# `fractal-midi` extraction plan

> Companion to [`MULTI-DEVICE-ROADMAP.md`](MULTI-DEVICE-ROADMAP.md) §"Phase 2 —
> Vendor protocol-package extraction." That doc states the *why* and the
> repo-level shape; this doc is the actionable *how* — per-file moves,
> consumer surface, blockers, dev workflow during dual-repo work.
>
> **Status (2026-05-17):** PLANNED, not started. Authored 2026-05-17 as
> the durable plan to revisit when the extraction trigger fires
> (founder ships polish on Axe-Fx II writes + Hydrasynth patch sends,
> OR AM4 surface is mature enough that extraction earns its keep
> without slowing core iteration).

## TL;DR

Two public GitHub repos at the end of this work:

1. **`mcp-midi-control`** (this repo) — the MCP server, MIDI transport,
   tool registrations, MCP-specific agent guidance. Depends on
   `fractal-midi` as an npm package.
2. **`fractal-midi`** (new) — pure data + pure codec for the Fractal
   product family (AM4, Axe-Fx II, Axe-Fx III, and future FM3 / FM9 /
   VP4). **No MIDI library dependency.** Consumers wire up their own
   transport.

Per-vendor split, not per-device — confirmed in
[`MULTI-DEVICE-ROADMAP.md`](MULTI-DEVICE-ROADMAP.md) §"Two-tier
architecture." `fractal-midi/am4`, `fractal-midi/axe-fx-ii`,
`fractal-midi/axe-fx-iii` are subpath exports.

## Naming — `fractal-midi`, not `fractal-protocol`

The 2026-05-17 conversation that prompted this doc proposed
`fractal-protocol`; the pre-existing
[`MULTI-DEVICE-ROADMAP.md`](MULTI-DEVICE-ROADMAP.md) (2026-05-04)
already names it `fractal-midi`. **`fractal-midi` wins** for three
reasons:

1. Already documented across the project as the target name (would have
   to flip MULTI-DEVICE-ROADMAP + DECISIONS + the launch-post plan if
   we changed it).
2. Search/discovery — guitarists and tool authors search "fractal midi
   library," not "fractal protocol library."
3. Consistent with the planned siblings (`asm-midi`, `roland-midi`) per
   the same roadmap doc.

`fractal-rosetta` was a strong alternative that ties to the RE story
but doesn't survive the consistency test against `asm-midi` /
`roland-midi`. Park it as a marketing/story phrase, not the package
name.

## Scope decision — codec only, no MIDI dependency

**`fractal-midi` ships JSON tables + pure-TS codec only. It does NOT
depend on `node-midi` or any other MIDI library.** Callers route bytes
through whatever transport they prefer.

Tradeoff (re-confirmed 2026-05-17): codec-only maximizes audience —
DAW plugins (JUCE/Rust/Swift), mobile editors, browser tools, and
Python wrappers via FFI/transpile can all consume `fractal-midi`
without a Node native build. Bundling `node-midi` would give a
turnkey Node experience but lock out the ~80% of realistic consumers
who aren't writing Node CLIs.

The convenience layer (a `fractal-midi-node` helper that bundles
`node-midi` + safe-edit gates) is **deferred**. Re-evaluate if real
consumers ask for it; do not preemptively ship.

## Boundary — per-file move plan

Tested against the current `packages/` layout. Files marked **MOVE**
go to `fractal-midi`; files marked **STAY** remain in
`mcp-midi-control`.

### `packages/core/src/` (cross-cutting)

| File / dir | Disposition | Notes |
|---|---|---|
| `core/src/fractal-shared/checksum.ts` | **MOVE** → `fractal-midi/shared/` | Pure XOR-and-mask |
| `core/src/fractal-shared/packValue.ts` | **MOVE** → `fractal-midi/shared/` | Septet pack/unpack, packed-float |
| `core/src/fractal-shared/device.ts` | **MOVE** → `fractal-midi/shared/` | Vendor-shared device-type primitives |
| `core/src/fractal-shared/types.ts` | **MOVE** → `fractal-midi/shared/` | Vendor-shared TS types |
| `core/src/fractal-shared/lineage/` | **MOVE** → `fractal-midi/shared/lineage/` | JSON data — the OSS crown jewel for amp/cab tone authors |
| `core/src/fractal-shared/lineageLookup.ts` | **MOVE** → `fractal-midi/shared/` | Pure-data lookup engine |
| `core/src/protocol-generic/` | **STAY** | MCP-coupled (DeviceDescriptor + dispatcher + unified tools) |
| `core/src/server-shared/` | **STAY** | MCP-coupled (bufferDirty, safeEdit gates, connection mgmt) |
| `core/src/midi/` | **STAY** | node-midi transport + SysEx assembler |
| `core/src/types/` | **STAY** | MCP-shared types |

