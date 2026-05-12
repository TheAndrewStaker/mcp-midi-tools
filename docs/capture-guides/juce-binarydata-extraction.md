# JUCE BinaryData ZIP Extraction

> Pull every embedded resource (XMLs, SVGs, fonts, layout files) out
> of a closed JUCE-based editor in five minutes, with no captures, no
> debugger, no Ghidra. Discovered 2026-05-03 while reverse-engineering
> AM4-Edit; this guide is the technique generalised, with the AM4
> example at the bottom.

## Why this matters

Many vendor-supplied audio hardware editors ship as compiled binaries
with their UI configuration, parameter labels, layouts, and assets
embedded directly in the executable. Reverse-engineering a closed
editor's protocol typically means USBPcap captures, debugger
breakpoints, and code analysis — days to weeks per device.

For editors built on the [JUCE](https://juce.com/) framework, almost
all of that work is unnecessary. Projucer (JUCE's project generator)
bundles non-code assets via its **BinaryData** system, and a common
configuration packs them into a single ZIP archive embedded in the
binary's read-only data section.

That ZIP is a normal ZIP. You can extract it with `unzip` once you
locate it. The five-minute path:

1. Confirm the editor is JUCE-based.
2. Search the binary for the ZIP End-of-Central-Directory signature.
3. Slice and extract.
4. Read the layout XML files to map symbolic IDs to display labels.

If the editor isn't JUCE, this guide doesn't apply — fall back to
USBPcap + debugger workflows.

## Step 1: Is the editor JUCE-based?

Three reliable signals, any one is sufficient:

**A. Linked DirectX/DirectWrite stack on Windows.** JUCE's standard
Windows backend uses Direct2D + DirectWrite + DirectX 11. Run:

```powershell
# Replace EXE_PATH with the editor's path
& 'C:\Windows\System32\tasklist.exe' /M /FI "IMAGENAME eq <editor>.exe"
```

After launching the editor. If you see `dwrite.dll`, `d2d1.dll`,
`d3d11.dll` loaded together, that's a strong JUCE signal. Classic
GDI / GDI+ / Uniscribe alone is not.

**B. `juce::` symbols in the binary.** Even with stripped builds,
JUCE's `vftable` symbols, RTTI-derived class names, and assertion
strings often survive:

```bash
strings <editor>.exe | grep -i 'juce::' | head
```

A handful of hits is enough.

**C. Recognisable BinaryData filenames.** JUCE's Projucer prefixes
embedded resource names with `__` so they're valid C++ identifiers.
Search the binary for distinctive `__*.xml` / `__*.svg` strings:

```bash
strings <editor>.exe | grep -E '^__[a-z_]+\.(xml|svg|png|ttf|otf)$' | head
```

If you see filenames that look like project assets (`__layouts.xml`,
`__skin.xml`, `__icons.svg`), JUCE BinaryData is in play.

## Step 2: Locate the embedded ZIP

JUCE's BinaryData with the "Compress files" option enabled produces
a single ZIP archive concatenated into `.rdata`. Find it by searching
backward from end-of-file for the ZIP End-of-Central-Directory (EOCD)
signature `50 4B 05 06`:

```typescript
// Pseudocode:
import { readFileSync } from 'node:fs';
const buf = readFileSync(EXE);
// EOCD is in the LAST 22+commentLen bytes; scan backward.
let eocdOff = -1;
for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b &&
        buf[i+2] === 0x05 && buf[i+3] === 0x06) { eocdOff = i; break; }
}
const cdSize        = buf.readUInt32LE(eocdOff + 12);
const cdOffsetInZip = buf.readUInt32LE(eocdOff + 16);
const commentLen    = buf.readUInt16LE(eocdOff + 20);
// EOCD points at the central directory; central directory is
// preceded by all local file headers + their compressed data.
const zipStart = eocdOff - cdSize - cdOffsetInZip;
const zipEnd   = eocdOff + 22 + commentLen;
const zipBytes = buf.subarray(zipStart, zipEnd);
```

The slice `[zipStart, zipEnd)` is a valid ZIP archive. Write it to
disk and extract with any standard ZIP tool.

## Step 3: Extract

```bash
unzip <extracted>.zip -d ./resources/
ls resources/
```

A typical JUCE editor's BinaryData ZIP contains:

| File pattern | Purpose |
|---|---|
| `__*.xml` | Layout / parameter / control configuration |
| `*.svg` | UI icons and skins |
| `*.png` | Bitmap assets |
| `*.ttf` / `*.otf` | Embedded fonts |
| `Release-Notes.txt` (or similar) | Build metadata |

The XML files are the prize for protocol RE — they typically map
**symbolic parameter IDs** (the keys the binary uses internally) to
**display labels** (what the user sees on screen).

## Step 4: Map symbolic IDs to display labels

Open the XML files in a text editor or grep them. Look for entries
like:

```xml
<EditorControl name="Bright Cap" parameterName="DISTORT_BRIGHTCAP" type="knob"/>
```

Or in older JUCE conventions:

```xml
<EffectParameter id="DISTORT_BRIGHTCAP" name="Bright Cap"/>
```

The `parameterName` / `id` is the symbolic key used in the editor's
code and (often) on the wire. The `name` is the AM4-Edit-style
display label. Together they're a 100% accurate display-label
mapping, scoped to the firmware version that produced the binary.

For a project supporting agent control of the device, this means:
- Tool descriptions can use the exact word the user reads on screen.
- Parameter discovery is a one-shot extraction, not a
  capture-per-knob investigation.

## Step 5 (gotchas)

**The ZIP isn't always present.** Projucer's BinaryData has a
"Compress files" option that emits a ZIP; without it, individual
resources are inlined as raw byte arrays in `.rdata`. If
`PK\x05\x06` doesn't appear, search for individual `__*.xml`
strings and follow xref patterns to find the data instead.

**Multiple concatenated ZIPs.** Some binaries embed *more than
one* ZIP archive — for example, the editor's own layout/asset
ZIP plus a separately-bundled updater UI (Fractal's binaries
ship a Fractal-Bot ZIP alongside the editor's main ZIP). The
backward `PK\x05\x06` search finds only the LAST one, which may
be the wrong one. Two consequences:

  - For a SINGLE-ZIP binary like AM4-Edit, the last EOCD is the
    only EOCD and points at the editor's main bundle (which in
    AM4-Edit happens to also include the Fractal-Bot resources
    concatenated in one ZIP).
  - For a MULTI-ZIP binary like Axe-Edit III, the last EOCD
    points at the small Fractal-Bot-only ZIP (~700 KB, 58
    entries); the layout XMLs we want are in an EARLIER ZIP at
    a different EOCD (~8.5 MB, 398 entries, including a 1.3 MB
    `__block_layout.xml`).

**Detection:** if the last EOCD points at a ZIP that doesn't
contain the layout XMLs you expect, scan the entire binary for
all `PK\x05\x06` candidates and try each one. Most random byte
sequences that happen to match `PK\x05\x06` will have nonsense
EOCD fields (entries=65535, multi-GB sizes); a quick
plausibility check rules them out. The `scripts/extract-all-zips.ts`
script in this repo does exactly this: scans, validates, and
extracts every valid ZIP it finds.

**Some BinaryData uses gzip per-file rather than a single ZIP.**
Look for `1F 8B 08` (gzip member signature). Decompress per-file.

**Some editors store XML uncompressed but tokenised** (parsed
into a custom binary form by a custom XML preprocessor). Rare
but documented; falls back to the harder static analysis path.

**Versioned overlay XMLs.** For amps (and possibly other blocks),
Fractal ships firmware-version-specific layout overlays:
`__amp_layout_v24p00.xml`, `__amp_layout_v24p05.xml`,
`__amp_layout_v28p09.xml`, etc. The base `__amp_layout.xml`
covers the canonical layout; the `_vXXpYY` files are deltas
for when the firmware shifts amp-block parameters between
versions. When extracting and parsing for a multi-firmware
device, prefer the most recent `_vXXpYY` overlay AND the base
file together — they're a clean diff source and fit
straightforwardly into firmware-reconciliation workflows
(see BK-045).

## What this DOESN'T give you

- **Wire IDs (`pidLow` / `pidHigh`).** The XML knows the symbolic
  ID and the label. The wire ID — the bytes that go on the
  USB/MIDI cable to actually change the parameter — usually lives
  in a separate metadata file, in the device's firmware, or in
  the editor's compiled code. Captures are still required for
  this layer.
- **Value encoding (Q15, packed-float, septet packing).** The
  editor decodes wire values into display values via code, not
  data. Captures + structural analysis remain necessary.
- **Behavioural relationships** (which params depend on which,
  which knobs are gated by which type selector). Sometimes
  encoded in the XML's `controllingParamName` attributes;
  often in code.

So this technique gets you 30-40% of the device-onboarding work
for free, on day one. The rest of the protocol still needs the
classic captures + cache parsing + decode workflows. But the
**labelling** problem — which had been the hardest part of the
multi-device story for closed editors — is now a five-minute fix
per JUCE-based editor.

## AM4 worked example

**Target:** `C:\Program Files\Fractal Audio\AM4-Edit\AM4-Edit.exe`
(20.7 MB, build dated `Mar 20 2026 06:46:54`).

**Verification (Step 1):**
- DirectWrite + Direct2D + DirectX 11 confirmed loaded at runtime.
- `juce::MemoryInputStream::vftable` directly referenced from the
  loader caller `FUN_14031fed0` (Ghidra trace via
  `scripts/ghidra/TraceLoaderCallers.java`).
- `__components.xml`, `__block_layout.xml`,
  `__block_layout_expert.xml` filename strings present in the
  binary.

**Locate the ZIP (Step 2):**

EOCD `PK\x05\x06` found at file offset `0x7DFF26`. Header values:
- entries = 58 (in the EOCD record)
- cdSize = `0x1618`
- cdOffsetInZip = `0xA8D6E`

Computed `zipStart = 0x7DFF26 - 0x1618 - 0xA8D6E = 0x735BA0`. The
ZIP spans file `0x735BA0..0x7DFF40` — about 270 KB.

**Extract (Step 3):**

`scripts/extract-juce-resources-zip.ts` automates this. Output:
350 entries — three XML files (~1.5 MB uncompressed total) plus
347 SVG/PNG/font/audio assets.

**Map symbolic IDs (Step 4):**

`scripts/parse-am4edit-labels.ts` walks all three XMLs, tracks
parent-element context (`EditorControls > EffectVariants >
EffectVariant > Page > Parameters > Row > EditorControl`), and
emits `src/protocol/editorControlLabels.ts` with 1,299 unique
parameterNames and their canonical AM4-Edit display labels.

Spot-check confirms the previously-elusive labels are all
present:

| parameterName | canonicalLabel |
|---|---|
| `DISTORT_BRIGHTCAP` | Bright Cap |
| `DISTORT_HITREBLE` | High Treble |
| `DISTORT_SATDRIVE` | Saturation Drive |
| `DISTORT_MVTRIM` | Master Vol Trim |
| `DISTORT_BETA` | Negative Feedback |
| `COMP_KNEE` | Knee Type |
| `COMP_SIDECHAIN` | Sidechain Source |
| `FUZZ_SLEW` | Slew Rate |
| `FLANGER_FOCUS` | Bass Focus |

**Context-dependent labelling worked too:** `DISTORT_TREBLE`
shows as "Treble" on standard amps but "Tone" on simpler tone-
stack amps; `GEQ_GAIN3` shows as the actual Hz centre frequency
("125", "320", "400") which differs across GraphicEQ types. Both
captured in the `contexts[]` array per parameterName.

**Total time from start to extracted labels:** ~10 minutes,
including writing the script. The seven sessions of capture-driven
RE that preceded this finding (Frida, WinDbg, Ghidra, memory
dumps) were not strictly required for label extraction. They
remain load-bearing for protocol decode (wire IDs, value
encoding) but not for the labelling layer.

## Cross-references

- **`docs/SESSIONS.md` — Session 46 cont 3** (2026-05-03): full
  investigation narrative, including what was tried before this
  approach worked.
- **`scripts/extract-juce-resources-zip.ts`**: ready-to-run
  extractor. Drop in a path to any JUCE editor and extract.
- **`scripts/parse-am4edit-labels.ts`**: example of converting
  extracted XMLs into a structured TypeScript module. Copy the
  SAX-style walker for any similarly-structured XML.
- **`scripts/find-binarydata-by-hash.ts`** + **`find-binarydata-pointers.ts`**:
  failed approaches that ruled out hash-based and pointer-table
  BinaryData lookup before we found the ZIP. Useful as the first
  things to try if a future JUCE editor doesn't use the ZIP
  approach.

## Future devices to try this on

| Device | Editor | Likely JUCE? | Status |
|---|---|---|---|
| AM4 | AM4-Edit | ✓ JUCE | **Validated 2026-05-03** — 1,299 parameterNames extracted |
| Axe-Fx III / FM9 / FM3 / VP4 | Axe-Edit III | ✓ JUCE | **Validated 2026-05-03** — `__block_layout.xml` 1.3 MB, 10,250 EditorControl matches; same XML format as AM4 |
| Axe-Fx II XL+ | Axe-Edit II | Probably | Probe |
| Boss RC-505 MKII / VE-500 | Boss Tone Studio | Unknown | Probe |
| Line 6 Helix / HX Stomp | Helix Native, HX Edit | Unknown | Probe |
| Quad Cortex | NDSP Cortex Cloud | Unknown — desktop editor exists | Probe |
| AlGrenadine FractalBot / Fracpad | (closed) | Worth probing | Probe |

For each: run `scripts/probe-juce-binarydata.ts <exe>` first to
detect the ZIP. If found, run `scripts/extract-all-zips.ts <exe>`
to slice every valid ZIP out (multi-EOCD aware). Inspect the
resulting XML files for `<EditorControl>` entries. Result should
be a near-complete display-label catalogue for the device, ready
to wire into a per-device protocol package per the multi-repo
architecture (`memory/project_multi_repo_architecture.md`).
