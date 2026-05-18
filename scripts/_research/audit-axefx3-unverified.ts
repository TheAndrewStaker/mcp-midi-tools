/**
 * Audit III's 587 `unit: 'unverified'` entries.
 *
 * Goal: filter out CONTROLLERS / FC / PRESET-FC families (internal-only
 * per v1.4 PDF) plus other non-user-addressable buckets. What's left is
 * the "actionable unverified" set — params in user-addressable III
 * blocks that could plausibly borrow display calibration from AM4 or
 * universal Fractal convention.
 *
 * For each actionable family bucket, propose AM4-borrow candidates
 * where the III paramName (after family-prefix strip) matches an AM4
 * symbol with known unit + display range.
 */

import { PARAMS as IIIPARAMS } from '../../packages/axe-fx-iii/src/params.ts';
import { KNOWN_PARAMS as AM4_KNOWN } from '../../packages/am4/src/params.ts';
const ALL_PARAMS = IIIPARAMS;
type Am4Entry = { block: string; name: string; unit: string; displayMin: number; displayMax: number };
const AM4_PARAMS: Array<{ key: string } & Am4Entry> = Object.entries(AM4_KNOWN as Record<string, Am4Entry>).map(
  ([key, v]) => ({ key, ...v }),
);

// Families that are internal-only or non-addressable per v1.4 PDF.
const NON_ADDRESSABLE_FAMILIES = new Set<string>([
  'CONTROLLERS', // ID_CONTROL=2 — internal "control switch", FC-controlled
  'FC',          // ID_FOOTCONTROLLER=199 — FC interface only
  'PRESET',      // ID_PRESET_FC=200 — internal
  'MIDIBLOCK',   // ID_MIDIBLOCK=190 — internal scene MIDI only
  'GLOBAL',      // System-wide; not block-addressable via 0x01
]);

// All unverified entries
const unverified = ALL_PARAMS.filter((p) => p.unit === 'unverified');
console.log(`Total unverified entries: ${unverified.length}`);

// Bucket by family
const byFamily = new Map<string, typeof unverified>();
unverified.forEach((p) => {
  if (!byFamily.has(p.family)) byFamily.set(p.family, []);
  byFamily.get(p.family)!.push(p);
});

console.log(`\n=== Unverified by family ===`);
const familyEntries = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length);
let nonAddressableCount = 0;
let actionableCount = 0;
familyEntries.forEach(([family, params]) => {
  const tag = NON_ADDRESSABLE_FAMILIES.has(family) ? '  [non-addressable]' : '  [ADDRESSABLE]';
  console.log(`  ${family.padEnd(15)} ${params.length.toString().padStart(4, ' ')} ${tag}`);
  if (NON_ADDRESSABLE_FAMILIES.has(family)) nonAddressableCount += params.length;
  else actionableCount += params.length;
});

console.log(`\nNon-addressable total: ${nonAddressableCount}`);
console.log(`Actionable total:      ${actionableCount}`);

// Filter paramId > 16383 (wire-unreachable sentinels)
const wireUnreachable = unverified.filter((p) => p.paramId > 16383);
console.log(`\nWire-unreachable (paramId > 16383): ${wireUnreachable.length}`);

// AM4 symbol index (strip family prefix, fold to upper)
const am4Index = new Map<string, typeof AM4_PARAMS[number]>();
AM4_PARAMS.forEach((p) => {
  // AM4 params have `key` like 'amp:gain' — use that. Also try uppercase suffix.
  am4Index.set(p.key, p);
});

// Build AM4 name index from `name` field (already lowercase). Also
// allow some AM4-specific name conventions:
//   amp.input_select → name='input_select' → INPUT_SELECT/INPUTSEL match
const am4NameIndex = new Map<string, typeof AM4_PARAMS[number]>();
AM4_PARAMS.forEach((p) => {
  am4NameIndex.set(p.name.toUpperCase(), p);
  // Also index without underscores so DISTORT_OUTPUT_LEVEL → OUTPUTLEVEL matches output_level
  am4NameIndex.set(p.name.replace(/_/g, '').toUpperCase(), p);
});

console.log(`\nAM4 catalog size: ${AM4_PARAMS.length} (indexed by name: ${am4NameIndex.size})`);

// For each actionable unverified entry, try to match against AM4 by:
//   1. Strip family prefix from III name (CABINET_MUTE1 → MUTE1)
//   2. Also try without the trailing 1/2/3/4 instance suffix (MUTE)
//   3. Match against AM4 name index (uppercase compare)
const actionable = unverified.filter(
  (p) => !NON_ADDRESSABLE_FAMILIES.has(p.family) && p.paramId <= 16383,
);

console.log(`\nActionable (addressable family + wire-reachable): ${actionable.length}`);

type Match = {
  iiiFamily: string;
  iiiParamId: number;
  iiiName: string;
  iiiBase: string;
  matchedAm4Key: string;
  am4Unit: string;
  am4DisplayMin?: number;
  am4DisplayMax?: number;
};

