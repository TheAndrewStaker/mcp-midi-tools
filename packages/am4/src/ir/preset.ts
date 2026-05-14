/**
 * Preset Intermediate Representation.
 *
 * Scope: **working buffer only** — a flat parameter map. The full preset
 * IR (block placement, scenes, per-block channels) is deferred until the
 * relevant protocol pieces are reverse-engineered.
 *
 * A `WorkingBufferIR` describes the parameter values to apply to the
 * AM4's *currently loaded* preset. The transpiler in `./transpile.ts`
 * turns it into an ordered SET_PARAM command sequence.
 */

import type { ParamKey } from '../params.js';

/**
 * Display values keyed by registry param key (e.g. `'amp.gain'`). Values
 * are in human/UI units (the registry handles the scale conversion).
 *
 * Iteration order is preserved by the transpiler, so callers can express
 * apply-order dependencies (e.g. set block type before block params)
 * by ordering insertion.
 */
export interface WorkingBufferIR {
  params: Partial<Record<ParamKey, number>>;
}
