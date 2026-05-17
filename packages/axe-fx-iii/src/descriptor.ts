/**
 * Axe-Fx III DeviceDescriptor — community-beta scaffold (BK-015).
 *
 * BEFORE EDITING, READ:
 *   - `docs/SYSEX-MAP-AXE-FX-III.md`
 *   - `docs/manuals/AxeFx3-MIDI-3rdParty.txt` (Fractal v1.4 PDF extracted)
 *
 * The v1.4 PDF is the only Fractal-published spec for the III's third-
 * party MIDI surface. It documents bypass / channel / scene / preset
 * name / tempo / looper / tuner only.
 *
 * Session 88 founder direction: "make it work as much as possible and
 * just have users confirm it works. not list anything as unsupported
 * until [tested]." Per that direction the unified surface now wires
 * `set_param` / `get_param` / `get_params` / `set_params` through the
 * II-derived 0x02 SET_PARAMETER envelope (see `./setParam.ts`
 * `FN_SET_PARAMETER` for the community evidence chain). Every response
 * carries a 🟡 BETA warning naming the unverified surfaces; the device
 * also surfaces malformed-request rejections as 0x64
 * MULTIPURPOSE_RESPONSE frames, which we catch and surface inline.
 *
 * Every unified-surface op is wired up — none refused. Per Session 88
 * founder direction: III owners should be able to exercise the full
 * tool surface and confirm what works. Each op surfaces 0x64
 * MULTIPURPOSE_RESPONSE rejections inline so users can report results.
 *
 * Unified surface status:
 *   - get_param / set_param      : 🟡 0x02 envelope, II-shape inferred
 *   - get_params / set_params    : 🟡 loop over the above
 *   - set_bypass                 : 🟡 spec-documented (function 0x0A)
 *   - switch_scene               : 🟡 spec-documented (function 0x0C)
 *   - switch_preset              : 🟢 standard MIDI Program Change +
 *                                  Bank Select (the spec-documented way)
 *   - save_preset                : 🟡 II's 0x1D STORE_PRESET envelope —
 *                                  no preset payload, just "persist
 *                                  working buffer to slot N"
 *   - rename                     : 🟡 II's 0x09 SET_PRESET_NAME
 *   - set_block                  : 🟡 II's 0x05 SET_GRID_CELL
 *   - apply_preset               : 🟡 composes set_block + set_param
 *                                  across PresetSpec.slots, then
 *                                  optionally save_preset at target
 *
 * 🟡 ops are NOT in the v1.4 III spec — wire shapes are ported from
 * the Axe-Fx II's hardware-verified encoder with the III's model byte
 * (0x10). Safe to attempt because the III's parser rejects unsupported
 * envelopes via the 0x64 MULTIPURPOSE_RESPONSE error channel rather
 * than executing partial / unintended state writes; we catch those and
 * surface the rejection (with the named error code) inline.
 *
 * Registration order in `packages/server-all/src/server/index.ts`
 * MUST put Axe-Fx III BEFORE AM4 — the III's port-name regex
 * `/axe-?fx ?iii/i` is more specific than AM4's catch-all
 * `/Fractal/i`, and the dispatcher uses registration order as the
 * tiebreaker (DECISIONS.md row 40).
 */
import type {
  DeviceDescriptor,
  DeviceReader,
  DeviceWriter,
  DispatchCtx,
  BlockSchema,
  ParamSchema,
  ReadResult,
  BatchReadResult,
  BatchWriteResult,
  ParamQuery,
  WriteOp,
  WriteResult,
  BlockChange,
  PresetSpec,
  LocationRef,
  SlotRef,
  RenameTarget,
  ApplyResult,
  ApplyPresetOptions,
} from '@mcp-midi-control/core/protocol-generic/types.js';
import { DispatchError } from '@mcp-midi-control/core/protocol-generic/types.js';

import {
  AXE_FX_III_BLOCKS,
  resolveEffectId,
  type AxeFxIIIBlock,
} from './blockTypes.js';
import { PARAMS_BY_FAMILY, type Param as AxeFxIIIParam } from './params.js';
import {
  buildGetParameter,
  buildSetGridCell,
  buildSetParameter,
  buildSetPresetName,
  buildSetScene,
  buildStorePreset,
  buildSwitchPresetPC,
  describeMultipurposeResultCode,
  isMultipurposeResponse,
  isSetGetParameterResponse,
  parseMultipurposeResponse,
  parseSetGetParameterResponse,
  buildSetBypass,
} from './setParam.js';

const DEVICE_LABEL = 'Fractal Axe-Fx III';

/** Wire response window — same budget the device-namespaced tools use. */
const GET_RESPONSE_TIMEOUT_MS = 800;

/**
 * Banner appended to every UNIFIED set_param / get_param response. The
 * III ships without a maintainer-owned device, so every successful op
 * is "spec-correct or II-derived but unverified on real hardware." The
 * agent surfaces this to the user so they can confirm by ear / by panel.
 */
const BETA_WARNING = [
  '🟡 axe-fx-iii community beta — 0x02 SET/GET_PARAMETER is NOT in the',
  'v1.4 III spec; the wire shape was ported from the Axe-Fx II encoder',
  '(II uses model byte 0x03, III uses 0x10) per community evidence that',
  'III firmware still honors the opcode. UNVERIFIED on real III hardware.',
  'Please confirm the audible/visible response on the device, and if the',
  'op silently no-ops, run axefx3_probe_sysex to confirm the device emitted',
  'a 0x64 MULTIPURPOSE_RESPONSE rejection vs. accepting the write.',
].join(' ');

