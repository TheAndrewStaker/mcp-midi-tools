/**
 * Axe-Fx III tools — shared helpers, MIDI lazy-init, and constants.
 *
 * Mirrors the Axe-Fx II tools/shared.ts pattern: every per-family file
 * under `packages/axe-fx-iii/src/tools/` imports from here. The
 * lazy-MIDI surface (ensureConn / resetAxeFxIIIConnection) is the
 * core utility all the tool handlers reach for.
 *
 * Status: 🟡 community beta. The 5 functional tools registered through
 * this surface (switch_preset, switch_scene, get_preset_name,
 * get_scene_name, status_dump) ride on spec-documented wire envelopes
 * from Fractal's "Axe-Fx III MIDI for Third-Party Devices" v1.4 PDF,
 * but have NOT been hardware-verified end-to-end — no maintainer owns
 * an Axe-Fx III. Tool descriptions surface this caveat to the agent.
 */

import { connectAxeFxIII, type MidiConnection } from '../midi.js';

/**
 * Default response-await window for GET tools. The III responds to
 * function-0x0D / 0x0F / 0x13 GETs in well under 50ms over USB; 800ms
 * is generous enough to cover OS-side scheduling jitter without making
 * the tool feel hung.
 */
export const GET_RESPONSE_TIMEOUT_MS = 800;

/**
 * Caveat appended to SET tool responses (switch_preset, switch_scene).
 * The III's SET semantics for these functions don't generate explicit
 * ack frames on the wire — verification is by audible/visible response
 * on the device.
 */
export const NO_ACK_NOTE = [
  'Note: this tool is fire-and-forget — the Axe-Fx III protocol does not',
  'ack these writes. Verify the change by audible/visible response on the',
  'device (front panel preset / scene readout, audio output).',
].join('\n');

/**
 * Banner appended to every axefx3_* tool result. The III ships as a
 * 🟡 community beta — until a contributor with III hardware runs the
 * USBPcap workflow in HARDWARE-TASKS-AXEFX3.md, every successful tool
 * response is "spec-correct but unverified on real hardware." The
 * banner is brief enough not to drown out the actual response.
 */
export const BETA_NOTE = [
  '🟡 axe-fx-iii community beta — wire shape per Fractal v1.4 spec, not',
  'yet hardware-verified end-to-end. If something looks wrong, capture',
  'a USB-MIDI session of AxeEdit III firing the same op and open an',
  'issue with the .pcapng (see docs/community/axefx3-captures.md).',
].join('\n');

// -- MIDI lazy-init -------------------------------------------------------

let conn: MidiConnection | undefined;
let connError: Error | undefined;

export function ensureConn(): MidiConnection {
  if (conn) return conn;
  if (connError) throw connError;
  try {
    conn = connectAxeFxIII();
    return conn;
  } catch (err) {
    connError = err instanceof Error ? err : new Error(String(err));
    throw connError;
  }
}

/**
 * Drop the cached connection so the next ensureConn() re-attempts the
 * port open. Useful when the user plugs the device in mid-session and
 * the cached "not connected" error keeps masking the now-working port.
 */
export function resetAxeFxIIIConnection(): {
  wasConnected: boolean;
  previousError: string | undefined;
} {
  const wasConnected = conn !== undefined;
  const previousError = connError?.message;
  if (conn) {
    try { conn.close(); } catch { /* dead handle */ }
  }
  conn = undefined;
  connError = undefined;
  return { wasConnected, previousError };
}

export function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
