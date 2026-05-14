// verify-axe-fx-ii-encoding.ts
//
// Byte-exact goldens for the Axe-Fx II family wire encoders.
// Sources:
//   - Fractal Audio Wiki §"obtaining parameter values" — 52421 example.
//   - Fractal Audio Wiki §"GET/SET_BLOCK_PARAMETER_VALUE" — message
//     layout for function 0x02.
//
// Run:
//   npx tsx scripts/verify-axe-fx-ii-encoding.ts
//
// Status: 🟡 wiki-spec verification only. Promotion to 🟢 waits on a
// live capture of Axe-Edit ↔ Axe-Fx II XL+ traffic at Quantum 8.02
// (HW-074) so we can compare byte-for-byte.

import {
    AXE_FX_II_XL_PLUS_MODEL_ID,
    buildGetBlockChannel,
    buildGetBlockParameterValue,
    buildGetGridLayout,
    buildGetPresetName,
    buildGetSceneNumber,
    buildSetBlockBypass,
    buildSetBlockChannel,
    buildSetBlockParameterValue,
    buildSetPresetName,
    buildSetSceneNumber,
    buildStateBroadcastTriple,
    buildStateBroadcastTripleMessages,
    buildGetPresetNumber,
    buildSetCellRouting,
    buildSetGridCell,
    buildStorePreset,
    buildSwitchPreset,
    displayToWire,
    isGetBlockChannelResponse,
    isGetBlockParameterResponse,
    isGetGridLayoutResponse,
    isGetPresetNameResponse,
    isGetPresetNumberResponse,
    isSceneNumberResponse,
    isSetCellRoutingResponse,
    isSetGridCellResponse,
    isStorePresetResponse,
    MODEL_IDS,
    packValue16,
    parseGetBlockChannelResponse,
    parseGetBlockParameterResponse,
    parseGetGridLayoutResponse,
    parseGetPresetNameResponse,
    parseGetPresetNumberResponse,
    parseSceneNumberResponse,
    parseSetCellRoutingResponse,
    parseSetGridCellResponse,
    parseStorePresetResponse,
    unpackValue16,
    wireToDisplay,
} from '@mcp-midi-control/axe-fx-ii/setParam.js';
import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
    if (!ok) {
        failures++;
        console.error(`  FAIL — ${label}${detail ? `: ${detail}` : ''}`);
    }
}

function eqBytes(actual: number[], expected: number[]): boolean {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) return false;
    return true;
}

function hex(bs: number[]): string {
    return bs.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// ── Value packing — wiki worked example ───────────────────────────────
//
// 52421 = 0xCCC5 = 1100 1100 1100 0101
//   bits 0-6  : 1000101  = 0x45
//   bits 7-13 : 0011001  = 0x19
//   bits 14-15: 11       = 0x03
//
// (The wiki labels these XX/YY/ZZ; the wire transmits XX first.)

{
    const [b0, b1, b2] = packValue16(52421);
    check('packValue16(52421) low septet', b0 === 0x45, `got 0x${b0.toString(16)}`);
    check('packValue16(52421) mid septet', b1 === 0x19, `got 0x${b1.toString(16)}`);
    check('packValue16(52421) hi septet',  b2 === 0x03, `got 0x${b2.toString(16)}`);

    const round = unpackValue16(b0, b1, b2);
    check('unpackValue16 round-trip 52421', round === 52421, `got ${round}`);
}

// ── Endpoints ─────────────────────────────────────────────────────────

{
    check('packValue16(0)',     eqBytes(packValue16(0),     [0x00, 0x00, 0x00]));
    check('packValue16(1)',     eqBytes(packValue16(1),     [0x01, 0x00, 0x00]));
    check('packValue16(127)',   eqBytes(packValue16(127),   [0x7f, 0x00, 0x00]));
    check('packValue16(128)',   eqBytes(packValue16(128),   [0x00, 0x01, 0x00]));
    check('packValue16(16383)', eqBytes(packValue16(16383), [0x7f, 0x7f, 0x00]));
    check('packValue16(16384)', eqBytes(packValue16(16384), [0x00, 0x00, 0x01]));
    check('packValue16(32767)', eqBytes(packValue16(32767), [0x7f, 0x7f, 0x01]));
    check('packValue16(65534)', eqBytes(packValue16(65534), [0x7e, 0x7f, 0x03]));
    check('packValue16(65535)', eqBytes(packValue16(65535), [0x7f, 0x7f, 0x03]));

    for (const v of [0, 1, 127, 128, 16383, 16384, 32767, 45871, 65534]) {
        const [a, b, c] = packValue16(v);
        check(`round-trip ${v}`, unpackValue16(a, b, c) === v, `got ${unpackValue16(a, b, c)}`);
    }
}

// Out-of-range rejection.
{
    let threw = false;
    try { packValue16(-1); } catch { threw = true; }
    check('packValue16 rejects negative', threw);

    threw = false;
    try { packValue16(0x10000); } catch { threw = true; }
    check('packValue16 rejects > 0xffff', threw);

    threw = false;
    try { packValue16(1.5); } catch { threw = true; }
    check('packValue16 rejects non-integer', threw);
}

// ── SET_BLOCK_PARAMETER_VALUE envelope ────────────────────────────────
//
// Construct manually: AMP 1 (effectId=106), INPUT DRIVE (paramId=1),
// value 32767 ("midway" on an unscaled knob), action 1 = set.
//
//   F0 00 01 74 07 02 [6a 00] [01 00] [7f 7f 01] [01] [cs] F7
//
// effectId 106 = 0x6a → encode14: [0x6a, 0x00]
// paramId  1   = 0x01 → encode14: [0x01, 0x00]
// value    32767 = 0x7fff → packValue16: [0x7f, 0x7f, 0x01]

{
    const expectedHead = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x02,
        0x6a, 0x00,
        0x01, 0x00,
        0x7f, 0x7f, 0x01,
        0x01,
    ];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];

    const built = buildSetBlockParameterValue(
        { effectId: 106, paramId: 1 },
        32767,
    );
    check(
        'buildSetBlockParameterValue(amp1, input_drive, 32767)',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// ── GET_BLOCK_PARAMETER_VALUE envelope ────────────────────────────────
//
// Per wiki, the value field carries zeros in a query message.
//
//   F0 00 01 74 07 02 [6a 00] [01 00] [00 00 00] [00] [cs] F7

{
    const expectedHead = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x02,
        0x6a, 0x00,
        0x01, 0x00,
        0x00, 0x00, 0x00,
        0x00,
    ];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];

    const built = buildGetBlockParameterValue({ effectId: 106, paramId: 1 });
    check(
        'buildGetBlockParameterValue(amp1, input_drive)',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// ── Block bypass via paramId=255 ──────────────────────────────────────
//
// "Send the value 0 to Engage, 1 to Bypass." — wiki §GET/SET_BLOCK_
// PARAMETER_VALUE. paramId=255 → encode14: [0x7f, 0x01].

{
    // Bypass = true → value 1
    const expectedHead = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x02,
        0x6a, 0x00,
        0x7f, 0x01,
        0x01, 0x00, 0x00,
        0x01,
    ];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];

    const built = buildSetBlockBypass(106, true);
    check(
        'buildSetBlockBypass(amp1, true)',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// ── Other variants honour modelId override ────────────────────────────
//
// AX8 has model byte 0x08 — confirm the modelId override path works.

{
    const built = buildSetBlockParameterValue(
        { effectId: 106, paramId: 1 },
        0,
        { modelId: 0x08 },
    );
    check(
        'buildSetBlockParameterValue honours modelId override',
        built[4] === 0x08,
        `got modelByte 0x${built[4].toString(16)}`,
    );
}

// XL+ default is 0x07.
check('AXE_FX_II_XL_PLUS_MODEL_ID === 0x07', AXE_FX_II_XL_PLUS_MODEL_ID === 0x07);

// ── GET_PRESET_NAME (function 0x0F) ───────────────────────────────────

{
    // Empty body — envelope + function + checksum + F7.
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x0f];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildGetPresetName();
    check(
        'buildGetPresetName',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Synthesize a GET_PRESET_NAME response for "Mark V Lead" + null + checksum + F7.
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x0f];
    const labelBytes = Array.from('Mark V Lead', (c) => c.charCodeAt(0));
    const body = [...head, ...labelBytes, 0x00];
    const cs = fractalChecksum(body);
    const synthetic = [...body, cs, 0xf7];

    check('isGetPresetNameResponse accepts synthesized "Mark V Lead"', isGetPresetNameResponse(synthetic));
    check(
        'parseGetPresetNameResponse decodes "Mark V Lead"',
        parseGetPresetNameResponse(synthetic) === 'Mark V Lead',
        `got "${parseGetPresetNameResponse(synthetic)}"`,
    );
}

