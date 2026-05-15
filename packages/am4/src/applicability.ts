/**
 * Per-(block, name) applicability helpers — translates the
 * `typeApplicability.ts` generated data into agent-facing prose and
 * runtime predicates.
 *
 * Used by `list_params` to annotate each parameter row with which
 * AM4 types expose it, by `set_param` to warn when the agent writes
 * a knob that the active type doesn't expose, and by `apply_preset`
 * to surface type/param mismatches before any wire bytes are sent.
 */
import {
  AMP_TYPES,
  CHORUS_TYPES,
  COMPRESSOR_TYPES,
  DELAY_TYPES,
  DRIVE_TYPES,
  FILTER_TYPES,
  FLANGER_TYPES,
  GATE_TYPES,
  GEQ_TYPES,
  PHASER_TYPES,
  REVERB_TYPES,
  TREMOLO_TYPES,
} from './cacheEnums.js';
import {
  TYPE_APPLICABILITY,
  type Applicability,
  type ApplicabilityGate,
} from './typeApplicability.js';

/**
 * AM4-Edit symbolic enum name → display name array (cacheEnums).
 * Enums not listed here are surfaced as raw indices in agent-facing
 * prose. The omitted ones (CABINET_MODE, DISTORT_MODE_1,
 * DISTORT_EQTYPE, REVERB_SPRINGTYPE, REVERB_LOWSLOPE,
 * REVERB_HIGHSLOPE, PEQ_TYPE1, PEQ_TYPE5) are sub-mode enums whose
 * display names we haven't extracted yet — usable as raw indices in
 * the meantime, easy to add when needed.
 */
const ENUM_LOOKUP: Readonly<Record<string, readonly string[]>> = {
  DISTORT_TYPE: AMP_TYPES,
  AMP_TYPE: AMP_TYPES,
  FUZZ_TYPE: DRIVE_TYPES,
  REVERB_TYPE: REVERB_TYPES,
  REVERB_BASETYPE: REVERB_TYPES,
  DELAY_TYPE: DELAY_TYPES,
  DELAY_MODEL: DELAY_TYPES,
  CHORUS_TYPE: CHORUS_TYPES,
  FLANGER_TYPE: FLANGER_TYPES,
  PHASER_TYPE: PHASER_TYPES,
  TREMOLO_TYPE: TREMOLO_TYPES,
  COMP_TYPE: COMPRESSOR_TYPES,
  FILTER_TYPE: FILTER_TYPES,
  GEQ_TYPE: GEQ_TYPES,
  GATE_TYPE: GATE_TYPES,
};

export function getApplicability(blockDotName: string): Applicability | undefined {
  return TYPE_APPLICABILITY[blockDotName];
}

/**
 * Render a type-enum gate's values as comma-joined display names. Falls
 * back to `idx N` for enums we don't have a cacheEnums lookup for.
 */
function renderTypeNames(gate: ApplicabilityGate): string {
  const list = ENUM_LOOKUP[gate.typeEnum] ?? [];
  return gate.values.map((v) => list[v] ?? `idx ${v}`).join(', ');
}

/**
 * One-line summary of a parameter's applicability for the agent — appears
 * in `list_params` row decoration. Returns `undefined` for the common
 * "no applicability data" case (out-of-band registers, params not yet
 * decoded by the type-applicability extractor) — caller should treat as
 * always-on. Empty string for confirmed-always-on with no special-case
 * gates (no decoration needed).
 */
export function describeApplicability(blockDotName: string): string | undefined {
  const a = TYPE_APPLICABILITY[blockDotName];
  if (!a) return undefined;
  if (a.always && a.gates.length === 0) return '';
  if (a.always) {
    // Always-on PLUS special-case pages (e.g. amp.negative_feedback has
    // a Friedman BE special page in addition to the universal one).
    // Surface the special cases as informational; agent doesn't need to
    // gate writes on them.
    const cases = a.gates.map((g) => `${g.typeEnum}=[${renderTypeNames(g)}]`).join('; ');
    return `applies to any type (special-cased on: ${cases})`;
  }
  // Strictly type-gated. Surface the union of types that expose it.
  const cases = a.gates.map((g) => `${g.typeEnum}=[${renderTypeNames(g)}]`).join(' OR ');
  return `applies only when ${cases}`;
}

