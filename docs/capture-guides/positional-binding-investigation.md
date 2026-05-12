# Positional binding investigation — XML parameterNames ↔ cache record IDs

**Status (2026-05-03, Session 46 cont 4):** Positional alignment is
**not viable**. Documented here so future sessions and other-device
ports (Axe-Fx III etc.) don't repeat the experiment.

## The hypothesis

Priority 2 from STATE.md cont 3 proposed binding the 1,140 unbound
XML parameterNames to wire IDs by positional alignment of
`SYMBOLIC_IDS_BY_BLOCK` (or XML first-occurrence order) against
the cache record-id sequence per block.

Sketch: if XML parameterName at position N corresponds to cache
record at position N in id-sorted order, then between two known
anchors (from the existing PARAMETER_BRIDGE 184 matches) we could
fill in the unbound positions by interpolation.

## The probe

`scripts/probe-positional-binding.ts` measures, per block:

1. Cache records per block (sorted by id, header excluded).
2. XML parameterNames per block (first-occurrence order across all
   variants in `editor-controls.json`).
3. The 184 existing bridge anchors give us pairs of
   (xml-position, cache-position).
4. Sort anchors by xml-position; check whether cache-position stays
   monotonically increasing.

Verdicts: green ≥90% monotonic, yellow 60–89%, red < 60%.

## The result

```
block        cache  xml   anchors  monotonic   verdict
-----------  -----  ----  -------  ----------  -------
amp            151   193       21       15/20  yellow
drive           49    42       22       16/21  yellow
reverb          72    65        5         2/4  red
delay           89    82       24       15/23  yellow
chorus          31    26        8         4/7  red
flanger         35    30        5         3/4  yellow
phaser          37    31        5         2/4  red
wah             29    23       18       13/17  yellow
compressor      41    33        9         4/8  red
geq             22    16       12        9/11  yellow
filter          40    35        7         3/6  red
tremolo         24    18        4         1/3  red
enhancer        17    11        5         3/4  yellow
gate            22    17        6         3/5  yellow
volpan          20    15        3         1/2  red
peq             36    31       16        5/15  red
rotary          23    19       14       10/13  yellow

Greens: 0
Yellows: 9 (75–80% monotonic — meaning 20–25% inversions)
Reds: 8
```

**Zero green blocks.** Best-scoring blocks are 75–80% monotonic.
Inversion rate of 20–40% across the corpus is too noisy for safe
interpolation between anchors.

## Why positional alignment fails — the deeper finding

The probe surfaced the structural reason: **XML parameterNames are
NOT unique per wire ID**. The same parameterName binds to multiple
cache record ids depending on variant.

Examples from the existing PARAMETER_BRIDGE (which were established
by display-label match, so the wire-side is hand-anchored):

| parameterName | bound to cache ids | meaning |
|---|---|---|
| `FUZZ_TONE` | drive.id=12 (`tone`), drive.id=23 (`treble`) | "Tone" knob in some drive variants is a different wire ID than "Treble" in others |
| `FUZZ_HIMID` | drive.id=21 (`mid`), drive.id=45 (`high_mid`) | "Mid" in some variants, "High Mid" in others |
| `DISTORT_EQ4` | amp.id=30 (`presence`), amp.id=65 (`geq_band_4`) | Used both for the simple amp's Presence and for the Expert GEQ's 4th band |
| `BLOCK_PAN` | every block × cache id 2 | Universal block-level Balance — same XML symbol, different wire address per block |
| `BLOCK_MIX` | every block with a Mix knob × cache id 1 | Same — universal Mix, per-block wire address |

The XML's `parameterName=` is a **per-variant UI symbol** ("the knob
labelled X in this view"), not a unique key for a wire-level
parameter. The XML `<EffectVariant>` system encodes which symbolic
name binds to which wire address per amp/drive/etc. type — that
binding is the bit we don't have.

## Implications

1. **Positional alignment paths are dead.** Both .exe-symbolic-ID
   order and XML first-occurrence order produce the same noise.
   The cache record id order reflects firmware data layout; the
   XML order reflects UI layout. Neither orders the same way.

