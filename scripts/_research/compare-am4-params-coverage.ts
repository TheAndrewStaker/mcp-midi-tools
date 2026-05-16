/**
 * Compare AM4-Edit's Ghidra-extracted parameter catalog against our
 * current `packages/am4/src/params.ts` to find:
 *
 *   1. Effect families we have FULL coverage of (≥80% match)
 *   2. Effect families with significant gaps (< 50% match)
 *   3. Specific Ghidra symbol names that don't have a corresponding
 *      key in our params.ts (potential missed params)
 *
 * Naming convention mapping:
 *   Ghidra: `REVERB_TIME`, `DELAY_FEEDR`, `GLOBAL_TUNER_SOURCE`
 *   Ours:   `reverb.time`, `delay.feedR`, no prefix for global
 *
 * Match heuristic:
 *   - Lowercase + dot-split → compare with underscore-split lowercase
 *   - Ignore minor differences (e.g., snake_case vs camelCase)
 */

import { readFileSync } from 'node:fs';

const ghidraJson = JSON.parse(
  readFileSync('samples/captured/decoded/ghidra-am4-paramnames.json', 'utf-8')
);
const paramsTs = readFileSync('packages/am4/src/params.ts', 'utf-8');

// Extract our current param keys.
const ourKeys = new Set<string>();
const keyRe = /'([a-z][a-z]+\.[a-z][a-z0-9_]+)'/g;
for (const m of paramsTs.matchAll(keyRe)) {
  ourKeys.add(m[1]);
}

console.log(`Current params.ts unique keys: ${ourKeys.size}`);
console.log(`Ghidra catalog effect families: ${Object.keys(ghidraJson.effect_types).length}`);
console.log('');

// Convert Ghidra symbolic name to our convention. REVERB_TIME → reverb.time
function ghidraToOurs(symbol: string): string {
  const u = symbol.indexOf('_');
  if (u < 0) return symbol.toLowerCase();
  const family = symbol.substring(0, u).toLowerCase();
  const rest = symbol.substring(u + 1).toLowerCase();
  return `${family}.${rest}`;
}

// Family aliases — Ghidra family → our family name (when they differ).
// These are the families where Fractal's internal symbolic name differs
// from the user-facing block name we use in MCP tools / params.ts.
const FAMILY_ALIAS: Record<string, string> = {
  DISTORT: 'drive',        // Fractal's DISTORT_* maps to our drive.*
  CABINET: 'cab',          // CABINET_* → cab.*
  COMP: 'compressor',      // COMP_* → compressor.*
  GEQ: 'geq',              // matches but explicit
  PEQ: 'peq',              // matches but explicit
  TONEMATCH: 'tonematch',
  IRPLAYER: 'irplayer',
  MULTITAP: 'multitap',
  TENTAP: 'tentap',
  MEGATAP: 'megatap',
  PLEX: 'plex',
  DYNDIST: 'dyndist',
};

interface Coverage {
  family: string;
  ghidraCount: number;
  oursCount: number;
  matched: string[];
  missingFromOurs: string[];
}

const coverage: Coverage[] = [];

for (const effect of Object.values(ghidraJson.effect_types) as any[]) {
  if (!effect.effectFamily) continue;
  const family = effect.effectFamily;
  const ourFamily = (FAMILY_ALIAS[family] || family).toLowerCase();

  const matched: string[] = [];
  const missing: string[] = [];

  for (const p of effect.params as { paramId: number; name: string }[]) {
    if (!p.name || p.name === '?') continue;
    const ourKey = ghidraToOurs(p.name).replace(family.toLowerCase() + '.', ourFamily + '.');
    if (ourKeys.has(ourKey)) {
      matched.push(p.name);
    } else {
      missing.push(p.name);
    }
  }

  const oursInFamily = [...ourKeys].filter((k) => k.startsWith(ourFamily + '.')).length;

  coverage.push({
    family,
    ghidraCount: effect.paramCount,
    oursCount: oursInFamily,
    matched,
    missingFromOurs: missing,
  });
}

coverage.sort((a, b) => b.ghidraCount - a.ghidraCount);

console.log('| Family | Ghidra | Ours | Matched | Missing from ours |');
console.log('|---|---|---|---|---|');
for (const c of coverage) {
  const pct = c.ghidraCount > 0 ? Math.round((c.matched.length / c.ghidraCount) * 100) : 0;
  console.log(`| ${c.family} | ${c.ghidraCount} | ${c.oursCount} | ${c.matched.length} (${pct}%) | ${c.missingFromOurs.length} |`);
}

console.log('');
console.log('## Top missing params per family (first 10 each):');
console.log('');

const significantGaps = coverage.filter((c) => c.missingFromOurs.length > 0 && c.oursCount > 0);
for (const c of significantGaps.slice(0, 15)) {
  console.log(`### ${c.family} — ${c.missingFromOurs.length} missing`);
  for (const m of c.missingFromOurs.slice(0, 10)) console.log(`  - ${m}  →  suggested key: \`${ghidraToOurs(m)}\``);
  if (c.missingFromOurs.length > 10) console.log(`  ... (${c.missingFromOurs.length - 10} more)`);
  console.log('');
}
