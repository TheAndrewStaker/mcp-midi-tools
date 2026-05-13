// decode-session-61-save.ts
//
// Analyze samples/captured/session-61-save-attempt.syx — passive capture
// of AxeEdit's File → Save Preset operation, saving the working buffer
// to user preset slot 700 with preset name "HW-101 Test".
//
// Goals:
//   1. Histogram every Axe-Fx II SysEx function byte in the capture.
//   2. Cross-reference against the known wiki + decoded corpus — flag
//      any function byte we haven't seen before.
//   3. Look specifically for preset-number 700 (= 0x2BC; 14-bit septet
//      pair = high 0x05, low 0x3C) appearing as a payload field.
//   4. Print full hex of any low-frequency function bytes (likely
//      candidates for save-correlated events).
//
// Hardware-free; reads only the capture file.

import { readFileSync } from 'node:fs';

const CAPTURE = 'samples/captured/session-61-save-attempt.syx';
const PRESET_NUMBER = 700;

interface Msg {
    offset: number;
    bytes: Buffer;
    fn: number;
    payloadLen: number;
}

function splitAxeFxMessages(buf: Buffer): Msg[] {
    const out: Msg[] = [];
    let i = 0;
    while (i < buf.length) {
        if (buf[i] !== 0xF0) { i++; continue; }
        let j = i + 1;
        while (j < buf.length && buf[j] !== 0xF7) j++;
        if (j >= buf.length) break;
        const slice = buf.subarray(i, j + 1);
        // Axe-Fx II envelope: F0 00 01 74 07 [fn] ... [cs] F7
        if (slice.length >= 8 && slice[1] === 0x00 && slice[2] === 0x01 &&
            slice[3] === 0x74 && slice[4] === 0x07) {
            const fn = slice[5];
            const payloadLen = slice.length - 8;
            out.push({
                offset: i,
                bytes: Buffer.from(slice),
                fn,
                payloadLen,
            });
        }
        i = j + 1;
    }
    return out;
}

