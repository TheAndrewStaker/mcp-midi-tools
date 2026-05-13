// extract-variant-resolver.ts
//
// Reads AM4-Edit.exe directly and extracts every per-variant
// (cache_id, parameterName) binding from the resolver tables that
// Ghidra found at FUN_1402e3da0 (Session 46 cont 4).
//
// Resolver dispatch (from Ghidra ghidra-resolver-tables.txt):
//   int FUN_1402e3da0(undefined8 ctx, int effectType, char** input)
//     switch(effectType) {
//       case  1: table = DAT_14141a9f0; break;
//       case  2: table = DAT_141420bc0; break;
//       ... (51 unique tables, plus a fallback)
//     }
//     // table walker:
//     while (table->cache_id != -1 && !found) {
//         if (table->parameterName && strcmp(table->parameterName, *input) == 0) {
//             return table->cache_id;
//         }
//         table = (Entry*)((char*)table + 16);
//     }
//     // also tries the global fallback at DAT_141420490
//
// Entry format (16 bytes):
//   +0  u32 cache_id           (-1 = end-of-table sentinel)
//   +4  u32 pad
//   +8  u64 parameterName_ptr  (VA into .rdata; null = skip)
//
// Output:
//   samples/captured/decoded/labels/variant-resolver.json
//     - Per-effectType list of (cache_id, parameterName) pairs.
//   src/protocol/variantResolverTables.ts
//     - Runtime-consumable per-effectType lookup table + helper.
//
// Run:
//   npx tsx scripts/extract-variant-resolver.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const EXE_PATH = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const OUT_JSON = 'samples/captured/decoded/labels/variant-resolver.json';
const OUT_TS   = 'src/fractal/am4/variantResolverTables.ts';

mkdirSync('samples/captured/decoded/labels', { recursive: true });

// ── Effect-type → table VA dispatch (verbatim from FUN_1402e3da0).
// Some effectTypes share a table (e.g., 0x29..0x2d all use DAT_14141e8a0).
// The "default" / 0x4 case uses the global fallback DAT_141420490.
const DISPATCH: Array<{ effectType: number | number[]; tableVA: number; note?: string }> = [
    { effectType: 1,    tableVA: 0x14141a9f0 },
    { effectType: 2,    tableVA: 0x141420bc0 },
    { effectType: 3,    tableVA: 0x14141ce60 },
    { effectType: 5,    tableVA: 0x141420980 },
    { effectType: 7,    tableVA: 0x14141fcd0 },
    { effectType: 8,    tableVA: 0x14141d900 },
    { effectType: 9,    tableVA: 0x14141b040 },
    { effectType: 10,   tableVA: 0x14141e930 },
    { effectType: 0xb,  tableVA: 0x14141a090 },
    { effectType: 0xc,  tableVA: 0x14141b200 },
    { effectType: 0xd,  tableVA: 0x14141f7c0 },
    { effectType: 0xe,  tableVA: 0x14141d000 },
    { effectType: 0xf,  tableVA: 0x14141ff10 },
    { effectType: 0x10, tableVA: 0x14141d720 },
    { effectType: 0x11, tableVA: 0x141421ec0 },
    { effectType: 0x12, tableVA: 0x14141e7b0 },
    { effectType: 0x13, tableVA: 0x14141e4f0 },
    { effectType: 0x14, tableVA: 0x14141e250 },
    { effectType: 0x15, tableVA: 0x14141a840 },
    { effectType: 0x16, tableVA: 0x141419f90 },
    { effectType: 0x17, tableVA: 0x14141d9e0 },
    { effectType: 0x18, tableVA: 0x141419d20 },
    { effectType: 0x19, tableVA: 0x141421c30 },
    { effectType: 0x1a, tableVA: 0x141421640 },
    { effectType: 0x1c, tableVA: 0x14141f6a0 },
    { effectType: 0x1d, tableVA: 0x14141fee0 },
    { effectType: 0x1e, tableVA: 0x141419f20 },
    { effectType: 0x1f, tableVA: 0x14141f230 },
    { effectType: 0x20, tableVA: 0x141420540 },
    { effectType: 0x21, tableVA: 0x14141cca0 },
    { effectType: 0x22, tableVA: 0x141421540 },
    { effectType: 0x23, tableVA: 0x14141a5f0 },
    { effectType: 0x24, tableVA: 0x141420b50 },
    { effectType: 0x25, tableVA: 0x14141f470 },
    { effectType: 0x26, tableVA: 0x14141c980 },
    { effectType: 0x27, tableVA: 0x1414211e0 },
    { effectType: 0x28, tableVA: 0x14141a920 },
    { effectType: [0x29, 0x2a, 0x2b, 0x2c, 0x2d], tableVA: 0x14141e8a0 },
    { effectType: [0x2e, 0x2f, 0x30, 0x31],       tableVA: 0x141421410 },
    { effectType: 0x32, tableVA: 0x1414209c0 },
    { effectType: 0x33, tableVA: 0x14141a6d0 },
    { effectType: 0x34, tableVA: 0x14141d890 },
    { effectType: 0x35, tableVA: 0x14141c920 },
    { effectType: 0x36, tableVA: 0x14141a8a0 },
    { effectType: 0x37, tableVA: 0x14141e3a0 },
    { effectType: 0x38, tableVA: 0x14141c910 },
    { effectType: 0x39, tableVA: 0x14141a9e0 },
    { effectType: 0x3a, tableVA: 0x14141b030 },
    { effectType: 0x3b, tableVA: 0x14141e6c0 },
    { effectType: 0x3c, tableVA: 0x1414216d0 },
];

