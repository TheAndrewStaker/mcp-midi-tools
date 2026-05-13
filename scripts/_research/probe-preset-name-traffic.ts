/**
 * Research: find traffic in AM4-Edit launch capture that retrieves
 * stored preset names (104 names) without switching presets.
 *
 * Strategy:
 * 1. Parse the capture into IN/OUT 0x01 envelope messages.
 * 2. Group OUT messages by their (pidLow, pidHigh, action) header
 *    triple — every read sets these to a specific address.
 * 3. Find OUT addresses that repeat exactly 104 times (the AM4 preset
 *    count). That pattern is the smoking gun for a per-location loop.
 * 4. Decode the IN responses correlated with those OUT addresses and
 *    show whether they contain ASCII printable text (preset names).
 *
 * Usage:
 *   npx tsx scripts/probe-preset-name-traffic.ts <midi-events.txt>
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) { console.error('Usage: probe-preset-name-traffic.ts <txt>'); process.exit(1); }

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

function asciiRuns(bytes: number[], minLen = 4): string[] {
  const runs: string[] = [];
  let cur = '';
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b);
    else { if (cur.length >= minLen) runs.push(cur); cur = ''; }
  }
  if (cur.length >= minLen) runs.push(cur);
  return runs;
}

async function main(): Promise<void> {
  // Bucket OUT messages with fn=0x01 by (pidLow, pidHigh, action) triple.
  // Track INs in arrival order so we can correlate with OUTs.
  const outByAddress = new Map<string, { count: number; firstFrames: number[]; payloadLens: Set<number> }>();
  const allMsgs: SysexMsg[] = [];

  for await (const msg of parseStream(path)) {
    allMsgs.push(msg);
    if (msg.direction !== 'OUT' || msg.fn !== 0x01) continue;
    if (msg.payload.length < 10) continue;
    const pidLow = decode14(msg.payload[0], msg.payload[1]);
    const pidHigh = decode14(msg.payload[2], msg.payload[3]);
    const action = decode14(msg.payload[4], msg.payload[5]);
    const key = `pidLow=0x${pidLow.toString(16).padStart(4, '0')} pidHigh=0x${pidHigh.toString(16).padStart(4, '0')} action=0x${action.toString(16).padStart(4, '0')}`;
    let entry = outByAddress.get(key);
    if (!entry) { entry = { count: 0, firstFrames: [], payloadLens: new Set() }; outByAddress.set(key, entry); }
    entry.count++;
    if (entry.firstFrames.length < 3) entry.firstFrames.push(msg.frame);
    entry.payloadLens.add(msg.payload.length);
  }

  console.log(`total messages: ${allMsgs.length}`);
  console.log(`distinct OUT 0x01 addresses: ${outByAddress.size}\n`);

  // Sort by count descending, show all with count >= 4 (a per-location pattern would be 104).
  const sorted = [...outByAddress.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log('OUT 0x01 address frequencies (count >= 4):');
  for (const [key, info] of sorted) {
    if (info.count < 4) continue;
    console.log(`  ${key}  count=${info.count}  payloadLens={${[...info.payloadLens].join(',')}}  firstFrames=[${info.firstFrames.join(',')}]`);
  }

  // Specifically flag any address with count exactly 104 or near it.
  console.log('\nAddresses with count == 104 or in [100..108]:');
  for (const [key, info] of sorted) {
    if (info.count >= 100 && info.count <= 108) console.log(`  ${key}  count=${info.count}`);
  }

  // Find IN messages that contain ASCII printable runs >= 5 chars (likely preset names)
  // and show first 30 of them with their preceding OUT address.
  console.log('\nFirst 30 IN responses with ASCII run >= 5 chars, with preceding OUT address:');
  let asciiCount = 0;
  let lastOutMsg: SysexMsg | undefined;
  for (const msg of allMsgs) {
    if (msg.direction === 'OUT' && msg.fn === 0x01) lastOutMsg = msg;
    if (msg.direction !== 'IN' || msg.fn !== 0x01) continue;
    const runs = asciiRuns(msg.payload, 5);
    if (runs.length === 0) continue;
    if (asciiCount++ < 30) {
      const outAddr = lastOutMsg ? (() => {
        const p = lastOutMsg.payload;
        const pidLow = decode14(p[0], p[1]);
        const pidHigh = decode14(p[2], p[3]);
        const action = decode14(p[4], p[5]);
        return `pidLow=0x${pidLow.toString(16).padStart(4, '0')} pidHigh=0x${pidHigh.toString(16).padStart(4, '0')} action=0x${action.toString(16).padStart(4, '0')}`;
      })() : '(no preceding OUT)';
      const hex = msg.payload.slice(0, 48).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`  frame=${msg.frame} preceded by OUT ${outAddr}`);
      console.log(`    payload[${msg.payload.length}]: ${hex}${msg.payload.length > 48 ? ' ...' : ''}`);
      console.log(`    ASCII runs: ${runs.map(r => `"${r}"`).join(', ')}`);
    }
  }
  if (asciiCount > 30) console.log(`  ... +${asciiCount - 30} more IN messages with ASCII`);
  console.log(`\nTotal IN 0x01 messages with ASCII runs >= 5: ${asciiCount}`);
}

await main();
