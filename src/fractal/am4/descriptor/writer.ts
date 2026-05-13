/**
 * AM4 DeviceDescriptor — `DeviceWriter` implementation.
 *
 * Wraps the existing AM4 protocol layer (params.ts, blockTypes.ts,
 * setParam.ts, applyExecutor.ts, factoryBank.ts) into the
 * `DeviceWriter` contract from `src/protocol/generic/types.ts`.
 *
 * Two flavors of method:
 *   - Pure builders (`buildSetParam`, `buildSwitchPreset`,
 *     `buildSavePreset`, `buildSwitchScene`) — return wire bytes
 *     without touching the connection. Used by goldens to assert
 *     byte-equivalence with the legacy am4_* tools.
 *   - Execute methods (`setParam`, `setParams`, `switchPreset`,
 *     `savePreset`, `switchScene`, `setBlock`, `setBypass`,
 *     `applyPreset`, `applySetlist`, `restoreDefaults`,
 *     `restoreDefaultsRange`, `rename`) — drive the wire round-trip
 *     via `sendAndAwaitAck` + the shared applyExecutor pipeline.
 *
 * Legacy `am4_*` tools keep working in parallel through v0.1.0; this
 * writer is what the unified `set_param` / `apply_preset` / etc.
 * dispatchers call at runtime.
 */

import type {
  ApplyResult,
  ApplySetlistResult,
  BatchWriteResult,
  DeviceWriter,
  DispatchCtx,
  PresetSpec,
  RenameTarget,
  RestoreDefaultsOptions,
  RestoreDefaultsRangeOptions,
  RestoreDefaultsRangeResult,
  RestoreDefaultsResult,
  SceneSpec,
  SetlistApplyOptions,
  SetlistEntrySpec,
  SetlistEntryResult,
  WriteResult,
} from '@/protocol/generic/types.js';
import { DispatchError } from '@/protocol/generic/types.js';

import {
  KNOWN_PARAMS,
  type Param,
  type ParamKey,
} from '@/fractal/am4/params.js';
import {
  BLOCK_NAMES_BY_VALUE,
  BLOCK_TYPE_VALUES,
  resolveBlockType,
} from '@/fractal/am4/blockTypes.js';
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
import {
  prepareApplyPresetWrites,
  runApplyPresetAt,
  runApplyPresetWires,
  type ApplyPresetInput,
  type ApplyPresetSceneInput,
  type ApplyPresetSlotInput,
} from '@/fractal/am4/tools/applyExecutor.js';
import { loadFactoryBank, sendFactoryRestore } from '@/fractal/am4/factoryBank.js';
import { guardActiveAM4BufferOrSave } from '@/fractal/am4/tools/safeEdit.js';
import { readPresetName } from '@/server/shared/readOps.js';
import { recordInbound, sendAndAwaitAck } from '@/server/shared/wireOps.js';
import {
  CHANNEL_BLOCKS,
  channelLetter,
  invalidateChannelCache,
  switchBlockChannel,
} from '@/server/shared/channels.js';
import {
  formatLocationCode,
  formatLocationDisplay,
} from '@/fractal/am4/locations.js';

import { parseAm4Location } from './schema.js';

/**
 * Translate the generic-surface PresetSpec into the AM4-native
 * ApplyPresetInput shape. The legacy AM4 schema supports `channel`
 * (single-channel shortcut) and `params` (current-channel) for backward
 * compat; the unified surface only exposes per-channel `channels`, so
 * we translate slots[].params (channel → name → value) onto the legacy
 * `channels` field. Shared by `validatePreset` (pre-MIDI) and
 * `applyPreset` (execute) so both paths see byte-identical translated
 * input.
 */