// ── SET_SCENE_NUMBER + GET_SCENE_NUMBER (function 0x29) ───────────────

{
    // Switch to scene 3 (display: scene 4).
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x29, 0x03];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildSetSceneNumber(3);
    check(
        'buildSetSceneNumber(3)',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Range rejection.
{
    let threw = false;
    try { buildSetSceneNumber(8); } catch { threw = true; }
    check('buildSetSceneNumber rejects scene 8 (max is 7)', threw);

    threw = false;
    try { buildSetSceneNumber(-1); } catch { threw = true; }
    check('buildSetSceneNumber rejects negative scene', threw);
}

{
    // Get-current uses sentinel 0x7F per wiki.
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x29, 0x7f];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildGetSceneNumber();
    check(
        'buildGetSceneNumber (uses 0x7F sentinel)',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Synthesize a SCENE_NUMBER response (echo).
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x29, 0x05];
    const cs = fractalChecksum(head);
    const synthetic = [...head, cs, 0xf7];
    check('isSceneNumberResponse accepts synthesized scene-5', isSceneNumberResponse(synthetic));
    check(
        'parseSceneNumberResponse decodes scene 5',
        parseSceneNumberResponse(synthetic) === 5,
        `got ${parseSceneNumberResponse(synthetic)}`,
    );
}

// ── GET_GRID_LAYOUT_AND_ROUTING (function 0x20) ───────────────────────

{
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x20];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildGetGridLayout();
    check(
        'buildGetGridLayout',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Synthesize a GET_GRID_LAYOUT response: 48 cells × 4 bytes each = 192 body bytes.
// Place AMP 1 (id 106 = 0x6a) at (col=1,row=1) with no input mask, Reverb 1
// (id 110 = 0x6e) at (col=2,row=1) with mask 0x01 (connect from row 1 of
// previous column), and shunt 200 at (col=3,row=2). Rest = empty (id 0).
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x20];
    // Build cell payload per wiki ordering: column-major, top-to-bottom.
    // Cell index: 0 = (col=1,row=1), 1 = (col=1,row=2), 2 = (col=1,row=3),
    // 3 = (col=1,row=4), 4 = (col=2,row=1), ...
    const cells: Array<[number, number]> = []; // [blockId, routingFlags] per cell
    for (let i = 0; i < 48; i++) cells.push([0, 0]);
    cells[0]  = [106, 0x00]; // (col=1, row=1) AMP 1, no input
    cells[4]  = [110, 0x01]; // (col=2, row=1) Reverb 1, input from row 1
    cells[9]  = [200, 0x00]; // (col=3, row=2) Shunt
    const body: number[] = [];
    for (const [blockId, flags] of cells) {
        body.push(blockId & 0x7f, (blockId >> 7) & 0x7f, flags & 0x0f, 0x00);
    }
    const beforeCs = [...head, ...body];
    const cs = fractalChecksum(beforeCs);
    const synthetic = [...beforeCs, cs, 0xf7];

    check('isGetGridLayoutResponse accepts synthesized 48-cell payload', isGetGridLayoutResponse(synthetic));
    const parsed = parseGetGridLayoutResponse(synthetic);
    check('parseGetGridLayoutResponse returns 48 cells', parsed.length === 48, `got ${parsed.length}`);
    check('cell 0 = AMP 1 at (col=1, row=1)',
        parsed[0].blockId === 106 && parsed[0].col === 1 && parsed[0].row === 1,
        JSON.stringify(parsed[0]));
    check('cell 4 = Reverb 1 at (col=2, row=1) with mask 0x01',
        parsed[4].blockId === 110 && parsed[4].col === 2 && parsed[4].row === 1 && parsed[4].routingFlags === 0x01,
        JSON.stringify(parsed[4]));
    check('cell 9 = Shunt 200 at (col=3, row=2)',
        parsed[9].blockId === 200 && parsed[9].col === 3 && parsed[9].row === 2,
        JSON.stringify(parsed[9]));
    check('cell 47 = empty at (col=12, row=4)',
        parsed[47].blockId === 0 && parsed[47].col === 12 && parsed[47].row === 4,
        JSON.stringify(parsed[47]));
}

