/**
 * Axe-Fx II family — MCP tool registration index.
 *
 * `registerAxeFxIITools(server)` composes the per-family registrations.
 * Each family file under `src/fractal/axe-fx-ii/tools/` owns one
 * coherent slice of the surface:
 *
 *   - `shared.ts`       — MIDI lazy-init, NO_ACK_NOTE, findParam,
 *                         findBlock, GET_RESPONSE_TIMEOUT_MS
 *   - `gridRender.ts`   — ASCII / markdown / JSON / summary renderers
 *                         for the 4×12 routing grid
 *   - `applyExecutor.ts` — buildApplyPresetAtOps + runApplyPresetAtOps,
 *                          reused by all three apply tools
 *   - `discovery.ts`    — list_block_types, list_params, list_enum_values,
 *                         lookup_lineage
 *   - `params.ts`       — set_param, get_param
 *   - `layout.ts`       — set_block_bypass, get_grid_layout,
 *                         set_block_at_cell
 *   - `navigation.ts`   — get_preset_name, get_active_preset_number,
 *                         switch_scene, set_block_channel, get_block_channel,
 *                         switch_preset, set_preset_name, scan_preset_range,
 *                         save_preset
 *   - `preset.ts`       — apply_preset, apply_preset_at, apply_setlist
 *   - `meta.ts`         — reconnect_midi + describeAxeFxIIPortStatus
 *
 * Hardware-verification status per tool is tracked in
 * `docs/_private/HARDWARE-TASKS-AXEFX2.md`, not in this surface.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAxeFxIIDiscoveryTools } from './tools/discovery.js';
import { registerAxeFxIILayoutTools } from './tools/layout.js';
import { registerAxeFxIIMetaTools } from './tools/meta.js';
import { registerAxeFxIINavigationTools } from './tools/navigation.js';
import { registerAxeFxIIParamTools } from './tools/params.js';
import { registerAxeFxIIPresetTools } from './tools/preset.js';

export { describeAxeFxIIPortStatus } from './tools/meta.js';
export { resetAxeFxIIConnection, findParam } from './tools/shared.js';

export function registerAxeFxIITools(server: McpServer): void {
  registerAxeFxIIDiscoveryTools(server);
  registerAxeFxIIParamTools(server);
  registerAxeFxIILayoutTools(server);
  registerAxeFxIINavigationTools(server);
  registerAxeFxIIPresetTools(server);
  registerAxeFxIIMetaTools(server);
}
