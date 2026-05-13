/**
 * Inspect non-bulk USB transfers (control endpoints) AND USB-MIDI cable
 * numbers in an existing USBPcap capture. Used to hunt for state-changing
 * vendor commands that we missed by filtering on bulk transfers only.
 *
 * Usage: npx tsx scripts/inspect-usbpcap-control-and-cables.ts <path.pcapng>
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function hex(b: number, w = 2): string { return b.toString(16).padStart(w, '0'); }
function toHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes).map((b) => hex(b)).join(' ');
}

const BLOCK_EPB = 0x00000006;

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

interface ParsedPacket { tsHi: number; tsLo: number; data: Buffer; }
function parseEpb(body: Buffer): ParsedPacket | null {
  if (body.length < 20) return null;
  const tsHi = body.readUInt32LE(4);
  const tsLo = body.readUInt32LE(8);
  const capLen = body.readUInt32LE(12);
  if (20 + capLen > body.length) return null;
  return { tsHi, tsLo, data: Buffer.from(body.subarray(20, 20 + capLen)) };
}

interface UsbPacket {
  ts: number;
  headerLen: number;
  endpoint: number;
  transferType: number;
  direction: 'IN' | 'OUT';
  dataLength: number;
  payload: Buffer;
  raw: Buffer;
}

function parseUsbPcap(ts: number, packet: Buffer): UsbPacket | null {
  if (packet.length < 27) return null;
  const headerLen = packet.readUInt16LE(0);
  if (headerLen > packet.length) return null;
  const infoByte = packet.readUInt8(16);
  const endpoint = packet.readUInt8(21);
  const transferType = packet.readUInt8(22);
  const dataLength = packet.readUInt32LE(23);
  const direction = (infoByte & 0x01) ? 'IN' : 'OUT';
  const payload = packet.subarray(headerLen, headerLen + dataLength);
  return { ts, headerLen, endpoint, transferType, direction, dataLength, payload, raw: packet };
}

const arg = process.argv[2];
if (!arg) { console.error('Usage: inspect-usbpcap-control-and-cables <path.pcapng>'); process.exit(1); }
const abs = path.resolve(arg);
if (!existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(1); }

const buf = readFileSync(abs);

const packets: UsbPacket[] = [];
for (const { type, body } of iteratePcapngBlocks(buf)) {
  if (type !== BLOCK_EPB) continue;
  const epb = parseEpb(body);
  if (!epb) continue;
  const ts = (epb.tsHi * 0x100000000) + epb.tsLo;
  const usb = parseUsbPcap(ts, epb.data);
  if (usb) packets.push(usb);
}
packets.sort((a, b) => a.ts - b.ts);

console.log(`Total packets: ${packets.length}`);

// ── Part 1: dump all CONTROL transfers ──────────────────────────────────
const controls = packets.filter((p) => p.transferType === 0x02);
console.log(`\nCONTROL transfers: ${controls.length}`);
console.log('Direction  ep    dataLen  fullHeader+payload');
console.log('-'.repeat(78));
for (const c of controls) {
  console.log(`  ${c.direction.padEnd(3)}    0x${hex(c.endpoint)}  ${c.dataLength.toString().padStart(4)}     ${toHex(c.raw.subarray(0, Math.min(48, c.raw.length)))}${c.raw.length > 48 ? ' …' : ''}`);
}

// ── Part 2: scan bulk OUT packets, look for USB-MIDI cable numbers ──────
const bulkOut = packets.filter((p) => p.transferType === 0x03 && p.direction === 'OUT' && p.payload.length >= 4);
console.log(`\nBULK OUT bulk packets: ${bulkOut.length}`);
console.log('USB-MIDI cable+CIN distribution (high nibble = cable, low nibble = CIN):');
const cinCounts = new Map<number, number>();
for (const p of bulkOut) {
  for (let i = 0; i + 4 <= p.payload.length; i += 4) {
    const b0 = p.payload[i];
    cinCounts.set(b0, (cinCounts.get(b0) ?? 0) + 1);
  }
}
const cinSummary = [...cinCounts.entries()]
  .sort(([a], [b]) => a - b)
  .map(([b, n]) => {
    const cable = (b >> 4) & 0x0f;
    const cin = b & 0x0f;
    return `0x${hex(b)}(cable=${cable},CIN=${cin}):${n}`;
  });
console.log('  ' + cinSummary.join('  '));

// Pull out the first OUT packet containing fn 0x06 for byte-level inspection
const fn06Bulk = bulkOut.find((p) => {
  for (let i = 0; i + 4 <= p.payload.length; i += 4) {
    const b1 = p.payload[i + 1];
    if (b1 === 0xf0 && p.payload[i + 2] === 0x00 && p.payload[i + 3] === 0x01) {
      // F0 starts a frame; continue scanning for 0x06 at the right offset
      return true;
    }
  }
  return false;
});

console.log('\nFIRST OUT bulk packet containing F0 (may be fn 0x06 routing):');
if (fn06Bulk) {
  console.log(`  ts=${fn06Bulk.ts}  endpoint=0x${hex(fn06Bulk.endpoint)}  dataLen=${fn06Bulk.dataLength}`);
  console.log(`  payload bytes (USB-MIDI parcels): ${toHex(fn06Bulk.payload)}`);
}

// Also: scan for outbound packets containing the exact fn 0x06 frame
console.log('\nAll OUT bulk packets whose payload contains 0xF0 0x00 0x01 0x74 0x07 0x06:');
let found = 0;
for (const p of bulkOut) {
  const buf2 = p.payload;
  for (let i = 0; i + 8 <= buf2.length; i++) {
    if (
      buf2[i] === 0xf0 && buf2[i+1] === 0x00 && buf2[i+2] === 0x01 &&
      buf2[i+3] === 0x74 && buf2[i+4] === 0x07 && buf2[i+5] === 0x06
    ) {
      found++;
      console.log(`  ts=${p.ts}  ep=0x${hex(p.endpoint)}  payload (${buf2.length}B): ${toHex(buf2)}`);
      break;
    }
    // Also check USB-MIDI repacked form: parcels of 4 bytes starting [cable+CIN, F0, ...]
    if (i % 4 === 0 && (buf2[i] & 0x0f) === 0x4 && buf2[i+1] === 0xf0) {
      // Look ahead for F0 frame across parcels
      const midiBytes: number[] = [];
      for (let j = i; j + 4 <= buf2.length; j += 4) {
        const cin = buf2[j] & 0x0f;
        if (cin === 0x4) midiBytes.push(buf2[j+1], buf2[j+2], buf2[j+3]);
        else if (cin === 0x5) { midiBytes.push(buf2[j+1]); break; }
        else if (cin === 0x6) { midiBytes.push(buf2[j+1], buf2[j+2]); break; }
        else if (cin === 0x7) { midiBytes.push(buf2[j+1], buf2[j+2], buf2[j+3]); break; }
        else break;
      }
      if (midiBytes.length >= 6 && midiBytes[5] === 0x06) {
        found++;
        console.log(`  ts=${p.ts}  ep=0x${hex(p.endpoint)} cable=${(buf2[i] >> 4) & 0xf}  USB_BULK_PAYLOAD_LEN=${buf2.length}`);
        console.log(`    full raw payload: ${toHex(buf2)}`);
        console.log(`    reassembled MIDI: ${toHex(midiBytes)} (${midiBytes.length} bytes)`);
        break;
      }
    }
  }
}
if (found === 0) console.log('  (none — fn 0x06 must be reassembled across packets)');
