/**
 * Axe-Fx II family GET/SET_BLOCK_PARAMETER_VALUE message builders.
 *
 * Reference: Fractal Audio Wiki "MIDI_SysEx" page (cached at
 * `docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html`), §"GET/SET_
 * BLOCK_PARAMETER_VALUE" + §"obtaining parameter values".
 *
 * Wire envelope (function ID `0x02`):
 *
 *   F0 00 01 74 [model] 02
 *     [effectId  bits 6-0] [effectId  bits 13-7]
 *     [paramId   bits 6-0] [paramId   bits 13-7]
 *     [value     bits 6-0] [value     bits 13-7] [value bits 14-15]
 *     [00=query, 01=set]
 *     [checksum] F7
 *
 * Value range: 0..65534 (16-bit). Packed across three 7-bit septets
 * because SysEx bytes can't have bit 7 set. The high 2 bits of the
 * 16-bit value land in the bottom 2 bits of the third septet (bits
 * 6..2 of that byte are zero).
 *
 * Status: 🟢 hardware-verified on Quantum 8.02 (2026-05-10). HW-075
 * landed both halves of function 0x02 SET: normal paramId (Amp 1 Bass
 * 5.30 → 6.30, audibly warmer) and paramId=255 bypass (Reverb 1 tail
 * dropped, front-panel LED disengaged). Wiki spec matches Q8.02
 * firmware behavior — no drift detected. HW-077 covers the GET half
 * (function 0x02 query). Byte-exact goldens in
 * `scripts/verify-axe-fx-ii-encoding.ts` lock the encoder.
 */

import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const FRACTAL_MFR = [0x00, 0x01, 0x74] as const;
const FUNC_BLOCK_PARAM = 0x02;
const FUNC_SET_GRID_CELL = 0x05;
const FUNC_SET_CELL_ROUTING = 0x06;
const FUNC_SET_PRESET_NAME = 0x09;
const FUNC_GET_PRESET_NAME = 0x0f;
const FUNC_BLOCK_CHANNEL = 0x11;
const FUNC_GET_PRESET_NUMBER = 0x14;
const FUNC_GET_GRID_LAYOUT = 0x20;
const FUNC_SCENE_NUMBER = 0x29;
const FUNC_STORE_PRESET = 0x1d;
const FUNC_MULTIPURPOSE_RESPONSE = 0x64;
const FUNC_SWITCH_PRESET = 0x3c;
const FUNC_STATE_DUMP_HEADER = 0x74;
const FUNC_STATE_DUMP_CHUNK = 0x75;
const FUNC_STATE_DUMP_FOOTER = 0x76;

/**
 * Max items per 0x75 chunk observed in device captures. AxeEdit /
 * firmware splits the state value list into chunks of up to 64 items
 * each (each item = 3 wire bytes via `packValue16`). Capture corpus
 * shows full chunks of 64 followed by a final short chunk holding
 * the remainder; we mirror that shape for round-trip byte-exactness.
 */
const STATE_DUMP_CHUNK_MAX_ITEMS = 64;

const ACTION_QUERY = 0x00;
const ACTION_SET = 0x01;
/** Sentinel scene value used by SET_SCENE_NUMBER to read the current scene. */
const SCENE_QUERY = 0x7f;

/** Default model byte for the founder's hardware (Axe-Fx II XL+). */
export const AXE_FX_II_XL_PLUS_MODEL_ID = 0x07;

/** Wire model byte for each Axe-Fx II family variant. */
export const MODEL_IDS = Object.freeze({
    'axe-fx-ii': 0x03,        // Mark I / Mark II
    'axe-fx-ii-xl': 0x06,
    'axe-fx-ii-xl-plus': 0x07,
    'ax8': 0x08,
});

export interface AxeFxIIParamId {
    /** 14-bit block instance ID (e.g. 106 = Amp 1, 107 = Amp 2). */
    effectId: number;
    /** 14-bit parameter index within the block (e.g. 1 = Input Drive). */
    paramId: number;
}

function encode14(n: number): [number, number] {
    if (!Number.isInteger(n) || n < 0 || n > 0x3fff) {
        throw new Error(`14-bit value out of range: ${n}`);
    }
    return [n & 0x7f, (n >> 7) & 0x7f];
}

/**
 * Pack a 16-bit unsigned value into the wire's three 7-bit septets.
 *
 *   septet 0 = bits 6..0   (lowest seven bits)
 *   septet 1 = bits 13..7  (next seven bits)
 *   septet 2 = bits 15..14 (top two bits, zero-padded into a 7-bit byte)
 *
 * Per wiki, valid input range is 0..65534. We accept up to 65535 (the
 * full 16-bit range) so callers can passes through without an extra
 * clamp; firmware reportedly clamps 65535 → 65534 internally.
 */
export function packValue16(value: number): [number, number, number] {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new Error(`packValue16 input out of range: ${value}`);
    }
    return [
        value & 0x7f,
        (value >> 7) & 0x7f,
        (value >> 14) & 0x03,
    ];
}

/** Inverse of `packValue16`. Inputs may have unused upper bits — masked. */
export function unpackValue16(b0: number, b1: number, b2: number): number {
    return ((b0 & 0x7f)) | ((b1 & 0x7f) << 7) | ((b2 & 0x03) << 14);
}

/**
 * Convert a display value to its corresponding 16-bit wire value, given
 * a param's calibrated `displayMin` / `displayMax` / `displayScale`.
 *
 * Two scale shapes supported:
 *
 * **`'linear'`** (default) — wire 0..65534 maps linearly onto
 * displayMin..displayMax. Confirmed by HW-079 / HW-088 / HW-089 across
 * 0..10 (AMP knobs), 0..100% (mix), -100..+100% (feedback / balance /
 * pan), -80..+20 dB (cab level).
 *
 * **`'log10'`** — wire 0..65534 maps log-base-10 onto
 * displayMin..displayMax. Used for frequency knobs (HW-090 confirmed
 * cab.low_cut 20..2000 Hz and cab.high_cut 200..20000 Hz both fit
 * `displayHz = displayMin × (displayMax/displayMin)^(wire/65534)`
 * exactly at every measured anchor). Requires displayMin > 0.
 *
 * Callers should only invoke this on params with populated displayMin
 * AND displayMax. For uncalibrated params, the tool layer falls back
 * to the wire-value path.
 *
 * Clamps to [displayMin, displayMax] silently — the wire value pins to
 * [0, 65534] either way, so an out-of-range display value rounds to
 * the same endpoint. The tool layer surfaces a clamp note when needed.
 */
