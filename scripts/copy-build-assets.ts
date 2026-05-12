/**
 * Post-build asset copier. tsc compiles .ts → .js but doesn't copy
 * data files (.json, etc.) into the dist/ tree. The MCP server reads
 * lineage data at runtime via `fs.readFileSync('dist/fractal/shared/
 * lineage/<block>-lineage.json')`, so the JSON files have to be
 * present alongside the compiled .js. This script mirrors them.
 *
 * Run via `npm run build` (chained after tsc + tsc-alias).
 */
import { readdirSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = 'src';
const DIST_ROOT = 'dist';

// Globs to copy. Each entry is a directory under SRC_ROOT whose
// non-.ts files should be mirrored to DIST_ROOT.
const ASSET_DIRS = [
  'fractal/shared/lineage',
];

function copyTree(srcDir: string, distDir: string): number {
  let count = 0;
  if (!safeExists(srcDir)) return 0;
  mkdirSync(distDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name);
    const distPath = join(distDir, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      count += copyTree(srcPath, distPath);
    } else if (!srcPath.endsWith('.ts')) {
      copyFileSync(srcPath, distPath);
      count++;
    }
  }
  return count;
}

function safeExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

let total = 0;
for (const rel of ASSET_DIRS) {
  const src = join(SRC_ROOT, rel);
  const dst = join(DIST_ROOT, rel);
  const n = copyTree(src, dst);
  console.log(`  copied ${n} file(s) from ${src} → ${dst}`);
  total += n;
}
console.log(`copy-build-assets: ${total} file(s) mirrored.`);
