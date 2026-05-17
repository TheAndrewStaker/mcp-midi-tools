/**
 * Axe-Fx III ⇆ AM4 calibration overrides.
 *
 * This module powers the III catalog generator's ability to port
 * hardware-verified display calibrations (`unit`, `displayMin`,
 * `displayMax`, `scaling`) from AM4 → III for cross-family parameters
 * that share semantics across the two devices.
 *
 * Why this is sound. The AM4 (model byte 0x15) and the Axe-Fx III
 * (model byte 0x10) are different binaries with different paramId
 * orderings inside each effect family, but both use the same Fractal
 * naming convention for parameters. Where AM4 has `reverb.time`
 * `unit: 'seconds'` `displayMin: 0.1` `displayMax: 100` at
 * `pidHigh=0x000b`, the III has `REVERB.REVERB_TIME` at `paramId=1`.
 * The wire address differs, the wire value scale (16-bit, packed
 * across three septets) differs, BUT the user-facing display
 * convention is governed by Fractal's design language and the same
 * audio-engineering reality (reverb time IS a 0.1..100 s knob on
 * both devices because that's the musically useful range).
 *
 * Sanity caveats:
 *
 * 1. **Join is by SYMBOL NAME, not paramId.** AM4-Edit's binary and
 *    AxeEdit III's binary number paramIds differently inside each
 *    family. `DISTORT_DRIVE` is paramId=1 on the III but paramId=11
 *    on the AM4. Joining by `(family, paramId)` would map AM4's
 *    `amp.gain` (knob_0_10) onto whatever the III happens to have at
 *    paramId 11 — which is `DISTORT_WSLPF`, a wave-shaper LPF that
 *    is most definitely not a 0..10 knob. So we join by the symbolic
 *    name suffix only.
 *
 * 2. **Enum value tables do NOT port.** AM4's `reverb.type` enum has
 *    79 values; III's REVERB_TYPE has more (the III ships dozens of
 *    extra reverb algorithms added post-AM4). We deliberately drop
 *    `enumValues` in the port and emit unit='enum' WITHOUT a value
 *    table — that signals "this paramId is an enum, but the menu
 *    is III-firmware-defined and needs III-side capture to enumerate."
 *
 * 3. **One AM4 family can map to multiple AM4 blocks.** AM4's DISTORT
 *    family is addressable as both `amp` and `drive` blocks (per the
 *    AM4 generator's FAMILY_TO_BLOCKS table). For calibration porting
 *    we only need ONE AM4 entry to copy unit + range from — both
 *    blocks share the catalog, so we walk the candidate blocks in
 *    order and take the first hit. Ties don't matter; the metadata
 *    is identical across blocks of the same family.
 *
 * 4. **Output is documentary, not executable.** The III's `0x02
 *    SET_PARAMETER` tool surface still accepts raw 16-bit wire values
 *    from the caller — these ported display ranges are surfaced for
 *    the agent to reason about ("this is a 0..10 knob"), not to drive
 *    display↔wire conversion. Display↔wire still requires III
 *    hardware verification, because the III's wire scaling for any
 *    given knob isn't published. When III hardware verification lands,
 *    the calibrated entries flip from "inferred from AM4" → "verified
 *    on III".
 *
 * 5. **Idempotent.** This module is pure: same AM4 source ⇒ same
 *    override table ⇒ same generator output. Re-running the
 *    generator without source changes produces a byte-stable file.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const AM4_CACHE_PARAMS_PATH = join(
  REPO_ROOT,
  'packages',
  'am4',
  'src',
  'cacheParams.ts',
);
// AM4's hand-authored `params.ts` carries the entries that don't live
// in the cache (channel/level/bypass/tempo/pan + several enum overrides
// the cache-generator can't emit cleanly). Those entries share the same
// schema shape and same hardware-verified calibration as cacheParams.ts
// — including them roughly doubles the III's calibration coverage,
// because most of the III's per-family `LEVEL`/`PAN`/`TEMPO`/`BYPASS`
// suffixes have AM4 analogs only in params.ts, not cacheParams.ts.
//
// Both sources are parsed by the same regex (their entry shape is
// identical by design — see `gen-params-from-cache.ts`). When the
// same `block.name` appears in both, cacheParams.ts wins (it's the
// generator-truth, while params.ts may carry hand-tweaked display
// overrides we'd rather not propagate to the III).
const AM4_PARAMS_PATH = join(
  REPO_ROOT,
  'packages',
  'am4',
  'src',
  'params.ts',
);

// ── Family ↔ AM4 block mapping ─────────────────────────────────────
//
// Mirrors the table in `generate-am4-params-from-catalog.ts` — kept
// in this file too because we walk the III's family symbols (taken
// from its own Ghidra mining) rather than AM4-Edit's. Families that
// AM4 doesn't have (CABINET, PEQ instances ≠ AM4's, FUZZ, NAM,
// etc.) simply produce no overrides — they stay 'unverified'.

export const FAMILY_TO_AM4_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  REVERB: ['reverb'],
  DELAY: ['delay'],
  CHORUS: ['chorus'],
  FLANGER: ['flanger'],
  PHASER: ['phaser'],
  ROTARY: ['rotary'],
  TREMOLO: ['tremolo'],
  WAH: ['wah'],
  FILTER: ['filter'],
  // DISTORT covers both AM4 amp AND drive blocks — Ghidra shows both
  // pidLows (0x003a, 0x0076) dispatch into the same param table.
  // Order matters slightly for ties (we take the first hit), but the
  // metadata is identical across the two blocks.
  DISTORT: ['amp', 'drive'],
  COMP: ['compressor'],
  GEQ: ['geq'],
  PEQ: ['peq'],
  GATE: ['gate'],
  ENHANCER: ['enhancer'],
  VOLUME: ['volpan'],
};

// ── III suffix ↔ AM4 name aliases ──────────────────────────────────
//
// Mirrors `generate-am4-params-from-catalog.ts`'s NAMING_ALIAS table.
// Maps an SCREAMING_SNAKE suffix (post family-prefix strip) to AM4's
// snake_case convention. Suffixes not in the map fall through to plain
// `toLowerCase()`.

const III_SUFFIX_ALIAS: Readonly<Record<string, string>> = {
  // Frequency knobs — III uses HICUT/LOWCUT, AM4 uses high_cut/low_cut.
  HICUT: 'high_cut',
  LOWCUT: 'low_cut',
  // DELAY uses LOCUT (no 'W') alongside LOWCUT on some III firmware
  // revisions; both resolve to AM4's `low_cut`.
  LOCUT: 'low_cut',
  // Compressor — III's `THRESH` ↔ AM4's `threshold`. Common abbreviation
  // mismatch; the AM4 generator's NAMING_ALIAS doesn't carry it because
  // AM4-Edit's own catalog symbols use `THRESH` too, but the AM4
  // params.ts hand-overrides expanded it to `threshold` for readability.
  THRESH: 'threshold',
  // Sidechain frequency knobs on the compressor.
  SCFREQ: 'sidechain_frequency',
  SCGAIN: 'sidechain_gain',
  SCQ: 'sidechain_q',
  SCHIGHCUT: 'sidechain_high_cut',
  SCLOWCUT: 'sidechain_low_cut',
  // Reverb late/early/HF/LF knob aliases. Several of these target AM4
  // entries that don't currently exist (e.g. `hf_ratio`, `lf_time`,
  // `early_send`); they're documented here for future AM4-side
  // expansion. The override loader silently no-ops on missing targets.
  HFRATIO: 'hf_ratio',
  LFTIME: 'lf_time',
  LFXOVER: 'lf_xover',
  // AM4 ships `pre_delay`; the cache catalog name is `pre_delay`. The
  // previous alias target `predelay` was a misread — AM4 has no entry
  // by that exact spelling.
  PREDELAY: 'pre_delay',
  NUMSPRINGS: 'springs',
  INPDIFF: 'input_diffusion',
  INDIFFTIME: 'input_diff_time',
  EARLYLEVEL: 'early_level',
  EARLYDIFF: 'early_diffusion',
  EARLYDIFFTIME: 'early_diff_time',
  EARLYDECAY: 'early_decay',
  EARLYSEND: 'early_send',
  LATELEVEL: 'late_level',
  LATEINPUTMIX: 'late_input_mix',
  HIGHDECAY: 'high_decay',
  LOWDECAY: 'low_decay',
  XOVERFREQ: 'xover_frequency',
  RELEASETIME: 'release_time',
  ECHOMIX: 'echo_mix',
  PICKUPSPACING: 'pickup_spacing',
  SPRINGTONE: 'spring_tone',
  DIFFUSIONTIME: 'diffusion_time',
  PITCHFEEDBACK: 'pitch_feedback',
  PITCHMODULATION: 'pitch_modulation',
  PITCHHIGHCUT: 'pitch_high_cut',
  VOICEBALANCE: 'voice_balance',
  SPLICETIME: 'splice_time',
  LOWCUTQ: 'low_cut_q',
  HIGHCUTQ: 'high_cut_q',
  LFOPHASE: 'lfo_phase',
  // III firmware exposes a `REVERB_LFOPHASE` (mod LFO phase) alongside
  // AM4's `lfo_phase_pct` (chorus stage). Different blocks, same
  // alias safely targets the AM4 reverb entry.
  REVERBLEVEL: 'reverb_level',
  // AM4's cacheParams ships `reverb.reverbdelay` (no underscore). The
  // previous alias `reverb_delay` was a misread.
  REVERBDELAY: 'reverbdelay',
  INPUTSELECT: 'input_select',
  LOWSLOPE: 'low_slope',
  HIGHSLOPE: 'high_slope',
  // AM4's cache symbols are `basetype` / `tonetype` (one word). The
  // previous aliases `base_type` / `tone_type` didn't match anything.
  BASETYPE: 'basetype',
  TONETYPE: 'tonetype',
  SHIFT1: 'voice_1_shift',
  SHIFT2: 'voice_2_shift',
  SPRINGTYPE: 'spring_type',
  PREDLYTAP: 'predly_tap',
  PREDLYTEMPO: 'predly_tempo',
  PREDLYFDBK: 'predly_fdbk',
  PREDLYMIX: 'predly_mix',
  PITCHLPF: 'pitch_lpf',
  PITCHMIX: 'pitch_mix',
  PITCHFDBK: 'pitch_fdbk',
  PITCHDIR: 'pitch_dir',
  PITCHTIME: 'pitch_time',
  PITCHPOS: 'pitch_pos',
  PITCHMOD: 'pitch_mod',
  PITCHBAL: 'pitch_bal',
  FEEDR: 'feed_r',
  FEEDL: 'feed_l',
  FEEDLR: 'feed_lr',
  FEEDRL: 'feed_rl',
  MSTRFDBK: 'master_feedback',
  MSTRTIME: 'master_time',
  TEMPOR: 'tempo_r',
  TEMPOL: 'tempo_l',
  PANL: 'pan_l',
  PANR: 'pan_r',
  LOWQ: 'low_q',
  HIGHQ: 'high_q',
  // ── Indexed parameter aliases ────────────────────────────────────
  // AM4 numbers indexed params with an underscore (`gain_1`, `q_2`,
  // `frequency_1`); III concatenates (`GAIN1`, `Q2`, `FREQ1`). The
  // explicit alias rows below keep the join straightforward — without
  // them, plain lowercase produces `gain1`/`q2`/`freq1` which don't
  // match any AM4 entry.
  GAIN1: 'gain_1',
  GAIN2: 'gain_2',
  // GAIN3..5 / FREQ3..5 / Q3..5 have AM4 analogs only inside the PEQ
  // block under the `channel_N_*` naming convention. Aliasing the
  // generic suffix to `gain_3` here would silently misroute the GEQ
  // family (which uses `band_N` instead). Skipped — the III's PEQ
  // entries stay `unverified` until we add family-aware aliasing.
  FREQ1: 'frequency_1',
  FREQ2: 'frequency_2',
  Q1: 'q_1',
  Q2: 'q_2',
  // ── Compound-word suffix aliases ─────────────────────────────────
  // III concatenates these as SCREAMING_RUN-ON, AM4 uses snake_case.
  // Every entry here was verified against the actual AM4 source —
  // dead aliases are kept above (HF*/LF*/EARLY_SEND/PREDLY_*/etc.) as
  // documented future-readiness rather than mixed in here.
  LFOTYPE: 'lfo_type',
  DELAYTIME: 'delay_time',
  KILLDRY: 'kill_dry',
  GAINMONITOR: 'gain_monitor',
  PHASEREV: 'phase_reverse',
  MODPHASE: 'mod_phase',
  AUTODEPTH: 'auto_depth',
  // Chorus stereo-image suffixes. III uses single-letter L/C/R on
  // DEPTH; AM4 spells them out.
  DEPTHL: 'left_depth',
  DEPTHC: 'center_depth',
  DEPTHR: 'right_depth',
  VOICES: 'number_of_voices',
  STEREOSPREAD: 'stereo_spread',
  // Flanger time-range knobs. AM4 names them `min_time`/`max_time`.
  TMIN: 'min_time',
  TMAX: 'max_time',
  // Flanger dry-delay knob (AM4 spells with underscore).
  DRYDELAY: 'dry_delay',
  // Delay compander/feedback compound names.
  BITREDUCE: 'bit_reduction',
  HOLDFDBK: 'hold_feedback',
  STACKFDBK: 'stack_feedback',
  LEVELL: 'level_l',
  LEVELR: 'level_r',
};