const matches: Match[] = [];
const unmatched: typeof actionable = [];

// III family → AM4 block name(s). Same musical role across products.
// Built by reading AM4 block names + III family naming convention.
// Multiple AM4 blocks allowed (e.g. CABINET also fits 'cab'); the loop
// tries each and accepts the first AM4 entry with matching name +
// non-unverified unit.
const FAMILY_TO_AM4_BLOCKS: Record<string, string[]> = {
  AMP: ['amp'],
  CABINET: ['cab', 'amp'],
  DISTORT: ['drive'],
  FUZZ: ['drive'],
  DYNDIST: ['drive'],
  COMP: ['compressor'],
  MULTICOMP: ['compressor'],
  CHORUS: ['chorus'],
  FLANGER: ['flanger'],
  PHASER: ['phaser'],
  ROTARY: ['rotary'],
  WAH: ['wah'],
  REVERB: ['reverb'],
  DELAY: ['delay'],
  MULTITAP: ['delay'],
  PLEX: ['delay'],
  MEGATAP: ['delay'],
  TENTAP: ['delay'],
  TREMOLO: ['tremolo'],
  PITCH: ['pitch'],
  FILTER: ['filter'],
  PEQ: ['peq'],
  GEQ: ['geq'],
  GATE: ['gate'],
  ENHANCER: ['enhancer'],
  VOLUME: ['volpan'],
  MIXER: ['volpan'],
  RINGMOD: [], // no AM4 analog
  SYNTH: [],
  VOCODER: [],
  RESONATOR: [],
  FORMANT: [],
  CROSSOVER: [],
  TONEMATCH: [],
  RTA: [],
  LOOPER: [],
  IRPLAYER: ['cab'],
  IRCAPTURE: [],
  MOD: [],
  INPUT: [],
  OUTPUT: [],
  FDBKSEND: [],
  FDBKRET: [],
  MULTIPLEXER: [],
};

for (const iii of actionable) {
  const stripFamily = iii.name.startsWith(iii.family + '_')
    ? iii.name.slice(iii.family.length + 1)
    : iii.name;
  const stripInstance = stripFamily.replace(/[1-4]$/, '');
  const noUnderscore = stripFamily.replace(/_/g, '');
  const noUnderscoreNoInst = stripInstance.replace(/_/g, '');

  const candidates = [stripFamily, stripInstance, noUnderscore, noUnderscoreNoInst];
  const allowedBlocks = FAMILY_TO_AM4_BLOCKS[iii.family] ?? [];

  let matched: typeof AM4_PARAMS[number] | undefined;
  let matchedKey = '';
  outer: for (const cand of candidates) {
    const am4 = am4NameIndex.get(cand);
    if (!am4 || am4.unit === 'unverified') continue;
    // Require AM4 block to be in the same-family mapping
    if (!allowedBlocks.includes(am4.block)) continue;
    matched = am4;
    matchedKey = cand;
    break outer;
  }

  if (matched) {
    matches.push({
      iiiFamily: iii.family,
      iiiParamId: iii.paramId,
      iiiName: iii.name,
      iiiBase: matchedKey,
      matchedAm4Key: matched.key,
      am4Unit: matched.unit,
      am4DisplayMin: matched.displayMin,
      am4DisplayMax: matched.displayMax,
    });
  } else {
    unmatched.push(iii);
  }
}

console.log(`\n=== AM4-borrow candidates: ${matches.length} ===`);
matches.forEach((m) => {
  const range =
    m.am4DisplayMin !== undefined
      ? ` [${m.am4DisplayMin}..${m.am4DisplayMax}]`
      : '';
  console.log(
    `  III ${m.iiiFamily}.${m.iiiParamId} ${m.iiiName.padEnd(35)} → AM4 ${m.matchedAm4Key.padEnd(30)} unit=${m.am4Unit}${range}`,
  );
});

console.log(`\nUnmatched actionable entries: ${unmatched.length}`);
console.log(`(no AM4 analog by name — would need III-specific calibration)`);

// Top unmatched families
const unmatchedByFamily = new Map<string, number>();
unmatched.forEach((p) => {
  unmatchedByFamily.set(p.family, (unmatchedByFamily.get(p.family) ?? 0) + 1);
});
console.log(`\nUnmatched by family:`);
[...unmatchedByFamily.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([family, count]) => {
    console.log(`  ${family.padEnd(15)} ${count}`);
  });

// Also count by family among matched
const matchedByFamily = new Map<string, number>();
matches.forEach((m) => {
  matchedByFamily.set(m.iiiFamily, (matchedByFamily.get(m.iiiFamily) ?? 0) + 1);
});
console.log(`\nMatched by family:`);
[...matchedByFamily.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([family, count]) => {
    console.log(`  ${family.padEnd(15)} ${count}`);
  });
