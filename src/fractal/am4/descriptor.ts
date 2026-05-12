/**
 * AM4 DeviceDescriptor for the BK-051 unified tool surface.
 *
 * Wraps the existing AM4 protocol code (params.ts, blockTypes.ts,
 * setParam.ts, locations.ts) into the `DeviceDescriptor` contract from
 * `src/protocol/generic/types.ts`. The wire layer is byte-frozen — no
 * code under `src/fractal/am4/` is modified. This file is the
 * translation layer between the legacy direct-call shape and the
 * dispatcher-routed shape.
 *
 * Coexists with `src/fractal/am4/device.ts` (the Fractal-protocol-layer
 * `FractalDevice` instance used by the cross-Fractal device registry).
 * Both registries hold an AM4 entry; they serve different layers.
 *
 * Session A scope (BK-051 phase 1): only the pure builders are wired
 * (writer.buildSetParam) — enough for `verify-dispatcher.ts` to prove
 * byte-exact equivalence with the legacy `am4_set_param` wire output.
 * The execute methods (writer.setParam, getParam, applyPreset, …) are
 * deferred to follow-up sessions; the descriptor's reader/writer slots
 * declare them as undefined until then.
 */

import type {
  BlockSchema,
  BlockTypeMeta,
  DeviceDescriptor,
  DeviceReader,
  DeviceWriter,
  DispatchCtx,
  ParamSchema,
  ReadResult,
  RenameTarget,
  WriteOp,
  WriteResult,
} from '@/protocol/generic/types.js';
import { DispatchError } from '@/protocol/generic/types.js';

import {
  KNOWN_PARAMS,
  PARAM_ALIASES,
  decode as am4Decode,
  findEnumCandidates,
  resolveEnumValue,
  type Param,
  type ParamKey,
} from '@/fractal/am4/params.js';
import { BLOCK_TYPE_VALUES, BLOCK_NAMES_BY_VALUE } from '@/fractal/am4/blockTypes.js';
import {
  buildSaveToLocation,
  buildSetBlockBypass,
  buildSetBlockType,
  buildSetParam,
  buildSetPresetName,
  buildSetSceneName,
  buildSwitchPreset,
  buildSwitchScene,
  isCommandAck,
  isWriteEcho,
} from '@/fractal/am4/setParam.js';
import { resolveBlockType } from '@/fractal/am4/blockTypes.js';
import { readPresetName } from '@/server/shared/readOps.js';
import {
  formatLocationDisplay,
} from '@/fractal/am4/locations.js';
import { runLineageLookup, formatLineageRecord, LINEAGE_BLOCKS } from '@/fractal/shared/lineageLookup.js';
import {
  parseLocationCode,
  formatLocationCode,
  TOTAL_LOCATIONS,
} from '@/fractal/am4/locations.js';
import { sendAndAwaitAck } from '@/server/shared/wireOps.js';
import { sendReadAndParse } from '@/server/shared/readOps.js';
import {
  switchBlockChannel,
  channelLetter,
  invalidateChannelCache,
  CHANNEL_BLOCKS,
} from '@/server/shared/channels.js';

// ── Unit pass-through ───────────────────────────────────────────────
//
// AM4's unit names (`knob_0_10`, `pf`, `rotary_mic_spacing`,
// `amp_geq_band`, …) are the words the AM4 manual + front panel use,
// so the LLM should see those words in describe_device / list_params
// output. Open item #4 (Session 63 cont): the generic `Unit` is now
// `string`, so AM4 units pass through verbatim. The encode/decode
// closures still own all the scaling math — `unit` is purely a label.

// ── Encode helper ───────────────────────────────────────────────────
//
// Mirrors `resolveValue` from src/server/shared/paramHelpers.ts but
// scoped to a single Param so each schema entry can carry its own
// closure. Behavior is identical: numbers/strings for enums (with
// disambiguation), range-checked numerics for everything else. The
// returned number is the "display value" the AM4 wire layer expects
// — `buildSetParam` does its own display→packed-float conversion
// internally, so the dispatcher doesn't need to know about the wire
// encoding.

