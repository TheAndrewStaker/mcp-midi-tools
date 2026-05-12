/**
 * Sanity-check a USBPcap capture for Axe-Fx II SysEx traffic before
 * spending time analyzing the wrong file. Saves the "did I capture the
 * right USB hub?" round-trip — instead of stopping Wireshark, naming
 * the file, opening it in a Wireshark filter, etc., just point this at
 * the .pcapng and it tells you in one second.
 *
 * Walks the pcapng block stream, finds USB packets, and counts how
 * many contain the Axe-Fx II SysEx signature `F0 00 01 74 07`. Reports
 * either "looks good, N frames found" or "0 frames — wrong USB hub
 * selected, retry with a different USBPcap interface."
 *
 * Usage:
 *   npx tsx scripts/check-axefx2-capture.ts <path-to.pcapng>
 *   npm run check-axefx2-capture -- samples/captured/foo.pcapng
 *
 * Exit codes:
 *   0  = capture contains Axe-Fx II SysEx frames; keep this file
 *   1  = file invalid / not pcapng / unreadable
 *   2  = file valid but contains 0 Axe-Fx II frames; retry capture
 *
 * Doesn't decode the frames — that's `inspect-axe-bank-syx.ts`'s job.
 * This is a fast triage tool to avoid wasting time on bad captures.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const AXE_FX_II_SYSEX_PREFIX = [0xf0, 0x00, 0x01, 0x74, 0x07];

const arg = process.argv[2];
if (!arg) {
    console.error('Usage: check-axefx2-capture <path-to.pcapng>');
    process.exit(1);
}
const absPath = path.resolve(arg);
if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
}

const buf = readFileSync(absPath);
const sizeKb = (buf.length / 1024).toFixed(1);

// pcapng magic: Section Header Block starts with `0a0d0d0a` (Block Type).
if (buf.length < 12 || buf.readUInt32LE(0) !== 0x0a0d0d0a) {
    console.error(`Not a pcapng file (magic mismatch at offset 0). Wireshark default is pcapng; if you saved as legacy .pcap this script won't read it. File: ${absPath}`);
    process.exit(1);
}

// Walk pcapng blocks. Each block = u32 type + u32 length + body + u32 length-repeat.
// Block types we care about:
//   0x00000001 — Interface Description Block (carries link-layer type)
//   0x00000006 — Enhanced Packet Block (the common per-packet record)
//   0x00000003 — Simple Packet Block (rarer)
let off = 0;
let blockCount = 0;
let packetCount = 0;
let axeFxIIFrames = 0;
let nonAxeUsbPackets = 0;
const linktypes = new Map<number, number>(); // ifaceId → linktype
const sampleFrames: string[] = [];

while (off + 12 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const length = buf.readUInt32LE(off + 4);
    if (length < 12 || length > buf.length - off) {
        console.error(`Truncated block at offset ${off} — file may be incomplete.`);
        break;
    }
    blockCount++;

    if (type === 0x00000001) {
        // Interface Description Block: u16 linktype + u16 reserved + u32 snaplen + options
        const linktype = buf.readUInt16LE(off + 8);
        linktypes.set(linktypes.size, linktype);
    } else if (type === 0x00000006 || type === 0x00000003) {
        packetCount++;
        // EPB body layout: ifaceId(4) + timestampHi(4) + timestampLo(4) + capturedLen(4) + origLen(4) + packetData
        const isEPB = type === 0x00000006;
        const dataStart = isEPB ? off + 8 + 16 : off + 8 + 4;
        const capturedLen = isEPB ? buf.readUInt32LE(off + 8 + 12) : buf.readUInt32LE(off + 8);
        if (capturedLen <= 0 || dataStart + capturedLen > off + length) {
            off += length;
            continue;
        }
        const data = buf.subarray(dataStart, dataStart + capturedLen);
        const matchStart = findSubarray(data, AXE_FX_II_SYSEX_PREFIX);
        if (matchStart >= 0) {
            axeFxIIFrames++;
            if (sampleFrames.length < 5) {
                let end = matchStart;
                for (let j = matchStart; j < Math.min(matchStart + 80, data.length); j++) {
                    end = j;
                    if (data[j] === 0xf7) break;
                }
                const hex = Array.from(data.subarray(matchStart, end + 1))
                    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');
                sampleFrames.push(`  packet #${packetCount}: ${hex}`);
            }
        } else {
            nonAxeUsbPackets++;
        }
    }
    off += length;
}

// Report.
console.log(`File:     ${absPath}`);
console.log(`Size:     ${buf.length} bytes (${sizeKb} KB)`);
console.log(`Blocks:   ${blockCount}`);
console.log(`Packets:  ${packetCount}`);
if (linktypes.size > 0) {
    const linkSummary = [...linktypes.entries()]
        .map(([id, lt]) => `iface ${id}: linktype=${lt}${lt === 249 ? ' (USBPcap)' : ''}`)
        .join('; ');
    console.log(`Interfaces: ${linkSummary}`);
}
console.log('');

if (axeFxIIFrames === 0) {
    console.log('✗ NO Axe-Fx II SysEx frames found.');
    console.log('');
    console.log('Diagnosis: the capture grabbed USB traffic from a different device.');
    console.log('Cause is usually wrong USBPcap interface — interfaces are numbered');
    console.log('per USB Root Hub, not per physical port, so "USB port 2" in USBPcap');
    console.log('rarely corresponds to the physical port the Axe-Fx II is plugged into.');
    console.log('');
    console.log('Retry:');
    console.log('  1. Stop the current capture.');
    console.log('  2. In USBPcap, pick a different USBPcap interface (USBPcap1, 2, 3…).');
    console.log('  3. Start capture, wiggle one knob in AxeEdit, watch Wireshark\'s');
    console.log('     bottom-right packet counter. If it jumps → right interface.');
    console.log('  4. If still 0 → stop, try the next interface, repeat.');
    console.log('  5. Once found, do the full HW-074 capture sequence on that interface.');
    process.exit(2);
}

console.log(`✓ Found ${axeFxIIFrames} Axe-Fx II SysEx frame${axeFxIIFrames === 1 ? '' : 's'} in capture.`);
console.log(`  (plus ${nonAxeUsbPackets} non-Axe-Fx II USB packets — control transfers, other devices on the same hub, etc.)`);
console.log('');
console.log('Sample frames:');
for (const f of sampleFrames) console.log(f);
if (axeFxIIFrames > sampleFrames.length) {
    console.log(`  … (${axeFxIIFrames - sampleFrames.length} more)`);
}
console.log('');
console.log('Capture looks good. Analyze with `scripts/inspect-axe-bank-syx.ts` or');
console.log('the inspection / diff workflow documented in HARDWARE-TASKS-AXEFX2.md HW-074.');
process.exit(0);

function findSubarray(haystack: Uint8Array, needle: number[]): number {
    if (needle.length === 0 || haystack.length < needle.length) return -1;
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}
