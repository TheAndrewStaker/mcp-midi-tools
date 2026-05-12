// report-resolver-vs-paramnames.ts
//
// Diff the variant resolver (extracted from AM4-Edit.exe — firmware
// truth) against the hand-curated PARAM_NAMES (likely contains errors
// from messy hardware captures). Categorises every (block, cache_id):
//
//   AGREE     hand-curated and resolver point at the same parameterName
//             family (i.e., the hand name's display label matches the
//             resolver's parameterName via EDITOR_CONTROLS).
//   DISAGREE  hand-curated and resolver disagree on parameterName.
//             Resolver is firmware truth; hand-curation is wrong.
//   ORPHAN    hand-curated entry exists but resolver doesn't bind any
//             parameterName at this cache_id for any variant.
//   MISSING   resolver knows a parameterName at this cache_id but no
//             hand-curated entry exists yet.
//
// Output:
//   samples/captured/decoded/labels/resolver-vs-paramnames.{json,md}
//
// Used to plan the resolver-driven paramNames.ts refactor.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PARAM_NAMES, type ParamNameEntry } from '@/fractal/am4/paramNames.js';
import { EDITOR_CONTROLS } from '@/fractal/am4/editorControlLabels.js';
import { PARAMETER_NAME_TO_CACHE_ID } from '@/fractal/am4/variantResolverTables.js';

const OUT_JSON = 'samples/captured/decoded/labels/resolver-vs-paramnames.json';
const OUT_MD   = 'samples/captured/decoded/labels/resolver-vs-paramnames.md';
mkdirSync('samples/captured/decoded/labels', { recursive: true });

function getName(e: ParamNameEntry): string {
    return typeof e === 'string' ? e : e.name;
}

function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

interface CategoryEntry {
    block: string;
    cacheId: number;
    handName?: string;
    resolverParameterNames?: string[];   // all variants binding this cache_id
    canonicalLabels?: string[];          // EDITOR_CONTROLS labels for the parameterNames
    note?: string;
}

const agree:    CategoryEntry[] = [];
const disagree: CategoryEntry[] = [];
const orphan:   CategoryEntry[] = [];
const missing:  CategoryEntry[] = [];

// Build reverse index: per-block, cache_id → parameterNames (any variant).
const reverseByBlock: Record<string, Map<number, Set<string>>> = {};
for (const [block, paramMap] of Object.entries(PARAMETER_NAME_TO_CACHE_ID)) {
    if (!reverseByBlock[block]) reverseByBlock[block] = new Map();
    for (const [paramName, cids] of Object.entries(paramMap)) {
        for (const cid of cids) {
            if (!reverseByBlock[block].has(cid)) reverseByBlock[block].set(cid, new Set());
            reverseByBlock[block].get(cid)!.add(paramName);
        }
    }
}

// Walk every hand-curated entry; categorise.
for (const [pBlock, entries] of Object.entries(PARAM_NAMES)) {
    const resolverForBlock = reverseByBlock[pBlock] ?? new Map();
    for (const [cidStr, entry] of Object.entries(entries)) {
        const cid = Number(cidStr);
        const handName = getName(entry);
        const resolverNames = resolverForBlock.get(cid);

        if (!resolverNames) {
            orphan.push({ block: pBlock, cacheId: cid, handName });
            continue;
        }

        // Get canonical labels for the resolver's parameterNames at this cache_id.
        const labels = [...resolverNames].map(n => EDITOR_CONTROLS[n]?.canonicalLabel ?? n);
        const normalizedHand = normalize(handName);
        const matchedAny = labels.some(l => normalize(l) === normalizedHand);

        if (matchedAny) {
            agree.push({
                block: pBlock, cacheId: cid, handName,
                resolverParameterNames: [...resolverNames],
                canonicalLabels: labels,
            });
        } else {
            disagree.push({
                block: pBlock, cacheId: cid, handName,
                resolverParameterNames: [...resolverNames],
                canonicalLabels: labels,
                note: `hand="${handName}" vs resolver=[${labels.join(', ')}]`,
            });
        }
    }
}

// Walk every resolver entry; mark MISSING where no hand-curated entry exists.
for (const [block, m] of Object.entries(reverseByBlock)) {
    const handForBlock = (PARAM_NAMES as Record<string, Record<number, ParamNameEntry>>)[block] ?? {};
    for (const [cid, paramNames] of m.entries()) {
        if (handForBlock[cid] !== undefined) continue;  // covered above
        const labels = [...paramNames].map(n => EDITOR_CONTROLS[n]?.canonicalLabel ?? n);
        missing.push({
            block, cacheId: cid,
            resolverParameterNames: [...paramNames],
            canonicalLabels: labels,
        });
    }
}

