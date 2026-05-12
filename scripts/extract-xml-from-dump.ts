/**
 * Memory dump contains XML UI definitions like:
 *   <EditorControl name="Sidechain Source" parameterName="...">
 *
 * Find the root XML element(s) in the dump and extract the largest
 * contiguous well-formed XML document. Then parse for (name,
 * parameterName) tuples — that's the label table.
 *
 * Usage:
 *   npx tsx scripts/extract-xml-from-dump.ts <dump-path> [--out file]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dumpPath = args[0];
if (!dumpPath) { console.error('Usage: extract-xml-from-dump.ts <dump>'); process.exit(1); }
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'samples/captured/decoded/dump-xml-extracts.txt';

console.log(`dump: ${dumpPath}`);
const buf = readFileSync(dumpPath);
console.log(`size: ${(buf.length / 1_000_000).toFixed(0)} MB\n`);

// Find every "<?xml" start (xml prolog) and "<EditorControl" tag
// occurrence. For each, follow forward as long as the bytes look like
// valid XML / printable ASCII.
const PROBES: string[] = [
  '<?xml',
  '<EditorControl',
  '<Editor',
  '<UI',
  '<Block',
  '<Param',
  '<Page',
];

interface Hit { offset: number; probe: string; }
const hits: Hit[] = [];
for (const probe of PROBES) {
  const needle = Buffer.from(probe, 'ascii');
  let pos = 0;
  while (pos <= buf.length - needle.length) {
    const idx = buf.indexOf(needle, pos);
    if (idx < 0) break;
    hits.push({ offset: idx, probe });
    pos = idx + 1;
  }
}
hits.sort((a, b) => a.offset - b.offset);

console.log(`hits per probe:`);
const probeCounts = new Map<string, number>();
for (const h of hits) probeCounts.set(h.probe, (probeCounts.get(h.probe) ?? 0) + 1);
for (const [p, n] of probeCounts) console.log(`  ${p.padEnd(20)} ${n}`);

// For each XML-prolog hit, walk forward extracting bytes until we hit
// a long run of non-printable bytes (>= 8 NUL bytes in a row → end).
function isPrintableOrWS(b: number): boolean {
  return (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
}

interface Extract { offset: number; len: number; text: string }
const extracts: Extract[] = [];

// Start hunts from each EditorControl/Block/Page tag, walk backward to
// find document start, walk forward to find end. Cluster by proximity.
const startHits = hits.filter(h => h.probe === '<?xml' || h.probe === '<EditorControl' || h.probe === '<UI');
const seen = new Set<number>();
for (const h of startHits) {
  // Walk backward until we hit a non-printable run
  let lo = h.offset;
  let nonPrintRun = 0;
  while (lo > 0) {
    const b = buf[lo - 1];
    if (isPrintableOrWS(b)) {
      nonPrintRun = 0;
      lo--;
    } else {
      nonPrintRun++;
      if (nonPrintRun > 4) { lo += nonPrintRun; break; }
      lo--;
    }
  }
  // Walk forward
  let hi = h.offset;
  nonPrintRun = 0;
  while (hi < buf.length) {
    const b = buf[hi];
    if (isPrintableOrWS(b)) {
      nonPrintRun = 0;
      hi++;
    } else {
      nonPrintRun++;
      if (nonPrintRun > 8) { hi -= nonPrintRun; break; }
      hi++;
    }
  }
  // Avoid duplicates: skip if we've already extracted from this region
  let dup = false;
  for (const s of seen) {
    if (Math.abs(s - lo) < 64) { dup = true; break; }
  }
  if (dup) continue;
  seen.add(lo);

  if (hi - lo > 200) { // require substantial run
    const text = buf.subarray(lo, hi).toString('ascii');
    extracts.push({ offset: lo, len: hi - lo, text });
  }
}

// Sort by length descending
extracts.sort((a, b) => b.len - a.len);

console.log(`\nfound ${extracts.length} candidate XML extracts; top 10 by size:\n`);
for (let i = 0; i < Math.min(10, extracts.length); i++) {
  const e = extracts[i];
  console.log(`  #${i}  offset=0x${e.offset.toString(16)}  len=${e.len}  preview="${e.text.slice(0, 120).replace(/\s+/g, ' ')}"`);
}

// Save the top 5 to disk for inspection
const topN = Math.min(5, extracts.length);
let outAll = '';
for (let i = 0; i < topN; i++) {
  const e = extracts[i];
  outAll += `\n\n========== extract #${i}  offset=0x${e.offset.toString(16)}  len=${e.len} ==========\n\n`;
  outAll += e.text;
}
writeFileSync(outPath, outAll);
console.log(`\nwrote ${outPath} (${outAll.length} bytes)`);

// Quickly count (name, parameterName) tuples in the extracts
const NAME_RE = /name="([^"]+)"/g;
const PARAM_RE = /parameterName="([^"]+)"/g;
const allNames = new Set<string>();
const allParams = new Set<string>();
for (const e of extracts) {
  let m;
  while ((m = NAME_RE.exec(e.text))) allNames.add(m[1]);
  while ((m = PARAM_RE.exec(e.text))) allParams.add(m[1]);
}
console.log(`\ndistinct name="..." values:          ${allNames.size}`);
console.log(`distinct parameterName="..." values:    ${allParams.size}`);
if (allParams.size > 0) {
  console.log(`\nsample parameterNames: ${[...allParams].slice(0, 10).join(', ')}`);
}
if (allNames.size > 0) {
  console.log(`sample names: ${[...allNames].slice(0, 10).join(', ')}`);
}
