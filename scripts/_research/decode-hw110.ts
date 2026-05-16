/**
 * HW-110 — decode session-87-scene-midi-test-buttons.tshark.txt
 *
 * Lists every OUT 23-byte write chronologically with full bytewise
 * detail so we can identify the (scene, msg) → wire encoding for
 * the AM4-Edit scene-MIDI ▶ test-send buttons.
 */
import fs from 'fs';
import { unpackValue } from '@mcp-midi-control/core/fractal-shared/packValue.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx scripts/_research/decode-hw110.ts <file.tshark.txt>');
  process.exit(1);
}

type R = { frame: number; time: number; direction: 'IN' | 'OUT'; hex: string };
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
const records: R[] = [];
let cur: Partial<R> | undefined;
const frameRe = /^Frame (\d+):/;
const timeRe = /Time since reference or first frame:\s+([\d.]+)/;
const dirRe = /Endpoint:\s+0x[0-9a-f]+,\s+Direction:\s+(IN|OUT)/;
const reRe = /\[Reassembled data:\s+([0-9a-f]+)\]/;
for (const line of lines) {
  const m = line.match(frameRe);
  if (m) {
    if (cur?.frame && cur.hex && cur.direction) records.push(cur as R);
    cur = { frame: Number(m[1]) };
    continue;
  }
  if (!cur) continue;
  const t = line.match(timeRe);
  if (t) cur.time = Number(t[1]);
  const d = line.match(dirRe);
  if (d) cur.direction = d[1] as 'IN' | 'OUT';
  const r = line.match(reRe);
  if (r) cur.hex = r[1];
}
if (cur?.frame && cur.hex && cur.direction) records.push(cur as R);

function decode14(lo: number, hi: number) {
  return lo | (hi << 7);
}

const writes = records
  .filter((r) => r.direction === 'OUT' && r.hex.length / 2 === 23)
  .sort((a, b) => a.time - b.time);

console.log(`Total OUT 23-byte writes: ${writes.length}\n`);
console.log(
  'idx  t(s)    pidL  pidH  act   hdr3  hdr4 | payload bytes (after 16) | raw[]      | as u32 LE  | float',
);
console.log('-'.repeat(120));
for (let i = 0; i < writes.length; i++) {
  const r = writes[i];
  const b: number[] = [];
  for (let j = 0; j < r.hex.length; j += 2) b.push(parseInt(r.hex.slice(j, j + 2), 16));
  const pidLow = decode14(b[6], b[7]);
  const pidHigh = decode14(b[8], b[9]);
  const action = decode14(b[10], b[11]);
  const hdr3 = decode14(b[12], b[13]);
  const hdr4 = decode14(b[14], b[15]);
  const packed = b.slice(16, b.length - 2);
  const raw = [...unpackValue(new Uint8Array(packed), hdr4)];
  let u32 = 0, f32 = 0;
  if (raw.length >= 4) {
    const buf = new Uint8Array(raw);
    const dv = new DataView(buf.buffer);
    u32 = dv.getUint32(0, true);
    f32 = dv.getFloat32(0, true);
  }
  const rawHex = raw.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const payloadHex = packed.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  console.log(
    `${String(i + 1).padStart(3)}  ${r.time.toFixed(3).padStart(7)}  ` +
      `0x${pidLow.toString(16).padStart(4, '0')} ` +
      `0x${pidHigh.toString(16).padStart(4, '0')} ` +
      `0x${action.toString(16).padStart(4, '0')} ` +
      `0x${hdr3.toString(16).padStart(4, '0')} ` +
      `0x${hdr4.toString(16).padStart(4, '0')} | ` +
      `${payloadHex.padEnd(14)} | ${rawHex.padEnd(11)} | ` +
      `${String(u32).padStart(10)} | ${f32.toFixed(4)}`,
  );
}
