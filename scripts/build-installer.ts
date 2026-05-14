#!/usr/bin/env node
/**
 * scripts/build-installer.ts
 *
 * Build the MCP MIDI Control release bundle for v0.1.0.
 *
 * Output:
 *   build/staging/                              -- bundle contents (also reused
 *                                                  if/when the Inno Setup .exe
 *                                                  installer ships in v0.2)
 *   build/dist/mcp-midi-control-v<version>.zip    -- shippable ZIP (this is
 *                                                  what users download)
 *
 * Steps performed:
 *   1. Clean build/staging/.
 *   2. Compile TypeScript -> dist/.
 *   3. Download node.exe for the pinned version (cached in build/node-cache/).
 *   4. Copy dist/, package.json, package-lock.json, LICENSE, NOTICE, node.exe,
 *      installer wrappers (setup.cmd, uninstall.cmd, instructions.txt) and
 *      PowerShell helpers into build/staging/.
 *   5. Run `npm ci --omit=dev` inside build/staging/ using the BUNDLED Node
 *      (so native node-midi compiles against the same V8 ABI we ship).
 *   6. Verify staging by invoking the bundled node --version and asserting
 *      the entry point + native node-midi binary are present.
 *   7. Package build/staging/ into a versioned ZIP at build/dist/.
 *
 * Usage:
 *   npm run build:installer
 *   npm run build:installer -- --clean   # also wipe build/node-cache
 *
 * Why bundle Node + node_modules instead of using `pkg`/`nexe`/SEA:
 *   See docs/DECISIONS.md 2026-05-03 packager row. The native node-midi
 *   .node addon is friendliest with file-on-disk distribution; single-binary
 *   tools handle native addons via fragile runtime extraction.
 *
 * Why ZIP for v0.1.0 (not .exe installer):
 *   See docs/DECISIONS.md 2026-05-03 cert row + the v0.1.0 strategy
 *   conversation: forum-savvy users prefer "extract folder, double-click
 *   setup.cmd"; .exe installer with full SmartScreen click-through is
 *   deferred to v0.2 once we have install-friction data.
 */

import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';

// Pinned Node version. Matches founder's dev env (verified 2026-05-03 = v24.13.1)
// so native modules compiled here are ABI-compatible with the runtime we ship.
// Bump only after retesting `npm run preflight` against the new Node version.
const NODE_VERSION = '24.13.1';
const NODE_ARCH = 'win-x64';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const PKG_JSON = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
) as { version: string };
const VERSION = PKG_JSON.version;

