// find-binarydata-pointers.ts
//
// Locate JUCE BinaryData entries in AM4-Edit.exe by scanning for
// 8-byte little-endian VA pointers that point to the filename
// strings (e.g. "__block_layout.xml" at VA 0x140723628). Where those
// pointer values appear in the .exe is either:
//   - inside the BinaryData lookup function (FUN_14031d420)
//     where it does `lea rcx, name_string` then immediately `lea rdx,
//     data_blob` and `mov r8d, size`. The 8 bytes after the name VA
//     are usually the data pointer.
//   - inside a static table {name_ptr, data_ptr, size} layout.
//
// Output: print each pointer location + 32 bytes of context. The
// context typically reveals the data pointer + size adjacent to the
// name pointer.
//
// Once we have a candidate data pointer + size, we read those exact
// bytes and check if they look like XML (with `<` somewhere in the
// first 16 bytes). If yes, dump them to disk for inspection.
//
// Usage:
//   npx tsx scripts/find-binarydata-pointers.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const EXE = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const OUT_INDEX = 'samples/captured/decoded/binarydata-index.txt';
const OUT_BLOB_DIR = 'samples/captured/decoded/binarydata/';

mkdirSync(dirname(OUT_INDEX), { recursive: true });
mkdirSync(OUT_BLOB_DIR, { recursive: true });

const buf = readFileSync(EXE);
console.log(`exe: ${EXE} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

// File offset → VA conversion (verified earlier in this project):
//   VA = file_offset + 0x140001000
const FILE_TO_VA = 0x140001000n;

interface Filename {
    name: string;
    fileOffset: number;
    va: bigint;
}

// Locate filename strings inside the .exe.
const filenames: string[] = ['__components.xml', '__block_layout.xml', '__block_layout_expert.xml'];
const found: Filename[] = [];

for (const fname of filenames) {
    // First occurrence in file (the canonical .rdata copy).
    const ascii = Buffer.from(fname, 'ascii');
    const idx = buf.indexOf(ascii);
    if (idx < 0) {
        console.log(`  WARN: ${fname} NOT in exe`);
        continue;
    }
    const va = BigInt(idx) + FILE_TO_VA;
    found.push({ name: fname, fileOffset: idx, va });
    console.log(`  ${fname.padEnd(28)} file=0x${idx.toString(16)}  VA=0x${va.toString(16)}`);
}

const lines: string[] = [];
lines.push(`# JUCE BinaryData pointer scan in AM4-Edit.exe`);
lines.push(`# exe size: ${buf.length} bytes`);
lines.push(`# file→VA conversion: VA = file + 0x${FILE_TO_VA.toString(16)}`);
lines.push('');

function readU64LE(at: number): bigint {
    return buf.readBigUInt64LE(at);
}

// Helper: search for an 8-byte little-endian VA pattern in the file.
function findVAReferences(va: bigint): number[] {
    const target = Buffer.alloc(8);
    target.writeBigUInt64LE(va, 0);
    const refs: number[] = [];
    let from = 0;
    while (from < buf.length) {
        const idx = buf.indexOf(target, from);
        if (idx < 0) break;
        refs.push(idx);
        from = idx + 1;
    }
    return refs;
}

function hex32(at: number): string {
    const len = Math.min(32, buf.length - at);
    const slice = buf.subarray(at, at + len);
    let hex = '';
    let ascii = '';
    for (let i = 0; i < slice.length; i++) {
        hex += slice[i].toString(16).padStart(2, '0') + ' ';
        const c = slice[i];
        ascii += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
    }
    return `${hex.trim()}  |${ascii}|`;
}

// VA → file offset conversion (.text and .rdata both fall in the
// same simple `file = VA - 0x140001000` mapping per our PE inspection).
function vaToFileMaybe(va: bigint): number | undefined {
    const off = Number(va - FILE_TO_VA);
    if (off < 0 || off >= buf.length) return undefined;
    return off;
}

// For each filename, scan for references and dump the 8-byte values
// immediately after each reference (the candidate data pointer).
for (const f of found) {
    lines.push(`################################################################`);
    lines.push(`# ${f.name}  (file 0x${f.fileOffset.toString(16)}, VA 0x${f.va.toString(16)})`);
    lines.push(`################################################################`);

    const refs = findVAReferences(f.va);
    lines.push(`# pointer references: ${refs.length}`);
    for (const refOff of refs) {
        lines.push('');
        lines.push(`@ file 0x${refOff.toString(16)}`);
        // Dump 64 bytes around the reference.
        const start = Math.max(0, refOff - 16);
        const len = Math.min(96, buf.length - start);
        for (let row = 0; row < len; row += 16) {
            const lineStart = start + row;
            lines.push(`  0x${lineStart.toString(16).padStart(8, '0')}  ${hex32(lineStart)}`);
        }

        // Try interpreting the 8 bytes immediately after the name
        // pointer as a candidate data pointer, and the 8 bytes after
        // that as a size.
        if (refOff + 24 <= buf.length) {
            const dataPtrVA = readU64LE(refOff + 8);
            const sizeMaybe = readU64LE(refOff + 16);
            const dataFile = vaToFileMaybe(dataPtrVA);
            lines.push(`  candidate data ptr (8 bytes after name ptr) = 0x${dataPtrVA.toString(16)}  ${dataFile !== undefined ? `(file 0x${dataFile.toString(16)})` : '(out of range)'}`);
            lines.push(`  candidate size     (16 bytes after name ptr) = 0x${sizeMaybe.toString(16)}  (${Number(sizeMaybe & 0x7FFFFFFFFFFFFFFFn)} dec)`);

            if (dataFile !== undefined && sizeMaybe < 5_000_000n && sizeMaybe > 32n) {
                const blobLen = Number(sizeMaybe);
                if (dataFile + blobLen <= buf.length) {
                    const blob = buf.subarray(dataFile, dataFile + blobLen);
                    const head = blob.subarray(0, Math.min(64, blob.length)).toString('ascii');
                    lines.push(`  blob head: ${JSON.stringify(head)}`);

                    // Save the blob if it looks XML-shaped.
                    const looksXml = head.includes('<') && (head.includes('xml') || head.includes('Page') || head.includes('Editor') || head.includes('Effect') || head.includes('component'));
                    if (looksXml) {
                        const safe = f.name.replace(/[^a-z0-9._-]/gi, '_');
                        const outPath = `${OUT_BLOB_DIR}${safe}.from-0x${dataFile.toString(16)}.bin`;
                        writeFileSync(outPath, blob);
                        lines.push(`  *** XML-shaped blob written to ${outPath} ***`);
                    }
                }
            }
        }
    }
    lines.push('');
}

writeFileSync(OUT_INDEX, lines.join('\n'));
console.log(`\nWrote index to ${OUT_INDEX}`);
