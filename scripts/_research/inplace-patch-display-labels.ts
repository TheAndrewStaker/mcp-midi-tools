// Splice `displayLabel` from AM4-Edit XML into every params.ts entry
// where the XML carries a label and the entry doesn't already have one.
// Idempotent. Drives `display_name` in list_params (resolver lands in
// schema.ts:138).

import { readFileSync, writeFileSync } from 'node:fs';

const PARAMS_TS = 'packages/am4/src/params.ts';
const XML_REG = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const XML_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';
const GHIDRA = 'samples/captured/decoded/ghidra-am4-paramnames.json';

const xml = new Map<string, string>();
for (const x of [readFileSync(XML_REG, 'utf-8'), readFileSync(XML_EXPERT, 'utf-8')]) {
  for (const m of x.matchAll(/<EditorControl\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const sym = attrs.match(/parameterName="([A-Z][A-Z0-9_]*)"/)?.[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1]
      ?.replace(/&#10;/g, ' ')
      .replace(/&amp;/g, '&');
    if (sym && name && !xml.has(sym)) xml.set(sym, name);
  }
}

// (family pidLow, paramId) → catalog symbol. Mirrors the cross-ref audit's
// HARDCODED_PIDLOW table.
const HARDCODED_PIDLOW: Record<string, number> = {
  GLOBAL: 0x0001, COMP: 0x002e, GEQ: 0x0032, PEQ: 0x0036, DISTORT: 0x003a,
  CABINET: 0x003e, REVERB: 0x0042, DELAY: 0x0046, CHORUS: 0x004e,
  FLANGER: 0x0052, ROTARY: 0x0056, PHASER: 0x005a, WAH: 0x005e,
  VOLUME: 0x0066, TREMOLO: 0x006a, FILTER: 0x0072, ENHANCER: 0x007a,
  GATE: 0x0092, PATCH: 0x00ce, INPUT: 0x0025,
};
const cat = JSON.parse(readFileSync(GHIDRA, 'utf-8'));
const symByAddr = new Map<string, string>();
for (const eff of Object.values(cat.effect_types) as any[]) {
  if (!eff.effectFamily || !eff.params) continue;
  const pl = HARDCODED_PIDLOW[eff.effectFamily];
  if (pl === undefined) continue;
  for (const p of eff.params) {
    if (!p.name || p.name === '?') continue;
    const k = `${pl}.${p.paramId}`;
    if (!symByAddr.has(k)) symByAddr.set(k, p.name);
  }
}

let ts = readFileSync(PARAMS_TS, 'utf-8');
let patched = 0;

// Match entries that lack displayLabel. Captures the block name so we
// can join (block_pidLow, pidHigh) → catalog symbol → xml label.
const re = /('[a-z]+\.[a-z0-9_]+':\s*\{\s*block:\s*'([a-z]+)',\s*name:\s*'[a-z0-9_]+',)(\s*)(pidLow:\s*(0x[0-9a-fA-F]+),\s*pidHigh:\s*(0x[0-9a-fA-F]+))/g;

ts = ts.replace(re, (full, head, _block, gap, tail, pidLowHex, pidHighHex) => {
  if (head.includes('displayLabel:')) return full;
  const pidLow = parseInt(pidLowHex, 16);
  const paramId = parseInt(pidHighHex, 16);
  const sym = symByAddr.get(`${pidLow}.${paramId}`);
  if (!sym) return full;
  const label = xml.get(sym);
  if (!label) return full;
  patched++;
  const safe = label.replace(/"/g, '\\"');
  return `${head} displayLabel: "${safe}",${gap}${tail}`;
});

writeFileSync(PARAMS_TS, ts);
console.log(`Patched ${patched} entries with displayLabel from XML.`);
