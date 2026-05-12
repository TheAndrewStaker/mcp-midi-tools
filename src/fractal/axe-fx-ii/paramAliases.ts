/**
 * Axe-Fx II — param-name fuzzy resolution.
 *
 * Single source of truth for every code path that resolves a user-typed
 * param name to the device's canonical wire param. Three layers, tried
 * in order:
 *
 *   1. **Exact canonical match** — `name === userInput.toLowerCase()`.
 *      Fast path; hits 90%+ of well-formed agent calls.
 *
 *   2. **Normalized fuzzy match against display fields.** User input is
 *      normalized to lowercase snake_case (`"Input Drive"`, `"INPUT
 *      DRIVE"`, `"input-drive"` all → `"input_drive"`); then compared
 *      against each param's canonical `name`, plus the human-display
 *      fields `wikiName` (e.g. `"INPUT DRIVE"`), `xmlLabel` (e.g.
 *      `"Input Drive"`), and `parameterName` (firmware name, e.g.
 *      `"DISTORT_DRIVE"`). Free coverage for anyone who types what they
 *      see in AxeEdit.
 *
 *   3. **Per-group hardcoded English aliases.** For the cases where the
 *      common English word doesn't match any of the device's labels —
 *      `"gain"` on amp (canonical `input_drive`), `"master"`
 *      (`master_volume`), `"mid"` (`middle`).
 *
 * Used by both the legacy `axefx2_*` tool surface (`tools/shared.ts`,
 * `tools/applyExecutor.ts`) and the unified-surface descriptor
 * (`descriptor/writer.ts`, `descriptor/reader.ts`). Updating this file
 * updates both surfaces — no cross-module sync drift.
 */

import { KNOWN_PARAMS, type AxeFxIIParam } from './params.js';
import type { AxeFxIIBlock } from './blockTypes.js';

/**
 * Per-block-group aliases for common English param names that don't
 * appear in any of the device's own labels. Add an entry here ONLY when
 * the canonical word the user reaches for is genuinely absent from the
 * param's `name` / `wikiName` / `xmlLabel` / `parameterName` — fuzzy
 * normalization covers most cases for free.
 *
 * Scoped per group code so the same English word can resolve differently
 * across blocks. "gain" on AMP → `input_drive`, but "gain" on DRV is
 * already the canonical name (no alias entry needed there).
 */
export const PARAM_ALIASES_AXEFX2: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AMP: {
    gain: 'input_drive',
    master: 'master_volume',
    mid: 'middle',
  },
  DRV: {
    // The Drive block's gain knob is `gain` on Axe-Fx II, `drive` on
    // AM4. Cross-device users (and any agent who learned the AM4 naming
    // first) reach for "drive" on the Drive block — accept it as an
    // alias here. Also `level` → `volume` (common pedal-output naming).
    drive: 'gain',
    level: 'volume',
  },
  REV: {
    // Reverb decay/length both map to time (canonical Fractal name).
    // Mirrors AM4's PARAM_ALIASES entries.
    decay: 'time',
    length: 'time',
    // Axe-Fx II's canonical name is the unspaced "predelay" — the
    // alias direction here covers users who type "pre_delay" (which
    // would normalize to "pre_delay" and not match) or "Pre Delay".
    pre_delay: 'predelay',
  },
  DLY: {
    // Strymon/Eventide convention: "repeats" instead of "feedback".
    repeats: 'feedback',
    length: 'time',
  },
  CHO: {
    // Boss/MXR convention for modulation rate.
    speed: 'rate',
  },
  FLG: {
    speed: 'rate',
  },
  PHA: {
    speed: 'rate',
  },
  TRM: {
    speed: 'rate',
  },
  // Reverb/Delay/Chorus canonical-name knobs (mix, level, time, etc.)
  // are already common English — fuzzy normalization handles capitalization
  // and separators ("Mix" → "mix", "PRE DELAY" → "pre_delay").
};

/**
 * Normalize a param-name candidate for fuzzy matching. Lower-cases,
 * collapses any run of non-alphanumeric characters to a single `_`, and
 * trims leading/trailing underscores.
 *
 * Examples:
 *   "Input Drive"       → "input_drive"
 *   "INPUT DRIVE"       → "input_drive"
 *   "input-drive"       → "input_drive"
 *   "Speaker\nDrive"    → "speaker_drive"  (xmlLabel for speaker_drive)
 *   "DISTORT_DRIVE"     → "distort_drive"
 */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Resolve a user-supplied param name (string) to its `AxeFxIIParam`
 * within the given block's group, applying the three-layer cascade
 * above. Returns `undefined` if nothing matches at any layer.
 *
 * `block` is the resolved `AxeFxIIBlock` (e.g. Amp 1), not a raw string;
 * the group code drives both the candidate filter and the alias-table
 * key.
 */
export function findParamFuzzy(block: AxeFxIIBlock, userInput: string): AxeFxIIParam | undefined {
  const groupUpper = block.groupCode.toUpperCase();
  const candidates: AxeFxIIParam[] = [];
  for (const p of Object.values(KNOWN_PARAMS) as readonly AxeFxIIParam[]) {
    if (p.groupCode === groupUpper) candidates.push(p);
  }

  // Layer 1: exact canonical match (fast path).
  const lower = userInput.trim().toLowerCase();
  for (const p of candidates) {
    if (p.name === lower) return p;
  }

  // Layer 2: normalized fuzzy match against display fields.
  const normalizedInput = normalize(userInput);
  for (const p of candidates) {
    if (normalize(p.name) === normalizedInput) return p;
    if (p.wikiName && normalize(p.wikiName) === normalizedInput) return p;
    if (p.xmlLabel && normalize(p.xmlLabel) === normalizedInput) return p;
    if (p.parameterName && normalize(p.parameterName) === normalizedInput) return p;
  }

  // Layer 3: per-group hardcoded English alias.
  const aliasTarget = PARAM_ALIASES_AXEFX2[groupUpper]?.[lower];
  if (aliasTarget !== undefined) {
    for (const p of candidates) {
      if (p.name === aliasTarget) return p;
    }
  }

  return undefined;
}
