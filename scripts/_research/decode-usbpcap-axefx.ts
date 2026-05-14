/**
 * Decode a Wireshark .pcapng capture of USBPcap traffic into per-direction
 * SysEx streams, highlighting any Axe-Fx II frames (manufacturer 00 01 74,
 * model 0x07).
 *
 * Pipeline:
 *   pcapng blocks → USBPcap pseudo-header → USB-MIDI 4-byte packets → SysEx
 *
 * USB-MIDI Class Specification: every USB-MIDI transfer is a multiple of 4
 * bytes. Each 4-byte parcel is [CN<<4|CIN, midi0, midi1, midi2]. CIN values
 * for SysEx fragmentation:
 *   0x4 = SysEx starts or continues, all 3 MIDI bytes valid
 *   0x5 = SysEx ends with one byte
 *   0x6 = SysEx ends with two bytes
 *   0x7 = SysEx ends with three bytes
 *
 * Usage: npx tsx scripts/decode-usbpcap-axefx.ts <path.pcapng>
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const AXEFX_PREFIX = [0xf0, 0x00, 0x01, 0x74, 0x07];

function hex(b: number, w = 2): string { return b.toString(16).padStart(w, '0'); }
function toHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes).map((b) => hex(b)).join(' ');
}

// ─── pcapng block parser ──────────────────────────────────────────────────

const BLOCK_SHB = 0x0a0d0d0a; // Section Header Block
const BLOCK_IDB = 0x00000001; // Interface Description Block
const BLOCK_EPB = 0x00000006; // Enhanced Packet Block

interface ParsedPacket {
  ifaceId: number;
  tsHi: number;
  tsLo: number;
  data: Buffer;
}

function* iteratePcapngBlocks(buf: Buffer): Generator<{ type: number; body: Buffer }> {
  let off = 0;
  while (off + 8 <= buf.length) {
    const blockType = buf.readUInt32LE(off);
    const blockLen = buf.readUInt32LE(off + 4);
    if (blockLen < 12 || off + blockLen > buf.length) break;
    const body = buf.subarray(off + 8, off + blockLen - 4);
    yield { type: blockType, body };
    off += blockLen;
  }
}

function parseEpb(body: Buffer): ParsedPacket | null {
  if (body.length < 20) return null;
  const ifaceId = body.readUInt32LE(0);
  const tsHi = body.readUInt32LE(4);
  const tsLo = body.readUInt32LE(8);
  const capLen = body.readUInt32LE(12);
  if (20 + capLen > body.length) return null;
  const data = body.subarray(20, 20 + capLen);
  return { ifaceId, tsHi, tsLo, data: Buffer.from(data) };
}

// ─── USBPcap pseudo-header ────────────────────────────────────────────────

interface UsbPacket {
  headerLen: number;
  endpoint: number;
  transferType: number;
  dataLength: number;
  direction: 'IN' | 'OUT';
  payload: Buffer;
}

function parseUsbPcap(packet: Buffer): UsbPacket | null {
  if (packet.length < 27) return null;
  const headerLen = packet.readUInt16LE(0);
  if (headerLen > packet.length) return null;
  // Per USBPcap spec, common fields after headerLen:
  //   off  0: HeaderLen (u16)
  //   off  2: IRPID (u64)
  //   off 10: Status (u32)
  //   off 14: Function (u16)
  //   off 16: Info (u8)
  //   off 17: Bus (u16)
  //   off 19: Device (u16)
  //   off 21: Endpoint (u8)
  //   off 22: TransferType (u8)
  //   off 23: DataLength (u32)
  const endpoint = packet.readUInt8(21);
  const transferType = packet.readUInt8(22);
  const dataLength = packet.readUInt32LE(23);
  // Direction is the high bit of endpoint per USB spec.
  // For USBPcap, direction is also embedded in the Info byte (bit 0).
  const infoByte = packet.readUInt8(16);
  // Info bit 0: 0 = host-to-device (OUT), 1 = device-to-host (IN)
  const direction = (infoByte & 0x01) ? 'IN' : 'OUT';
  const payload = packet.subarray(headerLen, headerLen + dataLength);
  return { headerLen, endpoint, transferType, dataLength, direction, payload };
}

// ─── USB-MIDI decoder ─────────────────────────────────────────────────────

/** Decode a USB-MIDI bulk payload (multiple of 4 bytes) into raw MIDI bytes. */
function decodeUsbMidi(payload: Buffer): number[] {
  const midi: number[] = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const cinHi = payload[i];
    const cin = cinHi & 0x0f;
    const b1 = payload[i + 1];
    const b2 = payload[i + 2];
    const b3 = payload[i + 3];
    // CIN handling for SysEx:
    //   0x4 = SysEx start/continue (3 bytes)
    //   0x5 = SysEx end with 1 byte
    //   0x6 = SysEx end with 2 bytes
    //   0x7 = SysEx end with 3 bytes
    // Other CINs are non-SysEx (note/CC/etc) — we still capture them for
    // completeness but won't reassemble.
    switch (cin) {
      case 0x4: midi.push(b1, b2, b3); break;
      case 0x5: midi.push(b1); break;
      case 0x6: midi.push(b1, b2); break;
      case 0x7: midi.push(b1, b2, b3); break;
      case 0x8: case 0x9: case 0xa: case 0xb: midi.push(b1, b2, b3); break;
      case 0xc: case 0xd: midi.push(b1, b2); break;
      case 0xe: midi.push(b1, b2, b3); break;
      case 0xf: midi.push(b1); break;
      default: break; // CIN 0x0/0x1/0x2/0x3 reserved
    }
  }
  return midi;
}

