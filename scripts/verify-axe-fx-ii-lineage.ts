/**
 * Regression — Axe-Fx II lineage extractor outputs match the BK-046 +
 * BK-047 fix expectations from Session 66 (2026-05-12).
 *
 * Guards against silent regression of:
 *   - BK-046 prose-inheritance filtering (inherited records should NOT
 *     carry mis-attributed description / fractalQuotes / artistNotes).
 *   - BK-047 part A — Recto Org variant matching via `org → orange`.
 *   - BK-047 part B — USA Mark series matching via `USA → USA MK`
 *     injection.
 *
 * Pure JSON read — runs in <50ms, no MIDI required. Wired into the
 * `npm test` chain so the next time someone touches
 * `scripts/extract-axe-fx-ii-lineage.ts`, the fixes don't silently
 * regress.
 *
 * If this fails, the most likely cause is: someone edited the
 * extractor's field-copy logic or ABBREVS table and forgot to re-run
 * `npm run extract-axe-fx-ii-lineage` (or did, but the change broke
 * one of the named records below).
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LINEAGE_DIR = path.join(ROOT, 'packages', 'core', 'src', 'fractal-shared', 'lineage');

interface AxeFxIIRecord {
    axefx2Name: string;
    wireIndex: number;
    matchVia: string;
    am4Name?: string;
    description?: string;
    fractalQuotes?: unknown[];
    artistNotes?: unknown[];
    family?: string;
    basedOn?: { manufacturer?: string; model?: string; productName?: string; primary?: string };
    flags: string[];
}

interface LineageJSON {
    _matched: number;
    _unmatched: number;
    _matchedVia: Record<string, number>;
    records: AxeFxIIRecord[];
}

function load(block: 'amp' | 'drive' | 'reverb' | 'delay'): LineageJSON {
    return JSON.parse(readFileSync(path.join(LINEAGE_DIR, `axefx2-${block}-lineage.json`), 'utf8'));
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
    if (!ok) {
        failures++;
        console.error(`  FAIL — ${label}${detail ? `: ${detail}` : ''}`);
    }
}

function findRecord(records: AxeFxIIRecord[], axefx2Name: string): AxeFxIIRecord | undefined {
    return records.find((r) => r.axefx2Name === axefx2Name);
}

console.log('Verifying Axe-Fx II lineage extractor outputs (BK-046 + BK-047 regression guard)…');

const amp = load('amp');

// ─── BK-047 part B — USA MK injection ─────────────────────────────────

const usaIICPlus = findRecord(amp.records, 'USA IIC+');
check('USA IIC+ exists', usaIICPlus !== undefined);
check(
    'USA IIC+ matched via USA-MK injection',
    usaIICPlus?.matchVia === 'abbrev-expand',
    `matchVia=${usaIICPlus?.matchVia}`,
);
check(
    'USA IIC+ resolves to USA MK IIC+ wiki record',
    usaIICPlus?.am4Name === 'USA MK IIC+',
    `am4Name=${usaIICPlus?.am4Name}`,
);

const usaIICPlusPlus = findRecord(amp.records, 'USA IIC++');
check('USA IIC++ exists', usaIICPlusPlus !== undefined);
check(
    'USA IIC++ resolves to USA MK IIC++ wiki record',
    usaIICPlusPlus?.am4Name === 'USA MK IIC++',
    `am4Name=${usaIICPlusPlus?.am4Name}`,
);

// ─── BK-047 part A — Recto Org variants ────────────────────────────────

const recto1OrgMdrn = findRecord(amp.records, 'RECTO1 ORG MDRN');
check('RECTO1 ORG MDRN exists', recto1OrgMdrn !== undefined);
check(
    'RECTO1 ORG MDRN matches Recto1 Orange Modern (org → orange)',
    recto1OrgMdrn?.am4Name === 'Recto1 Orange Modern',
    `am4Name=${recto1OrgMdrn?.am4Name}`,
);

const recto2OrgVntg = findRecord(amp.records, 'RECTO2 ORG VNTG');
check('RECTO2 ORG VNTG exists', recto2OrgVntg !== undefined);
check(
    'RECTO2 ORG VNTG matches Recto2 Orange Vintage',
    recto2OrgVntg?.am4Name === 'Recto2 Orange Vintage',
    `am4Name=${recto2OrgVntg?.am4Name}`,
);

// ─── BK-046 prose-inheritance filtering ───────────────────────────────

const bassguyNrml = findRecord(amp.records, '65 BASSGUY NRML');
check('65 BASSGUY NRML exists', bassguyNrml !== undefined);
check(
    '65 BASSGUY NRML carries INHERITED flag (sanity — confirms upstream AM4 source is inherited)',
    bassguyNrml?.flags.some((f) => f.startsWith('INHERITED:')) ?? false,
);
check(
    '65 BASSGUY NRML carries inherited-prose-omitted flag (BK-046 filter fired)',
    bassguyNrml?.flags.some((f) => f.startsWith('inherited-prose-omitted:')) ?? false,
);
check(
    '65 BASSGUY NRML has NO description (prose filtered out)',
    bassguyNrml?.description === undefined,
    `description=${bassguyNrml?.description}`,
);
check(
    '65 BASSGUY NRML has NO fractalQuotes (prose filtered out)',
    bassguyNrml?.fractalQuotes === undefined,
    `fractalQuotes length=${(bassguyNrml?.fractalQuotes as unknown[] | undefined)?.length}`,
);
check(
    '65 BASSGUY NRML preserves structured fields (basedOn, family, etc.)',
    bassguyNrml?.basedOn !== undefined && bassguyNrml?.family !== undefined,
);

// Direct-match record keeps its prose intact (negative control for BK-046).
const vibratoVerb = findRecord(amp.records, 'VIBRATO VERB');
check('VIBRATO VERB exists', vibratoVerb !== undefined);
check(
    'VIBRATO VERB matchVia is direct (sanity — confirms negative control)',
    vibratoVerb?.matchVia === 'direct',
    `matchVia=${vibratoVerb?.matchVia}`,
);
check(
    'VIBRATO VERB has description (prose preserved on direct match)',
    typeof vibratoVerb?.description === 'string' && vibratoVerb.description.length > 0,
);
check(
    'VIBRATO VERB has fractalQuotes (prose preserved on direct match)',
    Array.isArray(vibratoVerb?.fractalQuotes) && (vibratoVerb!.fractalQuotes as unknown[]).length > 0,
);

// ─── Coverage floor — matched counts must not regress ─────────────────

check(
    'AMP block matched count ≥ 200',
    amp._matched >= 200,
    `matched=${amp._matched}, unmatched=${amp._unmatched}`,
);

const drive = load('drive');
check(
    'DRIVE block matched count ≥ 33',
    drive._matched >= 33,
    `matched=${drive._matched}, unmatched=${drive._unmatched}`,
);

const reverb = load('reverb');
check(
    'REVERB block matched count ≥ 25',
    reverb._matched >= 25,
    `matched=${reverb._matched}, unmatched=${reverb._unmatched}`,
);

const delay = load('delay');
check(
    'DELAY block matched count ≥ 17',
    delay._matched >= 17,
    `matched=${delay._matched}, unmatched=${delay._unmatched}`,
);

// ─── Schema invariants ─────────────────────────────────────────────────

for (const block of ['amp', 'drive', 'reverb', 'delay'] as const) {
    const lineage = load(block);
    for (let i = 0; i < lineage.records.length; i++) {
        const r = lineage.records[i];
        check(
            `${block}[${i}] has axefx2Name`,
            typeof r.axefx2Name === 'string' && r.axefx2Name.length > 0,
        );
        check(
            `${block}[${i}] has integer wireIndex`,
            Number.isInteger(r.wireIndex) && r.wireIndex >= 0,
        );
        check(
            `${block}[${i}] has matchVia in known set`,
            ['direct', 'reverb-swap', 'abbrev-expand', 'prefix', 'unmatched'].includes(r.matchVia),
            `matchVia=${r.matchVia}`,
        );
        check(
            `${block}[${i}] has flags array`,
            Array.isArray(r.flags),
        );
    }
}

// ─── Final ─────────────────────────────────────────────────────────────

if (failures > 0) {
    console.error(`\n${failures} lineage-verifier check(s) FAILED.`);
    console.error('  If you edited scripts/extract-axe-fx-ii-lineage.ts and the BK-046/BK-047 fixes regressed,');
    console.error('  re-run `npm run extract-axe-fx-ii-lineage` and re-check the assertions above.');
    console.error('  If you intentionally changed extractor behavior, update this verifier to match.');
    process.exit(1);
}

const totalChecks =
    /* USA injection */    4 +
    /* Org variants */     4 +
    /* BK-046 BASSGUY */   5 +
    /* BK-046 control */   3 +
    /* coverage floors */  4 +
    /* schema (4 blocks × ~80 records average × 4 invariants — approx 1280) */ 0;
console.log(`✓ All Axe-Fx II lineage regression checks pass (${totalChecks} named + per-record schema invariants).`);
