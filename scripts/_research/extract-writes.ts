/**
 * Pull every 23-byte SET_PARAM write out of a tshark dump and decode it
 * back to (parameter ID, raw value bytes, internal float32 LE).
 *
 * Usage: npx tsx scripts/extract-writes.ts <tshark.txt> [more.txt ...]
 */
import fs from 'fs';
import path from 'path';
import { unpackFloat32LE, unpackValue } from '@mcp-midi-control/core/fractal-shared/packValue.js';

interface Record {
  frame: number;
  time: number;
  direction: 'IN' | 'OUT';
  hex: string;
}

function parse(file: string): Record[] {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const records: Record[] = [];
  let cur: Partial<Record> | undefined;
  for (const line of lines) {
    const m = line.match(/^Frame (\d+):/);
    if (m) {
      if (cur?.frame && cur.hex && cur.direction) records.push(cur as Record);
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
  if (cur?.frame && cur.hex && cur.direction) records.push(cur as Record);
  return records;
}

interface Decoded {
  pidLow: number;
  pidHigh: number;
  hdr2: number;
  hdr3: number;
  count: number;
  rawBytes: Uint8Array;
  floatLE: number | null;
  full: string;
}

function decodeWrite(hex: string): Decoded | null {
  // Bytes from hex string
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  // Validate envelope
  if (bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7) return null;
  if (bytes[1] !== 0x00 || bytes[2] !== 0x01 || bytes[3] !== 0x74) return null;
  if (bytes[4] !== 0x15) return null; // model
  if (bytes[5] !== 0x01) return null; // PARAM_RW

  const r14 = (lo: number, hi: number) => (lo & 0x7f) | ((hi & 0x7f) << 7);
  const pidLow  = r14(bytes[6], bytes[7]);
  const pidHigh = r14(bytes[8], bytes[9]);
  const hdr2    = r14(bytes[10], bytes[11]);
  const hdr3    = r14(bytes[12], bytes[13]);
  const count   = r14(bytes[14], bytes[15]);

  const wireValue = bytes.slice(16, bytes.length - 2); // exclude cs + F7
  if (wireValue.length !== count + 1) {
    // Not a standard write, or count doesn't match
  }
  const wire = new Uint8Array(wireValue);
  const raw = unpackValue(wire, count);

  let floatLE: number | null = null;
  if (count === 4) floatLE = unpackFloat32LE(wire);

  return { pidLow, pidHigh, hdr2, hdr3, count, rawBytes: raw, floatLE, full: hex };
}

function hex(arr: number[] | Uint8Array): string {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: tsx scripts/extract-writes.ts <tshark.txt> [...]');
  process.exit(1);
}

for (const file of files) {
  console.log(`\n=== ${path.basename(file)} ===`);
  const recs = parse(file);
  const writes = recs.filter((r) => r.direction === 'OUT' && r.hex.length === 46); // 23 bytes
  console.log(`  ${writes.length} 23-byte OUT writes found`);

  // Group by hex content to spot duplicates / polling
  const byHex = new Map<string, Record[]>();
  for (const w of writes) {
    const list = byHex.get(w.hex) ?? [];
    list.push(w);
    byHex.set(w.hex, list);
  }
  // Decode unique writes
  for (const [h, list] of byHex.entries()) {
    const d = decodeWrite(h);
    console.log(`  [${list.length}×] t=${list[0].time?.toFixed(3)}`);
    console.log(`    raw    : ${h}`);
    if (!d) { console.log(`    (could not decode — not a SET_PARAM)`); continue; }
    console.log(`    pidLow = 0x${d.pidLow.toString(16).padStart(4, '0')}, pidHigh = 0x${d.pidHigh.toString(16).padStart(4, '0')}`);
    console.log(`    hdr2 = 0x${d.hdr2.toString(16).padStart(4, '0')}, hdr3 = 0x${d.hdr3.toString(16).padStart(4, '0')}, count = ${d.count}`);
    console.log(`    raw bytes: [${hex(d.rawBytes)}]`);
    if (d.floatLE !== null) {
      console.log(`    as float32 LE: ${d.floatLE}`);
    }
    if (d.count === 4) {
      const u32 = new DataView(d.rawBytes.buffer, d.rawBytes.byteOffset, 4).getUint32(0, true);
      const i32 = new DataView(d.rawBytes.buffer, d.rawBytes.byteOffset, 4).getInt32(0, true);
      console.log(`    as uint32 LE:  ${u32}  (0x${u32.toString(16).padStart(8, '0')})`);
      console.log(`    as int32 LE:   ${i32}`);
    }
  }
}