const FALLBACK_TABLE_VA = 0x141420490;

// ── PE parser: VA → file offset ───────────────────────────────────
//
// PE/COFF image base for AM4-Edit.exe is 0x140000000 (per Ghidra's
// imageBase = 140000000 in the existing dumps). To convert a VA into
// a file offset we parse the section table and find which section
// the VA falls in.

interface PeSection {
    name: string;
    virtualAddress: number;   // RVA (relative to image base)
    virtualSize: number;
    pointerToRawData: number;
    sizeOfRawData: number;
}

interface PeImage {
    imageBase: bigint;
    sections: PeSection[];
}

function parsePe(buf: Buffer): PeImage {
    if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE (no MZ)');
    const peOffset = buf.readUInt32LE(0x3c);
    if (buf.readUInt32LE(peOffset) !== 0x00004550) throw new Error('not a PE (no PE\\0\\0)');

    const fileHeader = peOffset + 4;
    const numSections = buf.readUInt16LE(fileHeader + 2);
    const sizeOfOptional = buf.readUInt16LE(fileHeader + 16);
    const optHeader = fileHeader + 20;

    const optMagic = buf.readUInt16LE(optHeader);
    if (optMagic !== 0x20b) throw new Error(`unexpected OptionalHeader magic 0x${optMagic.toString(16)} (expected PE32+ 0x20b)`);
    const imageBase = buf.readBigUInt64LE(optHeader + 24);

    const sectionTable = optHeader + sizeOfOptional;
    const sections: PeSection[] = [];
    for (let i = 0; i < numSections; i++) {
        const base = sectionTable + i * 40;
        sections.push({
            name: buf.toString('latin1', base, base + 8).replace(/\0+$/, ''),
            virtualSize:      buf.readUInt32LE(base + 8),
            virtualAddress:   buf.readUInt32LE(base + 12),
            sizeOfRawData:    buf.readUInt32LE(base + 16),
            pointerToRawData: buf.readUInt32LE(base + 20),
        });
    }
    return { imageBase, sections };
}

function vaToFileOffset(pe: PeImage, va: number | bigint): number {
    const vaB = typeof va === 'bigint' ? va : BigInt(va);
    const rva = Number(vaB - pe.imageBase);
    for (const s of pe.sections) {
        if (rva >= s.virtualAddress && rva < s.virtualAddress + s.virtualSize) {
            return s.pointerToRawData + (rva - s.virtualAddress);
        }
    }
    throw new Error(`VA 0x${vaB.toString(16)} (RVA 0x${rva.toString(16)}) not in any section`);
}

function readCString(buf: Buffer, offset: number, max = 256): string {
    const end = Math.min(buf.length, offset + max);
    let i = offset;
    while (i < end && buf[i] !== 0) i++;
    return buf.toString('latin1', offset, i);
}

// ── Walk one resolver table ───────────────────────────────────────

interface ResolverEntry {
    cache_id: number;
    parameterName: string;
}

function walkTable(buf: Buffer, pe: PeImage, tableVA: number): ResolverEntry[] {
    const start = vaToFileOffset(pe, tableVA);
    const out: ResolverEntry[] = [];
    let off = start;
    while (off + 16 <= buf.length) {
        const cache_id = buf.readInt32LE(off);
        if (cache_id === -1) break;
        const ptr = buf.readBigUInt64LE(off + 8);
        if (ptr !== 0n) {
            const strFileOff = vaToFileOffset(pe, ptr);
            const name = readCString(buf, strFileOff, 128);
            out.push({ cache_id, parameterName: name });
        }
        off += 16;
        if (out.length > 1024) {
            throw new Error(`table at VA 0x${tableVA.toString(16)} ran off (no terminator?)`);
        }
    }
    return out;
}