export type DisplayScale = 'linear' | 'log10';

export interface DisplayToWireOptions {
    readonly displayMin: number;
    readonly displayMax: number;
    readonly displayScale?: DisplayScale; // defaults to 'linear'
}

export function displayToWire(display: number, opts: DisplayToWireOptions): number {
    if (!Number.isFinite(display)) {
        throw new Error(`displayToWire: display value must be finite, got ${display}`);
    }
    const { displayMin, displayMax, displayScale = 'linear' } = opts;
    if (displayMin >= displayMax) {
        throw new Error(`displayToWire: displayMin (${displayMin}) must be < displayMax (${displayMax})`);
    }

    if (displayScale === 'log10') {
        if (displayMin <= 0 || displayMax <= 0) {
            throw new Error(`displayToWire: log10 scale requires positive displayMin/displayMax, got ${displayMin}/${displayMax}`);
        }
        const clamped = Math.min(displayMax, Math.max(displayMin, display));
        const ratio = Math.log10(clamped / displayMin) / Math.log10(displayMax / displayMin);
        return Math.round(ratio * 65534);
    }

    // linear (default)
    const clamped = Math.min(displayMax, Math.max(displayMin, display));
    const ratio = (clamped - displayMin) / (displayMax - displayMin);
    return Math.round(ratio * 65534);
}

/**
 * Inverse of `displayToWire`. Wire 0..65534 → display value via the
 * param's linear or log10 scale.
 */
export function wireToDisplay(wire: number, opts: DisplayToWireOptions): number {
    if (!Number.isInteger(wire) || wire < 0 || wire > 65534) {
        throw new Error(`wireToDisplay: wire value out of range: ${wire}`);
    }
    const { displayMin, displayMax, displayScale = 'linear' } = opts;
    if (displayMin >= displayMax) {
        throw new Error(`wireToDisplay: displayMin (${displayMin}) must be < displayMax (${displayMax})`);
    }

    if (displayScale === 'log10') {
        if (displayMin <= 0 || displayMax <= 0) {
            throw new Error(`wireToDisplay: log10 scale requires positive displayMin/displayMax, got ${displayMin}/${displayMax}`);
        }
        return displayMin * Math.pow(displayMax / displayMin, wire / 65534);
    }

    return displayMin + (wire / 65534) * (displayMax - displayMin);
}

function buildEnvelope(
    modelId: number,
    body: readonly number[],
): number[] {
    const head = [SYSEX_START, ...FRACTAL_MFR, modelId, ...body];
    return [...head, fractalChecksum(head), SYSEX_END];
}

export interface BuildOptions {
    /** Target hardware variant. Defaults to XL+ (the founder's device). */
    modelId?: number;
}

/**
 * Build a SET_BLOCK_PARAMETER_VALUE message (function `0x02`, action 1).
 *
 * `value` is the wire-level 16-bit integer (0..65534). Display ↔ wire
 * conversion is the caller's responsibility — see KNOWN_PARAMS in
 * `./params.ts` for per-param display ranges where the wiki documents
 * them, and the §LOUDNESS BUDGET / display-anchor doc for params
 * without populated ranges.
 */
export function buildSetBlockParameterValue(
    param: AxeFxIIParamId,
    value: number,
    opts: BuildOptions = {},
): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_BLOCK_PARAM,
        ...encode14(param.effectId),
        ...encode14(param.paramId),
        ...packValue16(value),
        ACTION_SET,
    ]);
}

/**
 * Build a GET_BLOCK_PARAMETER_VALUE request (function `0x02`, action 0).
 *
 * Per wiki: "When you are getting a parameter value you still have to
 * include a parameter value with your message but this value can be 0."
 * We send three zero septets for the value field.
 */
export function buildGetBlockParameterValue(
    param: AxeFxIIParamId,
    opts: BuildOptions = {},
): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_BLOCK_PARAM,
        ...encode14(param.effectId),
        ...encode14(param.paramId),
        0x00, 0x00, 0x00,
        ACTION_QUERY,
    ]);
}

/**
 * Build a block-bypass toggle. Per wiki:
 *
 *   "Bypassing/Engaging a Block is also done with this function with
 *    parameter 255. Send the value 0 to Engage, 1 to Bypass."
 */
export function buildSetBlockBypass(
    effectId: number,
    bypassed: boolean,
    opts: BuildOptions = {},
): number[] {
    return buildSetBlockParameterValue(
        { effectId, paramId: 255 },
        bypassed ? 1 : 0,
        opts,
    );
}

/**
 * Predicate: does `bytes` look like the response to our GET_BLOCK_PARAMETER_VALUE
 * request for `(effectId, paramId)`? The device echoes the same
 * envelope+function+effectId+paramId, then includes the actual wire
 * value, then 5 unknown bytes, then a null-terminated label string.
 *
 * Per wiki §"GET/SET_BLOCK_PARAMETER_VALUE", response payload is:
 *   [eff7-0][eff13-7][param7-0][param13-7][val7-0][val13-7][val15-14]
 *   [unk1][unk2][unk3][unk4][unk5][label-bytes...][0x00][checksum] F7
 *
 * Distinguishing GET response from a SET echo: the GET response always
 * carries a label string (>= 1 character + null terminator), so total
 * length is well above the SET request's 14 bytes. We use the length
 * cutoff as the discriminator.
 */
