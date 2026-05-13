/**
 * Test whether cache-record signatures + Blocks Guide section-assignment
 * is enough to bulk-name unnamed cache records.
 *
 * Method:
 *   1. Pull the 151 amp-block records from cache-section2.json (block 5).
 *   2. For each, look up our hand-verified name (paramNames.ts amp section).
 *   3. Print every record with: id, signature, current name (if any),
 *      and whether it shares a signature with a known-named neighbor.
 *   4. For unnamed records, list every named record that has the SAME
 *      signature — that's a candidate label set.
 *
 * The output tells us:
 *   - How much of the 151 we already have (baseline coverage)
 *   - How many unnamed records have signatures that match KNOWN ones
 *     (these are easy candidates — same kind of knob)
 *   - How many have unique signatures (hard cases — need Blocks Guide
 *     ranged-knob match or hardware capture)
 *
 * If most unnamed records share signatures with named neighbors, we have
 * a path forward without captures. If many are unique signatures, we
 * still need the Procmon trace + USBPcap-on-refresh approach.
 */

import { readFileSync } from 'node:fs';

interface Section2Float {
  kind: 'float';
  block: number; id: number; typecode: number;
  a: number; b: number; c: number; d: number;
}
interface Section2Enum {
  kind: 'enum';
  block: number; id: number; typecode: number;
  min: number; max: number; default: number;
  values: string[];
}
interface Section2BlockHeader { kind: 'blockHeader' }
type Section2 = Section2Float | Section2Enum | Section2BlockHeader;

const s2: Section2[] = JSON.parse(readFileSync('samples/captured/decoded/cache-section2.json', 'utf8'));
const amp = s2.filter((r): r is Section2Float | Section2Enum =>
  (r as { block: number }).block === 5 && r.kind !== 'blockHeader',
);

// Hand-coded name table for amp block, drawn from paramNames.ts (the
// 23-entry verified list). Update if paramNames.ts adds more.
const NAMED: Record<number, string> = {
  2: 'balance',
  8: 'out_boost_level',
  10: 'type',
  11: 'gain',
  12: 'bass',
  13: 'mid',
  14: 'treble',
  15: 'master',
  20: 'bright_cap',
  26: 'depth',
  30: 'presence',
  54: 'input_trim',
  62: 'geq_band_1',
  63: 'geq_band_2',
  64: 'geq_band_3',
  65: 'geq_band_4',
  66: 'geq_band_5',
  67: 'geq_band_6',
  68: 'geq_band_7',
  69: 'geq_band_8',
  77: 'compressor_clarity',
  82: 'compressor_amount',
  83: 'compressor_threshold',
  84: 'master_vol_trim',
  104: 'high_treble',
};

function sig(r: Section2Float | Section2Enum): string {
  if (r.kind === 'enum') {
    return `enum[${r.values.length}] tc=0x${r.typecode.toString(16).padStart(4, '0')} first="${r.values[0]}"`;
  }
  return `tc=0x${r.typecode.toString(16).padStart(4, '0')} a=${r.a.toFixed(3)} b=${r.b.toFixed(3)} c=${r.c.toFixed(3)} step=${r.d.toFixed(4)}`;
}

function sigKey(r: Section2Float | Section2Enum): string {
  if (r.kind === 'enum') return `E:${r.typecode}:${r.values.length}`;
  return `F:${r.typecode}:${r.a}:${r.b}:${r.c}`;
}

// Build sigKey -> list of (id, name) pairs
const sigGroups = new Map<string, Array<{ id: number; name?: string }>>();
for (const r of amp) {
  const k = sigKey(r);
  if (!sigGroups.has(k)) sigGroups.set(k, []);
  sigGroups.get(k)!.push({ id: r.id, name: NAMED[r.id] });
}

console.log(`amp block: ${amp.length} cache records, ${Object.keys(NAMED).length} named (${(Object.keys(NAMED).length / amp.length * 100).toFixed(0)}%)\n`);

// Stats
let unnamedCount = 0;
let unnamedWithKnownSig = 0;
let unnamedUnique = 0;

for (const r of amp) {
  const name = NAMED[r.id];
  if (name) continue;
  unnamedCount++;
  const group = sigGroups.get(sigKey(r))!;
  const namedSiblings = group.filter(g => g.name);
  if (namedSiblings.length > 0) unnamedWithKnownSig++;
  else if (group.length === 1) unnamedUnique++;
}

console.log(`unnamed: ${unnamedCount}`);
console.log(`  share signature with a named record: ${unnamedWithKnownSig}`);
console.log(`  signature unique (need Blocks Guide range match): ${unnamedUnique}`);
console.log(`  share signature only with other unnamed records: ${unnamedCount - unnamedWithKnownSig - unnamedUnique}\n`);

console.log('=== full record listing ===');
console.log('id   name              signature');
for (const r of amp) {
  const name = NAMED[r.id] ?? '';
  const group = sigGroups.get(sigKey(r))!;
  const namedSiblings = group.filter(g => g.name);
  let hint = '';
  if (!name && namedSiblings.length > 0) {
    hint = '   ↳ shares sig with: ' + namedSiblings.map(s => `${s.id}=${s.name}`).join(', ');
  } else if (!name && group.length > 1) {
    hint = `   ↳ shares sig with unnamed ids: ${group.filter(g => g.id !== r.id).map(g => g.id).join(',')}`;
  } else if (!name) {
    hint = '   ↳ signature unique (only this id)';
  }
  console.log(
    r.id.toString().padStart(3) + '  ' +
    name.padEnd(20) +
    sig(r) +
    hint,
  );
}
