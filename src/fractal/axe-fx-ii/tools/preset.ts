/**
 * Axe-Fx II preset-application tools — single preset (working buffer),
 * single preset at a target slot (atomic switch + apply + save), and
 * setlist (N-entry batch). All three share the executor from
 * ./applyExecutor.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { type AxeFxIIBlock } from '@/fractal/axe-fx-ii/blockTypes.js';
import {
  buildGetGridLayout,
  buildSetBlockBypass as buildSetBlockBypassEnvelope,
  buildSetBlockChannel,
  buildSetBlockParameterValue,
  buildSetGridCell,
  buildSetPresetName,
  buildSetSceneNumber,
  buildStorePreset,
  buildSwitchPreset,
  displayToWire,
  isGetGridLayoutResponse,
  isSetGridCellResponse,
  isStorePresetResponse,
  parseGetGridLayoutResponse,
  parseSetGridCellResponse,
  parseStorePresetResponse,
  type AxeFxIIChannel,
} from '@/fractal/axe-fx-ii/setParam.js';

import { buildApplyPresetAtOps, runApplyPresetAtOps, type ApplyPresetAtInput, type ApplyPresetAtOp } from './applyExecutor.js';
import {
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  findBlock,
  findParam,
} from './shared.js';

export function registerAxeFxIIPresetTools(server: McpServer): void {


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

}
