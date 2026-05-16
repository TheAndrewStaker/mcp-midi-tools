/**
 * Mine the SYSEX_* function-byte enum table from AxeEdit III strings.
 *
 * Loads samples/captured/decoded/axeedit3-strings.json (produced by
 * extract-exe-strings.ts against the AxeEdit III installer binary),
 * filters to SYSEX_* symbols, sorts by .rdata offset, and prints the
 * table.
 *
 * The MIDI_ERROR_* table (0x597108) established that contiguous,
 * 8-byte-aligned, NUL-terminated string pools in .rdata are indexed
 * by enum position — index in offset-sorted order = enum value.
 * Confirmed by 0x00 = MIDI_ERROR_BAD_CHKSUM matching the v1.4
 * empirical capture.
 *
 * Cross-anchor for SYSEX_* uses these v1.4-documented assignments:
 *   SYSEX_SETGET_BYPASS  = 0x0A
 *   SYSEX_SETGET_CHANNEL = 0x0B
 *   SYSEX_SETGET_SCENE   = 0x0C
 *   SYSEX_GET_PATCHNAME  = 0x0D   (v1.4 PDF labels this "QUERY PATCH NAME")
 *   SYSEX_GET_SCENENAME  = 0x0E   (v1.4 PDF labels this "QUERY SCENE NAME")
 *   SYSEX_SETGET_LOOPER  = 0x0F
 *   SYSEX_PATCH_STATUS   = 0x13
 *   SYSEX_SETGET_TEMPO   = 0x14
 *
 * If the SYSEX_* strings cluster contiguously and the documented names
 * land at their documented function bytes, the offset-index pattern
 * holds and undocumented entries pick up their function bytes for
 * free. If the offsets don't line up cleanly, we still document the
 * names in offset order as evidence of what surface exists.
 *
 * Run:
 *   npx tsx scripts/_research/mine-axeedit3-sysex-table.ts
 *     [--in samples/captured/decoded/axeedit3-strings.json]
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

const inPath = flag('in', 'samples/captured/decoded/axeedit3-strings.json')!;

interface ExtractedString {
  offset: number;
  kind: 'ascii' | 'utf16le';
  value: string;
}

console.log(`reading ${inPath}…`);
const raw = readFileSync(inPath, 'utf-8');
const all: ExtractedString[] = JSON.parse(raw);
console.log(`  ${all.length.toLocaleString()} total strings`);

const sysex = all
  .filter((s) => s.kind === 'ascii' && /^SYSEX_/.test(s.value))
  .sort((a, b) => a.offset - b.offset);

console.log(`  ${sysex.length} SYSEX_* ascii strings`);
console.log('');

if (sysex.length === 0) {
  console.error('no SYSEX_* strings found; aborting.');
  process.exit(1);
}

// Print full list with offsets and deltas between consecutive entries.
// A clean contiguous pool shows uniform deltas (length+padding).
const KNOWN: Record<string, number> = {
  SYSEX_SETGET_BYPASS: 0x0a,
  SYSEX_SETGET_CHANNEL: 0x0b,
  SYSEX_SETGET_SCENE: 0x0c,
  SYSEX_GET_PATCHNAME: 0x0d,
  SYSEX_GET_SCENENAME: 0x0e,
  SYSEX_SETGET_LOOPER: 0x0f,
  SYSEX_PATCH_STATUS: 0x13,
  SYSEX_SETGET_TEMPO: 0x14,
};

console.log('SYSEX_* strings sorted by .rdata offset:');
console.log('');
console.log('  idx | offset       | delta  | string                                | known fn');
console.log('  ----+--------------+--------+---------------------------------------+----------');

let prev = -1;
sysex.forEach((s, idx) => {
  const offHex = '0x' + s.offset.toString(16).padStart(6, '0');
  const delta = prev < 0 ? '' : `+${s.offset - prev}`;
  const known = KNOWN[s.value];
  const knownStr = known !== undefined ? `0x${known.toString(16).padStart(2, '0')}` : '';
  console.log(
    `  ${idx.toString().padStart(3)} | ${offHex.padEnd(12)} | ${delta.padEnd(6)} | ${s.value.padEnd(37)} | ${knownStr}`,
  );
  prev = s.offset;
});

console.log('');

// Anchor analysis: do the known assignments line up with the index?
// If SYSEX_SETGET_BYPASS lands at index N, and N corresponds to fn 0x0A,
// then index → fn mapping might be index + offsetBase = fn.
//
// Try a fit: assume fn = index + delta for some constant delta.
console.log('Index-to-fn-byte fit analysis:');
console.log('');

const fits: Map<number, string[]> = new Map();
sysex.forEach((s, idx) => {
  const known = KNOWN[s.value];
  if (known === undefined) return;
  const delta = known - idx;
  if (!fits.has(delta)) fits.set(delta, []);
  fits.get(delta)!.push(`${s.value} (idx ${idx} → fn 0x${known.toString(16)})`);
});

if (fits.size === 0) {
  console.log('  no known anchors found in the SYSEX_* string list.');
} else {
  for (const [delta, lines] of [...fits.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  delta=${delta} (fn = index + ${delta}) — ${lines.length} matches:`);
    for (const line of lines) console.log(`    ${line}`);
    console.log('');
  }
}

// If a single delta fits ALL known anchors, the mapping is clean.
// Print the inferred function-byte table for the whole list.
const dominantFit = [...fits.entries()].sort((a, b) => b[1].length - a[1].length)[0];
if (dominantFit && dominantFit[1].length === Object.keys(KNOWN).filter((k) => sysex.some((s) => s.value === k)).length) {
  const delta = dominantFit[0];
  console.log(`Inferred function-byte mapping (fn = index + ${delta}):`);
  console.log('');
  console.log('  fn   | string                              | documented?');
  console.log('  -----+-------------------------------------+------------');
  sysex.forEach((s, idx) => {
    const fn = idx + delta;
    const known = KNOWN[s.value];
    const doc = known !== undefined ? (known === fn ? '✓' : `MISMATCH (doc=0x${known.toString(16)})`) : '?';
    console.log(`  0x${fn.toString(16).padStart(2, '0')} | ${s.value.padEnd(35)} | ${doc}`);
  });
} else {
  console.log('Index-to-fn mapping is NOT consistent across known anchors.');
  console.log('Document the names in offset order; function-byte assignments need other evidence.');
}