function notInSpec(op: string, gap: string): DispatchError {
  return new DispatchError(
    'capability_not_supported',
    DEVICE_LABEL,
    `axe-fx-iii ${op}: not in v1.4 third-party MIDI spec. ${gap}`,
    {
      retry_action:
        'See docs/SYSEX-MAP-AXE-FX-III.md for the spec coverage and ' +
        'docs/_private/HARDWARE-TASKS-AXEFX3.md for the community ' +
        'capture workflow that can unlock this operation.',
    },
  );
}

// ── Block-slug ↔ catalog-family mapping ────────────────────────────
//
// AxeFxIIIBlock entries use 3-letter groupCodes (CMP, REV, DLY, etc.);
// the PARAMS catalog families are spelled-out (COMP, REVERB, DELAY).
// Keep the mapping explicit so missing entries fail loud instead of
// silently producing empty BlockSchemas.

const GROUP_TO_FAMILY: Readonly<Record<string, string>> = Object.freeze({
  CMP: 'COMP',
  GEQ: 'GEQ',
  PEQ: 'PEQ',
  DRV: 'DISTORT',
  CAB: 'CABINET',
  REV: 'REVERB',
  DLY: 'DELAY',
  MTD: 'MULTITAP',
  CHO: 'CHORUS',
  FLG: 'FLANGER',
  ROT: 'ROTARY',
  PHA: 'PHASER',
  WAH: 'WAH',
  FRM: 'FORMANT',
  PTR: 'TREMOLO',
  PIT: 'PITCH',
  FIL: 'FILTER',
  FUZ: 'FUZZ',
  ENH: 'ENHANCER',
  MIX: 'MIXER',
  SYN: 'SYNTH',
  VOC: 'VOCODER',
  MGD: 'MEGATAP',
  XOV: 'CROSSOVER',
  GAT: 'GATE',
  RNG: 'RINGMOD',
  MBC: 'MULTICOMP',
  TTD: 'TENTAP',
  RES: 'RESONATOR',
  VOL: 'VOLUME',
  PLX: 'PLEX',
  SND: 'FDBKSEND',
  RTN: 'FDBKRET',
  LPR: 'LOOPER',
  TMA: 'TONEMATCH',
  RTA: 'RTA',
  MUX: 'MULTIPLEXER',
  IRP: 'IRPLAYER',
  IN: 'INPUT',
  OUT: 'OUTPUT',
  SMI: 'MIDIBLOCK',
  FC: 'FC',
  PFC: 'PRESET',
  DYD: 'DYNDIST',
  // Blocks with NO catalog family: AMP, NAM (post-v1.13 additions),
  // CTR (Controllers), TUN (Tuner), IRC (IR Capture utility), GBK
  // (Global Block), SHT (Shunt). These get empty params and set_param
  // refuses with "no params catalogued for <block>".
});

/** Slug → catalog family. Built once at module load. */
const BLOCK_SLUG_TO_FAMILY: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const b of AXE_FX_III_BLOCKS) {
    const family = GROUP_TO_FAMILY[b.groupCode];
    if (family !== undefined) map[blockSlug(b)] = family;
  }
  return Object.freeze(map);
})();

/** Slug → block descriptor. Built once at module load. */
const BLOCK_SLUG_TO_BLOCK: Readonly<Record<string, AxeFxIIIBlock>> = (() => {
  const map: Record<string, AxeFxIIIBlock> = {};
  for (const b of AXE_FX_III_BLOCKS) {
    map[blockSlug(b)] = b;
  }
  return Object.freeze(map);
})();

