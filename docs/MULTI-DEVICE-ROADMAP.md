# Multi-device roadmap

> **Status (2026-05-04):** Plan-of-record, not yet implemented. v0.1.0
> ships as a single repo (`mcp-midi-control`) carrying both the framework
> and the Fractal AM4 device pack together. The split into a framework
> repo + per-device pack repos is queued for v0.2, after one Wave 1
> expansion (Axe-Fx II) has validated the framework boundary.
>
> This doc is the north star for that work — it states the architecture
> intent, the repo organization, the device target order, the framework
> boundary, and the migration plan. It exists so future readers (and
> contributors) can understand where the project is going without
> re-deriving it from the codebase.

---

## Goal

A vendor-neutral MCP framework that lets a Claude conversation control
real music hardware (guitar amps, synths, loopers, drum pads) over USB
MIDI. The framework is the conversational + protocol scaffolding;
per-vendor *device packs* carry the protocol decoders and the device-
specific tools that wrap them. Users install one framework + one or
more device packs, get a Claude Desktop integration that knows their
gear by name.

Inverse of the closed model (AlGrenadine's FractalBot / Fracpad — one
proprietary editor per device family, no shared substrate). This
project is the **open** counterpart: shared substrate, vendor-specific
packs, OSS from day one (Apache-2.0).

## Two-tier architecture

**Decided 2026-05-04:** MCP is a top-layer concern, not a per-device
concern. Vendor protocol packages are pure MIDI — useful in non-MCP
contexts (CLIs, web UIs, Python wrappers). Vendor packages are also
**vendor-grouped, not device-grouped**: a single `fractal-midi` package
supports the entire Fractal product family (AM4, Axe-Fx II, Axe-Fx III,
FM9, FM3, VP4) since they share SysEx envelope, checksum, register
shape, and most lineage data. Same for ASM (Hydrasynth Explorer /
Keyboard / Desktop / Deluxe) and Roland/Boss (RC-505, VE-500, SPD-SX,
JD-Xi).

| Tier | Responsibility | Examples | Shipped as |
|---|---|---|---|
| **L1 — MCP project** (this repo) | The ONLY MCP layer. MCP server scaffolding, tool registration, port management, General-MIDI primitive MCP tools, display-first API conventions, vendor-specific MCP wrappers (`apply_preset` / `set_param` / etc. for each device the project supports). Imports vendor protocol packages and exposes their primitives as MCP tools. | `mcp-midi-control` | One repo, one npm package |
| **L2 — Vendor protocol packages** | Pure MIDI / protocol decoders for one vendor's product family. NO MCP. Each package contains: SysEx envelope + checksum + shared encoding helpers (vendor-level), per-device protocol decoder + parameter registry + applicability data + lineage records (per-device subdirs within the vendor package). | `fractal-midi` (AM4 + Axe-Fx II + Axe-Fx III + FM9 + FM3 + VP4), `asm-midi` (Hydrasynth family), `roland-midi` (RC-505 + VE-500 + SPD-SX + JD-Xi) | One repo per vendor, one npm package per vendor |
| **L3 — User distribution** | Bundles `mcp-midi-control` + native deps + Claude Desktop config setup. End-user-installable artifact. | Today: `setup.cmd` ZIP (per [memory](../../Users/Steph/.claude/projects/C--dev-am4-tone-agent/memory/project_distribution_model.md)); future: signed `.exe` (P5 milestones) | Separate repo for distribution form |

L2 is pure code/data, no native deps, npm-friendly, Apache-2.0. The MCP
project depends on whichever vendor packages it wants to support — it's
the integration point where "this protocol primitive becomes a Claude-
callable tool" happens. L3 wraps the messy installer concerns.

**Why vendor-grouped, not device-grouped.** Within a vendor, devices
share more than they differ:
- Fractal: same SysEx envelope (`F0 00 01 74 <model> ...`), same XOR
  checksum, same packed-float wire format, overlapping lineage data,
  AM4-Edit / Axe-Edit / FM9-Edit all share JUCE BinaryData layout.
  One Fractal protocol package amortizes that work across the family.