// ── GET_BLOCK_PARAMETER_VALUE response synthesis + parse ──────────────
//
// Synthesize: AMP 1 INPUT DRIVE returning 32767 with label "5.00".
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x02];
    const eff = [0x6a, 0x00];        // 106
    const param = [0x01, 0x00];      // 1
    const value = [0x7f, 0x7f, 0x01]; // 32767
    const unknown5 = [0x00, 0x00, 0x00, 0x00, 0x00];
    const labelBytes = Array.from('5.00', (c) => c.charCodeAt(0));
    const before = [...head, ...eff, ...param, ...value, ...unknown5, ...labelBytes, 0x00];
    const cs = fractalChecksum(before);
    const synthetic = [...before, cs, 0xf7];

    check('isGetBlockParameterResponse matches AMP 1 INPUT DRIVE',
        isGetBlockParameterResponse(synthetic, { effectId: 106, paramId: 1 }));
    check('isGetBlockParameterResponse rejects different paramId',
        !isGetBlockParameterResponse(synthetic, { effectId: 106, paramId: 2 }));
    check('isGetBlockParameterResponse rejects different effectId',
        !isGetBlockParameterResponse(synthetic, { effectId: 107, paramId: 1 }));

    const parsed = parseGetBlockParameterResponse(synthetic);
    check('parseGetBlockParameterResponse value === 32767',
        parsed.value === 32767, `got ${parsed.value}`);
    check('parseGetBlockParameterResponse label === "5.00"',
        parsed.label === '5.00', `got "${parsed.label}"`);
}

// ── STATE BROADCAST TRIPLE (functions 0x74/0x75/0x76) ─────────────────
//
// Byte-exact golden against the Volume/Pan 1 triple captured passively
// from the Axe-Fx II XL+ via `scripts/capture-midi-passive.ts` in
// `samples/captured/session-58-block-add.syx`. The capture is gitignored;
// the canonical wire bytes are inlined here so the test runs offline.
//
// target_id = 127 (Volume/Pan 1)
// item_count = 9
// op_flag = 0x00 (preset-structure change — block add)
// values = [65534, 32767, 2, 0, 0, 65534, 52427, 0, 0]
//
// Cross-decoded with `scripts/decode-axefx2-chunk.ts` Session 60.

{
    const expectedHeader = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x74,
        0x7f, 0x00,   // target_id = 127
        0x09, 0x00,   // item_count = 9
        0x00,         // op_flag = 0x00
        0x00,         // checksum
        0xf7,
    ];
    const expectedChunk = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x75,
        0x09, 0x00,   // chunk item count = 9
        // 9 × packValue16: [65534, 32767, 2, 0, 0, 65534, 52427, 0, 0]
        0x7e, 0x7f, 0x03,
        0x7f, 0x7f, 0x01,
        0x02, 0x00, 0x00,
        0x00, 0x00, 0x00,
        0x00, 0x00, 0x00,
        0x7e, 0x7f, 0x03,
        0x4b, 0x19, 0x03,
        0x00, 0x00, 0x00,
        0x00, 0x00, 0x00,
        0x2c,         // checksum
        0xf7,
    ];
    const expectedFooter = [
        0xf0, 0x00, 0x01, 0x74, 0x07, 0x76,
        0x74,         // checksum
        0xf7,
    ];
    const expectedFlat = [...expectedHeader, ...expectedChunk, ...expectedFooter];

    const built = buildStateBroadcastTripleMessages(
        127,
        [65534, 32767, 2, 0, 0, 65534, 52427, 0, 0],
        { opFlag: 0x00 },
    );
    check('state broadcast header matches captured Volume/Pan 1 triple',
        eqBytes(built.header, expectedHeader),
        `got [${hex(built.header)}], expected [${hex(expectedHeader)}]`);
    check('state broadcast chunk matches captured Volume/Pan 1 triple',
        built.chunks.length === 1 && eqBytes(built.chunks[0], expectedChunk),
        `got [${hex(built.chunks[0] ?? [])}], expected [${hex(expectedChunk)}]`);
    check('state broadcast footer matches captured Volume/Pan 1 triple',
        eqBytes(built.footer, expectedFooter),
        `got [${hex(built.footer)}], expected [${hex(expectedFooter)}]`);

    const flat = buildStateBroadcastTriple(
        127,
        [65534, 32767, 2, 0, 0, 65534, 52427, 0, 0],
        { opFlag: 0x00 },
    );
    check('buildStateBroadcastTriple flat output round-trips Volume/Pan 1 capture',
        eqBytes(flat, expectedFlat),
        `length got=${flat.length} expected=${expectedFlat.length}`);
}

