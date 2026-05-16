/**
 * Coverage audit — auto-snapshot of "what's actually decoded vs shipped vs tested."
 *
 * Reads three sources of truth and joins them:
 *
 *   1. Ghidra catalog (`samples/captured/decoded/ghidra-am4-paramnames.json`)
 *      — every paramId Fractal's own engineers use, keyed by family.
 *      Gracefully skipped if not present locally (it's gitignored).
 *   2. `packages/am4/src/params.ts` — what's actually addressable from MCP.
 *   3. `scripts/verify-msg.ts` — what's wire-tested with byte-exact goldens.
 *
 * Outputs a stdout report with per-family coverage stats and totals. Runs
 * in preflight so a session-start glance answers "where are we?" without
 * scrolling STATE.md handoff lists that go stale.
 *
 * Not a verification script — never fails, just informs.
 *
 *   npx tsx scripts/coverage-audit.ts
 *   npm run coverage-audit  (alias)
 */

import { readFileSync, existsSync } from 'node:fs';

const PARAMS_TS = 'packages/am4/src/params.ts';
const BLOCK_TYPES_TS = 'packages/am4/src/blockTypes.ts';
const VERIFY_MSG_TS = 'scripts/verify-msg.ts';
const GHIDRA_AM4 = 'samples/captured/decoded/ghidra-am4-paramnames.json';

// Block name → catalog family. Multiple blocks can share a family (amp +
// drive both pull from DISTORT). Mirrors generate-am4-params-from-catalog.ts.
const BLOCK_TO_FAMILY: Record<string, string> = {
  amp: 'DISTORT',
  drive: 'DISTORT',
  reverb: 'REVERB',
  delay: 'DELAY',
  chorus: 'CHORUS',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  rotary: 'ROTARY',
  tremolo: 'TREMOLO',
  wah: 'WAH',
  filter: 'FILTER',
  compressor: 'COMP',
  geq: 'GEQ',
  peq: 'PEQ',
  gate: 'GATE',
  enhancer: 'ENHANCER',
  volpan: 'VOLUME',
  cab: 'CABINET',
  preset: 'PATCH',
};

// Generic pidHigh range (shared across all blocks — out-of-catalog).
const GENERIC_PIDHIGH_MAX = 9;
const CHANNEL_REGISTER = 0x07d2;

// --- Load Ghidra catalog (optional) ----------------------------------

interface CatalogEntry { paramId: number; name: string; }
const catalogByFamily: Record<string, CatalogEntry[]> = {};
let catalogTotal = 0;

if (existsSync(GHIDRA_AM4)) {
  const raw = JSON.parse(readFileSync(GHIDRA_AM4, 'utf-8'));
  for (const eff of Object.values(raw.effect_types) as any[]) {
    if (!eff.effectFamily) continue;
    const arr: CatalogEntry[] = Array.isArray(eff.params)
      ? eff.params.map((p: any) => ({ paramId: p.paramId, name: p.name }))
      : [];
    catalogByFamily[eff.effectFamily] = arr;
    catalogTotal += arr.length;
  }
}

// --- Parse params.ts entries -----------------------------------------