const BUILD_DIR = path.join(PROJECT_ROOT, 'build');
const STAGING = path.join(BUILD_DIR, 'staging');
const DIST_DIR = path.join(BUILD_DIR, 'dist');
const NODE_CACHE = path.join(BUILD_DIR, 'node-cache');
const NODE_DIR_NAME = `node-v${NODE_VERSION}-${NODE_ARCH}`;
const NODE_ZIP_NAME = `${NODE_DIR_NAME}.zip`;
const NODE_DOWNLOAD_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP_NAME}`;
const RELEASE_DIR_NAME = `mcp-midi-control-v${VERSION}`;
const RELEASE_ZIP_PATH = path.join(DIST_DIR, `${RELEASE_DIR_NAME}.zip`);

const cleanFlag = process.argv.includes('--clean');

async function main() {
  console.log(`[build] MCP MIDI Control installer staging — bundling Node v${NODE_VERSION}`);

  // 1. Clean staging (always); optionally clean node-cache.
  if (fs.existsSync(STAGING)) {
    fs.rmSync(STAGING, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING, { recursive: true });

  if (cleanFlag && fs.existsSync(NODE_CACHE)) {
    console.log('[build] --clean: wiping node-cache');
    fs.rmSync(NODE_CACHE, { recursive: true, force: true });
  }
  fs.mkdirSync(NODE_CACHE, { recursive: true });

  // 2. Compile TypeScript across all workspace packages.
  console.log('[build] Compiling TypeScript (all workspace packages)');
  execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  const compiledEntry = path.join(
    PROJECT_ROOT,
    'packages',
    'server-all',
    'dist',
    'server',
    'index.js',
  );
  if (!fs.existsSync(compiledEntry)) {
    throw new Error(`TypeScript compile produced no ${path.relative(PROJECT_ROOT, compiledEntry)}`);
  }

  // 3. Ensure node.exe is cached locally.
  const cachedNodeDir = path.join(NODE_CACHE, NODE_DIR_NAME);
  const cachedNodeExe = path.join(cachedNodeDir, 'node.exe');
  const cachedNpmCli = path.join(cachedNodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(cachedNodeExe)) {
    await downloadAndExtractNode();
  } else {
    console.log(`[build] Using cached node.exe at ${cachedNodeExe}`);
  }
  if (!fs.existsSync(cachedNpmCli)) {
    throw new Error(`Bundled npm not found at ${cachedNpmCli} — Node ZIP layout may have changed`);
  }

  // 4. Stage workspace packages.
  //
  // Bundle layout (no symlinks; safe to ZIP and Explorer-extract):
  //   STAGING/
  //   ├── node.exe
  //   ├── package.json  (lean root: NO workspaces; deps = non-workspace only)
  //   ├── node_modules/
  //   │   ├── @modelcontextprotocol/sdk/  (npm install populates)
  //   │   ├── midi/                       (npm install populates, native build)
  //   │   ├── zod/                        (npm install populates)
  //   │   └── @mcp-midi-control/
  //   │       ├── core/{package.json,dist/}        (copied from packages/core)
  //   │       ├── am4/{package.json,dist/}         (copied from packages/am4)
  //   │       ├── axe-fx-ii/{package.json,dist/}
  //   │       ├── hydrasynth-explorer/{package.json,dist/}
  //   │       └── server-all/{package.json,dist/}
  //   ├── LICENSE, NOTICE
  //   ├── setup.cmd, uninstall.cmd, verify-midi.cmd, instructions.txt
  //   └── install/{merge,unmerge}-mcp-config.ps1
  //
  // Node resolves cross-package imports (e.g. server-all importing
  // `@mcp-midi-control/core/midi/transport.js`) via normal node_modules
  // walk-up — each package is a real directory under
  // node_modules/@mcp-midi-control/, no symlinks needed.
  console.log('[build] Staging artifacts');
  const WORKSPACE_PACKAGES = [
    'core',
    'am4',
    'axe-fx-ii',
    'hydrasynth-explorer',
    'server-all',
  ] as const;

  // 4a. Lean root package.json — NO workspaces, NO @mcp-midi-control/*
  //     deps. npm install only fetches the three leaf node-only deps.
  //     We pull leaf-dep versions from the project's devDependencies
  //     (Phase B moved them there since each workspace package now
  //     declares its own runtime deps).
  const devPkg = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const leafDeps = ['@modelcontextprotocol/sdk', 'midi', 'zod'] as const;
  const leanDeps: Record<string, string> = {};
  for (const d of leafDeps) {
    const v = devPkg.devDependencies?.[d] ?? devPkg.dependencies?.[d];
    if (!v) throw new Error(`Leaf dep ${d} missing from root package.json`);
    leanDeps[d] = v;
  }
  const leanPkg = {
    name: 'mcp-midi-control-bundle',
    version: VERSION,
    private: true,
    type: 'module' as const,
    dependencies: leanDeps,
  };
  fs.writeFileSync(
    path.join(STAGING, 'package.json'),
    JSON.stringify(leanPkg, null, 2) + '\n',
  );

  // 4b. Static files at staging root.
  for (const f of ['LICENSE', 'NOTICE']) {
    fs.copyFileSync(path.join(PROJECT_ROOT, f), path.join(STAGING, f));
  }
  fs.copyFileSync(cachedNodeExe, path.join(STAGING, 'node.exe'));

  // Installer wrappers (root of the bundle so users see them after
  // extracting): setup.cmd / uninstall.cmd / verify-midi.cmd /
  // instructions.txt.
  for (const f of ['setup.cmd', 'uninstall.cmd', 'verify-midi.cmd', 'instructions.txt']) {
    fs.copyFileSync(path.join(PROJECT_ROOT, 'installer', f), path.join(STAGING, f));
  }
  // PowerShell helpers go under install/ to keep the root tidy.
  const installerHelperDir = path.join(STAGING, 'install');
  fs.mkdirSync(installerHelperDir, { recursive: true });
  for (const f of ['merge-mcp-config.ps1', 'unmerge-mcp-config.ps1']) {
    fs.copyFileSync(path.join(PROJECT_ROOT, 'installer', f), path.join(installerHelperDir, f));
  }

  // 5. Production-only npm install using the BUNDLED node + npm. This
  // guarantees the native node-midi binary is compiled against the same
  // V8 ABI as the node.exe we ship, regardless of what's on PATH. Only
  // the three leaf deps install.
  //
  // ORDER MATTERS: install FIRST, copy workspace packages AFTER. If we
  // pre-place the workspace packages, npm install treats them as
  // orphans (no declaration in the lean package.json) and prunes them.
  console.log('[build] Installing leaf production deps with bundled node + npm');
  execSync(
    `"${cachedNodeExe}" "${cachedNpmCli}" install --omit=dev --no-package-lock`,
    { cwd: STAGING, stdio: 'inherit' }
  );

  // 6. Copy each workspace package as a real directory under
  // node_modules/@mcp-midi-control/. Done AFTER npm install so npm
  // doesn't prune them. Node's runtime resolution finds them by
  // directory presence + each package's `exports` field — no need for
  // the bundle to be a workspace, no symlinks needed (ZIP-safe).
  console.log('[build] Copying workspace packages into node_modules');
  const mcpNs = path.join(STAGING, 'node_modules', '@mcp-midi-control');
  fs.mkdirSync(mcpNs, { recursive: true });
  for (const pkg of WORKSPACE_PACKAGES) {
    const srcPkg = path.join(PROJECT_ROOT, 'packages', pkg);
    const dstPkg = path.join(mcpNs, pkg);
    fs.mkdirSync(dstPkg, { recursive: true });

    // Strip workspace-internal deps (`@mcp-midi-control/*: "*"`) from
    // each copied package.json — the shipped bundle isn't a workspace,
    // so the `"*"` specifier would confuse any future `npm` run. Real-
    // directory presence + each package's `exports` field is what runtime
    // resolution actually needs. Non-internal deps (e.g. `midi`) stay
    // listed but are already present at the bundle's root node_modules.
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(srcPkg, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; [k: string]: unknown };
    if (pkgJson.dependencies) {
      const cleaned: Record<string, string> = {};
      for (const [name, version] of Object.entries(pkgJson.dependencies)) {
        if (!name.startsWith('@mcp-midi-control/')) cleaned[name] = version;
      }
      pkgJson.dependencies = cleaned;
    }
    fs.writeFileSync(
      path.join(dstPkg, 'package.json'),
      JSON.stringify(pkgJson, null, 2) + '\n',
    );
    fs.cpSync(path.join(srcPkg, 'dist'), path.join(dstPkg, 'dist'), { recursive: true });
  }

  // 7. Verify the bundle.
  const stagedNodeExe = path.join(STAGING, 'node.exe');
  const versionOutput = execSync(`"${stagedNodeExe}" --version`).toString().trim();
  if (!versionOutput.includes(NODE_VERSION)) {
    throw new Error(`Bundled node reported ${versionOutput}; expected v${NODE_VERSION}`);
  }

  const stagedEntry = path.join(
    STAGING,
    'node_modules',
    '@mcp-midi-control',
    'server-all',
    'dist',
    'server',
    'index.js',
  );
  if (!fs.existsSync(stagedEntry)) {
    throw new Error(`Entry point missing at ${stagedEntry}`);
  }

  const stagedNativeMidi = path.join(STAGING, 'node_modules', 'midi', 'build', 'Release', 'midi.node');
  if (!fs.existsSync(stagedNativeMidi)) {
    throw new Error(
      `Native node-midi binary missing at ${stagedNativeMidi}.\n` +
      `npm install probably skipped the native build step. Try: rm -rf build/staging/node_modules ` +
      `&& re-run this script.`
    );
  }

  // Note: skipping a deeper import-resolution smoke test here because the
  // server reads stdio for MCP and shouldn't be spawned headless without
  // a transport peer. The `npm run preflight` smoke-server step already
  // exercises the same dist/ entry against a real MCP handshake, so any
  // import-resolution regression would have been caught before this
  // script runs.

  const stagedSize = dirSizeMb(STAGING);

  // 8. Package staging into a versioned ZIP. Rename staging -> versioned
  // dir so the ZIP contains a clean top-level folder, then rename back so
  // re-builds and the deferred Inno Setup .iss path keep working.
  console.log('[build] Packaging release ZIP');
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(RELEASE_ZIP_PATH)) {
    fs.unlinkSync(RELEASE_ZIP_PATH);
  }
  const versionedDir = path.join(BUILD_DIR, RELEASE_DIR_NAME);
  if (fs.existsSync(versionedDir)) {
    fs.rmSync(versionedDir, { recursive: true, force: true });
  }
  fs.renameSync(STAGING, versionedDir);
  try {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${versionedDir}' -DestinationPath '${RELEASE_ZIP_PATH}' -Force"`,
      { stdio: 'inherit' },
    );
  } finally {
    fs.renameSync(versionedDir, STAGING);
  }
  if (!fs.existsSync(RELEASE_ZIP_PATH)) {
    throw new Error(`Compress-Archive did not produce ${RELEASE_ZIP_PATH}`);
  }
  const zipSizeMb = Math.round(fs.statSync(RELEASE_ZIP_PATH).size / (1024 * 1024));

  console.log('');
  console.log('[build] OK release bundle ready');
  console.log(`        staging:         ${STAGING} (${stagedSize} MB)`);
  console.log(`        release ZIP:     ${RELEASE_ZIP_PATH} (${zipSizeMb} MB)`);
  console.log(`        bundled node:    ${versionOutput}`);
  console.log(`        entry point:     node_modules/@mcp-midi-control/server-all/dist/server/index.js`);
  console.log(`        native node-midi: node_modules/midi/build/Release/midi.node`);
  console.log('');
  console.log('Next: smoke-test the ZIP on a clean Win11 VM per docs/RELEASE-RUNBOOK.md');
}

async function downloadAndExtractNode() {
  const zipPath = path.join(NODE_CACHE, NODE_ZIP_NAME);
  console.log(`[build] Downloading ${NODE_DOWNLOAD_URL}`);
  const res = await fetch(NODE_DOWNLOAD_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Node download failed: ${res.status} ${res.statusText}`);
  }
  const out = fs.createWriteStream(zipPath);
  await finished(Readable.fromWeb(res.body as any).pipe(out));

  console.log(`[build] Extracting ${NODE_ZIP_NAME}`);
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${NODE_CACHE}' -Force"`,
    { stdio: 'inherit' }
  );
  if (!fs.existsSync(path.join(NODE_CACHE, NODE_DIR_NAME, 'node.exe'))) {
    throw new Error(`After extract, expected node.exe at ${NODE_CACHE}\\${NODE_DIR_NAME}\\node.exe`);
  }
  fs.unlinkSync(zipPath);
}

function dirSizeMb(dir: string): number {
  let bytes = 0;
  function walk(p: string) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(p)) walk(path.join(p, child));
    } else {
      bytes += stat.size;
    }
  }
  walk(dir);
  return Math.round(bytes / (1024 * 1024));
}

main().catch((err) => {
  console.error('\n[build] FAILED:', err.message);
  process.exit(1);
});
