/**
 * Pull every printable C-string from AM4-Edit.exe with its file offset.
 *
 * The premise: AM4-Edit's UI labels (knob names) live in .rdata as
 * NUL-terminated ASCII strings. If they're stored in a contiguous pool
 * whose order mirrors the cache-record order, we can mechanically map
 * cache_id → name without runtime instrumentation.
 *
 * This script is the raw extraction step. It produces:
 *   samples/captured/decoded/exe-strings.json
 *
 *   [
 *     { offset: 0x559aa0, kind: 'ascii', value: 'Input 1' },
 *     { offset: 0x559aa8, kind: 'ascii', value: 'Input 2' },
 *     ...
 *   ]
 *
 * Both ASCII and UTF-16LE variants are extracted. Min length 3 chars.
 *
 * Run:
 *   npx tsx scripts/extract-exe-strings.ts
 *     [--exe "C:\Program Files\Fractal Audio\AM4-Edit\AM4-Edit.exe"]
 *     [--min 3]
 *     [--out samples/captured/decoded/exe-strings.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

const exePath = flag('exe', 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe')!;
const minLen = parseInt(flag('min', '3')!, 10);
const outPath = flag('out', 'samples/captured/decoded/exe-strings.json')!;

console.log(`exe:    ${exePath}`);
console.log(`min:    ${minLen}`);
console.log(`out:    ${outPath}`);

const buf = readFileSync(exePath);
console.log(`size:   ${buf.length.toLocaleString()} bytes`);

interface ExtractedString {
  offset: number;
  kind: 'ascii' | 'utf16le';
  value: string;
}

function isPrintableAscii(b: number): boolean {
  return b >= 0x20 && b <= 0x7e;
}

const results: ExtractedString[] = [];

// ASCII pass: walk the buffer byte by byte. Whenever we hit a printable
// byte after a non-printable one, start a run; close the run on first
// non-printable. Emit if length ≥ minLen.
{
  let runStart = -1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (isPrintableAscii(b)) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) {
        const len = i - runStart;
        if (len >= minLen) {
          results.push({
            offset: runStart,
            kind: 'ascii',
            value: buf.toString('ascii', runStart, i),
          });
        }
        runStart = -1;
      }
    }
  }
  if (runStart >= 0 && buf.length - runStart >= minLen) {
    results.push({
      offset: runStart,
      kind: 'ascii',
      value: buf.toString('ascii', runStart, buf.length),
    });
  }
}

console.log(`ascii:  ${results.length.toLocaleString()} strings`);

// UTF-16LE pass: walk the buffer two bytes at a time. UTF-16LE printable
// runs have the pattern XX 00 XX 00 ... where each XX is a printable
// ASCII byte. Many Windows apps store UI labels this way for Qt/WinAPI.
const asciiCount = results.length;
{
  let runStart = -1;
  let i = 0;
  while (i + 1 < buf.length) {
    const lo = buf[i];
    const hi = buf[i + 1];
    if (hi === 0 && isPrintableAscii(lo)) {
      if (runStart < 0) runStart = i;
      i += 2;
    } else {
      if (runStart >= 0) {
        const len = (i - runStart) / 2;
        if (len >= minLen) {
          let str = '';
          for (let p = runStart; p < i; p += 2) str += String.fromCharCode(buf[p]);
          results.push({ offset: runStart, kind: 'utf16le', value: str });
        }
        runStart = -1;
      }
      i += 1;
    }
  }
  if (runStart >= 0) {
    const len = (i - runStart) / 2;
    if (len >= minLen) {
      let str = '';
      for (let p = runStart; p < i; p += 2) str += String.fromCharCode(buf[p]);
      results.push({ offset: runStart, kind: 'utf16le', value: str });
    }
  }
}

console.log(`utf16:  ${(results.length - asciiCount).toLocaleString()} strings`);
console.log(`total:  ${results.length.toLocaleString()} strings`);

// Sort by offset for human-readable output. Both ASCII and UTF-16
// strings interleave by file address.
results.sort((a, b) => a.offset - b.offset);

writeFileSync(outPath, JSON.stringify(results, null, 0));
console.log(`\nwrote ${outPath}  (${(buf.length / 1_000_000).toFixed(1)} MB exe → ${(JSON.stringify(results).length / 1_000_000).toFixed(1)} MB json)`);
