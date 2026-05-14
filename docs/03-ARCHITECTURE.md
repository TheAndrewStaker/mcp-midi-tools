# Architecture — MCP MIDI Control

## System Overview

```
┌─────────────────────────────────────────────────────┐
│  Claude Desktop (claude.ai)                         │
│  User types: "Amber by 311, 4 scenes"               │
└──────────────────────┬──────────────────────────────┘
                       │ MCP protocol (stdio)
┌──────────────────────▼──────────────────────────────┐
│  MCP Server  (Node.js / TypeScript)                 │
│  — Tool definitions                                 │
│  — Tone research context                            │
│  — Preset safety logic                              │
│  — Slot management                                  │
└──────────────────────┬──────────────────────────────┘
                       │ TypeScript function calls
┌──────────────────────▼──────────────────────────────┐
│  AM4 Protocol Layer  (TypeScript)                   │
│  — SysEx encoder/decoder                           │
│  — Checksum calculation                            │
│  — Block parameter maps                            │
│  — Preset/scene binary format                      │
└──────────────────────┬──────────────────────────────┘
                       │ node-midi
┌──────────────────────▼──────────────────────────────┐
│  USB/MIDI Transport                                 │
│  — Fractal AM4 USB driver (Windows)                │
│  — node-midi input/output ports                    │
└──────────────────────┬──────────────────────────────┘
                       │ USB cable
┌──────────────────────▼──────────────────────────────┐
│  Fractal AM4 Hardware                               │
└─────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### 1. MCP Server (`src/server/`)
The Claude-facing interface. `src/server/index.ts` is boot +
register-loop only — one `register*Tools(server)` call per device.
Pure orchestration plus per-tool agent guidance in the registered
tool descriptions; no MIDI logic at this layer.

```
src/server/
  index.ts                    ← boot + transport + register loop (~120 LOC)
  shared/                     ← cross-tool helpers (used by every device)
    connections.ts            ← per-port MIDI registry, ensureConnection,
                                  recordAckOutcome, stale-handle counter
    channels.ts               ← lastKnownChannel / lastKnownType caches,
                                  switchBlockChannel, applicability advisory
    paramHelpers.ts           ← paramKey resolution, display-value coercion
    wireOps.ts                ← sendAndAwaitAck + recordInbound/format
                                  ([+NNNms] LABEL timeline)
    readOps.ts                ← sendReadAndParse, readPresetName predicate
  tools/                      ← device-AGNOSTIC tool families
    midi-primitives.ts        ← send_cc / _note / _program_change /
                                  _nrpn / _sysex (any MIDI device)
    midi-control.ts           ← list_midi_ports / reconnect_midi
```

Device-specific tool surfaces live alongside their wire layer under
`src/<vendor>/<device>/`:

```
src/fractal/am4/tools/        ← AM4 (split by family because apply_preset
  index.ts                       alone is 1633 LOC)
  apply.ts                    ← am4_apply_preset / _at / _setlist
  write.ts                    ← am4_set_param / set_params / set_block_type
                                  / set_block_bypass
  read.ts                     ← 8 read tools
  navigation.ts               ← save / rename / switch / dump (7 tools)
  factory.ts                  ← restore_factory / _range (with pre/post
                                  name verification)
  lookup.ts                   ← list_params / _block_types / _enum_values
  lookup-lineage.ts           ← lookup_lineage / _lineages (Fractal-
                                  authored amp/drive/etc. lineage)
  diagnostics.ts              ← am4_test_navigate (bypass-the-stack probe)

src/fractal/axe-fx-ii/
  tools.ts                    ← single-file Axe-Fx II tool surface

src/asm/hydrasynth-explorer/
  server.ts                   ← single-file Hydrasynth tool surface
