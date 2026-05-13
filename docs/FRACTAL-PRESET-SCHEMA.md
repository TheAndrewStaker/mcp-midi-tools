# Fractal Preset Schema — design proposal

**Status:** draft (Session 73). Not implemented yet. Discussion + iteration
before code.

This document proposes the canonical data structure for "a Fractal
preset" — one shape that covers every Fractal guitar processor:

- **AM4** (linear, 4 slots, A/B/C/D channels, 4 scenes)
- **Axe-Fx II / II XL / II XL+** (4×12 grid, X/Y channels, 8 scenes)
- **Axe-Fx III** (4×14 grid, A/B/C/D channels, 8 scenes)
- **FM9** (4×14 grid, A/B/C/D channels, 8 scenes)
- **FM3** (4×4 grid, A/B/C/D channels, 8 scenes)

Hydrasynth and other non-Fractal devices are **out of scope** — their
domain model differs enough (NRPN modulation matrix, patch-based
architecture, no scenes) that forcing them into a Fractal shape would
hurt more than it helps. They stay on the generic `PresetSpec` already
shipped, with their own descriptor-level translation.

## Why this matters

The founder's framing: "the integration API IS the schema."

Today, the unified `apply_preset` accepts a single `PresetSpec` shape
that's the lowest common denominator across AM4 + grid devices. It
works for v0.1 linear-row-2 chains. But the eventual goal — parallel
chains, FX loops, stereo splits, the full grid editing experience
AxeEdit ships — requires expressing topology richer than "slots in
order."

This schema is the design choice that unlocks Level 4 routing
(parallel paths, multi-row merges) while keeping AM4 callers
unchanged.

---

## Domain model — six axes

Every Fractal preset varies along these six axes:

| Axis | What it is | AM4 | Axe-Fx II | Axe-Fx III / FM9 / FM3 |
|---|---|---|---|---|
| **Block placement** | Where each block sits in the signal path | 4 fixed slots | 48 cells (4×12) | 56–64 cells (4×14 to 4×16) |
| **Block instances** | Multiple of the same type per preset? | No (1 per type) | Yes (Amp 1, Amp 2, …) | Yes |
| **Channels** | Per-block parameter variations | 4 letters (A/B/C/D) | 2 letters (X/Y) | 4 letters (A/B/C/D) |
| **Routing** | Signal flow between blocks | Implicit linear | Explicit per-cell input mask | Explicit per-cell input mask |
| **Scenes** | Performance snapshots picking channels + bypass | 4 scenes | 8 scenes | 8 scenes |
| **Metadata** | Preset name, scene names | 32-char ASCII | 32-char ASCII | 32-char ASCII |

The schema needs to accommodate every axis without inflating the
linear case beyond what it actually needs.

---

## The proposed shape

