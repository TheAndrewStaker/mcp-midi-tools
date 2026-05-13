/**
 * HW-067 — decode session-46-main-levels.pcapng
 *
 * Extracts every OUT 23-byte SysEx write from the parametric-sweep capture,
 * groups by (pidLow, pidHigh, action), and emits a per-cluster chronology
 * with float / u32 / display-value interpretation. Used to identify the
 * Main Levels register family (preset.level / preset.balance / scene_level).
 */
import fs from 'fs';
import { unpackValue } from '@/fractal/shared/packValue.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx scripts/decode-main-levels.ts <file.tshark.txt>');
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

type Decoded = {
  time: number;
  hex: string;
  pidLow: number;
  pidHigh: number;
  action: number;
  hdr3: number;
  hdr4: number;
  raw: number[];
  asFloat?: number;
  asU32?: number;
  asI32?: number;
};

function describeWrite(time: number, hex: string): Decoded | undefined {
  const b: number[] = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  if (b.length !== 23) return undefined;
  const pidLow = decode14(b[6], b[7]);
  const pidHigh = decode14(b[8], b[9]);
  const action = decode14(b[10], b[11]);
  const hdr3 = decode14(b[12], b[13]);
  const hdr4 = decode14(b[14], b[15]);
  const packed = b.slice(16, b.length - 2);
  const raw = unpackValue(new Uint8Array(packed), hdr4);
  const out: Decoded = { time, hex, pidLow, pidHigh, action, hdr3, hdr4, raw: [...raw] };
  if (hdr4 === 4) {
    const buf = new Uint8Array(raw);
    const dv = new DataView(buf.buffer);
    out.asFloat = dv.getFloat32(0, true);
    out.asU32 = dv.getUint32(0, true);
    out.asI32 = dv.getInt32(0, true);
  }
  return out;
}

const writes: Decoded[] = [];
for (const r of records) {
  if (r.direction !== 'OUT') continue;
  if (r.hex.length / 2 !== 23) continue;
  const d = describeWrite(r.time, r.hex);
  if (d) writes.push(d);
}

console.log(`Total OUT 23-byte writes: ${writes.length}`);
console.log();

// Group by (pidLow, pidHigh, action), count, time-span
const groups = new Map<string, Decoded[]>();
for (const w of writes) {
  const key = `${w.pidLow.toString(16).padStart(4, '0')}_${w.pidHigh
    .toString(16)
    .padStart(4, '0')}_${w.action.toString(16).padStart(4, '0')}`;
  const arr = groups.get(key) ?? [];
  arr.push(w);
  groups.set(key, arr);
}

console.log(
  'group key                          | count | time range          | float range',
);
console.log(
  '-----------------------------------+-------+---------------------+------------------------',
);
const sorted = [...groups.entries()].sort((a, b) => a[1][0].time - b[1][0].time);
for (const [key, arr] of sorted) {
  const t0 = arr[0].time;
  const t1 = arr[arr.length - 1].time;
  const floats = arr.map((w) => w.asFloat ?? NaN).filter((f) => !Number.isNaN(f));
  const fMin = Math.min(...floats);
  const fMax = Math.max(...floats);
  console.log(
    `pidL=0x${key.slice(0, 4)} pidH=0x${key.slice(5, 9)} act=0x${key.slice(
      10,
      14,
    )} | ${String(arr.length).padStart(5)} | ${t0.toFixed(3).padStart(8)}..${t1
      .toFixed(3)
      .padStart(8)} | ${fMin.toFixed(4)}..${fMax.toFixed(4)}`,
  );
}

console.log();
console.log('Chronological timeline of every write (compressed: only on cluster change):');
console.log();

let lastKey = '';
let count = 0;
let clusterFirst: Decoded | undefined;
let clusterLast: Decoded | undefined;
const sortedByTime = [...writes].sort((a, b) => a.time - b.time);
for (const w of sortedByTime) {
  const key = `${w.pidLow.toString(16).padStart(4, '0')}_${w.pidHigh
    .toString(16)
    .padStart(4, '0')}_${w.action.toString(16).padStart(4, '0')}`;
  if (key !== lastKey) {
    if (clusterFirst && clusterLast) {
      const fMin = Math.min(clusterFirst.asFloat ?? 0, clusterLast.asFloat ?? 0);
      const fMax = Math.max(clusterFirst.asFloat ?? 0, clusterLast.asFloat ?? 0);
      console.log(
        `    cluster=${count + 1} writes  first.float=${(clusterFirst.asFloat ?? 0).toFixed(
          4,
        )}  last.float=${(clusterLast.asFloat ?? 0).toFixed(4)}  min..max=${fMin.toFixed(4)}..${fMax.toFixed(4)}`,
      );
    }
    console.log(
      `t=${w.time.toFixed(3)} pidL=0x${key.slice(0, 4)} pidH=0x${key.slice(
        5,
        9,
      )} act=0x${key.slice(10, 14)} float=${(w.asFloat ?? 0).toFixed(4)} u32=${
        w.asU32 ?? 0
      }`,
    );
    lastKey = key;
    count = 0;
    clusterFirst = w;
    clusterLast = w;
  } else {
    count += 1;
    clusterLast = w;
  }
}
if (clusterFirst && clusterLast) {
  console.log(
    `    cluster=${count + 1} writes  first.float=${(clusterFirst.asFloat ?? 0).toFixed(
      4,
    )}  last.float=${(clusterLast.asFloat ?? 0).toFixed(4)}`,
  );
}