### `packages/am4/src/` (highest-value MOVE candidates)

| File / dir | Disposition | Notes |
|---|---|---|
| `params.ts`, `paramNames.ts`, `paramNamesGenerated.ts` | **MOVE** → `fractal-midi/am4/` | Parameter dictionary — crown jewel |
| `blockTypes.ts` | **MOVE** → `fractal-midi/am4/` | Block type table + enum |
| `setParam.ts` | **MOVE** → `fractal-midi/am4/` | Wire-byte builder (pure) |
| `locations.ts` | **MOVE** → `fractal-midi/am4/` | A01–Z04 parsing |
| `applicability.ts`, `typeApplicability.ts` | **MOVE** → `fractal-midi/am4/` | Type/applicability tables |
| `cacheParams.ts`, `cacheEnums.ts` | **MOVE** → `fractal-midi/am4/` | RE-derived data |
| `editorControlLabels.ts` | **MOVE** → `fractal-midi/am4/` | JUCE BinaryData mining output |
| `factoryBank.ts` | **MOVE** → `fractal-midi/am4/` | Factory bank data |
| `symbolicIds.ts` | **MOVE** → `fractal-midi/am4/` | Symbolic ID table |
| `variantResolverTables.ts` | **MOVE** → `fractal-midi/am4/` | Variant resolver data |
| `parameterBridge.ts` | **MOVE** → `fractal-midi/am4/` | Display↔wire bridge (pure) |
| `descriptor/schema.ts`, `descriptor/reader.ts`, `descriptor/writer.ts` | **MOVE** → `fractal-midi/am4/descriptor/` | DeviceDescriptor data + adapters (pure) |
| `descriptor/agentGuidance.ts` | **STAY** | MCP-flavored agent prompt text |
| `descriptor.ts` (top-level) | **SPLIT** | Data part moves; the MCP-registration wrapper stays |
| `ir/preset.ts`, `ir/transpile.ts` | **MOVE** → `fractal-midi/am4/ir/` | Preset IR — useful to any AM4 tool, not just MCP |
| `bufferFingerprint.ts` | **SPLIT** | Pure hash + diff logic moves; the gate that invokes node-midi stays |
| `shared/channels.ts`, `shared/paramHelpers.ts` | **MOVE** → `fractal-midi/am4/` | Pure helpers |
| `shared/readOps.ts`, `shared/wireOps.ts` | **STAY** | MIDI-coupled (read/write ops over a connection) |
| `presetDump.ts` | **STAY** | MIDI-coupled (dumps via connection) |
| `safety/` | **STAY** | MCP safe-edit policy + connection-coupled gates |
| `midi.ts`, `device.ts` | **STAY** | node-midi I/O wrapper |
| `tools/` | **STAY** | MCP tool registrations |

### `packages/axe-fx-ii/src/` and `packages/axe-fx-iii/src/`

Same pattern as AM4:

- **MOVE:** `params.ts`, `blockTypes.ts`, `setParam.ts`, `lineageLookup.ts`,
  `paramAliases.ts`, `descriptor/{schema,reader,writer}.ts`, the
  type-only parts of `descriptor.ts`.
- **STAY:** `descriptor/agentGuidance.ts`, `midi.ts`, `device.ts`,
  `tools/*`, the descriptor-registration wrapper.

### `packages/hydrasynth-explorer/src/`

Out of scope for `fractal-midi`. Hydrasynth Explorer is the seed of a
future `asm-midi` package per the same roadmap doc — separate
extraction, same pattern.

### `packages/server-all/`

100% **STAY**. This is the MCP entrypoint.

## Consumer surface (what `fractal-midi` exports)

