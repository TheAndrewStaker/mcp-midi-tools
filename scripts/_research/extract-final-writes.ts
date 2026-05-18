/**
 * Like extract-writes.ts but groups by pidHigh and shows the FINAL (last
 * by timestamp) write per pidHigh — the value that matches what the user
 * left the knob at when the capture ended.
 *
 * Usage: npx tsx scripts/extract-final-writes.ts <tshark.txt> [...]
 */
import fs from 'fs';
import path from 'path';
import { unpackFloat32LE } from 'fractal-midi/shared';

interface Rec { frame: number; time: number; direction: 'IN' | 'OUT'; hex: string; }

function parse(file: string): Rec[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: Rec[] = [];
  let cur: Partial<Rec> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^Frame (\d+):/);
    if (m) {
      if (cur?.frame && cur.hex && cur.direction) out.push(cur as Rec);
      cur = { frame: Number(m[1]) };
      continue;
    }
    if (!cur) continue;
    const t = line.match(/Time since reference[^:]+:\s+([\d.]+)/);
    if (t) cur.time = Number(t[1]);
    const e = line.match(/Direction:\s+(IN|OUT)/);
    if (e) cur.direction = e[1] as 'IN' | 'OUT';
    const r = line.match(/\[Reassembled data:\s+([0-9a-f]+)\]/);
    if (r) cur.hex = r[1];
  }
  if (cur?.frame && cur.hex && cur.direction) out.push(cur as Rec);
  return out;
}

interface Decoded {
  pidLow: number; pidHigh: number; hdr2: number; floatLE: number; hex: string; time: number;
}

function decode(hex: string, time: number): Decoded | null {
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
  return { pidLow, pidHigh, hdr2, floatLE, hex, time };
}

const files = process.argv.slice(2);
for (const file of files) {
  console.log(`\n=== ${path.basename(file)} ===`);
  const recs = parse(file);
  const writes = recs.filter((r) => r.direction === 'OUT' && r.hex.length === 46);

  const last = new Map<string, Decoded & { count: number }>();
  for (const w of writes) {
    const d = decode(w.hex, w.time);
    if (!d) continue;
    if (d.pidHigh === 0x3e81) continue;
    const key = `${d.pidLow.toString(16).padStart(4, '0')}/${d.pidHigh.toString(16).padStart(4, '0')}`;
    const prev = last.get(key);
    last.set(key, { ...d, count: (prev?.count ?? 0) + 1 });
  }

  const rows = Array.from(last.entries()).sort((a, b) => parseInt(a[0].split('/')[1], 16) - parseInt(b[0].split('/')[1], 16));
  console.log(`  ${rows.length} distinct (pidLow/pidHigh) addresses written. Final value per address:`);
  console.log(`  pidLow/pidHigh  hdr2    final-float          writes  hex`);
  for (const [key, d] of rows) {
    console.log(`  ${key}     0x${d.hdr2.toString(16).padStart(4, '0')}  ${d.floatLE.toFixed(8).padStart(20)}  ${d.count.toString().padStart(6)}  ${d.hex}`);
  }
}