- ASM: published MIDI CC chart applies across Explorer / Keyboard /
  Desktop / Deluxe with the same engine.
- Roland/Boss: shared MIDI Implementation PDF conventions, similar
  SysEx framing across the family.

Device-grouped packages would force vendor primitives (envelope,
checksum, encoding) into an unstated shared dependency or duplicate
them N times. Vendor-grouped keeps them honest in one place.

## Repo organization

### Today (single repo)

```
github.com/TheAndrewStaker/am4-tone-agent           ← will rename
└── src/
    ├── (framework code, not yet sectioned)
    ├── protocol/      ← all AM4-specific
    └── server/        ← mix of framework + AM4-specific tools
```

### After Phase 1 directory restructure (still one repo, before split)

Goal: visible seam between MCP-project code and vendor-protocol code,
so the eventual `fractal-midi` extraction is `cp -r` + publish, not a
refactor. Per-device subdirectories within `fractal/` so adding
Axe-Fx II later is a sibling folder.

```
github.com/TheAndrewStaker/mcp-midi-control          ← single repo (rename from am4-tone-agent)
└── src/
    ├── server/                          ← MCP server entrypoint, stays
    │   └── index.ts
    ├── core/                            ← MCP project, vendor-neutral
    │   ├── midi/                        ← node-midi wrapper, port mgmt
    │   ├── tool-conventions/            ← display-first helpers
    │   └── (generic MIDI message builders, types)
    └── fractal/                         ← will become fractal-midi npm package
        ├── shared/                      ← vendor-level
        │   ├── checksum.ts              ← Fractal XOR checksum
        │   ├── packValue.ts             ← septet/packed-float
        │   └── lineage/                 ← shared lineage JSON (am4 + Axe-Fx)
        └── am4/                         ← AM4-specific
            ├── protocol/                ← message builders / decoders
            ├── safety/                  ← location classification, fingerprints
            ├── ir/                      ← preset IR / transpiler
            └── (params, paramNames, cacheParams, parameterBridge,
                 typeApplicability, editorControlLabels, etc.)
```

The MCP wrappers for AM4 (`apply_preset` / `set_param` / `get_params` /
etc.) live under `src/fractal/am4/tools/` — one file per tool family
(`apply.ts`, `write.ts`, `read.ts`, `navigation.ts`, `factory.ts`,
`lookup.ts`, `lookup-lineage.ts`, `diagnostics.ts`), aggregated by
`src/fractal/am4/tools/index.ts` which exports `registerAM4Tools(server)`.
Cross-tool helpers live under `src/server/shared/` (the shared pieces
generalize across AM4, Hydrasynth, and Axe-Fx II). Generic-MIDI tool
families (`send_*`, `list_midi_ports`, `reconnect_midi`) live under
`src/server/tools/`. `src/server/index.ts` is the boot + register-loop
only — one `register*Tools(server)` call per device plus the two
generic families.

### After Phase 2 split (target for v0.2 or first Fractal expansion)

```
github.com/TheAndrewStaker/mcp-midi-control          ← MCP project (this repo)
github.com/TheAndrewStaker/fractal-midi            ← Fractal protocol family (extracted)
github.com/TheAndrewStaker/asm-midi                ← ASM protocol family (Wave 1, BK-031)
github.com/TheAndrewStaker/roland-midi             ← Roland/Boss protocol family (later)
github.com/TheAndrewStaker/mcp-midi-control-installer ← L3 distribution (later)
```

`fractal-midi` would expose subpaths per device:
```
import { encodeAm4Param } from 'fractal-midi/am4';
import { encodeAxeFxIIPreset } from 'fractal-midi/axe-fx-ii';
import { fractalChecksum } from 'fractal-midi/shared';
```

Naming conventions:

- MCP project: `mcp-midi-control` (per [BK-029](04-BACKLOG.md), decided 2026-04-19).
- Vendor protocol packages: `<vendor>-midi` (e.g. `fractal-midi`,
  `asm-midi`, `roland-midi`). NO `mcp-` prefix — these aren't MCP
  packages, they're MIDI protocol libraries that anyone can consume.
