/**
 * Axe-Fx II tools — shared helpers, MIDI lazy-init, and constants.
 *
 * Every per-family file under src/fractal/axe-fx-ii/tools/ imports from
 * here. The lazy-MIDI surface (ensureConn / resetAxeFxIIConnection)
 * and the param/block resolvers (findParam / findBlock) are the core
 * utilities all the tool handlers reach for.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  AXE_FX_II_BLOCKS,
  BLOCK_BY_ID,
  resolveBlock,
  type AxeFxIIBlock,
} from '@/fractal/axe-fx-ii/blockTypes.js';
import { KNOWN_PARAMS, type AxeFxIIParam } from '@/fractal/axe-fx-ii/params.js';
import { connectAxeFxII, listAxeFxIIOutputs, type AxeFxIIConnection } from '@/fractal/axe-fx-ii/midi.js';

/**
 * Default response-await window for GET tools. The Axe-Fx II responds
 * to function-0x02 GET in well under 50ms in a healthy USB connection;
 * 800ms is generous enough to cover OS-side scheduling jitter without
 * making the tool feel hung.
 */
export const GET_RESPONSE_TIMEOUT_MS = 800;

// -- MIDI lazy-init -------------------------------------------------------

let conn: AxeFxIIConnection | undefined;
let connError: Error | undefined;

export function ensureConn(): AxeFxIIConnection {
  if (conn) return conn;
  if (connError) throw connError;
  try {
    conn = connectAxeFxII();
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
export function resetAxeFxIIConnection(): { wasConnected: boolean; previousError: string | undefined } {
  const wasConnected = conn !== undefined;
  const previousError = connError?.message;
  if (conn) {
    try { conn.close(); } catch { /* dead handle */ }
  }
  conn = undefined;
  connError = undefined;
  return { wasConnected, previousError };
}

// -- Helpers --------------------------------------------------------------

/**
 * Terse caveat appended to SET tool responses only — writes on the
 * Axe-Fx II don't ack on the wire (the protocol is fire-and-forget for
 * SET_BLOCK_PARAMETER_VALUE), so the only verification path is the user
 * hearing or seeing the change on the device. NOT appended to GET tool
 * responses (the response itself IS the verification — a successful
 * decode of a 40-byte name frame proves the read works) nor to pure
 * data tools like list_block_types / list_params.
 *
 * Hardware-verification status across the axefx2_* surface is tracked
 * in HARDWARE-TASKS-AXEFX2.md, not here. Earlier versions of this
 * banner included a longer "🟡 wiki-documented" hedge appended to
 * every response — that made the tool look unreliable when reads were
 * actually self-verifying. See Session 56 commit `<TBD>` for context.
 */
export const NO_ACK_NOTE = 'Note: SET tools on Axe-Fx II are fire-and-forget — the protocol does not ack writes. Verify the change by audible/visible response on the device.';

/**
 * Resolve a param descriptor from a block instance + snake-case name.
 *
 * The registry is keyed `<block-slug>.<param-name>` (e.g. `volpan.volume`,
 * `compressor.ratio`) but the agent addresses blocks by group code
 * (`VOL`, `CPR`) or display name (`Volume/Pan 1`). We resolve by
 * matching (groupCode, name) against the registry — that way both
 * `axefx2_list_params` (which filters by groupCode + slug) and
 * `axefx2_get_param` / `axefx2_set_param` (this resolver) see the
 * same set of valid names.
 *
 * Historically there was a `paramKey(group, name)` that built
 * `<group>.<name>` and looked it up directly, but it broke any
 * block where the groupCode (3-letter) differs from the block slug —
 * e.g. VOL/volpan, CPR/compressor, CHO/chorus, DLY/delay, REV/reverb.
 */
export function findParam(target: AxeFxIIBlock, name: string): AxeFxIIParam | undefined {
  const lower = name.trim().toLowerCase();
  const groupUpper = target.groupCode.toUpperCase();
  for (const p of Object.values(KNOWN_PARAMS) as readonly AxeFxIIParam[]) {
    if (p.groupCode === groupUpper && p.name === lower) return p;
  }
  return undefined;
}

export function findBlock(input: string | number): AxeFxIIBlock {
  const resolved = resolveBlock(input);
  if (!resolved) {
    const sample = AXE_FX_II_BLOCKS.slice(0, 6).map((b) => `"${b.name}"`).join(', ');
    throw new Error(
      `Unknown block "${input}". Pass either an effectId (e.g. 106) or a display name like "Amp 1" / "Reverb 1" / "Delay 1". ` +
      `Sample valid names: ${sample}, ... — call axefx2_list_block_types for the full list.`,
    );
  }
  return resolved;
}

export function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