export function isGetBlockParameterResponse(
    bytes: number[],
    target: AxeFxIIParamId,
    expectedModelId: number = AXE_FX_II_XL_PLUS_MODEL_ID,
): boolean {
    if (bytes.length < 17) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0] || bytes[2] !== FRACTAL_MFR[1] || bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[4] !== expectedModelId) return false;
    if (bytes[5] !== FUNC_BLOCK_PARAM) return false;
    const eff = (bytes[6] & 0x7f) | ((bytes[7] & 0x7f) << 7);
    const param = (bytes[8] & 0x7f) | ((bytes[9] & 0x7f) << 7);
    return eff === target.effectId && param === target.paramId;
}

export interface GetBlockParameterResponse {
    /** 16-bit unsigned wire value the device reports as currently held. */
    value: number;
    /** Display label the device shows for this value (e.g. "5.00", "Plexi 50W Hi"). */
    label: string;
}

/**
 * Parse a GET_BLOCK_PARAMETER_VALUE response. Caller must have already
 * matched it via `isGetBlockParameterResponse` for the right target —
 * this just decodes the value + label string from a known-shape buffer.
 */
export function parseGetBlockParameterResponse(bytes: number[]): GetBlockParameterResponse {
    // bytes[10..12] = value 3 septets; bytes[13..17] = 5 unknown bytes;
    // bytes[18..N-2] = label string + null; bytes[N-2] = checksum; bytes[N-1] = 0xF7
    if (bytes.length < 17) {
        throw new Error(`GET_BLOCK_PARAMETER response too short: ${bytes.length} bytes`);
    }
    const value = unpackValue16(bytes[10], bytes[11], bytes[12]);
    // Find the null terminator starting at byte 18 (after 5 unknown bytes).
    let nullIdx = -1;
    for (let i = 18; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x00) { nullIdx = i; break; }
    }
    const labelBytes = nullIdx > 18 ? bytes.slice(18, nullIdx) : [];
    const label = String.fromCharCode(...labelBytes);
    return { value, label };
}

/**
 * Build a GET_PRESET_NAME request (function 0x0F). Empty body —
 * envelope + function + checksum + F7.
 */
export function buildGetPresetName(opts: BuildOptions = {}): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [FUNC_GET_PRESET_NAME]);
}

export function isGetPresetNameResponse(
    bytes: number[],
    expectedModelId: number = AXE_FX_II_XL_PLUS_MODEL_ID,
): boolean {
    if (bytes.length < 9) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0] || bytes[2] !== FRACTAL_MFR[1] || bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[4] !== expectedModelId) return false;
    if (bytes[5] !== FUNC_GET_PRESET_NAME) return false;
    return true;
}

/**
 * Parse a GET_PRESET_NAME response. Body is null-terminated ASCII
 * starting at byte 6.
 */
export function parseGetPresetNameResponse(bytes: number[]): string {
    if (!isGetPresetNameResponse(bytes)) {
        throw new Error('Bytes do not match GET_PRESET_NAME response shape');
    }
    let nullIdx = -1;
    for (let i = 6; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x00) { nullIdx = i; break; }
    }
    const labelBytes = nullIdx > 6 ? bytes.slice(6, nullIdx) : [];
    return String.fromCharCode(...labelBytes).trim();
}

/**
 * Build a GET_GRID_LAYOUT_AND_ROUTING request (function 0x20). Empty
 * body. Response carries 48× 4-byte grid cells (4 rows × 12 columns).
 */
export function buildGetGridLayout(opts: BuildOptions = {}): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [FUNC_GET_GRID_LAYOUT]);
}

export function isGetGridLayoutResponse(
    bytes: number[],
    expectedModelId: number = AXE_FX_II_XL_PLUS_MODEL_ID,
): boolean {
    if (bytes.length < 8 + 48 * 4) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0] || bytes[2] !== FRACTAL_MFR[1] || bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[4] !== expectedModelId) return false;
    if (bytes[5] !== FUNC_GET_GRID_LAYOUT) return false;
    return true;
}

/**
 * One cell in the 4×12 routing grid. `blockId` is the 14-bit ID per
 * `blockTypes.ts` — block IDs 100..170, shunt IDs 200..235, or 0 for
 * an empty cell. `routingFlags` is a 4-bit mask: bit N set means
 * "connect row (N+1) of the previous column to this cell's input".
 */
export interface GridCell {
    /** Column 1..12. */
    col: number;
    /** Row 1..4. */
    row: number;
    /** 14-bit block ID (100-170 = block, 200-235 = shunt, 0 = empty). */
    blockId: number;
    /** Routing-input mask. Bit N (0..3) set ⇒ row N+1 of previous column connects to this input. */
    routingFlags: number;
}

/**
 * Parse a GET_GRID_LAYOUT_AND_ROUTING response into 48 grid cells.
 *
 * Per wiki §"GET_GRID_LAYOUT_AND_ROUTING": cell order is column-major,
 * top-to-bottom within each column. Cell 0 = (col=1, row=1); cell 1 =
 * (col=1, row=2); ...; cell 4 = (col=2, row=1); etc.
 *
 * Per cell (4 bytes):
 *   bytes[0]: blockId bits 6-0
 *   bytes[1]: blockId bits 13-7
 *   bytes[2]: routing flags
 *   bytes[3]: unused (per wiki)
 */
export function parseGetGridLayoutResponse(bytes: number[]): GridCell[] {
    if (!isGetGridLayoutResponse(bytes)) {
        throw new Error('Bytes do not match GET_GRID_LAYOUT response shape');
    }
    const cells: GridCell[] = [];
    let i = 6; // start after envelope + function byte
    for (let cellIdx = 0; cellIdx < 48; cellIdx++) {
        const col = Math.floor(cellIdx / 4) + 1;
        const row = (cellIdx % 4) + 1;
        const blockId = (bytes[i] & 0x7f) | ((bytes[i + 1] & 0x7f) << 7);
        const routingFlags = bytes[i + 2] & 0x0f;
        cells.push({ col, row, blockId, routingFlags });
        i += 4;
    }
    return cells;
}

/**
 * Build a SET_SCENE_NUMBER message (function 0x29). Pass scene 0..7
 * to switch; pass undefined to query the current scene (sentinel 0x7F
 * per wiki — response carries the actual scene number).
 */
