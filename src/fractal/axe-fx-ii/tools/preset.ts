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
  buildGetPresetNumber,
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
  isGetPresetNumberResponse,
  isSetGridCellResponse,
  isStorePresetResponse,
  parseGetGridLayoutResponse,
  parseGetPresetNumberResponse,
  parseSetGridCellResponse,
  parseStorePresetResponse,
  type AxeFxIIChannel,
} from '@/fractal/axe-fx-ii/setParam.js';

import { buildApplyPresetAtOps, buildApplyPresetOps, runApplyPresetAtOps, type ApplyPresetAtInput, type ApplyPresetAtOp, type ApplyPresetInput } from './applyExecutor.js';
import { renderGridSummary } from './gridRender.js';
import {
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ON_EDITED_DESCRIPTION,
  ON_EDITED_SCHEMA,
  ensureConn,
  findBlock,
  findParam,
  guardActiveBufferOrSave,
  type OnEditedMode,
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
      'slot, clear row 2 grid, place blocks + shunts on row 2, explicitly',
      'cable every adjacent pair (fn 0x06 SET_CELL_ROUTING), set per-',
      'block params, optional scene + name, save via STORE_PRESET',
      '(function 0x1D). Audio flows end-to-end on a fresh-empty slot —',
      'verified Session 71 (2026-05-13) on Q8.02 XL+.',
      '',
      'WHEN TO USE: when the user has a clear single-preset spec ready —',
      '"Build me a clean Vox tone with light delay and reverb, save to',
      'slot 700, name it \'Vox Light\'." For setlist-style multi-preset',
      'batches, prefer `axefx2_apply_setlist` which iterates this tool.',
      '',
      'GRID LAYOUT — row-2 linear chain with shunt extension:',
      '  Content blocks are placed on row 2 in declared order: blocks[0]',
      '  → col 1, blocks[1] → col 2, ..., blocks[N-1] → col N. Cells',
      '  beyond the chain (cols N+1..12) get unique SHUNT instances',
      '  (blockId 200..(199 + (12-N))). Every adjacent pair from col',
      '  2..12 is then explicitly cabled — each cell\'s routing mask is',
      '  set to 0x02 ("feed from row 2 of prev col"). The chain reaches',
      '  col 12, and the device\'s OUTPUT picks up the signal there.',
      '  Rows 1, 3, 4 are cleared.',
      '',
      'SAVE AUTHORIZATION REQUIRED — DESTRUCTIVE:',
      '  This tool calls STORE_PRESET at the end, which overwrites the',
      '  target slot. The tool refuses by default; you MUST pass',
      '  `save_authorized: true` AND that should only happen when the',
      '  user used save-intent language (save/store/keep/put-on/persist).',
      '  For "build a tone" / "design a preset" without save language,',
      '  use `axefx2_apply_preset` (working-buffer-only) instead, let',
      '  the user audition, then ASK before calling this tool with',
      '  save_authorized: true. For unknown target slots, run',
      '  `axefx2_scan_preset_range` first to surface what would be lost.',
      '',
      'CHANNELS: Axe-Fx II has 2 channels per block (X / Y), not 4.',
      'Pass `channel: "X"` or `channel: "Y"` per block to switch before',
      'writing its params. Both channels in one call: not yet supported',
      '(use `axefx2_apply_preset` separately if needed).',
      '',
      'DISPLAY-FIRST PARAMS: pass display values for calibrated params',
      '(`input_drive: 5.0`, `mix: 30`, `low_cut: 200`). Tool auto-detects',
      'display vs wire-int mode same as `axefx2_set_param`.',
      '',
      'AMP PARAM NAMES: the Axe-Fx II amp block uses the wire names',
      '`input_drive` (the gain knob, 0..10) and `master_volume` (master,',
      '0..10) — NOT `gain` and `master` (those are AM4 names). The',
      'common English aliases `gain` / `master` / `mid` ARE accepted',
      'as shortcuts (auto-resolved to input_drive / master_volume /',
      'middle), but prefer the canonical names in tool calls — they',
      'render correctly in error messages and match `axefx2_list_params`',
      'output. Other amp params: bass, middle, treble, presence,',
      'depth, sag, bias, master_volume, effect_type (the amp model).',
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
      slot: z.number().int().min(1).max(16384).describe(
        'Target user-preset SLOT to save the built preset into (1-indexed display slot, 1..16384 — matches the device front panel and AxeEdit). DESTRUCTIVE — overwrites whatever is at this slot.',
      ),
      blocks: z.array(z.object({
        block: z.union([z.string(), z.number()]).describe(
          'Block to place — display name ("Amp 1") or numeric effectId. Order matters: blocks[0] lands at col 1, blocks[1] at col 2, etc.',
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
        'Ordered list of blocks for the linear chain. Up to 12 blocks (1 per column). Each block lands at row 2, col = (index + 1). The executor wipes ALL 48 grid cells before placement, so the previous occupant\'s blocks are NOT preserved.',
      ),
      scene: z.number().int().min(0).max(7).optional().describe(
        'Optional scene 0..7 to switch to before writing block params (display: scene + 1). Single-scene shortcut — for multi-scene authoring use `scenes` instead.',
      ),
      scenes: z.array(z.object({
        index: z.number().int().min(1).max(8).describe(
          'Scene number 1..8 (matches Axe-Fx II front-panel display and AxeEdit). 1-indexed.',
        ),
        bypass: z.record(z.string(), z.boolean()).optional().describe(
          'Map of block-slug → bypass flag for this scene. true = silence the block on this scene (block stays placed, just passes input through); false = active. Example: { drive: true, reverb: false }.',
        ),
        channels: z.record(z.string(), z.enum(['X', 'Y'])).optional().describe(
          'Map of block-slug → channel letter (X / Y) for this scene. Axe-Fx II has 2 channels per block (X/Y), not 4 like AM4. Example: { amp: "Y" } makes this scene use amp\'s channel Y.',
        ),
      })).max(8).optional().describe(
        'Per-scene authoring (HW-106 closure, Session 68). Walks each scene\'s bypass + channel state by switching to that scene before writing — matches Fractal\'s family-wide constraint that writes always target the active scene. Use this to build a setlist preset with distinct verse/chorus/solo tones in a single call. Scenes you DON\'T list keep the preset\'s default state (no overrides). Scene names are NOT yet supported — the SET envelope for scene names isn\'t decoded in any OSS corpus for Axe-Fx II.',
      ),
      landingScene: z.number().int().min(1).max(8).optional().describe(
        'Scene the device lands on AFTER the build (1..8, display). Default 1 — user can immediately audition the song\'s opening scene. Override for previewing a specific scene-section (e.g. land on solo scene for an immediate lead test).',
      ),
      name: z.string().max(32).optional().describe(
        'Optional preset name (≤32 ASCII-printable chars). Written before save.',
      ),
      save_authorized: z.boolean().optional().describe(
        'EXPLICIT save authorization. Default false — this tool is DESTRUCTIVE (overwrites the target slot) and requires the user to have used save/store/keep/put-on language about the target. If the user said "build a tone for X" without naming a save action, use axefx2_apply_preset (working-buffer-only) FIRST so they can audition, then ASK before calling this tool with save_authorized: true. "Build a setlist" / "build presets in slots 700-702" / "save this as Glassy" all count as authorized; "build a clean tone at slot 666" without save/store/keep language does NOT.',
      ),
      on_active_preset_edited: ON_EDITED_SCHEMA.describe(ON_EDITED_DESCRIPTION),
    },
  }, async ({ slot, blocks, scene, scenes, landingScene, name, save_authorized, on_active_preset_edited }) => {
    const presetNumber = slot - 1;

    // Save-intent guard. apply_preset_at is destructive (it STORE_PRESETs
    // at the end), and the user's "build a tone at slot N" language is
    // ambiguous about save intent — "at slot N" names a TARGET, not an
    // AUTHORIZATION. Per CLAUDE.md's existing AM4 rule: "Do NOT auto-save
    // after apply_preset — saves require an explicit save phrase from the
    // user." This guard enforces the same discipline on Axe-Fx II.
    if (save_authorized !== true) {
      return {
        content: [{
          type: 'text',
          text:
            `REFUSING TO SAVE: this tool persists the built preset to slot ${slot}, which overwrites whatever is there. ` +
            `The default policy refuses unless save_authorized: true is explicitly passed.\n` +
            `\n` +
            `If the user said something like "build a clean tone" / "design a tone for X" without naming a save action (save, store, keep, put on, persist to slot N), the right tool is axefx2_apply_preset (WORKING-BUFFER-ONLY) — let them audition the tone first, then ASK "want me to save it to slot ${slot}?" before calling axefx2_apply_preset_at again with save_authorized: true.\n` +
            `\n` +
            `User phrases that DO authorize saving here: "save this to slot N", "store as N", "build and save", "put it on N", "keep it at N", or "build a setlist into slots A/B/C" (multi-preset intent implies save).\n` +
            `\n` +
            `User phrases that DO NOT authorize saving (use apply_preset first): "build a tone for X", "design a clean preset", "make me a Marshall sound", "build a tone at slot 666" (the "at slot 666" names a target but doesn't authorize a save — the user might just want to audition there).`,
        }],
        isError: true,
      };
    }

    // Edited-buffer guard. This tool will switch_preset to the target,
    // which discards the active preset's unsaved edits. Refuse / save-
    // first / discard per the caller's mode.
    const mode: OnEditedMode = on_active_preset_edited ?? 'warn';
    const guard = await guardActiveBufferOrSave(mode);
    if (!guard.proceed) {
      return {
        content: [{ type: 'text', text: guard.warningText ?? 'navigation refused' }],
        isError: true,
      };
    }

    const input: ApplyPresetAtInput = {
      preset_number: presetNumber,
      blocks: blocks as ApplyPresetAtInput['blocks'],
      scene,
      scenes: scenes as ApplyPresetAtInput['scenes'],
      landingScene,
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

    const savedLine = guard.savedDetail ? `${guard.savedDetail}\n\n` : '';
    const header =
      savedLine +
      `axefx2_apply_preset_at: built preset → display slot ${slot} ` +
      `(wire ${presetNumber})` +
      (name !== undefined ? ` named "${name}"` : '') +
      ` in ${result.elapsedMs}ms (${ops.length} wire ops, ${result.totalBytes} bytes, ${result.acks} ACKs).`;

    const failureNote = result.lastNack
      ? `\n\nNOTE: at least one op got a non-OK ACK. Last NACK: ` +
        `${result.lastNack.summary} → result=0x${result.lastNack.resultCode.toString(16)}. ` +
        `Verify the final preset state on the device.`
      : '';

    const verifyHint =
      `\n\nVerify with axefx2_switch_preset({ slot: ${slot} }) ` +
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
      'preset cycles through each target as it\'s loaded, written, and',
      'saved. The whole 3-preset batch takes ~2.5 seconds, so the front-',
      'panel cycle is brief but visible. Post-batch the device lands on',
      'the LAST preset built (default) — the user can audition that',
      'preset immediately. Pass restore_active: true to instead bounce',
      'back to whichever preset was active before the batch started.',
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
        slot: z.number().int().min(1).max(16384).describe(
          'Target user-preset SLOT (1-indexed display slot, 1..16384, matches device front panel + AxeEdit).',
        ),
        blocks: z.array(z.object({
          block: z.union([z.string(), z.number()]),
          bypass: z.boolean().optional(),
          channel: z.enum(['X', 'Y']).optional(),
          params: z.record(z.string(), z.number()).optional(),
        })).min(1).max(12),
        scene: z.number().int().min(0).max(7).optional(),
        scenes: z.array(z.object({
          index: z.number().int().min(1).max(8),
          bypass: z.record(z.string(), z.boolean()).optional(),
          channels: z.record(z.string(), z.enum(['X', 'Y'])).optional(),
        })).max(8).optional(),
        landingScene: z.number().int().min(1).max(8).optional(),
        name: z.string().max(32).optional(),
      })).min(1).max(26).describe(
        '1..26 setlist entries. Each has the same shape as axefx2_apply_preset_at\'s input. slots must be unique within the batch.',
      ),
      on_error: z.enum(['stop', 'continue']).optional().describe(
        'Failure handling. "stop" (default) halts on first error; "continue" logs the error and proceeds.',
      ),
      dry_run: z.boolean().optional().describe(
        'Validate every entry without sending any wire bytes. Returns { ok, total, validated, message }. Default false.',
      ),
      restore_active: z.boolean().optional().describe(
        'After the batch completes, switch back to whichever preset was active BEFORE the batch started. Default FALSE — the device is left on the last preset built so the user can audition it immediately. Pass true only when the user explicitly says "leave me where I was" or the agent is running a batch as a side-quest from a different conversational task.',
      ),
      on_active_preset_edited: ON_EDITED_SCHEMA.describe(ON_EDITED_DESCRIPTION),
    },
  }, async ({ presets, on_error, dry_run, restore_active, on_active_preset_edited }) => {
    const onError: 'stop' | 'continue' = on_error ?? 'stop';
    const dryRun = dry_run ?? false;
    const restoreActive = restore_active ?? false;
    const editedMode: OnEditedMode = on_active_preset_edited ?? 'warn';

    // Validation pass.
    const seenSlots = new Set<number>();
    const validatedEntries: { input: ApplyPresetAtInput; ops: ApplyPresetAtOp[]; slot: number }[] = [];
    for (let i = 0; i < presets.length; i++) {
      const entry = presets[i];
      if (seenSlots.has(entry.slot)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              step: 'validate',
              error: `presets[${i}]: slot ${entry.slot} appears more than once in the batch; each slot may appear at most once per call`,
            }, null, 2),
          }],
          isError: true,
        };
      }
      seenSlots.add(entry.slot);
      const input: ApplyPresetAtInput = {
        preset_number: entry.slot - 1,
        blocks: entry.blocks as ApplyPresetAtInput['blocks'],
        scene: entry.scene,
        scenes: entry.scenes as ApplyPresetAtInput['scenes'],
        landingScene: entry.landingScene,
        name: entry.name,
      };
      try {
        const ops = buildApplyPresetAtOps(input);
        validatedEntries.push({ input, ops, slot: entry.slot });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              step: 'validate',
              error: `presets[${i}] (slot ${entry.slot}): ${reason}`,
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

    // Edited-buffer guard — apply_setlist will switch presets repeatedly
    // through the batch, which discards the active preset's unsaved edits
    // on the very first switch. Refuse / save-first / discard per the
    // caller's mode BEFORE we start any wire activity.
    const editedGuard = await guardActiveBufferOrSave(editedMode);
    if (!editedGuard.proceed) {
      return {
        content: [{ type: 'text', text: editedGuard.warningText ?? 'navigation refused' }],
        isError: true,
      };
    }

    // Live execution.
    const conn = ensureConn();
    const startMs = Date.now();
    const perEntryResults: { slot: number; status: 'ok' | 'error'; error?: string; wallTimeMs: number }[] = [];
    let applied = 0;
    let failed = 0;
    let stopIndex: number | undefined;
    let finalActiveSlot = validatedEntries[0].slot;

    // Capture the originally-active preset so we can restore it at the
    // end. The batch loads/saves into each target slot, which cycles the
    // working buffer — the founder asked to land on whatever preset was
    // active before the batch started.
    let originalActiveWire: number | undefined;
    if (restoreActive) {
      try {
        const reqBytes = buildGetPresetNumber();
        const respP = conn.receiveSysExMatching(
          isGetPresetNumberResponse,
          GET_RESPONSE_TIMEOUT_MS,
        );
        conn.send(reqBytes);
        const resp = await respP;
        originalActiveWire = parseGetPresetNumberResponse(resp).presetNumber;
      } catch {
        originalActiveWire = undefined; // best-effort — proceed without restore
      }
    }

    for (let i = 0; i < validatedEntries.length; i++) {
      const { ops, slot } = validatedEntries[i];
      const entryStart = Date.now();
      try {
        const result = await runApplyPresetAtOps(conn, ops);
        finalActiveSlot = slot;
        if (!result.ok) {
          failed++;
          perEntryResults.push({
            slot,
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
          slot,
          status: 'ok',
          wallTimeMs: Date.now() - entryStart,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed++;
        perEntryResults.push({
          slot,
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

    // Restore active preset (best-effort) — done OUTSIDE the per-entry
    // loop so a mid-batch failure still tries to bounce the device back.
    let restoreNote: string | undefined;
    if (restoreActive && originalActiveWire !== undefined) {
      try {
        conn.send(buildSwitchPreset(originalActiveWire));
        finalActiveSlot = originalActiveWire + 1;
        restoreNote = `Restored active preset to display slot ${originalActiveWire + 1} (wire ${originalActiveWire}) after batch.`;
      } catch (err) {
        restoreNote = `WARNING: failed to restore active preset: ${err instanceof Error ? err.message : String(err)}.`;
      }
    }

    const totalWallTimeMs = Date.now() - startMs;
    const remaining = stopIndex !== undefined
      ? validatedEntries.slice(stopIndex + 1).map((e) => e.slot)
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
          finalActiveSlot,
          restoreNote,
          savedActiveBeforeBatch: editedGuard.savedDetail,
        }, null, 2),
      }],
    };
  });


  server.registerTool('axefx2_test_apply', {
    description: [
      'Build a preset on the WORKING BUFFER and immediately verify its',
      'wire-level chain integrity in one tool call. Non-destructive: no',
      'STORE_PRESET, no save-authorization needed — switching presets',
      'afterward reverts the buffer.',
      '',
      'WHEN TO USE: as the "did the apply actually land correctly?"',
      'check before asking the user to plug in their guitar. Replaces',
      'the three-call sequence (apply → switch → get_grid_layout) with',
      'one round-trip that returns a structured pass/fail verdict the',
      'agent can act on immediately.',
      '',
      'WHAT IT DOES:',
      '  1. Builds + runs the same op sequence as `axefx2_apply_preset`',
      '     (working buffer): clear non-chain cells, place blocks +',
      '     shunts on row 2, explicitly cable every adjacent pair from',
      '     col 2..12, write per-block params, optional scene + name.',
      '  2. Reads `axefx2_get_grid_layout` against the working buffer.',
      '  3. Returns JSON with: `ok` (boolean), `chainBreaks` (list of',
      '     cells past col 1 with routing_mask=0), `gridSummary` (the',
      '     same human-readable summary `axefx2_get_grid_layout`',
      '     returns), `applyDigest` (apply outcome line + first/last',
      '     few op summaries), `elapsedMs`, `ackCount`.',
      '',
      'PASS CRITERION: every cell in the chain past col 1 must have',
      'routing_mask = 0x02 (or, more generally, a non-zero mask). A',
      'failed test means signal will not flow end-to-end — the agent',
      'should surface the failure to the user rather than claim audio',
      'will work.',
      '',
      'INPUT shape mirrors `axefx2_apply_preset` (blocks + optional',
      'scene + name). No `slot` parameter — this tool always operates',
      'on the working buffer. To persist a verified build, follow up',
      'with `axefx2_save_preset({ slot })` after this returns ok=true.',
      '',
      'PERFORMANCE: ~1.5-2.5 s for a 4-6 block chain (same op count',
      'as apply_preset, plus one extra grid-read round-trip ~50ms).',
    ].join('\n'),
    inputSchema: {
      blocks: z.array(z.object({
        block: z.union([z.string(), z.number()]).describe(
          'Block to place — display name ("Amp 1") or numeric effectId.',
        ),
        bypass: z.boolean().optional(),
        channel: z.enum(['X', 'Y']).optional(),
        params: z.record(z.string(), z.number()).optional(),
      })).min(1).max(12).describe(
        'Ordered list of blocks for the linear chain. Up to 12.',
      ),
      scene: z.number().int().min(0).max(7).optional(),
      name: z.string().max(32).optional(),
      on_active_preset_edited: ON_EDITED_SCHEMA.describe(ON_EDITED_DESCRIPTION),
    },
  }, async ({ blocks, scene, name, on_active_preset_edited }) => {
    // Edited-buffer guard. apply_preset (working-buffer-only) doesn't
    // navigate slots, but it WILL overwrite the active preset's working
    // buffer. Honor the same gate as axefx2_apply_preset.
    const mode: OnEditedMode = on_active_preset_edited ?? 'warn';
    const guard = await guardActiveBufferOrSave(mode);
    if (!guard.proceed) {
      return {
        content: [{ type: 'text', text: guard.warningText ?? 'navigation refused' }],
        isError: true,
      };
    }

    const input: ApplyPresetInput = {
      blocks: blocks as ApplyPresetInput['blocks'],
      scene,
      name,
    };

    let ops: ApplyPresetAtOp[];
    try {
      ops = buildApplyPresetOps(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`axefx2_test_apply: ${msg}`);
    }

    const conn = ensureConn();
    const applyResult = await runApplyPresetAtOps(conn, ops);

    // Read grid + parse for chain breaks.
    const gridRespPromise = conn.receiveSysExMatching(
      isGetGridLayoutResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    conn.send(buildGetGridLayout());
    let gridSummary: string;
    let chainBreaks: Array<{ row: number; col: number; blockId: number }> = [];
    try {
      const gridBytes = await gridRespPromise;
      const cells = parseGetGridLayoutResponse(gridBytes);
      gridSummary = renderGridSummary(cells);
      // Inline chain-break detection so the structured result doesn't
      // depend on regex-parsing the summary text. Mirrors the logic
      // gridRender.ts uses for the warning surface.
      for (const c of cells) {
        if (c.blockId === 0) continue;
        if (c.row !== 2) continue; // chain-break check is row-2 only for v0.1
        if (c.col > 1 && c.routingFlags === 0) {
          chainBreaks.push({ row: c.row, col: c.col, blockId: c.blockId });
        }
      }
    } catch (err) {
      gridSummary = `(grid read failed: ${err instanceof Error ? err.message : String(err)})`;
      chainBreaks = [];
    }

    const ok = applyResult.ok && chainBreaks.length === 0;
    const applyDigest = [
      applyResult.summaries[0] ?? '(no apply summary)',
      ...applyResult.summaries.slice(-3),
    ];

    const verdict = ok
      ? `PASS — wire-level chain reads clean. Working buffer holds an audible preset (audition before saving with axefx2_save_preset).`
      : applyResult.lastNack
        ? `FAIL — apply op got a non-OK ack: "${applyResult.lastNack.summary}" (resultCode=0x${applyResult.lastNack.resultCode.toString(16)}). Chain may also have breaks.`
        : `FAIL — chain has ${chainBreaks.length} broken cable${chainBreaks.length === 1 ? '' : 's'}. Signal won't flow past the first break.`;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok,
          verdict,
          chainBreaks,
          gridSummary,
          applyDigest,
          elapsedMs: applyResult.elapsedMs,
          ackCount: applyResult.acks,
          opsTotal: ops.length,
          bytesTotal: applyResult.totalBytes,
          lastNack: applyResult.lastNack,
        }, null, 2),
      }],
    };
  });

}
