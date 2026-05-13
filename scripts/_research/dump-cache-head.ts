/**
 * Dump first N bytes of the AM4-Edit cache as a hex+ASCII view so we
 * can hand-decode the first few records. Temporary scaffolding for
 * parse-cache.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appdata = process.env.APPDATA;
if (!appdata) throw new Error('APPDATA not set');
const path = join(appdata, 'Fractal Audio', 'AM4-Edit', 'effectDefinitions_15_2p0.cache');
const buf = readFileSync(path);

const start = Number(process.argv[2] ?? 16);
const len = Number(process.argv[3] ?? 256);

for (let i = start; i < Math.min(start + len, buf.length); i += 16) {
  const slice = buf.slice(i, i + 16);
  const hex = [...slice].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...slice].map(b => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
  console.log(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(48, ' ')}  ${ascii}`);
}
