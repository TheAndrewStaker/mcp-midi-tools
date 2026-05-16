/**
 * Generate proposed AM4 params.ts entries from the Ghidra catalog.
 *
 * Mapping (verified at 99% match rate against our hand-decoded entries):
 *
 *   pidLow  = block-type identifier (from packages/am4/src/blockTypes.ts)
 *   pidHigh = paramId (from the Ghidra catalog, for paramIds ≥ 10)
 *
 *   pidHigh 0-9 are generic shared params:
 *     0: level, 1: mix, 2: balance, 4: bypass_mode
 *     (and a few more we haven't enumerated)
 *
 *   pidHigh = 2002 is the channel-select register (different code path).
 *
 * For every UI-relevant Ghidra catalog entry that we don't already have
 * in params.ts, this script emits a proposed entry. The founder reviews,
 * adjusts naming convention (e.g. HICUT → high_cut), and merges.
 *
 * Output: samples/captured/decoded/am4-params-proposed.ts
 *         (Not in packages/am4/src/ — review-first.)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const GHIDRA_AM4 = 'samples/captured/decoded/ghidra-am4-paramnames.json';
const PARAMS_TS = 'packages/am4/src/params.ts';
const BLOCK_TYPES_TS = 'packages/am4/src/blockTypes.ts';
const XML_REG = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const XML_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';
const OUTPUT = 'samples/captured/decoded/am4-params-proposed.ts';

// --- Step 1: load blockTypes pidLow values ---

const blockTypesSrc = readFileSync(BLOCK_TYPES_TS, 'utf-8');
const blockPidLow: Record<string, number> = {};
for (const m of blockTypesSrc.matchAll(/^\s+([a-z]+):\s+(0x[0-9a-fA-F]+),/gm)) {
  blockPidLow[m[1]] = parseInt(m[2], 16);
}
console.log(`Block-type pidLows: ${Object.keys(blockPidLow).length}`);

// --- Step 2: map Ghidra family → our block name ---

const FAMILY_TO_BLOCK: Record<string, string> = {
  REVERB: 'reverb',
  DELAY: 'delay',
  CHORUS: 'chorus',
  FLANGER: 'flanger',
  PHASER: 'phaser',
  ROTARY: 'rotary',
  TREMOLO: 'tremolo',
  WAH: 'wah',
  FILTER: 'filter',
  DISTORT: 'drive',
  COMP: 'compressor',
  GEQ: 'geq',
  PEQ: 'peq',
  GATE: 'gate',
  ENHANCER: 'enhancer',
  VOLUME: 'volpan',
};

// --- Step 3: load existing params.ts entries (set of (block, pidHigh)) ---

const paramsTs = readFileSync(PARAMS_TS, 'utf-8');
const existing = new Set<string>();
const entryRe = /block:\s*'([a-z]+)',\s*name:\s*'([a-z0-9_]+)',[\s\S]*?pidLow:\s*(0x[0-9a-fA-F]+),\s*pidHigh:\s*(0x[0-9a-fA-F]+)/g;
for (const m of paramsTs.matchAll(entryRe)) {
  existing.add(`${m[1]}:${parseInt(m[4], 16)}`);
}
console.log(`Existing (block, pidHigh) pairs: ${existing.size}`);

// --- Step 4: load UI-referenced params from XML (filter to user-facing) ---

function loadUI(path: string): Set<string> {
  const xml = readFileSync(path, 'utf-8');
  const set = new Set<string>();
  for (const m of xml.matchAll(/parameterName="([A-Z][A-Z0-9_]+)"/g)) set.add(m[1]);
  return set;
}
const uiAll = new Set([...loadUI(XML_REG), ...loadUI(XML_EXPERT)]);
console.log(`UI-referenced params (XML): ${uiAll.size}`);

// --- Step 5: load Ghidra catalog and generate proposed entries ---

const catalog = JSON.parse(readFileSync(GHIDRA_AM4, 'utf-8'));

// Convert SCREAMING_SNAKE → our convention.
// Treat common synonyms (HICUT → high_cut, PREDELAY → predelay, NUMSPRINGS → springs).
const NAMING_ALIAS: Record<string, string> = {
  HICUT: 'high_cut',
  LOWCUT: 'low_cut',
  HFRATIO: 'hf_ratio',
  LFTIME: 'lf_time',
  LFXOVER: 'lf_xover',
  PREDELAY: 'predelay',
  NUMSPRINGS: 'springs',
  INPDIFF: 'input_diffusion',
  INDIFFTIME: 'input_diff_time',
  EARLYLEVEL: 'early_level',
  EARLYDIFF: 'early_diffusion',
  EARLYDIFFTIME: 'early_diff_time',
  EARLYDECAY: 'early_decay',
  EARLYSEND: 'early_send',
  LFOPHASE: 'lfo_phase',
  REVERBLEVEL: 'reverb_level',
  REVERBDELAY: 'reverb_delay',
  INPUTSELECT: 'input_select',
  LOWSLOPE: 'low_slope',
  HIGHSLOPE: 'high_slope',
  BASETYPE: 'base_type',
  SHIFT1: 'shift_1',
  SHIFT2: 'shift_2',
  SPRINGTYPE: 'spring_type',
  TONETYPE: 'tone_type',
  PREDLYTAP: 'predly_tap',
  PREDLYTEMPO: 'predly_tempo',
  PREDLYFDBK: 'predly_fdbk',
  PREDLYMIX: 'predly_mix',
  PITCHLPF: 'pitch_lpf',
  PITCHMIX: 'pitch_mix',
  PITCHFDBK: 'pitch_fdbk',
  PITCHDIR: 'pitch_dir',
  PITCHTIME: 'pitch_time',
  PITCHPOS: 'pitch_pos',
  PITCHMOD: 'pitch_mod',
  PITCHBAL: 'pitch_bal',
  FEEDR: 'feed_r',
  FEEDL: 'feed_l',
  FEEDLR: 'feed_lr',
  FEEDRL: 'feed_rl',
  MSTRFDBK: 'master_feedback',
  TEMPOR: 'tempo_r',
  TEMPOL: 'tempo_l',
  PANL: 'pan_l',
  PANR: 'pan_r',
  LOWQ: 'low_q',
  HIGHQ: 'high_q',
};

function nameToOurs(symbol: string): string {
  // Strip family prefix
  const u = symbol.indexOf('_');
  if (u < 0) return symbol.toLowerCase();
  const tail = symbol.substring(u + 1);
  // Try alias first
  if (NAMING_ALIAS[tail]) return NAMING_ALIAS[tail];
  // Otherwise lowercase
  return tail.toLowerCase();
}

const proposals: { block: string; name: string; pidLow: number; pidHigh: number; symbol: string; uiReferenced: boolean }[] = [];

for (const eff of Object.values(catalog.effect_types) as any[]) {
  if (!eff.effectFamily) continue;
  const ourBlock = FAMILY_TO_BLOCK[eff.effectFamily];
  if (!ourBlock) continue;
  const pidLow = blockPidLow[ourBlock];
  if (pidLow === undefined) continue;

  for (const p of eff.params as { paramId: number; name: string }[]) {
    if (!p.name || p.name === '?') continue;
    if (p.paramId < 10) continue; // skip generic
    if (existing.has(`${ourBlock}:${p.paramId}`)) continue;
    const ourName = nameToOurs(p.name);
    proposals.push({
      block: ourBlock,
      name: ourName,
      pidLow,
      pidHigh: p.paramId,
      symbol: p.name,
      uiReferenced: uiAll.has(p.name),
    });
  }
}

console.log(`Total proposed new entries: ${proposals.length}`);
const uiOnly = proposals.filter((p) => p.uiReferenced);
console.log(`  UI-referenced only:           ${uiOnly.length}`);
const internal = proposals.length - uiOnly.length;
console.log(`  Non-UI (internal):            ${internal}`);

// --- Step 6: emit TypeScript file with proposed entries ---

const lines: string[] = [];
lines.push('// AUTO-GENERATED proposed AM4 params.ts entries from Ghidra catalog.');
lines.push('// Source: samples/captured/decoded/ghidra-am4-paramnames.json');
lines.push('// Generated by: scripts/_research/generate-am4-params-from-catalog.ts');
lines.push('//');
lines.push('// Mapping (verified 99% match rate):');
lines.push('//   pidLow  = block-type pidLow from blockTypes.ts');
lines.push('//   pidHigh = Ghidra paramId (block-specific paramIds ≥ 10)');
lines.push('//');
lines.push('// REVIEW BEFORE MERGING — naming style and metadata (unit, scale,');
lines.push('// range, enum values, blocksGuideRef) must be hand-filled. This file');
lines.push('// only generates the skeleton + wire bytes.');
lines.push('');
lines.push('// Grouped by block. UI-referenced first, then non-UI (likely modifier');
lines.push('// slots or internal calc state — skip unless you confirm they show up');
lines.push('// in AM4-Edit\'s UI).');
lines.push('');

// Group by block
const byBlock: Record<string, typeof proposals> = {};
for (const p of proposals) {
  if (!byBlock[p.block]) byBlock[p.block] = [];
  byBlock[p.block].push(p);
}

for (const [block, items] of Object.entries(byBlock)) {
  lines.push(`// ──── ${block} (${items.length} new) ────`);
  items.sort((a, b) => a.pidHigh - b.pidHigh);
  const uiItems = items.filter((p) => p.uiReferenced);
  const nonUi = items.filter((p) => !p.uiReferenced);

  if (uiItems.length > 0) {
    lines.push('');
    lines.push(`// UI-referenced (${uiItems.length})`);
    for (const p of uiItems) {
      const key = `${block}.${p.name}`;
      const pidLowHex = '0x' + p.pidLow.toString(16).padStart(4, '0');
      const pidHighHex = '0x' + p.pidHigh.toString(16).padStart(4, '0');
      lines.push(`  '${key}': {`);
      lines.push(`    // Ghidra symbol: ${p.symbol}`);
      lines.push(`    block: '${p.block}', name: '${p.name}',`);
      lines.push(`    pidLow: ${pidLowHex}, pidHigh: ${pidHighHex},`);
      lines.push(`    // TODO: fill in unit, scale, range, enumValues (if enum), blocksGuideRef`);
      lines.push(`    unit: 'knob_0_10', scale: 0.1, range: [0, 10],`);
      lines.push(`  },`);
    }
  }

  if (nonUi.length > 0) {
    lines.push('');
    lines.push(`// Non-UI (${nonUi.length}) — probably modifier slots / internal calc state`);
    for (const p of nonUi) {
      const pidHighHex = '0x' + p.pidHigh.toString(16).padStart(4, '0');
      lines.push(`  // pidHigh=${pidHighHex}  ${p.symbol}  (suggested: ${block}.${p.name})`);
    }
  }
  lines.push('');
}

writeFileSync(OUTPUT, lines.join('\n'));
console.log(`\nWrote draft to ${OUTPUT}`);
console.log('');
console.log('Per-block breakdown of NEW (UI-referenced only) entries:');
for (const [block, items] of Object.entries(byBlock).sort((a, b) => b[1].filter((x) => x.uiReferenced).length - a[1].filter((x) => x.uiReferenced).length)) {
  const ui = items.filter((p) => p.uiReferenced).length;
  console.log(`  ${block}: ${ui} new UI-referenced params`);
}