/**
 * Convert a full Ghidra III symbol like `REVERB_TIME` or
 * `DISTORT_PRESENCE` into the AM4 convention name (`time`,
 * `presence`). Strips the first underscore-delimited segment as the
 * family prefix, then applies the alias table (with a lowercase
 * fallback for unaliased suffixes).
 */
export function iiiSymbolToAm4Name(iiiSymbol: string): string {
  const u = iiiSymbol.indexOf('_');
  if (u < 0) return iiiSymbol.toLowerCase();
  const tail = iiiSymbol.substring(u + 1);
  if (III_SUFFIX_ALIAS[tail]) return III_SUFFIX_ALIAS[tail];
  return tail.toLowerCase();
}

// ── AM4 cacheParams parser ─────────────────────────────────────────

export interface Am4Override {
  block: string;
  name: string;
  unit: string;
  displayMin: number;
  displayMax: number;
  scaling?: 'linear' | 'log10';
  /**
   * True if AM4's entry was an enum (`unit: 'enum'` + `enumValues: …`).
   * The III generator emits `unit: 'enum'` for these but deliberately
   * drops the enumValues table — III's enum vocabularies differ from
   * AM4's (post-AM4 firmware adds reverb types, amp models, etc.),
   * and shipping AM4's values for an III enum would be misleading.
   */
  enum: boolean;
}