// ── Block-name inference from parameterName prefix ────────────────
//
// Maps the prefix of a parameterName (DISTORT_, FUZZ_, etc.) to our
// internal block name (amp, drive, etc.). Same mapping
// scripts/extract-symbolic-ids.ts uses.
const PREFIX_TO_BLOCK: Record<string, string> = {
    DISTORT: 'amp',
    CABINET: 'amp',
    FUZZ: 'drive',
    REVERB: 'reverb',
    DELAY: 'delay',
    CHORUS: 'chorus',
    FLANGER: 'flanger',
    PHASER: 'phaser',
    WAH: 'wah',
    COMP: 'compressor',
    TREMOLO: 'tremolo',
    FILTER: 'filter',
    GATE: 'gate',
    VOLUME: 'volpan',
    ENHANCER: 'enhancer',
    ROTARY: 'rotary',
    GEQ: 'geq',
    PEQ: 'peq',
    BLOCK: '<universal>',  // BLOCK_PAN, BLOCK_MIX, BLOCK_LEVEL — apply to every block
    OUTPUT: 'output',
    INPUT: 'input',
    GLOBAL: 'global',
    LOOPER: 'looper',
    IRPLAYER: 'irplayer',
    MULTITAP: 'delay',     // Multi-tap delay
    PLEX: 'delay',         // Plex delay
    MEGATAP: 'megatap',
    PATCH: '<patch>',
    CROSSOVER: 'crossover',
};

function inferBlock(parameterName: string): string {
    const m = parameterName.match(/^([A-Z]+)_/);
    if (!m) return '<unknown>';
    return PREFIX_TO_BLOCK[m[1]] ?? `<unknown:${m[1].toLowerCase()}>`;
}

// ── Main ──────────────────────────────────────────────────────────

const buf = readFileSync(EXE_PATH);
const pe = parsePe(buf);

console.log(`PE imageBase: 0x${pe.imageBase.toString(16)}`);
console.log(`sections:`);
for (const s of pe.sections) {
    console.log(`  ${s.name.padEnd(8)}  VA=0x${s.virtualAddress.toString(16).padStart(8, '0')}  size=${s.virtualSize.toString(16).padStart(7)}  fileOff=${s.pointerToRawData.toString(16).padStart(7)}`);
}

interface VariantResolver {
    effectType: number;
    tableVA: number;
    entries: ResolverEntry[];
}

const resolvers: VariantResolver[] = [];
for (const d of DISPATCH) {
    const ets = Array.isArray(d.effectType) ? d.effectType : [d.effectType];
    const entries = walkTable(buf, pe, d.tableVA);
    for (const et of ets) {
        resolvers.push({ effectType: et, tableVA: d.tableVA, entries });
    }
}
const fallbackEntries = walkTable(buf, pe, FALLBACK_TABLE_VA);

// Stats
const totalUniqueTables = DISPATCH.length;
const totalEntries = resolvers.reduce((acc, r) => acc + r.entries.length, 0);
const fallbackCount = fallbackEntries.length;
console.log(`\nDispatch tables walked: ${totalUniqueTables}`);
console.log(`Total per-effectType entries: ${totalEntries}  (${resolvers.length} effectType bindings, some sharing tables)`);
console.log(`Fallback table entries: ${fallbackCount}`);

// Group by inferred block.
const byBlock: Record<string, Map<number, Set<string>>> = {};   // block → cache_id → parameterNames
function add(block: string, cache_id: number, paramName: string) {
    if (!byBlock[block]) byBlock[block] = new Map();
    if (!byBlock[block].has(cache_id)) byBlock[block].set(cache_id, new Set());
    byBlock[block].get(cache_id)!.add(paramName);
}

for (const r of resolvers) {
    for (const e of r.entries) {
        if (e.parameterName.startsWith('BLOCK_')) {
            // Universal block-level params show up in every variant. Don't
            // count them as a single block; we'll surface them separately.
            continue;
        }
        const block = inferBlock(e.parameterName);
        add(block, e.cache_id, e.parameterName);
    }
}
for (const e of fallbackEntries) {
    if (e.parameterName.startsWith('BLOCK_')) continue;
    const block = inferBlock(e.parameterName);
    add(block, e.cache_id, e.parameterName);
}

