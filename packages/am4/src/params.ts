/**
 * AM4 parameter registry.
 *
 * Each entry maps a human key (`block.name`) to its wire-level address
 * (`pidLow` = block ID, `pidHigh` = parameter index within block) and
 * its display ↔ internal scale convention.
 *
 * Address is preset-independent (confirmed Session 06 — Amp pidLow
 * matches across A01 and A2). See docs/_private/STATE.md for the decoded set.
 */

import type { ParamId } from './setParam.js';
import { CACHE_PARAMS } from './cacheParams.js';
import {
  AMP_TYPES_VALUES,
  DRIVE_TYPES_VALUES,
  REVERB_TYPES_VALUES,
  DELAY_TYPES_VALUES,
  CHORUS_TYPES_VALUES,
  FLANGER_TYPES_VALUES,
  PHASER_TYPES_VALUES,
  WAH_TYPES_VALUES,
  COMPRESSOR_TYPES_VALUES,
  GEQ_TYPES_VALUES,
  FILTER_TYPES_VALUES,
  TREMOLO_TYPES_VALUES,
  ENHANCER_TYPES_VALUES,
  GATE_TYPES_VALUES,
  VOLPAN_MODES_VALUES,
  TEMPO_DIVISIONS_VALUES,
  LFO_WAVEFORMS_VALUES,
} from './cacheEnums.js';

/**
 * How a parameter's display value relates to the float stored on the
 * wire. The firmware always stores a float; the unit decides the scale.
 *
 *   knob_0_10        — UI 0–10, internal ÷10 (gain-style knobs)
 *   db               — UI dB, internal raw dB
 *   hz               — UI Hz (raw passthrough), for LFO rates + filter cutoffs
 *   seconds          — UI seconds (raw passthrough), for reverb time etc.
 *   percent          — UI 0–100%, internal ÷100
 *   bipolar_percent  — UI -100..+100%, internal -1..+1 (balance knobs —
 *                      per-block output balance, stereo pan)
 *   count            — UI integer count (voices, stages, taps, springs);
 *                      display = internal (scale 1)
 *   semitones        — UI integer semitones (pitch shift);
 *                      display = internal (scale 1)
 *   ratio            — UI compression ratio (e.g. 4 ⇒ 4:1); display =
 *                      internal (scale 1). Fractional values valid
 *                      (1.5:1 etc.) — semantic label so Claude reads
 *                      "ratio 4" as 4:1 not 4 dB.
 *   ms               — UI milliseconds, internal seconds (÷1000)
 *   degrees          — UI degrees 0–180, internal radians (÷57.2958 = ÷180/π)
 *   enum             — UI dropdown name, internal int-as-float (per-param table)
 *
 * Note: `db`, `hz`, `seconds`, `count`, `semitones`, and `ratio` all
 * pass display=internal (scale 1). They're distinct unit tags so tool
 * descriptions can label values accurately — Claude interprets "set
 * rate to 3" as 3 Hz when it sees `unit: 'hz'`, not 3 dB, and "8
 * voices" as a count rather than 8 dB. Semantic labels matter for
 * LLM correctness, even when the wire math is identical.
 */
export type Unit =
  | 'knob_0_10'
  | 'knob_0_20'
  | 'db'
  | 'hz'
  | 'seconds'
  | 'percent'
  | 'bipolar_percent'
  | 'count'
  | 'semitones'
  | 'ratio'
  | 'ms'
  | 'degrees'
  | 'pf'
  | 'rotary_mic_spacing'
  | 'amp_geq_band'
  | 'enum';

export interface Param extends ParamId {
  block: string;
  name: string;
  unit: Unit;
  displayMin: number;
  displayMax: number;
  /** For `unit: 'enum'` only — internal int → display name. */
  enumValues?: Record<number, string>;
  /**
   * How the AM4's internal stored value (the Q15-encoded normalized [0,1]
   * float we read back) maps to the display range.
   *
   * - `linear` (default): display = displayMin + internal × (displayMax − displayMin).
   * - `log10`: display = displayMin × (displayMax / displayMin) ^ internal.
   *   Used for time-based knobs (attack/release/delay) and ratio knobs that
   *   span multiple decades — the AM4 stores them on a logarithmic curve so
   *   the slider feels musical (small movements at low values, larger
   *   movements at high values).
   *
   * Empirically determined per cache record's `typecode` field; see
   * BK-038 in `04-BACKLOG.md` and `gen-params-from-cache.ts` for the
   * typecode → scaling mapping.
   */
  scaling?: 'linear' | 'log10';
  /**
   * Optional override for the unit suffix shown in get_param / get_params
   * readback strings. Default is `param.unit` verbatim. Use this when the
   * unit field's encoding scale is correct but its name is misleading
   * for the user — e.g. `negative_feedback` uses `unit: 'percent'` for
   * the encode scale (cache c=100), but the AM4 displays it as a unitless
   * 0..10 knob with no % sign. Pass an empty string to suppress the
   * suffix entirely. Does NOT affect encoding, decoding, range, or any
   * wire behavior — purely cosmetic.
   */
  displayUnit?: string;
  /**
   * The AM4-Edit on-screen label for this control (e.g. `'Scene 1 Level'`,
   * `'Mic Distance'`, `'Drive'`). Sourced from `__block_layout.xml` /
   * `__block_layout_expert.xml` inside `am4edit-resources.zip`. Surfaced
   * to the agent as a recognition synonym so user prompts that quote the
   * display label match the right param. Does NOT affect wire encoding —
   * purely a discovery hint.
   *
   * Maintained by `scripts/_research/add-display-labels.ts` (generator)
   * and verified by `scripts/_research/coverage-cross-ref-audit.ts`
   * (gated in preflight via a WIRED-MISLABEL ceiling).
   */
  displayLabel?: string;
}

const DISPLAY_TO_INTERNAL: Record<Exclude<Unit, 'enum'>, number> = {
  knob_0_10: 10,
  // HW-028 (Session 35, 2026-04-29): Compressor Emphasis at cache c=20.
  // Display range 0..20 with fractional precision (cache step 0.0005 ×
  // 20 = 0.01 display step). Same shape as knob_0_10 but with double
  // the display range — JFET Studio compressor's Drive-engine emphasis
  // knob is the canonical case.
  knob_0_20: 20,
  db: 1,
  hz: 1,
  seconds: 1,
  percent: 100,
  bipolar_percent: 100,
  count: 1,
  semitones: 1,
  ratio: 1,
  ms: 1000,
  // Cache c=57.295780... = 180/π. AM4-Edit displays Mod Phase / Phase
  // knobs in degrees; firmware stores radians. e.g. 10 deg → 0.17453 rad
  // / 90 deg → 1.5708 rad / 180 deg → 3.14159 rad.
  degrees: 57.29577951308232,
  // Session 36 (HW-040, 2026-04-29): Picofarad capacitance for amp.bright_cap.
  // Cache id=20 a=0.00001 b=0.01 c=1000000 → wire 0.00001..0.01 displays
  // as 10..10000 pF. The "Bright Cap" knob on the FAS Modern III amp's
  // IDEAL section is the canonical case.
  pf: 1000000,
  // BK-035 (Session 36 cont, 2026-04-29): rotary.mic_spacing uses a
  // π-encoded internal scale. Cache id=16 a=0 b=π c=100/π=31.831 → wire
  // 0..π displays as 0..100. Used only by `rotary.mic_spacing` so far;
  // unit name is specific to keep the math discoverable. Same structural
  // pattern as `degrees` (180/π) but maps to a 0..100 linear scale.
  rotary_mic_spacing: 31.83098793029785,
  // Session 38 follow-up (2026-04-30): amp's 8-band Graphic EQ stores
  // each band as ±1 wire, scale ×12 → display ±12 dB. Cache ids 62..69
  // share the (a=-1, b=1, c=12) signature. Distinct from `drive`'s GEQ,
  // which stores ±12 directly (cache c=1) and uses plain `db`. Naming is
  // specific because c=12 only appears on these 8 cache records across
  // the whole AM4 surface.
  amp_geq_band: 12,
};

/** Convert a UI/display value to the float the firmware expects. */
export function encode(param: Param, displayValue: number): number {
  if (param.unit === 'enum') return displayValue;
  return displayValue / DISPLAY_TO_INTERNAL[param.unit];
}

/**
 * Convert the AM4's internal [0,1] normalized float (decoded from the Q15
 * read register) back to a UI/display value.
 *
 * The AM4 stores all params in a normalized [0,1] form scaled to each
 * param's `[displayMin, displayMax]` range. Most params are linearly
 * scaled; time-based knobs (ms attack/release/delay) and ratio knobs are
 * stored on a log10 curve. Per-param scaling is encoded in `param.scaling`
 * (default `linear`).
 *
 * BK-038 (Session 43 cont, 2026-05-01): the previous decode rule was
 * `internal × DISPLAY_TO_INTERNAL[unit]`, which only happened to be
 * correct for params where `displayMin === 0` AND `displayMax ===
 * DISPLAY_TO_INTERNAL[unit]` (e.g. `knob_0_10` with range 0..10 and
 * scale 10). For most non-knob_0_10 params it produced wildly wrong
 * readbacks ("compressor.attack = 867 ms" when the device displayed
 * 40 ms). Founder-observed via the Sultans-of-Swing iconic-tone test.
 */
export function decode(param: Param, internalValue: number): number {
  if (param.unit === 'enum') return Math.round(internalValue);
  const { displayMin, displayMax } = param;
  if (param.scaling === 'log10') {
    // Guard against degenerate range / zero-or-negative endpoints.
    if (displayMin <= 0 || displayMax <= 0 || displayMax === displayMin) {
      return displayMin + internalValue * (displayMax - displayMin);
    }
    return displayMin * Math.pow(displayMax / displayMin, internalValue);
  }
  // Linear (default): display = displayMin + internal × (displayMax − displayMin).
  return displayMin + internalValue * (displayMax - displayMin);
}

/**
 * Decimal places for display values, per unit. Matches AM4-Edit's on-screen
 * convention so read tool output ("amp.gain is 5.00") doesn't surface the
 * Q15 quantization residue ("amp.gain is 4.9999"). Used by `formatDisplay`.
 */
const DISPLAY_PRECISION: Record<Exclude<Unit, 'enum'>, number> = {
  knob_0_10: 2,
  knob_0_20: 2,
  db: 1,
  hz: 0,
  seconds: 2,
  percent: 0,
  bipolar_percent: 0,
  count: 0,
  semitones: 0,
  ratio: 1,
  ms: 0,
  degrees: 0,
  pf: 0,
  rotary_mic_spacing: 1,
  amp_geq_band: 1,
};

/**
 * Format a display value for human-readable output (read tools, error
 * messages). Picks decimal precision per `param.unit` so the AM4's Q15
 * quantization residue (~0.0001 on a 0..10 knob) doesn't leak into the
 * agent's tool output. Enum params use `formatEnum` instead.
 */
export function formatDisplay(param: Param, displayValue: number): string {
  if (param.unit === 'enum') {
    throw new Error(`formatDisplay called on enum param ${param.block}.${param.name} — use enumValues lookup`);
  }
  return displayValue.toFixed(DISPLAY_PRECISION[param.unit]);
}

/**
 * Render the unit suffix for read-tool output, including the leading
 * space. Returns `' <suffix>'` (with leading space) for non-empty
 * suffixes, or empty string when the param is unitless or the override
 * suppresses it. Used by get_param / get_params to format readback
 * strings without trailing whitespace.
 */
export function formatUnitSuffix(param: Param): string {
  const suffix = param.displayUnit ?? param.unit;
  return suffix === '' ? '' : ` ${suffix}`;
}

/**
 * Resolve an enum param's display name (or numeric index) to the wire
 * integer. Accepts numbers directly, exact name matches, and a relaxed
 * case-insensitive match after collapsing whitespace and punctuation —
 * `"Marshall 1959SLP"`, `"1959slp normal"`, and `0` all resolve the
 * same entry.
 *
 * Returns `undefined` if no match is found or the param is not an enum.
 * Callers should treat that as an invalid user input.
 */
