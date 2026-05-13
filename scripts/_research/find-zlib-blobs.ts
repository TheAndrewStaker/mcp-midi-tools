/**
 * Search AM4-Edit.exe for zlib stream magic bytes and try to decompress
 * each candidate. If labels are compressed in a static blob, the blob
 * starts with one of zlib's well-known 2-byte headers.
 *
 * zlib stream headers (CMF/FLG):
 *   0x78 0x01  - no compression / minimal
 *   0x78 0x5E  - low compression
 *   0x78 0x9C  - default compression  (most common)
 *   0x78 0xDA  - best compression
 *
 * For each match we try inflateSync(). Successful decompression that
 * yields > 1 KB of mostly-printable bytes is a label-table candidate.
 *
 * Run:
 *   npx tsx scripts/find-zlib-blobs.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const exePath = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const buf = readFileSync(exePath);
console.log(`exe: ${exePath}`);
console.log(`size: ${buf.length.toLocaleString()} bytes\n`);

const HEADERS: Array<{ bytes: [number, number]; label: string }> = [
  { bytes: [0x78, 0x01], label: 'low' },
  { bytes: [0x78, 0x5e], label: 'medium' },
  { bytes: [0x78, 0x9c], label: 'default' },
  { bytes: [0x78, 0xda], label: 'best' },
];

interface Candidate {
  offset: number;
  header: string;
  inflated?: Buffer;
  error?: string;
  printableRatio?: number;
}

const candidates: Candidate[] = [];

for (const { bytes, label } of HEADERS) {
  let pos = 0;
  while (pos < buf.length - 2) {
    const i = buf.indexOf(bytes[0], pos);
    if (i < 0) break;
    if (buf[i + 1] === bytes[1]) {
      candidates.push({ offset: i, header: label });
    }
    pos = i + 1;
  }
}

console.log(`found ${candidates.length} zlib-magic-byte candidates`);
const headerHist = new Map<string, number>();
for (const c of candidates) headerHist.set(c.header, (headerHist.get(c.header) ?? 0) + 1);
for (const [h, n] of headerHist) console.log(`  ${h.padEnd(8)} ${n}`);

// Try to inflate each. Many will be false positives (random bytes that
// happen to start with 0x78 0x9C, etc.) so most attempts will fail.
let success = 0;
const successfulCandidates: Required<Candidate>[] = [];
for (const c of candidates) {
  // Skip obviously too-small remaining buffers
  if (buf.length - c.offset < 16) continue;
  try {
    // Take a generous slice (up to 2MB) and let inflate decide where to
    // stop. inflateSync may not stop cleanly mid-stream, but for valid
    // streams it returns the full inflated content.
    const slice = buf.subarray(c.offset, Math.min(c.offset + 2_000_000, buf.length));
    const out = inflateSync(slice);
    success++;
    let printable = 0;
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
    }
    const ratio = out.length > 0 ? printable / out.length : 0;
    successfulCandidates.push({
      offset: c.offset, header: c.header,
      inflated: out, printableRatio: ratio, error: '',
    });
  } catch (e) {
    // Most candidates will fail — that's expected
    candidates[candidates.indexOf(c)].error = (e as Error).message.slice(0, 60);
  }
}

console.log(`\nsuccessful inflations: ${success}`);

// Sort by inflated size, descending. Largest blobs are most likely to be
// the label table or a similar resource.
successfulCandidates.sort((a, b) => b.inflated.length - a.inflated.length);

console.log('\ntop 15 successful inflations:');
console.log('  exe-offset    header     inflated-size  printable%  preview');
for (const c of successfulCandidates.slice(0, 15)) {
  const preview = c.inflated.subarray(0, 80).toString('ascii').replaceAll(/[^\x20-\x7e]/g, '.');
  console.log(
    `  0x${c.offset.toString(16).padStart(8, '0')}  ${c.header.padEnd(8)}   ${c.inflated.length.toString().padStart(10)}   ${(c.printableRatio * 100).toFixed(0).padStart(4)}%      ${preview}`,
  );
}

// Save the most promising candidates (printable ratio > 60%, size > 1 KB)
// to disk so we can inspect them.
const PROMISING = successfulCandidates.filter(c => c.printableRatio > 0.6 && c.inflated.length > 1024);
console.log(`\npromising candidates (>60% printable, >1KB): ${PROMISING.length}`);
for (let i = 0; i < Math.min(PROMISING.length, 10); i++) {
  const c = PROMISING[i];
  const outPath = `samples/captured/decoded/exe-zlib-${i}-off${c.offset.toString(16)}.bin`;
  writeFileSync(outPath, c.inflated);
  console.log(`  wrote ${outPath}  (${c.inflated.length} bytes, ${(c.printableRatio * 100).toFixed(0)}% printable)`);
}
