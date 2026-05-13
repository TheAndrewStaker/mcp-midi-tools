# Volume Control — Cross-Device Reference

Loudness, gain, mix, and level have different meanings on each device. When
the user says "turn it up" or "the reverb is too loud," the agent needs to
pick the right param. This doc is the canonical mapping; tool descriptions
reference it.

## The four kinds of "volume"

Every musical-instrument signal path has up to four conceptually distinct
loudness controls. The user's vocabulary maps to them differently than the
device's wire names:

| User intent | What it controls | Common user phrasing |
|---|---|---|
| **Input gain** | How hard the amp/oscillator is driven (creates distortion / character). Affects tone, not just loudness. | "more gain," "drive it harder," "more distortion" |
| **Amp master** | Master volume INSIDE the amp model — preserves the gain character but changes overall amp loudness. | "amp louder," "less amp," "turn the amp down" |
| **Output level** | Post-amp output trim — typically dB, used to match levels between presets/scenes. | "the preset is quieter than the next one," "level it up" |
| **Per-FX mix** | How much of an effect (reverb/delay/chorus) is heard relative to the dry signal. | "more reverb," "less delay," "wetter," "drier" |

## Per-device mapping

### Fractal AM4

| Intent | Block.param | Range | Unit |
|---|---|---|---|
| Input gain | `amp.gain` | 0..10 | knob |
| Amp master | `amp.master` | 0..10 | knob |
| Output level | `amp.level` | -80..+20 | dB |
| Cab output | `amp.cab_master_level` | knob | (per-amp scaling) |
| Reverb mix | `reverb.mix` | 0..100 | % |
| Delay mix | `delay.mix` | 0..100 | % |
| Chorus/Flanger/Phaser mix | `<block>.mix` | 0..100 | % |
| Compressor output | `compressor.level` | knob | — |
| Per-FX output trim | `<block>.level` | knob/dB | varies |

Notes:
- AM4's `amp.master` and `amp.level` are at different points in the signal
  chain. `master` is amp-internal (preserves gain character); `level` is
  post-amp (clean trim). Reach for `level` when matching presets to each
  other; reach for `master` when the user wants the amp itself louder.
- For "the reverb is washing out the tone," lower `reverb.mix`, not the
  reverb's `level` — mix is the conventional wet/dry knob.

### Fractal Axe-Fx II

| Intent | Block.param | Range | Unit |
|---|---|---|---|
| Input gain | `amp.input_drive` (aliases: `gain`, `drive`) | 0..10 | knob |
| Amp master | `amp.master_volume` (aliases: `master`) | 0..10 | knob |
| Amp output | `amp.level` | knob | — |
| Cab output | `cab.level` | -80..+20 | dB |
| Reverb mix | `reverb.mix` | 0..100 | % |
| Delay mix | `delay.mix` | 0..100 | % |
| Drive volume | `drive.volume` | knob | — |
| Drive mix | `drive.mix` | 0..100 | % |
| Per-FX mix | `<block>.mix` | 0..100 | % |
| Per-FX level | `<block>.level` | knob | varies |

Notes:
- The wire names are `input_drive` and `master_volume` on Axe-Fx II.
  Common English aliases (`gain`, `master`, `drive`) auto-resolve, but the
  canonical names render correctly in error messages and match
  `list_params` output — prefer canonical in tool calls.
- `drive.volume` AND `drive.mix` both exist — `volume` is the boosted
  output (gain stage), `mix` is wet/dry. "Drive louder" → volume; "less
  drive in the chain" → mix.

### ASM Hydrasynth Explorer

The Hydrasynth is a synthesizer, not an amp modeler — different topology:

| Intent | Param | Range | Unit |
|---|---|---|---|
| Main output | `amplevel` | 0.0..128.0 | linear |
| Oscillator level (per osc) | `mixer.osc1_vol`, `mixer.osc2_vol`, `mixer.osc3_vol` | 0.0..128.0 | linear |
| Pre-FX wet | `prefx.mix` (`prefxwet`) | 0..100 | % |
| Delay wet | `delay.dry_wet` (`delaywet`) | 0..100 | % |
| Reverb wet | `reverb.dry_wet` (`reverbwet`) | 0..100 | % |
| Post-FX wet | `postfx.mix` (`postfxwet`) | 0..100 | % |
| Mutator wet (per mutator) | `mutator{1..4}.dry_wet` | 0..100 | % |

Notes:
- Hydrasynth has no "input gain" — it's the sound source. Oscillator
  levels (`mixer.osc*_vol`) are the closest analog to "drive harder"
  (more level into the filter / amplifier path).
- `amplevel` is the global output trim, equivalent to AM4's `amp.level`.
- All FX wet params use the `*wet` wire name with a `.dry_wet` alias.

## Disambiguation cheat sheet for agents

When the user says... the right param is usually...

- **"It's too quiet" / "Turn the preset up"** → `amp.level` (output trim).
  Don't change `amp.master` or `amp.gain` — those affect tone character.
- **"Make the amp louder"** → `amp.master` (AM4) / `amp.master_volume`
  (Axe-Fx II). Preserves amp voicing.
- **"Drive it harder" / "More distortion"** → `amp.gain` /
  `amp.input_drive`. Changes amp character toward breakup.
- **"More/less reverb"** → `reverb.mix`. Don't touch `reverb.level` —
  that's the reverb's output level, which is a different concern.
- **"Washy" / "Too wet"** → lower `*.mix` on whichever FX is too
  prominent (usually reverb or delay).
- **"Dry" / "Bone-dry"** → set `reverb.mix` and `delay.mix` to 0.
- **"More chorus / flanger / phaser"** → `<block>.mix`.
- **"Match the volume to the last preset"** → `amp.level` (-80..+20 dB
  on AM4 and Axe-Fx II cab). Use small adjustments (±2 dB at a time).

## Completeness audit (Session 72, 2026-05-13)

Every device exposes the four canonical control points:

| Control | AM4 | Axe-Fx II | Hydrasynth |
|---|---|---|---|
| Input gain | ✅ `amp.gain` | ✅ `amp.input_drive` | n/a (synth) |
| Amp master | ✅ `amp.master` | ✅ `amp.master_volume` | ✅ `amplevel` |
| Output level | ✅ `amp.level` (dB) | ✅ `cab.level` (dB) | ✅ `amplevel` |
| Per-FX wet/mix | ✅ `<block>.mix` | ✅ `<block>.mix` | ✅ `<block>wet` |

No gaps. Every user "louder/quieter/wetter/drier" intent has a clean
target on every device.

## Open work

- Add cross-device aliases to canonical_terms in each descriptor so the
  unified `set_param` accepts `volume` / `loudness` / `wet` as aliases
  for the canonical names.
- Consider a unified `set_volume(port, target='preset'|'amp'|'reverb'|...,
  level)` helper that the agent can call without remembering per-device
  param names. (Backlog — discuss with founder.)
