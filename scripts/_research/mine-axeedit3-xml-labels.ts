/**
 * Mine the Axe-Edit III JUCE-BinaryData XML files for parameterName →
 * displayLabel + controlType + page-context catalog.
 *
 * Source XML (already extracted from `Axe-Edit III.exe`'s JUCE
 * BinaryData zip, gitignored under `samples/captured/decoded/binarydata/`):
 *
 *   __block_layout.xml   — 8,645 parameterName entries (every III block)
 *   __amp_layout.xml     — 2,060 parameterName entries (amp-variant pages)
 *   __amp_layout_v24p00.xml / _v24p05.xml / _v28p09.xml — per-firmware
 *                          amp layouts; mined for any parameterName the
 *                          base XML omits.
 *
 * Why mine this. The III Ghidra catalog (Session 82) gives 2,216
 * (paramId, symbolicName) pairs but NOT the display unit, range, or
 * human label. AM4 closes that gap by borrowing display calibration
 * from `packages/am4/src/params.ts` via the override loader
 * (`scripts/_research/axefx3-am4-overrides.ts`, Session 93), but
 * AM4-borrow only covers III symbols whose suffix already exists in
 * AM4 (~30% of catalog). This XML mine fills the remaining gap with
 * Axe-Edit III's OWN display labels — the same labels the editor's UI
 * shows under each knob — and a control-type hint that maps cleanly
 * to a unit guess:
 *
 *   knob / sliderMini / hslider      → numeric (range TBD)
 *   dropdown* / combo / pulldown     → enum
 *   toggle / toggleGroup / radio     → enum off/on (or N-way)
 *   meterGainHeadroom / meterVU      → dB
 *   readout / readoutCtrl*           → string / text display
 *
 * Output:
 *   samples/captured/decoded/axeedit3-xml-labels.json
 *     [
 *       {
 *         parameterName: "DISTORT_DRIVE",
 *         displayLabel: "Gain",
 *         controlType: "knob",
 *         sources: [
 *           {file: "__amp_layout.xml", page: "0", pageName: "Authentic"},
 *           ...
 *         ],
 *         variants: ["Gain", "Drive", "Input Drive"]  // distinct labels
 *                                                     // seen across files
 *       },
 *       ...
 *     ]
 *
 * Consumer. The override loader (universal-fallback workstream
 * 2026-05-17) can join this JSON against the III Ghidra catalog to
 * populate `displayLabel` and infer `unit` for III params.ts entries
 * that AM4-borrow doesn't cover.
 *
 * Run:
 *   npx tsx scripts/_research/mine-axeedit3-xml-labels.ts
 *     [--out samples/captured/decoded/axeedit3-xml-labels.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

const XML_DIR =
  'samples/captured/decoded/binarydata/axe-edit-iii-allzips/extracted';
const SOURCES = [
  '__block_layout.xml',
  '__amp_layout.xml',
  '__amp_layout_v24p00.xml',
  '__amp_layout_v24p05.xml',
  '__amp_layout_v28p09.xml',
];
const OUT = flag(
  'out',
  'samples/captured/decoded/axeedit3-xml-labels.json',
)!;

interface SourceHit {
  file: string;
  page?: string;
  pageName?: string;
  controllingParamName?: string;
  controllingParamValue?: string;
}

interface CatalogEntry {
  parameterName: string;
  displayLabel: string;
  controlType: string;
  sources: SourceHit[];
  variants: string[];
}

// Track ALL hits per parameterName so we can pick a canonical label
// + emit all distinct label variants seen across the XML.
const hits = new Map<
  string,
  Array<{
    file: string;
    page?: string;
    pageName?: string;
    controllingParamName?: string;
    controllingParamValue?: string;
    name: string;
    type: string;
  }>
>();

const editorControlRe = /<EditorControl\b([^>]*?)\/?>/g;
const pageOpenRe = /<Page\b([^>]*?)>/g;

function attr(s: string, key: string): string | undefined {
  const m = s.match(new RegExp(`\\b${key}="([^"]*)"`));
  return m ? m[1] : undefined;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#10;/g, ' ')
    .replace(/&#13;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Track open Page context as we walk the XML so each EditorControl hit
// carries its enclosing page metadata. Page boundaries are detected by
// line scan (sufficient for the flat AxeEdit III layout files).
interface PageContext {
  pageNum?: string;
  pageName?: string;
}
function scanFile(filename: string): void {
  const path = `${XML_DIR}/${filename}`;
  const xml = readFileSync(path, 'utf-8');

  // Build (offset → page context) map by scanning <Page ...> opens.
  const pageOpens: Array<{ offset: number; ctx: PageContext }> = [];
  for (const m of xml.matchAll(pageOpenRe)) {
    pageOpens.push({
      offset: m.index!,
      ctx: {
        pageNum: attr(m[1], 'pageNum'),
        pageName: attr(m[1], 'name'),
      },
    });
  }

  function pageAt(offset: number): PageContext {
    let last: PageContext = {};
    for (const p of pageOpens) {
      if (p.offset > offset) break;
      last = p.ctx;
    }
    return last;
  }

  let count = 0;
  for (const m of xml.matchAll(editorControlRe)) {
    const attrs = m[1];
    const parameterName = attr(attrs, 'parameterName');
    if (!parameterName) continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(parameterName)) continue;
    const name = attr(attrs, 'name');
    const type = attr(attrs, 'type') ?? '';
    // EditorControls without a name (e.g. spacers, modifier-only) carry
    // no display info — skip.
    if (!name) continue;
    const decoded = decodeXmlEntities(name);
    if (!decoded) continue;
    const ctx = pageAt(m.index!);
    const arr = hits.get(parameterName) ?? [];
    arr.push({
      file: filename,
      page: ctx.pageNum,
      pageName: ctx.pageName,
      controllingParamName: attr(attrs, 'controllingParamName'),
      controllingParamValue:
        attr(attrs, 'controllingParamValue') ??
        attr(attrs, 'controllingParamStrValue'),
      name: decoded,
      type,
    });
    hits.set(parameterName, arr);
    count++;
  }
  console.log(`  ${filename}: ${count} parameterName hits`);
}

console.log(`mining III XML labels from ${XML_DIR}…`);
for (const f of SOURCES) scanFile(f);

// Reduce hits → CatalogEntry. Canonical label is the most-common label;
// variants list every distinct label seen.
const catalog: CatalogEntry[] = [];
for (const [parameterName, items] of [...hits.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const labelCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (const it of items) {
    labelCounts.set(it.name, (labelCounts.get(it.name) ?? 0) + 1);
    if (it.type) typeCounts.set(it.type, (typeCounts.get(it.type) ?? 0) + 1);
  }
  const displayLabel = [...labelCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0];
  const controlType =
    [...typeCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? '';
  catalog.push({
    parameterName,
    displayLabel,
    controlType,
    sources: items.map((it) => ({
      file: it.file,
      page: it.page,
      pageName: it.pageName,
      controllingParamName: it.controllingParamName,
      controllingParamValue: it.controllingParamValue,
    })),
    variants: [...new Set(items.map((it) => it.name))].sort(),
  });
}

writeFileSync(OUT, JSON.stringify(catalog, null, 2), 'utf-8');

// Stats summary.
const total = catalog.length;
const byType = new Map<string, number>();
for (const e of catalog) {
  byType.set(e.controlType, (byType.get(e.controlType) ?? 0) + 1);
}
console.log('');
console.log(`wrote ${total.toLocaleString()} unique parameterName entries → ${OUT}`);
console.log('');
console.log('control-type distribution:');
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(t || '(none)').padEnd(28)} ${n.toString().padStart(5)}`);
}
console.log('');

// Quick sanity check: how many entries carry the canonical Fractal
// family prefixes? (Confirms we're hitting symbolic names, not UI-only
// labels.)
const familyPrefixes = [
  'REVERB_', 'DELAY_', 'DISTORT_', 'CHORUS_', 'FLANGER_', 'PHASER_',
  'COMP_', 'WAH_', 'FILTER_', 'GATE_', 'TREMOLO_', 'ROTARY_', 'PEQ_',
  'GEQ_', 'ENHANCER_', 'VOLUME_', 'CABINET_', 'GLOBAL_', 'PATCH_',
  'PITCH_', 'MULTITAP_', 'MOD_', 'CONTROLLERS_', 'INPUT_', 'OUTPUT_',
  'MIXER_', 'PLEX_', 'TENTAP_', 'VOCODER_', 'MEGATAP_', 'FUZZ_',
  'SYNTH_', 'RESONATOR_', 'MULTICOMP_', 'IRPLAYER_', 'TONEMATCH_',
  'CROSSOVER_', 'DYNDIST_', 'RINGMOD_', 'RTA_', 'FORMANT_',
  'MIDIBLOCK_', 'IRCAPTURE_', 'FDBKRET_', 'FDBKSEND_', 'LOOPER_',
];
const byFamily = new Map<string, number>();
for (const e of catalog) {
  for (const p of familyPrefixes) {
    if (e.parameterName.startsWith(p)) {
      byFamily.set(p, (byFamily.get(p) ?? 0) + 1);
      break;
    }
  }
}
console.log('per-family entry count (Ghidra-catalog prefix match):');
for (const [p, n] of [...byFamily.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(16)} ${n.toString().padStart(4)}`);
}
const unmatched = catalog.filter(
  (e) => !familyPrefixes.some((p) => e.parameterName.startsWith(p)),
);
console.log(`  (no-family-prefix)  ${unmatched.length.toString().padStart(4)}`);
if (unmatched.length && unmatched.length < 30) {
  console.log('  no-family-prefix sample:');
  for (const e of unmatched.slice(0, 30)) {
    console.log(`    ${e.parameterName.padEnd(40)} → "${e.displayLabel}"`);
  }
}
