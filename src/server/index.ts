#!/usr/bin/env node
/**
 * MCP MIDI Tools — MCP server (stdio).
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
 *   "mcp-midi-tools": {
 *     "command": "node",
 *     "args": ["C:\\\\dev\\\\mcp-midi-tools\\\\dist\\\\server\\\\index.js"],
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

// -- Server setup -----------------------------------------------------------

const server = new McpServer({
  name: 'mcp-midi-tools',
  version: '0.1.0',
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

// -- Start ------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers log to stderr — stdout is owned by the transport.
  // The port enumeration mirrors what list_midi_ports would return at
  // this moment; if the user reports "AM4 not connected" later, the
  // startup banner captures whatever state the server started with.
  console.error('MCP MIDI Tools MCP server running on stdio.');
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
