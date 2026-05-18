// probe-positional-binding.ts
//
// For each block, score how well the XML parameterName first-occurrence
// order matches the cache record-id order at the existing
// PARAMETER_BRIDGE anchor points. If anchors stay monotonic when sorted
// by XML position, positional alignment is viable for that block: between
// two anchors, the unbound XML parameterNames can be assigned cache ids
// by interpolation.
//
// Inputs (no fresh captures needed):
//   - samples/captured/decoded/cache-section2.json
//   - samples/captured/decoded/cache-section3.json
//   - samples/captured/decoded/labels/editor-controls.json
//   - src/protocol/parameterBridge.ts (PARAMETER_BRIDGE)
//   - src/protocol/paramNames.ts      (PARAM_NAMES, for cache-id lookup)
//
// Output:
//   samples/captured/decoded/labels/positional-probe.json
//   samples/captured/decoded/labels/positional-probe.md
//
// What we DO here: score, not assign. A green score per block is the
// signal to follow up with an alignment-and-emit pass.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PARAM_NAMES, type ParamNameEntry } from 'fractal-midi/am4';
import { PARAMETER_BRIDGE } from 'fractal-midi/am4';

interface CacheRec {
    block: number;
    id: number | null;
    kind: 'float' | 'enum' | 'blockHeader';
    typecode?: number;
    a?: number; b?: number; c?: number;
    values?: string[];
}

interface XmlEntry {
    label: string;
    parameterName: string;
    block: string;          // XML block name
    variant: string;
    page: string;
    pageLayer: string;
}

const s2: CacheRec[] = JSON.parse(
    readFileSync('samples/captured/decoded/cache-section2.json', 'utf8'),
);
const s3raw = JSON.parse(
    readFileSync('samples/captured/decoded/cache-section3.json', 'utf8'),
);
const s3: CacheRec[] = s3raw.records;
const xmlAll: XmlEntry[] = JSON.parse(
    readFileSync('samples/captured/decoded/labels/editor-controls.json', 'utf8'),
).entries;

// Cache-section + cache-block per logical block name. Sourced from
// scripts/extract-symbolic-ids.ts BLOCKS table.
const CACHE_SOURCE: Record<string, { section: 'S2' | 'S3'; block: number }> = {
    amp:        { section: 'S2', block: 5  },
    drive:      { section: 'S3', block: 9  },
    reverb:     { section: 'S3', block: 0  },
    delay:      { section: 'S3', block: 1  },
    chorus:     { section: 'S3', block: 2  },
    flanger:    { section: 'S3', block: 3  },
    phaser:     { section: 'S3', block: 5  },
    wah:        { section: 'S3', block: 6  },
    compressor: { section: 'S2', block: 2  },
    geq:        { section: 'S2', block: 3  },
    filter:     { section: 'S3', block: 8  },
    tremolo:    { section: 'S3', block: 7  },
    enhancer:   { section: 'S3', block: 10 },
    gate:       { section: 'S3', block: 11 },
    volpan:     { section: 'S3', block: 12 },
    peq:        { section: 'S2', block: 4  },
    rotary:     { section: 'S3', block: 4  },
};

// XML block → logical block name. Inverse of BLOCK_TO_XML in
// scripts/bridge-paramnames-to-xml.ts.
const XML_TO_BLOCK: Record<string, string> = {
    Amp: 'amp',
    Drive: 'drive',
    Reverb: 'reverb',
    Delay: 'delay',
    Chorus: 'chorus',
    Flanger: 'flanger',
    Phaser: 'phaser',
    Wah: 'wah',
    ParametricEQ: 'peq',
    Rotary: 'rotary',
    Compressor: 'compressor',
    GraphicEQ: 'geq',
    Filter: 'filter',
    Tremolo: 'tremolo',
    Enhancer: 'enhancer',
    GateExpander: 'gate',
    VolPan: 'volpan',
};

function cacheRecsFor(block: string): CacheRec[] {
    const cs = CACHE_SOURCE[block];
    if (!cs) return [];
    const src = cs.section === 'S2' ? s2 : s3;
    return src
        .filter(r => r.block === cs.block && r.kind !== 'blockHeader' && typeof r.id === 'number')
        .sort((a, b) => (a.id! - b.id!));
}

function getName(entry: ParamNameEntry | undefined): string | undefined {
    if (!entry) return undefined;
    return typeof entry === 'string' ? entry : entry.name;
}

interface AnchorPoint {
    handName: string;
    parameterName: string;
    cacheId: number;
    cachePos: number;        // 0-based index in cacheRecs sorted by id
    xmlPos: number;          // 0-based index in first-occurrence XML sequence
}

