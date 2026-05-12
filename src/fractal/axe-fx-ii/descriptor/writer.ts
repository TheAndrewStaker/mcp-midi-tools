/**
 * Axe-Fx II DeviceDescriptor — `DeviceWriter` implementation.
 *
 * Wraps the existing Axe-Fx II protocol layer (setParam.ts, params.ts,
 * blockTypes.ts, applyExecutor.ts) into the `DeviceWriter` contract
 * from `src/protocol/generic/types.ts`.
 *
 * Two flavors of method:
 *   - Pure builders (`buildSetParam`, `buildSwitchPreset`,
 *     `buildSavePreset`, `buildSwitchScene`) — return wire bytes
 *     without touching the connection. Used by goldens to assert
 *     byte-equivalence with the legacy axefx2_* tools.
 *   - Execute methods (`setParam`, `setParams`, `switchPreset`,
 *     `savePreset`, `switchScene`, `setBlock`, `setBypass`,
 *     `applyPreset`, `applySetlist`, `rename`) — drive the wire
 *     round-trip via `ctx.conn` + the shared applyExecutor pipeline.
 *
 * Legacy `axefx2_*` tools keep working in parallel through v0.1.x;
 * this writer is what the unified `set_param` / `apply_preset` / etc.
 * dispatchers call at runtime.
 *
 * Per Q3 / Q6 (Session 66 wrap, 2026-05-12): scene-name rename and
 * multi-scene authoring are out of MVP scope. `rename(target='scene:N')`
 * throws `capability_not_supported`; PresetSpec.scenes[] uses only the
 * first entry's scene index (no per-scene channel/bypass walk).
 *
 * Per Q8 (Session 66 wrap): every `applyPreset` / `applySetlist` call
 * runs values through `descriptor.blocks[block].params[name].encode()`
 * BEFORE passing them to `buildApplyPresetAtOps` with `{wire: true}` —
 * the schema's encode closure is the canonical display→wire path; the
 * executor's auto-detect short-circuits in this mode.
 */

import type {
  ApplyResult,
  ApplySetlistResult,
  BatchWriteResult,
  BlockChange,
  DeviceWriter,
  DispatchCtx,
  LocationRef,
  PresetSpec,
  RenameTarget,
  SetlistApplyOptions,
  SetlistEntryResult,
  SetlistEntrySpec,
  SlotRef,
  WriteResult,
} from '@/protocol/generic/types.js';
import { DispatchError } from '@/protocol/generic/types.js';

import {
  AXE_FX_II_BLOCKS,
  BLOCK_BY_ID,
  resolveBlock,
  type AxeFxIIBlock,
} from '@/fractal/axe-fx-ii/blockTypes.js';
import { KNOWN_PARAMS, type AxeFxIIParam } from '@/fractal/axe-fx-ii/params.js';
import {
  buildGetPresetName,
  buildSetBlockBypass,
  buildSetBlockChannel,
  buildSetBlockParameterValue,
  buildSetGridCell,
  buildSetPresetName,
  buildSetSceneNumber,
  buildStorePreset,
  buildSwitchPreset,
  channelToWire,
  displayToWire,
  isGetPresetNameResponse,
  isSetGridCellResponse,
  isStorePresetResponse,
  parseGetPresetNameResponse,
  parseSetGridCellResponse,
  parseStorePresetResponse,
  wireToDisplay,
  type AxeFxIIChannel,
} from '@/fractal/axe-fx-ii/setParam.js';

import {
  buildApplyPresetAtOps,
  buildApplyPresetOps,
  runApplyPresetAtOps,
  type ApplyPresetAtInput,
  type ApplyPresetInput,
} from '@/fractal/axe-fx-ii/tools/applyExecutor.js';
import { findParamFuzzy } from '@/fractal/axe-fx-ii/paramAliases.js';

import { findBlockBySlug, parseAxeFxIILocation } from './schema.js';

const DEVICE_LABEL = 'Fractal Axe-Fx II XL+';