export function resolveEnumValue(param: Param, input: number | string): number | undefined {
  if (param.unit !== 'enum' || !param.enumValues) return undefined;
  if (typeof input === 'number') {
    return param.enumValues[input] !== undefined ? input : undefined;
  }
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  // Exact match first (fast path + most accurate).
  for (const [idx, name] of Object.entries(param.enumValues)) {
    if (name === trimmed) return Number(idx);
  }

  // Relaxed match: lowercase, collapse non-alphanumeric to single space.
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = normalize(trimmed);
  for (const [idx, name] of Object.entries(param.enumValues)) {
    if (normalize(name) === target) return Number(idx);
  }

  // Substring fallback: pick the entry whose normalized name contains
  // the query (or vice-versa). Only accept unambiguous matches — if
  // more than one entry qualifies, bail rather than pick arbitrarily.
  const hits: number[] = [];
  for (const [idx, name] of Object.entries(param.enumValues)) {
    const n = normalize(name);
    if (n.includes(target) || target.includes(n)) hits.push(Number(idx));
  }
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Find every enum entry that matches the input under the substring rule
 * used by `resolveEnumValue`. Returns `[indices, names]` of all hits.
 *
 * Used by the validation error path to tell the agent EXACTLY which
 * candidates a partial name like "Room" or "Plate" matched, instead of
 * the previous "first 8 valid names from offset 0" hint that listed
 * names regardless of relevance. Founder-driven (Session 44 Lamb-of-God
 * test): agent passed `reverb.type = "Room"`, hit the ambiguous-bail
 * branch, and the error sample showed Room, Small / Room, Medium /
 * Room, Large / Hall, Small / Hall, Medium … — the Hall entries were
 * noise. With this helper we can show only the matched candidates.
 */
export function findEnumCandidates(
  param: Param,
  input: string,
): Array<{ index: number; name: string }> {
  if (param.unit !== 'enum' || !param.enumValues) return [];
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const target = normalize(input.trim());
  if (target === '') return [];
  const hits: Array<{ index: number; name: string }> = [];
  for (const [idx, name] of Object.entries(param.enumValues)) {
    const n = normalize(name);
    if (n.includes(target) || target.includes(n)) {
      hits.push({ index: Number(idx), name });
    }
  }
  return hits;
}

/**
 * Common-synonym aliases for parameter names. Maps a `${block}.${alias}`
 * key to the canonical `${block}.${name}` registered in KNOWN_PARAMS.
 *
 * Why this exists. AM4-Edit / Fractal docs use specific names ("time"
 * for both reverb decay and delay repeat time, "rate" for modulation
 * LFO speed, "feedback" for delay repeats). LLM agents reach for the
 * synonyms most common in the gear world ("decay" for reverb, "speed"
 * for modulation, "repeats" for delay) and hit unknown-param errors
 * even though the registered param does the same thing. This map
 * intercepts the well-established universal synonyms before the
 * unknown-param error fires, returning the canonical name silently so
 * the agent's first call lands.
 *
 * Conservative scope. Only synonyms that are universally accepted in
 * music gear documentation (Fractal manual, Boss/Roland docs, synth
 * world). No clever mapping — if there's any ambiguity ("size" could
 * be reverb size or chamber size or amp room size), don't add the
 * alias and let the agent's first error teach it.
 *
 * Founder-driven (Session 44, 2026-05-02): Lamb-of-God Mark Morton tone
 * test had the agent reach for `reverb.decay` (universal synthesizer
 * term) and `reverb.length` (less common but plausible) — both meant
 * `reverb.time`. Aliases prevent the round-trip-and-fix cost that this
 * test had to pay.
 */
export const PARAM_ALIASES: Record<string, string> = {
  // Reverb time = decay (universal synth/reverb-pedal term).
  'reverb.decay': 'reverb.time',
  'reverb.length': 'reverb.time',
  // Delay time = length (less common but plausible from compact-pedal docs).
  'delay.length': 'delay.time',
  // Delay feedback = repeats (Strymon / Eventide convention).
  'delay.repeats': 'delay.feedback',
  // Modulation rate = speed (Boss / MXR convention).
  'chorus.speed': 'chorus.rate',
  'flanger.speed': 'flanger.rate',
  'phaser.speed': 'phaser.rate',
  'tremolo.speed': 'tremolo.rate',
  'rotary.speed': 'rotary.rate',
  // Panel-name vs AM4-name mismatches surfaced by HW-064 (2026-05-05):
  // vintage Fender amps display "Volume" on the front panel but AM4
  // calls the same knob `gain`; drive panels say "Drive" but agents
  // reach for "gain" by analogy with amp; reverb's "predelay" is
  // smashed (every other audio API uses pre_delay or preDelay).
  'amp.volume': 'amp.gain',
  'drive.gain': 'drive.drive',
  'reverb.pre_delay': 'reverb.predelay',
};

/**
 * Scene-MIDI Type enum (PATCH family, pidHigh row 0x40..0x4F).
 *
 * AM4-Edit's UI exposes only Program Change and Control Change as
 * available message types ("The available message types are Program
 * Change (PC) and Control Change (CC)" — AM4-Edit Scene MIDI page
 * help text). The wire encoding folds the CC number into the Type
 * enum itself:
 *
 *   wire 0   → 'None'        (no message — Channel/Value greyed out)
 *   wire 1   → 'PC'          (Program Change — uses Channel + Value)
 *   wire N≥2 → 'CC #(N-2)'   (Control Change with CC# = N-2)
 *
 * Wire-confirmed against samples/captured/session-85-scene-midi.pcapng
 * (Type=1.0 for PC) and the founder's AM4-Edit screenshot showing
 * "CC #016" displayed when wire Type=18.0 (16 + 2 = 18).
 *
 * Display names use AM4-Edit's exact format: `CC #016` (zero-padded to
 * 3 digits, with a space and hash). Keep parity with what the user
 * reads on screen — `resolveEnumValue` matches by display string.
 */
export const SCENE_MIDI_TYPE_ENUM: Record<number, string> = (() => {
  const out: Record<number, string> = { 0: 'None', 1: 'PC' };
  for (let cc = 0; cc <= 127; cc++) {
    out[cc + 2] = `CC #${cc.toString().padStart(3, '0')}`;
  }
  return out;
})();

/**
 * Runtime parameter registry. Hand-authored entries (manual unit/range
 * overrides, out-of-band registers like `*.channel` / `*.level`,
 * hand-authored enum mappings, etc.) are listed explicitly below.
 * Resolver-derived entries flow in via `...CACHE_PARAMS` — that spread
 * imports the bulk auto-generated bindings synthesized by
 * `scripts/gen-params-from-cache.ts` from the AM4-Edit metadata cache,
 * with friendly names from `paramNames.ts` (hand-curated) merged with
 * `paramNamesGenerated.ts` (resolver-derived from AM4-Edit.exe). Order
 * matters: hand entries below shadow any same-key spread entry, so a
 * hand override always wins. `verify-cache-params.ts` enforces that
 * any hand override that COLLIDES with a CACHE_PARAMS entry must agree
 * byte-for-byte (pidLow/pidHigh/unit/displayMin/displayMax/scaling) —
 * pure additions are unconstrained.
 */
export const KNOWN_PARAMS = {
  ...CACHE_PARAMS,
  'amp.gain': {
    block: 'amp', name: 'gain',
    displayLabel: 'Gain',
    pidLow: 0x003a, pidHigh: 0x000b,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.bass': {
    block: 'amp', name: 'bass',
    displayLabel: 'Bass',
    pidLow: 0x003a, pidHigh: 0x000c,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // P1-010 Session B (2026-04-19) — AM4 tone stack completion. Cache
  // records at ids 13/14/15 have the identical signature to gain/bass
  // (knob_0_10, 0..1 range, display-scale 10). Named per AM4 Owner's
  // Manual line 1563 "Gain, Bass, Mid, Treble, Presence, Level" and
  // the Fractal Blocks Guide tone-stack order (§Tone Page, pp. 9–10).
  // HW-014 verified (Session 29 cont 7): mid / treble / presence / bass
  // all wrote and displayed correctly on hardware.
  'amp.mid': {
    block: 'amp', name: 'mid',
    displayLabel: 'Mid',
    pidLow: 0x003a, pidHigh: 0x000d,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.treble': {
    block: 'amp', name: 'treble',
    displayLabel: 'Tone',
    pidLow: 0x003a, pidHigh: 0x000e,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // Session 29 (HW-015): `pidHigh=0x000f` was wrongly registered as
  // amp.presence in Session 26 based on cache signature alone. Two
  // wire captures on Marshall-family amps (unknown amp + Brit 800
  // #34) proved the register is Master. Real Presence is at
  // pidHigh=0x001e (below).
  'amp.master': {
    block: 'amp', name: 'master',
    displayLabel: 'Master',
    pidLow: 0x003a, pidHigh: 0x000f,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // Session 29 (HW-015): full 0→10 sweep capture confirmed Depth at
  // pidHigh=0x001a. Knob_0_10 matches the cache signature.
  'amp.depth': {
    block: 'amp', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x003a, pidHigh: 0x001a,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // Session 29 (HW-015): Presence at pidHigh=0x001e (not 0x000f — see
  // amp.master above). Wire-verified on the same Marshall amp.
  'amp.presence': {
    block: 'amp', name: 'presence',
    displayLabel: 'Presence',
    pidLow: 0x003a, pidHigh: 0x001e,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // Session 29 (HW-015): Out Boost Level on the Extras tab, dB knob
  // 0..4 dB with 0.05 dB steps.
  'amp.out_boost_level': {
    block: 'amp', name: 'out_boost_level',
    pidLow: 0x003a, pidHigh: 0x0008,
    unit: 'db', displayMin: 0, displayMax: 4,
  },
  // Session 29 (HW-015): Out Boost ON/OFF toggle on the Extras tab.
  // Registered directly in KNOWN_PARAMS (out-of-band from the cache
  // generator because per-block non-Type enum imports aren't
  // supported). Wire-verified via session-29-amp-out-boost-toggle:
  // value=1.0 → ON.
  'amp.out_boost': {
    block: 'amp', name: 'out_boost',
    displayLabel: 'Out Boost',
    pidLow: 0x003a, pidHigh: 0x0096,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  // Session 29 cont: Amp Advanced-panel enums registered from Blocks
  // Guide text (structural — wire indexing assumed from cache enum
  // order). Out-of-band from the cache generator for the same reason
  // amp.out_boost is: the generator emits only the block's Type enum,
  // not its other enum records. HW-014 couldn't verify these from
  // the hardware display alone (both labels are hidden by the AM4
  // hardware UI); AM4-Edit would show them. Structural-only until
  // an AM4-Edit-side verification pass.
  //
  // Tonestack Location (not Type — Type is a separate 69-value enum).
  // Blocks Guide: "POST places the stack between the preamp and
  // power amp. MID places it between the last two triode stages.
  // END places it after the power amp (physically impossible with
  // a real amp)." PRE-MID is the 5th option.
  'amp.tonestack_location': {
    block: 'amp', name: 'tonestack_location',
    displayLabel: 'Location',
    pidLow: 0x003a, pidHigh: 0x0018,
    unit: 'enum', displayMin: 0, displayMax: 4,
    enumValues: { 0: 'PRE', 1: 'POST', 2: 'MID', 3: 'END', 4: 'PRE-MID' },
  },
  // Master Volume Location. Blocks Guide §Advanced (p. 853):
  // "Master Vol Location — Sets the location of the Master Volume
  // control. Most amps have the Master Volume before the phase
  // inverter ('Pre PI'). On some amps (like the 'Class-A' types)
  // the Master Volume comes after the phase inverter ('PI'). A
  // third option, 'pre-triode,' is the default for 'Hipower' amp
  // types."
  'amp.master_vol_location': {
    block: 'amp', name: 'master_vol_location',
    displayLabel: 'Master Vol Location',
    pidLow: 0x003a, pidHigh: 0x0038,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'PRE-PI', 1: 'POST-PI', 2: 'PRE-TRIODE' },
  },
  // HW-040 (Session 36, 2026-04-29): Amp Expert-Edit page from
  // session-40-amp-expert.pcapng + paired AM4-Edit screenshot
  // (FAS Modern III). 17 new params across BASIC + IDEAL + POST
  // BOOST + CHANNEL COLORS + OUTPUT COMPRESSOR + AMP EXTRAS + GEQ
  // sections. Wiggle-order timeline + screenshot column order
  // disambiguates the OFF/ON switches in the IDEAL column. Mirrored
  // from CACHE_PARAMS where applicable; hand-authored enums + the
  // cache-derived block of `bright_cap` / `input_trim` / GEQ bands /
  // `compressor_*` / `master_vol_trim` / `high_treble`.
  //
  // One open follow-up: pidHigh=0x0085 (cache id=133, enum [OFF,ON],
  // wire 1 = ON) is unmapped — wiggled between Master Vol Trim and
  // GEQ Type but doesn't fit a screenshot label cleanly. Likely a
  // POST BOOST related toggle or an amp-mode flag; needs a single
  // disambiguation capture to confirm.
  'amp.bypass_mode': {
    block: 'amp', name: 'bypass_mode',
    pidLow: 0x003a, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  'amp.bright_cap': {
    block: 'amp', name: 'bright_cap',
    displayLabel: 'Bright Cap',
    pidLow: 0x003a, pidHigh: 0x0014,
    // Cache id=20: float a=0.00001 b=0.01 c=1000000 → wire 0.00001..0.01
    // displays as 10..10000 pF. New `pf` unit (scale 1000000).
    unit: 'pf', displayMin: 10, displayMax: 10000,
    // typecode 72 = log10 — HW-053 hardware-confirmed (write 220 → AM4 220 ✓; linear readback gave 4480)
    scaling: 'log10',
  },
  'amp.input_select': {
    block: 'amp', name: 'input_select',
    displayLabel: 'Amp Input Select',
    pidLow: 0x003a, pidHigh: 0x0019,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'LEFT', 1: 'RIGHT', 2: 'SUM L+R' },
  },
  'amp.section': {
    block: 'amp', name: 'section',
    displayLabel: 'Amp Section',
    pidLow: 0x003a, pidHigh: 0x0023,
    // AMP EXTRAS.Amp Section toggle.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'ENGAGED', 1: 'BYPASSED' },
  },
  'amp.bright': {
    block: 'amp', name: 'bright',
    displayLabel: 'Bright',
    pidLow: 0x003a, pidHigh: 0x002e,
    // BASIC.Bright toggle. Wiggle-order adjacency pins this between
    // Depth (0x001a) and Master (0x000f) in the BASIC column.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'amp.cut_switch': {
    block: 'amp', name: 'cut_switch',
    displayLabel: 'Cut Switch',
    pidLow: 0x003a, pidHigh: 0x0034,
    // IDEAL.Cut Switch — wiggle adjacency pins it between High Treble
    // (0x0068) and Fat Switch (0x0055) in the IDEAL column.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'amp.input_trim': {
    block: 'amp', name: 'input_trim',
    displayLabel: 'Input Trim',
    pidLow: 0x003a, pidHigh: 0x0036,
    // Cache id=54: float a=0.1 b=10 c=1 raw 0.1..10. Same shape as
    // master_vol_trim; `count` here is structural (display = wire ×
    // 1) not integer-only.
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
  },
  // 8-band Graphic EQ — frequencies per the screenshot: 62/125/250/
  // 500/1K/2K/4K/8K Hz, each ±12 dB. Cache ids 62..69 share the
  // (a=-1, b=1, c=12) signature: wire stored as ±1, displayed as ±12 dB.
  // Uses the `amp_geq_band` unit (scale 12). Drive's GEQ uses plain `db`
  // because its cache stores ±12 directly (c=1).
  'amp.geq_band_1': { block: 'amp', name: 'geq_band_1', displayLabel: 'Bass', pidLow: 0x003a, pidHigh: 0x003e, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_2': { block: 'amp', name: 'geq_band_2', displayLabel: 'Mid', pidLow: 0x003a, pidHigh: 0x003f, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_3': { block: 'amp', name: 'geq_band_3', displayLabel: 'Treble', pidLow: 0x003a, pidHigh: 0x0040, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_4': { block: 'amp', name: 'geq_band_4', displayLabel: 'Presence', pidLow: 0x003a, pidHigh: 0x0041, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_5': { block: 'amp', name: 'geq_band_5', displayLabel: '1K', pidLow: 0x003a, pidHigh: 0x0042, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_6': { block: 'amp', name: 'geq_band_6', displayLabel: '2K', pidLow: 0x003a, pidHigh: 0x0043, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_7': { block: 'amp', name: 'geq_band_7', displayLabel: '4K', pidLow: 0x003a, pidHigh: 0x0044, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.geq_band_8': { block: 'amp', name: 'geq_band_8', displayLabel: '8K', pidLow: 0x003a, pidHigh: 0x0045, unit: 'amp_geq_band', displayMin: -12, displayMax: 12 },
  'amp.compressor_clarity': {
    block: 'amp', name: 'compressor_clarity',
    displayLabel: 'Clarity',
    pidLow: 0x003a, pidHigh: 0x004d,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
    // typecode 80 = log10 (HW-053 cont). displayMin=0 makes log10
    // fall back to linear at runtime; declared anyway to match the
    // cache-derived scaling and keep verify-cache-params byte-exact.
    scaling: 'log10',
  },
  'amp.compressor_amount': {
    block: 'amp', name: 'compressor_amount',
    displayLabel: 'Amount',
    pidLow: 0x003a, pidHigh: 0x0052,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.compressor_threshold': {
    block: 'amp', name: 'compressor_threshold',
    displayLabel: 'Threshold',
    pidLow: 0x003a, pidHigh: 0x0053,
    unit: 'db', displayMin: -60, displayMax: 0,
  },
  'amp.master_vol_trim': {
    block: 'amp', name: 'master_vol_trim',
    displayLabel: 'Master Vol Trim',
    pidLow: 0x003a, pidHigh: 0x0054,
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
    // HW-054 readback surfaced "7 count" — misleading. AM4 displays
    // this as a unitless 0..10 knob; the `count` unit tag is
    // structural (encode scale 1, cache c=1). Suppress the suffix.
    displayUnit: '',
  },
  'amp.fat_switch': {
    block: 'amp', name: 'fat_switch',
    displayLabel: 'Fat',
    pidLow: 0x003a, pidHigh: 0x0055,
    // IDEAL.Fat Switch — wiggle adjacency pins it right after Cut
    // Switch (0x0034) in the IDEAL column.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'amp.geq_type': {
    block: 'amp', name: 'geq_type',
    displayLabel: 'Type',
    pidLow: 0x003a, pidHigh: 0x0063,
    // Cache id=99: 4-entry enum.
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: '8 BAND VAR Q', 1: '7 BAND VAR Q', 2: '5 BAND (MARK)', 3: '8 BAND CONST Q' },
  },
  'amp.high_treble': {
    block: 'amp', name: 'high_treble',
    displayLabel: 'High Treble',
    pidLow: 0x003a, pidHigh: 0x0068,
    // IDEAL.High Treble — bipolar dB ±12 at cache id=104.
    unit: 'db', displayMin: -12, displayMax: 12,
  },
  'amp.compressor_type': {
    block: 'amp', name: 'compressor_type',
    displayLabel: 'Type',
    pidLow: 0x003a, pidHigh: 0x0074,
    // Cache id=116: 3-entry enum.
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'OUTPUT', 1: 'FEEDBACK', 2: 'GAIN ENHANCER' },
  },
  'amp.output_mode': {
    block: 'amp', name: 'output_mode',
    displayLabel: 'Amp Output Mode',
    pidLow: 0x003a, pidHigh: 0x0083,
    // Cache id=131: 2-entry enum.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'FRFR', 1: 'SS PWR AMP + CAB' },
  },
  // HW-024 (Session 30 cont 3, 2026-04-25): hardware-verified at
  // +8 dB on a 1959SLP Normal — first non-default positive-value
  // datapoint for amp.level (HW-014 only tested at the default).
  'amp.level': {
    block: 'amp', name: 'level',
    pidLow: 0x003a, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'amp.channel': {
    block: 'amp', name: 'channel',
    pidLow: 0x003a, pidHigh: 0x07d2,
    unit: 'enum', displayMin: 0, displayMax: 3,
    // Session 08: A→B→A and A→C→D→A captures confirmed all 4 indices.
    enumValues: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' },
  },
  'amp.type': {
    block: 'amp', name: 'type',
    pidLow: 0x003a, pidHigh: 0x000a,
    // Session 16: enum dictionary imported from cacheEnums.ts (248 models).
    // Wire indexing verified via drive.type ground truth; amp.type index
    // 0 in cache is "1959SLP Normal". Untested against capture — flag as
    // such when hardening.
    unit: 'enum', displayMin: 0, displayMax: 247,
    enumValues: AMP_TYPES_VALUES,
  },

  // ─── HW-041 (Session 41+, 2026-04-30): Amp Expert-Edit page (4 tabs) ───
  // Source: session-41-amp-{preamp,poweramp,cabinet,speaker}-expert.{pcapng,png}
  // + founder-confirmed audit-input JSONs at docs/audit-input/amp-*.json.
  // Audit script output: docs/audit-output/amp-*.md.
  //
  // The amp Expert page surfaces ~120 knobs across Preamp / Power Amp /
  // Cabinet / Speaker tabs — far more than the 16 BASIC params already
  // registered. Cabinet knobs use a SEPARATE block ID (pidLow=0x003e),
  // not the amp pidLow=0x003a; preamp/power-amp/speaker share 0x003a.
  // Block prefix is kept as `amp` since AM4 surfaces all four tabs as
  // one user-facing block, even though the protocol splits cabinet out.
  //
  // Naming: knobs are keyed by their AM4-Edit label, snake-cased, with
  // disambiguating prefixes where labels collide between sections (e.g.
  // `power_tube_hardness` vs preamp `tube_hardness`, `pi_bias_excursion`
  // vs `master_bias_excursion`, speaker `spkr_compression` vs the
  // amp Compressor section's `compressor_amount`/`compressor_clarity`).
  //
  // Verification: ⚠ unregistered rows from the audit table where the
  // wire×scale match was uniquely-on-the-label-side OR where ambiguity
  // was resolved by domain reasoning (scale plausibility + screenshot
  // section position). Ambiguous rows where neither candidate label is
  // unique on the label side were skipped — those need a follow-up
  // capture wiggling one of the colliding knobs in isolation.
  //
  // Skipped from audit (need follow-up):
  //   • Preamp 0x0082 (Input EQ Low Cut duplicate at scale ×10)
  //   • Power Amp 0x005d / 0x0090 (Cathode Resistance vs Master Bias
  //     Excursion duplicates at wire=1.0)
  //   • Power Amp 0x0026 / 0x0064 / 0x008d / 0x0093 (no screenshot match)
  //   • Cabinet 0x001c (Cab 1 Low Cut needs different scale than
  //     master_low_cut — likely log-Hz storage; skipped pending decode)
  //   • Cabinet 0x0045 / 0x0046 (Cab 1/2 Position — bipolar -10..10
  //     range needs new unit, no existing fit)
  //   • Cabinet 0x0024 / 0x002c / 0x0030 / 0x0031 (LF/HF Damping —
  //     three pidHighs share value 8.0, can't disambiguate)
  //   • Cabinet 0x0011 + 0x0016 + 0x0017 + many wire=1.0 rows (no
  //     screenshot match or false-positive ×10 scale matches)
  //   • Speaker 0x0022 / 0x0033 / 0x0039 / 0x0048 / 0x0087 / 0x008e /
  //     0x0092 (Low/Hi Reso, Drive, others not wiggled or scale TBD)
  //
  // ── Preamp tab (pidLow=0x003a) ──
  'amp.in_boost_level': {
    block: 'amp', name: 'in_boost_level',
    displayLabel: 'In Boost Level',
    pidLow: 0x003a, pidHigh: 0x0081,
    // Preamp.Input Boost section. Screenshot 1.11 dB (no unit visible
    // but Boost knobs are conventionally dB on Fractal).
    unit: 'db', displayMin: 0, displayMax: 20,
  },
  'amp.saturation_drive': {
    block: 'amp', name: 'saturation_drive',
    displayLabel: 'Saturation Drive',
    pidLow: 0x003a, pidHigh: 0x0070,
    // Preamp.Saturation Mod.Saturation Drive. Screenshot 2.220, no
    // visible unit on AM4-Edit panel; treated as raw count.
    unit: 'count', displayMin: 0, displayMax: 10,
  },
  'amp.tonestack_frequency': {
    block: 'amp', name: 'tonestack_frequency',
    displayLabel: 'Frequency',
    pidLow: 0x003a, pidHigh: 0x0012,
    // Preamp.Tonestack.Frequency. Screenshot 333.0 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.tube_hardness': {
    block: 'amp', name: 'tube_hardness',
    displayLabel: 'Tube Hardness',
    pidLow: 0x003a, pidHigh: 0x0037,
    // Preamp.Preamp.Tube Hardness — knob_0_10 (wire 0.444 → display 4.44).
    // Distinct from amp.power_tube_hardness on the Power Amp tab.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.triode_1_plate_freq': {
    block: 'amp', name: 'triode_1_plate_freq',
    displayLabel: 'Triode 1 Plate Freq',
    pidLow: 0x003a, pidHigh: 0x004a,
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.triode_2_plate_freq': {
    block: 'amp', name: 'triode_2_plate_freq',
    displayLabel: 'Triode 2 Plate Freq',
    pidLow: 0x003a, pidHigh: 0x0049,
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.preamp_bias': {
    block: 'amp', name: 'preamp_bias',
    displayLabel: 'Preamp Bias',
    pidLow: 0x003a, pidHigh: 0x0031,
    // Screenshot -0.700 raw — bipolar count.
    unit: 'count', displayMin: -1, displayMax: 1,
  },
  'amp.preamp_bias_excursion': {
    block: 'amp', name: 'preamp_bias_excursion',
    displayLabel: 'Bias Excursion',
    pidLow: 0x003a, pidHigh: 0x0071,
    // Preamp.Preamp.Bias Excursion — percent (wire 0.080 → display 8.0%).
    // Distinct from amp.power_tube_bias_excursion / amp.pi_bias_excursion
    // / amp.master_bias_excursion on the Power Amp tab.
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.preamp_high_cut_freq': {
    block: 'amp', name: 'preamp_high_cut_freq',
    displayLabel: 'High Cut Frequency',
    pidLow: 0x003a, pidHigh: 0x0011,
    // Preamp.Preamp.High Cut Frequency — bottom row of the PREAMP
    // section. Screenshot 9999.1 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.input_eq_low_cut': {
    block: 'amp', name: 'input_eq_low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x003a, pidHigh: 0x0010,
    // Preamp.Input EQ.Low Cut. Screenshot 130.0 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.input_eq_gain': {
    block: 'amp', name: 'input_eq_gain',
    displayLabel: 'Gain',
    pidLow: 0x003a, pidHigh: 0x0050,
    // Preamp.Input EQ.Gain. Screenshot 11.00 dB raw.
    unit: 'db', displayMin: -20, displayMax: 20,
  },
  'amp.input_eq_q': {
    block: 'amp', name: 'input_eq_q',
    displayLabel: 'Q',
    pidLow: 0x003a, pidHigh: 0x004e,
    // Preamp.Input EQ.Q. Screenshot 0.120 raw count.
    unit: 'count', displayMin: 0.1, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },

  // ── Power Amp tab (pidLow=0x003a) ──
  'amp.supply_sag': {
    block: 'amp', name: 'supply_sag',
    displayLabel: 'Supply Sag',
    pidLow: 0x003a, pidHigh: 0x001d,
    // Power Amp.Power Supply.Supply Sag. Screenshot 2.20 (knob_0_10:
    // wire 0.220 → display 2.20). Disambiguated from Power Tubes Hardness
    // (which sits at 0x005f wire=0.700 → display 7.00).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.negative_feedback': {
    block: 'amp', name: 'negative_feedback',
    displayLabel: 'Negative FB',
    pidLow: 0x003a, pidHigh: 0x001f,
    // Power Amp.Power Amp.Negative Feedback. Screenshot 4.44 — percent
    // ×100 (wire 0.0444 → 4.44%). NFB display has no visible unit on
    // AM4-Edit; ×100 scale fits the captured wire cleanly.
    unit: 'percent', displayMin: 0, displayMax: 10,
    // HW-054 readback surfaced "5 percent" — misleading. AM4 actually
    // displays NFB as a unitless 0..10 knob; the `percent` unit is
    // for encode-scale only (cache c=100). Suppress the suffix.
    displayUnit: '',
    // HW-053b cont audit: HW-053: cache b*c = 10, not 100. Hand entry was off by 10×; readback came out 50 instead of 5.
  },
  'amp.presence_freq': {
    block: 'amp', name: 'presence_freq',
    displayLabel: 'Presence Freq',
    pidLow: 0x003a, pidHigh: 0x0020,
    // HW-053 (2026-05-04): cache record at id=32 has a=0.1, b=10, c=1.
    // The original HW-040 screenshot read "6.660 Hz raw" but the AM4
    // device actually displays the value as 0.1..10 (kHz on the device,
    // shown without explicit unit suffix). Earlier registration of
    // displayMin=20 displayMax=20000 was off by ~1000× and saturated
    // every write. Range corrected to match the cache truth; unit kept
    // as 'hz' so agent reads it as a frequency knob (the agent should
    // pass values in the 0.1..10 range, which AM4-Edit renders as kHz).
    unit: 'hz', displayMin: 0.1, displayMax: 10,
    // HW-054 readback surfaced "3 hz" — agent then mentally translated
    // to kHz, awkward. Override the suffix to 'kHz' so the readback
    // matches the user's mental model. Encoding is unaffected.
    displayUnit: 'kHz',
    // typecode 64 = log10 (HW-053 confirmed: write 3 → AM4 3.000 ✓ but readback was 7 with linear decode)
    scaling: 'log10',
  },
  'amp.depth_freq': {
    block: 'amp', name: 'depth_freq',
    displayLabel: 'Depth Freq',
    pidLow: 0x003a, pidHigh: 0x0024,
    // HW-053 (2026-05-04): cache record at id=36 has a=50, b=500, c=1.
    // Same screenshot-misread pattern as presence_freq. Range corrected
    // to the cache truth (50..500 Hz, real Hz this time).
    unit: 'hz', displayMin: 50, displayMax: 500,
  },
  'amp.cathode_follower_harmonics': {
    block: 'amp', name: 'cathode_follower_harmonics',
    displayLabel: 'Harmonics',
    pidLow: 0x003a, pidHigh: 0x0028,
    // Power Amp.Cathode Follower.Harmonics. Screenshot 0.150 Hz —
    // raw value (label says "Hz" but the magnitude reads as a 0..1
    // ratio, likely a normalised knob despite the unit suffix).
    unit: 'count', displayMin: 0, displayMax: 1,
  },
  'amp.b_plus_time_constant': {
    block: 'amp', name: 'b_plus_time_constant',
    displayLabel: 'B+ Time Constant',
    pidLow: 0x003a, pidHigh: 0x002a,
    // Power Amp.Power Supply.B+ Time Constant. Screenshot 9.50 ms
    // (wire 0.0095 ×1000 = 9.5).
    unit: 'ms', displayMin: 0.1, displayMax: 1000,
    // typecode 68 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.grid_bias': {
    block: 'amp', name: 'grid_bias',
    displayLabel: 'Grid Bias',
    pidLow: 0x003a, pidHigh: 0x002b,
    // Power Amp.Power Tubes.Grid Bias. Screenshot 16.0 % (wire 0.160).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.xformer_drive': {
    block: 'amp', name: 'xformer_drive',
    displayLabel: 'XFormer Drive',
    pidLow: 0x003a, pidHigh: 0x0035,
    // Power Amp.Transformer.XFormer Drive. Screenshot 0.120 raw count.
    unit: 'count', displayMin: 0, displayMax: 1,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.xformer_matching': {
    block: 'amp', name: 'xformer_matching',
    displayLabel: 'XFormer Matching',
    pidLow: 0x003a, pidHigh: 0x003a,
    // Power Amp.Transformer.XFormer Matching. Screenshot 1.300 raw.
    unit: 'count', displayMin: 0.1, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.screen_frequency': {
    block: 'amp', name: 'screen_frequency',
    displayLabel: 'Screen Frequency',
    pidLow: 0x003a, pidHigh: 0x003b,
    // HW-053 (2026-05-04): cache record at id=59 has a=1, b=100, c=1.
    // The AM4 device displays this as a unitless 0..100 raw knob (the
    // founder confirmed "no units on device for Screen Frequency"). The
    // earlier "Hz" registration was a screenshot misread. Despite the
    // parameterName ending in "FREQ", the firmware exposes it as a raw
    // power-supply knob without a frequency unit on the device UI.
    unit: 'count', displayMin: 1, displayMax: 100,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.screen_q': {
    block: 'amp', name: 'screen_q',
    displayLabel: 'Screen Q',
    pidLow: 0x003a, pidHigh: 0x003c,
    // Power Amp.Power Supply.Screen Q. Screenshot 8.500 raw count.
    unit: 'count', displayMin: 0.1, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.power_tube_bias_excursion': {
    block: 'amp', name: 'power_tube_bias_excursion',
    displayLabel: 'Bias Excursion',
    pidLow: 0x003a, pidHigh: 0x0046,
    // Power Amp.Power Tubes.Bias Excursion. Screenshot 19.0 %.
    // Distinct from preamp_bias_excursion / pi_bias_excursion /
    // master_bias_excursion (4 separate "bias excursion" knobs).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.cathode_follower_compression': {
    block: 'amp', name: 'cathode_follower_compression',
    displayLabel: 'Power Tube Type',
    pidLow: 0x003a, pidHigh: 0x004b,
    // Power Amp.Cathode Follower.Compression. Screenshot 14.0 %.
    // Stored raw (wire 14.0 → display 14.0%) NOT as percent ×100,
    // confirmed by scale ×1 match in audit. Treat unit as 'count'
    // even though display suffix is %.
    unit: 'count', displayMin: 0, displayMax: 100,
  },
  'amp.ac_line_frequency': {
    block: 'amp', name: 'ac_line_frequency',
    displayLabel: 'AC Line Frequency',
    pidLow: 0x003a, pidHigh: 0x005e,
    // Power Amp.Power Supply.AC Line Frequency. Screenshot 65 Hz raw.
    // Typical range 50/60 Hz mains; AM4-Edit allows wider sweep.
    unit: 'hz', displayMin: 30, displayMax: 200,
  },
  'amp.power_tube_hardness': {
    block: 'amp', name: 'power_tube_hardness',
    displayLabel: 'Hardness',
    pidLow: 0x003a, pidHigh: 0x005f,
    // Power Amp.Power Tubes.Hardness. Screenshot 7.00 (knob_0_10).
    // Distinct from preamp tube_hardness (separate knob, separate
    // wire address).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
    // typecode 80 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.cathode_time_const': {
    block: 'amp', name: 'cathode_time_const',
    displayLabel: 'Cathode Time Const',
    pidLow: 0x003a, pidHigh: 0x0065,
    // Power Amp.Power Amp.Cathode Time Const. Screenshot 10.00 ms
    // (wire 0.010 ×1000 = 10).
    unit: 'ms', displayMin: 0.1, displayMax: 1000,
    // typecode 68 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.mismatch': {
    block: 'amp', name: 'mismatch',
    displayLabel: 'Mismatch',
    pidLow: 0x003a, pidHigh: 0x0069,
    // Power Amp.Power Tubes.Mismatch. Screenshot 0.180 raw count.
    unit: 'count', displayMin: 0, displayMax: 1,
  },
  'amp.variac': {
    block: 'amp', name: 'variac',
    displayLabel: 'Variac',
    pidLow: 0x003a, pidHigh: 0x006c,
    // Power Amp.Power Supply.Variac. Screenshot 55.0 % (wire 0.550 ×100).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.pi_bias_excursion': {
    block: 'amp', name: 'pi_bias_excursion',
    displayLabel: 'PI Bias Excursion',
    pidLow: 0x003a, pidHigh: 0x0079,
    // Power Amp.Power Amp.PI Bias Excursion (phase-inverter).
    // Screenshot 11.0 % (wire 0.110 ×100).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.master_bias_excursion': {
    block: 'amp', name: 'master_bias_excursion',
    displayLabel: 'Master Bias Excursion',
    pidLow: 0x003a, pidHigh: 0x008b,
    // Power Amp.Power Tubes.Master Bias Excursion. Screenshot 20.0 %.
    unit: 'percent', displayMin: 0, displayMax: 100,
  },

  // ── Speaker tab (pidLow=0x003a) ──
  // Section breakdown: Impedance (top half — XFormer / Low / Hi knobs +
  // a frequency-response curve) and Speaker (bottom — speaker-emulation
  // character knobs).
  'amp.xformer_low_freq': {
    block: 'amp', name: 'xformer_low_freq',
    displayLabel: 'XFormer Low Freq',
    pidLow: 0x003a, pidHigh: 0x0016,
    // Speaker.Impedance.XFormer Low Freq. Screenshot 33.3 Hz (wire stores
    // 33.33; AM4-Edit display rounds to 1 decimal).
    unit: 'hz', displayMin: 10, displayMax: 20000,
  },
  'amp.low_freq': {
    block: 'amp', name: 'low_freq',
    displayLabel: 'Low Freq',
    pidLow: 0x003a, pidHigh: 0x0021,
    // Speaker.Impedance.Low Freq. Screenshot 44.4 Hz (wire 44.44).
    unit: 'hz', displayMin: 10, displayMax: 20000,
  },
  'amp.low_q': {
    block: 'amp', name: 'low_q',
    displayLabel: 'Low Q',
    pidLow: 0x003a, pidHigh: 0x0030,
    // Speaker.Impedance.Low Q. Screenshot 0.666 raw count.
    unit: 'count', displayMin: 0.1, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.xformer_hi_freq': {
    block: 'amp', name: 'xformer_hi_freq',
    displayLabel: 'XFormer Hi Freq',
    pidLow: 0x003a, pidHigh: 0x0017,
    // Speaker.Impedance.XFormer Hi Freq. Screenshot 12000 Hz raw.
    unit: 'hz', displayMin: 100, displayMax: 20000,
  },
  'amp.high_freq': {
    block: 'amp', name: 'high_freq',
    displayLabel: 'High Freq',
    pidLow: 0x003a, pidHigh: 0x0032,
    // Speaker.Impedance.High Freq. Screenshot 666.0 Hz raw.
    unit: 'hz', displayMin: 100, displayMax: 20000,
  },
  'amp.hi_slope': {
    block: 'amp', name: 'hi_slope',
    displayLabel: 'Hi Slope',
    pidLow: 0x003a, pidHigh: 0x006b,
    // Speaker.Impedance.Hi Slope. Screenshot 8.880 (knob_0_10:
    // wire 0.888 ×10 = 8.88). Disambiguated from Speaker.Compression
    // (also wire 0.888) by section-position heuristic — Hi Slope is
    // higher in the AM4-Edit UI (Impedance > Speaker), and 0x006b
    // sits before 0x007a in pidHigh order.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.cab_resonance': {
    block: 'amp', name: 'cab_resonance',
    displayLabel: 'Cab Resonance',
    pidLow: 0x003a, pidHigh: 0x0088,
    // Speaker.Impedance.Cab Resonance. Screenshot 111.1 % (wire 1.111
    // ×100). Display can exceed 100% — set displayMax wider.
    unit: 'percent', displayMin: 0, displayMax: 200,
  },
  'amp.speaker_impedance': {
    block: 'amp', name: 'speaker_impedance',
    displayLabel: 'Speaker Impedance',
    pidLow: 0x003a, pidHigh: 0x0086,
    // Speaker.Impedance.Speaker Impedance. Screenshot 1.220 raw count.
    unit: 'count', displayMin: 0.1, displayMax: 10,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.spkr_compression': {
    block: 'amp', name: 'spkr_compression',
    displayLabel: 'Compression',
    pidLow: 0x003a, pidHigh: 0x007a,
    // Speaker.Speaker.Compression. Screenshot 8.88 (knob_0_10).
    // Named with `spkr_` prefix to distinguish from the Compressor
    // section's `compressor_amount` / `compressor_clarity` etc.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.compliance': {
    block: 'amp', name: 'compliance',
    displayLabel: 'Compliance',
    pidLow: 0x003a, pidHigh: 0x0084,
    // Speaker.Speaker.Compliance. Screenshot 99.0 % (wire 0.990).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.spkr_time_constant': {
    block: 'amp', name: 'spkr_time_constant',
    displayLabel: 'Time Constant',
    pidLow: 0x003a, pidHigh: 0x007b,
    // Speaker.Speaker.Time Constant. Screenshot 1000.0 ms (wire 1.000
    // ×1000). `spkr_` prefix to avoid confusion with cathode_time_const
    // on the Power Amp tab.
    unit: 'ms', displayMin: 0.1, displayMax: 10000,
    // typecode 68 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.thump': {
    block: 'amp', name: 'thump',
    displayLabel: 'Thump',
    pidLow: 0x003a, pidHigh: 0x008f,
    // Speaker.Speaker.Thump. Screenshot 1.11 (knob_0_10).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },

  // ── Cabinet tab (pidLow=0x003e — separate block ID from amp 0x003a) ──
  'amp.cab1_distance': {
    block: 'amp', name: 'cab1_distance',
    pidLow: 0x003e, pidHigh: 0x0002,
    // Cabinet.Cab 1.Distance. Screenshot 2.22 cm (wire 0.022 ×100).
    // Display unit on AM4-Edit is "cm"; firmware stores cm/100.
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.cab_mic_preamp_drive': {
    block: 'amp', name: 'cab_mic_preamp_drive',
    displayLabel: 'Drive',
    pidLow: 0x003e, pidHigh: 0x001a,
    // Cabinet.Cab Mic Preamp.Drive. Screenshot 6.60 (knob_0_10).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.cab_mic_preamp_saturation': {
    block: 'amp', name: 'cab_mic_preamp_saturation',
    displayLabel: 'Saturation',
    pidLow: 0x003e, pidHigh: 0x001b,
    // Cabinet.Cab Mic Preamp.Saturation. Screenshot 7.77 (knob_0_10).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.cab_mic_preamp_treble': {
    block: 'amp', name: 'cab_mic_preamp_treble',
    displayLabel: 'Treble',
    pidLow: 0x003e, pidHigh: 0x0027,
    // Cabinet.Cab Mic Preamp.Treble. Screenshot 10.00 dB raw.
    // (Many wire=1.0 rows in the audit also matched this label via the
    // ×10 scale — those are false positives; the canonical pidHigh
    // is 0x0027 with wire=10.0 raw.)
    unit: 'db', displayMin: -20, displayMax: 20,
  },
  'amp.room_size': {
    block: 'amp', name: 'room_size',
    displayLabel: 'Room Size',
    pidLow: 0x003e, pidHigh: 0x001d,
    // Cabinet.Room.Room Size. Screenshot 5.55 m raw count.
    unit: 'count', displayMin: 0.1, displayMax: 50,
  },
  'amp.mic_spacing': {
    block: 'amp', name: 'mic_spacing',
    displayLabel: 'Mic Spacing',
    pidLow: 0x003e, pidHigh: 0x001e,
    // Cabinet.Room.Mic Spacing. Screenshot 10.1 % (wire 0.101 ×100).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.cab_master_high_cut': {
    block: 'amp', name: 'cab_master_high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x003e, pidHigh: 0x0020,
    // Cabinet.Cab Master EQ.Master High Cut. Screenshot 222 Hz
    // (founder-confirmed deliberate non-default value).
    unit: 'hz', displayMin: 20, displayMax: 20000,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.cab_master_low_cut': {
    block: 'amp', name: 'cab_master_low_cut',
    displayLabel: 'Proximity Frequency',
    pidLow: 0x003e, pidHigh: 0x0022,
    // Cabinet.Cab Master EQ.Master Low Cut. Screenshot 33.3 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.cab_master_level': {
    block: 'amp', name: 'cab_master_level',
    displayLabel: 'Air',
    pidLow: 0x003e, pidHigh: 0x002d,
    // Cabinet.Cab Extras.Cab Master Level. Screenshot 1.1 dB
    // (wire 0.110 ×10 = 1.10). Stored as knob_0_10 even though the
    // display suffix is dB.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.air_frequency': {
    block: 'amp', name: 'air_frequency',
    displayLabel: 'Frequency',
    pidLow: 0x003e, pidHigh: 0x002e,
    // Cabinet.Air.Frequency. Screenshot 12121 Hz raw.
    unit: 'hz', displayMin: 100, displayMax: 20000,
  },
  'amp.room_diffusion': {
    block: 'amp', name: 'room_diffusion',
    displayLabel: 'Room Diffusion',
    pidLow: 0x003e, pidHigh: 0x0032,
    // Cabinet.Room.Room Diffusion. Screenshot 7.0 % (wire 0.070).
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.cab2_low_cut': {
    block: 'amp', name: 'cab2_low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x003e, pidHigh: 0x0036,
    // Cabinet.Cab 2.Low Cut. Screenshot 55.0 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
    // typecode 64 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'amp.cab1_high_cut': {
    block: 'amp', name: 'cab1_high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x003e, pidHigh: 0x0037,
    // Cabinet.Cab 1.High Cut. Screenshot 5500.0 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.cab2_high_cut': {
    block: 'amp', name: 'cab2_high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x003e, pidHigh: 0x0038,
    // Cabinet.Cab 2.High Cut. Screenshot 4444.1 Hz raw.
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  'amp.align_distance_1': {
    block: 'amp', name: 'align_distance_1',
    displayLabel: 'Mic Distance',
    pidLow: 0x003e, pidHigh: 0x0012,
    // Cabinet.Align modal.Distance 1. Screenshot 5.000 ms
    // (wire 0.005 ×1000). Distinct delay-trim knob from Cab 1 Distance.
    unit: 'ms', displayMin: 0, displayMax: 100,
  },
  'amp.align_distance_2': {
    block: 'amp', name: 'align_distance_2',
    displayLabel: 'Mic Distance',
    pidLow: 0x003e, pidHigh: 0x0013,
    // Cabinet.Align modal.Distance 2. Screenshot 6.000 ms.
    unit: 'ms', displayMin: 0, displayMax: 100,
  },

  // Session 89 (2026-05-16) — DISTORT UI-MISSING closeout. 16 new amp
  // params mirrored from CACHE_PARAMS so the coverage-audit (which
  // text-greps params.ts) sees them. Wire bytes + units come from
  // paramNames.ts overrides; cacheParams.ts emits the canonical entries
  // and verify-cache-params guards byte-for-byte agreement. displayLabel
  // = AM4-Edit XML "name=" attribute for the same EditorControl. See
  // samples/captured/decoded/am4-params-proposed.ts for the Ghidra
  // catalog source (Sessions 82–83) and cache-section2.json for the
  // signature data that pinned each unit + range.
  'amp.low_reso': {
    block: 'amp', name: 'low_reso',
    displayLabel: 'Low Reso',
    pidLow: 0x003a, pidHigh: 0x0022,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.master_vol_cap': {
    block: 'amp', name: 'master_vol_cap',
    displayLabel: 'Master Vol Cap',
    pidLow: 0x003a, pidHigh: 0x0026,
    // Cache typecode=72 → log10 storage (sibling to amp.bright_cap at
    // id=20). Capacitance scaling in pF.
    unit: 'pf', displayMin: 1, displayMax: 1000,
    scaling: 'log10',
  },
  'amp.hi_reso': {
    block: 'amp', name: 'hi_reso',
    displayLabel: 'Hi Reso',
    pidLow: 0x003a, pidHigh: 0x0033,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.spkr_drive': {
    block: 'amp', name: 'spkr_drive',
    displayLabel: 'Drive',
    pidLow: 0x003a, pidHigh: 0x0039,
    // Speaker-stage drive knob (catalog: DISTORT_SPKRDRIVE). Renamed
    // from the resolver's bare 'drive' to disambiguate against
    // drive.drive in the separate Drive block.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.input_eq_frequency': {
    block: 'amp', name: 'input_eq_frequency',
    displayLabel: 'Frequency',
    pidLow: 0x003a, pidHigh: 0x004f,
    // Input-EQ peaking frequency. Renamed from the resolver's bare
    // 'frequency' to mirror the existing input_eq_q / input_eq_gain /
    // input_eq_low_cut family on the same UI page.
    unit: 'hz', displayMin: 100, displayMax: 10000,
  },
  'amp.overdrive': {
    block: 'amp', name: 'overdrive',
    displayLabel: 'Normal Gain',
    pidLow: 0x003a, pidHigh: 0x0051,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.definition': {
    block: 'amp', name: 'definition',
    displayLabel: 'Definition',
    pidLow: 0x003a, pidHigh: 0x0056,
    // Cache c=31.62299 (≈10/√10) → bipolar power-amp definition knob
    // displayed -10..+10 on the front panel. Uses 'count' rather than
    // bipolar_percent because front panel reads -10.0..+10.0, not ±100%.
    unit: 'count', displayMin: -10, displayMax: 10,
  },
  'amp.compression': {
    block: 'amp', name: 'compression',
    displayLabel: 'Compression',
    pidLow: 0x003a, pidHigh: 0x0057,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.high_cut': {
    block: 'amp', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x003a, pidHigh: 0x005a,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'amp.cathode_resistance': {
    block: 'amp', name: 'cathode_resistance',
    displayLabel: 'Cathode Resistance',
    pidLow: 0x003a, pidHigh: 0x0064,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'amp.b_plus_monitor': {
    block: 'amp', name: 'b_plus_monitor',
    displayLabel: 'B+',
    pidLow: 0x003a, pidHigh: 0x007d,
    // Read-only B+ voltage monitor (front-panel meter, not a knob).
    // Cache type=0 a=0 b=1 c=1 → raw 0..1 float; display as count.
    unit: 'count', displayMin: 0, displayMax: 1,
  },
  'amp.gain_monitor': {
    block: 'amp', name: 'gain_monitor',
    displayLabel: 'Gain',
    pidLow: 0x003a, pidHigh: 0x007e,
    // Read-only gain monitor. Sibling to b_plus_monitor / headroom_monitor.
    unit: 'count', displayMin: 0, displayMax: 1,
  },
  'amp.headroom_monitor': {
    block: 'amp', name: 'headroom_monitor',
    displayLabel: 'HEADROOM',
    pidLow: 0x003a, pidHigh: 0x0089,
    // Read-only plate-voltage headroom monitor.
    unit: 'count', displayMin: 0, displayMax: 1,
  },
  'amp.presence_prepresence': {
    block: 'amp', name: 'presence_prepresence',
    displayLabel: 'Treble',
    pidLow: 0x003a, pidHigh: 0x008a,
    // Preamp-stage presence shaper. AM4-Edit XML labels this "Treble"
    // on some amps; catalog name is DISTORT_PREPRESENCE. Name keeps
    // the resolver's dedupe suffix since amp.presence (id=30) is the
    // post-amp presence knob.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.pa_high_cut': {
    block: 'amp', name: 'pa_high_cut',
    displayLabel: 'Tone',
    pidLow: 0x003a, pidHigh: 0x008c,
    // Power-amp high-cut shaper. AM4-Edit labels "Tone" but catalog
    // is DISTORT_PAHICUT; renamed from resolver's 'high_cut_pahicut'
    // to surface the family (pa_ prefix mirrors the rest of the
    // power-amp stage knobs).
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'amp.overdrive_volume': {
    block: 'amp', name: 'overdrive_volume',
    displayLabel: 'Overdrive Volume',
    pidLow: 0x003a, pidHigh: 0x0091,
    // Global post-amp master that scales after the cab sim.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },

  'drive.drive': {
    block: 'drive', name: 'drive',
    displayLabel: 'Gain',
    pidLow: 0x0076, pidHigh: 0x000b,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // P1-010 Session B (2026-04-20) — AM4 Owner's Manual line 1330:
  // "Page Right and dial in Drive, Tone, and Level." Cache records
  // at 0x0C/0x0D/0x0E have canonical pedal-layout signatures.
  // HW-014 verified: address + value land correctly on Klone Chiron.
  // Note: AM4 hardware display labels these registers per drive
  // model (Klone Chiron shows `tone`→"Treble" and `level`→"Output",
  // matching the real Klon Centaur). The underlying register is
  // unchanged across drive types.
  'drive.tone': {
    block: 'drive', name: 'tone',
    displayLabel: 'Bass',
    pidLow: 0x0076, pidHigh: 0x000c,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.level': {
    block: 'drive', name: 'level',
    displayLabel: 'Mid',
    pidLow: 0x0076, pidHigh: 0x000d,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.mix': {
    block: 'drive', name: 'mix',
    displayLabel: 'Tone',
    pidLow: 0x0076, pidHigh: 0x000e,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-019 (Session 30, 2026-04-25): Drive EQ-page knobs from
  // session-30-drive-basic-blackglass-7k. T808 OD only exposed
  // Drive/Tone/Level on its first page (session-30-drive-basic-t808-od
  // capture confirmed) — the EQ controls below are absent on simpler
  // pedal types and only surface on amp-emu drive types like
  // Blackglass 7K. Cache signatures pin the unit + range; sequence in
  // the cache (id 16/17 = Low/High Cut Hz, id 20/21/23 = Bass/Mid/
  // Treble knobs flanking id 22 = Mid Frequency) matches the AM4-Edit
  // EQ-1-page layout. Captured wiggle order on Blackglass differed
  // from the spec order; mapping is by cache-id sequence + signature
  // not capture order.
  'drive.low_cut': {
    block: 'drive', name: 'low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x0076, pidHigh: 0x0010,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'drive.bass': {
    block: 'drive', name: 'bass',
    displayLabel: 'Bright Cap',
    pidLow: 0x0076, pidHigh: 0x0014,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.mid': {
    block: 'drive', name: 'mid',
    pidLow: 0x0076, pidHigh: 0x0015,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.mid_freq': {
    block: 'drive', name: 'mid_freq',
    displayLabel: 'XFormer Low Freq',
    pidLow: 0x0076, pidHigh: 0x0016,
    unit: 'hz', displayMin: 200, displayMax: 2000,
  },
  'drive.treble': {
    block: 'drive', name: 'treble',
    displayLabel: 'XFormer Hi Freq',
    pidLow: 0x0076, pidHigh: 0x0017,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.channel': {
    block: 'drive', name: 'channel',
    pidLow: 0x0076, pidHigh: 0x07d2,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' },
  },
  // HW-029 + HW-039 (Session 35, 2026-04-29): Blackglass 7K Drive
  // Expert-Edit page from session-31-drive-expert.pcapng + paired
  // AM4-Edit screenshot. 6 single-knob params + 10 GEQ bands + 1
  // type-specific knob (high_mid for Blackglass, may surface under
  // a different label on other types).
  //
  // Mirrored from CACHE_PARAMS so the type-check picks them up.
  'drive.high_cut': {
    block: 'drive', name: 'high_cut',
    displayLabel: 'High Cut Frequency',
    pidLow: 0x0076, pidHigh: 0x0011,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'drive.bypass_mode': {
    block: 'drive', name: 'bypass_mode',
    pidLow: 0x0076, pidHigh: 0x0004,
    // Cache id=4: enum [Thru / Mute]. Hand-authored per-block non-Type
    // enum (gen-params skips these).
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  'drive.clip_type': {
    block: 'drive', name: 'clip_type',
    displayLabel: 'Frequency',
    pidLow: 0x0076, pidHigh: 0x0012,
    // Cache id=18: 14-entry enum. Hand-authored — generator only
    // attaches one enum import per block (used for `type` at id=10).
    unit: 'enum', displayMin: 0, displayMax: 13,
    enumValues: {
      0: 'LV TUBE', 1: 'HARD', 2: 'SOFT', 3: 'GERMANIUM', 4: 'FW RECT',
      5: 'HV TUBE', 6: 'SILICON', 7: '4558/DIODE', 8: 'LED', 9: 'FET',
      10: 'OP-AMP', 11: 'VARIABLE', 12: 'CMOS', 13: 'NULL',
    },
  },
  'drive.bit_reduce': {
    block: 'drive', name: 'bit_reduce',
    displayLabel: 'Location',
    pidLow: 0x0076, pidHigh: 0x0018,
    unit: 'count', displayMin: 0, displayMax: 24,
  },
  'drive.input_select': {
    block: 'drive', name: 'input_select',
    displayLabel: 'Amp Input Select',
    pidLow: 0x0076, pidHigh: 0x0019,
    // Cache id=25: enum [L+R / LEFT / RIGHT].
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'L+R', 1: 'LEFT', 2: 'RIGHT' },
  },
  'drive.eq_position': {
    block: 'drive', name: 'eq_position',
    pidLow: 0x0076, pidHigh: 0x001c,
    // Cache id=28: enum [OFF / POST / PRE]. Selects whether the post-
    // Drive Graphic EQ is bypassed, post-drive, or pre-drive.
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'OFF', 1: 'POST', 2: 'PRE' },
  },
  // HW-043 partial (Session 45, 2026-05-02) — Drive Expert-Edit ADVANCED
  // panel knobs from `session-45-drive-expert-blackglass.{pcapng,png}`.
  // Slew Rate is universal (also active on Pi Fuzz at wire 0.21044).
  // Bias is Blackglass-only (silent in Pi Fuzz capture) — type-conditional
  // UI but firmware-stable address. See docs/audit-output/drive-blackglass.md.
  // Note: drive.balance is currently registered at 0x0002 but Session 45
  // captures show actual Balance is at 0x000f (hdr2=0x0002 bipolar
  // signature). Re-point deferred until 0x0002's actual identity is
  // confirmed — see open follow-ups in session-44-findings.md.
  'drive.slew_rate': {
    block: 'drive', name: 'slew_rate',
    displayLabel: 'Depth',
    pidLow: 0x0076, pidHigh: 0x001a,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'drive.bias': {
    block: 'drive', name: 'bias',
    pidLow: 0x0076, pidHigh: 0x001b,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // 10-band Graphic EQ — frequencies 100/160/250/400/640/1000/1600/
  // 2500/4000/6400 Hz, each ±12 dB. Wire-display match exact across
  // all 10 bands.
  'drive.geq_band_1':  { block: 'drive', name: 'geq_band_1', displayLabel: 'Supply Sag',  pidLow: 0x0076, pidHigh: 0x001d, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_2':  { block: 'drive', name: 'geq_band_2', displayLabel: 'Presence',  pidLow: 0x0076, pidHigh: 0x001e, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_3':  { block: 'drive', name: 'geq_band_3', displayLabel: 'Negative FB',  pidLow: 0x0076, pidHigh: 0x001f, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_4':  { block: 'drive', name: 'geq_band_4', displayLabel: 'Presence Freq',  pidLow: 0x0076, pidHigh: 0x0020, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_5':  { block: 'drive', name: 'geq_band_5', displayLabel: 'Low Freq',  pidLow: 0x0076, pidHigh: 0x0021, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_6':  { block: 'drive', name: 'geq_band_6', displayLabel: 'Low Reso',  pidLow: 0x0076, pidHigh: 0x0022, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_7':  { block: 'drive', name: 'geq_band_7', displayLabel: 'Amp Section',  pidLow: 0x0076, pidHigh: 0x0023, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_8':  { block: 'drive', name: 'geq_band_8', displayLabel: 'Depth Freq',  pidLow: 0x0076, pidHigh: 0x0024, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_9':  { block: 'drive', name: 'geq_band_9',  pidLow: 0x0076, pidHigh: 0x0025, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.geq_band_10': { block: 'drive', name: 'geq_band_10', displayLabel: 'Master Vol Cap', pidLow: 0x0076, pidHigh: 0x0026, unit: 'db', displayMin: -12, displayMax: 12 },
  'drive.high_mid': {
    block: 'drive', name: 'high_mid',
    pidLow: 0x0076, pidHigh: 0x002d,
    // Cache id=45: knob_0_10. Closes HW-029 — wiggle-order adjacency
    // pins this between drive.mid_freq (id=22) and drive.treble (id=23)
    // in the BASIC column on Blackglass 7K. Type-specific UI label
    // varies; the register name reflects the Blackglass usage.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'drive.type': {
    block: 'drive', name: 'type',
    pidLow: 0x0076, pidHigh: 0x000a,
    // Session 06 capture set drive type with wire-value 8; cache lists
    // index 8 as "T808 Mod" (Fractal's internal label for the TS808
    // variant AM4-Edit surfaces as "TS808"). Full 78-entry table from
    // cache lines up 1:1 with AM4-Edit's Drive Type dropdown order.
    unit: 'enum', displayMin: 0, displayMax: 77,
    enumValues: DRIVE_TYPES_VALUES,
  },
  'reverb.mix': {
    block: 'reverb', name: 'mix',
    pidLow: 0x0042, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'reverb.time': {
    // Blocks Guide §Reverb Basic Page: decay time, 0.1..100 seconds.
    // Uses 'seconds' unit (display = internal, scale 1).
    block: 'reverb', name: 'time',
    displayLabel: 'Time',
    pidLow: 0x0042, pidHigh: 0x000b,
    unit: 'seconds', displayMin: 0.1, displayMax: 100,
  },
  'reverb.predelay': {
    // BK-033 fix (HW-025 #1, Session 30): true address is pidHigh=0x0013,
    // not 0x0010. AM4-Edit capture for Pre-Delay→85 ms wrote 0x0042/0x0013
    // with float32(0.085) — confirms the `ms` unit's ÷1000 scale is right.
    // The 0x0010 register was a cache-derived guess that was structurally
    // plausible (range matched) but wrote to nothing. See SYSEX-MAP §6j.
    block: 'reverb', name: 'predelay',
    displayLabel: 'Pre-Delay',
    pidLow: 0x0042, pidHigh: 0x0013,
    unit: 'ms', displayMin: 0, displayMax: 250,
  },
  // Session 29 (HW-015): reverb Size at pidHigh=0x000f. Wire-verified
  // on two captures ("Plate Size" on Plate reverb + "Size" on Room
  // reverb) — same register, type-dependent UI label. Percent scale.
  'reverb.size': {
    block: 'reverb', name: 'size',
    displayLabel: 'Size',
    pidLow: 0x0042, pidHigh: 0x000f,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // Session 29 (HW-015): spring-reverb-specific params. Registers are
  // writable on any reverb type; AM4-Edit exposes the UI only when
  // a Spring reverb is active. HW-024 (Session 30 cont 3) wire-verified
  // both on Spring, Large reverb (springs=5 displayed exactly; spring_tone
  // 7.30 displayed exactly) — first-ever hardware test of these params.
  'reverb.springs': {
    block: 'reverb', name: 'springs',
    displayLabel: '# of Springs',
    pidLow: 0x0042, pidHigh: 0x001b,
    unit: 'count', displayMin: 2, displayMax: 6,
  },
  'reverb.spring_tone': {
    block: 'reverb', name: 'spring_tone',
    displayLabel: 'Tone',
    pidLow: 0x0042, pidHigh: 0x001c,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // Session 29 follow-up: Shimmer Verb / Plex Verb pitch-shifter
  // voices. Blocks Guide §Shimmer Verb Parameters describes "Shift
  // 1–8" as detune amounts within ±24 semitones ("this is where
  // 'Shimmer' is born"). AM4's reverb exposes two such voices at
  // cache ids 56/57 — structural registration (cache signature
  // matches BG exactly: a=-24, b=24, c=1, step=1). HW-014 couldn't
  // verify on hardware display (both shifts hidden on the Plate
  // reverb type tested); awaits a Shimmer-type hardware spot-check
  // or AM4-Edit-side verification.
  // HW-018 (Session 30, 2026-04-25): 10 new universal/algorithmic-reverb
  // and Spring-specific knobs decoded from session-30-reverb-basic-hall
  // and session-30-reverb-spring captures. Cache metadata confirmed
  // pidLow/pidHigh/range for each; capture final values cross-checked
  // against the founder's AM4-Edit screenshot inventory. Hall + Spring
  // share the universal registers (high_cut / low_cut / input_gain /
  // ducking) while Hall-only adds algorithmic controls (density / quality
  // / stack_hold / stereo_spread) and Spring-only adds Spring-engine
  // controls (dwell / drip).
  'reverb.high_cut': {
    block: 'reverb', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x0042, pidHigh: 0x000c,
    // Cache: a=200, b=20000, c=1 → raw Hz, 200..20000 Hz. Hall capture
    // wrote 7000 Hz directly (numeric input field, action=0x0001).
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'reverb.low_cut': {
    block: 'reverb', name: 'low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x0042, pidHigh: 0x0014,
    // Cache: a=20, b=2000, c=1 → raw Hz, 20..2000 Hz.
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'reverb.input_gain': {
    block: 'reverb', name: 'input_gain',
    displayLabel: 'Input Gain',
    pidLow: 0x0042, pidHigh: 0x0017,
    // Cache: a=0, b=1, c=100 → percent 0..100. Spring final 0.8217 →
    // 82.17% matches the AM4-Edit screenshot's "Input Gain 82.2 %".
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'reverb.density': {
    block: 'reverb', name: 'density',
    displayLabel: 'Density',
    pidLow: 0x0042, pidHigh: 0x0018,
    // Cache: a=4, b=8, c=1, kind=float typecode=16 → integer count
    // 4..8. Hall-only (algorithmic Hall/Plate/Room knob).
    unit: 'count', displayMin: 4, displayMax: 8,
  },
  'reverb.dwell': {
    block: 'reverb', name: 'dwell',
    displayLabel: 'Dwell',
    pidLow: 0x0042, pidHigh: 0x0024,
    // Cache: a=0.01, b=1, c=10 → knob_0_10 (display = wire × 10).
    // Spring final 0.4741 → 4.741 matches screenshot "Dwell 4.74".
    // Spring-engine specific (alongside spring_tone, drip).
    unit: 'knob_0_10', displayMin: 0.1, displayMax: 10,
    // typecode 80 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'reverb.stereo_spread': {
    block: 'reverb', name: 'stereo_spread',
    displayLabel: 'Stereo Spread',
    pidLow: 0x0042, pidHigh: 0x0027,
    // Cache: a=-2, b=2, c=100 → bipolar_percent allowing -200..+200%.
    // AM4-Edit screenshot shows Hall Stereo Spread as a positive 0..100%
    // knob (display value 90.0 %). Cache exposes the wider firmware
    // range — leave displayMin/displayMax at the cache values; Claude
    // can clamp to the typical 0..100 range when describing the knob.
    unit: 'bipolar_percent', displayMin: -200, displayMax: 200,
  },
  'reverb.ducking': {
    block: 'reverb', name: 'ducking',
    displayLabel: 'Ducking',
    pidLow: 0x0042, pidHigh: 0x0028,
    // Cache: a=0, b=80, c=1 → raw dB, 0..80 dB attenuation. Universal
    // (Hall + Spring both wrote here). Screenshot shows "Ducking 46.9 dB"
    // on both reverb types — typical mid-range attenuation.
    unit: 'db', displayMin: 0, displayMax: 80,
  },
  'reverb.quality': {
    block: 'reverb', name: 'quality',
    displayLabel: 'Quality',
    pidLow: 0x0042, pidHigh: 0x002f,
    // Cache: enum, values=["ECONOMY","NORMAL","HIGH","ULTRA-HIGH"].
    // Hall-only (algorithmic CPU-quality selector). Hand-authored enum
    // map; not yet exported via cacheEnums.ts since cacheEnums is
    // auto-generated from a different cache section. If a regen pass
    // adds REVERB_QUALITY_VALUES later, swap this inline map for the
    // import.
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'ECONOMY', 1: 'NORMAL', 2: 'HIGH', 3: 'ULTRA-HIGH' },
  },
  'reverb.stack_hold': {
    block: 'reverb', name: 'stack_hold',
    displayLabel: 'Stack/Hold',
    pidLow: 0x0042, pidHigh: 0x0030,
    // Cache: enum, values=["OFF","STACK","HOLD"]. Hall-only. Same
    // hand-authored caveat as reverb.quality.
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'OFF', 1: 'STACK', 2: 'HOLD' },
  },
  'reverb.drip': {
    block: 'reverb', name: 'drip',
    displayLabel: 'Drip',
    pidLow: 0x0042, pidHigh: 0x0034,
    // Cache: a=0, b=1, c=100 → percent 0..100. Spring final 0.9183 →
    // 91.83% matches screenshot "Drip 91.8 %". Spring-engine specific.
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'reverb.shift_1': {
    block: 'reverb', name: 'shift_1',
    displayLabel: 'Voice 1 Shift',
    pidLow: 0x0042, pidHigh: 0x0038,
    unit: 'semitones', displayMin: -24, displayMax: 24,
  },
  'reverb.shift_2': {
    block: 'reverb', name: 'shift_2',
    displayLabel: 'Voice 2 Shift',
    pidLow: 0x0042, pidHigh: 0x0039,
    unit: 'semitones', displayMin: -24, displayMax: 24,
  },
  'reverb.channel': {
    block: 'reverb', name: 'channel',
    pidLow: 0x0042, pidHigh: 0x07d2,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' },
  },
  'reverb.type': {
    block: 'reverb', name: 'type',
    pidLow: 0x0042, pidHigh: 0x000a,
    // Session 16: enum dictionary imported from cacheEnums.ts (79 models).
    // Untested against capture.
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: REVERB_TYPES_VALUES,
  },
  'delay.time': {
    block: 'delay', name: 'time',
    displayLabel: 'Time',
    pidLow: 0x0046, pidHigh: 0x000c,
    // Session 16: cache says `b=8` seconds → UI max 8000 ms (was 5000).
    unit: 'ms', displayMin: 0, displayMax: 8000,
  },
  'delay.mix': {
    // Blocks Guide: delay has Mix at pidHigh 0x01. "Note that the
    // delay block uses a different Mix Law compared to other blocks" —
    // semantics differ but the param is at the standard location.
    block: 'delay', name: 'mix',
    pidLow: 0x0046, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // Session 29 (HW-015): Feedback knobs on per-block delay/flanger/phaser.
  // All bipolar — negative feedback inverts the phase of the repeats/
  // sweep, a standard Fractal implementation detail.
  'delay.feedback': {
    block: 'delay', name: 'feedback',
    displayLabel: 'Feedback',
    pidLow: 0x0046, pidHigh: 0x000e,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  // HW-020 (Session 30, 2026-04-25): Delay first-page registers from
  // session-30-delay-basic-digital-mono. `level` follows the universal
  // pidHigh=0x0000 "Level" pattern shared with amp.level (no cache
  // record at id=0; out-of-band hand-author). `stack_hold` and
  // `ducking` mirror the same registers found on Reverb (HW-018).
  // `tempo` (pidHigh=0x0013) is captured but deferred — registering
  // it requires extracting the 79-entry tempo-division enum from cache
  // (queued as HW-027 follow-up).
  'delay.level': {
    block: 'delay', name: 'level',
    pidLow: 0x0046, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  // HW-040 (Session 36, 2026-04-29): Delay Expert-Edit page from
  // session-40-delay-expert.pcapng (Ambient Stereo). 32 new params
  // mirrored from CACHE_PARAMS + 7 hand-authored enums (bypass_mode,
  // kill_dry, lo_fi_drive, phase_reverse, low_cut_slope, high_cut_slope,
  // compander).
  'delay.bypass_mode': {
    block: 'delay', name: 'bypass_mode',
    pidLow: 0x0046, pidHigh: 0x0004,
    // Cache id=4 enum has 5 entries: [Thru, Mute FX Out, Mute Out,
    // Mute FX In, Mute In] — the cache extraction shows 4 visible
    // entries but the enum max is 4 (so 5 indices, 0..4).
    unit: 'enum', displayMin: 0, displayMax: 4,
    enumValues: { 0: 'Thru', 1: 'Mute FX Out', 2: 'Mute Out', 3: 'Mute FX In', 4: 'Mute In' },
  },
  'delay.kill_dry': {
    block: 'delay', name: 'kill_dry',
    pidLow: 0x0046, pidHigh: 0x0007,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'delay.lr_time_ratio': {
    block: 'delay', name: 'lr_time_ratio',
    displayLabel: 'L/R Time Ratio',
    pidLow: 0x0046, pidHigh: 0x000d,
    unit: 'percent', displayMin: 1, displayMax: 100,
  },
  'delay.feedback_r': {
    block: 'delay', name: 'feedback_r',
    displayLabel: 'Feedback R',
    pidLow: 0x0046, pidHigh: 0x0010,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'delay.stereo_spread': {
    block: 'delay', name: 'stereo_spread',
    displayLabel: 'Stereo Spread',
    pidLow: 0x0046, pidHigh: 0x0012,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'delay.low_cut': {
    block: 'delay', name: 'low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x0046, pidHigh: 0x0014,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'delay.high_cut': {
    block: 'delay', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x0046, pidHigh: 0x0015,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'delay.lo_fi_drive': {
    block: 'delay', name: 'lo_fi_drive',
    displayLabel: 'Drive',
    pidLow: 0x0046, pidHigh: 0x001a,
    // Cache id=26: float a=0.05 b=50 c=10 → display = wire × 10,
    // range 0.5..500. Same encoding shape as knob_0_10 (scale 10);
    // the unit name is structural, the bounds carry the actual range.
    unit: 'knob_0_10', displayMin: 0.5, displayMax: 500,
    // typecode 80 = log10 (HW-053b cont audit)
    scaling: 'log10',
  },
  'delay.input_gain': {
    block: 'delay', name: 'input_gain',
    displayLabel: 'Input Gain',
    pidLow: 0x0046, pidHigh: 0x001b,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'delay.master_feedback': {
    block: 'delay', name: 'master_feedback',
    displayLabel: 'Master Feedback',
    pidLow: 0x0046, pidHigh: 0x0020,
    // Cache id=32: a=0 b=2 c=100 → display 0..200%.
    unit: 'percent', displayMin: 0, displayMax: 200,
  },
  'delay.high_cut_slope': {
    block: 'delay', name: 'high_cut_slope',
    displayLabel: 'High Cut Slope',
    pidLow: 0x0046, pidHigh: 0x002d,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: '6 dB/OCT', 1: '12 dB/OCT', 2: '24 dB/OCT', 3: '36 dB/OCT' },
  },
  'delay.ducker_threshold': {
    block: 'delay', name: 'ducker_threshold',
    displayLabel: 'Threshold',
    pidLow: 0x0046, pidHigh: 0x002f,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'delay.ducker_release': {
    block: 'delay', name: 'ducker_release',
    displayLabel: 'Release',
    pidLow: 0x0046, pidHigh: 0x0030,
    unit: 'ms', displayMin: 1, displayMax: 1000, scaling: 'log10',
  },
  'delay.diffusor': {
    block: 'delay', name: 'diffusor',
    displayLabel: 'Diffuser',
    pidLow: 0x0046, pidHigh: 0x0031,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'delay.diffusion_time': {
    block: 'delay', name: 'diffusion_time',
    displayLabel: 'Diffusion Time',
    pidLow: 0x0046, pidHigh: 0x0032,
    unit: 'percent', displayMin: 1, displayMax: 100,
  },
  'delay.phase_reverse': {
    block: 'delay', name: 'phase_reverse',
    displayLabel: 'Phase Reverse',
    pidLow: 0x0046, pidHigh: 0x0033,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'NONE', 1: 'RIGHT', 2: 'LEFT', 3: 'BOTH' },
  },
  'delay.eq_q_high_low': {
    block: 'delay', name: 'eq_q_high_low',
    displayLabel: 'Q (High + Low)',
    pidLow: 0x0046, pidHigh: 0x003f,
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
  },
  'delay.bit_reduction': {
    block: 'delay', name: 'bit_reduction',
    displayLabel: 'Bit Reduction',
    pidLow: 0x0046, pidHigh: 0x0040,
    unit: 'count', displayMin: 0, displayMax: 24,
  },
  'delay.eq_freq_1': {
    block: 'delay', name: 'eq_freq_1',
    displayLabel: 'Frequency 1',
    pidLow: 0x0046, pidHigh: 0x0041,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'delay.eq_freq_2': {
    block: 'delay', name: 'eq_freq_2',
    displayLabel: 'Frequency 2',
    pidLow: 0x0046, pidHigh: 0x0042,
    unit: 'hz', displayMin: 100, displayMax: 10000,
  },
  'delay.eq_q_1': {
    block: 'delay', name: 'eq_q_1',
    displayLabel: 'Q 1',
    pidLow: 0x0046, pidHigh: 0x0043,
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
  },
  'delay.eq_q_2': {
    block: 'delay', name: 'eq_q_2',
    displayLabel: 'Q 2',
    pidLow: 0x0046, pidHigh: 0x0044,
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
  },
  'delay.eq_gain_1': {
    block: 'delay', name: 'eq_gain_1',
    displayLabel: 'Gain 1',
    pidLow: 0x0046, pidHigh: 0x0045,
    unit: 'db', displayMin: -12, displayMax: 12,
  },
  'delay.eq_gain_2': {
    block: 'delay', name: 'eq_gain_2',
    displayLabel: 'Gain 2',
    pidLow: 0x0046, pidHigh: 0x0046,
    unit: 'db', displayMin: -12, displayMax: 12,
  },
  'delay.low_cut_slope': {
    block: 'delay', name: 'low_cut_slope',
    displayLabel: 'Low Cut Slope',
    pidLow: 0x0046, pidHigh: 0x004a,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: '6 dB/OCT', 1: '12 dB/OCT', 2: '24 dB/OCT', 3: '36 dB/OCT' },
  },
  'delay.compander': {
    block: 'delay', name: 'compander',
    displayLabel: 'Compander',
    pidLow: 0x0046, pidHigh: 0x004b,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'delay.compander_time': {
    block: 'delay', name: 'compander_time',
    displayLabel: 'Time',
    pidLow: 0x0046, pidHigh: 0x004c,
    unit: 'ms', displayMin: 1, displayMax: 100, scaling: 'log10',
  },
  'delay.compander_threshold': {
    block: 'delay', name: 'compander_threshold',
    displayLabel: 'Threshold',
    pidLow: 0x0046, pidHigh: 0x004d,
    unit: 'db', displayMin: -100, displayMax: -20,
  },
  'delay.master_time': {
    block: 'delay', name: 'master_time',
    displayLabel: 'Master Time',
    pidLow: 0x0046, pidHigh: 0x004e,
    unit: 'percent', displayMin: 25, displayMax: 400,
  },
  'delay.lfo_rate': {
    block: 'delay', name: 'lfo_rate',
    displayLabel: 'LFO Rate',
    pidLow: 0x0046, pidHigh: 0x004f,
    unit: 'hz', displayMin: 0.1, displayMax: 10,
  },
  'delay.lfo_depth': {
    block: 'delay', name: 'lfo_depth',
    displayLabel: 'LFO Depth',
    pidLow: 0x0046, pidHigh: 0x0050,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'delay.stack_feedback': {
    block: 'delay', name: 'stack_feedback',
    displayLabel: 'Stack Feedback',
    pidLow: 0x0046, pidHigh: 0x0057,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'delay.hold_feedback': {
    block: 'delay', name: 'hold_feedback',
    displayLabel: 'Hold Feedback',
    pidLow: 0x0046, pidHigh: 0x0058,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'delay.stack_hold': {
    block: 'delay', name: 'stack_hold',
    displayLabel: 'Repeat Stack/Hold',
    pidLow: 0x0046, pidHigh: 0x001f,
    // Cache id=31: enum [OFF|STACK|HOLD]. Hand-authored — generator
    // can't emit per-block non-Type enums (it would mis-import the
    // block's TYPES_VALUES instead of these three).
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'OFF', 1: 'STACK', 2: 'HOLD' },
  },
  'delay.ducking': {
    block: 'delay', name: 'ducking',
    displayLabel: 'Ducking',
    pidLow: 0x0046, pidHigh: 0x002e,
    // Cache id=46: float a=0 b=80 c=1 → raw dB 0..80 attenuation.
    // Same signature as reverb.ducking (HW-018).
    unit: 'db', displayMin: 0, displayMax: 80,
  },
  // HW-027 (Session 30 cont 2, 2026-04-25): tempo-sync registers across
  // every modulation block. Cache contains 14 79-entry tempo enums (delay
  // × 6, chorus × 2, reverb / flanger / rotary / phaser / tremolo /
  // filter × 1 each) — all string-identical, sharing the
  // TEMPO_DIVISIONS_VALUES dictionary emitted by gen-cache-enums.ts.
  // The first/lowest-id tempo enum on each block is canonically the main
  // "Tempo Sync" knob per Blocks Guide §Common LFO Parameters. We
  // register the high-confidence ones below (delay = wire-verified;
  // chorus/flanger/phaser/tremolo = structural-by-symmetry, every
  // modulation block has a Tempo Sync knob). Filter / reverb / rotary
  // tempo registers deferred — semantics uncertain (auto-wah env follower
  // vs LFO sync; reverb-modulation tempo for Vibrato-King types only).
  // Hand-authored in KNOWN_PARAMS rather than via paramNames+generator
  // because the generator's enum-handling defaults to the block's
  // TYPES_VALUES, which would mis-import for these non-Type enums.
  'delay.tempo': {
    block: 'delay', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x0046, pidHigh: 0x0013,
    // Wire-verified: session-30-delay-basic-digital-mono captured
    // value=11 (= "1/8" tempo division).
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'chorus.tempo': {
    block: 'chorus', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x004e, pidHigh: 0x000d,
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'flanger.tempo': {
    block: 'flanger', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x0052, pidHigh: 0x000c,
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'phaser.tempo': {
    block: 'phaser', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x005a, pidHigh: 0x000e,
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'tremolo.tempo': {
    block: 'tremolo', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x006a, pidHigh: 0x000f,
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'delay.channel': {
    block: 'delay', name: 'channel',
    pidLow: 0x0046, pidHigh: 0x07d2,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' },
  },
  'delay.type': {
    block: 'delay', name: 'type',
    pidLow: 0x0046, pidHigh: 0x000a,
    // Session 16: enum dictionary imported from cacheEnums.ts (29 models).
    // Untested against capture.
    unit: 'enum', displayMin: 0, displayMax: 28,
    enumValues: DELAY_TYPES_VALUES,
  },
  // Session 18 — 6 additional block Type selectors, each pinned to wire
  // pidLow by a Tier-3 AM4-Edit capture of a Type-dropdown change. The
  // cache record id is the wire pidHigh (10 for the effect blocks, 19/20
  // for Comp/GEQ because their cache slot reserves ids 0..12 for band
  // levels / assign slots).
  // P1-010 Session B (2026-04-20) — universal Mix control per the
  // Blocks Guide §Common Mix/Level Parameters (p. 7). Every effect
  // block with a wet/dry concept exposes Mix at pidHigh 0x01 with the
  // same percent signature as the confirmed reverb.mix. Skipped for
  // Wah/GEQ/Gate/Volume-Pan (AM4 manual p. 34: "Effects with no mix,
  // such as Wah, GEQ, etc., will show 'NA'"). HW-014 partial: delay
  // / chorus / reverb mix verified correct; flanger.mix and
  // phaser.mix surfaced the BK-034 encoding bug (see entries below);
  // tremolo.mix / compressor.mix / filter.mix hidden on hardware
  // display (awaits AM4-Edit verification).
  // Modulation-block LFO rates + depths (Session 26 Unit-extension pass).
  // Rate uses the 'hz' unit (raw passthrough, c=1 in cache). Depth is a
  // standard percent knob. Blocks Guide §Chorus/Flanger/Phaser document
  // all three as Basic Page controls across these blocks.
  'chorus.mix': {
    block: 'chorus', name: 'mix',
    pidLow: 0x004e, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'chorus.type': {
    block: 'chorus', name: 'type',
    pidLow: 0x004e, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 19,
    enumValues: CHORUS_TYPES_VALUES,
  },
  'chorus.rate': {
    // BK-034 resolved (HW-025 #2, Session 30): NOT an encoding bug.
    // AM4-Edit wire for Rate→3.4 Hz wrote pidLow=0x004e/pidHigh=0x000c
    // with float32(3.4) — byte-identical to our `unit: 'hz'` builder.
    // HW-014's hardware-display readback (3.4→0.5 Hz) is an AM4
    // hardware-screen rendering quirk for chorus rate, not a wire-
    // layer bug. Verify chorus rate via AM4-Edit, not the AM4 hardware
    // display, until the screen-side rendering is characterised.
    block: 'chorus', name: 'rate',
    displayLabel: 'Rate',
    pidLow: 0x004e, pidHigh: 0x000c,
    unit: 'hz', displayMin: 0.1, displayMax: 10,
  },
  'chorus.depth': {
    block: 'chorus', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x004e, pidHigh: 0x000e,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-022 (Session 31, 2026-04-26): wire-verified on Analog Stereo
  // chorus — `session-30-chorus-basic.pcapng`. Chorus first-page
  // additions: level / time / mod_phase / phase_reverse.
  'chorus.level': {
    block: 'chorus', name: 'level',
    pidLow: 0x004e, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'chorus.time': {
    block: 'chorus', name: 'time',
    displayLabel: 'Delay Time',
    pidLow: 0x004e, pidHigh: 0x0010,
    // Cache id=16: float a=0.0001 b=0.05 c=1000 → display 0.1..50 ms.
    unit: 'ms', displayMin: 0.1, displayMax: 50,
  },
  'chorus.mod_phase': {
    block: 'chorus', name: 'mod_phase',
    displayLabel: 'Mod Phase',
    pidLow: 0x004e, pidHigh: 0x0011,
    // Cache id=17: float a=0 b=π c=180/π → display 0..180 deg.
    unit: 'degrees', displayMin: 0, displayMax: 180,
  },
  'chorus.phase_reverse': {
    block: 'chorus', name: 'phase_reverse',
    displayLabel: 'Phase Reverse',
    pidLow: 0x004e, pidHigh: 0x0014,
    // Cache id=20 enum: [NONE, RIGHT, LEFT, BOTH]. Default NONE.
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'NONE', 1: 'RIGHT', 2: 'LEFT', 3: 'BOTH' },
  },
  // HW-040 (Session 36, 2026-04-29): Chorus Expert-Edit page from
  // session-40-chorus-expert.pcapng (Analog Stereo). New non-Type
  // enums + cache mirrors.
  'chorus.bypass_mode': {
    block: 'chorus', name: 'bypass_mode',
    pidLow: 0x004e, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'Thru', 1: 'Mute FX Out', 2: 'Mute Out' },
  },
  // chorus.tempo already registered above (HW-027 added the
  // shared TEMPO_DIVISIONS_VALUES dictionary).
  'chorus.lfo_type': {
    block: 'chorus', name: 'lfo_type',
    displayLabel: 'LFO Type',
    pidLow: 0x004e, pidHigh: 0x0012,
    unit: 'enum', displayMin: 0, displayMax: 9,
    enumValues: LFO_WAVEFORMS_VALUES,
  },
  'chorus.auto_depth': {
    block: 'chorus', name: 'auto_depth',
    displayLabel: 'Auto Depth',
    pidLow: 0x004e, pidHigh: 0x0013,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'OFF', 1: 'LOW', 2: 'HIGH' },
  },
  'chorus.dimension_mode': {
    block: 'chorus', name: 'dimension_mode',
    displayLabel: 'Mode',
    pidLow: 0x004e, pidHigh: 0x001b,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'OFF', 1: 'LOW', 2: 'MED', 3: 'HIGH' },
  },
  'chorus.number_of_voices': {
    block: 'chorus', name: 'number_of_voices',
    displayLabel: 'Number of Voices',
    pidLow: 0x004e, pidHigh: 0x000b,
    unit: 'count', displayMin: 1, displayMax: 4,
  },
  'chorus.high_cut': {
    block: 'chorus', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x004e, pidHigh: 0x000f,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'chorus.lfo_phase_pct': {
    block: 'chorus', name: 'lfo_phase_pct',
    displayLabel: 'Right Time Ratio',
    pidLow: 0x004e, pidHigh: 0x0015,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'chorus.lfo_rate': {
    block: 'chorus', name: 'lfo_rate',
    displayLabel: 'Rate Right',
    pidLow: 0x004e, pidHigh: 0x0016,
    unit: 'hz', displayMin: 0.1, displayMax: 10,
  },
  'chorus.width': {
    block: 'chorus', name: 'width',
    displayLabel: 'LFO 2 Depth',
    pidLow: 0x004e, pidHigh: 0x0017,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'chorus.drive': {
    block: 'chorus', name: 'drive',
    displayLabel: 'Drive',
    pidLow: 0x004e, pidHigh: 0x0018,
    // Cache id=24: float a=0.05 b=50 c=10 → display = wire × 10,
    // range 0.5..500. Same encoding shape as knob_0_10 with stretched
    // range; the unit is structural. typecode 80 → log10 (HW-053 cont).
    unit: 'knob_0_10', displayMin: 0.5, displayMax: 500,
    scaling: 'log10',
  },
  'chorus.lfo_freq': {
    block: 'chorus', name: 'lfo_freq',
    displayLabel: 'Low Cut',
    pidLow: 0x004e, pidHigh: 0x0019,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'chorus.lfo_depth_2': {
    block: 'chorus', name: 'lfo_depth_2',
    displayLabel: 'Stereo Spread',
    pidLow: 0x004e, pidHigh: 0x001a,
    // Cache id=26: float a=-2 b=2 c=100 → display = wire × 100,
    // range -200..200% (bipolar with extended range).
    unit: 'bipolar_percent', displayMin: -200, displayMax: 200,
  },
  // HW-032 (Session 30 cont 8, 2026-04-25): wire-verified at +10 dB on
  // an Analog Stereo flanger — `session-32-flanger-extended.pcapng`.
  // Follows the universal pidHigh=0x0000 Level pattern.
  'flanger.level': {
    block: 'flanger', name: 'level',
    pidLow: 0x0052, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'flanger.mix': {
    // BK-034 resolved (HW-025 #3, Session 30): NOT an encoding bug.
    // AM4-Edit wire for Mix→54% wrote pidLow=0x0052/pidHigh=0x0001
    // with float32(0.54) — byte-identical to our `unit: 'percent'`
    // builder. HW-014's hardware-display readback (54%→50%) is a
    // hardware-screen rendering quirk; verify via AM4-Edit.
    block: 'flanger', name: 'mix',
    pidLow: 0x0052, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'flanger.type': {
    block: 'flanger', name: 'type',
    pidLow: 0x0052, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 31,
    enumValues: FLANGER_TYPES_VALUES,
  },
  // HW-024 (Session 30 cont 3): wire-verified at 1.7 Hz on an
  // Analog Stereo flanger (HW-014 left this unconfirmed in Round 2).
  'flanger.rate': {
    block: 'flanger', name: 'rate',
    displayLabel: 'Rate',
    pidLow: 0x0052, pidHigh: 0x000b,
    unit: 'hz', displayMin: 0.05, displayMax: 10,
  },
  'flanger.depth': {
    block: 'flanger', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x0052, pidHigh: 0x000d,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'flanger.feedback': {
    // BK-034 resolved (HW-025 #4, Session 30): NOT an encoding bug.
    // AM4-Edit wire for Feedback→-61% wrote pidLow=0x0052/pidHigh=0x000e
    // with float32(-0.61) — byte-identical to our `unit: 'bipolar_percent'`
    // builder. HW-014's hardware-display readbacks (-61%→0; +99%→+90)
    // are hardware-screen rendering quirks; verify via AM4-Edit.
    block: 'flanger', name: 'feedback',
    displayLabel: 'Feedback',
    pidLow: 0x0052, pidHigh: 0x000e,
    // Cache caps internal range at ±0.995 — display scale 100 ⇒ ±99%.
    unit: 'bipolar_percent', displayMin: -99, displayMax: 99,
  },
  // HW-022 (Session 31, 2026-04-26): wire-verified on Analog Stereo
  // flanger — `session-30-flanger-basic.pcapng`. Manual is a 0–10 knob
  // (no unit suffix shown in AM4-Edit); Mod Phase mirrors the chorus
  // degrees encoding.
  'flanger.manual': {
    block: 'flanger', name: 'manual',
    displayLabel: 'Manual',
    pidLow: 0x0052, pidHigh: 0x000f,
    // Cache id=15: float a=0 b=1 c=10 → display 0..10.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'flanger.mod_phase': {
    block: 'flanger', name: 'mod_phase',
    displayLabel: 'Mod Phase',
    pidLow: 0x0052, pidHigh: 0x0011,
    // Cache id=17: float a=0 b=π c=180/π → display 0..180 deg.
    unit: 'degrees', displayMin: 0, displayMax: 180,
  },
  'phaser.mix': {
    // BK-034 resolved (HW-025 #5, Session 30): NOT an encoding bug.
    // AM4-Edit wire for Mix→88% wrote pidLow=0x005a/pidHigh=0x0001
    // with float32(0.88) — byte-identical to our `unit: 'percent'`
    // builder. HW-014's hardware-display readback (88%→53%) is a
    // hardware-screen rendering quirk; verify via AM4-Edit.
    block: 'phaser', name: 'mix',
    pidLow: 0x005a, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'phaser.type': {
    block: 'phaser', name: 'type',
    pidLow: 0x005a, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 16,
    enumValues: PHASER_TYPES_VALUES,
  },
  // HW-024 (Session 30 cont 3): wire-verified at 2.3 Hz on a Digital
  // Mono phaser (HW-014 left this unconfirmed in Round 2).
  'phaser.rate': {
    block: 'phaser', name: 'rate',
    displayLabel: 'Rate',
    pidLow: 0x005a, pidHigh: 0x000c,
    unit: 'hz', displayMin: 0.1, displayMax: 10,
  },
  'phaser.feedback': {
    block: 'phaser', name: 'feedback',
    displayLabel: 'Feedback',
    pidLow: 0x005a, pidHigh: 0x0010,
    // Cache signature is unusual — internal ±0.9, display-scale 111.1.
    // We use standard bipolar_percent (scale 100) with clamped bounds
    // so input stays inside the internal range; AM4-Edit's displayed
    // percentage may read slightly higher than the value set (an input
    // of "50" sets internal 0.5 which AM4-Edit shows as ~55.5%). The
    // natural-language UX impact is negligible.
    unit: 'bipolar_percent', displayMin: -90, displayMax: 90,
  },
  // HW-022 (Session 31, 2026-04-26): wire-verified on Digital Stereo
  // phaser — `session-30-phaser-basic.pcapng`. Phaser uses 0–10 knob
  // semantics for Depth + Manual (unlike chorus/flanger which use
  // percent for Depth). Mod Phase address differs from chorus/flanger
  // (0x0013 here vs 0x0011 there) — cache lays it out at id=19 not id=17.
  'phaser.level': {
    block: 'phaser', name: 'level',
    pidLow: 0x005a, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'phaser.depth': {
    block: 'phaser', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x005a, pidHigh: 0x000f,
    // Cache id=15: float a=0 b=1 c=10 → display 0..10.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'phaser.mod_phase': {
    block: 'phaser', name: 'mod_phase',
    displayLabel: 'Mod Phase',
    pidLow: 0x005a, pidHigh: 0x0013,
    // Cache id=19: float a=0 b=π c=180/π → display 0..180 deg.
    unit: 'degrees', displayMin: 0, displayMax: 180,
  },
  'phaser.manual': {
    block: 'phaser', name: 'manual',
    displayLabel: 'Manual',
    pidLow: 0x005a, pidHigh: 0x0022,
    // Cache id=34: float a=0 b=1 c=10 → display 0..10.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'wah.type': {
    block: 'wah', name: 'type',
    pidLow: 0x005e, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 8,
    enumValues: WAH_TYPES_VALUES,
  },
  // HW-040 (Session 36, 2026-04-29): Wah Expert-Edit page from
  // session-40-wah-expert.pcapng (FAS Wah). 18 new params + 3 hand-
  // authored enums. Closes the wah block from "type-only" registration
  // to full Expert coverage.
  //
  // **BK-035 audit (Session 36 cont, 2026-04-29):** Eight wah ids were
  // mis-named in the original auto-generation pass — the cache-id →
  // pidHigh ordering didn't match the AM4-Edit screenshot's knob
  // labels. Re-derived from the value-matched audit table (`scripts/
  // audit-block-vs-screenshot.ts` against `docs/audit-input/wah.json`).
  // Old → new:
  //   0x000d  q (range 2..20)         → q_resonance (range 0..10)
  //   0x000e  q_resonance              → q_tracking
  //   0x000f  q_tracking                → wah_control
  //   0x0010  control_taper + drive    → fat
  //                  (was duplicate-pidHigh code bug — now resolved)
  //   0x0011  fat                       → drive
  //   0x0012  (unregistered)            → control_taper (enum, hand-authored)
  //   0x0013  low_cut_frequency         → inductor_bias (knob_0_10)
  //   0x0014  inductor_bias (hz)        → low_cut_frequency (hz)
  'wah.level': {
    block: 'wah', name: 'level',
    pidLow: 0x005e, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'wah.bypass_mode': {
    block: 'wah', name: 'bypass_mode',
    pidLow: 0x005e, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  'wah.min_frequency': {
    block: 'wah', name: 'min_frequency',
    displayLabel: 'Minimum Frequency',
    pidLow: 0x005e, pidHigh: 0x000b,
    unit: 'hz', displayMin: 100, displayMax: 1000,
  },
  'wah.max_frequency': {
    block: 'wah', name: 'max_frequency',
    displayLabel: 'Maximum Frequency',
    pidLow: 0x005e, pidHigh: 0x000c,
    // Cache id=12: a=500 b=5000 c=1.
    unit: 'hz', displayMin: 500, displayMax: 5000,
  },
  'wah.q_resonance': {
    block: 'wah', name: 'q_resonance',
    displayLabel: 'Resonance',
    pidLow: 0x005e, pidHigh: 0x000d,
    // BK-035: was `wah.q` with range 2..20. Screenshot showed 4.44 at
    // wire 0.444, which only matches knob_0_10 (×10). Range corrected.
    // typecode 80 → log10 (HW-053 cont); displayMin=0 falls back to linear.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
    scaling: 'log10',
  },
  'wah.q_tracking': {
    block: 'wah', name: 'q_tracking',
    displayLabel: 'Q Tracking',
    pidLow: 0x005e, pidHigh: 0x000e,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'wah.wah_control': {
    block: 'wah', name: 'wah_control',
    displayLabel: 'Wah Control',
    pidLow: 0x005e, pidHigh: 0x000f,
    // BK-035: the actual pedal-position param. Without it, cocked-wah
    // presets are blocked — Claude can't sweep the wah filter sweep.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'wah.fat': {
    block: 'wah', name: 'fat',
    displayLabel: 'Fat',
    pidLow: 0x005e, pidHigh: 0x0010,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'wah.drive': {
    block: 'wah', name: 'drive',
    displayLabel: 'Drive',
    pidLow: 0x005e, pidHigh: 0x0011,
    // typecode 80 → log10 (HW-053 cont); displayMin=0 falls back to linear.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
    scaling: 'log10',
  },
  'wah.control_taper': {
    block: 'wah', name: 'control_taper',
    displayLabel: 'Control Taper',
    pidLow: 0x005e, pidHigh: 0x0012,
    // BK-035: previously registered at 0x0010 (wrong pidHigh). The
    // captured wire at 0x0012 is float32(4) = enum index 4 = "Log 10A",
    // matching the screenshot's Control Taper dropdown.
    // Cache id=18 enum has 6 entries (max=5).
    unit: 'enum', displayMin: 0, displayMax: 5,
    enumValues: { 0: 'LINEAR', 1: 'LOG 30A', 2: 'LOG 20A', 3: 'LOG 15A', 4: 'LOG 10A', 5: 'LOG 5A' },
  },
  'wah.inductor_bias': {
    block: 'wah', name: 'inductor_bias',
    displayLabel: 'Inductor Bias',
    pidLow: 0x005e, pidHigh: 0x0013,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'wah.low_cut_frequency': {
    block: 'wah', name: 'low_cut_frequency',
    displayLabel: 'Low Cut Frequency',
    pidLow: 0x005e, pidHigh: 0x0014,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'wah.eq_post': {
    block: 'wah', name: 'eq_post',
    displayLabel: 'EQ',
    pidLow: 0x005e, pidHigh: 0x0015,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'wah.graphic_eq_band_1': { block: 'wah', name: 'graphic_eq_band_1', displayLabel: '160', pidLow: 0x005e, pidHigh: 0x0016, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_2': { block: 'wah', name: 'graphic_eq_band_2', displayLabel: '250', pidLow: 0x005e, pidHigh: 0x0017, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_3': { block: 'wah', name: 'graphic_eq_band_3', displayLabel: '400', pidLow: 0x005e, pidHigh: 0x0018, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_4': { block: 'wah', name: 'graphic_eq_band_4', displayLabel: '640', pidLow: 0x005e, pidHigh: 0x0019, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_5': { block: 'wah', name: 'graphic_eq_band_5', displayLabel: '1000', pidLow: 0x005e, pidHigh: 0x001a, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_6': { block: 'wah', name: 'graphic_eq_band_6', displayLabel: '1600', pidLow: 0x005e, pidHigh: 0x001b, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_7': { block: 'wah', name: 'graphic_eq_band_7', displayLabel: '2500', pidLow: 0x005e, pidHigh: 0x001c, unit: 'db', displayMin: -12, displayMax: 12 },
  'wah.graphic_eq_band_8': { block: 'wah', name: 'graphic_eq_band_8', displayLabel: '4000', pidLow: 0x005e, pidHigh: 0x001d, unit: 'db', displayMin: -12, displayMax: 12 },
  'compressor.mix': {
    block: 'compressor', name: 'mix',
    pidLow: 0x002e, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-021 (Session 30, 2026-04-25): Compressor first-page registers
  // from session-30-comp-basic-jfet-studio. Cache ids 10..15 are the
  // canonical comp-config knobs (Threshold, Ratio, Attack, Release,
  // Knee Type enum, Auto Makeup OFF/ON). `level` follows the universal
  // pidHigh=0x0000 "Level" pattern (out-of-band hand-author).
  // Two more registers wiggled in the capture remain unidentified
  // (pidHigh=0x0017 cache id=23 float; pidHigh=0x0029 cache id=41
  // knob_0_10 with value 1.2 exceeding cache cap b=1) — queued as
  // HW-028 follow-up. The Optical/JFET-specific Light Type knob
  // wasn't reached in this capture.
  'compressor.level': {
    block: 'compressor', name: 'level',
    pidLow: 0x002e, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'compressor.threshold': {
    block: 'compressor', name: 'threshold',
    displayLabel: 'Threshold',
    pidLow: 0x002e, pidHigh: 0x000a,
    // Cache id=10: float a=-60 b=20 c=1 → dB -60..+20 (capture wrote
    // -30 dB).
    unit: 'db', displayMin: -60, displayMax: 20,
  },
  'compressor.ratio': {
    block: 'compressor', name: 'ratio',
    displayLabel: 'Ratio',
    pidLow: 0x002e, pidHigh: 0x000b,
    // Cache id=11: float a=1 b=20 c=1 step=0.01 → 1.0..20.0 ratio
    // (e.g. 4.0 ⇒ 4:1). Uses the `ratio` unit semantically; math is
    // identical to db/hz/seconds (display = internal, scale 1) but
    // the label tells Claude "4 means 4:1, not 4 dB".
    // BK-038 (Session 43 cont): typecode=64 → log10 scaling. Read
    // register stores Q15 of log10-normalized internal across [1..20].
    unit: 'ratio', displayMin: 1, displayMax: 20, scaling: 'log10',
  },
  'compressor.attack': {
    block: 'compressor', name: 'attack',
    displayLabel: 'Attack Time',
    pidLow: 0x002e, pidHigh: 0x000c,
    // Cache id=12: float a=0.0001 b=0.1 c=1000 → 0.1..100 ms.
    // BK-038 (Session 43 cont): typecode=68 → log10 scaling. Verified
    // empirically — Sultans test wrote 40 ms, readback decoded as 867 ms
    // with old linear rule; with log10 rule, internal 0.867 → 40.0 ms.
    unit: 'ms', displayMin: 0.1, displayMax: 100, scaling: 'log10',
  },
  'compressor.release': {
    block: 'compressor', name: 'release',
    displayLabel: 'Release Time',
    pidLow: 0x002e, pidHigh: 0x000d,
    // Cache id=13: float a=0.002 b=2 c=1000 → 2..2000 ms.
    // BK-038 (Session 43 cont): typecode=68 → log10 scaling. Sultans
    // test wrote 100 ms; readback internal 0.566 → log10 decode → 100 ms.
    unit: 'ms', displayMin: 2, displayMax: 2000, scaling: 'log10',
  },
  'compressor.auto_makeup': {
    block: 'compressor', name: 'auto_makeup',
    displayLabel: 'Auto Makeup',
    pidLow: 0x002e, pidHigh: 0x000f,
    // Cache id=15: enum [OFF|ON]. Hand-authored — see delay.stack_hold
    // for why per-block non-Type enums skip the generator.
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'compressor.type': {
    block: 'compressor', name: 'type',
    pidLow: 0x002e, pidHigh: 0x0013,
    unit: 'enum', displayMin: 0, displayMax: 18,
    enumValues: COMPRESSOR_TYPES_VALUES,
  },
  // HW-028 + HW-039 (Session 35, 2026-04-29): Compressor Expert-Edit
  // Sidechain section + Drive-engine knobs from
  // session-31-comp-jfet-expert.pcapng + paired AM4-Edit screenshot
  // (JFET Studio Compressor type). Closes HW-028: 0x0017 = comp.emphasis
  // (knob_0_20 fine knob 0..20, screenshot 2.22 ↔ wire 0.111×20=2.22);
  // 0x0029 = comp.drive (knob_0_10, screenshot 6.66 ↔ wire 0.666). The
  // Sidechain section pins eight new params (filter Frequency/Q/Gain/
  // Low Cut/High Cut/Source/Filter Type/Emphasis Freq) with cache shapes
  // matching screenshot labels byte-for-byte. bypass_mode (0x0004) and
  // input_level (0x0019) are universal MIX-section enums.
  //
  // Mirrored from CACHE_PARAMS so the type-check picks them up.
  'compressor.bypass_mode': {
    block: 'compressor', name: 'bypass_mode',
    pidLow: 0x002e, pidHigh: 0x0004,
    // Cache id=4: enum [Thru / Mute FX Out / Mute Out]. Hand-authored —
    // not Type, so gen-params skips the enum-import attachment.
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'Thru', 1: 'Mute FX Out', 2: 'Mute Out' },
  },
  'compressor.sidechain_low_cut': {
    block: 'compressor', name: 'sidechain_low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x002e, pidHigh: 0x0011,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'compressor.sidechain_source': {
    block: 'compressor', name: 'sidechain_source',
    displayLabel: 'Sidechain Source',
    pidLow: 0x002e, pidHigh: 0x0012,
    // Cache id=18: enum [BLOCK L+R / INPUT 1 / BLOCK L / BLOCK R].
    // Same enum strings as gate.sidechain (capture wrote index 3 =
    // BLOCK R; matches screenshot "Block R").
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'BLOCK L+R', 1: 'INPUT 1', 2: 'BLOCK L', 3: 'BLOCK R' },
  },
  'compressor.look_ahead_time': {
    block: 'compressor', name: 'look_ahead_time',
    displayLabel: 'Look-Ahead Time',
    pidLow: 0x002e, pidHigh: 0x0015,
    // Cache id=21: float a=0 b=0.002 c=1000 → 0..2 ms (fine resolution).
    unit: 'ms', displayMin: 0, displayMax: 2,
  },
  'compressor.emphasis': {
    block: 'compressor', name: 'emphasis',
    displayLabel: 'Emphasis',
    pidLow: 0x002e, pidHigh: 0x0017,
    // Cache id=23: float a=0 b=1 c=20 step=0.0005 → 0..20 fine knob.
    // First param to use the new `knob_0_20` unit (HW-028 closure).
    unit: 'knob_0_20', displayMin: 0, displayMax: 20,
  },
  'compressor.input_level': {
    block: 'compressor', name: 'input_level',
    displayLabel: 'Input Level',
    pidLow: 0x002e, pidHigh: 0x0019,
    // Cache id=25: enum [INSTRUMENT / LINE]. Capture wrote index 0 =
    // INSTRUMENT; matches screenshot "Instrument".
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'INSTRUMENT', 1: 'LINE' },
  },
  'compressor.sidechain_high_cut': {
    block: 'compressor', name: 'sidechain_high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x002e, pidHigh: 0x001a,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'compressor.sidechain_gain': {
    block: 'compressor', name: 'sidechain_gain',
    displayLabel: 'Gain',
    pidLow: 0x002e, pidHigh: 0x001b,
    unit: 'db', displayMin: -12, displayMax: 12,
  },
  'compressor.sidechain_frequency': {
    block: 'compressor', name: 'sidechain_frequency',
    displayLabel: 'Frequency',
    pidLow: 0x002e, pidHigh: 0x001c,
    unit: 'hz', displayMin: 100, displayMax: 10000,
  },
  'compressor.sidechain_q': {
    block: 'compressor', name: 'sidechain_q',
    displayLabel: 'Q',
    pidLow: 0x002e, pidHigh: 0x001d,
    // Cache id=29: float a=0.1 b=10 c=1 → 0.1..10 fractional Q. Uses
    // `count` for the raw-passthrough scale (display = wire × 1) — the
    // unit is structural; Q is a quality factor, not a literal count.
    unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10',
  },
  'compressor.sidechain_filter_type': {
    block: 'compressor', name: 'sidechain_filter_type',
    displayLabel: 'Filter Type',
    pidLow: 0x002e, pidHigh: 0x0020,
    // HW-039 (closed 2026-04-30): cache id=32 enum has all 12 entries
    // (the earlier "4-entry truncation" finding from Session 35 was a
    // stale parse — `cache-section2.json` confirms count=12, max=11).
    // Hand-authored rather than emitted via gen-params-from-cache because
    // the generator's per-block `enumImport` only targets the Type
    // dropdown (id=19 here); non-Type enums are inlined.
    unit: 'enum', displayMin: 0, displayMax: 11,
    enumValues: {
      0: 'NULL',
      1: 'LOWPASS',
      2: 'BANDPASS',
      3: 'HIGHPASS',
      4: 'LOWSHELF',
      5: 'HIGHSHELF',
      6: 'PEAKING',
      7: 'NOTCH',
      8: 'TILT EQ',
      9: 'LOWSHELF 2',
      10: 'HIGHSHELF 2',
      11: 'PEAKING 2',
    },
  },
  'compressor.sidechain_emphasis_freq': {
    block: 'compressor', name: 'sidechain_emphasis_freq',
    displayLabel: 'Emphasis Freq',
    pidLow: 0x002e, pidHigh: 0x0027,
    unit: 'hz', displayMin: 100, displayMax: 10000,
  },
  'compressor.drive': {
    block: 'compressor', name: 'drive',
    displayLabel: 'Drive',
    pidLow: 0x002e, pidHigh: 0x0029,
    // Cache id=41: float a=0 b=1 c=10 → knob_0_10. HW-021 noted the
    // earlier capture wrote 1.2 (exceeds cache cap b=1) — that capture
    // was one of the AM4-Edit-side wiggles that briefly went past the
    // displayed range; the current capture wire is 0.666 → display 6.66
    // matches screenshot "Drive 6.66" cleanly.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'geq.type': {
    block: 'geq', name: 'type',
    pidLow: 0x0032, pidHigh: 0x0014,
    unit: 'enum', displayMin: 0, displayMax: 17,
    enumValues: GEQ_TYPES_VALUES,
  },
  // Session 18 (continued) — 5 more Type/Mode selectors from block-placement
  // captures. PEQ (pidLow=0x36) and Rotary (pidLow=0x56) are also confirmed
  // block addresses but have no Type enum — their params will be added when
  // we start supporting specific knob names.
  // HW-032 (Session 30 cont 8, 2026-04-25): wire-verified at +12 dB on
  // a Low-Pass filter — `session-32-filter-extended.pcapng`. Follows
  // the universal pidHigh=0x0000 Level pattern.
  'filter.level': {
    block: 'filter', name: 'level',
    pidLow: 0x0072, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'filter.mix': {
    block: 'filter', name: 'mix',
    pidLow: 0x0072, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'filter.type': {
    block: 'filter', name: 'type',
    pidLow: 0x0072, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 17,
    enumValues: FILTER_TYPES_VALUES,
  },
  'filter.freq': {
    // Blocks Guide §Filter: Frequency is the filter cutoff. 20..20000 Hz,
    // c=1 raw (uses 'hz' unit). HW-024 (Session 30 cont 3): wire-verified
    // on Low-Pass at 1250 Hz; readback was 1249.9 Hz. The 0.1 Hz drift is
    // float→fixed-point quantization noise in the firmware (8e-5 relative
    // error), not a wire-layer encoding bug — drift scales with frequency.
    // Functionally inaudible; do not assume exact equality on round-trip
    // when comparing presets that differ only in filter.freq.
    block: 'filter', name: 'freq',
    displayLabel: 'Frequency',
    pidLow: 0x0072, pidHigh: 0x000b,
    unit: 'hz', displayMin: 20, displayMax: 20000,
  },
  // HW-032 (Session 30 cont 8, 2026-04-25): filter Config-page cuts.
  // Wire-verified at 100 Hz / 1800 Hz on a Low-Pass filter
  // (`session-32-filter-extended.pcapng`). Cache c=1 raw Hz at ids
  // 18 / 19. Mirrored from CACHE_PARAMS so the type-check picks them up.
  'filter.low_cut': {
    block: 'filter', name: 'low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x0072, pidHigh: 0x0012,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'filter.high_cut': {
    block: 'filter', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x0072, pidHigh: 0x0013,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  // HW-034 (Session 33, 2026-04-26): All-Pass filter Config-page
  // residuals — `session-33-filter-extended.pcapng`. Wire-verified
  // at 13% Feedback / 4-pole Order. Feedback cache signature
  // (a=-1, b=1, c=100) is bipolar_percent ±100 (All-Pass feedback
  // can invert phase). Order is an integer pole count 1..12 — cache
  // typecode=0x0010 with c=1 raw. AM4-Edit's UI dropdown limits the
  // exposed options per filter type (All-Pass shows 2/4/6/8/10/12;
  // Low-Pass shows 2/4 only at cache id=14), but the wire register
  // accepts any integer in the cache range.
  'filter.feedback': {
    block: 'filter', name: 'feedback',
    displayLabel: 'Feedback',
    pidLow: 0x0072, pidHigh: 0x0015,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'filter.order': {
    block: 'filter', name: 'order',
    displayLabel: 'Order',
    pidLow: 0x0072, pidHigh: 0x001c,
    unit: 'count', displayMin: 1, displayMax: 12,
  },
  'tremolo.mix': {
    block: 'tremolo', name: 'mix',
    pidLow: 0x006a, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'tremolo.type': {
    block: 'tremolo', name: 'type',
    pidLow: 0x006a, pidHigh: 0x000a,
    unit: 'enum', displayMin: 0, displayMax: 6,
    enumValues: TREMOLO_TYPES_VALUES,
  },
  'tremolo.rate': {
    block: 'tremolo', name: 'rate',
    displayLabel: 'Rate',
    pidLow: 0x006a, pidHigh: 0x000c,
    unit: 'hz', displayMin: 0.2, displayMax: 20,
  },
  'tremolo.depth': {
    block: 'tremolo', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x006a, pidHigh: 0x000d,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-022 (Session 31, 2026-04-26): wire-verified on Panner-type
  // tremolo — `session-30-tremolo-basic.pcapng`. Tremolo's first page
  // is type-dependent: Panner exposes Width / Phase / Center / Ducking
  // / Waveform (instead of VCA Trem's Depth which lives at pidHigh
  // 0x000d). Level (pidHigh=0x0000) wasn't moved in this capture — to
  // be added when a future capture wiggles it.
  'tremolo.waveform': {
    block: 'tremolo', name: 'waveform',
    displayLabel: 'Waveform',
    pidLow: 0x006a, pidHigh: 0x000b,
    // Cache id=11 enum: 10-entry LFO_WAVEFORMS — SINE / TRIANGLE /
    // SQUARE / SAW UP / SAW DOWN / RANDOM / LOG / EXP / TRAPEZOID /
    // ASTABLE. Shared dictionary across modulation blocks (extracted
    // from chorus/id=18; cross-checked against flanger/phaser/tremolo).
    unit: 'enum', displayMin: 0, displayMax: 9,
    enumValues: LFO_WAVEFORMS_VALUES,
  },
  'tremolo.phase': {
    block: 'tremolo', name: 'phase',
    displayLabel: 'Phase',
    pidLow: 0x006a, pidHigh: 0x0010,
    // Cache id=16: float a=0 b=π c=180/π → display 0..180 deg.
    unit: 'degrees', displayMin: 0, displayMax: 180,
  },
  'tremolo.width': {
    block: 'tremolo', name: 'width',
    displayLabel: 'Width',
    pidLow: 0x006a, pidHigh: 0x0011,
    // Cache id=17: float a=0 b=4 c=100 — internal range allows up to
    // display 400, but AM4-Edit's Panner Width slider visually caps at
    // 100. Stay at 0..100 here; widen if a future capture proves
    // values >100 are user-reachable.
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'tremolo.center': {
    block: 'tremolo', name: 'center',
    displayLabel: 'Center',
    pidLow: 0x006a, pidHigh: 0x0012,
    // Cache id=18: float a=-1 b=1 c=100 → display -100..+100. Panner
    // center-pan position; 0 = dead center, ±100 = full L/R.
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'tremolo.ducking': {
    block: 'tremolo', name: 'ducking',
    displayLabel: 'Ducking',
    pidLow: 0x006a, pidHigh: 0x0018,
    // Cache id=24: float a=0 b=1 c=10 → display 0..10.
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  // HW-037 (Session 35, 2026-04-29): Enhancer Config-page knobs from
  // session-33-enhancer-extended.pcapng + paired AM4-Edit screenshot.
  // Wire-verified on a Modern enhancer at level=-6 dB / width=33% /
  // depth=11% / low_cut=22.2 Hz / high_cut=6500 Hz. Level is the
  // universal pidHigh=0x0000 out-of-band pattern (no cache record);
  // width/depth/low_cut/high_cut are mirrored from CACHE_PARAMS so
  // the type-check picks them up.
  'enhancer.level': {
    block: 'enhancer', name: 'level',
    pidLow: 0x007a, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'enhancer.width': {
    block: 'enhancer', name: 'width',
    displayLabel: 'Width',
    pidLow: 0x007a, pidHigh: 0x000a,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'enhancer.depth': {
    block: 'enhancer', name: 'depth',
    displayLabel: 'Depth',
    pidLow: 0x007a, pidHigh: 0x000b,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  'enhancer.low_cut': {
    block: 'enhancer', name: 'low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x007a, pidHigh: 0x000c,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'enhancer.high_cut': {
    block: 'enhancer', name: 'high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x007a, pidHigh: 0x000d,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  // HW-024 (Session 30 cont 3) finding F1 — `enhancer.mix` is a phantom
  // register on the AM4 hardware display. The Enhancer block exposes
  // Width / Phase Invert / Pan Left / Pan Right / Balance / Level on
  // its UI pages — no Mix knob anywhere. Wire writes still ack (the
  // SET_PARAM goes through and the firmware accepts it), but the
  // parameter likely has no audible effect. Cache id=1 has the same
  // signature as every other block's `mix` (percent, c=100), which is
  // why P1-010 Session B registered it via the universal Mix-Page rule.
  // Keep registered for now but treat as "wire-acked, no observed
  // hardware effect" — pending an audio-effect spot-check (queued
  // under HW-032 follow-ups).
  'enhancer.mix': {
    block: 'enhancer', name: 'mix',
    pidLow: 0x007a, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-024 (Session 30 cont 3): wire-verified — type "Classic" displayed
  // exactly. AM4-Edit labels this "Mode" on the dropdown but we keep
  // `type` for consistency across blocks.
  'enhancer.type': {
    block: 'enhancer', name: 'type',
    pidLow: 0x007a, pidHigh: 0x000e,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: ENHANCER_TYPES_VALUES,
  },
  // HW-024 (Session 30 cont 3): wire-verified — Modern Gate displayed
  // exactly. Round 4 first-time test for this block type.
  'gate.type': {
    block: 'gate', name: 'type',
    pidLow: 0x0092, pidHigh: 0x0013,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: GATE_TYPES_VALUES,
  },
  // HW-035 (Session 34, 2026-04-26): slot-Gate first-page knobs on a
  // Modern Gate type — `session-34-slotgate-extended.pcapng`. Wire-
  // verified at Threshold=-22 dB / Attack=1 ms / Hold=80 ms /
  // Release=90 ms / Attenuation=-33 dB / Sidechain=INPUT 1 / Level=
  // 12 dB. Threshold/Attack/Hold/Release/Attenuation are mirrored
  // from CACHE_PARAMS. Level (pidHigh=0x0000) follows the universal
  // out-of-band Level pattern. Sidechain (pidHigh=0x000f) is a
  // 4-entry enum sourced directly from cache id=15 enum strings
  // (BLOCK L+R / INPUT 1 / BLOCK L / BLOCK R) — hand-authored
  // because the cache generator only attaches the block-wide
  // GATE_TYPES_VALUES import.
  'gate.level': {
    block: 'gate', name: 'level',
    pidLow: 0x0092, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'gate.threshold': {
    block: 'gate', name: 'threshold',
    displayLabel: 'Threshold',
    pidLow: 0x0092, pidHigh: 0x000a,
    unit: 'db', displayMin: -100, displayMax: 0,
  },
  'gate.attack': {
    block: 'gate', name: 'attack',
    displayLabel: 'Attack',
    pidLow: 0x0092, pidHigh: 0x000b,
    unit: 'ms', displayMin: 0, displayMax: 1000, scaling: 'log10',
  },
  'gate.hold': {
    block: 'gate', name: 'hold',
    displayLabel: 'Hold',
    pidLow: 0x0092, pidHigh: 0x000c,
    unit: 'ms', displayMin: 0, displayMax: 1000, scaling: 'log10',
  },
  'gate.release': {
    block: 'gate', name: 'release',
    displayLabel: 'Release',
    pidLow: 0x0092, pidHigh: 0x000d,
    unit: 'ms', displayMin: 0, displayMax: 1000, scaling: 'log10',
  },
  'gate.sidechain': {
    block: 'gate', name: 'sidechain',
    displayLabel: 'Sidechain',
    pidLow: 0x0092, pidHigh: 0x000f,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'BLOCK L+R', 1: 'INPUT 1', 2: 'BLOCK L', 3: 'BLOCK R' },
  },
  'gate.attenuation': {
    block: 'gate', name: 'attenuation',
    displayLabel: 'Attenuation',
    pidLow: 0x0092, pidHigh: 0x0014,
    unit: 'db', displayMin: -80, displayMax: 0,
  },
  // HW-043 partial (Session 44, 2026-05-02) — slot-Gate Modern Expander
  // Expert-Edit page from `session-44-gate-expert.{pcapng,png}`. 7 new
  // first-page registrations: ratio, sidechain_low_cut, sidechain_high_cut,
  // bypass_mode, knee_type, detector_type, mix-phantom. Modern Expander
  // exposes Ratio at 0x000e (replaces the fixed Attenuation that Modern
  // Gate exposes at 0x0014); same firmware register surface, different
  // type-dependent UI. Knee_type vs detector_type pidHigh assignment
  // disambiguated via single-knob-isolation capture
  // `session-46-gate-knee-isolation.pcapng` — 0x0016 moved (knee_type),
  // 0x0015 stayed (detector_type by elimination). Ratio range 1..20
  // founder-confirmed at the device. See docs/audit-output/gate.md for
  // the full audit table.
  'gate.ratio': {
    block: 'gate', name: 'ratio',
    displayLabel: 'Ratio',
    pidLow: 0x0092, pidHigh: 0x000e,
    unit: 'ratio', displayMin: 1, displayMax: 20, scaling: 'log10',
  },
  'gate.sidechain_low_cut': {
    block: 'gate', name: 'sidechain_low_cut',
    displayLabel: 'Low Cut',
    pidLow: 0x0092, pidHigh: 0x0010,
    unit: 'hz', displayMin: 20, displayMax: 2000,
  },
  'gate.sidechain_high_cut': {
    block: 'gate', name: 'sidechain_high_cut',
    displayLabel: 'High Cut',
    pidLow: 0x0092, pidHigh: 0x0011,
    unit: 'hz', displayMin: 200, displayMax: 20000,
  },
  'gate.bypass_mode': {
    block: 'gate', name: 'bypass_mode',
    pidLow: 0x0092, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  // Detector type at 0x0015: wire 0 displayed as "RMS" in Session 44
  // Modern Expander capture. Likely 2-entry enum {0:RMS, 1:Peak} — only
  // the observed entry is registered until founder confirms the full
  // table.
  'gate.detector_type': {
    block: 'gate', name: 'detector_type',
    displayLabel: 'Detector Type',
    pidLow: 0x0092, pidHigh: 0x0015,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'RMS' },
  },
  // Knee type at 0x0016: wire 4 displayed as "Soft" in Session 44.
  // Likely 5-entry enum {0:Hard, 1:Med Hard, 2:Med, 3:Med Soft, 4:Soft}
  // per typical compressor/gate UX — only the observed entry is
  // registered until founder confirms the full table.
  'gate.knee_type': {
    block: 'gate', name: 'knee_type',
    displayLabel: 'Knee',
    pidLow: 0x0092, pidHigh: 0x0016,
    unit: 'enum', displayMin: 0, displayMax: 4,
    enumValues: { 4: 'Soft' },
  },
  // Phantom register: AM4-Edit displays "NA" for Mix on the Gate block
  // (gate is a dynamics block; absorb-vs-effect doesn't apply). Wire
  // still ack'd but no audible effect — same status as `enhancer.mix`
  // (HW-024 finding F1). Registered for completeness so the agent
  // doesn't surface it as a tweak target on its own.
  'gate.mix': {
    block: 'gate', name: 'mix',
    pidLow: 0x0092, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },
  // HW-024 (Session 30 cont 3): wire-verified — Auto-Swell displayed
  // exactly. Round 4 first-time test for this block type.
  'volpan.mode': {
    // Block is "Volume/Pan"; this is the Volume-vs-Auto-Swell selector.
    block: 'volpan', name: 'mode',
    pidLow: 0x0066, pidHigh: 0x000f,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: VOLPAN_MODES_VALUES,
  },
  // HW-032 (Session 30 cont 8, 2026-04-25): Volume/Pan Auto-Swell
  // envelope params. Wire-verified at -20 dB / 300 ms on the Auto-Swell
  // type (`session-32-volpan-extended.pcapng`). Cache ids 16 / 17 with
  // c=1 (raw dB) and c=1000 (display ms) respectively. Mirrored from
  // CACHE_PARAMS so the type-check picks them up.
  'volpan.threshold': {
    block: 'volpan', name: 'threshold',
    displayLabel: 'Threshold',
    pidLow: 0x0066, pidHigh: 0x0010,
    unit: 'db', displayMin: -100, displayMax: 0,
  },
  'volpan.attack': {
    block: 'volpan', name: 'attack',
    displayLabel: 'Attack',
    pidLow: 0x0066, pidHigh: 0x0011,
    unit: 'ms', displayMin: 1, displayMax: 5000, scaling: 'log10',
  },
  // HW-032 (Session 30 cont 8, 2026-04-25): wire-verified at +12 dB on
  // an Auto-Swell Volume/Pan — `session-32-volpan-extended.pcapng`.
  // Follows the universal pidHigh=0x0000 Level pattern.
  'volpan.level': {
    block: 'volpan', name: 'level',
    pidLow: 0x0066, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  // HW-043 partial (Session 44, 2026-05-02) — Volume/Pan Expert-Edit
  // captures from `session-44-volpan-expert-{volume,autoswell}.{pcapng,png}`.
  // Confirmed type-dependent UI on volpan: Volume mode exposes
  // volume/pan_l/pan_r at 0x000a/c/d; Auto-Swell mode exposes
  // release/hysteresis at 0x0012/0x0013. Both modes share level/balance/
  // mix/bypass_mode/taper/input_select at the same pidHighs. Type-
  // agnostic firmware addressing — same pattern as gate. Hysteresis
  // range 0..12 dB founder-confirmed at the device. See
  // docs/audit-output/volpan-{volume,autoswell}.md for the full audit
  // tables.
  'volpan.volume': {
    block: 'volpan', name: 'volume',
    displayLabel: 'Volume',
    pidLow: 0x0066, pidHigh: 0x000a,
    unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  },
  'volpan.pan_l': {
    block: 'volpan', name: 'pan_l',
    displayLabel: 'Pan Left',
    pidLow: 0x0066, pidHigh: 0x000c,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'volpan.pan_r': {
    block: 'volpan', name: 'pan_r',
    displayLabel: 'Pan Right',
    pidLow: 0x0066, pidHigh: 0x000d,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  // Taper at 0x000b: shared register across Volume + Auto-Swell modes
  // with type-aware enum entries. Volume mode wire=5 → "Log 50";
  // Auto-Swell wire=1 → "Log 30A". Only observed entries registered
  // until founder confirms the full table.
  'volpan.taper': {
    block: 'volpan', name: 'taper',
    displayLabel: 'Taper',
    pidLow: 0x0066, pidHigh: 0x000b,
    unit: 'enum', displayMin: 0, displayMax: 10,
    enumValues: { 1: 'Log 30A', 5: 'Log 50' },
  },
  // Input Select at 0x000e: at minimum 3 entries observed across both
  // mode captures (wire=0 → "Stereo", wire=2 → "Right Only"). Index 1
  // unobserved but plausibly "Left Only". Full enum table needs founder
  // confirmation; registered with the partial mapping.
  'volpan.input_select': {
    block: 'volpan', name: 'input_select',
    displayLabel: 'Input Select',
    pidLow: 0x0066, pidHigh: 0x000e,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'Stereo', 2: 'Right Only' },
  },
  'volpan.bypass_mode': {
    block: 'volpan', name: 'bypass_mode',
    pidLow: 0x0066, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  // Auto-Swell-mode envelope params. Release mirrors attack at 0x0011
  // (same ms-stored-as-seconds + log10 scaling). Hysteresis is a dB
  // knob unique to Auto-Swell — no Volume-mode equivalent. Range
  // 0..12 dB founder-confirmed.
  'volpan.release': {
    block: 'volpan', name: 'release',
    displayLabel: 'Release',
    pidLow: 0x0066, pidHigh: 0x0012,
    unit: 'ms', displayMin: 1, displayMax: 5000, scaling: 'log10',
  },
  'volpan.hysteresis': {
    block: 'volpan', name: 'hysteresis',
    displayLabel: 'Hysteresis',
    pidLow: 0x0066, pidHigh: 0x0013,
    unit: 'db', displayMin: 0, displayMax: 12,
  },
  // Phantom register: AM4-Edit displays "NA" for Mix on Volume/Pan
  // (volpan is a signal-flow / routing block; absorb-vs-effect doesn't
  // apply). Wire still ack'd but no audible effect — same status as
  // `gate.mix` and `enhancer.mix`.
  'volpan.mix': {
    block: 'volpan', name: 'mix',
    pidLow: 0x0066, pidHigh: 0x0001,
    unit: 'percent', displayMin: 0, displayMax: 100,
  },

  // Input Noise Gate (HW-032, Session 30 cont 8). Always-on input stage
  // (per docs/BLOCK-PARAMS.md "Input Noise Gate (global, not a block
  // slot)"); not placeable in any of the 4 effect slots. Distinct from
  // the slot-placeable Gate effect block (pidLow=0x0092).
  // Wire-verified on `session-32-gate-extended.pcapng` against the
  // AM4-Edit "In-Gate" tab on Z04. Captured 4 distinct registers
  // (0x00 / 0x0a / 0x0c / 0x0f); `level` is the only one with a
  // unit-clean encoding so far. Threshold (0x0a, internal 0..1 →
  // display -100..0 dB), Release (0x0c, curve TBD) and Type (0x0f,
  // enum: Classic / Intelligent / Noise Reducer per the manual) need
  // a Unit-extension pass plus a type-walk capture and are queued as
  // HW-034. Pidlow 0x0025 has no cache backing — input gate isn't in
  // any of the 17 cache sub-blocks (none of the section 2 candidates
  // match its 4-register footprint).
  'ingate.level': {
    block: 'ingate', name: 'level',
    pidLow: 0x0025, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  // HW-036 (Session 34, 2026-04-26): In-Gate Config-page residuals
  // from `session-34-inputgate-extended.pcapng`. Wire-verified at
  // Threshold=-44 dB / Release=60 ms / Type=Intelligent on the
  // In-Gate tab. All three were the HW-032 residuals queued for
  // unit + type-walk. Threshold curve is dB-direct (not the 0..1
  // normalized hypothesis from HW-032 — hardware writes raw dB).
  // Release uses the same display=internal × 1000 ms scaling as
  // every other release-style param. Type enum order matches
  // BLOCK-PARAMS.md (Classic Expander / Intelligent / Noise
  // Reducer); wire confirmed index 1 = Intelligent. No cache
  // backing — all hand-authored.
  'ingate.threshold': {
    block: 'ingate', name: 'threshold',
    displayLabel: 'Threshold',
    pidLow: 0x0025, pidHigh: 0x000a,
    unit: 'db', displayMin: -100, displayMax: 0,
  },
  'ingate.release': {
    block: 'ingate', name: 'release',
    displayLabel: 'Release',
    pidLow: 0x0025, pidHigh: 0x000c,
    unit: 'ms', displayMin: 0, displayMax: 1000,
  },
  'ingate.type': {
    block: 'ingate', name: 'type',
    displayLabel: 'Gate Type',
    pidLow: 0x0025, pidHigh: 0x000f,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'Classic Expander', 1: 'Intelligent', 2: 'Noise Reducer' },
  },

  // Universal per-block output Balance (Session 28 cont — P1-010
  // second unit-extension pass, introduced `bipolar_percent`).
  // Blocks Guide line 347: "Every block outputs both left and right
  // signals. As you adjust to the left or right, the opposite channel
  // [is reduced]." Confirmed as a universal block-level parameter at
  // lines 899 (Amp), 1233 (Chorus), 1430 (Flanger), 1733 (Delay),
  // 1883 (Phaser). Cache signature is identical across all 15
  // confirmed blocks: id=2, a=-1, b=1, c=100 (display = internal ×
  // 100, so -100..+100%).
  //
  // Hardware-display visibility per block (HW-014 + HW-024 finding F2):
  //   visible: enhancer.balance (HW-024 at -33%), geq.balance (HW-014
  //     at -67), volpan.balance is type-specific to the Pan range —
  //     classified as an effect-block balance below.
  //   hidden (wire-acked, no display readout): amp / compressor /
  //     reverb / delay / chorus / flanger / phaser / wah / tremolo /
  //     filter / drive / gate / volpan.
  // Visibility is block-type-dependent — the enhancer is a stereo
  // utility block where balance/pan controls are core, while effect
  // blocks treat balance as a hidden output mixer. Hidden writes still
  // affect the stereo image at the audio path (per Blocks Guide line
  // 347 — universal at the firmware level); audio-effect spot-check
  // queued under HW-032.
  'amp.balance':       { block: 'amp',        name: 'balance', pidLow: 0x003a, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'compressor.balance':{ block: 'compressor', name: 'balance', pidLow: 0x002e, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'geq.balance':       { block: 'geq',        name: 'balance', pidLow: 0x0032, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'reverb.balance':    { block: 'reverb',     name: 'balance', pidLow: 0x0042, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'delay.balance':     { block: 'delay',      name: 'balance', pidLow: 0x0046, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'chorus.balance':    { block: 'chorus',     name: 'balance', pidLow: 0x004e, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'flanger.balance':   { block: 'flanger',    name: 'balance', pidLow: 0x0052, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'phaser.balance':    { block: 'phaser',     name: 'balance', pidLow: 0x005a, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'wah.balance':       { block: 'wah',        name: 'balance', pidLow: 0x005e, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'tremolo.balance':   { block: 'tremolo',    name: 'balance', pidLow: 0x006a, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'filter.balance':    { block: 'filter',     name: 'balance', pidLow: 0x0072, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'drive.balance':     { block: 'drive',      name: 'balance', pidLow: 0x0076, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'enhancer.balance':  { block: 'enhancer',   name: 'balance', pidLow: 0x007a, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'gate.balance':      { block: 'gate',       name: 'balance', pidLow: 0x0092, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'volpan.balance':    { block: 'volpan',     name: 'balance', pidLow: 0x0066, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  // HW-040 (Session 36, 2026-04-29): peq + rotary + geq + wah balance
  // mirrors. Plus the new-block universal mix entries.
  'peq.balance':       { block: 'peq',        name: 'balance', pidLow: 0x0036, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'rotary.balance':    { block: 'rotary',     name: 'balance', pidLow: 0x0056, pidHigh: 0x0002, unit: 'bipolar_percent', displayMin: -100, displayMax: 100 },
  'wah.mix':           { block: 'wah',        name: 'mix',     pidLow: 0x005e, pidHigh: 0x0001, unit: 'percent', displayMin: 0, displayMax: 100 },
  'peq.mix':           { block: 'peq',        name: 'mix',     pidLow: 0x0036, pidHigh: 0x0001, unit: 'percent', displayMin: 0, displayMax: 100 },
  'rotary.mix':        { block: 'rotary',     name: 'mix',     pidLow: 0x0056, pidHigh: 0x0001, unit: 'percent', displayMin: 0, displayMax: 100 },
  // GEQ Expert-Edit 10-band mirrors + master_q.
  'geq.mix':           { block: 'geq',        name: 'mix',     pidLow: 0x0032, pidHigh: 0x0001, unit: 'percent', displayMin: 0, displayMax: 100 },
  'geq.band_1':  { block: 'geq', name: 'band_1', displayLabel: '31',  pidLow: 0x0032, pidHigh: 0x000a, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_2':  { block: 'geq', name: 'band_2', displayLabel: '63',  pidLow: 0x0032, pidHigh: 0x000b, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_3':  { block: 'geq', name: 'band_3', displayLabel: '125',  pidLow: 0x0032, pidHigh: 0x000c, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_4':  { block: 'geq', name: 'band_4', displayLabel: '250',  pidLow: 0x0032, pidHigh: 0x000d, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_5':  { block: 'geq', name: 'band_5', displayLabel: '500',  pidLow: 0x0032, pidHigh: 0x000e, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_6':  { block: 'geq', name: 'band_6', displayLabel: '1k',  pidLow: 0x0032, pidHigh: 0x000f, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_7':  { block: 'geq', name: 'band_7', displayLabel: '2k',  pidLow: 0x0032, pidHigh: 0x0010, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_8':  { block: 'geq', name: 'band_8', displayLabel: '4k',  pidLow: 0x0032, pidHigh: 0x0011, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_9':  { block: 'geq', name: 'band_9', displayLabel: '8k',  pidLow: 0x0032, pidHigh: 0x0012, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.band_10': { block: 'geq', name: 'band_10', displayLabel: '16k', pidLow: 0x0032, pidHigh: 0x0013, unit: 'db', displayMin: -12, displayMax: 12 },
  'geq.master_q': { block: 'geq', name: 'master_q', displayLabel: 'Master Q', pidLow: 0x0032, pidHigh: 0x0015, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  // PEQ 5-channel parametric EQ mirrors (frequency / Q / gain × 5 channels).
  'peq.channel_1_frequency': { block: 'peq', name: 'channel_1_frequency', displayLabel: 'Freq 1', pidLow: 0x0036, pidHigh: 0x000a, unit: 'hz', displayMin: 20, displayMax: 2000 },
  'peq.channel_2_frequency': { block: 'peq', name: 'channel_2_frequency', displayLabel: 'Freq 2', pidLow: 0x0036, pidHigh: 0x000b, unit: 'hz', displayMin: 100, displayMax: 10000 },
  'peq.channel_3_frequency': { block: 'peq', name: 'channel_3_frequency', displayLabel: 'Freq 3', pidLow: 0x0036, pidHigh: 0x000c, unit: 'hz', displayMin: 100, displayMax: 10000 },
  'peq.channel_4_frequency': { block: 'peq', name: 'channel_4_frequency', displayLabel: 'Freq 4', pidLow: 0x0036, pidHigh: 0x000d, unit: 'hz', displayMin: 100, displayMax: 10000 },
  'peq.channel_5_frequency': { block: 'peq', name: 'channel_5_frequency', displayLabel: 'Freq 5', pidLow: 0x0036, pidHigh: 0x000e, unit: 'hz', displayMin: 200, displayMax: 20000 },
  'peq.channel_1_q': { block: 'peq', name: 'channel_1_q', displayLabel: 'Q1', pidLow: 0x0036, pidHigh: 0x000f, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'peq.channel_2_q': { block: 'peq', name: 'channel_2_q', displayLabel: 'Q2', pidLow: 0x0036, pidHigh: 0x0010, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'peq.channel_3_q': { block: 'peq', name: 'channel_3_q', displayLabel: 'Q3', pidLow: 0x0036, pidHigh: 0x0011, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'peq.channel_4_q': { block: 'peq', name: 'channel_4_q', displayLabel: 'Q4', pidLow: 0x0036, pidHigh: 0x0012, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'peq.channel_5_q': { block: 'peq', name: 'channel_5_q', displayLabel: 'Q5', pidLow: 0x0036, pidHigh: 0x0013, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'peq.channel_1_gain': { block: 'peq', name: 'channel_1_gain', displayLabel: 'Gain 1', pidLow: 0x0036, pidHigh: 0x0014, unit: 'db', displayMin: -20, displayMax: 20 },
  'peq.channel_2_gain': { block: 'peq', name: 'channel_2_gain', displayLabel: 'Gain 2', pidLow: 0x0036, pidHigh: 0x0015, unit: 'db', displayMin: -20, displayMax: 20 },
  'peq.channel_3_gain': { block: 'peq', name: 'channel_3_gain', displayLabel: 'Gain 3', pidLow: 0x0036, pidHigh: 0x0016, unit: 'db', displayMin: -20, displayMax: 20 },
  'peq.channel_4_gain': { block: 'peq', name: 'channel_4_gain', displayLabel: 'Gain 4', pidLow: 0x0036, pidHigh: 0x0017, unit: 'db', displayMin: -20, displayMax: 20 },
  'peq.channel_5_gain': { block: 'peq', name: 'channel_5_gain', displayLabel: 'Gain 5', pidLow: 0x0036, pidHigh: 0x0018, unit: 'db', displayMin: -20, displayMax: 20 },
  // BK-035 audit (Session 36 cont, 2026-04-29): PEQ Bypass Mode +
  // 5 per-channel Type enums + 5 per-channel Solo toggles. Founder
  // confirmed labels from `session-40-peq-expert.png`. Cache provides
  // each channel's Type enum entries (different shapes per channel —
  // e.g. Channel 3 only has [Peaking, Peaking 2] while Channels 1/5
  // have the full [Shelving, Peaking, Blocking, Shelving 2, Peaking 2]).
  'peq.bypass_mode': {
    block: 'peq', name: 'bypass_mode',
    pidLow: 0x0036, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  'peq.channel_1_type': {
    block: 'peq', name: 'channel_1_type',
    displayLabel: 'Type 1',
    pidLow: 0x0036, pidHigh: 0x0019,
    unit: 'enum', displayMin: 0, displayMax: 4,
    enumValues: { 0: 'Shelving', 1: 'Peaking', 2: 'Blocking', 3: 'Shelving 2', 4: 'Peaking 2' },
  },
  'peq.channel_2_type': {
    block: 'peq', name: 'channel_2_type',
    displayLabel: 'Type 2',
    pidLow: 0x0036, pidHigh: 0x001a,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'Peaking', 1: 'Shelving', 2: 'Shelving 2', 3: 'Peaking 2' },
  },
  'peq.channel_3_type': {
    block: 'peq', name: 'channel_3_type',
    displayLabel: 'Type 3',
    pidLow: 0x0036, pidHigh: 0x001b,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Peaking', 1: 'Peaking 2' },
  },
  'peq.channel_4_type': {
    block: 'peq', name: 'channel_4_type',
    displayLabel: 'Type 4',
    pidLow: 0x0036, pidHigh: 0x001c,
    unit: 'enum', displayMin: 0, displayMax: 3,
    enumValues: { 0: 'Peaking', 1: 'Shelving', 2: 'Shelving 2', 3: 'Peaking 2' },
  },
  'peq.channel_5_type': {
    block: 'peq', name: 'channel_5_type',
    displayLabel: 'Type 5',
    pidLow: 0x0036, pidHigh: 0x001d,
    unit: 'enum', displayMin: 0, displayMax: 4,
    enumValues: { 0: 'Shelving', 1: 'Peaking', 2: 'Blocking', 3: 'Shelving 2', 4: 'Peaking 2' },
  },
  'peq.channel_1_solo': {
    block: 'peq', name: 'channel_1_solo',
    displayLabel: 'Solo',
    pidLow: 0x0036, pidHigh: 0x001e,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'peq.channel_2_solo': {
    block: 'peq', name: 'channel_2_solo',
    displayLabel: 'Solo',
    pidLow: 0x0036, pidHigh: 0x001f,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'peq.channel_3_solo': {
    block: 'peq', name: 'channel_3_solo',
    displayLabel: 'Solo',
    pidLow: 0x0036, pidHigh: 0x0020,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'peq.channel_4_solo': {
    block: 'peq', name: 'channel_4_solo',
    displayLabel: 'Solo',
    pidLow: 0x0036, pidHigh: 0x0021,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  'peq.channel_5_solo': {
    block: 'peq', name: 'channel_5_solo',
    displayLabel: 'Solo',
    pidLow: 0x0036, pidHigh: 0x0022,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'OFF', 1: 'ON' },
  },
  // BK-035 audit (Session 36 cont, 2026-04-29): GEQ Bypass Mode added.
  // GEQ Level was missing too — added via paramNames.ts auto-gen path.
  'geq.bypass_mode': {
    block: 'geq', name: 'bypass_mode',
    pidLow: 0x0032, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Thru', 1: 'Mute' },
  },
  'geq.level': { block: 'geq', name: 'level', pidLow: 0x0032, pidHigh: 0x0000, unit: 'db', displayMin: -80, displayMax: 20 },
  // Rotary cabinet sim mirrors.
  // BK-035 audit (Session 36 cont, 2026-04-29): rotary block had two
  // mis-registered pidHighs (drive ↔ mic_spacing swap) plus 5 unregistered
  // user-facing knobs that the founder's screenshot dictation surfaced:
  //   id 10 (was `drive` count 0..10) → `rate` (Hz, Leslie speed knob —
  //                                     **BK-035 headline gap closed**)
  //   id 21 (was `mic_spacing`)        → `drive` (knob_0_10 0.5..500)
  //   id 16 (NEW)                      → `mic_spacing` (π-encoded scale,
  //                                     unit `rotary_mic_spacing`, 0..100)
  //   id 0 (NEW)                       → `level` (db, -80..20)
  //   id 4 (NEW)                       → `bypass_mode` (enum, hand-authored)
  //   id 14 (NEW)                      → `tempo` (TEMPO_DIVISIONS_VALUES, hand-authored)
  //   id 20 (NEW)                      → `stereo_spread` (bipolar_percent -200..200)
  //   id 23 (NEW)                      → `input_select` (enum [L+R/LEFT/RIGHT], hand-authored)
  'rotary.level': { block: 'rotary', name: 'level', pidLow: 0x0056, pidHigh: 0x0000, unit: 'db', displayMin: -80, displayMax: 20 },
  'rotary.bypass_mode': {
    block: 'rotary', name: 'bypass_mode',
    pidLow: 0x0056, pidHigh: 0x0004,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'Thru', 1: 'Mute FX Out', 2: 'Mute Out' },
  },
  'rotary.rate': { block: 'rotary', name: 'rate', displayLabel: 'Rate', pidLow: 0x0056, pidHigh: 0x000a, unit: 'hz', displayMin: 0, displayMax: 10 },
  'rotary.low_depth': { block: 'rotary', name: 'low_depth', displayLabel: 'Low Depth', pidLow: 0x0056, pidHigh: 0x000b, unit: 'percent', displayMin: 0, displayMax: 100 },
  'rotary.high_depth': { block: 'rotary', name: 'high_depth', displayLabel: 'High Depth', pidLow: 0x0056, pidHigh: 0x000c, unit: 'percent', displayMin: 0, displayMax: 100 },
  'rotary.high_level': { block: 'rotary', name: 'high_level', displayLabel: 'High Level', pidLow: 0x0056, pidHigh: 0x000d, unit: 'db', displayMin: -6, displayMax: 6 },
  'rotary.tempo': {
    block: 'rotary', name: 'tempo',
    displayLabel: 'Tempo',
    pidLow: 0x0056, pidHigh: 0x000e,
    unit: 'enum', displayMin: 0, displayMax: 78,
    enumValues: TEMPO_DIVISIONS_VALUES,
  },
  'rotary.rotor_length': { block: 'rotary', name: 'rotor_length', displayLabel: 'Rotor Length', pidLow: 0x0056, pidHigh: 0x000f, unit: 'percent', displayMin: 0.1, displayMax: 100 },
  'rotary.mic_spacing': { block: 'rotary', name: 'mic_spacing', displayLabel: 'Mic Spacing', pidLow: 0x0056, pidHigh: 0x0010, unit: 'rotary_mic_spacing', displayMin: 0, displayMax: 100 },
  'rotary.low_rate_multiplier': { block: 'rotary', name: 'low_rate_multiplier', displayLabel: 'Low Rate Multiplier', pidLow: 0x0056, pidHigh: 0x0011, unit: 'count', displayMin: 0.1, displayMax: 10, scaling: 'log10' },
  'rotary.low_time_constant': { block: 'rotary', name: 'low_time_constant', displayLabel: 'Low Time Constant', pidLow: 0x0056, pidHigh: 0x0012, unit: 'count', displayMin: 0.1, displayMax: 10 },
  'rotary.high_time_constant': { block: 'rotary', name: 'high_time_constant', displayLabel: 'High Time Constant', pidLow: 0x0056, pidHigh: 0x0013, unit: 'count', displayMin: 0.1, displayMax: 10 },
  'rotary.stereo_spread': { block: 'rotary', name: 'stereo_spread', displayLabel: 'Stereo Spread', pidLow: 0x0056, pidHigh: 0x0014, unit: 'bipolar_percent', displayMin: -200, displayMax: 200 },
  'rotary.drive': { block: 'rotary', name: 'drive', displayLabel: 'Drive', pidLow: 0x0056, pidHigh: 0x0015, unit: 'knob_0_10', displayMin: 0.5, displayMax: 500, scaling: 'log10' /* typecode 80 — HW-053 cont */ },
  'rotary.mic_distance': { block: 'rotary', name: 'mic_distance', displayLabel: 'Mic Distance', pidLow: 0x0056, pidHigh: 0x0016, unit: 'count', displayMin: 0.01, displayMax: 1, scaling: 'log10' },
  'rotary.input_select': {
    block: 'rotary', name: 'input_select',
    displayLabel: 'Input Select',
    pidLow: 0x0056, pidHigh: 0x0017,
    unit: 'enum', displayMin: 0, displayMax: 2,
    enumValues: { 0: 'L+R', 1: 'LEFT', 2: 'RIGHT' },
  },

  // ── Main Levels page — pidLow=0x002A — HW-067a closed Session 84 (2026-05-16) ──
  // Capture: samples/captured/session-84-levels.pcapng. AM4-Edit 2.00 +
  // AM4 firmware 2.00 use action=0x0001 (the standard write action) on
  // this register family — supersedes Session 50's tentative 0x0002.
  // Anchors from screenshot match wire 1:1: preset.level wire 1.1100 →
  // display 1.1 dB; preset.balance wire 0.0222 → display 2.2 (× 100);
  // scene levels wire 3.33/4.44/5.55/6.66 → display 3.3/4.4/5.5/6.7 dB.
  'preset.level': {
    block: 'preset', name: 'level',
    pidLow: 0x002a, pidHigh: 0x0000,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'preset.balance': {
    block: 'preset', name: 'balance',
    pidLow: 0x002a, pidHigh: 0x0002,
    unit: 'bipolar_percent', displayMin: -100, displayMax: 100,
  },
  'preset.scene_1_level': {
    block: 'preset', name: 'scene_1_level',
    pidLow: 0x002a, pidHigh: 0x0018,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'preset.scene_2_level': {
    block: 'preset', name: 'scene_2_level',
    pidLow: 0x002a, pidHigh: 0x0019,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'preset.scene_3_level': {
    block: 'preset', name: 'scene_3_level',
    pidLow: 0x002a, pidHigh: 0x001a,
    unit: 'db', displayMin: -80, displayMax: 20,
  },
  'preset.scene_4_level': {
    block: 'preset', name: 'scene_4_level',
    pidLow: 0x002a, pidHigh: 0x001b,
    unit: 'db', displayMin: -80, displayMax: 20,
  },

  // ── PATCH family — pidLow=0x00CE (cross-references catalog case 0x3c) ──
  // Closed Session 84 (2026-05-16) via samples/captured/session-84-routing-
  // mix-midi.pcapng. Wire shape decoded directly against Ghidra's PATCH
  // catalog: paramId N → pidHigh = N (matching §6p rule for every other
  // AM4 block). Same pidLow already hosts block-placement (pidHigh=
  // 0x0010+slot-1) and preset rename — PATCH is the umbrella family that
  // covers "everything preset-scoped that isn't a block parameter."
  //
  // Confirmed wire values for routing: Series=0.0, Parallel=1.0.
  // Founder toggled FX2/3/4 routing dropdowns in AM4-Edit; each click
  // produced a clean float write whose value matches the on-screen state.
  'preset.routing_slot_2': {
    block: 'preset', name: 'routing_slot_2',
    pidLow: 0x00ce, pidHigh: 0x0014,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Series', 1: 'Parallel' },
  },
  'preset.routing_slot_3': {
    block: 'preset', name: 'routing_slot_3',
    pidLow: 0x00ce, pidHigh: 0x0015,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Series', 1: 'Parallel' },
  },
  'preset.routing_slot_4': {
    block: 'preset', name: 'routing_slot_4',
    pidLow: 0x00ce, pidHigh: 0x0016,
    unit: 'enum', displayMin: 0, displayMax: 1,
    enumValues: { 0: 'Series', 1: 'Parallel' },
  },

  // ── PATCH scene-MIDI — pidLow=0x00CE, base rows 0x40/0x50/0x60 ──
  // Closed Session 85 + 86 (2026-05-16) via:
  //   samples/captured/session-85-scene-midi.pcapng
  //   samples/captured/session-86-scene-midi-disambiguate.pcapng
  //
  // Each scene has 4 MIDI message slots; each slot has 3 fields
  // (Type / Channel / Value). 4×4×3 = 48 wire-addressable params,
  // all on standard SET_PARAM action=0x0001 with hdr4=0x0004 and
  // a packed-float value. NO custom action needed.
  //
  // Wire layout:
  //   pidHigh = base_row + (scene-1)*4 + (msg-1)
  //     base_row 0x40 → Type    (enum; PC=1.0 confirmed)
  //     base_row 0x50 → Channel (1..16, raw int as float)
  //     base_row 0x60 → Value   (0..127, raw int as float)
  //
  // Type enum: only PC=1 is wire-confirmed. The (s=4,m=4) bonus in
  // session-85 showed Type=18.0 for what the founder believed was CC,
  // so CC=18 is hypothesized but not yet locked. A dedicated type-
  // sweep capture (cycle the Type dropdown through all entries on one
  // slot) would harvest the full enum. Treat unknown Type values as
  // raw int passthrough — the encoder will accept any int 0..127.
  //
  // The Session 84 §6n-patch anomaly (pidHigh=0x3e81 action=0x0017)
  // is unrelated to scene-MIDI authoring — it was triggered by a
  // different AM4-Edit operation. Not on this critical path.
  'preset.scene_1_midi_1_type': { block: 'preset', name: 'scene_1_midi_1_type',
    pidLow: 0x00ce, pidHigh: 0x0040, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_1_midi_1_channel': { block: 'preset', name: 'scene_1_midi_1_channel',
    pidLow: 0x00ce, pidHigh: 0x0050, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_1_midi_1_value': { block: 'preset', name: 'scene_1_midi_1_value',
    pidLow: 0x00ce, pidHigh: 0x0060, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_1_midi_2_type': { block: 'preset', name: 'scene_1_midi_2_type',
    pidLow: 0x00ce, pidHigh: 0x0041, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_1_midi_2_channel': { block: 'preset', name: 'scene_1_midi_2_channel',
    pidLow: 0x00ce, pidHigh: 0x0051, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_1_midi_2_value': { block: 'preset', name: 'scene_1_midi_2_value',
    pidLow: 0x00ce, pidHigh: 0x0061, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_1_midi_3_type': { block: 'preset', name: 'scene_1_midi_3_type',
    pidLow: 0x00ce, pidHigh: 0x0042, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_1_midi_3_channel': { block: 'preset', name: 'scene_1_midi_3_channel',
    pidLow: 0x00ce, pidHigh: 0x0052, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_1_midi_3_value': { block: 'preset', name: 'scene_1_midi_3_value',
    pidLow: 0x00ce, pidHigh: 0x0062, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_1_midi_4_type': { block: 'preset', name: 'scene_1_midi_4_type',
    pidLow: 0x00ce, pidHigh: 0x0043, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_1_midi_4_channel': { block: 'preset', name: 'scene_1_midi_4_channel',
    pidLow: 0x00ce, pidHigh: 0x0053, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_1_midi_4_value': { block: 'preset', name: 'scene_1_midi_4_value',
    pidLow: 0x00ce, pidHigh: 0x0063, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_2_midi_1_type': { block: 'preset', name: 'scene_2_midi_1_type',
    pidLow: 0x00ce, pidHigh: 0x0044, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_2_midi_1_channel': { block: 'preset', name: 'scene_2_midi_1_channel',
    pidLow: 0x00ce, pidHigh: 0x0054, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_2_midi_1_value': { block: 'preset', name: 'scene_2_midi_1_value',
    pidLow: 0x00ce, pidHigh: 0x0064, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_2_midi_2_type': { block: 'preset', name: 'scene_2_midi_2_type',
    pidLow: 0x00ce, pidHigh: 0x0045, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_2_midi_2_channel': { block: 'preset', name: 'scene_2_midi_2_channel',
    pidLow: 0x00ce, pidHigh: 0x0055, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_2_midi_2_value': { block: 'preset', name: 'scene_2_midi_2_value',
    pidLow: 0x00ce, pidHigh: 0x0065, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_2_midi_3_type': { block: 'preset', name: 'scene_2_midi_3_type',
    pidLow: 0x00ce, pidHigh: 0x0046, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_2_midi_3_channel': { block: 'preset', name: 'scene_2_midi_3_channel',
    pidLow: 0x00ce, pidHigh: 0x0056, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_2_midi_3_value': { block: 'preset', name: 'scene_2_midi_3_value',
    pidLow: 0x00ce, pidHigh: 0x0066, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_2_midi_4_type': { block: 'preset', name: 'scene_2_midi_4_type',
    pidLow: 0x00ce, pidHigh: 0x0047, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_2_midi_4_channel': { block: 'preset', name: 'scene_2_midi_4_channel',
    pidLow: 0x00ce, pidHigh: 0x0057, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_2_midi_4_value': { block: 'preset', name: 'scene_2_midi_4_value',
    pidLow: 0x00ce, pidHigh: 0x0067, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_3_midi_1_type': { block: 'preset', name: 'scene_3_midi_1_type',
    pidLow: 0x00ce, pidHigh: 0x0048, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_3_midi_1_channel': { block: 'preset', name: 'scene_3_midi_1_channel',
    pidLow: 0x00ce, pidHigh: 0x0058, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_3_midi_1_value': { block: 'preset', name: 'scene_3_midi_1_value',
    pidLow: 0x00ce, pidHigh: 0x0068, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_3_midi_2_type': { block: 'preset', name: 'scene_3_midi_2_type',
    pidLow: 0x00ce, pidHigh: 0x0049, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_3_midi_2_channel': { block: 'preset', name: 'scene_3_midi_2_channel',
    pidLow: 0x00ce, pidHigh: 0x0059, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_3_midi_2_value': { block: 'preset', name: 'scene_3_midi_2_value',
    pidLow: 0x00ce, pidHigh: 0x0069, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_3_midi_3_type': { block: 'preset', name: 'scene_3_midi_3_type',
    pidLow: 0x00ce, pidHigh: 0x004a, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_3_midi_3_channel': { block: 'preset', name: 'scene_3_midi_3_channel',
    pidLow: 0x00ce, pidHigh: 0x005a, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_3_midi_3_value': { block: 'preset', name: 'scene_3_midi_3_value',
    pidLow: 0x00ce, pidHigh: 0x006a, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_3_midi_4_type': { block: 'preset', name: 'scene_3_midi_4_type',
    pidLow: 0x00ce, pidHigh: 0x004b, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_3_midi_4_channel': { block: 'preset', name: 'scene_3_midi_4_channel',
    pidLow: 0x00ce, pidHigh: 0x005b, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_3_midi_4_value': { block: 'preset', name: 'scene_3_midi_4_value',
    pidLow: 0x00ce, pidHigh: 0x006b, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_4_midi_1_type': { block: 'preset', name: 'scene_4_midi_1_type',
    pidLow: 0x00ce, pidHigh: 0x004c, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_4_midi_1_channel': { block: 'preset', name: 'scene_4_midi_1_channel',
    pidLow: 0x00ce, pidHigh: 0x005c, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_4_midi_1_value': { block: 'preset', name: 'scene_4_midi_1_value',
    pidLow: 0x00ce, pidHigh: 0x006c, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_4_midi_2_type': { block: 'preset', name: 'scene_4_midi_2_type',
    pidLow: 0x00ce, pidHigh: 0x004d, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_4_midi_2_channel': { block: 'preset', name: 'scene_4_midi_2_channel',
    pidLow: 0x00ce, pidHigh: 0x005d, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_4_midi_2_value': { block: 'preset', name: 'scene_4_midi_2_value',
    pidLow: 0x00ce, pidHigh: 0x006d, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_4_midi_3_type': { block: 'preset', name: 'scene_4_midi_3_type',
    pidLow: 0x00ce, pidHigh: 0x004e, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_4_midi_3_channel': { block: 'preset', name: 'scene_4_midi_3_channel',
    pidLow: 0x00ce, pidHigh: 0x005e, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_4_midi_3_value': { block: 'preset', name: 'scene_4_midi_3_value',
    pidLow: 0x00ce, pidHigh: 0x006e, unit: 'count', displayMin: 0, displayMax: 127 },
  'preset.scene_4_midi_4_type': { block: 'preset', name: 'scene_4_midi_4_type',
    pidLow: 0x00ce, pidHigh: 0x004f, unit: 'enum', displayMin: 0, displayMax: 129, enumValues: SCENE_MIDI_TYPE_ENUM },
  'preset.scene_4_midi_4_channel': { block: 'preset', name: 'scene_4_midi_4_channel',
    pidLow: 0x00ce, pidHigh: 0x005f, unit: 'count', displayMin: 1, displayMax: 16 },
  'preset.scene_4_midi_4_value': { block: 'preset', name: 'scene_4_midi_4_value',
    pidLow: 0x00ce, pidHigh: 0x006f, unit: 'count', displayMin: 0, displayMax: 127 },
} as const satisfies Record<string, Param>;

export type ParamKey = keyof typeof KNOWN_PARAMS;
