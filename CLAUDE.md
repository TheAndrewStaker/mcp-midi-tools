# MCP MIDI Control — Claude Code Context

This file is read by Claude Code at the start of every session.

---

## Project Purpose
Build a local MCP server that lets Claude Desktop control a Fractal AM4
guitar amp modeler over USB/MIDI via natural language conversation.

## Current Phase
See **`docs/_private/STATE.md`** first. It names the current phase, the
single next action, and recent findings — start every session there.
`STATE.md` is kept current; the numbered plan docs (`01-PROJECT-VISION.md`,
`03-ARCHITECTURE.md`) are longer-lived reference.

Hardware tasks the founder owes (USB captures, round-trip tests on
the device, reference dumps) are queued per-device under
`docs/_private/`:
- **`HARDWARE-TASKS.md`** — index file pointing at per-device files.
- **`HARDWARE-TASKS-AXEFX2.md`** — Fractal Axe-Fx II XL+ tasks.
- **`HARDWARE-TASKS-AM4.md`** — Fractal AM4 tasks.
- **`HARDWARE-TASKS-HYDRASYNTH.md`** — ASM Hydrasynth Explorer tasks.
- **`HARDWARE-TASKS-ARCHIVE.md`** — closed tasks across all devices.

Each active file groups tasks as 📷 capture-required, 🎛️ desktop test,
or 💬 chat-only. Check the index at session start; if anything sits at
🔜 Pending in the relevant device's file, flag it before proceeding
with work that depends on it. When you identify a new hardware action
you can't perform yourself, append a `HW-NNN` entry to the right
device's file (NOT the index) with detailed steps the founder can
follow without re-reading the backlog.

`docs/_private/` is the founder's operational scratch (gitignored,
local-only): STATE, HARDWARE-TASKS, SESSIONS log, BACKLOG, HW-NNN test
plans, marketing drafts, internal data dumps. The committed `docs/`
files (`SYSEX-MAP.md`, `BLOCK-PARAMS.md`, `DECISIONS.md`,
`03-ARCHITECTURE.md`, `*-research.md`, `capture-guides/`, etc.) are the
OSS public good — protocol RE, architecture, decision log, research
artefacts — and DO ship in the repo.

> Phase 0 (feasibility) completed 2026-04-14. Phase 1 (protocol RE) is in
> progress — USB capture of AM4-Edit's outgoing traffic is the current
> blocker. See `_private/STATE.md` for exact next steps.

## Stack
- TypeScript / Node.js (**ES modules**, not CommonJS — `package.json` has
  `"type": "module"`, `tsconfig.json` uses `"module": "NodeNext"`)
- `tsx` is the TypeScript runner for scripts (not `ts-node`) — invoke via
  `npm run <script>` or `npx tsx <path>`
- node-midi for USB MIDI (native module — requires VS Build Tools on Windows
  dev machines; end users get a packaged `.exe` and need neither)
- @modelcontextprotocol/sdk for MCP
- No framework. No ORM. Keep it simple.

## Target User
A working guitarist with a Claude account — not a developer. Every UX,
install, and distribution decision prioritizes the non-technical user.
The MVP ships as a signed Windows `.exe` that configures Claude Desktop
automatically; users never install Node, a C++ toolchain, or edit JSON.
See `docs/DECISIONS.md` for the full reasoning and rejected alternatives.

## Decision Log
Non-obvious architectural and library choices live in `docs/DECISIONS.md`.
Read it before proposing changes to: the MIDI library, module system,
TypeScript runner, distribution model, or wiki-scrape workflow.

## External References
Manuals, protocol specs, factory preset banks, and generated working docs
are catalogued in `docs/REFERENCES.md`. Check there first before searching
the web — most common questions are answered by one of the local PDFs
(all extracted to `.txt` for grep-ability).

## AM4 SysEx Quick Reference

### Device ID
AM4 model byte: `0x15`

### Message Envelope
```
F0 00 01 74 15 [function] [payload...] [checksum] F7
```

### Checksum
```typescript
const checksum = bytes.reduce((a, b) => a ^ b, 0) & 0x7F;
// where bytes = everything from F0 through last payload byte
```