function hex(buf: Buffer): string {
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// What we've already seen across the existing corpus (sessions 58 / 60 etc.).
// Used to flag bytes that are NEW to session 61's save-attempt capture.
// Sourced from docs/_private/HARDWARE-TASKS-AXEFX2.md:528-543 + SYSEX-MAP-AXE-FX-II.md.
const KNOWN_FN_BYTES = new Set<number>([
    0x01, 0x02, 0x07, 0x08, 0x09, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13,
    0x14, 0x15, 0x17, 0x18, 0x1A, 0x20, 0x21, 0x23, 0x29, 0x2A, 0x2E, 0x2F,
    0x32, 0x33, 0x35, 0x36, 0x37, 0x3C, 0x42, 0x47, 0x48, 0x64, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x7B, 0x7C,
]);

const SAVE_HYPOTHESES: Record<number, string> = {
    0x1D: '🎯 bspaulding-documented store-to-location byte',
    0x77: 'PRESET_DUMP_HEADER — may double as save trigger',
    0x78: 'PRESET_DUMP_CHUNK — may double as save body',
    0x79: 'PRESET_DUMP_FOOTER — may double as save commit',
    0x09: 'SET_PRESET_NAME — common partner with save',
    0x3C: 'SET_PRESET_NUMBER — may be the save trigger payload',
};

function main() {
    const buf = readFileSync(CAPTURE);
    console.log(`\n=== Session 61 save-attempt capture ===`);
    console.log(`File: ${CAPTURE}`);
    console.log(`Size: ${buf.length} bytes`);

    const msgs = splitAxeFxMessages(buf);
    console.log(`Axe-Fx II messages: ${msgs.length}\n`);

    // Function-byte histogram
    const histo = new Map<number, Msg[]>();
    for (const m of msgs) {
        const list = histo.get(m.fn) ?? [];
        list.push(m);
        histo.set(m.fn, list);
    }
    const sortedFns = Array.from(histo.keys()).sort((a, b) => a - b);

    console.log('--- Function-byte histogram ---');
    console.log('fn      count  payloadLen(s)  known?  hypothesis');
    for (const fn of sortedFns) {
        const list = histo.get(fn)!;
        const lens = Array.from(new Set(list.map((m) => m.payloadLen))).sort((a, b) => a - b);
        const lensStr = lens.length <= 4 ? lens.join(',') : `${lens[0]}..${lens[lens.length - 1]} (${lens.length})`;
        const known = KNOWN_FN_BYTES.has(fn) ? '✓' : '🆕 NEW';
        const hint = SAVE_HYPOTHESES[fn] ?? '';
        console.log(`0x${fn.toString(16).padStart(2, '0')}    ${String(list.length).padStart(4)}  ${lensStr.padEnd(13)}  ${known.padEnd(6)}  ${hint}`);
    }

    // Look for preset 700 in 14-bit septet form: high=5, low=0x3C
    console.log('\n--- Searching for preset 700 (14-bit septet: 0x05 0x3C) ---');
    const target = Buffer.from([0x05, 0x3C]);
    let hits = 0;
    for (const m of msgs) {
        const idx = m.bytes.indexOf(target);
        if (idx !== -1) {
            hits++;
            if (hits <= 10) {
                console.log(`fn=0x${m.fn.toString(16).padStart(2, '0')} offset=${m.offset} idx=${idx}/${m.bytes.length}: ${hex(m.bytes)}`);
            }
        }
    }
    console.log(`Total matches for [0x05 0x3C]: ${hits}`);

    // Also try LSB-first ordering (some Fractal payloads use low,high)
    console.log('\n--- Searching for preset 700 (LSB-first septet: 0x3C 0x05) ---');
    const targetLsb = Buffer.from([0x3C, 0x05]);
    let hitsLsb = 0;
    for (const m of msgs) {
        const idx = m.bytes.indexOf(targetLsb);
        if (idx !== -1) {
            hitsLsb++;
            if (hitsLsb <= 10) {
                console.log(`fn=0x${m.fn.toString(16).padStart(2, '0')} offset=${m.offset} idx=${idx}/${m.bytes.length}: ${hex(m.bytes)}`);
            }
        }
    }
    console.log(`Total matches for [0x3C 0x05]: ${hitsLsb}`);

    // Dump full hex of any NEW function bytes (not in known set)
    console.log('\n--- Full hex of NEW function-byte messages ---');
    let dumped = 0;
    for (const fn of sortedFns) {
        if (KNOWN_FN_BYTES.has(fn)) continue;
        const list = histo.get(fn)!;
        for (const m of list) {
            console.log(`fn=0x${fn.toString(16).padStart(2, '0')} (${m.bytes.length}B): ${hex(m.bytes)}`);
            dumped++;
            if (dumped >= 30) {
                console.log('(truncated at 30 messages)');
                return;
            }
        }
    }
    if (dumped === 0) {
        console.log('(no new function bytes — every fn in this capture appears in the existing corpus)');
    }

    // Also dump full hex of any low-frequency fn (< 4 occurrences), since
    // a "save" is a one-shot event, not a periodic broadcast.
    console.log('\n--- Full hex of LOW-FREQUENCY (<= 3 occurrences) function-byte messages ---');
    let lfDumped = 0;
    for (const fn of sortedFns) {
        const list = histo.get(fn)!;
        if (list.length > 3) continue;
        if (!KNOWN_FN_BYTES.has(fn)) continue; // already dumped above
        for (const m of list) {
            console.log(`fn=0x${fn.toString(16).padStart(2, '0')} (${m.bytes.length}B): ${hex(m.bytes)}`);
            lfDumped++;
            if (lfDumped >= 60) {
                console.log('(truncated at 60 messages)');
                return;
            }
        }
    }
}

main();
