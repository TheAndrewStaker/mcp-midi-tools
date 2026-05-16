# Fractal protocol decode — status & references

**One-stop reference** for the cross-device Fractal protocol RE
work. If you're a new session (human or agent) trying to figure
out "what do we know about the Fractal protocol family, and where
is everything documented?", start here.

Last meaningful update: Session 87 cont (2026-05-16 — cross-ref
audit infra + `displayLabel` field + scene-MIDI test-send wire
shape decoded + SysEx assembler fragmentation fix that unbroke the
AM4 dirty-gate; Sessions 84–86 closed Main Levels + PATCH routing
+ scene-MIDI on real hardware; Axe-Fx II Ghidra recommendation
flipped to "skip — captures are cheaper"; III `0x02 SET_PARAMETER`
shipped 🟡 untested).

> **Run `npm run coverage-audit` before trusting any state claim in
> this doc.** The audit reads `packages/*/src/params.ts` +
> `scripts/verify-msg.ts` directly and reports current AM4-placeable
> coverage by-device — most reliable single-command answer to "where
> are we?" As of Session 87 cont: AM4 placeable coverage is **50%**
> (`PIDLOW_TO_FAMILY` override in Session 87 cont fixed a CABINET
> miscount — 16 entries had been attributed to DISTORT, depressing
> the headline; placeable-only TOTAL is now what's reported, not the
> misleading 18% that included product-line-only families). 196/196
> verify-msg goldens green. Cross-ref audit (Session 87 cont):
> `scripts/_research/coverage-cross-ref-audit.ts` joins Ghidra
> catalog ↔ AM4-Edit XML ↔ `params.ts` and flags
> **WIRED-MATCHED / WIRED-MISLABEL=135 / UI-MISSING=298 / GHOST=61**.
> Wired into preflight as a drift guard at `WIRED_MISLABEL_CEILING=135`.

---

## Devices covered

