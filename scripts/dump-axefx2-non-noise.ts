/**
 * One-shot triage dumper: read an Axe-Fx II passive capture, print every
 * SysEx frame whose function byte is NOT in the known-noise set
 * (keepalive 0x10, polls 0x12/0x15). Used to surface the novel envelope
 * inside a noisy single-click AxeEdit capture (HW-108).
 *
 * Usage: npx tsx scripts/dump-axefx2-non-noise.ts <path.syx>
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const PREFIX = [0xf0, 0x00, 0x01, 0x74, 0x07];
const NOISE_FNS = new Set([0x10, 0x12, 0x15]);

function splitSysEx(buf: Uint8Array): { offset: number; bytes: Uint8Array }[] {
  const out: { offset: number; bytes: Uint8Array }[] = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xf0) { i++; continue; }
    let end = i + 1;
    while (end < buf.length && buf[end] !== 0xf7) end++;
    if (end >= buf.length) break;
    const bytes = buf.subarray(i, end + 1);
    if (
      bytes.length >= 7 &&
      bytes[1] === PREFIX[1] && bytes[2] === PREFIX[2] &&
      bytes[3] === PREFIX[3] && bytes[4] === PREFIX[4]
    ) {
      out.push({ offset: i, bytes });
    }
    i = end + 1;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

const arg = process.argv[2];
if (!arg) { console.error('Usage: dump-axefx2-non-noise <path.syx>'); process.exit(1); }
const abs = path.resolve(arg);
if (!existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(1); }

const buf = readFileSync(abs);
const frames = splitSysEx(buf);
const interesting = frames.filter((f) => !NOISE_FNS.has(f.bytes[5]));

console.log(`Total Axe-Fx II frames: ${frames.length}`);
console.log(`Noise (fn ∈ {0x10, 0x12, 0x15}): ${frames.length - interesting.length}`);
console.log(`Interesting: ${interesting.length}`);
console.log('');

// Group consecutive interesting frames by function byte for readability
let lastFn = -1;
let blockCounter = 0;
for (const f of interesting) {
  const fn = f.bytes[5];
  if (fn !== lastFn) {
    if (lastFn !== -1) console.log('');
    blockCounter++;
    console.log(`── fn 0x${fn.toString(16).padStart(2, '0')} ────────────────────────────────────────────────`);
    lastFn = fn;
  }
  // Print: file offset, length, full hex
  console.log(`  @${f.offset.toString(16).padStart(6, '0')}  len=${f.bytes.length.toString().padStart(3)}  ${toHex(f.bytes)}`);
}
