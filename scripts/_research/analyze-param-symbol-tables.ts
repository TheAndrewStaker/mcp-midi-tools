/**
 * Analyze parameter-symbol string tables in AxeEdit III.
 *
 * The binary contains thousands of EFFECT_, REVERB_, DELAY_, GLOBAL_,
 * CHORUS_, ID_ prefixed strings — the same symbolic names referenced
 * in __block_layout.xml. If these are stored as a contiguous const
 * char* table in .rdata (indexed by wire paramId), then offset-sorted
 * order = paramId, the same way the MIDI_ERROR_* table worked.
 *
 * For each prefix family this script:
 *   - filters all strings matching the prefix
 *   - sorts by .rdata offset
 *   - looks for contiguous runs (delta < 64 bytes between consecutive)
 *   - prints each contiguous-run band with its size and offset range
 *
 * A clean, contiguous run = strong evidence of an indexed table.
 * Multiple runs = the strings are referenced from multiple sites
 * (printed-string literal mode); we need Ghidra xrefs to nail the
 * lookup.
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface ExtractedString {
  offset: number;
  kind: 'ascii' | 'utf16le';
  value: string;
}

const inPath = 'samples/captured/decoded/axeedit3-strings.json';
const all: ExtractedString[] = JSON.parse(readFileSync(inPath, 'utf-8'));
console.log(`loaded ${all.length.toLocaleString()} strings`);

const PREFIXES = [
  'GLOBAL_', 'EFFECT_', 'REVERB_', 'DELAY_', 'CHORUS_',
  'AMP_', 'DRIVE_', 'CAB_', 'COMP_', 'EQ_', 'WAH_', 'PHASER_',
  'FLANGER_', 'PITCH_', 'FILTER_', 'GATE_', 'LOOPER_',
  'ID_', 'TYPE_',
];

const out: string[] = [];
function w(s: string) {
  out.push(s);
  console.log(s);
}

// For a given prefix, find contiguous runs in the offset-sorted list.
// A contiguous run = consecutive entries with delta (next.offset -
// prev.offset) below a threshold (typical string length + alignment).
function analyzePrefix(prefix: string) {
  const hits = all
    .filter((s) => s.kind === 'ascii' && s.value.startsWith(prefix))
    .sort((a, b) => a.offset - b.offset);
  if (hits.length === 0) return;

  // De-dupe: same string can appear multiple times. Keep only the first
  // occurrence per value.
  const seen = new Set<string>();
  const uniq = hits.filter((s) => {
    if (seen.has(s.value)) return false;
    seen.add(s.value);
    return true;
  });

  w('');
  w(`### ${prefix}  (total: ${hits.length}, unique: ${uniq.length})`);

  // Identify contiguous runs in the UNIQUE list. Threshold: 80 bytes
  // (most symbolic names < 40 chars + 8-byte alignment = < 48 bytes
  // delta; use 80 to allow slack).
  const RUN_DELTA_LIMIT = 80;
  type Run = { start: number; end: number; entries: ExtractedString[] };
  const runs: Run[] = [];
  let current: Run | null = null;

  for (const s of uniq) {
    if (current === null) {
      current = { start: s.offset, end: s.offset + s.value.length + 1, entries: [s] };
      continue;
    }
    const delta = s.offset - current.entries[current.entries.length - 1].offset;
    if (delta <= RUN_DELTA_LIMIT) {
      current.entries.push(s);
      current.end = s.offset + s.value.length + 1;
    } else {
      runs.push(current);
      current = { start: s.offset, end: s.offset + s.value.length + 1, entries: [s] };
    }
  }
  if (current) runs.push(current);

  // Report top runs by size.
  runs.sort((a, b) => b.entries.length - a.entries.length);
  const topRuns = runs.slice(0, 5);
  w(`  ${runs.length} contiguous run${runs.length === 1 ? '' : 's'}; top ${topRuns.length}:`);
  for (const r of topRuns) {
    w(`    @ 0x${r.start.toString(16)}..0x${r.end.toString(16)}  ${r.entries.length} entries`);
    // Sample first 5 + last 5 entries of the run to give a sense
    if (r.entries.length <= 12) {
      for (const e of r.entries) {
        w(`        0x${e.offset.toString(16).padStart(6,'0')}  ${e.value}`);
      }
    } else {
      for (const e of r.entries.slice(0, 6)) {
        w(`        0x${e.offset.toString(16).padStart(6,'0')}  ${e.value}`);
      }
      w(`        … (${r.entries.length - 12} more)`);
      for (const e of r.entries.slice(-6)) {
        w(`        0x${e.offset.toString(16).padStart(6,'0')}  ${e.value}`);
      }
    }
  }
}

w('## Parameter-symbol contiguous-run analysis');
w('');
w('A clean contiguous run of N entries strongly suggests a const char*');
w('array indexed by wire paramId. If a prefix has ONE big run with all');
w('entries, the offset-sorted order is the paramId enum order.');

for (const prefix of PREFIXES) {
  analyzePrefix(prefix);
}

const outPath = 'samples/captured/decoded/axeedit3-param-symbol-tables.txt';
writeFileSync(outPath, out.join('\n'));
console.log(`\nwrote ${out.length} lines to ${outPath}`);