// Chunk splitting at 64-item boundary: an 80-value payload should
// produce two chunks (64 + 16) matching the AMP 1 / Delay 1 capture
// chunk-size pattern.
{
    const values = Array.from({ length: 80 }, (_, i) => i);
    const built = buildStateBroadcastTripleMessages(106, values);
    check('80-value payload produces 2 chunks',
        built.chunks.length === 2,
        `got ${built.chunks.length} chunks`);

    // First chunk: 1 (F0) + 3 (mfr) + 1 (model) + 1 (fn) + 2 (count) + 64*3 (payload) + 1 (cs) + 1 (F7) = 202
    check('first chunk length = 202 (64 items)',
        built.chunks[0].length === 202,
        `got ${built.chunks[0].length}`);
    // Second chunk: 8 (envelope) + 16*3 (payload) + 2 (cs + F7) = 58
    check('second chunk length = 58 (16 items)',
        built.chunks[1].length === 58,
        `got ${built.chunks[1].length}`);

    // Header pre-announces the FULL item count (80), not per-chunk.
    // bytes[8..9] in the header = item_count 14-bit septet.
    const itemCount = (built.header[8] & 0x7f) | ((built.header[9] & 0x7f) << 7);
    check('header item_count = 80 (full payload)',
        itemCount === 80,
        `got ${itemCount}`);
}

// 140-value Delay 1 capture had chunk sizes [64, 64, 12]. Confirm
// our splitter produces the same shape.
{
    const values = Array.from({ length: 140 }, () => 0);
    const built = buildStateBroadcastTripleMessages(112, values);
    check('140-value payload produces 3 chunks',
        built.chunks.length === 3,
        `got ${built.chunks.length} chunks`);
    // Per-chunk item-count encoded at bytes[6..7].
    const chunkCounts = built.chunks.map((c) => (c[6] & 0x7f) | ((c[7] & 0x7f) << 7));
    check('chunk counts = [64, 64, 12]',
        chunkCounts.length === 3 && chunkCounts[0] === 64 && chunkCounts[1] === 64 && chunkCounts[2] === 12,
        `got [${chunkCounts.join(', ')}]`);
}

// 236-value AMP 1 capture had chunk sizes [64, 64, 64, 44].
{
    const values = Array.from({ length: 236 }, () => 0);
    const built = buildStateBroadcastTripleMessages(106, values);
    const chunkCounts = built.chunks.map((c) => (c[6] & 0x7f) | ((c[7] & 0x7f) << 7));
    check('236-value AMP 1 chunk counts = [64, 64, 64, 44]',
        chunkCounts.length === 4 && chunkCounts[0] === 64 && chunkCounts[1] === 64 && chunkCounts[2] === 64 && chunkCounts[3] === 44,
        `got [${chunkCounts.join(', ')}]`);
}

// Out-of-range target_id rejection.
{
    let threw = false;
    try { buildStateBroadcastTriple(-1, []); } catch { threw = true; }
    check('buildStateBroadcastTriple rejects negative targetId', threw);

    threw = false;
    try { buildStateBroadcastTriple(0x4000, []); } catch { threw = true; }
    check('buildStateBroadcastTriple rejects targetId > 14b', threw);
}

// ── displayToWire / wireToDisplay — HW-079 calibration goldens ────────
//
// Hardware sweep on Q8.02 (2026-05-11) confirmed wire 0..65534 ↔ display
// 0.00..10.00 linear for AMP first-page knobs, with quarter-scale anchors
// landing exactly at 2.50 / 5.00 / 7.50 / 10.00. These goldens lock the
// conversion: a regression in displayToWire would break every display-
// first axefx2_set_param call.

