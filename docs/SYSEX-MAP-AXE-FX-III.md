# Axe-Fx III SysEx map

**Authoritative source for the III protocol layer.** Before searching
the web, reading other OSS libraries, or speculating about III wire
shapes, check this doc and the underlying text extraction.

## Spec text extraction (READ THIS FIRST)

- **Local extracted text:** [`docs/manuals/AxeFx3-MIDI-3rdParty.txt`](manuals/AxeFx3-MIDI-3rdParty.txt) (353 lines).
- **Original PDF:** [`docs/manuals/Axe-Fx III MIDI for 3rd Party Devices.pdf`](manuals/Axe-Fx%20III%20MIDI%20for%203rd%20Party%20Devices.pdf), Revision 1.4, "supported in Axe-Fx III firmware 1.13 or greater."
- **Index entry:** [`docs/REFERENCES.md`](REFERENCES.md) row "Axe-Fx III MIDI for 3rd Party Devices.pdf".

The PDF is the **only** public protocol document Fractal ships for
the III generation. Everything beyond what it covers is either
community reverse-engineering or unverified inference from the
Axe-Fx II spec. **Treat anything not in the .txt as 🟡 unverified.**

## Envelope

```
F0 00 01 74 10 cc dd dd dd ... cs F7
```

- `F0` — SysEx start
- `00 01 74` — Fractal manufacturer prefix
- `10` — Axe-Fx III model byte (FM3=0x11, FM9=0x12, VP4=0x14, AM4=0x15)
- `cc` — function / command opcode
- `dd ...` — variable payload
- `cs` — XOR of every byte from `F0` through last payload byte, AND `0x7F`
- `F7` — SysEx end

Checksum implementation: `packages/core/src/fractal-shared/checksum.ts`.

## Function table (from v1.4 PDF, verbatim)

| Opcode | Name | Direction | Notes |
|---|---|---|---|
| `0x0A` | SET / GET BYPASS | bidir | `id id dd` payload. `dd=0` engaged, `1` bypassed, `7F` query. Returns same shape with current state. |
| `0x0B` | SET / GET CHANNEL | bidir | `id id dd` payload. `dd=0..3` (A..D), `7F` query. |
| `0x0C` | SET / GET SCENE | bidir | `dd` payload. `7F` query. Spec line: "where dd is the current scene." |
| `0x0D` | QUERY PATCH NAME | host→device, response | **`dd dd` payload = preset number** (LS-first 7-bit pair); `dd dd = 7F 7F` to query the current preset. Response: `nn nn dd*32` (preset number + 32-char name). This is BOTH "what preset is active" and "what's the name of preset N." |
| `0x0E` | QUERY SCENE NAME | host→device, response | `dd` payload = scene index. `7F` for current scene. Response: `nn dd*32` (scene index + 32-char name). No SET variant. |
| `0x0F` | SET / GET LOOPER STATE | bidir | `dd` = button (0=Record, 1=Play, 2=Undo, 3=Once, 4=Reverse, 5=Half-speed). `7F` query. Response: `dd` bitfield (bit0=Record, bit1=Play, bit2=Overdub, bit3=Once, bit4=Reverse, bit5=Half-speed). |
| `0x10` | TEMPO TAP | host→device | No payload. Single-shot. Also the format of an unprompted "tempo down-beat" push (no checksum). |
| `0x11` | TUNER ON/OFF | host→device | `dd=0` off, `dd=1` on. The push-variant (sent when tuner is active) is `nn ss cc` (note, string, cents) without checksum. |
| `0x13` | STATUS DUMP | host→device, response | No request payload. Response: variable-length list of `id id dd` triples, one per effect in the active preset. `dd` bit layout: bit 0 = bypass, bits 3:1 = channel (0..7; current max is 3 → channels 0..3 = A..D), bits 6:4 = number of channels supported by this effect. |
| `0x14` | SET / GET TEMPO | bidir | `dd dd` payload = BPM (LS-first 7-bit pair). `7F 7F` query. |

**That is the ENTIRE documented function-byte set in v1.4.**
Notably absent — operations that exist in other Fractal devices but
are NOT in the III's third-party spec:

