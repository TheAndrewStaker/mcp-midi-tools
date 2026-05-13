# MCP MIDI Tools

Talk to Claude. Control your MIDI gear.

MCP MIDI Tools is a local [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server that lets Claude drive USB MIDI hardware in plain English.
First-class support today for the **Fractal Audio AM4** guitar amp
modeler — block layout, amp type, drive, delay, reverb, scenes, and
preset naming all updateable in real time. Five generic-MIDI primitives
work against any CC/NRPN/SysEx-addressable device, so synths, looper
pedals, and other gear are reachable from day one.

> **Unaffiliated community tool.** "Fractal Audio", "AM4", and related
> product names are trademarks of Fractal Audio Systems, Inc. This project
> neither claims endorsement from, nor affiliation with, Fractal Audio
> Systems. It communicates with AM4 hardware the user already owns via
> SysEx messages. See [`NOTICE`](./NOTICE) for the full trademark
> statement.

---

## Status

v0.1.0 — first public release. The protocol layer is hardware-verified
across Fractal AM4, Axe-Fx II XL+, and ASM Hydrasynth Explorer; 84 MCP
tools are live; every wire-level tool ships with byte-exact goldens
against real captures. Axe-Fx II preset authoring is audio-confirmed
end-to-end on Q8.02 firmware — building "Comp + Amp + Cab + Reverb" in
chat saves an audible preset on a fresh-empty slot, no manual
re-routing in AxeEdit required.

Tools split across two surfaces:

- **Unified surface** (17 tools) — port-dispatched, device-agnostic.
  `set_param(port, block, name, value)`, `get_param`, `apply_preset`,
  `apply_setlist`, `switch_preset`, `save_preset`, `switch_scene`,
  `set_block`, `set_bypass`, `set_params`, `get_params`, `list_params`,
  `describe_device`, `rename`, `scan_locations`, `lookup_lineage`,
  `restore_defaults`. Same tool name works against any registered device
  — the `port` argument picks the device. Adding a new device means
  registering a schema descriptor; no new tools. AM4 and Axe-Fx II both
  ship as descriptors today (BK-051 Wave 2); Hydrasynth descriptor lands
  next session.
- **Device-namespaced surface** (`am4_*`, `axefx2_*`, `hydra_*` — ~65
  tools) — first-generation tool pattern, kept in parallel through
  v0.1. Carries device-specific behavioral guidance in tool
  descriptions (AM4: relative-change discipline, tempo-sync model,
  channel/scene semantics, enum-naming conventions) the LLM relies on
  during tone-building. Slated for removal in v0.3 once that guidance
  migrates into per-device `describe_device` responses.
- **Generic-MIDI primitives** (13 tools) — `send_cc`, `send_note`,
  `send_program_change`, `send_nrpn`, `send_sysex`, plus `send_panic`,
  `send_pitch_bend`, `send_clock_*`, etc. Work against any USB MIDI
  device the OS exposes.

Distribution is a Windows ZIP that bundles a Node runtime plus the
server — no Node or developer tooling required. A signed `.exe`
installer is planned for v0.2 once we have install-friction data
from real users.

---

## What you can ask Claude to do today

Once connected, Claude can:

- **Build a full preset in one sentence.** *"Build me a clean preset with
  a compressor, a Deluxe Verb Normal amp at gain 4 and bass 6, a 350 ms
  analog delay, and a Deluxe spring reverb at 35% mix."*
- **Tweak individual params.** *"Drop the gain to 3 and bump the reverb
  mix to 50%."*
- **Place, clear, or change effect blocks.** *"Put a Klon-style drive in
  slot 1 and swap the reverb for a plate."*
- **Name and save presets.** *"Save this to Z04 and call it 'Clean
  Machine'."*
- **Manage scenes.** *"Name scene 2 'verse', scene 3 'chorus', scene 4
  'solo'."* / *"Switch to scene 3."*
- **Research tones by real gear.** *"What's the closest drive to a
  Klon?"* / *"Which amp on the AM4 is inspired by a Matchless DC-30?"*
- **Switch presets.** *"Load A01."*

Under the hood Claude picks one of 84 tools and sends SysEx (or CC /
NRPN / etc.) to the device. Tool round-trips land in roughly 30–60 ms;
whole-preset builds take under a second.

The unified surface (`set_param`, `get_param`, `apply_preset`,
`switch_preset`, `save_preset`, `switch_scene`, `set_block`,
`set_bypass`, `lookup_lineage`, `scan_locations`, `describe_device`,
…) works against any registered device — pass the `port` argument and
the dispatcher routes to the right device. Device-namespaced tools
(`am4_*`, `axefx2_*`, `hydra_*`) ship in parallel and carry deeper
device-specific guidance until v0.3.

Generic-MIDI primitives (`send_cc`, `send_note`, `send_program_change`,
`send_nrpn`, `send_sysex`, …) work against any USB MIDI device the OS
exposes, not just registered hardware. See [Generic MIDI
quick-start](#generic-midi-quick-start) below.

---

## Requirements

- **Windows 10/11.** macOS / Linux builds are a future item (P5-006).
- **Fractal AM4** connected by USB with Fractal's AM4 USB driver
  installed ([downloads](https://www.fractalaudio.com/am4-downloads/)).
- A Claude client that supports MCP — [Claude Desktop](https://claude.ai/download),
  [Claude Code](https://docs.claude.com/en/docs/claude-code), or any
  other MCP-capable host.
- For source-installs only: Node.js 18+ and Visual Studio Build Tools
  (to compile the `node-midi` native module). The release ZIP bundles
  Node so end users do not need either.

AM4-Edit can stay open while the MCP server runs — Windows MIDI ports
are shareable. If a tool call doesn't reach the device, see the
troubleshooting tips for port-not-found errors.

---

## Install

### From the release ZIP (recommended)

1. Download `mcp-midi-tools-v0.1.0.zip` from [the latest release](https://github.com/TheAndrewStaker/mcp-midi-tools/releases/latest).
2. Right-click the ZIP, choose Properties, tick **Unblock**, then
   click OK. (Windows tags downloaded files with a "came from another
   computer" flag; unblocking now avoids per-file warnings later.)
3. Extract the folder anywhere you like — your home directory, an
   Apps folder, wherever.
4. Make sure Claude Desktop is fully closed (system tray right-click
   → Quit, not just the window's X).
5. Double-click `setup.cmd` inside the extracted folder. A console
   window opens, registers the server with Claude Desktop, and waits
   for a keypress.
6. Open Claude Desktop. The mcp-midi-tools server appears in the
   connector panel (the + button near the chat input).

To uninstall: double-click `uninstall.cmd` to remove the entry from
Claude Desktop's config (any other MCP servers you have stay intact),
then delete the extracted folder.

> **Note on signing.** v0.1.0 ships unsigned to keep the project free.
> Windows shows a "this came from another computer" warning until you
> Unblock. The source is open here on GitHub if you want to read every
> line of the install scripts before running them. A signed `.exe`
> installer is on the v0.2 roadmap.

### From source (for development or contributing)

Clone the repo, install dependencies, and run the hardware smoke test:

```bash
git clone https://github.com/TheAndrewStaker/mcp-midi-tools.git
cd mcp-midi-tools
npm install
npm run preflight    # typecheck + protocol goldens + MCP smoke test
npm run write-test   # changes amp gain on the device — confirms MIDI path
```

If `write-test` flips the amp gain on the AM4's display, the hardware
path is good. Then register the server with Claude Desktop in one
command:

```bash
npm run setup-claude-desktop
```

This builds `dist/`, detects whether you have the direct-download or
Microsoft Store variant of Claude Desktop (or both), and writes our
entry into the right `claude_desktop_config.json` without disturbing
other MCP servers you have. Restart Claude Desktop fully (system tray
→ Quit) and the tools appear in the connector panel.

After source changes that touch `src/`, run `npm run setup-claude-
desktop` again (it re-runs the build + re-writes the config) and
restart Claude Desktop — Claude Desktop runs the compiled `dist/`
output, not the TypeScript source, so a rebuild is required for
changes to take effect.

> Windows-only for now. macOS / Linux source installs work (preflight
> + smoke pass cleanly) but the bootstrap script relies on PowerShell.
> Mac / Linux contributors hand-edit `claude_desktop_config.json` per
> [Connect to Claude](#connect-to-claude) Option 1 below.

---

## Connect to Claude

> If you installed from the release ZIP, `setup.cmd` already
> registered the server with Claude Desktop. Skip ahead to
> [Confirm it works](#confirm-it-works) — the options below are for
> source installs and non-Claude-Desktop MCP clients.

### Option 1 — Claude Desktop (GUI config)

Run `npm run build` first to produce `dist/`. Then edit Claude
Desktop's config and add the entry below.

**Where the config file lives:**

| Claude Desktop variant | Config path |
|---|---|
| Windows — direct download | `%APPDATA%\Claude\claude_desktop_config.json` |
| Windows — Microsoft Store | `C:\Users\<you>\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

If the file doesn't exist, create it. If both Windows variants of
Claude Desktop are installed, edit both files. macOS users replace
the Windows path in the JSON below with their `dist/server/index.js`
absolute path (e.g. `/Users/you/code/mcp-midi-tools/dist/server/index.js`)
and use forward slashes.

```json
{
  "mcpServers": {
    "mcp-midi-tools": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-midi-tools\\dist\\server\\index.js"],
      "env": {}
    }
  }
}
```

Adjust the path. Fully quit Claude Desktop (system tray → Quit, not
just the window's ✕) and relaunch. The tools appear under the **`+`
button → Connectors** in a new chat.

> The bootstrap script `npm run setup-claude-desktop` automates all
> of this — runs the build, detects which Claude Desktop variant(s)
> are installed, writes the config without disturbing other MCP
> servers. Skip this option entirely if you ran that.

> **Why not `npx tsx <src/...>`?** It looks tempting (no build step!)
> but Claude Desktop spawns the MCP server with cwd set to
> `C:\Windows\System32`, so `tsx` can't find the project's
> `tsconfig.json` and the `@/` path aliases fail to resolve.
> `node dist/server/index.js` works because `tsc-alias` rewrites
> the aliases to relative paths at build time.

### Option 2 — Claude Code (CLI)

From your project directory, after `npm run build`:

```bash
claude mcp add mcp-midi-tools -- node C:\path\to\mcp-midi-tools\dist\server\index.js
```

Then start `claude` and the tools are available in your session.

### Option 3 — Any MCP client (raw stdio)

For development, launch with:

```bash
npm run server   # tsx-based, picks up source changes immediately
```

For wiring into another MCP client (cwd-agnostic):

```bash
node C:\path\to\mcp-midi-tools\dist\server\index.js
```

The server speaks MCP over stdio in either case.

---

## MCP host compatibility

The server implements the open [Model Context Protocol](https://modelcontextprotocol.io)
spec, so it works with any spec-compliant MCP host. The protocol layer
is host-agnostic; only the config file location differs.

| Host | Status | Config location |
|---|---|---|
| **Claude Desktop** (Anthropic) | ✅ Primary target | `claude_desktop_config.json` (per-platform path; `npm run setup-claude-desktop` finds it for you) |
| **Claude Code** (CLI) | ✅ Tested | `claude mcp add` registers it; or `~/.claude.json` |
| **Cursor** | ✅ Spec-compliant, works | `.cursor/mcp.json` (project) or global settings |
| **Windsurf** (Codeium) | ✅ Spec-compliant | `~/.codeium/windsurf/mcp_config.json` |
| **Continue.dev** (VS Code) | ✅ Spec-compliant | `~/.continue/config.json` |
| **VS Code GitHub Copilot Chat** | ✅ Spec-compliant | VS Code settings → `chat.mcp.servers` |
| **Cline / Roo Code** (VS Code) | ✅ Spec-compliant | Extension-specific JSON |
| **LM Studio, Goose, Ollama-based hosts** | ✅ Most support MCP | Per-host config |
| **ChatGPT Desktop** (OpenAI) | 🟡 Partial — MCP support added 2025; tool descriptions on this project are large (~10 KB), may hit description-length limits in some surfaces | OS-specific |
| **Microsoft Copilot Studio** | 🟡 Better for cloud-hosted MCP servers than local-stdio | Azure-side |
| **Google Gemini first-party** | ⚠️ Native MCP not shipped at the time of writing; Gemini Extensions / function-calling is similar-but-distinct. Adapter layers exist | Adapter-specific |

The JSON shape is near-universal across hosts:

```json
{
  "mcpServers": {
    "mcp-midi-tools": {
      "command": "node",
      "args": ["/path/to/dist/server/index.js"]
    }
  }
}
```

What differs per host: the file location, the top-level key name (some
use `mcpServers`, some `mcp.servers`), and whether they honor `cwd` /
`env` fields (Claude Desktop does not honor `cwd` — that's why we
recommend the absolute-path-to-`dist` setup rather than `tsx` against
source). After editing whichever config your host uses, restart it.

Primary target is Claude Desktop because of how cleanly the
Connectors panel surfaces tool calls — but any spec-compliant host
should work. Hardware features (USB MIDI, the AM4 / Axe-Fx II
drivers) are the same regardless of host.

---

## Confirm it works

1. Open a new chat in your Claude client. Make sure the AM4 is powered
   on and connected by USB.
2. Ask: **"Using mcp-midi-tools, list the MIDI ports you can see."**
   Claude calls `list_midi_ports` and reports a verdict like *"AM4
   detected (in: AM4, out: AM4)"*. If it says the AM4 isn't visible,
   replug the USB cable.
3. Ask: **"Place a compressor in slot 1 and set the level to 6."**
   Watch the AM4 display — slot 1 should flip to Compressor and the
   level knob should jump to 6. Round-trip is under a second.

If step 3 works, you're done. Move on to building full presets.

### Troubleshooting

- **"AM4 not found in MIDI device list"** — the server couldn't open
  the USB port. Check the AM4 is powered on, the USB cable is seated,
  and the driver is installed. Power-cycle the AM4 if needed.
- **Tool call hangs in Claude Desktop** — the server writes to MIDI
  synchronously, so hangs usually mean `node-midi` couldn't load.
  Check Claude Desktop's MCP log for stderr output from the server.
- **Parameter out of range** — `set_param` validates against the
  parameter's `displayMin`/`displayMax`. Ranges are derived from the
  AM4's own metadata cache.

---

## The 84 tools at a glance

### Unified surface (17) — port-dispatched, device-agnostic

Same tool name works against every registered device. Pass `port` to
select which device (id, display_name, or any MIDI port-name substring
match). Adding a new device means writing a schema descriptor + wire
adapter; no new tools.

| Tool | What it does |
|---|---|
| `describe_device(port)` | Capabilities + canonical vocabulary + block roster. Pure introspection. Call once per session to learn what a device offers. |
| `list_params(port, block?, name?)` | Enumerate named params. With `block`+`name` on an enum-typed param, returns the full enum table. |
| `get_param(port, block, name, channel?)` | Single read, returns display-shaped value. |
| `set_param(port, block, name, value, channel?)` | Single write. Display values for numerics ("4.5"); enum names or wire index for enums. |
| `get_params(port, queries[])` | Batch read. Continues past per-query failures. |
| `set_params(port, ops[])` | Atomic batch write — validates every entry up-front. |
| `set_block(port, slot, block_type)` | Place/clear a block at a slot. |
| `set_bypass(port, block, bypassed)` | Silence/activate a block on the active scene. |
| `apply_preset(port, spec, target_location?)` | Build a whole preset in one call (blocks + params + scenes + name). Without `target_location`, writes to the working buffer only; with it, switches to the target slot and saves. |
| `apply_setlist(port, entries[])` | Batch preset write across N entries. Each entry has the same shape as `apply_preset`. |
| `switch_preset(port, location)` | Load a stored preset into the working buffer. |
| `save_preset(port, location, name?)` | Persist working buffer (optional rename first). Only on explicit user save phrase — apply_preset is reversible, save_preset is not. |
| `switch_scene(port, scene)` | Switch scene. Capability-gated (devices without scenes reject). |
| `rename(port, target, name)` | Rename `'preset'` or `'scene:N'`. Working-buffer scope; pair with `save_preset` to persist. |
| `scan_locations(port, from, to)` | Bulk-scan stored preset names across a location range. Setlist-load opener. |
| `lookup_lineage(port, block_type, query)` | Authored lineage data — real-hardware inspiration, manufacturer/model, developer quotes. AM4 + Axe-Fx II ship lineage corpora. |
| `restore_defaults(port, from, to?)` | Reset a single location or inclusive range to factory state. Capability-gated; only devices with `supports_factory_restore=true` (currently AM4) honor it. |

### Device-namespaced — AM4 (30, slated for v0.3 removal)

| Tool | What it does |
|---|---|
| `apply_preset` | Build a whole preset in one call (blocks, per-channel params, scenes, optional name). Working buffer only; does not save. |
| `set_param` | Write one parameter (amp gain, reverb mix, …). |
| `set_params` | Batch write. Validates the whole batch before any MIDI leaves. |
| `set_block_type` | Place a block (amp, drive, reverb, …) in a signal-chain slot. |
| `set_block_bypass` | Silence / activate a block on the currently-active scene. |
| `save_to_location` | Persist the working buffer to a preset location (gated to Z04 until factory-safety ships). |
| `set_preset_name` | Rename the working-buffer preset. |
| `save_preset` | One-shot rename + save. |
| `set_scene_name` | Rename a scene in the working buffer. |
| `switch_preset` | Load a preset (A01–Z04). |
| `switch_scene` | Switch to scene 1–4. |
| `get_active_location` | Read the currently-loaded preset location. |
| `get_active_scene` | Read which scene (1..4) is currently selected. |
| `get_block_layout` | Read what's in each of the four signal-chain slots. |
| `get_block_bypass` | Read whether a block is bypassed in the active scene. |
| `get_param` | Read one parameter's current value. |
| `get_params` | Batch read. Pairs naturally with `set_params` for "read, summarize, confirm, write" flows. |
| `list_params` | Describe every param Claude can write. |
| `list_block_types` | List the block types that fit each slot. |
| `list_enum_values` | List enum choices for a given param (e.g. all amp types). |
| `list_midi_ports` | Diagnose the USB/MIDI connection (any device; tags AM4 by default). |
| `reconnect_midi` | Force-reopen the AM4 handle after an AM4-Edit excursion (also accepts a `port` arg for non-AM4 devices). |
| `lookup_lineage` | "What real amp inspired this?" / "Find me a Klon-style drive." |
| `am4_test_navigate` | Diagnostic tool — drives the AM4's mode-switch envelope for protocol smoke-testing. |

### Device-namespaced — Axe-Fx II XL+ (21, slated for v0.3 removal)

Same shape as the AM4 surface. Wire-format-verified end-to-end as of
Session 62; setlist build round-trip lands in ~6–10s for a 3-preset
batch. The unified surface ALSO dispatches against the Axe-Fx II via
its own `DeviceDescriptor` (Session 67, BK-051 Wave 2) — call
`set_param(port='axe-fx-ii', block='amp', name='bass', value=6.0)`
to route through the unified path.

### Device-namespaced — ASM Hydrasynth Explorer (14, slated for v0.3 removal)

Patch-based architecture (no scenes). `hydra_apply_patch`,
`hydra_set_param`, `hydra_set_engine_params`, `hydra_set_macro`, etc.
NRPN-driven engine. The Hydrasynth `DeviceDescriptor` (BK-031, post-
Session 67) is the next item on the BK-051 Wave 2 roadmap; until it
ships, the unified surface routes Hydrasynth calls through the
namespaced tools.

### Generic MIDI primitives (13)

Work with any USB MIDI device the OS exposes. Channels are 1..16 at the
tool boundary (musician convention); the wire layer converts to 0..15
once. Reach for these primitives when the target device doesn't have a
registered descriptor yet, or when you want to send raw MIDI rather
than addressing named params.

| Tool | What it does |
|---|---|
| `send_cc` | Send a Control Change. Channel 1..16, controller 0..127, value 0..127. |
| `send_note` | Play a note (Note On + Note Off after `duration_ms`, default 500, max 5000). |
| `send_program_change` | Switch patches. Optional Bank Select MSB/LSB prefix. |
| `send_nrpn` | Write a Non-Registered Parameter Number. 7-bit by default; `high_res: true` unlocks 14-bit values (0..16383). |
| `send_sysex` | Send a raw System Exclusive frame. Validates F0/F7 framing; otherwise sends bytes verbatim. |
| `send_panic` | All notes off + reset controllers across all 16 channels. |
| `send_pitch_bend` | 14-bit pitch bend (-8192..+8191). |
| `send_channel_pressure` | After-touch / aftertouch on a channel. |
| `send_song_position` | MIDI clock song-position pointer. |
| `send_reset_controllers` | Reset all controllers on a channel. |
| `send_clock_start` / `_stop` / `_continue` | MIDI clock transport commands. |
| `list_midi_ports` | Enumerate input/output ports the OS exposes. |
| `reconnect_midi` | Force-reopen a stale MIDI handle. |

Full tool descriptions surface inside Claude automatically (just ask).

---

## Generic MIDI quick-start

The five `send_*` primitives let Claude drive any MIDI device with a
published implementation chart. Below are conversational examples
targeting non-AM4 gear so the generality is obvious; substitute the
`port` substring for whatever name your device shows up as in
`list_midi_ports`.

**Tweak a synth filter cutoff (CC 74).** Most synths follow the standard
MIDI CC chart for tone-shaping controls.

> *"Set the filter cutoff on my Hydrasynth to 80."*

Claude calls:

```
send_cc { port: "hydra", channel: 1, controller: 74, value: 80 }
```

**Play a single note.** Useful for confirming a synth is responding and
for one-shot triggers.

> *"Play middle C on the Hydrasynth for half a second."*

```
send_note { port: "hydra", channel: 1, note: 60, velocity: 100, duration_ms: 500 }
```

**Switch patches with a bank select.** Devices that expose more than 128
patches need a Bank Select prefix before the Program Change.

> *"Load patch 12 on bank 2 of the Hydrasynth."*

```
send_program_change { port: "hydra", channel: 1, program: 12, bank_msb: 0, bank_lsb: 2 }
```

**Address a 14-bit NRPN.** Some synths expose deeper engine controls
through NRPN at higher resolution than CC.

> *"Set Hydrasynth NRPN parameter (0, 74) to 8192 in 14-bit mode."*

```
send_nrpn { port: "hydra", channel: 1, parameter_msb: 0, parameter_lsb: 74, value: 8192, high_res: true }
```

**Send a raw SysEx frame.** The escape hatch for ad-hoc reverse
engineering or one-offs that don't have a wrapper yet.

> *"Send these bytes to the AM4 verbatim: F0 00 01 74 15 12 4A 48 F7"*

```
send_sysex { port: "am4", bytes: [0xF0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x4A, 0x48, 0xF7] }
```

Tools default to the AM4 only on `reconnect_midi` and `list_midi_ports`;
every `send_*` tool requires the `port` argument explicitly so there's
no ambiguity about which device is being driven.

---

## Opinionated UX guarantees

This project takes opinionated stances about destructive operations
on your hardware. Across **every** supported device (AM4, Axe-Fx II,
Hydrasynth, and any device added later), the same rules apply:

**No silent saves.** When you ask Claude to "build a tone at slot 700"
the tool builds it in the working buffer — you can audition immediately
— but does **not** save to slot 700 unless you also said "save it" /
"store it" / "put it on 700" / similar. The only exception is multi-
preset requests ("build a setlist for 700/701/702"), where save intent
is implicit because a setlist without persistence isn't a setlist.

**No silent edit loss.** If you've been tweaking a preset and then ask
Claude to do something that would navigate away from it (load another
preset, build at a different slot), the tool refuses and asks "you
have unsaved edits on slot Y — save first, discard, or cancel?" before
it touches anything. The dirty-state detection is device-sourced where
the hardware exposes it (Axe-Fx II via state-broadcast — confirmed) and
heuristic-fallback where it doesn't (AM4 pending decode, Hydrasynth has
no MIDI-exposed dirty signal — limitations are documented per-tool).

**No silent overwrites.** Multi-preset requests pre-flight scan the
target range before writing. If any target slot already holds a named
preset, the tool surfaces what would be lost so Claude can ask you to
confirm before proceeding.

**Every write is acknowledged.** `set_param` and friends wait for the
device's write echo (up to 300 ms on AM4, configurable on Axe-Fx II)
before returning success. "The tool succeeded" means "the device
actually took the write." No silent fail.

**Read-only probes stay read-only.** `scripts/probe.ts` and the
`axefx2_probe_sysex` diagnostic tool never issue store/save SysEx —
they're the designated safe introspection paths for protocol RE.

See [`docs/SAFE-EDIT-WORKFLOW.md`](./docs/SAFE-EDIT-WORKFLOW.md) for
the full contract, including the per-device implementation table and
the test scenarios every device must pass.

---

## Project layout

```
src/
├── server/                       # MCP server boot
│   ├── index.ts                  # one register*Tools(server) call per
│   │                             #   device + 2 generic-MIDI families
│   ├── shared/                   # cross-tool helpers (connection registry,
│   │                             #   channel cache, wire-op timeline,
│   │                             #   readOps, paramHelpers)
│   └── tools/                    # device-AGNOSTIC tool families
│       ├── midi-primitives.ts    #   send_cc / _note / _program_change /
│       │                         #   _nrpn / _sysex (any MIDI device)
│       └── midi-control.ts       #   list_midi_ports / reconnect_midi
├── fractal/                      # Fractal Audio devices
│   ├── am4/                      # AM4
│   │   ├── tools/                #   AM4 MCP tool surface (split by
│   │   │   ├── index.ts          #     family — apply.ts is 1633 LOC)
│   │   │   ├── apply.ts          #   index.ts exports registerAM4Tools()
│   │   │   ├── read.ts
│   │   │   ├── write.ts
│   │   │   ├── navigation.ts
│   │   │   ├── factory.ts
│   │   │   ├── lookup.ts
│   │   │   ├── lookup-lineage.ts
│   │   │   └── diagnostics.ts
│   │   └── (params, setParam, blockTypes, locations,
│   │        factoryBank, midi.ts, …)
│   ├── axe-fx-ii/                # Axe-Fx II XL+
│   │   ├── tools.ts              #   single-file tool surface
│   │   └── (params, setParam, blockTypes, midi.ts, …)
│   └── shared/                   # cross-Fractal helpers (lineage data, …)
├── asm/
│   └── hydrasynth-explorer/      # ASM Hydrasynth (single-file tool surface)
└── core/                         # generic-MIDI message builders (used by
                                  #   the device-agnostic send_* tools)
docs/                             # protocol reference, decisions, research
samples/captured/                 # RE captures + decoded cache data (gitignored)
scripts/                          # probes, verifiers, smoke test
```

**Adding a new device.** Drop your wire layer + tool surface under
`src/<vendor>/<device>/`, export a `register<Device>Tools(server)` that
adds your tools to the MCP server, and register it in
`src/server/index.ts`. Single-file tool surface (axefx2 / hydrasynth
pattern) is the default; multi-file with an `index.ts` aggregator (AM4
pattern) is for devices with a tool family large enough that one file
becomes unwieldy.

- [`docs/03-ARCHITECTURE.md`](./docs/03-ARCHITECTURE.md) — system overview
  + per-layer responsibilities.
- [`docs/SYSEX-MAP.md`](./docs/SYSEX-MAP.md) — AM4 wire protocol reference.
- [`docs/SYSEX-MAP-AXE-FX-II.md`](./docs/SYSEX-MAP-AXE-FX-II.md) —
  Axe-Fx II wire protocol reference.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — non-obvious architectural
  + library choices, with rationale and rejected alternatives.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Short version: run
`npm run preflight` locally before opening a PR, and add a byte-exact
golden against a real capture if you touch the wire protocol.

Security issues: see [`SECURITY.md`](./SECURITY.md).

---

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
