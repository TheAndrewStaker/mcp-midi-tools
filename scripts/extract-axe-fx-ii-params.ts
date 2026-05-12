// extract-axe-fx-ii-params.ts
//
// Hardware-free generator for the Fractal Axe-Fx II XL+ parameter
// registry. Joins two existing data sources:
//
//   1. The Fractal Audio Wiki's `MIDI_SysEx` page (cached at
//      `docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html`). Carries
//      the per-block parameter ID tables — the wire-IDs needed to
//      build SET_BLOCK_PARAMETER_VALUE messages. Source of truth for
//      `(blockGroup, paramId, name, type, options)`.
//
//   2. The Axe-Edit BinaryData XML catalog (already extracted by
//      `extract-axe-fx-ii-catalog.ts` to
//      `samples/captured/decoded/labels/axe-edit-catalog.json`).
//      Carries the symbolic parameterName (e.g. `DISTORT_DRIVE`) +
//      Title-Case UI label + type-applicability gates. **No wire IDs.**
//
// Outputs:
//   src/fractal/axe-fx-ii/blockTypes.ts      — block ID dictionary
//   src/fractal/axe-fx-ii/params.ts          — KNOWN_PARAMS registry
//   samples/captured/decoded/labels/axe-fx-ii-params.json
//                                            — full structured dump
//
// Run:
//   npx tsx scripts/extract-axe-fx-ii-params.ts
//
// Status: hardware-free RE artefact. Wiki data is documented "as of
// Quantum 8.02" but we have not yet captured live Axe-Edit ↔ device
// SysEx to verify the wiki spec holds on the founder's current
// firmware. Every entry stays 🟡 wiki-documented until HW-074 lands.
// See `docs/SYSEX-MAP-AXE-FX-II.md` for the current state.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ── Inputs / outputs ──────────────────────────────────────────────────

const WIKI_HTML = 'docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html';
const XML_CATALOG_JSON = 'samples/captured/decoded/labels/axe-edit-catalog.json';
const OUT_BLOCKTYPES_TS = 'src/fractal/axe-fx-ii/blockTypes.ts';
const OUT_PARAMS_TS = 'src/fractal/axe-fx-ii/params.ts';
const OUT_DEBUG_JSON = 'samples/captured/decoded/labels/axe-fx-ii-params.json';

// ── Wiki group code → Axe-Edit XML block name ────────────────────────
//
// The wiki uses 3-letter group codes (AMP, CPR, GEQ); Axe-Edit's XML
// uses CamelCase block names (Amp, Compressor, GraphicEQ). This is the
// only manual mapping the join needs — once paired, parameterName ↔
// paramId joins purely on (block, name) match.
//
// `''` value means the wiki group has no XML editor surface (typically
// I/O / global blocks Axe-Edit doesn't render as a block tile).

const WIKI_TO_XML: Record<string, string> = {
  AMP: 'Amp',
  CAB: 'Cab',
  CPR: 'Compressor',
  GEQ: 'GraphicEQ',
  PEQ: 'ParametricEQ',
  REV: 'Reverb',
  DLY: 'Delay',
  MTD: 'MultiDelay',
  CHO: 'Chorus',
  FLG: 'Flanger',
  ROT: 'Rotary',
  PHA: 'Phaser',
  WAH: 'Wah',
  FRM: 'Formant',
  VOL: 'VolPan',
  TRM: 'PanTrem',
  PIT: 'Pitch',
  FIL: 'Filter',
  DRV: 'Drive',
  ENH: 'Enhancer',
  FXL: 'EffectsLoop',
  INPUT: '',
  OUTPUT: 'Output',
  CONTROLLERS: 'Controllers',
  SYN: 'Synth',
  GTE: 'GateExpander',
  RNG: 'RingMod',
  LPR: 'Looper',
  SND: 'FeedbackSend',
  RTN: 'FeedbackReturn',
  MIX: 'Mixer',
  MBC: 'MultibandComp',
  XVR: 'Crossover',
  MGT: 'MegaTap',
};

