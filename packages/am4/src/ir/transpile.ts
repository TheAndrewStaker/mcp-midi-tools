/**
 * Working-buffer IR → wire command sequence.
 *
 * Emits one SET_PARAM message per entry in `ir.params`, in insertion
 * order. Use `sendMessages(...)` from the MIDI layer to dispatch them.
 */

import type { ParamKey } from '../params.js';
import { buildSetParam } from '../setParam.js';
import type { WorkingBufferIR } from './preset.js';

export function transpile(ir: WorkingBufferIR): number[][] {
  const messages: number[][] = [];
  for (const [key, value] of Object.entries(ir.params) as [ParamKey, number | undefined][]) {
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      throw new Error(`Param "${key}" has non-finite value: ${value}`);
    }
    messages.push(buildSetParam(key, value));
  }
  return messages;
}