function specToApplyInput(spec: PresetSpec): ApplyPresetInput {
  const slots: ApplyPresetSlotInput[] = spec.slots.map((s) => {
    if (typeof s.slot !== 'number') {
      throw new DispatchError(
        'capability_not_supported',
        'Fractal AM4',
        `apply_preset on Fractal AM4 uses linear slots — pass slot as a 1..4 integer, not {row,col}.`,
      );
    }
    const channels: Record<string, Record<string, number | string>> = {};
    if (s.params) {
      for (const [ch, paramMap] of Object.entries(s.params)) {
        channels[ch] = { ...paramMap } as Record<string, number | string>;
      }
    }
    return {
      position: s.slot,
      block_type: s.block_type,
      channels: Object.keys(channels).length > 0 ? channels : undefined,
    };
  });

  const scenes: ApplyPresetSceneInput[] | undefined = spec.scenes?.map((sc: SceneSpec) => {
    const channels: Record<string, string> = {};
    if (sc.channels) {
      for (const [block, ch] of Object.entries(sc.channels)) {
        channels[block] = typeof ch === 'number' ? ['A', 'B', 'C', 'D'][ch] : String(ch);
      }
    }
    return {
      index: sc.scene,
      name: sc.name,
      channels: Object.keys(channels).length > 0 ? channels : undefined,
      bypass: sc.bypassed ? { ...sc.bypassed } : undefined,
    };
  });

  // landingScene parity (restored v0.3 audit). AM4 scenes are 1..4
  // and the executor clamps; explicit out-of-range throws early.
  let landingScene: 1 | 2 | 3 | 4 | undefined;
  if (spec.landingScene !== undefined) {
    if (!Number.isInteger(spec.landingScene) || spec.landingScene < 1 || spec.landingScene > 4) {
      throw new DispatchError(
        'value_out_of_range',
        'Fractal AM4',
        `landingScene=${spec.landingScene} out of range on Fractal AM4 (valid: 1..4).`,
      );
    }
    landingScene = spec.landingScene as 1 | 2 | 3 | 4;
  }

  return { slots, name: spec.name, scenes, landingScene };
}