export function buildSetSceneNumber(scene: number, opts: BuildOptions = {}): number[] {
    if (!Number.isInteger(scene) || scene < 0 || scene > 7) {
        throw new Error(`Scene out of range: ${scene} (valid 0..7)`);
    }
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [FUNC_SCENE_NUMBER, scene]);
}

export function buildGetSceneNumber(opts: BuildOptions = {}): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [FUNC_SCENE_NUMBER, SCENE_QUERY]);
}

export function isSceneNumberResponse(
    bytes: number[],
    expectedModelId: number = AXE_FX_II_XL_PLUS_MODEL_ID,
): boolean {
    if (bytes.length < 9) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0] || bytes[2] !== FRACTAL_MFR[1] || bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[4] !== expectedModelId) return false;
    if (bytes[5] !== FUNC_SCENE_NUMBER) return false;
    return true;
}

export function parseSceneNumberResponse(bytes: number[]): number {
    if (!isSceneNumberResponse(bytes)) {
        throw new Error('Bytes do not match SCENE_NUMBER response shape');
    }
    return bytes[6] & 0x7f;
}

/**
 * Block channel select (function 0x11) — Axe-Fx II has TWO channels
 * per block (X and Y), distinct from AM4's four-channel A/B/C/D model.
 *
 * Wiki documents the envelope:
 *
 *   Request (host → device):
 *     F0 00 01 74 [model] 11 [eff_lo] [eff_hi] [chan] [action] [cs] F7
 *       chan   = 0 (X) or 1 (Y)
 *       action = 0 (get current value) or 1 (set)
 *
 *   Response/broadcast (device → host):
 *     F0 00 01 74 [model] 11 [eff_lo] [eff_hi] [chan] [cs] F7
 *
 * The device emits the response form whenever the active channel for a
 * block changes (e.g. user clicks X/Y in AxeEdit or front-panel) —
 * cross-confirmed via passive capture in
 * `samples/captured/session-60-channel-toggle.syx` (HW-097, 2026-05-11):
 * Amp 1 toggle X→Y produced `F0 00 01 74 07 11 6A 00 01 78 F7`;
 * Y→X produced `F0 00 01 74 07 11 6A 00 00 79 F7`. Checksums verified.
 *
 * Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-098). Amp 1
 * X→Y SET round-tripped cleanly: pre-read = X, set wrote Y (12 bytes
 * out), post-read = Y, front panel + AxeEdit both confirmed Y. The
 * 0=X / 1=Y mapping holds; wire envelope is byte-exact with wiki spec
 * and the broadcast capture from HW-097.
 */
export type AxeFxIIChannel = 'X' | 'Y';

export function channelToWire(c: AxeFxIIChannel | 0 | 1): number {
    if (c === 'X' || c === 0) return 0;
    if (c === 'Y' || c === 1) return 1;
    throw new Error(`channelToWire: expected 'X' / 'Y' / 0 / 1, got ${c}`);
}

export function wireToChannel(b: number): AxeFxIIChannel {
    if (b === 0) return 'X';
    if (b === 1) return 'Y';
    throw new Error(`wireToChannel: expected 0 or 1, got ${b}`);
}

export function buildSetBlockChannel(
    effectId: number,
    channel: AxeFxIIChannel | 0 | 1,
    opts: BuildOptions = {},
): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_BLOCK_CHANNEL,
        ...encode14(effectId),
        channelToWire(channel),
        0x01, // action = set
    ]);
}

export function buildGetBlockChannel(
    effectId: number,
    opts: BuildOptions = {},
): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_BLOCK_CHANNEL,
        ...encode14(effectId),
        0x00, // chan field — ignored on get
        0x00, // action = get
    ]);
}

export function isGetBlockChannelResponse(
    bytes: number[],
    expectedEffectId: number,
    expectedModelId: number = AXE_FX_II_XL_PLUS_MODEL_ID,
): boolean {
    // Response is 11 bytes: F0 00 01 74 [model] 11 [eff_lo] [eff_hi] [chan] [cs] F7
    if (bytes.length !== 11) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0] || bytes[2] !== FRACTAL_MFR[1] || bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[4] !== expectedModelId) return false;
    if (bytes[5] !== FUNC_BLOCK_CHANNEL) return false;
    const effId = (bytes[6] & 0x7f) | ((bytes[7] & 0x7f) << 7);
    return effId === expectedEffectId;
}

export function parseGetBlockChannelResponse(bytes: number[]): AxeFxIIChannel {
    if (bytes.length !== 11) {
        throw new Error(`Expected 11-byte BLOCK_CHANNEL response, got ${bytes.length}`);
    }
    return wireToChannel(bytes[8]);
}

/**
 * Switch preset (function 0x3C) — load preset N into the working buffer.
 * Wiki documents the envelope as `F0 00 01 74 [model] 3C [pn_lo]
 * [pn_hi] [cs] F7` where `pn_lo`/`pn_hi` is a 14-bit septet pair
 * encoding the preset number.
 *
 * Axe-Fx II preset numbering: 0-based linear index 0..N across the
 * bank (each bank holds 128 presets typically; XL+ has bigger
 * capacity). 0x14 GET_PRESET_NUMBER returns the same number space.
 *
 * Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-100).
 * `preset_number: 0` loaded "59 Bassguy" into the working buffer
 * cleanly; front panel showed slot "1" (the MIDI 0-based index maps
 * to the device's 1-based front-panel display — preset N appears as
 * slot N+1 on the front panel).
 */
export function buildSwitchPreset(
    presetNumber: number,
    opts: BuildOptions = {},
): number[] {
    if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > 0x3fff) {
        throw new Error(`buildSwitchPreset: preset number out of range (0..16383): ${presetNumber}`);
    }
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    // **MSB-first** byte ordering — matches `buildStorePreset` (0x1D) and
    // the device's own `GET_PRESET_NUMBER` (0x14) response, both of
    // which were hardware-verified on Q8.02 (HW-100/HW-102, session-61).
    //
    // The wiki documents this envelope as LSB-first, but Session 68
    // hardware testing on Q8.02 showed that LSB-first encoding silently
    // fails for any preset ≥ 128 — the device receives the bytes,
    // doesn't ACK or NACK, and stays on the previously-active slot
    // (founder slot-705 test 2026-05-12; agent's "RockOfAges" build
    // appeared at slot 683 instead of slot 702 because the per-entry
    // switch never landed and the writes hit whatever working buffer
    // was active). For preset < 128 both orderings produce identical
    // bytes, which is why HW-100 (test on wire 0) didn't catch this.
    //
    // Closes HW-103 (verify buildSwitchPreset byte ordering for preset ≥ 128).
    const presetHigh = (presetNumber >> 7) & 0x7f;
    const presetLow = presetNumber & 0x7f;
    return buildEnvelope(modelId, [
        FUNC_SWITCH_PRESET,
        presetHigh,
        presetLow,
    ]);
}

