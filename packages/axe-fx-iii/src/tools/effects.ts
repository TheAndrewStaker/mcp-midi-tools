/**
 * Axe-Fx III block-level effect tools — bypass + channel writes
 * using v1.4 spec Appendix 1 effect IDs.
 *
 * These operate on the ACTIVE scene only (per v1.4 spec — the III
 * has no per-scene bypass / channel writes in the public spec).
 *
 * Tools registered:
 *   - axefx3_set_bypass(block, bypassed)
 *   - axefx3_get_bypass(block)
 *   - axefx3_set_channel(block, channel)
 *   - axefx3_get_channel(block)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { resolveEffectId } from '../blockTypes.js';
import {
  buildSetBypass,
  buildGetBypass,
  buildSetChannel,
  buildGetChannel,
  isSetGetBypassResponse,
  isSetGetChannelResponse,
  parseBypassResponse,
  parseChannelResponse,
} from '../setParam.js';

import {
  BETA_NOTE,
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  formatMultipurposeError,
  sendAndWatchForError,
  toHex,
} from './shared.js';

const BLOCK_INPUT_DESCRIPTION = [
  'Block reference. Accepts:',
  '  - "Reverb 1", "Drive 2", "Compressor 4" — name + instance number',
  '  - "Reverb" (no instance defaults to instance 1)',
  '  - "REV", "DRV", "CMP" — 3-letter group code',
  '',
  "AMP / Dynamic Distortion / NAM / Global Block / Shunt aren't",
  "addressable from the v1.4 spec (no effect ID) — these will refuse.",
  'Call axefx3_list_blocks for the full catalog.',
].join('\n');

const CHANNEL_VALUES = { A: 0, B: 1, C: 2, D: 3 } as const;

export function registerAxeFxIIIEffectTools(server: McpServer): void {

  server.registerTool('axefx3_set_bypass', {
    description: [
      'Set the bypass state of a block on the Axe-Fx III. Targets the',
      'ACTIVE scene only — the v1.4 spec has no per-scene bypass write.',
      '',
      'Wire: SET_BYPASS (function 0x0A). Payload: `id id dd` where',
      '  id id = 14-bit effect ID per v1.4 Appendix 1 (LS-first)',
      '  dd    = 0 (engaged) or 1 (bypassed)',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
      bypassed: z.boolean().describe(
        'true → bypass (block is muted/skipped), false → engage (block is in signal chain).',
      ),
    },
  }, async ({ block, bypassed }) => {
    const effectId = resolveEffectId(block);
    const bytes = buildSetBypass(effectId, bypassed);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_BYPASS → ${block} (effect ID ${effectId}) ` +
          `${bypassed ? 'BYPASSED' : 'ENGAGED'}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_bypass', {
    description: [
      "Read a block's current bypass state on the Axe-Fx III.",
      '',
      'Wire: GET_BYPASS (function 0x0A with `dd=0x7F`).',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
    },
  }, async ({ block }) => {
    const effectId = resolveEffectId(block);
    const reqBytes = buildGetBypass(effectId);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetBypassResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_bypass(${block}) failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseBypassResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `${block} (effect ID ${parsed.effectId}) is ` +
          `${parsed.bypassed ? 'BYPASSED' : 'ENGAGED'}.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_set_channel', {
    description: [
      "Switch a block's active channel on the Axe-Fx III. Each block",
      'holds up to 4 independent parameter sets (channels A/B/C/D).',
      'Targets the ACTIVE scene only.',
      '',
      'Wire: SET_CHANNEL (function 0x0B). Payload: `id id dd` where',
      '  id id = 14-bit effect ID per v1.4 Appendix 1 (LS-first)',
      '  dd    = 0 (A), 1 (B), 2 (C), 3 (D)',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
      channel: z.enum(['A', 'B', 'C', 'D']).describe(
        'Target channel — A, B, C, or D.',
      ),
    },
  }, async ({ block, channel }) => {
    const effectId = resolveEffectId(block);
    const wireChannel = CHANNEL_VALUES[channel];
    const bytes = buildSetChannel(effectId, wireChannel);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_CHANNEL → ${block} (effect ID ${effectId}) ` +
          `channel=${channel}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_channel', {
    description: [
      "Read a block's current channel (A/B/C/D) on the Axe-Fx III.",
      '',
      'Wire: GET_CHANNEL (function 0x0B with `dd=0x7F`).',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
    },
  }, async ({ block }) => {
    const effectId = resolveEffectId(block);
    const reqBytes = buildGetChannel(effectId);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetChannelResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_channel(${block}) failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseChannelResponse(response);
    const channelName = ['A', 'B', 'C', 'D'][parsed.channel] ?? `(unknown wire ${parsed.channel})`;
    return {
      content: [{
        type: 'text',
        text:
          `${block} (effect ID ${parsed.effectId}) is on channel ${channelName}.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });

}
