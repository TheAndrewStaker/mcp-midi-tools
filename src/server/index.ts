#!/usr/bin/env node
/**
 * MCP MIDI Control — MCP server (stdio).
 *
 * The boot + register-loop. One `register*Tools(server)` call per
 * supported device, plus a couple of generic-MIDI primitive families.
 *
 * Where things live:
 *   src/server/shared/                cross-tool helpers (connection
 *                                       registry, channel cache, wire-op
 *                                       helpers, paramKey resolution)
 *   src/server/tools/                 generic-MIDI tool families that
 *                                       work against any USB MIDI device
 *                                       (`send_*`, `list_midi_ports`,
 *                                       `reconnect_midi`)
 *   src/fractal/am4/tools/            AM4 tool family (split into 8 files
 *                                       because apply_preset alone is 1633
 *                                       LOC; aggregator at index.ts)
 *   src/fractal/axe-fx-ii/tools.ts    Axe-Fx II tool family (single file)
 *   src/asm/hydrasynth-explorer/server.ts  Hydrasynth tool family
 *
 * Adding a new device follows the same shape: put the device's wire layer
 * + tool definitions under `src/<vendor>/<device>/`, export a
 * `register<Device>Tools(server)`, and register it below.
 *
 * Run standalone for a quick sanity check (development only — picks up
 * source changes without rebuilding):
 *   npm run server          # tsx-based, requires project cwd
 *
 * Claude Desktop wiring — run `npm run setup-claude-desktop` (handles
 * build + config-file detection + idempotent merge), or hand-edit
 * `%APPDATA%\Claude\claude_desktop_config.json` after `npm run build`:
 *
 *   "mcp-midi-control": {
 *     "command": "node",
 *     "args": ["C:\\\\dev\\\\mcp-midi-control\\\\dist\\\\server\\\\index.js"],
 *     "env": {}
 *   }
 *
 * `tsx`-against-source DOES NOT work as a Claude Desktop entry because
 * Desktop spawns the server with cwd = C:\Windows\System32, so tsx
 * can't find tsconfig.json and the `@/` path aliases fail. The build
 * approach (`tsc-alias` rewrites aliases to relative paths) is robust.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { listMidiPorts } from '@/fractal/am4/midi.js';

import { registerMidiControlTools } from '@/server/tools/midi-control.js';
import { registerMidiPrimitiveTools } from '@/server/tools/midi-primitives.js';

import { registerAM4Tools } from '@/fractal/am4/tools/index.js';
import { registerAxeFxIITools, describeAxeFxIIPortStatus } from '@/fractal/axe-fx-ii/tools.js';
import { registerHydrasynthTools, describeHydrasynthPortStatus } from '@/asm/hydrasynth-explorer/server.js';

// BK-051 unified tool surface — descriptor registration. The dispatcher
// resolves a tool call's `port` to a registered descriptor; per-device
// behavior lives in the descriptor's schema + reader/writer adapters.
// Session A (BK-051 phase 1, 2026-05-11) registers AM4 only — the
// existing legacy `am4_*` tools keep working unchanged in parallel.
// Sessions B onward register the unified MCP tools (set_param,
// get_param, …) that route through the dispatcher.
import { registerDevice as registerMcpDevice } from '@/protocol/generic/registry.js';
import { registerDeviceResources } from '@/protocol/generic/resources.js';
import { registerUnifiedTools } from '@/protocol/generic/tools.js';
import { AM4_DESCRIPTOR } from '@/fractal/am4/descriptor.js';
import { AXEFX2_DESCRIPTOR } from '@/fractal/axe-fx-ii/descriptor.js';
import { HYDRASYNTH_DESCRIPTOR } from '@/asm/hydrasynth-explorer/descriptor.js';

// -- Server setup -----------------------------------------------------------

/**
 * Server-level instructions — sent once at the MCP `initialize`
 * handshake, ahead of any tool call. Cross-cutting agent contracts
 * that apply to the entire MIDI tool surface live here instead of
 * being copy-pasted into every tool description.
 */
const SERVER_INSTRUCTIONS = [
  'mcp-midi-control is a USB MIDI control server for Fractal AM4, Fractal',
  'Axe-Fx II XL+, ASM Hydrasynth Explorer, and any generic MIDI device the',
  'OS exposes. Pick tools by intent, not by name length.',
  '',
  'DEFAULT BEHAVIOR — call the tools, do not write specs.',
  'When the user asks for an audible change on connected hardware (build a',
  'tone, tweak a param, switch a preset, switch a scene, save a patch), USE',
  'THE TOOLS. Do not produce a written spec / preset doc / parameter table',
  'instead of calling the tools unless the user explicitly asked for a dry',
  'run, design exercise, or "what would the params look like" preview.',
  'Audible-change requests are tool-call requests by default.',
  '',
  'SESSION-START SETUP — call describe_device(port) ONCE.',
  'Before the first tone-building or apply_preset call against a device,',
  'call describe_device({port}) once. The response carries device-specific',
  'agent_guidance (channel/scene model, applicability rules, iconic-amp',
  'shortcuts, enum-name conventions, tempo-sync discipline, save-language',
  'anti-patterns, read-vs-navigate constraints) — load it into context',
  'and refer to it while planning. Skipping this is the #1 cause of "the',
  'AI changed something but it doesn\'t sound right."',
  '',
  'TWO TOOL SURFACES — prefer unified.',
  'The unified surface (apply_preset, set_param, get_param, switch_preset,',
  'save_preset, switch_scene, set_block, set_bypass, set_params, get_params,',
  'list_params, lookup_lineage, scan_locations, describe_device, rename,',
  'apply_setlist, restore_defaults) routes via the `port` argument and works',
  'against any registered device. Use unified by default. Device-namespaced',
  'tools (am4_*, axefx2_*, hydra_*) survive only for capabilities the unified',
  'surface does not yet cover (Axe-Fx II grid layout, Hydrasynth full-patch',
  'NRPN dump). Reach for them only when the unified surface lacks the',
  'specific operation you need.',
  '',
  'SAVE LANGUAGE — strict vocabulary list.',
  'Persisting to flash is destructive and gated. Only set save_authorized=',
  'true when the user used explicit save vocab: save, store, keep, put on,',
  'persist, commit to flash. State descriptions ("I want X to have a copy',
  'of Y", "make X look/sound like Y", "create at X based on Y") describe',
  'the desired audition state, NOT save intent — leave save_authorized=false',
  'and audition. When ambiguous, audition and ASK before persisting.',
].join('\n');

