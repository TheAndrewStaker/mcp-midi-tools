/**
 * Test the alignment hypothesis: AM4-Edit stores parameter labels in
 * .rdata as a contiguous string pool whose order mirrors cache-record
 * order. If true, we can extract every label without runtime
 * instrumentation.
 *
 * Method:
 *   1. Load exe-strings.json (output of extract-exe-strings.ts).
 *   2. Pull the anchor labels from PARAM_NAMES (the hand-verified
 *      table). For the AMP block: Gain / Bass / Mid / Treble / Master
 *      / Presence / Depth / Bright Cap. These are unambiguous knob
 *      labels for tone-stack and Extras-tab knobs.
 *   3. For every offset in the .exe where any anchor appears, count
 *      how many DISTINCT anchor strings appear within a ±4 KB window.
 *      The window with the highest count is the candidate label pool.
 *   4. Print that window's contents (offset + string) for human review.
 *
 * If the printout shows the anchors clustered in cache-record order
 * with sensible-looking names between them, the hypothesis is
 * confirmed and we move on to the bulk-extraction step.
 *
 * Run:
 *   npx tsx scripts/find-label-pool.ts
 *     [--exe-strings samples/captured/decoded/exe-strings.json]
 *     [--window 4096]
 *     [--block amp]
 */

import { readFileSync } from 'node:fs';

interface ExtractedString {
  offset: number;
  kind: 'ascii' | 'utf16le';
  value: string;
}

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

const stringsPath = flag('exe-strings', 'samples/captured/decoded/exe-strings.json')!;
const windowSize = parseInt(flag('window', '4096')!, 10);
const targetBlock = flag('block', 'amp')!;

// Anchor sets keyed by block. Each anchor is the human-readable label
// we expect AM4-Edit to use for that param. Drawn from paramNames.ts.
//
// Pick anchors that are UNAMBIGUOUS — words that wouldn't naturally
// appear as standalone strings in the binary outside the param table.
// Single common words like "On" / "Off" / "Yes" / "No" are too noisy.
// Single-word anchors like "Bass" / "Mid" / "Master" hit the General-
// MIDI patch-name table that AM4-Edit ships (Bass Drum 1, Mute Hi Conga,
// Synth Lead, etc), poisoning the cluster scoring. Use only multi-word
// or unmistakably-amp-specific labels as anchors.
const ANCHOR_SETS: Record<string, string[]> = {
  amp: [
    'Bright Cap', 'High Treble', 'Master Vol Trim', 'Input Trim',
    'Compressor Clarity', 'Compressor Amount', 'Compressor Threshold',
    'Out Boost Level', 'Out Boost', 'Output Boost',
    'Negative Feedback', 'Tonestack Type', 'Tonestack Location',
    'Power Amp Modeling', 'Master Vol Location',
  ],
  drive: [
    'Bit Reduce', 'Bit Reduction', 'Mid Freq',
    'Slew Rate', 'Bass Response', 'Dry Level',
    'Clip Type', 'Clip Shape', 'Bass Focus',
  ],
  reverb: [
    'Spring Tone', 'Spring Drive', 'Number Of Springs', 'Boiiinnng!',
    'Shimmer Intensity', 'Shift 1', 'Shift 2',
    'Pre Delay', 'Pre-Delay', 'Predelay',
    'Crossover Frequency', 'Low Freq Time', 'High Freq Time',
    'Early Level', 'Late Level',
  ],
  delay: [
    'L/R Time Ratio', 'Master Feedback', 'Echo Pan',
    'Right Post Delay', 'Motor Speed', 'Head 1 Time', 'Head 2 Ratio',
    'Number Of Taps', 'Crossfade Time', 'Trigger Restart',
    'Sweep Rate', 'Sweep Phase',
  ],
  compressor: [
    'Knee Type', 'Auto Makeup', 'Look Ahead', 'Light Type',
    'Sidechain Source', 'Sidechain Frequency',
  ],
  chorus: [
    'Mod Phase', 'Phase Reverse', 'Number Of Voices', 'Auto Depth',
    'Thru-Zero', 'LFO Type', 'LFO Phase', 'LFO Duty Cycle',
  ],
};

