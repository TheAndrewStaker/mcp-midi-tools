# Per-parameter descriptions — what AM4-Edit ships and what we need to source elsewhere

**Question (founder, 2026-05-03):** beyond display labels and symbolic
IDs, do the AM4-Edit XMLs contain per-parameter descriptions /
tooltips / help text that an AI agent could use to reason about what
each knob does?

**Answer:** No. AM4-Edit's distributed data has zero structured
per-parameter prose. The Fractal Audio Blocks Guide (already in
`docs/manuals/`) is the only authoritative prose reference, and it's
NOT embedded — it's a separate Fractal publication.

## Sources audited

### 1. `english.laxml` (UI localisation)

`C:/Program Files/Fractal Audio/AM4-Edit/english.laxml` — 123 entries
total, all of shape `<VALUE name="KEY" val="STRING" />`.

Key prefixes:
- `PROMPT_*` (~70 entries) — dialog titles + body text
  ("Bypass/Engage", "Confirm Save To")
- `TOOLTIP_*` (3 entries) — UI feedback ("Snapshot saved",
  "Preset saved")
- `PREFS_*` (~40 entries) — preferences-pane labels + body text
- `BROWSER_*`, `TITLEBAR_*`, `CPU_METER_*` — chrome strings

**Per-parameter content: none.** No keys of shape
`PARAM_<paramName>_DESC`, `PARAM_<paramName>_HELP`, etc. Not a
parameter-description source.

### 2. The three layout XMLs

`__block_layout.xml`, `__block_layout_expert.xml`, `__components.xml`
(extracted from AM4-Edit.exe's JUCE BinaryData ZIP).

Every `<EditorControl>` element carries: `name=` (display label),
`parameterName=` (symbolic ID), `type=` (widget class), plus a
constellation of layout/styling attributes (`col=`, `bounds=`,
`offsetX=`, `lock=`, `version_gtet=`, etc.).

Searched-for attributes that DON'T exist (zero occurrences):
`description=`, `helpText=`, `info=`, `semanticLabel=`, `prose=`.

**`tooltip=` does exist but only on UI chrome.** 84 occurrences
total, all in `__components.xml`, all on buttons / menus / browsers
("Display the Tuner", "Close Expert Edit", "Edit the selected
effect block"). Zero per-parameter tooltips. The two
`__block_layout*.xml` files have **zero** `tooltip=` attributes.

`cursorStrUnits=` carries display-unit hints ("Hz") for graph
widgets — useful for a small number of frequency-display widgets
but not parameter-description content.

### 3. `__components.xml` other contents

Two `<Column text="Description" identifier="description" />`
entries — these are TABLE COLUMN definitions for preset/cab
browser views (the "Description" column in the browser). They
reference a description FIELD that the user fills in, not a
per-parameter knob description.

### 4. `AM4-Edit-Release-Notes.txt`

Changelog only (versions 1.00.04, 1.00.03, etc.). Documents UI
improvements and bug fixes per release. Zero parameter prose.

### 5. Memory dumps (not exhaustively searched)

Three dumps available (`session-46-am4edit.DMP` etc., ~230 MB
each). If descriptions were loaded into RAM, AM4-Edit would have
needed a source for them in its distributed files — which we just
ruled out. So memory probably doesn't surface anything new. Not
worth the spelunking time.

## What we DO have

**The Fractal Audio Blocks Guide** at
`docs/manuals/Fractal-Audio-Blocks-Guide.txt` (4,746 lines,
PDF-extracted plaintext, June 2023 edition).

Coverage: ~200–300 unique parameters across the AM4 / FM3 / FM9 /
Axe-Fx III block surface, written as flowing prose. Example
(power amp page, lines 601–637):

> **Negative Feedback** — This controls the amount of negative
> feedback, or damping, in the power amp simulation. Higher
> values give a tighter and brighter sound but can be harsh at
> high master volume levels. Lower values give a loose, gritty
> sound. Negative Feedback is set to a "correct" value whenever
> you reset or change the amp type, but other settings can be
> interesting too…

Format: free-form paragraphs, **NOT** structured key→prose. A
parameter description has to be located by matching the bold
label at the start of a paragraph against the XML's `name=`
display label.

## Options if we want descriptions in the bridge

### A. Regex-extract from the Blocks Guide

Walk the Blocks Guide TXT, find sections of shape `**Label**` /
`Label —` / similar, capture the following paragraph as the
description, and key by `Label`. Then join against the bridge's
`canonicalLabel` to get `(parameterName, description)` pairs.

Likely yield: ~150–250 parameters with non-empty descriptions.
The agent would get prose for the most frequently asked-about
knobs.

Risks: section detection regex needs tuning per Blocks Guide
edition; some labels are ambiguous across blocks ("Tone" appears
in many places); the bridge's canonical labels are XML-side
and may differ from Blocks Guide phrasing.

Estimated effort: 2–4 hours.

### B. LLM-summarised per-parameter context

For each `(block, parameterName, canonicalLabel)` triple, prompt
an LLM with the Blocks Guide section text plus the parameter
context, ask for a one-sentence description. Persist as
`paramDescriptions.ts`.

Higher quality and more uniform than regex; more expensive in
LLM-call budget. Would pair well with description-vs-label
disambiguation.

### C. Skip — agent already has Blocks Guide as project knowledge

The Claude Project that hosts the agent already has the Blocks
Guide PDF in its knowledge base (per the project setup
instructions in `CLAUDE.md`). When the user asks "what does Bright
Cap do?", the agent can fetch from the PDF directly. Adding
descriptions to the bridge is a UX polish — the agent isn't
blind without them.

## Recommendation

**Skip for v0.1.0.** Path C is already in place via the Claude
Project knowledge base. The bridge's value is in providing the
canonical *label* so the agent's user-facing strings match what's
on the AM4-Edit screen; descriptions are a separate axis.

**Path A is a candidate post-v0.1.0** if forum feedback shows
agents struggle to explain less-common knobs. ~3 hours of work
buys per-parameter prose in the bridge response, no PDF lookup
required at conversation time.

**Path B is over-engineering** unless we hit a specific gap that
A can't close.

## Files this investigation touched

- (read-only) `english.laxml` from `C:/Program Files/Fractal Audio/AM4-Edit/`
- (read-only) `samples/captured/decoded/binarydata/extracted/__*.xml`
- (read-only) `samples/captured/decoded/binarydata/extracted/AM4-Edit-Release-Notes.txt`
- (read-only) `docs/manuals/Fractal-Audio-Blocks-Guide.txt`

No new captures or scripts were needed; the audit ran entirely
against existing artifacts.