function makeEncode(param: Param): ParamSchema['encode'] {
  return (value: number | string): number => {
    if (param.unit === 'enum') {
      const resolved = resolveEnumValue(param, value);
      if (resolved === undefined) {
        const candidates = typeof value === 'string'
          ? findEnumCandidates(param, value)
          : [];
        if (candidates.length >= 2) {
          const list = candidates.map((c) => `"${c.name}"`).join(' / ');
          throw new Error(`"${value}" is ambiguous — matched ${candidates.length} entries: ${list}. Pick one verbatim.`);
        }
        const samples = Object.values(param.enumValues ?? {}).slice(0, 8).join(', ');
        throw new Error(`"${value}" is not a valid ${param.block}.${param.name} value. First few valid names: ${samples}… (call list_enum_values for the full list).`);
      }
      return resolved;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Expected a number for ${param.block}.${param.name}, got "${value}"`);
    }
    if (num < param.displayMin || num > param.displayMax) {
      throw new Error(`${param.block}.${param.name} out of range [${param.displayMin}..${param.displayMax}]: ${num}`);
    }
    return num;
  };
}

function makeDecode(param: Param): ParamSchema['decode'] {
  return (wire: number): number | string => {
    if (param.unit === 'enum') {
      const idx = Math.round(wire);
      return param.enumValues?.[idx] ?? idx;
    }
    return am4Decode(param, wire);
  };
}

// ── Block schemas ───────────────────────────────────────────────────
//
// Iterate KNOWN_PARAMS once to build per-block schemas. The flat
// `{block}.{name}` map fans out into nested `blocks[block].params[name]`
// entries, with PARAM_ALIASES translated into per-block alias tables.

function buildBlocks(): Record<string, BlockSchema> {
  const blocks: Record<string, { params: Record<string, ParamSchema>; aliases: Record<string, string> }> = {};
  for (const key of Object.keys(KNOWN_PARAMS) as ParamKey[]) {
    // KNOWN_PARAMS is a heterogenous `as const` literal — TS infers per-entry
    // shapes that lack the union'd optional fields like `enumValues`. Widen
    // to the shared `Param` interface so optional fields are accessible
    // uniformly. Same pattern as `paramHelpers.ts:resolveValue`.
    const param: Param = KNOWN_PARAMS[key];
    const block = param.block;
    const name = param.name;
    blocks[block] ??= { params: {}, aliases: {} };
    blocks[block].params[name] = {
      display_name: name,
      unit: param.unit,                 // AM4-native name passes through
      display_min: param.unit === 'enum' ? undefined : param.displayMin,
      display_max: param.unit === 'enum' ? undefined : param.displayMax,
      enum_values: param.enumValues,
      encode: makeEncode(param),
      decode: makeDecode(param),
    };
  }
  // Per-block aliases: PARAM_ALIASES has fully-qualified keys
  // ('reverb.decay' → 'reverb.time'). Split into per-block dictionaries.
  for (const [aliasFq, canonicalFq] of Object.entries(PARAM_ALIASES)) {
    const [aliasBlock, aliasName] = aliasFq.split('.');
    const [canonicalBlock, canonicalName] = canonicalFq.split('.');
    // PARAM_ALIASES is well-formed (same block on both sides) by
    // construction in params.ts. Belt-and-suspenders check anyway.
    if (aliasBlock !== canonicalBlock) continue;
    if (!blocks[aliasBlock]) continue;
    if (!(canonicalName in blocks[aliasBlock].params)) continue;
    blocks[aliasBlock].aliases[aliasName] = canonicalName;
  }

  const result: Record<string, BlockSchema> = {};
  for (const [block, { params, aliases }] of Object.entries(blocks)) {
    result[block] = {
      display_name: block,
      params,
      aliases: Object.keys(aliases).length > 0 ? aliases : undefined,
    };
  }
  return result;
}

// ── Block types (for set_block(block_type=...)) ─────────────────────

function buildBlockTypes(): Record<string, BlockTypeMeta> {
  const result: Record<string, BlockTypeMeta> = {};
  for (const [name, wire] of Object.entries(BLOCK_TYPE_VALUES)) {
    result[name] = {
      wire_value: wire,
      display_name: BLOCK_NAMES_BY_VALUE[wire] ?? name,
    };
  }
  return result;
}

// ── Writer adapter ──────────────────────────────────────────────────
//
// Pure builder (`buildSetParam`) is what `verify-dispatcher.ts`
// exercises for byte-equivalence vs the legacy path. Execute method
// (`setParam`) is what the unified `set_param` MCP tool calls at
// runtime — wraps the same wire-plumbing the legacy `am4_set_param`
// handler uses (channel-switch → send → await echo → result).
// `am4_set_param` itself is untouched; the legacy tool keeps working
// in parallel through v0.1.0.

function parseAm4Location(location: string | number): number {
  if (typeof location === 'number') {
    if (Number.isInteger(location) && location >= 0 && location < TOTAL_LOCATIONS) {
      return location;
    }
    throw new DispatchError(
      'bad_location',
      'Fractal AM4',
      `Location index ${location} is out of range on Fractal AM4 (valid: 0..${TOTAL_LOCATIONS - 1}).`,
    );
  }
  const normalized = location.trim().toUpperCase();
  try {
    return parseLocationCode(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DispatchError(
      'bad_location',
      'Fractal AM4',
      `Location '${location}' is not valid on Fractal AM4 — ${msg}. AM4 locations are A01..Z04 (104 total, 26 banks × 4).`,
      { retry_action: 'Pass a code like "A01" or "Z04".' },
    );
  }
}

const writer: DeviceWriter = {
  buildSetParam(block, name, displayValue): number[] {
    const key = `${block}.${name}` as ParamKey;
    return buildSetParam(key, displayValue);
  },

  buildSwitchPreset(location): number[] {
    return buildSwitchPreset(parseAm4Location(location));
  },

  buildSavePreset(location, name): number[] {
    // Pure-builder shape: returns ONLY the save bytes. Rename + save is
    // a 2-message sequence the execute path handles; the pure builder
    // is the canonical save step for goldens.
    if (name !== undefined && name.length > 0) {
      // No-op — the name argument is honored by the execute path.
    }
    return buildSaveToLocation(parseAm4Location(location));
  },

  buildSwitchScene(scene): number[] {
    if (!Number.isInteger(scene) || scene < 1 || scene > 4) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Scene index ${scene} out of range on Fractal AM4 (valid: 1..4).`,
      );
    }
    return buildSwitchScene(scene - 1);
  },

  async setParam(
    ctx: DispatchCtx,
    block: string,
    name: string,
    value: number,
    channel?: string | number,
  ): Promise<WriteResult> {
    const key = `${block}.${name}` as ParamKey;
    const param: Param = KNOWN_PARAMS[key];
    const bytes = buildSetParam(key, value);
    let channelSwitched: boolean | undefined;
    if (channel !== undefined && CHANNEL_BLOCKS.has(block)) {
      const switchResult = await switchBlockChannel(ctx.conn, block, channel);
      channelSwitched = switchResult.switched;
    }
    const result = await sendAndAwaitAck(ctx.conn, bytes, isWriteEcho);
    const enumName = param.unit === 'enum'
      ? (param.enumValues as Record<number, string> | undefined)?.[value]
      : undefined;
    const display: number | string = param.unit === 'enum'
      ? (enumName ?? value)
      : value;
    const channelName = channelSwitched && typeof channel === 'number'
      ? channelLetter(channel)
      : (typeof channel === 'string' ? channel.toUpperCase() : undefined);
    return {
      op: 'set_param',
      target: `${block}.${name}`,
      block,
      name,
      wire_value: value,
      display_value: display,
      acked: result.acked,
      channel: channelName,
      warning: result.acked
        ? undefined
        : `No ack within timeout — typically a stale MIDI handle or the block isn't placed. Try reconnect_midi or check the layout.`,
    };
  },

  async setParams(ctx, ops): Promise<import('@/protocol/generic/types.js').BatchWriteResult> {
    const writes: WriteResult[] = [];
    let acked_count = 0;
    let unacked_count = 0;
    for (const op of ops) {
      try {
        const r = await writer.setParam!(ctx, op.block, op.name, op.value as number, op.channel);
        writes.push(r);
        if (r.acked) acked_count++;
        else unacked_count++;
      } catch (err) {
        writes.push({
          op: 'set_param',
          target: `${op.block}.${op.name}`,
          block: op.block,
          name: op.name,
          acked: false,
          warning: err instanceof Error ? err.message : String(err),
        });
        unacked_count++;
      }
    }
    return { writes, acked_count, unacked_count };
  },

  async switchPreset(ctx, location): Promise<WriteResult> {
    const locationIndex = parseAm4Location(location);
    const bytes = buildSwitchPreset(locationIndex);
    const result = await sendAndAwaitAck(ctx.conn, bytes, isWriteEcho);
    // New preset = new channel layout; existing cache is stale.
    invalidateChannelCache();
    return {
      op: 'switch_preset',
      target: formatLocationCode(locationIndex),
      acked: result.acked,
      warning: result.acked
        ? 'Any unsaved working-buffer edits were discarded. Channel cache cleared.'
        : 'No write-echo within timeout — verify on the AM4 display.',
    };
  },

  async savePreset(ctx, location, name): Promise<WriteResult> {
    const locationIndex = parseAm4Location(location);
    if (name !== undefined && name.length > 0) {
      // Composite rename + save (mirrors am4_save_preset).
      const renameBytes = buildSetPresetName(locationIndex, name);
      const renameResult = await sendAndAwaitAck(ctx.conn, renameBytes, isCommandAck);
      if (!renameResult.acked) {
        return {
          op: 'save_preset',
          target: formatLocationCode(locationIndex),
          acked: false,
          warning: `Rename to "${name}" didn't ack — save skipped to avoid persisting the old name.`,
        };
      }
    }
    const saveBytes = buildSaveToLocation(locationIndex);
    const saveResult = await sendAndAwaitAck(ctx.conn, saveBytes, isCommandAck);
    return {
      op: 'save_preset',
      target: formatLocationCode(locationIndex),
      acked: saveResult.acked,
      warning: saveResult.acked
        ? (name ? `Saved "${name}" to ${formatLocationCode(locationIndex)}.` : `Working buffer saved to ${formatLocationCode(locationIndex)}.`)
        : `Save to ${formatLocationCode(locationIndex)} sent but no ack — verify by loading another location and coming back.`,
    };
  },

  async switchScene(ctx, scene): Promise<WriteResult> {
    if (!Number.isInteger(scene) || scene < 1 || scene > 4) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Scene index ${scene} out of range on Fractal AM4 (valid: 1..4).`,
      );
    }
    const bytes = buildSwitchScene(scene - 1);
    const result = await sendAndAwaitAck(ctx.conn, bytes, isWriteEcho);
    invalidateChannelCache();
    return {
      op: 'switch_scene',
      target: `scene:${scene}`,
      acked: result.acked,
      warning: result.acked
        ? 'Channel cache cleared — the new scene may point each block at a different channel.'
        : 'No write-echo within timeout — verify on the AM4 display.',
    };
  },

  async setBlock(ctx, slot, change): Promise<WriteResult> {
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 4) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Slot ${typeof slot === 'number' ? slot : JSON.stringify(slot)} is out of range on Fractal AM4 (linear slot_model, valid: 1..4).`,
      );
    }
    if (change.block_type === undefined) {
      throw new DispatchError(
        'capability_not_supported',
        'Fractal AM4',
        `set_block on Fractal AM4 currently only handles block placement. Pass block_type to place/clear a block; use set_bypass for bypass writes.`,
        { retry_action: 'Call set_bypass(port, block, bypassed) for the bypass write.' },
      );
    }
    const wire = resolveBlockType(change.block_type);
    if (wire === undefined) {
      const known = Object.keys(BLOCK_TYPE_VALUES).join(', ');
      throw new DispatchError(
        'unknown_block',
        'Fractal AM4',
        `Block type '${change.block_type}' is not valid on Fractal AM4. Known: ${known}.`,
      );
    }
    const bytes = buildSetBlockType(slot as 1 | 2 | 3 | 4, wire);
    const result = await sendAndAwaitAck(ctx.conn, bytes, isWriteEcho);
    const displayName = BLOCK_NAMES_BY_VALUE[wire] ?? `0x${wire.toString(16)}`;
    return {
      op: 'set_block',
      target: `slot:${slot}=${displayName}`,
      acked: result.acked,
      warning: result.acked
        ? `Placed ${displayName} in slot ${slot}.`
        : `No write-echo within timeout — verify on the AM4 display.`,
    };
  },

  async setBypass(ctx, block, bypassed): Promise<WriteResult> {
    const wire = resolveBlockType(block);
    if (wire === undefined || wire === BLOCK_TYPE_VALUES.none) {
      const known = Object.keys(BLOCK_TYPE_VALUES).filter((n) => n !== 'none').join(', ');
      throw new DispatchError(
        'unknown_block',
        'Fractal AM4',
        `Block '${block}' is not valid on Fractal AM4 (cannot bypass 'none'). Known: ${known}.`,
      );
    }
    const bytes = buildSetBlockBypass(wire, bypassed);
    const result = await sendAndAwaitAck(ctx.conn, bytes, isWriteEcho);
    const stateWord = bypassed ? 'bypassed' : 'active';
    return {
      op: 'set_bypass',
      target: `${block}:${stateWord}`,
      acked: result.acked,
      warning: result.acked
        ? `${block} set to ${stateWord} on the active scene. To change a different scene's bypass, switch_scene first and re-issue.`
        : `No write-echo within timeout — verify on the AM4 display.`,
    };
  },

  async rename(ctx, target: RenameTarget, name): Promise<WriteResult> {
    if (target === 'preset') {
      // AM4's set_preset_name requires a location to write to. The
      // working-buffer rename in the legacy `am4_set_preset_name` tool
      // is actually a "rename and save to this location" — the AM4
      // doesn't expose a pure working-buffer rename without an address.
      // For the unified rename(target='preset'), the caller must supply
      // a name only; we throw here because there's no implicit location.
      // Use save_preset(location, name) instead — the composite covers
      // the rename + persist flow honestly.
      throw new DispatchError(
        'capability_not_supported',
        'Fractal AM4',
        'rename(target="preset") needs a location on Fractal AM4 — use save_preset(location, name) to rename + persist, or am4_set_preset_name with an explicit location.',
        { retry_action: 'Call save_preset(port, location, name).' },
      );
    }
    const m = /^scene:([1-4])$/.exec(target);
    if (!m) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `rename target '${target}' is not valid on Fractal AM4. Valid: 'scene:1'..'scene:4'.`,
      );
    }
    const sceneIdx = Number(m[1]) - 1;
    const bytes = buildSetSceneName(sceneIdx, name);
    const result = await sendAndAwaitAck(ctx.conn, bytes, isCommandAck);
    return {
      op: 'rename',
      target,
      acked: result.acked,
      warning: result.acked
        ? `Scene ${sceneIdx + 1} renamed to "${name}" in the working buffer. Call save_preset to persist.`
        : `Scene rename sent but no ack — verify on the AM4 display.`,
    };
  },
};