```

Each tool surface exports a `register<Device>Tools(server)` that
`src/server/index.ts` calls. Cross-tool state (connection registry,
channel/type caches) lives once in `src/server/shared/` so multiple
device surfaces read the same source of truth.

**Adding a new device.** Single-file pattern (axefx2 / hydra) is the
default — copy one of those `tools.ts` as a template, change the names,
and write your wire encoder next door. Multi-file pattern (AM4) is
only for devices with a tool family big enough that one file becomes
unwieldy; AM4's `apply.ts` is 1633 LOC by itself, which is why the
split exists.

**Safety rules enforced across the AM4 surface:**
- Save tools (`save_to_location`, `save_preset`, `apply_preset_at`)
  require an explicit user save phrase; agent guidance is in each
  tool's description.
- Pre-overwrite scan: bulk operations call `scan_locations` first to
  surface what would be clobbered (especially `restore_factory_range`).
- Working-buffer-only tools (`apply_preset`, `set_param`, etc.) are
  reversible by switching presets; this is reflected in their
  REVERSIBILITY / SAVE INTENT clauses.
- Factory preset verification: pre/post-name comparison
  (`verifyRestoredSlot` in `src/fractal/am4/tools/factory.ts`) catches
  no-op restores and silent-fail cases without depending on the BK-036
  bank-file decode.

### 2. AM4 Protocol Layer (`src/fractal/am4/`)
Pure TypeScript. No Claude, no MCP. Testable in isolation against
captured wire bytes via `scripts/verify-msg.ts` and friends.

**Modules:**
```
src/fractal/am4/
  midi.ts             — node-midi connection wrapper, port enumeration,
                          inbound parser (describeAm4InboundMessage)
  setParam.ts         — buildSetParam / buildSetBlockType / build*Echo
                          predicates / parseReadResponse / packed-septet
                          encoding for the F0 00 01 74 15 ... F7 envelope
  params.ts           — KNOWN_PARAMS registry (each param's pidLow/pidHigh,
                          range, scale, enum table, alias list)
  blockTypes.ts       — block-name ↔ pidLow lookup
  locations.ts        — A01..Z04 ↔ index conversion
  applicability.ts    — type-gated knob applicability (XML decode)
  parameterBridge.ts  — paramNames ↔ AM4-Edit canonical labels
  factoryBank.ts      — load + replay the factory bank's stored-form
                          bytes for a given location
  presetDump.ts       — receive 0x77 / 0x78 / 0x79 dump stream
  safety/             — factory fingerprints, location classification,
                          backup helpers (built but post-MVP)
  ir/                 — preset IR + transpiler (post-MVP)
```

Per-vendor siblings (`src/fractal/axe-fx-ii/`, `src/asm/hydrasynth-explorer/`)
follow the same layout so each device's wire layer stays self-contained.

### 3. Intermediate Representation (`src/ir/`)
Device-agnostic preset format. Claude builds this; encoder converts it to SysEx.

```typescript
interface AM4Preset {
  name: string;           // max 32 chars
  tempo: number;          // BPM
  inputGate: InputGate;
  // slot1..slot4 are the four effect slots; any slot may hold any block type; Drive may appear in up to two slots.
  blocks: {
    slot1: Block | null;  // AM4 has 4 effect slots
    slot2: Block | null;
    slot3: Block | null;
    slot4: Block | null;
  };
  scenes: [Scene, Scene, Scene, Scene];  // exactly 4 scenes (index 0–3 in SysEx, displayed 1–4 on hardware)
}

interface Scene {
  name: string;
  blocks: {
    slot1: { enabled: boolean; channel: 'A' | 'B' | 'C' | 'D' };
    slot2: { enabled: boolean; channel: 'A' | 'B' | 'C' | 'D' };
    slot3: { enabled: boolean; channel: 'A' | 'B' | 'C' | 'D' };
    slot4: { enabled: boolean; channel: 'A' | 'B' | 'C' | 'D' };
  };
}
```

### 4. Transport Layer (`src/transport/`)
Thin wrapper around node-midi. Handles port discovery, connection
lifecycle, and raw SysEx send/receive.

```typescript
interface AM4Transport {
  connect(): Promise<void>;
  disconnect(): void;
  send(sysex: number[]): Promise<void>;
  request(sysex: number[], timeoutMs?: number): Promise<number[]>;
  onMessage(handler: (data: number[]) => void): void;
}
```

---

## Slot Naming Convention
The AM4 uses Fractal's native bank/letter system. The app uses this natively.

```
Format: [Bank Letter][Two-digit number]
Banks:  A through Z (26 banks)
Slots:  01 through 04 per bank (4 slots each)
Total:  104 preset slots