/**
 * Set working-buffer preset name (function 0x09). Wiki documents the
 * envelope as the function byte followed by ASCII characters. Preset
 * names on Axe-Fx II are 32 chars, space-padded.
 *
 * Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-100).
 * `"HW-100 Test"` written to the working buffer; immediate
 * `axefx2_get_preset_name` echoed it back; front panel showed the
 * new name. Working-buffer scope confirmed — switching presets
 * discards it (no persistent change to factory slot).
 */
export function buildSetPresetName(name: string, opts: BuildOptions = {}): number[] {
    if (name.length > 32) {
        throw new Error(`buildSetPresetName: name too long (max 32 chars): "${name}" (${name.length})`);
    }
    // Validate ASCII-printable per project convention. Allow space + printable 0x20..0x7E.
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c < 0x20 || c > 0x7e) {
            throw new Error(`buildSetPresetName: non-ASCII-printable char at position ${i}: 0x${c.toString(16)}`);
        }
    }
    // Right-pad with spaces to 32 chars (Axe-Fx II convention; matches
    // GET_PRESET_NAME response shape).
    const padded = name.padEnd(32, ' ');
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_SET_PRESET_NAME,
        ...Array.from(padded, (c) => c.charCodeAt(0)),
    ]);
}

/**
 * STORE the working buffer to a user preset slot (function 0x1D).
 *
 * Wire envelope:
 *
 *   F0 00 01 74 [model] 1D [preset_high] [preset_low] [cs] F7
 *     preset_high = (n >> 7) & 0x7F
 *     preset_low  = n & 0x7F
 *
 * Note: this function uses **MSB-first** byte ordering for the 14-bit
 * preset number, unlike `buildSwitchPreset` / `buildEnvelope(..., [0x02,
 * ...effectId, ...paramId, ...])` which use LSB-first via `encode14()`.
 * The MSB-first ordering for 0x1D is taken from bspaulding/axe-fx-midi
 * (Rust) and matches the byte order the device uses for its own
 * 0x14 GET_PRESET_NUMBER response (captured session-61 payload `05 3B`
 * for preset 699 = display preset 700).
 *
 * Status: 🟢 hardware-verified on Q8.02 XL+ (HW-102, 2026-05-11).
 * End-to-end round-trip from our encoder landed on the first attempt:
 * `axefx2_save_preset({ preset_number: 699, name: "..." })` produced
 * the captured save sequence, device returned `0x64 1D 00` (OK),
 * working buffer persisted to slot 700 confirmed by founder front-
 * panel inspection. Wire format derived from bspaulding/axe-fx-midi
 * + session-61 passive capture (AxeEdit File → Save Preset); our
 * encoder matches AxeEdit's behavior byte-for-byte.
 *
 * Cross-checks before shipping:
 * - bspaulding's test case (Mark II, preset 217):
 *   `[F0 00 01 74 03 1D 01 59 43 F7]` — locked as a golden in
 *   `scripts/verify-axe-fx-ii-encoding.ts`.
 * - XL+ encoding for preset 699:
 *   `[F0 00 01 74 07 1D 05 3B 21 F7]` — also locked, paired with the
 *   captured device-side 0x64 ACK pattern.
 *
 * 0-vs-1 indexing: same as `buildSwitchPreset` — wire is 0-based, the
 * device's front panel displays 1-based. To save to what the user sees
 * as "preset 700," pass `presetNumber: 699`. The tool layer surfaces
 * this in `axefx2_save_preset`'s description so the agent translates.
 */
export function buildStorePreset(
    presetNumber: number,
    opts: BuildOptions = {},
): number[] {
    if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > 0x3fff) {
        throw new Error(`buildStorePreset: preset number out of range (0..16383): ${presetNumber}`);
    }
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    const high = (presetNumber >> 7) & 0x7f;
    const low = presetNumber & 0x7f;
    return buildEnvelope(modelId, [FUNC_STORE_PRESET, high, low]);
}

/**
 * Match a MULTIPURPOSE_RESPONSE (function 0x64) acknowledging a
 * STORE_PRESET (function 0x1D) request. The device's response format
 * is `[echoed_fn, result_code]`:
 *
 *   F0 00 01 74 [model] 64 1D [result_code] [cs] F7
 *     result_code 0x00 = OK
 *     result_code 0x05 = parsed but not honored (e.g. malformed payload)
 *
 * Captured session-61, 2026-05-11 from AxeEdit's save-to-slot operation
 * on Q8.02 XL+: `F0 00 01 74 07 64 1D 00 7B F7` (result=OK).
 */
export function isStorePresetResponse(bytes: readonly number[]): boolean {
    if (bytes.length < 10) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0]) return false;
    if (bytes[2] !== FRACTAL_MFR[1]) return false;
    if (bytes[3] !== FRACTAL_MFR[2]) return false;
    // bytes[4] = model byte — accept any (we may encounter the same response
    // shape across II / XL / XL+ / AX8 if cross-revision support lands later).
    if (bytes[5] !== FUNC_MULTIPURPOSE_RESPONSE) return false;
    if (bytes[6] !== FUNC_STORE_PRESET) return false;
    return bytes[bytes.length - 1] === SYSEX_END;
}

export interface StorePresetResult {
    /** Raw device result code (0x00 = OK). */
    resultCode: number;
    /** True iff resultCode === 0x00. */
    ok: boolean;
}

