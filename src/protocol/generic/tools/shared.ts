/**
 * Shared helpers and zod sub-schemas for the BK-051 unified tool surface.
 *
 * Every family file under `src/protocol/generic/tools/` imports these helpers
 * — `PORT_DESC` (the canonical description string for the `port` argument),
 * `asText` / `asError` (MCP response shapers), and `presetSlotShape` /
 * `presetSceneShape` / `presetShape` (zod schemas reused by apply_preset and
 * apply_setlist).
 */

import * as z from 'zod/v4';

import { DispatchError } from '@/protocol/generic/types.js';

export const PORT_DESC =
  'Device port. Accepts the device id (e.g. "am4", "axe-fx-ii"), display ' +
  'name ("Fractal AM4"), or any MIDI port-name substring matching a ' +
  'registered device (e.g. "AM4 MIDI 1"). Call list_midi_ports to see ' +
  'connected ports; call describe_device(port) to confirm capabilities.';

export function asText(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{
      type: 'text',
      text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    }],
  };
}

export function asError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
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

// ── PresetSpec zod schemas (shared by apply_preset + apply_setlist) ─

export const presetSlotShape = z.object({
  slot: z.union([
    z.number().int().min(1),
    z.object({ row: z.number().int().min(1), col: z.number().int().min(1) }),
  ]).describe(
    'Slot location. Linear devices (AM4): 1-based slot index 1..4. Grid devices (Axe-Fx II): {row,col} 1-based, or a bare number as shorthand for {row:2, col:N} (row-2 linear chain).',
  ),
  block_type: z.string().describe(
    'Block to place (e.g. "amp", "drive", "reverb", "none"). See describe_device.block_types.',
  ),
  params: z.record(
    z.string(),
    z.record(z.string(), z.union([z.number(), z.string()])),
  ).optional().describe(
    'Per-channel params: { "A": { gain: 6, bass: 5 }, "D": { gain: 8 } }. Channel keys match describe_device.capabilities.channel_names.',
  ),
  bypassed: z.boolean().optional(),
  id: z.string().optional().describe(
    'v0.4: stable identifier for this block, used by routing edges and scene maps. Default: auto-derived `<block_type>_<instance>` (e.g. amp_1). Required when two blocks of the same type exist in the same preset.',
  ),
  instance: z.number().int().min(1).optional().describe(
    'v0.4: instance number on grid devices that support multiple of the same block type (Amp 1, Amp 2). Default 1. AM4 only accepts 1.',
  ),
});

export const presetSceneShape = z.object({
  scene: z.number().int().min(1).describe('Scene number (1-indexed).'),
  channels: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe(
    'Per-block channel selection: { "amp": "A", "drive": "A" }. Optional — supply at least one of channels / bypassed / name per entry.',
  ),
  bypassed: z.record(z.string(), z.boolean()).optional().describe(
    'Per-block bypass: { "drive": true } silences drive on this scene.',
  ),
  name: z.string().max(32).optional(),
});

export const routingEdgeShape = z.object({
  from: z.string().describe(
    'Source block id. Either the explicit `id` on a slots[] entry, or the auto-derived `<block_type>_<instance>` (e.g. amp_1, drive_2).',
  ),
  to: z.string().describe(
    'Destination block id. Same naming rules as `from`.',
  ),
  connect: z.boolean().optional().describe(
    'true (default) adds the cable; false removes it.',
  ),
});

export const presetShape = z.object({
  slots: z.array(presetSlotShape).min(1),
  scenes: z.array(presetSceneShape).optional(),
  name: z.string().max(32).optional(),
  landingScene: z.number().int().min(1).optional().describe(
    'Scene the device lands on after the build (1-indexed, device-clamped). ' +
    'Default 1. Lets the agent preview a specific scene-section ' +
    '(e.g. land on solo scene for an immediate lead test). Devices without scenes ignore this.',
  ),
  routing: z.array(routingEdgeShape).optional().describe(
    'v0.4: explicit routing edges for grid devices (parallel chains, FX loops, wet/dry splits). When omitted on a grid device, the descriptor infers a row-2 linear chain. Linear devices (AM4) reject this field — they route implicitly by slot order. See docs/FRACTAL-PRESET-SCHEMA.md for worked examples.',
  ),
});
