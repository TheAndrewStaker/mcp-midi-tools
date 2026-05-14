/**
 * BK-051 unified MCP tool surface — index module.
 *
 * `registerUnifiedTools(server)` registers the full port-dispatched,
 * device-agnostic tool family on an `McpServer`. The 17 tools are split
 * across per-family files under `src/protocol/generic/tools/` so each file
 * stays focused on one concern (discovery, params, layout, navigation,
 * preset). This index just composes them.
 *
 * Family layout (every file exports a `register{Family}Tools(server)` fn):
 *   - `discovery.ts` — describe_device, list_params, lookup_lineage
 *   - `params.ts`    — get_param, set_param, get_params, set_params
 *   - `layout.ts`    — set_block, set_bypass
 *   - `navigation.ts` — switch_preset, save_preset, switch_scene, rename,
 *                       scan_locations
 *   - `preset.ts`    — apply_preset, apply_setlist, restore_defaults
 *   - `shared.ts`    — PORT_DESC + asText/asError + presetShape zod schemas
 *
 * The long AM4-specific behavioral guidance (RELATIVE-CHANGE DISCIPLINE,
 * TEMPO/TIME, CHANNEL/SCENE, REVERB.TYPE NAMING, COMPRESSOR groups, etc.)
 * stays on the legacy device-namespaced tool descriptions through v0.1.0.
 * When Wave 2 retires the device-namespaced surface, the guidance migrates
 * into per-device `behavioral_guidance` fields on `describe_device`. v0.3
 * problem; not Session B's job.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { requireDevice } from './dispatcher.js';

import { registerDiscoveryTools } from './tools/discovery.js';
import { registerLayoutTools } from './tools/layout.js';
import { registerNavigationTools } from './tools/navigation.js';
import { registerParamTools } from './tools/params.js';
import { registerPresetTools } from './tools/preset.js';

export function registerUnifiedTools(server: McpServer): void {
  registerDiscoveryTools(server);
  registerParamTools(server);
  registerLayoutTools(server);
  registerNavigationTools(server);
  registerPresetTools(server);
}

// Self-register `requireDevice` as an unused-but-exported symbol just to
// guarantee the registry module's side effect (initialization) is part of
// this module's import graph. Without this, tree-shaking COULD drop the
// registry from a future minified build before any descriptor registers.
// Harmless no-op at runtime.
void requireDevice;
