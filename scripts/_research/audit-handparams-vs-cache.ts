/**
 * Audit every hand-authored entry in KNOWN_PARAMS against the AM4-Edit
 * metadata cache. Catches mismatches that escape verify-cache-params
 * (which only compares CACHE_PARAMS-generated entries to KNOWN_PARAMS,
 * not hand-only entries):
 *
 *   - displayMin / displayMax not matching `a × c .. b × c` from cache
 *   - scaling 'linear' when typecode is in LOG10_TYPECODES (or vice
 *     versa)
 *
 * HW-053 / Friedman-BE iconic-tone test (2026-05-04) surfaced three
 * such bugs (amp.bright_cap, amp.presence_freq, amp.negative_feedback)
 * each with different symptoms — readback ×20, readback ×2.3, readback
 * ×10. Founder asked for a sweep to catch more before they bite.
 *
 * Output: per-block grouped table of mismatches sorted by severity.
 * Skips entries whose pidHigh has no cache record (out-of-band
 * registers like channel/level), since those are firmware-only and
 * have no cache to compare against.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWN_PARAMS } from '@/fractal/am4/params.js';
import type { Param } from '@/fractal/am4/params.js';

interface CacheRec {
  offset: number;
  block: number;
  id: number;
  typecode?: number;
  kind: 'float' | 'enum' | 'blockHeader';
  a?: number;
  b?: number;
  c?: number;
  d?: number;
}

const DECODED_DIR = 'samples/captured/decoded';
const s2: CacheRec[] = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section2.json'), 'utf8'));
const s3: CacheRec[] = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section3.json'), 'utf8')).records;

interface BlockSpec {
  block: string;
  pidLow: number;
  section: 'S2' | 'S3';
  cacheBlock: number;
}

const BLOCKS: BlockSpec[] = [
  { block: 'amp',        pidLow: 0x003a, section: 'S2', cacheBlock: 5 },
  { block: 'drive',      pidLow: 0x0076, section: 'S3', cacheBlock: 9 },
  { block: 'reverb',     pidLow: 0x0042, section: 'S3', cacheBlock: 0 },
  { block: 'delay',      pidLow: 0x0046, section: 'S3', cacheBlock: 1 },
  { block: 'chorus',     pidLow: 0x004e, section: 'S3', cacheBlock: 2 },
  { block: 'flanger',    pidLow: 0x0052, section: 'S3', cacheBlock: 3 },
  { block: 'phaser',     pidLow: 0x005a, section: 'S3', cacheBlock: 5 },
  { block: 'wah',        pidLow: 0x005e, section: 'S3', cacheBlock: 6 },
  { block: 'compressor', pidLow: 0x002e, section: 'S2', cacheBlock: 2 },
  { block: 'geq',        pidLow: 0x0032, section: 'S2', cacheBlock: 3 },
  { block: 'filter',     pidLow: 0x0072, section: 'S3', cacheBlock: 8 },
  { block: 'tremolo',    pidLow: 0x006a, section: 'S3', cacheBlock: 7 },
  { block: 'enhancer',   pidLow: 0x007a, section: 'S3', cacheBlock: 10 },
  { block: 'gate',       pidLow: 0x0092, section: 'S3', cacheBlock: 11 },
  { block: 'volpan',     pidLow: 0x0066, section: 'S3', cacheBlock: 12 },
  { block: 'peq',        pidLow: 0x0036, section: 'S2', cacheBlock: 4 },
  { block: 'rotary',     pidLow: 0x0056, section: 'S3', cacheBlock: 4 },
];

// Mirror gen-params-from-cache.ts. Keep in sync.
const LOG10_TYPECODES: ReadonlySet<number> = new Set([64, 68, 72, 80]);

function findCacheRec(blockName: string, pidHigh: number): CacheRec | undefined {
  const spec = BLOCKS.find((b) => b.block === blockName);
  if (!spec) return undefined;
  const src = spec.section === 'S2' ? s2 : s3;
  return src.find((r) => r.block === spec.cacheBlock && r.id === pidHigh);
}

interface Mismatch {
  key: string;
  kind: 'displayMin' | 'displayMax' | 'scaling' | 'unit-suspicious';
  detail: string;
  severity: number; // higher = worse
}

const mismatches: Mismatch[] = [];

for (const [key, paramRaw] of Object.entries(KNOWN_PARAMS)) {
  const param = paramRaw as Param;
  // Skip enums — their displayMin/Max are 0..count-1 by convention,
  // not derived from cache a/b/c.
  if (param.unit === 'enum') continue;
  // Skip out-of-band registers (channel at pidHigh=0x07d2, level at
  // pidHigh=0x0000). These have no cache record by design.
  if (param.pidHigh === 0x07d2 || param.pidHigh === 0x0000) continue;

  const rec = findCacheRec(param.block, param.pidHigh);
  if (!rec) continue;
  if (rec.kind !== 'float') continue;
  if (rec.a === undefined || rec.b === undefined || rec.c === undefined) continue;
  // Skip degenerate ranges (a===b → no addressable value).
  if (rec.a === rec.b) continue;

  const expectedDisplayMin = rec.a * rec.c;
  const expectedDisplayMax = rec.b * rec.c;

  // Tolerate small float noise (cache stores 0.10000000149… for 0.1, etc.)
  // and intentional rounding (e.g. predelay 0.25 cache → 250 ms display).
  const TOL_REL = 0.01;
  const TOL_ABS = 0.001;
  const within = (a: number, b: number): boolean => {
    if (a === b) return true;
    const diff = Math.abs(a - b);
    return diff <= TOL_ABS || diff / Math.max(Math.abs(a), Math.abs(b), 1e-9) <= TOL_REL;
  };

  // Some hand entries deliberately clamp the display range (e.g. amp's
  // GEQ bands: cache a=-1, c=12 → -12 dB display, hand displayMin=-12 ✓;
  // delay.predelay: cache b=0.25 → 250 ms display, hand displayMax=250 ✓).
  // Allow exact match OR ±1% rel tolerance.
  if (!within(param.displayMin, expectedDisplayMin)) {
    // bipolar_percent pseudo-unit: cache often has a=-1 b=1 c=100 →
    // expected -100..100. Hand sometimes uses ±90 / ±99 etc. for
    // technical reasons documented per param. Flag if more than 50%
    // off; otherwise treat as deliberate clamp.
    const ratio = Math.abs(param.displayMin) > 0
      ? Math.abs(expectedDisplayMin / param.displayMin)
      : Math.abs(expectedDisplayMin - param.displayMin);
    const severity = ratio > 5 || ratio < 0.2 ? 3 : 1;
    mismatches.push({
      key,
      kind: 'displayMin',
      detail: `hand=${param.displayMin}  cache=${formatNum(expectedDisplayMin)} (a=${formatNum(rec.a)} × c=${formatNum(rec.c)})`,
      severity,
    });
  }
  if (!within(param.displayMax, expectedDisplayMax)) {
    const ratio = Math.abs(param.displayMax) > 0
      ? Math.abs(expectedDisplayMax / param.displayMax)
      : Math.abs(expectedDisplayMax - param.displayMax);
    const severity = ratio > 5 || ratio < 0.2 ? 3 : 1;
    mismatches.push({
      key,
      kind: 'displayMax',
      detail: `hand=${param.displayMax}  cache=${formatNum(expectedDisplayMax)} (b=${formatNum(rec.b)} × c=${formatNum(rec.c)})`,
      severity,
    });
  }

  // Scaling: typecode in LOG10_TYPECODES → must declare scaling='log10'.
  // Otherwise must be undefined / 'linear'.
  if (rec.typecode !== undefined) {
    const expectLog10 = LOG10_TYPECODES.has(rec.typecode);
    const declaredLog10 = param.scaling === 'log10';
    if (expectLog10 && !declaredLog10) {
      mismatches.push({
        key,
        kind: 'scaling',
        detail: `typecode ${rec.typecode} is log10; hand entry has scaling=${param.scaling ?? 'undefined (linear)'}`,
        severity: 2,
      });
    }
    if (!expectLog10 && declaredLog10) {
      mismatches.push({
        key,
        kind: 'scaling',
        detail: `typecode ${rec.typecode} is linear; hand entry has scaling='log10' — readback will mis-decode`,
        severity: 2,
      });
    }
  }
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

mismatches.sort((a, b) => b.severity - a.severity || a.key.localeCompare(b.key));

console.log(`Audit found ${mismatches.length} hand-vs-cache mismatch(es).\n`);
const byBlock = new Map<string, Mismatch[]>();
for (const m of mismatches) {
  const block = m.key.split('.')[0];
  const list = byBlock.get(block) ?? [];
  list.push(m);
  byBlock.set(block, list);
}
for (const [block, list] of [...byBlock.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${block} (${list.length}):`);
  for (const m of list) {
    const sev = m.severity >= 3 ? '🔴' : m.severity >= 2 ? '🟡' : '⚪';
    console.log(`  ${sev} ${m.key.padEnd(36)} ${m.kind.padEnd(11)} ${m.detail}`);
  }
}

console.log(`\nLegend: 🔴 severe (>5× range mismatch — write/decode WILL be wrong)`);
console.log(`        🟡 scaling (firmware stores log10, decoder uses linear or vice versa — readback wrong)`);
console.log(`        ⚪ minor (small numeric drift — likely a deliberate display clamp)`);
