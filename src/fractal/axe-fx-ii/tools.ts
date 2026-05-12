/**
 * Axe-Fx II family — MCP tool registration.
 *
 * Mirrors the pattern used by the AM4 + Hydrasynth tool surfaces:
 * each device exports a `register*Tools(server)` that the main
 * `src/server/index.ts` calls during boot. Tools are prefixed
 * `axefx2_*` so they coexist cleanly with `am4_*` and `hydra_*`.
 *
 * v0.1.x MVP surface (10 tools):
 *
 *   reads (response IS verification — successful decode = working):
 *     - axefx2_list_block_types
 *     - axefx2_list_params
 *     - axefx2_get_param          (HW-077, pending)
 *     - axefx2_get_grid_layout    (HW-076, pending)
 *     - axefx2_get_preset_name    (HW-080 ✅, 2026-05-10)
 *     - axefx2_lookup_lineage     (data tool, no hardware path)
 *
 *   writes (no-ack — only audible/visible verification):
 *     - axefx2_set_param          (HW-075, pending)
 *     - axefx2_set_block_bypass   (HW-081, pending)
 *     - axefx2_switch_scene       (HW-078, pending; echoes scene number)
 *
 *   meta:
 *     - axefx2_reconnect_midi
 *
 * Hardware-verification status per tool tracked in
 * `docs/_private/HARDWARE-TASKS-AXEFX2.md`. Tool responses do NOT
 * append a "🟡 wiki-documented" hedge anymore — earlier versions of
 * the surface did, and it made every response read as unreliable
 * even when reads were self-verifying. SET tools surface a terse
 * `NO_ACK_NOTE` (the no-ack protocol is the only legitimate caveat).
 *
 * Wire encoding lives in `./setParam.ts` — these tools just thread
 * MIDI bytes between the MCP transport and the connection helper.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  AXE_FX_II_BLOCKS,
  BLOCK_BY_ID,
  resolveBlock,
  type AxeFxIIBlock,
} from './blockTypes.js';
import { KNOWN_PARAMS, type AxeFxIIParam } from './params.js';
import {
  buildGetBlockChannel,
  buildGetBlockParameterValue,
  buildGetGridLayout,
  buildGetPresetName,
  buildGetPresetNumber,
  buildSetBlockChannel,
  buildSetBlockBypass as buildSetBlockBypassEnvelope,
  buildSetBlockParameterValue,
  buildSetGridCell,
  buildSetPresetName,
  buildSetSceneNumber,
  buildStorePreset,
  buildSwitchPreset,
  displayToWire,
  isGetBlockChannelResponse,
  isGetBlockParameterResponse,
  isGetGridLayoutResponse,
  isGetPresetNameResponse,
  isGetPresetNumberResponse,
  isSceneNumberResponse,
  isSetGridCellResponse,
  isStorePresetResponse,
  parseGetBlockChannelResponse,
  parseGetBlockParameterResponse,
  parseGetGridLayoutResponse,
  parseGetPresetNameResponse,
  parseGetPresetNumberResponse,
  parseSceneNumberResponse,
  parseSetGridCellResponse,
  parseStorePresetResponse,
  type AxeFxIIChannel,
  type GridCell,
} from './setParam.js';
import { connectAxeFxII, listAxeFxIIOutputs, type AxeFxIIConnection } from './midi.js';
import {
  AXE_FX_II_LINEAGE_BLOCKS,
  formatAxeFxIILineageRecord,
  runAxeFxIILineageLookup,
  type AxeFxIILineageLookupResult,
} from './lineageLookup.js';

/**
 * Default response-await window for GET tools. The Axe-Fx II responds
 * to function-0x02 GET in well under 50ms in a healthy USB connection;
 * 800ms is generous enough to cover OS-side scheduling jitter without
 * making the tool feel hung.
 */
const GET_RESPONSE_TIMEOUT_MS = 800;

// -- MIDI lazy-init -------------------------------------------------------

let conn: AxeFxIIConnection | undefined;
let connError: Error | undefined;

function ensureConn(): AxeFxIIConnection {
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
const NO_ACK_NOTE = 'Note: SET tools on Axe-Fx II are fire-and-forget — the protocol does not ack writes. Verify the change by audible/visible response on the device.';

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

function findBlock(input: string | number): AxeFxIIBlock {
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

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function describeCell(cell: GridCell): { label: string; kind: 'block' | 'shunt' | 'empty' } {
  if (cell.blockId === 0) return { label: '·', kind: 'empty' };
  if (cell.blockId >= 200 && cell.blockId <= 235) {
    return { label: `Sh${cell.blockId - 199}`, kind: 'shunt' };
  }
  const block = BLOCK_BY_ID[cell.blockId];
  if (block) {
    // Compact label: group code + instance number from the display name.
    // "Amp 1" → "AMP1", "Reverb 1" → "REV1", "Drive 2" → "DRV2".
    const m = block.name.match(/(\d+)\s*$/);
    const instance = m ? m[1] : '';
    return { label: `${block.groupCode}${instance}`, kind: 'block' };
  }
  return { label: `?${cell.blockId}`, kind: 'block' };
}

function renderGridAscii(cells: GridCell[]): string {
  // Render columns left-to-right, rows 1..4 top-to-bottom. Each cell shows
  // a compact label (≤ 5 chars) plus the routing-mask hex digit when the
  // cell receives input from a previous column.
  const widths: number[] = Array(12).fill(0);
  const grid: string[][] = Array.from({ length: 4 }, () => Array(12).fill(''));
  for (const cell of cells) {
    const { label } = describeCell(cell);
    const mask = cell.routingFlags === 0 ? '' : `:${cell.routingFlags.toString(16)}`;
    const text = `${label}${mask}`;
    grid[cell.row - 1][cell.col - 1] = text;
    widths[cell.col - 1] = Math.max(widths[cell.col - 1], text.length, 5);
  }
  const lines: string[] = [];
  // Column header
  const header = '     ' + widths.map((w, i) => String(i + 1).padStart(w)).join(' ');
  lines.push(header);
  lines.push('     ' + widths.map((w) => '-'.repeat(w)).join(' '));
  for (let r = 0; r < 4; r++) {
    const row = `R${r + 1} | ` + grid[r].map((cell, c) => cell.padStart(widths[c])).join(' ');
    lines.push(row);
  }
  // Quick block roster — distinct (groupCode, instance) summary, so the
  // agent can reference what's actually placed without re-scanning the grid.
  const placed = cells
    .filter((c) => c.blockId >= 100 && c.blockId <= 170)
    .map((c) => {
      const b = BLOCK_BY_ID[c.blockId];
      return b ? `${b.name} (col ${c.col} row ${c.row})` : `?${c.blockId}`;
    });
  const shunts = cells
    .filter((c) => c.blockId >= 200 && c.blockId <= 235).length;
  const empty = cells.filter((c) => c.blockId === 0).length;
  lines.push('');
  lines.push(`Placed blocks (${placed.length}): ${placed.length === 0 ? '(none)' : placed.join(', ')}`);
  lines.push(`Shunts: ${shunts} | Empty cells: ${empty}`);
  lines.push('');
  lines.push('Routing mask: hex digit after \':\' lists which previous-column rows feed this cell\'s input.');
  lines.push('  e.g. AMP1:1 = receives input from row 1 of the previous column.');
  lines.push('       AMP1:5 = receives input from rows 1 AND 3 (bits 0+2).');
  return lines.join('\n');
}

/**
 * One-line-per-row summary — readable on any chat width, doesn't depend
 * on a fixed-width font, and surfaces the iconic "single serial chain
 * on row 2" case as natural prose. Best default for chat UX.
 *
 * Examples:
 *   "Row 2 (serial, 12 blocks): CPR1 → WAH1 → PHA1 → DRV1 → AMP1 → CAB1
 *    → CHO1 → FLG1 → DLY1 → MTD1 → ROT1 → REV1"
 *   "Row 1: AMP1 (cols 3-4), Row 3: AMP2 (cols 3-4), Row 2: REV1 (col 6)
 *    [parallel amps]"
 */
function renderGridSummary(cells: GridCell[]): string {
    const lines: string[] = [];
    const placedByRow: Map<number, GridCell[]> = new Map();
    for (const cell of cells) {
        if (cell.blockId === 0) continue;
        if (!placedByRow.has(cell.row)) placedByRow.set(cell.row, []);
        placedByRow.get(cell.row)!.push(cell);
    }
    // Sort cells in each row left-to-right.
    for (const row of placedByRow.values()) row.sort((a, b) => a.col - b.col);

    const activeRows = [...placedByRow.keys()].sort();
    if (activeRows.length === 0) {
        return 'No blocks placed in the active preset.';
    }

    // Detect the iconic "single row, all serial" case for a cleaner summary line.
    if (activeRows.length === 1) {
        const row = activeRows[0];
        const rowCells = placedByRow.get(row)!;
        const blockCells = rowCells.filter((c) => c.blockId >= 100 && c.blockId <= 170);
        const shuntCount = rowCells.filter((c) => c.blockId >= 200 && c.blockId <= 235).length;
        const labels = blockCells.map((c) => describeCell(c).label);
        const shuntNote = shuntCount > 0 ? ` (+ ${shuntCount} shunt${shuntCount === 1 ? '' : 's'})` : '';
        lines.push(
            `Row ${row} — serial chain, ${blockCells.length} block${blockCells.length === 1 ? '' : 's'}${shuntNote}:`,
        );
        lines.push('  ' + labels.join(' → '));
    } else {
        // Multi-row: list each row's contents on its own line. The routing
        // mask is what determines actual signal flow across rows; surface
        // any non-2 routing mask as a parallel-path hint.
        for (const row of activeRows) {
            const rowCells = placedByRow.get(row)!;
            const cellSummaries = rowCells.map((c) => {
                const { label } = describeCell(c);
                const mask = c.routingFlags === 0 ? '' : ` ←r${maskToRowList(c.routingFlags)}`;
                return `${label}@c${c.col}${mask}`;
            });
            lines.push(`Row ${row}: ${cellSummaries.join(', ')}`);
        }
        lines.push('');
        lines.push(
            'Multi-row layout — signal flow follows the routing masks (←rN = receives from row N of the previous column). Use `format: "markdown"` or `"ascii"` for a 2-D view.',
        );
    }

    // Roster of placed blocks (deduplicated by block) so the agent can
    // reference them by name when proposing tweaks.
    const placed = cells
        .filter((c) => c.blockId >= 100 && c.blockId <= 170)
        .map((c) => BLOCK_BY_ID[c.blockId])
        .filter((b): b is AxeFxIIBlock => !!b);
    if (placed.length > 0) {
        lines.push('');
        lines.push(`Placed blocks (${placed.length}): ${placed.map((b) => b.name).join(', ')}`);
    }
    lines.push('');
    lines.push(
        'NOTE: this read shows BLOCK PLACEMENT only. Bypass / scene state per block is a separate concern — most presets have several placed blocks bypassed in the active scene. A consolidated preset-state read is a planned next-session improvement.',
    );

    return lines.join('\n');
}

/** Decode a routing-flags mask into a comma-separated list of source row numbers. */
function maskToRowList(mask: number): string {
    const rows: number[] = [];
    if (mask & 0x01) rows.push(1);
    if (mask & 0x02) rows.push(2);
    if (mask & 0x04) rows.push(3);
    if (mask & 0x08) rows.push(4);
    return rows.length > 0 ? rows.join('+') : '?';
}

/**
 * Markdown table — renders as a real HTML table in Claude Desktop chat
 * and most MCP-host UIs (Cursor, Continue, etc. all render markdown).
 * Responsive to chat width because the host's table layout reflows.
 * Best when the grid is non-trivial (multi-row, parallel paths).
 */
function renderGridMarkdown(cells: GridCell[]): string {
    const grid: string[][] = Array.from({ length: 4 }, () => Array(12).fill(''));
    for (const cell of cells) {
        const { label } = describeCell(cell);
        const mask = cell.routingFlags === 0 ? '' : `:${cell.routingFlags.toString(16)}`;
        grid[cell.row - 1][cell.col - 1] = `${label}${mask}`;
    }
    const lines: string[] = [];
    // Markdown table header: empty corner + col 1..12.
    lines.push('|   | ' + Array.from({ length: 12 }, (_, i) => String(i + 1)).join(' | ') + ' |');
    lines.push('|---' + '|---'.repeat(12) + '|');
    for (let r = 0; r < 4; r++) {
        lines.push(`| **R${r + 1}** | ` + grid[r].map((cell) => cell || '·').join(' | ') + ' |');
    }
    lines.push('');
    lines.push(
        '_Routing mask: hex digit after `:` lists which previous-column rows feed this cell\'s input (e.g. `AMP1:1` = receives from row 1; `AMP1:5` = receives from rows 1 AND 3)._',
    );
    return lines.join('\n');
}

function renderGridJson(cells: GridCell[]): string {
  const annotated = cells.map((c) => {
    const { label, kind } = describeCell(c);
    const block = BLOCK_BY_ID[c.blockId];
    return {
      col: c.col,
      row: c.row,
      blockId: c.blockId,
      label,
      kind,
      blockName: block?.name,
      groupCode: block?.groupCode,
      routingFlags: c.routingFlags,
      receivesFromRows: [1, 2, 3, 4].filter((r) => (c.routingFlags >> (r - 1)) & 1),
    };
  });
  return JSON.stringify(annotated, null, 2);
}

// -- apply_preset_at + apply_setlist shared helpers ------------------------

/**
 * Shape of a single preset entry — used by both axefx2_apply_preset_at
 * (one entry at a time) and axefx2_apply_setlist (array of entries).
 * Mirrors the inputSchema of apply_preset_at minus the zod wrappers.
 */
interface ApplyPresetAtInput {
  preset_number: number;
  blocks: Array<{
    block: string | number;
    bypass?: boolean;
    channel?: 'X' | 'Y';
    params?: Record<string, number>;
  }>;
  scene?: number;
  name?: string;
}

interface ApplyPresetAtOp {
  kind: 'switch_preset' | 'clear_cell' | 'place_block' | 'switch_scene' | 'channel' | 'bypass' | 'param' | 'name' | 'save';
  bytes: number[];
  summary: string;
  awaitResponse?: 'set_grid_cell' | 'store_preset';
}

/**
 * Build the full wire-op sequence for one preset entry. Pure function —
 * no I/O, no connection required. Throws on validation errors (unknown
 * block name, unknown param, out-of-range value).
 */
function buildApplyPresetAtOps(input: ApplyPresetAtInput): ApplyPresetAtOp[] {
  const { preset_number, blocks, scene, name } = input;

  // 1. Resolve blocks (catches typos before any op is built).
  type ResolvedEntry = {
    target: AxeFxIIBlock;
    bypass?: boolean;
    channel?: AxeFxIIChannel;
    params?: Record<string, number>;
  };
  const resolved: ResolvedEntry[] = [];
  for (const b of blocks) {
    const target = findBlock(b.block);
    resolved.push({
      target,
      bypass: b.bypass,
      channel: b.channel as AxeFxIIChannel | undefined,
      params: b.params as Record<string, number> | undefined,
    });
  }

  // 2. Pre-validate every param + value.
  interface PendingParamWrite {
    blockIdx: number;
    paramName: string;
    paramId: number;
    wire: number;
    modeNote: string;
  }
  const pendingParams: PendingParamWrite[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (!r.params) continue;
    for (const [paramName, value] of Object.entries(r.params)) {
      const param = findParam(r.target, paramName);
      if (!param) {
        throw new Error(
          `unknown param "${paramName}" for ${r.target.name} ` +
          `(group ${r.target.groupCode}). Call axefx2_list_params for the full set.`,
        );
      }
      const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
      const useDisplay = hasCalibration && value <= (param.displayMax ?? 0);
      let wire: number;
      let modeNote: string;
      if (useDisplay) {
        wire = displayToWire(value, {
          displayMin: param.displayMin as number,
          displayMax: param.displayMax as number,
          displayScale: param.displayScale,
        });
        modeNote = `${value} → wire ${wire}`;
      } else {
        if (!Number.isInteger(value) || value < 0 || value > 65534) {
          throw new Error(
            `wire value out of range for ${r.target.name}.${paramName}: ${value} ` +
            `(valid 0..65534, or display value if param is calibrated).`,
          );
        }
        wire = value;
        modeNote = `wire ${wire}`;
      }
      pendingParams.push({ blockIdx: i, paramName, paramId: param.paramId, wire, modeNote });
    }
  }

  // 3. Build the op sequence.
  const ops: ApplyPresetAtOp[] = [];

  ops.push({
    kind: 'switch_preset',
    bytes: buildSwitchPreset(preset_number),
    summary: `LOAD_PRESET → ${preset_number} (target slot)`,
  });

  // Clear cells beyond chain length, right-to-left.
  for (let col = 12; col > blocks.length; col--) {
    ops.push({
      kind: 'clear_cell',
      bytes: buildSetGridCell({ row: 2, col, blockId: 0 }),
      summary: `CLEAR row 2 col ${col}`,
      awaitResponse: 'set_grid_cell',
    });
  }

  // Place blocks left-to-right so each one auto-routes from upstream.
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    ops.push({
      kind: 'place_block',
      bytes: buildSetGridCell({ row: 2, col: i + 1, blockId: r.target.id }),
      summary: `PLACE ${r.target.name} at row 2 col ${i + 1}`,
      awaitResponse: 'set_grid_cell',
    });
  }

  if (scene !== undefined) {
    ops.push({
      kind: 'switch_scene',
      bytes: buildSetSceneNumber(scene),
      summary: `SET_SCENE → ${scene} (display: scene ${scene + 1})`,
    });
  }

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (r.bypass !== undefined) {
      ops.push({
        kind: 'bypass',
        bytes: buildSetBlockBypassEnvelope(r.target.id, r.bypass),
        summary: `${r.target.name}: bypass=${r.bypass ? 'BYPASSED' : 'ENGAGED'}`,
      });
    }
    if (r.channel !== undefined) {
      ops.push({
        kind: 'channel',
        bytes: buildSetBlockChannel(r.target.id, r.channel),
        summary: `${r.target.name}: channel=${r.channel}`,
      });
    }
    for (const pp of pendingParams.filter((p) => p.blockIdx === i)) {
      ops.push({
        kind: 'param',
        bytes: buildSetBlockParameterValue({ effectId: r.target.id, paramId: pp.paramId }, pp.wire),
        summary: `${r.target.name}.${pp.paramName} = ${pp.modeNote}`,
      });
    }
  }

  if (name !== undefined) {
    ops.push({
      kind: 'name',
      bytes: buildSetPresetName(name),
      summary: `SET_PRESET_NAME → "${name}"`,
    });
  }
  ops.push({
    kind: 'save',
    bytes: buildStorePreset(preset_number),
    summary: `STORE_PRESET → slot ${preset_number} (display: slot ${preset_number + 1})`,
    awaitResponse: 'store_preset',
  });

  return ops;
}