/** State the agent passes when checking applicability — current active type per block. */
export interface ActiveTypeContext {
  /** Block name (e.g. `amp`, `delay`) → wire enum index of its currently active type. */
  readonly currentTypes?: Readonly<Record<string, number>>;
}

/**
 * Predicate: is this parameter applicable on the active type?
 *
 * Returns:
 *   - { applicable: true } when always-on, OR when at least one gate
 *     matches the current type.
 *   - { applicable: false, reason } when the parameter is strictly
 *     type-gated and none of its gates match.
 *   - { applicable: 'unknown' } when we don't have applicability data
 *     for this key (caller should treat as applicable).
 */
export type ApplicabilityCheck =
  | { applicable: true }
  | { applicable: false; gates: readonly ApplicabilityGate[] }
  | { applicable: 'unknown' };

export function checkApplicability(
  blockDotName: string,
  ctx: ActiveTypeContext,
): ApplicabilityCheck {
  const a = TYPE_APPLICABILITY[blockDotName];
  if (!a) return { applicable: 'unknown' };
  // Truly universal — no gates at all → applies to every type.
  if (a.gates.length === 0) {
    return a.always ? { applicable: true } : { applicable: 'unknown' };
  }
  // 2026-05-13 founder-test correction. Original interpretation: if
  // `a.always === true`, the param applies on every type regardless of
  // gates ("gates list is informational, special-case pages only"). The
  // 5F8 Tweed Normal test surfaced that this is wrong for some
  // metadata-extracted params — amp.master shows `always: true` with a
  // large primary-type gates list, but the gates list is the AUTHORITATIVE
  // set of types that expose the param. Wire 185 (5F8 Tweed Normal) is
  // not in the master gates list; the AM4 silently no-ops master writes
  // on this amp model. Old interpretation let the write through and
  // claimed success; new interpretation refuses.
  //
  // Concretely: when primary-type gates exist (DISTORT_TYPE / FUZZ_TYPE
  // / etc.), the active type MUST be in the gate list. Sub-mode gates
  // (CABINET_MODE, DISTORT_MODE_1, …) are still informational — we
  // don't track sub-mode state so we can't enforce against them.
  const block = blockDotName.split('.')[0];
  const activeIndex = ctx.currentTypes?.[block];
  if (activeIndex === undefined) return { applicable: 'unknown' };
  let hasPrimaryGate = false;
  for (const g of a.gates) {
    if (!isGateForBlock(g.typeEnum, block)) continue;
    if (!isPrimaryTypeEnum(g.typeEnum, block)) continue;
    hasPrimaryGate = true;
    if (g.values.includes(activeIndex)) return { applicable: true };
  }
  if (!hasPrimaryGate) {
    // Only sub-mode gates — can't enforce; treat as applicable if
    // `always: true` (the universal-with-special-pages case) or unknown
    // otherwise (caller's fallback is "let the write through with a
    // warning" — see preflightApplicabilityWarning).
    return a.always ? { applicable: true } : { applicable: 'unknown' };
  }
  // Primary-type gates exist AND the active type is NOT in any of
  // them → the param doesn't apply on this type. Refuse the write
  // rather than letting the device silently no-op it.
  return { applicable: false, gates: a.gates };
}