// Per-block summary.
const perBlock: Record<string, { agree: number; disagree: number; orphan: number; missing: number; total: number }> = {};
function bump(b: string, k: 'agree' | 'disagree' | 'orphan' | 'missing') {
    if (!perBlock[b]) perBlock[b] = { agree: 0, disagree: 0, orphan: 0, missing: 0, total: 0 };
    perBlock[b][k]++;
    perBlock[b].total++;
}
for (const e of agree)    bump(e.block, 'agree');
for (const e of disagree) bump(e.block, 'disagree');
for (const e of orphan)   bump(e.block, 'orphan');
for (const e of missing)  bump(e.block, 'missing');

console.log('## Diff: resolver vs paramNames\n');
console.log(`agree:    ${agree.length}`);
console.log(`disagree: ${disagree.length}`);
console.log(`orphan:   ${orphan.length}    (hand-name has no resolver binding)`);
console.log(`missing:  ${missing.length}   (resolver knows; no hand name)`);

console.log('\n## Per-block:');
console.log('block         agree  disagree  orphan  missing');
console.log('------------  -----  --------  ------  -------');
for (const [b, s] of Object.entries(perBlock).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${b.padEnd(13)}  ${String(s.agree).padStart(5)}  ${String(s.disagree).padStart(8)}  ${String(s.orphan).padStart(6)}  ${String(s.missing).padStart(7)}`);
}

writeFileSync(OUT_JSON, JSON.stringify({
    summary: {
        agree: agree.length, disagree: disagree.length,
        orphan: orphan.length, missing: missing.length,
    },
    perBlock,
    agree, disagree, orphan, missing,
}, null, 2));
console.log(`\nWrote ${OUT_JSON}`);

const md: string[] = [];
md.push('# Resolver vs paramNames diff');
md.push('');
md.push('Variant resolver (firmware-truth, extracted from AM4-Edit.exe) vs');
md.push('hand-curated `PARAM_NAMES` (built from messy hardware captures).');
md.push('');
md.push('## Summary');
md.push('');
md.push(`- **AGREE:** ${agree.length} — hand and resolver agree on parameterName family at this cache_id`);
md.push(`- **DISAGREE:** ${disagree.length} — hand-curated entry points at the wrong cache_id (resolver authoritative)`);
md.push(`- **ORPHAN:** ${orphan.length} — hand-curated entry exists but resolver doesn't bind anything at this cache_id`);
md.push(`- **MISSING:** ${missing.length} — resolver knows a parameterName here, no hand-curation yet`);
md.push('');

md.push('## Per-block coverage');
md.push('');
md.push('| block | agree | disagree | orphan | missing |');
md.push('|---|---:|---:|---:|---:|');
for (const [b, s] of Object.entries(perBlock).sort((a, b) => b[1].total - a[1].total)) {
    md.push(`| ${b} | ${s.agree} | ${s.disagree} | ${s.orphan} | ${s.missing} |`);
}
md.push('');

md.push('## DISAGREE entries (the corrections needed)');
md.push('');
md.push('| block | cache_id | hand name | resolver parameterName(s) | XML label(s) |');
md.push('|---|---:|---|---|---|');
for (const e of disagree.slice(0, 80)) {
    md.push(`| ${e.block} | ${e.cacheId} | \`${e.handName}\` | ${(e.resolverParameterNames ?? []).map(n => `\`${n}\``).join(', ')} | ${(e.canonicalLabels ?? []).join(', ')} |`);
}
if (disagree.length > 80) md.push(`\n... ${disagree.length - 80} more disagreements`);
md.push('');

md.push('## ORPHAN entries (hand-curated but no resolver binding)');
md.push('');
md.push('| block | cache_id | hand name |');
md.push('|---|---:|---|');
for (const e of orphan.slice(0, 50)) {
    md.push(`| ${e.block} | ${e.cacheId} | \`${e.handName}\` |`);
}
if (orphan.length > 50) md.push(`\n... ${orphan.length - 50} more orphans`);
md.push('');

md.push('## MISSING — resolver knows, no hand name yet (top per block, first 100)');
md.push('');
md.push('| block | cache_id | resolver parameterName(s) | XML label(s) |');
md.push('|---|---:|---|---|');
for (const e of missing.slice(0, 100)) {
    md.push(`| ${e.block} | ${e.cacheId} | ${(e.resolverParameterNames ?? []).map(n => `\`${n}\``).join(', ')} | ${(e.canonicalLabels ?? []).join(', ')} |`);
}
if (missing.length > 100) md.push(`\n... ${missing.length - 100} more missing`);

writeFileSync(OUT_MD, md.join('\n'));
console.log(`Wrote ${OUT_MD}`);
