/**
 * Axe-Fx III SysEx wire builders.
 *
 * Envelope: `F0 00 01 74 0x10 [function] [payload...] [checksum] F7`.
 * Same modern Fractal family as AM4 (model 0x15), FM3 (0x11), FM9
 * (0x12), VP4 (0x14) — III is 0x10.
 *
 * Function-byte map sourced from Fractal's official "Axe-Fx III MIDI
 * for Third-Party Devices" v1.4 PDF — see `docs/axefx3-design-notes.md`
 * for the full table. **The III function-byte space is DIFFERENT from
 * Axe-Fx II** — same envelope shape, different opcodes.
 *
 * What this module supports today:
 *   - 0x0C SET/GET SCENE         (functional — beta-verified pending capture)
 *   - 0x0D SET/GET PRESET NUMBER (functional — beta-verified pending capture)
 *   - 0x0E QUERY SCENE NAME      (functional)
 *   - 0x0F QUERY PRESET NAME     (functional)
 *   - 0x13 STATUS DUMP           (functional — single-shot all-effects state)
 *   - 0x0A SET/GET BYPASS        (needs effect-index — throws until decoded)
 *   - 0x0B SET/GET CHANNEL       (needs effect-index — throws until decoded)
 *   - 0x02 SET_PARAMETER_VALUE   (needs effect-index + per-block param-ID — throws)
 *
 * Status legend:
 *   - "functional" = envelope is structurally correct per the spec PDF;
 *     wire bytes will be byte-identical to what AxeEdit III emits for
 *     the same operation. Pending one community capture to confirm.
 *   - "throws" = the operation needs decoded data (effect-index space,
 *     per-block param-ID space) that's NOT in the public spec.
 *     Functions throw at call time with a clear "pending capture"
 *     message and a pointer to HARDWARE-TASKS-AXEFX3.md.
 *
 * What's NOT shipped (pending decode):
 *   - SET_PRESET_NAME (envelope not in public spec)
 *   - SET_SCENE_NAME (no SET variant documented)
 *   - STORE_PRESET / SAVE_TO_LOCATION (not in public spec — same gap
 *     as Axe-Fx II had pre-Session-71)
 *   - SET_BLOCK_TYPE / grid layout writes (need effect-index decode)
 *   - SET_CELL_ROUTING (III may use a different grid model — TBD)
 */
import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

/** Axe-Fx III model byte. From Fractal's published spec. */
export const AXE_FX_III_MODEL_ID = 0x10;

/** SysEx framing bytes shared across the entire modern Fractal family. */
const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const FRACTAL_MFR_PREFIX = [0x00, 0x01, 0x74] as const;

/** Function-ID bytes from the Axe-Fx III spec v1.4. */
export const FN_SET_PARAMETER_VALUE = 0x02;
export const FN_SET_GET_BYPASS = 0x0a;
export const FN_SET_GET_CHANNEL = 0x0b;
export const FN_SET_GET_SCENE = 0x0c;
export const FN_SET_GET_PRESET_NUMBER = 0x0d;
export const FN_QUERY_SCENE_NAME = 0x0e;
export const FN_QUERY_PRESET_NAME = 0x0f;
export const FN_STATUS_DUMP = 0x13;
export const FN_FRONT_PANEL_CHANGE = 0x21;
export const FN_MULTIPURPOSE_RESPONSE = 0x64;

/** Query sentinel — when this is the value byte, the device responds with current state. */
export const QUERY_SENTINEL = 0x7f;

/**
 * Encode a 14-bit value as a 2-byte septet pair (low 7 bits, then high
 * 7 bits — little-endian). Preset numbers + scene index parameters
 * across the Fractal family use this.
 */