// Channel-switch settle window. The Axe-Fx II silently absorbs param
// writes that race ahead of a channel switch — 20ms matches the legacy
// preset.ts settle.
const CHANNEL_SWITCH_SETTLE_MS = 20;

// Store-preset response timeout. The device acks 0x64 1D 00 within
// ~150ms on Q8.02; 800ms is generous.
const STORE_RESPONSE_TIMEOUT_MS = 800;
const GRID_CELL_RESPONSE_TIMEOUT_MS = 800;
const GET_NAME_TIMEOUT_MS = 800;

// ── Param-name → AxeFxIIParam ───────────────────────────────────────
// Resolution shared with legacy axefx2_* tools via paramAliases.ts.

function findParamByName(block: AxeFxIIBlock, name: string): AxeFxIIParam | undefined {
  return findParamFuzzy(block, name);
}

function resolveBlockOrThrow(slugOrName: string): AxeFxIIBlock {
  // Try descriptor-style slug first ("amp", "reverb"), then legacy
  // display-name resolver ("Amp 1", "Reverb 1") as fallback.
  const fromSlug = findBlockBySlug(slugOrName);
  if (fromSlug) return fromSlug;
  const fromName = resolveBlock(slugOrName);
  if (fromName) return fromName;
  const sample = AXE_FX_II_BLOCKS.slice(0, 6).map((b) => `"${b.name}"`).join(', ');
  throw new DispatchError(
    'unknown_block',
    DEVICE_LABEL,
    `Block '${slugOrName}' is not valid on Fractal Axe-Fx II. First few: ${sample}… (call list_params for the full list).`,
  );
}

function findParamOrThrow(block: AxeFxIIBlock, name: string): AxeFxIIParam {
  const p = findParamByName(block, name);
  if (p) return p;
  throw new DispatchError(
    'unknown_param',
    DEVICE_LABEL,
    `Parameter '${block.name}.${name}' (group ${block.groupCode}) is not registered on Fractal Axe-Fx II.`,
  );
}

// ── Channel resolution helper ───────────────────────────────────────

function normalizeChannel(channel: string | number | undefined): AxeFxIIChannel | undefined {
  if (channel === undefined) return undefined;
  if (typeof channel === 'number') {
    if (channel === 0) return 'X';
    if (channel === 1) return 'Y';
    throw new DispatchError(
      'bad_channel',
      DEVICE_LABEL,
      `Channel index ${channel} is out of range on Fractal Axe-Fx II (valid: 0=X, 1=Y).`,
    );
  }
  const upper = channel.trim().toUpperCase();
  if (upper === 'X' || upper === 'Y') return upper as AxeFxIIChannel;
  throw new DispatchError(
    'bad_channel',
    DEVICE_LABEL,
    `Channel '${channel}' is not valid on Fractal Axe-Fx II (channels are X/Y).`,
    { valid_options: ['X', 'Y'] },
  );
}

// ── Pure builders ───────────────────────────────────────────────────

