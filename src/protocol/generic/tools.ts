/**
 * BK-051 unified MCP tool surface — chunk 1 of Session B.
 *
 * Four device-agnostic tools that dispatch through
 * `src/protocol/generic/dispatcher.ts`:
 *   - `describe_device(port)` — capabilities + canonical terms.
 *   - `list_params(port, block?, name?)` — schema discovery.
 *     When `name` is supplied and the param is an enum, the response
 *     includes the full enum table (collapses the legacy
 *     `*_list_enum_values` tools per BK-051 Session 63 audit).
 *   - `get_param(port, block, name, channel?)` — single read.
 *   - `set_param(port, block, name, value, channel?)` — single write.
 *
 * Concise descriptions. The long AM4-specific behavioral guidance
 * (RELATIVE-CHANGE DISCIPLINE, TEMPO/TIME, CHANNEL/SCENE, REVERB.TYPE
 * NAMING) stays on the legacy `am4_set_param` description through
 * v0.1.0 — it's load-bearing for the AM4 conversational quality the
 * MVP ships on. When Wave 2 retires the device-namespaced surface, the
 * guidance migrates into a per-device `behavioral_guidance` field on
 * `describe_device`. v0.3 problem; not Session B's job.
 *
 * The remaining ~12 unified tools (set_params, get_params, set_block,
 * apply_preset, switch_preset, save_preset, switch_scene, rename,
 * apply_setlist, scan_locations, lookup_lineage, restore_defaults)
 * land in Session B subsequent chunks.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  describeDevice,
  executeGetParam,
  executeGetParams,
  executeRename,
  executeSavePreset,
  executeSetParam,
  executeSetParams,
  executeSwitchPreset,
  executeSwitchScene,
  listParams,
  requireDevice,
} from '@/protocol/generic/dispatcher.js';
import { DispatchError } from '@/protocol/generic/types.js';

const PORT_DESC =
  'Device port. Accepts the device id (e.g. "am4", "axe-fx-ii"), display ' +
  'name ("Fractal AM4"), or any MIDI port-name substring matching a ' +
  'registered device (e.g. "AM4 MIDI 1"). Call list_midi_ports to see ' +
  'connected ports; call describe_device(port) to confirm capabilities.';

function asText(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{
      type: 'text',
      text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    }],
  };
}

function asError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  let text: string;
  if (err instanceof DispatchError) {
    const parts = [`${err.message}`];
    if (err.details?.suggestion) parts.push(`Suggestion: ${err.details.suggestion}.`);
    if (err.details?.valid_options) parts.push(`Valid options: ${err.details.valid_options.join(', ')}.`);
    if (err.details?.valid_options_tool) parts.push(`See: ${err.details.valid_options_tool}.`);
    if (err.details?.retry_action) parts.push(err.details.retry_action);
    text = parts.join(' ');
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  return { content: [{ type: 'text', text }], isError: true };
}

export function registerUnifiedTools(server: McpServer): void {
  // ── describe_device ───────────────────────────────────────────────

  server.registerTool('describe_device', {
    description: [
      'Return a registered device\'s capabilities and canonical vocabulary.',
      'Call once per session for any device you\'re about to control via the',
      'unified set_param / get_param / apply_preset / etc. tools — the',
      'response tells you what blocks the device has, what its scenes /',
      'channels / preset locations look like, and which words the device',
      'uses for each concept (e.g. AM4: "channel A/B/C/D"; Axe-Fx II:',
      '"channel X/Y"; Hydrasynth: "patch" instead of "preset").',
      'Pure introspection — no MIDI I/O. Safe to call repeatedly.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
    },
  }, async ({ port }) => {
    try {
      return asText(describeDevice(port));
    } catch (err) {
      return asError(err);
    }
  });

  // ── list_params ───────────────────────────────────────────────────

  server.registerTool('list_params', {
    description: [
      'Enumerate a device\'s named parameters. With no `block` filter,',
      'returns every (block, name) pair the device exposes plus its unit',
      'and display range. With `block` supplied, scopes to just that block.',
      'With both `block` AND `name`, the response also includes the full',
      'enum table for enum-typed params (e.g. amp.type with 50+ amp model',
      'names; reverb.type with all the "Room, Small" / "Plate, Medium"',
      'entries). Use this before calling set_param when you\'re unsure of',
      'the exact spelling of an enum value.',
      'Pure introspection — no MIDI I/O.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      block: z.string().optional().describe('Optional block-name filter (e.g. "amp", "reverb").'),
      name: z.string().optional().describe(
        'Optional param-name filter (requires `block`). For enum params, returns the full enum table.',
      ),
    },
  }, async ({ port, block, name }) => {
    try {
      return asText(listParams({ port, block, name }));
    } catch (err) {
      return asError(err);
    }
  });

  // ── get_param ─────────────────────────────────────────────────────

  server.registerTool('get_param', {
    description: [
      'Read a single parameter from a device. Returns the display-shaped',
      'value (knob 0–10, dB, ms, %, enum dropdown name) — never raw wire',
      'bytes. Use this before set_param when you need to know the current',
      'value (the user said "more gain" — read first so you know what',
      '"more" is relative to).',
      'For channel-bearing blocks on devices that have channels (AM4 amp /',
      'drive / reverb / delay; Axe-Fx II X/Y blocks), pass `channel` to',
      'target a specific A/B/C/D (or X/Y). Without `channel`, reads',
      'whichever channel is currently active on that block.',
      'One wire round-trip, < 200 ms on healthy MIDI.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      block: z.string().describe('Block name (e.g. "amp", "reverb", "delay").'),
      name: z.string().describe('Parameter name within the block (e.g. "gain", "time", "mix").'),
      channel: z.union([z.string(), z.number()]).optional().describe(
        'Optional channel selector. Only valid for channel-bearing blocks; see describe_device.capabilities.channel_blocks.',
      ),
    },
  }, async ({ port, block, name, channel }) => {
    try {
      const result = await executeGetParam({ port, block, name, channel });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── set_param ─────────────────────────────────────────────────────

  server.registerTool('set_param', {
    description: [
      'Write a single parameter on a device. The parameter is addressed by',
      '(block, name) — e.g. block="amp", name="gain". Numeric params take',
      'the display value (0–10 knob, dB, ms, %); enum params take the',
      'dropdown name ("Plexi 100W High") or a numeric wire index.',
      'For channel-bearing blocks on devices that have channels (AM4 amp /',
      'drive / reverb / delay; Axe-Fx II X/Y blocks), pass `channel` to',
      'target a specific A/B/C/D (or X/Y). The server switches the block\'s',
      'channel selector first, then writes the param. Without `channel`,',
      'writes to whichever channel is currently active.',
      'IMPORTANT: the wire-ack confirms the device received the write — it',
      'does NOT confirm an audible change. If the target block isn\'t',
      'placed in the active preset, the device still acks but produces no',
      'sound. Check describe_device.capabilities and call get_param to',
      'verify the read-back if the user reports an unexpected outcome.',
      'For device-specific behavioral guidance (relative changes, tempo-',
      'sync defaults, enum-naming conventions, scene model), call the',
      'legacy device-namespaced tool description (e.g. am4_set_param) —',
      'that guidance migrates to describe_device in a future release.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      block: z.string().describe('Block name (e.g. "amp", "drive", "reverb", "delay").'),
      name: z.string().describe('Parameter name within the block (e.g. "gain", "type", "mix").'),
      value: z.union([z.number(), z.string()]).describe(
        'Display value. Numbers for knobs / dB / ms / %, strings for enum dropdown names.',
      ),
      channel: z.union([z.string(), z.number()]).optional().describe(
        'Optional channel selector. Only valid for channel-bearing blocks; see describe_device.capabilities.channel_blocks.',
      ),
    },
  }, async ({ port, block, name, value, channel }) => {
    try {
      const result = await executeSetParam({ port, block, name, value, channel });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── set_params ────────────────────────────────────────────────────

  server.registerTool('set_params', {
    description: [
      'Write multiple parameters on a device in one call. Prefer this over',
      'many set_param calls when applying a scene, preset, or any grouped',
      'change — fewer round-trips, and validation is atomic (a bad value in',
      'one entry rejects the whole call with nothing sent).',
      'Per-entry shape matches set_param: numeric display values for knobs /',
      'dB / ms / %, strings or wire indices for enum dropdowns, optional',
      'channel selector for channel-bearing blocks. Writes are sent in the',
      'order provided.',
      'Same ack caveat as set_param: an ack is wire-level confirmation, not',
      'audible confirmation. If the user reports no change, target blocks',
      'may not be placed in the active preset.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      ops: z.array(z.object({
        block: z.string(),
        name: z.string(),
        value: z.union([z.number(), z.string()]),
        channel: z.union([z.string(), z.number()]).optional(),
      })).describe('Ordered list of (block, name, value, channel?) writes.'),
    },
  }, async ({ port, ops }) => {
    try {
      const result = await executeSetParams({ port, ops });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── get_params ────────────────────────────────────────────────────

  server.registerTool('get_params', {
    description: [
      'Read multiple parameters from a device in one call. Useful for',
      'state-anchoring before a tone-edit conversation (read current amp',
      'gain + master + bass + mid + treble, then propose a change). Per-',
      'query shape: (block, name, channel?). Reads continue past',
      'individual failures — a failed read for query[3] does NOT abort',
      'query[4..N]; the response lists which queries failed.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      queries: z.array(z.object({
        block: z.string(),
        name: z.string(),
        channel: z.union([z.string(), z.number()]).optional(),
      })).describe('List of (block, name, channel?) queries to read.'),
    },
  }, async ({ port, queries }) => {
    try {
      const result = await executeGetParams({ port, queries });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── switch_preset ─────────────────────────────────────────────────

  server.registerTool('switch_preset', {
    description: [
      'Load a stored preset location into the device\'s working buffer.',
      'Same effect as turning the preset knob on the hardware or selecting',
      'a preset in the device\'s editor app.',
      'WARNING: discards any unsaved edits in the current working buffer.',
      'If the user has been tone-building via apply_preset / set_param and',
      'hasn\'t yet called save_preset, those edits are lost. Confirm intent',
      'before issuing this after a session of building, especially if any',
      'set_param / set_block writes are still un-persisted.',
      'Location format depends on the device — call describe_device to see',
      'the preset_location_format regex (AM4: A01..Z04; Axe-Fx II: 0..383;',
      'Hydrasynth: A1..H8). Pass either the string form or a numeric index.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      location: z.union([z.string(), z.number()]).describe(
        'Preset location. See describe_device.capabilities.preset_location_format for the device\'s expected shape.',
      ),
    },
  }, async ({ port, location }) => {
    try {
      const result = await executeSwitchPreset({ port, location });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── save_preset ───────────────────────────────────────────────────

  server.registerTool('save_preset', {
    description: [
      'Persist the device\'s working-buffer preset to a stored location.',
      'Optional `name` argument renames the preset first (composite rename',
      '+ save). Same destructive-write semantics as the legacy device-',
      'namespaced save tools — call this ONLY when the user has explicitly',
      'asked to save / persist / store / keep the preset; apply_preset is',
      'reversible (switch presets to discard), save_preset is not.',
      'A bare "make me a preset for X" is a try-it-out ask, not a save ask.',
      'When in doubt, apply_preset first and ask whether to persist.',
      'If the target location is non-empty, confirm with the user before',
      'overwriting. The user\'s scratch location on AM4 is "Z04" by',
      'convention.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      location: z.union([z.string(), z.number()]).describe(
        'Storage location. See describe_device for the device\'s shape.',
      ),
      name: z.string().max(32).optional().describe(
        'Optional new name (up to 32 chars). If supplied, the preset is renamed before saving.',
      ),
    },
  }, async ({ port, location, name }) => {
    try {
      const result = await executeSavePreset({ port, location, name });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── switch_scene ──────────────────────────────────────────────────

  server.registerTool('switch_scene', {
    description: [
      'Switch the active scene within the current preset. Scene switch',
      'does not change the preset\'s block layout — it toggles per-scene',
      'bypass + channel state. Devices without scenes (e.g. Hydrasynth)',
      'reject this call with a capability error.',
      'SCOPE: current working buffer only. Scene index is not stored on',
      'preset load — the next preset load starts at its default scene.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      scene: z.number().int().describe(
        'Scene number (1-indexed). Range depends on the device — AM4: 1..4; Axe-Fx II: 1..8.',
      ),
    },
  }, async ({ port, scene }) => {
    try {
      const result = await executeSwitchScene({ port, scene });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  // ── rename ────────────────────────────────────────────────────────

  server.registerTool('rename', {
    description: [
      'Rename the working-buffer preset or one of its scenes. Target is',
      '"preset" (working-buffer preset name) or "scene:N" (1-indexed scene',
      'number). Devices without scenes reject scene targets.',
      'SCOPE: writes to the working buffer only. The rename persists across',
      'preset loads only if save_preset is called afterward. Without a',
      'subsequent save, loading a different preset discards the rename.',
      'AM4 NOTE: rename(target="preset") needs a paired save_preset to',
      'land — the AM4 wire protocol requires a location even for "rename',
      'the working buffer". Use save_preset(location, name) for the full',
      'rename + persist flow; rename(target="scene:N") on AM4 writes the',
      'scene name into the working buffer and waits for save_preset.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      target: z.string().describe(
        'Rename target — "preset" or "scene:N" (1-indexed).',
      ),
      name: z.string().min(1).max(32).describe(
        'New name (1..32 chars). Shorter names are space-padded on the wire by the device.',
      ),
    },
  }, async ({ port, target, name }) => {
    try {
      const result = await executeRename({ port, target, name });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });
}

// Self-register `requireDevice` as an unused-but-exported symbol just to
// guarantee the registry module's side effect (initialization) is part of
// this module's import graph. Without this, tree-shaking COULD drop the
// registry from a future minified build before any descriptor registers.
// Harmless no-op at runtime.
void requireDevice;