Examples:
  A01 — Bank A, slot 1 (first factory preset)
  Z04 — Bank Z, slot 4 (last slot, #104)
  M02 — Bank M, slot 2

Flat index mapping (for internal use):
  index = (bankIndex * 4) + (slotNumber - 1)
  A01 = 0, A02 = 1, A03 = 2, A04 = 3, B01 = 4 ...
```

---

## Preset Safety System

```
┌─────────────────────────────────────────────────────┐
│  BEFORE ANY WRITE OPERATION                         │
│                                                     │
│  1. Read current slot contents                      │
│  2. Check against factory preset checksum table     │
│     → Factory: show "slot contains factory preset"  │
│     → Unknown/custom: show "slot contains           │
│       user preset — backup recommended"             │
│     → Empty: show "slot is empty — safe to write"   │
│                                                     │
│  3. Present compact confirmation summary:           │
│     Writing: AMBER 311                              │
│     Slot:    M01                                    │
│     Current: [Empty / Factory A01 / User preset]   │
│     Backup:  [N/A / Not needed / Saved as M01_bak] │
│     Confirm? [Yes / No]                             │
│                                                     │
│  4. On confirm: backup if needed, then write        │
└─────────────────────────────────────────────────────┘
```

---

## Repo Structure
```
mcp-midi-control/
  src/
    server/         — MCP server, tool definitions
    protocol/       — SysEx encoder/decoder, block maps
    ir/             — Intermediate representation types
    transport/      — node-midi wrapper
    safety/         — Slot read, backup, confirmation logic
    knowledge/      — AM4 block reference data (from manuals)
  scripts/
    probe.ts        — Feasibility proof scripts
    sniff.ts        — MIDI-OX equivalent for logging traffic
    diff-syx.ts     — Compare two .syx files byte by byte
    annotate.ts     — Annotate .syx hex dump with known field names
  samples/          — Local-only debug scratch (entire dir gitignored)
    factory/        — Factory .syx preset files (downloaded from Fractal; their IP)
    captured/       — USB / MIDI-OX captured traffic sessions
    decoded/        — Human-readable decoded preset JSON + extractor outputs
  docs/
    SYSEX-MAP.md    — Growing reverse-engineered SysEx reference
    BLOCK-PARAMS.md — AM4 block parameter tables (from manual)
    SESSIONS.md     — Sniffing session notes and findings
  tests/
    protocol/       — Unit tests for encoder/decoder round-trips
    integration/    — Tests that require AM4 hardware
  claude.md         — Context file for Claude Code
  package.json
  tsconfig.json
```

---

## Development Phases

### Phase 0 — Feasibility Scripts
`scripts/probe.ts` — proves USB MIDI communication works
`scripts/sniff.ts` — captures AM4-Edit traffic for analysis
No MCP yet. Pure Node.js CLI.

### Phase 1 — Protocol Layer
Build encoder/decoder from sniffed data.
`scripts/diff-syx.ts` and `scripts/annotate.ts` support this.
Full unit test coverage of round-trips before moving on.

### Phase 2 — MCP Server MVP
Wire protocol layer to MCP tools.
Test with Claude Desktop using `claude_desktop_config.json`.
Goal: "set amp to Plexi, gain 6" works end to end.

### Phase 3 — Intelligence Layer
Add block reference knowledge to Claude project.
Famous tone research capability.
Iterative refinement loop.

### Phase 4 — Library Management
Backup/restore system.
Setlist concept.
Slot safety enforcement.