- Distribution: separate, branded if/when needed.
- **Product names never include device names** (per [memory](../../Users/Steph/.claude/projects/C--dev-am4-tone-agent/memory/project_multi_repo_architecture.md)). The MCP project is the product; vendor packages are reusable libraries.

## Boundary — what stays in mcp-midi-control vs what moves to vendor packages

This is the load-bearing decision the directory restructure encodes.

### L1 mcp-midi-control (this repo, the MCP layer)

Everything that knows about MCP, plus everything that's MIDI-generic
across vendors:

- **MCP server scaffolding.** `registerTool`, request/response types,
  the `@modelcontextprotocol/sdk` integration, error formatting,
  startup banner.
- **MIDI port management.** Port enumeration, open/close, hot-replug
  detection, error handling. Already shipped as `list_midi_ports` and
  `reconnect_midi`. Generic node-midi wrapper.
- **General-MIDI primitive MCP tools.** `send_cc`, `send_note`,
  `send_program_change`, `send_nrpn`, `send_sysex`. Channel-1..16,
  CC 0..127, NRPN 14-bit, raw SysEx framing. Shipped in BK-030. These
  work on *any* MIDI device — they're the lowest-common-denominator
  wire.
- **Tool conventions.** Display-first API (per project CLAUDE.md):
  enums accept display names, knobs accept display values, the wire
  conversion happens at the tool boundary. Range validation,
  applicability advisory shape, error path conventions.
- **Vendor-specific MCP wrappers.** `apply_preset`, `set_param`,
  `set_block_type`, `switch_scene`, `save_to_location`, etc. These
  are MCP tools that consume vendor protocol packages. They're
  device-shaped (AM4's `apply_preset` differs from a hypothetical
  Hydrasynth `apply_patch`) but they live in the MCP project because
  MCP scaffolding is the only place that registers tools.
- **`lookup_lineage` MCP tool.** The MCP-callable wrapper. The
  *data* per vendor lives in the vendor package.

### L2 vendor protocol packages (`fractal-midi`, `asm-midi`, etc.)

Pure MIDI protocol code. **No MCP imports.** Anyone can consume these
from a CLI, web UI, Python wrapper via FFI, etc.

- **Vendor-shared primitives.** SysEx envelope (model byte slot,
  framing), checksum (Fractal: XOR-and-mask; Roland: Roland-specific),
  packed-float / septet encoding helpers, byte-level utilities
  shared across the vendor's product family.
