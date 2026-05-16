# Axe-Fx III function 0x01 — partial decode

**Status:** field skeletons for three sub-actions inferred from 11
unique 23-byte captures + 2 unique 87-byte captures (2026-05-15
community scrape). Sub-action codes confirmed; per-block param-ID
table still TBD.

## Headline: 0x01 is GET_BLOCK_PARAMETERS_LIST — multi-mode envelope

Function 0x01 on the Axe-Fx III is the **same** function as on the
Axe-Fx II: `GET_BLOCK_PARAMETERS_LIST`. This is independently
confirmed by community posts in two forum threads:

- Thread #161230: *"function call 0x01 which is GET_BLOCK_PARAMETERS_LIST"*
  (with a link to the Axe-Fx II wiki entry).
- Thread #140602 (Third-Party MIDI Spec): a user describes the
  workflow as "calling function 0x01 after receive the status dump
  response (0x13)" — exactly the II-pattern: enumerate blocks via
  STATUS_DUMP, then query each block's parameter list with 0x01.
- Thread #192151 (DIY controller share thread): a community member
  calls 0x01 with `blockid == 106` and receives a stream of
  `i = N, id = NN` records — the parameter-list response in
  action.

The function carries different operations distinguished by a 2-byte
**action / mode code** at offsets 6-7. Three modes observed:

| Action (pos 6-7) | Length | Direction | Role |
|---|---|---|---|
| `52 00` | 23 bytes | host → device | **SET_PARAMETER** (set a single block parameter value) |
| `04 01` | 23 bytes | device → host | **STATE_BROADCAST** (device announces a parameter / modifier state change) |
| `01 00` | 87 bytes | device → host | **PARAMETERS_LIST response** (one record from the block's parameter list — multiple records emitted per query) |

The 87-byte `01 00` captures aren't a single state dump as we first
hypothesized — they're individual records in a multi-message response
stream. The III emits one 0x01-with-`01 00` for each parameter in
the queried block, until the list is exhausted.

This means the III's `get_param` / `list_params` operations are
already in our reach: send `0x01` with the right query-mode action
code (probably `01 00` with the block ID, no value), parse the
stream of responses.

**Why this matters:** function 0x01 is the III's parameter-write
SysEx, **not in the v1.4 third-party MIDI PDF**. Decoding it unlocks
`axefx3_set_param` and `axefx3_get_param`. The v1.4 PDF deliberately
omits parameter writes — this is exactly the gap the community has
been trying to close.

## Sub-action `52 00` — SET_PARAMETER (host→device)

Four labeled captures (FC-12 footswitch sending boost on/off):

```
pos:  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22

A1on: F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 7C 03 00 00 00 00 2B F7   "Amp 1 Boost ON"
A1of: F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 00 00 00 00 00 00 54 F7   "Amp 1 Boost OFF"
A2on: F0 00 01 74 10 01 52 00 3B 00 28 00 00 00 00 7C 03 00 00 00 00 2A F7   "Amp 2 Boost ON"
A2of: F0 00 01 74 10 01 52 00 3B 00 28 00 00 00 00 00 00 00 00 00 00 55 F7   "Amp 2 Boost OFF"
```

Differences ON vs OFF (same block): only **value bytes at 15-16**
change. Differences A1 vs A2 (same value): only **effect ID lo
at offset 8** changes (`3A` ↔ `3B`).

### SET_PARAMETER field layout (verified)

| Offset | Bytes | Field | Evidence |
|---|---|---|---|
| 0-5 | `F0 00 01 74 10 01` | SysEx envelope + function 0x01 | Fixed |
| 6-7 | `52 00` | **Sub-action: SET_PARAMETER** | Constant across all SET captures |
| 8-9 | `3A 00`, `3B 00` | **Effect ID** (LS-first septet pair) | `3A 00` = 58 = `ID_DISTORT1` (Drive 1) per v1.4 Appendix; `3B 00` = Drive 2 |
| 10-11 | `28 00` | **Parameter ID** (LS-first septet pair) | Constant `40` across all 4 Drive captures — same param being set |
| 12-14 | `00 00 00` | Reserved (always zero in SET captures) | Constant |
| 15-16 | `7C 03` ↔ `00 00` | **Value** (LS-first septet pair) | The ONLY field that differs between same-block ON and OFF — confirms it's the value |
| 17-20 | `00 00 00 00` | Reserved | Constant zero |
| 21 | `2B` / `54` / `2A` / `55` | XOR checksum (Fractal family standard) | Re-derivable |
| 22 | `F7` | SysEx end | Fixed |

`0x1FC` (= 508 decimal) is the value Drive 1 / Drive 2 take when
"Boost ON". The forum thread doesn't label which Drive parameter
this is — could be Drive Mix, Output Level, or a boost-specific
flag. One more capture pairing this param with a known knob name
would close it.

## Sub-action `04 01` — STATE_BROADCAST (device→host)

Five captures from a passive sniff of AxeEdit III ↔ III traffic.
These are inbound (device emitting), not outbound (host setting):

```
pos:  00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22

      F0 00 01 74 10 01 04 01 3A 00 00 00 46 01 00 00 00 00 00 00 00 6C F7
      F0 00 01 74 10 01 04 01 3B 00 00 00 13 00 00 00 00 00 00 00 00 39 F7
      F0 00 01 74 10 01 04 01 02 00 00 00 25 1A 00 00 00 00 00 00 00 2C F7
      F0 00 01 74 10 01 04 01 01 00 00 00 7F 1B 02 00 00 00 00 00 00 76 F7
      F0 00 01 74 10 01 04 01 3E 01 00 00 4F 27 02 00 00 00 00 00 00 44 F7
```

### STATE_BROADCAST field layout

| Offset | Bytes | Field | Evidence |
|---|---|---|---|
| 6-7 | `04 01` | **Sub-action: STATE_BROADCAST** | Constant across all 5 device-emitted captures |
| 8-9 | varies | **Effect ID** (LS-first septet pair) | Decoded values: 58/59 (Drive 1/2), 2 (`ID_CONTROL`), 1 (gen-1 holdover?), 190 (`ID_MIDIBLOCK`) — all match v1.4 Appendix 1 |
| 10-11 | `00 00` | Reserved (no separate param-id field?) | Constant zero |
| 12-13 | varies | **Value** (LS-first septet pair) | Different values per broadcast |
| 14 | `00` / `02` | Unknown flag — appears with some broadcasts | Sometimes `02`, hypothesis: "value pending / latched" |
| 15-20 | `00 00 00 00 00 00` | Reserved | Constant zero |
| 21 | varies | XOR checksum | Re-derivable |

The broadcast covers effect IDs across the full v1.4 Appendix
range (1, 2, 58, 59, 190) — consistent with a stream the device
emits when AxeEdit polls or auto-syncs state.

## Sub-action `01 00` — STATE_DUMP (device→host, 87 bytes)

Two captures, much longer (87 bytes total → 79-byte payload):

```
pos: 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 …

#1:  F0 00 01 74 10 01 01 00 25 00 00 00 3F 01 00 00 00 00 00 38 …
#2:  F0 00 01 74 10 01 01 00 28 00 00 00 3F 01 00 00 00 00 00 38 …
```

- Pos 6-7: `01 00` (action code)
- Pos 8-9: effect ID (`25 00` = 37 = `ID_INPUT1`; `28 00` = 40 = `ID_COMP1`)
- Pos 12-13: `3F 01` constant across both (191 = unknown — possibly "all parameters" flag)
- Pos 19: `38` constant — probably another marker
- Pos 21-37: per-block parameter values, packed as septet pairs

These look like **multi-parameter state dumps** for a single block.
Effectively the III's analog of Axe-Fx II's `GET_BLOCK_PARAMETERS_LIST`
response — the device transmitting all the block's parameters when
AxeEdit III opens its block editor for that block.

If this hypothesis is correct, sending `01 00` with a given effect
ID is the way to QUERY all parameters of a block. That would be
the III's `get_params(block)` function — a major decode unlock.

## Cross-decode facts

**Effect ID across all sub-actions decodes via the v1.4 Appendix 1
table.** Examples observed in 0x01 captures:

| Effect ID bytes | Decoded ID | v1.4 Appendix label |
|---|---|---|
| `01 00` | 1 | (reserved range — gen 1 holdover?) |
| `02 00` | 2 | `ID_CONTROL` |
| `25 00` | 37 | `ID_INPUT1` |
| `28 00` | 40 | `ID_COMP1` (Compressor 1) |
| `3A 00` | 58 | `ID_DISTORT1` (Drive 1) |
| `3B 00` | 59 | `ID_DISTORT2` (Drive 2) |
| `3E 01` | 190 | `ID_MIDIBLOCK` (Scene MIDI) |

This is independent verification that the v1.4 Appendix's effect-
ID space applies to the III's real-time parameter SysEx, not just
the documented `0x0A` / `0x0B` / `0x13` functions.

**"Amp 1 Boost" was actually a Drive block.** The forum-thread
title said "Amp 1 Boost," but `3A 00` = 58 = `ID_DISTORT1`. The
user labeled their footswitch action by intent, not by wire
representation. Wire bytes win.

**SET_PARAMETER (`52 00`) is fixed 23 bytes.** Single-parameter
operation. Simple encoder.

**STATE_BROADCAST (`04 01`) is also 23 bytes.** Same envelope
shape but device-emitted, different field layout.

**STATE_DUMP (`01 00`) is 87 bytes** with much richer payload.
Likely the "all parameters of this block" envelope.

## What we still need

**Per-block, per-parameter ID dictionary.** Biggest gap. We've
confirmed param ID `28 00` (= 40) for the Drive block boost
operation, but don't know what "param 40" is in human terms (Drive
Mix? Output Level? Boost flag?). To populate `set_param`:

