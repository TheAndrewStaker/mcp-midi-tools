import fs from 'fs';
import { unpackValue } from 'fractal-midi/shared';

const files = process.argv.slice(2);

function parseCapture(path: string) {
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  type R = { frame: number; time: number; direction: 'IN'|'OUT'; hex: string };
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
    const t = line.match(timeRe); if (t) cur.time = Number(t[1]);
    const d = line.match(dirRe); if (d) cur.direction = d[1] as 'IN'|'OUT';
    const r = line.match(reRe); if (r) cur.hex = r[1];
  }
  if (cur?.frame && cur.hex && cur.direction) records.push(cur as R);
  return records;
}

function decode14(lo: number, hi: number) { return lo | (hi << 7); }

function describeWrite(hex: string) {
  const b: number[] = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i+2), 16));
  const pidLow = decode14(b[6], b[7]);
  const pidHigh = decode14(b[8], b[9]);
  const action = decode14(b[10], b[11]);
  const hdr3 = decode14(b[12], b[13]);
  const hdr4 = decode14(b[14], b[15]);
  const packed = b.slice(16, b.length - 2);
  const raw = unpackValue(new Uint8Array(packed), hdr4);
  let asFloat: number | undefined;
  let asU32: number | undefined;
  if (hdr4 === 4) {
    const buf = new Uint8Array(raw);
    const dv = new DataView(buf.buffer);
    asFloat = dv.getFloat32(0, true);
    asU32 = dv.getUint32(0, true);
  }
  return {
    pidLow: '0x' + pidLow.toString(16).padStart(4, '0'),
    pidHigh: '0x' + pidHigh.toString(16).padStart(4, '0'),
    action: '0x' + action.toString(16).padStart(4, '0'),
    hdr3, hdr4,
    packedHex: packed.map(n => n.toString(16).padStart(2,'0')).join(' '),
    rawHex: [...raw].map(n => n.toString(16).padStart(2,'0')).join(' '),
    asFloat, asU32,
  };
}

for (const f of files) {
  const recs = parseCapture(f);
  const outs = recs.filter(r => r.direction === 'OUT' && r.hex.length / 2 === 23);
  console.log('='.repeat(80));
  console.log(f.replace(/^.*[\/]/, ''));
  console.log(`  ${outs.length} OUT 23-byte writes in chronological order:`);
  for (const r of outs) {
    const d = describeWrite(r.hex);
    console.log(`  t=${r.time.toFixed(3)}  ${r.hex}`);
    console.log(`    pidLow=${d.pidLow} pidHigh=${d.pidHigh} action=${d.action} hdr4=${d.hdr4}`);
    console.log(`    raw=[${d.rawHex}]  float=${d.asFloat}  u32=${d.asU32}`);
  }
}
