/**
 * Axe-Fx III SysEx wire builders.
 *
 * BEFORE EDITING THIS FILE, READ:
 *   - `docs/SYSEX-MAP-AXE-FX-III.md`   (project spec summary + known bugs)
 *   - `docs/manuals/AxeFx3-MIDI-3rdParty.txt`  (Fractal v1.4 PDF, extracted)
 *
 * The v1.4 PDF is the only public spec Fractal ships for the III's
 * third-party MIDI surface. It IS in this repo as extracted text.
 * Don't web-search or guess opcodes — grep the .txt first.
 *
 * Envelope: `F0 00 01 74 0x10 [function] [payload...] [checksum] F7`.
 * Same modern Fractal family as AM4 (model 0x15), FM3 (0x11), FM9
 * (0x12), VP4 (0x14) — III is 0x10.
 *
 * Function-byte map (all opcodes documented in the PDF):
 *   - 0x0A SET/GET BYPASS         (id id dd)
 *   - 0x0B SET/GET CHANNEL        (id id dd)
 *   - 0x0C SET/GET SCENE          (dd)
 *   - 0x0D QUERY PATCH NAME       (dd dd — preset number; returns nn nn + 32-char name)
 *   - 0x0E QUERY SCENE NAME       (dd — scene index; returns nn + 32-char name)
 *   - 0x0F SET/GET LOOPER STATE   (dd — button index; returns state bitfield)
 *   - 0x10 TEMPO TAP              (no payload; also the "tempo down-beat" push frame)
 *   - 0x11 TUNER ON/OFF           (dd; push variant carries note/string/cents)
 *   - 0x13 STATUS DUMP            (no payload; returns id id dd triples)
 *   - 0x14 SET/GET TEMPO          (dd dd — BPM)
 *
 * NOT documented in v1.4 (deliberately omitted by Fractal):
 *   - SET_PRESET / SWITCH_PRESET — use MIDI Program Change (CC0/CC32 + PC).
 *   - SET_PARAMETER_VALUE (0x02) — family inference only; param-IDs not public.
 *   - STORE_PRESET / SAVE — multi-frame envelope (0x77/0x78/0x79) per
 *     community RE; not in v1.4.
 *   - SET_PRESET_NAME / SET_SCENE_NAME — names are query-only.
 */
import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

/** Axe-Fx III model byte. From Fractal's published spec. */
export const AXE_FX_III_MODEL_ID = 0x10;

/** SysEx framing bytes shared across the entire modern Fractal family. */
const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const FRACTAL_MFR_PREFIX = [0x00, 0x01, 0x74] as const;

// ── Function-ID bytes from the Axe-Fx III spec v1.4 ────────────────

export const FN_SET_GET_BYPASS = 0x0a;
export const FN_SET_GET_CHANNEL = 0x0b;
export const FN_SET_GET_SCENE = 0x0c;
export const FN_QUERY_PATCH_NAME = 0x0d;
export const FN_QUERY_SCENE_NAME = 0x0e;
export const FN_SET_GET_LOOPER = 0x0f;
export const FN_TEMPO_TAP = 0x10;
export const FN_TUNER_ON_OFF = 0x11;
export const FN_STATUS_DUMP = 0x13;
export const FN_SET_GET_TEMPO = 0x14;

/**
 * Family-inference constant: 0x02 SET_PARAMETER_VALUE is the Axe-Fx
 * II opcode for per-block parameter writes. The III may share the
 * shape — the spec PDF deliberately omits parameter writes entirely.
 * Keep here for reference; do not USE in production without a capture.
 */
export const FN_SET_PARAMETER_VALUE_INFERRED = 0x02;

/** Query sentinel — when this is the value byte, the device responds with current state. */
export const QUERY_SENTINEL = 0x7f;

// ── Encoding helpers ───────────────────────────────────────────────

/**
 * Encode a 14-bit value as a 2-byte septet pair (low 7 bits, then high
 * 7 bits — little-endian). Preset numbers, BPMs, and effect IDs across
 * the Fractal family use this.
 */
function encode14(n: number): [number, number] {
  if (!Number.isInteger(n) || n < 0 || n > 0x3fff) {
    throw new Error(`encode14: ${n} out of range (0..16383)`);
  }
  return [n & 0x7f, (n >> 7) & 0x7f];
}

