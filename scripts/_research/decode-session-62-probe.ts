// decode-session-62-probe.ts
//
// Decode passive-capture file from the 0x05 probe series (session-62).
// User sent 4 probes via send_sysex while capture-axefx2 was listening
// on AXE-FX II MIDI In. After all 4 probes, the grid had changed
// (CPR1 moved from row 2 col 1 to row 3 col 1; a shunt appeared at
// row 2 col 3). This capture holds the device-side broadcasts that
// followed each probe.
//
// Goal: identify WHICH probe triggered the state change and what the
// device emitted in response. Probes (in order):
//   A: F0 00 01 74 07 05 07 F7                         (bare)
//   B: F0 00 01 74 07 05 00 07 F7                      (1-byte payload 0x00)
//   C: F0 00 01 74 07 05 00 00 00 00 07 F7             (4-byte zero payload)
//   D: F0 00 01 74 07 05 64 00 02 00 61 F7             (4-byte populated-cell descriptor)
//
// What we look for in the capture (all device → host):
//   - 0x64 [05] [result] — ACK for the 0x05 frame; one per probe
//   - 0x0E PRESET_BLOCKS_DATA — broadcasts after grid change
//   - 0x2A 01 — preset-edited flag broadcasts after a write
//   - 0x74/0x75/0x76 — state-dump triple broadcasts after a block edit
//   - 0x20 — only if the device proactively re-broadcasts grid layout
//
// Hardware-free; reads only the capture file.

import { readFileSync } from 'node:fs';

const CAPTURE = 'samples/captured/session-62-probe-0x05.syx';

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

function hex(buf: Buffer): string {
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function main() {
    const buf = readFileSync(CAPTURE);
    console.log(`\n=== ${CAPTURE} ===`);
    console.log(`File size: ${buf.length} bytes`);

    const msgs = splitAxeFxMessages(buf);
    console.log(`Axe-Fx II messages: ${msgs.length}\n`);

    // Full message sequence so we can correlate position with probe events.
    console.log('--- All messages in capture order ---');
    for (const m of msgs) {
        const payload = m.bytes.subarray(6, m.bytes.length - 2);
        console.log(`  [${String(m.index).padStart(2)}] fn=0x${m.fn.toString(16).padStart(2, '0')} (${m.payloadLen}B): ${hex(payload)}`);
    }

    // 0x64 ACK summary — every echoed function byte AxeEdit (or our probe) sent.
    console.log('\n--- 0x64 MULTIPURPOSE_RESPONSE ACK chain ---');
    const acks = msgs.filter((m) => m.fn === 0x64);
    if (acks.length === 0) {
        console.log('  (no ACKs — every probe was either ignored at the framing layer or our capture missed them)');
    }
    for (const ack of acks) {
        const echoedFn = ack.bytes[6];
        const result = ack.bytes[7];
        const interpretation = result === 0x00 ? 'OK' : result === 0x05 ? 'parsed but not honored' : `result=0x${result.toString(16)}`;
        console.log(`  [${ack.index}] echoed_fn=0x${echoedFn.toString(16).padStart(2, '0')} result=0x${result.toString(16).padStart(2, '0')} (${interpretation})`);
    }

    // STATE_DUMP triples — these fire when the device's block state changes.
    console.log('\n--- 0x74/0x75/0x76 state-dump triples ---');
    const triples = msgs.filter((m) => m.fn === 0x74 || m.fn === 0x75 || m.fn === 0x76);
    if (triples.length === 0) {
        console.log('  (no state-dump triples — no block-param state changed; grid edits may not trigger this)');
    }
    for (const t of triples) {
        const payload = t.bytes.subarray(6, t.bytes.length - 2);
        if (t.fn === 0x74 && payload.length >= 5) {
            const targetLow = payload[0] & 0x7f;
            const targetHigh = payload[1] & 0x7f;
            const targetId = (targetHigh << 7) | targetLow;
            const countLow = payload[2] & 0x7f;
            const countHigh = payload[3] & 0x7f;
            const itemCount = (countHigh << 7) | countLow;
            console.log(`  [${t.index}] 0x74 header: target_id=${targetId} item_count=${itemCount} op_flag=0x${payload[4].toString(16).padStart(2, '0')}`);
        } else {
            console.log(`  [${t.index}] 0x${t.fn.toString(16)} payload (${payload.length}B): ${hex(payload).slice(0, 80)}`);
        }
    }

    // 0x2A PRESET_EDITED_STATUS — broadcasts when the device's preset becomes "dirty".
    console.log('\n--- 0x2A PRESET_EDITED_STATUS broadcasts ---');
    const editStatus = msgs.filter((m) => m.fn === 0x2A);
    for (const e of editStatus) {
        const payload = e.bytes.subarray(6, e.bytes.length - 2);
        console.log(`  [${e.index}] payload: ${hex(payload)}`);
    }

    // 0x0E PRESET_BLOCKS_DATA — broadcasts the new block list after grid edits.
    console.log('\n--- 0x0E PRESET_BLOCKS_DATA broadcasts ---');
    const blocksData = msgs.filter((m) => m.fn === 0x0E);
    for (const b of blocksData) {
        const payload = b.bytes.subarray(6, b.bytes.length - 2);
        console.log(`  [${b.index}] (${payload.length}B): ${hex(payload)}`);
    }

    // 0x20 GET_GRID_LAYOUT_AND_ROUTING — if the device broadcasts this, decode the cell descriptors.
    console.log('\n--- 0x20 GET_GRID_LAYOUT_AND_ROUTING (cell descriptors) ---');
    const layouts = msgs.filter((m) => m.fn === 0x20);
    for (const l of layouts) {
        const payload = l.bytes.subarray(6, l.bytes.length - 2);
        console.log(`  [${l.index}] (${payload.length}B):`);
        // Decode as 48 cells × 4 bytes, column-major (col 1 rows 1-4, col 2 rows 1-4, ...).
        if (payload.length === 192) {
            for (let cellIdx = 0; cellIdx < 48; cellIdx++) {
                const row = (cellIdx % 4) + 1;
                const col = Math.floor(cellIdx / 4) + 1;
                const c0 = payload[cellIdx * 4];
                const c1 = payload[cellIdx * 4 + 1];
                const c2 = payload[cellIdx * 4 + 2];
                const c3 = payload[cellIdx * 4 + 3];
                if (c0 === 0 && c1 === 0 && c2 === 0 && c3 === 0) continue; // skip empty cells
                console.log(`     cell ${cellIdx} (col ${col}, row ${row}): ${c0.toString(16).padStart(2, '0')} ${c1.toString(16).padStart(2, '0')} ${c2.toString(16).padStart(2, '0')} ${c3.toString(16).padStart(2, '0')}`);
            }
        }
    }
}

main();
