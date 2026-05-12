// find-axeedit-write-bytes.ts
//
// Cross-capture analysis: enumerate every function byte AxeEdit FIRES
// (host → device) by looking at the device's 0x64 MULTIPURPOSE_RESPONSE
// echoes across our passive-capture corpus. The 0x64 response format is
// `[echoed_fn, result_code]` — so every 0x64 in a capture tells us:
//   - AxeEdit (or something) sent function `echoed_fn` to the device
//   - The device's result for that send (0x00 OK, 0x05 parsed-but-not-honored)
//
// We can't see AxeEdit's outgoing payloads from passive capture, but
// we can enumerate the function bytes it uses. Combined with knowledge
// of what action was happening in each capture (block-add, grid-move,
// knob-turn, preset-change, startup-sync), we get a function-byte ↔
// editor-action correlation map.
//
// This narrows the probe-and-observe search space for grid-write decode
// dramatically: instead of guessing across 256 possible function bytes,
// we test the small set AxeEdit actually fires during grid edits.

import { readFileSync } from 'node:fs';

const CAPTURES = [
    { path: 'samples/captured/session-58-direct-sync.syx', action: 'startup-sync (read-only baseline)' },
    { path: 'samples/captured/session-58-preset-change.syx', action: 'front-panel preset switch (read-only edit-side)' },
    { path: 'samples/captured/session-58-knob-turn.syx', action: 'knob-turn via AxeEdit (param write)' },
    { path: 'samples/captured/session-58-grid-move.syx', action: 'block moved between grid cells (grid write)' },
    { path: 'samples/captured/session-58-block-add.syx', action: 'block added to empty grid cell (grid write)' },
    { path: 'samples/captured/session-61-save-attempt.syx', action: 'save-to-slot (already decoded — control)' },
];

interface Msg {
    fn: number;
    bytes: Buffer;
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
        if (slice.length >= 8 && slice[1] === 0x00 && slice[2] === 0x01 &&
            slice[3] === 0x74 && slice[4] === 0x07) {
            out.push({ fn: slice[5], bytes: Buffer.from(slice) });
        }
        i = j + 1;
    }
    return out;
}

const WIKI_DOCUMENTED: Record<number, string> = {
    0x01: 'EDITOR_STREAM (AM4 family — value/label broadcast during writes)',
    0x02: 'GET/SET_BLOCK_PARAMETER_VALUE',
    0x07: 'GET/SET_MODIFIER_VALUE',
    0x08: 'GET_FIRMWARE_VERSION',
    0x09: 'SET_PRESET_NAME',
    0x0D: 'TUNER_INFO (no checksum)',
    0x0E: 'PRESET_BLOCKS_DATA',
    0x0F: 'GET_PRESET_NAME',
    0x10: 'MIDI_TEMPO_BEAT (no checksum)',
    0x11: 'GET/SET_BLOCK_XY',
    0x12: 'GET_CAB_NAME / GET_ALL_CAB_NAMES',
    0x13: 'GET_CPU_USAGE',
    0x14: 'GET_PRESET_NUMBER',
    0x17: 'GET_MIDI_CHANNEL',
    0x1D: 'STORE_PRESET (save-to-location) — bspaulding-documented, 🟢',
    0x20: 'GET_GRID_LAYOUT_AND_ROUTING',
    0x21: 'FRONT_PANEL_CHANGE_DETECTED (response-only)',
    0x23: 'MIDI_LOOPER_STATUS',
    0x29: 'GET/SET_SCENE_NUMBER',
    0x2A: 'GET_PRESET_EDITED_STATUS',
    0x2E: 'SET_TYPED_BLOCK_PARAMETER_VALUE',
    0x32: 'BATCH_LIST_REQUEST_START',
    0x33: 'BATCH_LIST_REQUEST_COMPLETE',
    0x37: 'SET_TARGET_BLOCK',
    0x3C: 'SET_PRESET_NUMBER',
    0x42: 'DISCONNECT_FROM_CONTROLLER',
    0x64: 'MULTIPURPOSE_RESPONSE',
    0x74: 'STATE_DUMP_HEADER (decoded session-60)',
    0x75: 'STATE_DUMP_CHUNK (decoded session-60)',
    0x76: 'STATE_DUMP_FOOTER (decoded session-60)',
    0x77: 'PRESET_DUMP_HEADER',
    0x78: 'PRESET_DUMP_CHUNK',
    0x79: 'PRESET_DUMP_FOOTER',
};

