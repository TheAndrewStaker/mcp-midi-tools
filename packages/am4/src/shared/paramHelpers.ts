/**
 * Param-name resolution and display-value coercion shared by every tool
 * that takes (block, name) and a value at the input boundary.
 *
 * Display-first contract per CLAUDE.md "Tool API conventions": tool inputs
 * accept the user-facing display value (knob 0–10, dB, ms, %, enum dropdown
 * name); the wire conversion happens at the encoder layer below this file.
 * The helpers here translate display → wire-ready numeric and surface
 * helpful errors for typos.
 */

import {
    KNOWN_PARAMS,
    PARAM_ALIASES,
    findEnumCandidates,
    resolveEnumValue,
    type Param,
    type ParamKey,
} from '../params.js';

/**
 * Default scratch preset location used for in-place test workflows
 * (apply_preset's `dance:both` analogue, founder spot-checks, HW-064
 * style multi-turn sessions). The historical hard-gate on this location
 * was lifted Session 49 once HW-064 confirmed save-to-inactive-location
 * is a real workflow (device on Z03, save to Z04 succeeded — the user
 * uses it to build multiple presets in one session). Agents should
 * still treat saves as destructive: confirm intent before overwriting
 * a non-empty user-content slot, and never auto-save without an
 * explicit save phrase from the user.
 */
export const DEFAULT_SCRATCH_LOCATION = 'Z04';

/**
 * Typed error for ambiguous-enum resolution. Carries the structured
 * candidate list so the dispatcher / apply executor can populate
 * `DispatchError.details.valid_options` instead of forcing the agent
 * to regex the candidates out of the prose message.
 *
 * H2 Plexi-100W trace (2026-05-15) — agent sent `"Plexi 100W"`, hit
 * the ambiguous-enum branch with 4 candidates, parsed them from the
 * error prose, and retried with `"Plexi 100W High"`. Round-trip cost
 * ~2 s + tokens; structured valid_options closes that gap.
 */
export class EnumAmbiguityError extends Error {
    readonly candidates: readonly string[];
    readonly value: string;
    constructor(value: string, candidates: readonly string[], prefix = '') {
        const list = candidates.map((c) => `"${c}"`).join(' / ');
        super(`${prefix}"${value}" is ambiguous — matched ${candidates.length} entries: ${list}. Pick one verbatim.`);
        this.name = 'EnumAmbiguityError';
        this.candidates = candidates;
        this.value = value;
    }
}

/**
 * Suggest the closest known param key for an unknown name. Returns the
 * single best match within Levenshtein distance ≤ 2, scoped to the same
 * block so we don't suggest cross-block names. Returns undefined when no
 * close match exists — caller falls back to listing the full set.
 *
 * HW-064 motivation: agent reached for `reverb.pre_delay` (canonical is
 * `predelay`, no underscore) and the error dumped the entire 50+-name
 * reverb param list. A `did you mean "predelay"?` hint is more useful.
 * Aliases (PARAM_ALIASES) handle the common synonyms; this helper
 * catches the rest.
 */
export function suggestParamName(block: string, name: string): string | undefined {
    const sameBlock = Object.keys(KNOWN_PARAMS)
        .filter((k) => k.startsWith(`${block}.`))
        .map((k) => k.slice(block.length + 1));
    if (sameBlock.length === 0) return undefined;
    const distance = (a: string, b: string): number => {
        if (a === b) return 0;
        const al = a.length;
        const bl = b.length;
        if (Math.abs(al - bl) > 2) return 3;
        const dp: number[] = Array.from({ length: bl + 1 }, (_, j) => j);
        for (let i = 1; i <= al; i++) {
            let prev = i - 1;
            let curr = i;
            for (let j = 1; j <= bl; j++) {
                const tmp = dp[j];
                curr = a[i - 1] === b[j - 1]
                    ? prev
                    : Math.min(prev, dp[j], dp[j - 1]) + 1;
                dp[j - 1] = prev;
                prev = tmp;
                dp[j] = curr;
            }
        }
        return dp[bl];
    };
    let best: { name: string; d: number } | undefined;
    for (const candidate of sameBlock) {
        const d = distance(name.toLowerCase(), candidate.toLowerCase());
        if (d <= 2 && (!best || d < best.d)) best = { name: candidate, d };
    }
    return best?.name;
}

export function paramKey(block: string, name: string): ParamKey {
    const literal = `${block}.${name}` as ParamKey;
    if (literal in KNOWN_PARAMS) return literal;
    // Common-synonym alias check — `reverb.decay` → `reverb.time`,
    // `delay.repeats` → `delay.feedback`, etc. Resolves silently so the
    // agent's first call lands instead of round-tripping through an
    // unknown-param error. See PARAM_ALIASES in params.ts for the list
    // and Session 44 Lamb-of-God test for the motivating case.
    const aliasTarget = PARAM_ALIASES[literal];
    if (aliasTarget !== undefined && aliasTarget in KNOWN_PARAMS) {
        return aliasTarget as ParamKey;
    }
    const suggestion = suggestParamName(block, name);
    if (suggestion !== undefined) {
        throw new Error(`Unknown parameter "${literal}" — did you mean "${block}.${suggestion}"?`);
    }
    const sameBlock = Object.keys(KNOWN_PARAMS).filter((k) => k.startsWith(`${block}.`));
    throw new Error(
        sameBlock.length
            ? `Unknown parameter "${literal}". Known params for ${block}: ${sameBlock.join(', ')}.`
            : `Unknown parameter "${literal}". No params registered for ${block} yet.`,
    );
}

export function resolveValue(param: Param, value: number | string): number {
    if (param.unit === 'enum') {
        const resolved = resolveEnumValue(param, value);
        if (resolved === undefined) {
            // If the input substring-matched multiple entries, list THOSE
            // candidates explicitly — they're far more useful than the first
            // 8 names from offset 0 of the enum table. Founder-driven Session
            // 44: agent passed reverb.type = "Room" (matched Room, Small /
            // Room, Medium / Room, Large + a few others) and the previous
            // hint mixed in Hall / Chamber names that weren't candidates.
            const candidates = typeof value === 'string'
                ? findEnumCandidates(param, value)
                : [];
            if (candidates.length >= 2) {
                throw new EnumAmbiguityError(String(value), candidates.map((c) => c.name));
            }
            const samples = Object.values(param.enumValues ?? {}).slice(0, 8).join(', ');
            throw new Error(`"${value}" is not a valid ${param.block}.${param.name} value. First few valid names: ${samples}… (call list_enum_values for the full list).`);
        }
        return resolved;
    }
    // Non-enum params take a numeric display value (e.g. 0–10 knob, dB, ms).
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) throw new Error(`Expected a number for ${param.block}.${param.name}, got "${value}"`);
    if (num < param.displayMin || num > param.displayMax) {
        throw new Error(`${param.block}.${param.name} out of range [${param.displayMin}..${param.displayMax}]: ${num}`);
    }
    return num;
}
