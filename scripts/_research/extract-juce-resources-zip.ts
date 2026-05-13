// extract-juce-resources-zip.ts
//
// Extract the embedded JUCE resources ZIP from AM4-Edit.exe and
// dump every member file. The ZIP was located by spotting a `PK\03\04`
// local file header at file offset 0x7dc1a1 (containing `__components.xml`)
// and the End of Central Directory `PK\05\06` at 0x7dff26.
//
// ZIP layout in the .exe:
//   - All local file headers + compressed data: starting at ZIP_START
//   - Central directory: at ZIP_START + CD_OFFSET
//   - End of Central Directory: at ZIP_START + CD_OFFSET + CD_SIZE
//
// We compute ZIP_START from the EOCD record, slice those bytes out
// of the .exe, and write a real .zip file. Then we read the contents
// using a standard ZIP library.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import AdmZip from 'adm-zip';

// Defaults to AM4-Edit; pass an alternate exe path as argv[2] to
// extract from another JUCE-based editor. Generates a per-exe
// output dir + zip name.
const EXE = process.argv[2] ?? 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const TAG = (() => {
    const m = EXE.replace(/\\/g, '/').match(/\/([^/]+)\.exe$/i);
    return (m?.[1] ?? 'unknown').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
})();
const OUT_ZIP = `samples/captured/decoded/binarydata/${TAG}-resources.zip`;
const OUT_DIR = `samples/captured/decoded/binarydata/${TAG}-extracted/`;

mkdirSync('samples/captured/decoded/binarydata', { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
console.log(`Source exe: ${EXE}`);

const buf = readFileSync(EXE);

// Find EOCD signature `50 4b 05 06`. Use the LAST occurrence in
// the file (in case there are stray ZIPs).
const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
let eocdOff = -1;
for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocdOff = i;
        break;
    }
}
if (eocdOff < 0) throw new Error('No EOCD signature found in .exe');
console.log(`EOCD found at file 0x${eocdOff.toString(16)}`);

// Parse the EOCD record.
const numEntries     = buf.readUInt16LE(eocdOff + 10);
const cdSize         = buf.readUInt32LE(eocdOff + 12);
const cdOffsetInZip  = buf.readUInt32LE(eocdOff + 16);
const commentLen     = buf.readUInt16LE(eocdOff + 20);
console.log(`EOCD: entries=${numEntries}  cdSize=0x${cdSize.toString(16)}  cdOffsetInZip=0x${cdOffsetInZip.toString(16)}  commentLen=${commentLen}`);

const cdEndFile  = eocdOff;            // CD ends right before EOCD
const cdStartFile = cdEndFile - cdSize;
const zipStartFile = cdStartFile - cdOffsetInZip;
const zipEndFile = eocdOff + 22 + commentLen;

console.log(`ZIP file span: 0x${zipStartFile.toString(16)} .. 0x${zipEndFile.toString(16)}  (${zipEndFile - zipStartFile} bytes)`);

const zipBytes = buf.subarray(zipStartFile, zipEndFile);
writeFileSync(OUT_ZIP, zipBytes);
console.log(`Wrote ZIP to ${OUT_ZIP}`);

// Extract all entries.
const zip = new AdmZip(OUT_ZIP);
const entries = zip.getEntries();
console.log(`\nZIP contains ${entries.length} entries:`);

for (const e of entries) {
    const name = e.entryName;
    const sz = e.header.size;
    console.log(`  ${name.padEnd(48)}  uncompressed=${sz}`);
    if (e.isDirectory) continue;
    const outPath = OUT_DIR + name.replace(/[\/\\]/g, '_');
    writeFileSync(outPath, e.getData());
}

console.log(`\nExtracted ${entries.length} entries to ${OUT_DIR}`);