interface BlockReport {
    block: string;
    cacheCount: number;
    xmlCount: number;
    anchorCount: number;
    monotonicAnchors: number;
    monotonicPct: number;
    minMaxXmlPos: [number, number] | null;
    minMaxCachePos: [number, number] | null;
    /** All anchor points (xml-pos sorted). */
    anchors: AnchorPoint[];
    /** XML parameterNames in first-occurrence order (block-scoped). */
    xmlSequence: string[];
    /** Cache record ids in order (block-scoped). */
    cacheIdSequence: number[];
    /** Anchor pairs that broke monotonicity (xmlPos > prev but cachePos <= prev cachePos). */
    inversions: Array<{ a: AnchorPoint; b: AnchorPoint; }>;
    /** Suggestion based on monotonicity score and counts. */
    verdict: 'green' | 'yellow' | 'red';
    note: string;
}

const reports: BlockReport[] = [];

for (const [block] of Object.entries(CACHE_SOURCE)) {
    const cacheRecs = cacheRecsFor(block);
    const cacheIdSequence = cacheRecs.map(r => r.id!);

    // XML parameterNames in first-occurrence order, block-scoped.
    const xmlBlockNames = Object.entries(XML_TO_BLOCK)
        .filter(([_, v]) => v === block)
        .map(([k]) => k);
    const xmlSubset = xmlAll.filter(e => xmlBlockNames.includes(e.block));
    const seen = new Set<string>();
    const xmlSequence: string[] = [];
    for (const e of xmlSubset) {
        if (seen.has(e.parameterName)) continue;
        seen.add(e.parameterName);
        xmlSequence.push(e.parameterName);
    }

    // Anchors from PARAMETER_BRIDGE × PARAM_NAMES.
    const bridgeForBlock = PARAMETER_BRIDGE[block] ?? {};
    const namesForBlock = (PARAM_NAMES as Record<string, Record<number, ParamNameEntry>>)[block] ?? {};

    // Build (handName -> cacheId) lookup from PARAM_NAMES.
    const handToCacheId: Map<string, number> = new Map();
    for (const [idStr, entry] of Object.entries(namesForBlock)) {
        const n = getName(entry);
        if (n) handToCacheId.set(n, Number(idStr));
    }

    const anchors: AnchorPoint[] = [];
    for (const [handName, b] of Object.entries(bridgeForBlock)) {
        const cacheId = handToCacheId.get(handName);
        if (cacheId === undefined) continue;
        const cachePos = cacheIdSequence.indexOf(cacheId);
        const xmlPos = xmlSequence.indexOf(b.parameterName);
        if (cachePos < 0 || xmlPos < 0) continue;
        anchors.push({
            handName, parameterName: b.parameterName,
            cacheId, cachePos, xmlPos,
        });
    }
    // Sort anchors by xmlPos for monotonicity check.
    anchors.sort((a, b) => a.xmlPos - b.xmlPos);

    let monotonic = 0;
    const inversions: Array<{ a: AnchorPoint; b: AnchorPoint; }> = [];
    for (let i = 1; i < anchors.length; i++) {
        const prev = anchors[i - 1];
        const cur  = anchors[i];
        if (cur.cachePos > prev.cachePos) {
            monotonic++;
        } else {
            inversions.push({ a: prev, b: cur });
        }
    }
    const totalPairs = Math.max(1, anchors.length - 1);
    const monoPct = anchors.length < 2 ? 1 : monotonic / totalPairs;

    const xmlPosRange: [number, number] | null = anchors.length
        ? [anchors[0].xmlPos, anchors[anchors.length - 1].xmlPos] : null;
    const cachePosRange: [number, number] | null = anchors.length
        ? [Math.min(...anchors.map(a => a.cachePos)),
           Math.max(...anchors.map(a => a.cachePos))]
        : null;

    let verdict: BlockReport['verdict'];
    let note: string;
    if (anchors.length < 3) {
        verdict = 'red';
        note = `Only ${anchors.length} anchors — too few to score positional alignment confidently.`;
    } else if (monoPct >= 0.9) {
        verdict = 'green';
        note = `${monotonic}/${totalPairs} anchor pairs monotonic (${(100 * monoPct).toFixed(0)}%). Positional alignment looks viable; safe to interpolate between anchors.`;
    } else if (monoPct >= 0.6) {
        verdict = 'yellow';
        note = `${monotonic}/${totalPairs} anchor pairs monotonic (${(100 * monoPct).toFixed(0)}%). Mostly positional with localized inversions; needs spot-check before bulk binding.`;
    } else {
        verdict = 'red';
        note = `${monotonic}/${totalPairs} anchor pairs monotonic (${(100 * monoPct).toFixed(0)}%). Order is shuffled; positional alignment will not work for this block.`;
    }

    reports.push({
        block,
        cacheCount: cacheRecs.length,
        xmlCount: xmlSequence.length,
        anchorCount: anchors.length,
        monotonicAnchors: monotonic,
        monotonicPct: monoPct,
        minMaxXmlPos: xmlPosRange,
        minMaxCachePos: cachePosRange,
        anchors,
        xmlSequence,
        cacheIdSequence,
        inversions,
        verdict,
        note,
    });
}

