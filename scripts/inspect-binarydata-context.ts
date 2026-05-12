// inspect-binarydata-context.ts
//
// We located the BinaryData filenames at multiple offsets:
//   __components.xml: 0x722640 (canonical), 0x728BB0, 0x7DC1BF, 0x7DFF16, 0x11E35AD, 0x11F2F49
//   __block_layout.xml: 0x722628, 0x11D1D7E, 0x11F2EC2
//   __block_layout_expert.xml: 0x722680, 0x11DA8A8, 0x11F2F02
//
// The first occurrence per name is the canonical .rdata copy. The
// later occurrences are likely:
//   (a) Inside FUN_14031d420 as inline strcmp constants. If so, the
//       surrounding bytes are x86-64 instructions, and the data
//       pointer + size are loaded via `lea` / `mov` nearby.
//   (b) In a separate string pool used for a different purpose
//       (logging? debug?).
//
// This script dumps 256 bytes around each non-canonical occurrence
// and looks for nearby `lea` / `mov edx, imm32` / `mov r8d, imm32`
// patterns that would indicate the data pointer + size.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const EXE = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const OUT = 'samples/captured/decoded/binarydata-context.txt';
const OUT_BLOB_DIR = 'samples/captured/decoded/binarydata/';

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(OUT_BLOB_DIR, { recursive: true });

const buf = readFileSync(EXE);
const FILE_TO_VA = 0x140001000n;

const occurrences: Record<string, number[]> = {
    '__components.xml':           [0x722640, 0x728BB0, 0x7DC1BF, 0x7DFF16, 0x11E35AD, 0x11F2F49],
    '__block_layout.xml':         [0x722628, 0x11D1D7E, 0x11F2EC2],
    '__block_layout_expert.xml':  [0x722680, 0x11DA8A8, 0x11F2F02],
};

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

function readS32LE(at: number): number {
    return buf.readInt32LE(at);
}

function vaToFile(va: bigint): number | undefined {
    const off = Number(va - FILE_TO_VA);
    if (off < 0 || off >= buf.length) return undefined;
    return off;
}

function tryReadAsciiBlob(fileOff: number, size: number): string | undefined {
    if (fileOff < 0 || fileOff + size > buf.length || size < 8 || size > 5_000_000) return undefined;
    const slice = buf.subarray(fileOff, fileOff + Math.min(size, 256));
    let printable = 0;
    for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        if ((c >= 0x20 && c < 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d) printable++;
    }
    if (printable / slice.length < 0.7) return undefined;
    return slice.toString('ascii');
}

const lines: string[] = [];
lines.push(`# BinaryData filename context dump`);
lines.push('');

for (const [name, offsets] of Object.entries(occurrences)) {
    lines.push(`################################################################`);
    lines.push(`# ${name}`);
    lines.push(`################################################################`);

    for (let oi = 0; oi < offsets.length; oi++) {
        const off = offsets[oi];
        const tag = oi === 0 ? '(canonical .rdata copy)' : '(occurrence ' + (oi + 1) + ')';
        lines.push('');
        lines.push(`@ file 0x${off.toString(16)}  VA=0x${(BigInt(off) + FILE_TO_VA).toString(16)}  ${tag}`);
        // Dump 128 bytes BEFORE and 256 bytes AFTER the occurrence.
        // The "before" tells us if there's instruction context (likely strcmp).
        const start = Math.max(0, off - 128);
        const end = Math.min(buf.length, off + name.length + 256);
        for (let row = start; row < end; row += 16) {
            const marker = (row <= off && off < row + 16) ? ' <-- name here' : '';
            lines.push(`  0x${row.toString(16).padStart(8, '0')}  ${hexLine(row, 16)}${marker}`);
        }

        // For non-canonical occurrences, scan AFTER the string for
        // `lea rXX, [rip+disp32]` and `mov rYY, imm32` patterns.
        if (oi > 0) {
            const scanStart = off + name.length;
            const scanEnd = Math.min(buf.length, scanStart + 256);
            const candidatePtrs: { offset: number, dispVA: bigint, dispFile?: number, head?: string }[] = [];
            for (let p = scanStart; p < scanEnd - 7; p++) {
                if (buf[p] === 0x48 && buf[p + 1] === 0x8D &&
                    (buf[p + 2] === 0x05 || buf[p + 2] === 0x0D || buf[p + 2] === 0x15 || buf[p + 2] === 0x35)) {
                    const disp = readS32LE(p + 3);
                    const rip = BigInt(p + 7);
                    const targetVA = BigInt.asUintN(64, rip + FILE_TO_VA + BigInt(disp));
                    const targetFile = vaToFile(targetVA);
                    const head = targetFile !== undefined ? tryReadAsciiBlob(targetFile, 128) : undefined;
                    candidatePtrs.push({ offset: p, dispVA: targetVA, dispFile: targetFile, head });
                }
            }
            if (candidatePtrs.length > 0) {
                lines.push('');
                lines.push(`  RIP-relative LEA targets within 256 bytes after name:`);
                for (const c of candidatePtrs) {
                    lines.push(`    @ +0x${(c.offset - off).toString(16)}: targetVA=0x${c.dispVA.toString(16)}${c.dispFile !== undefined ? ` (file 0x${c.dispFile.toString(16)})` : ''}${c.head ? `  head=${JSON.stringify(c.head.substring(0, 80))}` : ''}`);
                }
            }
        }
    }
    lines.push('');
}

writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${lines.length} lines to ${OUT}`);
