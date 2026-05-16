/**
 * Analyze the "Splawn Lane" preset (sourced from a third-party
 * community RE project, archived locally in docs/_private/) as the
 * foundation for the Axe-Fx III preset .syx decode.
 *
 * Inputs (in docs/_private/, gitignored):
 *   - splawnlane.syx   — 49,336 byte binary preset
 *   - splawnlane.csv   — paired CSV export with ground-truth parameter values
 *   - splawnlane.xml   — same data in XML form
 *
 * Goal: build our own decode pass independent of community prose
 * analysis, using the .syx ↔ .csv pairing as cross-reference.
 *
 * This script is a STUB — Phase 1 only:
 *   1. Read the .syx, walk SysEx frame boundaries (F0..F7).
 *   2. Confirm the forum-claimed structure: 1× 0x77 + 16× 0x78 + 1× 0x79.
 *   3. Pretty-print each frame's header bytes for inspection.
 *   4. Read the .csv, summarize which (effect, param) rows are "modified
 *      from default" — the input side of any sparse-storage hypothesis.
 *
 * Phase 2 (future): decode block boundaries inside the 0x78 frames,
 * try to match byte sequences to CSV ground truth.
 *
 * Run:  npx tsx scripts/_research/analyze-splawnlane.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
// Source data path (gitignored — community-sourced sample preset).
const SAMPLE_DIR = resolve(ROOT, 'docs/_private/axefx3-community-decode-sample');
const SYX = resolve(SAMPLE_DIR, 'splawnlane.syx');
const CSV = resolve(SAMPLE_DIR, 'splawnlane.csv');

function hex(bytes: Uint8Array | number[], max = 16): string {
  const arr = Array.from(bytes).slice(0, max);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join(' ') + (bytes.length > max ? '…' : '');
}

// ── Phase 1a: SysEx frame walker ───────────────────────────────────

interface Frame {
  /** Frame index in the file (0..N-1). */
  index: number;
  /** Byte offset of the F0 in the source file. */
  start: number;
  /** Byte length INCLUDING F0 and F7. */
  length: number;
  /** Function byte (byte 5: after F0 00 01 74 <model>). */
  fn: number;
  /** Model byte (byte 4). */
  model: number;
  /** First 16 bytes for at-a-glance inspection. */
  preview: string;
}

function walkFrames(bytes: Uint8Array): Frame[] {
  const frames: Frame[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0xf0) {
      i += 1;
      continue;
    }
    const start = i;
    // Find the next F7.
    let j = i + 1;
    while (j < bytes.length && bytes[j] !== 0xf7) j += 1;
    if (j >= bytes.length) {
      console.warn(`unterminated SysEx starting at ${start}`);
      break;
    }
    const length = j - start + 1;
    // Validate Fractal envelope: F0 00 01 74 <model> <fn> ...
    if (length < 7 || bytes[start + 1] !== 0x00 || bytes[start + 2] !== 0x01 || bytes[start + 3] !== 0x74) {
      console.warn(`non-Fractal frame at ${start}: ${hex(bytes.slice(start, start + 8))}`);
      i = j + 1;
      continue;
    }
    frames.push({
      index: frames.length,
      start,
      length,
      model: bytes[start + 4],
      fn: bytes[start + 5],
      preview: hex(bytes.slice(start, start + 16)),
    });
    i = j + 1;
  }
  return frames;
}

// ── Phase 1b: CSV summary ──────────────────────────────────────────

interface CsvRow {
  effect: string;
  param: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [header, ...body] = lines;
  // Expected columns: Effect Name, Param Label, Param Value (A), (B), (C), (D), ...
  if (!header.toLowerCase().includes('effect name')) {
    throw new Error(`CSV header doesn't look right: "${header.slice(0, 80)}"`);
  }
  const rows: CsvRow[] = [];
  for (const line of body) {
    const cols = line.split(',').map((s) => s.trim());
    if (cols.length < 6) continue;
    rows.push({
      effect: cols[0],
      param: cols[1],
      a: cols[2],
      b: cols[3],
      c: cols[4],
      d: cols[5],
    });
  }
  return rows;
}

function rowIsDefault(r: CsvRow): boolean {
  return r.a === r.b && r.b === r.c && r.c === r.d;
}

function rowMixedAcrossChannels(r: CsvRow): boolean {
  return !(r.a === r.b && r.b === r.c && r.c === r.d);
}

// ── Run ────────────────────────────────────────────────────────────

console.log('Analyzing splawnlane preset\n');