- **One capture per (block_type, parameter) pair** with a known
  human-readable value. AxeEdit III firing a single-knob change
  paired with a screenshot of the affected knob is the canonical
  data point.

- **Same param at multiple values** to verify linearity. Most
  Fractal parameters are 16-bit unsigned packed into the septet
  pair. Worth confirming by capturing e.g. Drive's Drive knob at
  0%, 50%, 100% and checking the value bytes scale linearly.

**Verify the `01 00` STATE_DUMP query direction.** If sending
`F0 00 01 74 10 01 01 00 [effect_id] [cs] F7` (host→device, short
form, hypothetical) triggers the device to dump the long 87-byte
state for that block, that's a `get_params(block)` decode for
free — no per-param-ID table needed for reads.

**Decode the 87-byte STATE_DUMP payload.** 79 bytes of data after
the effect ID. Almost certainly a packed parameter list — but the
ordering and which-param-is-where requires pairing with AxeEdit's
display for that block.

## Cross-references

- `scripts/_research/mine-axefx3-fn01.ts` — re-runnable extractor;
  drop more scrapes into `docs/_private/` and re-run.
- `docs/SYSEX-MAP-AXE-FX-III.md` "Undocumented function bytes seen
  in the wild" section — earlier note on 0x01.
- `docs/manuals/AxeFx3-MIDI-3rdParty.txt` — the official v1.4 PDF
  that deliberately omits this function.
