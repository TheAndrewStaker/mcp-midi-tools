/**
 * Layout tools — block placement and bypass writes.
 *
 * Tools registered here:
 *   - `set_block(port, slot, block_type)` — place / clear a block at a slot
 *   - `set_bypass(port, block, bypassed)` — silence / activate a placed block
 *
 * `set_block` mutates the signal-chain layout; `set_bypass` mutates the
 * active scene's per-block bypass register. To set bypass on a non-active
 * scene, call `switch_scene` first.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { executeSetBlock, executeSetBypass } from '../dispatcher.js';

import { PORT_DESC, asError, asText } from './shared.js';

export function registerLayoutTools(server: McpServer): void {
  server.registerTool('set_block', {
    description: [
      'Place (or clear) a block at a slot in the signal chain. Use this to',
      'build up a preset\'s block layout before tuning per-block params via',
      'set_param. Slot indexing is 1-based on linear devices (AM4: 1..4)',
      'and {row, col} on grid devices (Axe-Fx II — Wave 2).',
      'block_type accepts the device\'s registered block names ("amp",',
      '"drive", "reverb", "delay", …) plus "none" to clear the slot.',
      'See describe_device.block_types for the full list per device.',
      'For bypass writes (silence an existing block without removing it),',
      'use set_bypass instead — the AM4\'s bypass register is addressed',
      'by block name, not by slot.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      slot: z.number().int().describe(
        'Slot index (1-based) on linear devices. Grid-device support is Wave 2.',
      ),
      block_type: z.string().describe(
        'Block type to place. Pass "none" to clear the slot. See describe_device.block_types.',
      ),
    },
  }, async ({ port, slot, block_type }) => {
    try {
      const result = await executeSetBlock({ port, slot, change: { block_type } });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  server.registerTool('set_bypass', {
    description: [
      'Silence (bypass = true) or activate (bypass = false) a block on the',
      'currently active scene. A bypassed block passes audio through',
      'unchanged — its params stay intact, it just makes no sound. Common',
      'use: "mute the drive on the clean scene" — switch to that scene',
      'first, then set_bypass(block="drive", bypassed=true).',
      'SCENE SCOPE: the write lands on whichever scene is active right now.',
      'To configure bypass on a specific scene, switch_scene first and then',
      'set_bypass.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      block: z.string().describe('Block name to bypass / activate (e.g. "amp", "drive", "reverb").'),
      bypassed: z.boolean().describe('true = silence the block; false = activate.'),
    },
  }, async ({ port, block, bypassed }) => {
    try {
      const result = await executeSetBypass({ port, block, bypassed });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });
}
