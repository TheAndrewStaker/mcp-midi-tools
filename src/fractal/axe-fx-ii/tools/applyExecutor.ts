/**
 * Axe-Fx II apply-preset executor — builds the wire-op sequence for a
 * single preset entry and runs it against a live connection. Shared by
 * axefx2_apply_preset, axefx2_apply_preset_at, and axefx2_apply_setlist.
 */

import type { AxeFxIIBlock } from '@/fractal/axe-fx-ii/blockTypes.js';
import type { AxeFxIIConnection } from '@/fractal/axe-fx-ii/midi.js';
import {
  buildSetBlockBypass as buildSetBlockBypassEnvelope,
  buildSetBlockChannel,
  buildSetBlockParameterValue,
  buildSetGridCell,
  buildSetPresetName,
  buildSetSceneNumber,
  buildStorePreset,
  buildSwitchPreset,
  displayToWire,
  isSetGridCellResponse,
  isStorePresetResponse,
  parseSetGridCellResponse,
  parseStorePresetResponse,
  type AxeFxIIChannel,
} from '@/fractal/axe-fx-ii/setParam.js';

import { GET_RESPONSE_TIMEOUT_MS, findBlock, findParam } from './shared.js';

// -- apply_preset_at + apply_setlist shared helpers ------------------------

/**
 * Shape of a single preset entry — used by both axefx2_apply_preset_at
 * (one entry at a time) and axefx2_apply_setlist (array of entries).
 * Mirrors the inputSchema of apply_preset_at minus the zod wrappers.
 */
export interface ApplyPresetAtInput {
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

export interface ApplyPresetAtOp {
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
export function buildApplyPresetAtOps(input: ApplyPresetAtInput): ApplyPresetAtOp[] {
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

export interface RunOpsResult {
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
export async function runApplyPresetAtOps(
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