### Known Working Commands
```
Mode: Presets  — F0 00 01 74 15 12 48 4A F7
Mode: Scenes   — F0 00 01 74 15 12 49 4B F7
Mode: Effects  — F0 00 01 74 15 12 4A 48 F7
Mode: Amp      — F0 00 01 74 15 12 58 5A F7
Mode: Tuner    — F0 00 01 74 15 12 18 1A F7
```

### Preset-location Naming
A01–Z04 (104 preset locations total, 4 per bank, 26 banks A–Z). Use
`parseLocationCode` / `formatLocationCode` from `src/protocol/locations.ts`.

## Fractal terminology (use these exact words)

Fractal's docs use specific words for AM4 concepts. Our code and user-
facing strings MUST match, because one of the words — "slot" — has
opposite meanings in casual use:

| Term | What it means |
|---|---|
| **Bank** | A letter A–Z grouping 4 preset locations |
| **Preset** | The stored patch (blocks + params + scenes + name) |
| **Location** | Where a preset is stored. "A01" through "Z04", 104 total. NOT called a "slot" |
| **Slot** (or **effect slot**) | A position 1–4 in a preset's signal chain. The slot is the container; the block is what fills it |
| **Block** | The effect occupying a slot (amp, drive, delay, reverb, chorus, …) |
| **Scene** | One of 4 performance variations within a preset (bypass + channel state, not a copy of the blocks themselves) |
| **Channel** | Per-block A/B/C/D variation of that block's settings |

