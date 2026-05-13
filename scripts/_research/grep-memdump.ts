/**
 * Grep a process memory dump for known knob labels in every encoding.
 *
 * Usage:
 *   npx tsx scripts/grep-memdump.ts <dump-path>
 *
 * Output: for each label, the encoding it was found in and the first 5
 * file offsets. If labels exist in RAM as plaintext, they exist on disk
 * (somewhere) too — and the offsets give us anchor addresses to trace.
 */

import { readFileSync, statSync } from 'node:fs';

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage: grep-memdump.ts <dump-path>');
  process.exit(1);
}

console.log(`dump: ${dumpPath}`);
const stat = statSync(dumpPath);
console.log(`size: ${(stat.size / 1_000_000).toFixed(0)} MB\n`);

const buf = readFileSync(dumpPath);

const PROBES = [
  // Amp tone-stack — should hit if labels are in RAM
  'Treble', 'Presence', 'Depth',
  // Amp Extras / Preamp page — distinctive tokens
  'Bright Cap', 'BrightCap',
  'High Treble', 'Master Vol Trim', 'Input Trim',
  'Negative Feedback', 'Tonestack', 'Power Amp',
  'Saturation Drive', 'Saturation Switch',
  'Bias', 'Sag', 'Variac',
  // Reverb
  'Spring Drive', 'Spring Tone', 'Number Of Springs', 'Boiiinnng',
  'Predelay', 'Pre Delay', 'Pre-Delay',
  // Drive
  'Bit Reduce', 'Mid Freq', 'Bass Focus', 'Slew Rate',
  // Modulation
  'Mod Phase', 'LFO Type', 'LFO Phase', 'Phase Reverse', 'Thru-Zero',
  // Compressor
  'Knee Type', 'Auto Makeup', 'Look Ahead', 'Sidechain Source',
  // Generic
  'Gain', 'Bass', 'Mid', 'Master',
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
  { name: 'ASCII',     encode: asciiSeq },
  { name: 'UTF-16LE',  encode: utf16leSeq },
  { name: 'UTF-16BE',  encode: utf16beSeq },
];

console.log('=== probes ===\n');
const found: string[] = [];
for (const probe of PROBES) {
  const lines: string[] = [];
  for (const enc of ENCODINGS) {
    const r = countAndFirst(enc.encode(probe));
    if (r.count > 0) {
      const offsets = r.first.map(o => '0x' + o.toString(16)).join(', ');
      const more = r.count > 5 ? ` ...+${r.count - 5}` : '';
      lines.push(`  ${enc.name.padEnd(10)} ${r.count.toString().padStart(5)}× [${offsets}${more}]`);
    }
  }
  if (lines.length) {
    console.log(`"${probe}"`);
    for (const l of lines) console.log(l);
    found.push(probe);
  }
}

console.log(`\n=== summary ===`);
console.log(`probes:    ${PROBES.length}`);
console.log(`found:     ${found.length}`);
console.log(`not found: ${PROBES.length - found.length}`);
const missing = PROBES.filter(p => !found.includes(p));
if (missing.length) console.log(`missing: ${missing.join(', ')}`);