- **No `SET_PRESET_NUMBER` / `SWITCH_PRESET` function.** Remote preset
  switching on the III is via standard MIDI Program Change messages
  (PC), not SysEx. The III does NOT accept "switch to preset N" as a
  SysEx command from a third-party device.
- **No `SET_PARAMETER_VALUE` function.** Per-block parameter writes
  are not exposed in the spec. The Axe-Fx II spec exposes `0x02
  SET_PARAMETER_VALUE`; the III deliberately omits it.
- **No `STORE_PRESET` / `SAVE_PRESET` function.** The III's preset-
  store wire format is a community-reverse-engineered **18-frame
  envelope** (1× `0x77` header + 16× `0x78` body + 1× `0x79` footer
  for the III; 10-frame for FM3/FM9). Body content is **Huffman-
  compressed**. Full research log + post-by-post evidence chain in
  [`docs/axefx3-preset-format-research.md`](axefx3-preset-format-research.md).
  Forum thread #159885 is archived locally at `docs/_private/fractal-forum-text.txt`.
- **No `FRONT_PANEL_CHANGE` push (0x21).** Our earlier design notes
  reference `0x21` as the III's dirty-state signal — it is NOT in
  v1.4. Source for that claim is unidentified; treat as unverified.
- **No `SET_GRID_CELL` / `SET_CELL_ROUTING`.** Grid topology authoring
  is not exposed.
- **No `SET_PRESET_NAME` / `SET_SCENE_NAME`.** Names are query-only
  via 0x0D / 0x0E.

## Effect IDs — Appendix 1 (from v1.4 PDF)

The PDF DOES enumerate effect IDs for the third-party MIDI surface.
These are the 14-bit values that go in `id id` payload slots for
functions `0x0A` SET_BYPASS, `0x0B` SET_CHANNEL, and `0x13`
STATUS_DUMP responses. **Earlier project docs claimed these IDs were
undocumented — that claim is wrong.**

Ranges below are derived from the C-enum auto-increment style the
PDF uses (each entry without an `= N` continues from the previous
explicit assignment).

| Block | Instance count | Effect IDs (1..N) |
|---|---|---|
| `ID_CONTROL` | 1 | 2 |
| (IDs 3-34 reserved / not enumerated in v1.4 — see "Anomalies" below) | | |
| `ID_TUNER` | 1 | 35 |
| `ID_IRCAPTURE` | 1 | 36 |
| `ID_INPUT1..5` | 5 | 37, 38, 39, 40, 41 |
| `ID_OUTPUT1..4` | 4 | 42, 43, 44, 45 |
| `ID_COMP1..4` (Compressor) | 4 | 46, 47, 48, 49 |
| `ID_GRAPHEQ1..4` | 4 | 50, 51, 52, 53 |
| `ID_PARAEQ1..4` | 4 | 54, 55, 56, 57 |
| `ID_DISTORT1..4` (Drive) | 4 | 58, 59, 60, 61 |
| `ID_CAB1..4` | 4 | 62, 63, 64, 65 |
| `ID_REVERB1..4` | 4 | 66, 67, 68, 69 |
| `ID_DELAY1..4` | 4 | 70, 71, 72, 73 |
| `ID_MULTITAP1..4` | 4 | 74, 75, 76, 77 |
| `ID_CHORUS1..4` | 4 | 78, 79, 80, 81 |
| `ID_FLANGER1..4` | 4 | 82, 83, 84, 85 |
| `ID_ROTARY1..4` | 4 | 86, 87, 88, 89 |
| `ID_PHASER1..4` | 4 | 90, 91, 92, 93 |
| `ID_WAH1..4` | 4 | 94, 95, 96, 97 |
| `ID_FORMANT1..4` | 4 | 98, 99, 100, 101 |
| `ID_VOLUME1..4` | 4 | 102, 103, 104, 105 |
| `ID_TREMOLO1..4` (Pan/Tremolo) | 4 | 106, 107, 108, 109 |
| `ID_PITCH1..4` | 4 | 110, 111, 112, 113 |
| `ID_FILTER1..4` | 4 | 114, 115, 116, 117 |
| `ID_FUZZ1..4` | 4 | 118, 119, 120, 121 |
| `ID_ENHANCER1..4` | 4 | 122, 123, 124, 125 |
| `ID_MIXER1..4` | 4 | 126, 127, 128, 129 |
| `ID_SYNTH1..4` | 4 | 130, 131, 132, 133 |
| `ID_VOCODER1..4` | 4 | 134, 135, 136, 137 |
| `ID_MEGATAP1..4` | 4 | 138, 139, 140, 141 |
| `ID_CROSSOVER1..4` | 4 | 142, 143, 144, 145 |
| `ID_GATE1..4` | 4 | 146, 147, 148, 149 |
| `ID_RINGMOD1..4` | 4 | 150, 151, 152, 153 |
| `ID_MULTICOMP1..4` | 4 | 154, 155, 156, 157 |
| `ID_TENTAP1..4` | 4 | 158, 159, 160, 161 |
| `ID_RESONATOR1..4` | 4 | 162, 163, 164, 165 |
| `ID_LOOPER1..4` | 4 | 166, 167, 168, 169 |
| `ID_TONEMATCH1..4` | 4 | 170, 171, 172, 173 |
| `ID_RTA1..4` | 4 | 174, 175, 176, 177 |
| `ID_PLEX1..4` (Plex Delay) | 4 | 178, 179, 180, 181 |
| `ID_FBSEND1..4` | 4 | 182, 183, 184, 185 |
| `ID_FBRETURN1..4` | 4 | 186, 187, 188, 189 |
| `ID_MIDIBLOCK` (Scene MIDI) | 1 | 190 |
| `ID_MULTIPLEXER1..4` | 4 | 191, 192, 193, 194 |
| `ID_IRPLAYER1..4` | 4 | 195, 196, 197, 198 |
| `ID_FOOTCONTROLLER` | 1 | 199 |
| `ID_PRESET_FC` | 1 | 200 |

