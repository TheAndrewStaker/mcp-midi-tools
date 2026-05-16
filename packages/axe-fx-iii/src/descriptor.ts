/**
 * Axe-Fx III DeviceDescriptor — community-beta scaffold (BK-015).
 *
 * BEFORE EDITING, READ:
 *   - `docs/SYSEX-MAP-AXE-FX-III.md`
 *   - `docs/manuals/AxeFx3-MIDI-3rdParty.txt` (Fractal v1.4 PDF extracted)
 *
 * The v1.4 PDF is the authoritative spec source. This descriptor now
 * exposes all spec-documented operations against the unified surface;
 * spec-omitted operations (set_param, save_preset, apply_preset)
 * remain refused with structured "not in v1.4 spec" errors.
 *
 * What works on the unified surface:
 *   - get_param: refused (param-ID space not in spec)
 *   - set_param: refused (param-ID space not in spec)
 *   - set_block / set_block_type: refused (block-type swap not in spec)
 *   - set_bypass: 🟡 implemented (function 0x0A + Appendix 1 effect IDs)
 *   - switch_scene: 🟡 implemented (function 0x0C)
 *   - apply_preset: refused (depends on set_param + topology writes)
 *   - save_preset: refused (multi-frame envelope not in v1.4)
 *   - switch_preset: refused (III has no SysEx preset switch; use MIDI PC)
 *   - rename: refused (no SET_PRESET_NAME / SET_SCENE_NAME in spec)
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
  ReadResult,
  BatchReadResult,
  ParamQuery,
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
import {
  buildSetBypass,
  buildSetChannel,
  buildSetScene,
} from './setParam.js';

const DEVICE_LABEL = 'Fractal Axe-Fx III';

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

/**
 * Build the `blocks` map for `describe_device`. Each block carries
 * its v1.4 effect ID where known. Per-block params are EMPTY — the
 * v1.4 spec doesn't document parameter writes, so list_params returns
 * empty for the III; the descriptor surfaces the block roster via
 * agent_guidance + describe_device.
 */
function buildBlocks(): Record<string, BlockSchema> {
  const out: Record<string, BlockSchema> = {};
  for (const b of AXE_FX_III_BLOCKS) {
    const slug = blockSlug(b);
    out[slug] = {
      display_name: b.name,
      params: {},
    };
  }
  return out;
}

function blockSlug(b: AxeFxIIIBlock): string {
  return b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Reader ─────────────────────────────────────────────────────────

const reader: DeviceReader = {
  async getParam(
    _ctx: DispatchCtx,
    block: string,
    name: string,
    _channel?: string | number,
  ): Promise<ReadResult> {
    throw notInSpec(
      `getParam(${block}.${name})`,
      'III parameter reads need per-block param IDs, which are NOT in v1.4. ' +
        'Per-block bypass + channel state CAN be read — use the unified ' +
        '`status_dump` tool or device-namespaced `axefx3_status_dump`.',
    );
  },
  async getParams(
    _ctx: DispatchCtx,
    queries: readonly ParamQuery[],
  ): Promise<BatchReadResult> {
    const reads: ReadResult[] = [];
    const failed: number[] = [];
    const errors: Record<number, string> = {};
    for (let i = 0; i < queries.length; i++) {
      failed.push(i);
      errors[i] =
        'axe-fx-iii getParams: param-level reads not in v1.4 spec. ' +
        'Use axefx3_status_dump for per-block bypass/channel state.';
    }
    return { reads, failed_indices: failed, errors };
  },
};

// ── Writer ─────────────────────────────────────────────────────────

const writer: DeviceWriter = {
  buildSetParam(_block: string, _name: string, _wireValue: number): number[] {
    throw notInSpec(
      'buildSetParam',
      'Per-block parameter writes (SET_PARAMETER_VALUE) are NOT in the v1.4 ' +
        'III spec — Fractal deliberately omitted them. Family-inference ' +
        'suggests 0x02 with II-style payload, but param-IDs are also ' +
        'undocumented. Requires capture work.',
    );
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
    _ctx: DispatchCtx,
    block: string,
    name: string,
    _wireValue: number,
  ): Promise<WriteResult> {
    throw notInSpec(
      `setParam(${block}.${name})`,
      'Per-block parameter writes are NOT in the v1.4 III spec.',
    );
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
      'apply_preset requires set_param + block-type swap + save_preset, ' +
        'none of which are in the v1.4 spec.',
    );
  },

  async switchPreset(
    _ctx: DispatchCtx,
    _location: LocationRef,
  ): Promise<WriteResult> {
    throw notInSpec(
      'switchPreset',
      'III has NO SysEx preset-switch function. Use MIDI Program Change ' +
        '(2-byte: `Cn pp`, with CC 0 + CC 32 Bank Select for slots > 127).',
    );
  },

  async savePreset(
    _ctx: DispatchCtx,
    _location: LocationRef,
  ): Promise<WriteResult> {
    throw notInSpec(
      'savePreset',
      'STORE_PRESET is NOT in v1.4 spec. Community reverse-engineering ' +
        'suggests a multi-frame envelope (0x77 header + 16×0x78 body + ' +
        '0x79 footer per Fractal Forum thread #159885) but this is not ' +
        'safe to ship without a confirmed capture.',
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
    "The Axe-Fx III protocol layer is implemented from Fractal's published",
    '"Axe-Fx III MIDI for Third-Party Devices" v1.4 PDF. It has NOT been',
    'hardware-verified end-to-end because no project maintainer owns an',
    'Axe-Fx III.',
    '',
    'What works today (from v1.4 spec alone, no capture required):',
    '  - set_bypass / get_bypass on any block with a known effect ID',
    '  - set_channel / get_channel (channels A/B/C/D)',
    '  - switch_scene (1..8) / get_active_scene',
    '  - get_preset_name (returns preset number + 32-char name)',
    '  - get_scene_name (returns scene name)',
    '  - status_dump (per-block state snapshot)',
    '  - tempo: tap, set BPM, get BPM',
    '  - tuner: on/off',
    '  - looper: trigger button, get state',
    '',
    'What does NOT work yet (not in v1.4 spec):',
    '  - set_param / get_param: per-block parameter writes are NOT in the',
    '    v1.4 PDF. The III deliberately omits SET_PARAMETER_VALUE from the',
    '    third-party MIDI surface — and the param-ID space is also not',
    '    documented anywhere public.',
    '  - apply_preset / save_preset / set_block / rename — all refused.',
    '  - switch_preset via SysEx — NOT supported. Use MIDI Program Change',
    '    (Bank Select CC 0/32 + PC byte) for III preset switching.',
    '',
    'AMP block bypass/channel: the v1.4 effect-ID table has no AMP entry.',
    "AMP IDs may be in the spec's 3..34 reserved range. Until verified",
    'on hardware via STATUS_DUMP, AMP bypass/channel control may refuse.',
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