function encode14(n: number): [number, number] {
  if (!Number.isInteger(n) || n < 0 || n > 0x3fff) {
    throw new Error(`encode14: ${n} out of range (0..16383)`);
  }
  return [n & 0x7f, (n >> 7) & 0x7f];
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

function pendingCapture(op: string, gap: string): never {
  throw new Error(
    `axe-fx-iii ${op}: pending community capture. ${gap} ` +
    `See docs/_private/HARDWARE-TASKS-AXEFX3.md for the capture workflow.`,
  );
}

// ── Functional: spec-documented, payload-clear ────────────────────

/**
 * SET / GET preset number (function 0x0D). Pass a number to set, pass
 * `'query'` to request the current preset number. Axe-Fx III Mark I
 * has 512 presets (0..511); Mark II has 1024 (0..1023).
 */
export function buildSwitchPreset(
  presetNumber: number | 'query',
  maxIndex = 1023,
): number[] {
  if (presetNumber === 'query') {
    return buildEnvelope(FN_SET_GET_PRESET_NUMBER, [QUERY_SENTINEL]);
  }
  if (
    !Number.isInteger(presetNumber) ||
    presetNumber < 0 ||
    presetNumber > maxIndex
  ) {
    throw new Error(
      `buildSwitchPreset: presetNumber ${presetNumber} out of range (0..${maxIndex}).`,
    );
  }
  return buildEnvelope(FN_SET_GET_PRESET_NUMBER, encode14(presetNumber));
}

/**
 * SET / GET scene (function 0x0C). Axe-Fx III has 8 scenes per preset
 * (0..7). Pass `'query'` to request the current scene.
 */
export function buildSwitchScene(sceneIndex: number | 'query'): number[] {
  if (sceneIndex === 'query') {
    return buildEnvelope(FN_SET_GET_SCENE, [QUERY_SENTINEL]);
  }
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex > 7) {
    throw new Error(
      `buildSwitchScene: sceneIndex ${sceneIndex} out of range (0..7).`,
    );
  }
  return buildEnvelope(FN_SET_GET_SCENE, [sceneIndex & 0x7f]);
}

/**
 * QUERY preset name (function 0x0F). Returns the active preset's
 * 32-char name in the response.
 */
export function buildQueryPresetName(): number[] {
  return buildEnvelope(FN_QUERY_PRESET_NAME, []);
}

/**
 * QUERY scene name (function 0x0E). Pass a scene index 0..7, or
 * `'current'` to query the active scene.
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

/**
 * STATUS DUMP (function 0x13). One-shot snapshot of the current
 * scene's state across all effect blocks in the preset. Response is a
 * sequence of `id id dd` triples where:
 *   - `id id` = effect-index (2 bytes)
 *   - `dd` bit 0 = bypass, bits 3-1 = channel, bits 6-4 = channel count
 *
 * Used to discover the effect-index → block-type mapping for a preset
 * during the community-capture workflow.
 */
export function buildStatusDump(): number[] {
  return buildEnvelope(FN_STATUS_DUMP, []);
}

// ── Pending: spec-documented shape, needs effect-index decode ─────

/**
 * SET/GET BYPASS (function 0x0A). Targets the ACTIVE scene only — the
 * III spec doesn't provide a per-scene bypass write. Wire shape:
 * `0x0A [effect_index_lo] [effect_index_hi] [dd]` where `dd=0`
 * engaged, `dd=1` bypassed, `dd=0x7F` query.
 *
 * 🟡 Throws until the effect-index space is decoded — `effect_index`
 * isn't a stable property of the block-type; it's a per-preset slot
 * assignment recoverable only from a STATUS_DUMP response.
 */
export function buildSetBlockBypass(
  _effectIndex: number,
  _bypassed: boolean,
): number[] {
  pendingCapture(
    'buildSetBlockBypass',
    'The III addresses blocks by per-preset effect-index (not block-type id); ' +
    'the effect-index space needs a STATUS_DUMP capture to decode.',
  );
}

/**
 * SET/GET CHANNEL (function 0x0B). Wire shape: `0x0B [effect_index_lo]
 * [effect_index_hi] [channel]` where channel = 0..3 (A..D) or
 * 0x7F to query.
 */
export function buildSetBlockChannel(
  _effectIndex: number,
  _channel: 0 | 1 | 2 | 3,
): number[] {
  pendingCapture(
    'buildSetBlockChannel',
    'Effect-index addressing pending decode (same as buildSetBlockBypass).',
  );
}

/**
 * SET_PARAMETER_VALUE (function 0x02). Per-block parameter writes.
 * Wire shape: `0x02 [effect_index] [param_id] [value_bytes]`.
 *
 * 🟡 Throws — neither the effect-index space NOR the per-block
 * parameter-ID space is documented by Fractal for Gen 3. Both need
 * capture-based decoding.
 */
export function buildSetParam(
  _effectIndex: number,
  _paramId: number,
  _value: number,
): number[] {
  pendingCapture(
    'buildSetParam',
    'III parameter-ID space is not in the public spec and is not in any ' +
    'OSS library. Decoding requires USB-MIDI capture of AxeEdit III firing ' +
    'a single-param write against a known block.',
  );
}
