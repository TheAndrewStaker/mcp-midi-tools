/**
 * Session-85 scene-MIDI decoder.
 *
 * Walks the tshark dump of session-85-scene-midi.pcapng and prints
 * every OUT SET_PARAM write to PATCH family (pidLow=0xCE) with its
 * pidHigh, action bytes, and raw payload. Goal: pin down the
 * (scene, msg_idx, field) packing inside pidHigh and the wire encoding
 * of `Type=ProgramChange, Channel=N, Value=M`.
 *
 * Usage: npx tsx scripts/_research/decode-session-85-scene-midi.ts
 */
import fs from 'fs';
import readline from 'readline';
import { unpackFloat32LE } from 'fractal-midi/shared';

const FILE = process.argv[2] ?? 'samples/captured/session-85-scene-midi.tshark.txt';

interface Frame {
  frame: number;
  time: number;
  direction: 'IN' | 'OUT';
  hex: string;
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

const r14 = (lo: number, hi: number): number => (lo & 0x7f) | ((hi & 0x7f) << 7);

interface Decoded {
  frame: number;
  time: number;
  pidLow: number;
  pidHigh: number;
  hdr2: number;        // bytes 10-11 (septet)
  action: number;      // bytes 14-15 (septet) — if present
  payload: number[];   // everything between action and checksum
  cs: number;
  raw: string;
}

function decode(f: Frame): Decoded | null {
  const b = hexToBytes(f.hex);
  if (b[0] !== 0xf0 || b[b.length - 1] !== 0xf7) return null;
  if (b[1] !== 0x00 || b[2] !== 0x01 || b[3] !== 0x74 || b[4] !== 0x15) return null;
  // Only function=0x01 (SET_PARAM-family).
  if (b[5] !== 0x01) return null;
  const pidLow = r14(b[6], b[7]);
  const pidHigh = r14(b[8], b[9]);
  const hdr2 = r14(b[10], b[11]);
  const action = b.length >= 18 ? r14(b[14], b[15]) : 0;
  const payload = b.slice(16, b.length - 2);
  const cs = b[b.length - 2];
  return {
    frame: f.frame,
    time: f.time,
    pidLow,
    pidHigh,
    hdr2,
    action,
    payload,
    cs,
    raw: f.hex,
  };
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let cur: Partial<Frame> = {};
  const decoded: Decoded[] = [];

  const flush = (): void => {
    if (cur.frame === undefined || cur.hex === undefined || cur.direction !== 'OUT') return;
    const d = decode(cur as Frame);
    if (!d) return;
    if (d.pidLow !== 0xce) return; // PATCH family only
    decoded.push(d);
  };

  for await (const line of rl) {
    const m = line.match(/^Frame (\d+):/);
    if (m) {
      flush();
      cur = { frame: Number(m[1]) };
      continue;
    }
    if (cur.frame === undefined) continue;
    const t = line.match(/Time since reference[^:]+:\s+([\d.]+)/);
    if (t) cur.time = Number(t[1]);
    const e = line.match(/Direction:\s+(IN|OUT)/);
    if (e) cur.direction = e[1] as 'IN' | 'OUT';
    const r = line.match(/\[Reassembled data:\s+([0-9a-f]+)\]/);
    if (r) cur.hex = r[1];
  }
  flush();

  console.log(`Total PATCH (pidLow=0xCE) writes: ${decoded.length}\n`);

  // Group consecutive writes to the same pidHigh into pairs (the short
  // "select" + long "write" pattern observed in the raw dump).
  // Print each as: frame, t, pidHigh, hdr2, action, payload_len, payload_hex.
  console.log('Writes with payload (hdr2=0x0001 SET_PARAM-style):');
  console.log('frame      t(s)   pidHigh  hdr2    action  paylen  payload         floatLE');
  console.log('-'.repeat(110));
  for (const d of decoded) {
    if (d.payload.length === 0) continue;
    const ph = d.pidHigh.toString(16).padStart(4, '0');
    const hd = d.hdr2.toString(16).padStart(4, '0');
    const ac = d.action.toString(16).padStart(4, '0');
    const pp = d.payload.map((x) => x.toString(16).padStart(2, '0')).join('');
    const fl = d.payload.length === 5 ? unpackFloat32LE(new Uint8Array(d.payload)).toFixed(4) : '—';
    console.log(
      `${d.frame.toString().padStart(6)}  ${(d.time ?? 0).toFixed(3).padStart(7)}  0x${ph}    0x${hd}  0x${ac}  ${d.payload.length.toString().padStart(4)}    ${pp.padEnd(14)}  ${fl}`,
    );
  }

  // Summary: unique pidHighs, what they look like.
  const uniquePh = Array.from(new Set(decoded.map((d) => d.pidHigh))).sort((a, b) => a - b);
  console.log(`\nUnique pidHighs (${uniquePh.length}): ${uniquePh.map((p) => '0x' + p.toString(16).padStart(4, '0')).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