interface CaptureRow {
    label: string;
    msgCount: number;
    /** All function bytes AxeEdit fired (extracted from 0x64 echo payloads). */
    firedFunctions: Map<number, number>; // fn → ack count
    /** All function bytes the device emitted (every fn byte in the file). */
    receivedFunctions: Map<number, number>;
}

function analyze(path: string, action: string): CaptureRow {
    const buf = readFileSync(path);
    const msgs = splitAxeFxMessages(buf);
    const firedFunctions = new Map<number, number>();
    const receivedFunctions = new Map<number, number>();
    for (const m of msgs) {
        receivedFunctions.set(m.fn, (receivedFunctions.get(m.fn) ?? 0) + 1);
        if (m.fn === 0x64 && m.bytes.length >= 10) {
            const echoedFn = m.bytes[6];
            firedFunctions.set(echoedFn, (firedFunctions.get(echoedFn) ?? 0) + 1);
        }
    }
    return { label: `${path.split('/').pop()} (${action})`, msgCount: msgs.length, firedFunctions, receivedFunctions };
}

function main() {
    const rows = CAPTURES.filter((c) => {
        try { readFileSync(c.path); return true; } catch { return false; }
    }).map((c) => analyze(c.path, c.action));

    console.log('\n=== Function bytes AxeEdit FIRED (from 0x64 ACK echoes) ===\n');
    for (const r of rows) {
        console.log(`📁 ${r.label}`);
        console.log(`   total messages: ${r.msgCount}`);
        if (r.firedFunctions.size === 0) {
            console.log(`   no 0x64 ACKs → AxeEdit silent in this capture (read-only or no write surface)`);
        } else {
            const fired = Array.from(r.firedFunctions.entries()).sort((a, b) => a[0] - b[0]);
            for (const [fn, n] of fired) {
                const doc = WIKI_DOCUMENTED[fn] ?? '🆕 UNDOCUMENTED — candidate write surface';
                console.log(`   0x${fn.toString(16).padStart(2, '0')} × ${n}  ${doc}`);
            }
        }
        console.log();
    }

    // Cross-capture: which function bytes appear ONLY in grid-write captures?
    console.log('\n=== Cross-capture comparison: function bytes correlated with grid writes ===\n');
    const gridCaptures = rows.filter((r) => r.label.includes('grid'));
    const nonGridCaptures = rows.filter((r) => !r.label.includes('grid') && !r.label.includes('knob') && !r.label.includes('save'));
    const writeOnlyFns = new Set<number>();
    for (const r of gridCaptures) {
        for (const fn of r.firedFunctions.keys()) {
            const inNonGrid = nonGridCaptures.some((nr) => nr.firedFunctions.has(fn));
            if (!inNonGrid) writeOnlyFns.add(fn);
        }
    }
    if (writeOnlyFns.size === 0) {
        console.log('(no function bytes fire exclusively during grid writes — they all appear in read-only captures too)');
    } else {
        for (const fn of Array.from(writeOnlyFns).sort((a, b) => a - b)) {
            const doc = WIKI_DOCUMENTED[fn] ?? '🆕 UNDOCUMENTED — strong candidate for grid-write surface';
            console.log(`  0x${fn.toString(16).padStart(2, '0')}  ${doc}`);
        }
    }

    // Undocumented function bytes anywhere in the corpus (potentially novel decode targets).
    console.log('\n=== All UNDOCUMENTED function bytes received from device (across all captures) ===\n');
    const allReceived = new Map<number, Map<string, number>>();
    for (const r of rows) {
        for (const [fn, n] of r.receivedFunctions.entries()) {
            if (WIKI_DOCUMENTED[fn]) continue;
            if (!allReceived.has(fn)) allReceived.set(fn, new Map());
            allReceived.get(fn)!.set(r.label.split(' ')[0], n);
        }
    }
    if (allReceived.size === 0) {
        console.log('(all received function bytes are wiki-documented)');
    } else {
        for (const fn of Array.from(allReceived.keys()).sort((a, b) => a - b)) {
            const perCapture = allReceived.get(fn)!;
            const total = Array.from(perCapture.values()).reduce((a, b) => a + b, 0);
            const captureList = Array.from(perCapture.entries()).map(([cap, n]) => `${cap}=${n}`).join(', ');
            console.log(`  0x${fn.toString(16).padStart(2, '0')} (total ${total} msgs)  appeared in: ${captureList}`);
        }
    }
}

main();