export function parseStorePresetResponse(bytes: readonly number[]): StorePresetResult {
    if (!isStorePresetResponse(bytes)) {
        throw new Error(
            `parseStorePresetResponse: not a STORE_PRESET MULTIPURPOSE_RESPONSE: ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
        );
    }
    const resultCode = bytes[7];
    return { resultCode, ok: resultCode === 0x00 };
}

/**
 * GET the device's currently-active preset number (function 0x14).
 *
 * Wire envelope (request):  F0 00 01 74 [model] 14 [cs] F7   (no payload)
 * Wire envelope (response): F0 00 01 74 [model] 14 [hi] [lo] [cs] F7
 *
 * **Byte ordering is MSB-first** in the response — `[bits 13-7, bits 6-0]`
 * — contrary to the wiki's "bits 6-0 first" documentation. Empirically
 * disambiguated by session-61 passive capture: payload `05 3B` decodes
 * to wire preset 699 (= front-panel display "slot 700") only under
 * MSB-first, matching the founder's reported state at capture time.
 * LSB-first decode would yield preset 7557, which is impossible (XL+
 * user range is 0..767). See `docs/SYSEX-MAP-AXE-FX-II.md` § 6b.
 *
 * Status: 🟡 wire format from session-61 passive capture; will flip to
 * 🟢 once axefx2_get_active_preset_number lands end-to-end on Q8.02.
 */
export function buildGetPresetNumber(opts: BuildOptions = {}): number[] {
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [FUNC_GET_PRESET_NUMBER]);
}

export function isGetPresetNumberResponse(bytes: readonly number[]): boolean {
    if (bytes.length < 10) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0]) return false;
    if (bytes[2] !== FRACTAL_MFR[1]) return false;
    if (bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[5] !== FUNC_GET_PRESET_NUMBER) return false;
    if (bytes[bytes.length - 1] !== SYSEX_END) return false;
    // Distinguish from a bare request echo: a response must carry the
    // two-byte preset-number payload (total length = 6 header + 2 payload
    // + 1 cs + 1 end = 10 bytes).
    return bytes.length === 10;
}

export interface GetPresetNumberResult {
    /** 0-based wire preset number (0..16383). */
    presetNumber: number;
    /** 1-based front-panel display slot (presetNumber + 1). */
    displaySlot: number;
}

export function parseGetPresetNumberResponse(bytes: readonly number[]): GetPresetNumberResult {
    if (!isGetPresetNumberResponse(bytes)) {
        throw new Error(
            `parseGetPresetNumberResponse: not a GET_PRESET_NUMBER response: ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
        );
    }
    const high = bytes[6] & 0x7f;
    const low = bytes[7] & 0x7f;
    const presetNumber = (high << 7) | low;
    return { presetNumber, displaySlot: presetNumber + 1 };
}

/**
 * Set the block at a grid cell (function 0x05). Places a block at the
 * specified cell, or clears the cell (blockId = 0). If the block was
 * already on the grid elsewhere, the device MOVES it (clears its
 * previous cell as a side effect).
 *
 * Wire envelope:
 *
 *   F0 00 01 74 [model] 05
 *     [blockId_lo] [blockId_hi]
 *     [cell_idx]
 *     [reserved=0]
 *     [cs] F7
 *
 *   cell_idx = (col_idx × 4) + row_idx
 *              col_idx ∈ 0..11 (column 1..12 minus 1)
 *              row_idx ∈ 0..3  (row 1..4 minus 1)
 *              col-major, top-to-bottom — same ordering as the 0x20
 *              GET_GRID_LAYOUT_AND_ROUTING response.
 *
 *   blockId  = 14-bit, LSB-first septet pair.
 *              0 = empty cell (clears whatever was there)
 *              100..170 = named blocks (see blockTypes.ts)
 *              200..235 = shunts (pass-through cells)
 *
 *   reserved = the device accepts 0x00; non-zero behavior is unknown.
 *              May be a routing-flag mask in some firmwares; on Q8.02 XL+
 *              we observed no effect on routing when set. The device
 *              auto-assigns a routing mask to newly-placed cells (e.g.
 *              :2 for row-2 placements) regardless of this byte.
 *
 * Decoding evidence (session-62 + session-63 probes, 2026-05-11):
 *
 *   Probe (payload bytes after 0x05)         Observed effect
 *   ─────────────────────────────────────────────────────────
 *   64 00 00 00  → CPR1 at cell 0 (R1C1)     ✓ matches
 *   00 00 02 00  → empty at cell 2 (R3C1)    ✓ matches (was already empty)
 *   00 00 01 02  → empty at cell 1 (R2C1)    ✓ matches (CPR1 cleared)
 *   64 00 01 00  → CPR1 at cell 1 (R2C1)     ✓ matches (CPR1 returned)
 *
 *   Cell index 1 disambiguates col-major vs row-major: under col-major
 *   it points to (col 0, row 1) = R2C1, which IS where the change
 *   landed. Under row-major it would point to (row 0, col 1) = R1C2,
 *   which is empty and would show no change. Col-major confirmed.
 *
 *   Probes with bare (no payload) and 1-byte payload were rejected by
 *   the device with non-OK result codes (0x06 / 0x0C) — the 4-byte
 *   payload is the minimum the device accepts.
 *
 * KNOWN LIMITATION: this write does NOT propagate routing/cabling.
 * Moving a block out of a cell leaves the downstream block's input
 * mask pointing at empty space (audio dead-end). The agent / user is
 * responsible for re-wiring via a separate mechanism (TBD — likely
 * either byte[3] of this function with the right value, or a sibling
 * function byte like 0x06 which also fires during grid-move captures).
 *
 * Status: 🟢 wire format hardware-validated on Q8.02 XL+
 * (session-63 probe sequence). Routing-propagation limitation
 * documented above.
 */