// ── Helpers ───────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#10;/g, '\n')
        .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
    return decodeEntities(html.replace(/<[^>]+>/g, ''));
}

function snakeCase(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function blockSlug(xmlName: string, groupCode: string): string {
    if (xmlName) return snakeCase(xmlName);
    return snakeCase(groupCode);
}

// ── Wiki HTML parsing ─────────────────────────────────────────────────

interface BlockId {
    id: number;
    name: string;
    groupCode: string;
    canBypass: boolean;
    availableOnAX8: boolean;
    xY: boolean;
    xlY: boolean;
    ax8XY: boolean;
}

interface WikiOption {
    index: number;
    name: string;
}

interface WikiParamRow {
    groupCode: string;
    paramId: number;
    name: string;            // wiki "Name" column verbatim
    type: 'knob' | 'select' | 'switch' | 'unknown';
    options: WikiOption[];
    min?: string;            // verbatim wiki min cell (numbers may be floats)
    max?: string;
    step?: string;
    modifierAssignable: boolean;
    fwAdded?: string;
}

const wikiHtml = readFileSync(WIKI_HTML, 'utf8');

/** Extract the contents of a wikitable starting near `startOffset`. */
function findNextWikitable(html: string, startOffset: number): { start: number; end: number } | null {
    const tableStart = html.indexOf('<table class="wikitable"', startOffset);
    if (tableStart < 0) return null;
    const tableEnd = html.indexOf('</table>', tableStart);
    if (tableEnd < 0) return null;
    return { start: tableStart, end: tableEnd + '</table>'.length };
}

/** Split a `<tbody>` chunk into `<tr>...</tr>` slices. */
function splitRows(tableHtml: string): string[] {
    const rows: string[] = [];
    const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tableHtml)) !== null) rows.push(m[1]);
    return rows;
}

/** Pull every `<td>...</td>` out of a row, in order, with text content. */
function rowCells(rowHtml: string): string[] {
    const cells: string[] = [];
    const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rowHtml)) !== null) cells.push(m[1]);
    return cells;
}

/** Skip rows that are header-only (`<th>` cells) or completely empty. */
function isDataRow(cells: string[]): boolean {
    if (cells.length === 0) return false;
    return cells.some((c) => stripTags(c).trim() !== '');
}

// ── Block IDs table ───────────────────────────────────────────────────

function parseBlockIds(html: string): BlockId[] {
    const anchor = html.indexOf('id="Axe-Fx_II_MIDI_SysEx:_Block_IDs"');
    if (anchor < 0) throw new Error('Block IDs heading not found in wiki HTML');
    const tbl = findNextWikitable(html, anchor);
    if (!tbl) throw new Error('Block IDs wikitable not found');
    const tableHtml = html.slice(tbl.start, tbl.end);

    const rows = splitRows(tableHtml).filter((r) => !/<th[\s>]/.test(r));
    const out: BlockId[] = [];
    for (const r of rows) {
        const cells = rowCells(r).map((c) => stripTags(c).trim());
        if (!isDataRow(cells)) continue;
        if (cells.length < 4) continue;
        const id = Number(cells[0]);
        if (!Number.isFinite(id)) continue;
        out.push({
            id,
            name: cells[1] ?? '',
            groupCode: cells[2] ?? '',
            canBypass: /^yes$/i.test(cells[3] ?? ''),
            availableOnAX8: /^yes$/i.test(cells[4] ?? ''),
            xY: /^yes$/i.test(cells[5] ?? ''),
            xlY: /^yes$/i.test(cells[6] ?? ''),
            ax8XY: /^yes$/i.test(cells[7] ?? ''),
        });
    }
    return out;
}

// ── Per-block parameter tables ────────────────────────────────────────

