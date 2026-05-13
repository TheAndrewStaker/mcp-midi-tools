/**
 * Research: confirm that the 104 IN responses correlated with OUT
 * `pidLow=0x00CE pidHigh=0x000B action=0x0012` reads in the AM4-Edit
 * launch capture decode to plaintext preset names (one per location).
 *
 * Usage:
 *   npx tsx scripts/decode-preset-name-reads.ts <midi-events.txt>
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { unpackValueChunked } from '@/fractal/shared/packValue.js';

const path = process.argv[2];
if (!path) { console.error('Usage: decode-preset-name-reads.ts <txt>'); process.exit(1); }

interface SysexMsg { frame: number; direction: 'OUT' | 'IN'; fn: number; payload: number[]; }

async function* parseStream(file: string): AsyncGenerator<SysexMsg> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });

  let frame = 0;
  let direction: 'OUT' | 'IN' = 'OUT';
  const accumOut: number[] = [];
  const accumIn: number[] = [];
  let lastFrameOut = 0;
  let lastFrameIn = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    let m;
    if ((m = /^Frame Number: (\d+)/.exec(trimmed))) {
      frame = parseInt(m[1], 10);
      continue;
    }
    if ((m = /^Endpoint: 0x([0-9a-f]+), Direction: (IN|OUT)/.exec(trimmed))) {
      const ep = parseInt(m[1], 16);
      if (ep !== 0x02 && ep !== 0x82) continue;
      direction = m[2] as 'OUT' | 'IN';
      continue;
    }
    if ((m = /^MIDI Event: ([0-9a-f]+)/.exec(trimmed))) {
      const hex = m[1];
      const bytes: number[] = [];
      for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
      const accum = direction === 'OUT' ? accumOut : accumIn;
      for (const b of bytes) {
        if (b === 0xf0) {
          accum.length = 0;
          accum.push(b);
          if (direction === 'OUT') lastFrameOut = frame;
          else lastFrameIn = frame;
        } else if (accum.length > 0) {
          accum.push(b);
          if (b === 0xf7) {
            const arr = [...accum];
            accum.length = 0;
            if (arr.length >= 7 && arr[1] === 0x00 && arr[2] === 0x01 && arr[3] === 0x74) {
              const fn = arr[5];
              const payload = arr.slice(6, arr.length - 2);
              yield { frame: direction === 'OUT' ? lastFrameOut : lastFrameIn, direction, fn, payload };
            }
          }
        }
      }
    }
  }
}

function decode14(lo: number, hi: number): number { return (lo & 0x7f) | ((hi & 0x7f) << 7); }
function locationCode(idx: number): string {
  const bank = String.fromCharCode('A'.charCodeAt(0) + Math.floor(idx / 4));
  const sub = (idx % 4) + 1;
  return `${bank}0${sub}`;
}

async function main(): Promise<void> {
  const outBuf: SysexMsg[] = [];
  const inBuf: SysexMsg[] = [];
  for await (const msg of parseStream(path)) {
    if (msg.fn !== 0x01) continue;
    if (msg.direction === 'OUT') outBuf.push(msg);
    else inBuf.push(msg);
  }

  // Find the 104 OUT messages with action=0x0012, pidHigh=0x000B, pidLow=0x00CE,
  // in arrival order.
  interface NameRead { outIdx: number; outFrame: number; locationIdx: number | undefined; raw: number[]; payload: number[]; inFrame: number; }
  const nameOuts: { idx: number; frame: number; payload: number[] }[] = [];
  outBuf.forEach((m, i) => {
    const p = m.payload;
    if (p.length < 10) return;
    const pidLow = decode14(p[0], p[1]);
    const pidHigh = decode14(p[2], p[3]);
    const action = decode14(p[4], p[5]);
    if (pidLow === 0x00ce && pidHigh === 0x000b && action === 0x0012) {
      nameOuts.push({ idx: i, frame: m.frame, payload: p });
    }
  });
  console.log(`OUT pidLow=0x00CE pidHigh=0x000B action=0x0012: ${nameOuts.length} messages`);

  // Match each with the next IN message after it (same address echoed in IN body).
  const matched: { outFrame: number; inFrame: number; outPayload: number[]; inPayload: number[] }[] = [];
  let inCursor = 0;
  for (const out of nameOuts) {
    while (inCursor < inBuf.length && inBuf[inCursor].frame < out.frame) inCursor++;
    // Find next IN message that echoes the same address triple.
    let found = -1;
    for (let j = inCursor; j < Math.min(inCursor + 10, inBuf.length); j++) {
      const ip = inBuf[j].payload;
      if (ip.length < 10) continue;
      const pidLow = decode14(ip[0], ip[1]);
      const pidHigh = decode14(ip[2], ip[3]);
      const action = decode14(ip[4], ip[5]);
      if (pidLow === 0x00ce && pidHigh === 0x000b && action === 0x0012) { found = j; break; }
    }
    if (found < 0) continue;
    matched.push({ outFrame: out.frame, inFrame: inBuf[found].frame, outPayload: out.payload, inPayload: inBuf[found].payload });
  }
  console.log(`Matched IN responses: ${matched.length}\n`);

  // Decode each IN response.
  // Body layout (post-envelope): [pidL_lo pidL_hi][pidH_lo pidH_hi][act_lo act_hi][hdr3 hdr3][hdr4_lo hdr4_hi][packed...]
  // We expect hdr4 = 0x0024 (36 raw bytes, same as preset rename) OR 0x0020 (32 raw — name-only?).
  // Inspection earlier showed hdr4 = 0x0020 (32 raw).
  console.log('First 30 decoded responses:');
  let allNames: string[] = [];
  matched.forEach((rec, i) => {
    const ip = rec.inPayload;
    const hdr4 = decode14(ip[8], ip[9]);
    const packed = ip.slice(10);
    const raw = unpackValueChunked(new Uint8Array(packed), hdr4);
    // The rename payload is [u32 LE slot index][32 ASCII bytes space-padded].
    // For a read response, may or may not include slot index.
    const asAscii = Array.from(raw).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
    if (i < 30) {
      const hexHead = Array.from(raw.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  [${i.toString().padStart(3, ' ')}] frame=${rec.inFrame} hdr4=${hdr4} raw[${raw.length}]: hex_first4="${hexHead}" ascii="${asAscii}"`);
    }
    // The 32 raw bytes are the preset name, space-padded ASCII.
    const name = String.fromCharCode(...Array.from(raw)).replace(/\s+$/, '');
    allNames.push(`${locationCode(i)}: "${name}"`);
  });

  console.log('\nAll 104 names interpreted as [u32 slot index][28 ASCII] from response (i = location index by arrival order):');
  for (const line of allNames) console.log(`  ${line}`);
}

await main();