export function buildSetGridCell(opts: {
    row: number;
    col: number;
    blockId: number;
    modelId?: number;
}): number[] {
    const { row, col, blockId } = opts;
    if (!Number.isInteger(row) || row < 1 || row > 4) {
        throw new Error(`buildSetGridCell: row out of range (1..4): ${row}`);
    }
    if (!Number.isInteger(col) || col < 1 || col > 12) {
        throw new Error(`buildSetGridCell: col out of range (1..12): ${col}`);
    }
    if (!Number.isInteger(blockId) || blockId < 0 || blockId > 0x3fff) {
        throw new Error(`buildSetGridCell: blockId out of range (0..16383): ${blockId}`);
    }
    const cellIdx = (col - 1) * 4 + (row - 1);
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_SET_GRID_CELL,
        blockId & 0x7f,        // blockId LSB septet
        (blockId >> 7) & 0x7f, // blockId MSB septet
        cellIdx & 0x7f,        // cell index 0..47
        0x00,                  // reserved / routing-flag-mask (unused on Q8.02)
    ]);
}

/**
 * Match a MULTIPURPOSE_RESPONSE (function 0x64) acknowledging a
 * SET_GRID_CELL (function 0x05) request.
 *
 *   F0 00 01 74 [model] 64 05 [result_code] [cs] F7
 *
 * Result codes observed on Q8.02 XL+ during decode:
 *   0x00 — OK, write applied
 *   0x06 — payload too short (e.g. bare envelope)
 *   0x0C — payload too short (e.g. 1-byte payload)
 *
 * Other values are unknown; treat any non-0x00 as a rejection.
 */
export function isSetGridCellResponse(bytes: readonly number[]): boolean {
    if (bytes.length < 10) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0]) return false;
    if (bytes[2] !== FRACTAL_MFR[1]) return false;
    if (bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[5] !== FUNC_MULTIPURPOSE_RESPONSE) return false;
    if (bytes[6] !== FUNC_SET_GRID_CELL) return false;
    return bytes[bytes.length - 1] === SYSEX_END;
}

export interface SetGridCellResult {
    resultCode: number;
    ok: boolean;
}

export function parseSetGridCellResponse(bytes: readonly number[]): SetGridCellResult {
    if (!isSetGridCellResponse(bytes)) {
        throw new Error(
            `parseSetGridCellResponse: not a SET_GRID_CELL MULTIPURPOSE_RESPONSE: ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
        );
    }
    const resultCode = bytes[7];
    return { resultCode, ok: resultCode === 0x00 };
}

/**
 * Build a SET_CELL_ROUTING message (function 0x06) — add or remove a
 * cable between two adjacent-column grid cells. Companion to
 * `buildSetGridCell` (function 0x05): 0x05 places the block, 0x06 wires
 * its inputs.
 *
 * Wire envelope:
 *
 *   F0 00 01 74 [model] 06
 *     [src_cell_idx]    ← col-major linear index (col-1)*4 + (row-1)
 *     [dst_cell_idx]    ← col-major linear index; MUST be src_col + 1
 *     [connect]         ← 0x01 = add cable, 0x00 = remove cable
 *     [cs] F7
 *
 * Effect: the device updates `dst_cell.routing_mask` by setting
 * (connect=1) or clearing (connect=0) the bit at index `src_row_0indexed`.
 * The mask byte uses 4-bit input-mask encoding — bit N set means "feed
 * from row N+1 of previous column" (see `parseGetGridLayoutResponse`).
 * So a cable from row 2 → row 2 with src_col=2, dst_col=3 toggles
 * `dst_cell.routing_mask`'s bit 1 (= 0x02) on or off.
 *
 * Status: 🟢 hardware-decoded on Q8.02 XL+ (Session 70, 2026-05-13).
 * Captured AxeEdit's outbound fn 0x06 from a click-to-connect on
 * Amp(R2C2) → Cab(R2C3):
 *
 *   F0 00 01 74 07 06 05 09 01 09 F7
 *     src_cell = 5  = (2-1)*4 + (2-1) = R2C2
 *     dst_cell = 9  = (3-1)*4 + (2-1) = R2C3
 *     connect  = 1  = add cable
 *
 * Replayed by our own probe with byte-exact match — device acked
 * 0x00 OK and the grid-state read confirmed Cab's routing mask
 * flipped 0x00 → 0x02 ("Cab now feeds from row 2 of col 2 = from Amp").
 *
 * Validates adjacency (`dstCol === srcCol + 1`); the device rejects
 * non-adjacent cables. Cross-row cables (e.g. row 1 of col 5 → row 3
 * of col 6) ARE allowed — that's how parallel paths are wired.
 */
export function buildSetCellRouting(opts: {
    srcRow: number;
    srcCol: number;
    dstRow: number;
    dstCol: number;
    connect?: boolean;
    modelId?: number;
}): number[] {
    const { srcRow, srcCol, dstRow, dstCol, connect = true } = opts;
    if (!Number.isInteger(srcRow) || srcRow < 1 || srcRow > 4) {
        throw new Error(`buildSetCellRouting: srcRow out of range (1..4): ${srcRow}`);
    }
    if (!Number.isInteger(srcCol) || srcCol < 1 || srcCol > 11) {
        throw new Error(`buildSetCellRouting: srcCol out of range (1..11): ${srcCol}`);
    }
    if (!Number.isInteger(dstRow) || dstRow < 1 || dstRow > 4) {
        throw new Error(`buildSetCellRouting: dstRow out of range (1..4): ${dstRow}`);
    }
    if (!Number.isInteger(dstCol) || dstCol < 2 || dstCol > 12) {
        throw new Error(`buildSetCellRouting: dstCol out of range (2..12): ${dstCol}`);
    }
    if (dstCol !== srcCol + 1) {
        throw new Error(
            `buildSetCellRouting: dstCol (${dstCol}) must equal srcCol + 1 (got src=${srcCol}, dst=${dstCol}). ` +
            `Cables connect adjacent columns only — the device rejects off-column cables.`,
        );
    }
    const srcCellIdx = (srcCol - 1) * 4 + (srcRow - 1);
    const dstCellIdx = (dstCol - 1) * 4 + (dstRow - 1);
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;
    return buildEnvelope(modelId, [
        FUNC_SET_CELL_ROUTING,
        srcCellIdx & 0x7f,
        dstCellIdx & 0x7f,
        connect ? 0x01 : 0x00,
    ]);
}

/**
 * Match a MULTIPURPOSE_RESPONSE (function 0x64) acknowledging a
 * SET_CELL_ROUTING (function 0x06) request.
 *
 *   F0 00 01 74 [model] 64 06 [result_code] [cs] F7
 *
 * Result codes observed on Q8.02 XL+ during decode:
 *   0x00 — OK, routing updated
 *   0x01 — request rejected (e.g. non-adjacent columns, malformed shape)
 *   0x0C — payload length too short
 */
export function isSetCellRoutingResponse(bytes: readonly number[]): boolean {
    if (bytes.length < 10) return false;
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== FRACTAL_MFR[0]) return false;
    if (bytes[2] !== FRACTAL_MFR[1]) return false;
    if (bytes[3] !== FRACTAL_MFR[2]) return false;
    if (bytes[5] !== FUNC_MULTIPURPOSE_RESPONSE) return false;
    if (bytes[6] !== FUNC_SET_CELL_ROUTING) return false;
    return bytes[bytes.length - 1] === SYSEX_END;
}

export interface SetCellRoutingResult {
    resultCode: number;
    ok: boolean;
}

export function parseSetCellRoutingResponse(bytes: readonly number[]): SetCellRoutingResult {
    if (!isSetCellRoutingResponse(bytes)) {
        throw new Error(
            `parseSetCellRoutingResponse: not a SET_CELL_ROUTING MULTIPURPOSE_RESPONSE: ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
        );
    }
    const resultCode = bytes[7];
    return { resultCode, ok: resultCode === 0x00 };
}