// Console summary
console.log('=== Positional alignment probe ===\n');
console.log('block        cache  xml   anchors  monotonic   verdict');
console.log('-----------  -----  ----  -------  ----------  -------');
for (const r of reports) {
    console.log(
        r.block.padEnd(11) + '  ' +
        String(r.cacheCount).padStart(5) + '  ' +
        String(r.xmlCount).padStart(4)  + '  ' +
        String(r.anchorCount).padStart(7) + '  ' +
        `${r.monotonicAnchors}/${Math.max(1, r.anchorCount - 1)}`.padStart(10) + '  ' +
        r.verdict,
    );
}
console.log();
const greens = reports.filter(r => r.verdict === 'green').map(r => r.block);
const yellows = reports.filter(r => r.verdict === 'yellow').map(r => r.block);
const reds = reports.filter(r => r.verdict === 'red').map(r => r.block);
console.log(`Greens (positional binding viable): ${greens.length} — ${greens.join(', ')}`);
console.log(`Yellows (mostly viable, needs check): ${yellows.length} — ${yellows.join(', ')}`);
console.log(`Reds (don't bother): ${reds.length} — ${reds.join(', ')}`);

// Output JSON + MD
mkdirSync('samples/captured/decoded/labels', { recursive: true });
writeFileSync(
    'samples/captured/decoded/labels/positional-probe.json',
    JSON.stringify(reports, null, 2),
);

const md: string[] = [];
md.push('# Positional binding probe — XML parameterNames ↔ cache record IDs');
md.push('');
md.push('For each block, the existing PARAMETER_BRIDGE anchors give us pairs of');
md.push('(xml-position, cache-position). If those pairs stay monotonic when sorted');
md.push('by xml-position, then positional alignment is viable: between two anchors,');
md.push('unbound XML parameterNames can be assigned cache ids by interpolation.');
md.push('');
md.push('## Summary');
md.push('');
md.push('| block | cache | xml | anchors | monotonic | verdict |');
md.push('|---|---:|---:|---:|---|---|');
for (const r of reports) {
    md.push(`| ${r.block} | ${r.cacheCount} | ${r.xmlCount} | ${r.anchorCount} | ${r.monotonicAnchors}/${Math.max(1, r.anchorCount - 1)} (${(100 * r.monotonicPct).toFixed(0)}%) | ${r.verdict} |`);
}
md.push('');
md.push('## Per-block detail');
md.push('');
for (const r of reports) {
    md.push(`### ${r.block} — ${r.verdict.toUpperCase()}`);
    md.push('');
    md.push(`> ${r.note}`);
    md.push('');
    md.push(`- cache records: **${r.cacheCount}**`);
    md.push(`- unique XML parameterNames: **${r.xmlCount}**`);
    md.push(`- anchors used: **${r.anchorCount}**`);
    if (r.minMaxXmlPos && r.minMaxCachePos) {
        md.push(`- xml-position range: ${r.minMaxXmlPos[0]}..${r.minMaxXmlPos[1]}`);
        md.push(`- cache-position range: ${r.minMaxCachePos[0]}..${r.minMaxCachePos[1]}`);
    }
    md.push('');
    if (r.anchors.length > 0) {
        md.push('Anchor (xml-pos, cache-pos, parameterName, hand-name) sorted by xml-pos:');
        md.push('');
        md.push('| xml-pos | cache-pos | cache id | parameterName | hand name |');
        md.push('|---:|---:|---:|---|---|');
        for (const a of r.anchors) {
            md.push(`| ${a.xmlPos} | ${a.cachePos} | ${a.cacheId} | \`${a.parameterName}\` | \`${a.handName}\` |`);
        }
        md.push('');
    }
    if (r.inversions.length > 0) {
        md.push(`Inversions (${r.inversions.length}):`);
        md.push('');
        for (const inv of r.inversions) {
            md.push(`- xml-pos ${inv.a.xmlPos} → ${inv.b.xmlPos}, but cache-pos ${inv.a.cachePos} ≥ ${inv.b.cachePos} (\`${inv.a.parameterName}\` → \`${inv.b.parameterName}\`)`);
        }
        md.push('');
    }
}

writeFileSync('samples/captured/decoded/labels/positional-probe.md', md.join('\n'));
console.log('\nWrote samples/captured/decoded/labels/positional-probe.json');
console.log('Wrote samples/captured/decoded/labels/positional-probe.md');