### Anomalies in v1.4 effect-ID table

1. **AMP is missing from the effect-ID enumeration.** No `ID_AMP1..N`
   appears in the PDF. AMP IDs may be in the unaccounted-for 3..34
   range (32 reserved slots between ID_CONTROL and ID_TUNER), or
   may be deliberately omitted from the third-party MIDI surface.
   **Until verified on hardware, treat AMP bypass/channel control
   as 🟡 unsupported.** A test-against-hardware would be a single
   STATUS_DUMP call against a preset known to contain the AMP block —
   the response would reveal whichever ID corresponds to the AMP.

2. **Recent blocks are absent.** Spec is v1.4 / firmware 1.13 era
   (~2018). Current firmware is 32.03 (March 2026). Blocks added in
   later firmware are NOT in this table:
   - **Dynamic Distortion** (firmware 20.00 / 2022) — no ID
   - **NAM** (asset present in AxeEdit III but no release-note mention) — no ID
   - **Newer Multiplexer instances** beyond 4 (if any) — unknown
   - Their IDs are presumably ≥ 201, but we don't know which.

3. **`ID_FUZZ` is its own entry** separate from `ID_DISTORT`.
   Fractal's modern UI calls everything "Drive" — but the PDF
   distinguishes Distort (= drive) from Fuzz at the SysEx layer.
   Whether these are two separate placeable block types or one
   block-type with two ID ranges is unclear.

4. **`ID_DISTORT` is Fractal's older name for the Drive block.**
   For 3rd-party MIDI purposes, this is what populates as "DRV" in
   editor assets / wiki.

## Bugs found 2026-05-15 — RESOLVED

The Tier-A tools shipped earlier in the same session had the bugs
listed below. **All resolved in the cleanup commit** that landed:

- `setParam.ts` rewritten from scratch against v1.4 PDF spec
- `blockTypes.ts` now carries v1.4 Appendix 1 effect IDs
- `descriptor.ts` removed the broken `switchPreset`, added
  `setBypass` / `setChannel` using effect IDs
- Tool surface rewritten: `axefx3_switch_preset` removed (no such
  SysEx function); `axefx3_get_preset_name` merged with
  `get_active_preset_number` (0x0D returns both); new tools for
  bypass / channel / tempo / tuner / looper