// 1. SysEx structure.
const syx = readFileSync(SYX);
console.log(`File size: ${syx.byteLength} bytes`);
const frames = walkFrames(new Uint8Array(syx));
console.log(`Frames:    ${frames.length}\n`);

const fnSummary = new Map<number, number>();
for (const f of frames) {
  fnSummary.set(f.fn, (fnSummary.get(f.fn) ?? 0) + 1);
}
console.log('Frame counts by function byte:');
for (const [fn, count] of fnSummary) {
  const fnName =
    fn === 0x77 ? 'preset header'
    : fn === 0x78 ? 'preset body'
    : fn === 0x79 ? 'preset footer'
    : `(unknown)`;
  console.log(`  0x${fn.toString(16).padStart(2, '0')}  × ${count}   ${fnName}`);
}

console.log('\nPer-frame summary (first 16 bytes of each):');
for (const f of frames) {
  const tag =
    f.fn === 0x77 ? 'HEAD'
    : f.fn === 0x78 ? 'BODY'
    : f.fn === 0x79 ? 'FOOT'
    : ' ?? ';
  console.log(
    `  [${f.index.toString().padStart(2)}] ${tag} model=0x${f.model.toString(16).padStart(2, '0')} ` +
    `fn=0x${f.fn.toString(16).padStart(2, '0')} ` +
    `start=${f.start.toString().padStart(5)} ` +
    `length=${f.length.toString().padStart(5)}   ${f.preview}`,
  );
}

// 2. Validate forum-claimed structure for Axe-Fx III.
const expected = { '77': 1, '78': 16, '79': 1 };
const got77 = fnSummary.get(0x77) ?? 0;
const got78 = fnSummary.get(0x78) ?? 0;
const got79 = fnSummary.get(0x79) ?? 0;
console.log('\nStructure validation (forum claim: 1× 0x77 + 16× 0x78 + 1× 0x79 for Axe-Fx III):');
console.log(`  0x77 header frames: got ${got77}, expected ${expected['77']}  ${got77 === 1 ? '✓' : '✗'}`);
console.log(`  0x78 body frames:   got ${got78}, expected ${expected['78']}  ${got78 === 16 ? '✓' : '✗'}`);
console.log(`  0x79 footer frames: got ${got79}, expected ${expected['79']}  ${got79 === 1 ? '✓' : '✗'}`);
const allFractal = frames.every((f) => f.model === 0x10);
console.log(`  model byte = 0x10 (III) for all frames: ${allFractal ? '✓' : '✗'}`);

// 3. Body-frame length distribution (forum claim: 3082 bytes each).
const bodyLens = frames.filter((f) => f.fn === 0x78).map((f) => f.length);
const uniqLens = [...new Set(bodyLens)];
console.log(`\nBody-frame length distribution: ${uniqLens.join(', ')} (forum claim: 3082)`);

// 4. CSV side.
console.log('\n─────────────────────────────────────────────────────────────────');
const csvText = readFileSync(CSV, 'utf8');
const rows = parseCsv(csvText);
console.log(`CSV rows: ${rows.length}`);

const byEffect = new Map<string, CsvRow[]>();
for (const r of rows) {
  const arr = byEffect.get(r.effect) ?? [];
  arr.push(r);
  byEffect.set(r.effect, arr);
}

console.log('\nPer-effect counts (rows total / modified across channels / non-default values):');
const allMixed: Array<{ effect: string; rows: CsvRow[] }> = [];
for (const [effect, ers] of byEffect) {
  const mixed = ers.filter(rowMixedAcrossChannels);
  // "non-default" without a defaults database = unknowable; approximation:
  // a row whose channels disagree is by definition "modified somewhere".
  console.log(
    `  ${effect.padEnd(30)} total=${ers.length.toString().padStart(3)} ` +
    `mixed=${mixed.length.toString().padStart(3)}`,
  );
  if (mixed.length > 0) allMixed.push({ effect, rows: mixed });
}

console.log('\nDone.');
console.log('\nNext steps (Phase 2):');
console.log('  - Decode preset name from the first 128 bytes of body frame 0');
console.log('    (community RE places the name at a fixed offset there).');
console.log('  - Slice the body frames into 128-byte chunks; correlate chunk boundaries');
console.log('    with effect-block boundaries (effect ID, see Appendix 1 effect IDs).');
console.log('  - Cross-reference param values in the CSV against decoded 14-bit pairs');
console.log('    in the body bytes. Build a per-block param-position map.');
