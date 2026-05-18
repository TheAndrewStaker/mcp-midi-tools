/**
 * Axe-Fx III navigation tools — read tools per v1.4 PDF spec.
 *
 * NOTE: there is NO `axefx3_switch_preset` tool because the III's
 * v1.4 spec does NOT include a SysEx preset-switch function. III
 * preset switching is done via standard MIDI Program Change (with
 * CC 0 / CC 32 Bank Select for slots > 127), which is outside this
 * SysEx-focused tool surface.
 *
 * `axefx3_switch_scene` was removed 2026-05-18 — the unified
 * `switch_scene({port:'axe-fx-iii', scene})` covers it via the
 * descriptor writer.switchScene path.
 *
 * Tools registered:
 *   - axefx3_get_active_scene   (function 0x0C query)
 *   - axefx3_get_preset_name    (function 0x0D — returns preset # + name)
 *   - axefx3_get_scene_name     (function 0x0E)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  buildGetScene,
  buildQueryPatchName,
  buildQuerySceneName,
  isSetGetSceneResponse,
  isQueryPatchNameResponse,
  isQuerySceneNameResponse,
  parseSceneResponse,
  parseQueryPatchNameResponse,
  parseQuerySceneNameResponse,
} from 'fractal-midi/axe-fx-iii';

import {
  BETA_NOTE,
  GET_RESPONSE_TIMEOUT_MS,
  ensureConn,
  toHex,
} from './shared.js';

export function registerAxeFxIIINavigationTools(server: McpServer): void {

  server.registerTool('axefx3_get_active_scene', {
    description: [
      'Read the currently-active scene within the active preset.',
      'Returns 1-based display number.',
      '',
      'Wire: SET_GET_SCENE (function 0x0C) with the 0x7F query sentinel.',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildGetScene();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetSceneResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_active_scene failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const { scene } = parseSceneResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `Active scene: ${scene + 1} (wire ${scene}).\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_preset_name', {
    description: [
      'Read a preset name on the Axe-Fx III. By default returns the',
      'active preset (working buffer). Pass `preset` to look up a',
      "specific preset's name.",
      '',
      'Wire: QUERY_PATCH_NAME (function 0x0D). Spec quote:',
      '  Request:  F0 00 01 74 10 0D dd dd cs F7 (dd dd = preset #,',
      '            or 7F 7F to query current)',
      '  Response: F0 00 01 74 10 0D nn nn dd*32 cs F7 (nn nn = preset',
      '            #, dd*32 = 32-char ASCII name)',
      '',
      'Returns BOTH the preset number AND the name in one round-trip —',
      'there is no separate "get preset number" function in the III',
      'spec.',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      preset: z.number().int().min(0).max(1023).optional().describe(
        '0-based preset number to query. Omit to query the active preset.',
      ),
    },
  }, async ({ preset }) => {
    const target = preset ?? 'current';
    const reqBytes = buildQueryPatchName(target);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isQueryPatchNameResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_preset_name failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseQueryPatchNameResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `${target === 'current' ? 'Active' : `Preset ${preset}`}: ` +
          `"${parsed.name}" (preset number ${parsed.presetNumber}, ` +
          `display slot ${parsed.presetNumber + 1}).\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_scene_name', {
    description: [
      'Read the name of a scene (1..8) in the active preset, or the',
      'currently-active scene by passing scene="current".',
      '',
      'Wire: QUERY_SCENE_NAME (function 0x0E). Returns scene index +',
      '32-char ASCII name (space-padded).',
      '',
      'NB: there is no SET_SCENE_NAME envelope in the v1.4 III spec —',
      'scene rename support requires future capture work.',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      scene: z.union([
        z.literal('current'),
        z.number().int().min(1).max(8),
      ]).describe(
        '1-indexed scene number (1..8), or "current" to read the active scene\'s name.',
      ),
    },
  }, async ({ scene }) => {
    const wireSentinel = scene === 'current' ? 'current' as const : (scene - 1);
    const reqBytes = buildQuerySceneName(wireSentinel);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isQuerySceneNameResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_scene_name failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseQuerySceneNameResponse(response);
    const displayScene = parsed.scene + 1;
    return {
      content: [{
        type: 'text',
        text:
          `Scene ${displayScene} name: "${parsed.name}".\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });

}