interface RunOpsResult {
  ok: boolean;
  totalBytes: number;
  acks: number;
  elapsedMs: number;
  summaries: string[];
  lastNack?: { summary: string; resultCode: number };
}

/**
 * Execute a sequence of wire ops against the device. Awaits ACKs for
 * grid-cell and store-preset ops; sends others fire-and-forget. Returns
 * a summary suitable for both single-preset (apply_preset_at) and batch
 * (apply_setlist) callers.
 *
 * `ok` is false iff the FINAL store_preset op got a non-OK ACK (or no
 * ACK at all). Mid-sequence NACKs don't flip ok=false on their own
 * because some grid-cell rejections (e.g. "clear an already-empty cell")
 * may report non-zero result codes but still leave the eventual save
 * functional.
 */
async function runApplyPresetAtOps(
  conn: AxeFxIIConnection,
  ops: ApplyPresetAtOp[],
): Promise<RunOpsResult> {
  const startMs = Date.now();
  let totalBytes = 0;
  let acks = 0;
  let lastNack: { summary: string; resultCode: number } | undefined;
  let finalSaveOk = false;
  const summaries: string[] = [];

  for (const op of ops) {
    if (op.awaitResponse === 'set_grid_cell') {
      const ackPromise = conn.receiveSysExMatching(
        isSetGridCellResponse,
        GET_RESPONSE_TIMEOUT_MS,
      );
      conn.send(op.bytes);
      totalBytes += op.bytes.length;
      try {
        const ack = await ackPromise;
        const parsed = parseSetGridCellResponse(ack);
        if (!parsed.ok) {
          lastNack = { summary: op.summary, resultCode: parsed.resultCode };
          summaries.push(`  ${op.summary}  ❌ result=0x${parsed.resultCode.toString(16)}`);
        } else {
          acks++;
          summaries.push(`  ${op.summary}  ✓`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summaries.push(`  ${op.summary}  ⚠ no ACK (${msg})`);
      }
    } else if (op.awaitResponse === 'store_preset') {
      const ackPromise = conn.receiveSysExMatching(
        isStorePresetResponse,
        GET_RESPONSE_TIMEOUT_MS,
      );
      conn.send(op.bytes);
      totalBytes += op.bytes.length;
      try {
        const ack = await ackPromise;
        const parsed = parseStorePresetResponse(ack);
        if (!parsed.ok) {
          lastNack = { summary: op.summary, resultCode: parsed.resultCode };
          summaries.push(`  ${op.summary}  ❌ result=0x${parsed.resultCode.toString(16)} (SAVE FAILED)`);
        } else {
          acks++;
          finalSaveOk = true;
          summaries.push(`  ${op.summary}  ✓ saved`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summaries.push(`  ${op.summary}  ⚠ no ACK (${msg}) (SAVE STATE UNKNOWN)`);
      }
    } else {
      conn.send(op.bytes);
      totalBytes += op.bytes.length;
      summaries.push(`  ${op.summary}  (${op.bytes.length}B)`);
      if (op.kind === 'switch_preset' || op.kind === 'switch_scene' || op.kind === 'channel') {
        await new Promise((res) => setTimeout(res, 20));
      }
    }
  }

  return {
    ok: finalSaveOk,
    totalBytes,
    acks,
    elapsedMs: Date.now() - startMs,
    summaries,
    lastNack,
  };
}

// -- Tool registration ----------------------------------------------------

export function registerAxeFxIITools(server: McpServer): void {

  // axefx2_list_block_types --------------------------------------------------

  server.registerTool('axefx2_list_block_types', {
    description: [
      'Use this tool to list every addressable block instance on the user\'s',
      'Axe-Fx II family device. The Axe-Fx II exposes multiple instances of',
      'most block groups (Amp 1 + Amp 2, Reverb 1 + Reverb 2, etc.) — each',
      'instance has a unique 14-bit effectId used in the wire address. All',
      'instances of the same group share the same parameter table; pick the',
      'instance the user is editing (usually "1" unless they\'ve placed a',
      'second one in the signal chain).',
      '',
      'Returns 71 block instances per the wiki. The optional `group` filter',
      'narrows by 3-letter group code (AMP, CPR, REV, DLY, CHO, FLG, PHA,',
      'WAH, GTE, FIL, DRV, ENH, PIT, etc.) — useful when the agent only',
      'cares about which Amp / Drive / Reverb instances exist.',
    ].join('\n'),
    inputSchema: {
      group: z.string().optional().describe(
        'Optional 3-letter group code to filter by (case-insensitive). e.g. "AMP" returns just the Amp instances.',
      ),
    },
  }, async ({ group }) => {
    const filter = group?.trim().toUpperCase();
    const matches = filter
      ? AXE_FX_II_BLOCKS.filter((b) => b.groupCode === filter)
      : AXE_FX_II_BLOCKS.slice();
    if (filter && matches.length === 0) {
      const allGroups = [...new Set(AXE_FX_II_BLOCKS.map((b) => b.groupCode))].sort();
      return {
        content: [{
          type: 'text',
          text: `No blocks match group "${filter}". Valid group codes: ${allGroups.join(', ')}.`,
        }],
      };
    }
    const lines = matches.map((b) =>
      `  ${String(b.id).padStart(3)}  ${b.name.padEnd(22)} (group: ${b.groupCode}${b.canBypass ? '' : ', no-bypass'})`,
    );
    return {
      content: [{
        type: 'text',
        text: [
          `Axe-Fx II addressable blocks${filter ? ` (filtered to ${filter})` : ''}: ${matches.length} instance(s).`,
          'Format: <effectId> <name> (group, flags)',
          ...lines,
          '',
        ].join('\n'),
      }],
    };
  });

  // axefx2_list_params -------------------------------------------------------

  server.registerTool('axefx2_list_params', {
    description: [
      'Use this tool to list every wiki-documented parameter for a given',
      'Axe-Fx II block group. The block group is the 3-letter code (AMP /',
      'CPR / REV / DLY / etc.) or the lowercase block slug (amp / compressor /',
      'reverb / delay) — both resolve. All instances of the same group share',
      'the parameter table, so the listing is per-group rather than per-',
      'instance.',
      '',
      'Each row reports the wire `paramId` (0..255), the snake-case key the',
      'agent passes to axefx2_set_param, the wiki control type (knob / select /',
      'switch), and the wiki-documented display range when populated. Most',
      'knobs have unpopulated ranges in the wiki — for those, treat the wire',
      'value as the source of truth and set 0..65534 directly until display-',
      'range anchors come from a hardware spotcheck.',
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(
        'Block group, e.g. "amp" / "AMP" / "compressor" / "CPR" / "reverb" / "delay". Resolves on both 3-letter wiki code and lowercase slug.',
      ),
    },
  }, async ({ block }) => {
    const upper = block.trim().toUpperCase();
    const lower = block.trim().toLowerCase();
    const all = Object.values(KNOWN_PARAMS) as readonly AxeFxIIParam[];
    const matches = all.filter((p) => p.groupCode === upper || p.block === lower);
    if (matches.length === 0) {
      const groups = [...new Set(all.map((p) => `${p.groupCode}/${p.block}`))].slice(0, 12);
      return {
        content: [{
          type: 'text',
          text:
            `No params for block "${block}". Try the 3-letter group code or the lowercase slug. ` +
            `Sample valid blocks: ${groups.join(', ')}, ...`,
        }],
      };
    }
    const sorted = matches.slice().sort((a, b) => a.paramId - b.paramId);
    const lines = sorted.map((p) => {
      const range = (p.displayMin !== undefined && p.displayMax !== undefined)
        ? ` [${p.displayMin}..${p.displayMax}${p.step !== undefined ? ` step ${p.step}` : ''}]`
        : '';
      const label = p.xmlLabel ? ` "${p.xmlLabel.replace(/\n/g, ' ')}"` : '';
      const enumNote = p.enumValues ? ` (enum, ${Object.keys(p.enumValues).length} values)` : '';
      return `  ${String(p.paramId).padStart(3)}  ${p.name.padEnd(28)} ${p.controlType}${range}${enumNote}${label}`;
    });
    return {
      content: [{
        type: 'text',
        text: [
          `Axe-Fx II params for ${matches[0].block} (group ${matches[0].groupCode}): ${matches.length} parameter(s).`,
          'Format: <paramId> <name> <controlType> [<displayMin..displayMax>] (enum) "<xmlLabel>"',
          ...lines,
          '',
        ].join('\n'),
      }],
    };
  });

  // axefx2_list_enum_values --------------------------------------------------

  server.registerTool('axefx2_list_enum_values', {
    description: [
      'Use this tool to list the dropdown options for an enum/select',
      'parameter on the user\'s Axe-Fx II — e.g. `amp.effect_type`',
      '(amp model dropdown), `drive.effect_type`, `cab.cab`,',
      '`delay.tempo` (tempo-sync division select), `amp.tone_stack`,',
      '`amp.power_type`, etc. Returns the integer wire value the',
      'device expects + the display name the device shows for each',
      'option.',
      '',
      'Use this BEFORE `axefx2_set_param` on any select/enum param',
      'when the user describes a value by name ("set the amp to a',
      'Plexi", "switch delay to dotted-eighth tempo"). The tool',
      'response gives you the wire integer to pass to set_param with',
      '`interpret: "wire"`.',
      '',
      'Returns an error if the param is not a select/enum type — call',
      '`axefx2_list_params` first to see the param\'s controlType.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Delay 1" or numeric effectId. Call axefx2_list_block_types for the full set.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. e.g. "effect_type", "tempo", "tone_stack". Call axefx2_list_params for the full set.',
      ),
    },
  }, async ({ block, name }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      const groupParams = Object.values(KNOWN_PARAMS as Readonly<Record<string, AxeFxIIParam>>)
        .filter((p) => p.groupCode === target.groupCode);
      const sample = groupParams.slice(0, 8).map((p) => p.name).join(', ');
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Sample valid names: ${sample}, ... — call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }
    if (!param.enumValues) {
      // Two distinct cases produce no enumValues:
      //   1. controlType is 'knob' / 'switch' / 'unknown' — not an enum
      //      semantically; the caller should use axefx2_set_param with
      //      a numeric value (display or wire depending on calibration).
      //   2. controlType is 'select' but the registry has no enum table
      //      backing it (wiki documented the param as a select but didn't
      //      list the dropdown values). The caller still has to write a
      //      numeric wire value, but should also flag the registry gap
      //      for a future calibration sweep to populate.
      if (param.controlType === 'select') {
        throw new Error(
          `${target.name} → ${param.name} is type 'select' but the registry has no ` +
          `enum values populated (gap from the wiki scrape — the wiki documents the ` +
          `param as a select but doesn't list the dropdown options). Pass a wire ` +
          `integer to axefx2_set_param with \`interpret: "wire"\`. Wire 0 is ` +
          `conventionally "None"/"Off" on Fractal selects, but verify by reading ` +
          `back the device label.`,
        );
      }
      throw new Error(
        `${target.name} → ${param.name} is not an enum param (controlType=${param.controlType}). ` +
        `It accepts a numeric value — use axefx2_set_param directly.`,
      );
    }
    const entries = Object.entries(param.enumValues)
      .map(([idx, label]) => ({ idx: Number(idx), label }))
      .sort((a, b) => a.idx - b.idx);
    const rows = entries.map((e) => `  ${String(e.idx).padStart(3)}: ${e.label}`).join('\n');
    return {
      content: [{
        type: 'text',
        text:
          `${target.name} → ${param.name} (paramId ${param.paramId}, group ${target.groupCode}): ` +
          `${entries.length} enum option(s).\n` +
          `Format: <wire_value>: <display_name>\n${rows}\n`,
      }],
    };
  });

  // axefx2_set_param ---------------------------------------------------------

  server.registerTool('axefx2_set_param', {
    description: [
      'Use this tool to write a single parameter on the user\'s Axe-Fx II',
      'family device. The parameter is addressed by `block` (block instance,',
      'e.g. "Amp 1" or effectId 106) and `name` (snake-case parameter name,',
      'e.g. "input_drive"). Use axefx2_list_block_types to discover instances',
      'and axefx2_list_params to discover param names per block group.',
      '',
      'DISPLAY-FIRST CONTRACT — `value` is a display-unit number for params',
      'with hardware-calibrated displayMin/displayMax (HW-079, 2026-05-11),',
      'and a raw 0..65534 wire integer for everything else. The tool resolves',
      'which mode to use from the param\'s registry entry:',
      '',
      '  - amp.bass / amp.middle / amp.treble / amp.master_volume /',
      '    amp.input_drive — accept 0..10 (knob display, e.g. bass: 6.0).',
      '  - All other params — accept raw wire 0..65534 (e.g. bass: 39321).',
      '',
      'When the param has populated `displayMin`/`displayMax`, pass display',
      'values like `4.5` (gain at 4.5/10) or `6.0` (bass at 6.0/10). The',
      'tool converts to wire internally using a linear mapping and surfaces',
      'the converted wire value in the response. If you pass a value that\'s',
      'numerically inside the display range (0..10 for calibrated knobs), the',
      'tool treats it as a display value; if it\'s above displayMax, the tool',
      'treats it as a wire integer for backwards-compat. To bypass auto-',
      'detection entirely, set `interpret: "wire"` to force wire-integer mode',
      'or `interpret: "display"` to force display mode (errors if param has',
      'no calibration).',
      '',
      'For ENUM/SELECT params (e.g. amp.tone_stack), pass the integer enum',
      'index — call axefx2_list_params or axefx2_list_enum_values for the',
      'set. Display-first conversion does NOT apply to selects.',
      '',
      'NO-ACK PROTOCOL — the Axe-Fx II SET function does not produce a wire',
      'ack. The signal that the change took is audible (the user hears the',
      'change) and the device\'s display reflects the new value. If the user',
      'expected an audible change and reports none, likely causes: (a) the',
      'addressed block isn\'t on the active preset\'s signal chain, (b) the',
      'wire value falls outside the param\'s display range and the device',
      'clamped silently, or (c) MIDI port routing — confirm with',
      'list_midi_ports that an Axe-Fx port is visible.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId (106 / 110). Call axefx2_list_block_types for the full set.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. e.g. "input_drive", "bass", "master_volume". Call axefx2_list_params for the full set.',
      ),
      value: z.number().min(0).max(65534).describe(
        'Display value (for calibrated knobs like amp.bass=6.0) or raw wire 0..65534 for uncalibrated params. Tool auto-detects mode from param calibration.',
      ),
      interpret: z.enum(['auto', 'wire', 'display']).optional().describe(
        'Force value interpretation. "auto" (default) infers from param calibration. "wire" treats value as raw 0..65534. "display" treats value as display unit (errors if param uncalibrated).',
      ),
    },
  }, async ({ block, name, value, interpret }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      const groupParams = Object.values(KNOWN_PARAMS as Readonly<Record<string, AxeFxIIParam>>)
        .filter((p) => p.groupCode === target.groupCode);
      const sample = groupParams.slice(0, 8).map((p) => p.name).join(', ');
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Sample valid names: ${sample}, ... — call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }

    const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
    const mode = interpret ?? 'auto';
    // Force display when explicitly requested; force wire when explicitly
    // requested; auto-detect: if calibrated AND value fits inside the
    // display range, treat as display; otherwise treat as wire.
    let useDisplay: boolean;
    if (mode === 'display') {
      if (!hasCalibration) {
        throw new Error(
          `Param "${name}" on ${target.name} has no calibrated display range — ` +
          `pass a wire value (0..65534) or omit \`interpret: "display"\`.`,
        );
      }
      useDisplay = true;
    } else if (mode === 'wire') {
      useDisplay = false;
    } else {
      useDisplay = hasCalibration && value <= (param.displayMax ?? 0);
    }

    let wireValue: number;
    let displayValueUsed: number | undefined;
    if (useDisplay) {
      displayValueUsed = value;
      wireValue = displayToWire(value, {
        displayMin: param.displayMin as number,
        displayMax: param.displayMax as number,
        displayScale: param.displayScale,
      });
    } else {
      if (!Number.isInteger(value) || value < 0 || value > 65534) {
        throw new Error(
          `Wire value out of range: ${value} (valid 0..65534). ` +
          `If you meant a display value, pass \`interpret: "display"\` (requires the param to have calibrated displayMin/displayMax).`,
        );
      }
      wireValue = value;
    }

    const bytes = buildSetBlockParameterValue(
      { effectId: target.id, paramId: param.paramId },
      wireValue,
    );
    const c = ensureConn();
    c.send(bytes);
    const enumLabel = param.enumValues?.[wireValue];
    const enumLine = enumLabel ? `\nValue ${wireValue} matches enum: "${enumLabel}".` : '';
    const scaleLabel = param.displayScale ?? 'linear';
    const modeLine = useDisplay
      ? `Display ${displayValueUsed} → wire ${wireValue} via [${param.displayMin}..${param.displayMax}] ${scaleLabel}.`
      : hasCalibration
        ? `Wire ${wireValue} (raw — not a display value; calibrated range is [${param.displayMin}..${param.displayMax}] ${scaleLabel}).`
        : `Wire ${wireValue} (uncalibrated param; pass wire 0..65534).`;
    return {
      content: [{
        type: 'text',
        text:
          `Sent ${target.name} (${target.groupCode}, effectId ${target.id}) → ${param.name} ` +
          `(paramId ${param.paramId}).\n` +
          `${modeLine}${enumLine}\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });

  // axefx2_set_block_bypass --------------------------------------------------

  server.registerTool('axefx2_set_block_bypass', {
    description: [
      'Use this tool to bypass or engage a block on the user\'s Axe-Fx II.',
      'Per the wiki, bypass uses the same SET_BLOCK_PARAMETER_VALUE function',
      'with paramId = 255: value 0 engages the block, value 1 bypasses it.',
      '',
      'Some blocks (Mixer, Input, Output, Controllers, Feedback Send/Return)',
      'don\'t expose a bypass — call axefx2_list_block_types to see which',
      'blocks have `canBypass: true`. Trying to bypass a no-bypass block',
      'will still send the wire bytes (the device ignores them) but the',
      'tool surfaces a warning rather than fabricating success.',
      '',
      'NO-ACK PROTOCOL — same caveat as axefx2_set_param. The signal of',
      'success is the user hearing the block engage / disengage and the',
      'device\'s LED state changing.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId. Call axefx2_list_block_types for the full set.',
      ),
      bypassed: z.boolean().describe(
        'true = bypass (block out of signal path), false = engage (block in signal path).',
      ),
    },
  }, async ({ block, bypassed }) => {
    const target = findBlock(block);
    const bytes = buildSetBlockBypassEnvelope(target.id, bypassed);
    const c = ensureConn();
    c.send(bytes);
    const noBypassWarning = target.canBypass
      ? ''
      : `\n\nWARNING: ${target.name} (group ${target.groupCode}) is documented as no-bypass per the wiki. ` +
        `The wire write was sent (${bytes.length} bytes) but the device likely ignored it.`;
    return {
      content: [{
        type: 'text',
        text:
          `Sent bypass=${bypassed ? 'BYPASS' : 'ENGAGE'} for ${target.name} ` +
          `(${target.groupCode}, effectId ${target.id}, paramId 255).\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}${noBypassWarning}\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });

  // axefx2_get_param ---------------------------------------------------------

  server.registerTool('axefx2_get_param', {
    description: [
      'Use this tool to read the current value of a single parameter on the',
      'user\'s Axe-Fx II. Sends GET_BLOCK_PARAMETER_VALUE (function 0x02,',
      'action 0x00) and waits for the device\'s response, which returns BOTH',
      'the wire value (0..65534) and the display label string the device',
      'shows on its UI ("5.00", "Plexi 50W Hi", "12.0 dB", etc.). The label',
      'is firmware-truth — use it verbatim when summarizing to the user.',
      '',
      'RELATIVE-CHANGE DISCIPLINE — call this BEFORE axefx2_set_param when',
      'the user says "more / less / a bit / increase / decrease" or any',
      'other relative phrasing. Without the read, the agent is guessing the',
      'starting point.',
      '',
      'Failure modes:',
      '- "No Axe-Fx II input port available" — the OS exposes only an',
      '  output port, no input. Check list_midi_ports.',
      '- "Timeout waiting for matching SysEx" — request sent but no',
      '  response in 800ms. Likely causes: addressed block not placed in',
      '  the active preset (Axe-Fx II silently absorbs reads on absent',
      '  blocks), Q8.02 firmware uses a different function-byte for GET',
      '  on this paramId (capture HW-074 to verify), or USB handle stale',
      '  (try axefx2_reconnect_midi).',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. Call axefx2_list_params for the full set.',
      ),
    },
  }, async ({ block, name }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }
    const targetId = { effectId: target.id, paramId: param.paramId };
    const reqBytes = buildGetBlockParameterValue(targetId);
    const c = ensureConn();
    // Register the listener BEFORE sending so the response can't race
    // ahead of the predicate registration.
    const responsePromise = c.receiveSysExMatching(
      (bytes) => isGetBlockParameterResponse(bytes, targetId),
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_param failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseGetBlockParameterResponse(response);
    const enumLabel = param.enumValues?.[parsed.value];
    const enumNote = enumLabel ? ` (enum: "${enumLabel}")` : '';
    return {
      content: [{
        type: 'text',
        text:
          `${target.name} → ${param.name} = ${parsed.value} (wire 0..65534).\n` +
          `Device label: "${parsed.label}"${enumNote}.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n`,
      }],
    };
  });

  // axefx2_get_grid_layout ---------------------------------------------------

  server.registerTool('axefx2_get_grid_layout', {
    description: [
      'Use this tool to read the active preset\'s 4-row × 12-column block-',
      'placement grid on the user\'s Axe-Fx II. Sends GET_GRID_LAYOUT_AND_',
      'ROUTING (function 0x20) and parses the 48-cell response. Each cell',
      'reports a block ID + a routing-input mask saying which rows of the',
      'previous column connect to its input.',
      '',
      'CRITICAL FOR HONEST AGENT BEHAVIOR — the MVP does NOT support',
      'changing the grid layout (no add/remove/rearrange/cabling). When',
      'the user asks for a tone change, call this FIRST so you know which',
      'blocks are actually placed in the chain. Don\'t suggest tweaks to a',
      'block ("more reverb decay") if it\'s not on the grid — instead say',
      '"I don\'t see a reverb in the chain; please add Reverb 1 to the',
      'grid via the device or AxeEdit, then I can dial it in".',
      '',
      'Cell semantics:',
      '- blockId 100..170 = a placed block (Amp 1 = 106, Reverb 1 = 110, etc).',
      '  Cross-reference axefx2_list_block_types output.',
      '- blockId 200..235 = a shunt (signal pass-through, no effect, used',
      '  to draw cabling around or through a column).',
      '- blockId 0 = empty cell.',
      '',
      'Routing mask: 4 bits, one per row of the previous column.',
      '- mask & 0x01 → connect from row 1 of previous column',
      '- mask & 0x02 → connect from row 2',
      '- mask & 0x04 → connect from row 3',
      '- mask & 0x08 → connect from row 4',
      '- mask = 0    → no input (start of a new chain or empty cell)',
      '',
      'Output formats:',
      '  - `summary` (default) — one-line-per-row prose. Reads well on any',
      '    chat width, surfaces the iconic single-serial-row case as natural',
      '    "CPR1 → WAH1 → ... → REV1" prose. Best for chat UX.',
      '  - `markdown` — markdown table that renders as a real HTML table in',
      '    Claude Desktop / Cursor / Continue. Use when the grid is non-trivial',
      '    (multi-row, parallel paths) and the spatial layout matters.',
      '  - `ascii` — fixed-width 4×12 grid. Useful in terminal-based MCP',
      '    clients or wide monitors. Wraps badly in narrow chat windows.',
      '  - `json` — raw cell array for machine parsing.',
    ].join('\n'),
    inputSchema: {
      format: z.enum(['summary', 'markdown', 'ascii', 'json']).optional().describe(
        'Output rendering. "summary" (default) for one-line-per-row prose; "markdown" for a chat-rendered table; "ascii" for fixed-width grid; "json" for raw cell array.',
      ),
    },
  }, async ({ format }) => {
    const reqBytes = buildGetGridLayout();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isGetGridLayoutResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_grid_layout failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const cells = parseGetGridLayoutResponse(response);
    const rendered = format === 'json'
      ? renderGridJson(cells)
      : format === 'ascii'
        ? renderGridAscii(cells)
        : format === 'markdown'
          ? renderGridMarkdown(cells)
          : renderGridSummary(cells);
    return {
      content: [{
        type: 'text',
        text:
          `Axe-Fx II grid layout (4 rows × 12 columns, 48 cells):\n\n${rendered}\n\n`,
      }],
    };
  });

  // axefx2_get_preset_name ---------------------------------------------------

  server.registerTool('axefx2_get_preset_name', {
    description: [
      'Read the active preset name on the Axe-Fx II. Returns the preset',
      'name string currently held in the working buffer — the same string',
      'shown on the device front panel. Use this tool any time the agent',
      'needs to know "what preset is loaded right now" on the Axe-Fx II.',
      '',
      'Common phrasings this tool answers:',
      '  - "what preset am I on?" / "what\'s the current preset name?"',
      '  - "read the preset name" / "get the preset name"',
      '  - "what does the Axe-Fx II say is loaded?"',
      '  - "did the rename land?" / "is the save persisted?" — call this',
      '    AFTER axefx2_set_preset_name or axefx2_save_preset to verify.',
      '',
      'Sends GET_PRESET_NAME (function 0x0F). The device responds with',
      'a 32-byte ASCII payload (space-padded) inside the same 0x0F',
      'envelope. Working-buffer scope: this returns the working buffer\'s',
      'name, which after a save-to-slot equals the persisted slot name.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 XL+ (HW-080, 2026-05-10).',
      'No input parameters — the request is a bare envelope.',
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildGetPresetName();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isGetPresetNameResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_preset_name failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const name = parseGetPresetNameResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `Active preset name: "${name}".\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n`,
      }],
    };
  });

  // axefx2_get_active_preset_number ------------------------------------------

  server.registerTool('axefx2_get_active_preset_number', {
    description: [
      'Read the active preset NUMBER (slot index) on the Axe-Fx II.',
      'Returns both the 0-indexed wire value AND the 1-indexed front-',
      'panel display slot. Useful when the agent needs to anchor the',
      'user\'s mental state ("you\'re on slot 47") or detect a preset',
      'switch the user made on the device without telling the agent.',
      '',
      'Common phrasings this tool answers:',
      '  - "what slot am I on?" / "which preset is active?"',
      '  - "what\'s the current preset number?"',
      '  - "did the preset switch land?" — call AFTER axefx2_switch_preset',
      '    to confirm the device is on the requested slot.',
      '',
      'Sends GET_PRESET_NUMBER (function 0x14). Device responds with a',
      '2-byte payload encoding the 14-bit preset number MSB-first.',
      '',
      'NOTE: this returns the preset NUMBER (e.g. 47). For the preset',
      'NAME (e.g. "Vox Light"), use axefx2_get_preset_name instead.',
      'For the FULL grid layout of the active preset, use axefx2_get_',
      'grid_layout.',
      '',
      'Status: 🟡 wire format derived from session-61 passive capture;',
      'will flip to 🟢 once the first end-to-end round-trip lands. No',
      'input parameters — request is a bare envelope.',
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildGetPresetNumber();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isGetPresetNumberResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_active_preset_number failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const { presetNumber, displaySlot } = parseGetPresetNumberResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `Active preset: wire ${presetNumber} (front-panel display: slot ${displaySlot}).\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n`,
      }],
    };
  });

  // axefx2_switch_scene ------------------------------------------------------

  server.registerTool('axefx2_switch_scene', {
    description: [
      'Use this tool to switch the active scene on the user\'s Axe-Fx II.',
      'Sends SET_SCENE_NUMBER (function 0x29) with scene 0..7 (the device',
      'has 8 scenes per preset, 1-indexed in the UI as 1..8 — pass the',
      '0-indexed value here, the response confirms which scene the device',
      'is now on).',
      '',
      'Scenes select per-block channel + bypass state without changing the',
      'block parameters. Useful for performance switching (clean → crunch →',
      'lead → wet ambient). Like AM4 scenes, axefx2 scenes are assignment',
      'switches, not parameter copies.',
      '',
    ].join('\n'),
    inputSchema: {
      scene: z.number().int().min(0).max(7).describe(
        'Scene number 0..7 (device displays 1..8 — subtract 1).',
      ),
    },
  }, async ({ scene }) => {
    const reqBytes = buildSetSceneNumber(scene);
    const c = ensureConn();
    // The device echoes the scene number on success per wiki
    // §SET_SCENE_NUMBER. Wait for the matching response so the user gets
    // a confirmed value rather than a fire-and-forget.
    const responsePromise = c.hasInput
      ? c.receiveSysExMatching(isSceneNumberResponse, GET_RESPONSE_TIMEOUT_MS)
      : null;
    c.send(reqBytes);
    if (!responsePromise) {
      return {
        content: [{
          type: 'text',
          text:
            `Sent SET_SCENE_NUMBER → ${scene} (display: scene ${scene + 1}).\n` +
            `No input port — sent fire-and-forget without confirmation.\n` +
            `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n`,
        }],
      };
    }
    try {
      const response = await responsePromise;
      const confirmed = parseSceneNumberResponse(response);
      return {
        content: [{
          type: 'text',
          text:
            `Switched to scene ${confirmed} (display: scene ${confirmed + 1}). ` +
            `Device confirmed via 0x29 echo.\n` +
            `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
            `Recv (${response.length}B): ${toHex(response)}\n`,
        }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{
          type: 'text',
          text:
            `Sent SET_SCENE_NUMBER → ${scene} (display: scene ${scene + 1}).\n` +
            `No echo within ${GET_RESPONSE_TIMEOUT_MS}ms — write may have landed but the device didn\'t confirm.\n` +
            `Underlying: ${msg}\n` +
            `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n`,
        }],
      };
    }
  });

  // axefx2_set_block_channel -------------------------------------------------

  server.registerTool('axefx2_set_block_channel', {
    description: [
      'Use this tool to switch a block on the user\'s Axe-Fx II between its',
      'two channels — channel X and channel Y. Each block (Amp, Drive,',
      'Reverb, Delay, Chorus, etc.) holds TWO independent sets of params',
      'in X and Y; switching changes which set is active. Distinct from',
      'AM4\'s four-channel A/B/C/D model — Axe-Fx II is the outlier in the',
      'Fractal family on this.',
      '',
      'Per-block channel state is independent of scene switching: scenes',
      'select which channel each block uses on a given scene, but the',
      'block itself only holds X and Y.',
      '',
      'Wire format (function 0x11, wiki-documented + cross-confirmed via',
      'passive capture of an AxeEdit X↔Y toggle in HW-097, 2026-05-11):',
      '  F0 00 01 74 07 11 [eff_lo] [eff_hi] [chan: 0=X, 1=Y] [01=set] [cs] F7',
      '',
      'NO-ACK PROTOCOL — same as axefx2_set_param. Verify by the device\'s',
      'audible / visible response. Front-panel CHANNEL button + AxeEdit\'s',
      'X/Y buttons both reflect the new state.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-098). Amp 1',
      'X→Y SET round-tripped cleanly across wire / read-back / front',
      'panel / AxeEdit.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name ("Amp 1" / "Reverb 1") or numeric effectId.',
      ),
      channel: z.enum(['X', 'Y']).describe(
        'Target channel — "X" or "Y". Each block has these two channels and only these two.',
      ),
    },
  }, async ({ block, channel }) => {
    const target = findBlock(block);
    const bytes = buildSetBlockChannel(target.id, channel as AxeFxIIChannel);
    const c = ensureConn();
    c.send(bytes);
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_BLOCK_CHANNEL → ${target.name} (${target.groupCode}, ` +
          `effectId ${target.id}) channel=${channel}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });

  // axefx2_get_block_channel -------------------------------------------------

  server.registerTool('axefx2_get_block_channel', {
    description: [
      'Use this tool to read the current channel (X or Y) of a block on the',
      'user\'s Axe-Fx II. Sends GET_BLOCK_CHANNEL (function 0x11, action 0)',
      'and waits for the device\'s response.',
      '',
      'Call this BEFORE switching channels to know the starting state, or',
      'after switching to confirm the change landed.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name or numeric effectId.',
      ),
    },
  }, async ({ block }) => {
    const target = findBlock(block);
    const reqBytes = buildGetBlockChannel(target.id);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      (bytes) => isGetBlockChannelResponse(bytes, target.id),
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_block_channel failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const chan = parseGetBlockChannelResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `${target.name} (${target.groupCode}, effectId ${target.id}) is on channel ${chan}.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n`,
      }],
    };
  });

  // axefx2_switch_preset -----------------------------------------------------

  server.registerTool('axefx2_switch_preset', {
    description: [
      'Use this tool to load a preset by number into the user\'s Axe-Fx II',
      'working buffer. Sends LOAD_PRESET (function 0x3C) with the preset',
      'number as a 14-bit septet pair.',
      '',
      'Preset numbering: 0-based linear index. Axe-Fx II XL+ has many',
      'banks; banks A..H plus user banks. The preset number is the full',
      'linear index, not a within-bank position. To find a preset\'s',
      'number, call `axefx2_list_block_types` is not the right tool —',
      'use the device\'s front-panel display, AxeEdit\'s preset browser,',
      'or `axefx2_get_active_preset` once that ships (function 0x14).',
      '',
      'AFTER LOADING — the working buffer reflects the loaded preset.',
      'Use `axefx2_get_preset_name` to confirm the load landed.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-100).',
      'preset_number is 0-based — the device front-panel display shows',
      'slot N+1 for MIDI preset N (e.g. preset_number: 0 = front-panel',
      '"preset 1"). Worth keeping in mind when the user says "load',
      'preset 5" — they almost certainly mean the front-panel slot 5,',
      'which is preset_number: 4 on the wire.',
    ].join('\n'),
    inputSchema: {
      preset_number: z.number().int().min(0).max(16383).describe(
        '0-based linear preset number (0..16383). For factory bank A on Q8.02, preset 0 = first preset, etc.',
      ),
    },
  }, async ({ preset_number }) => {
    const bytes = buildSwitchPreset(preset_number);
    const c = ensureConn();
    c.send(bytes);
    return {
      content: [{
        type: 'text',
        text:
          `Sent LOAD_PRESET → preset ${preset_number}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          `Call axefx2_get_preset_name to confirm which preset is now in the working buffer.\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });

  // axefx2_set_preset_name ---------------------------------------------------

  server.registerTool('axefx2_set_preset_name', {
    description: [
      'Use this tool to set the working-buffer preset name on the user\'s',
      'Axe-Fx II. Sends SET_PRESET_NAME (function 0x09) followed by 32',
      'ASCII characters (the tool space-pads shorter names to 32).',
      '',
      'This writes the name to the WORKING BUFFER only — it does NOT save',
      'to a preset location. After setting the name, the user must press',
      'SAVE on the front panel (or use AxeEdit) to persist the renamed',
      'preset to a slot.',
      '',
      'Validation: name must be ASCII-printable (chars 0x20..0x7E) and',
      'at most 32 characters. Lowercase / uppercase / punctuation / spaces',
      'all allowed; non-ASCII (Unicode) rejected.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-100).',
      'Working-buffer scope confirmed — switching presets after a rename',
      'discards the new name. To persist, user must press SAVE on the',
      'device after the rename lands.',
    ].join('\n'),
    inputSchema: {
      name: z.string().max(32).describe(
        'Preset name (≤32 ASCII-printable chars). The tool right-pads with spaces to 32 chars on the wire.',
      ),
    },
  }, async ({ name }) => {
    const bytes = buildSetPresetName(name);
    const c = ensureConn();
    c.send(bytes);
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_PRESET_NAME → "${name}" (padded to 32 chars on wire).\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          `Call axefx2_get_preset_name to confirm the name landed in the working buffer.\n` +
          `Note: this updates working buffer only — user must press SAVE on the device to persist.\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });

  // axefx2_scan_preset_range -------------------------------------------------

  server.registerTool('axefx2_scan_preset_range', {
    description: [
      'Read the names stored at a range of preset slots on the Axe-Fx II.',
      'Iconic use: setlist pre-flight — before bulk-applying a setlist to',
      'slots 700..715, scan that range first to see which slots hold custom',
      'presets the user might want to keep, and which are empty / safe to',
      'overwrite. Returns one row per slot with name + is_empty flag.',
      '',
      'WORKING-BUFFER CAVEAT: the Axe-Fx II has no "read name at slot N',
      'without loading it" wire primitive. To read each slot\'s name this',
      'tool must `switch_preset` to that slot, which **destroys any',
      'unsaved working-buffer edits**. By default the tool restores the',
      'originally-active preset at the end of the scan, so the device',
      'looks like it did before — but the working buffer\'s pre-scan',
      'edits are GONE. If the user has unsaved tweaks, save first or',
      'skip the scan.',
      '',
      'PERFORMANCE: each slot is one switch + one name-read round-trip,',
      '~50-80 ms per slot. A 16-slot scan finishes in ~1 s. The tool',
      'caps the range at 64 slots per call to keep wall time predictable',
      '(longer ranges should be paginated by the agent).',
      '',
      'INPUT: 0-indexed wire range, inclusive on both ends. Examples:',
      '  { from: 0, to: 7 }       — first 8 user slots (front panel 1..8)',
      '  { from: 699, to: 715 }   — scratch range used in session-61',
      '  { from: 0, to: 0 }       — single-slot scan (rarely useful;',
      '                             prefer axefx2_switch_preset + name read)',
      '',
      'FAILURE: on a mid-scan timeout, the tool aborts and surfaces partial',
      'results plus the failure slot. Agent can decide whether to retry,',
      'narrow the range, or call axefx2_reconnect_midi if the handle is',
      'stale.',
      '',
      'Status: 🟡 wire-sequence is composed of two 🟢-validated tools',
      '(axefx2_switch_preset and axefx2_get_preset_name); will flip to',
      '🟢 once the first end-to-end multi-slot scan lands.',
    ].join('\n'),
    inputSchema: {
      from: z.number().int().min(0).max(16383).describe(
        'Inclusive start of the scan range, 0-indexed wire preset (0..16383). Front-panel display = from + 1.',
      ),
      to: z.number().int().min(0).max(16383).describe(
        'Inclusive end of the scan range, 0-indexed wire preset (0..16383). Must be >= from. Range size (to - from + 1) is capped at 64.',
      ),
      restore_active: z.boolean().optional().describe(
        'After scanning, switch back to whichever preset was active before the scan started. Default true. Pass false only if you are about to call apply_setlist or apply_preset_at next (since those will switch presets anyway).',
      ),
    },
  }, async ({ from, to, restore_active }) => {
    if (to < from) {
      return {
        content: [{
          type: 'text',
          text:
            `Invalid range: from=${from} > to=${to}. ` +
            `Pass from <= to (e.g. { from: 700, to: 715 } for a 16-slot scan).`,
        }],
        isError: true,
      };
    }
    const rangeSize = to - from + 1;
    if (rangeSize > 64) {
      return {
        content: [{
          type: 'text',
          text:
            `Range too wide: ${rangeSize} slots (cap is 64). ` +
            `Split into smaller scans, e.g. { from: ${from}, to: ${from + 63} } first.`,
        }],
        isError: true,
      };
    }
    const restore = restore_active ?? true;
    const c = ensureConn();

    // Capture the originally-active preset so we can restore it at the
    // end. If the device is in an unusual state (e.g. no presets in the
    // user bank, response timeout) we report and proceed without restore.
    let originalActive: number | undefined;
    try {
      const req = buildGetPresetNumber();
      const resp = c.receiveSysExMatching(isGetPresetNumberResponse, GET_RESPONSE_TIMEOUT_MS);
      c.send(req);
      const parsed = parseGetPresetNumberResponse(await resp);
      originalActive = parsed.presetNumber;
    } catch {
      originalActive = undefined;
    }

    interface ScanRow {
      preset_number: number;
      display_slot: number;
      name: string;
      is_empty: boolean;
    }
    const results: ScanRow[] = [];
    let failureSlot: number | undefined;
    let failureReason: string | undefined;

    for (let n = from; n <= to; n++) {
      try {
        c.send(buildSwitchPreset(n));
        const namePromise = c.receiveSysExMatching(
          isGetPresetNameResponse,
          GET_RESPONSE_TIMEOUT_MS,
        );
        c.send(buildGetPresetName());
        const nameResp = await namePromise;
        const name = parseGetPresetNameResponse(nameResp);
        const trimmed = name.trimEnd();
        results.push({
          preset_number: n,
          display_slot: n + 1,
          name: trimmed,
          is_empty: trimmed.length === 0 || /^[\s_]+$/.test(trimmed),
        });
      } catch (err) {
        failureSlot = n;
        failureReason = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    // Best-effort restore even on failure path.
    let restoredText = '';
    if (restore && originalActive !== undefined) {
      try {
        c.send(buildSwitchPreset(originalActive));
        restoredText = `\nRestored active preset to wire ${originalActive} (front-panel display: slot ${originalActive + 1}).`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        restoredText = `\nWARNING: failed to restore original active preset (wire ${originalActive}): ${reason}`;
      }
    } else if (restore && originalActive === undefined) {
      restoredText = `\nNOTE: could not read original active preset before the scan, so no restore attempted. Device is on whichever slot the scan left it (wire ${results[results.length - 1]?.preset_number ?? from}).`;
    } else {
      restoredText = `\nNOTE: restore_active=false; device left on the last scanned slot (wire ${results[results.length - 1]?.preset_number ?? from}).`;
    }

    const lines = results.map((r) =>
      `  wire ${r.preset_number} (slot ${r.display_slot}): ${r.is_empty ? '<EMPTY>' : `"${r.name}"`}`,
    );

    if (failureSlot !== undefined) {
      return {
        content: [{
          type: 'text',
          text:
            `Scan aborted at wire ${failureSlot} (slot ${failureSlot + 1}): ${failureReason}.\n` +
            `Partial results (${results.length}/${rangeSize} scanned):\n` +
            (lines.length > 0 ? lines.join('\n') : '  (no slots scanned)') +
            restoredText +
            `\n\nIf this is the first failed read in a while, the MIDI handle may be stale — call axefx2_reconnect_midi.`,
        }],
        isError: true,
      };
    }

    const populated = results.filter((r) => !r.is_empty).length;
    return {
      content: [{
        type: 'text',
        text:
          `Scanned ${results.length} slot${results.length === 1 ? '' : 's'} (wire ${from}..${to}, ` +
          `display slots ${from + 1}..${to + 1}): ${populated} populated, ${results.length - populated} empty.\n` +
          lines.join('\n') +
          restoredText,
      }],
    };
  });

  // axefx2_set_block_at_cell -------------------------------------------------

  server.registerTool('axefx2_set_block_at_cell', {
    description: [
      'Place a block at a specific grid cell on the Axe-Fx II — the wire-',
      'level write that AxeEdit fires when you drag a block from its',
      'palette onto a grid position. Sends function 0x05 SET_GRID_CELL.',
      '',
      'WHAT IT DOES:',
      '  - Places a block at the specified (row, col) cell.',
      '  - If the block was already on the grid elsewhere, the device',
      '    MOVES it (clears its previous position).',
      '  - Pass `block: "empty"` (or numeric 0) to CLEAR the cell.',
      '',
      'CHAIN ROUTING — row 2 auto-routes; other rows do NOT:',
      '  Row 2 is the device\'s canonical signal lane. When you place a',
      '  block on row 2, the device assigns its input mask to :2 ("feed',
      '  from row 2 of previous column"). Practical effect: building a',
      '  fresh linear chain on row 2 by placing blocks left-to-right',
      '  (col 1 → 2 → 3 → ...) WORKS — each block automatically reads',
      '  from the upstream block on the same row.',
      '',
      '  Rows 1, 3, and 4 do NOT auto-route. Placements on those rows',
      '  land with mask 0 (no input). They are isolated islands until',
      '  explicit routing control ships (see "ROUTING LIMITATIONS" below).',
      '  For now, build chains on row 2.',
      '',
      'CHAIN ROUTING — additional break case:',
      '  REMOVING a block from row 2 then RE-PLACING another block in',
      '  the SAME cell does NOT auto-restore the downstream cell\'s',
      '  routing mask. If you clear cell N then re-write something there,',
      '  cell N+1\'s input mask was cleared by the device when the feeder',
      '  vanished and is NOT restored when the new block arrives.',
      '',
      'RECOMMENDED USAGE PATTERNS:',
      '  - Building a preset from scratch on row 2: clear row 2 cells',
      '    1..N first (with `block: "empty"`), then place blocks',
      '    left-to-right on row 2. All masks come out as :2 → linear',
      '    chain works automatically. This is what axefx2_apply_preset_at',
      '    does internally.',
      '  - Modifying an existing row-2 chain: re-place every block from',
      '    the edit point onward to refresh their routing masks.',
      '  - Single-block tweaks within an existing layout: works fine if',
      '    you replace a block with another in the SAME cell.',
      '',
      'ROUTING LIMITATIONS (open decode work):',
      '  Explicit routing-mask control (for parallel chains, multi-row',
      '  layouts, FX loops, stereo splits) requires either: (a) byte[3]',
      '  of the 0x05 payload controlling routing — currently set to 0',
      '  by this tool — pending hardware verification, or (b) a separate',
      '  function 0x06 write — also undecoded. Either decode unlocks',
      '  rows 1/3/4 + parallel routing. Tracked as a follow-up.',
      '',
      'POSITION CONVENTION:',
      '  - `row`: 1..4 (1-indexed, matches device front-panel display).',
      '  - `col`: 1..12 (1-indexed).',
      '  - Wire format uses col-major cell index = (col-1)*4 + (row-1).',
      '    The tool handles the conversion.',
      '',
      'BLOCK REFERENCE:',
      '  - Named blocks (preferred): "Amp 1", "Compressor 1", "Reverb 2"',
      '    etc. — case-insensitive, matched against the blockTypes',
      '    catalog (IDs 100..170).',
      '  - Numeric IDs: pass the 14-bit effect ID directly. Useful for',
      '    Shunts (IDs 200..235, not in the named catalog) — pass 200',
      '    for a generic pass-through cell.',
      '  - "empty" or 0: clears the cell.',
      '',
      'Status: 🟢 wire format hardware-validated on Q8.02 XL+',
      '(session-63 probe sequence, 2026-05-11). Probe-and-observe decode',
      'using passive capture; no bridge required. Routing auto-restore',
      'limitation documented above and queued as a follow-up decode.',
    ].join('\n'),
    inputSchema: {
      row: z.number().int().min(1).max(4).describe(
        'Grid row 1..4 (1 = top row, 2 = main signal lane on most factory presets).',
      ),
      col: z.number().int().min(1).max(12).describe(
        'Grid column 1..12 (1 = leftmost / chain start).',
      ),
      block: z.union([z.string(), z.number()]).describe(
        'Block to place. Display name (e.g. "Amp 1"), numeric effect ID, "empty"/"clear" to clear the cell, or "shunt" for a pass-through. Shunt IDs 200..235 also accepted as numbers.',
      ),
    },
  }, async ({ row, col, block }) => {
    // Resolve block reference to a numeric ID.
    let blockId: number;
    let displayName: string;
    if (typeof block === 'number') {
      blockId = block;
      if (blockId === 0) {
        displayName = '<empty>';
      } else if (blockId >= 200 && blockId <= 235) {
        displayName = `Shunt (ID ${blockId})`;
      } else {
        const named = BLOCK_BY_ID[blockId];
        displayName = named ? `${named.name} (ID ${blockId})` : `Block ID ${blockId}`;
      }
    } else {
      const norm = block.trim().toLowerCase();
      if (norm === 'empty' || norm === 'clear' || norm === 'none') {
        blockId = 0;
        displayName = '<empty>';
      } else if (norm === 'shunt') {
        blockId = 200;
        displayName = 'Shunt';
      } else {
        const named = findBlock(block);
        blockId = named.id;
        displayName = `${named.name} (ID ${named.id})`;
      }
    }

    const bytes = buildSetGridCell({ row, col, blockId });
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGridCellResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(bytes);

    let ackText: string;
    try {
      const ack = await responsePromise;
      const parsed = parseSetGridCellResponse(ack);
      if (parsed.ok) {
        ackText =
          `Device ACK: 0x64 echoed_fn=0x05 result_code=0x00 (OK).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}`;
      } else {
        ackText =
          `Device NACK: 0x64 echoed_fn=0x05 result_code=0x` +
          `${parsed.resultCode.toString(16).padStart(2, '0')} ` +
          `(NOT OK — the device parsed the frame but rejected it).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}\n` +
          `Common cause: device firmware refused the placement. The` +
          ` working buffer is likely unchanged; verify with` +
          ` axefx2_get_grid_layout.`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ackText =
        `No 0x64 ACK arrived within ${GET_RESPONSE_TIMEOUT_MS}ms: ${msg}.\n` +
        `The SET_GRID_CELL bytes were sent successfully; verify the` +
        ` change with axefx2_get_grid_layout.`;
    }

    const cellIdx = (col - 1) * 4 + (row - 1);
    return {
      content: [{
        type: 'text',
        text:
          `Placed ${displayName} at row ${row}, col ${col} ` +
          `(cell index ${cellIdx}).\n` +
          `Wire (${bytes.length}B): ${toHex(bytes)}\n\n` +
          ackText + '\n\n' +
          `Next step: call axefx2_get_grid_layout to see the new grid` +
          ` state. Note: routing/cabling is NOT auto-propagated to` +
          ` downstream cells — if you modified an existing chain, you` +
          ` may need to re-place downstream blocks to restore their` +
          ` input masks.`,
      }],
    };
  });

  // axefx2_save_preset -------------------------------------------------------

  server.registerTool('axefx2_save_preset', {
    description: [
      'Use this tool to PERSIST the user\'s working buffer to a user preset',
      'slot on the Axe-Fx II. Sends STORE_PRESET (function 0x1D) with the',
      'target slot number; optionally sets the preset name first (function',
      '0x09). This is the save-to-location operation — equivalent to',
      'AxeEdit\'s "File → Save Preset" — and is THE only way to make a',
      'working-buffer change survive a preset switch or device reboot.',
      '',
      '**DESTRUCTIVE — this overwrites whatever is currently at the target',
      'preset slot.** Unlike the other write tools, this one is NOT',
      'reversible by switching presets. The previous contents of that slot',
      'are GONE once the save lands.',
      '',
      'WORKFLOW the agent must follow:',
      '  1. Confirm WITH THE USER which slot they want to save to.',
      '     Do not assume. The user typically says it in plain language',
      '     ("save this to slot 700", "put it on user bank A preset 1").',
      '  2. If you have ANY doubt the target slot might already contain',
      '     a preset the user cares about, ASK BEFORE CALLING. Suggest a',
      '     designated scratch slot if the user doesn\'t care where.',
      '  3. Pass `preset_number` 0-indexed on the wire (the device front',
      '     panel displays slot N+1 for wire preset N — same convention',
      '     as axefx2_switch_preset). Example: user says "save to slot',
      '     700" → pass `preset_number: 699`.',
      '  4. Pass an optional `name` (≤32 ASCII-printable chars) to also',
      '     set the preset name in one operation. If omitted, the tool',
      '     saves whatever name is currently in the working buffer.',
      '',
      'RESPONSE: the device confirms with a 0x64 MULTIPURPOSE_RESPONSE.',
      'result_code=0x00 means OK (save landed); result_code=0x05 means',
      'the device parsed the message but rejected it (e.g. read-only',
      'firmware mode, locked slot). The tool surfaces both back to the',
      'agent so it can report the outcome accurately.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 XL+ (HW-102, 2026-05-11).',
      'End-to-end round-trip landed first try: our encoder fired 0x09 +',
      '0x1D, device responded `0x64 1D 00` (OK), working buffer persisted',
      'to slot 700 confirmed by founder front-panel inspection. Wire',
      'format derived from bspaulding/axe-fx-midi + session-61 passive',
      'capture of AxeEdit\'s File → Save Preset operation.',
      '',
      'preset_number range: 0..16383 on the wire (XL+ has 768 user slots',
      'live; values above range may be rejected with `result_code=0x05`).',
    ].join('\n'),
    inputSchema: {
      preset_number: z.number().int().min(0).max(16383).describe(
        '0-based wire preset number to save TO (0..16383). Device front-panel display shows slot N+1 — so user-spoken "slot 700" = preset_number 699.',
      ),
      name: z.string().max(32).optional().describe(
        'Optional preset name (≤32 ASCII-printable chars). If provided, the tool sends SET_PRESET_NAME (0x09) BEFORE the STORE so the saved preset carries the new name. If omitted, saves with whatever name is currently in the working buffer.',
      ),
    },
  }, async ({ preset_number, name }) => {
    const c = ensureConn();
    const wireOps: string[] = [];
    let totalBytes = 0;

    // Step 1 (optional): rename working buffer before the commit.
    if (name !== undefined) {
      const nameBytes = buildSetPresetName(name);
      c.send(nameBytes);
      totalBytes += nameBytes.length;
      wireOps.push(
        `SET_PRESET_NAME (0x09, ${nameBytes.length}B): ${toHex(nameBytes)}`,
      );
    }

    // Step 2: STORE — commit working buffer to target slot.
    const storeBytes = buildStorePreset(preset_number);
    const responsePromise = c.receiveSysExMatching(
      isStorePresetResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(storeBytes);
    totalBytes += storeBytes.length;
    wireOps.push(
      `STORE_PRESET (0x1D, ${storeBytes.length}B): ${toHex(storeBytes)}`,
    );

    let ackText: string;
    try {
      const ack = await responsePromise;
      const parsed = parseStorePresetResponse(ack);
      if (parsed.ok) {
        ackText =
          `Device ACK: 0x64 (MULTIPURPOSE_RESPONSE) echoed_fn=0x1D ` +
          `result_code=0x00 (OK).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}`;
      } else {
        ackText =
          `Device NACK: 0x64 echoed_fn=0x1D result_code=0x` +
          `${parsed.resultCode.toString(16).padStart(2, '0')} ` +
          `(NOT OK — device parsed the STORE request but rejected it).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}\n` +
          `Common causes: target slot locked, firmware-protected, or ` +
          `working buffer in an unsavable state. Working buffer state ` +
          `unchanged; previous slot contents preserved.`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ackText =
        `WARNING: no 0x64 MULTIPURPOSE_RESPONSE arrived within ` +
        `${GET_RESPONSE_TIMEOUT_MS}ms.\n` +
        `Cause: ${msg}\n` +
        `The STORE bytes were sent successfully, but we can't confirm ` +
        `the device persisted the working buffer. Verify by:\n` +
        `  1. axefx2_switch_preset({ preset_number: ${preset_number} }) — ` +
        `loads the target slot.\n` +
        `  2. axefx2_get_preset_name — should echo what you just saved.\n` +
        `If the name doesn't match, the save didn't land; retry or ` +
        `check the device's front-panel state.`;
    }

    return {
      content: [{
        type: 'text',
        text:
          `Saved working buffer to preset ${preset_number} ` +
          `(front-panel display: slot ${preset_number + 1})` +
          (name !== undefined ? ` with name "${name}"` : '') +
          `.\n` +
          `Wire sequence (${totalBytes}B total):\n` +
          wireOps.map((line, i) => `  ${i + 1}. ${line}`).join('\n') +
          `\n\n${ackText}`,
      }],
    };
  });

  // axefx2_apply_preset ------------------------------------------------------

  server.registerTool('axefx2_apply_preset', {
    description: [
      'Use this tool to build / configure the user\'s Axe-Fx II preset from',
      'a single structured description. Writes per-block params, optional',
      'bypass state, optional channel selection (X/Y) for each block. Can',
      'switch to a target preset slot first and / or rename the working',
      'buffer after the writes. ONE tool call replaces what would otherwise',
      'be 20-100 separate `axefx2_set_param` calls.',
      '',
      'WORKFLOW — "build a named new preset from chat":',
      '  1. (optional) `target_preset_number`: if you want to build the',
      '     preset on a specific slot, set this first — the tool loads',
      '     that slot into the working buffer before writing.',
      '  2. `blocks[]`: per-block params + bypass + channel. Each block',
      '     is addressed by display name ("Amp 1") or numeric effectId.',
      '  3. (optional) `scene`: switch to scene N before writing.',
      '  4. (optional) `name`: rename the working buffer.',
      '',
      'After this tool returns, the device\'s working buffer holds the new',
      'tone. **The user must press SAVE on the front panel (or in',
      'AxeEdit) to persist** — save-to-location via MIDI is still being',
      'decoded (see HARDWARE-TASKS HW-094..HW-096 / HW-099). Tell the',
      'user at the end of your reply: "Tone built. Press SAVE on the',
      'device to persist."',
      '',
      'DISPLAY-FIRST PARAMS — for blocks/params with calibrated display',
      'ranges (HW-079/088/089/090/091/092 calibrations), pass display',
      'values: `bass: 6.0`, `mix: 30`, `feedback: -25`, `low_cut: 200`',
      '(Hz). For uncalibrated params, pass raw 0..65534 wire integers.',
      'The tool auto-detects which mode the value is in based on',
      'whether it fits the param\'s `displayMin..displayMax` range.',
      '',
      'CHANNELS — Axe-Fx II blocks have TWO channels (X / Y), not four.',
      'Pass `channel: "X"` or `channel: "Y"` per block to switch before',
      'writing params; writes land on the now-active channel. To',
      'configure BOTH channels in one apply call, use `channels: { X:',
      '{...}, Y: {...} }` — the tool switches X, writes, switches Y,',
      'writes. Without `channel` or `channels`, writes go to whichever',
      'channel is currently active for that block.',
      '',
      'CONFIRMATION — for any preset build that touches > 3 blocks or',
      '> 10 total params, briefly summarize the plan ("I\'ll set Amp 1 to',
      'Class-A with bass 6 / treble 7 / master 5, engage Drive 1 with',
      'T808 OD model and gain 3.5, set Reverb 1 mix to 25, switch to',
      'scene 1, name it \'Vox Light\'") and wait for the user\'s "yes" /',
      '"go" before calling this tool.',
      '',
      'GRID PREFLIGHT — by default, the tool errors before any wire',
      'write if a `blocks[].block` references a block not placed in',
      'the active preset\'s grid (the device silently absorbs writes',
      'to absent blocks, which produces non-debuggable "I made the',
      'change but nothing happened"). Set `preflight: "permissive"` to',
      'skip this check.',
      '',
      'Status: 🟢 hardware-verified on Q8.02 (2026-05-11, HW-101). 6-block',
      'Class-A clean build (Amp 1 + Cab 1 + Reverb 1 + 3 bypasses + scene',
      '0 + name "HW-101 Test") landed in 33ms / 257 bytes / 15 wire ops.',
      'Display→wire math verified at all 7 calibrated params (bass/middle/',
      'treble/master/drive 0..10 linear; cab.level -80..+20 dB; reverb.mix',
      '0..100%). Grid preflight + name write + scene switch all worked.',
      'Audible-tone check skipped due to founder being unable to strum at',
      'test time; visual + wire confirmation only.',
    ].join('\n'),
    inputSchema: {
      target_preset_number: z.number().int().min(0).max(16383).optional().describe(
        'Optional — load this preset slot into the working buffer before applying writes. Use to build a new preset on a known scratch slot (e.g. 0 for the first slot in a known-empty bank). If omitted, applies to whatever preset is currently in the working buffer.',
      ),
      blocks: z.array(z.object({
        block: z.union([z.string(), z.number()]).describe(
          'Block instance — display name ("Amp 1") or effectId. Required.',
        ),
        bypass: z.boolean().optional().describe(
          'Optional bypass toggle. true = bypassed (silent), false = engaged. Omit to leave bypass state alone.',
        ),
        channel: z.enum(['X', 'Y']).optional().describe(
          'Optional channel select before writing params. Mutually exclusive with `channels`.',
        ),
        params: z.record(z.string(), z.number()).optional().describe(
          'Map of param-name → value. Display values for calibrated params, wire 0..65534 for uncalibrated. Mutually exclusive with `channels`.',
        ),
        channels: z.record(z.enum(['X', 'Y']), z.record(z.string(), z.number())).optional().describe(
          'Map of channel → param map for configuring BOTH channels in one call. e.g. { X: { gain: 3 }, Y: { gain: 8 } }. Mutually exclusive with `channel` and `params`.',
        ),
      })).min(1).describe('Ordered list of blocks to configure. Writes happen in this order.'),
      scene: z.number().int().min(0).max(7).optional().describe(
        'Optional 0..7. Switches to this scene (display: scene+1) BEFORE writing block params, so writes land in that scene\'s context.',
      ),
      name: z.string().max(32).optional().describe(
        'Optional working-buffer preset name (≤32 ASCII-printable chars). Written AFTER all block writes complete.',
      ),
      preflight: z.enum(['strict', 'permissive']).optional().describe(
        'Default "strict": error before any wire write if a block isn\'t placed in the active preset\'s grid. "permissive" sends writes anyway (device silently absorbs writes to absent blocks).',
      ),
    },
  }, async ({ target_preset_number, blocks, scene, name, preflight }) => {
    const mode = preflight ?? 'strict';

    // 1. Resolve every block reference up front. Catch typos before any wire write.
    type ResolvedBlock = {
      target: AxeFxIIBlock;
      bypass?: boolean;
      channel?: AxeFxIIChannel;
      channels?: { X?: Record<string, number>; Y?: Record<string, number> };
      params?: Record<string, number>;
    };
    const resolved: ResolvedBlock[] = [];
    for (const b of blocks) {
      const target = findBlock(b.block);
      // Mutual exclusion: channels vs (channel + params).
      if (b.channels && (b.channel !== undefined || b.params !== undefined)) {
        throw new Error(
          `Block "${target.name}": \`channels\` is mutually exclusive with \`channel\` and \`params\`. ` +
          `Use either { channel: "X", params: {...} } OR { channels: { X: {...}, Y: {...} } }, not both.`,
        );
      }
      resolved.push({
        target,
        bypass: b.bypass,
        channel: b.channel as AxeFxIIChannel | undefined,
        channels: b.channels as { X?: Record<string, number>; Y?: Record<string, number> } | undefined,
        params: b.params as Record<string, number> | undefined,
      });
    }

    // 2. Strict-mode grid preflight: read GET_GRID_LAYOUT and confirm every
    //    referenced block is placed. Permissive mode skips this.
    const conn = ensureConn();
    let placedIds: Set<number> | undefined;
    if (mode === 'strict') {
      try {
        const gridReqBytes = buildGetGridLayout();
        const responsePromise = conn.receiveSysExMatching(
          isGetGridLayoutResponse,
          GET_RESPONSE_TIMEOUT_MS,
        );
        conn.send(gridReqBytes);
        const gridResponse = await responsePromise;
        const cells = parseGetGridLayoutResponse(gridResponse);
        placedIds = new Set(cells.filter((c) => c.blockId !== 0).map((c) => c.blockId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `axefx2_apply_preset preflight failed: could not read grid layout. ${msg}\n` +
          `Run with \`preflight: "permissive"\` to skip the preflight check, or \`axefx2_reconnect_midi\` if the port is stale.`,
        );
      }
      const missing = resolved.filter((r) => !placedIds!.has(r.target.id));
      if (missing.length > 0) {
        const lines = missing.map((m) =>
          `  - ${m.target.name} (${m.target.groupCode}, effectId ${m.target.id}) is not placed on the active grid`,
        );
        throw new Error(
          `axefx2_apply_preset strict preflight failed — ${missing.length} block(s) not placed:\n` +
          `${lines.join('\n')}\n\n` +
          `Either (a) ask the user to drag the missing blocks onto the grid in AxeEdit ` +
          `(this tool can\'t add blocks — grid edits are not yet decoded), or ` +
          `(b) pass \`preflight: "permissive"\` to send writes anyway (the device silently ` +
          `absorbs writes to absent blocks, so you won\'t hear a change but the wire call won\'t error).`,
        );
      }
    }

    // 3. Build the write sequence. All wire-shape validation happens here so
    //    a bad param name in block #5 fails before we send anything from block #1.
    interface Op {
      kind: 'switch_preset' | 'switch_scene' | 'channel' | 'bypass' | 'param' | 'name';
      bytes: number[];
      summary: string;
    }
    const ops: Op[] = [];

    if (target_preset_number !== undefined) {
      ops.push({
        kind: 'switch_preset',
        bytes: buildSwitchPreset(target_preset_number),
        summary: `LOAD_PRESET → ${target_preset_number}`,
      });
    }
    if (scene !== undefined) {
      ops.push({
        kind: 'switch_scene',
        bytes: buildSetSceneNumber(scene),
        summary: `SET_SCENE → ${scene} (display: scene ${scene + 1})`,
      });
    }

    for (const r of resolved) {
      // Bypass first (so subsequent param writes land in the desired engaged/bypassed state).
      if (r.bypass !== undefined) {
        ops.push({
          kind: 'bypass',
          bytes: buildSetBlockBypassEnvelope(r.target.id, r.bypass),
          summary: `${r.target.name}: bypass=${r.bypass ? 'BYPASSED' : 'ENGAGED'}`,
        });
      }

      // Channel selection paths.
      const channelGroups: Array<{ chan: AxeFxIIChannel; params: Record<string, number> }> = [];
      if (r.channels) {
        if (r.channels.X) channelGroups.push({ chan: 'X', params: r.channels.X });
        if (r.channels.Y) channelGroups.push({ chan: 'Y', params: r.channels.Y });
      } else if (r.channel && r.params) {
        channelGroups.push({ chan: r.channel, params: r.params });
      } else if (r.channel && !r.params) {
        // Channel-only switch with no params.
        channelGroups.push({ chan: r.channel, params: {} });
      } else if (r.params) {
        // Params only, no channel switch — write to whichever channel is currently active.
        channelGroups.push({ chan: undefined as unknown as AxeFxIIChannel, params: r.params });
      }

      for (const group of channelGroups) {
        if (group.chan !== undefined) {
          ops.push({
            kind: 'channel',
            bytes: buildSetBlockChannel(r.target.id, group.chan),
            summary: `${r.target.name}: channel=${group.chan}`,
          });
        }
        for (const [paramName, value] of Object.entries(group.params)) {
          const param = findParam(r.target, paramName);
          if (!param) {
            throw new Error(
              `axefx2_apply_preset: unknown param "${paramName}" for ${r.target.name} ` +
              `(group ${r.target.groupCode}). Call axefx2_list_params for the full set.`,
            );
          }
          // Display-first conversion: auto-detect mode same as axefx2_set_param.
          const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
          const useDisplay = hasCalibration && value <= (param.displayMax ?? 0);
          let wire: number;
          let modeNote: string;
          if (useDisplay) {
            wire = displayToWire(value, {
              displayMin: param.displayMin as number,
              displayMax: param.displayMax as number,
              displayScale: param.displayScale,
            });
            const scale = param.displayScale ?? 'linear';
            modeNote = `${value} → wire ${wire} via [${param.displayMin}..${param.displayMax}] ${scale}`;
          } else {
            if (!Number.isInteger(value) || value < 0 || value > 65534) {
              throw new Error(
                `axefx2_apply_preset: wire value out of range for ${r.target.name}.${paramName}: ${value} ` +
                `(valid 0..65534, or display value if param has displayMin/displayMax).`,
              );
            }
            wire = value;
            modeNote = `wire ${wire}`;
          }
          ops.push({
            kind: 'param',
            bytes: buildSetBlockParameterValue({ effectId: r.target.id, paramId: param.paramId }, wire),
            summary: `${r.target.name}.${paramName} = ${modeNote}`,
          });
        }
      }
    }

    if (name !== undefined) {
      ops.push({
        kind: 'name',
        bytes: buildSetPresetName(name),
        summary: `SET_PRESET_NAME → "${name}"`,
      });
    }

    // 4. Run the wire sequence. Send fire-and-forget for set ops; for switch_preset
    //    + switch_scene wait briefly so subsequent writes don't race.
    const startMs = Date.now();
    let totalBytes = 0;
    const summaries: string[] = [];
    for (const op of ops) {
      conn.send(op.bytes);
      totalBytes += op.bytes.length;
      summaries.push(`  ${op.summary}  (${op.bytes.length}B)`);
      // Brief settle between mode-change ops (preset/scene/channel switches).
      // Empirically a single set_param takes ~50ms wire round-trip; mode
      // changes likely take a bit longer for the device to swap state.
      if (op.kind === 'switch_preset' || op.kind === 'switch_scene' || op.kind === 'channel') {
        await new Promise((res) => setTimeout(res, 20));
      }
    }
    const elapsedMs = Date.now() - startMs;

    const header = `axefx2_apply_preset: ran ${ops.length} wire op(s) in ${elapsedMs}ms, total ${totalBytes} bytes.`;
    const footer = name !== undefined
      ? `\nWorking buffer renamed to "${name}". Tell the user: "Tone built and named — press SAVE on the device to persist."`
      : `\nTell the user: "Tone built. Press SAVE on the device to persist (save-to-location is being decoded; see HARDWARE-TASKS HW-094..HW-099)."`;

    return {
      content: [{
        type: 'text',
        text: [header, '', ...summaries, footer, '', NO_ACK_NOTE].join('\n'),
      }],
    };
  });

  // axefx2_apply_preset_at ---------------------------------------------------

  server.registerTool('axefx2_apply_preset_at', {
    description: [
      'Build a complete Axe-Fx II preset from scratch AND save it to a',
      'specific user-preset slot — single tool call, fully end-to-end.',
      'This is the canonical "Claude designs a tone for a song and the',
      'user gets a saved preset" entry point. Combines: switch to target',
      'slot, clear row 2 grid, place blocks left-to-right on row 2 (auto-',
      'routed as a linear chain), set per-block params, optional scene +',
      'name, save via STORE_PRESET (function 0x1D).',
      '',
      'WHEN TO USE: when the user has a clear single-preset spec ready —',
      '"Build me a clean Vox tone with light delay and reverb, save to',
      'slot 700, name it \'Vox Light\'." For setlist-style multi-preset',
      'batches, prefer `axefx2_apply_setlist` which iterates this tool.',
      '',
      'GRID LAYOUT — row 2 only (current limitation):',
      '  Blocks are placed on row 2 in declared order: blocks[0] → col 1,',
      '  blocks[1] → col 2, ..., blocks[N-1] → col N. Cells N+1 through',
      '  12 are CLEARED. Row 2 placements auto-route (each cell reads',
      '  from row 2 of prev col, forming a linear chain). Multi-row /',
      '  parallel routing requires explicit routing-mask control which',
      '  is undecoded — see axefx2_set_block_at_cell docstring.',
      '',
      'OVERWRITE WARNING — DESTRUCTIVE:',
      '  This tool calls STORE_PRESET at the end, which overwrites',
      '  whatever was at the target slot. Per Axe-Fx II save convention',
      '  the user MUST have explicitly confirmed the target slot before',
      '  you call this tool. For unknown target slots, run',
      '  `axefx2_scan_preset_range` first to surface what would be lost.',
      '',
      'CHANNELS: Axe-Fx II has 2 channels per block (X / Y), not 4.',
      'Pass `channel: "X"` or `channel: "Y"` per block to switch before',
      'writing its params. Both channels in one call: not yet supported',
      '(use `axefx2_apply_preset` separately if needed).',
      '',
      'DISPLAY-FIRST PARAMS: pass display values for calibrated params',
      '(`gain: 5.0`, `mix: 30`, `low_cut: 200`). Tool auto-detects',
      'display vs wire-int mode same as `axefx2_set_param`.',
      '',
      'PERFORMANCE: ~12 clear writes + N place writes + ~20 param writes',
      '+ 3 misc (scene, name, save) = ~40-50 wire ops, ~1.5-2.5 s per',
      'preset on Q8.02 USB. Acceptable for "build before the show"',
      'workflows; not for "between songs."',
      '',
      'FAILURE: returns an error before any wire write if blocks',
      'reference unknown block names. Param-name typos error mid-build',
      'and leave the working buffer in a partial state — re-run with',
      'corrected names or call `axefx2_set_param` to fix manually.',
      '',
      'Status: 🟡 first-version composition of 🟢-validated primitives:',
      'switch_preset (🟢 HW-100), set_block_at_cell (🟢 session-63),',
      'set_block_parameter_value (🟢 HW-075), set_scene_number (🟢 HW-078',
      'queued), set_preset_name (🟢 HW-100), store_preset (🟢 HW-102).',
      'End-to-end round-trip against Q8.02 pending.',
    ].join('\n'),
    inputSchema: {
      preset_number: z.number().int().min(0).max(16383).describe(
        'Target user-preset slot to SAVE the built preset into (0-indexed wire; front-panel display = preset_number + 1). DESTRUCTIVE — overwrites whatever is at this slot.',
      ),
      blocks: z.array(z.object({
        block: z.union([z.string(), z.number()]).describe(
          'Block to place — display name ("Amp 1") or numeric effectId. Order matters: blocks[0] lands at row 2 col 1, blocks[1] at col 2, etc.',
        ),
        bypass: z.boolean().optional().describe(
          'Optional bypass toggle for this block. true = bypassed, false = engaged. Omitted = leave default (engaged after fresh placement).',
        ),
        channel: z.enum(['X', 'Y']).optional().describe(
          'Optional channel switch before writing params (X / Y).',
        ),
        params: z.record(z.string(), z.number()).optional().describe(
          'Map of param-name → value. Display values for calibrated params, wire 0..65534 for uncalibrated.',
        ),
      })).min(1).max(12).describe(
        'Ordered list of blocks for the row-2 chain. Up to 12 blocks (1 per column). Each block lands at row 2, col = (index + 1).',
      ),
      scene: z.number().int().min(0).max(7).optional().describe(
        'Optional scene 0..7 to switch to before writing block params (display: scene + 1).',
      ),
      name: z.string().max(32).optional().describe(
        'Optional preset name (≤32 ASCII-printable chars). Written before save.',
      ),
    },
  }, async ({ preset_number, blocks, scene, name }) => {
    const input: ApplyPresetAtInput = {
      preset_number,
      blocks: blocks as ApplyPresetAtInput['blocks'],
      scene,
      name,
    };

    // Validate + build ops (throws on bad input — caught by MCP framework).
    let ops: ApplyPresetAtOp[];
    try {
      ops = buildApplyPresetAtOps(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`axefx2_apply_preset_at: ${msg}`);
    }

    // Run the sequence.
    const conn = ensureConn();
    const result = await runApplyPresetAtOps(conn, ops);

    const header =
      `axefx2_apply_preset_at: built preset → slot ${preset_number} ` +
      `(display: slot ${preset_number + 1})` +
      (name !== undefined ? ` named "${name}"` : '') +
      ` in ${result.elapsedMs}ms (${ops.length} wire ops, ${result.totalBytes} bytes, ${result.acks} ACKs).`;

    const failureNote = result.lastNack
      ? `\n\nNOTE: at least one op got a non-OK ACK. Last NACK: ` +
        `${result.lastNack.summary} → result=0x${result.lastNack.resultCode.toString(16)}. ` +
        `Verify the final preset state on the device.`
      : '';

    const verifyHint =
      `\n\nVerify with axefx2_switch_preset({ preset_number: ${preset_number} }) ` +
      `+ axefx2_get_preset_name + axefx2_get_grid_layout — those should show ` +
      `the saved preset` + (name !== undefined ? ` named "${name}"` : '') + `.`;

    return {
      content: [{
        type: 'text',
        text: [header, '', ...result.summaries, failureNote, verifyHint].join('\n'),
      }],
    };
  });

  // axefx2_apply_setlist -----------------------------------------------------

  server.registerTool('axefx2_apply_setlist', {
    description: [
      'Build and save MULTIPLE presets to user-preset slots in a single',
      'batch call — the canonical "Claude, set up my setlist for the',
      'show" tool. Iterates `axefx2_apply_preset_at` over N entries,',
      'sharing one validation pass up front and one inbound MIDI capture',
      'across the entire sequence.',
      '',
      'WHEN TO USE: when the user has a fully-specified multi-preset',
      'plan ready ("Build clean Vox at slot 700, crunch Plexi at 701,',
      'lead Mark V at 702, ambient at 703, save them all"). For CREATIVE',
      'batch builds where you are picking tone targets per song from',
      'natural-language direction, prefer calling `axefx2_apply_preset_at`',
      'in sequence (one per preset, narrating progress between calls).',
      'Per-preset focused decisions are faster and more reliable than',
      'cramming 15 simultaneous decisions into one tool call: each',
      'apply_preset_at result is an immediate checkpoint, vs apply_setlist',
      'where any single entry\'s validation error fails all of them.',
      '',
      'DISPLAY-DRIFT CAVEAT: while the batch runs, the device\'s active',
      'preset moves through the setlist as each preset is built and',
      'saved. The user will see the front-panel preset number cycle.',
      'Post-batch the device sits on the last preset built. To return to',
      'their pre-batch state, the user can switch presets manually or',
      'the agent can call `axefx2_switch_preset` after the batch.',
      '',
      'PRE-FLIGHT SCAN: before calling on a target range that may contain',
      'non-empty user presets, run `axefx2_scan_preset_range` over the',
      'target slots and surface what would be overwritten. Silent',
      'overwrites are the worst failure mode for this workflow.',
      '',
      'PERFORMANCE: ~1.5-2.5 s wall time per preset (40-50 wire ops each).',
      'A 15-preset setlist is ~30-40 s. Frame as a "load before the show"',
      'workflow, not "load between songs." Tell the user the wall-time',
      'estimate up front; do not start the batch and leave them watching',
      'a silent terminal.',
      '',
      'FAILURE SEMANTICS: `on_error="stop"` (default) halts immediately',
      'on first error and surfaces the failed slot plus the unprocessed',
      '`remaining` list so the agent can decide whether to retry, rewind,',
      'or continue. `on_error="continue"` logs each error in the per-entry',
      'results and proceeds through the rest of the batch.',
      '',
      'DRY RUN: pass `dry_run: true` to run validation only; every entry',
      'is shape-validated against the same rules as live execution, but',
      'no wire writes leave the host. Useful for catching schema',
      'mistakes before committing to the wall time of a real batch.',
      '',
      'OUTPUT: returns { total, applied, failed, remaining, results,',
      'totalWallTimeMs, finalActivePreset }. Per-entry results carry',
      '{ preset_number, status: "ok"|"error", error?, wallTimeMs }.',
      '',
      'Status: 🟡 first-version composition over 🟢 primitives. Validated',
      'in chat smoke; end-to-end hardware round-trip pending.',
    ].join('\n'),
    inputSchema: {
      presets: z.array(z.object({
        preset_number: z.number().int().min(0).max(16383).describe(
          'Target user-preset slot to save THIS entry to (0-indexed wire).',
        ),
        blocks: z.array(z.object({
          block: z.union([z.string(), z.number()]),
          bypass: z.boolean().optional(),
          channel: z.enum(['X', 'Y']).optional(),
          params: z.record(z.string(), z.number()).optional(),
        })).min(1).max(12),
        scene: z.number().int().min(0).max(7).optional(),
        name: z.string().max(32).optional(),
      })).min(1).max(26).describe(
        '1..26 setlist entries. Each has the same shape as axefx2_apply_preset_at\'s input. preset_numbers must be unique within the batch.',
      ),
      on_error: z.enum(['stop', 'continue']).optional().describe(
        'Failure handling. "stop" (default) halts on first error; "continue" logs the error and proceeds.',
      ),
      dry_run: z.boolean().optional().describe(
        'Validate every entry without sending any wire bytes. Returns { ok, total, validated, message }. Default false.',
      ),
    },
  }, async ({ presets, on_error, dry_run }) => {
    const onError: 'stop' | 'continue' = on_error ?? 'stop';
    const dryRun = dry_run ?? false;

    // Validation pass.
    const seenPresets = new Set<number>();
    const validatedEntries: { input: ApplyPresetAtInput; ops: ApplyPresetAtOp[] }[] = [];
    for (let i = 0; i < presets.length; i++) {
      const entry = presets[i];
      if (seenPresets.has(entry.preset_number)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              step: 'validate',
              error: `presets[${i}]: preset_number ${entry.preset_number} appears more than once in the batch; each slot may appear at most once per call`,
            }, null, 2),
          }],
          isError: true,
        };
      }
      seenPresets.add(entry.preset_number);
      const input: ApplyPresetAtInput = {
        preset_number: entry.preset_number,
        blocks: entry.blocks as ApplyPresetAtInput['blocks'],
        scene: entry.scene,
        name: entry.name,
      };
      try {
        const ops = buildApplyPresetAtOps(input);
        validatedEntries.push({ input, ops });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              step: 'validate',
              error: `presets[${i}] (preset_number ${entry.preset_number}): ${reason}`,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }

    if (dryRun) {
      const totalOps = validatedEntries.reduce((sum, e) => sum + e.ops.length, 0);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            total: validatedEntries.length,
            validated: validatedEntries.length,
            totalOps,
            message: `Validated ${validatedEntries.length} entry/entries (${totalOps} total wire ops); no wire writes performed.`,
          }, null, 2),
        }],
      };
    }

    // Live execution.
    const conn = ensureConn();
    const startMs = Date.now();
    const perEntryResults: { preset_number: number; status: 'ok' | 'error'; error?: string; wallTimeMs: number }[] = [];
    let applied = 0;
    let failed = 0;
    let stopIndex: number | undefined;
    let finalActivePreset = validatedEntries[0].input.preset_number;

    for (let i = 0; i < validatedEntries.length; i++) {
      const { input, ops } = validatedEntries[i];
      const entryStart = Date.now();
      try {
        const result = await runApplyPresetAtOps(conn, ops);
        finalActivePreset = input.preset_number;
        if (!result.ok) {
          failed++;
          perEntryResults.push({
            preset_number: input.preset_number,
            status: 'error',
            error: result.lastNack
              ? `${result.lastNack.summary} → result=0x${result.lastNack.resultCode.toString(16)}`
              : 'no STORE_PRESET ACK arrived',
            wallTimeMs: Date.now() - entryStart,
          });
          if (onError === 'stop') {
            stopIndex = i;
            break;
          }
          continue;
        }
        applied++;
        perEntryResults.push({
          preset_number: input.preset_number,
          status: 'ok',
          wallTimeMs: Date.now() - entryStart,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed++;
        perEntryResults.push({
          preset_number: input.preset_number,
          status: 'error',
          error: msg,
          wallTimeMs: Date.now() - entryStart,
        });
        if (onError === 'stop') {
          stopIndex = i;
          break;
        }
      }
    }

    const totalWallTimeMs = Date.now() - startMs;
    const remaining = stopIndex !== undefined
      ? validatedEntries.slice(stopIndex + 1).map((e) => e.input.preset_number)
      : [];

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: failed === 0,
          total: validatedEntries.length,
          applied,
          failed,
          remaining,
          results: perEntryResults,
          totalWallTimeMs,
          finalActivePreset,
        }, null, 2),
      }],
    };
  });

  // axefx2_lookup_lineage ----------------------------------------------------

  server.registerTool('axefx2_lookup_lineage', {
    description: [
      'Look up Fractal Audio\'s authored lineage info for an Axe-Fx II model —',
      'what real hardware it\'s modeled after, Fractal\'s own description of',
      'the algorithm, and forum quotes from the developer. Data is keyed off',
      'the Axe-Fx II enum tables (UPPERCASE display names like "59 BASSGUY"',
      'or "PLEXI 100W HI 1") and inherits the prose from the shared Fractal',
      'wiki — same source as `am4_lookup_lineage`.',
      '',
      'Status: 🟢 hardware-validated on Q8.02 via HW-084 (2026-05-10) —',
      'all 5 query classes (direct / abbrev-expand / reverse / structured /',
      'reverb-swap) return non-empty ranked results, `matchVia` honestly',
      'surfaced. Known data-quality issues tracked in BACKLOG: forum quotes',
      'are inherited across sibling enum entries in some records (so a',
      'Bassman record may carry Plexi-related quotes — flag the user and',
      'lean on `basedOn` rather than reciting prose), and some enum entries',
      'have no lineage record at all (USA Mark series, Recto Org variants).',
      'Each record carries a `matchVia` field that names the lookup-path used to',
      'find the wiki entry — NOT a confidence rating on the data itself.',
      'When summarizing to the user, do NOT hedge on `direct` /',
      '`abbrev-expand` / `reverb-swap` matches — those are known-good',
      'display-string conventions, the data is reliable. Hedging on them',
      'makes the tool look unreliable when it is not. Hedge only when the',
      'matchVia is `prefix` or `unmatched`, or when the record\'s `flags`',
      'array surfaces a substantive data-quality issue (cross-attributed',
      'forum quotes, missing wiki entry, etc.).',
      '',
      'matchVia values:',
      '  - `direct`         — exact name match against the wiki entry.',
      '                       Same wiki record, same model. Trust the data.',
      '  - `abbrev-expand`  — Axe-Fx II truncates words to fit its 16-char',
      '                       display ("NRML"→"NORMAL", "VIB"→"VIBRATO",',
      '                       "MDRN"→"MODERN", "OR"→"ORANGE"). Same model,',
      '                       different label. Trust the data — a Bassguy',
      '                       Normal IS a Bassguy NRML.',
      '  - `reverb-swap`    — reverb display labels invert wiki word order',
      '                       ("MEDIUM HALL" matches wiki "Hall, Medium").',
      '                       Same algorithm, different label. Trust the data.',
      '  - `prefix`         — Axe-Fx II uses a family-head abbreviation that',
      '                       PREFIXES a more specific wiki entry ("USA IIC+"',
      '                       could match "USA Mark IIC+ Lead Bright" or',
      '                       "USA Mark IIC+ Rhythm"). Family-level lineage',
      '                       (manufacturer, era, basic topology) is solid.',
      '                       Specifics (which channel, which mod) are',
      '                       approximate — surface that to the user.',
      '  - `unmatched`      — no wiki record found. The model name is real',
      '                       (it\'s in the firmware), but lineage prose is',
      '                       not yet sourced. Tell the user the model exists',
      '                       but lineage data isn\'t available.',
      '',
      'Substantive flags to surface to the user when present:',
      '  - `INHERITED: lineage from sibling "X"` — basedOn / tubes / cab',
      '    were back-filled from a sibling amp record. For amp-family',
      '    siblings (Plexi 50W Normal/High/Jumped) this is fine — the same',
      '    real amp at slightly different settings. For non-sibling',
      '    inheritance, basedOn might be wrong; check the sibling name vs',
      '    the model name and flag if they\'re from different families.',
      '  - Forum quotes that mention a different amp family than the record',
      '    name (e.g. Plexi quotes on a Bassguy record) — there is a known',
      '    AM4 wiki-parser bug where cross-cutting "Regarding the following',
      '    X models" prose attaches to the prior entry. If the quotes name a',
      '    different amp than the record, FILTER them — don\'t surface them',
      '    as authoritative. Tracked for fix in extract-lineage.ts.',
      '',
      'Three call shapes (exactly one required):',
      '  (a) forward — { block_type, name }: return the record matching that',
      '      Axe-Fx II display name (case-insensitive substring match against',
      '      axefx2Name, am4Name, or wikiName).',
      '  (b) reverse by real_gear — { block_type, real_gear }: substring',
      '      search across basedOn / description / forum quotes. Returns the',
      '      top 10 ranked matches. Use for fuzzy queries — including artist',
      '      references ("Cantrell tone", "Knopfler clean") which match the',
      '      artist names in Fractal\'s description prose.',
      '  (c) structured filter — { block_type, manufacturer?, model? }:',
      '      exact-match against basedOn\'s structured fields. Most precise',
      '      for queries like "MXR phaser" (manufacturer="MXR") or "1176"',
      '      (model="1176"). Multiple structured fields AND together.',
      '',
      'Block coverage: amp (259 enum / 196 matched), drive (36 / 34),',
      'reverb (43 / 25), delay (18 / 17). Compressor / chorus / flanger /',
      'phaser / wah lineage exists for AM4 but isn\'t yet re-keyed for the',
      'Axe-Fx II — defer to `am4_lookup_lineage` for those blocks until',
      'the extractor covers them.',
      '',
      'Response text is designed to be read by Claude, not shown verbatim',
      'to the user — pull out the axefx2Name + match status and summarize',
      'the lineage in your own words.',
    ].join(' '),
    inputSchema: {
      block_type: z.enum(AXE_FX_II_LINEAGE_BLOCKS).describe(
        'Which block\'s lineage to query. Currently amp / drive / reverb / delay (cab is post-MVP; compressor / phaser / chorus / flanger / wah are AM4-only for now).',
      ),
      name: z.string().optional().describe(
        'Axe-Fx II display name for forward lookup. Case-insensitive. Examples: "59 BASSGUY", "PLEXI 100W HI 1", "RECTO2 RED MDRN", "MEDIUM HALL", "PI FUZZ".',
      ),
      real_gear: z.string().optional().describe(
        'Real-hardware query for fuzzy reverse search (e.g. "1176", "Tube Screamer", "EMT 140", "Fender Twin"). Returns the top Axe-Fx II models whose lineage text mentions the term.',
      ),
      manufacturer: z.string().optional().describe(
        'Exact manufacturer filter (case-insensitive): "Fender", "Marshall", "Mesa", "MXR", "Ibanez", "TC Electronic". Use alone or combined with model.',
      ),
      model: z.string().optional().describe(
        'Exact model identifier filter (case-insensitive): "TS-9", "LA-2A", "5F1", "1176", "2290". Use alone or combined with manufacturer.',
      ),
      include_quotes: z.boolean().optional().describe(
        'Whether to include Fractal Audio forum quotes in the response. Default true. Pass false for a terser response when you only need the description / basedOn summary.',
      ),
    },
  }, async ({ block_type, name, real_gear, manufacturer, model, include_quotes }) => {
    const withQuotes = include_quotes ?? true;
    let result: AxeFxIILineageLookupResult;
    try {
      result = runAxeFxIILineageLookup({ block_type, name, real_gear, manufacturer, model });
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }

    if (!result.found) {
      if (result.shape === 'structured') {
        const filter = [
          manufacturer && `manufacturer="${manufacturer}"`,
          model && `model="${model}"`,
        ].filter(Boolean).join(', ');
        return {
          content: [{
            type: 'text',
            text:
              `No ${block_type} records match ${filter}. ${result.totalScanned} records scanned. ` +
              `Try a fuzzy search with real_gear if you're unsure of the exact brand/model spelling.`,
          }],
        };
      }
      if (result.shape === 'forward') {
        return {
          content: [{
            type: 'text',
            text:
              `No ${block_type} lineage record matches "${name}". The Axe-Fx II ${block_type}-lineage ` +
              `catalog has ${result.totalScanned} records; try a reverse search with real_gear if you ` +
              `know the real hardware but not the exact Axe-Fx II display name.`,
          }],
        };
      }
      // reverse miss
      return {
        content: [{
          type: 'text',
          text:
            `No ${block_type} records mention "${real_gear}". Searched across ${result.totalScanned} records. ` +
            `Try a different spelling (e.g. "TS9" vs "Tube Screamer", "EVH" vs "5150") or widen the query.`,
        }],
      };
    }

    if (result.shape === 'forward') {
      return {
        content: [{
          type: 'text',
          text: formatAxeFxIILineageRecord(result.hits[0].record, withQuotes),
        }],
      };
    }

    if (result.shape === 'structured') {
      const blocks = result.hits.map(
        (h) => `── ${h.axefx2Name} ──\n${formatAxeFxIILineageRecord(h.record, withQuotes, 3)}`,
      );
      return {
        content: [{
          type: 'text',
          text: `${result.hits.length} ${block_type} matches${result.hits.length > 10 ? ' (showing top 10)' : ''}:\n\n${blocks.join('\n\n')}`,
        }],
      };
    }

    // reverse hit
    const blocks = result.hits.map(
      (h) => `── ${h.axefx2Name} (score ${h.score}) ──\n${formatAxeFxIILineageRecord(h.record, withQuotes, 3)}`,
    );
    return {
      content: [{
        type: 'text',
        text:
          `Top ${result.hits.length} ${block_type} matches for "${real_gear}":\n\n${blocks.join('\n\n')}`,
      }],
    };
  });

  // axefx2_reconnect_midi ----------------------------------------------------

  server.registerTool('axefx2_reconnect_midi', {
    description: [
      'Use this tool to drop the cached Axe-Fx II MIDI handle and force a',
      'fresh port-open on the next axefx2_* tool call. Useful when the user',
      'plugged the device in mid-session and the cached "not connected"',
      'error keeps masking the now-working port, or when an earlier tool',
      'call timed out (USB handle may have gone stale).',
      '',
      'This does NOT affect the AM4 connection (use reconnect_midi for that)',
      'or the Hydrasynth connection (hydra_reconnect_midi).',
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const result = resetAxeFxIIConnection();
    const lines = [
      `Axe-Fx II connection cache cleared.`,
      `  Was connected: ${result.wasConnected ? 'yes' : 'no'}`,
    ];
    if (result.previousError) {
      lines.push(`  Previous cached error: ${result.previousError}`);
    }
    lines.push(
      '',
      'The next axefx2_* tool call will re-attempt connectAxeFxII().',
      'Run list_midi_ports if you want to confirm the OS is currently',
      'exposing an Axe-Fx II port before retrying.',
    );
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  });

}

/**
 * Startup-banner helper — describes whether an Axe-Fx II output port is
 * visible right now, without opening it. Mirrors the AM4 + Hydrasynth
 * port-scan banners in `src/server/index.ts:main()`.
 */
export function describeAxeFxIIPortStatus(): string {
  try {
    const outputs = listAxeFxIIOutputs();
    const axe = outputs.find((p) => p.looksLikeAxeFxII);
    if (axe) return `Axe-Fx II detected at output [${axe.index}]: "${axe.name}"`;
    if (outputs.length === 0) return 'no MIDI outputs visible';
    return `Axe-Fx II not visible among ${outputs.length} output(s)`;
  } catch (err) {
    return `port scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
