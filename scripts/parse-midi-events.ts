/**
 * Parse `tshark -V` output to reconstruct SysEx messages from USB MIDI
 * Event Packets. Groups by Fractal function ID. Surfaces any function
 * we haven't decoded that carries ASCII text (label-fetch candidate).
 *
 * Usage:
 *   npx tsx scripts/parse-midi-events.ts <midi-events.txt>
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) { console.error('Usage: parse-midi-events.ts <txt>'); process.exit(1); }

interface SysexMsg {
  frame: number;
  direction: 'OUT' | 'IN';
  fn: number;
  payload: number[];
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
      // Only process MIDI bulk endpoints. AM4 uses ep 0x02 (OUT) and 0x82 (IN).
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
            // Validate Fractal envelope
            if (arr.length >= 7 && arr[1] === 0x00 && arr[2] === 0x01 && arr[3] === 0x74) {
              const fn = arr[5];
              const payload = arr.slice(6, arr.length - 2);
              yield {
                frame: direction === 'OUT' ? lastFrameOut : lastFrameIn,
                direction,
                fn, payload,
              };
            }
          }
        }
      }
    }
  }
}

interface FnGroup {
  outCount: number;
  inCount: number;
  outFirst: SysexMsg[];
  inFirst: SysexMsg[];
  outMaxLen: number;
  inMaxLen: number;
  outAsciiSamples: Set<string>;
  inAsciiSamples: Set<string>;
}

async function main(): Promise<void> {
  const groups = new Map<number, FnGroup>();
  let total = 0;

  for await (const msg of parseStream(path)) {
    total++;
    if (!groups.has(msg.fn)) {
      groups.set(msg.fn, {
        outCount: 0, inCount: 0,
        outFirst: [], inFirst: [],
        outMaxLen: 0, inMaxLen: 0,
        outAsciiSamples: new Set(),
        inAsciiSamples: new Set(),
      });
    }
    const g = groups.get(msg.fn)!;
    if (msg.direction === 'OUT') {
      g.outCount++;
      if (g.outFirst.length < 3) g.outFirst.push(msg);
      g.outMaxLen = Math.max(g.outMaxLen, msg.payload.length);
    } else {
      g.inCount++;
      if (g.inFirst.length < 3) g.inFirst.push(msg);
      g.inMaxLen = Math.max(g.inMaxLen, msg.payload.length);
    }

    let run = '';
    for (let i = 0; i < msg.payload.length; i++) {
      const b = msg.payload[i];
      if (b >= 0x20 && b <= 0x7e) {
        run += String.fromCharCode(b);
      } else {
        if (run.length >= 4) {
          (msg.direction === 'OUT' ? g.outAsciiSamples : g.inAsciiSamples).add(run);
        }
        run = '';
      }
    }
    if (run.length >= 4) (msg.direction === 'OUT' ? g.outAsciiSamples : g.inAsciiSamples).add(run);
  }

  console.log(`total SysEx messages: ${total}`);
  console.log(`distinct function IDs: ${groups.size}\n`);

  const sorted = [...groups.entries()].sort((a, b) => (b[1].outCount + b[1].inCount) - (a[1].outCount + a[1].inCount));
  for (const [fn, g] of sorted) {
    console.log(`\n=== fn=0x${fn.toString(16).padStart(2, '0')}  OUT=${g.outCount}  IN=${g.inCount}  maxOut=${g.outMaxLen}  maxIn=${g.inMaxLen} ===`);
    if (g.outAsciiSamples.size > 0) {
      const samples = [...g.outAsciiSamples].slice(0, 8).map(s => `"${s}"`);
      console.log(`  OUT ASCII (${g.outAsciiSamples.size}): ${samples.join(', ')}${g.outAsciiSamples.size > 8 ? ` +${g.outAsciiSamples.size - 8}` : ''}`);
    }
    if (g.inAsciiSamples.size > 0) {
      const samples = [...g.inAsciiSamples].slice(0, 8).map(s => `"${s}"`);
      console.log(`  IN  ASCII (${g.inAsciiSamples.size}): ${samples.join(', ')}${g.inAsciiSamples.size > 8 ? ` +${g.inAsciiSamples.size - 8}` : ''}`);
    }
    if (g.inFirst.length > 0) {
      const m = g.inFirst[0];
      const hex = m.payload.slice(0, 32).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  first IN  (frame=${m.frame}): payload[${m.payload.length}]: ${hex}${m.payload.length > 32 ? ' ...' : ''}`);
    }
    if (g.outFirst.length > 0) {
      const m = g.outFirst[0];
      const hex = m.payload.slice(0, 32).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  first OUT (frame=${m.frame}): payload[${m.payload.length}]: ${hex}${m.payload.length > 32 ? ' ...' : ''}`);
    }
  }
}

await main();