```ts
// Pure data — copy-paste-able into any language
import { params, blocks, lineage, applicability } from 'fractal-midi/am4';
import { params as iiParams } from 'fractal-midi/axe-fx-ii';
import { params as iiiParams } from 'fractal-midi/axe-fx-iii';

// Pure codec — display value in, SysEx bytes out
import { buildSetParam, parseSetParam } from 'fractal-midi/am4/codec';
import { checksum, packValue } from 'fractal-midi/shared';

const bytes = buildSetParam({ block: 'amp', param: 'gain', value: 7.5 });
// → Uint8Array. Caller routes through their own MIDI library.

// Pure validators — given captured bytes, parse back to display values
import { parseSetParam } from 'fractal-midi/am4/codec';
const display = parseSetParam(bytes); // { block, param, value }
```

Three layers per device subpath:

1. **JSON tables** (`params`, `blocks`, `lineage`, `applicability`) —
   the data, language-agnostic at the byte level (parsed once into
   typed TS objects on import).
2. **TS codec** (`/codec`) — `buildSetParam`, `parseSetParam`,
   envelope builders, checksum integration.
3. **Validators / fingerprints** — pure functions for buffer-dump
   hashing, preset round-trip equality, applicability checks.

## Pre-extraction blockers (work to do BEFORE the move)

These are the conditions that, if not satisfied at extraction time,
make the resulting `fractal-midi` lower-quality than it should be.

### Blocker 1 — AM4 coverage audit closeout
- **State (2026-05-17):** AM4 84%, cross-ref audit shows
  `WIRED-MISLABEL=135`, `UI-MISSING=298`, `GHOST=61`.
- **What's needed:** either close most of these, or add a `coverage`
  status field per param entry so downstream consumers can filter by
  confidence. Don't ship a public dictionary that quietly carries
  ~14% mislabeled entries.
- **Effort:** medium. The cross-ref audit script already produces
  the input; either hand-closeout passes or generator-side fixes
  resolve the bulk.

### Blocker 2 — Axe-Fx III calibration coverage
- **State (2026-05-17):** III calibration at 229/2017 entries (≈11%)
  after the Session 93 alias work.
- **What's needed:** decision point — does v0.1 of `fractal-midi` ship
  III as "experimental, ~11% calibrated, names only" with the rest
  as `unit: 'enum'` placeholders, or do we wait for the BinaryData
  XML mining + universal-fallback work (Session 93 next-session
  candidates) to land?
- **Recommendation:** ship II as headline, AM4 as second, III as
  experimental — same posture the launch post already takes. III's
  catalog (2017 names) is itself the headline win even with sparse
  calibration.

### Blocker 3 — Display↔wire boundary cleanup
- **State (2026-05-17):** the 2026-04-28 display-first decision is
  honored at the MCP boundary, but some `setParam.ts` paths may still
  expect pre-translated wire values from callers.
- **What's needed:** audit per-device `setParam.ts` for any
  caller-side wire assumptions; ensure the public codec API is
  display-in / bytes-out end-to-end.
- **Effort:** small if the contract is already clean; may surface
  one or two leak spots.

### Blocker 4 — `bufferFingerprint` purification
- **State (2026-05-17):** `packages/am4/src/bufferFingerprint.ts`
  mixes pure hashing logic with connection-aware polling.
- **What's needed:** split into `fingerprint.ts` (pure: buffer bytes
  → hash) and `safeEdit/poller.ts` (connection-aware). The pure half
  moves to `fractal-midi`; the poller stays in `mcp-midi-control`.
- **Effort:** small refactor.

### Blocker 5 — Descriptor schema portability
- **State (2026-05-17):** `descriptor/schema.ts` per device is
  TS-native. For non-TS consumers (Python, Rust, JUCE/C++) to use the
  param catalog, the schema needs a JSON Schema or Protobuf
  equivalent.
- **What's needed:** decide whether `fractal-midi` ships JSON Schema
  alongside the TS types (recommended) or TS-only (faster, less
  inclusive).
- **Recommendation:** JSON Schema. The whole point of extraction is
  cross-language reuse; the marginal cost of generating JSON Schema
  from the existing Zod schemas is low.