/** Decode a 2-byte septet pair (low 7 bits then high 7 bits) into a 14-bit integer. */
function decode14(lo: number, hi: number): number {
  return (lo & 0x7f) | ((hi & 0x7f) << 7);
}

/**
 * Build an envelope: `F0 00 01 74 [model] [function] [payload...]
 * [checksum] F7`. Checksum covers everything from `F0` through the
 * last payload byte (XOR-7bit).
 */
function buildEnvelope(fn: number, payload: readonly number[]): number[] {
  const body = [SYSEX_START, ...FRACTAL_MFR_PREFIX, AXE_FX_III_MODEL_ID, fn, ...payload];
  const checksum = fractalChecksum(body);
  return [...body, checksum, SYSEX_END];
}

// ── 0x0A SET/GET BYPASS ────────────────────────────────────────────

/**
 * SET BYPASS (function 0x0A). Targets the active scene only — per
 * spec the III's bypass writes don't carry a scene argument.
 *
 *   `F0 00 01 74 10 0A [id_lo] [id_hi] [dd] [cs] F7`
 *
 * `dd=0` engaged, `dd=1` bypassed.
 */
export function buildSetBypass(effectId: number, bypassed: boolean): number[] {
  return buildEnvelope(FN_SET_GET_BYPASS, [
    ...encode14(effectId),
    bypassed ? 1 : 0,
  ]);
}

/** GET BYPASS (function 0x0A with `dd=0x7F`). Device responds with same envelope shape. */
export function buildGetBypass(effectId: number): number[] {
  return buildEnvelope(FN_SET_GET_BYPASS, [
    ...encode14(effectId),
    QUERY_SENTINEL,
  ]);
}

// ── 0x0B SET/GET CHANNEL ───────────────────────────────────────────

/**
 * SET CHANNEL (function 0x0B). Targets the active scene only.
 * `channel` is 0..3 mapping to A..D.
 *
 *   `F0 00 01 74 10 0B [id_lo] [id_hi] [channel] [cs] F7`
 */
export function buildSetChannel(
  effectId: number,
  channel: 0 | 1 | 2 | 3,
): number[] {
  if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
    throw new Error(`buildSetChannel: channel ${channel} out of range (0..3 = A..D)`);
  }
  return buildEnvelope(FN_SET_GET_CHANNEL, [
    ...encode14(effectId),
    channel,
  ]);
}

/** GET CHANNEL (function 0x0B with `dd=0x7F`). */
export function buildGetChannel(effectId: number): number[] {
  return buildEnvelope(FN_SET_GET_CHANNEL, [
    ...encode14(effectId),
    QUERY_SENTINEL,
  ]);
}

// ── 0x0C SET/GET SCENE ─────────────────────────────────────────────

/**
 * SET SCENE (function 0x0C). `sceneIndex` is 0..7. Spec also says
 * "Returns: ... where dd is the current scene" — so SET also echoes.
 */
export function buildSetScene(sceneIndex: number): number[] {
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 7) {
    throw new Error(`buildSetScene: sceneIndex ${sceneIndex} out of range (0..7)`);
  }
  return buildEnvelope(FN_SET_GET_SCENE, [sceneIndex & 0x7f]);
}

/** GET SCENE (function 0x0C with `dd=0x7F`). */
export function buildGetScene(): number[] {
  return buildEnvelope(FN_SET_GET_SCENE, [QUERY_SENTINEL]);
}

// ── 0x0D QUERY PATCH NAME ──────────────────────────────────────────

/**
 * QUERY PATCH NAME (function 0x0D).
 *
 *   Request:  `F0 00 01 74 10 0D [dd dd preset#] [cs] F7`
 *   Current:  `F0 00 01 74 10 0D 7F 7F [cs] F7`
 *   Response: `F0 00 01 74 10 0D [nn nn preset#] [dd*32 name] [cs] F7`
 *
 * Pass a preset number 0..1023 (Mark II) / 0..511 (Mark I) to look
 * up that preset's name, or `'current'` to query the active preset.
 * Response contains BOTH the preset number AND the name — there's no
 * separate "get preset number" function in the v1.4 spec.
 *
 * NB: this is NOT a preset-switching command. To CHANGE the active
 * preset on the III via MIDI, use standard Program Change messages
 * (with CC 0 + CC 32 Bank Select for slots > 127). The III has no
 * SysEx preset-switch in the v1.4 public spec.
 */
