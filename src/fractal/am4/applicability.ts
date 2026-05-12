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
  if (a.always) return { applicable: true };
  // Strictly gated: need a current-type match. Each gate's typeEnum is
  // the parameterName of the gate enum (e.g. DELAY_TYPE). Gate's
  // values is the wire-index list. We map the gate's typeEnum to the
  // friendly block (most gates resolve to the same block as the param;
  // rare cross-block gates fall through to 'unknown' rather than
  // misreport).
  const block = blockDotName.split('.')[0];
  const activeIndex = ctx.currentTypes?.[block];
  if (activeIndex === undefined) return { applicable: 'unknown' };
  // HW-054: distinguish primary-type gates (DISTORT_TYPE / FUZZ_TYPE /
  // etc., the enum we track via lastKnownType[<block>.type]) from
  // sub-mode gates (CABINET_MODE, DISTORT_MODE_1, REVERB_BASETYPE on
  // amp/reverb expert pages, etc.) that we don't track. Only primary-
  // type gates can fail the check; if all gates are sub-mode, return
  // 'unknown' so apply_preset doesn't fire a false-positive advisory
  // (e.g. amp.type itself is gated by CABINET_MODE=[0], which used to
  // misfire by comparing the amp.type wire index against [0]).
  let hasPrimaryGate = false;
  for (const g of a.gates) {
    if (!isGateForBlock(g.typeEnum, block)) continue;
    if (!isPrimaryTypeEnum(g.typeEnum, block)) continue;
    hasPrimaryGate = true;
    if (g.values.includes(activeIndex)) return { applicable: true };
  }
  if (!hasPrimaryGate) return { applicable: 'unknown' };
  return { applicable: false, gates: a.gates };
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