{
    const cal = { displayMin: 0, displayMax: 10 };

    // Endpoints + quarter-scale anchors.
    check('displayToWire(0)     === 0',     displayToWire(0, cal)     === 0);
    check('displayToWire(2.5)   === 16384', displayToWire(2.5, cal)   === 16384);
    check('displayToWire(5)     === 32767', displayToWire(5, cal)     === 32767);
    check('displayToWire(7.5)   === 49151', displayToWire(7.5, cal)   === 49151);
    check('displayToWire(10)    === 65534', displayToWire(10, cal)    === 65534);

    // Round-trip via wireToDisplay should recover anchors exactly.
    check('wireToDisplay(0)     === 0',     wireToDisplay(0, cal)     === 0);
    check('wireToDisplay(32767) ≈ 5',       Math.abs(wireToDisplay(32767, cal) - 5) < 0.001);
    check('wireToDisplay(65534) === 10',    wireToDisplay(65534, cal) === 10);

    // Clamping: out-of-range display values pin to endpoints.
    check('displayToWire(-1)    clamps to 0',     displayToWire(-1, cal)    === 0);
    check('displayToWire(11)    clamps to 65534', displayToWire(11, cal)    === 65534);
    check('displayToWire(100)   clamps to 65534', displayToWire(100, cal)   === 65534);

    // HW-090 log10 anchors — Cab 1 low_cut (20..2000 Hz log10).
    const lowCut = { displayMin: 20, displayMax: 2000, displayScale: 'log10' as const };
    check('log10 displayToWire(20)   === 0',     displayToWire(20, lowCut)   === 0);
    check('log10 displayToWire(200)  === 32767', displayToWire(200, lowCut)  === 32767);
    check('log10 displayToWire(2000) === 65534', displayToWire(2000, lowCut) === 65534);
    // Quarter-decade anchors at the measured wire values.
    check('log10 displayToWire(63.245…) ≈ 16384', Math.abs(displayToWire(63.245553203367585, lowCut) - 16384) <= 1);
    check('log10 displayToWire(632.45…) ≈ 49151', Math.abs(displayToWire(632.4555320336758, lowCut) - 49151) <= 1);

    // log10 wireToDisplay round-trip — should recover the measured Hz values.
    check('log10 wireToDisplay(0)     === 20',    wireToDisplay(0, lowCut)     === 20);
    check('log10 wireToDisplay(32767) ≈ 200',     Math.abs(wireToDisplay(32767, lowCut) - 200) < 0.01);
    check('log10 wireToDisplay(65534) === 2000',  wireToDisplay(65534, lowCut) === 2000);

    // log10 rejects non-positive displayMin (would yield log10(0) = -∞).
    let threwLog = false;
    try { displayToWire(5, { displayMin: 0, displayMax: 100, displayScale: 'log10' }); } catch { threwLog = true; }
    check('log10 displayToWire rejects displayMin = 0', threwLog);

    threwLog = false;
    try { displayToWire(5, { displayMin: -10, displayMax: 100, displayScale: 'log10' }); } catch { threwLog = true; }
    check('log10 displayToWire rejects negative displayMin', threwLog);

    // Linear is still the default when displayScale is omitted.
    check('linear is default when displayScale omitted',
        displayToWire(5, { displayMin: 0, displayMax: 10 }) === 32767);

    // Non-zero displayMin (covers future params like pan -100..+100).
    const pan = { displayMin: -100, displayMax: 100 };
    check('displayToWire(-100) on pan === 0',         displayToWire(-100, pan) === 0);
    check('displayToWire(0)    on pan === 32767',     displayToWire(0, pan)    === 32767);
    check('displayToWire(100)  on pan === 65534',     displayToWire(100, pan)  === 65534);

    // Errors: invalid display values rejected.
    let threw = false;
    try { displayToWire(Number.NaN, cal); } catch { threw = true; }
    check('displayToWire rejects NaN', threw);

    threw = false;
    try { displayToWire(5, { displayMin: 10, displayMax: 10 }); } catch { threw = true; }
    check('displayToWire rejects displayMin === displayMax', threw);

    threw = false;
    try { wireToDisplay(-1, cal); } catch { threw = true; }
    check('wireToDisplay rejects wire -1', threw);

    threw = false;
    try { wireToDisplay(65535, cal); } catch { threw = true; }
    check('wireToDisplay rejects wire 65535', threw);
}

// ── SET/GET BLOCK CHANNEL (function 0x11) — HW-097 cross-confirmed ────
//
// Byte-exact golden against the passive-capture broadcast pattern
// observed in samples/captured/session-60-channel-toggle.syx (HW-097,
// 2026-05-11): AxeEdit channel toggle X→Y on Amp 1 produced
// `F0 00 01 74 07 11 6A 00 01 78 F7`; Y→X produced
// `F0 00 01 74 07 11 6A 00 00 79 F7`. Wiki documents the same envelope.

{
    // Get-form request (action byte = 0): 11 bytes.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x11, 0x6a, 0x00, 0x00, 0x00];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildGetBlockChannel(106);
        check(
            'buildGetBlockChannel(amp1) envelope',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Set-form request channel X = 0, action = 1.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x11, 0x6a, 0x00, 0x00, 0x01];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSetBlockChannel(106, 'X');
        check(
            'buildSetBlockChannel(amp1, X) envelope',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Set-form request channel Y = 1, action = 1.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x11, 0x6a, 0x00, 0x01, 0x01];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSetBlockChannel(106, 'Y');
        check(
            'buildSetBlockChannel(amp1, Y) envelope',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Accept numeric channel 0/1 in addition to 'X'/'Y'.
    check('buildSetBlockChannel accepts 0 as X',
        eqBytes(buildSetBlockChannel(106, 0), buildSetBlockChannel(106, 'X')));
    check('buildSetBlockChannel accepts 1 as Y',
        eqBytes(buildSetBlockChannel(106, 1), buildSetBlockChannel(106, 'Y')));

    // Response form recognized + parsed correctly.
    const captureXtoY: number[] = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x11, 0x6a, 0x00, 0x01, 0x78, 0xf7];
    const captureYtoX: number[] = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x11, 0x6a, 0x00, 0x00, 0x79, 0xf7];
    check('isGetBlockChannelResponse accepts X→Y capture for amp1',
        isGetBlockChannelResponse(captureXtoY, 106));
    check('isGetBlockChannelResponse accepts Y→X capture for amp1',
        isGetBlockChannelResponse(captureYtoX, 106));
    check('isGetBlockChannelResponse rejects mismatched effectId',
        !isGetBlockChannelResponse(captureXtoY, 107));
    check('parseGetBlockChannelResponse(X→Y) === Y',
        parseGetBlockChannelResponse(captureXtoY) === 'Y',
        `got "${parseGetBlockChannelResponse(captureXtoY)}"`);
    check('parseGetBlockChannelResponse(Y→X) === X',
        parseGetBlockChannelResponse(captureYtoX) === 'X',
        `got "${parseGetBlockChannelResponse(captureYtoX)}"`);
}

// ── SWITCH_PRESET (function 0x3C) — MSB-first (HW-103 closed Session 68) ──
//
// Wiki documents LSB-first ordering for this envelope, but Q8.02
// hardware testing showed switch_preset silently fails for any wire
// preset >= 128 with LSB-first encoding. Flipped to MSB-first to match
// STORE_PRESET (0x1D) and the device's own GET_PRESET_NUMBER (0x14)
// response — both of which are MSB-first AND hardware-verified.

