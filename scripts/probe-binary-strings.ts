/**
 * Probe AM4-Edit.exe for known label strings using multiple encodings,
 * to figure out how UI labels are actually stored. The flat ASCII pass
 * found "Gain" 50 times but "Treble" zero times, so labels aren't all
 * stored as plain null-terminated C-strings.
 *
 * Tries:
 *   - ASCII byte sequence (no null terminator required)
 *   - UTF-16LE byte sequence
 *   - Pascal-style: u8 length + ASCII (Pascal-1 / .NET-style short-string)
 *   - .NET BSTR: u32 length + UTF-16LE
 *   - Length-prefixed ASCII: u32 len + ASCII
 *
 * For each encoding, report total hit count + first 5 offsets.
 */

import { readFileSync } from 'node:fs';

const exePath = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const buf = readFileSync(exePath);
console.log(`exe: ${exePath}`);
console.log(`size: ${buf.length.toLocaleString()} bytes\n`);

const PROBES = [
  'Gain', 'Bass', 'Mid', 'Treble', 'Master', 'Presence', 'Depth',
  'Bright Cap', 'BrightCap', 'Bright_Cap',
  'Spring Drive', 'Boiiinnng!', 'Spring Tone',
  'Sag', 'Negative Feedback', 'NegativeFeedback',
  'Tone', 'Drive', 'Level', 'Mix',
  'Threshold', 'Ratio', 'Attack', 'Release',
  'TS808', 'Plexi', 'Marshall', 'Fender',
  // Filename-style names that AM4-Edit might use as resource keys.
  'gain', 'bass', 'treble', 'master', 'presence',
  // Modifier-source names already known to be in the binary
  // (from Ghidra cluster #1 dump).
  'Modifier 1', 'Modifier 29', 'Input 1',
];

function asciiSeq(s: string): Buffer { return Buffer.from(s, 'ascii'); }
function utf16leSeq(s: string): Buffer { return Buffer.from(s, 'utf16le'); }
function utf16beSeq(s: string): Buffer {
  const out = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = 0;
    out[i * 2 + 1] = s.charCodeAt(i);
  }
  return out;
}
function pascal1(s: string): Buffer {
  return Buffer.concat([Buffer.from([s.length]), Buffer.from(s, 'ascii')]);
}
function lpAscii(s: string): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(s.length, 0);
  return Buffer.concat([len, Buffer.from(s, 'ascii')]);
}
function lpUtf16le(s: string): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(s.length, 0);
  return Buffer.concat([len, Buffer.from(s, 'utf16le')]);
}

function countAndFirst(needle: Buffer, max = 5): { count: number; first: number[] } {
  const out: number[] = [];
  let pos = 0;
  let total = 0;
  while (pos <= buf.length - needle.length) {
    const idx = buf.indexOf(needle, pos);
    if (idx < 0) break;
    total++;
    if (out.length < max) out.push(idx);
    pos = idx + 1;
  }
  return { count: total, first: out };
}

const ENCODINGS: Array<{ name: string; encode: (s: string) => Buffer }> = [
  { name: 'ASCII raw',       encode: asciiSeq   },
  { name: 'UTF-16LE',        encode: utf16leSeq },
  { name: 'UTF-16BE',        encode: utf16beSeq },
  { name: 'Pascal-1 (u8len)', encode: pascal1   },
  { name: 'LP-ASCII (u32+s)', encode: lpAscii   },
  { name: 'LP-UTF16LE (u32+u16s)', encode: lpUtf16le },
];

for (const probe of PROBES) {
  console.log(`\n--- ${probe} ---`);
  for (const enc of ENCODINGS) {
    const needle = enc.encode(probe);
    const r = countAndFirst(needle);
    if (r.count > 0) {
      const offsets = r.first.map(o => '0x' + o.toString(16)).join(', ');
      const more = r.count > 5 ? `, ... (+${r.count - 5} more)` : '';
      console.log(`  ${enc.name.padEnd(22)} ${r.count.toString().padStart(4)}  [${offsets}${more}]`);
    }
  }
}