/**
 * find_compatible_types: which `block.type` enum values expose every
 * param in `paramNames`? Used by the unified-surface MCP tool of the
 * same name so the agent can pick a type compatible with the knobs
 * it plans to write, BEFORE apply_preset → no "dropped X param"
 * warning round-trip.
 *
 * Algorithm: start with the full type enum, intersect down per param.
 * Params with no applicability data, or only sub-mode gates (e.g.
 * CABINET_MODE), can't narrow on the primary-type axis — skipped.
 * Params with primary-type gates narrow the accepted-types set to the
 * gate value list.
 *
 * Returns `applicability_known: false` when NONE of the listed params
 * have primary-type gates — caller knows the result is the unfiltered
 * full list and should treat it as "try and see" rather than "these
 * are the only valid choices."
 */
export function findCompatibleTypes(
  block: string,
  paramNames: readonly string[],
): {
  compatible_types: readonly string[];
  total_types: number;
  applicability_known: boolean;
  note?: string;
} {
  const typeEnum = primaryTypeEnumFor(block);
  if (typeEnum === undefined) {
    return {
      compatible_types: [],
      total_types: 0,
      applicability_known: false,
      note: `block "${block}" has no primary type enum`,
    };
  }
  const enumDisplayNames = ENUM_LOOKUP[typeEnum] ?? [];
  if (enumDisplayNames.length === 0) {
    return {
      compatible_types: [],
      total_types: 0,
      applicability_known: false,
      note: `no display names registered for ${typeEnum}`,
    };
  }
  const totalTypes = enumDisplayNames.length;

  let accepted = new Set<number>(Array.from({ length: totalTypes }, (_, i) => i));
  let anyPrimaryGateApplied = false;
  const skippedParams: string[] = [];

  for (const paramName of paramNames) {
    const key = `${block}.${paramName}`;
    const a = TYPE_APPLICABILITY[key];
    if (a === undefined) {
      skippedParams.push(`${paramName} (no applicability data — treated as always-on)`);
      continue;
    }
    if (a.always && a.gates.length === 0) {
      continue;
    }
    const exposedHere = new Set<number>();
    let hasPrimaryGate = false;
    for (const g of a.gates) {
      if (g.typeEnum !== typeEnum) continue;
      hasPrimaryGate = true;
      for (const v of g.values) exposedHere.add(v);
    }
    if (!hasPrimaryGate) {
      skippedParams.push(`${paramName} (only sub-mode gates — not narrowable on primary type)`);
      continue;
    }
    anyPrimaryGateApplied = true;
    accepted = new Set([...accepted].filter((idx) => exposedHere.has(idx)));
    if (accepted.size === 0) break;
  }

  const compatibleNames: string[] = [...accepted]
    .sort((a, b) => a - b)
    .map((idx) => enumDisplayNames[idx])
    .filter((n): n is string => n !== undefined);

  const note = skippedParams.length > 0
    ? `Skipped from narrowing: ${skippedParams.join('; ')}.`
    : undefined;

  return {
    compatible_types: compatibleNames,
    total_types: totalTypes,
    applicability_known: anyPrimaryGateApplied,
    note,
  };
}

/**
 * Primary type enum for each AM4 block — the enum the agent picks via
 * `block.type` and that primary-type applicability gates filter on.
 * Mirrors `isPrimaryTypeEnum` below but returns the enum NAME rather
 * than a boolean (caller uses it to look up the display-name table).
 *
 * Returns undefined for blocks with no primary type enum (e.g. peq,
 * volpan, ingate) — those exist as block_types but don't have a
 * `type` selector knob users can pick.
 */
function primaryTypeEnumFor(block: string): string | undefined {
  switch (block) {
    case 'amp':        return 'DISTORT_TYPE';
    case 'drive':      return 'FUZZ_TYPE';
    case 'delay':      return 'DELAY_TYPE';
    case 'reverb':     return 'REVERB_TYPE';
    case 'chorus':     return 'CHORUS_TYPE';
    case 'flanger':    return 'FLANGER_TYPE';
    case 'phaser':     return 'PHASER_TYPE';
    case 'wah':        return 'WAH_TYPE';
    case 'compressor': return 'COMP_TYPE';
    case 'geq':        return 'GEQ_TYPE';
    case 'filter':     return 'FILTER_TYPE';
    case 'tremolo':    return 'TREMOLO_TYPE';
    case 'gate':       return 'GATE_TYPE';
    default:           return undefined;
  }
}

