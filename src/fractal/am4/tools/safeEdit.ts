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

import type { MidiConnection } from '@/core/midi/transport.js';
import { formatLocationDisplay, parseLocationCode } from '@/fractal/am4/locations.js';
import { sendReadAndParse, readPresetName } from '@/fractal/am4/shared/readOps.js';
import { buildRequestActiveBufferDump, buildSaveToLocation } from '@/fractal/am4/setParam.js';
import { receivePresetDumpStream } from '@/fractal/am4/presetDump.js';
import {
  cacheFingerprint,
  fingerprintDump,
  getCachedFingerprint,
} from '@/fractal/am4/bufferFingerprint.js';

export const AM4_DIRTY_LABEL = AM4_LABEL;

/** Wire address for AM4's active-location state-read (pidLow=0xCE, pidHigh=0x0A). */
const LOCATION_STATE_PID_LOW = 0x00ce;
const LOCATION_STATE_PID_HIGH = 0x000a;

/** Time we wait for an AM4 save-ack before assuming the wire is stuck. */
const SAVE_ACK_TIMEOUT_MS = 500;

/** Time we wait for a working-buffer dump response (12 KB stream). */
const BUFFER_DUMP_TIMEOUT_MS = 1500;

/**
 * Capture a fresh fingerprint of the AM4 working buffer and cache it
 * under the given location index. Called after every CLEAN transition
 * (post-save, post-switch) so future dirty-gate checks have a
 * known-good baseline to compare against.
 *
 * Best-effort: if the dump fails (port stuck, timeout, etc.) we
 * silently skip — the next gate check will see no cache and proceed
 * without front-panel verification, fail-safe rather than blocking
 * the user's navigation on a non-critical side task.
 */
export async function refreshAM4Fingerprint(
  conn: MidiConnection,
  locationIndex: number,
): Promise<void> {
  try {
    const streamPromise = receivePresetDumpStream(conn, { timeoutMs: BUFFER_DUMP_TIMEOUT_MS });
    conn.send(buildRequestActiveBufferDump());
    const stream = await streamPromise;
    const hash = fingerprintDump(stream.chunkBytes);
    cacheFingerprint(locationIndex, hash);
  } catch {
    // Best-effort — see jsdoc.
  }
}

/**
 * Read the current working-buffer fingerprint from the device. Used
 * in the dirty gate to detect front-panel edits the code-side
 * classifier can't see (AM4 emits zero unsolicited MIDI on knob turns
 * — confirmed Session 74 HW-107). Returns undefined when the dump
 * fails so the caller can gracefully degrade rather than block.
 */
async function readAM4Fingerprint(conn: MidiConnection): Promise<string | undefined> {
  try {
    const streamPromise = receivePresetDumpStream(conn, { timeoutMs: BUFFER_DUMP_TIMEOUT_MS });
    conn.send(buildRequestActiveBufferDump());
    const stream = await streamPromise;
    return fingerprintDump(stream.chunkBytes);
  } catch {
    return undefined;
  }
}

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
  // Front-panel-edit detection. AM4 emits zero unsolicited MIDI on
  // knob turns (Session 74 HW-107), so the code-side classifier
  // (markAM4Dirty wired into our writes) is blind to user edits made
  // directly on the device. Lazy fingerprint check: when our
  // classifier reads clean, dump the working buffer and compare to
  // the last cached fingerprint for the active preset. If they
  // differ, the buffer has been edited outside our control.
  //
  // Only fires when the classifier already reads clean — if we know
  // we're dirty, we skip the dump and use the existing warning path.
  // First-visit-per-location has no cache: we proceed without the
  // check (the post-switch cache refresh sets the baseline for next
  // time).
  let activeIndexForFingerprint: number | undefined;
  if (!isAM4Dirty()) {
    if (mode === 'discard') {
      // The user already opted to discard — skip the dump round-trip.
      return { proceed: true };
    }
    try {
      const parsed = await sendReadAndParse(conn, LOCATION_STATE_PID_LOW, LOCATION_STATE_PID_HIGH);
      const idx = parsed.asUInt32LE();
      if (idx >= 0 && idx <= 103) activeIndexForFingerprint = idx;
    } catch {
      activeIndexForFingerprint = undefined;
    }
    if (activeIndexForFingerprint === undefined) {
      // Can't read the active location — proceed (degrade gracefully).
      return { proceed: true };
    }
    const cached = getCachedFingerprint(activeIndexForFingerprint);
    if (!cached) {
      // First-visit baseline isn't set yet. Skip the front-panel check;
      // the post-switch cache refresh will establish it for next time.
      return { proceed: true };
    }
    const currentHash = await readAM4Fingerprint(conn);
    if (currentHash === undefined) {
      // Dump failed — proceed rather than block on a non-critical
      // side check.
      return { proceed: true };
    }
    if (currentHash === cached.hash) {
      // Buffer matches the cached clean fingerprint — no front-panel
      // edits since we last established the baseline.
      return { proceed: true };
    }
    // Hash mismatch → working buffer differs from the cached clean
    // state. The user (or AM4-Edit running alongside us) edited the
    // buffer through a channel we don't observe. Mark dirty so the
    // shared refusal path below names the active preset and offers
    // discard / save-first options.
    markAM4Dirty();
    // Fall through to the existing warning logic.
  }

  if (mode === 'discard') {
    return { proceed: true };
  }

  // Read active location for the warning text. If the read fails we
  // still surface a useful warning — we just can't name the slot.
  let activeIndex: number | undefined = activeIndexForFingerprint;
  if (activeIndex === undefined) {
    try {
      const parsed = await sendReadAndParse(conn, LOCATION_STATE_PID_LOW, LOCATION_STATE_PID_HIGH);
      const idx = parsed.asUInt32LE();
      if (idx >= 0 && idx <= 103) activeIndex = idx;
    } catch {
      activeIndex = undefined;
    }
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
