// find-juce-xml-blobs.ts
//
// Brute-force scan AM4-Edit.exe for embedded XML payloads. JUCE's
// BinaryData with "Compress files" enabled uses gzip
// (GZIPCompressorOutputStream); without it, raw uncompressed.
// `find-zlib-blobs.ts` only triggered on zlib magic bytes (0x78 ...),
// which would miss gzip (0x1F 0x8B) and raw deflate (no magic).
//
// This script:
//   1. Tries gzip inflate at every offset in the file where the next
//      three bytes are `1F 8B 08` (gzip member signature). Cheap.
//   2. Tries raw deflate at every offset. More expensive — bounded by
//      a min-output-length filter to reject 99%+ of garbage.
//   3. For each successful inflate, checks if the output looks like
//      AM4 XML (contains `<EditorControl` or `<EffectParameter` or
//      `<PageLayout` or `<components`).
//   4. Reports the offset, compressed size, inflated size, and the
//      first 512 chars of the inflated output.
//
// Usage:
//   npx tsx scripts/find-juce-xml-blobs.ts [path-to-exe]
// Default exe: C:\Program Files\Fractal Audio\AM4-Edit\AM4-Edit.exe

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import zlib from 'node:zlib';

const exePath = process.argv[2] ?? 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const outPath = 'samples/captured/decoded/juce-xml-blobs.txt';
mkdirSync(dirname(outPath), { recursive: true });

const buf = readFileSync(exePath);
console.log(`exe: ${exePath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);

// XML markers we expect to find inflated content to contain.
const XML_MARKERS = [
    '<EditorControl', '<EffectParameter', '<EffectLayouts',
    '<PageLayout', '<components', '<EditorLayouts',
    '<?xml',
];

function looksLikeAm4Xml(s: string): boolean {
    return XML_MARKERS.some(m => s.includes(m));
}

interface Hit {
    offset: number;
    method: 'gzip' | 'deflate-raw' | 'zlib';
    compressedLen: number;
    inflatedLen: number;
    preview: string;
}

const hits: Hit[] = [];

function tryInflate(method: 'gzip' | 'deflate-raw' | 'zlib', offset: number, slice: Buffer): Hit | undefined {
    try {
        let out: Buffer;
        if (method === 'gzip')         out = zlib.gunzipSync(slice);
        else if (method === 'deflate-raw') out = zlib.inflateRawSync(slice);
        else                            out = zlib.inflateSync(slice);

        if (out.length < 32) return undefined; // junk
        const text = out.toString('utf8', 0, Math.min(out.length, 4096));
        // Cheap printability check: if first 512 bytes are mostly
        // non-printable, it's not text.
        const head = text.slice(0, 512);
        let printable = 0;
        for (let i = 0; i < head.length; i++) {
            const c = head.charCodeAt(i);
            if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) printable++;
        }
        if (printable / head.length < 0.7) return undefined;

        return {
            offset,
            method,
            compressedLen: slice.length,
            inflatedLen: out.length,
            preview: text.slice(0, 512),
        };
    } catch {
        return undefined;
    }
}

console.log('Phase 1: gzip scan (offsets where bytes match 1F 8B 08)...');
let gzipChecked = 0;
for (let i = 0; i + 10 < buf.length; i++) {
    if (buf[i] !== 0x1F || buf[i + 1] !== 0x8B || buf[i + 2] !== 0x08) continue;
    gzipChecked++;
    const slice = buf.subarray(i, Math.min(i + 8 * 1024 * 1024, buf.length));
    const hit = tryInflate('gzip', i, slice);
    if (hit) hits.push(hit);
}
console.log(`  gzip candidates inspected: ${gzipChecked}`);

console.log('Phase 2: zlib scan (offsets where bytes match 78 01/5E/9C/DA)...');
let zlibChecked = 0;
for (let i = 0; i + 10 < buf.length; i++) {
    if (buf[i] !== 0x78) continue;
    const second = buf[i + 1];
    if (second !== 0x01 && second !== 0x5E && second !== 0x9C && second !== 0xDA) continue;
    zlibChecked++;
    const slice = buf.subarray(i, Math.min(i + 8 * 1024 * 1024, buf.length));
    const hit = tryInflate('zlib', i, slice);
    if (hit) hits.push(hit);
}
console.log(`  zlib candidates inspected: ${zlibChecked}`);

// Phase 3 (raw deflate every offset) is expensive; skip unless
// phases 1+2 found nothing relevant.
const xmlHits = hits.filter(h => looksLikeAm4Xml(h.preview));
console.log(`\nXML-shaped hits across phases 1+2: ${xmlHits.length}`);

if (xmlHits.length === 0) {
    console.log('\nPhase 3: raw deflate scan (every offset, slow)...');
    let lastReport = Date.now();
    for (let i = 0; i < buf.length; i++) {
        if (Date.now() - lastReport > 5000) {
            console.log(`  ${(100 * i / buf.length).toFixed(1)}%  hits=${hits.length}`);
            lastReport = Date.now();
        }
        // Heuristic: raw deflate's first byte's low 3 bits are
        // {00,01,10}=block-type, with bit 0 indicating final block.
        // The first byte is widely varied. To bound cost, only try
        // raw deflate when the first byte looks plausible (bit 7
        // can be anything; bits 0-2 are 0x00..0x05 typically).
        const b = buf[i];
        if ((b & 0x06) > 0x04) continue;  // skip rare/invalid block types
        const slice = buf.subarray(i, Math.min(i + 4 * 1024 * 1024, buf.length));
        const hit = tryInflate('deflate-raw', i, slice);
        if (hit && looksLikeAm4Xml(hit.preview)) {
            hits.push(hit);
            console.log(`  HIT @ 0x${i.toString(16)}  inflated=${hit.inflatedLen}`);
        }
    }
}

// Final report
const finalXml = hits.filter(h => looksLikeAm4Xml(h.preview));
const lines: string[] = [];
lines.push(`# JUCE XML blob scan results`);
lines.push(`# exe: ${exePath}`);
lines.push(`# total hits (any inflate success): ${hits.length}`);
lines.push(`# XML-shaped hits: ${finalXml.length}`);
lines.push('');
for (const h of finalXml) {
    lines.push(`================================================================================`);
    lines.push(`offset       : 0x${h.offset.toString(16)}`);
    lines.push(`method       : ${h.method}`);
    lines.push(`compressedLen: ~${h.compressedLen}`);
    lines.push(`inflatedLen  : ${h.inflatedLen}`);
    lines.push(`preview (512 chars):`);
    lines.push(h.preview);
    lines.push('');
}
writeFileSync(outPath, lines.join('\n'));
console.log(`\nWrote ${lines.length} lines to ${outPath}`);
console.log(`XML hits: ${finalXml.length}`);
