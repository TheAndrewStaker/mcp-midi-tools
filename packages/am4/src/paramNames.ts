/**
 * Hand-maintained name table for cache-derived parameters.
 *
 * Pipeline (P1-010): `scripts/gen-params-from-cache.ts` walks every
 * CONFIRMED cache block, looks up each record's `id` in this table,
 * and emits a `KNOWN_PARAMS`-shape entry if a name is present.
 * Records without a name here are NOT emitted — they stay dormant
 * until a human assigns them a UI label (Session B of P1-010).
 *
 * Why a manual table instead of just emitting `param_{id}` placeholders:
 * MCP tool callers (Claude) need real human names to reason about
 * parameters. `amp.gain=6` is useful; `amp.param_11=6` is not. The
 * cache only stores ids + ranges, not labels.
 *
 * Sources for labels (in priority order):
 *   1. Wire captures that pin a name to a `(pidLow, pidHigh)` pair
 *      (highest confidence — see SYSEX-MAP §6a for the decode rule).
 *   2. `docs/manuals/Fractal-Audio-Blocks-Guide.txt` param descriptions.
 *   3. AM4-Edit UI labels observed via AM4-Edit screenshots.
 *
 * Entry shape (two forms):
 *   `'name'` — plain string. Generator infers unit from cache `c`
 *     (display-scale) via the default mapping (c=10 → knob_0_10,
 *     c=100 → percent, c=1000 → ms, c=1 → db, enum → enum).
 *   `{ name: 'label', unit: 'hz' }` — object form with an explicit
 *     unit override. Required when cache signature is ambiguous
 *     (e.g. c=1 could be dB / Hz / seconds / raw-count — the cache
 *     doesn't distinguish). Optional `displayMin` / `displayMax`
 *     overrides round the cache's internal min/max to a cleaner UI
 *     range where needed (e.g. reverb.predelay cache max=0.25s →
 *     displayMax=250 ms instead of the floating-point 250.0000…).
 *
 * Seed (2026-04-19, Session 25): every name already registered in
 * `KNOWN_PARAMS`. Session 26 (2026-04-20) added tone-stack + Mix
 * Page + Drive tone/level/mix + reverb predelay + LFO rates +
 * reverb time via the object-form overrides.
 *
 * OUT-OF-BAND PARAMS (not in the cache; hand-registered in
 * `KNOWN_PARAMS` directly, not through this pipeline):
 *   - `amp.level` / other-block `level` — pidHigh=0x0000, no cache
 *     record at id=0.
 *   - `{amp,drive,reverb,delay}.channel` — pidHigh=0x07D2, no cache
 *     record (Session 08 decoded this directly from wire captures).
 *
 * These remain in `params.ts` regardless of what this file says.
 */
import type { Unit } from './params.js';

export type ParamNameEntry =
  | string
  | { readonly name: string; readonly unit?: Unit; readonly displayMin?: number; readonly displayMax?: number };

// Universal per-block output Balance at cache id=2 — signature
// (a=-1, b=1, c=100) across every confirmed block. Blocks Guide §347
// documents Balance as a standard block-level parameter that pans
// the block's output between left and right. Requires the
// `bipolar_percent` unit (display -100..+100, internal -1..+1,
// scale 100) which generator default for c=100 would misclassify
// as plain `percent` (0..100).
const BALANCE: ParamNameEntry = {
  name: 'balance',
  unit: 'bipolar_percent',
  displayMin: -100,
  displayMax: 100,
};