function parseOptionsCell(cellHtml: string): WikiOption[] {
    // Cell content is `0: NAME<br />1: NAME<br />...`. Split on <br /> /
    // newlines and parse `INDEX: NAME`.
    const text = decodeEntities(cellHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    const out: WikiOption[] = [];
    for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\s*:\s*(.+?)\s*$/.exec(line);
        if (!m) continue;
        out.push({ index: Number(m[1]), name: m[2] });
    }
    return out;
}

function classifyType(rawType: string): WikiParamRow['type'] {
    const t = rawType.trim().toLowerCase();
    if (t === 'knob' || t === 'select' || t === 'switch') return t;
    return 'unknown';
}

function parseBlockParams(html: string, groupCode: string): WikiParamRow[] {
    const headingRe = new RegExp(`id="${groupCode}"`);
    const m = headingRe.exec(html);
    if (!m) return [];
    const tbl = findNextWikitable(html, m.index);
    if (!tbl) return [];
    const tableHtml = html.slice(tbl.start, tbl.end);

    const rows = splitRows(tableHtml).filter((r) => !/<th[\s>]/.test(r));
    const out: WikiParamRow[] = [];
    for (const r of rows) {
        const cells = rowCells(r);
        if (!isDataRow(cells.map((c) => stripTags(c)))) continue;
        if (cells.length < 4) continue;
        const text = cells.map((c) => stripTags(c).trim());
        // Cell layout: [Block, ID, Name, Type, Options, Min, Max, Step, ModAssign, Added]
        const paramId = Number(text[1]);
        if (!Number.isFinite(paramId)) continue;
        const name = text[2] ?? '';
        if (!name) continue;
        out.push({
            groupCode,
            paramId,
            name,
            type: classifyType(text[3] ?? ''),
            options: parseOptionsCell(cells[4] ?? ''),
            min: text[5] || undefined,
            max: text[6] || undefined,
            step: text[7] || undefined,
            modifierAssignable: /^yes$/i.test(text[8] ?? ''),
            fwAdded: text[9] || undefined,
        });
    }
    return out;
}

// ── XML catalog (already-decoded JSON) ────────────────────────────────

interface XmlEntry {
    label: string;
    parameterName: string;
    controlType: string;
    block: string;
    variant: string;
    variantValue: string;
    page: string;
    pageLayout: string;
    controllingParamName?: string;
    controllingParamValue?: string;
}

interface XmlCatalog {
    totalEntries: number;
    totalUniqueParams: number;
    entries: XmlEntry[];
}

const xmlCatalog: XmlCatalog = JSON.parse(readFileSync(XML_CATALOG_JSON, 'utf8'));

/**
 * Map of XML block name → unique parameterName entries. We dedupe on
 * parameterName because the same symbol appears across many variants —
 * we only need one canonical UI label per symbol for the join.
 */
function buildXmlIndex(): Map<string, Map<string, XmlEntry>> {
    const byBlock = new Map<string, Map<string, XmlEntry>>();
    for (const e of xmlCatalog.entries) {
        if (!e.parameterName) continue;
        if (!byBlock.has(e.block)) byBlock.set(e.block, new Map());
        const inner = byBlock.get(e.block)!;
        // Prefer entries from the "Basic" page (more representative
        // labels) but accept any if Basic is unavailable.
        const existing = inner.get(e.parameterName);
        if (!existing || (e.page === 'Basic' && existing.page !== 'Basic')) {
            inner.set(e.parameterName, e);
        }
    }
    return byBlock;
}

const xmlIndex = buildXmlIndex();

// ── Join wiki rows → XML symbols ──────────────────────────────────────
//
// Match rule: case-insensitive whitespace-collapsed equality between
// wiki Name (e.g. "INPUT DRIVE") and XML label (e.g. "Input Drive").
//
// When the wiki name is something like "EFFECT TYPE" but the XML label
// is "Type", the join misses — we accept that loss; the wire ID is
// what matters and the wiki is authoritative for it.

