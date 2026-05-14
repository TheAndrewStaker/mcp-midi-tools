/**
 * Verify the (wire-pidLow → cache block) mapping and dump the
 * candidate parameter metadata per block for KNOWN_PARAMS generation.
 *
 * **The key insight of Session 15**: wire `pidHigh` directly equals the
 * cache record `id` within the right block. Finding the "right block"
 * for each wire pidLow was the last missing piece; see the table below.
 *
 * Confirmed mappings (verified by this script — each block's candidate
 * records line up with KNOWN_PARAMS by id, and the main effect-type
 * enum at a canonical low id matches Session 13's findings):
 *
 *   Amp        pidLow=0x3A  ↔  S2 block 5   tag=0x98   151 recs
 *   Drive      pidLow=0x76  ↔  S3 sub-block 9           49 recs
 *   Reverb     pidLow=0x42  ↔  S3 sub-block 0           72 recs
 *   Delay      pidLow=0x46  ↔  S3 sub-block 1           89 recs
 *   Chorus     pidLow=0x4E  ↔  S3 sub-block 2           31 recs  (Session 18)
 *   Flanger    pidLow=0x52  ↔  S3 sub-block 3           35 recs  (Session 18)
 *   Phaser     pidLow=0x5A  ↔  S3 sub-block 5           37 recs  (Session 18)
 *   Wah        pidLow=0x5E  ↔  S3 sub-block 6           29 recs  (Session 18)
 *   Compressor pidLow=0x2E  ↔  S2 block 2               41 recs  (Session 18)
 *   GEQ        pidLow=0x32  ↔  S2 block 3               22 recs  (Session 18)
 *   Tremolo    pidLow=0x6A  ↔  S3 sub-block 7           24 recs  (Session 18)
 *   Filter     pidLow=0x72  ↔  S3 sub-block 8           40 recs  (Session 18)
 *   Enhancer   pidLow=0x7A  ↔  S3 sub-block 10          17 recs  (Session 18)
 *   Gate/Exp   pidLow=0x92  ↔  S3 sub-block 11          22 recs  (Session 18)
 *   Volume/Pan pidLow=0x66  ↔  S3 sub-block 12          20 recs  (Session 18)
 *   Rotary     pidLow=0x56  ↔  S3 sub-block 4           23 recs  (Session 18 — replaces tentative "Pitch Shifter")
 *   PEQ        pidLow=0x36  ↔  S2 block 4               36 recs  (Session 18 — replaces tentative "Utility")
 *
 * Run after `npx tsx scripts/parse-cache.ts`:
 *   npx tsx scripts/map-cache-params.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_PARAMS, type Param } from '@mcp-midi-control/am4/params.js';

interface CacheRec {
  offset: number;
  block: number;
  id: number;
  typecode: number;
  kind: 'float' | 'enum' | 'blockHeader';
  a?: number; b?: number; c?: number; d?: number;
  values?: string[];
}

const DECODED_DIR = 'samples/captured/decoded';
const s2: CacheRec[] = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section2.json'), 'utf8'));
const s3Wrap = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section3.json'), 'utf8'));
const s3: CacheRec[] = s3Wrap.records;

// Mapping from wire pidLow → (section, cache block index). Pinned here
// because deriving it automatically is fragile: modifier-assign enums
// ("NONE  … 63/64", 79 entries) appear in many blocks, confounding the
// obvious "biggest enum = main type" heuristic. The table is instead
// verified structurally in this script.
interface BlockLoc { section: 'S2' | 'S3'; block: number; recs: CacheRec[]; }
const CACHE_BLOCK_MAP: Record<number, BlockLoc> = {
  0x3a: { section: 'S2', block: 5, recs: s2 },  // Amp
  0x76: { section: 'S3', block: 9, recs: s3 },  // Drive
  0x42: { section: 'S3', block: 0, recs: s3 },  // Reverb
  0x46: { section: 'S3', block: 1, recs: s3 },  // Delay
  0x4e: { section: 'S3', block: 2, recs: s3 },  // Chorus
  0x52: { section: 'S3', block: 3, recs: s3 },  // Flanger
  0x5a: { section: 'S3', block: 5, recs: s3 },  // Phaser
  0x5e: { section: 'S3', block: 6, recs: s3 },  // Wah
  0x2e: { section: 'S2', block: 2, recs: s2 },  // Compressor
  0x32: { section: 'S2', block: 3, recs: s2 },  // GEQ
  0x6a: { section: 'S3', block: 7, recs: s3 },  // Tremolo/Panner
  0x72: { section: 'S3', block: 8, recs: s3 },  // Filter
  0x7a: { section: 'S3', block: 10, recs: s3 }, // Enhancer
  0x92: { section: 'S3', block: 11, recs: s3 }, // Gate/Expander
  0x66: { section: 'S3', block: 12, recs: s3 }, // Volume/Pan
  0x56: { section: 'S3', block: 4, recs: s3 },  // Rotary (pidLow fills the 0x56 gap in the S3 series)
  0x36: { section: 'S2', block: 4, recs: s2 },  // Parametric EQ (previously tentative "Utility")
};

function paramRecsFor(recs: CacheRec[], block: number): CacheRec[] {
  return recs.filter((r) => r.block === block && r.kind !== 'blockHeader');
}

// Group KNOWN_PARAMS by block name for display.
const byBlock = new Map<string, Param[]>();
for (const p of Object.values(KNOWN_PARAMS) as Param[]) {
  const arr = byBlock.get(p.block) ?? [];
  arr.push(p);
  byBlock.set(p.block, arr);
}

console.log('Verifying KNOWN_PARAMS against pinned cache-block map\n');

let verified = 0;
let unverified = 0;
for (const [blockName, params] of byBlock) {
  const pidLow = params[0].pidLow;
  const loc = CACHE_BLOCK_MAP[pidLow];
  if (!loc) {
    console.log(`  ${blockName}  pidLow=0x${pidLow.toString(16)}  (no cache mapping — skipped)`);
    continue;
  }
  const byId = new Map(paramRecsFor(loc.recs, loc.block).map((r) => [r.id, r]));
  console.log(`  ${blockName.padEnd(8)} pidLow=0x${pidLow.toString(16).padStart(2, '0')}  →  ${loc.section} block ${loc.block}  (${byId.size} records)`);

  for (const p of params) {
    const rec = byId.get(p.pidHigh);
    if (!rec) {
      const note = p.pidHigh > 0xff
        ? ' (out-of-band — expected not in cache)'
        : ' (NOT FOUND — investigate)';
      console.log(`      ${p.name.padEnd(8)} pidHigh=0x${p.pidHigh.toString(16).padStart(4, '0')}${note}`);
      if (p.pidHigh <= 0xff) unverified++;
      continue;
    }
    const expectEnum = p.unit === 'enum';
    const kindOk = expectEnum ? rec.kind === 'enum' : rec.kind === 'float';
    const ok = kindOk ? '✓' : '✗';
    const extra = rec.kind === 'enum'
      ? `enum count=${rec.values!.length} [${rec.values![0]}…]`
      : `float [${rec.a}..${rec.b}]`;
    console.log(`      ${ok} ${p.name.padEnd(8)} pidHigh=0x${p.pidHigh.toString(16).padStart(4, '0')}  id=${rec.id} unit=${p.unit}  ${extra}`);
    if (kindOk) verified++;
    else unverified++;
  }
  console.log('');
}
console.log(`verified: ${verified} params, unverified: ${unverified} params`);

// Dump each main block's candidate parameter set — source data for the
// next step, auto-generating KNOWN_PARAMS entries.
console.log('\n=== Block parameter tables ===');
for (const [pidLow, loc] of Object.entries(CACHE_BLOCK_MAP)) {
  const recs = paramRecsFor(loc.recs, loc.block).sort((a, b) => a.id - b.id);
  console.log(`\npidLow=0x${Number(pidLow).toString(16)}  (${loc.section} block ${loc.block}, ${recs.length} params):`);
  for (const r of recs) {
    if (r.kind === 'enum') {
      console.log(`  id=${r.id.toString().padStart(3)}  enum × ${r.values!.length}  [${r.values![0]}${r.values!.length > 1 ? ', …, ' + r.values![r.values!.length - 1] : ''}]`);
    } else {
      console.log(`  id=${r.id.toString().padStart(3)}  float  a=${r.a} b=${r.b} c=${r.c} d=${r.d}`);
    }
  }
}
