/**
 * Post-build asset copier. tsc compiles .ts → .js but doesn't copy
 * data files (.json, etc.) into the dist/ tree. The MCP server reads
 * lineage data at runtime via `fs.readFileSync('<dist>/fractal-shared/
 * lineage/<block>-lineage.json')`, so the JSON files have to be
 * present alongside the compiled .js. This script mirrors them.
 *
 * Workspace layout (post-Phase-B):
 *   packages/core/src/fractal-shared/lineage/*.json
 *   → packages/core/dist/fractal-shared/lineage/*.json
 *
 * Run via `npm run build` (chained after the per-package tsc builds).
 */
import { readdirSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface AssetCopy {
  src: string;
  dst: string;
}

const COPIES: AssetCopy[] = [
  {
    src: 'packages/core/src/fractal-shared/lineage',
    dst: 'packages/core/dist/fractal-shared/lineage',
  },
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
for (const { src, dst } of COPIES) {
  const n = copyTree(src, dst);
  console.log(`  copied ${n} file(s) from ${src} → ${dst}`);
  total += n;
}
console.log(`copy-build-assets: ${total} file(s) mirrored.`);