export const PARAM_NAMES: Readonly<Record<string, Readonly<Record<number, ParamNameEntry>>>> = {
  amp: {
    2: BALANCE,
    // Session 29 (HW-015): Out Boost Level — dB knob on the Extras tab,
    // cache (a=0, b=4, c=1, step=0.05). Wire-verified at pidHigh=0x08.
    8: { name: 'out_boost_level', unit: 'db', displayMin: 0, displayMax: 4 },
    10: 'type',
    11: 'gain',
    12: 'bass',
    // ids 13/14 (mid/treble) still structural — cache signature identical
    // to gain/bass (knob_0_10, 0..1 range, step 0.001). Named per the
    // AM4 Owner's Manual line 1563 tone-stack order "Gain, Bass, Mid,
    // Treble, Presence, Level". HW-014 spot-check still pending.
    13: 'mid',
    14: 'treble',
    // Session 29 (HW-015): id 15 (pidHigh=0x0f) was mis-inferred as
    // 'presence' in Session 26 from the cache signature alone. Two
    // wire captures (amp-master on an unknown Marshall-family amp +
    // amp-master-2 on "Brit 800 #34") prove this register is Master.
    // Real Presence was subsequently captured at id 30 (pidHigh=0x1e).
    15: 'master',
    // Session 29 (HW-015): Depth at pidHigh=0x1a, knob_0_10. Wire-
    // verified with a full 0→10 sweep capture.
    26: 'depth',
    // Session 29 (HW-015): Presence at pidHigh=0x1e, knob_0_10. Wire-
    // verified on the same amp as amp-master. Corrects the Session 26
    // structural guess at id 15.
    30: 'presence',
    // HW-040 (Session 36, 2026-04-29): Amp Expert-Edit page from
    // session-40-amp-expert.pcapng + paired AM4-Edit screenshot
    // (FAS Modern III). Wiggle order + screenshot column order
    // disambiguates the OFF/ON switches in the IDEAL column.
    20: { name: 'bright_cap', unit: 'pf', displayMin: 10, displayMax: 10000 },
    54: { name: 'input_trim', unit: 'count', displayMin: 0.1, displayMax: 10 },
    // amp's 8-band GEQ stores ±1 wire, scale ×12 → display ±12 dB.
    // Cache ids 62..69 share the (a=-1, b=1, c=12) signature. Uses the
    // `amp_geq_band` unit (scale 12) — distinct from drive's GEQ which
    // stores ±12 wire directly (cache c=1) and uses plain `db`.
    62: { name: 'geq_band_1', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    63: { name: 'geq_band_2', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    64: { name: 'geq_band_3', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    65: { name: 'geq_band_4', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    66: { name: 'geq_band_5', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    67: { name: 'geq_band_6', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    68: { name: 'geq_band_7', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    69: { name: 'geq_band_8', unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
    77: { name: 'compressor_clarity', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    82: { name: 'compressor_amount', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    83: { name: 'compressor_threshold', unit: 'db', displayMin: -60, displayMax: 0 },
    84: { name: 'master_vol_trim', unit: 'count', displayMin: 0.1, displayMax: 10 },
    104: { name: 'high_treble', unit: 'db', displayMin: -12, displayMax: 12 },
  },
  drive: {
    2: BALANCE,
    10: 'type',
    11: 'drive',
    // AM4 Owner's Manual line 1330: "Page Right and dial in Drive, Tone,
    // and Level." Cache records at 0x0C and 0x0D have the identical
    // knob_0_10 signature to drive.drive (0x0B); typical pedal-UI order
    // matches. `mix` at 0x0E follows the universal Mix Page pattern
    // (percent). All three await Session D hardware spot-check.
    12: 'tone',
    13: 'level',
    14: 'mix',
    // HW-019 (Session 30, 2026-04-25): EQ-page knobs decoded from
    // session-30-drive-basic-blackglass-7k. Cache ids 16/17 are the
    // Hz cuts (raw passthrough — c=1 default would mis-classify as dB),
    // ids 20/21/23 are the knob_0_10 Bass/Mid/Treble flanking id 22
    // (mid frequency in Hz). T808 OD doesn't expose these — the
    // session-30-drive-basic-t808-od capture only had drive/tone/level.
    16: { name: 'low_cut', unit: 'hz', displayMin: 20, displayMax: 2000 },
    20: 'bass',
    21: 'mid',
    22: { name: 'mid_freq', unit: 'hz', displayMin: 200, displayMax: 2000 },
    23: 'treble',
    // HW-029 + HW-039 (Session 35, 2026-04-29): Blackglass 7K Drive
    // Expert-Edit page exposes a second-Hz cut + a 10-band post-Drive
    // Graphic EQ + DIGITAL LO-FI + ADVANCED knobs. Decoded from
    // session-31-drive-expert.pcapng + paired AM4-Edit screenshot.
    // Closes HW-029 (0x002d = high_mid knob, knob_0_10 — wiggled
    // adjacent to drive.mid_freq + drive.treble in the timeline).
    //
    // - id 17 (0x0011): high_cut sibling to id 16. Cache c=1 a=200
    //   b=20000 — needs the 'hz' override (default would be dB).
    // - id 24 (0x0018): Bit Reduce count, cache a=0 b=24 c=1 raw.
    //   Uses the 'count' unit (default for c=1 would be dB).
    // - id 45 (0x002d): drive.high_mid for Blackglass 7K (cache c=10
    //   knob_0_10). Type-specific UI label varies; the register name
    //   reflects the most common Blackglass usage.
    17: { name: 'high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    24: { name: 'bit_reduce', unit: 'count', displayMin: 0, displayMax: 24 },
    // 10-band post-Drive Graphic EQ — cache ids 29..38 all share the
    // bipolar dB ±12 signature (a=-12 b=12 c=1 step=0.025). Frequencies
    // per the screenshot: 100, 160, 250, 400, 640, 1000, 1600, 2500,
    // 4000, 6400 Hz. Wire-display match is byte-exact on all 10 bands
    // (capture vs screenshot agree exactly).
    29: { name: 'geq_band_1', unit: 'db', displayMin: -12, displayMax: 12 },
    30: { name: 'geq_band_2', unit: 'db', displayMin: -12, displayMax: 12 },
    31: { name: 'geq_band_3', unit: 'db', displayMin: -12, displayMax: 12 },
    32: { name: 'geq_band_4', unit: 'db', displayMin: -12, displayMax: 12 },
    33: { name: 'geq_band_5', unit: 'db', displayMin: -12, displayMax: 12 },
    34: { name: 'geq_band_6', unit: 'db', displayMin: -12, displayMax: 12 },
    35: { name: 'geq_band_7', unit: 'db', displayMin: -12, displayMax: 12 },
    36: { name: 'geq_band_8', unit: 'db', displayMin: -12, displayMax: 12 },
    37: { name: 'geq_band_9', unit: 'db', displayMin: -12, displayMax: 12 },
    38: { name: 'geq_band_10', unit: 'db', displayMin: -12, displayMax: 12 },
    45: 'high_mid',
  },
  reverb: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    // Blocks Guide §Reverb Basic Page: "Time — Sets the decay time."
    // Cache 0x0B is 0.1..100 seconds, c=1 (raw passthrough). Needs the
    // 'seconds' unit override — generator default for c=1 is 'db'.
    // displayMin rounded to 0.1 (cache stores 0.10000000149…).
    11: { name: 'time', unit: 'seconds', displayMin: 0.1 },
    // Session 29 (HW-015): Size at pidHigh=0x0f, percent. Wire-verified
    // on two captures — "Plate Size" (on Plate reverb type) and "Size"
    // (on Room reverb type) both wrote to this register, confirming
    // it's a universal reverb-size knob whose UI label depends on the
    // active reverb type.
    15: 'size',
    // BK-033 (HW-025 #1, Session 30): the cache record at id=16 (0x10)
    // signature LOOKED like predelay (0..0.25s × 1000 = 0..250 ms) but
    // wire-testing proved it's a dead address — writes ack but the
    // firmware ignores them. The real predelay register is id=19 (0x13);
    // AM4-Edit captures wrote there for "Pre-Delay → 85 ms / 111.4 ms".
    // Skipping id=16 here so the generator doesn't emit the wrong cache
    // mapping; the corrected entry lives hand-authored in params.ts.
    // The cache record at 0x13 has no name slot here either — it's
    // not exposed via the auto-gen path; instead reverb.predelay is
    // a pure KNOWN_PARAMS hand-authored entry going forward.
    // Session 29 (HW-015): Spring-reverb-specific. Number of Springs
    // (integer count 2..6) at pidHigh=0x1b; cache c=1 structurally
    // ambiguous — needs 'count' override. Spring Tone (knob_0_10) at
    // pidHigh=0x1c; cache signature matches knob_0_10 default. Both
    // only visible in AM4-Edit when a Spring reverb type is active,
    // but the registers remain writable on any type — writes simply
    // no-op on non-spring reverbs.
    27: { name: 'springs', unit: 'count', displayMin: 2, displayMax: 6 },
    28: 'spring_tone',
    // Session 29 follow-up (2026-04-21): Shimmer Verb / Plex Verb
    // "Shift 1" and "Shift 2" pitch-shifter voices. Blocks Guide
    // §Shimmer Verb Parameters: "Shift 1–8 — Sets the amount of
    // detune within a range of ±24 semitones. This is where
    // 'Shimmer' is born." AM4's reverb has two such voices (ids
    // 56/57); the AxeFx/FM8-voice variant ships more. Cache signature
    // (a=-24, b=24, c=1, step=1) matches the BG documentation
    // exactly — needs the 'semitones' unit override since c=1 is
    // structurally ambiguous. Structural registration; HW-014-style
    // spot-check still required.
    56: { name: 'shift_1', unit: 'semitones', displayMin: -24, displayMax: 24 },
    57: { name: 'shift_2', unit: 'semitones', displayMin: -24, displayMax: 24 },
  },
  delay: {
    // Mix follows the universal percent-at-0x01 pattern (Blocks Guide
    // §Common Mix/Level Parameters, p. 7). "delay block uses a
    // different Mix Law compared to other blocks" — same param, just
    // different internal curve; still the wet/dry knob.
    1: 'mix',
    2: BALANCE,
    10: 'type',
    12: 'time',
    // Session 29 (HW-015): Feedback at pidHigh=0x0e. Cache (a=-1, b=1,
    // c=100) is bipolar — negative feedback inverts the phase of the
    // repeats, a standard Fractal delay feature.
    14: { name: 'feedback', unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
    // HW-020 (Session 30, 2026-04-25): Ducking attenuation amount,
    // session-30-delay-basic-digital-mono capture. Cache id=46 a=0
    // b=80 c=1 → raw dB 0..80. Same signature as reverb.ducking
    // (HW-018). delay.level (out-of-band, pidHigh=0x0000) and
    // delay.stack_hold (per-block non-Type enum, pidHigh=0x001f) are
    // hand-authored in params.ts directly.
    46: 'ducking',
    // HW-040 (Session 36, 2026-04-29): Delay Expert-Edit page on
    // Ambient Stereo from session-40-delay-expert.pcapng. ~32 new
    // params across BASIC + DIFFUSOR + EQ + MIX + DUCKER + COMPANDER
    // + STACK/HOLD + LO FI sections. Cache shapes pin units; screenshot
    // labels confirm names. Bypass_mode / kill_dry / phase_reverse /
    // slopes / compander enums are hand-authored in params.ts.
    13: { name: 'lr_time_ratio', unit: 'percent', displayMin: 1, displayMax: 100 },
    16: { name: 'feedback_r', unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
    18: { name: 'stereo_spread', unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
    20: { name: 'low_cut', unit: 'hz', displayMin: 20, displayMax: 2000 },
    21: { name: 'high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    27: { name: 'input_gain', unit: 'percent', displayMin: 0, displayMax: 100 },
    32: { name: 'master_feedback', unit: 'percent', displayMin: 0, displayMax: 200 },
    47: { name: 'ducker_threshold', unit: 'db', displayMin: -80, displayMax: 20 },
    48: { name: 'ducker_release', unit: 'ms', displayMin: 1, displayMax: 1000 },
    49: { name: 'diffusor', unit: 'percent', displayMin: 0, displayMax: 100 },
    50: { name: 'diffusion_time', unit: 'percent', displayMin: 1, displayMax: 100 },
    63: { name: 'eq_q_high_low', unit: 'count', displayMin: 0.1, displayMax: 10 },
    64: { name: 'bit_reduction', unit: 'count', displayMin: 0, displayMax: 24 },
    65: { name: 'eq_freq_1', unit: 'hz', displayMin: 20, displayMax: 2000 },
    66: { name: 'eq_freq_2', unit: 'hz', displayMin: 100, displayMax: 10000 },
    67: { name: 'eq_q_1', unit: 'count', displayMin: 0.1, displayMax: 10 },
    68: { name: 'eq_q_2', unit: 'count', displayMin: 0.1, displayMax: 10 },
    69: { name: 'eq_gain_1', unit: 'db', displayMin: -12, displayMax: 12 },
    70: { name: 'eq_gain_2', unit: 'db', displayMin: -12, displayMax: 12 },
    // HW-053 (2026-05-04): cache id=72 (DELAY_SPEED, "Motor Speed") has
    // a=0.5, b=2, c=1 — a tape-motor speed multiplier, not dB. Without
    // this hand override the cache pipeline emits unit='db' from the
    // c=1 default. Range 0.5..2.0 = half-speed to double-speed; only
    // applies when delay.type is Ping-Pong (per type-applicability).
    72: { name: 'motor_speed', unit: 'count', displayMin: 0.5, displayMax: 2 },
    76: { name: 'compander_time', unit: 'ms', displayMin: 1, displayMax: 100 },
    77: { name: 'compander_threshold', unit: 'db', displayMin: -100, displayMax: -20 },
    78: { name: 'master_time', unit: 'percent', displayMin: 25, displayMax: 400 },
    79: { name: 'lfo_rate', unit: 'hz', displayMin: 0.1, displayMax: 10 },
    80: { name: 'lfo_depth', unit: 'percent', displayMin: 0, displayMax: 100 },
    87: { name: 'stack_feedback', unit: 'percent', displayMin: 0, displayMax: 100 },
    88: { name: 'hold_feedback', unit: 'percent', displayMin: 0, displayMax: 100 },
  },
  // Universal `mix` at pidHigh 0x01 across every effect block that
  // exposes a Mix Page per the Blocks Guide (p. 7). Skipped for
  // Amp/Drive (different semantics), Wah/GEQ/Gate/VolPan (no wet/dry —
  // AM4 manual p.34 line 1423: "Effects with no mix, such as Wah,
  // GEQ, etc., will show 'NA'"). Cache signature matches percent
  // (0..1 × 100) structurally identical to the confirmed reverb.mix.
  // Modulation-block LFO controls. Blocks Guide §Chorus/Flanger/Phaser
  // document "Rate (Hz/BPM): Controls the speed of the modulation" —
  // all three blocks expose a rate knob with the same cache-c=1 raw-Hz
  // signature. Depth is a percent knob at a distinct pidHigh per block.
  chorus: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    12: { name: 'rate', unit: 'hz', displayMin: 0.1 },
    14: 'depth',
    // HW-040 (Session 36, 2026-04-29): Chorus Expert-Edit page on
    // Analog Stereo from session-40-chorus-expert.pcapng. Cache shapes
    // pin units; screenshot labels confirm names.
    11: { name: 'number_of_voices', unit: 'count', displayMin: 1, displayMax: 4 },
    15: { name: 'high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    21: { name: 'lfo_phase_pct', unit: 'percent', displayMin: 0, displayMax: 100 },
    22: { name: 'lfo_rate', unit: 'hz', displayMin: 0.1, displayMax: 10 },
    23: { name: 'width', unit: 'percent', displayMin: 0, displayMax: 100 },
    24: { name: 'drive', unit: 'knob_0_10', displayMin: 0.5, displayMax: 500 },
    25: { name: 'lfo_freq', unit: 'hz', displayMin: 20, displayMax: 2000 },
    26: { name: 'lfo_depth_2', unit: 'bipolar_percent', displayMin: -200, displayMax: 200 },
  },
  // geq Expert-Edit additions are merged into the existing geq:
  // entry above (lines ~299) — duplicate removed in Session 36
  // cleanup. The 10 GEQ bands + master_q now live there.
  flanger: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    11: { name: 'rate', unit: 'hz', displayMin: 0.05 },
    13: 'depth',
    // Session 29 (HW-015): Feedback at pidHigh=0x0e. Cache (a=-0.995,
    // b=0.995, c=100) — bipolar_percent with the internal range
    // clamped slightly short of ±1.0 per Fractal's flanger
    // implementation.
    14: { name: 'feedback', unit: 'bipolar_percent', displayMin: -99, displayMax: 99 },
  },
  phaser: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    12: { name: 'rate', unit: 'hz', displayMin: 0.1 },
    // Session 29 (HW-015): Feedback at pidHigh=0x10. Cache (a=-0.9,
    // b=0.9, c=111.1) — bipolar, internal ±0.9 with an unusual
    // display-scale of 111.1 meaning internal -0.9 displays as
    // -99.99%. We use the standard bipolar_percent unit (scale 100)
    // with displayMin/Max clamped to ±90 so input stays within the
    // internal range; the displayed percentage in AM4-Edit may read
    // slightly higher than the value Claude used (e.g. "50" sets
    // internal 0.5, AM4-Edit displays ~55.5%) but the wire behavior
    // is correct. Natural-language UX impact is negligible.
    16: { name: 'feedback', unit: 'bipolar_percent', displayMin: -90, displayMax: 90 },
  },
  wah: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    // HW-040 (Session 36, 2026-04-29): Wah Expert-Edit page on FAS Wah
    // from session-40-wah-expert.pcapng. Cache shapes pin units;
    // screenshot labels confirm names. **BK-035 audit (Session 36 cont,
    // 2026-04-29):** the original auto-generated names for ids 13..20
    // were misaligned vs the AM4-Edit screenshot. Each label below was
    // re-derived from the value-matched audit table run via
    // `scripts/audit-block-vs-screenshot.ts` against
    // `docs/audit-input/wah.json`. Old → new mapping:
    //   13 (was `q`,                  range 2..20) → `q_resonance`, range 0..10
    //   14 (was `q_resonance`)        → `q_tracking`
    //   15 (was `q_tracking`)         → `wah_control`
    //   16 (was `drive`)              → `fat`
    //   17 (was `fat`)                → `drive`
    //   18 (was unregistered)         → `control_taper` (enum, hand-authored in params.ts)
    //   19 (was `low_cut_frequency`)  → `inductor_bias`
    //   20 (was `inductor_bias`)      → `low_cut_frequency`
    11: { name: 'min_frequency', unit: 'hz', displayMin: 100, displayMax: 1000 },
    12: { name: 'max_frequency', unit: 'hz', displayMin: 500, displayMax: 5000 },
    13: { name: 'q_resonance', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    14: { name: 'q_tracking', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    15: { name: 'wah_control', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    16: { name: 'fat', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    17: { name: 'drive', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    19: { name: 'inductor_bias', unit: 'knob_0_10', displayMin: 0, displayMax: 10 },
    20: { name: 'low_cut_frequency', unit: 'hz', displayMin: 20, displayMax: 2000 },
    22: { name: 'graphic_eq_band_1', unit: 'db', displayMin: -12, displayMax: 12 },
    23: { name: 'graphic_eq_band_2', unit: 'db', displayMin: -12, displayMax: 12 },
    24: { name: 'graphic_eq_band_3', unit: 'db', displayMin: -12, displayMax: 12 },
    25: { name: 'graphic_eq_band_4', unit: 'db', displayMin: -12, displayMax: 12 },
    26: { name: 'graphic_eq_band_5', unit: 'db', displayMin: -12, displayMax: 12 },
    27: { name: 'graphic_eq_band_6', unit: 'db', displayMin: -12, displayMax: 12 },
    28: { name: 'graphic_eq_band_7', unit: 'db', displayMin: -12, displayMax: 12 },
    29: { name: 'graphic_eq_band_8', unit: 'db', displayMin: -12, displayMax: 12 },
  },
  // HW-040 (Session 36, 2026-04-29): NEW BLOCKS — PEQ (parametric EQ,
  // pidLow=0x0036, S2 cacheBlock=4) and Rotary (pidLow=0x0056, S3
  // cacheBlock=4). Neither has a Type enum at id=10. Captures from
  // session-40-{peq,rot}-expert.pcapng.
  peq: {
    1: 'mix',
    2: BALANCE,
    // 5 channels of parametric EQ, each with Type / Frequency / Q /
    // Gain / Solo. Cache lays them out in groups: ids 10-14 are the
    // 5 frequencies (Hz, varying ranges), 15-19 are the 5 Q values
    // (count 0.1..10), 20-24 are the 5 gains (dB ±20).
    10: { name: 'channel_1_frequency', unit: 'hz', displayMin: 20, displayMax: 2000 },
    11: { name: 'channel_2_frequency', unit: 'hz', displayMin: 100, displayMax: 10000 },
    12: { name: 'channel_3_frequency', unit: 'hz', displayMin: 100, displayMax: 10000 },
    13: { name: 'channel_4_frequency', unit: 'hz', displayMin: 100, displayMax: 10000 },
    14: { name: 'channel_5_frequency', unit: 'hz', displayMin: 200, displayMax: 20000 },
    15: { name: 'channel_1_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    16: { name: 'channel_2_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    17: { name: 'channel_3_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    18: { name: 'channel_4_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    19: { name: 'channel_5_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    20: { name: 'channel_1_gain', unit: 'db', displayMin: -20, displayMax: 20 },
    21: { name: 'channel_2_gain', unit: 'db', displayMin: -20, displayMax: 20 },
    22: { name: 'channel_3_gain', unit: 'db', displayMin: -20, displayMax: 20 },
    23: { name: 'channel_4_gain', unit: 'db', displayMin: -20, displayMax: 20 },
    24: { name: 'channel_5_gain', unit: 'db', displayMin: -20, displayMax: 20 },
  },
  rotary: {
    1: 'mix',
    2: BALANCE,
    // FAS Rotary cabinet sim. Cache layout (cacheBlock=4 in S3).
    // **BK-035 audit (Session 36 cont, 2026-04-29):** initial cache-driven
    // names had two pidHigh swaps vs the AM4-Edit screenshot. Re-derived
    // via `scripts/audit-block-vs-screenshot.ts` against
    // `docs/audit-input/rotary.json`:
    //   id 10 (was `drive`)        → `rate` (Leslie speed knob; cache
    //                                  range 0..10 ×1 → display 0..10 Hz)
    //   id 21 (was `mic_spacing`)  → `drive` (cache range 0.5..500 ×10)
    //   id 16 (was unregistered)   → `mic_spacing` (cache π-encoded:
    //                                  range 0..π × 31.831 → display 0..100)
    // Plus 5 new entries founder confirmed from screenshot:
    //   id 0 → `level` (db); id 4 → `bypass_mode` (enum, hand-authored
    //   in params.ts); id 14 → `tempo` (TEMPO_DIVISIONS, hand-authored);
    //   id 20 → `stereo_spread` (bipolar -200..200%); id 23 →
    //   `input_select` (enum [L+R, LEFT, RIGHT], hand-authored).
    10: { name: 'rate', unit: 'hz', displayMin: 0, displayMax: 10 },
    11: { name: 'low_depth', unit: 'percent', displayMin: 0, displayMax: 100 },
    12: { name: 'high_depth', unit: 'percent', displayMin: 0, displayMax: 100 },
    13: { name: 'high_level', unit: 'db', displayMin: -6, displayMax: 6 },
    15: { name: 'rotor_length', unit: 'percent', displayMin: 0.1, displayMax: 100 },
    16: { name: 'mic_spacing', unit: 'rotary_mic_spacing', displayMin: 0, displayMax: 100 },
    17: { name: 'low_rate_multiplier', unit: 'count', displayMin: 0.1, displayMax: 10 },
    18: { name: 'low_time_constant', unit: 'count', displayMin: 0.1, displayMax: 10 },
    19: { name: 'high_time_constant', unit: 'count', displayMin: 0.1, displayMax: 10 },
    20: { name: 'stereo_spread', unit: 'bipolar_percent', displayMin: -200, displayMax: 200 },
    21: { name: 'drive', unit: 'knob_0_10', displayMin: 0.5, displayMax: 500 },
    22: { name: 'mic_distance', unit: 'count', displayMin: 0.01, displayMax: 1 },
  },
  compressor: {
    1: 'mix',
    2: BALANCE,
    // HW-021 (Session 30, 2026-04-25): Compressor first-page knobs from
    // session-30-comp-basic-jfet-studio. Cache ids 10..15 are the
    // canonical comp-config registers per Blocks Guide §Compressor:
    // Threshold (dB), Ratio (1..20:1, new `ratio` unit), Attack (ms),
    // Release (ms), Knee Type enum (id 14, not yet wiggled), Auto
    // Makeup OFF/ON (id 15, hand-authored in params.ts because per-
    // block non-Type enums skip the generator). compressor.level
    // (pidHigh=0x0000) is out-of-band hand-authored.
    10: { name: 'threshold', unit: 'db', displayMin: -60, displayMax: 20 },
    12: { name: 'attack', unit: 'ms', displayMin: 0.1, displayMax: 100 },
    13: { name: 'release', unit: 'ms', displayMin: 2, displayMax: 2000 },
    19: 'type',
    // Ratio uses the new `ratio` unit (display = internal, scale 1) so
    // Claude reads "ratio 4" as 4:1 not 4 dB. Cache c=1 default would
    // mis-classify as dB; full override required.
    11: { name: 'ratio', unit: 'ratio', displayMin: 1, displayMax: 20 },
    // HW-028 + HW-039 (Session 35, 2026-04-29): JFET Studio Compressor
    // Expert-Edit page exposes a Sidechain section + a Drive-engine
    // emphasis knob. Decoded from session-31-comp-jfet-expert.pcapng
    // + paired AM4-Edit screenshot. Cache shapes pin units; screenshot
    // labels confirm the names. Wire-vs-screenshot value mismatches on
    // Ratio (wire 2.22 / shot 3.000) and Look-Ahead (wire 4.33 ms / shot
    // 2.000 ms) — founder noted screenshot was for label confirmation,
    // not exact final-value sync; cache shapes + label position keep
    // registration unambiguous. Closes HW-028 (0x0017 = emphasis at
    // cache c=20 fine knob 0..20; 0x0029 = drive at cache c=10
    // knob_0_10).
    17: { name: 'sidechain_low_cut', unit: 'hz', displayMin: 20, displayMax: 2000 },
    21: { name: 'look_ahead_time', unit: 'ms', displayMin: 0, displayMax: 2 },
    23: { name: 'emphasis', unit: 'knob_0_20', displayMin: 0, displayMax: 20 },
    26: { name: 'sidechain_high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    27: { name: 'sidechain_gain', unit: 'db', displayMin: -12, displayMax: 12 },
    28: { name: 'sidechain_frequency', unit: 'hz', displayMin: 100, displayMax: 10000 },
    // Q is a fractional 0.1..10 quality factor — `count` here is
    // structural (display = wire passthrough), not integer-only.
    29: { name: 'sidechain_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
    39: { name: 'sidechain_emphasis_freq', unit: 'hz', displayMin: 100, displayMax: 10000 },
    41: 'drive',
  },
  geq: {
    1: 'mix',
    2: BALANCE,
    20: 'type',
    // HW-040 (Session 36, 2026-04-29): GEQ Expert-Edit page on
    // 10 Band Variable Q from session-40-geq-expert.pcapng. 10 bands
    // (cache ids 10-19), all bipolar dB ±12, plus Master Q (id 21).
    // **BK-035 audit (Session 36 cont, 2026-04-29):** added Level
    // (hand-authored in params.ts because pidHigh=0x0000 has no cache
    // record at id=0 across blocks) and Bypass Mode (hand-authored enum).
    10: { name: 'band_1', unit: 'db', displayMin: -12, displayMax: 12 },
    11: { name: 'band_2', unit: 'db', displayMin: -12, displayMax: 12 },
    12: { name: 'band_3', unit: 'db', displayMin: -12, displayMax: 12 },
    13: { name: 'band_4', unit: 'db', displayMin: -12, displayMax: 12 },
    14: { name: 'band_5', unit: 'db', displayMin: -12, displayMax: 12 },
    15: { name: 'band_6', unit: 'db', displayMin: -12, displayMax: 12 },
    16: { name: 'band_7', unit: 'db', displayMin: -12, displayMax: 12 },
    17: { name: 'band_8', unit: 'db', displayMin: -12, displayMax: 12 },
    18: { name: 'band_9', unit: 'db', displayMin: -12, displayMax: 12 },
    19: { name: 'band_10', unit: 'db', displayMin: -12, displayMax: 12 },
    21: { name: 'master_q', unit: 'count', displayMin: 0.1, displayMax: 10 },
  },
  filter: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    // Blocks Guide §Filter: Frequency is the filter cutoff (20..20000 Hz
    // at cache-c=1 raw). Universal control for every filter type.
    11: { name: 'freq', unit: 'hz' },
    // HW-032 (Session 30 cont 8, 2026-04-25): Low/High cut on the
    // filter Config page — `session-32-filter-extended.pcapng`. Cache
    // c=1 raw Hz; needs the 'hz' override since the generator default
    // for c=1 is 'db'. Wire-verified at 100 Hz / 1800 Hz.
    18: { name: 'low_cut', unit: 'hz', displayMin: 20, displayMax: 2000 },
    19: { name: 'high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    // HW-034 (Session 33, 2026-04-26): All-Pass filter Config-page
    // residuals — `session-33-filter-extended.pcapng`. Wire-verified
    // at +13% / 4 poles on an All-Pass filter. Feedback's cache
    // signature (a=-1, b=1, c=100) requires the bipolar_percent
    // override since the generator default for c=100 is plain
    // percent. Order is a raw integer (cache c=1 a=1 b=12) — needs
    // 'count' override since c=1 default is 'db'.
    21: { name: 'feedback', unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
    28: { name: 'order', unit: 'count', displayMin: 1, displayMax: 12 },
    // HW-053 (2026-05-04): cache id=33 (FILTER_SENS, "Sensitivity") has
    // a=0.1, b=40, c=10, typecode=80 (log10). The generator's c=10
    // default forces displayMin=0, displayMax=10 (knob_0_10). With
    // displayMin=0, the runtime decode falls back to LINEAR even when
    // typecode 80 wants log10 — yielding the inverted-taper bug HW-053
    // observed (write 7 → display 3.25). Override with a positive
    // displayMin so log10 fires correctly. Only applies when
    // filter.type is Envelope Filter / Auto-Wah / Touch-Wah (per
    // type-applicability).
    33: { name: 'sensitivity', unit: 'count', displayMin: 0.1, displayMax: 40 },
  },
  tremolo: {
    1: 'mix',
    2: BALANCE,
    10: 'type',
    // Blocks Guide §Tremolo: Rate sets the modulation speed (0.2..20 Hz
    // at cache-c=1 raw). Depth is a percent knob.
    12: { name: 'rate', unit: 'hz', displayMin: 0.2 },
    13: 'depth',
  },
  enhancer: {
    1: 'mix',
    2: BALANCE,
    // HW-037 (Session 35, 2026-04-29): Config-page knobs from
    // session-33-enhancer-extended.pcapng + paired screenshot. Wire-
    // verified at width=33% / depth=11% / low_cut=22.2 Hz /
    // high_cut=6500 Hz on a Modern enhancer. Width + Depth follow the
    // generator's c=100 → percent default; Low/High Cut need the 'hz'
    // override since cache c=1 default is dB. enhancer.level is out-of-
    // band hand-authored in params.ts (pidHigh=0x0000, no cache record).
    10: 'width',
    11: 'depth',
    12: { name: 'low_cut', unit: 'hz', displayMin: 20, displayMax: 2000 },
    13: { name: 'high_cut', unit: 'hz', displayMin: 200, displayMax: 20000 },
    // AM4-Edit labels this "Mode" but we keep `type` for cross-block consistency.
    14: 'type',
  },
  gate: {
    2: BALANCE,
    // HW-035 (Session 34, 2026-04-26): slot-Gate Config-page knobs on
    // Modern Gate type — `session-34-slotgate-extended.pcapng`.
    // Threshold/Attack/Hold/Release/Attenuation are dB and ms knobs
    // with cache c=1 (raw dB, signed) and c=1000 (ms) signatures
    // respectively. Sidechain enum (cache id=15) is hand-authored
    // in params.ts since the generator only handles one enum import
    // per block (used for `type` at id=19).
    10: { name: 'threshold', unit: 'db', displayMin: -100, displayMax: 0 },
    11: { name: 'attack', unit: 'ms', displayMin: 0, displayMax: 1000 },
    12: { name: 'hold', unit: 'ms', displayMin: 0, displayMax: 1000 },
    13: { name: 'release', unit: 'ms', displayMin: 0, displayMax: 1000 },
    19: 'type',
    20: { name: 'attenuation', unit: 'db', displayMin: -80, displayMax: 0 },
  },
  volpan: {
    2: BALANCE,
    // The Volume-vs-Auto-Swell selector. Registered as `volpan.mode` in
    // KNOWN_PARAMS for historical reasons — keep the name stable.
    15: 'mode',
    // HW-032 (Session 30 cont 8, 2026-04-25): Auto-Swell envelope params
    // on the Volume/Pan Config page — `session-32-volpan-extended.pcapng`.
    // Threshold (id=16, dB) wire-verified at -20 dB; Attack (id=17, ms)
    // wire-verified at 300 ms. Cache c=1 for threshold (raw dB, needs
    // 'db' override since generator default is also 'db' but we set the
    // range explicitly). Cache c=1000 for attack means generator picks
    // 'ms' automatically — no override needed except the display range.
    16: { name: 'threshold', unit: 'db', displayMin: -100, displayMax: 0 },
    17: { name: 'attack', unit: 'ms', displayMin: 1, displayMax: 5000 },
  },
} as const;