| Device | Model byte | Protocol family | Editor binary | Ghidra project | Decode state |
|---|---|---|---|---|---|
| AM4 | `0x15` | Axe-Fx III (subset + extensions) | `AM4-Edit.exe` | `C:\Users\Steph\ghidra-am4-edit.gpr` | **Most complete.** 463 params shipped covering 50% of AM4-placeable catalog. PATCH family closed Sessions 84–87 (routing — §6n-patch; scene-MIDI 48 params — §6n-scene-midi; scene-MIDI test-send partial — §6n-scene-midi-test, HW-111 open). 1732 paramId/name pairs across 50 families mined Session 82 (catalog). 322/463 params now carry the optional `displayLabel` field (Session 87 cont — generated from AM4-Edit XML; surfaced to LLM as recognition synonym). Cross-ref audit: WIRED-MATCHED + WIRED-MISLABEL=135 + UI-MISSING=298 + GHOST=61. |
| Axe-Fx III | `0x10` | Axe-Fx III (full spec + community RE) | `Axe-Edit III.exe` (v1.14.31) | `C:\Users\Steph\ghidra-axe-edit-3.gpr` | **Partial.** v1.4 PDF opcodes shipping (bypass/channel/scene/tempo/looper/status). Ghidra Session 82 mined **2216 paramIds across 49 families** + **21 fn bytes confirmed in binary** (vs 10 in v1.4 PDF). `0x02 SET_PARAMETER` ported from II model byte `0x03`→`0x10` and shipped 🟡 untested Sessions 85+86 (commit `6b8ab07`) — see SYSEX-MAP-AXE-FX-III §0x02 SET_PARAMETER. MCP tools `axefx3_set_parameter` / `axefx3_get_parameter` exist with explicit `⚠ UNTESTED` banners; one III contributor running `axefx3_get_parameter(block="Reverb 1", param_id=0)` against a scratch preset unlocks 2216 paramIds. Preset-save 0x77/0x78/0x79 community-known (forum thread #159885 archived). |
| Axe-Fx II XL+ | `0x07` | Axe-Fx II (separate family) | `Axe-Edit.exe` | `C:\Users\Steph\ghidra-axe-edit.gpr` | **905 params shipping** via wiki + capture decode. `0x02 SET_PARAMETER` hardware-verified (HW-075 / HW-077). Ghidra II mining attempted Sessions 83–84 — **negative finding**: the 32-bit Axe-Edit binary uses indirect dispatch (likely hash-keyed), the byte-pattern + xref technique that worked on AM4/III yields only **9/1125 refs / 3 UI-prompt functions**. Session 87 cont recommendation: **skip Ghidra for II — captures are cheaper than another dispatcher hunt on 32-bit code**. Diagnosis + unblock notes documented in `scripts/ghidra/MineAxeEditIIParamResolver.java` header. |
| Hydrasynth Explorer | (vendor: ASM, not Fractal) | NRPN-based | n/a | n/a | Separate workstream — not part of this doc. |
| FM3 / FM9 / VP4 | `0x11` / `0x12` / `0x14` | Axe-Fx III family | (TBD if we add) | (TBD) | Not yet pursued. The Ghidra workflow recipe applies if/when we add them. |

---

## What's in each doc

### Wire-format references (committed, public)

| Doc | Covers |
|---|---|
| [`docs/SYSEX-MAP.md`](SYSEX-MAP.md) | AM4 wire spec. §6a is the `0x01` SET_PARAM dispatcher; §6p is the canonical Session-82-83 finding: `pidLow=block, pidHigh=catalog paramId`. §6b value encoding (8-to-7 bit-pack), §6c block placement, §6k cab cross-block, §6l Main Levels (Session 84 — `preset.level / balance / scene_{1..4}_level`), §6m preset-name read, §6n-patch PATCH routing (Session 84), §6n-scene-midi 48 scene-MIDI params (Session 85+86), §6n-scene-midi-test test-send wire frame `action=0x0004 / pidHigh=0x0070` (Session 87 cont 🟡 partial — HW-111). |
| [`docs/SYSEX-MAP-AXE-FX-III.md`](SYSEX-MAP-AXE-FX-III.md) | III wire spec. Covers v1.4 PDF (10 documented functions) + 21 fn bytes confirmed via Ghidra caller trace + the 49-effect dispatcher catalog. **§0x02 SET_PARAMETER** documents the II→III port (model byte `0x03`→`0x10`, Sessions 85+86) with community-evidence chain and the one-call test that converts 🟡→🟢. Documents what III's SET_PARAM ISN'T (fn=0x1f ruled out Session 83). |
| [`docs/SYSEX-MAP-AXE-FX-II.md`](SYSEX-MAP-AXE-FX-II.md) | II wire spec — pre-Ghidra-era community RE work. Still the canonical doc; Session 87 cont confirmed Ghidra is not a cheaper alternative on the II 32-bit binary. |
| [`docs/BLOCK-PARAMS.md`](BLOCK-PARAMS.md) | AM4 block reference. Header table maps each AM4 block to its pidLow, catalog family, dispatcher case, and catalog param count. Points at the Ghidra catalog as the primary source. |
| [`docs/ghidra-mining-workflow.md`](ghidra-mining-workflow.md) | **Workflow recipe**: how to mine a new Fractal editor binary. Captures the 3-tier proven technique, v1 failure modes to avoid, dispatcher discovery, ParamDescriptor struct layout, headless runner pattern, cross-block addressing pattern. Read this first before opening a new Ghidra project. |

### Research / decode-history (committed)

| Doc | Covers |
|---|---|
| [`docs/axefx3-fn01-decode.md`](axefx3-fn01-decode.md) | III function 0x01 — three-mode envelope. Session 81-82 RE work. |
| [`docs/axefx3-preset-format-research.md`](axefx3-preset-format-research.md) | III preset-save format research (forum thread #159885 archive). |
| [`docs/axe-fx-ii-community-re-methodology.md`](axe-fx-ii-community-re-methodology.md) | II community RE methodology background. |
| [`docs/DECISIONS.md`](DECISIONS.md) | Architectural decisions. 2026-05-16 entry covers the Ghidra-as-canonical-RE-method decision. |

### Ghidra outputs (gitignored — regenerate locally)

All under `samples/captured/decoded/`:

| File | How to regenerate |
|---|---|
| `ghidra-am4-paramnames.json` | `scripts/ghidra/run-am4-paramnames.cmd` |
| `ghidra-axeedit3-paramnames.json` | `scripts/ghidra/run-axeedit3-paramnames.cmd` |
| `ghidra-axeedit3-message-builders.txt` | `scripts/ghidra/run-axeedit3-message-builders.cmd` |
| `ghidra-axeedit3-v2.txt` (mining sweep) | `scripts/ghidra/run-axeedit3-v2.cmd` (if exists; else run via GUI) |
| `am4-params-proposed.ts` | `npx tsx scripts/_research/generate-am4-params-from-catalog.ts` |
| `am4-coverage-report.md` | `npx tsx scripts/_research/am4-catalog-coverage-report.ts` |

---

## Ghidra scripts (committed, regenerate outputs locally)

Under `scripts/ghidra/`:

### Per-device scripts

| Script | Targets | Purpose |
|---|---|---|
| `MineAxeEditIII.java` / `MineAxeEditIIIv2.java` | Axe-Edit III.exe | Broad protocol-string sweep — symbol-table walk + byte-pattern hits + instruction-walk fallback |
| `MineAxeEditIIIParamResolver.java` | Axe-Edit III.exe | Rank functions by # of param-symbol references — identifies the dispatcher |
| `DumpAxeEditIIIParamNames.java` | Axe-Edit III.exe | Extract per-effect `(paramId, name)` pairs from the dispatcher |
| `DumpAxeEditIIIParamTables.java` / `V2.java` | Axe-Edit III.exe | Earlier table-extraction iterations (superseded by ParamNames) |
| `TraceAxeEditIIIMessageBuilders.java` | Axe-Edit III.exe | Walk callers of generic SysEx builders to enumerate fn bytes |
| `MineAM4EditParamResolver.java` | AM4-Edit.exe | AM4 equivalent of the III resolver script |
| `DumpAM4ParamNames.java` | AM4-Edit.exe | AM4 equivalent of the III param-names dumper |
| `MineAxeEditIIParamResolver.java` | Axe-Edit.exe (II) | II equivalent — currently blocked on data-ref analyzer rerun |
| `run-*.cmd` | (runners) | Headless invocation wrappers |
| Earlier-era scripts (`FindEncoder.java`, `FindAxeEditRouting.java`, etc.) | AM4-Edit / II | Original techniques the Session 82-83 work was built on |

### Analysis helpers (TypeScript)

Under `scripts/_research/`:

| Script | Purpose |
|---|---|
| `survey-axeedit3-anchors.ts` | Bucket strings JSON by prefix family to pick Ghidra anchors |
| `analyze-param-symbol-tables.ts` | Find contiguous runs in offset-sorted string lists |
| `find-axeedit3-sysex-fnbyte-array.ts` | Scan binary for parallel fn-byte arrays (negative result on III) |
| `mine-axeedit3-sysex-table.ts` | Extract+sort SYSEX_* strings |
| `parse-ghidra-axeedit3-mine.ts` | Post-Ghidra structured extraction (switch cases, decompile blocks) |
| `compare-am4-params-coverage.ts` / `v2.ts` | Audit params.ts against Ghidra catalog |
| `generate-am4-params-from-catalog.ts` | Emit proposed `params.ts` entries from catalog (verified wire mapping) |
| `validate-params-against-catalog.ts` | Validate `params.ts` correctness against catalog + blockTypes.ts |
| `am4-catalog-coverage-report.ts` | Emit per-block markdown coverage report |
| `coverage-cross-ref-audit.ts` | **Three-way join (catalog ↔ XML ↔ params.ts)** — Session 87 cont. Classifies every catalog entry as WIRED-MATCHED / WIRED-MISLABEL / UI-MISSING / GHOST / PIDLOW-UNKNOWN. Wired into preflight as a drift guard at `WIRED_MISLABEL_CEILING=135`. Output: `samples/captured/decoded/coverage-cross-ref-audit.md` |
| `add-display-labels.ts` | Idempotent generator that populates the optional `displayLabel` field on `params.ts` entries from AM4-Edit XML (322/463 entries populated as of Session 87 cont) |
| `decode-session-85-scene-midi.ts` | Decode scene-MIDI captures into 16-msg Type/Channel/Value rows (Session 85+86) |
| `decode-hw110.ts` | Decode HW-110 scene-MIDI test-send capture (Session 87 cont) |
| `probe-dirty-gate.ts` | Regression probe that hashes the AM4 working buffer twice + asserts dirty-after-set_param differs + asserts switch_preset refuses with structured warning. Locks in the Session 87 SysEx assembler fix. |

---

## Key findings cheat sheet

### Wire mapping (verified 99% on AM4)

- `pidLow` = block-type pidLow from `packages/am4/src/blockTypes.ts`
- `pidHigh` ≥ 10 = Ghidra catalog paramId for that block's family
- `pidHigh` 0-9 = generic shared params (0=level, 1=mix, 2=balance, 4=bypass_mode; 7+8 partially documented)
- `pidHigh` = 0x07D2 (2002) = channel-select register (separate code path)

### Cross-block addressing on AM4

- AMP + DRIVE both pull from DISTORT family (case 0xa, 143 params).
  AMP via `pidLow=0x003a`, DRIVE via `pidLow=0x0076`.
- AMP has NO separate dispatcher case. Closes the Session 82
  "missing AMP dispatcher" question.

### Non-placeable addressable blocks

These pidLows are addressable but not in `BLOCK_TYPE_VALUES`:

- `0x0025` Input Noise Gate (`ingate.*`, INPUT family)
- `0x003e` Cabinet (CABINET family, §6k)
- `0x00CE` PATCH family (case 0x3c, 85 params — preset.level/balance, scene_{1..4}_level, routing_slot_{2,3,4}, scene_{1..4}_midi_{1..4}_{type,channel,value}). Decoded Sessions 84–86 — §6n-patch + §6n-scene-midi. The PATCH `PATCH_SCENE_OUTPUT1..4` entries are NOT a phantom per-scene output mode — they're the Scene N Level knobs already shipping at `preset.scene_{1..4}_level` (Session 87 cont closure). `PATCH_4CM` is a firmware ghost with no AM4-Edit UI (4CM on AM4 is a wiring pattern, not a software toggle).
- GLOBAL family pidLow TBD (case 0x1, 99 params — system settings)

### Transport-layer fix (Session 87)

`packages/core/src/midi/transport.ts:createSysExAssembler` (pure
exported function, ~50 LOC) buffers bytes between F0…F7 across
multiple WinMM callbacks before invoking downstream handlers.
RtMidi's WinMM input callback delivers SysEx in 1024-byte chunks
without waiting for `F7`, so a 3082-byte AM4 preset dump arrived
as 3–4 separate `message` events and the dirty-gate's preset-dump
receiver rejected every chunk as malformed → fingerprint cache
never populated → every navigation silently discarded dirty edits.
The fix is wired into `connect()` and covered by 7 byte-exact
goldens in `scripts/verify-sysex-assembler.ts` (3082-byte AM4
4-fragment case, 2KB 2-fragment case, single-fragment, back-to-
back SysEx, interleave, empty fragments). Affects every device
that reads messages >1024 bytes (AM4 preset dumps + factory
restore; II preset dumps are larger).

### III function-byte inventory (Session 82-83)

21 fn bytes confirmed via FUN_1403437d0 caller trace, vs 10 in v1.4 PDF:

`0x0A 0x0B 0x0C 0x0D 0x0E 0x0F 0x10 0x11 0x12 0x13 0x14 0x19 0x1A 0x1B 0x1F 0x3F 0x40 0x46 0x47 0x5A 0x5B 0x5C 0x74 0x75 0x76 0x77 0x78 0x79 0x7A 0x7B 0x7C`

The III's SET_PARAM wire envelope is **still undecoded** as of Session 83. fn=0x1f was the original suspect; caller decompile shows it only carries a 16-bit payload, too small for SET_PARAM. See `docs/SYSEX-MAP-AXE-FX-III.md` "What the III's SET_PARAM still isn't" for hypotheses.

---

## Open questions / next-session candidates

In rough order of impact:

1. **Verify `axefx3_set_parameter` on real III hardware** (commit `6b8ab07`, Sessions 85+86) — wire shape ported from II by swapping model byte `0x03`→`0x10` and shipped 🟡 untested. Founder doesn't own a III. First III contributor running `axefx3_get_parameter(block="Reverb 1", param_id=0)` against a scratch preset confirms or refutes. Three outcomes documented in `docs/SYSEX-MAP-AXE-FX-III.md §0x02 SET_PARAMETER`. If accepted, 2216 III paramIds become writable from the MCP surface.

2. **Close the 298 UI-MISSING AM4 params** — wired gaps where the catalog has the symbol AND XML exposes the control AND `params.ts` has no entry. Top families: CABINET (54), REVERB (42), DELAY (40), DISTORT (35). Each needs a capture or AM4-Edit screenshot for range/unit (the catalog doesn't carry those). Roadmap item, not a single session task. Route through `paramNames.ts` overrides not direct `params.ts` edits — blunt blind-merge corrupts unit metadata (Session 84 bug pattern).

3. **HW-111 — decode the scene-MIDI test-send per-row payload byte packing** (Session 87 cont). Per-scene "Send All" payload fully decoded: `byte[2] = (scene_idx<<5) | 0x0F`. Per-row payload partial. Closes SYSEX-MAP §6n-scene-midi-test from 🟡 → 🟢. P3, non-blocking.

4. **WIRED-MISLABEL review pass** (135 entries, Session 87 cont). Most are intentional disambiguation (e.g. `cab_mic_preamp_drive` is more specific than "Drive"); some are real (e.g. `align_distance_1` should arguably be `mic_distance_1` to match the UI). One review pass through `samples/captured/decoded/coverage-cross-ref-audit.md` "WIRED-MISLABEL findings" section could lower the ceiling and improve LLM prompt matching.

5. **action=0x0017 anomaly trigger still unknown.** Session 87 cont ruled out test-send buttons via HW-110 (16 per-row + 4 per-scene clicks → zero `action=0x0017` frames; test-send fires `action=0x0004 / pidHigh=0x0070` instead). Next candidate hypotheses: "Quick Build" button or another page-level AM4-Edit action. NOT blocking any user-facing feature.

6. **Capture AM4 GLOBAL block pidLow** — toggle a system setting in AM4-Edit while capturing USB. Unlocks system-wide MCP tools (USB levels, tap-tempo mode, etc.). Case 0x1, 99 params.

7. **Investigate generic `pidHigh` 7 and 8** — currently seen on `delay.kill_dry` and `amp.out_boost_level` respectively. Are they cross-block (a fifth and sixth generic slot) or block-specific overflows?

8. **Verify `amp.cab1_distance` `pidHigh`** — ~~validator-flagged~~ **resolved Session 83**: hardware-verified at pidHigh=0x02 under cab pidLow=0x3e (cross-block addressing per §6k). Ghidra catalog's `CABINET_PROXIMITY1` (paramId 20) is a separate unbound cab param. Kept here as a pointer; not a real open question.

9. **`SYSEX_DSP_MESSAGE` decode** — confirmed string in III binary, fn byte unknown. Would unlock `get_dsp_usage` per Session 78 forum-wishlist Item 3.

10. **AM4-Edit alternate dispatcher hunt** — case 0x3a in `FUN_1402e3da0` returns an empty table. What's its purpose? (Same on III's `FUN_140397a40`.) Are there OTHER dispatchers we haven't found?

11. **Cross-publish AM4 / III catalogs** — both binaries use the same Fractal symbolic names. A shared `fractal-shared/catalog/` package could centralize the per-family paramId enums (so amp.gain on AM4 and reverb.time on III both pull canonical names from one source). Architectural — would prep BK-051 unified surface.

**Closed since last update:**

- ~~Capture AM4 PATCH block pidLow~~ — closed Session 84 (`pidLow=0x00CE`, §6n-patch).
- ~~Decode the 0x3e81 action=0x0017 scene-MIDI anomaly~~ — decoupled Session 85+86: scene-MIDI uses standard `action=0x0001 SET_PARAM`; the 0x0017 anomaly is a different (unknown-trigger) operation.
- ~~Re-run II-generation Ghidra mining after data-ref analyzer fix~~ — closed Session 87 cont as **negative finding**: 32-bit Axe-Edit uses indirect dispatch; xref technique yields 9/1125 refs. **Skip Ghidra for II.**
- ~~PATCH_SCENE_OUTPUT1..4 + PATCH_4CM coverage gaps~~ — closed Session 87 cont: the SCENE_OUTPUT entries ARE the Scene N Level knobs (already shipping); `PATCH_4CM` is a firmware ghost with no UI.
- ~~SysEx fragmentation breaking AM4 dirty-gate~~ — closed Session 87 (`createSysExAssembler` in `transport.ts` + 7 goldens).

---

## Where to find what

| Question | Answer |
|---|---|
| What does a SysEx envelope look like? | `docs/SYSEX-MAP.md` §2, `docs/SYSEX-MAP-AXE-FX-III.md` "Envelope" |
| What pidLow does block X use? | `packages/am4/src/blockTypes.ts` (placeable) + `docs/SYSEX-MAP.md` §6p (non-placeable: cab, ingate) |
| What params does block X have? | `samples/captured/decoded/ghidra-am4-paramnames.json` (regenerate via `.cmd`) + coverage report |
| What's verified vs hypothesized? | This doc's "Devices covered" + "Open questions" |
| How do I decode a new Fractal device? | `docs/ghidra-mining-workflow.md` |
| Why does AMP share DISTORT? | `docs/SYSEX-MAP.md` §6p + this doc's cross-block section |
| What's the next high-impact decode work? | This doc's "Open questions" — items 1-4 are the unlocks |

---

## Session log (high-level)

- **Sessions 1-77**: AM4 protocol reverse-engineering via USB capture
  + hand-decode. Built `params.ts` (~400 entries), all 4 slots, scenes,
  channels, preset save/rename. Detailed in `docs/_private/SESSIONS.md`
  (gitignored — founder's local log).
- **Session 78-79**: Mock transport for agent-regression; III forum-
  scrape research; III function 0x01 decode.
- **Session 80-81**: III 0x64 result-code table extracted from AxeEdit
  III binary (28 codes); III v1.4 non-addressable IDs marked
  (ID_CONTROL, ID_MIDIBLOCK, ID_FOOTCONTROLLER, ID_PRESET_FC).
- **Session 82** (2026-05-16): **Ghidra mining sweep**. Extracted
  full per-effect param dictionaries for AM4 (1732 pairs / 50
  families) and III (2216 pairs / 49 families). 21 III fn bytes
  confirmed via caller trace.
- **Session 83** (2026-05-16 overnight): **AMP=DISTORT closure +
  documentation hardening**. Validator, coverage report, full
  workflow recipe, II mining script staged. fn=0x1f walk-back.
- **Session 84** (2026-05-16): **Two AM4 hardware decodes closed in
  one session.** HW-067a Main Levels (`preset.level / balance /
  scene_{1..4}_level`, §6l). PATCH family (`pidLow=0x00CE`,
  §6n-patch) — routing toggles, 10 new MCP params, 185/185
  verify-msg goldens green.
- **Sessions 85+86** (2026-05-16): **Scene-MIDI bank decoded
  end-to-end.** 48 new MCP-addressable params
  (`preset.scene_{1..4}_midi_{1..4}_{type,channel,value}`),
  Type-enum-folds-CC# encoding screenshot-confirmed (§6n-scene-midi).
  Axe-Fx III `0x02 SET_PARAMETER` ported from II 🟡 untested.
- **Session 87** (2026-05-16): **AM4 dirty-gate fixed at the
  transport root.** `createSysExAssembler` in
  `packages/core/src/midi/transport.ts` (~50 LOC pure function)
  buffers F0…F7 across WinMM's 1024-byte SysEx chunks; closes a
  bug where 3082-byte AM4 preset dumps arrived as 3–4 separate
  events and the dirty-gate silently fell through to proceed.
  Verified live against AM4 via `probe-dirty-gate.ts`.
- **Session 87 cont** (2026-05-16): **Cross-ref audit infra +
  displayLabel field + scene-MIDI test-send wire shape.**
  `coverage-cross-ref-audit.ts` joins catalog ↔ XML ↔ params.ts
  (WIRED-MISLABEL=135 / UI-MISSING=298 / GHOST=61, wired into
  preflight). `Param.displayLabel` optional field added, 322/463
  AM4 entries populated. HW-110 closed (test-send fires
  `action=0x0004 / pidHigh=0x0070`, NOT the 0x0017 anomaly);
  per-scene "Send All" payload decoded; per-row payload partial
  (HW-111 open). Ghidra II mining: **negative finding** — skip
  Ghidra for II; 32-bit indirect dispatch defeats the technique.
  Coverage-audit now reports by-device with placeable-only TOTAL
  (50%, not the misleading 18% that included product-line families).
