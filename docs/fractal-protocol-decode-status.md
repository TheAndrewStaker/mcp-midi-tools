# Fractal protocol decode — status & references

**One-stop reference** for the cross-device Fractal protocol RE
work. If you're a new session (human or agent) trying to figure
out "what do we know about the Fractal protocol family, and where
is everything documented?", start here.

Last meaningful update: 2026-05-16 (Sessions 82-83 — Ghidra mining
sweep across AM4-Edit and Axe-Edit III).

---

## Devices covered

| Device | Model byte | Protocol family | Editor binary | Ghidra project | Decode state |
|---|---|---|---|---|---|
| AM4 | `0x15` | Axe-Fx III (subset + extensions) | `AM4-Edit.exe` | `C:\Users\Steph\ghidra-am4-edit.gpr` | **Most complete.** 50 effect families decoded; 332 of ~700 UI-relevant params named in `params.ts`. |
| Axe-Fx III | `0x10` | Axe-Fx III (full spec + community RE) | `Axe-Edit III.exe` (v1.14.31) | `C:\Users\Steph\ghidra-axe-edit-3.gpr` | **Partial.** 49 effect families decoded; SET_PARAM wire envelope undecoded (Session 83 ruled out fn=0x1f); preset-save 0x77/0x78/0x79 community-known. |
| Axe-Fx II XL+ | `0x07` | Axe-Fx II (separate family) | `Axe-Edit.exe` | `C:\Users\Steph\ghidra-axe-edit.gpr` | **Minimal.** SET_PARAMETER `0x02` shipping. Ghidra dispatcher mining staged but data-ref analyzer needs to re-run on the 32-bit project. |
| Hydrasynth Explorer | (vendor: ASM, not Fractal) | NRPN-based | n/a | n/a | Separate workstream — not part of this doc. |
| FM3 / FM9 / VP4 | `0x11` / `0x12` / `0x14` | Axe-Fx III family | (TBD if we add) | (TBD) | Not yet pursued. The Ghidra workflow recipe applies if/when we add them. |

---

## What's in each doc

### Wire-format references (committed, public)

| Doc | Covers |
|---|---|
| [`docs/SYSEX-MAP.md`](SYSEX-MAP.md) | AM4 wire spec. §6a is the `0x01` SET_PARAM dispatcher; §6p is the canonical Session-82-83 finding: `pidLow=block, pidHigh=catalog paramId`. §6b is value encoding (8-to-7 bit-pack), §6c block placement, §6k cab cross-block, §6m preset name read, etc. |
| [`docs/SYSEX-MAP-AXE-FX-III.md`](SYSEX-MAP-AXE-FX-III.md) | III wire spec. Covers v1.4 PDF (10 documented functions) + 21 fn bytes confirmed via Ghidra caller trace + the 49-effect dispatcher catalog. Documents what III's SET_PARAM ISN'T (after fn=0x1f hypothesis was ruled out). |
| [`docs/SYSEX-MAP-AXE-FX-II.md`](SYSEX-MAP-AXE-FX-II.md) | II wire spec — pre-Ghidra-era community RE work. |
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
- PATCH family pidLow TBD (case 0x3c, 85 params — scene/routing/4CM)
- GLOBAL family pidLow TBD (case 0x1, 99 params — system settings)

### III function-byte inventory (Session 82-83)

21 fn bytes confirmed via FUN_1403437d0 caller trace, vs 10 in v1.4 PDF:

`0x0A 0x0B 0x0C 0x0D 0x0E 0x0F 0x10 0x11 0x12 0x13 0x14 0x19 0x1A 0x1B 0x1F 0x3F 0x40 0x46 0x47 0x5A 0x5B 0x5C 0x74 0x75 0x76 0x77 0x78 0x79 0x7A 0x7B 0x7C`

The III's SET_PARAM wire envelope is **still undecoded** as of Session 83. fn=0x1f was the original suspect; caller decompile shows it only carries a 16-bit payload, too small for SET_PARAM. See `docs/SYSEX-MAP-AXE-FX-III.md` "What the III's SET_PARAM still isn't" for hypotheses.

---

## Open questions / next-session candidates

In rough order of impact:

1. **Apply ~268 UI-referenced proposed AM4 params to `packages/am4/src/params.ts`** — wire bytes are correct; needs unit/scale/range/enum metadata per entry. Start with reverb (43), delay (42), drive (90).

2. **Capture AM4 PATCH block pidLow** — toggle a routing/4CM option in AM4-Edit while capturing USB. Unlocks scene-MIDI / routing / 4CM MCP tools.

3. **Capture AM4 GLOBAL block pidLow** — same pattern. Unlocks system-wide MCP tools.

4. **Decode III SET_PARAM wire envelope** — USBPcap capture of AxeEdit III firing a single-knob change. Once decoded, the 2216-param III catalog becomes writable from the MCP surface.

5. **Re-run II-generation Ghidra mining** after Ghidra Auto Analyze with all data-ref analyzers enabled on the II project.

6. **Investigate generic `pidHigh` 7 and 8** — currently seen on `delay.kill_dry` and `amp.out_boost_level` respectively. Are they cross-block (a fifth and sixth generic slot) or block-specific overflows?

7. **Verify `amp.cab1_distance` `pidHigh`** — flagged by validator as using the generic balance slot. Either capture was right (cab semantics differ) or there's a typo.

8. **`SYSEX_DSP_MESSAGE` decode** — confirmed string in III binary, fn byte unknown. Would unlock `get_dsp_usage` per Session 78 forum-wishlist Item 3.

9. **AM4-Edit alternate dispatcher hunt** — case 0x3a in `FUN_1402e3da0` returns an empty table. What's its purpose? (Same on III's `FUN_140397a40`.) Are there OTHER dispatchers we haven't found?

10. **Cross-publish AM4 / III catalogs** — both binaries use the same Fractal symbolic names. A shared `fractal-shared/catalog/` package could centralize the per-family paramId enums (so amp.gain on AM4 and reverb.time on III both pull canonical names from one source). Architectural — would prep BK-051 unified surface.

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
  full per-effect param dictionaries for AM4 (1732 pairs) and III
  (2216 pairs). 21 III fn bytes confirmed via caller trace.
- **Session 83** (2026-05-16 overnight): **AMP=DISTORT closure +
  documentation hardening**. Validator, coverage report, full
  workflow recipe, II mining script staged. fn=0x1f walk-back. All
  Session 82-83 findings consolidated into committed docs (this
  file is the index).
