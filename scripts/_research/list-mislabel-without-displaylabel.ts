// Find WIRED-MISLABEL entries that DON'T already carry a `displayLabel`
// field. After 077c1c0 the schema resolver surfaces displayLabel as the
// LLM-facing friendly name, so a MISLABEL with displayLabel is already
// fine — no rename needed. A MISLABEL without displayLabel is a real
// UX gap: the LLM only sees the snake_case `name`, which may not match
// the user's natural-language prompt.

import { readFileSync } from 'node:fs';

const PARAMS_TS = 'packages/am4/src/params.ts';
const GHIDRA = 'samples/captured/decoded/ghidra-am4-paramnames.json';
const XML_REG = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const XML_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';

// Load XML symbol → display label.
const xml = new Map<string, string>();
for (const x of [readFileSync(XML_REG, 'utf-8'), readFileSync(XML_EXPERT, 'utf-8')]) {
  for (const m of x.matchAll(/<EditorControl\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const sym = attrs.match(/parameterName="([A-Z][A-Z0-9_]*)"/)?.[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1]?.replace(/&#10;/g, ' ');
    if (sym && name && !xml.has(sym)) xml.set(sym, name);
  }
}

// Load catalog.
const cat = JSON.parse(readFileSync(GHIDRA, 'utf-8'));
const catBySymbol = new Map<string, { family: string; paramId: number }>();
for (const eff of Object.values(cat.effect_types) as any[]) {
  if (!eff.effectFamily || !eff.params) continue;
  for (const p of eff.params) {
    if (p.name && p.name !== '?') catBySymbol.set(p.name, { family: eff.effectFamily, paramId: p.paramId });
  }
}

// Load params.ts WITH displayLabel detection.
const ts = readFileSync(PARAMS_TS, 'utf-8');
const re = /^\s+'([a-z]+\.[a-z0-9_]+)':\s*\{([^\}]*)\}/gm;
type P = { key: string; block: string; name: string; pidLow: number; pidHigh: number; hasDisplayLabel: boolean };
const params: P[] = [];
for (const m of ts.matchAll(re)) {
  const body = m[2];
  const block = body.match(/block:\s*'([^']+)'/)?.[1];
  const name = body.match(/\bname:\s*'([^']+)'/)?.[1];
  const pidLow = parseInt(body.match(/pidLow:\s*(0x[0-9a-fA-F]+)/)?.[1] ?? '0', 16);
  const pidHigh = parseInt(body.match(/pidHigh:\s*(0x[0-9a-fA-F]+)/)?.[1] ?? '0', 16);
  if (!block || !name) continue;
  params.push({ key: m[1], block, name, pidLow, pidHigh, hasDisplayLabel: /displayLabel:/.test(body) });
}

const HARDCODED_PIDLOW: Record<string, number> = {
  GLOBAL: 0x0001, COMP: 0x002e, GEQ: 0x0032, PEQ: 0x0036, DISTORT: 0x003a,
  CABINET: 0x003e, REVERB: 0x0042, DELAY: 0x0046, CHORUS: 0x004e,
  FLANGER: 0x0052, ROTARY: 0x0056, PHASER: 0x005a, WAH: 0x005e,
  VOLUME: 0x0066, TREMOLO: 0x006a, FILTER: 0x0072, ENHANCER: 0x007a,
  GATE: 0x0092, PATCH: 0x00ce, INPUT: 0x0025,
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const byAddr = new Map<string, P>();
for (const p of params) byAddr.set(`${p.pidLow}.${p.pidHigh}`, p);

const missing: { entry: P; symbol: string; family: string; xmlLabel: string }[] = [];
for (const [symbol, { family, paramId }] of catBySymbol) {
  const pl = HARDCODED_PIDLOW[family];
  if (pl === undefined) continue;
  const p = byAddr.get(`${pl}.${paramId}`);
  if (!p) continue;
  const xmlLabel = xml.get(symbol);
  if (!xmlLabel) continue;
  if (norm(p.name) === norm(xmlLabel)) continue;  // matched
  if (p.hasDisplayLabel) continue;                 // already covered by resolver
  missing.push({ entry: p, symbol, family, xmlLabel });
}

console.log(`# WIRED-MISLABEL entries WITHOUT displayLabel — ${missing.length} candidates\n`);
console.log('| family | paramId | symbol | XML label | params.ts key | params.ts name |');
console.log('|---|---|---|---|---|---|');
for (const m of missing) {
  console.log(`| ${m.family} | ${m.entry.pidHigh} | \`${m.symbol}\` | "${m.xmlLabel}" | \`${m.entry.key}\` | \`${m.entry.name}\` |`);
}
