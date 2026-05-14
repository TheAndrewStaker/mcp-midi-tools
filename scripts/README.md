# scripts/

Dev-time tooling for this project. Not shipped to end users — the
installer bundle (`build/dist/mcp-midi-control-v*.zip`) only contains
`dist/` + Node + production deps. These scripts run via `tsx` against
the TypeScript source.

## Categories

### Regression goldens — wired into `npm test`

`verify-*.ts` files. Byte-exact assertions against captured wire
traffic for every shipped protocol layer (AM4, Axe-Fx II, Hydrasynth,
unified dispatcher). These are the production tests.

- `verify-pack.ts` — AM4 pack/unpack 10-sample golden
- `verify-msg.ts` — AM4 built-vs-captured byte-exactness
- `verify-transpile.ts` — IR → command sequence
- `verify-axe-fx-ii-encoding.ts` — Axe-Fx II wire goldens
- `verify-axe-fx-ii-param-lookup.ts` — param resolver
- `verify-axe-fx-ii-lineage.ts` — lineage extractor regression
- `verify-dispatcher.ts` — unified BK-051 dispatcher
- `verify-cache-params.ts` — AM4Edit cache → params registry
- `verify-describe-inbound.ts` — inbound MIDI formatter
- `verify-echo.ts` — AM4 write-echo predicate
- `verify-enum-lookup.ts` — AM4 enum resolution
- `verify-preset-dump.ts` — preset-dump parser
- `verify-safety.ts` — factory-bank fingerprint + safety
- `verify-name-read-roundtrip.ts` — name read decoder

### MCP regression harnesses — drive the shipped server via stdio

`mcp-test-*.ts` files. Spawn `dist/server/index.js` via
StdioClientTransport (the same JSON-RPC path Claude Desktop uses) and
assert tool-level behavior. The canonical pattern per MCP community
guidance (modelcontextprotocol.io debugging guide).

- `mcp-test-preset-suite.ts` — 7 preset shapes through `axefx2_test_apply`
- `mcp-test-apply-preset.ts` — single-preset apply against a slot
- `mcp-test-safe-edit-scenarios.ts` — 7 contract scenarios from
  `docs/SAFE-EDIT-WORKFLOW.md`
- `mcp-test-am4-safe-edit.ts` — AM4 save-auth gate smoke
- `mcp-test-hydra-safe-edit.ts` — Hydrasynth save-auth gate smoke
- `mcp-test-unified-safe-edit.ts` — unified `apply_preset` gates
- `mcp-test-test-apply.ts` — `axefx2_test_apply` round-trip

### Smoke + build + setup

- `smoke-server.ts` — full server startup + tools/list assertion
- `build-installer.ts` — bundles `dist/`, Node, production deps into the
  Windows ZIP
- `copy-build-assets.ts` — copies non-TS data files into `dist/`
- `setup-claude-desktop.ts` — one-shot Claude Desktop config helper
- `build-type-knobs.ts` — generates AM4 type-applicability tables

### Active protocol probes + capture tools

For protocol reverse-engineering and decode work. Run when adding new
device support or decoding undocumented SysEx.

- `probe.ts` / `read-probe.ts` / `sanity-probe.ts` / `state-probe.ts` /
  `channel-probe.ts` — AM4 protocol probes
- `capture-midi-passive.ts` — passive USB MIDI capture
- `sniff.ts` — sniff dev tool
- `diff-syx.ts` — diff two .syx captures
- `scrape-wiki.ts` — refresh Fractal Audio wiki cache
- `check-axefx2-capture.ts` — quick Axe-Fx II capture sanity check
- `decode-usbpcap-axefx.ts` — pcapng decoder for USB MIDI traffic
- `diff-axefx2-grid-state.ts` — diff fn 0x20 grid responses
- `dump-axefx2-non-noise.ts` — filter capture noise
- `inspect-usbpcap-control-and-cables.ts` — USBPcap inspection
- `probe-axefx2-routing*.ts` — Session 70 fn 0x06 SET_CELL_ROUTING decode
  references
- `mcp-probe-axefx2-routing-slot666.ts` — MCP-driven probe pattern
- `verify-axefx2-routing-write.ts` — Session 70 wire-level oracle
- `test-axefx2-slot603-glassy-clean.ts` — Session 71 hardware test
- `probe-factory-restore.ts` — AM4 factory restore probe
- `write-test.ts` — AM4 write smoke

### Data generators

For regenerating the device registries from authoritative sources.

- `gen-params-from-cache.ts` — AM4Edit cache → params registry
- `extract-lineage.ts` — AM4 lineage corpus
- `extract-factory-data.ts` — AM4 factory bank
- `extract-axe-fx-ii-{catalog,params,lineage}.ts` — Axe-Fx II
  registries from the wiki cache

Run `npm run regen` to refresh all of them in one pass.

### Device-specific subdirectories

- `hydrasynth/` — Hydrasynth Explorer wire-format goldens and one-off
  diagnostics (wired via `npm run hydra:*` scripts).
- `frida/` — Frida instrumentation scripts (binary RE; one-off).
- `ghidra/` — Ghidra-driven decode notes (binary RE; one-off).
- `spdsx-td0/` — SPD-SX TD-0 binary RE (parked device).

### `_research/`

Historical RE one-offs from previous sessions — completed work whose
output landed in the source tree (`params.ts`, `blockTypes.ts`, etc.).
Preserved for git history reference but no longer part of any
workflow. Includes:

- AM4-Edit binary RE artifacts (`extract-*`, `find-*`, `parse-*`)
- Session-specific decode scripts (`decode-session-23.ts` etc.)
- Audit one-offs (`audit-*`, `bguide-alignment-test.ts`)
- Resolved probes (`probe-bypass-action-0d.ts` etc.)

If you're looking for an example of how a specific decode was done,
this is the archive. Don't run them blind — they reference local
files that may not exist in the current tree.
