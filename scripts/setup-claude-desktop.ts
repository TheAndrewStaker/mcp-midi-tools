/**
 * One-shot Claude Desktop bootstrap for source-install developers.
 *
 * Wraps `installer/merge-mcp-config.ps1` so a contributor cloning the
 * repo for the first time can:
 *
 *   git clone …
 *   cd mcp-midi-control
 *   npm install
 *   npm run setup-claude-desktop   # this script
 *   # restart Claude Desktop, done
 *
 * Without manually:
 *   - locating the right Claude Desktop config file (UWP vs MSI variants
 *     have different paths)
 *   - hand-editing JSON without breaking other MCP server entries
 *   - figuring out which Node command + args + path to write
 *
 * The merge script is the same one the v0.1.0 ZIP installer uses (via
 * `installer/setup.cmd`) — both end-user and developer paths share one
 * implementation, so a fix in one path lands in the other.
 *
 * Pre-requisite: `npm run build` must have produced `dist/server/
 * index.js`. The npm script (`npm run setup-claude-desktop`) chains
 * `build` automatically; running this `tsx` invocation directly skips
 * that chain, so build first.
 *
 * Platform: Windows-only at the moment. Source-install on macOS / Linux
 * works (preflight + smoke pass), but this bootstrap relies on
 * PowerShell. Mac/Linux equivalents are tracked in P5-006.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENTRY_JS = path.join(PROJECT_ROOT, 'dist', 'server', 'index.js');
const MERGE_SCRIPT = path.join(PROJECT_ROOT, 'installer', 'merge-mcp-config.ps1');

if (process.platform !== 'win32') {
    console.error(
        'setup-claude-desktop: Windows-only for now. macOS / Linux contributors ' +
        'still need to hand-edit Claude Desktop\'s config (see README "Connect to ' +
        'Claude" section). P5-006 tracks adding Mac/Linux bootstrap.',
    );
    process.exit(1);
}

if (!existsSync(ENTRY_JS)) {
    console.error(
        `setup-claude-desktop: build artifact missing at ${ENTRY_JS}.\n` +
        `Run \`npm run build\` first (or just \`npm run setup-claude-desktop\` ` +
        `which chains build automatically).`,
    );
    process.exit(1);
}

if (!existsSync(MERGE_SCRIPT)) {
    console.error(`setup-claude-desktop: merge script missing at ${MERGE_SCRIPT}.`);
    process.exit(1);
}

console.log(`Registering mcp-midi-control with Claude Desktop…`);
console.log(`  install dir: ${PROJECT_ROOT}`);
console.log(`  entry:       ${ENTRY_JS}`);
console.log();

try {
    // -ExecutionPolicy Bypass so corporate-managed machines don't
    // require an admin policy change just to run this script. The
    // .ps1 file lives inside the project, the user already chose to
    // clone + install — they trust the source.
    execSync(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${MERGE_SCRIPT}" -InstallDir "${PROJECT_ROOT}"`,
        { stdio: 'inherit' },
    );
} catch (err) {
    console.error(
        `\nsetup-claude-desktop failed. Most common causes:\n` +
        `  - Claude Desktop not installed yet (script wrote a config file ` +
        `to where Desktop will look — install Claude Desktop and you should ` +
        `still be good).\n` +
        `  - PowerShell execution policy blocked the script. Workaround: open ` +
        `PowerShell as Administrator and run\n` +
        `      Set-ExecutionPolicy -Scope CurrentUser RemoteSigned\n` +
        `    then re-run \`npm run setup-claude-desktop\`.\n` +
        `\nUnderlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
}

console.log();
console.log('Done. Restart Claude Desktop fully (right-click tray icon → Quit, then');
console.log('relaunch) for the change to take effect.');
console.log();
console.log('After source-code changes that touch src/, re-run:');
console.log('  npm run build && (restart Claude Desktop)');
console.log('or just `npm run setup-claude-desktop` again — it rebuilds + writes the');
console.log('config (idempotent, safe to re-run).');
