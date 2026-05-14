/**
 * MCP resources for device agent guidance.
 *
 * Per-MCP-spec, **tools** are for actions and **resources** are for
 * data the agent might want to read independently. The static
 * `agent_guidance` blocks on each device descriptor (channel/scene
 * model, save-language anti-patterns, tempo discipline, applicability
 * rules, iconic-tone tables, etc.) are reference data — not actions.
 * They were shipped inside `describe_device.agent_guidance` because
 * MCP resources had no MCP-SDK convention for cross-device data at
 * the time the unified surface landed.
 *
 * Surfacing them as resources lets the agent:
 *   - Discover guidance topics via `resources/list` without burning a
 *     tool call.
 *   - Read a specific guidance block independently — load only the
 *     topics relevant to the current planning step.
 *   - Pin guidance docs in MCP-aware UIs (Claude Desktop's connector
 *     panel, etc.) the way users pin documentation.
 *
 * URI scheme: `guidance://<deviceId>/<topic>` (e.g.
 * `guidance://am4/save_language`, `guidance://hydrasynth/envelope_time_units`).
 * Static — one resource registration per (device, topic) pair at
 * server startup.
 *
 * `describe_device` STILL returns the full `agent_guidance` map in its
 * response for back-compat with agents that haven't migrated to the
 * resources path. v0.5 may deprecate that field in favor of resources
 * once the SDK + Desktop client UX is stable.
 *
 * Lineage corpus is NOT yet exposed as resources — it needs a
 * descriptor extension (`reader.lineageCorpus()` returning the full
 * dataset per block type). Queued for next session.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { listRegisteredDevices } from '@/protocol/generic/registry.js';

/**
 * Compact device label for resource titles in MCP-aware UIs. The full
 * display_name (e.g. "Fractal Axe-Fx II XL+") is too long for menu
 * dropdowns once the topic name is appended. The compact label keeps
 * each resource title short enough to read in the Claude Desktop
 * "Add from <server>" submenu without truncation.
 */
function compactDeviceLabel(deviceId: string, displayName: string): string {
  switch (deviceId) {
    case 'am4': return 'AM4';
    case 'axe-fx-ii': return 'Axe-Fx II';
    case 'hydrasynth': return 'Hydrasynth';
    default: return displayName;
  }
}

export function registerDeviceResources(server: McpServer): void {
  for (const descriptor of listRegisteredDevices()) {
    const guidance = descriptor.agent_guidance;
    if (guidance === undefined) continue;
    const compactLabel = compactDeviceLabel(descriptor.id, descriptor.display_name);
    for (const [topic, content] of Object.entries(guidance)) {
      if (typeof content !== 'string' || content.length === 0) continue;
      const uri = `guidance://${descriptor.id}/${topic}`;
      // Internal name stays unique + technical so resources/list can be
      // disambiguated unambiguously. Title is what users see in the
      // Add-from dropdown — kept short by leading with the topic name
      // (the part users actually care about) and using the compact
      // device label.
      const name = `${descriptor.display_name} — ${topic}`;
      const title = `${topic}  (${compactLabel})`;
      const description = firstSentence(content, 200);
      server.registerResource(
        name,
        uri,
        {
          title,
          description,
          mimeType: 'text/plain',
        },
        async (readUri) => ({
          contents: [{
            uri: typeof readUri === 'string' ? readUri : uri,
            mimeType: 'text/plain',
            text: content,
          }],
        }),
      );
    }
  }
}

function firstSentence(text: string, maxLen: number): string {
  const sentenceEnd = text.search(/[.!?]\s/);
  const cut = sentenceEnd >= 0 && sentenceEnd < maxLen
    ? sentenceEnd + 1
    : Math.min(maxLen, text.length);
  return text.slice(0, cut).trim();
}
