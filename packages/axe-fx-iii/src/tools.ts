/**
 * Axe-Fx III family — MCP tool registration index.
 *
 * `registerAxeFxIIITools(server)` composes the per-family
 * registrations. Mirrors the Axe-Fx II tools index pattern.
 *
 *   - `shared.ts`     — MIDI lazy-init, GET_RESPONSE_TIMEOUT_MS,
 *                       NO_ACK_NOTE, BETA_NOTE, toHex
 *   - `meta.ts`       — axefx3_reconnect_midi, axefx3_probe_sysex
 *   - `navigation.ts` — axefx3_switch_scene, axefx3_get_active_scene,
 *                       axefx3_get_preset_name, axefx3_get_scene_name
 *   - `effects.ts`    — axefx3_set_bypass / get_bypass / set_channel /
 *                       get_channel  (function 0x0A, 0x0B + Appendix 1)
 *   - `utility.ts`    — axefx3_tempo_tap / set_tempo / get_tempo /
 *                       set_tuner / set_looper / get_looper_state
 *   - `discovery.ts`  — axefx3_status_dump, axefx3_list_blocks
 *
 * NOTE: there is NO `axefx3_switch_preset` — the v1.4 III spec has no
 * SysEx preset-switch function. III preset switching is via MIDI
 * Program Change (Bank Select + PC), which is outside this SysEx
 * tool surface.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAxeFxIIIDiscoveryTools } from './tools/discovery.js';
import { registerAxeFxIIIEffectTools } from './tools/effects.js';
import { registerAxeFxIIIMetaTools } from './tools/meta.js';
import { registerAxeFxIIINavigationTools } from './tools/navigation.js';
import { registerAxeFxIIIUtilityTools } from './tools/utility.js';

export { describeAxeFxIIIPortStatus } from './tools/meta.js';
export { resetAxeFxIIIConnection } from './tools/shared.js';

export function registerAxeFxIIITools(server: McpServer): void {
  registerAxeFxIIINavigationTools(server);
  registerAxeFxIIIEffectTools(server);
  registerAxeFxIIIUtilityTools(server);
  registerAxeFxIIIDiscoveryTools(server);
  registerAxeFxIIIMetaTools(server);
}
