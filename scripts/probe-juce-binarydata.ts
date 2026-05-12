// probe-juce-binarydata.ts
//
// Quick probe of any binary to check if it contains an embedded JUCE
// BinaryData ZIP, without actually extracting the contents.
//
// Searches backward from end-of-file for the EOCD signature
// `PK\x05\x06`. If present, parses the EOCD to compute the ZIP span,
// reads its central directory, and prints the top-level filenames
// sorted by uncompressed size. Useful to confirm the technique works
// on a new binary before writing a full extractor for that device.
//
// Usage:
//   npx tsx scripts/probe-juce-binarydata.ts <path-to-exe>
//
// Output: lines printed to stdout. Exit code 0 if ZIP found, 1 if not.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const exePath = process.argv[2];
if (!exePath) {
    console.error('Usage: npx tsx scripts/probe-juce-binarydata.ts <path-to-exe>');
    process.exit(2);
}

const buf = readFileSync(exePath);
console.log(`Probing ${basename(exePath)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

// Step 1: locate the LAST EOCD signature in the file.
let eocdOff = -1;
for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocdOff = i;
        break;
    }
}
if (eocdOff < 0) {
    console.log('  ✗ No PK\\x05\\x06 EOCD signature found. Not a JUCE BinaryData ZIP (or uses non-ZIP shape).');
    process.exit(1);
}

console.log(`  ✓ EOCD at file 0x${eocdOff.toString(16)}`);

const numEntries     = buf.readUInt16LE(eocdOff + 10);
const cdSize         = buf.readUInt32LE(eocdOff + 12);
const cdOffsetInZip  = buf.readUInt32LE(eocdOff + 16);
const commentLen     = buf.readUInt16LE(eocdOff + 20);
console.log(`  entries: ${numEntries}`);
console.log(`  cdSize:  0x${cdSize.toString(16)}`);
console.log(`  cdOffsetInZip: 0x${cdOffsetInZip.toString(16)}`);

const cdEndFile     = eocdOff;
const cdStartFile   = cdEndFile - cdSize;
const zipStartFile  = cdStartFile - cdOffsetInZip;
const zipEndFile    = eocdOff + 22 + commentLen;
const zipSize       = zipEndFile - zipStartFile;

console.log(`  ZIP span: 0x${zipStartFile.toString(16)} .. 0x${zipEndFile.toString(16)}  (${zipSize.toLocaleString()} bytes)`);

// Step 2: parse the central directory entries to enumerate filenames.
let cursor = cdStartFile;
const entries: Array<{ name: string; uncompressedSize: number; compressedSize: number; method: number }> = [];
for (let i = 0; i < numEntries; i++) {
    if (cursor + 46 > buf.length) break;
    const sig = buf.readUInt32LE(cursor);
    if (sig !== 0x02014b50) {
        console.log(`  central directory entry #${i} bad signature 0x${sig.toString(16)} at file 0x${cursor.toString(16)} — bailing`);
        break;
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const uncompSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLenE = buf.readUInt16LE(cursor + 32);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    entries.push({ name, uncompressedSize: uncompSize, compressedSize: compSize, method });
    cursor += 46 + nameLen + extraLen + commentLenE;
}

console.log(`\n  Parsed ${entries.length} CD entries.`);

// Step 3: print the largest XML / text entries first (most likely to be
// labelling data), then a count of asset types.
const xmlOrText = entries.filter(e => /\.(xml|txt|json|csv|tsv|laxml)$/i.test(e.name)).sort((a, b) => b.uncompressedSize - a.uncompressedSize);
console.log('\n  XML / text entries (sorted by size):');
for (const e of xmlOrText) {
    const compRatio = e.uncompressedSize > 0 ? (100 * e.compressedSize / e.uncompressedSize).toFixed(0) + '%' : '-';
    console.log(`    ${e.name.padEnd(40)} ${String(e.uncompressedSize).padStart(8)} bytes  (${compRatio} compressed, method=${e.method})`);
}

// Step 4: type histogram of all entries.
const extCounts: Record<string, number> = {};
for (const e of entries) {
    const ext = (e.name.match(/\.([^.\/\\]+)$/) ?? ['', '<no-ext>'])[1].toLowerCase();
    extCounts[ext] = (extCounts[ext] ?? 0) + 1;
}
console.log('\n  Asset types:');
for (const [ext, n] of Object.entries(extCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    .${ext.padEnd(12)} ${n}`);
}

console.log('\n  Verdict: ✓ JUCE BinaryData ZIP found. Use scripts/extract-juce-resources-zip.ts (point it at this exe) to extract.');