- **Per-device protocol decoder.** Subpath per device
  (`fractal-midi/am4`, `fractal-midi/axe-fx-ii`, …):
  - **Parameter registry.** The `KNOWN_PARAMS`-equivalent — every
    exposed parameter, its wire address, display unit, range,
    scaling curve, enum table.
  - **Cache / cache-derived data.** AM4-Edit's cache extraction is a
    Fractal-specific artifact; equivalent metadata sources exist for
    other devices (Roland publishes MIDI Implementation PDFs;
    Hydrasynth's CC chart is in the manual; Axe-Fx II shares
    Fractal's cache shape).
  - **Type/applicability tables.** Which knobs apply to which type
    (e.g. compressor.ratio is gated to studio-comp types per HW-055).
    XML or markdown source, generated tables checked in.
  - **Lineage data.** The records that feed `lookup_lineage`. Many
    of these are vendor-shared (AM4 + Axe-Fx II share most amp
    models) — they live in `fractal-midi/shared/lineage` rather
    than per-device.
  - **Preset IR / transpiler.** When the device has a preset binary
    format (AM4 .syx dumps, Axe-Fx II .syx, etc.), the IR + bidirectional
    transpiler lives in the device subdir.
  - **Distribution metadata.** Driver requirements (e.g. AM4 USB
    driver), known-firmware-version compatibility, capability flags.

### Genuinely shared-across-vendors but not yet generic

A few pieces straddle the L1/L2 boundary today and need a second
vendor to clarify:

- **The `apply_preset`-shape pattern.** Compose-an-entire-preset-in-
  one-call is the right UX, but each device's "preset" is shaped
  differently (AM4 has 4 slots × 4 channels × 4 scenes; Hydrasynth
  is a flat patch; RC-505 is a song). The MCP project can offer a
  generic "compose-and-apply" scaffold; each vendor's MCP wrappers
  define their own schema.
- **Channel/variant addressing.** AM4 has A/B/C/D channels per
  block. Hydrasynth has macros. Axe-Fx II has channels too but more
  per block. Not yet generic.
- **Working-buffer vs persistent semantics.** AM4 v0.1.0 ships
  working-buffer-only; future devices may have different lifecycle
  models.

These get clarified at Wave 1 expansion, not before.

## Device target order

Per [BK-005 / BK-014 / BK-031 in the backlog](04-BACKLOG.md):

| Wave | Device | Vendor package | Status | Why this order |
|---|---|---|---|---|
| **0** | Fractal AM4 | `fractal-midi/am4` | v0.1.0 (this repo) | Founder owns, deepest RE done, MVP-shape proven |
| **1** | Fractal Axe-Fx II XL+ | `fractal-midi/axe-fx-ii` | Queued | Founder owns, same SysEx envelope as AM4 (huge reuse — exercises the `fractal-midi/shared/` boundary), wiki + Blocks Guide published. **First boundary-validation device** — wiring this up is what tells us the vendor-package shape is right |
| **1** | ASM Hydrasynth Explorer | `asm-midi/hydrasynth-explorer` | Queued (BK-031) | Founder owns. CC chart fully published (manual pp. 94–96), zero capture-RE for the engine. Gives us a **non-Fractal vendor** validation point cheaply — exercises the L1 generality (does the MCP project's tool conventions absorb a totally different protocol family?) |
| **2** | Fractal Axe-Fx III / FM9 / FM3 / VP4 | `fractal-midi/<device>` | Community beta | Need community-owned hardware for capture. Same vendor package, sibling subdirs |
| **2** | Roland / Boss family (RC-505 MKII, VE-500, SPD-SX, JD-Xi) | `roland-midi/<device>` | Queued | Roland publishes MIDI Implementation PDFs — zero capture-RE. Different SysEx family from Fractal but structurally simpler. Single vendor package across the family |
| **deferred** | Helix, Quad Cortex, others | (TBD) | — | Helix has JSON preset format (different protocol family); Quad Cortex is closed-protocol (hardest) |

[AM4 depth gates Wave 1 device shipping](../../Users/Steph/.claude/projects/C--dev-am4-tone-agent/memory/feedback_am4_depth_gates_wave_expansion.md):
don't ship multi-device until AM4 is impressive, but side-branch
exploration (Hydrasynth-explorer parked branch, Axe-Fx II prototyping)
is fine while AM4 hardens.

## Migration plan

### Phase 0 — Already done (2026-04-19 → 2026-05-04)

- [x] Decide framework name (`mcp-midi-control`, BK-029).
- [x] Rename `package.json` `name` field.
- [x] Build out General-MIDI primitives (BK-030) so the name isn't aspirational.
- [x] Decide multi-repo OSS architecture in principle ([memory](../../Users/Steph/.claude/projects/C--dev-am4-tone-agent/memory/project_multi_repo_architecture.md)).

### Phase 1 — Pre-launch (this week, before v0.1.0 ships)

- [ ] Restructure `src/` into `src/core/` + `src/fractal/{shared,am4}/`.
      Mechanical move, no API change. Preflight catches regressions.
      `src/server/` stays at top level (MCP entrypoint).
- [x] `mcp-midi-control` GitHub repo created (empty, ready to receive
      the rebranded codebase). https://github.com/TheAndrewStaker/mcp-midi-control
- [ ] Publish this roadmap doc as the architectural reference for
      launch posts ("here's where it's going").
- [ ] Push current repo (after restructure + rename + cleanup) as the
      first commit of `mcp-midi-control`. Old `am4-tone-agent` repo can
      either redirect or be archived. Founder decides between
      "fresh-history rebrand" and "git filter-repo'd preservation".

### Phase 2 — Fractal expansion (v0.2 or first non-AM4 Fractal device)

Trigger: founder starts wiring Axe-Fx II into the same runtime, OR
the AM4 surface is mature enough that splitting earns its keep.

- [ ] Extract `src/fractal/` into its own repo: `fractal-midi`.
      Pure protocol package, no MCP. Subpaths per device
      (`fractal-midi/am4`, `fractal-midi/axe-fx-ii`).
- [ ] Update `mcp-midi-control` to depend on `fractal-midi` as an npm
      package instead of a local subdir.
- [ ] Add Axe-Fx II MCP tool wrappers in `mcp-midi-control` that
      consume `fractal-midi/axe-fx-ii` primitives.
- [ ] First non-Fractal vendor package. If founder goes Hydrasynth
      next: create `asm-midi` repo, add Hydrasynth MCP wrappers in
      `mcp-midi-control`.

### Phase 3 — Multi-vendor + community (post-v0.2)

Once `mcp-midi-control` consumes 2+ vendor packages and the contract is
published, external contributors can author vendor packages without
touching the MCP project. The plan is:

- Per-vendor package repo template.
- Documented hardware-RE methodology (`docs/capture-guides/`
  already exists for AM4; generalize for other devices).
- Conformance test suite (golden writes + reads against captures)
  any vendor package must pass before being listed.
- "Approved vendor packages" registry in the `mcp-midi-control` README,
  pinned versions per release.

## Open questions (revisit at Phase 2)

1. **Monorepo vs polyrepo.** Phase 2 commits to polyrepo (one repo
   per pack). If we accumulate 10+ device packs, monorepo with a
   tool like Nx or Turborepo might earn its keep. Defer.
2. **Versioning across packs.** Framework v1.x with packs at their
   own versions? Or align? Practical answer probably: framework is
   semver-stable, packs version independently.
3. **Distribution form for end users.** ZIP + setup.cmd today; signed
   `.exe` post-traction (P5-005). MCPB bundle (P5-008) is another
   option. Decision parking-lotted.
4. **Third-party pack discoverability.** A registry? A page in the
   framework README? Defer until there are third-party packs.
5. **License consistency.** Framework + first-party packs all
   Apache-2.0 (per [memory](../../Users/Steph/.claude/projects/C--dev-am4-tone-agent/memory/feedback_oss_from_day_one.md)).
   Third-party pack contributors choose their own license; we link
   to packs we trust.

## What this enables on launch day

Even though the split itself doesn't ship in v0.1.0, having this
roadmap committed lets the launch post say:

> "v0.1.0 is `mcp-midi-control` with Fractal AM4 support — the MCP layer
> is the product, AM4 is the first device. Axe-Fx II support extends
> the same Fractal protocol code (queued as v0.2). Hydrasynth Explorer
> and Roland/Boss device families are queued behind that. The Fractal
> protocol code will eventually spin out to its own `fractal-midi`
> package so it's reusable in non-MCP contexts (CLIs, web UIs, Python
> wrappers). Roadmap: [link to this doc]."

That posture is honest (single repo today, multi-repo planned),
specific (named devices, named order), credible (memory of backlog
items + decided naming + structural prep), AND signals to non-MCP
audiences that the protocol code will be liberatable independently
of the MCP layer — wins respect from the broader MIDI / tools
community who don't care about MCP specifically.

## References

- [`docs/04-BACKLOG.md`](04-BACKLOG.md) — BK-005 (other device support
  umbrella), BK-014 (Axe-Fx II), BK-029 (project rename, decided),
  BK-031 (Hydrasynth Explorer)
- [`docs/DECISIONS.md`](DECISIONS.md) — vendor-neutral name decision,
  ESM choice, distribution model
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — current single-repo
  architecture (will need updating after Phase 1 restructure)
- AlGrenadine's FractalBot / Fracpad — closed-source per-device
  editors that this project deliberately inverts
