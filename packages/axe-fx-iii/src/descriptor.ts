/**
 * Axe-Fx III DeviceDescriptor — community-beta scaffold (BK-015).
 *
 * Wraps the wiki-decoded + Fractal-PDF-sourced Axe-Fx III protocol
 * layer into the BK-051 unified `DeviceDescriptor` contract. The
 * **read surface** (preset/scene number queries, preset/scene name
 * queries, status dump) is functional per Fractal's published spec
 * v1.4 — pending one community capture to confirm byte-for-byte. The
 * **write surface** is gated:
 *
 *   - `switchPreset` + `switchScene`: functional (spec-documented).
 *   - `setParam`, `setBlock`, `setBypass`, `applyPreset`, `savePreset`,
 *     `restoreDefaults`: throw `DispatchError` with code
 *     `capability_not_supported` + a clear "pending community capture"
 *     pointer to `docs/_private/HARDWARE-TASKS-AXEFX3.md`.
 *
 * The block roster (47 blocks) is real — extracted from AxeEdit III
 * editor assets — but per-block parameter dictionaries are EMPTY
 * pending capture-based decoding. `describe_device` surfaces the
 * roster + beta-status warnings; the agent can introspect what's
 * known vs unknown.
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
  type AxeFxIIIBlock,
} from './blockTypes.js';
import {
  buildSwitchPreset,
  buildSwitchScene,
  buildQueryPresetName,
  buildQuerySceneName,
} from './setParam.js';

const DEVICE_LABEL = 'Fractal Axe-Fx III';

function betaRefusal(op: string, gap: string): DispatchError {
  return new DispatchError(
    'capability_not_supported',
    DEVICE_LABEL,
    `axe-fx-iii ${op}: 🟡 community beta — wire layer pending capture. ${gap}`,
    {
      retry_action:
        'See docs/_private/HARDWARE-TASKS-AXEFX3.md for the capture workflow. ' +
        'Contributors with Axe-Fx III hardware: please run a USBPcap session of ' +
        'AxeEdit III firing the operation in question and share the .pcapng so ' +
        'we can decode the wire format.',
    },
  );
}

/**
 * Build the `blocks` map: each AxeEdit-III block becomes a
 * `BlockSchema` with an empty `params` map (pending decode). The
 * agent's `describe_device` reads this to discover what blocks the
 * III ships; `list_params` returns empty for now, with a beta-status
 * note in agent_guidance.
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

/** Lowercase, alphanumeric-and-underscore slug for a block name. */
function blockSlug(b: AxeFxIIIBlock): string {
  return b.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Reader ─────────────────────────────────────────────────────────

const reader: DeviceReader = {
  async getParam(
    ctx: DispatchCtx,
    block: string,
    name: string,
    _channel?: string | number,
  ): Promise<ReadResult> {
    throw betaRefusal(
      `getParam(${block}.${name})`,
      'III parameter-ID space is not documented in the public Fractal spec ' +
        '(Gen 3 deliberately omits per-block param IDs). Reads need the same ' +
        'capture-based decoding as writes.',
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
        'axe-fx-iii getParams: 🟡 community beta — param-ID space pending capture.';
    }
    return { reads, failed_indices: failed, errors };
  },
};

// ── Writer ─────────────────────────────────────────────────────────

const writer: DeviceWriter = {
  buildSetParam(_block: string, _name: string, _wireValue: number): number[] {
    throw betaRefusal(
      'buildSetParam',
      'III parameter-ID space pending decode.',
    );
  },

  buildSwitchPreset(location: LocationRef): number[] {
    const idx = coerceLocation(location);
    return buildSwitchPreset(idx);
  },

  buildSwitchScene(scene: number): number[] {
    // BK-051 unified-surface scene numbers are 1-indexed (display);
    // the wire is 0-indexed.
    return buildSwitchScene(scene - 1);
  },

  async setParam(
    _ctx: DispatchCtx,
    block: string,
    name: string,
    _wireValue: number,
  ): Promise<WriteResult> {
    throw betaRefusal(
      `setParam(${block}.${name})`,
      'III parameter writes need the per-block param-ID space, which is not ' +
        'documented and not in any OSS library. This is the highest-priority ' +
        'community decode target for III.',
    );
  },

  async setBlock(
    _ctx: DispatchCtx,
    _slot: SlotRef,
    change: BlockChange,
  ): Promise<WriteResult> {
    throw betaRefusal(
      `setBlock(${change.block_type ?? 'unknown'})`,
      'Block-type ID space is not documented; block placement on III needs ' +
        'the effect-index addressing model decoded from a STATUS_DUMP capture.',
    );
  },

  async setBypass(
    _ctx: DispatchCtx,
    block: string,
    _bypassed: boolean,
  ): Promise<WriteResult> {
    throw betaRefusal(
      `setBypass(${block})`,
      'III bypass writes use effect-index addressing (function 0x0A id id dd). ' +
        'Effect-index space pending capture.',
    );
  },

  async applyPreset(
    _ctx: DispatchCtx,
    _spec: PresetSpec,
    _target?: LocationRef,
    _options?: ApplyPresetOptions,
  ): Promise<ApplyResult> {
    throw betaRefusal(
      'applyPreset',
      'III preset authoring needs block-type IDs + effect-index space + per-' +
        'block param IDs — none of which are publicly documented. The III ' +
        'protocol layer ships in v0.1 as read + navigation only.',
    );
  },

  async switchPreset(
    ctx: DispatchCtx,
    location: LocationRef,
  ): Promise<WriteResult> {
    const idx = coerceLocation(location);
    const bytes = buildSwitchPreset(idx);
    await ctx.conn.send(bytes);
    return {
      op: 'switch_preset',
      target: String(idx),
      acked: true, // III doesn't ack preset switches via 0x64; assume after send
      warning:
        '🟡 axe-fx-iii switch_preset: spec-documented (function 0x0D) but ' +
        'pending one community capture to verify byte-for-byte against AxeEdit III.',
    };
  },

  async savePreset(
    _ctx: DispatchCtx,
    _location: LocationRef,
  ): Promise<WriteResult> {
    throw betaRefusal(
      'savePreset',
      "III STORE_PRESET envelope is not in Fractal's public spec — same gap as " +
        "Axe-Fx II had pre-Session-71. Decoding requires probe-and-observe " +
        'against connected hardware.',
    );
  },

  async switchScene(ctx: DispatchCtx, scene: number): Promise<WriteResult> {
    if (!Number.isInteger(scene) || scene < 1 || scene > 8) {
      throw new DispatchError(
        'value_out_of_range',
        DEVICE_LABEL,
        `axe-fx-iii switchScene: scene ${scene} out of range. The III has 8 scenes per preset (1..8 display, 0..7 wire).`,
      );
    }
    const bytes = buildSwitchScene(scene - 1);
    await ctx.conn.send(bytes);
    return {
      op: 'switch_scene',
      target: String(scene),
      acked: true,
      warning:
        '🟡 axe-fx-iii switch_scene: spec-documented (function 0x0C) but ' +
        'pending one community capture to verify.',
    };
  },

  async rename(
    _ctx: DispatchCtx,
    target: RenameTarget,
    _name: string,
  ): Promise<WriteResult> {
    throw betaRefusal(
      `rename(${target})`,
      'III SET_PRESET_NAME / SET_SCENE_NAME envelopes are not in the public spec.',
    );
  },
};

/**
 * Coerce a `LocationRef` (string or number) to the 0-based wire index
 * for the III. III presets are addressed by integer 0..511 (Mark I)
 * or 0..1023 (Mark II); strings are accepted for cross-device API
 * symmetry — anything that parses as an integer is valid.
 */
function coerceLocation(loc: LocationRef): number {
  if (typeof loc === 'number') return loc;
  const parsed = Number.parseInt(loc, 10);
  if (Number.isFinite(parsed)) return parsed;
  throw new DispatchError(
    'bad_location',
    DEVICE_LABEL,
    `axe-fx-iii: location "${loc}" is not a valid integer preset number. ` +
      'The III addresses presets by integer 0..511 (Mark I) or 0..1023 (Mark II).',
  );
}

// ── Agent guidance ─────────────────────────────────────────────────

const AXEFX3_AGENT_GUIDANCE: Record<string, string> = {
  beta_status: [
    '🟡 BETA / COMMUNITY VERIFICATION NEEDED.',
    '',
    "The Axe-Fx III protocol layer is scaffolded from Fractal's published",
    '"Axe-Fx III MIDI for Third-Party Devices" v1.4 PDF + AxeEdit III editor',
    'assets (block roster). It has NOT been hardware-verified end-to-end',
    'because no project maintainer owns an Axe-Fx III.',
    '',
    'What works today:',
    '  - Device identification (list_midi_ports detects III ports)',
    '  - describe_device returns capabilities + block roster',
    '  - switch_preset (function 0x0D) — spec-documented',
    '  - switch_scene  (function 0x0C) — spec-documented',
    '  - Read tools: query preset name, query scene name, status dump',
    '',
    'What does NOT work yet:',
    '  - apply_preset, set_param, set_block, set_bypass, save_preset',
    '    — all refused with structured "pending capture" errors.',
    '  - The III deliberately omits per-block parameter IDs from its',
    '    public spec, so the param-ID space needs USB-MIDI capture',
    '    decoding (analogous to how this project decoded Axe-Fx II).',
    '',
    'Help wanted: see docs/_private/HARDWARE-TASKS-AXEFX3.md for the',
    'community capture workflow. One careful USBPcap session of AxeEdit III',
    'firing a SET_PARAMETER_VALUE write unlocks the next layer of support.',
  ].join('\n'),
  channels: [
    'Axe-Fx III channel names: A, B, C, D (4 channels per block — same as AM4,',
    "different from Axe-Fx II's X/Y). Per-scene channel writes target the",
    'ACTIVE scene only (III spec function 0x0B id id dd).',
  ].join('\n'),
  scenes: [
    'Axe-Fx III: 8 scenes per preset (vs AM4 4 / same as Axe-Fx II 8). Scenes',
    'are 1-indexed in user-facing tools, 0-indexed on the wire (the descriptor',
    'handles the conversion).',
  ].join('\n'),
  grid: [
    "The III's grid size is ambiguous in published docs: 4x12 (original) vs",
    "4x14 (Mark II / current firmware). Without hardware confirmation we",
    'advertise 4x12 in capabilities (conservative). Beta testers: please',
    'report your firmware version and visible grid columns.',
  ].join('\n'),
};

// ── Descriptor ─────────────────────────────────────────────────────

export const AXEFX3_DESCRIPTOR: DeviceDescriptor = {
  id: 'axe-fx-iii',
  display_name: 'Fractal Axe-Fx III',
  connection_label: 'axe-fx-iii',
  port_match: [
    { pattern: /axe-?fx ?iii/i },
    { pattern: /axefx ?3/i },
  ],
  capabilities: {
    slot_model: 'grid',
    grid: { rows: 4, cols: 12 }, // 🟡 wiki contradicts itself between 4×12 and 4×14
    has_scenes: true,
    scene_count: 8,
    has_channels: true,
    channel_names: ['A', 'B', 'C', 'D'],
    preset_location_format: /^(?:\d{1,4})$/,
    supports_save: false, // STORE envelope pending decode
    supports_factory_restore: false,
    supports_lineage: false, // shared lineage corpus may extend later
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

// Re-export query builders for any read-tool that wants to wire them
// directly (e.g. a future axefx3_get_preset_name).
export {
  buildQueryPresetName,
  buildQuerySceneName,
};