export function buildQueryPatchName(
  presetNumber: number | 'current',
): number[] {
  if (presetNumber === 'current') {
    return buildEnvelope(FN_QUERY_PATCH_NAME, [QUERY_SENTINEL, QUERY_SENTINEL]);
  }
  if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > 1023) {
    throw new Error(
      `buildQueryPatchName: presetNumber ${presetNumber} out of range (0..1023).`,
    );
  }
  return buildEnvelope(FN_QUERY_PATCH_NAME, encode14(presetNumber));
}

// ── 0x0E QUERY SCENE NAME ──────────────────────────────────────────

/**
 * QUERY SCENE NAME (function 0x0E).
 *
 *   Request:  `F0 00 01 74 10 0E [dd scene] [cs] F7`
 *   Current:  `F0 00 01 74 10 0E 7F [cs] F7`
 *   Response: `F0 00 01 74 10 0E [nn scene] [dd*32 name] [cs] F7`
 *
 * No SET variant in the spec.
 */
export function buildQuerySceneName(sceneIndex: number | 'current'): number[] {
  if (sceneIndex === 'current') {
    return buildEnvelope(FN_QUERY_SCENE_NAME, [QUERY_SENTINEL]);
  }
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 7) {
    throw new Error(
      `buildQuerySceneName: sceneIndex ${sceneIndex} out of range (0..7).`,
    );
  }
  return buildEnvelope(FN_QUERY_SCENE_NAME, [sceneIndex & 0x7f]);
}

// ── 0x0F SET/GET LOOPER STATE ──────────────────────────────────────

export type LooperAction =
  | 'record'    // 0
  | 'play'      // 1
  | 'undo'      // 2
  | 'once'      // 3
  | 'reverse'   // 4
  | 'half_speed'; // 5

const LOOPER_ACTION_VALUES: Record<LooperAction, number> = {
  record: 0,
  play: 1,
  undo: 2,
  once: 3,
  reverse: 4,
  half_speed: 5,
};

/**
 * SET LOOPER (function 0x0F). Triggers a looper "button press":
 *
 *   `F0 00 01 74 10 0F [dd button] [cs] F7`
 *
 * Buttons per spec: 0=Record, 1=Play, 2=Undo, 3=Once, 4=Reverse,
 * 5=Half-speed.
 */
export function buildSetLooper(action: LooperAction): number[] {
  return buildEnvelope(FN_SET_GET_LOOPER, [LOOPER_ACTION_VALUES[action]]);
}

/**
 * GET LOOPER STATE (function 0x0F with `dd=0x7F`). Returns a state
 * bitfield: bit 0=Record, 1=Play, 2=Overdub, 3=Once, 4=Reverse,
 * 5=Half-speed.
 */
export function buildGetLooperState(): number[] {
  return buildEnvelope(FN_SET_GET_LOOPER, [QUERY_SENTINEL]);
}

// ── 0x10 TEMPO TAP ─────────────────────────────────────────────────

/**
 * TEMPO TAP (function 0x10). Single-shot, no payload. Each call
 * counts as one tap-tempo press; the III computes BPM from the
 * inter-tap interval the same way as the front-panel TAP button.
 */
export function buildTempoTap(): number[] {
  return buildEnvelope(FN_TEMPO_TAP, []);
}

// ── 0x11 TUNER ON/OFF ──────────────────────────────────────────────

/** TUNER ON/OFF (function 0x11). */
export function buildSetTuner(on: boolean): number[] {
  return buildEnvelope(FN_TUNER_ON_OFF, [on ? 1 : 0]);
}

// ── 0x13 STATUS DUMP ───────────────────────────────────────────────

/**
 * STATUS DUMP (function 0x13). One-shot snapshot of the current
 * scene's state across all effect blocks in the preset. Response is
 * a sequence of `id id dd` triples — see `parseStatusDumpResponse`.
 */
export function buildStatusDump(): number[] {
  return buildEnvelope(FN_STATUS_DUMP, []);
}

// ── 0x14 SET/GET TEMPO ─────────────────────────────────────────────

/**
 * SET TEMPO (function 0x14). BPM as a 14-bit value (LS-first septet
 * pair). Range per spec is implicitly 0..16383; in practice the III
 * accepts ~30..250 BPM (front-panel range).
 */
export function buildSetTempo(bpm: number): number[] {
  if (!Number.isInteger(bpm) || bpm < 0 || bpm > 0x3fff) {
    throw new Error(`buildSetTempo: bpm ${bpm} out of range (0..16383)`);
  }
  return buildEnvelope(FN_SET_GET_TEMPO, encode14(bpm));
}