2. **The 1,140 "unbound XML parameterNames" framing was wrong.**
   Many of those parameterNames actually correspond to wire IDs
   that ARE already hand-named in `paramNames.ts` — they just
   weren't matched because:
   - The XML uses the parameterName in a variant whose cache
     binding we didn't anchor.
   - Or the XML appears in a non-Amp-block container (Synth,
     Modifier, Controllers, MultiDelay, MegaTap, Output, Global,
     Input) that we don't expose as MCP-addressable blocks today.

3. **The wire-ID-naming gap that remains is real but smaller.**
   Per-block, we have:
   - cache records: ~700 user-facing
   - hand-named: 226 (the existing PARAM_NAMES coverage)
   - bridge-bound (with XML label): 184
   - unnamed cache records: ~470

   Naming those ~470 requires either hardware capture
   (wiggle the knob, see which cache id changes) or per-variant
   variant→wire-id binding extracted from .exe code.

## Paths forward

Cont 3 already closed hardware captures as a path for **label
discovery** (the JUCE BinaryData ZIP gives us all 1,299 canonical
labels for free). What remains open is **wire binding** — which
cache record corresponds to which parameterName. That gap is
separate from labels and isn't closed by more captures, because
captures bind ONE parameterName per knob-wiggle and there are
~470 unnamed cache records remaining. That doesn't scale.

### A. Ship v0.1.0 as-is — recommended

The 184-binding bridge covers 81% of the hand-curated registry.
The remaining ~470 unnamed cache records stay addressable via
`id_NN` fallbacks (see `extract-symbolic-ids.ts` plan); the
agent can still write them, just under less-friendly names like
`amp.id_77` instead of `amp.cathode_bias`.

For v0.1.0 launch, this is the right posture. The conversational-
preset MVP rarely needs to address obscure Expert-page knobs by
name — and when it does, it can use the symbolic ID via
`SYMBOLIC_IDS_BY_BLOCK`.

### B. Variant→wire-id binding via Ghidra — the only post-launch
   path that scales

The `<EffectVariant>` resolver in AM4-Edit.exe knows which
parameterName binds to which cache id per variant. That binding
is a code-driven dispatch (switch/jump table) — confirmed by the
absence of `cacheId=` / `wireId=` / similar attributes in the
embedded XML (audited 2026-05-03 cont 4). A Ghidra trace of the
resolver would expose the table machine-readably.

Cost: ~1 day of focused RE.

Output: complete `parameterName ↔ cache_id` mapping per block per
variant. Combined with the existing XML labels, this closes the
agent-facing param surface end-to-end.

Bonus: ports directly to Axe-Fx III / FM3-Edit / FM9-Edit /
VP4-Edit (same JUCE backend, same likely dispatcher pattern).

This is the right post-v0.1.0 deep-RE thread.

### Hardware captures — NOT a path for this gap

For label discovery, captures were superseded by cont 3's XML
extraction. For wire-binding closure, captures don't scale —
~470 unnamed cache records would need ~470 single-knob wiggles
across the 17 user-facing blocks (~6–10 hours of founder time
for partial coverage, no port to Axe-Fx III).

Captures are still useful for **protocol-quality verification**
of BK-035 release-gate work (confirming the wire still addresses
the right param), but they're not the lever for closing the
1,140-unbound-XML-parameterName gap. Path B is.

### C. Skip wire-binding closure entirely

Worth considering: do users actually ask the agent to address
the unnamed Expert-page params? If forum feedback after v0.1.0
shows users naming knobs the bridge can't resolve, prioritise
path B. If not, the 184-binding bridge may be sufficient long-
term and path B is over-engineering.

## Recommendation

**v0.1.0:** ship as-is (path A).

**Post-v0.1.0:** measure user demand for unbound params. If
demand is real, schedule path B (Ghidra `<EffectVariant>`
resolver trace). If not, path A stays sufficient.

Hardware captures are off the path for this gap.

## Artifacts

- `scripts/probe-positional-binding.ts` — the scoring script
- `samples/captured/decoded/labels/positional-probe.json` — per-block detail
- `samples/captured/decoded/labels/positional-probe.md` — review-friendly report
