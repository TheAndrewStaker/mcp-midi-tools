// find-binarydata-by-hash.ts
//
// JUCE Projucer's getNamedResource uses a hash-based switch:
//   unsigned int hash = 0;
//   while (*p) hash = 31 * hash + *p++;
//   switch (hash) { case 0xABCDEF12: numBytes = ...; return blob; ... }
//
// The hash constants are 4-byte little-endian values in `.text`.
// This script:
//   1. Computes the JUCE hash for each known BinaryData filename.
//   2. Searches the .exe for each 4-byte hash value.
//   3. For each hit (typically inside the switch), dumps the
//      surrounding bytes — adjacent `lea` instructions reveal the
//      data pointer (RIP-relative), and `mov edx, imm32` reveals
//      the size.
//   4. Heuristically extracts the data pointer + size from the
//      hit's neighbourhood and dumps the bytes if they look XML.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const EXE = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const OUT_REPORT = 'samples/captured/decoded/binarydata-by-hash.txt';
const OUT_BLOB_DIR = 'samples/captured/decoded/binarydata/';

mkdirSync(dirname(OUT_REPORT), { recursive: true });
mkdirSync(OUT_BLOB_DIR, { recursive: true });

const buf = readFileSync(EXE);

// File offset → VA conversion (verified earlier):
const FILE_TO_VA = 0x140001000n;

function juceHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i);
        h = h | 0;       // keep 32-bit
    }
    return h >>> 0;      // unsigned
}

interface NamedFile {
    name: string;
    hash: number;
    hashLE: Buffer;
}

const names: string[] = ['__components.xml', '__block_layout.xml', '__block_layout_expert.xml'];

const targets: NamedFile[] = names.map(n => {
    const h = juceHash(n);
    const b = Buffer.alloc(4);
    b.writeUInt32LE(h, 0);
    return { name: n, hash: h, hashLE: b };
});

console.log('JUCE BinaryData hash lookup:');
for (const t of targets) {
    console.log(`  ${t.name.padEnd(28)} hash=0x${t.hash.toString(16).padStart(8, '0')}  bytes=${[...t.hashLE].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
}

// Find every occurrence of each hash value. Filter occurrences that
// look like part of an instruction operand (a `cmp eax, imm32` is
// a 5-byte instruction `3D xx xx xx xx`).

function findAll(needle: Buffer): number[] {
    const out: number[] = [];
    let from = 0;
    while (from < buf.length) {
        const idx = buf.indexOf(needle, from);
        if (idx < 0) break;
        out.push(idx);
        from = idx + 1;
    }
    return out;
}

function readU32LE(at: number): number {
    return buf.readUInt32LE(at);
}
function readS32LE(at: number): number {
    return buf.readInt32LE(at);
}
function readU64LE(at: number): bigint {
    return buf.readBigUInt64LE(at);
}

function hexLine(at: number, len = 16): string {
    if (at < 0 || at + len > buf.length) return '<oob>';
    let hex = '';
    let ascii = '';
    for (let i = 0; i < len; i++) {
        const c = buf[at + i];
        hex += c.toString(16).padStart(2, '0') + ' ';
        ascii += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
    }
    return `${hex.trim()}  |${ascii}|`;
}

function vaToFile(va: bigint): number | undefined {
    const off = Number(va - FILE_TO_VA);
    if (off < 0 || off >= buf.length) return undefined;
    return off;
}

const lines: string[] = [];
lines.push(`# JUCE BinaryData hash-based lookup scan`);
lines.push(`# exe: ${EXE}  (${buf.length} bytes)`);
lines.push('');

for (const t of targets) {
    lines.push(`################################################################`);
    lines.push(`# ${t.name}  hash=0x${t.hash.toString(16).padStart(8, '0')}`);
    lines.push(`################################################################`);

    const hits = findAll(t.hashLE);
    lines.push(`# raw 4-byte hits in exe: ${hits.length}`);

    for (const at of hits) {
        // Dump 96 bytes around the hit.
        lines.push('');
        lines.push(`@ file 0x${at.toString(16)}  VA=0x${(BigInt(at) + FILE_TO_VA).toString(16)}`);
        const start = Math.max(0, at - 16);
        const end = Math.min(buf.length, at + 80);
        for (let row = start; row < end; row += 16) {
            lines.push(`  0x${row.toString(16).padStart(8, '0')}  ${hexLine(row, 16)}`);
        }

        // Try to interpret nearby bytes as a `lea rcx, [rip+disp32]`
        // pattern: `48 8D 0D xx xx xx xx`. Common RIP-relative load.
        // This is the typical encoding for `return blob_data` after
        // `mov edx, imm32` (size).
        // Scan forward up to 64 bytes for `48 8D 0D` or `48 8D 15`
        // (lea rcx | rdx).
        for (let probe = at + 5; probe < Math.min(buf.length - 7, at + 64); probe++) {
            if (buf[probe] === 0x48 &&
                buf[probe + 1] === 0x8D &&
                (buf[probe + 2] === 0x0D || buf[probe + 2] === 0x15 ||
                 buf[probe + 2] === 0x05 || buf[probe + 2] === 0x35)) {
                const disp32 = readS32LE(probe + 3);
                // RIP-relative: target = RIP + disp32, where RIP is
                // the address of the NEXT instruction (probe + 7).
                const rip = BigInt(probe + 7);
                const targetVA = BigInt.asUintN(64, rip + FILE_TO_VA + BigInt(disp32));
                const targetFile = vaToFile(targetVA);
                lines.push(`  lea @ +0x${(probe - at).toString(16)}: rip-rel disp32=${disp32}  target VA=0x${targetVA.toString(16)}${targetFile !== undefined ? `  file=0x${targetFile.toString(16)}` : ''}`);

                // If the lea target looks like a data blob start, peek at it.
                if (targetFile !== undefined && targetFile + 64 <= buf.length) {
                    const head = buf.subarray(targetFile, targetFile + 64).toString('ascii');
                    const isPrintable = (() => {
                        let n = 0;
                        for (let i = 0; i < head.length; i++) {
                            const c = head.charCodeAt(i);
                            if ((c >= 0x20 && c < 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d) n++;
                        }
                        return n / head.length > 0.7;
                    })();
                    lines.push(`    head bytes: ${JSON.stringify(head)}  printable=${isPrintable}`);
                }
            }
        }
    }
    lines.push('');
}

writeFileSync(OUT_REPORT, lines.join('\n'));
console.log(`\nWrote report to ${OUT_REPORT}`);
