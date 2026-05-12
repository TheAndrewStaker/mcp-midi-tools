// inspect-axe-bank-syx.ts
//
// One-shot byte-level inspection of an Axe-Fx II XL+ factory bank
// SysEx export. Hardware-free RE: confirms envelope/checksum/function-
// byte hypotheses against real wire bytes.
//
// Reads `samples/factory/Axe-Fx-II_XL+_Bank-A_Q8p02.syx` and reports:
//   - Total SysEx messages in file
//   - Messages by function byte (0x77 header / 0x78 chunk / 0x79 footer / etc.)
//   - Presets identified (each preset starts with a 0x77 header)
//   - Per-message size distribution
//   - First N preset names extracted from chunk bodies
//
// This is a discovery script, not a regression test — output is human-
// readable and meant to be eyeballed.

import { readFileSync, existsSync } from 'node:fs';

const FILES = [
    'samples/factory/Axe-Fx-II_XL+_Bank-A_Q8p02.syx',
    'samples/factory/Axe-Fx-II_XL+_Bank-B_Q8p02.syx',
    'samples/factory/Axe-Fx-II_XL+_Bank-C_Q8p02.syx',
] as const;

interface SysexMessage {
    /** Byte offset where F0 was found. */
    offset: number;
    /** Full message bytes including F0..F7. */
    bytes: Buffer;
    /** Manufacturer ID octet 1 (offset 1). */
    manuf1: number;
    manuf2: number;
    manuf3: number;
    /** Model byte (offset 4). */
    model: number;
    /** Function byte (offset 5). */
    fn: number;
    /** Inner payload (between fn and the trailing checksum byte). */
    payload: Buffer;
    /** Last data byte before F7 — Fractal-style XOR & 0x7F checksum. */
    checksum: number;
    /** Computed XOR & 0x7F across F0..lastPayload. */
    checksumComputed: number;
}

function splitMessages(buf: Buffer): SysexMessage[] {
    const out: SysexMessage[] = [];
    let i = 0;
    while (i < buf.length) {
        if (buf[i] !== 0xF0) { i++; continue; }
        let j = i + 1;
        while (j < buf.length && buf[j] !== 0xF7) j++;
        if (j >= buf.length) break;
        const slice = buf.subarray(i, j + 1);
        if (slice.length < 8) { i = j + 1; continue; }
        const manuf1 = slice[1];
        const manuf2 = slice[2];
        const manuf3 = slice[3];
        const model = slice[4];
        const fn = slice[5];
        const checksum = slice[slice.length - 2];
        const payload = slice.subarray(6, slice.length - 2);
        let xor = 0;
        for (let k = 0; k < slice.length - 2; k++) xor ^= slice[k];
        out.push({
            offset: i,
            bytes: Buffer.from(slice),
            manuf1, manuf2, manuf3, model, fn, payload,
            checksum,
            checksumComputed: xor & 0x7F,
        });
        i = j + 1;
    }
    return out;
}

function asciiFromTriplets(buf: Buffer, maxChars = 40): string {
    const chars: string[] = [];
    for (let i = 0; i + 2 < buf.length && chars.length < maxChars; i += 3) {
        const c = buf[i];
        if (buf[i + 1] === 0 && buf[i + 2] === 0 && c >= 0x20 && c < 0x7F) {
            chars.push(String.fromCharCode(c));
        } else {
            break;
        }
    }
    return chars.join('').trimEnd();
}

for (const path of FILES) {
    if (!existsSync(path)) {
        console.log(`SKIP (missing): ${path}`);
        continue;
    }
    const buf = readFileSync(path);
    const msgs = splitMessages(buf);
    console.log(`\n=== ${path} ===`);
    console.log(`File size: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`);
    console.log(`SysEx messages: ${msgs.length}`);

    const byFn: Record<number, number> = {};
    let envelopeMatches = 0;
    let checksumMatches = 0;
    for (const m of msgs) {
        byFn[m.fn] = (byFn[m.fn] ?? 0) + 1;
        if (m.manuf1 === 0x00 && m.manuf2 === 0x01 && m.manuf3 === 0x74) envelopeMatches++;
        if (m.checksum === m.checksumComputed) checksumMatches++;
    }
    console.log(`Envelope matches Fractal '00 01 74': ${envelopeMatches}/${msgs.length}`);
    console.log(`Checksum matches XOR & 0x7F: ${checksumMatches}/${msgs.length}`);

    const modelBytes = new Set(msgs.map(m => m.model));
    console.log(`Model bytes seen: ${Array.from(modelBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}`);

    console.log('Messages by function byte:');
    for (const [fn, n] of Object.entries(byFn).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        console.log(`  fn=0x${Number(fn).toString(16).padStart(2, '0')}  count=${n}`);
    }

    // Per-fn payload size distribution
    const sizesByFn: Record<number, number[]> = {};
    for (const m of msgs) {
        if (!sizesByFn[m.fn]) sizesByFn[m.fn] = [];
        sizesByFn[m.fn].push(m.payload.length);
    }
    console.log('Payload size by fn (min/median/max):');
    for (const [fn, sizes] of Object.entries(sizesByFn).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const sorted = [...sizes].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const med = sorted[Math.floor(sorted.length / 2)];
        console.log(`  fn=0x${Number(fn).toString(16).padStart(2, '0')}  min=${min}  median=${med}  max=${max}  count=${sizes.length}`);
    }

    // 0x77 = preset/bank header. Each one starts a new preset.
    const presetHeaders = msgs.filter(m => m.fn === 0x77);
    console.log(`Preset headers (fn=0x77): ${presetHeaders.length}`);
    if (presetHeaders.length > 0) {
        console.log('First 5 header payloads (hex):');
        for (const h of presetHeaders.slice(0, 5)) {
            const hex = Array.from(h.payload).map(b => b.toString(16).padStart(2, '0')).join(' ');
            console.log(`  offset=0x${h.offset.toString(16)}  payload=[${hex}]`);
        }
    }

    // Pull names from first 8 chunk messages (fn=0x78). Names appear
    // at bytes 8..40ish in chunk payloads, ASCII-in-triplet pattern.
    const chunks = msgs.filter(m => m.fn === 0x78);
    console.log(`Data chunks (fn=0x78): ${chunks.length}`);
    if (chunks.length > 0) {
        console.log('First 8 chunk preset-name candidates:');
        for (let k = 0; k < Math.min(8, chunks.length); k++) {
            const c = chunks[k];
            // Skip the chunk header bytes (typically 8 bytes per inspection).
            const nameRegion = c.payload.subarray(8, 8 + 32 * 3);
            const name = asciiFromTriplets(nameRegion, 32);
            console.log(`  chunk #${k}  payloadLen=${c.payload.length}  name="${name}"`);
        }
    }
}