// ── Reader adapter ──────────────────────────────────────────────────
//
// `getParam` wraps the existing `sendReadAndParse` + `decode` pipeline
// from the legacy `am4_get_param` handler. The dispatcher pre-resolves
// the canonical (block, name); this method does the wire round-trip
// and returns the display value. Optional channel switch happens
// before the read so callers can target A/B/C/D explicitly without
// a separate switch tool call.

const reader: DeviceReader = {
  async getParam(
    ctx: DispatchCtx,
    block: string,
    name: string,
    channel?: string | number,
  ): Promise<ReadResult> {
    const key = `${block}.${name}` as ParamKey;
    const param: Param = KNOWN_PARAMS[key];
    if (channel !== undefined && CHANNEL_BLOCKS.has(block)) {
      await switchBlockChannel(ctx.conn, block, channel);
    }
    const parsed = await sendReadAndParse(ctx.conn, param.pidLow, param.pidHigh);
    const wire = param.unit === 'enum'
      ? parsed.asUInt32LE()
      : parsed.asInternalFloat();
    const display = param.unit === 'enum'
      ? ((param.enumValues as Record<number, string> | undefined)?.[Math.round(wire)] ?? Math.round(wire))
      : am4Decode(param, wire);
    return {
      block,
      name,
      wire_value: wire,
      display_value: display,
      unit: param.unit,
    };
  },

  async getParams(ctx: DispatchCtx, queries) {
    const reads: ReadResult[] = [];
    const failed_indices: number[] = [];
    const errors: Record<number, string> = {};
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      try {
        reads.push(await reader.getParam(ctx, q.block, q.name, q.channel));
      } catch (err) {
        failed_indices.push(i);
        errors[i] = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      reads,
      failed_indices,
      errors: failed_indices.length > 0 ? errors : undefined,
    };
  },

  async scanLocations(ctx, from, to) {
    const fromIdx = parseAm4Location(from);
    const toIdx = parseAm4Location(to);
    if (fromIdx > toIdx) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Scan range invalid: ${from} (idx ${fromIdx}) is after ${to} (idx ${toIdx}). Pass from <= to.`,
      );
    }
    const scanned: import('@/protocol/generic/types.js').ScannedLocation[] = [];
    let failed_at: string | undefined;
    let failed_reason: string | undefined;
    for (let i = fromIdx; i <= toIdx; i++) {
      try {
        const parsed = await readPresetName(ctx.conn, i);
        scanned.push({
          location: formatLocationDisplay(i),
          name: parsed.name,
          is_empty: parsed.isEmpty,
        });
      } catch (err) {
        failed_at = formatLocationDisplay(i);
        failed_reason = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    return { scanned, failed_at, failed_reason };
  },

  lookupLineage(query) {
    const blockType = query.block_type;
    if (!LINEAGE_BLOCKS.includes(blockType as typeof LINEAGE_BLOCKS[number])) {
      return {
        ok: false,
        text: `Block type '${blockType}' has no Fractal-authored lineage corpus. Valid: ${LINEAGE_BLOCKS.join(', ')}.`,
      };
    }
    const result = runLineageLookup({
      block_type: blockType as typeof LINEAGE_BLOCKS[number],
      name: query.name,
      real_gear: query.real_gear,
      manufacturer: query.manufacturer,
      model: query.model,
    });
    if (!result.found) {
      const detail = result.shape === 'structured'
        ? [
            query.manufacturer && `manufacturer="${query.manufacturer}"`,
            query.model && `model="${query.model}"`,
          ].filter(Boolean).join(', ')
        : (query.name ?? query.real_gear ?? '(unknown query)');
      return {
        ok: false,
        text: `No ${blockType} lineage records match ${detail}. ${result.totalScanned} records scanned.`,
      };
    }
    const withQuotes = query.include_quotes ?? true;
    if (result.shape === 'forward') {
      return { ok: true, text: formatLineageRecord(result.hits[0].record, withQuotes) };
    }
    const blocks = result.hits.map(
      (h) => `── ${'am4Name' in h ? h.am4Name : '?'} ──\n${formatLineageRecord(h.record, withQuotes, 3)}`,
    );
    return {
      ok: true,
      text: `${result.hits.length} ${blockType} match(es)${result.hits.length > 10 ? ' (showing top 10)' : ''}:\n\n${blocks.join('\n\n')}`,
    };
  },
};

// ── Top-level descriptor ────────────────────────────────────────────

export const AM4_DESCRIPTOR: DeviceDescriptor = {
  id: 'am4',
  display_name: 'Fractal AM4',
  connection_label: 'am4',                      // matches AM4_LABEL in connections.ts
  port_match: [
    { pattern: /AM4/i },
    { pattern: /Fractal/i },
  ],
  capabilities: {
    slot_model: 'linear',
    slot_count: 4,
    has_scenes: true,
    scene_count: 4,
    has_channels: true,
    channel_names: ['A', 'B', 'C', 'D'],
    channel_blocks: ['amp', 'drive', 'reverb', 'delay'],
    preset_location_format: /^[A-Z](0[1-4])$/,
    supports_save: true,
    supports_factory_restore: true,
    supports_lineage: true,
  },
  canonical_terms: {
    block: 'block',
    slot: 'slot 1–4',
    preset: 'preset',
    scene: 'scene 1–4',
    channel: 'channel A/B/C/D',
    location: `location A01..Z04 (${TOTAL_LOCATIONS} total)`,
  },
  blocks: buildBlocks(),
  block_types: buildBlockTypes(),
  reader,
  writer,
};