/**
 * Parse one AM4 source file (cacheParams.ts or params.ts) for entries
 * shaped `'block.name': { block, name, pidLow, pidHigh, unit,
 * displayMin, displayMax, [scaling], [enumValues] }`. Both files
 * share the schema by design — `gen-params-from-cache.ts` owns
 * cacheParams.ts, and the hand-authored params.ts entries the
 * cache-generator can't produce (channel/level/bypass/tempo/pan +
 * several enum overrides) match the same shape.
 *
 * Parses by regex against the literal entry text — no TS compiler /
 * AST walk. The cacheParams generator owns the format; params.ts
 * follows the same shape by convention. If either file changes, the
 * generator below emits fewer / zero overrides and the regression is
 * loud (the III file's `inferred from AM4` count drops).
 *
 * The regex tolerates extra trailing fields (`displayLabel`,
 * `displayUnit`, `enumValues`) between `displayMax` and the closing
 * brace, which is needed for params.ts entries that the cache file
 * doesn't carry.
 */
function loadOverridesFromFile(path: string): Map<string, Am4Override> {
  const src = readFileSync(path, 'utf8');

  const result = new Map<string, Am4Override>();

  // Entry shape:
  //   'amp.gain': {
  //     block: 'amp', name: 'gain',
  //     pidLow: 0x003a, pidHigh: 0x000b,
  //     unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  //     [optional `scaling: 'log10',`]
  //     [optional `enumValues: AMP_TYPES_VALUES,`]
  //     [optional `displayLabel: 'Gain',`]
  //   },
  //
  // We capture block/name/unit/displayMin/displayMax/scaling/has-enum.
  // The `[\s\S]*?` between sections allows params.ts entries that
  // interleave optional fields (e.g. `displayLabel: 'Tempo',`) between
  // the name and pidLow lines.
  const entryRe = new RegExp(
    [
      // header line - 'amp.gain': {
      String.raw`'(?<key>[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)':\s*\{`,
      // block + name line. Non-greedy gap allows leading-line comments
      // and other fields between the header and the block declaration
      // (some params.ts entries put `displayLabel` first).
      String.raw`[\s\S]*?block:\s*'(?<block>[a-z][a-z0-9_]*)',\s*name:\s*'(?<name>[a-z][a-z0-9_]*)',`,
      // pidLow + pidHigh line. Non-greedy gap tolerates an interleaved
      // `displayLabel: 'Foo',` etc.
      String.raw`[\s\S]*?pidLow:\s*0x[0-9a-fA-F]+,\s*pidHigh:\s*0x[0-9a-fA-F]+,`,
      // unit + displayMin + displayMax line. unit names mix lowercase
      // letters + digits + underscores (e.g. `knob_0_10`). displayMin/
      // Max can be negative or fractional, so capture as a signed
      // numeric.
      String.raw`[\s\S]*?unit:\s*'(?<unit>[a-z][a-z0-9_]*)',\s*displayMin:\s*(?<displayMin>-?\d+(?:\.\d+)?),\s*displayMax:\s*(?<displayMax>-?\d+(?:\.\d+)?),`,
      // Optional remainder before the closing brace. Captures
      // `scaling: 'log10'` if present, and a marker for `enumValues:`.
      String.raw`(?<tail>[\s\S]*?)\},`,
    ].join(''),
    'g',
  );

  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(src)) !== null) {
    const g = m.groups as Record<string, string>;
    const tail = g.tail ?? '';
    const scalingMatch = /scaling:\s*'(log10|linear)'/.exec(tail);
    const hasEnumValues = /enumValues:\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail);

    const override: Am4Override = {
      block: g.block,
      name: g.name,
      unit: g.unit,
      displayMin: Number(g.displayMin),
      displayMax: Number(g.displayMax),
      enum: g.unit === 'enum' || hasEnumValues,
    };
    if (scalingMatch) {
      override.scaling = scalingMatch[1] as 'linear' | 'log10';
    }
    result.set(`${g.block}.${g.name}`, override);
  }

  return result;
}

