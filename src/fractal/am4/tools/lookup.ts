/**
 * AM4 lookup tools removed v0.3 — use the unified surface:
 *
 *   list_params({ port:'am4', block?, name? })  — full catalog or scoped to block/name
 *   describe_device({ port:'am4' })             — capabilities + agent_guidance
 *
 * The live-confirmation line (P5-011 item 4 / HW-012) is now a
 * `live_confirmation` field on the unified list_params response so
 * Claude Desktop can verify the connector is attached without an AM4-
 * specific tool call.
 *
 * AM4-Edit canonical labels + per-type applicability annotations that
 * the legacy am4_list_params surfaced are tracked for v0.4 — the
 * unified list_params will gain optional aliases / applies_only_when
 * fields once the cross-device schema can accommodate them.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerLookupTools(_server: McpServer): void {
    // intentionally empty — am4_list_params, am4_list_block_types,
    // am4_list_enum_values removed v0.3 (use unified list_params with
    // port='am4').
}