{
    // Preset 0 — encodes identically in both orderings.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x3c, 0x00, 0x00];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSwitchPreset(0);
        check(
            'buildSwitchPreset(0) envelope',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Preset 128 — exercises the 14-bit septet pair boundary. MSB-first:
    // high byte = 1, low byte = 0.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x3c, 0x01, 0x00];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSwitchPreset(128);
        check(
            'buildSwitchPreset(128) MSB-first envelope (HW-103)',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Preset 699 (display slot 700) — the slot the founder used for
    // HW-105 testing. MSB-first: high=5 (699>>7), low=59 (699&0x7f).
    // Should match the byte layout STORE_PRESET uses for the same slot.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x3c, 0x05, 0x3b];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSwitchPreset(699);
        check(
            'buildSwitchPreset(699 = display slot 700) MSB-first envelope',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Range rejection.
    let threwPreset = false;
    try { buildSwitchPreset(-1); } catch { threwPreset = true; }
    check('buildSwitchPreset rejects -1', threwPreset);

    threwPreset = false;
    try { buildSwitchPreset(16384); } catch { threwPreset = true; }
    check('buildSwitchPreset rejects 16384 (> 14-bit)', threwPreset);
}

// ── SET_PRESET_NAME (function 0x09) — wiki-documented ─────────────────

{
    // 32-char preset name, ASCII bytes + space-padded.
    const name = 'Vox Light';
    const padded = name.padEnd(32, ' ');
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x09, ...Array.from(padded, (c) => c.charCodeAt(0))];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildSetPresetName(name);
    check(
        'buildSetPresetName("Vox Light") envelope',
        eqBytes(built, expected),
        `got length ${built.length}, expected ${expected.length}`,
    );

    // Exactly 32 chars — no padding needed.
    const long = 'A'.repeat(32);
    const builtLong = buildSetPresetName(long);
    // 8 envelope overhead + 32 name bytes = 40 bytes total.
    check('buildSetPresetName(32-char name) total length = 40',
        builtLong.length === 40, `got ${builtLong.length}`);

    // Range rejection.
    let threwName = false;
    try { buildSetPresetName('A'.repeat(33)); } catch { threwName = true; }
    check('buildSetPresetName rejects 33-char name', threwName);

    threwName = false;
    try { buildSetPresetName('hello\x00world'); } catch { threwName = true; }
    check('buildSetPresetName rejects null byte', threwName);

    threwName = false;
    try { buildSetPresetName('hello\nworld'); } catch { threwName = true; }
    check('buildSetPresetName rejects newline', threwName);

    threwName = false;
    try { buildSetPresetName('héllo'); } catch { threwName = true; }
    check('buildSetPresetName rejects non-ASCII (é)', threwName);
}

// ── STORE_PRESET (function 0x1D) — bspaulding + session-61 capture ────

{
    // bspaulding/axe-fx-midi (Rust) byte-exact test case for original
    // Axe-Fx II (model 0x03), preset 217. Locked verbatim so any
    // refactor that breaks the MSB-first ordering or checksum trips the
    // goldens immediately.
    //
    // 217 → high=(217>>7)=1, low=(217&0x7F)=0x59. Wire: [1D 01 59 43].
    {
        const expected = [0xf0, 0x00, 0x01, 0x74, 0x03, 0x1d, 0x01, 0x59, 0x43, 0xf7];
        const built = buildStorePreset(217, { modelId: MODEL_IDS['axe-fx-ii'] });
        check(
            'buildStorePreset(217) Mark II matches bspaulding test case',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // XL+ (model 0x07), preset 699 — disambiguates MSB- vs LSB-first
    // ordering. 699 → high=5, low=0x3B. Paired with the captured
    // session-61 0x14 GET_PRESET_NUMBER response whose payload (`05 3B`)
    // only decodes to preset 699 under MSB-first ordering, matching
    // the founder's reported save target (front-panel display 700,
    // wire 699 per HW-100's 0-vs-1-indexing finding).
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x1d, 0x05, 0x3b];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildStorePreset(699);
        check(
            'buildStorePreset(699) XL+ envelope (matches session-61 captured slot)',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
        // cs derivation locked separately so a mis-renamed checksum
        // helper doesn't silently produce wrong bytes here.
        check(
            'buildStorePreset(699) XL+ checksum byte = 0x21',
            cs === 0x21,
            `got 0x${cs.toString(16)}`,
        );
    }

    // Range rejection — same shape as buildSwitchPreset.
    let threwStore = false;
    try { buildStorePreset(-1); } catch { threwStore = true; }
    check('buildStorePreset rejects -1', threwStore);

    threwStore = false;
    try { buildStorePreset(16384); } catch { threwStore = true; }
    check('buildStorePreset rejects 16384 (> 14-bit)', threwStore);

    // MULTIPURPOSE_RESPONSE matcher — captured session-61 ACK pattern.
    // Device-side: F0 00 01 74 07 64 1D 00 7B F7  (result=0x00 OK).
    {
        const captured = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x1d, 0x00, 0x7b, 0xf7];
        check(
            'isStorePresetResponse matches captured session-61 ACK',
            isStorePresetResponse(captured),
        );
        const parsed = parseStorePresetResponse(captured);
        check(
            'parseStorePresetResponse captured ACK → resultCode=0 ok=true',
            parsed.resultCode === 0x00 && parsed.ok === true,
            `got resultCode=0x${parsed.resultCode.toString(16)} ok=${parsed.ok}`,
        );
    }

    // Reject non-0x1D MULTIPURPOSE_RESPONSE — guards against the matcher
    // incorrectly hooking onto an unrelated 0x64 ack (e.g. 0x3C echo).
    {
        const otherAck = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x3c, 0x00, 0x5a, 0xf7];
        check(
            'isStorePresetResponse rejects 0x64 echo of 0x3C',
            !isStorePresetResponse(otherAck),
        );
    }
}

// ── GET_PRESET_NUMBER (function 0x14) — wiki + session-61 capture ─────

{
    // Bare-envelope request. Wiki shape: F0 00 01 74 07 14 [cs] F7.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x14];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildGetPresetNumber();
        check(
            'buildGetPresetNumber bare-envelope request',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Captured session-61 response: payload `05 3B`, MSB-first → preset 699.
    {
        const captured = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x14, 0x05, 0x3b, 0x28, 0xf7];
        check(
            'isGetPresetNumberResponse matches captured session-61 payload',
            isGetPresetNumberResponse(captured),
        );
        const parsed = parseGetPresetNumberResponse(captured);
        check(
            'parseGetPresetNumberResponse session-61 payload → wire 699 / display 700',
            parsed.presetNumber === 699 && parsed.displaySlot === 700,
            `got wire=${parsed.presetNumber} display=${parsed.displaySlot}`,
        );
    }

    // Reject the request echo (no payload) — guards against the matcher
    // incorrectly hooking onto our own outgoing request.
    {
        const requestEcho = buildGetPresetNumber();
        check(
            'isGetPresetNumberResponse rejects bare-envelope request echo',
            !isGetPresetNumberResponse(requestEcho),
        );
    }
}

// ── SET_GRID_CELL (function 0x05) — session-62/63 probe sequence ──────

{
    // Probe T1 (session-62): place CPR1 (blockId 100) at cell 0 = R1C1.
    // Hardware-observed: CPR1 appeared at R1C1 ✓
    {
        const expected = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x05, 0x64, 0x00, 0x00, 0x00, 0x63, 0xf7];
        const built = buildSetGridCell({ row: 1, col: 1, blockId: 100 });
        check(
            'buildSetGridCell CPR1 at R1C1 matches session-62 probe T1',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Probe T3 (session-63): clear cell 1 = R2C1.
    // Hardware-observed: CPR1 cleared from R2C1 ✓
    //
    // Note: the original probe T3 used byte[3]=0x02 (giving cs=0x04). Our
    // encoder hardcodes byte[3]=0x00 (giving cs=0x06) — both should
    // trigger the same device behavior (clear R2C1) because byte[3]
    // appears not to affect cell selection. The golden below locks our
    // encoder's deterministic output, NOT the original probe bytes.
    {
        const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x05, 0x00, 0x00, 0x01, 0x00];
        const cs = fractalChecksum(expectedHead);
        const expected = [...expectedHead, cs, 0xf7];
        const built = buildSetGridCell({ row: 2, col: 1, blockId: 0 });
        check(
            'buildSetGridCell clear at R2C1 — block_id bytes are zero, cell_idx is 0x01',
            built[6] === 0x00 && built[7] === 0x00 && built[8] === 0x01,
            `got block bytes [${built[6]?.toString(16)}, ${built[7]?.toString(16)}], cell_idx ${built[8]?.toString(16)}`,
        );
        check(
            'buildSetGridCell clear at R2C1 — full envelope checksum derives correctly',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Probe T4 (session-63): place CPR1 at cell 1 = R2C1.
    // Hardware-observed: CPR1 returned to R2C1 ✓
    {
        const expected = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x05, 0x64, 0x00, 0x01, 0x00, 0x62, 0xf7];
        const built = buildSetGridCell({ row: 2, col: 1, blockId: 100 });
        check(
            'buildSetGridCell CPR1 at R2C1 matches session-63 probe T4',
            eqBytes(built, expected),
            `got [${hex(built)}], expected [${hex(expected)}]`,
        );
    }

    // Boundary: cell at row 4, col 12 = cell index 47 = 0x2F.
    {
        const built = buildSetGridCell({ row: 4, col: 12, blockId: 100 });
        check(
            'buildSetGridCell row=4 col=12 → cell index 47',
            built[8] === 0x2f,
            `got cell_idx 0x${built[8]?.toString(16)}, expected 0x2f`,
        );
    }

    // Shunt placement (block ID 200): block ID > 127, requires the high
    // septet to be set correctly. 200 = (0x01 << 7) | 0x48.
    {
        const built = buildSetGridCell({ row: 2, col: 3, blockId: 200 });
        check(
            'buildSetGridCell Shunt at R2C3 — 14-bit block ID LSB-first',
            built[6] === 0x48 && built[7] === 0x01,
            `got [${built[6]?.toString(16)}, ${built[7]?.toString(16)}], expected [0x48, 0x01]`,
        );
    }

    // Range rejection.
    let threw = false;
    try { buildSetGridCell({ row: 0, col: 1, blockId: 100 }); } catch { threw = true; }
    check('buildSetGridCell rejects row=0', threw);

    threw = false;
    try { buildSetGridCell({ row: 5, col: 1, blockId: 100 }); } catch { threw = true; }
    check('buildSetGridCell rejects row=5', threw);

    threw = false;
    try { buildSetGridCell({ row: 1, col: 0, blockId: 100 }); } catch { threw = true; }
    check('buildSetGridCell rejects col=0', threw);

    threw = false;
    try { buildSetGridCell({ row: 1, col: 13, blockId: 100 }); } catch { threw = true; }
    check('buildSetGridCell rejects col=13', threw);

    threw = false;
    try { buildSetGridCell({ row: 1, col: 1, blockId: 16384 }); } catch { threw = true; }
    check('buildSetGridCell rejects blockId > 14-bit', threw);

    // MULTIPURPOSE_RESPONSE matcher — captured session-63 ACK pattern.
    // Device ACK for the CPR1 restore probe: F0 00 01 74 07 64 05 00 ?? F7
    {
        const captured = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x05, 0x00, 0x63, 0xf7];
        check(
            'isSetGridCellResponse matches captured session-63 OK ACK',
            isSetGridCellResponse(captured),
        );
        const parsed = parseSetGridCellResponse(captured);
        check(
            'parseSetGridCellResponse OK ACK → resultCode=0 ok=true',
            parsed.resultCode === 0x00 && parsed.ok === true,
        );
    }

    // Captured NACK from session-62 — bare envelope rejected with 0x06.
    {
        const captured = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x05, 0x06, 0x65, 0xf7];
        check(
            'isSetGridCellResponse matches captured NACK shape',
            isSetGridCellResponse(captured),
        );
        const parsed = parseSetGridCellResponse(captured);
        check(
            'parseSetGridCellResponse NACK → resultCode=0x06 ok=false',
            parsed.resultCode === 0x06 && parsed.ok === false,
        );
    }
}

