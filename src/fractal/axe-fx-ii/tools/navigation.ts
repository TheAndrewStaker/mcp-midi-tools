/**
 * Axe-Fx II navigation tools — preset / scene / channel reads and
 * writes, plus name handling, bulk scan, and the standalone save tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  buildGetBlockChannel,
  buildGetPresetName,
  buildGetPresetNumber,
  buildSetBlockChannel,
  buildSetPresetName,
  buildSetSceneNumber,
  buildStorePreset,
  buildSwitchPreset,
  isGetBlockChannelResponse,
  isGetPresetNameResponse,
  isGetPresetNumberResponse,
  isSceneNumberResponse,
  isStorePresetResponse,
  parseGetBlockChannelResponse,
  parseGetPresetNameResponse,
  parseGetPresetNumberResponse,
  parseSceneNumberResponse,
  parseStorePresetResponse,
  type AxeFxIIChannel,
} from '@/fractal/axe-fx-ii/setParam.js';

import {
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  findBlock,
  toHex,
} from './shared.js';

export function registerAxeFxIINavigationTools(server: McpServer): void {


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

}