```typescript
/**
 * A Fractal preset — the data Claude builds in `apply_preset(spec)`.
 *
 * One shape across all Fractal devices. Per-device descriptors
 * translate it into device-native wire ops; fields irrelevant to a
 * given device are silently ignored (AM4 ignores grid coords; linear
 * devices ignore the routing array; etc.).
 */
interface FractalPreset {
  /**
   * Optional ASCII-printable preset name (≤32 chars). Padded with
   * spaces on the wire. Omitting it leaves whatever the slot's
   * current name is (typically the previous preset's name on the
   * working buffer).
   */
  name?: string;

  /**
   * Every block placed in this preset. Empty list = clear all slots
   * (working buffer becomes silent). Order doesn't matter for
   * placement — each block carries its own `slot`. Order DOES matter
   * for routing inference in `chain` mode (see below).
   */
  blocks: FractalBlock[];

  /**
   * Optional explicit routing edges. Grid devices use this to author
   * parallel chains, FX loops, multi-row merges. Linear devices
   * (AM4) silently ignore it — the order of `blocks[].slot` IS the
   * routing.
   *
   * When `routing` is omitted on a grid device, the descriptor
   * computes the implicit linear-chain routing across blocks in the
   * same row (current Level 1 behavior). When you supply `routing`,
   * the descriptor uses it verbatim and skips inference.
   */
  routing?: RoutingEdge[];

  /**
   * Per-scene state. Up to N scenes (4 on AM4, 8 on Axe-Fx II/III).
   * Scenes reference blocks by their `id` field. A scene that doesn't
   * touch a block inherits the block's defaults.
   */
  scenes?: Scene[];

  /**
   * Which scene the device sits on after the build. 1-indexed. Use
   * this so the user immediately hears the scene they care about
   * (e.g. scene 1 for the song's opening section).
   */
  landing_scene?: number;
}

interface FractalBlock {
  /**
   * Stable identifier for this block within the preset. Used by
   * `routing` and `scenes` to reference this specific block. If
   * omitted, the descriptor generates one from `block_type +
   * instance` (e.g. `amp_1`, `drive_2`). Provide explicitly when
   * you have two instances of the same type and want predictable
   * names — `id: 'rhythm_amp'` / `id: 'lead_amp'`.
   */
  id?: string;

  /**
   * The block type/group. Lowercase slug per the device's
   * `block_aliases` table (e.g. `amp`, `compressor`, `reverb`,
   * `drive`, `cab`, `delay`). Call `describe_device({port})` to see
   * the device's supported types.
   */
  block_type: string;

  /**
   * Instance number (1-indexed). Defaults to 1. Only meaningful on
   * grid devices that support multiple instances per type (Axe-Fx
   * II/III have "Amp 1" + "Amp 2", AM4 has just "the amp"). AM4
   * silently ignores `instance` ≠ 1 with an error if you try
   * `instance: 2` on a single-instance type.
   */
  instance?: number;

  /**
   * Where this block lives in the signal path.
   *   - On linear devices: `number` (1..4 for AM4) = slot position.
   *   - On grid devices: `{ row, col }` (1-indexed). 1-D `number`
   *     accepted as shorthand for `{ row: 2, col: N }` (current
   *     Level 1 row-2 convenience).
   */
  slot: number | { row: number; col: number };

  /**
   * Initial bypass state for this block. Scenes can override
   * per-scene. Default false (engaged).
   */
  bypassed?: boolean;

  /**
   * Per-channel parameter map. Channel letters are device-specific —
   * AM4 = A/B/C/D, Axe-Fx II = X/Y, Axe-Fx III/FM = A/B/C/D.
   *
   * Two shorthand forms accepted:
   *   - `params: { gain: 5, bass: 6 }` — applies to channel A (or X
   *     on Axe-Fx II), the device's first channel.
   *   - `params: { A: { gain: 5 }, B: { gain: 8 } }` — explicit per-
   *     channel.
   *
   * Values are display units (knob 0..10, dB, ms, %); enum dropdowns
   * accept the canonical name as a string ("Plexi 100W High") or
   * the wire index as a number.
   */
  params?: ParamMap | Record<ChannelLetter, ParamMap>;
}

interface RoutingEdge {
  /** Source block's `id` (or auto-generated `<block_type>_<instance>`). */
  from: string;
  /** Destination block's `id`. */
  to: string;
  /**
   * Add the cable (default) or remove it. Removing edges is for
   * surgical routing tweaks; whole-preset builds typically don't
   * need `connect: false`.
   */
  connect?: boolean;
}

interface Scene {
  /** Scene number (1-indexed). 1..4 on AM4, 1..8 on Axe-Fx II/III/FM. */
  index: number;
  /** Optional scene name (≤32 chars). Some devices don't expose scene-name writes; descriptor ignores when unsupported. */
  name?: string;
  /**
   * Per-block channel selection for this scene. Keys are block ids.
   * Block ids absent from the map inherit the block's default channel.
   */
  channels?: Record<string, ChannelLetter>;
  /**
   * Per-block bypass state for this scene. Keys are block ids.
   * Block ids absent from the map inherit the block's default bypass.
   */
  bypassed?: Record<string, boolean>;
}

type ParamMap = Record<string, number | string>;
type ChannelLetter = string; // 'A'..'D' on AM4/III, 'X'|'Y' on Axe-Fx II
```

---

## How it translates per device

### AM4 (linear)

A 4-block clean preset:

```jsonc
{
  "name": "Clean Vox",
  "blocks": [
    { "block_type": "compressor", "slot": 1 },
    { "block_type": "amp",        "slot": 2,
      "params": { "type": "Class-A 30W TB", "gain": 4, "master": 6, "treble": 7 } },
    { "block_type": "cab",        "slot": 3 },
    { "block_type": "reverb",     "slot": 4,
      "params": { "type": "Spring, Medium", "mix": 25 } }
  ],
  "scenes": [
    { "index": 1, "channels": { "amp": "A" }, "bypassed": { "compressor": false } },
    { "index": 2, "channels": { "amp": "B" }, "bypassed": { "compressor": true } }
  ],
  "landing_scene": 1
}
```

AM4 descriptor:
- Reads each block's `slot: 1..4` as the linear position
- Ignores `instance` (errors if anything but 1)
- Ignores `routing` if present (linear is implicit)
- Walks `scenes[]` and writes per-scene channel + bypass via the
  switch-write-switch-back pattern