const anchors = ANCHOR_SETS[targetBlock];
if (!anchors) {
  console.error(`Unknown block: ${targetBlock}`);
  console.error(`Available: ${Object.keys(ANCHOR_SETS).join(', ')}`);
  process.exit(1);
}

console.log(`block:   ${targetBlock}`);
console.log(`anchors: ${anchors.length} (${anchors.join(', ')})`);
console.log(`window:  ±${windowSize / 2} bytes\n`);

console.log(`loading ${stringsPath}...`);
const strings: ExtractedString[] = JSON.parse(readFileSync(stringsPath, 'utf8'));
console.log(`  ${strings.length.toLocaleString()} strings`);

// Build an index: anchor → list of offsets where it appears.
const anchorHits = new Map<string, number[]>();
for (const a of anchors) anchorHits.set(a, []);
for (const s of strings) {
  if (s.kind !== 'ascii') continue; // labels are ASCII per Ghidra dump
  if (anchors.includes(s.value)) {
    anchorHits.get(s.value)!.push(s.offset);
  }
}

console.log(`\nanchor hit counts:`);
for (const [a, offsets] of anchorHits) {
  console.log(`  ${a.padEnd(20)}  ${offsets.length} hits`);
}

// For each anchor offset, count how many DISTINCT anchors appear
// within ±windowSize/2 bytes of it. The maximum cluster is the
// candidate label pool.
const allHits: Array<{ offset: number; anchor: string }> = [];
for (const [a, offsets] of anchorHits) {
  for (const off of offsets) allHits.push({ offset: off, anchor: a });
}
allHits.sort((a, b) => a.offset - b.offset);

let bestStart = 0;
let bestEnd = 0;
let bestDistinctCount = 0;
let bestAnchorList: string[] = [];

// Two-pointer sliding window over allHits.
let lo = 0;
const counts = new Map<string, number>();
for (let hi = 0; hi < allHits.length; hi++) {
  const a = allHits[hi].anchor;
  counts.set(a, (counts.get(a) ?? 0) + 1);
  while (allHits[hi].offset - allHits[lo].offset > windowSize) {
    const drop = allHits[lo].anchor;
    counts.set(drop, (counts.get(drop) ?? 0) - 1);
    if (counts.get(drop) === 0) counts.delete(drop);
    lo++;
  }
  const distinct = counts.size;
  if (distinct > bestDistinctCount) {
    bestDistinctCount = distinct;
    bestStart = allHits[lo].offset;
    bestEnd = allHits[hi].offset;
    bestAnchorList = [...counts.keys()];
  }
}

console.log(`\n=== best cluster ===`);
console.log(`offsets: 0x${bestStart.toString(16)} .. 0x${bestEnd.toString(16)}  (span ${bestEnd - bestStart} bytes)`);
console.log(`distinct anchors found: ${bestDistinctCount} of ${anchors.length}`);
console.log(`  ${bestAnchorList.sort().join(', ')}`);

const missing = anchors.filter(a => !bestAnchorList.includes(a));
if (missing.length) console.log(`missing: ${missing.join(', ')}`);

// Print the cluster's full string content (with offsets), expanded by
// windowSize/2 on each side so we see context.
const ctxStart = bestStart - windowSize / 2;
const ctxEnd = bestEnd + windowSize / 2;
const cluster = strings.filter(s => s.offset >= ctxStart && s.offset <= ctxEnd && s.kind === 'ascii');

console.log(`\n--- cluster contents (${cluster.length} strings, ${ctxStart.toString(16)} .. ${ctxEnd.toString(16)}) ---`);
for (const s of cluster) {
  const isAnchor = anchors.includes(s.value);
  const mark = isAnchor ? ' ★' : '';
  console.log(`  0x${s.offset.toString(16).padStart(7)}  ${s.value.length.toString().padStart(3)}  "${s.value}"${mark}`);
}