- Byte-exact goldens updated for the new builders

The list below is preserved as a historical record:

| # | Bug | Code location | Spec says |
|---|---|---|---|
| 1 | `FN_SET_GET_PRESET_NUMBER = 0x0d` is a fiction. The spec has no SET_PRESET function; `0x0D` is QUERY PATCH NAME. | `setParam.ts:55` | 0x0D = QUERY PATCH NAME (preset name lookup by number). |
| 2 | `FN_QUERY_PRESET_NAME = 0x0f` is wrong. `0x0F` is SET/GET LOOPER STATE. | `setParam.ts:57` | 0x0F = LOOPER. Preset name is on 0x0D. |
| 3 | `buildSwitchPreset(N)` sends bytes the III interprets as "give me the name of preset N", not "switch to preset N." There is NO SysEx switch_preset on the III — use MIDI PC. | `setParam.ts:102-119` | No SET_PRESET in spec. |
| 4 | `buildSwitchPreset('query')` uses a single `7F` sentinel; spec calls for `7F 7F` (two-byte LS-first) per 0x0D's payload shape. | `setParam.ts:107` | "let dd dd = 7F 7F" — TWO 7F bytes for the current-preset query. |
| 5 | `axefx3_switch_preset` tool doesn't switch presets. It queries a preset name and returns nothing useful. | `tools/navigation.ts` | Use MIDI Program Change (PC) for III preset switching. |
| 6 | `axefx3_get_preset_name` uses 0x0F (LOOPER) — sends a looper-button command, not a name query. | `tools/navigation.ts` get_preset_name handler | Use 0x0D with `dd dd = 7F 7F` for current preset name. |
| 7 | `axefx3_get_active_preset_number` and `get_preset_name` ought to be one tool: 0x0D query returns BOTH the preset number AND its name. | both navigation.ts handlers | One 0x0D query gives `nn nn` (preset number) + `dd*32` (name). |
| 8 | `FN_SET_PARAMETER_VALUE = 0x02` is declared as a constant — but `0x02` is NOT in the v1.4 PDF. This is family inference from Axe-Fx II. | `setParam.ts:51` | The III's parameter-write opcode is NOT documented anywhere public. Family inference is the only path. |
| 9 | `FN_FRONT_PANEL_CHANGE = 0x21` is referenced in design notes as the III dirty signal. Not in v1.4 PDF. Source unidentified. | `setParam.ts:59`, `docs/axefx3-design-notes.md` | Treat as unverified. The PDF documents only `0x10` (tempo down-beat) and `0x11` (tuner) as push frames. |
| 10 | Block roster (`blockTypes.ts`) ships every block with `id: null` claiming "effectId pending capture." Effect IDs ARE in the spec Appendix 1 — only AMP and post-firmware-1.13 blocks are unspecified. | `blockTypes.ts` | Populate `id:` from Appendix 1. Leave AMP, NAM, Dynamic Distortion as `null`. |

## Community-captured wire confirmations

Several of our builders have been independently verified against
real-world SysEx captures posted publicly to the Fractal Forum.
This is hardware-verification-equivalent for these operations even
though the project doesn't own an Axe-Fx III.

