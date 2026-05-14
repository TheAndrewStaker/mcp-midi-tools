/**
 * Golden check: every entry in `CACHE_PARAMS` (generated from the
 * AM4-Edit metadata cache) must match the hand-authored
 * `KNOWN_PARAMS` entry for the same key — same pidLow/pidHigh,
 * same unit, same displayMin/displayMax. If they diverge, either
 * the generator is wrong, the cache changed, or the hand-authored
 * entry has drifted from the cache and needs a matching update.
 *
 * This is the P1-010 coverage-gate guard: as Session B adds names
 * to `paramNames.ts`, the generator emits more CACHE_PARAMS entries,
 * and this check proves the bulk-registered entries agree with any
 * hand-tuned ones for params registered in both places.
 *
 *   npx tsx scripts/verify-cache-params.ts
 */
import { CACHE_PARAMS } from '@mcp-midi-control/am4/cacheParams.js';
import { KNOWN_PARAMS } from '@mcp-midi-control/am4/params.js';
import type { Param } from '@mcp-midi-control/am4/params.js';

interface Divergence {
  key: string;
  reason: string;
}

function paramEq(a: Param, b: Param): string | undefined {
  if (a.pidLow !== b.pidLow) return `pidLow differs: cache=0x${a.pidLow.toString(16)} vs known=0x${b.pidLow.toString(16)}`;
  if (a.pidHigh !== b.pidHigh) return `pidHigh differs: cache=0x${a.pidHigh.toString(16)} vs known=0x${b.pidHigh.toString(16)}`;
  if (a.unit !== b.unit) return `unit differs: cache='${a.unit}' vs known='${b.unit}'`;
  if (a.displayMin !== b.displayMin) return `displayMin differs: cache=${a.displayMin} vs known=${b.displayMin}`;
  if (a.displayMax !== b.displayMax) return `displayMax differs: cache=${a.displayMax} vs known=${b.displayMax}`;
  // BK-038 (Session 43 cont): scaling kind must match. cache derives this
  // from the cache record's typecode; KNOWN_PARAMS must mirror it for the
  // runtime decode to apply the right formula. Treat undefined as 'linear'
  // since that's the runtime default.
  const aScaling = a.scaling ?? 'linear';
  const bScaling = b.scaling ?? 'linear';
  if (aScaling !== bScaling) return `scaling differs: cache='${aScaling}' vs known='${bScaling}'`;
  if (a.block !== b.block) return `block differs: cache='${a.block}' vs known='${b.block}'`;
  if (a.name !== b.name) return `name differs: cache='${a.name}' vs known='${b.name}'`;
  // Enum values are objects of (index → name); identity-check by stringify
  // is fine since both sides reference the same cacheEnums arrays.
  const ae = a.enumValues;
  const be = b.enumValues;
  if (!!ae !== !!be) return `enumValues presence differs`;
  if (ae && be) {
    const ak = Object.keys(ae).sort();
    const bk = Object.keys(be).sort();
    if (ak.length !== bk.length) return `enumValues size differs: cache=${ak.length} vs known=${bk.length}`;
    for (const k of ak) {
      const ai = Number(k);
      if (ae[ai] !== be[ai]) return `enumValues[${k}] differs: cache='${ae[ai]}' vs known='${be[ai]}'`;
    }
  }
  return undefined;
}

const divergences: Divergence[] = [];
let matched = 0;

for (const [key, cacheEntry] of Object.entries(CACHE_PARAMS)) {
  const known = (KNOWN_PARAMS as Record<string, Param>)[key];
  if (!known) {
    divergences.push({
      key,
      reason: 'cache emits this entry but KNOWN_PARAMS does not register it — ' +
              'either remove the name from paramNames.ts or add a matching ' +
              'hand-authored entry to KNOWN_PARAMS',
    });
    continue;
  }
  const diff = paramEq(cacheEntry as Param, known);
  if (diff) {
    divergences.push({ key, reason: diff });
  } else {
    matched++;
  }
}

if (divergences.length > 0) {
  console.error(`❌ ${divergences.length} CACHE_PARAMS entries disagree with KNOWN_PARAMS:`);
  for (const d of divergences) {
    console.error(`  - ${d.key}: ${d.reason}`);
  }
  process.exit(1);
}

console.log(`✓ ${matched}/${Object.keys(CACHE_PARAMS).length} CACHE_PARAMS entries match KNOWN_PARAMS byte-for-byte.`);