console.log('\n## Per-block coverage');
console.log('block         unique-cache-ids  unique-paramNames');
console.log('------------  ----------------  -----------------');
for (const [block, m] of Object.entries(byBlock).sort((a, b) => b[1].size - a[1].size)) {
    let totalNames = 0;
    for (const set of m.values()) totalNames += set.size;
    console.log(`${block.padEnd(13)}  ${String(m.size).padStart(16)}  ${String(totalNames).padStart(17)}`);
}

// Universal BLOCK_* entries.
const blockUniversal: Map<number, Set<string>> = new Map();
for (const r of resolvers) {
    for (const e of r.entries) {
        if (!e.parameterName.startsWith('BLOCK_')) continue;
        if (!blockUniversal.has(e.cache_id)) blockUniversal.set(e.cache_id, new Set());
        blockUniversal.get(e.cache_id)!.add(e.parameterName);
    }
}
console.log('\n## Universal BLOCK_* bindings (apply to every block):');
for (const [cid, names] of [...blockUniversal.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  cache_id=${cid}  ${[...names].join(', ')}`);
}

// ── Write JSON ────────────────────────────────────────────────────

writeFileSync(OUT_JSON, JSON.stringify({
    firmwareSource: 'AM4-Edit.exe (Mar 20 2026 build)',
    extractedAt: new Date().toISOString(),
    note: 'Per-variant cache_id ↔ parameterName bindings extracted from FUN_1402e3da0 dispatch tables in AM4-Edit.exe.',
    resolvers: resolvers.map(r => ({
        effectType: r.effectType,
        tableVA: '0x' + r.tableVA.toString(16),
        entryCount: r.entries.length,
        entries: r.entries,
    })),
    fallback: {
        tableVA: '0x' + FALLBACK_TABLE_VA.toString(16),
        entryCount: fallbackEntries.length,
        entries: fallbackEntries,
    },
    byBlock: Object.fromEntries(
        Object.entries(byBlock).map(([block, m]) => [
            block,
            Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]).map(([cid, names]) => [cid, [...names]])),
        ]),
    ),
    universalBlockEntries: Object.fromEntries(
        [...blockUniversal.entries()].sort((a, b) => a[0] - b[0]).map(([cid, names]) => [cid, [...names]]),
    ),
}, null, 2));
console.log(`\nWrote ${OUT_JSON}`);

// ── Write src/protocol/variantResolverTables.ts ───────────────────

const tsLines: string[] = [];
tsLines.push('/**');
tsLines.push(' * Per-variant resolver tables extracted from AM4-Edit.exe via');
tsLines.push(' * scripts/extract-variant-resolver.ts. The XML loader\'s vtable-call');
tsLines.push(' * resolver (FUN_1402e3da0) dispatches to one of these tables per');
tsLines.push(' * effectType to translate parameterName -> cache_id.');
tsLines.push(' *');
tsLines.push(' * For our agent: this is the missing link that lets us bind any XML');
tsLines.push(' * parameterName to its wire address (cache_id) given a known block.');
tsLines.push(' *');
tsLines.push(' * AUTO-GENERATED. Do not hand-edit.');
tsLines.push(' */');
tsLines.push('');
tsLines.push('export interface ResolverEntry {');
tsLines.push('    readonly cache_id: number;');
tsLines.push('    readonly parameterName: string;');
tsLines.push('}');
tsLines.push('');
tsLines.push(`export const VARIANT_RESOLVER_FIRMWARE = 'AM4-Edit Mar 20 2026 build';`);
tsLines.push('');

// Per-effectType (one entry per shared table; effectTypes that share a table
// get the same array reference).
tsLines.push('/** Per-effectType resolver tables. Multiple effectTypes may share a table. */');
tsLines.push('export const VARIANT_RESOLVER_BY_EFFECT_TYPE: Readonly<Record<number, readonly ResolverEntry[]>> = {');
for (const r of resolvers) {
    tsLines.push(`    ${r.effectType}: [`);
    for (const e of r.entries) {
        tsLines.push(`        { cache_id: ${e.cache_id}, parameterName: ${JSON.stringify(e.parameterName)} },`);
    }
    tsLines.push('    ],');
}
tsLines.push('};');
tsLines.push('');

tsLines.push('/** Fallback table consulted when an effectType lookup fails. */');
tsLines.push('export const VARIANT_RESOLVER_FALLBACK: readonly ResolverEntry[] = [');
for (const e of fallbackEntries) {
    tsLines.push(`    { cache_id: ${e.cache_id}, parameterName: ${JSON.stringify(e.parameterName)} },`);
}
tsLines.push('];');
tsLines.push('');

// Per-block consolidated bindings.
tsLines.push('/**');
tsLines.push(' * Per-block consolidated parameterName -> cache_id bindings.');
tsLines.push(' *');
tsLines.push(' * Built by walking every variant\'s table and grouping entries by the');
tsLines.push(' * parameterName prefix (DISTORT_ -> amp, FUZZ_ -> drive, etc.). For');
tsLines.push(' * any (block, parameterName), this gives the canonical cache_id without');
tsLines.push(' * needing to know the variant id.');
tsLines.push(' *');
tsLines.push(' * If multiple variants disagree on the cache_id for the same parameterName,');
tsLines.push(' * all candidate cache_ids are listed (the variant resolver picks one at');
tsLines.push(' * runtime; without variant context we surface the ambiguity).');
tsLines.push(' */');
tsLines.push('export const PARAMETER_NAME_TO_CACHE_ID: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {');
for (const [block, m] of Object.entries(byBlock).sort()) {
    if (block.startsWith('<')) continue;  // skip <unknown>, <patch>, etc.
    // Reverse the map: paramName → cache_ids
    const byParam: Map<string, Set<number>> = new Map();
    for (const [cid, names] of m.entries()) {
        for (const name of names) {
            if (!byParam.has(name)) byParam.set(name, new Set());
            byParam.get(name)!.add(cid);
        }
    }
    tsLines.push(`    ${block}: {`);
    for (const [name, cids] of [...byParam.entries()].sort()) {
        tsLines.push(`        ${JSON.stringify(name)}: [${[...cids].sort((a, b) => a - b).join(', ')}],`);
    }
    tsLines.push('    },');
}
tsLines.push('};');
tsLines.push('');

tsLines.push('/**');
tsLines.push(' * Universal BLOCK_* parameterNames (BLOCK_PAN, BLOCK_MIX, BLOCK_LEVEL,');
tsLines.push(' * BLOCK_BYPASS, BLOCK_BYPASSMODE, etc.) — apply to every block.');
tsLines.push(' * Each block exposes these at the same cache_id.');
tsLines.push(' */');
tsLines.push('export const UNIVERSAL_BLOCK_PARAMETERS: Readonly<Record<string, number>> = {');
const universalSorted = [...blockUniversal.entries()].sort((a, b) => a[0] - b[0]);
for (const [cid, names] of universalSorted) {
    for (const name of [...names].sort()) {
        tsLines.push(`    ${JSON.stringify(name)}: ${cid},`);
    }
}
tsLines.push('};');
tsLines.push('');

tsLines.push('/**');
tsLines.push(' * Resolve a (block, parameterName) pair to a cache_id, preferring the');
tsLines.push(' * unambiguous case. Returns:');
tsLines.push(' *   - undefined if not found');
tsLines.push(' *   - the single cache_id if exactly one variant binds it');
tsLines.push(' *   - the first cache_id if multiple variants disagree (caller may want');
tsLines.push(' *     to call resolveAllCacheIds for the full ambiguity set).');
tsLines.push(' */');
tsLines.push('export function resolveCacheId(block: string, parameterName: string): number | undefined {');
tsLines.push('    if (UNIVERSAL_BLOCK_PARAMETERS[parameterName] !== undefined) {');
tsLines.push('        return UNIVERSAL_BLOCK_PARAMETERS[parameterName];');
tsLines.push('    }');
tsLines.push('    const cids = PARAMETER_NAME_TO_CACHE_ID[block]?.[parameterName];');
tsLines.push('    return cids && cids.length > 0 ? cids[0] : undefined;');
tsLines.push('}');
tsLines.push('');

tsLines.push('/** Same as resolveCacheId but returns every variant\'s cache_id (may be > 1). */');
tsLines.push('export function resolveAllCacheIds(block: string, parameterName: string): readonly number[] {');
tsLines.push('    if (UNIVERSAL_BLOCK_PARAMETERS[parameterName] !== undefined) {');
tsLines.push('        return [UNIVERSAL_BLOCK_PARAMETERS[parameterName]];');
tsLines.push('    }');
tsLines.push('    return PARAMETER_NAME_TO_CACHE_ID[block]?.[parameterName] ?? [];');
tsLines.push('}');
tsLines.push('');

writeFileSync(OUT_TS, tsLines.join('\n'));
console.log(`Wrote ${OUT_TS}  (${resolvers.length} variant tables, ${Object.keys(byBlock).length} blocks)`);
