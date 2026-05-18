/**
 * Extract HARDWARE_OVERRIDES table data from the current shipping
 * packages/axe-fx-ii/src/params.ts.
 *
 * Compares current entries against what `extract-axe-fx-ii-params.ts`
 * emits from the wiki + XML join. Any field on a shipping entry NOT
 * present in the regen output is a hand-curated calibration that the
 * `HARDWARE_OVERRIDES` table needs to carry.
 *
 * Run:
 *   npx tsx scripts/_research/extract-axefx2-hardware-overrides.ts
 *
 * Output: prints a paste-ready HARDWARE_OVERRIDES const to stdout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PARAMS_TS = 'packages/axe-fx-ii/src/params.ts';

// Step 1: save current file, run generator, capture regen output,
// restore the original.
const SHIPPING = readFileSync(PARAMS_TS, 'utf-8');
writeFileSync('/tmp/params-shipping.ts', SHIPPING);

execSync('npx tsx scripts/extract-axe-fx-ii-params.ts', {
  stdio: 'ignore',
});
const REGEN = readFileSync(PARAMS_TS, 'utf-8');
writeFileSync('/tmp/params-regen.ts', REGEN);

// Restore shipping.
writeFileSync(PARAMS_TS, SHIPPING);

// Step 2: parse entries from both. Entry shape:
//   "block.name": { groupCode: "X", block: "y", paramId: N, ...fields... },
type EntryFields = Record<string, string>;

function parseEntries(src: string): Map<string, EntryFields> {
  const out = new Map<string, EntryFields>();
  const entryRe =
    /^\s*"([a-z_]+\.[a-z_0-9]+)":\s*\{\s*([^}]*)\s*\}/gm;
  for (const m of src.matchAll(entryRe)) {
    const [, key, body] = m;
    const fields: EntryFields = {};
    // Field pattern: identifier: value (where value is the field's text up
    // to the next comma OUTSIDE of nested braces / strings — we accept
    // simple parsing since the entries are single-line key: value pairs).
    const fieldRe =
      /([a-zA-Z]+):\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Z_][A-Z0-9_]*|-?\d+(?:\.\d+)?|true|false)+)/g;
    for (const fm of body.matchAll(fieldRe)) {
      fields[fm[1]] = fm[2];
    }
    out.set(key, fields);
  }
  return out;
}

const shipping = parseEntries(SHIPPING);
const regen = parseEntries(REGEN);

// Step 3: compute the override delta. For every shipping entry, identify
// fields present in shipping but absent (or different) in regen.
const HARDWARE_FIELDS = new Set([
  'displayMin',
  'displayMax',
  'displayScale',
  'step',
  'enumValues', // catches enumValues: DELAY_TEMPO_VALUES specifically
]);

interface Override {
  key: string;
  block: string;
  paramId: number;
  fields: Record<string, string>;
}

const overrides: Override[] = [];
for (const [key, sFields] of shipping) {
  const rFields = regen.get(key) ?? {};
  const delta: Record<string, string> = {};
  for (const f of Object.keys(sFields)) {
    if (!HARDWARE_FIELDS.has(f)) continue;
    if (sFields[f] === rFields[f]) continue;
    // enumValues special-case: regen emits an auto-named enum const for
    // any `select` with options; the shipping `delay.tempo` references
    // DELAY_TEMPO_VALUES specifically. We capture only the cases where
    // shipping points at a hand-authored const (DELAY_TEMPO_VALUES).
    if (f === 'enumValues' && sFields[f] !== 'DELAY_TEMPO_VALUES') continue;
    delta[f] = sFields[f];
  }
  if (Object.keys(delta).length === 0) continue;
  const [block, ] = key.split('.');
  const paramId = parseInt(sFields['paramId'] ?? '0', 10);
  overrides.push({ key, block, paramId, fields: delta });
}

overrides.sort((a, b) => {
  if (a.block !== b.block) return a.block.localeCompare(b.block);
  return a.paramId - b.paramId;
});

// Step 4: emit paste-ready TypeScript.
console.log(
  '// HARDWARE_OVERRIDES — calibrations measured on real Axe-Fx II XL+',
);
console.log(
  '// hardware (Quantum 8.02 firmware) across HW-079/HW-088/HW-089/HW-090/',
);
console.log(
  '// HW-091/HW-092/HW-093 + Session 68 + earlier wiki-supplemental work.',
);
console.log(
  '// Keyed by `${block}.${paramId}`. Each entry shadows fields onto the',
);
console.log('// matching emit() output.');
console.log(
  '//',
);
console.log(
  '// Regen via `extract-axe-fx-ii-params.ts` is SAFE — the wiki + XML',
);
console.log(
  '// pipeline does not emit these fields, so the override layer is the',
);
console.log(
  '// only place this knowledge lives.',
);
console.log('');
console.log('const HARDWARE_OVERRIDES: Readonly<Record<string, {');
console.log('  displayMin?: number;');
console.log('  displayMax?: number;');
console.log("  displayScale?: 'log10';");
console.log('  step?: number;');
console.log('  enumValuesRef?: string;');
console.log('}>> = {');
let prevBlock = '';
for (const o of overrides) {
  if (o.block !== prevBlock) {
    if (prevBlock) console.log('');
    console.log(`  // --- ${o.block} ---`);
    prevBlock = o.block;
  }
  const parts: string[] = [];
  if (o.fields['displayMin']) parts.push(`displayMin: ${o.fields['displayMin']}`);
  if (o.fields['displayMax']) parts.push(`displayMax: ${o.fields['displayMax']}`);
  if (o.fields['displayScale']) parts.push(`displayScale: ${o.fields['displayScale']}`);
  if (o.fields['step']) parts.push(`step: ${o.fields['step']}`);
  if (o.fields['enumValues']) parts.push(`enumValuesRef: ${JSON.stringify(o.fields['enumValues'])}`);
  console.log(`  '${o.block}.${o.paramId}': { ${parts.join(', ')} },`);
}
console.log('};');
console.log('');
console.log(`// Total: ${overrides.length} entries.`);
