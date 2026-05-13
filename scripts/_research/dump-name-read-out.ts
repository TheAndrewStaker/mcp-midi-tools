/**
 * Dump the OUT-side header bytes of all 104 preset-name reads in order
 * to confirm how AM4-Edit specifies the location index.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) { console.error('Usage'); process.exit(1); }

interface SysexMsg { frame: number; direction: 'OUT' | 'IN'; fn: number; payload: number[]; }

async function* parseStream(file: string): AsyncGenerator<SysexMsg> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });
  let frame = 0;
  let direction: 'OUT' | 'IN' = 'OUT';
  const accumOut: number[] = [];
  const accumIn: number[] = [];
  let lastFrameOut = 0, lastFrameIn = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    let m;
    if ((m = /^Frame Number: (\d+)/.exec(trimmed))) { frame = parseInt(m[1], 10); continue; }
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
        if (b === 0xf0) { accum.length = 0; accum.push(b); if (direction === 'OUT') lastFrameOut = frame; else lastFrameIn = frame; }
        else if (accum.length > 0) { accum.push(b);
          if (b === 0xf7) {
            const arr = [...accum];
            accum.length = 0;
            if (arr.length >= 7 && arr[1] === 0x00 && arr[2] === 0x01 && arr[3] === 0x74) {
              yield { frame: direction === 'OUT' ? lastFrameOut : lastFrameIn, direction, fn: arr[5], payload: arr.slice(6, arr.length - 2) };
            }
          }
        }
      }
    }
  }
}

function decode14(lo: number, hi: number): number { return (lo & 0x7f) | ((hi & 0x7f) << 7); }

async function main(): Promise<void> {
  let count = 0;
  for await (const msg of parseStream(path)) {
    if (msg.fn !== 0x01) continue;
    if (msg.direction !== 'OUT') continue;
    const p = msg.payload;
    if (p.length < 10) continue;
    const pidLow = decode14(p[0], p[1]);
    const pidHigh = decode14(p[2], p[3]);
    const action = decode14(p[4], p[5]);
    if (pidLow !== 0x00ce || pidHigh !== 0x000b || action !== 0x0012) continue;
    // Show full hex of the OUT message (envelope already stripped, just payload).
    const hex = p.map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[${count.toString().padStart(3, ' ')}] frame=${msg.frame} payload[${p.length}]: ${hex}`);
    count++;
    if (count >= 10) break;
  }

  // Now scan the WHOLE capture and show every distinct OUT body for action=0x0012 — to see if hdr3
  // varies per location.
  console.log('\nDistinct OUT body bytes (after action) for action=0x0012:');
  const seen = new Set<string>();
  let total = 0;
  for await (const msg of parseStream(path)) {
    if (msg.fn !== 0x01) continue;
    if (msg.direction !== 'OUT') continue;
    const p = msg.payload;
    if (p.length < 10) continue;
    const pidLow = decode14(p[0], p[1]);
    const pidHigh = decode14(p[2], p[3]);
    const action = decode14(p[4], p[5]);
    if (pidLow !== 0x00ce || pidHigh !== 0x000b || action !== 0x0012) continue;
    total++;
    // hdr3 (bytes 6,7) and hdr4 (bytes 8,9), and any payload after.
    const hdr3 = decode14(p[6], p[7]);
    const hdr4 = decode14(p[8], p[9]);
    const tail = p.slice(10).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const key = `hdr3=0x${hdr3.toString(16)} hdr4=0x${hdr4.toString(16)} tail="${tail}"`;
    seen.add(key);
  }
  console.log(`distinct: ${seen.size}, total: ${total}`);
  for (const k of seen) console.log(`  ${k}`);
}

await main();