/** GET TEMPO (function 0x14 with `dd dd = 7F 7F`). */
export function buildGetTempo(): number[] {
  return buildEnvelope(FN_SET_GET_TEMPO, [QUERY_SENTINEL, QUERY_SENTINEL]);
}

// ── Response predicates + parsers ──────────────────────────────────

function isAxeFxIIIFrame(bytes: readonly number[], fn: number): boolean {
  if (bytes.length < 7) return false;
  if (bytes[0] !== SYSEX_START) return false;
  if (bytes[1] !== FRACTAL_MFR_PREFIX[0]) return false;
  if (bytes[2] !== FRACTAL_MFR_PREFIX[1]) return false;
  if (bytes[3] !== FRACTAL_MFR_PREFIX[2]) return false;
  if (bytes[4] !== AXE_FX_III_MODEL_ID) return false;
  if (bytes[5] !== fn) return false;
  if (bytes[bytes.length - 1] !== SYSEX_END) return false;
  return true;
}

/**
 * Decode an ASCII payload that's space- or null-padded. III name
 * responses are 32-char ASCII fields padded with spaces.
 */
function decodeName(bytes: readonly number[]): string {
  let end = bytes.length;
  while (end > 0) {
    const b = bytes[end - 1];
    if (b !== 0x00 && b !== 0x20) break;
    end -= 1;
  }
  return String.fromCharCode(...bytes.slice(0, end));
}

export function isSetGetBypassResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_SET_GET_BYPASS);
}
export function isSetGetChannelResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_SET_GET_CHANNEL);
}
export function isSetGetSceneResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_SET_GET_SCENE);
}
export function isQueryPatchNameResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_QUERY_PATCH_NAME);
}
export function isQuerySceneNameResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_QUERY_SCENE_NAME);
}
export function isSetGetLooperResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_SET_GET_LOOPER);
}
export function isStatusDumpResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_STATUS_DUMP);
}
export function isSetGetTempoResponse(bytes: readonly number[]): boolean {
  return isAxeFxIIIFrame(bytes, FN_SET_GET_TEMPO);
}

/**
 * Parse a 0x0A SET/GET BYPASS response. Payload is `[id_lo, id_hi, dd]`.
 */
