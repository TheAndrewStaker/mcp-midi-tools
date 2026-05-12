// decode-session-58-block-add.ts
//
// Analyze samples/captured/session-58-block-add.syx — passive capture
// of AxeEdit's "drag a block from the palette onto an empty grid cell"
// operation. Captured during the session-58 corpus run (2026-05-11);
// we are using it now to constrain the answer space for the
// session-62 grid-write bridge captures (Path B grid-write decode).
//
// Passive capture only sees device → host. So what we'll find here is
// the DEVICE'S RESPONSE to AxeEdit's add-block write — typically a
// state-broadcast triple (0x74/0x75/0x76) carrying the new block's
// param values, possibly preceded by an ACK or a state-correlated
// event. The actual write byte from AxeEdit is invisible to passive
// capture; we need the bridge for that. But knowing the response side
// constrains: how the device addresses cells, what param values get
// pre-populated for a fresh block, whether a "block added" ACK exists.
//
// Hardware-free — reads only the capture file.

import { readFileSync } from 'node:fs';

const CAPTURE = 'samples/captured/session-58-block-add.syx';

interface Msg {
    index: number;
    offset: number;
    bytes: Buffer;
    fn: number;
    payloadLen: number;
}

function splitAxeFxMessages(buf: Buffer): Msg[] {
    const out: Msg[] = [];
    let i = 0;
    let idx = 0;
    while (i < buf.length) {
        if (buf[i] !== 0xF0) { i++; continue; }
        let j = i + 1;
        while (j < buf.length && buf[j] !== 0xF7) j++;
        if (j >= buf.length) break;
        const slice = buf.subarray(i, j + 1);
        if (slice.length >= 8 && slice[1] === 0x00 && slice[2] === 0x01 &&
            slice[3] === 0x74 && slice[4] === 0x07) {
            out.push({
                index: idx++,
                offset: i,
                bytes: Buffer.from(slice),
                fn: slice[5],
                payloadLen: slice.length - 8,
            });
        }
        i = j + 1;
    }
    return out;
}

function hex(buf: Buffer, max = 200): string {
    if (buf.length <= max) {
        return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    }
    return Array.from(buf.subarray(0, max)).map((b) => b.toString(16).padStart(2, '0')).join(' ') + ` ... (+${buf.length - max} more)`;
}

function decodeTripletAscii(buf: Buffer, maxChars = 40): string {
    const chars: string[] = [];
    for (let i = 0; i + 2 < buf.length && chars.length < maxChars; i += 3) {
        const b = buf[i];
        if (b === 0 || (b >= 0x20 && b <= 0x7e)) {
            chars.push(b === 0 ? '·' : String.fromCharCode(b));
        } else {
            break;
        }
    }
    return chars.join('').trimEnd();
}

function main() {
    const buf = readFileSync(CAPTURE);
    console.log(`\n=== ${CAPTURE} ===`);
    console.log(`File size: ${buf.length} bytes`);

    const msgs = splitAxeFxMessages(buf);
    console.log(`Axe-Fx II messages: ${msgs.length}\n`);

    // Function-byte histogram
    const histo = new Map<number, Msg[]>();
    for (const m of msgs) {
        const list = histo.get(m.fn) ?? [];
        list.push(m);
        histo.set(m.fn, list);
    }
    const fns = Array.from(histo.keys()).sort((a, b) => a - b);

    console.log('--- Function-byte histogram (ordered) ---');
    console.log('fn      count  payloadLens');
    for (const fn of fns) {
        const list = histo.get(fn)!;
        const lens = Array.from(new Set(list.map((m) => m.payloadLen))).sort((a, b) => a - b);
        const lensStr = lens.length <= 5 ? lens.join(',') : `${lens[0]}..${lens[lens.length - 1]} (${lens.length} distinct)`;
        console.log(`0x${fn.toString(16).padStart(2, '0')}    ${String(list.length).padStart(4)}  ${lensStr}`);
    }

    // Show sequence — what fires first, what fires after.
    console.log('\n--- Message sequence (in capture order) ---');
    for (const m of msgs.slice(0, 80)) {
        const tag = `[${String(m.index).padStart(3)}] fn=0x${m.fn.toString(16).padStart(2, '0')} (${m.payloadLen}B payload)`;
        const previewBytes = m.bytes.subarray(6, Math.min(m.bytes.length - 2, 6 + 24));
        const preview = Array.from(previewBytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
        const ellipsis = m.bytes.length - 2 > 6 + 24 ? ' ...' : '';
        console.log(`  ${tag}: ${preview}${ellipsis}`);
    }
    if (msgs.length > 80) console.log(`  ... (+${msgs.length - 80} more messages)`);

    // 0x74 STATE_DUMP_HEADERs — likely the device's "here's the new
    // block's full state" broadcast. Header carries target_id + item_count.
    console.log('\n--- 0x74 STATE_DUMP_HEADER decoded ---');
    const headers = histo.get(0x74) ?? [];
    for (const h of headers.slice(0, 10)) {
        const p = h.bytes.subarray(6, h.bytes.length - 2);
        // wiki format from decode-axefx2-chunk.ts: target_id 14b septet, item_count 14b septet, op_flag
        if (p.length >= 5) {
            const targetLow = p[0] & 0x7f;
            const targetHigh = p[1] & 0x7f;
            const targetId = (targetHigh << 7) | targetLow;
            const countLow = p[2] & 0x7f;
            const countHigh = p[3] & 0x7f;
            const itemCount = (countHigh << 7) | countLow;
            const opFlag = p[4];
            console.log(`  [${h.index}] target_id=${targetId} (0x${targetId.toString(16)}) item_count=${itemCount} op_flag=0x${opFlag.toString(16).padStart(2, '0')}`);
        }
    }

    // 0x12 / 0x15 / 0x17 / 0x18 — periodic broadcasts. Skim a few.
    for (const fn of [0x12, 0x15, 0x17, 0x18, 0x1A, 0x2A, 0x2F, 0x35, 0x47, 0x64]) {
        const list = histo.get(fn);
        if (!list || list.length === 0) continue;
        console.log(`\n--- 0x${fn.toString(16)} first 3 messages ---`);
        for (const m of list.slice(0, 3)) {
            console.log(`  [${m.index}] (${m.bytes.length}B): ${hex(m.bytes, 80)}`);
        }
    }

    // ASCII payload sniff — does any message carry a block-type name?
    console.log('\n--- ASCII-decodable payloads ---');
    for (const m of msgs) {
        const p = m.bytes.subarray(6, m.bytes.length - 2);
        const asTriplet = decodeTripletAscii(p);
        if (asTriplet.length >= 3) {
            console.log(`  [${m.index}] fn=0x${m.fn.toString(16).padStart(2, '0')}: "${asTriplet}"`);
        }
    }
}

main();