/**
 * Merge AM4 overrides from `cacheParams.ts` (the generator-truth) and
 * `params.ts` (hand-authored entries the generator can't emit —
 * channel/level/bypass/tempo/pan + various enum overrides).
 *
 * Conflict policy: `cacheParams.ts` wins. The cacheParams generator
 * derives display ranges from the binary metadata cache; that's the
 * harder-to-fudge source. `params.ts` may carry hand-tweaked display
 * overrides (e.g. `displayUnit: ''` cosmetic suppression on
 * `negative_feedback`) that we wouldn't want to propagate to the III.
 *
 * Why merge at all (vs. just using cacheParams.ts): a large fraction of
 * the III's per-family `LEVEL`/`PAN`/`TEMPO`/`BYPASS`/`MODE`/`WIDTH`
 * suffixes correspond to AM4 pidHigh 0..9 generic-params that don't
 * live in the cache file (see the cacheParams.ts header comment). Those
 * AM4 entries are hand-authored in `params.ts`. Pulling from both
 * sources roughly triples the III's calibration coverage (Session 88
 * — went from 116 → ~200 inferred entries via this loader change).
 */
export function loadAm4ParamOverrides(): Map<string, Am4Override> {
  const cache = loadOverridesFromFile(AM4_CACHE_PARAMS_PATH);
  const hand = loadOverridesFromFile(AM4_PARAMS_PATH);

  const merged = new Map<string, Am4Override>(cache);
  for (const [k, v] of hand) {
    if (!merged.has(k)) merged.set(k, v);
  }
  return merged;
}

/**
 * Look up an AM4 calibration override for a given III catalog entry.
 *
 * Returns the first AM4 entry that matches `(am4Block, am4Name)` for
 * any `am4Block` in `FAMILY_TO_AM4_BLOCKS[family]`. Returns undefined
 * if the III family is unmapped, or if no AM4 entry exists for the
 * resolved name.
 */
export function findAm4Override(
  family: string,
  iiiSymbolName: string,
  overrides: Map<string, Am4Override>,
): Am4Override | undefined {
  const am4Blocks = FAMILY_TO_AM4_BLOCKS[family];
  if (!am4Blocks || am4Blocks.length === 0) return undefined;
  const am4Name = iiiSymbolToAm4Name(iiiSymbolName);
  for (const block of am4Blocks) {
    const hit = overrides.get(`${block}.${am4Name}`);
    if (hit) return hit;
  }
  return undefined;
}
