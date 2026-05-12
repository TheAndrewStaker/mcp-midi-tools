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
  executeSetParam,
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
}

// Self-register `requireDevice` as an unused-but-exported symbol just to
// guarantee the registry module's side effect (initialization) is part of
// this module's import graph. Without this, tree-shaking COULD drop the
// registry from a future minified build before any descriptor registers.
// Harmless no-op at runtime.
void requireDevice;
