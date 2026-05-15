/**
 * Aggregator for all device cases. Importing this surface (instead of
 * per-device files) lets the runner CLI accept a case-id without
 * caring which device file declares it.
 */
import { AM4_CASES } from './cases-am4.js';
import type { AgentRegressionCase } from './types.js';

export const ALL_CASES: readonly AgentRegressionCase[] = [
  ...AM4_CASES,
  // Axe-Fx II, Hydrasynth, Axe-Fx III cases land here once the AM4
  // harness pattern proves itself end-to-end.
];