export const writer: DeviceWriter = {
  buildSetParam(blockSlug, name, wireValue): number[] {
    const block = resolveBlockOrThrow(blockSlug);
    const param = findParamOrThrow(block, name);
    return buildSetBlockParameterValue(
      { effectId: block.id, paramId: param.paramId },
      wireValue,
    );
  },

  buildChannelSwitch(blockSlug, channel): number[] {
    const block = resolveBlockOrThrow(blockSlug);
    if (!block.canBypass) {
      // canBypass is the closest proxy we have for "exposes channels" —
      // the channel field doesn't model "has channels" yet. Return empty
      // when channels aren't a concept for this block.
      return [];
    }
    return buildSetBlockChannel(block.id, channel === 0 ? 'X' : 'Y');
  },

  buildSwitchPreset(location): number[] {
    return buildSwitchPreset(parseAxeFxIILocation(location));
  },

  buildSavePreset(location, _name): number[] {
    // Pure builder returns ONLY the STORE bytes. Rename is a separate
    // wire op handled by the execute path.
    return buildStorePreset(parseAxeFxIILocation(location));
  },

  buildSwitchScene(scene): number[] {
    if (!Number.isInteger(scene) || scene < 1 || scene > 8) {
      throw new DispatchError(
        'bad_location',
        DEVICE_LABEL,
        `Scene index ${scene} out of range on Fractal Axe-Fx II (valid: 1..8).`,
      );
    }
    return buildSetSceneNumber(scene - 1);
  },

  // ── Execute: param writes ─────────────────────────────────────────

  async setParam(ctx, blockSlug, name, wireValue, channel): Promise<WriteResult> {
    const block = resolveBlockOrThrow(blockSlug);
    const param = findParamOrThrow(block, name);
    const channelWire = normalizeChannel(channel);

    // Pre-write channel switch with settle.
    if (channelWire !== undefined && block.canBypass) {
      ctx.conn.send(buildSetBlockChannel(block.id, channelWire));
      await new Promise((res) => setTimeout(res, CHANNEL_SWITCH_SETTLE_MS));
    }

    const bytes = buildSetBlockParameterValue(
      { effectId: block.id, paramId: param.paramId },
      wireValue,
    );
    ctx.conn.send(bytes);
    // Axe-Fx II SET is fire-and-forget — no wire ack. We surface
    // acked: true to match the AM4 descriptor's success shape and let
    // the warning carry the no-ack semantics.
    const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
    let display: number | string;
    if (param.controlType === 'select') {
      display = param.enumValues?.[wireValue] ?? wireValue;
    } else if (param.controlType === 'switch') {
      display = wireValue ? 'on' : 'off';
    } else if (hasCalibration) {
      display = wireToDisplay(wireValue, {
        displayMin: param.displayMin as number,
        displayMax: param.displayMax as number,
        displayScale: param.displayScale,
      });
    } else {
      display = wireValue;
    }
    return {
      op: 'set_param',
      target: `${blockSlug}.${param.name}`,
      block: blockSlug,
      name: param.name,
      wire_value: wireValue,
      display_value: display,
      acked: true,
      channel: channelWire,
      warning: 'Axe-Fx II SET is fire-and-forget — verify by audible/visible response on the device.',
    };
  },

  async setParams(ctx, ops): Promise<BatchWriteResult> {
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

  // ── Execute: preset navigation ────────────────────────────────────

  async switchPreset(ctx, location): Promise<WriteResult> {
    const n = parseAxeFxIILocation(location);
    const slot = n + 1;
    ctx.conn.send(buildSwitchPreset(n));
    // Switch is fire-and-forget; no ack from the device. Settle window
    // matches the legacy axefx2_apply_preset behavior.
    await new Promise((res) => setTimeout(res, CHANNEL_SWITCH_SETTLE_MS));
    return {
      op: 'switch_preset',
      target: String(slot),
      acked: true,
      warning: `Loaded display slot ${slot} (wire ${n}). Any unsaved working-buffer edits were discarded.`,
    };
  },

  async savePreset(ctx, location, name): Promise<WriteResult> {
    const n = parseAxeFxIILocation(location);
    const slot = n + 1;
    // Optional rename FIRST (fire-and-forget — the device persists the
    // rename through the subsequent STORE).
    if (name !== undefined && name.length > 0) {
      try {
        ctx.conn.send(buildSetPresetName(name));
      } catch (err) {
        return {
          op: 'save_preset',
          target: String(slot),
          acked: false,
          warning: `Rename to "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    const ackPromise = ctx.conn.receiveSysExMatching(
      isStorePresetResponse,
      STORE_RESPONSE_TIMEOUT_MS,
    );
    ctx.conn.send(buildStorePreset(n));
    try {
      const ack = await ackPromise;
      const parsed = parseStorePresetResponse(ack);
      return {
        op: 'save_preset',
        target: String(slot),
        acked: parsed.ok,
        warning: parsed.ok
          ? (name
              ? `Saved "${name}" to display slot ${slot} (wire ${n}).`
              : `Working buffer saved to display slot ${slot} (wire ${n}).`)
          : `Device returned result code 0x${parsed.resultCode.toString(16)} — save likely rejected.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        op: 'save_preset',
        target: String(slot),
        acked: false,
        warning: `No STORE_PRESET ack within ${STORE_RESPONSE_TIMEOUT_MS}ms — ${msg}. Save state unknown; verify on the device.`,
      };
    }
  },

  async switchScene(ctx, scene): Promise<WriteResult> {
    if (!Number.isInteger(scene) || scene < 1 || scene > 8) {
      throw new DispatchError(
        'bad_location',
        DEVICE_LABEL,
        `Scene index ${scene} out of range on Fractal Axe-Fx II (valid: 1..8).`,
      );
    }
    ctx.conn.send(buildSetSceneNumber(scene - 1));
    return {
      op: 'switch_scene',
      target: `scene:${scene}`,
      acked: true,
      warning: `Switched to scene ${scene} (wire ${scene - 1}). Subsequent param writes land in this scene's context.`,
    };
  },

  // ── Execute: block layout ─────────────────────────────────────────

  async setBlock(ctx, slot: SlotRef, change: BlockChange): Promise<WriteResult> {
    if (typeof slot === 'number') {
      throw new DispatchError(
        'bad_location',
        DEVICE_LABEL,
        `set_block on Fractal Axe-Fx II uses grid coordinates — pass slot as { row: 1..4, col: 1..12 }, not a single integer.`,
        { retry_action: 'Pass slot: { row, col }.' },
      );
    }
    const { row, col } = slot;
    if (change.block_type === undefined) {
      throw new DispatchError(
        'capability_not_supported',
        DEVICE_LABEL,
        `set_block on Fractal Axe-Fx II currently only handles block placement. Pass block_type to place/clear; use set_bypass for bypass writes; use set_param for channel switches.`,
        { retry_action: 'Call set_bypass(port, block, bypassed) or set_param(port, block, ...) for the other writes.' },
      );
    }
    let blockId: number;
    if (change.block_type === 'none' || change.block_type === 'empty') {
      blockId = 0;
    } else {
      const target = resolveBlockOrThrow(change.block_type);
      blockId = target.id;
    }
    const bytes = buildSetGridCell({ row, col, blockId });
    const ackPromise = ctx.conn.receiveSysExMatching(
      isSetGridCellResponse,
      GRID_CELL_RESPONSE_TIMEOUT_MS,
    );
    ctx.conn.send(bytes);
    try {
      const ack = await ackPromise;
      const parsed = parseSetGridCellResponse(ack);
      const blockName = blockId === 0 ? 'empty' : (BLOCK_BY_ID[blockId]?.name ?? `block #${blockId}`);
      return {
        op: 'set_block',
        target: `r${row}c${col}=${blockName}`,
        acked: parsed.ok,
        warning: parsed.ok
          ? `Placed ${blockName} at row ${row}, col ${col}. Note: this write does NOT propagate routing — downstream cells' input masks still point at the previous occupant's position.`
          : `Device returned result code 0x${parsed.resultCode.toString(16)} — placement rejected.`,
      };
    } catch (err) {
      return {
        op: 'set_block',
        target: `r${row}c${col}`,
        acked: false,
        warning: `No SET_GRID_CELL ack within ${GRID_CELL_RESPONSE_TIMEOUT_MS}ms — ${err instanceof Error ? err.message : String(err)}.`,
      };
    }
  },

  async setBypass(ctx, blockSlug, bypassed): Promise<WriteResult> {
    const block = resolveBlockOrThrow(blockSlug);
    if (!block.canBypass) {
      throw new DispatchError(
        'capability_not_supported',
        DEVICE_LABEL,
        `Block '${block.name}' on Fractal Axe-Fx II cannot be bypassed (e.g. Mixer / Input / Output blocks).`,
      );
    }
    ctx.conn.send(buildSetBlockBypass(block.id, bypassed));
    return {
      op: 'set_bypass',
      target: `${block.name}:${bypassed ? 'bypassed' : 'engaged'}`,
      acked: true,
      warning: `${block.name} set to ${bypassed ? 'BYPASSED' : 'ENGAGED'}. Axe-Fx II SET is fire-and-forget — verify on the device.`,
    };
  },

  // ── Execute: apply preset ─────────────────────────────────────────

  async applyPreset(ctx, spec: PresetSpec, target?: LocationRef): Promise<ApplyResult> {
    const startMs = Date.now();
    let translated: ApplyPresetAtInput | ApplyPresetInput;
    try {
      translated = translateSpec(spec);
    } catch (err) {
      return {
        ok: false,
        steps: 0,
        duration_ms: Date.now() - startMs,
        failed_step: {
          index: 0,
          description: 'validate',
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }

    if (target !== undefined) {
      // parseAxeFxIILocation returns wire (0-indexed); the executor's
      // internal `preset_number` field IS wire.
      const presetNumber = parseAxeFxIILocation(target);
      const ops = buildApplyPresetAtOps(
        { ...translated, preset_number: presetNumber },
        { wire: true },
      );
      const result = await runApplyPresetAtOps(ctx.conn, ops);
      return {
        ok: result.ok,
        steps: ops.length,
        duration_ms: result.elapsedMs,
        failed_step: result.lastNack
          ? {
              index: 0,
              description: result.lastNack.summary,
              error: `result_code=0x${result.lastNack.resultCode.toString(16)}`,
            }
          : undefined,
        warning: !result.ok && !result.lastNack
          ? `STORE_PRESET did not ack within ${STORE_RESPONSE_TIMEOUT_MS}ms — save state unknown.`
          : undefined,
      };
    }

    // Working-buffer-only path: no switch_preset head, no STORE tail.
    const ops = buildApplyPresetOps(translated, { wire: true });
    const result = await runApplyPresetAtOps(ctx.conn, ops);
    return {
      ok: result.ok,
      steps: ops.length,
      duration_ms: result.elapsedMs,
      failed_step: result.lastNack
        ? {
            index: 0,
            description: result.lastNack.summary,
            error: `result_code=0x${result.lastNack.resultCode.toString(16)}`,
          }
        : undefined,
      warning: result.ok
        ? `Working buffer configured. Press SAVE on the device or call save_preset to persist.`
        : undefined,
    };
  },

  async applySetlist(
    ctx,
    entries: readonly SetlistEntrySpec[],
    options?: SetlistApplyOptions,
  ): Promise<ApplySetlistResult> {
    const onError: 'stop' | 'continue' = options?.on_error ?? 'stop';
    const dryRun = options?.dry_run ?? false;
    const verifyEnabled = options?.verify ?? false;
    const startMs = Date.now();

    // Pre-validation: resolve locations, check uniqueness, translate spec,
    // build ops up front so a bad entry at index 7 doesn't half-execute.
    const resolved: { location: string; presetNumber: number; ops: ReturnType<typeof buildApplyPresetAtOps>; name?: string }[] = [];
    const seenPresets = new Set<number>();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      // parseAxeFxIILocation returns wire (0-indexed); store display
      // slot in the user-facing `location` field.
      const presetNumber = parseAxeFxIILocation(e.location);
      const slot = presetNumber + 1;
      if (seenPresets.has(presetNumber)) {
        throw new DispatchError(
          'bad_location',
          DEVICE_LABEL,
          `entries[${i}] (display slot ${slot}): appears more than once in the batch; each preset slot may appear at most once per call.`,
        );
      }
      seenPresets.add(presetNumber);
      try {
        const translated = translateSpec(e.spec);
        const ops = buildApplyPresetAtOps(
          { ...translated, preset_number: presetNumber },
          { wire: true },
        );
        resolved.push({
          location: String(slot),
          presetNumber,
          ops,
          name: e.spec.name,
        });
      } catch (err) {
        throw new DispatchError(
          'value_out_of_range',
          DEVICE_LABEL,
          `entries[${i}] (display slot ${slot}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (dryRun) {
      return {
        ok: true,
        total: resolved.length,
        applied: 0,
        failed: 0,
        remaining: [],
        results: resolved.map((r) => ({
          location: r.location,
          status: 'ok' as const,
          wallTimeMs: 0,
        })),
        totalWallTimeMs: Date.now() - startMs,
      };
    }

    const results: SetlistEntryResult[] = [];
    let applied = 0;
    let failed = 0;
    let stopIndex: number | undefined;
    let finalActiveLocation: string | undefined;

    for (let i = 0; i < resolved.length; i++) {
      const entry = resolved[i];
      const entryStart = Date.now();
      try {
        const result = await runApplyPresetAtOps(ctx.conn, entry.ops);
        finalActiveLocation = entry.location;

        let verifyError: string | undefined;
        if (verifyEnabled && result.ok && entry.name !== undefined) {
          try {
            const ackPromise = ctx.conn.receiveSysExMatching(
              isGetPresetNameResponse,
              GET_NAME_TIMEOUT_MS,
            );
            ctx.conn.send(buildGetPresetName());
            const ack = await ackPromise;
            const liveName = parseGetPresetNameResponse(ack);
            if (liveName !== entry.name) {
              verifyError = `verify: preset name mismatch — wrote "${entry.name}", device reports "${liveName}".`;
            }
          } catch (err) {
            verifyError = `verify: GET_PRESET_NAME failed — ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        if (result.ok && verifyError === undefined) {
          applied++;
          results.push({
            location: entry.location,
            status: 'ok',
            wallTimeMs: Date.now() - entryStart,
          });
        } else {
          failed++;
          const errMsg = verifyError
            ?? (result.lastNack
              ? `${result.lastNack.summary} → result=0x${result.lastNack.resultCode.toString(16)}`
              : 'no STORE_PRESET ack arrived');
          results.push({
            location: entry.location,
            status: 'error',
            error: errMsg,
            wallTimeMs: Date.now() - entryStart,
          });
          if (onError === 'stop') {
            stopIndex = i;
            break;
          }
        }
      } catch (err) {
        failed++;
        results.push({
          location: entry.location,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          wallTimeMs: Date.now() - entryStart,
        });
        if (onError === 'stop') {
          stopIndex = i;
          break;
        }
      }
    }

    const remaining = stopIndex !== undefined
      ? resolved.slice(stopIndex + 1).map((r) => r.location)
      : [];

    return {
      ok: failed === 0,
      total: resolved.length,
      applied,
      failed,
      remaining,
      results,
      totalWallTimeMs: Date.now() - startMs,
      finalActiveLocation,
    };
  },

  // ── Execute: rename ───────────────────────────────────────────────

  async rename(ctx, target: RenameTarget, name): Promise<WriteResult> {
    if (target === 'preset') {
      ctx.conn.send(buildSetPresetName(name));
      return {
        op: 'rename',
        target: 'preset',
        acked: true,
        warning: `Working-buffer preset renamed to "${name}". Press SAVE or call save_preset to persist.`,
      };
    }
    // 'scene:N' — no decoded SET_SCENE_NAME on Axe-Fx II yet.
    throw new DispatchError(
      'capability_not_supported',
      DEVICE_LABEL,
      `rename target '${target}' is not supported on Fractal Axe-Fx II — scene-name writes have no decoded SysEx envelope on this device. Only target='preset' is implemented.`,
    );
  },
};

// ── PresetSpec → ApplyPresetInput translation ───────────────────────
//
// Maps the device-agnostic `PresetSpec` from `src/protocol/generic/types.ts`
// onto the Axe-Fx II-native shape the executor consumes.
//
// MVP simplifications (Section 6, Q1 + Q6 + Q7 of the descriptor plan):
//   - Single-instance addressing — every `block_type` resolves to
//     instance 1 of that group (no `amp_1` / `amp_2` discrimination).
//   - Single-scene authoring — only `spec.scenes[0]` is honored; its
//     `scene` index drives the executor's scene-switch op.
//   - Channel walk in `slots[].params` honors the FIRST channel only
//     when a slot supplies multiple (X then Y). The executor processes
//     each block once with a single optional channel switch.

function translateSpec(spec: PresetSpec): ApplyPresetInput {
  // Sort slots by grid column so the executor builds the chain
  // left-to-right. Per Section 6, all rows must be row 2 (auto-routing
  // limitation).
  const sorted = [...spec.slots].sort((a, b) => {
    const colA = typeof a.slot === 'object' ? a.slot.col : a.slot;
    const colB = typeof b.slot === 'object' ? b.slot.col : b.slot;
    return colA - colB;
  });

  const blocks: ApplyPresetAtInput['blocks'] = [];
  for (const s of sorted) {
    let row: number;
    if (typeof s.slot === 'object') {
      row = s.slot.row;
    } else {
      row = 2; // legacy linear-style — assume row 2
    }
    if (row !== 2) {
      throw new Error(
        `slot row=${row}: Axe-Fx II grid placement is row-2-only in MVP (multi-row routing not yet decoded). Pass slot: { row: 2, col: N } for every block.`,
      );
    }

    let channel: AxeFxIIChannel | undefined;
    let params: Record<string, number> | undefined;
    if (s.params) {
      // PresetSpec.params is channel → name → value. Axe-Fx II has X/Y;
      // collapse to the first present channel. If both X and Y are
      // supplied, the executor doesn't currently walk both — flag and
      // honor X.
      const keys = Object.keys(s.params);
      if (keys.length > 0) {
        const preferred = keys.includes('X') ? 'X' : (keys.includes('Y') ? 'Y' : keys[0]);
        channel = preferred === 'X' || preferred === 'Y' ? (preferred as AxeFxIIChannel) : undefined;
        const paramMap = s.params[preferred];
        params = {};
        for (const [k, v] of Object.entries(paramMap)) {
          // Values are still display units here; descriptor's encode
          // closure runs them through display→wire BEFORE we hand off to
          // the executor with {wire: true}.
          params[k] = encodeParamForApply(s.block_type, k, v);
        }
      }
    }

    blocks.push({
      block: s.block_type,
      bypass: s.bypassed,
      channel,
      params,
    });
  }

  let scene: number | undefined;
  if (spec.scenes && spec.scenes.length > 0) {
    const s = spec.scenes[0];
    if (!Number.isInteger(s.scene) || s.scene < 1 || s.scene > 8) {
      throw new Error(`scenes[0].scene=${s.scene} out of range (1..8).`);
    }
    scene = s.scene - 1; // executor uses 0-indexed scene
  }

  return {
    blocks,
    scene,
    name: spec.name,
  };
}

/**
 * Pre-encode a single param value for the apply path. Mirrors what the
 * descriptor's `params[name].encode` does — duplicated here so the
 * apply translator doesn't need a back-reference to the descriptor
 * (which would create a circular import). Falls back to wire pass-
 * through for params without calibration.
 */
function encodeParamForApply(
  blockSlug: string,
  paramName: string,
  value: number | string,
): number {
  const block = resolveBlockOrThrow(blockSlug);
  const param = findParamOrThrow(block, paramName);
  if (param.controlType === 'select') {
    if (typeof value === 'number') {
      if (param.enumValues?.[value] !== undefined) return value;
      throw new Error(`${blockSlug}.${paramName}: enum index ${value} out of range.`);
    }
    const lower = value.trim().toLowerCase();
    for (const [idxStr, label] of Object.entries(param.enumValues ?? {})) {
      if (label.toLowerCase() === lower) return Number(idxStr);
    }
    throw new Error(`${blockSlug}.${paramName}: unknown enum value "${value}".`);
  }
  if (param.controlType === 'switch') {
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      return (lower === 'true' || lower === 'on' || lower === '1') ? 1 : 0;
    }
    return value ? 1 : 0;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${blockSlug}.${paramName}: expected a number, got "${value}".`);
  }
  const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
  if (hasCalibration) {
    return displayToWire(num, {
      displayMin: param.displayMin as number,
      displayMax: param.displayMax as number,
      displayScale: param.displayScale,
    });
  }
  if (!Number.isInteger(num) || num < 0 || num > 65534) {
    throw new Error(`${blockSlug}.${paramName}: wire value out of range (0..65534): ${num}`);
  }
  return num;
}

// Re-export channelToWire so the writer-internal channel handling and
// the schema.ts findBlockBySlug helper share the same coercion path.
export { channelToWire };
