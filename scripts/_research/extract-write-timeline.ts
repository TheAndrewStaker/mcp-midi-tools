/**
 * Companion to extract-final-writes-streaming.ts. Dumps the SET_PARAM
 * writes in time order with frame number, time offset, pidLow/pidHigh,
 * and decoded float — handy for figuring out which block was active
 * when each write fired (e.g. did the user click into a different block
 * mid-capture?).
 *
 * Usage: npx tsx scripts/extract-write-timeline.ts <tshark.txt>
 *        --filter pidLow=0x0003     (optional, filters by pidLow hex)
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { unpackFloat32LE } from '@mcp-midi-control/core/fractal-shared/packValue.js';

interface Decoded {
  frame: number;
  time: number;
  pidLow: number; pidHigh: number; hdr2: number; floatLE: number; hex: string;
}

function decode(hex: string): Omit<Decoded, 'frame' | 'time'> | null {
  const b: number[] = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  if (b[0] !== 0xf0 || b[b.length - 1] !== 0xf7) return null;
  if (b[1] !== 0x00 || b[2] !== 0x01 || b[3] !== 0x74 || b[4] !== 0x15 || b[5] !== 0x01) return null;
  const r14 = (lo: number, hi: number) => (lo & 0x7f) | ((hi & 0x7f) << 7);
  const pidLow  = r14(b[6], b[7]);
  const pidHigh = r14(b[8], b[9]);
  const hdr2    = r14(b[10], b[11]);
  const value = b.slice(16, b.length - 2);
  const floatLE = unpackFloat32LE(new Uint8Array(value));
  return { pidLow, pidHigh, hdr2, floatLE, hex };
}

const args = process.argv.slice(2);
const file = args[0];
const filter = args.find((a) => a.startsWith('--filter='))?.split('=')[1];
const filterPidLow = filter?.startsWith('pidLow=') ? parseInt(filter.split('=')[1], 16) : undefined;

if (!file) {
  console.error('Usage: tsx scripts/extract-write-timeline.ts <tshark.txt> [--filter=pidLow=0xNNNN]');
  process.exit(1);
}

const stream = fs.createReadStream(file, { encoding: 'utf8' });
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

console.log(`\n=== ${path.basename(file)} ===`);
console.log('  frame      time   pidLow/pidHigh   hdr2    float           hex');

let cur: { frame?: number; time?: number; direction?: 'IN' | 'OUT'; hex?: string } = {};
const flush = () => {
  if (!cur.frame || !cur.hex || cur.direction !== 'OUT') return;
  if (cur.hex.length !== 46) return;
  const d = decode(cur.hex);
  if (!d) return;
  if (d.pidHigh === 0x3e81) return;
  if (filterPidLow !== undefined && d.pidLow !== filterPidLow) return;
  const pl = d.pidLow.toString(16).padStart(4, '0');
  const ph = d.pidHigh.toString(16).padStart(4, '0');
  console.log(`  ${cur.frame.toString().padStart(6)}  ${(cur.time ?? 0).toFixed(3).padStart(8)}  ${pl}/${ph}     0x${d.hdr2.toString(16).padStart(4, '0')}  ${d.floatLE.toFixed(6).padStart(14)}  ${d.hex}`);
};

for await (const line of rl) {
  const m = line.match(/^Frame (\d+):/);
  if (m) {
    flush();
    cur = { frame: Number(m[1]) };
    continue;
  }
  if (!cur.frame) continue;
  const t = line.match(/Time since reference[^:]+:\s+([\d.]+)/);
  if (t) cur.time = Number(t[1]);
  const e = line.match(/Direction:\s+(IN|OUT)/);
  if (e) cur.direction = e[1] as 'IN' | 'OUT';
  const r = line.match(/\[Reassembled data:\s+([0-9a-f]+)\]/);
  if (r) cur.hex = r[1];
}
flush();
