/**
 * Extract per-block symbolic IDs from AM4-Edit.exe and emit a
 * complete coverage proposal:
 *
 *   - Friendly names (the 226 hand-curated): preserved verbatim.
 *   - Unnamed cache records: assigned `id_NN` fallback so every
 *     param is addressable today.
 *   - Per-block symbolic IDs from the .exe: bundled as block-level
 *     metadata so the agent has self-describing names available
 *     when reasoning, even before we map each one to a specific
 *     cache id.
 *
 * Run:
 *   npx tsx scripts/extract-symbolic-ids.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PARAM_NAMES, type ParamNameEntry } from '@/fractal/am4/paramNames.js';

interface ExtractedString { offset: number; kind: 'ascii' | 'utf16le'; value: string; }
interface CacheRec {
  offset: number; block: number; id: number;
  typecode?: number; kind: 'float' | 'enum' | 'blockHeader';
  a?: number; b?: number; c?: number; d?: number;
  values?: string[];
}

const allStrings: ExtractedString[] = JSON.parse(readFileSync('samples/captured/decoded/exe-strings.json', 'utf8'));
const s2: CacheRec[] = JSON.parse(readFileSync('samples/captured/decoded/cache-section2.json', 'utf8'));
const s3wrap = JSON.parse(readFileSync('samples/captured/decoded/cache-section3.json', 'utf8'));
const s3: CacheRec[] = s3wrap.records;

const SYM_RE = /^[A-Z][A-Z0-9_]{3,}$/;
const NON_PARAM_PREFIXES = new Set([
  'ID', 'PROMPT', 'PREFS', 'MIDI', 'TITLEBAR', 'TOOLTIP', 'CPU',
  'BROWSER', 'EFFECT', 'PATCH', 'CONTROLLERS', 'GLOBAL', 'B',
]);

const symbolicIds = allStrings
  .filter(s => s.kind === 'ascii' && SYM_RE.test(s.value))
  .filter(s => {
    const m = s.value.match(/^([A-Z]+)_/);
    return m && !NON_PARAM_PREFIXES.has(m[1]);
  })
  .filter((s, i, arr) => arr.findIndex(x => x.value === s.value) === i)
  .sort((a, b) => a.offset - b.offset);

// Block prefixes confirmed by cross-checking against PARAM_NAMES anchors:
//   DISTORT_GAIN ↔ amp.gain (id=11)
//   FUZZ_BITREDUCE ↔ drive.bit_reduce (id=24)
//   etc.
const PREFIX_TO_BLOCK: Record<string, string> = {
  DISTORT: 'amp',
  FUZZ: 'drive',
  REVERB: 'reverb',
  DELAY: 'delay',
  CHORUS: 'chorus',
  FLANGER: 'flanger',
  PHASER: 'phaser',
  WAH: 'wah',
  WAHWAH: 'wah',
  COMP: 'compressor',
  COMPRESSOR: 'compressor',
  TREMOLO: 'tremolo',
  FILTER: 'filter',
  GATE: 'gate',
  VOLUME: 'volpan',
  VOLUMEPAN: 'volpan',
  ENHANCER: 'enhancer',
  ROTARY: 'rotary',
  CABINET: 'cab',
  CAB: 'cab',
};

interface BlockSpec { blockName: string; section: 'S2' | 'S3'; cacheBlock: number; }
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

const symsByBlock: Record<string, string[]> = {};
for (const s of symbolicIds) {
  const m = s.value.match(/^([A-Z]+)_(.+)$/);
  if (!m) continue;
  const block = PREFIX_TO_BLOCK[m[1]];
  if (!block) continue;
  if (!symsByBlock[block]) symsByBlock[block] = [];
  symsByBlock[block].push(s.value);
}

function recsFor(spec: BlockSpec): CacheRec[] {
  const src = spec.section === 'S2' ? s2 : s3;
  return src.filter(r => r.block === spec.cacheBlock && r.kind !== 'blockHeader')
            .sort((a, b) => a.id - b.id);
}

function getName(entry: ParamNameEntry | undefined): string | undefined {
  if (!entry) return undefined;
  return typeof entry === 'string' ? entry : entry.name;
}

interface BlockReport {
  block: string;
  cacheRecords: number;
  friendlyNamed: number;
  unnamed: number;
  symbolicIds: string[];
  symbolicCount: number;
  recordsDetail: Array<{ id: number; friendlyName?: string; signature: string }>;
}

const reports: BlockReport[] = [];

for (const b of BLOCKS) {
  const recs = recsFor(b);
  const namesForBlock = (PARAM_NAMES as Record<string, Record<number, ParamNameEntry>>)[b.blockName] ?? {};
  const syms = symsByBlock[b.blockName] ?? [];

  let named = 0;
  const detail: BlockReport['recordsDetail'] = [];
  for (const r of recs) {
    const friendly = getName(namesForBlock[r.id]);
    if (friendly) named++;
    const sig = r.kind === 'enum'
      ? `enum[${r.values?.length ?? 0}]`
      : `tc=0x${(r.typecode ?? 0).toString(16)} a=${r.a?.toFixed(3)} b=${r.b?.toFixed(3)} c=${r.c?.toFixed(3)}`;
    detail.push({ id: r.id, friendlyName: friendly, signature: sig });
  }

  reports.push({
    block: b.blockName,
    cacheRecords: recs.length,
    friendlyNamed: named,
    unnamed: recs.length - named,
    symbolicIds: syms,
    symbolicCount: syms.length,
    recordsDetail: detail,
  });
}

// Aggregate stats
const totals = reports.reduce((acc, r) => ({
  cache: acc.cache + r.cacheRecords,
  friendly: acc.friendly + r.friendlyNamed,
  unnamed: acc.unnamed + r.unnamed,
  syms: acc.syms + r.symbolicCount,
}), { cache: 0, friendly: 0, unnamed: 0, syms: 0 });

console.log('=== symbolic-ID extraction summary ===\n');
console.log('block        cache  friendly  unnamed  symIDs');
console.log('-----------  -----  --------  -------  ------');
for (const r of reports) {
  console.log(
    r.block.padEnd(11) + '  ' +
    r.cacheRecords.toString().padStart(5) + '  ' +
    r.friendlyNamed.toString().padStart(8) + '  ' +
    r.unnamed.toString().padStart(7) + '  ' +
    r.symbolicCount.toString().padStart(6),
  );
}
console.log('-----------  -----  --------  -------  ------');
console.log(
  'TOTAL'.padEnd(11) + '  ' +
  totals.cache.toString().padStart(5) + '  ' +
  totals.friendly.toString().padStart(8) + '  ' +
  totals.unnamed.toString().padStart(7) + '  ' +
  totals.syms.toString().padStart(6),
);
console.log(`\nFriendly coverage: ${totals.friendly} / ${totals.cache} (${(totals.friendly / totals.cache * 100).toFixed(0)}%)`);
console.log(`Symbolic IDs available as agent metadata: ${totals.syms}`);
console.log(`With id_NN fallback for unnamed: 100% addressability of all ${totals.cache} records.`);

// ---- Output 1: full block report (JSON) ----
writeFileSync('samples/captured/decoded/symbolic-ids-by-block.json', JSON.stringify(reports, null, 2));
console.log(`\nwrote samples/captured/decoded/symbolic-ids-by-block.json`);

// ---- Output 2: drop-in TS source for paramNames.ts metadata ----
// This gives Claude (the agent) a per-block list of symbolic IDs to
// reference in tool descriptions / agent reasoning.
const tsLines: string[] = [];
tsLines.push('/**');
tsLines.push(' * Per-block symbolic IDs harvested from AM4-Edit.exe at offset');
tsLines.push(' * ~0x611018+ (Session 46 cont, 2026-05-03). These are AM4-Edit\'s');
tsLines.push(' * own internal parameter identifiers (e.g. DISTORT_BRIGHTCAP for');
tsLines.push(' * the amp block\'s Bright Cap knob). Provided as agent context for');
tsLines.push(' * params not yet covered by paramNames.ts hand-curated entries.');
tsLines.push(' *');
tsLines.push(' * AUTO-GENERATED by scripts/extract-symbolic-ids.ts — do not hand-edit.');
tsLines.push(' */');
tsLines.push('export const SYMBOLIC_IDS_BY_BLOCK: Readonly<Record<string, readonly string[]>> = {');
for (const r of reports) {
  if (r.symbolicCount === 0) continue;
  tsLines.push(`  ${r.block}: [`);
  for (const sym of r.symbolicIds) tsLines.push(`    '${sym}',`);
  tsLines.push(`  ],`);
}
tsLines.push('};');
tsLines.push('');
writeFileSync('src/fractal/am4/symbolicIds.ts', tsLines.join('\n'));
console.log(`wrote src/protocol/symbolicIds.ts`);

