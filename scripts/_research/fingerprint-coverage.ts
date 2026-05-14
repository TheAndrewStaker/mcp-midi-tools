/**
 * Coverage report for cache-record naming across all MCP blocks.
 *
 * For every block we ship MCP tools for, count:
 *   - Total cache records the block has
 *   - Already named (in paramNames.ts)
 *   - Unnamed but share a signature with a named record (high-confidence
 *     candidates: same kind of knob)
 *   - Unnamed with unique signature (need Blocks Guide range match
 *     before naming)
 *   - Unnamed sharing signatures only with other unnamed (groups of
 *     similar unknown knobs)
 *
 * Output:
 *   - Console summary: per-block coverage table.
 *   - JSON: samples/captured/decoded/fingerprint-candidates.json
 *     containing per-record candidate names for the founder to review.
 *
 * Run:
 *   npx tsx scripts/fingerprint-coverage.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PARAM_NAMES, type ParamNameEntry } from '@mcp-midi-control/am4/paramNames.js';

interface CacheRec {
  offset: number;
  block: number;
  id: number;
  typecode?: number;
  kind: 'float' | 'enum' | 'blockHeader';
  a?: number; b?: number; c?: number; d?: number;
  values?: string[];
  // Section 1 fields (different schema)
  min?: number; max?: number; default?: number; step?: number;
}

const s2: CacheRec[] = JSON.parse(readFileSync('samples/captured/decoded/cache-section2.json', 'utf8'));
const s3wrap = JSON.parse(readFileSync('samples/captured/decoded/cache-section3.json', 'utf8'));
const s3: CacheRec[] = s3wrap.records;

// Block catalog mirrors gen-params-from-cache.ts (don't drift).
interface BlockSpec {
  blockName: string;
  section: 'S2' | 'S3';
  cacheBlock: number;
}
const BLOCKS: BlockSpec[] = [
  { blockName: 'amp',        section: 'S2', cacheBlock: 5  },
  { blockName: 'drive',      section: 'S3', cacheBlock: 9  },
  { blockName: 'reverb',     section: 'S3', cacheBlock: 0  },
  { blockName: 'delay',      section: 'S3', cacheBlock: 1  },
  { blockName: 'chorus',     section: 'S3', cacheBlock: 2  },
  { blockName: 'flanger',    section: 'S3', cacheBlock: 3  },
  { blockName: 'phaser',     section: 'S3', cacheBlock: 5  },
  { blockName: 'wah',        section: 'S3', cacheBlock: 6  },
  { blockName: 'compressor', section: 'S2', cacheBlock: 2  },
  { blockName: 'geq',        section: 'S2', cacheBlock: 3  },
  { blockName: 'filter',     section: 'S3', cacheBlock: 8  },
  { blockName: 'tremolo',    section: 'S3', cacheBlock: 7  },
  { blockName: 'enhancer',   section: 'S3', cacheBlock: 10 },
  { blockName: 'gate',       section: 'S3', cacheBlock: 11 },
  { blockName: 'volpan',     section: 'S3', cacheBlock: 12 },
  { blockName: 'peq',        section: 'S2', cacheBlock: 4  },
  { blockName: 'rotary',     section: 'S3', cacheBlock: 4  },
];

function recsFor(spec: BlockSpec): CacheRec[] {
  const src = spec.section === 'S2' ? s2 : s3;
  return src.filter(r => r.block === spec.cacheBlock && r.kind !== 'blockHeader')
            .sort((a, b) => a.id - b.id);
}

function sigKey(r: CacheRec): string {
  if (r.kind === 'enum') return `E:${r.typecode}:${(r.values?.length ?? 0)}`;
  return `F:${r.typecode}:${r.a}:${r.b}:${r.c}`;
}

function sigPretty(r: CacheRec): string {
  if (r.kind === 'enum') {
    const first = r.values?.[0] ?? '?';
    return `enum[${r.values?.length ?? 0}] tc=0x${(r.typecode ?? 0).toString(16).padStart(4, '0')} first="${first}"`;
  }
  return `tc=0x${(r.typecode ?? 0).toString(16).padStart(4, '0')} a=${r.a?.toFixed(3)} b=${r.b?.toFixed(3)} c=${r.c?.toFixed(3)} step=${r.d?.toFixed(4)}`;
}

function nameOfEntry(e: ParamNameEntry | undefined): string | undefined {
  if (e === undefined) return undefined;
  return typeof e === 'string' ? e : e.name;
}

interface BlockReport {
  block: string;
  total: number;
  named: number;
  nameableFromSibling: number;
  uniqueSig: number;
  groupedUnnamed: number;
  candidates: Array<{
    block: string;
    id: number;
    sig: string;
    candidates: string[];
    rationale: string;
  }>;
}

const reports: BlockReport[] = [];

for (const spec of BLOCKS) {
  const recs = recsFor(spec);
  const namesForBlock = (PARAM_NAMES as Record<string, Record<number, ParamNameEntry>>)[spec.blockName] ?? {};

  // Group by signature
  const sigGroups = new Map<string, Array<{ rec: CacheRec; name?: string }>>();
  for (const r of recs) {
    const k = sigKey(r);
    if (!sigGroups.has(k)) sigGroups.set(k, []);
    sigGroups.get(k)!.push({ rec: r, name: nameOfEntry(namesForBlock[r.id]) });
  }

  let named = 0;
  let nameableFromSibling = 0;
  let uniqueSig = 0;
  let groupedUnnamed = 0;
  const candidates: BlockReport['candidates'] = [];

  for (const r of recs) {
    const name = nameOfEntry(namesForBlock[r.id]);
    if (name) { named++; continue; }

    const group = sigGroups.get(sigKey(r))!;
    const namedSiblings = group.filter(g => g.name).map(g => g.name!);
    if (namedSiblings.length > 0) {
      nameableFromSibling++;
      candidates.push({
        block: spec.blockName,
        id: r.id,
        sig: sigPretty(r),
        candidates: [...new Set(namedSiblings)],
        rationale: `same signature as named: ${[...new Set(namedSiblings)].join(', ')}`,
      });
    } else if (group.length === 1) {
      uniqueSig++;
      candidates.push({
        block: spec.blockName,
        id: r.id,
        sig: sigPretty(r),
        candidates: [],
        rationale: 'unique signature — needs Blocks Guide range match',
      });
    } else {
      groupedUnnamed++;
      const groupIds = group.filter(g => g.rec.id !== r.id).map(g => g.rec.id);
      candidates.push({
        block: spec.blockName,
        id: r.id,
        sig: sigPretty(r),
        candidates: [],
        rationale: `shares signature with other unnamed ids: ${groupIds.join(',')}`,
      });
    }
  }

  reports.push({
    block: spec.blockName,
    total: recs.length,
    named,
    nameableFromSibling,
    uniqueSig,
    groupedUnnamed,
    candidates,
  });
}

// Summary
console.log('=== fingerprint coverage report ===\n');
const head = `${''.padEnd(11)}  ${'total'.padStart(6)}  ${'named'.padStart(6)}  ${'sibling'.padStart(8)}  ${'unique'.padStart(7)}  ${'grouped'.padStart(8)}  ${'cover%'.padStart(7)}  ${'reachable%'.padStart(11)}`;
console.log(head);
console.log('-'.repeat(head.length));
const totals = { total: 0, named: 0, sib: 0, uniq: 0, grp: 0 };
for (const r of reports) {
  const cover = r.total ? r.named / r.total : 0;
  // "Reachable" means: named today + nameable-from-sibling.
  const reachable = r.total ? (r.named + r.nameableFromSibling) / r.total : 0;
  console.log(
    `${r.block.padEnd(11)}  ${r.total.toString().padStart(6)}  ${r.named.toString().padStart(6)}  ${r.nameableFromSibling.toString().padStart(8)}  ${r.uniqueSig.toString().padStart(7)}  ${r.groupedUnnamed.toString().padStart(8)}  ${(cover * 100).toFixed(0).padStart(6)}%  ${(reachable * 100).toFixed(0).padStart(10)}%`,
  );
  totals.total += r.total;
  totals.named += r.named;
  totals.sib += r.nameableFromSibling;
  totals.uniq += r.uniqueSig;
  totals.grp += r.groupedUnnamed;
}
console.log('-'.repeat(head.length));
const totalCover = totals.named / totals.total;
const totalReachable = (totals.named + totals.sib) / totals.total;
console.log(
  `${'TOTAL'.padEnd(11)}  ${totals.total.toString().padStart(6)}  ${totals.named.toString().padStart(6)}  ${totals.sib.toString().padStart(8)}  ${totals.uniq.toString().padStart(7)}  ${totals.grp.toString().padStart(8)}  ${(totalCover * 100).toFixed(0).padStart(6)}%  ${(totalReachable * 100).toFixed(0).padStart(10)}%`,
);

console.log(`\nlegend:`);
console.log(`  total       — cache records the block has`);
console.log(`  named       — already named in paramNames.ts (current ship-as-is coverage)`);
console.log(`  sibling     — unnamed but signature matches a named record (high-confidence candidates)`);
console.log(`  unique      — unnamed with unique signature; needs Blocks Guide range match`);
console.log(`  grouped     — unnamed; signature shared only with other unnamed ids`);
console.log(`  cover%      — named / total`);
console.log(`  reachable%  — (named + sibling) / total — the upper bound from this approach alone`);

// Write candidates JSON for review
const allCandidates = reports.flatMap(r => r.candidates);
writeFileSync('samples/captured/decoded/fingerprint-candidates.json', JSON.stringify(allCandidates, null, 2));
console.log(`\nwrote samples/captured/decoded/fingerprint-candidates.json (${allCandidates.length} records)`);