const server = new McpServer({
  name: 'mcp-midi-control',
  version: '0.1.0',
}, {
  instructions: SERVER_INSTRUCTIONS,
});

// -- Generic-MIDI tool families (any device) --------------------------------
//
// These tools target a port by name substring and don't carry any
// device-specific protocol logic. Useful when a device has a published
// CC / NRPN / SysEx chart but no dedicated wrapper yet.

registerMidiControlTools(server);   // list_midi_ports, reconnect_midi
registerMidiPrimitiveTools(server); // send_cc / _note / _program_change / _nrpn / _sysex

// -- Per-device tool families -----------------------------------------------
//
// Each device contributes a prefixed tool family on the same MCP server.
// Tool names are namespaced (`am4_*`, `axefx2_*`, `hydra_*`) so they
// can't collide. See docs/MULTI-DEVICE-ROADMAP.md for the rationale.

registerAM4Tools(server);           // 30 am4_* tools
registerAxeFxIITools(server);       // 9 axefx2_* tools
registerHydrasynthTools(server);    // 12 hydra_* tools

// -- Unified-surface descriptor registration (BK-051) -----------------------
//
// Phase 1 (Session A): AM4 descriptor registers. Session B chunk 1 adds
// the first batch of unified MCP tools (describe_device, list_params,
// get_param, set_param) that dispatch through this descriptor. Legacy
// `am4_*` tools keep working in parallel; v0.1.0 ships with both
// surfaces, the legacy tools carry the long device-specific guidance
// the LLM relies on, and the unified surface is the architectural seed
// for Wave 2 (Axe-Fx II + Hydrasynth descriptors).
// Order matters — Axe-Fx II registers BEFORE AM4 so the more-specific
// `/axe-?fx/i` regex fires first against port names like "Fractal Axe-Fx
// II Port 1". AM4's `/Fractal/i` regex stays as a catch-all. Per Q4
// answer in `docs/_private/axefx2-descriptor-plan.md` § 9 (Session 66).
registerMcpDevice(AXEFX2_DESCRIPTOR);
registerMcpDevice(AM4_DESCRIPTOR);
// Hydrasynth registers after the Fractal devices — its port_match
// regex (/hydrasynth|asm.*hydra/i) can't collide with the Fractal
// patterns, so ordering doesn't matter for correctness. BK-031
// (Session 68) shipped this descriptor as the third device on the
// unified surface; legacy hydra_* tools still register in parallel.
registerMcpDevice(HYDRASYNTH_DESCRIPTOR);
registerUnifiedTools(server);
// Expose each device's agent_guidance topics as MCP resources so the
// agent can pull individual topics on demand instead of always
// receiving the full agent_guidance bag via describe_device.
registerDeviceResources(server);

// -- Start ------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers log to stderr — stdout is owned by the transport.
  // The port enumeration mirrors what list_midi_ports would return at
  // this moment; if the user reports "AM4 not connected" later, the
  // startup banner captures whatever state the server started with.
  console.error('MCP MIDI Control MCP server running on stdio.');
  try {
    const { inputs, outputs } = listMidiPorts();
    const am4In = inputs.find((p) => p.looksLikeAM4);
    const am4Out = outputs.find((p) => p.looksLikeAM4);
    const verdict = am4In && am4Out
      ? `AM4 detected (in: "${am4In.name}", out: "${am4Out.name}")`
      : am4In || am4Out
        ? 'AM4 partially visible — one direction missing; check driver'
        : inputs.length === 0 && outputs.length === 0
          ? 'no MIDI ports visible (driver likely not installed)'
          : `AM4 not visible among ${inputs.length} inputs / ${outputs.length} outputs`;
    console.error(`Startup port scan: ${verdict}.`);
  } catch (err) {
    // Port enumeration shouldn't throw, but if node-midi barfs on this
    // platform we don't want startup to die — log and continue.
    console.error(`Startup port scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Hydrasynth port-scan banner — separate from the AM4 scan because
  // they're independent devices that may both be plugged in (or just
  // one, or neither). Honest reporting of what's actually connected.
  try {
    console.error(`Hydrasynth port scan: ${describeHydrasynthPortStatus()}.`);
  } catch (err) {
    console.error(`Hydrasynth port scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Axe-Fx II port-scan banner — same independence rationale as above.
  try {
    console.error(`Axe-Fx II port scan: ${describeAxeFxIIPortStatus()}.`);
  } catch (err) {
    console.error(`Axe-Fx II port scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