interface SysExFrame {
  direction: 'IN' | 'OUT';
  endpoint: number;
  bytes: number[];
}

/** Walk a stream of decoded MIDI bytes, extract complete SysEx frames. */
function extractSysEx(midi: number[]): number[][] {
  const frames: number[][] = [];
  let current: number[] | null = null;
  for (const b of midi) {
    if (b === 0xf0) {
      current = [0xf0];
    } else if (current !== null) {
      current.push(b);
      if (b === 0xf7) {
        frames.push(current);
        current = null;
      }
    }
  }
  return frames;
}

function isAxeFxFrame(frame: number[]): boolean {
  if (frame.length < AXEFX_PREFIX.length) return false;
  for (let i = 0; i < AXEFX_PREFIX.length; i++) {
    if (frame[i] !== AXEFX_PREFIX[i]) return false;
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) { console.error('Usage: decode-usbpcap-axefx <path.pcapng>'); process.exit(1); }
const abs = path.resolve(arg);
if (!existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(1); }

const buf = readFileSync(abs);
console.log(`File: ${abs} (${buf.length} bytes)`);

let totalBlocks = 0;
let epbCount = 0;
let nonUsbCount = 0;
const directionCounts = { IN: 0, OUT: 0 };
const transferTypeCounts = new Map<number, number>();
const endpointCounts = new Map<string, number>();

// Stream per (direction × endpoint) — USB-MIDI traffic on different
// endpoints (different cables) needs to be reassembled separately.
type StreamKey = string;
interface StreamState {
  direction: 'IN' | 'OUT';
  endpoint: number;
  pendingMidi: number[];
  currentFrame: number[] | null;
  // Frames completed in this stream, in chronological order, with timestamps.
  frames: Array<{ ts: number; bytes: number[] }>;
}
const streams = new Map<StreamKey, StreamState>();

for (const { type, body } of iteratePcapngBlocks(buf)) {
  totalBlocks++;
  if (type !== BLOCK_EPB) continue;
  epbCount++;
  const epb = parseEpb(body);
  if (!epb) continue;
  const usb = parseUsbPcap(epb.data);
  if (!usb) { nonUsbCount++; continue; }
  directionCounts[usb.direction]++;
  transferTypeCounts.set(usb.transferType, (transferTypeCounts.get(usb.transferType) ?? 0) + 1);
  const epKey = `ep0x${hex(usb.endpoint)}`;
  endpointCounts.set(epKey, (endpointCounts.get(epKey) ?? 0) + 1);

  // Only bulk transfers carry USB-MIDI data
  if (usb.transferType !== 0x03) continue;
  if (usb.payload.length < 4) continue;

  const streamKey = `${usb.direction}/${epKey}`;
  let state = streams.get(streamKey);
  if (!state) {
    state = { direction: usb.direction, endpoint: usb.endpoint, pendingMidi: [], currentFrame: null, frames: [] };
    streams.set(streamKey, state);
  }
  const ts = (epb.tsHi * 0x100000000) + epb.tsLo;
  const midiBytes = decodeUsbMidi(usb.payload);
  for (const b of midiBytes) {
    if (b === 0xf0) {
      state.currentFrame = [0xf0];
    } else if (state.currentFrame !== null) {
      state.currentFrame.push(b);
      if (b === 0xf7) {
        state.frames.push({ ts, bytes: state.currentFrame });
        state.currentFrame = null;
      }
    }
  }
}

console.log(`pcapng blocks: ${totalBlocks}, EPBs: ${epbCount}, non-USBPcap: ${nonUsbCount}`);
console.log(`Direction: IN=${directionCounts.IN}  OUT=${directionCounts.OUT}`);
const ttNames: Record<number, string> = { 0: 'iso', 1: 'int', 2: 'ctrl', 3: 'bulk' };
const ttSummary = [...transferTypeCounts.entries()]
  .sort(([a], [b]) => a - b)
  .map(([t, n]) => `${ttNames[t] ?? `t${t}`}:${n}`)
  .join('  ');
console.log(`Transfer types: ${ttSummary}`);
const epSummary = [...endpointCounts.entries()].sort().map(([k, n]) => `${k}:${n}`).join('  ');
console.log(`Endpoints: ${epSummary}`);
console.log('');

// Build flat list of frames with timestamps for chronological view
interface TimedFrame extends SysExFrame { ts: number; }
const allFrames: TimedFrame[] = [];
for (const [, state] of streams) {
  for (const f of state.frames) {
    allFrames.push({ direction: state.direction, endpoint: state.endpoint, bytes: f.bytes, ts: f.ts });
  }
}
allFrames.sort((a, b) => a.ts - b.ts);

const outFrames = allFrames.filter((f) => f.direction === 'OUT');
const inFrames = allFrames.filter((f) => f.direction === 'IN');
const axeOut = outFrames.filter((f) => isAxeFxFrame(f.bytes));
const axeIn = inFrames.filter((f) => isAxeFxFrame(f.bytes));

console.log(`Total SysEx frames: ${allFrames.length}  (OUT ${outFrames.length}, IN ${inFrames.length})`);
console.log(`Axe-Fx II frames:   ${axeOut.length + axeIn.length}  (OUT ${axeOut.length}, IN ${axeIn.length})`);
console.log('');

if (axeOut.length === 0 && axeIn.length === 0) {
  console.log('No Axe-Fx II SysEx in this capture. Showing first 5 outbound frames for reference:');
  for (const f of outFrames.slice(0, 5)) {
    console.log(`  OUT len=${f.bytes.length}: ${toHex(f.bytes)}`);
  }
  process.exit(0);
}

// Outbound function-byte distribution — this is the headline find
const outFnCounts = new Map<number, number>();
for (const f of axeOut) {
  const fn = f.bytes[5];
  if (fn !== undefined) outFnCounts.set(fn, (outFnCounts.get(fn) ?? 0) + 1);
}
const outFnSummary = [...outFnCounts.entries()]
  .sort(([a], [b]) => a - b)
  .map(([fn, n]) => `0x${hex(fn)}:${n}`)
  .join('  ');
console.log(`OUTBOUND Axe-Fx II function distribution: ${outFnSummary}`);
console.log('');

// Highlight any fn 0x06 outbound — the long-sought routing-write
const fn06 = axeOut.filter((f) => f.bytes[5] === 0x06);
if (fn06.length > 0) {
  console.log(`🎯 FOUND ${fn06.length} OUTBOUND fn 0x06 frame(s) — routing-write payload:`);
  for (const [i, f] of fn06.entries()) {
    const payload = f.bytes.slice(6, -2); // strip cs + F7
    console.log(`  #${i + 1} full: ${toHex(f.bytes)}`);
    console.log(`      payload (between fn and cs): ${toHex(payload)}  (length ${payload.length})`);
  }
  console.log('');
} else {
  console.log('No outbound fn 0x06 frames in this capture.');
  console.log('');
}

// Print all outbound frames grouped by function byte
console.log('All OUTBOUND Axe-Fx II frames:');
const byFn = new Map<number, SysExFrame[]>();
for (const f of axeOut) {
  const fn = f.bytes[5];
  if (!byFn.has(fn)) byFn.set(fn, []);
  byFn.get(fn)!.push(f);
}
for (const [fn, frames] of [...byFn.entries()].sort(([a], [b]) => a - b)) {
  console.log(`── fn 0x${hex(fn)} (${frames.length} frames) ──`);
  for (const f of frames.slice(0, 5)) {
    console.log(`   len=${f.bytes.length.toString().padStart(3)}  ${toHex(f.bytes)}`);
  }
  if (frames.length > 5) console.log(`   … ${frames.length - 5} more`);
}

// Also: interleaved chronological view (OUT + IN) — critical for figuring
// out request/response sequencing on a small capture.
console.log('');
console.log('CHRONOLOGICAL interleaved view (Axe-Fx II frames only):');
console.log(`Direction  fn    len  bytes`);
console.log('-'.repeat(78));
const interleaved = allFrames
  .filter((f) => isAxeFxFrame(f.bytes))
  .slice(0, 80); // safety cap
for (const f of interleaved) {
  const fn = f.bytes[5];
  const dir = f.direction.padEnd(3);
  console.log(`  ${dir}    0x${hex(fn)}  ${f.bytes.length.toString().padStart(3)}  ${toHex(f.bytes)}`);
}
if (allFrames.filter((f) => isAxeFxFrame(f.bytes)).length > 80) {
  console.log(`  … truncated`);
}