export const writer: DeviceWriter = {
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

  validatePreset(spec: PresetSpec, _target): void {
    // Translate generic PresetSpec → AM4-native ApplyPresetInput and run
    // applyExecutor's pre-MIDI validation pass. Throws a plain Error
    // with the human-facing rejection message; the dispatcher's tool
    // handler formats it via asError. Same translation logic as the
    // execute path (kept in sync via specToApplyInput below).
    const input = specToApplyInput(spec);
    prepareApplyPresetWrites(input);
  },

  async applyPreset(ctx, spec: PresetSpec, target): Promise<ApplyResult> {
    const input = specToApplyInput(spec);

    const startMs = Date.now();
    if (target !== undefined) {
      const locationIndex = parseAm4Location(target);
      const capture = recordInbound(ctx.conn);
      let result;
      try {
        result = await runApplyPresetAt(ctx.conn, locationIndex, input);
      } finally {
        capture.unsubscribe();
      }
      if (result.ok) {
        return {
          ok: true,
          steps: spec.slots.length + (spec.scenes?.length ?? 0) + 2,
          duration_ms: result.wallTimeMs,
        };
      }
      return {
        ok: false,
        steps: 0,
        duration_ms: result.wallTimeMs,
        failed_step: {
          index: 0,
          description: result.step,
          error: result.error,
        },
      };
    }

    // Working-buffer-only path: validate + run wires, no switch/save.
    let prepared;
    let nameWriteBytes;
    try {
      ({ prepared, nameWriteBytes } = prepareApplyPresetWrites(input));
    } catch (err) {
      return {
        ok: false,
        steps: 0,
        duration_ms: Date.now() - startMs,
        failed_step: { index: 0, description: 'validate', error: err instanceof Error ? err.message : String(err) },
      };
    }
    const capture = recordInbound(ctx.conn);
    let wireResult;
    try {
      wireResult = await runApplyPresetWires(ctx.conn, prepared, nameWriteBytes, input.name);
    } finally {
      capture.unsubscribe();
    }
    return {
      ok: wireResult.unacked === 0,
      steps: wireResult.totalWrites,
      duration_ms: Date.now() - startMs,
      warning: wireResult.unacked > 0
        ? `${wireResult.unacked} of ${wireResult.totalWrites} writes did not ack within timeout — verify on the AM4 display or call reconnect_midi.`
        : undefined,
    };
  },

  async applySetlist(
    ctx,
    entries: readonly SetlistEntrySpec[],
    options?: SetlistApplyOptions,
  ): Promise<ApplySetlistResult> {
    const startMs = Date.now();
    const onError: 'stop' | 'continue' = options?.on_error ?? 'stop';
    const dryRun = options?.dry_run ?? false;
    const verifyEnabled = options?.verify ?? true;

    // Pre-validation: resolve locations, check uniqueness, run prepare pass.
    const resolved: { shortLocation: string; locationIndex: number; input: ApplyPresetInput }[] = [];
    const seenLocations = new Set<number>();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const locationIndex = parseAm4Location(e.location);
      if (seenLocations.has(locationIndex)) {
        throw new DispatchError(
          'bad_location',
          'Fractal AM4',
          `entries[${i}] (location ${formatLocationCode(locationIndex)}): appears more than once in the batch; each location may appear at most once per call.`,
        );
      }
      seenLocations.add(locationIndex);

      // Translate PresetSpec → ApplyPresetInput for this entry.
      let input: ApplyPresetInput;
      try {
        input = specToApplyInput(e.spec);
        prepareApplyPresetWrites(input);
      } catch (err) {
        throw new DispatchError(
          'value_out_of_range',
          'Fractal AM4',
          `entries[${i}] (location ${formatLocationCode(locationIndex)}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      resolved.push({
        shortLocation: formatLocationDisplay(locationIndex),
        locationIndex,
        input,
      });
    }

    if (dryRun) {
      return {
        ok: true,
        total: resolved.length,
        applied: 0,
        failed: 0,
        remaining: [],
        results: resolved.map((r) => ({
          location: r.shortLocation,
          status: 'ok' as const,
          wallTimeMs: 0,
        })),
        totalWallTimeMs: Date.now() - startMs,
      };
    }

    const capture = recordInbound(ctx.conn);
    const results: SetlistEntryResult[] = [];
    let applied = 0;
    let failed = 0;
    let finalActiveLocation = resolved[0].shortLocation;
    let stopIndex: number | undefined;
    try {
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const result = await runApplyPresetAt(ctx.conn, r.locationIndex, r.input);
        finalActiveLocation = r.shortLocation;
        if (!result.ok) {
          failed++;
          results.push({
            location: r.shortLocation,
            status: 'error',
            error: `${result.step}: ${result.error}`,
            wallTimeMs: result.wallTimeMs,
          });
          if (onError === 'stop') {
            stopIndex = i;
            break;
          }
          continue;
        }
        const expectedName = r.input.name?.trim();
        if (verifyEnabled && expectedName !== undefined && expectedName !== '') {
          const verifyStart = Date.now();
          let verifyError: string | undefined;
          try {
            const parsed = await readPresetName(ctx.conn, r.locationIndex);
            const actualName = parsed.isEmpty ? '<EMPTY>' : parsed.name;
            if (expectedName.toLowerCase() !== actualName.trim().toLowerCase()) {
              verifyError = `verification mismatch: applied "${expectedName}" but device reads back "${actualName}".`;
            }
          } catch (err) {
            verifyError = `verification timeout: could not read back name at ${r.shortLocation} (${err instanceof Error ? err.message : String(err)}).`;
          }
          if (verifyError) {
            failed++;
            results.push({
              location: r.shortLocation,
              status: 'error',
              error: verifyError,
              wallTimeMs: result.wallTimeMs + (Date.now() - verifyStart),
            });
            if (onError === 'stop') {
              stopIndex = i;
              break;
            }
            continue;
          }
        }
        applied++;
        results.push({ location: r.shortLocation, status: 'ok', wallTimeMs: result.wallTimeMs });
      }
    } finally {
      capture.unsubscribe();
    }
    const remaining = stopIndex !== undefined
      ? resolved.slice(stopIndex + 1).map((r) => r.shortLocation)
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

  async restoreDefaults(
    ctx,
    target,
    options?: RestoreDefaultsOptions,
  ): Promise<RestoreDefaultsResult> {
    const startMs = Date.now();
    const verifyEnabled = options?.verify ?? true;
    const locationIndex = parseAm4Location(target);
    try {
      loadFactoryBank();
    } catch (err) {
      return {
        ok: false,
        location: formatLocationDisplay(locationIndex),
        message: err instanceof Error ? err.message : String(err),
        wallTimeMs: Date.now() - startMs,
      };
    }
    let preRestoreName: string | undefined;
    if (verifyEnabled) {
      try {
        const parsed = await readPresetName(ctx.conn, locationIndex);
        preRestoreName = parsed.isEmpty ? '<EMPTY>' : parsed.name;
      } catch {
        preRestoreName = '<read-failed>';
      }
    }
    const result = await sendFactoryRestore(ctx.conn, locationIndex);
    let postRestoreName: string | undefined;
    let verified: boolean | undefined;
    if (verifyEnabled) {
      try {
        const parsed = await readPresetName(ctx.conn, locationIndex);
        postRestoreName = parsed.isEmpty ? '<EMPTY>' : parsed.name;
        if (postRestoreName === '<EMPTY>') {
          return {
            ok: false,
            location: formatLocationDisplay(locationIndex),
            message: `verification failure: post-restore name at ${formatLocationDisplay(locationIndex)} is <EMPTY>. Factory presets are never empty — the restore did not land.`,
            wallTimeMs: Date.now() - startMs,
            verified: false,
            preRestoreName,
            postRestoreName,
            totalBytes: result.totalBytes,
            messageCount: result.messageCount,
          };
        }
        verified = preRestoreName === undefined
          || preRestoreName.trim().toLowerCase() !== postRestoreName.trim().toLowerCase()
          || preRestoreName === '<EMPTY>';
      } catch (err) {
        return {
          ok: false,
          location: formatLocationDisplay(locationIndex),
          message: `verification timeout: could not read back preset name at ${formatLocationDisplay(locationIndex)} (${err instanceof Error ? err.message : String(err)}). Restore status unknown.`,
          wallTimeMs: Date.now() - startMs,
          preRestoreName,
          postRestoreName: '<read-failed>',
          totalBytes: result.totalBytes,
          messageCount: result.messageCount,
        };
      }
    }
    return {
      ok: true,
      location: formatLocationDisplay(locationIndex),
      message: verified === false
        ? `verification soft warning: pre="${preRestoreName}" equals post="${postRestoreName}" — either already factory or restore didn't land.`
        : `verified: pre="${preRestoreName}" → post="${postRestoreName}".`,
      wallTimeMs: Date.now() - startMs,
      verified,
      preRestoreName,
      postRestoreName,
      totalBytes: result.totalBytes,
      messageCount: result.messageCount,
    };
  },

  async restoreDefaultsRange(
    ctx,
    from,
    to,
    options?: RestoreDefaultsRangeOptions,
  ): Promise<RestoreDefaultsRangeResult> {
    const startMs = Date.now();
    const onError: 'stop' | 'continue' = options?.on_error ?? 'stop';
    const dryRun = options?.dry_run ?? false;
    const verifyEnabled = options?.verify ?? true;
    const fromIdx = parseAm4Location(from);
    const toIdx = parseAm4Location(to);
    if (fromIdx > toIdx) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Restore range invalid: ${from} (idx ${fromIdx}) is after ${to} (idx ${toIdx}).`,
      );
    }
    const totalSlots = toIdx - fromIdx + 1;
    const RANGE_CEILING = 26;
    if (totalSlots > RANGE_CEILING) {
      throw new DispatchError(
        'value_out_of_range',
        'Fractal AM4',
        `Range size ${totalSlots} exceeds the per-call ceiling of ${RANGE_CEILING} slots.`,
      );
    }
    try {
      loadFactoryBank();
    } catch (err) {
      throw new DispatchError(
        'capability_not_supported',
        'Fractal AM4',
        err instanceof Error ? err.message : String(err),
      );
    }
    if (dryRun) {
      return {
        ok: true,
        total: totalSlots,
        restored: 0,
        failed: 0,
        remaining: [],
        results: [],
        totalWallTimeMs: Date.now() - startMs,
      };
    }
    const results: RestoreDefaultsRangeResult['results'] = [];
    const resultsMut = results as Array<RestoreDefaultsRangeResult['results'][number]>;
    let restored = 0;
    let failed = 0;
    let stopIndex: number | undefined;
    for (let i = 0; i < totalSlots; i++) {
      const locationIndex = fromIdx + i;
      const display = formatLocationDisplay(locationIndex);
      const slotStart = Date.now();
      const single = await writer.restoreDefaults!(ctx, locationIndex, { verify: verifyEnabled });
      if (!single.ok) {
        failed++;
        resultsMut.push({
          location: display,
          status: 'error',
          error: single.message,
          preRestoreName: single.preRestoreName,
          postRestoreName: single.postRestoreName,
          wallTimeMs: Date.now() - slotStart,
        });
        if (onError === 'stop') {
          stopIndex = i;
          break;
        }
        continue;
      }
      restored++;
      resultsMut.push({
        location: display,
        status: 'ok',
        preRestoreName: single.preRestoreName,
        postRestoreName: single.postRestoreName,
        wallTimeMs: Date.now() - slotStart,
      });
    }
    const remaining = stopIndex !== undefined
      ? Array.from({ length: totalSlots - stopIndex - 1 }, (_, k) =>
          formatLocationDisplay(fromIdx + stopIndex! + 1 + k))
      : [];
    return {
      ok: failed === 0,
      total: totalSlots,
      restored,
      failed,
      remaining,
      results,
      totalWallTimeMs: Date.now() - startMs,
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

  /**
   * Safe-edit dirty-gate adapter. Delegates to the device-specific
   * implementation in tools/safeEdit.ts which knows AM4's location-
   * code naming + READ_PRESET_NAME wire format.
   */
  async guardActiveBufferOrSave(ctx, mode) {
    return guardActiveAM4BufferOrSave(ctx.conn, mode);
  },
};
