/**
 * Preset executors — `apply_preset`, `apply_setlist`, `restore_defaults`
 * full-lifecycle dispatch.
 *
 * `apply_preset` works in two modes: working-buffer only (no
 * target_location) or atomic switch + apply + save (with target_location).
 * `apply_setlist` iterates apply_preset across an N-entry batch with one
 * shared inbound capture. `restore_defaults` resets one location or a
 * range to factory; the descriptor decides which writer hook to call.
 */

import {
  DispatchError,
  type ApplyResult,
  type ApplySetlistResult,
  type PresetSpec,
  type RestoreDefaultsRangeOptions,
  type RestoreDefaultsRangeResult,
  type RestoreDefaultsResult,
  type SetlistApplyOptions,
  type SetlistEntrySpec,
} from '@/protocol/generic/types.js';

import { openCtx, requireDevice } from './core.js';

/**
 * Full lifecycle for `apply_preset`. Optional `target_location` runs the
 * switch + apply + save sequence atomically; without it, writes the
 * spec to the working buffer only (legacy `am4_apply_preset` shape).
 *
 * Safe-edit gates apply when `target_location` is set (cf.
 * `docs/SAFE-EDIT-WORKFLOW.md`):
 *   - `save_authorized` MUST be true; otherwise the dispatcher
 *     throws a `save_authorization_required` DispatchError that the
 *     unified tool handler formats into the canonical refusal text.
 *   - `on_active_preset_edited` is passed to the descriptor's
 *     `guardActiveBufferOrSave` (if the device supports dirty
 *     tracking); a refusal becomes a `buffer_dirty` DispatchError.
 *
 * Working-buffer-only mode (no `target_location`) doesn't navigate
 * and doesn't save, so neither gate applies.
 */
export async function executeApplyPreset(args: {
  port: string;
  spec: PresetSpec;
  target_location?: string | number;
  save_authorized?: boolean;
  on_active_preset_edited?: 'warn' | 'discard' | 'save_active_first';
}): Promise<ApplyResult & { device: string }> {
  const descriptor = requireDevice(args.port);
  if (descriptor.writer.applyPreset === undefined) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `apply_preset is not implemented for ${descriptor.display_name}.`,
    );
  }
  if (args.target_location !== undefined && !descriptor.capabilities.supports_save) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `apply_preset(target_location=...) requires a device that supports save; ${descriptor.display_name} does not.`,
    );
  }
  // Pre-MIDI validation pass: lets devices reject malformed specs
  // before we open a MIDI handle. Without this, "AM4 not found"
  // would mask a spec-shape bug whenever the hardware isn't connected.
  if (descriptor.writer.validatePreset !== undefined) {
    descriptor.writer.validatePreset(args.spec, args.target_location);
  }
  // Safe-edit contract for target_location:
  //   - The buffer-dirty gate ALWAYS runs (target_location implies the
  //     active location is about to change, so unsaved edits would be
  //     lost without the gate).
  //   - The save step requires explicit save_authorized=true. Without
  //     it, the executor runs switch + apply only ("audition at
  //     target" — working buffer holds the new build at the target
  //     location; reversible by switching presets).
  //
  // Working-buffer-only mode (no target_location) skips both gates:
  // no navigation, no save, the user's audition stays at the current
  // active location.
  const ctx = openCtx(descriptor);
  if (args.target_location !== undefined && descriptor.writer.guardActiveBufferOrSave) {
    const mode = args.on_active_preset_edited ?? 'warn';
    const guard = await descriptor.writer.guardActiveBufferOrSave(ctx, mode);
    if (!guard.proceed) {
      throw new DispatchError(
        'buffer_dirty',
        descriptor.display_name,
        guard.warningText ?? 'Navigation refused: active buffer has unsaved edits.',
      );
    }
  }
  const options = args.target_location !== undefined
    ? { save: args.save_authorized === true }
    : undefined;
  const result = await descriptor.writer.applyPreset(ctx, args.spec, args.target_location, options);
  return { ...result, device: descriptor.display_name };
}

/**
 * Full lifecycle for `apply_setlist`. Iterates apply_preset across N
 * entries with up-front validation. Returns a structured per-entry
 * result envelope so callers can summarize partial-success batches.
 */
export async function executeApplySetlist(args: {
  port: string;
  entries: readonly SetlistEntrySpec[];
  options?: SetlistApplyOptions;
  on_active_preset_edited?: 'warn' | 'discard' | 'save_active_first';
}): Promise<ApplySetlistResult & { device: string }> {
  const descriptor = requireDevice(args.port);
  if (descriptor.writer.applySetlist === undefined) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `apply_setlist is not implemented for ${descriptor.display_name}.`,
    );
  }
  if (!descriptor.capabilities.supports_save) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `apply_setlist requires a device that supports save; ${descriptor.display_name} does not.`,
    );
  }
  if (args.entries.length === 0) {
    throw new DispatchError(
      'value_out_of_range',
      descriptor.display_name,
      `apply_setlist requires at least one entry.`,
    );
  }
  const ctx = openCtx(descriptor);
  // Multi-preset intent implies save authorization, but the dirty
  // gate still applies — discarding the active buffer's unsaved
  // edits is a separate concern from "the user asked to save N
  // new presets." Per docs/SAFE-EDIT-WORKFLOW.md scenario 5.
  if (descriptor.writer.guardActiveBufferOrSave) {
    const mode = args.on_active_preset_edited ?? 'warn';
    const guard = await descriptor.writer.guardActiveBufferOrSave(ctx, mode);
    if (!guard.proceed) {
      throw new DispatchError(
        'buffer_dirty',
        descriptor.display_name,
        guard.warningText ?? 'Setlist refused: active buffer has unsaved edits.',
      );
    }
  }
  const result = await descriptor.writer.applySetlist(ctx, args.entries, args.options);
  return { ...result, device: descriptor.display_name };
}

/**
 * Full lifecycle for `restore_defaults`. Two shapes — single location or
 * inclusive range — picked by `to`. Devices without a factory bank
 * (descriptor.capabilities.supports_factory_restore=false) reject.
 */
export async function executeRestoreDefaults(args: {
  port: string;
  from: string | number;
  to?: string | number;
  on_error?: 'stop' | 'continue';
  dry_run?: boolean;
  verify?: boolean;
}): Promise<(RestoreDefaultsResult | RestoreDefaultsRangeResult) & { device: string; shape: 'single' | 'range' }> {
  const descriptor = requireDevice(args.port);
  if (!descriptor.capabilities.supports_factory_restore) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `${descriptor.display_name} does not expose a factory-restore capability.`,
    );
  }
  const ctx = openCtx(descriptor);
  if (args.to === undefined || args.to === args.from) {
    if (descriptor.writer.restoreDefaults === undefined) {
      throw new DispatchError(
        'capability_not_supported',
        descriptor.display_name,
        `restore_defaults (single) not implemented for ${descriptor.display_name}.`,
      );
    }
    const result = await descriptor.writer.restoreDefaults(ctx, args.from, { verify: args.verify });
    return { ...result, device: descriptor.display_name, shape: 'single' };
  }
  if (descriptor.writer.restoreDefaultsRange === undefined) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `restore_defaults (range) not implemented for ${descriptor.display_name}.`,
    );
  }
  const opts: RestoreDefaultsRangeOptions = {
    on_error: args.on_error,
    dry_run: args.dry_run,
    verify: args.verify,
  };
  const result = await descriptor.writer.restoreDefaultsRange(ctx, args.from, args.to, opts);
  return { ...result, device: descriptor.display_name, shape: 'range' };
}