const paramsTs = readFileSync(PARAMS_TS, 'utf-8');
const entryRe =
  /^\s+'([a-z]+\.[a-z0-9_]+)':\s*\{[\s\S]*?block:\s*'([a-z]+)',\s*name:\s*'([a-z0-9_]+)',[\s\S]*?pidLow:\s*(0x[0-9a-fA-F]+),\s*pidHigh:\s*(0x[0-9a-fA-F]+)/gm;

interface ParamEntry {
  key: string;
  block: string;
  pidLow: number;
  pidHigh: number;
}
const params: ParamEntry[] = [];
for (const m of paramsTs.matchAll(entryRe)) {
  params.push({
    key: m[1],
    block: m[2],
    pidLow: parseInt(m[4], 16),
    pidHigh: parseInt(m[5], 16),
  });
}

// --- Parse verify-msg.ts goldens -------------------------------------
//
// Goldens are 23-byte SET_PARAM hex strings. Position [6,7] = pidLow
// septets, [8,9] = pidHigh septets. We extract (pidLow, pidHigh) pairs
// to map goldens back to params.

const verifyTs = readFileSync(VERIFY_MSG_TS, 'utf-8');
const goldenHexRe = /expected:\s*'(f0[0-9a-f]+f7)'/g;
const goldenPidPairs = new Set<string>();

function decode14(lo: number, hi: number): number {
  return lo | (hi << 7);
}

for (const m of verifyTs.matchAll(goldenHexRe)) {
  const hex = m[1];
  if (hex.length !== 46) continue; // only 23-byte SET_PARAM frames
  const b = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  if (b(5) !== 0x01) continue; // function byte 0x01 SET_PARAM
  const pidLow = decode14(b(6), b(7));
  const pidHigh = decode14(b(8), b(9));
  goldenPidPairs.add(`${pidLow.toString(16)}.${pidHigh.toString(16)}`);
}

// --- Index params by family ------------------------------------------

interface FamilyCoverage {
  family: string;
  blocks: string[];      // AM4 block names mapped to this family
  catalogCount: number;
  shippedCount: number;
  goldenCount: number;
  genericCount: number;  // shipped entries in pidHigh 0..9 range
  channelCount: number;  // shipped entries at pidHigh=0x07d2
}

const familyMap: Record<string, FamilyCoverage> = {};

// Seed every catalog family even if no params reference it
for (const fam of Object.keys(catalogByFamily)) {
  familyMap[fam] = {
    family: fam,
    blocks: [],
    catalogCount: catalogByFamily[fam].length,
    shippedCount: 0,
    goldenCount: 0,
    genericCount: 0,
    channelCount: 0,
  };
}

// Also seed any block whose family we know but isn't in catalog
for (const [block, family] of Object.entries(BLOCK_TO_FAMILY)) {
  familyMap[family] ??= {
    family,
    blocks: [],
    catalogCount: 0,
    shippedCount: 0,
    goldenCount: 0,
    genericCount: 0,
    channelCount: 0,
  };
  if (!familyMap[family].blocks.includes(block)) familyMap[family].blocks.push(block);
}

// Group families by which catalog paramIds are addressed in params.ts
// (to compute catalog coverage rather than just entry count). Multiple
// blocks → same family means we de-dupe by paramId.
const catalogParamsAddressed: Record<string, Set<number>> = {};
for (const fam of Object.keys(familyMap)) catalogParamsAddressed[fam] = new Set();

for (const p of params) {
  const family = BLOCK_TO_FAMILY[p.block];
  if (!family) continue;
  const fc = familyMap[family];
  if (!fc) continue;
  fc.shippedCount += 1;
  if (p.pidHigh === CHANNEL_REGISTER) {
    fc.channelCount += 1;
  } else if (p.pidHigh <= GENERIC_PIDHIGH_MAX) {
    fc.genericCount += 1;
  } else {
    // pidHigh in catalog-paramId range — count toward catalog coverage
    catalogParamsAddressed[family].add(p.pidHigh);
  }
  if (goldenPidPairs.has(`${p.pidLow.toString(16)}.${p.pidHigh.toString(16)}`)) {
    fc.goldenCount += 1;
  }
}

// --- Render the report -----------------------------------------------

function pad(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}
function padl(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str : ' '.repeat(w - str.length) + str;
}

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  Coverage audit  (' + new Date().toISOString() + ')');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('');
console.log(`AM4 ${PARAMS_TS}: ${params.length} entries`);
console.log(`Ghidra catalog: ${existsSync(GHIDRA_AM4) ? `${Object.keys(catalogByFamily).length} families, ${catalogTotal} paramIds` : 'NOT PRESENT (regenerate via scripts/ghidra/run-am4-paramnames.cmd)'}`);
console.log(`Goldens with SET_PARAM wire bytes: ${goldenPidPairs.size} distinct (pidLow, pidHigh) pairs`);
console.log('');

console.log('AM4 PARAM COVERAGE (per Ghidra catalog family)');
console.log('');
console.log(
  '  ' + pad('Family', 12) + pad('Blocks', 22) +
  padl('Catalog', 9) + padl('In params.ts', 14) + padl('Goldens', 10) + '  ' + 'Catalog %'
);
console.log('  ' + '─'.repeat(78));

const sortedFamilies = Object.values(familyMap)
  .filter((f) => f.catalogCount > 0 || f.shippedCount > 0)
  .sort((a, b) => b.catalogCount - a.catalogCount);

let totalCatalog = 0, totalShipped = 0, totalGolden = 0, totalAddressed = 0;
for (const f of sortedFamilies) {
  const addressedFromCatalog = catalogParamsAddressed[f.family]?.size ?? 0;
  const pct = f.catalogCount > 0
    ? `${Math.round((addressedFromCatalog / f.catalogCount) * 100)}%`
    : '—';
  console.log(
    '  ' + pad(f.family, 12) + pad(f.blocks.join(', ') || '—', 22) +
    padl(f.catalogCount || '—', 9) + padl(f.shippedCount || '—', 14) + padl(f.goldenCount || '—', 10) + '  ' + pct
  );
  totalCatalog += f.catalogCount;
  totalShipped += f.shippedCount;
  totalGolden += f.goldenCount;
  totalAddressed += addressedFromCatalog;
}
console.log('  ' + '─'.repeat(78));
const totalPct = totalCatalog > 0 ? `${Math.round((totalAddressed / totalCatalog) * 100)}%` : '—';
console.log(
  '  ' + pad('TOTAL', 12) + pad('', 22) +
  padl(totalCatalog, 9) + padl(totalShipped, 14) + padl(totalGolden, 10) + '  ' + totalPct
);
console.log('');

// Catalog families NOT mapped to any block — these are the "unbinded" families
const unmappedFamilies = Object.values(familyMap)
  .filter((f) => f.catalogCount > 0 && f.blocks.length === 0);
if (unmappedFamilies.length > 0) {
  console.log('Catalog families WITHOUT a known pidLow binding (potential future MCP surfaces):');
  console.log('');
  for (const f of unmappedFamilies.sort((a, b) => b.catalogCount - a.catalogCount)) {
    console.log(`  ${pad(f.family, 14)} ${padl(f.catalogCount, 4)} paramIds catalog-known`);
  }
  console.log('');
}

// Devices: param/tool registration counts for non-AM4 packages.
// Each device uses a different entry format, so we count via a
// device-specific signature pattern.
const deviceFiles = [
  {
    device: 'Axe-Fx II',
    path: 'packages/axe-fx-ii/src/params.ts',
    // II uses object-array entries keyed by `groupCode`/`paramId` with
    // double-quoted values (auto-generated, JSON-style).
    signature: /groupCode:\s*["']/g,
  },
  {
    device: 'Axe-Fx III',
    path: 'packages/axe-fx-iii/src/blockTypes.ts',
    // III currently exposes blocks (not per-param) through blockTypes.ts.
    // Count `firstId:` lines as a block count proxy until per-param ships.
    signature: /firstId:\s/g,
    label: 'block entries (no per-param decode yet — III SET_PARAM undecoded)',
  },
  {
    device: 'Hydrasynth',
    path: 'packages/hydrasynth-explorer/src/params.ts',
    // Hydra uses object-array entries with `cc:` as the key field.
    signature: /\bcc:\s*\d/g,
  },
];

console.log('OTHER DEVICES');
console.log('');
for (const { device, path, signature, label } of deviceFiles) {
  if (existsSync(path)) {
    const src = readFileSync(path, 'utf-8');
    const count = (src.match(signature) || []).length;
    console.log(`  ${pad(device, 14)} ${padl(count, 4)} ${label ?? 'param entries'} (${path})`);
  } else {
    console.log(`  ${pad(device, 14)}    — (no params.ts; uses different surface)`);
  }
}
console.log('');

// What the audit DOESN'T tell you — direct ask for the open work
console.log('READ THIS WHEN PLANNING NEXT WORK');
console.log('');
console.log('  • Catalog % counts only entries with pidHigh >= 10 — generic params');
console.log('    (level/mix/balance/bypass at pidHigh 0-9, plus channel-select at');
console.log('    0x07D2) are NOT in the catalog and are counted separately in the');
console.log('    "In params.ts" column.');
console.log('  • Goldens column counts entries where verify-msg.ts has a byte-');
console.log('    exact wire test. Entries without goldens are unverified end-to-end.');
console.log('  • "Catalog families WITHOUT pidLow" lists every family the binary');
console.log('    knows about but we haven\'t mapped to a wire address yet —');
console.log('    each one is a potential MCP surface unlock from one capture.');
console.log('');