- `params: { gain: 5 }` (shorthand, no channel key) → writes to the
  currently-active channel; explicit `params: { A: {gain:5}, B: {gain:8} }`
  walks each channel

### Axe-Fx II (grid, row-2 linear chain — Level 1)

Same preset, expressed for Axe-Fx II:

```jsonc
{
  "name": "Clean Vox",
  "blocks": [
    { "block_type": "compressor", "slot": 1 },
    { "block_type": "amp",        "slot": 2,
      "params": { "X": { "input_drive": 4, "master_volume": 6, "treble": 7 } } },
    { "block_type": "cab",        "slot": 3 },
    { "block_type": "reverb",     "slot": 4,
      "params": { "X": { "type": "Spring, Medium", "mix": 25 } } }
  ],
  "scenes": [
    { "index": 1, "channels": { "amp": "X" } },
    { "index": 2, "channels": { "amp": "Y" } }
  ],
  "landing_scene": 1
}
```

Axe-Fx II descriptor:
- Reads `slot: number` as shorthand for `{ row: 2, col: number }`
- Auto-extends with shunts on cols N+1..12, auto-cables row 2
- No `routing` array → linear row-2 chain inferred
- Channel letters X/Y validated; A/B rejected

### Axe-Fx II — parallel chain (Level 4)

A wet/dry split: comp → splits to dry path AND wet path with delay+reverb, then merges:

```jsonc
{
  "name": "Wet/Dry Lead",
  "blocks": [
    { "id": "comp",   "block_type": "compressor", "slot": { "row": 2, "col": 1 } },
    { "id": "amp",    "block_type": "amp",        "slot": { "row": 2, "col": 2 },
      "params": { "X": { "input_drive": 7, "master_volume": 5 } } },
    { "id": "cab",    "block_type": "cab",        "slot": { "row": 2, "col": 3 } },
    { "id": "delay",  "block_type": "delay",      "slot": { "row": 1, "col": 4 },
      "params": { "X": { "mix": 100, "time": 350 } } },
    { "id": "reverb", "block_type": "reverb",     "slot": { "row": 3, "col": 4 },
      "params": { "X": { "mix": 100 } } },
    { "id": "mixer",  "block_type": "mixer",      "slot": { "row": 2, "col": 5 } }
  ],
  "routing": [
    { "from": "comp",  "to": "amp" },
    { "from": "amp",   "to": "cab" },
    { "from": "cab",   "to": "delay" },
    { "from": "cab",   "to": "reverb" },
    { "from": "cab",   "to": "mixer" },
    { "from": "delay", "to": "mixer" },
    { "from": "reverb","to": "mixer" }
  ]
}
```

The descriptor:
- Places each block at its explicit `{ row, col }`
- For each `routing` edge, derives the dst cell's input mask by
  OR-ing bits for each src row that feeds it
- Sends one `fn 0x06 SET_CELL_ROUTING` per edge
- The `mixer` block ends up with `routing_mask = 0x05` (bits 0 + 2,
  receives from rows 1 and 3 of prev col) → merges the three sources

### Axe-Fx III (when added)

Same schema as Axe-Fx II, just with:
- 4 channels A/B/C/D instead of X/Y
- 4×14 grid instead of 4×12
- Different block-type catalog (more block groups, different effectId space)

All of this is descriptor concerns — the schema doesn't change.

---

## What this replaces / extends

**Current shape (`src/protocol/generic/types.ts:PresetSpec`):**

```typescript
interface PresetSpec {
  slots: Array<{ slot: SlotRef; block_type: string; params?: ...; bypassed?: boolean; }>;
  scenes?: Array<{ scene: number; channels?: ...; bypassed?: ...; name?: string; }>;
  landingScene?: number;
  name?: string;
}
```

**The gaps:**

1. **No `instance` field** — can't address `Amp 2` distinctly from `Amp 1`.
2. **No `routing` array** — grid devices can only do row-2 linear chains.
3. **No block `id`** — scenes reference blocks by `block_type` string,
   which collides on multi-instance presets.
4. **No `routing` semantics for cross-row cables** — parallel chains,
   FX loops, stereo splits all blocked.

**Migration plan:**

- Add `instance?: number`, `id?: string` to slot/block entries.
- Add `routing?: RoutingEdge[]` at top level.
- Use block `id` (or auto-derived from `block_type + instance`) in
  scene maps. Back-compat: existing scenes that use `block_type` slug
  keys (e.g. `bypassed: { drive: true }`) continue working when there's
  only one instance — the descriptor falls back to slug lookup.
