/**
 * Filter the AM4 + III cross-validation deltas to identify the real
 * addressable-param unlocks worth merging into params.ts.
 *
 * Filters applied:
 *   - Drop ID_* family (block-identifier constants → blockTypes.ts).
 *   - Drop paramId >= 65000 (UI button widgets, not wire-addressable).
 *   - Drop GLOBAL_FC_* on III (foot controller, non-addressable per v1.4 PDF).
 *   - Drop FC_* on III (same).
 *   - Drop PRESET_* on III (metadata, not param).
 *   - Drop MULTIPLEXER, FDBKSEND, MEGATAP placeholder noise.
 *   - Drop CABINET_PICKER/NAME/LABEL/COPY_MENU/ALIGN_BTN UI elements.
 *   - Drop CONTROLLERS_*_SET_ALL / *_VAL_ALL / SEQ_GRID_HILITE UI.
 *
 * Run: npx tsx scripts/_research/filter-cross-validation-deltas.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface DispatcherEffect {
  caseIdx: number;
  effectFamily?: string;
  params: { paramId: number; name: string }[];
}
interface DispatcherDump {
  effect_types: Record<string, DispatcherEffect>;
}
interface DirectScanTable {
  effectFamily: string | null;
  params: { paramId: number; name: string }[];
}
interface DirectScanDump {
  tables: DirectScanTable[];
}

function flattenDispatcher(dump: DispatcherDump) {
  const byName = new Map<string, { paramId: number; effectFamily?: string }>();
  for (const eff of Object.values(dump.effect_types)) {
    for (const p of eff.params) {
      if (!byName.has(p.name)) {
        byName.set(p.name, {
          paramId: p.paramId,
          effectFamily: eff.effectFamily,
        });
      }
    }
  }
  return byName;
}

function flattenDirectScan(dump: DirectScanDump) {
  const byName = new Map<string, { paramId: number; effectFamily?: string }>();
  const canonical: Record<string, DirectScanTable> = {};
  for (const t of dump.tables) {
    const fam = t.effectFamily ?? 'UNKNOWN';
    if (!canonical[fam] || t.params.length > canonical[fam].params.length) {
      canonical[fam] = t;
    }
  }
  for (const t of Object.values(canonical)) {
    for (const p of t.params) {
      if (t.effectFamily && !p.name.startsWith(t.effectFamily + '_')) continue;
      if (!byName.has(p.name)) {
        byName.set(p.name, {
          paramId: p.paramId,
          effectFamily: t.effectFamily ?? undefined,
        });
      }
    }
  }
  return byName;
}

const NOISE_FAMILIES = new Set(['ID']);
// III-specific non-addressable per v1.4 PDF.
const III_NOISE_FAMILIES = new Set(['ID', 'GLOBAL_FC', 'FC', 'PRESET']);

function isUIWidget(name: string, paramId: number): boolean {
  if (paramId >= 65000) return true;
  // CABINET UI widgets (not in 65000+ range but UI-only).
  if (/^CABINET_(PICKER|NAME|LABEL|COPY_MENU|ALIGN_BTN|ALIGN_GRAPH)/.test(name))
    return true;
  // CONTROLLERS UI matrix widgets.
  if (/^CONTROLLERS_(SCENE\d+_SET_ALL|SCENE\d+_VAL_ALL|SEQ_SET_ALL|SEQ_VAL_ALL|SEQ_GRID_HILITE)/.test(
    name,
  ))
    return true;
  return false;
}

function familyPrefix(name: string): string {
  // Match longest prefix from a fixed list to catch GLOBAL_FC_* vs GLOBAL_*.
  if (name.startsWith('GLOBAL_FC_') || /^GLOBAL_FC$/.test(name)) return 'GLOBAL_FC';
  const m = name.match(/^([A-Z][A-Z0-9]*)_/);
  return m ? m[1] : name;
}

function filterDeltas(
  diff: Map<string, { paramId: number; effectFamily?: string }>,
  noise: Set<string>,
): Array<{ name: string; paramId: number; family: string }> {
  const out: Array<{ name: string; paramId: number; family: string }> = [];
  for (const [name, d] of diff) {
    if (isUIWidget(name, d.paramId)) continue;
    const fam = d.effectFamily ?? familyPrefix(name);
    if (noise.has(fam)) continue;
    // Also drop ID_* by name (catches direct-scan-only ID family).
    if (name.startsWith('ID_')) continue;
    out.push({ name, paramId: d.paramId, family: fam });
  }
  out.sort((a, b) => {
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.paramId - b.paramId;
  });
  return out;
}

function diff(
  a: Map<string, { paramId: number; effectFamily?: string }>,
  b: Map<string, { paramId: number; effectFamily?: string }>,
): Map<string, { paramId: number; effectFamily?: string }> {
  const out = new Map<string, { paramId: number; effectFamily?: string }>();
  for (const [name, d] of a) {
    if (!b.has(name)) out.set(name, d);
  }
  return out;
}

// AM4
const am4Disp = flattenDispatcher(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-am4-paramnames.json',
      'utf8',
    ),
  ),
);
const am4Direct = flattenDirectScan(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-am4edit-paramtables.json',
      'utf8',
    ),
  ),
);
const am4DispOnly = diff(am4Disp, am4Direct);
const am4DirectOnly = diff(am4Direct, am4Disp);
const am4DispOnlyFiltered = filterDeltas(am4DispOnly, NOISE_FAMILIES);
const am4DirectOnlyFiltered = filterDeltas(am4DirectOnly, NOISE_FAMILIES);

// III
const iiiDisp = flattenDispatcher(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-axeedit3-paramnames.json',
      'utf8',
    ),
  ),
);
const iiiDirect = flattenDirectScan(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-axeeditiii-paramtables.json',
      'utf8',
    ),
  ),
);
const iiiDispOnly = diff(iiiDisp, iiiDirect);
const iiiDirectOnly = diff(iiiDirect, iiiDisp);
const iiiDispOnlyFiltered = filterDeltas(iiiDispOnly, III_NOISE_FAMILIES);
const iiiDirectOnlyFiltered = filterDeltas(iiiDirectOnly, III_NOISE_FAMILIES);

function summarize(label: string, entries: Array<{ family: string }>) {
  console.log(`  ${label}: ${entries.length}`);
  const perFam = new Map<string, number>();
  for (const e of entries) perFam.set(e.family, (perFam.get(e.family) ?? 0) + 1);
  for (const [f, n] of [...perFam.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${f.padEnd(16)} ${n}`);
  }
}

console.log('=== AM4 ===');
console.log('Raw dispatcher-only:', am4DispOnly.size);
console.log('Raw direct-scan-only:', am4DirectOnly.size);
summarize('dispatcher-only (after filtering UI + ID noise)', am4DispOnlyFiltered);
summarize('direct-scan-only (after filtering UI + ID noise)', am4DirectOnlyFiltered);
console.log('');
console.log('=== III ===');
console.log('Raw dispatcher-only:', iiiDispOnly.size);
console.log('Raw direct-scan-only:', iiiDirectOnly.size);
summarize('dispatcher-only (after filtering UI + ID + FC noise)', iiiDispOnlyFiltered);
summarize('direct-scan-only (after filtering UI + ID + FC noise)', iiiDirectOnlyFiltered);

const out = {
  _generator: 'scripts/_research/filter-cross-validation-deltas.ts',
  am4: {
    dispatcherOnlyFiltered: am4DispOnlyFiltered,
    directScanOnlyFiltered: am4DirectOnlyFiltered,
  },
  iii: {
    dispatcherOnlyFiltered: iiiDispOnlyFiltered,
    directScanOnlyFiltered: iiiDirectOnlyFiltered,
  },
};
writeFileSync(
  'samples/captured/decoded/cross-validation-deltas-filtered.json',
  JSON.stringify(out, null, 2),
  'utf8',
);
console.log('');
console.log('Wrote samples/captured/decoded/cross-validation-deltas-filtered.json');