/**
 * Axe-Fx II preset-state-dump triple builder (functions 0x74/0x75/0x76).
 *
 * Wire format decoded Session 60, 2026-05-11 from passive captures
 * (`docs/axefx2-state-broadcast-decode-research.md`). The device
 * broadcasts this triple every time AxeEdit makes a block-level
 * edit — header announces target block + total item count, then 1+
 * chunks of 16-bit values (3 septets each), then a one-byte footer.
 *
 * Layout per message:
 *
 *   HEADER (function 0x74, 13 bytes)
 *     F0 00 01 74 [model] 74
 *       [target_id 14b septet] [item_count 14b septet] [op_flag]
 *       [cs] F7
 *
 *   CHUNK  (function 0x75, variable, 8 + 3·N bytes)
 *     F0 00 01 74 [model] 75
 *       [chunk_item_count 14b septet]
 *       [N × packValue16]
 *       [cs] F7
 *
 *   FOOTER (function 0x76, 8 bytes — checksum-only terminator)
 *     F0 00 01 74 [model] 76 [cs] F7
 *
 * `target_id` matches `BLOCK_BY_ID` (e.g. 106 = Amp 1, 112 = Delay 1,
 * 127 = Volume/Pan 1). `op_flag` observed values: 0x01 for direct-
 * block edits (knob turn, grid move), 0x00 for preset-structure
 * changes (block add). Value positions correspond to `paramId 0..N`
 * of the target block's group in linear order (position-as-paramId
 * model confirmed Session 60 across AMP 1 + Delay 1 captures).
 *
 * Returns a flat byte array — caller can transmit it as a single
 * MIDI stream (the device receives the 3 messages in order). Use
 * `buildStateBroadcastTripleMessages` if you need them as separate
 * arrays.
 *
 * Status: 🟡 spec-derived from passive captures + decoded round-trip
 * golden against the captured Volume/Pan 1 triple in
 * `scripts/verify-axe-fx-ii-encoding.ts`. Has NOT been transmitted
 * to hardware yet — Step 2 in STATE.md (synthesize an outgoing
 * triple and observe AxeEdit's UI for state-change confirmation)
 * is the unfinished hardware step.
 */
export interface BuildStateBroadcastOptions extends BuildOptions {
    /** Op flag byte 10. 0x01 = direct block edit, 0x00 = preset-structure. Default 0x01. */
    opFlag?: number;
}

export function buildStateBroadcastTripleMessages(
    targetId: number,
    values: readonly number[],
    opts: BuildStateBroadcastOptions = {},
): { header: number[]; chunks: number[][]; footer: number[] } {
    if (!Number.isInteger(targetId) || targetId < 0 || targetId > 0x3fff) {
        throw new Error(`State-broadcast targetId out of range: ${targetId}`);
    }
    const opFlag = opts.opFlag ?? 0x01;
    if (!Number.isInteger(opFlag) || opFlag < 0 || opFlag > 0x7f) {
        throw new Error(`State-broadcast opFlag out of range: ${opFlag}`);
    }
    const modelId = opts.modelId ?? AXE_FX_II_XL_PLUS_MODEL_ID;

    const header = buildEnvelope(modelId, [
        FUNC_STATE_DUMP_HEADER,
        ...encode14(targetId),
        ...encode14(values.length),
        opFlag,
    ]);

    const chunks: number[][] = [];
    for (let start = 0; start < values.length; start += STATE_DUMP_CHUNK_MAX_ITEMS) {
        const slice = values.slice(start, start + STATE_DUMP_CHUNK_MAX_ITEMS);
        const body: number[] = [FUNC_STATE_DUMP_CHUNK, ...encode14(slice.length)];
        for (const v of slice) {
            const [b0, b1, b2] = packValue16(v);
            body.push(b0, b1, b2);
        }
        chunks.push(buildEnvelope(modelId, body));
    }
    // Empty value list still emits a single zero-item chunk so the
    // header + chunk + footer triple shape stays consistent.
    if (chunks.length === 0) {
        chunks.push(buildEnvelope(modelId, [FUNC_STATE_DUMP_CHUNK, ...encode14(0)]));
    }

    const footer = buildEnvelope(modelId, [FUNC_STATE_DUMP_FOOTER]);

    return { header, chunks, footer };
}

export function buildStateBroadcastTriple(
    targetId: number,
    values: readonly number[],
    opts: BuildStateBroadcastOptions = {},
): number[] {
    const { header, chunks, footer } = buildStateBroadcastTripleMessages(targetId, values, opts);
    return [...header, ...chunks.flat(), ...footer];
}
