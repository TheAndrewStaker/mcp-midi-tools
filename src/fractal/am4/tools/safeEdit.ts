/**
 * AM4 safe-edit guard implementations — the cross-device contract in
 * `docs/SAFE-EDIT-WORKFLOW.md` ported to AM4 from the Axe-Fx II
 * reference implementation (Session 68).
 *
 * Two pieces:
 *
 *   - `guardActiveAM4BufferOrSave(mode)` — pre-navigation dirty check.
 *     If the buffer is dirty and `mode='warn'`, returns proceed=false
 *     with a structured warning naming the active location code.
 *     `mode='discard'` proceeds silently, `mode='save_active_first'`
 *     saves to the active location then proceeds.
 *   - `markAM4Dirty()` / `markAM4Clean()` — wrappers around the shared
 *     bufferDirty registry, scoped to the `'am4'` label.
 *
 * **Dirty-source-of-truth model** (Session 71 / 2026-05-13). AM4's
 * device-sourced dirty signal is pending HW-107 capture. Until that
 * lands we use a code-side send-classifier heuristic (per CLAUDE.md):
 *
 *   - markDirty on outbound write-class messages (set_param,
 *     set_block_type, set_block_bypass, set_*_name, apply_preset)
 *   - markClean on switch_preset, save_to_location, save_preset
 *
 * The classifier is drift-prone (front-panel edits don't fire markDirty
 * because there's no broadcast listener; device-side saves we don't
 * issue don't fire markClean). Documented limitation; fail-safe
 * (extra confirmation) rather than fail-dangerous (silent edit loss).
 */

import { isDirty, markClean, markDirty } from '@/server/shared/bufferDirty.js';
import { AM4_LABEL } from '@/server/shared/connections.js';
import type { DirtyGuardResult, OnEditedMode } from '@/server/shared/safeEdit.js';

import type { MidiConnection } from '@/fractal/am4/midi.js';
import { formatLocationDisplay, parseLocationCode } from '@/fractal/am4/locations.js';
import { sendReadAndParse, readPresetName } from '@/server/shared/readOps.js';
import { buildSaveToLocation } from '@/fractal/am4/setParam.js';

export const AM4_DIRTY_LABEL = AM4_LABEL;

/** Wire address for AM4's active-location state-read (pidLow=0xCE, pidHigh=0x0A). */
const LOCATION_STATE_PID_LOW = 0x00ce;
const LOCATION_STATE_PID_HIGH = 0x000a;

/** Time we wait for an AM4 save-ack before assuming the wire is stuck. */
const SAVE_ACK_TIMEOUT_MS = 500;

export function markAM4Dirty(): void {
  markDirty(AM4_LABEL);
}

export function markAM4Clean(): void {
  markClean(AM4_LABEL);
}

export function isAM4Dirty(): boolean {
  return isDirty(AM4_LABEL);
}

/**
 * Pre-navigation dirty check + optional save-first behavior for AM4.
 *
 * Mirrors `guardActiveBufferOrSave` from `src/fractal/axe-fx-ii/tools/
 * shared.ts` but uses AM4's location-code naming (A01–Z04) and AM4's
 * READ_PRESET_NAME wire path for the warning text.
 *
 * - Clean buffer → `proceed: true` regardless of mode.
 * - Dirty + `mode='warn'` (default) → `proceed: false` with warning.
 * - Dirty + `mode='discard'` → `proceed: true`, silent edit loss.
 * - Dirty + `mode='save_active_first'` → save to active location, then
 *   `proceed: true`. If the save fails, returns `proceed: false`.
 */
export async function guardActiveAM4BufferOrSave(
  conn: MidiConnection,
  mode: OnEditedMode,
): Promise<DirtyGuardResult> {
  if (!isAM4Dirty()) {
    return { proceed: true };
  }
  if (mode === 'discard') {
    return { proceed: true };
  }

  // Read active location for the warning text. If the read fails we
  // still surface a useful warning — we just can't name the slot.
  let activeIndex: number | undefined;
  try {
    const parsed = await sendReadAndParse(conn, LOCATION_STATE_PID_LOW, LOCATION_STATE_PID_HIGH);
    const idx = parsed.asUInt32LE();
    if (idx >= 0 && idx <= 103) activeIndex = idx;
  } catch {
    activeIndex = undefined;
  }

  let activeName: string | undefined;
  if (activeIndex !== undefined) {
    try {
      const nameResp = await readPresetName(conn, activeIndex);
      activeName = nameResp.name?.trim() || undefined;
    } catch {
      activeName = undefined;
    }
  }

  const activeDescriptor = activeIndex !== undefined
    ? `location ${formatLocationDisplay(activeIndex)}${activeName ? ` ("${activeName}")` : ''}`
    : 'the currently active preset';

  if (mode === 'warn') {
    return {
      proceed: false,
      warningText:
        `REFUSING TO NAVIGATE: ${activeDescriptor} has unsaved working-buffer edits.\n` +
        `\n` +
        `Navigating away would DISCARD those edits silently. Ask the user how to proceed:\n` +
        `  • "save first" → call this tool again with on_active_preset_edited="save_active_first" ` +
        `(saves the working buffer to ${activeDescriptor}, then navigates).\n` +
        `  • "discard" → call this tool again with on_active_preset_edited="discard" ` +
        `(silently loses the edits).\n` +
        `\n` +
        `If the user wants to save to a DIFFERENT location than ${activeDescriptor}, ` +
        `call am4_save_to_location({ location: "<code>" }) directly first, then retry this tool.`,
    };
  }

  // save_active_first path.
  if (activeIndex === undefined) {
    return {
      proceed: false,
      warningText:
        `Could not read the active location — refusing to navigate to avoid losing edits silently.\n` +
        `Try reconnect_midi, then retry. If the device is in an unusual state, ` +
        `the user can save manually on the front panel before this tool retries.`,
    };
  }

  try {
    // AM4 save_to_location is fire-and-forget (no ack); we send the bytes
    // and assume success. There's no inbound ack to await — the founder
    // verifies by hearing/seeing the change.
    const locationCode = formatLocationDisplay(activeIndex);
    conn.send(buildSaveToLocation(activeIndex));
    // Mark clean now that we've committed the buffer.
    markAM4Clean();
    return {
      proceed: true,
      savedSlot: locationCode,
      savedDetail: `Saved working buffer to ${activeDescriptor} before navigating.`,
    };
  } catch (err) {
    return {
      proceed: false,
      warningText:
        `Save attempt failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Refusing to navigate. Pass on_active_preset_edited="discard" to proceed without saving.`,
    };
  }
}