function normaliseName(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface JoinedParam extends WikiParamRow {
    xmlBlock?: string;
    xmlLabel?: string;
    parameterName?: string;
    xmlControlType?: string;
    controllingParamName?: string;
    controllingParamValue?: string;
}

function joinWikiToXml(row: WikiParamRow): JoinedParam {
    const xmlBlock = WIKI_TO_XML[row.groupCode];
    if (!xmlBlock) return { ...row };
    const inner = xmlIndex.get(xmlBlock);
    if (!inner) return { ...row, xmlBlock };
    const target = normaliseName(row.name);
    for (const e of inner.values()) {
        if (normaliseName(e.label) === target) {
            return {
                ...row,
                xmlBlock,
                xmlLabel: e.label,
                parameterName: e.parameterName,
                xmlControlType: e.controlType,
                controllingParamName: e.controllingParamName,
                controllingParamValue: e.controllingParamValue,
            };
        }
    }
    return { ...row, xmlBlock };
}

// ── Run extraction ────────────────────────────────────────────────────

const blockIds = parseBlockIds(wikiHtml);
const allWikiGroups = Array.from(new Set(blockIds.map((b) => b.groupCode))).sort();

// Some wiki sections live under group codes that don't appear in the
// Block IDs table (e.g. `INPUT`, `OUTPUT`, `CONTROLLERS` — global
// surfaces without a block ID). Pick those up by scanning headings.
const headingGroupRe = /<h2><span class="mw-headline" id="([A-Z]{2,12})"/g;
const headingGroups = new Set<string>();
let hm: RegExpExecArray | null;
while ((hm = headingGroupRe.exec(wikiHtml)) !== null) headingGroups.add(hm[1]);

const targetGroups = Array.from(new Set([...allWikiGroups, ...headingGroups])).sort();

const allParams: JoinedParam[] = [];
const groupSummary: Record<string, { rows: number; matched: number }> = {};
for (const g of targetGroups) {
    if (!(g in WIKI_TO_XML) && !headingGroups.has(g)) continue;
    if (!headingGroups.has(g)) continue;
    const rows = parseBlockParams(wikiHtml, g);
    const joined = rows.map(joinWikiToXml);
    allParams.push(...joined);
    groupSummary[g] = {
        rows: rows.length,
        matched: joined.filter((j) => j.parameterName).length,
    };
}

// ── Emit blockTypes.ts ────────────────────────────────────────────────

function emitBlockTypes(): string {
    const sorted = blockIds.slice().sort((a, b) => a.id - b.id);
    const entries = sorted.map((b) =>
        `  { id: ${b.id}, name: ${JSON.stringify(b.name)}, groupCode: ${JSON.stringify(b.groupCode)}, canBypass: ${b.canBypass}, availableOnAX8: ${b.availableOnAX8} },`,
    ).join('\n');

    return `/**
 * Axe-Fx II block ID dictionary (generated).
 *
 * Source: Fractal Audio Wiki "MIDI_SysEx" page, "Axe-Fx II MIDI SysEx:
 * Block IDs" table, cached at
 * \`docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html\`.
 *
 * Wire context: the Axe-Fx II family addresses each block by its
 * 14-bit \`effectId\` in the GET/SET_BLOCK_PARAMETER_VALUE message
 * (function \`0x02\`). Multiple instances of the same block group
 * (e.g. Amp 1 + Amp 2) have distinct ids but share the parameter
 * table — see \`KNOWN_PARAMS\` in \`./params.ts\`, keyed by group code.
 *
 * **DO NOT EDIT BY HAND** — regenerate via:
 *   npx tsx scripts/extract-axe-fx-ii-params.ts
 *
 * Status: 🟡 wiki-documented, not yet hardware-verified on Q8.02.
 * The factory bank file's preset chunks reference these block IDs
 * indirectly; live capture (HW-074) would promote to 🟢.
 */

export interface AxeFxIIBlock {
    /** 14-bit \`effectId\` used in GET/SET_BLOCK_PARAMETER_VALUE. */
    readonly id: number;
    /** Display name (e.g. "Amp 1", "Reverb 2"). */
    readonly name: string;
    /** 3-letter group code shared by all instances (e.g. "AMP"). */
    readonly groupCode: string;
    /** Whether the block exposes a bypass toggle. */
    readonly canBypass: boolean;
    /** Whether the AX8 floorboard exposes this block. */
    readonly availableOnAX8: boolean;
}

export const AXE_FX_II_BLOCKS: readonly AxeFxIIBlock[] = [
${entries}
] as const;

/** Reverse lookup: effectId → block. */
export const BLOCK_BY_ID: Readonly<Record<number, AxeFxIIBlock>> =
    Object.freeze(Object.fromEntries(AXE_FX_II_BLOCKS.map((b) => [b.id, b])));

/** Group code → list of effectIds (in order). e.g. AMP → [106, 107]. */
export const IDS_BY_GROUP: Readonly<Record<string, readonly number[]>> = (() => {
    const out: Record<string, number[]> = {};
    for (const b of AXE_FX_II_BLOCKS) {
        (out[b.groupCode] ??= []).push(b.id);
    }
    return Object.freeze(
        Object.fromEntries(
            Object.entries(out).map(([k, v]) => [k, Object.freeze(v.slice())]),
        ),
    );
})();

/** Block name (e.g. "Amp 1") → block. Case-insensitive. */
const NAMES_BY_LOWER: Record<string, AxeFxIIBlock> = Object.fromEntries(
    AXE_FX_II_BLOCKS.map((b) => [b.name.toLowerCase(), b]),
);

/** Resolve a user-supplied block reference (id or name) to its block. */
export function resolveBlock(input: string | number): AxeFxIIBlock | undefined {
    if (typeof input === 'number') return BLOCK_BY_ID[input];
    return NAMES_BY_LOWER[input.trim().toLowerCase()];
}
`;
}

// ── Emit params.ts ────────────────────────────────────────────────────

function emitParams(): string {
    const byBlock = new Map<string, JoinedParam[]>();
    for (const p of allParams) {
        if (!(p.groupCode in WIKI_TO_XML)) continue;
        const xmlName = WIKI_TO_XML[p.groupCode];
        const slug = blockSlug(xmlName, p.groupCode);
        if (!byBlock.has(slug)) byBlock.set(slug, []);
        byBlock.get(slug)!.push(p);
    }

    // Build entries deterministically: block alphabetic, paramId asc.
    const blocks = Array.from(byBlock.keys()).sort();
    const lines: string[] = [];
    const enumDecls: string[] = [];
    let totalEntries = 0;
    let totalEnumEntries = 0;

    for (const block of blocks) {
        const rows = byBlock.get(block)!.slice().sort((a, b) => a.paramId - b.paramId);
        // Deduplicate: same paramId can occur with different snake names
        // when the wiki repeats due to formatting; keep first occurrence.
        const seenParamIds = new Set<number>();
        const seenKeys = new Set<string>();
        for (const r of rows) {
            if (seenParamIds.has(r.paramId)) continue;
            seenParamIds.add(r.paramId);

            const baseKey = snakeCase(r.name);
            if (!baseKey) continue;
            const fullKey = `${block}.${baseKey}`;
            if (seenKeys.has(fullKey)) continue;
            seenKeys.add(fullKey);

            const props: string[] = [];
            props.push(`groupCode: ${JSON.stringify(r.groupCode)}`);
            props.push(`block: ${JSON.stringify(block)}`);
            props.push(`paramId: ${r.paramId}`);
            props.push(`wikiName: ${JSON.stringify(r.name)}`);
            props.push(`name: ${JSON.stringify(baseKey)}`);
            props.push(`controlType: ${JSON.stringify(r.type)}`);

            if (r.parameterName) props.push(`parameterName: ${JSON.stringify(r.parameterName)}`);
            if (r.xmlLabel) props.push(`xmlLabel: ${JSON.stringify(r.xmlLabel)}`);

            if (r.type === 'select' && r.options.length > 0) {
                const enumName = `${block.toUpperCase()}_${baseKey.toUpperCase()}_VALUES`;
                enumDecls.push(
                    `export const ${enumName}: Readonly<Record<number, string>> = Object.freeze({\n` +
                    r.options.map((o) => `    ${o.index}: ${JSON.stringify(o.name)},`).join('\n') +
                    `\n});`,
                );
                props.push(`enumValues: ${enumName}`);
                totalEnumEntries += r.options.length;
            }

            const trimmedMin = r.min?.trim();
            const trimmedMax = r.max?.trim();
            const trimmedStep = r.step?.trim();
            if (trimmedMin && Number.isFinite(Number(trimmedMin))) props.push(`displayMin: ${Number(trimmedMin)}`);
            if (trimmedMax && Number.isFinite(Number(trimmedMax))) props.push(`displayMax: ${Number(trimmedMax)}`);
            if (trimmedStep && Number.isFinite(Number(trimmedStep))) props.push(`step: ${Number(trimmedStep)}`);

            if (r.modifierAssignable) props.push(`modifierAssignable: true`);
            if (r.fwAdded) props.push(`fwAdded: ${JSON.stringify(r.fwAdded)}`);
            if (r.controllingParamName) props.push(`gateOn: ${JSON.stringify(r.controllingParamName)}`);
            if (r.controllingParamValue) props.push(`gateValues: ${JSON.stringify(r.controllingParamValue)}`);

            lines.push(`    ${JSON.stringify(fullKey)}: { ${props.join(', ')} },`);
            totalEntries++;
        }
    }

    return `/**
 * Axe-Fx II parameter registry (generated).
 *
 * Each entry describes one addressable parameter on the Axe-Fx II
 * family. Wire-side identity is \`(effectId, paramId)\` — \`paramId\` is
 * shared across every block instance in the same group (e.g. Amp 1 and
 * Amp 2 both expose \`paramId: 1\` for INPUT DRIVE), so the registry is
 * keyed by group + parameter, with \`effectId\` resolved at the tool
 * boundary via \`./blockTypes.ts\` \`IDS_BY_GROUP\`.
 *
 * Sources joined:
 *   • Fractal Audio Wiki "MIDI_SysEx" — wire-IDs + UPPERCASE name +
 *     control type + enum options + min/max/step (where present).
 *     Cached at \`docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html\`.
 *   • Axe-Edit \`__block_layout.xml\` — symbolic \`parameterName\` (e.g.
 *     \`DISTORT_DRIVE\`) + Title-Case UI label + type-applicability
 *     gates. Catalogued at
 *     \`samples/captured/decoded/labels/axe-edit-catalog.json\`.
 *
 * **DO NOT EDIT BY HAND** — regenerate via:
 *   npx tsx scripts/extract-axe-fx-ii-params.ts
 *
 * Status: 🟡 wiki-documented, not yet hardware-verified on Quantum 8.02.
 * Wiki min/max/step are populated only for the subset of params the
 * wiki documents — most knobs are blank in the wiki and need hardware
 * spotchecks to anchor display ranges. Until then, encoders should
 * treat absent ranges as "wire 0..65534, display unknown" and pass
 * the value through verbatim.
 *
 * Wire encoding (per wiki "MIDI SysEx: obtaining parameter values"):
 *   value range  : 0..65534 integer
 *   3-septet pack: [bits 6-0, bits 13-7, bits 14-15 in low 2 bits]
 *
 * Reference encoder lives in \`./setParam.ts\` (TBD when the encoder
 * lands in the multi-vendor refactor).
 */

export type AxeFxIIControlType = 'knob' | 'select' | 'switch' | 'unknown';

export interface AxeFxIIParam {
    /** Wiki block group (e.g. "AMP", "CPR", "GEQ"). */
    readonly groupCode: string;
    /** Block slug used in the registry key (e.g. "amp", "compressor"). */
    readonly block: string;
    /** Wire-side \`paramId\` within the block (0..255). */
    readonly paramId: number;
    /** Wiki "Name" column (UPPERCASE, e.g. "INPUT DRIVE"). */
    readonly wikiName: string;
    /** Snake-case key matching the registry suffix. */
    readonly name: string;
    /** Wiki control type. */
    readonly controlType: AxeFxIIControlType;
    /** Axe-Edit XML symbolic name when matched (e.g. "DISTORT_DRIVE"). */
    readonly parameterName?: string;
    /** Axe-Edit XML UI label when matched (e.g. "Input Drive"). */
    readonly xmlLabel?: string;
    /** Enum values for \`select\` controls (wire int → display name). */
    readonly enumValues?: Readonly<Record<number, string>>;
    /** Display min from wiki (when populated). */
    readonly displayMin?: number;
    /** Display max from wiki (when populated). */
    readonly displayMax?: number;
    /** Display step from wiki (when populated). */
    readonly step?: number;
    /** Whether a modifier can target this param. */
    readonly modifierAssignable?: boolean;
    /** Firmware version that introduced this param. */
    readonly fwAdded?: string;
    /** XML applicability gate: which other parameter controls visibility. */
    readonly gateOn?: string;
    /** XML gate values (comma-separated string of variant indices). */
    readonly gateValues?: string;
}

${enumDecls.join('\n\n')}

export const KNOWN_PARAMS = {
${lines.join('\n')}
} as const satisfies Readonly<Record<string, AxeFxIIParam>>;

export type AxeFxIIParamKey = keyof typeof KNOWN_PARAMS;

/** Extraction summary (refresh by re-running the generator). */
export const REGISTRY_STATS = Object.freeze({
    totalParams: ${totalEntries},
    totalEnumEntries: ${totalEnumEntries},
});
`;
}

// ── Persist ───────────────────────────────────────────────────────────

mkdirSync('src/fractal/axe-fx-ii', { recursive: true });
mkdirSync('samples/captured/decoded/labels', { recursive: true });

writeFileSync(OUT_BLOCKTYPES_TS, emitBlockTypes(), 'utf8');
writeFileSync(OUT_PARAMS_TS, emitParams(), 'utf8');
writeFileSync(
    OUT_DEBUG_JSON,
    JSON.stringify(
        {
            extractedAt: new Date().toISOString(),
            blockCount: blockIds.length,
            paramCount: allParams.length,
            groupSummary,
            blockIds,
            params: allParams,
        },
        null,
        2,
    ),
    'utf8',
);

// ── Stdout report ─────────────────────────────────────────────────────

const matched = allParams.filter((p) => p.parameterName).length;
const total = allParams.length;
const matchPct = total === 0 ? 0 : ((matched / total) * 100).toFixed(1);

console.log(`extract-axe-fx-ii-params: parsed ${blockIds.length} block IDs, ${total} parameters across ${Object.keys(groupSummary).length} groups.`);
console.log(`  XML join: ${matched}/${total} matched (${matchPct}%).`);
console.log(`  output: ${OUT_BLOCKTYPES_TS}`);
console.log(`  output: ${OUT_PARAMS_TS}`);
console.log(`  output: ${OUT_DEBUG_JSON}`);

const sortedGroups = Object.keys(groupSummary).sort();
console.log(`  per-group rows / matched:`);
for (const g of sortedGroups) {
    const s = groupSummary[g];
    console.log(`    ${g.padEnd(12)} ${String(s.rows).padStart(4)} rows, ${String(s.matched).padStart(4)} matched`);
}
