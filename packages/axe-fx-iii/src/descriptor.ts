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
 * What works on the unified surface:
 *   - get_param / set_param      : 🟡 0x02 envelope, II-shape inferred
 *   - get_params / set_params    : 🟡 loop over the above
 *   - set_bypass                 : 🟡 spec-documented (function 0x0A)
 *   - switch_scene               : 🟡 spec-documented (function 0x0C)
 *   - set_block / set_block_type : refused — block-type swap not in v1.4
 *   - apply_preset               : refused — depends on grid-cell writes
 *                                  (function 0x05/0x06 not in III v1.4)
 *   - save_preset                : refused — flash-write envelope is
 *                                  community-hypothesis only (0x77/0x78/
 *                                  0x79); too risky to ship unverified
 *   - switch_preset              : refused — use MIDI Program Change
 *                                  (Bank Select CC 0/32 + PC byte)
 *   - rename                     : refused — SET_PRESET_NAME not in v1.4
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
  buildSetParameter,
  buildSetScene,
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

  buildSwitchPreset(_location: LocationRef): number[] {
    throw notInSpec(
      'buildSwitchPreset',
      'III has NO SysEx preset-switch function. Use MIDI Program Change ' +
        '(with CC 0 + CC 32 Bank Select for slots > 127).',
    );
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
    _ctx: DispatchCtx,
    _slot: SlotRef,
    change: BlockChange,
  ): Promise<WriteResult> {
    throw notInSpec(
      `setBlock(${change.block_type ?? 'unknown'})`,
      'Block-type swap (SET_GRID_CELL) is NOT in the v1.4 III spec. ' +
        'The III grid layout is fixed by the preset; to change which block ' +
        'occupies a cell, edit on the device or in AxeEdit III.',
    );
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
    _ctx: DispatchCtx,
    _spec: PresetSpec,
    _target?: LocationRef,
    _options?: ApplyPresetOptions,
  ): Promise<ApplyResult> {
    throw notInSpec(
      'applyPreset',
      'apply_preset requires grid-cell + cell-routing writes (functions ' +
        '0x05 / 0x06 on the Axe-Fx II), neither of which is in the v1.4 ' +
        'III spec. Use individual set_param / set_bypass calls against a ' +
        'preset you already authored on-device, OR open AxeEdit III to lay ' +
        'out the grid and then tweak params from here.',
    );
  },

  async switchPreset(
    _ctx: DispatchCtx,
    _location: LocationRef,
  ): Promise<WriteResult> {
    throw notInSpec(
      'switchPreset',
      'III has NO SysEx preset-switch function. Use MIDI Program Change ' +
        '(2-byte: `Cn pp`, with CC 0 + CC 32 Bank Select for slots > 127). ' +
        'The unified surface does not route Program Change today — for now, ' +
        'switch presets on the device front panel before calling get_param / ' +
        'set_param against the new working buffer.',
    );
  },

  async savePreset(
    _ctx: DispatchCtx,
    _location: LocationRef,
  ): Promise<WriteResult> {
    throw notInSpec(
      'savePreset',
      'STORE_PRESET is NOT in v1.4 spec. Community reverse-engineering ' +
        'suggests an 18-frame envelope (0x77 header + 16×0x78 body + ' +
        '0x79 footer per Fractal Forum thread #159885) but ours is a ' +
        'second-hand summary, not a verified capture. Sending speculative ' +
        'flash-write SysEx to the III is too risky to ship default-on. ' +
        'Save from the device front panel or AxeEdit III for now.',
    );
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
    _ctx: DispatchCtx,
    target: RenameTarget,
    _name: string,
  ): Promise<WriteResult> {
    throw notInSpec(
      `rename(${target})`,
      'SET_PRESET_NAME / SET_SCENE_NAME are NOT in v1.4 spec. III names ' +
        'are query-only via 0x0D / 0x0E.',
    );
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
    'What works today (and is wired into the unified surface):',
    '  - set_param / get_param / set_params / get_params via 0x02',
    '    SET_PARAMETER (II-derived wire shape; III firmware code path',
    '    confirmed present, but rejection vs. accept is unverified). On',
    '    reject the device emits a 0x64 MULTIPURPOSE_RESPONSE which the',
    '    writer catches and surfaces as `acked: false` + the named error.',
    '  - set_bypass / get_bypass per block (function 0x0A)',
    '  - set_channel / get_channel (channels A/B/C/D, function 0x0B)',
    '  - switch_scene (1..8) / get_active_scene (function 0x0C)',
    '  - get_preset_name (function 0x0D — returns number + 32-char name)',
    '  - get_scene_name (function 0x0E)',
    '  - status_dump (function 0x13 — per-block bypass / channel snapshot)',
    '  - tempo: tap, set BPM, get BPM (functions 0x10 / 0x14)',
    '  - tuner: on/off (function 0x11)',
    '',
    'What is REFUSED with a structured explanation:',
    '  - apply_preset / set_block: depend on grid-cell + cell-routing',
    '    writes (II functions 0x05 / 0x06) NOT in the v1.4 III spec.',
    '  - save_preset: STORE envelope is community-hypothesis only; too',
    '    risky to ship default-on (flash-write target).',
    '  - switch_preset: not in v1.4 spec — use MIDI Program Change',
    '    (Bank Select CC 0/32 + PC byte) externally.',
    '  - rename: SET_PRESET_NAME / SET_SCENE_NAME not in v1.4 spec.',
    '',
    'Confirmation request: when you successfully set or read a param,',
    'tell the user what you wrote and ask them to confirm the change',
    'audibly / on the front panel. Their confirmation IS our verification',
    'pipeline until a maintainer captures the III protocol end-to-end.',
    '',
    'Help wanted: see docs/_private/HARDWARE-TASKS-AXEFX3.md.',
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
