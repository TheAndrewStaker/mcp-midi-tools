// extract-all-zips.ts
//
// Some JUCE binaries embed MULTIPLE concatenated ZIP archives — one
// for the editor's layout/asset BinaryData, one for the bundled
// Fractal-Bot updater, possibly more. The single-EOCD-from-end search
// in extract-juce-resources-zip.ts only finds the last one. This
// script:
//
//   1. Scans the entire binary for every PK\x05\x06 EOCD signature.
//   2. Validates each by parsing the EOCD record + checking the
//      central-directory walk produces sensible entries.
//   3. For each valid EOCD, slices the ZIP and writes it to disk.
//   4. For each ZIP, prints a brief summary (entries, top XML files
//      by size).
//
// Usage:
//   npx tsx scripts/extract-all-zips.ts <path-to-exe>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import AdmZip from 'adm-zip';

const exePath = process.argv[2];
if (!exePath) {
    console.error('Usage: npx tsx scripts/extract-all-zips.ts <path-to-exe>');
    process.exit(2);
}

const buf = readFileSync(exePath);
const tag = basename(exePath, '.exe').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const outDir = `samples/captured/decoded/binarydata/${tag}-allzips/`;
mkdirSync(outDir, { recursive: true });

console.log(`Source: ${exePath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Output: ${outDir}`);

// Scan for all EOCD signatures.
const eocdOffs: number[] = [];
for (let i = 0; i + 22 <= buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocdOffs.push(i);
    }
}
console.log(`\nFound ${eocdOffs.length} PK\\x05\\x06 candidate(s):`);

for (let idx = 0; idx < eocdOffs.length; idx++) {
    const eocdOff = eocdOffs[idx];
    console.log(`\n=== EOCD #${idx + 1} @ file 0x${eocdOff.toString(16)} ===`);

    if (eocdOff + 22 > buf.length) {
        console.log('  too close to end of file; skipping');
        continue;
    }

    const numEntries     = buf.readUInt16LE(eocdOff + 10);
    const cdSize         = buf.readUInt32LE(eocdOff + 12);
    const cdOffsetInZip  = buf.readUInt32LE(eocdOff + 16);
    const commentLen     = buf.readUInt16LE(eocdOff + 20);
    const cdEnd   = eocdOff;
    const cdStart = cdEnd - cdSize;
    const zipStart = cdStart - cdOffsetInZip;
    const zipEnd   = eocdOff + 22 + commentLen;

    console.log(`  entries: ${numEntries}, cdSize: 0x${cdSize.toString(16)}, cdOffsetInZip: 0x${cdOffsetInZip.toString(16)}`);
    console.log(`  ZIP span: 0x${zipStart.toString(16)} .. 0x${zipEnd.toString(16)}  (${(zipEnd - zipStart).toLocaleString()} bytes)`);

    if (zipStart < 0 || zipEnd > buf.length) {
        console.log('  ZIP span outside file; skipping');
        continue;
    }

    // Validate: first 4 bytes at cdStart should be PK\x01\x02 (CD entry signature).
    const cdSig = buf.readUInt32LE(cdStart);
    if (cdSig !== 0x02014b50) {
        console.log(`  CD start signature mismatch (got 0x${cdSig.toString(16)}, expected 0x02014b50). Probably a false positive — skipping.`);
        continue;
    }

    // Slice and write.
    const zipBytes = buf.subarray(zipStart, zipEnd);
    const outPath = `${outDir}zip${idx + 1}-eocd-0x${eocdOff.toString(16)}.zip`;
    writeFileSync(outPath, zipBytes);

    // Open with adm-zip to list contents.
    try {
        const zip = new AdmZip(outPath);
        const entries = zip.getEntries();
        console.log(`  Extracted ${entries.length} entries to ${outPath}`);

        const xmlEntries = entries.filter(e => /\.(xml|laxml|json)$/i.test(e.entryName)).sort((a, b) => b.header.size - a.header.size);
        if (xmlEntries.length > 0) {
            console.log(`  XML/JSON entries (${xmlEntries.length}):`);
            for (const e of xmlEntries.slice(0, 12)) {
                console.log(`    ${e.entryName.padEnd(48)} ${String(e.header.size).padStart(8)} bytes`);
            }
            if (xmlEntries.length > 12) console.log(`    (... ${xmlEntries.length - 12} more)`);
        } else {
            console.log(`  (no XML/JSON entries)`);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  adm-zip error: ${msg}`);
    }
}

console.log('\nDone.');