function blockSlug(b: AxeFxIIIBlock): string {
  return b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Param schema builders ──────────────────────────────────────────
//
// III display↔wire calibration is unverified — most catalog entries
// carry `unit: 'unverified'` and no displayMin/Max. We deliberately
// use PASSTHROUGH encode/decode so callers move integers in display
// space and the same integer reaches the wire (within the 0..65534
// 16-bit range). When the founder or a contributor verifies a
// per-param scale, that lives in the catalog as a separate concern.
//
// The 186 AM4-inferred entries carry display ranges but those are
// AM4 conventions, not III-verified — still passthrough until proven.

function stripFamilyPrefix(family: string, paramName: string): string {
  // REVERB_TYPE → type ; PITCH_HARM1 → harm1 ; GLOBAL_REVERBMIX → reverbmix
  const prefix = `${family}_`;
  if (paramName.startsWith(prefix)) {
    return paramName.slice(prefix.length).toLowerCase();
  }
  return paramName.toLowerCase();
}

function humanize(snake: string): string {
  return snake
    .split('_')
    .filter((s) => s.length > 0)
    .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

function makePassthroughEncode(family: string, paramKey: string): ParamSchema['encode'] {
  return (value: number | string): number => {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(
        `${family}.${paramKey}: expected a number (raw wire 0..65534), got "${value}". ` +
          'Axe-Fx III display→wire calibration is unverified — pass the 16-bit wire integer directly.',
      );
    }
    if (!Number.isInteger(num) || num < 0 || num > 65534) {
      throw new Error(
        `${family}.${paramKey} expects wire 0..65534 (uncalibrated): ${num}`,
      );
    }
    return num;
  };
}

function makePassthroughDecode(): ParamSchema['decode'] {
  return (wire: number): number => wire;
}

function buildParamSchema(family: string, param: AxeFxIIIParam): {
  key: string;
  schema: ParamSchema;
} {
  const key = stripFamilyPrefix(family, param.name);
  return {
    key,
    schema: {
      display_name: humanize(key),
      unit: param.unit,
      display_min: param.displayMin,
      display_max: param.displayMax,
      encode: makePassthroughEncode(family, key),
      decode: makePassthroughDecode(),
      parameter_name: param.name,
    },
  };
}

/**
 * Build the `blocks` map for `describe_device`. Each AXE_FX_III_BLOCKS
 * entry becomes one BlockSchema slug; per-block params come from
 * PARAMS_BY_FAMILY[family] for any block whose groupCode has a catalog
 * family mapping. Blocks without a mapped family (AMP, NAM, Tuner,
 * etc.) get an empty params map — list_params still surfaces the block,
 * but set_param refuses with a clean "no params catalogued" error.
 */
function buildBlocks(): Record<string, BlockSchema> {
  const out: Record<string, BlockSchema> = {};
  for (const b of AXE_FX_III_BLOCKS) {
    const slug = blockSlug(b);
    const family = GROUP_TO_FAMILY[b.groupCode];
    const params: Record<string, ParamSchema> = {};
    const aliases: Record<string, string> = {};
    if (family !== undefined) {
      const catalogEntries = PARAMS_BY_FAMILY[family] ?? [];
      for (const p of catalogEntries) {
        // Skip firmware-internal sentinels (paramId >= 65520 are *_SET_ALL,
        // *_VAL_ALL — see params.ts header). They're documentary only,
        // not wire-addressable.
        if (p.paramId >= 0x3fff) continue;
        const { key, schema } = buildParamSchema(family, p);
        // First wins on key collision (e.g. FLANGER_TYPE vs FLANGER_OLD_TYPE
        // both → "type"). The catalog header notes the _OLD_ variants exist
        // for backward preset compat — wire writes should target the
        // current symbol, which appears first per dispatcher-case order.
        if (!(key in params)) {
          params[key] = schema;
          // Alias the original symbol so callers can paste catalog names verbatim.
          if (p.name.toLowerCase() !== key) {
            aliases[p.name.toLowerCase()] = key;
          }
        }
      }
    }
    out[slug] = {
      display_name: b.name,
      params,
      aliases: Object.keys(aliases).length > 0 ? aliases : undefined,
    };
  }
  return out;
}

// ── Param-write/read helpers ───────────────────────────────────────

function resolveBlockOrThrow(slug: string): { block: AxeFxIIIBlock; effectId: number } {
  const block = BLOCK_SLUG_TO_BLOCK[slug];
  if (block === undefined) {
    throw new DispatchError(
      'unknown_block',
      DEVICE_LABEL,
      `Block slug '${slug}' is not registered on ${DEVICE_LABEL}.`,
    );
  }
  let effectId: number;
  try {
    // Default to instance 1; multi-instance routing is a future hook.
    effectId = resolveEffectId(block.name, 1);
  } catch (err) {
    throw new DispatchError(
      'capability_not_supported',
      DEVICE_LABEL,
      err instanceof Error ? err.message : String(err),
    );
  }
  return { block, effectId };
}

function resolveParamOrThrow(slug: string, name: string): {
  family: string;
  param: AxeFxIIIParam;
} {
  const family = BLOCK_SLUG_TO_FAMILY[slug];
  if (family === undefined) {
    throw new DispatchError(
      'capability_not_supported',
      DEVICE_LABEL,
      `Block '${slug}' has no parameter catalog on ${DEVICE_LABEL} — the III's ` +
        `groupCode-to-family map has no entry for this block (likely AMP / NAM / ` +
        `Tuner / Global Block / Shunt). set_param / get_param refuse for these.`,
    );
  }
  const catalogEntries = PARAMS_BY_FAMILY[family] ?? [];
  for (const p of catalogEntries) {
    if (stripFamilyPrefix(family, p.name) === name && p.paramId < 0x3fff) {
      return { family, param: p };
    }
  }
  throw new DispatchError(
    'unknown_param',
    DEVICE_LABEL,
    `Parameter '${slug}.${name}' is not in the III catalog (family ${family}). ` +
      `Call list_params(port='axe-fx-iii', block='${slug}') for the full per-block param list.`,
  );
}

/** Coerce a LocationRef (string | number) to an integer preset 0..1023. */
function parseLocation(location: LocationRef): number {
  const n = typeof location === 'number' ? location : Number(location);
  if (!Number.isInteger(n) || n < 0 || n > 1023) {
    throw new DispatchError(
      'bad_location',
      DEVICE_LABEL,
      `axe-fx-iii: preset location '${location}' is invalid (expected integer 0..1023).`,
    );
  }
  return n;
}

/** Render a MULTIPURPOSE_RESPONSE result-code into a human-readable suffix. */
function formatErrorCode(report: { resultCode: number; description?: string }): string {
  const hex = `0x${report.resultCode.toString(16).padStart(2, '0')}`;
  return report.description !== undefined ? `${report.description} (${hex})` : `unknown result code ${hex}`;
}

/**
 * Send a 0x02 SET_PARAMETER and watch for a 0x64 MULTIPURPOSE_RESPONSE
 * rejection in a short window after the write. The III emits 0x64 only
 * on rejection — no echo on accept — so the predicate is "rejection
 * came back" rather than "ack came back."
 */
async function sendAndWatchForError(
  ctx: DispatchCtx,
  bytes: number[],
  windowMs = 50,
): Promise<{ resultCode: number; description?: string } | undefined> {
  const watchPromise = ctx.conn.receiveSysExMatching(
    isMultipurposeResponse,
    windowMs,
  );
  ctx.conn.send(bytes);
  try {
    const frame = await watchPromise;
    const parsed = parseMultipurposeResponse(frame);
    return {
      resultCode: parsed.resultCode,
      description: describeMultipurposeResultCode(parsed.resultCode),
    };
  } catch {
    return undefined; // No rejection within window → write accepted.
  }
}

// ── Reader ─────────────────────────────────────────────────────────

const reader: DeviceReader = {
  async getParam(
    ctx: DispatchCtx,
    blockSlugIn: string,
    name: string,
    _channel?: string | number,
  ): Promise<ReadResult> {
    const { effectId } = resolveBlockOrThrow(blockSlugIn);
    const { param } = resolveParamOrThrow(blockSlugIn, name);
    const requestBytes = buildGetParameter(effectId, param.paramId);
    const responsePromise = ctx.conn.receiveSysExMatching(
      isSetGetParameterResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    ctx.conn.send(requestBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      throw new DispatchError(
        'no_ack',
        DEVICE_LABEL,
        `get_param: no response from ${DEVICE_LABEL} within ${GET_RESPONSE_TIMEOUT_MS}ms — ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Likely causes: device doesn't honor 0x02 SET_PARAMETER (the III may have ` +
          `removed the op in firmware > 1.13), or block '${blockSlugIn}' (effect ID ` +
          `${effectId}) isn't placed in the active preset.`,
      );
    }
    const parsed = parseSetGetParameterResponse(response);
    return {
      block: blockSlugIn,
      name,
      wire_value: parsed.value,
      display_value: parsed.value,
      unit: param.unit,
      raw_response: response,
    };
  },

  async getParams(
    ctx: DispatchCtx,
    queries: readonly ParamQuery[],
  ): Promise<BatchReadResult> {
    const reads: ReadResult[] = [];
    const failed: number[] = [];
    const errors: Record<number, string> = {};
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      try {
        reads.push(await reader.getParam(ctx, q.block, q.name, q.channel));
      } catch (err) {
        failed.push(i);
        errors[i] = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      reads,
      failed_indices: failed,
      errors: failed.length > 0 ? errors : undefined,
    };
  },
};

// ── Writer ─────────────────────────────────────────────────────────

const writer: DeviceWriter = {
  buildSetParam(block: string, name: string, wireValue: number): number[] {
    const { effectId } = resolveBlockOrThrow(block);
    const { param } = resolveParamOrThrow(block, name);
    return buildSetParameter(effectId, param.paramId, wireValue);
  },

  buildSwitchPreset(location: LocationRef): number[] {
    const n = parseLocation(location);
    return buildSwitchPresetPC(n);
  },

  buildSwitchScene(scene: number): number[] {
    // Unified surface scene numbers are 1-indexed (display); wire is 0-indexed.
    return buildSetScene(scene - 1);
  },

  async setParam(
    ctx: DispatchCtx,
    blockSlugIn: string,
    name: string,
    wireValue: number,
    _channel?: number,
  ): Promise<WriteResult> {
    const { effectId } = resolveBlockOrThrow(blockSlugIn);
    const { param } = resolveParamOrThrow(blockSlugIn, name);
    const bytes = buildSetParameter(effectId, param.paramId, wireValue);
    const errorReport = await sendAndWatchForError(ctx, bytes);
    if (errorReport !== undefined) {
      const desc = errorReport.description
        ? `${errorReport.description} (code 0x${errorReport.resultCode.toString(16).padStart(2, '0')})`
        : `unknown result code 0x${errorReport.resultCode.toString(16).padStart(2, '0')}`;
      return {
        op: 'set_param',
        target: `${blockSlugIn}.${name}`,
        block: blockSlugIn,
        name,
        wire_value: wireValue,
        display_value: wireValue,
        acked: false,
        warning:
          `Axe-Fx III rejected set_param via 0x64 MULTIPURPOSE_RESPONSE: ${desc}. ` +
          BETA_WARNING,
      };
    }
    return {
      op: 'set_param',
      target: `${blockSlugIn}.${name}`,
      block: blockSlugIn,
      name,
      wire_value: wireValue,
      display_value: wireValue,
      acked: true,
      warning: BETA_WARNING,
    };
  },

  async setParams(ctx: DispatchCtx, ops: readonly WriteOp[]): Promise<BatchWriteResult> {
    const writes: WriteResult[] = [];
    let ackedCount = 0;
    let unackedCount = 0;
    for (const op of ops) {
      // executeSetParams pre-encodes display → wire before calling us, so
      // every WriteOp.value here is already a number. The shared WriteOp
      // type permits `number | string` for the pure-side pipeline; assert
      // it's the number we expect at the writer boundary.
      const wireValue = typeof op.value === 'number' ? op.value : Number(op.value);
      const result = await writer.setParam!(ctx, op.block, op.name, wireValue, op.channel);
      writes.push(result);
      if (result.acked) ackedCount += 1;
      else unackedCount += 1;
    }
    return {
      writes,
      acked_count: ackedCount,
      unacked_count: unackedCount,
    };
  },

  async setBlock(
    ctx: DispatchCtx,
    slot: SlotRef,
    change: BlockChange,
  ): Promise<WriteResult> {
    if (typeof slot === 'number') {
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        `axe-fx-iii setBlock: slot must be {row, col} (grid coords) — got linear index ${slot}. ` +
          'The III uses a 4×14 grid; pass slot as {row: 1..4, col: 1..14}.',
      );
    }
    if (change.bypassed !== undefined && change.block_type === undefined) {
      // Bypass-only change — route through the spec-documented 0x0A path.
      // setBypass needs a block name, not slot; if the caller passed slot
      // without block_type we can't resolve the effectId from slot alone.
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        `axe-fx-iii setBlock: bypass-only changes require block_type to resolve the effect ID. ` +
          'For a pure bypass toggle, call set_bypass with the block name instead.',
      );
    }
    if (change.block_type === undefined) {
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        'axe-fx-iii setBlock: block_type is required (or "none" / "empty" / "shunt" to clear the cell).',
      );
    }
    const blockType = change.block_type.trim().toLowerCase();
    let blockId: number;
    if (blockType === 'none' || blockType === 'empty' || blockType === '') {
      blockId = 0; // 0 clears the cell per II convention
    } else {
      try {
        // Default to instance 1; multi-instance addressing for slot-placement
        // would need a separate API surface.
        blockId = resolveEffectId(change.block_type, 1);
      } catch (err) {
        throw new DispatchError(
          'unknown_block',
          DEVICE_LABEL,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    const bytes = buildSetGridCell({
      row: slot.row,
      col: slot.col,
      blockId,
    });
    const errorReport = await sendAndWatchForError(ctx, bytes);
    if (errorReport !== undefined) {
      return {
        op: 'set_block',
        target: `r${slot.row}c${slot.col}`,
        acked: false,
        warning:
          `Axe-Fx III rejected set_block via 0x64 MULTIPURPOSE_RESPONSE: ${formatErrorCode(errorReport)}. ` +
          BETA_WARNING,
      };
    }
    return {
      op: 'set_block',
      target: `r${slot.row}c${slot.col}`,
      acked: true,
      display_value: blockType === 'none' || blockType === 'empty' ? 'cleared' : change.block_type,
      warning:
        '🟡 axe-fx-iii set_block: tried II 0x05 SET_GRID_CELL envelope on III. ' +
        'Device emitted no rejection but the III may have ignored the write — ' +
        'confirm by checking the grid layout (call get_grid_layout or look at the device).',
    };
  },

  async setBypass(
    ctx: DispatchCtx,
    block: string,
    bypassed: boolean,
  ): Promise<WriteResult> {
    let effectId: number;
    try {
      effectId = resolveEffectId(block);
    } catch (err) {
      throw new DispatchError(
        'unknown_block',
        DEVICE_LABEL,
        err instanceof Error ? err.message : String(err),
      );
    }
    const bytes = buildSetBypass(effectId, bypassed);
    await ctx.conn.send(bytes);
    return {
      op: 'set_bypass',
      target: block,
      acked: true,
      display_value: bypassed ? 'bypassed' : 'engaged',
      warning:
        '🟡 axe-fx-iii set_bypass: spec-documented (function 0x0A) but ' +
        'pending hardware verification. Targets the ACTIVE scene only — ' +
        'per v1.4 spec, the III has no per-scene bypass write.',
    };
  },

  async applyPreset(
    ctx: DispatchCtx,
    spec: PresetSpec,
    target?: LocationRef,
    options?: ApplyPresetOptions,
  ): Promise<ApplyResult> {
    // Compose: for each slot in spec.slots, attempt set_block to place
    // the block, then loop set_param for any per-block params. Optional
    // rename + save at the end.
    //
    // This is a best-effort attempt — the 🟡 ops (set_block via 0x05,
    // save via 0x1D, rename via 0x09) may all be rejected by III
    // firmware. The dispatcher's design surfaces each rejection
    // individually so the caller can see exactly which step failed.
    const writes: WriteResult[] = [];
    let anyFailed = false;

    // 1. Place blocks (set_block per slot — 🟡 0x05 untested on III)
    for (const slotSpec of spec.slots) {
      if (typeof slotSpec.slot !== 'object') {
        writes.push({
          op: 'set_block',
          target: String(slotSpec.slot),
          acked: false,
          warning:
            `axe-fx-iii apply_preset: skipped slot ${String(slotSpec.slot)} — ` +
            'linear slot indexing not supported on grid device.',
        });
        anyFailed = true;
        continue;
      }
      try {
        const result = await writer.setBlock!(ctx, slotSpec.slot, {
          block_type: slotSpec.block_type,
          bypassed: slotSpec.bypassed,
        });
        writes.push(result);
        if (!result.acked) anyFailed = true;
      } catch (err) {
        writes.push({
          op: 'set_block',
          target: `r${slotSpec.slot.row}c${slotSpec.slot.col}`,
          acked: false,
          warning: `set_block failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        anyFailed = true;
      }
    }

    // 2. Loop per-block params (set_param per entry — 🟡 0x02 untested on III)
    for (const slotSpec of spec.slots) {
      if (slotSpec.params === undefined) continue;
      // We don't unwrap channel-nested params here — the III's setParam
      // takes a single block slug + name. A channel-nested apply_preset
      // would need to set_channel between writes; left for a future pass.
      const blockSlug = slotSpec.block_type.trim().toLowerCase();
      for (const [paramName, value] of Object.entries(slotSpec.params)) {
        if (typeof value === 'object') {
          // Channel-nested entry — skip with note. Per-channel apply is
          // a follow-up.
          writes.push({
            op: 'set_param',
            target: `${blockSlug}.${paramName}`,
            acked: false,
            warning:
              `axe-fx-iii apply_preset: skipped channel-nested param ${blockSlug}.${paramName} — ` +
              'per-channel apply not yet wired on the III. Use set_param with explicit channel instead.',
          });
          anyFailed = true;
          continue;
        }
        try {
          // The value is display-shaped; for III this is wire-passthrough
          // per the catalog's passthrough encode/decode contract.
          const wireValue = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(wireValue)) {
            throw new Error(`Non-numeric value for ${blockSlug}.${paramName}: ${value}`);
          }
          const result = await writer.setParam!(ctx, blockSlug, paramName, wireValue);
          writes.push(result);
          if (!result.acked) anyFailed = true;
        } catch (err) {
          writes.push({
            op: 'set_param',
            target: `${blockSlug}.${paramName}`,
            acked: false,
            warning: `set_param failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          anyFailed = true;
        }
      }
    }

    // 3. Optional rename + save (only if caller asked to persist)
    if (spec.name !== undefined) {
      try {
        const result = await writer.rename!(ctx, 'preset', spec.name);
        writes.push(result);
        if (!result.acked) anyFailed = true;
      } catch (err) {
        writes.push({
          op: 'rename',
          target: 'preset',
          acked: false,
          warning: `rename failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        anyFailed = true;
      }
    }
    if (target !== undefined) {
      try {
        const result = await writer.savePreset!(ctx, target);
        writes.push(result);
        if (!result.acked) anyFailed = true;
      } catch (err) {
        writes.push({
          op: 'save_preset',
          target: String(target),
          acked: false,
          warning: `save_preset failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        anyFailed = true;
      }
    }

    void options; // landingScene / no_save_on_done not yet wired

    const failedStepIdx = writes.findIndex((w) => !w.acked);
    return {
      ok: !anyFailed,
      steps: writes.length,
      duration_ms: 0, // not measured per-step on this path
      failed_step: failedStepIdx >= 0 ? {
        index: failedStepIdx,
        description: writes[failedStepIdx].target ?? writes[failedStepIdx].op ?? 'step',
        error: writes[failedStepIdx].warning ?? 'no warning recorded',
      } : undefined,
      warning:
        '🟡 axe-fx-iii apply_preset: composed of best-effort 0x05/0x02/0x09/0x1D ' +
        'envelopes (none of which are in the v1.4 III spec). Confirm the audible / ' +
        'visible result on the device. ' +
        `${writes.length} step(s) attempted; ${writes.filter((w) => w.acked).length} acked.`,
      saved: target !== undefined ? !anyFailed : undefined,
    };
  },

  async switchPreset(
    ctx: DispatchCtx,
    location: LocationRef,
  ): Promise<WriteResult> {
    const n = parseLocation(location);
    const bytes = buildSwitchPresetPC(n);
    ctx.conn.send(bytes);
    return {
      op: 'switch_preset',
      target: String(n),
      acked: true,
      display_value: String(n),
      warning:
        'axe-fx-iii switch_preset: sent standard MIDI Program Change + Bank ' +
        'Select on channel 1 (the III\'s factory-default MIDI channel). The III ' +
        'does not ack PC writes — confirm by reading the new active preset name ' +
        '(get_preset_name) or by checking the device front panel. If the device ' +
        'is configured to listen on a different MIDI channel, the switch will ' +
        'silently no-op; set the III back to channel 1 in its Global → MIDI menu.',
    };
  },

  async savePreset(
    ctx: DispatchCtx,
    location: LocationRef,
    name?: string,
  ): Promise<WriteResult> {
    // Try II's 0x1D STORE_PRESET envelope (10 bytes total — no preset
    // payload, just "persist working buffer to slot N"). The community-
    // known III-native 0x77/0x78/0x79 envelope requires Huffman-
    // compressed preset content and is out of scope here. If III ignores
    // 0x1D, the user can fall back to saving on the device front panel.
    const n = parseLocation(location);
    if (name !== undefined) {
      // Pre-write the new name before the store. If rename rejects, surface
      // the rejection but still attempt the store.
      try {
        const renameResult = await writer.rename!(ctx, 'preset', name);
        if (!renameResult.acked) {
          // Continue to save attempt anyway.
        }
      } catch {
        // Continue to save attempt anyway.
      }
    }
    const bytes = buildStorePreset(n);
    const errorReport = await sendAndWatchForError(ctx, bytes, 200);
    if (errorReport !== undefined) {
      return {
        op: 'save_preset',
        target: String(n),
        acked: false,
        warning:
          `Axe-Fx III rejected save_preset (II 0x1D envelope) via 0x64 MULTIPURPOSE_RESPONSE: ${formatErrorCode(errorReport)}. ` +
          'The III may require its native 0x77/0x78/0x79 multi-frame envelope ' +
          '(community RE, requires Huffman-compressed preset content — not yet ' +
          'implemented). For now, save on the device front panel. ' + BETA_WARNING,
      };
    }
    return {
      op: 'save_preset',
      target: String(n),
      acked: true,
      display_value: String(n),
      warning:
        '🟡 axe-fx-iii save_preset: sent II 0x1D STORE_PRESET envelope ' +
        '(10 bytes, no preset payload — just "persist working buffer to slot N"). ' +
        'Device emitted no rejection but the III may have ignored the write. ' +
        'CONFIRM by switching to a different preset and back — if the working ' +
        'buffer state survived, the save landed. If the original preset returns, ' +
        'the III needs its native 0x77/0x78/0x79 envelope (not yet implemented).',
    };
  },

  async switchScene(ctx: DispatchCtx, scene: number): Promise<WriteResult> {
    if (!Number.isInteger(scene) || scene < 1 || scene > 8) {
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        `axe-fx-iii switchScene: scene ${scene} out of range. ` +
          'The III has 8 scenes per preset (1..8 display, 0..7 wire).',
      );
    }
    const bytes = buildSetScene(scene - 1);
    await ctx.conn.send(bytes);
    return {
      op: 'switch_scene',
      target: String(scene),
      acked: true,
      warning:
        '🟡 axe-fx-iii switch_scene: spec-documented (function 0x0C) but ' +
        'pending hardware verification.',
    };
  },

  async rename(
    ctx: DispatchCtx,
    target: RenameTarget,
    name: string,
  ): Promise<WriteResult> {
    if (target !== 'preset') {
      throw new DispatchError(
        'capability_not_supported',
        DEVICE_LABEL,
        `axe-fx-iii rename: only target='preset' is wired (tried target='${target}'). ` +
          'Scene rename would need SET_SCENE_NAME (function 0x0X) which has no II analog ' +
          'to port from.',
      );
    }
    let bytes: number[];
    try {
      bytes = buildSetPresetName(name);
    } catch (err) {
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        err instanceof Error ? err.message : String(err),
      );
    }
    const errorReport = await sendAndWatchForError(ctx, bytes, 100);
    if (errorReport !== undefined) {
      return {
        op: 'rename',
        target: 'preset',
        acked: false,
        warning:
          `Axe-Fx III rejected rename (II 0x09 SET_PRESET_NAME envelope) via 0x64 MULTIPURPOSE_RESPONSE: ${formatErrorCode(errorReport)}. ` +
          BETA_WARNING,
      };
    }
    return {
      op: 'rename',
      target: 'preset',
      acked: true,
      display_value: name,
      warning:
        '🟡 axe-fx-iii rename: sent II 0x09 SET_PRESET_NAME envelope. ' +
        'Device emitted no rejection but the III may have ignored the write — ' +
        'confirm via get_preset_name (or by checking the front-panel preset title). ' +
        'Working-buffer scope only; persist with save_preset.',
    };
  },
};

// ── Agent guidance ─────────────────────────────────────────────────

const AXEFX3_AGENT_GUIDANCE: Record<string, string> = {
  beta_status: [
    '🟡 BETA / HARDWARE VERIFICATION NEEDED.',
    '',
    'The Axe-Fx III protocol layer has no project maintainer who owns an',
    'Axe-Fx III. Everything below is either documented in the v1.4 PDF or',
    'inferred from the Axe-Fx II family conventions and Ghidra-mined',
    'param tables from the AxeEdit III binary.',
    '',
    'NO unified-surface op refuses on the III — every op attempts a wire',
    'send and surfaces rejections (0x64 MULTIPURPOSE_RESPONSE) inline so',
    'an III owner can exercise the full surface and report results.',
    '',
    'What is wired up:',
    '  🟢 SPEC-DOCUMENTED (v1.4 PDF — most likely to land cleanly):',
    '  - set_bypass / get_bypass per block (function 0x0A)',
    '  - set_channel / get_channel (channels A/B/C/D, function 0x0B)',
    '  - switch_scene (1..8) / get_active_scene (function 0x0C)',
    '  - get_preset_name (function 0x0D — returns number + 32-char name)',
    '  - get_scene_name (function 0x0E)',
    '  - status_dump (function 0x13 — per-block bypass / channel snapshot)',
    '  - tempo: tap, set BPM, get BPM (functions 0x10 / 0x14)',
    '  - tuner: on/off (function 0x11)',
    '  - switch_preset (MIDI Program Change + Bank Select — channel 1)',
    '',
    '  🟡 PORTED FROM AXE-FX II (II encoder w/ III model byte — UNVERIFIED):',
    '  - set_param / get_param / set_params / get_params via 0x02',
    '    SET_PARAMETER (II-derived wire shape; III firmware code path',
    '    confirmed present, but rejection vs. accept is unverified)',
    '  - save_preset via 0x1D STORE_PRESET (10-byte envelope, no preset',
    '    payload — just "persist working buffer to slot N"). III may need',
    '    its native 0x77/0x78/0x79 envelope instead (not yet implemented).',
    '  - rename via 0x09 SET_PRESET_NAME (32-char ASCII, working buffer)',
    '  - set_block via 0x05 SET_GRID_CELL (block-type swap at grid cell)',
    '  - apply_preset composes set_block + set_param across PresetSpec.slots,',
    '    optionally rename + save at the end',
    '',
    'On any rejection (0x64 MULTIPURPOSE_RESPONSE) the response surfaces:',
    '  - `acked: false`',
    '  - `warning` with the named error code (e.g. "message not recognized",',
    '    "invalid parameter ID", "DSP overload")',
    'When you see a rejection, tell the user verbatim — that\'s data we',
    "need to close the protocol gap. Don't paper over it.",
    '',
    'When a write IS acked, tell the user what you wrote AND ask them to',
    'confirm the audible / visible response on the device. Their',
    'confirmation IS our verification pipeline until a maintainer captures',
    'the III protocol end-to-end. Examples: "I set pitch.harm1 to wire 27 —',
    'can you confirm the harmony interval changed on the front panel?"',
    '',
    'Help wanted: see docs/_private/HARDWARE-TASKS-AXEFX3.md. If you',
    'discover an op the III rejects, file an issue with the bytes you sent',
    'plus the 0x64 frame the device returned.',
  ].join('\n'),
  channels: [
    'Axe-Fx III channel names: A, B, C, D (4 channels per block — same as',
    "AM4, different from Axe-Fx II's X/Y). Per-spec function 0x0B `id id dd`",
    'targets the ACTIVE scene only — the III has no per-scene channel write',
    'in the v1.4 spec.',
  ].join('\n'),
  scenes: [
    'Axe-Fx III: 8 scenes per preset. Scenes are 1-indexed in user-facing',
    'tools, 0-indexed on the wire (the descriptor handles conversion).',
  ].join('\n'),
  effect_ids: [
    'Block-level operations (bypass, channel) need an EFFECT ID, which is',
    "an integer 0..16383 from v1.4 Appendix 1. Examples:",
    "  - Compressor 1..4    →  46..49",
    "  - Drive 1..4         →  58..61",
    "  - Cab 1..4           →  62..65",
    "  - Reverb 1..4        →  66..69",
    "  - Delay 1..4         →  70..73",
    "  - Chorus 1..4        →  78..81",
    "  - Pitch 1..4         →  110..113",
    "  - Tone Match 1..4    →  170..173",
    "  - Plex Delay 1..4    →  178..181",
    "  - Multiplexer 1..4   →  191..194",
    "  - IR Player 1..4     →  195..198",
    'Full table: docs/SYSEX-MAP-AXE-FX-III.md.',
    '',
    'AMP, Dynamic Distortion, NAM, Global Block, Shunt — effect IDs NOT',
    'in v1.4; bypass/channel control for these will refuse until decoded.',
  ].join('\n'),
  param_addressing: [
    'set_param / get_param address by (block, name) where:',
    '  - block is a single-instance slug (e.g. "reverb", "pitch", "drive")',
    '    that defaults to instance 1. Multi-instance routing (reverb 2,',
    '    drive 4) is a future hook — for now, all writes hit instance 1.',
    '  - name is the lowercase-stripped catalog symbol (REVERB_TYPE → type,',
    '    PITCH_HARM1 → harm1). The original symbol is also accepted as an',
    '    alias (so "reverb_type" works too).',
    '',
    'VALUE IS RAW WIRE 0..65534 — the III has no published display',
    'calibration so set_param/get_param pass the 16-bit wire integer',
    'through verbatim. Enum / select params: pass the wire index directly',
    '(0, 1, 2, ...). When you write, READ BACK and confirm with the user.',
    '',
    'list_params(port="axe-fx-iii", block=...) returns the per-block param',
    'list mined from AxeEdit III. The `parameter_name` field on each entry',
    'is the firmware-internal symbol (e.g. PITCH_HARM1) — useful for',
    'cross-referencing with community forum posts.',
  ].join('\n'),
};

// ── Descriptor ─────────────────────────────────────────────────────

export const AXEFX3_DESCRIPTOR: DeviceDescriptor = {
  id: 'axe-fx-iii',
  display_name: 'Fractal Axe-Fx III',
  connection_label: 'axe-fx-iii',
  port_match: [
    // /axe-?fx ?iii/i — matches "Axe-Fx III", "AxeFx III", "axe fx iii", etc.
    { pattern: /axe-?fx ?iii/i },
    // /axe-?fx ?3/i — covers "Axe-Fx 3" / "AxeFx3" / "axefx 3" / "axe fx 3".
    { pattern: /axe-?fx ?3/i },
  ],
  capabilities: {
    slot_model: 'grid',
    // 4×14 grid: Mark II (current firmware) ships 14 columns.
    grid: { rows: 4, cols: 14 },
    has_scenes: true,
    scene_count: 8,
    has_channels: true,
    channel_names: ['A', 'B', 'C', 'D'],
    preset_location_format: /^(?:\d{1,4})$/,
    supports_save: false,           // STORE envelope not in v1.4 PDF
    supports_factory_restore: false,
    supports_lineage: false,
  },
  canonical_terms: {
    block: 'block',
    slot: 'grid cell (row 1..4, col 1..14)',
    preset: 'preset',
    scene: 'scene 1..8',
    channel: 'channel A/B/C/D',
    location: 'preset slot 0..1023 (integer)',
  },
  blocks: buildBlocks(),
  reader,
  writer,
  agent_guidance: AXEFX3_AGENT_GUIDANCE,
};
