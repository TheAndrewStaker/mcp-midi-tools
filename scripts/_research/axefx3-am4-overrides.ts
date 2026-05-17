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
  HFRATIO: 'hf_ratio',
  LFTIME: 'lf_time',
  LFXOVER: 'lf_xover',
  PREDELAY: 'predelay',
  NUMSPRINGS: 'springs',
  INPDIFF: 'input_diffusion',
  INDIFFTIME: 'input_diff_time',
  EARLYLEVEL: 'early_level',
  EARLYDIFF: 'early_diffusion',
  EARLYDIFFTIME: 'early_diff_time',
  EARLYDECAY: 'early_decay',
  EARLYSEND: 'early_send',
  LFOPHASE: 'lfo_phase',
  REVERBLEVEL: 'reverb_level',
  REVERBDELAY: 'reverb_delay',
  INPUTSELECT: 'input_select',
  LOWSLOPE: 'low_slope',
  HIGHSLOPE: 'high_slope',
  BASETYPE: 'base_type',
  SHIFT1: 'shift_1',
  SHIFT2: 'shift_2',
  SPRINGTYPE: 'spring_type',
  TONETYPE: 'tone_type',
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
  TEMPOR: 'tempo_r',
  TEMPOL: 'tempo_l',
  PANL: 'pan_l',
  PANR: 'pan_r',
  LOWQ: 'low_q',
  HIGHQ: 'high_q',
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
 * Parse `packages/am4/src/cacheParams.ts` for `block`, `name`, `unit`,
 * `displayMin`, `displayMax`, `scaling`.
 *
 * Parses by regex against the literal entry shape the generator emits
 * — no TS compiler / AST walk. The cacheParams generator owns the
 * file format (see `scripts/gen-params-from-cache.ts`), and the
 * shape is uniform: each entry is a 3- or 4-line block with `block:`
 * `name:` on line 2, `pidLow:` `pidHigh:` on line 3, `unit:`
 * `displayMin:` `displayMax:` on line 4, optional `scaling:` /
 * `enumValues:` on line 5.
 *
 * The regex matches that shape and tolerates extra trailing fields.
 * If the cacheParams emit format changes, this parser breaks loudly
 * (the generator below would emit zero overrides) — easy to detect.
 */
export function loadAm4ParamOverrides(): Map<string, Am4Override> {
  const src = readFileSync(AM4_CACHE_PARAMS_PATH, 'utf8');

  const result = new Map<string, Am4Override>();

  // Entry shape:
  //   'amp.gain': {
  //     block: 'amp', name: 'gain',
  //     pidLow: 0x003a, pidHigh: 0x000b,
  //     unit: 'knob_0_10', displayMin: 0, displayMax: 10,
  //     [optional `scaling: 'log10',`]
  //     [optional `enumValues: AMP_TYPES_VALUES,`]
  //   },
  //
  // We capture block/name/unit/displayMin/displayMax/scaling/has-enum.
  const entryRe = new RegExp(
    [
      // header line - 'amp.gain': {
      String.raw`'(?<key>[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)':\s*\{`,
      // block + name line
      String.raw`\s*block:\s*'(?<block>[a-z][a-z0-9_]*)',\s*name:\s*'(?<name>[a-z][a-z0-9_]*)',`,
      // pidLow + pidHigh line (we don't need the values for porting)
      String.raw`\s*pidLow:\s*0x[0-9a-fA-F]+,\s*pidHigh:\s*0x[0-9a-fA-F]+,`,
      // unit + displayMin + displayMax line. unit names mix lowercase
      // letters + digits + underscores (e.g. `knob_0_10`). displayMin/
      // Max can be negative or fractional, so capture as a signed
      // numeric.
      String.raw`\s*unit:\s*'(?<unit>[a-z][a-z0-9_]*)',\s*displayMin:\s*(?<displayMin>-?\d+(?:\.\d+)?),\s*displayMax:\s*(?<displayMax>-?\d+(?:\.\d+)?),`,
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