export function parseBypassResponse(bytes: readonly number[]): {
  effectId: number;
  bypassed: boolean;
} {
  if (!isSetGetBypassResponse(bytes)) {
    throw new Error(`parseBypassResponse: not a 0x0A frame (len=${bytes.length})`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length < 3) throw new Error(`parseBypassResponse: payload too short`);
  return {
    effectId: decode14(payload[0], payload[1]),
    bypassed: (payload[2] & 0x01) !== 0,
  };
}

/** Parse a 0x0B SET/GET CHANNEL response. */
export function parseChannelResponse(bytes: readonly number[]): {
  effectId: number;
  channel: number;
} {
  if (!isSetGetChannelResponse(bytes)) {
    throw new Error(`parseChannelResponse: not a 0x0B frame`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length < 3) throw new Error(`parseChannelResponse: payload too short`);
  return {
    effectId: decode14(payload[0], payload[1]),
    channel: payload[2] & 0x07,
  };
}

/** Parse a 0x0C SET/GET SCENE response. Payload is `[scene]`. */
export function parseSceneResponse(bytes: readonly number[]): { scene: number } {
  if (!isSetGetSceneResponse(bytes)) {
    throw new Error(`parseSceneResponse: not a 0x0C frame`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length < 1) throw new Error('parseSceneResponse: empty payload');
  return { scene: payload[0] & 0x07 };
}

/**
 * Parse a 0x0D QUERY PATCH NAME response.
 *
 *   `F0 00 01 74 10 0D [nn nn preset#] [dd*32 name] [cs] F7`
 *
 * Returns both the preset number AND the 32-char name (trimmed).
 */
export function parseQueryPatchNameResponse(bytes: readonly number[]): {
  presetNumber: number;
  name: string;
} {
  if (!isQueryPatchNameResponse(bytes)) {
    throw new Error(`parseQueryPatchNameResponse: not a 0x0D frame (len=${bytes.length})`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length < 2) {
    throw new Error(`parseQueryPatchNameResponse: payload too short (${payload.length}B)`);
  }
  const presetNumber = decode14(payload[0], payload[1]);
  const name = decodeName(payload.slice(2));
  return { presetNumber, name };
}

/**
 * Parse a 0x0E QUERY SCENE NAME response.
 *
 *   `F0 00 01 74 10 0E [nn scene] [dd*32 name] [cs] F7`
 */
export function parseQuerySceneNameResponse(bytes: readonly number[]): {
  scene: number;
  name: string;
} {
  if (!isQuerySceneNameResponse(bytes)) {
    throw new Error(`parseQuerySceneNameResponse: not a 0x0E frame`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length === 0) throw new Error('parseQuerySceneNameResponse: empty payload');
  const scene = payload[0] & 0x07;
  const name = decodeName(payload.slice(1));
  return { scene, name };
}

/**
 * Parse a 0x0F SET/GET LOOPER STATE response. dd is a bitfield:
 * bit0=Record, 1=Play, 2=Overdub, 3=Once, 4=Reverse, 5=Half-speed.
 */
export interface LooperState {
  recording: boolean;
  playing: boolean;
  overdubbing: boolean;
  once: boolean;
  reverse: boolean;
  halfSpeed: boolean;
  raw: number;
}

export function parseLooperStateResponse(bytes: readonly number[]): LooperState {
  if (!isSetGetLooperResponse(bytes)) {
    throw new Error(`parseLooperStateResponse: not a 0x0F frame`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length === 0) throw new Error('parseLooperStateResponse: empty payload');
  const dd = payload[0] & 0x7f;
  return {
    recording:    (dd & 0x01) !== 0,
    playing:      (dd & 0x02) !== 0,
    overdubbing:  (dd & 0x04) !== 0,
    once:         (dd & 0x08) !== 0,
    reverse:      (dd & 0x10) !== 0,
    halfSpeed:    (dd & 0x20) !== 0,
    raw: dd,
  };
}

/** Parse a 0x14 SET/GET TEMPO response. Payload is the BPM as a septet pair. */
export function parseTempoResponse(bytes: readonly number[]): { bpm: number } {
  if (!isSetGetTempoResponse(bytes)) {
    throw new Error(`parseTempoResponse: not a 0x14 frame`);
  }
  const payload = bytes.slice(6, -2);
  if (payload.length < 2) throw new Error('parseTempoResponse: payload too short');
  return { bpm: decode14(payload[0], payload[1]) };
}

/**
 * One block's row in a STATUS_DUMP response.
 *
 * Per v1.4 PDF: `dd` bit 0 = bypass, bits 3:1 = channel (0..7; current
 * max is 3), bits 6:4 = number of channels supported (0..7).
 */
export interface StatusDumpEntry {
  /** 14-bit effect ID per v1.4 PDF Appendix 1. */
  effectId: number;
  /** True if the block is bypassed in the active scene. */
  bypassed: boolean;
  /** Current channel index (0..7). Most blocks expose 2 or 4 channels. */
  channel: number;
  /** Number of channels this block supports (0..7). */
  channelCount: number;
}

/**
 * Parse a 0x13 STATUS_DUMP response into a list of per-block entries.
 *
 * Wire shape per v1.4 PDF:
 *   `F0 00 01 74 10 13 [id id dd]* [cs] F7`
 */
export function parseStatusDumpResponse(bytes: readonly number[]): StatusDumpEntry[] {
  if (!isStatusDumpResponse(bytes)) {
    throw new Error(
      `parseStatusDumpResponse: not a valid 0x13 frame (len=${bytes.length})`,
    );
  }
  const payload = bytes.slice(6, -2);
  if (payload.length % 3 !== 0) {
    throw new Error(
      `parseStatusDumpResponse: payload length ${payload.length} not a ` +
        'multiple of 3 — STATUS_DUMP frames are id-id-dd triples.',
    );
  }
  const entries: StatusDumpEntry[] = [];
  for (let i = 0; i < payload.length; i += 3) {
    const idLo = payload[i] & 0x7f;
    const idHi = payload[i + 1] & 0x7f;
    const dd = payload[i + 2] & 0x7f;
    entries.push({
      effectId: decode14(idLo, idHi),
      bypassed: (dd & 0x01) !== 0,
      channel: (dd >> 1) & 0x07,
      channelCount: (dd >> 4) & 0x07,
    });
  }
  return entries;
}
