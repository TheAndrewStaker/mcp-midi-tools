// Print full UI-MISSING entries for one or more families. The shipping
// cross-ref audit caps at top 50 — this script removes the cap.
//
//   npx tsx scripts/_research/list-ui-missing.ts PATCH CABINET DISTORT
//
// Reuses the cross-ref audit's loader logic verbatim so the
// classification matches.

import { readFileSync } from 'node:fs';

const KEEP = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
if (KEEP.size === 0) {
  console.error('usage: list-ui-missing.ts FAMILY1 FAMILY2 ...');
  process.exit(1);
}

const GHIDRA_AM4 = 'samples/captured/decoded/ghidra-am4-paramnames.json';
const PARAMS_TS = 'packages/am4/src/params.ts';
const XML_REG = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const XML_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';

interface XmlControl { displayName: string; effectName?: string }
function loadXml(): Map<string, XmlControl[]> {
  const result = new Map<string, XmlControl[]>();
  const xmls = [readFileSync(XML_REG, 'utf-8'), readFileSync(XML_EXPERT, 'utf-8')];
  const tagRe = /<EditorControl\b([^>]*?)\/?>/g;
  for (const xml of xmls) {
    for (const m of xml.matchAll(tagRe)) {
      const attrs = m[1];
      const symMatch = attrs.match(/parameterName="([A-Z][A-Z0-9_]*)"/);
      if (!symMatch) continue;
      const sym = symMatch[1];
      const nameMatch = attrs.match(/\bname="([^"]+)"/);
      const effMatch = attrs.match(/effectName="([^"]+)"/);
      const displayName = (nameMatch?.[1] ?? '').replace(/&#10;/g, ' ');
      const ctrl: XmlControl = { displayName };
      if (effMatch) ctrl.effectName = effMatch[1];
      const list = result.get(sym) ?? [];
      list.push(ctrl);
      result.set(sym, list);
    }
  }
  return result;
}

function loadCatalog(): Map<string, { paramId: number; symbol: string }[]> {
  const data = JSON.parse(readFileSync(GHIDRA_AM4, 'utf-8'));
  const result = new Map<string, { paramId: number; symbol: string }[]>();
  for (const eff of Object.values(data.effect_types) as any[]) {
    if (!eff.effectFamily || !eff.params) continue;
    const arr = eff.params
      .filter((p: any) => p.name && p.name !== '?')
      .map((p: any) => ({ paramId: p.paramId, symbol: p.name }));
    result.set(eff.effectFamily, arr);
  }
  return result;
}

interface ParamEntry { key: string; block: string; name: string; pidLow: number; pidHigh: number }
function loadParamsTs(): ParamEntry[] {
  const ts = readFileSync(PARAMS_TS, 'utf-8');
  const re = /^\s+'([a-z]+\.[a-z0-9_]+)':\s*\{[\s\S]*?block:\s*'([a-z]+)',\s*name:\s*'([a-z0-9_]+)',[\s\S]*?pidLow:\s*(0x[0-9a-fA-F]+),\s*pidHigh:\s*(0x[0-9a-fA-F]+)/gm;
  const result: ParamEntry[] = [];
  for (const m of ts.matchAll(re)) {
    result.push({ key: m[1], block: m[2], name: m[3], pidLow: parseInt(m[4], 16), pidHigh: parseInt(m[5], 16) });
  }
  return result;
}

// Same family → pidLow mapping the audit uses.
const HARDCODED_PIDLOW: Record<string, number> = {
  GLOBAL: 0x0001, COMP: 0x002e, GEQ: 0x0032, PEQ: 0x0036, DISTORT: 0x003a,
  CABINET: 0x003e, REVERB: 0x0042, DELAY: 0x0046, CHORUS: 0x004e,
  FLANGER: 0x0052, ROTARY: 0x0056, PHASER: 0x005a, WAH: 0x005e,
  VOLUME: 0x0066, TREMOLO: 0x006a, FILTER: 0x0072, ENHANCER: 0x007a,
  GATE: 0x0092, PATCH: 0x00ce, INPUT: 0x0025,
};

const xml = loadXml();
const catalog = loadCatalog();
const params = loadParamsTs();
const paramsByAddr = new Map<string, ParamEntry>();
for (const p of params) paramsByAddr.set(`${p.pidLow}.${p.pidHigh}`, p);

for (const fam of KEEP) {
  const entries = catalog.get(fam);
  const pl = HARDCODED_PIDLOW[fam];
  if (!entries || pl === undefined) {
    console.log(`# ${fam} — no catalog or no pidLow`);
    continue;
  }
  const missing: { paramId: number; symbol: string; xml: XmlControl }[] = [];
  for (const { paramId, symbol } of entries.sort((a, b) => a.paramId - b.paramId)) {
    if (paramsByAddr.has(`${pl}.${paramId}`)) continue;
    const xmlEntry = xml.get(symbol);
    if (!xmlEntry) continue;
    missing.push({ paramId, symbol, xml: xmlEntry[0] });
  }
  console.log(`\n# ${fam} UI-MISSING (pidLow=0x${pl.toString(16).padStart(4, '0')}) — ${missing.length} entries\n`);
  console.log('| paramId | catalog symbol | XML display | XML effect |');
  console.log('|---|---|---|---|');
  for (const m of missing) {
    console.log(`| ${m.paramId} | \`${m.symbol}\` | "${m.xml.displayName}" | ${m.xml.effectName ?? '—'} |`);
  }
}