### Blocker 6 — Captures and licensing
- **State (2026-05-17):** captures are gitignored per BK-044. Some
  ride-along bytes appear in `verify-msg.ts` goldens.
- **What's needed:** confirm none of the goldens that would move with
  the codec embed any user data (preset names, factory bank
  contents). Spot-check before publishing.
- **Effort:** quick audit.

## Dev workflow during dual-repo work

When the extraction starts, the two repos need to coexist during a
transition window where `mcp-midi-control` is still iterating fast.

**Recommended setup:**

1. Sibling clones under one parent dir (`C:/dev/mcp-midi-control` +
   `C:/dev/fractal-midi`).
2. `npm link` the in-development `fractal-midi` into
   `mcp-midi-control` so edits in the protocol lib show up live in the
   MCP server's `node_modules`.
3. CI publishes `fractal-midi` to npm on tagged releases;
   `mcp-midi-control` pins a specific `fractal-midi` version in its
   `package.json` and bumps it explicitly when consuming new features.

**Don't** try to maintain a git submodule or a path-dependency in
production `package.json` — both create release-coordination friction
that npm version pinning solves cleanly.

## Migration sequencing (execution order)

When the extraction is triggered, this is the order I'd run it:

1. **Snapshot the current monorepo** under a release tag
   (`pre-fractal-midi-extraction`).
2. **Close blockers 1, 3, 4, 6 above** in the monorepo before any
   files move. Easier to fix things in one repo than across two.
3. **Create the new repo** with the proposed layout and a minimal
   skeleton (`package.json`, `tsconfig.json`, CI for typecheck +
   tests).
4. **Move `fractal-shared/` first** (smallest, most-shared) — it's
   the dependency root for every per-device subpath.
5. **Move AM4** as the second package — it's the deepest-RE'd device,
   so any cross-cutting design issues surface here first.
6. **Move Axe-Fx II** — fast, since the patterns are now proven.
7. **Move Axe-Fx III** — last, since its catalog is largest but its
   per-param calibration is sparsest (decision deferred per Blocker
   2).
8. **Cut `fractal-midi` v0.1** to npm.
9. **Update `mcp-midi-control` to depend on `fractal-midi` v0.1**;
   remove the moved files from `packages/{core/src/fractal-shared,am4,
   axe-fx-ii,axe-fx-iii}/`.
10. **Hardware-verify the dispatch path end-to-end** (run
    `launch-verify` against real AM4 + Axe-Fx II hardware) — this is
    the only way to confirm the cross-repo wiring didn't lose any
    runtime-resolution invariants.

## Strategic notes

- **AlGrenadine collaboration window.** The
  [`project_axefx3_algrenadine_mcp_overlap`](_private/) memory flags
  that AlGrenadine is independently building an Axe-Fx III MCP. If
  `fractal-midi` ships first, they're the natural first external
  consumer — validates the abstraction, and gives the project a
  public "second consumer" story. Worth a DM around extraction time.
- **The safe-edit fingerprint is publishable.** Most Fractal RE
  projects (bspaulding, tysonlt, laxu, FCBInfinity) ship without any
  dirty-state tracking — anyone building an editor reinvents it
  badly. Exposing the pure fingerprint computation in `fractal-midi`
  is a high-leverage gift to the community even if downstream
  consumers wire their own gates.
- **Hardware-verified contribution workflow translates.** Decision
  2026-05-10 in `DECISIONS.md` (every new device-support PR carries
  capture evidence) applies to `fractal-midi` too. Wire the same
  CI shape into the new repo from day one.

## References

- [`MULTI-DEVICE-ROADMAP.md`](MULTI-DEVICE-ROADMAP.md) — the
  high-level architecture intent (this doc is its Phase 2 detail).
- [`DECISIONS.md`](DECISIONS.md) — 2026-05-14 workspace-split row,
  2026-04-28 display-first row, 2026-05-10 contribution-evidence row.
- [`SAFE-EDIT-WORKFLOW.md`](SAFE-EDIT-WORKFLOW.md) — the cross-device
  contract; gates stay in `mcp-midi-control`, fingerprint primitives
  move to `fractal-midi`.
- [`_private/04-BACKLOG.md`](_private/04-BACKLOG.md) BK-012 — early
  pre-workspace-split version of this idea; superseded by this doc.
