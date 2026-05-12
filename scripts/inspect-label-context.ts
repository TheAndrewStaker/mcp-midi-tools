/**
 * Look at the bytes immediately before / after a known label in the
 * memory dump. The structure (length-prefix? null-terminated? embedded
 * in a struct?) will tell us how to decode the labels.
 *
 * Also: try XOR / Caesar shifts of known labels and search for those
 * patterns in AM4-Edit.exe. If a single XOR or shift produces hits,
 * we've found the encoding.
 */

import { readFileSync } from 'node:fs';

const dumpPath = process.argv[2] ?? 'samples/captured/session-46-am4edit.DMP';
const exePath = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';

console.log(`dump: ${dumpPath}`);
console.log(`exe:  ${exePath}\n`);

const dump = readFileSync(dumpPath);
const exe = readFileSync(exePath);

// Pick a few unambiguous labels (low collision risk)
const TARGETS = [
  'Bright Cap', 'Master Vol Trim', 'Negative Feedback',
  'Saturation Drive', 'Variac', 'Spring Tone', 'Bass Focus',
  'Slew Rate', 'Sidechain Source', 'Knee Type', 'High Treble',
];

console.log('=== Label CONTEXT in memory dump ===');
for (const label of TARGETS) {
  const needle = Buffer.from(label, 'ascii');
  const off = dump.indexOf(needle);
  if (off < 0) {
    console.log(`\n"${label}" — NOT FOUND in dump`);
    continue;
  }
  const before = dump.subarray(Math.max(0, off - 32), off);
  const at     = dump.subarray(off, off + needle.length);
  const after  = dump.subarray(off + needle.length, off + needle.length + 16);
  const fmt = (b: Buffer): string =>
    [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
  const printable = (b: Buffer): string =>
    [...b].map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
  console.log(`\n"${label}" at dump offset 0x${off.toString(16)}`);
  console.log(`  -32 .. 0:    ${fmt(before)}  ${printable(before)}`);
  console.log(`  +0 .. +n:    ${fmt(at)}  ${printable(at)}`);
  console.log(`  +n .. +16:   ${fmt(after)}  ${printable(after)}`);
}

// Try XOR with each constant byte and check if "Treble" appears
// anywhere in the exe under that XOR mask. If yes → labels stored
// xor-encoded.
console.log('\n=== XOR-byte search in AM4-Edit.exe ===');
function xorSearch(target: string, key: number): number[] {
  const enc = Buffer.alloc(target.length);
  for (let i = 0; i < target.length; i++) enc[i] = target.charCodeAt(i) ^ key;
  const hits: number[] = [];
  let pos = 0;
  while (pos <= exe.length - enc.length) {
    const idx = exe.indexOf(enc, pos);
    if (idx < 0) break;
    hits.push(idx);
    pos = idx + 1;
    if (hits.length >= 3) break;
  }
  return hits;
}

const TEST_LABELS = ['Treble', 'Bright Cap', 'Negative Feedback', 'Saturation Drive'];
for (const target of TEST_LABELS) {
  console.log(`\nXOR of "${target}":`);
  let any = false;
  for (let key = 0; key < 256; key++) {
    if (key === 0) continue; // 0 = identity, already tested as zero
    const hits = xorSearch(target, key);
    if (hits.length > 0) {
      any = true;
      const offsets = hits.map(o => '0x' + o.toString(16)).join(', ');
      console.log(`  XOR 0x${key.toString(16).padStart(2, '0')}: ${hits.length} hits [${offsets}]`);
    }
  }
  if (!any) console.log(`  no XOR-byte mask matches.`);
}

// Caesar shift search: each char += N
console.log('\n=== Caesar-shift search in AM4-Edit.exe ===');
function caesarSearch(target: string, shift: number): number[] {
  const enc = Buffer.alloc(target.length);
  for (let i = 0; i < target.length; i++) enc[i] = (target.charCodeAt(i) + shift) & 0xff;
  const hits: number[] = [];
  let pos = 0;
  while (pos <= exe.length - enc.length) {
    const idx = exe.indexOf(enc, pos);
    if (idx < 0) break;
    hits.push(idx);
    pos = idx + 1;
    if (hits.length >= 3) break;
  }
  return hits;
}

for (const target of TEST_LABELS) {
  console.log(`\nCaesar-shift of "${target}":`);
  let any = false;
  for (let shift = -64; shift <= 64; shift++) {
    if (shift === 0) continue;
    const hits = caesarSearch(target, shift);
    if (hits.length > 0) {
      any = true;
      const offsets = hits.map(o => '0x' + o.toString(16)).join(', ');
      console.log(`  shift ${shift > 0 ? '+' : ''}${shift}: ${hits.length} hits [${offsets}]`);
    }
  }
  if (!any) console.log(`  no Caesar-shift matches.`);
}