// ── SET_CELL_ROUTING (function 0x06) — Session 70 hardware decode ─────
//
// Captured AxeEdit's outbound fn 0x06 from a single click-to-connect
// of Amp(R2C2) → Cab(R2C3) in `samples/captured/session-69-click-
// connect-ctrl.syx`. Replayed by `scripts/verify-axefx2-routing-write.ts`
// against Q8.02 XL+: device acked 0x00 OK and the grid-state read
// confirmed Cab's routing mask flipped 0x00 → 0x02 ("Cab now feeds
// from row 2 of prev col = from Amp").
//
// Payload:
//   src_cell = 5  = (col-1)*4 + (row-1) = (2-1)*4 + (2-1) = R2C2
//   dst_cell = 9  = (3-1)*4 + (2-1)                      = R2C3
//   connect  = 1  = add cable
//
// Checksum: XOR(F0, 00, 01, 74, 07, 06, 05, 09, 01) & 0x7F = 0x09.

{
    const expected = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x06, 0x05, 0x09, 0x01, 0x09, 0xf7];
    const built = buildSetCellRouting({ srcRow: 2, srcCol: 2, dstRow: 2, dstCol: 3, connect: true });
    check(
        'buildSetCellRouting Amp(R2C2)→Cab(R2C3) matches captured AxeEdit click',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Disconnect variant — same shape, byte 8 flips to 0x00.
{
    const expectedHead = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x06, 0x05, 0x09, 0x00];
    const cs = fractalChecksum(expectedHead);
    const expected = [...expectedHead, cs, 0xf7];
    const built = buildSetCellRouting({ srcRow: 2, srcCol: 2, dstRow: 2, dstCol: 3, connect: false });
    check(
        'buildSetCellRouting connect=false produces remove-cable byte (0x00) and recomputed cs',
        eqBytes(built, expected),
        `got [${hex(built)}], expected [${hex(expected)}]`,
    );
}