| Builder | Forum-confirmed wire | Our golden | Match |
|---|---|---|---|
| `set_bypass(Reverb 1, false)` (function 0x0A, effect ID 66 = Reverb 1) | `F0 00 01 74 10 0A 42 00 00 5D F7` (forum thread #184833, captured from a third-party MIDI controller) | `f0000174100a4200005df7` | ✓ |
| `switch_scene(1..8)` (function 0x0C, scenes wire 0..7) | All 8 wire forms `F0 00 01 74 10 0C [wire] [cs] F7` (forum thread #182318, 2022-03, "correct and tested") | All 8 matches | ✓ |
| `set_tempo(120)` (function 0x14, BPM 120 = 0x78) | `F0 00 01 74 10 14 78 00 79 F7` (forum thread #162904, community example) | `f0000174101478007 9f7` | ✓ |
| `get_tempo()` (function 0x14, sentinel 7F 7F) | `F0 00 01 74 10 14 7F 7F 01 F7` (forum thread #140602) | `f000017410147f7f01f7` | ✓ |

**Caveats:**

- **`get_tempo` reportedly had a side-effect on early-firmware III**
  (forum bug report 2018-09-06, firmware ~1.x era): sending the get
  request actually SET the tempo to 250 BPM (the max). Current
  firmware is 32.03 and the bug was reported to FractalAudio
  directly; assume fixed unless a tester reports otherwise. The
  tool description for `axefx3_get_tempo` should mention this so a
  user with weird tempo behavior on old firmware can blame the
  right thing.

- **`set_bypass` wire example** uses an external MIDI controller
  sending to the III's USB-MIDI port. Verifies the wire shape but
  not the round-trip ack (the III may or may not echo a 0x0A
  response — capture didn't include the response window).

- **Additional set_bypass capture** (forum thread #218547, user
  observing unwanted block muting): `F0 00 01 74 10 0A 25 00 01 3B F7`
  — function 0x0A, effect ID `25 00` = 37 (Input 1 per v1.4
  Appendix), dd=1 (bypassed), cs=0x3B. Verifies our effect-ID
  resolution for `Input 1`.

## Undocumented function bytes seen in the wild

The v1.4 PDF documents 0x0A through 0x14 plus 0x13. Several captures
show **function bytes outside that range** being used in real III
traffic. These are likely the "set parameter / set modifier" calls
the public spec deliberately omits.

### Function 0x01 — long-payload write (likely SET_PARAMETER / SET_MODIFIER)

Examples from captures of AxeEdit III / FC-12 footswitch traffic:

```
Amp 1 Boost on:  F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 7C 03 00 00 00 00 2B F7
Amp 1 Boost off: F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 00 00 00 00 00 00 54 F7
Amp 2 Boost on:  F0 00 01 74 10 01 52 00 3B 00 28 00 00 00 00 7C 03 00 00 00 00 2A F7
```

22-byte payload after the function byte. Tentative field shape:
`[effect_id × 2][param_id × 2][?? × 4][value × 6][?? × 6][cs] F7`.
The two examples that differ only by enable/disable (boost-on vs
boost-off) confirm the value field is the `7C 03 → 00 00` swap.
Decoding the field layout precisely would require pairing several
captures with known parameter values — a target for any future
`set_param` work.

Note that v1.4 doesn't reserve 0x01 for any documented purpose, and
the Axe-Fx II family uses 0x01 for `GET_BLOCK_PARAMETERS_LIST` (a
different function) — the III repurposed the same byte for what
appears to be parameter-write.

### Function 0x21 — front-panel-change auto-push

Multiple captures of "AxeFXIII MIDI Input receives TONS of messages"
threads show frames with function byte 0x21 streaming during
front-panel knob movement. Earlier this was attributed to design-
note speculation; the capture confirms it's a real device-emitted
function. Useful for any future dirty-state detection.

### Function 0x64 — MULTIPURPOSE_RESPONSE (error / ack channel)

In the v1.4 PDF as the response opcode. A real-world capture
confirms the wire shape when the III rejects a malformed request:

```
F0 00 01 74 10 64 [echoed_fn] [result_code] [cs] F7
```

Example: a host sent QUERY_SCENE_NAME (0x0E) with a bad checksum.
The III responded `F0 00 01 74 10 64 0E 00 7F F7` — function 0x64,
echoed 0x0E, result code 0x00, valid checksum 0x7F.

**Status: shipped (Session 80).** The III tools now bracket each
fire-and-forget SET write with a 250ms 0x64 listener
(`sendAndWatchForError` in `packages/axe-fx-iii/src/tools/shared.ts`).
When a 0x64 arrives it surfaces as a warning in the tool response
text — `(echoed_fn, result_code)` plus a human label for known codes.
Byte-exact predicate + parser goldens (including the community-captured
`F0 00 01 74 10 64 0E 00 7F F7` frame) live in
`scripts/verify-axe-fx-iii-encoding.ts`. Known `result_code` labels:
`0x00` = general / checksum error, `0x05` = NACK; anything else
surfaces as a raw hex byte.

## Effect IDs in v1.4 Appendix 1 that are NOT 3rd-party addressable

The Appendix 1 effect-ID table enumerates internal blocks too. Per
community confirmation in thread #140602 (2019), the following IDs
are in the list but **not controllable** via the 3rd-party MIDI
surface (0x0A bypass / 0x0B channel / 0x13 status dump):

- `ID_CONTROL` (2) — internal "control switch", FC-controlled
- `ID_MIDIBLOCK` (190) — internal-only
- `ID_FOOTCONTROLLER` (199) — FC interface only
- `ID_PRESET_FC` (200) — internal

**Status: shipped (Session 80).** `packages/axe-fx-iii/src/blockTypes.ts`
now marks these four entries `addressable: false`, and
`resolveEffectId` refuses them with a clean message naming the four
non-addressable IDs. `axefx3_list_blocks` surfaces the addressable
column so the agent can see the FC-only blocks before attempting a
write. Goldens in `scripts/verify-axe-fx-iii-encoding.ts` cover all
four refusal cases.

## BPM table reference

Forum thread "All Axe Fx III BPM Tempo SysEx 1-200bpm" published
the full 1-200 BPM mapping for function 0x14. Pattern confirms our
`buildSetTempo` builder:

| BPM | Wire |
|---|---|
| 1 | `F0 00 01 74 10 14 01 00 00 F7` |
| 2 | `F0 00 01 74 10 14 02 00 03 F7` |
| 120 | `F0 00 01 74 10 14 78 00 79 F7` (matches our golden) |

For BPM > 127, the septet-pair encoding splits into the second byte
(spec: `dd dd` LS-first). Full 200-BPM dataset available in
`docs/_private/` corpus.

## Operations we CAN ship now from the spec alone

Given the function-byte map + Appendix 1 effect IDs:

- ✅ `axefx3_set_bypass(block_name, bypassed)` — 0x0A + known effect ID
- ✅ `axefx3_set_channel(block_name, channel)` — 0x0B + known effect ID
- ✅ `axefx3_get_preset_name_and_number()` — 0x0D `7F 7F` returns both
- ✅ `axefx3_get_preset_name_at(preset_number)` — 0x0D N N returns preset N's name
- ✅ `axefx3_switch_scene(scene)` — 0x0C set (correct already)
- ✅ `axefx3_get_active_scene()` — 0x0C query (correct already)
- ✅ `axefx3_get_scene_name(scene | 'current')` — 0x0E (correct already)
- ✅ `axefx3_tempo_tap()` — 0x10
- ✅ `axefx3_tuner(on)` — 0x11
- ✅ `axefx3_set_tempo(bpm)` / `axefx3_get_tempo()` — 0x14
- ✅ `axefx3_set_looper(action)` / `axefx3_get_looper_state()` — 0x0F (the REAL 0x0F)
- ✅ `axefx3_status_dump()` — 0x13 (correct already, parser too)
- ❌ `axefx3_switch_preset` — NOT possible via SysEx; use MIDI PC instead. Tool should be removed or relabeled `send_preset_change_pc`.
- ❌ `axefx3_set_param` — opcode is `0x02` family-inference only; param-IDs are not documented anywhere.
- ❌ `axefx3_save_preset` — multi-frame envelope (0x77/0x78/0x79); needs community capture or test against hardware.

## Cross-references

- **Project README and CLAUDE.md** — point at `docs/REFERENCES.md` for any "where do I find X" question. The III spec is row 30 there.
- **III package source** — `packages/axe-fx-iii/src/setParam.ts` carries an inline pointer to this doc at the top of the file (after edits land).
- **Community capture workflow** — [`docs/community/axefx3-captures.md`](community/axefx3-captures.md) and (private) `docs/_private/HARDWARE-TASKS-AXEFX3.md`.
- **Design notes** (some predate the bug discovery here) — [`docs/axefx3-design-notes.md`](axefx3-design-notes.md).
- **Forum reverse-engineering** of preset save format — Fractal Forum thread #159885 ("Axe-Fx III and deconstructing / parsing a .syx / sysex preset file"). Three-function envelope: `0x77` (header, contains destination), 16× `0x78` (body chunks), `0x79` (footer).
