// Decode HW-112 GLOBAL pidLow capture (session-95-am4-global-pidlow.pcapng).
// Parses every 0x01 (PARAM_R/W) frame, classifies host vs device, READ vs WRITE,
// and surfaces the unique host→device WRITE that pinpoints GLOBAL pidLow.

import { readFileSync } from 'node:fs';

const FRAMES_PATH = process.env.HW112_FRAMES ?? 'samples/captured/decoded/hw112-frames-full.txt';
const lines = readFileSync(FRAMES_PATH, 'utf8').trim().split('\n');

type Frame = {
  idx: number;
  wireSize: number;
  src: 'host' | 'dev';
  hex: string;
  pidLow: number;
  pidHigh: number;
  action: number;
  hdr3: number;
  hdr4: number;
  payload: number[];
};

function parse(line: string): Frame | null {
  const [idxStr, sizeStr, src, hex] = line.split('|');
  const b = Buffer.from(hex, 'hex');
  if (b[0] !== 0xf0 || b[1] !== 0x00 || b[2] !== 0x01 || b[3] !== 0x74) return null;
  if (b[4] !== 0x15 || b[5] !== 0x01) return null;
  const u14 = (lo: number, hi: number) => lo | (hi << 7);
  return {
    idx: +idxStr,
    wireSize: +sizeStr,
    src: src as 'host' | 'dev',
    hex,
    pidLow:  u14(b[6],  b[7]),
    pidHigh: u14(b[8],  b[9]),
    action:  u14(b[10], b[11]),
    hdr3:    u14(b[12], b[13]),
    hdr4:    u14(b[14], b[15]),
    payload: Array.from(b.subarray(16, b.length - 2)),
  };
}

const frames = lines.map(parse).filter((f): f is Frame => f !== null);
console.log(`Parsed ${frames.length} 0x01 PARAM_R/W frames`);
console.log();

// Host writes: hdr4>0 AND src=host AND not a periodic poll
// A periodic poll is a host frame whose (pidLow, pidHigh, action, payload) is repeated >5×.
const hostFrames = frames.filter(f => f.src === 'host');
const deviceFrames = frames.filter(f => f.src === 'dev');
console.log(`host→dev: ${hostFrames.length}, dev→host: ${deviceFrames.length}`);
console.log();

// Count signatures so we can find the unique writes vs periodic polls.
const sig = (f: Frame) => `${f.pidLow}:${f.pidHigh}:${f.action}:${f.hdr4}:${f.payload.join(',')}`;
const counts = new Map<string, number>();
for (const f of hostFrames) {
  counts.set(sig(f), (counts.get(sig(f)) ?? 0) + 1);
}

// Print host frames whose signature occurs <=3× — those are non-poll outliers.
console.log('=== Host→Device frames with unique/rare signatures (<=3 occurrences) ===');
const seen = new Set<string>();
const rareHosts: Frame[] = [];
for (const f of hostFrames) {
  const s = sig(f);
  if ((counts.get(s) ?? 0) <= 3 && !seen.has(s)) {
    seen.add(s);
    rareHosts.push(f);
  }
}
console.log(`${rareHosts.length} unique rare host signatures`);
for (const f of rareHosts.slice(0, 80)) {
  const c = counts.get(sig(f));
  const tag = f.hdr4 > 0 ? `WRITE(${f.hdr4}b)` : 'READ';
  console.log(`  frame#${String(f.idx).padStart(5)}  ${tag}  pidLow=0x${f.pidLow.toString(16).padStart(4,'0')}(${f.pidLow})  pidHigh=0x${f.pidHigh.toString(16).padStart(4,'0')}(${f.pidHigh})  action=0x${f.action.toString(16).padStart(2,'0')}  payload=[${f.payload.map(x=>x.toString(16).padStart(2,'0')).join(' ')}]  ×${c}`);
}
console.log();

// Specifically isolate WRITES (hdr4>0) from host
console.log('=== All host→dev WRITES (hdr4>0) ===');
const writes = hostFrames.filter(f => f.hdr4 > 0);
const writeSigs = new Map<string, { count: number; first: Frame }>();
for (const w of writes) {
  const s = sig(w);
  let r = writeSigs.get(s);
  if (!r) { r = { count: 0, first: w }; writeSigs.set(s, r); }
  r.count++;
}
console.log(`${writes.length} total write frames, ${writeSigs.size} unique signatures`);
for (const [s, { count, first }] of writeSigs) {
  console.log(`  frame#${first.idx}  ×${count}  pidLow=0x${first.pidLow.toString(16).padStart(4,'0')}(${first.pidLow})  pidHigh=0x${first.pidHigh.toString(16).padStart(4,'0')}(${first.pidHigh})  action=0x${first.action.toString(16).padStart(2,'0')}  hdr4=${first.hdr4}  payload=[${first.payload.map(x=>x.toString(16).padStart(2,'0')).join(' ')}]`);
}
