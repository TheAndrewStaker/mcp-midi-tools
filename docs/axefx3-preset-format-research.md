# Axe-Fx III preset-file format — research log

**Source of truth for this doc:** Fractal Forum thread "Axe-Fx III and
deconstructing / parsing a .syx / sysex preset file"
([#159885](https://forum.fractalaudio.com/threads/axe-fx-iii-and-deconstructing-parsing-a-syx-sysex-preset-file.159885/)),
4 pages, March 2020 – July 2025. Local archive:
`docs/_private/fractal-forum-text.txt` (1304 lines).

The Axe-Fx III's preset save format is **not in the v1.4 PDF**. This
file captures what's been community-reverse-engineered, with citations
to forum posts so the chain of evidence is auditable.

---

## Top-line findings

1. **The preset .syx file is a multi-frame envelope.** Not a single
   STORE_PRESET function byte. III presets are 18 SysEx messages:
   - 1× `0x77` header (13 bytes)
   - 16× `0x78` body chunks (3082 bytes each)
   - 1× `0x79` footer (11 bytes)
   - FM3 / FM9 presets are 10 messages (8× 0x78 body chunks) — same
     header / footer.
   Source: ectoplasm88 post #38 + #39 (May 2025), confirmed across 3
   FX3 presets from different firmwares **and our own walk of the
   v28.06 factory ALL-BANKS file (384 presets, 100% match)**.
   See `scripts/_research/analyze-factory-bank.ts`.

   **Header (0x77) carries destination location:**
   - Factory presets: `[0x00, slot_lo, 0x00, 0x00, 0x01]` — byte 1 is
     the preset slot index (verified across 384 factory presets,
     monotonically incrementing 0..383).
   - User-edit-buffer dumps: `[0x7F, 0x00, 0x00, 0x00, 0x01]` — byte 0
     `0x7F` = edit-buffer / "no fixed destination" marker.

   **Footer (0x79) carries a 3-byte checksum** that's unique per
   preset (384 distinct values across the factory bank).

   **Body[0] starts with constant magic** `00 08 3F 02 00 55 54 02`
   (offsets 0-7 of body payload). Then variable bytes including the
   preset-name region around offsets 14-47 with `0x01` interleavers
   that look like high-bit overflow markers.

2. **System-bank SysEx uses analogous envelope at 0x51/0x52/0x53.**
   The "settings backup" produced by Fractal-Bot has the same shape
   as a preset, but in a different function-byte range:
   - 1× `0x51` header
   - 64× `0x52` body chunks
   - 1× `0x53` footer
   Source: philflieger post in Fractal Forum thread #201663
   ("Reverse engineer undocumented sysex?", 2024-02), confirmed by
   AlGrenadine in same thread by not contradicting.

   Implication: Fractal's wire architecture uses paired
   header/body/footer function-byte triples in different ranges for
   different blob types. The pattern is reusable for IR uploads, cab
   uploads, etc. — function bytes probably 0x4N / 0x5N / 0x6N / 0x7N
   in a structured way.

2. **Preset content is Huffman-compressed.** The data inside the
   `0x78` frames is NOT a flat parameter table — it's Huffman-packed.
   Source: AlGrenadine post #63 (Jul 2025), one-line confirmation.
   This explains why a preset with a 120-parameter AMP block doesn't
   take 120 × 4-channel × 4-byte = ~2KB just for the amp — the unused
   defaults aren't stored at all, and what IS stored is compressed.

3. **The preset SysEx format is separate from the realtime SysEx.**
   AlGrenadine post #49 (Jul 2025) explicitly:
   > "Understanding the preset sysex won't help you to control any
   > parameter in real-time. You have to sniff AxeEdit for this"
   So even a complete decode of the .syx format would NOT give us
   the per-parameter SET_PARAMETER_VALUE sysex needed for tools like
   `set_param`. Those are different problems.

   **Cross-confirmed in thread #201663** (Reverse engineer undocumented
   sysex?, 2024-02): AlGrenadine to philflieger asking about partial
   system-bank uploads — *"Yes, you have to sniff what Axe3Edit does
   when modifying a parameter (a setup parameter in your case)...
   Sending 'a part of' a bank/preset/ir/anything doesn't exist"*.

   The constraint is absolute: either send the WHOLE blob (preset,
   system bank, IR), or use the realtime parameter-write SysEx — no
   middle ground. There is no "send these 3 bytes of preset N's amp
   gain" operation.

4. **There IS a SysEx for querying block parameter info**, but it's
   not public. AlGrenadine post #57:
   > "There's a sysex dedicated to this, which asks for a block each
   > parameters informations etc... I cant go into more details"
   This is the III's analog of Axe-Fx II's `0x01 GET_BLOCK_PARAMETERS_LIST`.
   Decoding it would unlock the param-ID space — but AlGrenadine won't
   share (FracTool is a commercial product).

5. **Firmware updates don't change the protocol.** AlGrenadine post #55:
   > "Yes, firmwares don't change protocole, just known parameters
   > and sometimes parameters strings"
   So a one-time decode is stable; we don't need to re-decode for each
   firmware revision.

---

## Header frame (function 0x77)

Confirmed structure (13 bytes, from ectoplasm88 post #38 across 3 FX3
presets from different firmwares — header was identical):

```
Offset  Hex   Notes
  0     F0    SysEx start
  1-3   00 01 74  Fractal manufacturer prefix
  4     10    Model byte (0x10 = III; 0x11 = FM3; 0x12 = FM9)
  5     77    Function byte — preset-header marker
  6-8   ??    "Preset revision number" per AlGrenadine post #37,
              NOT firmware version. Evolves "only when needed."
              Empirically: 7F 00 00 (one revision class observed).
  9     40    Constant in all observed FM9 captures (also 00 in some)
  10    00    Constant
  11    XX    XOR checksum (per Fractal family convention)
  12    F7    SysEx end
```

Example FX3 header observed identical across 3 firmware versions:
```
F0 00 01 74 10 77 7F 00 00 00 01 1C F7
```

(Note: in this example bytes 9-10 are `00 01`, not `40 00` — the FM9
captures from a different post had `40 00`. Variation TBD.)

**Important: the header does NOT carry a destination preset number.**
This is significant — it means the .syx file is not addressed by
destination location at the wire level. The destination is presumably
set by the receiver (AxeEdit III chooses where to write, or the
device's current "import target" is used).

---

## Body frames (function 0x78)

Per ectoplasm88 post #14 + #39:

- Each body frame is **3082 bytes** total
- Standard 5-byte SysEx prefix (`F0 00 01 74 10`) + `0x78` function
  byte + payload + checksum + `F7`
- 10 bytes of overhead per frame → **3072 data bytes per frame**
- The 3072-byte payload is split into 24× 128-byte chunks (ectoplasm88's
  observation)
- The first 128-byte chunk of body frame 0 contains "global preset
  info" — preset name, presumably tempo, etc.
- Subsequent chunks contain block data
- **Content is Huffman-compressed** (AlGrenadine post #63)

Body frame 0 starts with the preset name field at offset 9 of payload
(`0x78 00 08` header + name + zeros). The 32-char preset name is
encoded with **MIDI 7-bit packing** — each character can split across
2 bytes because MIDI strips the high bit of every byte to keep the
"control byte" reserved for `F0`/`F7`.

ectoplasm88's "Spy Guitar" example, with bytes shifted to assemble
the 8-bit chars:
```
S = 0x53                  (53)
p = 0x70 ← bytes 60 01    (shift-assemble: 0x60 | (0x01<<7) = 0xE0 wrong)
y = 0x79                  (79)
```

The decode is non-trivial — ectoplasm88 didn't finish it in the
thread, and AlGrenadine declined to elaborate on the encoding.

---

## Footer frame (function 0x79)

Confirmed 11 bytes total (ectoplasm88 post #38). Structure not
documented in the thread; likely just a checksum / size confirmation.

---

## Other useful intel from the thread

- **ectoplasm88's parsing tool** (post #27) — Node.js `fp-analyze.js`,
  not public, parses III presets to byte tables.
- **vangrieg/Midi-SysEx-MCPServer** (post #40, Jul 2025) — LLM-assisted
  reverse-engineering project. **Cloned locally to
  `docs/_private/vangrieg-midi-sysex-mcpserver/` and read raw 2026-05-15.**

  ### What's in the repo

  - **Source code:** `Midi-SysEx-MCPServer-02.ipynb` (a Jupyter notebook
    that uses LangChain + Claude API to analyze SysEx data). Not an
    Axe-Fx-specific tool — it's a generic SysEx-analysis framework
    that vangrieg happens to be applying to one Axe-Fx III preset.
  - **Data:** `splawnlane.syx` (a real Splawn Lane preset, binary),
    `splawnlane.csv` / `splawnlane.xml` (paired FracTool exports with
    parameter ground truth). **These three together are the most
    valuable artifact in the repo** — a known-input, known-output
    pair perfect for our own decode work.
  - **Analysis writeups:** several `.md` files documenting iterations
    of vangrieg's analysis.

  ### Honest assessment after direct reading

  **The repo's `.md` files contradict themselves.**
  `parameter_storage_architecture.md` contains TWO complete sections
  describing two incompatible models in the same file:
  - Lines 1-198: Effect ID = 1 byte (0x53), no block-size header.
  - Lines 199-422: Effect ID = 2 bytes (0x0101), with 2-byte block-
    size header. Labeled "BREAKTHROUGH DISCOVERY" as if this
    superseded the first half — but the first half is still there
    unedited.

  **The actual decode success rate is low.** `effect_block_analysis.md`
  has a parameter-mapping table for the Input 1 block (7 byte-pairs):
  **1 of 7 byte-pairs decoded matching CSV** (Release, /50 scaling).
  For "MultiComp 1 candidate": **2 of 6 byte-pairs matched.** The
  author's own status note for MultiComp: *"Release1 is perfectly
  matched, but other time parameters don't align."*

  **Trustable:**
  1. **14-bit septet-pair encoding for parameter values** — independently
     confirmed by Fractal v1.4 PDF for other functions.
  2. **One time-parameter decode**: Release = sysex_value / 50.0 (ms).
     Single data point but plausible given family conventions.
  3. **The paired data** `splawnlane.syx` ↔ `splawnlane.csv` ↔
     `splawnlane.xml` — real ground truth we can analyze ourselves.

  **NOT trustable:**
  - Specific effect IDs (vangrieg: 0x53 OR 0x0101; v1.4 PDF: 0x25 for
    Input 1; three different values, no resolution).
  - "Sparse storage" / "all-channels-or-none" as *confirmed*. The
    summary docs use ✅ language but the decode table mostly shows
    ❓. Treat as hypothesis at best.
  - Specific byte offsets within blocks.

  ### Recommended use

  **Treat as a data dump, not an analysis source.** The .syx/.csv/.xml
  triple is the gold. We have `scripts/_research/analyze-splawnlane.ts`
  to walk this data programmatically; that's our path forward, not
  vangrieg's prose analysis.
- **FracTool** (AlGrenadine's commercial product) — has both a sniffer
  and a CSV/XML export of preset content. Password-gated; he doesn't
  share decode details.

---

## Implications for this project

1. **`save_preset` for III is NOT a single-function envelope.** Any
   "ship STORE_PRESET" path requires:
   - Decoding the Huffman packing inside the `0x78` frames (HARD)
   - Or building a "write the entire .syx as the user provides it"
     tool (passthrough); user-friendliness suffers
   - Or sniffing AxeEdit III's save sequence and replicating it
2. **`set_param` for III still needs capture work.** AlGrenadine
   explicitly says preset-file decode does NOT help with realtime
   param control. The III's per-block param-ID sysex (function unknown,
   probably `0x02` family-inferred) needs to be decoded from AxeEdit
   III network traffic.
3. **Block-level operations (bypass / channel / scene) are unaffected**
   — those use the documented v1.4 spec functions 0x0A / 0x0B / 0x0C
   with Appendix 1 effect IDs, which work TODAY.
4. **The forum's reverse-engineering effort is ACTIVE** (2025-07 was
   the most recent post). vangrieg's GitHub repo is the most recent
   public artifact — worth periodic check-in.

## Action items (research, not blocking shipping)

- [ ] Pull and review vangrieg/Midi-SysEx-MCPServer `.md` files for
  cross-references / further decode.
- [ ] If founder gets time on an Axe-Fx III: capture an AxeEdit III
  parameter-edit USBPcap session. One 30-second capture of "knob
  turn" would unblock `set_param`.
- [ ] Decide whether `save_preset` for III is worth pursuing given
  the Huffman + multi-frame complexity. Probably no — recommend
  users save on the device's front panel until a community capture
  arrives.
