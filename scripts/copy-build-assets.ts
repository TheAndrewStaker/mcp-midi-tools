/**
 * Post-build asset copier.
 *
 * As of the Phase-B `fractal-midi` extraction (2026-05-18), the lineage
 * JSON data lives inside the `fractal-midi` package — the MCP server
 * reads it via `runLineageLookup` imported from `fractal-midi/shared`,
 * which resolves at runtime to the lineage JSON files bundled in the
 * linked package's compiled output.
 *
 * So this repo no longer needs to copy lineage JSON into its own
 * per-package dist trees. The `COPIES` list is empty for that reason
 * and the script is now a no-op — kept (rather than deleted) so the
 * `npm run build` chain that invokes it doesn't break, and so that any
 * future per-package data assets have a clear home to land in.
 */
import { readdirSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface AssetCopy {
  src: string;
  dst: string;
}

const COPIES: AssetCopy[] = [];

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