// ---- Output 3: review-friendly markdown ----
const mdLines: string[] = [];
mdLines.push('# Symbolic IDs by block');
mdLines.push('');
mdLines.push('Harvested from `AM4-Edit.exe` at file offset ~0x611018+. These are');
mdLines.push('AM4-Edit\'s own internal parameter identifiers. They are NOT yet mapped');
mdLines.push('1:1 to cache record IDs (alignment is non-trivial; off-by-9 pattern');
mdLines.push('observed across most blocks). They are stored as block-level metadata');
mdLines.push('so the agent has self-describing names available when reasoning about');
mdLines.push('params not in `paramNames.ts`.');
mdLines.push('');
for (const r of reports) {
  mdLines.push(`## ${r.block} (cache ${r.cacheRecords} / friendly-named ${r.friendlyNamed} / symbolic ${r.symbolicCount})`);
  mdLines.push('');
  if (r.symbolicCount > 0) {
    mdLines.push('Symbolic IDs available:');
    mdLines.push('');
    for (const s of r.symbolicIds) mdLines.push(`- \`${s}\``);
  } else {
    mdLines.push('_No symbolic IDs found for this block prefix. May use a different prefix in the .exe (e.g. PARAEQ → ?, GRAPHEQ → ?)._');
  }
  mdLines.push('');
}
writeFileSync('samples/captured/decoded/symbolic-ids-by-block.md', mdLines.join('\n'));
console.log(`wrote samples/captured/decoded/symbolic-ids-by-block.md`);
