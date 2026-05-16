/**
 * Smarter coverage comparison: filter the Ghidra catalog down to
 * params that AM4-Edit actually shows on a UI page (knobs, sliders,
 * dropdowns, toggles), then compare against our `params.ts`.
 *
 * The Ghidra catalog includes ALL params per effect — including
 * modifier slots, internal calc state, scene-only state, system-
 * reserved high paramId ranges. These aren't first-page knobs and
 * we shouldn't count them as gaps.
 *
 * The authoritative "what's on a UI page" source is AM4-Edit's
 * `__block_layout.xml` — every `parameterName="X"` attribute names
 * a param with an EditorControl widget. Filtering the Ghidra catalog
 * to that subset gives us the realistic "user-facing knob" set.
 *
 * Also reads `__block_layout_expert.xml` for advanced-page params.
 *
 * Output: stdout report + JSON of all missing knobs per family.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const AM4_BLOCK_LAYOUT = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const AM4_BLOCK_LAYOUT_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';
const GHIDRA_AM4 = 'samples/captured/decoded/ghidra-am4-paramnames.json';
const PARAMS_TS = 'packages/am4/src/params.ts';

// --- Step 1: extract every parameterName="X" from AM4-Edit's XMLs ---

function extractParameterNames(path: string): Set<string> {
  const xml = readFileSync(path, 'utf-8');
  const names = new Set<string>();
  for (const m of xml.matchAll(/parameterName="([A-Z][A-Z0-9_]+)"/g)) {
    names.add(m[1]);
  }
  return names;
}

const ui = extractParameterNames(AM4_BLOCK_LAYOUT);
const uiExpert = extractParameterNames(AM4_BLOCK_LAYOUT_EXPERT);
const uiCombined = new Set([...ui, ...uiExpert]);

console.log(`AM4-Edit UI-referenced params (regular layout): ${ui.size}`);
console.log(`AM4-Edit UI-referenced params (expert layout):  ${uiExpert.size}`);
console.log(`AM4-Edit UI-referenced params (combined):       ${uiCombined.size}`);
console.log('');

// --- Step 2: filter Ghidra catalog to UI-relevant entries ---

const ghidra = JSON.parse(readFileSync(GHIDRA_AM4, 'utf-8'));

interface FilteredFamily {
  family: string;
  caseIdx: number;
  total: number;
  uiRelevant: { paramId: number; name: string }[];
  uiCount: number;
}

const filtered: FilteredFamily[] = [];

for (const [caseKey, effect] of Object.entries(ghidra.effect_types) as [string, any][]) {
  if (!effect.effectFamily) continue;
  const uiRelevant = (effect.params as { paramId: number; name: string }[])
    .filter((p) => p.name && p.name !== '?' && uiCombined.has(p.name));
  filtered.push({
    family: effect.effectFamily,
    caseIdx: effect.caseIdx,
    total: effect.paramCount,
    uiRelevant,
    uiCount: uiRelevant.length,
  });
}

filtered.sort((a, b) => b.uiCount - a.uiCount);

// --- Step 3: load our current params.ts and bucket by family prefix ---

const paramsTs = readFileSync(PARAMS_TS, 'utf-8');
const ourKeys = new Set<string>();
for (const m of paramsTs.matchAll(/'([a-z][a-z]+\.[a-z][a-z0-9_]+)'/g)) ourKeys.add(m[1]);
const ourByFamily: Record<string, Set<string>> = {};
for (const k of ourKeys) {
  const f = k.split('.')[0];
  if (!ourByFamily[f]) ourByFamily[f] = new Set();
  ourByFamily[f].add(k.split('.').slice(1).join('.'));
}

// Family aliases (Ghidra's internal name → our key prefix).
const ALIAS: Record<string, string> = {
  DISTORT: 'drive',
  CABINET: 'cab',
  COMP: 'compressor',
  GEQ: 'geq',
  PEQ: 'peq',
  VOLUME: 'volpan',  // close — AM4's volpan is "Volume/Pan" block
};

// Normalize a Ghidra symbol name's tail for comparison against our keys.
// REVERB_TIME → time, REVERB_HFRATIO → hfratio, REVERB_FEEDR → feedr
function ghidraTail(symbol: string): string {
  const u = symbol.indexOf('_');
  return u < 0 ? '' : symbol.substring(u + 1).toLowerCase();
}

// Loose comparison key — strip underscores and lowercase. So that
// our "high_cut" and Ghidra's "HICUT" both normalize to "highcut" /
// "hicut" — still different. Apply alias map for these spelling
// differences.
const TAIL_ALIAS: Record<string, string[]> = {
  // Our key tail → Ghidra-style equivalents (any match counts)
  high_cut: ['hicut', 'highcut'],
  low_cut: ['lowcut'],
  pre_delay: ['predelay'],
  predelay: ['pre_delay'],
  input_gain: ['gain', 'inputgain', 'inpgain'],
  stereo_spread: ['spread', 'stereospread'],
  shift_1: ['shift1'],
  shift_2: ['shift2'],
  shift_3: ['shift3'],
  shift_4: ['shift4'],
  spring_tone: ['springtone', 'tone'],
  spring_count: ['numsprings'],
  springs: ['numsprings'],
  stack_hold: ['hold'],
  feed_l: ['feedl'],
  feed_r: ['feedr'],
  feedback_l: ['feedl'],
  feedback_r: ['feedr'],
  master_feedback: ['mstrfdbk'],
  // Common aliases between our naming and Ghidra's
  decay: ['time'],
  length: ['time'],
  repeats: ['feedback', 'feed'],
  speed: ['rate'],
  volume: ['level'],
};

function tailNormalize(s: string): string {
  return s.replace(/_/g, '').toLowerCase();
}

function tailsMatch(ourTail: string, ghidraTail: string): boolean {
  if (ourTail === ghidraTail) return true;
  if (tailNormalize(ourTail) === tailNormalize(ghidraTail)) return true;
  const aliases = TAIL_ALIAS[ourTail];
  if (aliases && aliases.includes(ghidraTail)) return true;
  // Reverse lookup — Ghidra tail might be the "key" in TAIL_ALIAS
  const reverse = TAIL_ALIAS[ghidraTail];
  if (reverse && reverse.includes(ourTail)) return true;
  return false;
}

// Families that AM4 actually has as placeable block types (from
// packages/am4/src/blockTypes.ts). Other Ghidra families (PITCH,
// MULTITAP, PLEX, FUZZ, SYNTH, etc.) exist in AM4-Edit's binary but
// AM4 the device doesn't have those blocks — counting them as "gaps"
// is misleading.
const AM4_BLOCK_FAMILIES = new Set([
  'AMP',  // not in dispatcher but AM4 has it
  'COMP', 'GEQ', 'PEQ', 'REVERB', 'DELAY', 'CHORUS', 'FLANGER',
  'ROTARY', 'PHASER', 'WAH', 'VOLUME', 'TREMOLO', 'FILTER',
  'DISTORT', 'ENHANCER', 'GATE',
]);

// --- Step 4: build per-family report ---

console.log('## UI-relevant param coverage — AM4 block-families only');
console.log('');
console.log('(Excludes PITCH/MULTITAP/PLEX/FUZZ/etc. — those exist in AM4-Edit binary');
console.log(' but AM4 the device doesn\'t have those blocks as placeable effects.)');
console.log('');
console.log('| Family | UI-relevant params | Our keys | Covered | Missing |');
console.log('|---|---|---|---|---|');

const allMissing: Record<string, string[]> = {};

for (const f of filtered) {
  if (!AM4_BLOCK_FAMILIES.has(f.family)) continue;
  const ourFamily = (ALIAS[f.family] || f.family.toLowerCase());
  const ourTails = ourByFamily[ourFamily] || new Set<string>();
  const matchedNames: string[] = [];
  const missingNames: string[] = [];
  for (const p of f.uiRelevant) {
    const tail = ghidraTail(p.name);
    let matched = false;
    for (const our of ourTails) {
      if (tailsMatch(our, tail)) { matched = true; break; }
    }
    if (matched) matchedNames.push(p.name);
    else missingNames.push(p.name);
  }
  const total = f.uiRelevant.length;
  const matched = matchedNames.length;
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  console.log(
    `| ${f.family} | ${total} | ${ourTails.size} | ${matched} (${pct}%) | ${missingNames.length} |`,
  );
  if (missingNames.length > 0) allMissing[f.family] = missingNames;
}

console.log('');
console.log('## Missing UI-relevant params per family');
console.log('');
for (const [family, names] of Object.entries(allMissing)) {
  if (names.length === 0) continue;
  const ourFamily = (ALIAS[family] || family.toLowerCase());
  console.log(`### ${family}  →  our prefix \`${ourFamily}.*\``);
  for (const n of names) {
    const tail = ghidraTail(n);
    console.log(`  - \`${n}\`  →  suggested key: \`${ourFamily}.${tail}\``);
  }
  console.log('');
}

// --- Step 5: dump JSON for follow-up ---

const reportPath = 'samples/captured/decoded/am4-coverage-report.json';
writeFileSync(reportPath, JSON.stringify({
  ui_referenced_params: uiCombined.size,
  per_family: filtered.map((f) => ({
    family: f.family,
    caseIdx: f.caseIdx,
    ui_relevant_count: f.uiCount,
    our_keys_count: (ourByFamily[ALIAS[f.family] || f.family.toLowerCase()] || new Set()).size,
    missing_from_ours: allMissing[f.family] || [],
  })),
}, null, 2));
console.log(`\nWrote JSON report to ${reportPath}`);
