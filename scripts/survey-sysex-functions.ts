/**
 * Survey EVERY SysEx function ID seen in a USBPcap capture, grouped by
 * direction (OUT = host→device, IN = device→host). Reports counts +
 * the first 5 examples per function ID.
 *
 * Goal: find any function IDs we haven't decoded yet, especially ones
 * carrying ASCII text payloads (label-fetch protocol candidates).
 *
 * Run:
 *   npx tsx scripts/survey-sysex-functions.ts <tshark.txt>
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const path = process.argv[2];
if (!path) {
  console.error('Usage: survey-sysex-functions.ts <tshark.txt>');
  process.exit(1);
}

interface SysexMsg {
  frame: number;
  time: number;
  direction: 'OUT' | 'IN';
  fn: number;
  payload: number[];
  rawHex: string;
}

async function* parseStream(file: string): AsyncGenerator<SysexMsg> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  // USBPcap MIDI: each USB packet contains zero or more 4-byte USB-MIDI
  // event packets. Each event packet has: cable+CIN nibble, then up to
  // 3 MIDI bytes. We need to reassemble the SysEx stream across packets.
  //
  // Simpler: just look at the raw capdata as hex, find every F0..F7 run,
  // strip the USB-MIDI 4-byte framing, and decode.

  // tshark output columns: frame, time_relative, endpoint_address, capdata
  // Endpoint 0x02 = OUT; 0x82 = IN.

  const accumOut: number[] = [];
  const accumIn: number[] = [];
  let lastTimeOut = 0;
  let lastFrameOut = 0;
  let lastTimeIn = 0;
  let lastFrameIn = 0;

  for await (const line of rl) {
    const cells = line.split('\t');
    if (cells.length < 4) continue;
    const [frameStr, timeStr, epStr, capdata] = cells;
    if (!capdata) continue;
    const ep = parseInt(epStr, 16);
    const isOut = (ep & 0x80) === 0x00 && ep === 0x02;
    const isIn = (ep & 0x80) === 0x80 && ep === 0x82;
    if (!isOut && !isIn) continue;
    const frame = parseInt(frameStr, 10);
    const time = parseFloat(timeStr);

    // capdata is space- or colon-separated hex. Normalize.
    const hex = capdata.replaceAll(/[: ,]/g, '');
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));

    // USB-MIDI 4-byte event packets. Each starts with a CIN/cable byte;
    // payload up to 3 MIDI bytes. Skip the first byte of each 4-byte
    // group, append the meaningful MIDI bytes (per CIN). For SysEx
    // CIN values 4 / 5 / 6 / 7 we emit the bytes following the header.
    for (let i = 0; i + 3 < bytes.length; i += 4) {
      const cn = bytes[i] & 0x0f;
      const m1 = bytes[i + 1];
      const m2 = bytes[i + 2];
      const m3 = bytes[i + 3];
      // CIN 0x04 = SysEx start/cont (3 bytes); 0x05 = SysEx end (1 byte);
      // 0x06 = SysEx end (2 bytes); 0x07 = SysEx end (3 bytes); 0x0F = single byte.
      let mb: number[] = [];
      if (cn === 0x04) mb = [m1, m2, m3];
      else if (cn === 0x05) mb = [m1];
      else if (cn === 0x06) mb = [m1, m2];
      else if (cn === 0x07) mb = [m1, m2, m3];
      else continue;

      const accum = isOut ? accumOut : accumIn;
      for (const b of mb) {
        if (b === 0xf0) {
          accum.length = 0;
          accum.push(b);
          if (isOut) { lastTimeOut = time; lastFrameOut = frame; }
          else { lastTimeIn = time; lastFrameIn = frame; }
        } else if (accum.length > 0) {
          accum.push(b);
          if (b === 0xf7) {
            // emit
            const arr = [...accum];
            accum.length = 0;
            // Validate Fractal envelope
            if (arr.length >= 7 && arr[1] === 0x00 && arr[2] === 0x01 && arr[3] === 0x74) {
              const fn = arr[5];
              const payload = arr.slice(6, arr.length - 2); // strip checksum + F7
              const rawHex = arr.map(b => b.toString(16).padStart(2, '0')).join(' ');
              yield {
                frame: isOut ? lastFrameOut : lastFrameIn,
                time: isOut ? lastTimeOut : lastTimeIn,
                direction: isOut ? 'OUT' : 'IN',
                fn,
                payload,
                rawHex,
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
      if (g.outFirst.length < 5) g.outFirst.push(msg);
      g.outMaxLen = Math.max(g.outMaxLen, msg.payload.length);
    } else {
      g.inCount++;
      if (g.inFirst.length < 5) g.inFirst.push(msg);
      g.inMaxLen = Math.max(g.inMaxLen, msg.payload.length);
    }

    // Look for ASCII runs in the payload (≥4 chars). If a function ID
    // is the label-protocol, we'll see substantial ASCII here.
    let runStart = -1;
    let run = '';
    for (let i = 0; i < msg.payload.length; i++) {
      const b = msg.payload[i];
      if (b >= 0x20 && b <= 0x7e) {
        if (runStart < 0) runStart = i;
        run += String.fromCharCode(b);
      } else {
        if (run.length >= 4) {
          (msg.direction === 'OUT' ? g.outAsciiSamples : g.inAsciiSamples).add(run);
        }
        runStart = -1;
        run = '';
      }
    }
    if (run.length >= 4) (msg.direction === 'OUT' ? g.outAsciiSamples : g.inAsciiSamples).add(run);
  }

  console.log(`total SysEx messages: ${total}`);
  console.log(`distinct function IDs: ${groups.size}\n`);

  const sorted = [...groups.entries()].sort((a, b) => (b[1].outCount + b[1].inCount) - (a[1].outCount + a[1].inCount));
  for (const [fn, g] of sorted) {
    console.log(`\n=== fn=0x${fn.toString(16).padStart(2, '0')}  OUT=${g.outCount}  IN=${g.inCount}  maxOutPayload=${g.outMaxLen}  maxInPayload=${g.inMaxLen} ===`);
    if (g.outAsciiSamples.size > 0) {
      console.log(`  ASCII in OUT: ${[...g.outAsciiSamples].slice(0, 8).map(s => `"${s}"`).join(', ')}${g.outAsciiSamples.size > 8 ? ` ... +${g.outAsciiSamples.size - 8}` : ''}`);
    }
    if (g.inAsciiSamples.size > 0) {
      console.log(`  ASCII in IN:  ${[...g.inAsciiSamples].slice(0, 8).map(s => `"${s}"`).join(', ')}${g.inAsciiSamples.size > 8 ? ` ... +${g.inAsciiSamples.size - 8}` : ''}`);
    }
    if (g.outFirst.length > 0) {
      console.log(`  first OUT (frame=${g.outFirst[0].frame} t=${g.outFirst[0].time.toFixed(3)}s): ${g.outFirst[0].rawHex}`);
    }
    if (g.inFirst.length > 0) {
      const m = g.inFirst[0];
      const preview = m.rawHex.length > 200 ? m.rawHex.slice(0, 200) + ' ...' : m.rawHex;
      console.log(`  first IN  (frame=${m.frame} t=${m.time.toFixed(3)}s): ${preview}`);
    }
  }
}

await main();
