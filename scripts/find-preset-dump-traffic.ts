/**
 * Search a midi-events.txt file for any 0x77 / 0x78 / 0x79 traffic
 * (preset dump header / chunk / footer). Reports direction, frame,
 * payload length, and the leading payload bytes.
 *
 * Usage:
 *   npx tsx scripts/find-preset-dump-traffic.ts <midi-events.txt>
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) { console.error('Usage: find-preset-dump-traffic.ts <txt>'); process.exit(1); }

interface SysexMsg {
  frame: number;
  direction: 'OUT' | 'IN';
  fn: number;
  payload: number[];
  totalLen: number;
}

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
              yield {
                frame: direction === 'OUT' ? lastFrameOut : lastFrameIn,
                direction,
                fn, payload,
                totalLen: arr.length,
              };
            }
          }
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const targets = new Set([0x77, 0x78, 0x79]);
  let total = 0;
  let totalAll = 0;
  const hits: SysexMsg[] = [];
  const fnCounts = new Map<number, { out: number; in: number }>();

  for await (const msg of parseStream(path)) {
    totalAll++;
    if (!fnCounts.has(msg.fn)) fnCounts.set(msg.fn, { out: 0, in: 0 });
    const c = fnCounts.get(msg.fn)!;
    if (msg.direction === 'OUT') c.out++; else c.in++;

    if (targets.has(msg.fn)) {
      total++;
      if (hits.length < 50) hits.push(msg);
    }
  }

  console.log(`Total SysEx messages parsed: ${totalAll}`);
  console.log(`0x77/0x78/0x79 hits: ${total}`);
  console.log();

  console.log('=== fn distribution ===');
  const sorted = [...fnCounts.entries()].sort((a, b) => a[0] - b[0]);
  for (const [fn, c] of sorted) {
    console.log(`  fn=0x${fn.toString(16).padStart(2, '0')}  OUT=${c.out}  IN=${c.in}`);
  }
  console.log();

  if (hits.length > 0) {
    console.log('=== first 50 dump-related hits ===');
    for (const h of hits) {
      const hex = h.payload.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  fn=0x${h.fn.toString(16)} ${h.direction} frame=${h.frame} totalLen=${h.totalLen} payload[${h.payload.length}]: ${hex}${h.payload.length > 16 ? ' ...' : ''}`);
    }
  }
}

await main();