/**
 * Whether a typeEnum is the block's primary-type enum (the one we track
 * via `lastKnownType[<block>.type]`). Sub-mode enums (CABINET_MODE,
 * DISTORT_MODE_1, REVERB_BASETYPE, etc.) gate UI exposure but we don't
 * read them after every block-type change, so applicability checks
 * against them must downgrade to 'unknown' instead of firing.
 */
function isPrimaryTypeEnum(typeEnum: string, block: string): boolean {
  switch (block) {
    case 'amp':        return typeEnum === 'DISTORT_TYPE' || typeEnum === 'AMP_TYPE';
    case 'drive':      return typeEnum === 'FUZZ_TYPE';
    case 'delay':      return typeEnum === 'DELAY_TYPE' || typeEnum === 'DELAY_MODEL';
    case 'reverb':     return typeEnum === 'REVERB_TYPE';
    case 'chorus':     return typeEnum === 'CHORUS_TYPE';
    case 'flanger':    return typeEnum === 'FLANGER_TYPE';
    case 'phaser':     return typeEnum === 'PHASER_TYPE';
    case 'wah':        return typeEnum === 'WAH_TYPE';
    case 'compressor': return typeEnum === 'COMP_TYPE';
    case 'geq':        return typeEnum === 'GEQ_TYPE';
    case 'filter':     return typeEnum === 'FILTER_TYPE';
    case 'tremolo':    return typeEnum === 'TREMOLO_TYPE';
    case 'gate':       return typeEnum === 'GATE_TYPE';
    default:           return false;
  }
}

/**
 * Whether a gate's typeEnum corresponds to a given block. The bulk of
 * gates are intra-block (DELAY_TYPE on delay params, FUZZ_TYPE on drive
 * params), but a few cross over (REVERB_BASETYPE / REVERB_SPRINGTYPE
 * both on reverb params; DISTORT_MODE_1 / CABINET_MODE on amp params).
 */
function isGateForBlock(typeEnum: string, block: string): boolean {
  switch (block) {
    case 'amp':        return typeEnum === 'DISTORT_TYPE' || typeEnum === 'AMP_TYPE' || typeEnum === 'DISTORT_MODE_1' || typeEnum === 'DISTORT_EQTYPE' || typeEnum === 'CABINET_MODE';
    case 'drive':      return typeEnum === 'FUZZ_TYPE';
    case 'delay':      return typeEnum === 'DELAY_TYPE' || typeEnum === 'DELAY_MODEL';
    case 'reverb':     return typeEnum === 'REVERB_TYPE' || typeEnum === 'REVERB_BASETYPE' || typeEnum === 'REVERB_SPRINGTYPE' || typeEnum === 'REVERB_LOWSLOPE' || typeEnum === 'REVERB_HIGHSLOPE';
    case 'chorus':     return typeEnum === 'CHORUS_TYPE';
    case 'flanger':    return typeEnum === 'FLANGER_TYPE';
    case 'phaser':     return typeEnum === 'PHASER_TYPE';
    case 'wah':        return typeEnum === 'WAH_TYPE';
    case 'compressor': return typeEnum === 'COMP_TYPE';
    case 'geq':        return typeEnum === 'GEQ_TYPE';
    case 'peq':        return typeEnum === 'PEQ_TYPE1' || typeEnum === 'PEQ_TYPE5';
    case 'filter':     return typeEnum === 'FILTER_TYPE';
    case 'tremolo':    return typeEnum === 'TREMOLO_TYPE';
    case 'gate':       return typeEnum === 'GATE_TYPE';
    default:           return false;
  }
}