// Cross-row cable (parallel-path wiring): row 1 col 5 → row 3 col 6.
//   src_cell = (5-1)*4 + (1-1) = 16 = 0x10
//   dst_cell = (6-1)*4 + (3-1) = 22 = 0x16
{
    const built = buildSetCellRouting({ srcRow: 1, srcCol: 5, dstRow: 3, dstCol: 6 });
    check(
        'buildSetCellRouting cross-row cable encodes both cell indices correctly',
        built[6] === 0x10 && built[7] === 0x16 && built[8] === 0x01,
        `got src=0x${built[6]?.toString(16)} dst=0x${built[7]?.toString(16)} connect=0x${built[8]?.toString(16)}, ` +
        `expected src=0x10 dst=0x16 connect=0x01`,
    );
}

// Default connect=true.
{
    const builtDefault = buildSetCellRouting({ srcRow: 2, srcCol: 1, dstRow: 2, dstCol: 2 });
    check(
        'buildSetCellRouting defaults connect to true (0x01)',
        builtDefault[8] === 0x01,
    );
}

// Adjacency validation.
{
    let threw = false;
    try { buildSetCellRouting({ srcRow: 2, srcCol: 2, dstRow: 2, dstCol: 4 }); } catch { threw = true; }
    check('buildSetCellRouting rejects non-adjacent columns (src+2)', threw);

    threw = false;
    try { buildSetCellRouting({ srcRow: 2, srcCol: 3, dstRow: 2, dstCol: 2 }); } catch { threw = true; }
    check('buildSetCellRouting rejects backward cable (dst before src)', threw);

    threw = false;
    try { buildSetCellRouting({ srcRow: 0, srcCol: 1, dstRow: 1, dstCol: 2 }); } catch { threw = true; }
    check('buildSetCellRouting rejects srcRow=0', threw);

    threw = false;
    try { buildSetCellRouting({ srcRow: 1, srcCol: 12, dstRow: 1, dstCol: 13 }); } catch { threw = true; }
    check('buildSetCellRouting rejects dstCol=13', threw);

    threw = false;
    try { buildSetCellRouting({ srcRow: 1, srcCol: 1, dstRow: 5, dstCol: 2 }); } catch { threw = true; }
    check('buildSetCellRouting rejects dstRow=5', threw);
}

// MULTIPURPOSE_RESPONSE matcher — OK ACK shape from Q8.02 captures.
// F0 00 01 74 07 64 06 00 [cs] F7  where cs = XOR of preceding bytes & 0x7F.
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x06, 0x00];
    const captured = [...head, fractalChecksum(head), 0xf7];
    check(
        'isSetCellRoutingResponse matches Q8.02 OK ACK shape',
        isSetCellRoutingResponse(captured),
    );
    const parsed = parseSetCellRoutingResponse(captured);
    check(
        'parseSetCellRoutingResponse OK ACK → resultCode=0 ok=true',
        parsed.resultCode === 0x00 && parsed.ok === true,
    );
}

// NACK shape — result code 0x01 ("args/shape unknown").
{
    const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x64, 0x06, 0x01];
    const captured = [...head, fractalChecksum(head), 0xf7];
    check(
        'isSetCellRoutingResponse matches NACK shape',
        isSetCellRoutingResponse(captured),
    );
    const parsed = parseSetCellRoutingResponse(captured);
    check(
        'parseSetCellRoutingResponse NACK → resultCode=0x01 ok=false',
        parsed.resultCode === 0x01 && parsed.ok === false,
    );
}

// ── Report ────────────────────────────────────────────────────────────

if (failures === 0) {
    // Silent success matches the convention the other verify scripts
    // follow (they only print on failure).
    process.exit(0);
}
console.error(`\nverify-axe-fx-ii-encoding: ${failures} failure(s).`);
process.exit(1);
