/**
 * Hunt for the missing labels section in the cache file.
 *
 * Premise: Procmon shows AM4-Edit reads the entire 129,407-byte cache
 * file. The records (1,154 of them) we already parse don't carry inline
 * names. That means there must be a string-pool / label-table section
 * we haven't decoded.
 *
 * Approach:
 *   1. Run parse-cache's logic to find where its parsing STOPS.
 *   2. Dump the bytes after the last parsed record — that's where the
 *      missing labels live.
 *   3. If labels are length-prefixed ASCII, count strings + dump first 50.
 */

import { readFileSync } from 'node:fs';

const cache = readFileSync('C:\\Users\\Steph\\AppData\\Roaming\\Fractal Audio\\AM4-Edit\\effectDefinitions_15_2p0.cache');
console.log(`cache size: ${cache.length} bytes (0x${cache.length.toString(16)})\n`);

// Read parsed records to find the highest offset we touched.
const s2 = JSON.parse(readFileSync('samples/captured/decoded/cache-section2.json', 'utf8')) as Array<{ offset: number; kind: string }>;
const s3wrap = JSON.parse(readFileSync('samples/captured/decoded/cache-section3.json', 'utf8')) as { records: Array<{ offset: number; kind: string; values?: string[] }> };
const s1 = JSON.parse(readFileSync('samples/captured/decoded/cache-records.json', 'utf8')) as Array<{ offset: number; kind: string }>;

const allOffsets = [...s1.map(r => r.offset), ...s2.map(r => r.offset), ...s3wrap.records.map(r => r.offset)];
const maxParsedOffset = Math.max(...allOffsets);
console.log(`parsed records: s1=${s1.length}, s2=${s2.length}, s3=${s3wrap.records.length} (total ${s1.length + s2.length + s3wrap.records.length})`);
console.log(`max parsed record offset: 0x${maxParsedOffset.toString(16)}`);

// Approximate end-of-last-parsed: walk forward 32 bytes (typical record size)
// from the max offset to estimate where parsing finished.
const stopGuess = maxParsedOffset + 64;
const remaining = cache.length - stopGuess;
console.log(`remaining bytes after estimated last record: ~${remaining} bytes\n`);

// Find every length-prefixed ASCII string in the file (u32 len + len ASCII).
// Look across the WHOLE file (not just the unparsed tail) so we find any
// string sections we might have missed.
function isPrintableAscii(b: number): boolean {
  return b >= 0x20 && b <= 0x7e;
}

interface Lp { offset: number; len: number; value: string }
const allLps: Lp[] = [];
for (let i = 0; i + 4 < cache.length; i++) {
  const len = cache.readUInt32LE(i);
  if (len < 1 || len > 64) continue;
  const start = i + 4;
  if (start + len > cache.length) continue;
  let ok = true;
  for (let j = 0; j < len; j++) {
    if (!isPrintableAscii(cache[start + j])) { ok = false; break; }
  }
  if (!ok) continue;
  // Reject if first char is digit-only sequences (probably noise) — but only
  // skip if entire string is digits. Real labels can start with digits ("1959SLP").
  const value = cache.slice(start, start + len).toString('ascii');
  allLps.push({ offset: i, len, value });
}

console.log(`length-prefixed ASCII strings (len 1..64) anywhere in file: ${allLps.length}`);

// Group strings into clusters by file region (4KB buckets)
const buckets = new Map<number, Lp[]>();
for (const lp of allLps) {
  const b = Math.floor(lp.offset / 4096);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b)!.push(lp);
}

console.log('\nstring density by 4KB bucket:');
for (const [b, lps] of [...buckets].sort((a, b) => a[0] - b[0])) {
  const offset = b * 4096;
  const sample = lps.slice(0, 4).map(l => `"${l.value}"`).join(', ');
  console.log(`  0x${offset.toString(16).padStart(5, '0')}..0x${(offset + 4095).toString(16)}: ${lps.length.toString().padStart(4)} strings  ${sample}`);
}

// Look specifically for the kind of labels we're missing. Filter out the
// known enum-value strings (amp model names, drive types, etc.). Anything
// like "Treble", "Presence", "Sag", "Bright Cap" would be a knob label.
const KNOWN_KNOB_LABELS = [
  'Gain', 'Bass', 'Mid', 'Treble', 'Master', 'Presence', 'Depth',
  'Bright Cap', 'Sag', 'Boiiinnng!', 'Spring Drive', 'Spring Tone',
  'Negative Feedback', 'Threshold', 'Ratio', 'Attack', 'Release',
  'Tone', 'Drive', 'Level', 'Mix',
];
console.log('\nLooking for knob-label strings:');
for (const target of KNOWN_KNOB_LABELS) {
  const hits = allLps.filter(l => l.value === target);
  if (hits.length > 0) {
    console.log(`  "${target}": ${hits.length} hits at offsets [${hits.slice(0, 5).map(h => '0x' + h.offset.toString(16)).join(', ')}${hits.length > 5 ? `, +${hits.length - 5} more` : ''}]`);
  }
}