Anti-patterns to avoid:
- "preset slot" when you mean "preset location" (wrong — preset slots
  don't exist; presets occupy *locations*, not slots)
- "save to slot N" in user-facing text (wrong — "save to location N")
- "effect in slot 3" is correct; "effect in position 3" is also OK but
  "slot" matches Fractal's wording

## Safe-edit workflow (cross-device contract)

Every MCP tool that navigates or persists must enforce three gates,
applied consistently across AM4, Axe-Fx II, Hydrasynth, and any future
device:

1. **Buffer-dirty gate** (`on_active_preset_edited`). Before navigating
   away from the active preset, check `isDirty(device)`. If dirty and
   the caller didn't pass `'discard'` or `'save_active_first'`, refuse
   with a structured warning naming the active preset. Reference impl:
   `src/fractal/axe-fx-ii/tools/shared.ts:guardActiveBufferOrSave`.

2. **Save-authorization gate** (`save_authorized`). Tools that apply
   AND persist in one call (`*_apply_preset_at`, `hydra_apply_patch`
   with target slot) default to `save_authorized: false` and refuse
   unless the caller passed `true`. The agent should only pass `true`
   when the user used save-intent language (save / store / keep /
   put-on / persist).

3. **Multi-preset overwrite gate.** Multi-preset tools (`*_apply_setlist`)
   do NOT need `save_authorized` (multi-preset intent implies save),
   but MUST pre-flight scan the target range and surface what would be
   overwritten before writing.

Full contract + per-device implementation status in
`docs/SAFE-EDIT-WORKFLOW.md`. When adding a new device, port these
three gates before considering the device "production-ready."

Per-device fallback rules when a device's MIDI surface doesn't expose
a dirty-state signal:

- **Hydrasynth has no MIDI-exposed dirty signal.** Hydra tools omit
  `on_active_preset_edited` entirely. The `save_authorized` gate still
  applies. Document the limitation in tool descriptions so the agent
  asks the user before navigating instead of relying on the API gate.
- **AM4's device-sourced dirty signal is pending HW-107 capture.**
  Until that lands, AM4 uses a code-side send-classifier heuristic
  (mark dirty on outbound write-class messages, clean on switch/save).
  Drift-prone — temporary measure documented as such.

## Tool surface architecture

**Two surfaces ship in parallel through v0.1.0.**

1. **Unified surface** (`src/protocol/generic/tools.ts`) — port-
   dispatched, device-agnostic. `set_param(port, block, name, value)`,
   `get_param`, `apply_preset`, `switch_preset`, `save_preset`,
   `switch_scene`, `set_block`, `set_bypass`, `set_params`,
   `get_params`, `list_params`, `describe_device`, `rename`,
   `scan_locations`, `lookup_lineage`. 14 tools cover every registered
   device. Adding a new device means writing a schema descriptor
   (`src/<vendor>/<device>/descriptor.ts`) + wire adapter; no new
   tools. Dispatcher lives in `src/protocol/generic/dispatcher.ts`,
   types in `src/protocol/generic/types.ts`.

2. **Device-namespaced surface** (`am4_*`, `axefx2_*`, `hydra_*`) —
   first-generation pattern. Kept in parallel through v0.1 because
   the long tool descriptions carry device-specific behavioral
   guidance (AM4: relative-change discipline, tempo-sync model,
   channel/scene semantics, enum-naming conventions, reverb.type
   format) the LLM relies on during tone-building. Slated for removal
   in v0.3 once that guidance migrates into per-device
   `describe_device` responses.

**When adding a new tool, prefer the unified surface.** New device-
namespaced tools are technical debt — the unified surface is what
v0.3+ ships exclusively. If a new capability doesn't fit the unified
contract, design the contract change first (extend `DeviceWriter` /
`DeviceReader` / capabilities), then register the unified tool.

## Tool API conventions (project-wide)

**Display-first.** MCP tool inputs and outputs use **display units** —
the values a musician reads on the AM4 front panel or in the manual.
Enum-typed params accept the **display name** as a string. Wire and
protocol numbers (14-bit septet-encoded ints, packed-float bytes,
internal `value × scale` fixed-point) are an internal detail that
**never appears in tool surfaces**.

This contract is enforced by the unified surface's TypeScript types
(`ParamSchema.encode: (display: number | string) => number`) — every
descriptor's encoder must accept display input by signature. Errors
emit display-shaped messages (`"amp.gain out of range [0..10]: 12.5"`,
not `"wire value 0x4800 invalid"`). `WriteResult.display_value` is
what the LLM reads back. The unit label on each param passes through
verbatim from the descriptor (AM4's `knob_0_10`, `pf`,
`rotary_mic_spacing` etc. — open item #4 fix in Session B chunk 1) so
the LLM sees the words the device's manual uses.

This rule applies to **AM4 today and every future instrument** (a
parked Hydrasynth-explorer branch already follows it):

- `set_param({ block: 'amp', name: 'gain', value: 4.5 })` — display dB / 0-10 knob
- `set_param({ block: 'compressor', name: 'ratio', value: 4 })` — 4:1, not "wire 4"
- `set_param({ block: 'amp', name: 'type', value: 'Plexi 100W High' })` — enum string
- `apply_preset({ slots: [{ position: 1, block_type: 'amp', params: { gain: 6, bass: 5 } }] })` — display values throughout
- `set_block_type({ position: 1, block_type: 'reverb' })` — block name, not the wire enum index

The encoder/protocol layer translates display → wire and hides device-
specific scaling: Fractal's `value × scale` packed-float wire format,
14-bit septet encoding, bipolar centering, the per-block channel
register, etc. When adding a new tool or new device support:

1. **Surface accepts display values and enum strings.** Use the
   `resolveValue(param, value)` / `resolveEnumValue` helpers at the
   tool boundary so all tools share the same coercion.
2. **Encoders take wire values internally.** The tool layer does the
   display → wire conversion once at the entry point; everything below
   the tool function takes wire and stays type-checked against it.
3. **Tool descriptions list iconic examples in display units**, not
   wire numbers. e.g. "amp.gain accepts 0..10 (knob)" not "amp.gain
   accepts 0.0..1.0 (internal float)".

Rationale and rejected alternatives are in `docs/DECISIONS.md`
(2026-04-28 entry). Reference implementations on AM4:
`src/fractal/am4/params.ts:resolveEnumValue` (display name → enum int)
and `src/server/shared/paramHelpers.ts:resolveValue` (display value →
numeric, with range check + enum auto-resolve).

## Performance budget

MCP tool calls are part of a conversation. Users tolerate short waits
during overt batch actions, but individual tool calls should feel
instantaneous.

- **Ideal:** < 200 ms per tool call (single `set_param`, `set_block_
  type`, etc.). SysEx round-trips against the AM4 land in 30–60 ms,
  with a 300 ms ack window.
- **Acceptable:** < 1 s for tools that make 2–5 wire transactions
  (`apply_preset` with a handful of blocks and params).
- **Requires explicit progress:** anything > 1 s must tell the user
  upfront ("This will probe 16 preset locations, ~1 second"). Never
  make the user wait silently.
- **Avoid altogether:** designs that require > 5 s of wire work in a
  single conversational turn. Either cache, batch into a dedicated
  command, or design around the probe.

When writing new tool specs, estimate the wire-round-trip count
up front. SysEx is serial — N reads ≈ N × 50 ms minimum. If the math
says > 1 s, redesign before implementing.

## Key Constraints
- Windows ThinkPad. Use Windows paths where relevant.
- node-midi requires node-gyp / native build tools on Windows.
  If build fails, try: `npm install --global windows-build-tools`
- AM4 USB driver must be installed before any MIDI communication.
  Driver: https://www.fractalaudio.com/am4-downloads/
- Never write to a preset slot without reading it first.
- Always confirm before overwriting non-empty, non-factory slots.

## File Conventions
- All .syx binary samples + USB captures + decoded analysis outputs go
  in `samples/` — **the entire directory is gitignored**. Nothing in
  `samples/` is committed; treat it as local debug scratch.
- All reverse-engineering notes go in docs/SYSEX-MAP.md
- All block parameter tables go in docs/BLOCK-PARAMS.md
- Sniffing session logs go in docs/_private/SESSIONS.md
- Tests that require hardware are in tests/integration/ and skipped in CI

## Testing and sign-off

- **`npm run preflight`** is the single command to run before every
  commit. It runs `tsc --noEmit` and then `npm test`, which chains the
  three protocol-layer goldens:
  - `verify-pack` — 10-sample pack/unpack round-trip.
  - `verify-msg` — built messages vs. captured wire bytes (byte-exact,
    including checksum).
  - `verify-transpile` — IR → command sequence goldens.
- `npm test` alone runs just the goldens; handy for iterating on the
  protocol layer without waiting for the typecheck.
- `npm run test:jest` is reserved for future Jest-based unit tests (the
  scaffolding exists; there are no tests yet).
- **When adding a new pidHigh to `params.ts`, add a matching case to
  `verify-msg.ts` built from captured bytes.** That is the only guard
  against misreading septet-encoded pidHighs as little-endian bytes
  (the class of bug that hit Session 08 — see SYSEX-MAP.md §6a note).

## Verification sources of truth

For any test that needs to confirm "what does the device actually hold
right now," trust these in order:

1. **Front panel display** on the hardware itself. Ground truth.
2. **`axefx2_get_param` / `am4_get_param` response**. The device echoes
   its own display label in the response payload, so this is the wire-
   level truth as the device understands it.
3. **AxeEdit / AM4-Edit panel display.** Useful but **not authoritative**
   — editor apps cache UI state and can show stale or placeholder values,
   especially right after a block is placed (AxeEdit shows "Volume: 10.00"
   for a freshly-placed Volume/Pan block while the device's actual state
   is wire 0 = display 0.00; HW-086, 2026-05-11). If front panel or
   `get_param` disagrees with the editor, the editor is the one that's
   wrong. **Workaround** if the founder needs the editor in sync: close
   and reopen AxeEdit (or reload the preset in the editor) — that forces
   a fresh read from the device.

When writing a HW-NNN task that involves verifying behavior, name which
source the founder should read. Don't accept a "checked the editor, looks
right" report when the question is "did the write actually land."

## Rebuilding for Claude Desktop testing

Claude Desktop launches this MCP server from the **compiled
workspace build** (`node packages/server-all/dist/server/index.js`
per `claude_desktop_config.json`), not the TypeScript source. The
dist is loaded into Node once when the child process spawns;
overwriting source files on disk does NOT reach the live MCP server.

**If the founder will test your changes via a Claude Desktop conversation
(any `*_get_*` / `*_set_*` / `*_apply_*` / etc. MCP tool call), you MUST
do all three of these or the test will run against stale code:**

1. **`npm run preflight`** — per-package typecheck + goldens pass.
2. **`npm run build`** — rebuilds every package in dependency order
   (`@mcp-midi-control/core` → `@mcp-midi-control/am4|axe-fx-ii|
   hydrasynth-explorer` → `@mcp-midi-control/server-all`) and copies
   lineage JSON into `packages/core/dist/fractal-shared/lineage/`.
3. **Tell the founder to fully quit and relaunch Claude Desktop.** Just
   closing the window keeps the MCP server child alive in the tray — it
   has to be a full quit. The relaunch respawns the child from the new
   dist.

If you only changed test/verify scripts under `scripts/` (they run via
`tsx` directly, never via dist), `docs/`, or `samples/` — no rebuild
needed; preflight is enough.

**Default behavior at session end**: if you've edited any TypeScript
under `src/` and the next likely user action is "test it in Claude
Desktop", run `npm run build` automatically and surface the restart
reminder in your wrap-up text. Don't make the founder ask twice.

## Living documentation — update before declaring a session complete

Certain docs must stay current because future sessions (human and
Claude) consult them as source of truth. When the underlying thing
changes, the doc must change in the same session — not as a followup.
Cheaper than discovering drift later.

| Doc | Update when… |
|---|---|
| `docs/_private/STATE.md` | A substantive session happens. Always — it's the session-start orientation doc. Update "single next action" and any relevant "recent breakthroughs" entry. |
| `docs/_private/PROMPT-COVERAGE.md` | A new MCP tool ships, a protocol decode lands, or founder testing surfaces a new user prompt pattern. Flip ⚠ → ✅ when the blocker clears; flip ❌ → ⚠ when a research item gets a concrete decode plan; add new rows for unanticipated prompts. |
| `docs/_private/HARDWARE-TASKS.md` | A HW-NNN item completes (mark ✅ + capture outcome), or a new hardware action is identified that Claude can't perform alone (append HW-NNN with step-by-step instructions). |
| `docs/_private/04-BACKLOG.md` | A new backlog item is identified, an existing item ships / re-scopes / is superseded, or a cross-reference between items is worth recording. |
| `docs/SYSEX-MAP.md` | A new protocol decode is confirmed against captured bytes. Include the concrete capture reference and byte-exact example. (Public — protocol RE is the OSS public good.) |
| `docs/_private/SESSIONS.md` | A session produces a substantive finding worth a chronological entry (decodes, major tool changes, hardware-verified behavior). STATE.md is the summary; SESSIONS.md is the log. |
| `docs/DECISIONS.md` | A non-obvious architectural or library choice is made. (Public — committed for OSS contributors.) |

**Session-wrap check.** Before declaring work complete, walk the table
above and update whichever rows apply to what changed. A one-line
reply at session end naming which docs were updated helps the founder
verify nothing was missed.

## Do Not
- Do not use AM4-Edit as a dependency or requirement
- Do not hardcode preset-location values — always use the A01–Z04 naming
- Do not skip the safety read before any write operation
- Do not guess parameter names — verify against AM4 manual or sniffed data
- Do not issue any preset-store / save-to-location SysEx command from
  `scripts/probe.ts`. Probe is read-only forever.
- Do not auto-save after `apply_preset` — saves require an explicit
  save phrase from the user ("save this", "put it on M03", "keep it").
  `apply_preset` is reversible (switching presets discards the working
  buffer); save is not.
- Before overwriting a non-empty preset location, confirm with the
  user — read the current contents, surface what's there, and ask
  before clobbering. **Z04 remains the conventional scratch location**
  for try-it-out work; the historical hard-gate to Z04 was lifted
  Session 49 once HW-064 confirmed save-to-inactive-location is a
  real workflow (founder builds multiple presets per session by
  saving to different locations from the same working buffer).

---

# Claude Project Setup Instructions

These instructions are for setting up the **Claude.ai Project** that will
serve as the knowledge base and planning environment for this app.
(Different from Claude Code — this is the conversational project.)

## What Goes in the Claude Project

### Required Knowledge Files
Upload these to the project's knowledge base:

1. **AM4 Owner's Manual** (PDF)
   - Download from: https://www.fractalaudio.com/am4-downloads/
   - This is the primary reference for all parameter names and navigation

2. **AM4 Block Parameter Reference** (when built)
   - src/knowledge/ files exported as readable reference
   - All effect type names, parameter ranges, channel behavior

3. **This planning document set**
   - 01-PROJECT-VISION.md
   - 02-FEASIBILITY-PROOF-PLAN.md
   - 03-ARCHITECTURE.md
   - 04-BACKLOG.md

4. **Amber 311 Build Sheet** (example of target output quality)
   - The preset build sheet already created in the other project
   - Shows the depth of research and parameter detail expected

### Project System Prompt (for Claude Project)

```
You are the MCP MIDI Control assistant — a Claude Project that helps the user
configure their Fractal AM4 guitar amp modeler through natural conversation.

## How to respond to requests

The AM4 is controlled via a local MCP server (`mcp-midi-control`) that exposes
tools like `apply_preset`, `set_param`, `set_params`, `switch_preset`,
`save_preset`, `set_scene_name`, `switch_scene`, and related controls.

Default behavior: USE THE TOOLS. When an AM4-related request comes in
(build a preset, change a tone, switch scenes, rename a preset, etc.),
your first move is to check whether the `mcp-midi-control` connector is
attached to this conversation. Claude Desktop surfaces MCP tools as
*deferred* — their names may be visible in the tool panel but their
schemas may not be in context until you load them. Always check the
deferred tool list for `mcp-midi-control` tools on any AM4-related
request, load the relevant schemas, and execute the change on hardware.
Do not fall back to producing a spec just because the schemas aren't
already loaded.

Spec-only mode is reserved for when the user explicitly asks for a
dry run, a design exercise, or a copy-pasteable preset document — e.g.
"what would the params look like for…", "draft a preset I can review
before pushing", "design a tone sheet without touching the hardware".
Absent that signal, assume the user wants the change made on the
hardware, not described on paper.

If the `mcp-midi-control` connector genuinely isn't attached (no AM4
tools in the deferred or loaded tool list), say so up front and stop
— don't silently fall back to writing a spec, since the user may not
realize the connector is disconnected.

## What the tools currently can and can't do

Tools land incrementally — before promising a behavior to the user,
check what the tool response actually says happened, not what would
make narrative sense. In particular:

- `apply_preset` writes block layout and per-channel params, but
  scene→channel assignment is a separate write (decoding in progress).
  The final active channel after `apply_preset` is whichever channel
  was walked last, not necessarily the one the user described as
  "scene 1's clean tone". If you set up a multi-channel amp, report
  which channel is currently active — don't assert that scene N will
  show channel X unless you've explicitly issued a scene→channel
  write for it.
- All param writes target "whichever channel is active right now" on
  the referenced block. If you need a param on channel D, the tool
  has to switch to D before writing. The tool's per-channel map
  handles this when you use it; ad-hoc `set_param` calls do not.
- Ack-less writes are usually a stale MIDI handle. If a tool response
  suggests `reconnect_midi`, follow that lead rather than retrying.

## Verification discipline

1. Never guess parameter names or type names — verify against the AM4
   Owner's Manual in the knowledge base. Flag anything you can't
   confirm with `[FLAG — VERIFY]`.
2. When building presets for a specific artist/song, research the
   artist's verified gear for that recording era, not a generic tone.
3. When producing a full preset (executed or speccced), think through
   all 4 slots, all 4 scenes, and every channel in use — never emit
   a partial config.

## Fractal terminology (exact words matter)

| Term | Meaning |
|---|---|
| Bank | A letter A–Z grouping 4 preset locations |
| Preset | The stored patch |
| Location | Where a preset lives. "A01" through "Z04" (104 total). NOT a "slot" |
| Slot | A signal-chain position 1–4 inside a preset. NOT a preset location |
| Block | The effect occupying a slot |
| Scene | One of 4 per-preset performance variations (selects per-block channel + bypass; not a copy of the block params) |
| Channel | Per-block A/B/C/D parameter variation |

Anti-patterns:
- "preset slot N" → wrong; say "preset location N"
- "save to slot 49" → wrong; say "save to location M01"
- "effect in slot 3" → correct (slot here means signal-chain position)

## AM4 structural facts

- 4 effect slots per preset (linear or simple parallel routing)
- 4 scenes per preset
- Up to 4 channels per block
- 104 preset locations total (A01 through Z04, 26 banks × 4)
- Write safety: in dev sessions the scratch location is Z04. For
  production users, confirm before overwriting any non-empty preset
  location — never write blind.
```

## Connecting Claude Desktop MCP (when server is ready)

Edit: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-midi-control": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-midi-control\\packages\\server-all\\dist\\server\\index.js"],
      "env": {}
    }
  }
}
```

Restart Claude Desktop after editing. The AM4 tools will appear in the
tools panel when the server starts successfully.