- Rename `slots` → `blocks` (conceptually clearer — `slot` is the
  POSITION, not the thing). Keep `slots` as a back-compat alias for
  one release cycle. Same for `scenes[].scene` → `scenes[].index`.

The changes are additive at the type level. Existing AM4 + Axe-Fx II
linear callers (slot 608, 609, all prior tests) continue working
unchanged.

---

## Why the founder's instinct is right

> "this is what the integration API actually is."

A few reasons this design IS the API:

1. **It's the contract the LLM sees.** Tool descriptions paste this
   shape into the agent's context window. The shape's clarity
   directly determines whether the agent picks the right blocks /
   slots / channels / scenes when building a preset from natural
   language.

2. **It's the contract that propagates to every device.** Adding
   FM9 or Axe-Fx III is a descriptor that accepts FractalPreset and
   translates to device-native ops. The schema doesn't change per
   device — only the descriptor's wire layer does.

3. **It's the contract files / setlists / version-controlled tone
   libraries use.** A YAML / JSON file of FractalPreset shapes IS
   the user's tone library. They can commit it to git, share it,
   export it to AxeEdit-compatible format, anything.

4. **It's the contract that survives the wire-protocol decoding.**
   Wire protocols change between firmware revisions (Q8.02 → Quantum
   10.0 — different SysEx envelopes). The schema is firmware-
   independent; per-device descriptors absorb the wire churn.

A well-designed FractalPreset shape is the senior-engineering moat:
new devices = new descriptors, not new tools. New routing topologies
= same shape, descriptor handles. New firmware = wire-layer fix,
schema unchanged.

---

## Open questions

1. **Do we expose a higher-level `chain: BlockRef[]` shorthand for
   the common linear case?** Pro: ergonomic for AM4 + Level 1 Axe-Fx
   II users. Con: two ways to do the same thing. Recommended: NO —
   the descriptor's automatic linear-chain inference (when `routing`
   omitted) is enough.

2. **How does `params` shorthand interact with multi-channel devices?**
   AM4's "active channel" is whatever the user last selected on the
   device. If a caller passes `params: { gain: 5 }` without specifying
   channel, the descriptor writes to whatever's active — which may
   not be what the caller intended. Recommended: when channels exist,
   require explicit channel keys; emit a warning if the caller omits
   and the device has channels.

3. **Should `routing` be allowed on linear devices?** If a caller
   accidentally passes `routing` to AM4, do we error or silently
   ignore? Recommended: error with a clear message ("routing edges
   are not applicable on linear devices; AM4 routes implicitly by
   slot order"). Silent ignore hides bugs.

4. **Scene-name writes on Axe-Fx II.** Currently undecoded. The
   schema accepts `scenes[].name`; the descriptor throws
   `capability_not_supported` when called against a device that
   can't write scene names. Recommended: schema accepts it
   universally; descriptor surfaces the error.

5. **Multi-block-type aliases.** AM4's "GEQ" vs "Graphic EQ" — same
   thing, different names. Resolved at the descriptor's
   `block_aliases` map. Schema is canonical; descriptor handles
   spelling.

---

## What this enables in v0.4

With FractalPreset shipped:

- **Parallel chains** (wet/dry, doubled drives merging at a mixer)
- **FX loops** (send on row 1, return on row 3)
- **Stereo splits** (L on row 1, R on row 3, merge at OUTPUT)
- **Multi-amp presets** (Amp 1 on row 2 col 4, Amp 2 on row 4 col 4,
  blended at a mixer)
- **Setlist files as version-controlled YAML** (one shape across all
  Fractal gear; portable between AM4 and Axe-Fx II for compatible
  blocks)
- **Authoring tools that round-trip** (export AxeEdit preset →
  FractalPreset → reimport)

---

## Recommendation

Ship this in v0.4, alongside the `axefx2_set_cell_routing` MCP tool
exposure. Implementation order:

1. Extend `PresetSpec` types with `instance`, `id`, `routing` fields
   (back-compat preserved).
2. Wire descriptor translators for AM4 + Axe-Fx II.
3. Add `routing` walk to `applyExecutor` (existing fn 0x06 primitives
   suffice).
4. Hardware test: wet/dry split on Axe-Fx II slot 610.
5. Hardware test: dual-amp parallel preset on slot 611.
6. Document with worked examples in this file (replace "design
   proposal" with "shipped contract").

Effort estimate: 1 focused session (~6 hours) for steps 1-4 + the
hardware tests.
