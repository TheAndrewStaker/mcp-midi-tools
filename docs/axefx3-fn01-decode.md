# Axe-Fx III function 0x01 — partial decode

**Status:** field skeleton inferred from 4 community-captured 0x01
frames; full layout pending more captures.

**Why this matters:** function 0x01 is the III's parameter-write
SysEx, **not in the v1.4 third-party MIDI PDF**. Decoding it unlocks
`axefx3_set_param` and `axefx3_get_param`. The v1.4 PDF deliberately
omits parameter writes — this is exactly the gap the community has
been trying to close.

## What we have

Four byte-exact captures, all 23 bytes total (function 0x01 has a
**fixed-length 23-byte envelope** with a 15-byte payload):

```
pos: 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22

A1:  F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 7C 03 00 00 00 00 2B F7   "Amp 1 Boost ON"
A1f: F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 00 00 00 00 00 00 54 F7   "Amp 1 Boost OFF"
A2:  F0 00 01 74 10 01 52 00 3B 00 28 00 00 00 00 7C 03 00 00 00 00 2A F7   "Amp 2 Boost ON"
X:   F0 00 01 74 10 01 04 01 3A 00 00 00 46 01 00 00 00 00 00 00 00 6C F7   (unrelated MIDI flood)
```

Bytes that vary across the three "Boost" captures isolate fields by
elimination.

## Decoded field skeleton

| Offset | Bytes | Field | Evidence |
|---|---|---|---|
| 0-5 | `F0 00 01 74 10 01` | SysEx envelope + function byte | Fixed |
| 6-7 | `52 00` (boost), `04 01` (other) | **Action / mode code** (2 bytes) | Varies between capture types |
| 8-9 | `3A 00` (Drive 1), `3B 00` (Drive 2) | **Effect ID** (LS-first septet pair) | Differs only between Drive 1 vs Drive 2 captures |
| 10-11 | `28 00` (boost), `00 00` (other) | **Parameter ID** (LS-first septet pair) | Constant across Boost captures, different for the other type |
| 12-13 | `00 00` (boost), `46 01` (other) | Unknown — possibly sub-param or controller index | Varies |
| 14 | `00` | Padding / reserved | Constant `00` across all 4 |
| 15-16 | `7C 03` (ON), `00 00` (OFF) | **Value** (LS-first septet pair) | The ONLY field that differs between A1-ON and A1-OFF |
| 17-20 | `00 00 00 00` | Reserved / unused | Constant `00` |
| 21 | `2B` / `54` / `2A` / `6C` | **XOR checksum** (Fractal family standard) | Re-derivable |
| 22 | `F7` | SysEx end | Fixed |

## Key decoded facts

**Effect ID confirms v1.4 PDF Appendix 1.** `3A 00` decodes via the
14-bit LS-first septet pair as `0x3A | (0x00 << 7) = 58`, which is
`ID_DISTORT1` in the v1.4 Appendix. Our Drive 1 (legacy name
"DISTORT" in Fractal's older code) is wired at effect ID 58.

The forum-thread title called it "Amp 1 Boost," but the wire bytes
show it's actually setting a parameter on the **Drive 1 block**, not
the Amp block. User colloquially called their drive-block-as-boost
the "Amp 1 Boost" — a naming mismatch worth noting.

**0x28 (decimal 40) is some Drive parameter.** Boost-on raises the
value to `0x7C 03` = `0x1FC` = 508 decimal. Boost-off zeroes it.
Without the parameter-id table for the Drive block, we can't yet
name which Drive knob this is (Drive Mix? Output Level? Bypass-
override?). It's NOT the bypass — bypass uses function 0x0A per
the v1.4 PDF, not 0x01.

**0x01 is fixed-length 23 bytes.** Unlike the variable-length 0x77
preset frames, function 0x01 looks like a fixed envelope. This
simplifies the encoder/decoder substantially.

## What we still need

**Per-block, per-parameter ID dictionary.** The biggest gap. We
have one example pair (Drive 1's param 40 set to 508). To populate
the full table for `set_param` we'd need:

- **One capture per (block_type, parameter) pair**, with a known
  value. AxeEdit III firing a single-knob change is the canonical
  source. Pairing this with the parameter's display name in
  AxeEdit closes the loop.

- **Same param at multiple values** to decode the value encoding.
  Most Fractal parameters are 16-bit unsigned packed into the
  septet pair; we'd want to verify by capturing e.g. Drive Drive
  knob at 0%, 50%, and 100% and checking the value bytes scale
  linearly.

- **The "Action / mode" field at offset 6-7.** Captures of the
  same parameter being SET vs. QUERIED (or different modifier
  types) would clarify what this field encodes.

## Targeted scraping plan

Two forum threads — both visible in the search snippets but NOT
fully scraped — contain rich 0x01 capture content:

1. **"Assigning a Footswitch on FC-12 to Control Amp Boost"**
   (forum thread, multiple 0x01 captures per post). The user paired
   their captured bytes with the human-readable "what the FC-12
   button does" labels.

2. **"AxeFXIII MIDI Input receives TONS of messages"** (forum
   thread). Shows a stream of 0x01 frames captured by a third-
   party MIDI tool as AxeEdit ran. Likely high-density 0x01
   variety.

Drop both into the next batch-scrape (the existing
`docs/_private/forum-scrape-threads-batch.js` handles them).

**Also useful — a targeted search:** the literal hex string
`"F0 00 01 74 10 01"` (note: must include the leading `"` and
inner spaces so XenForo treats it as a phrase). Run it via the
search UI to get a fresh `/search/<sid>/` URL, then run
`forum-scrape-search.js`. Will surface every post in which
someone pasted a 0x01 capture.

## Cross-references

- `scripts/_research/mine-axefx3-fn01.ts` — re-runnable extractor;
  drop more scrapes into `docs/_private/` and re-run.
- `docs/SYSEX-MAP-AXE-FX-III.md` "Undocumented function bytes seen
  in the wild" section — earlier note on 0x01.
- `docs/manuals/AxeFx3-MIDI-3rdParty.txt` — the official v1.4 PDF
  that deliberately omits this function.
