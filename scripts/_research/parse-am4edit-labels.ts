// parse-am4edit-labels.ts
//
// Parse AM4-Edit's embedded XML resource files to extract every
// EditorControl entry (parameterName → display label, plus block/
// variant/page context). Produces:
//
//   samples/captured/decoded/labels/editor-controls.json
//     Full structured dump: every <EditorControl> tuple with full
//     parent-stack context.
//
//   src/protocol/editorControlLabels.ts
//     Generated TypeScript: keyed by parameterName, exposes the
//     canonical display label and a list of (block, variant, page)
//     contexts where that parameterName appears. Used by the MCP
//     server to render the actual AM4-Edit UI label in tool
//     descriptions and responses.
//
// Source files (extracted by extract-juce-resources-zip.ts from the
// JUCE BinaryData ZIP embedded in AM4-Edit.exe):
//   - samples/captured/decoded/binarydata/extracted/__block_layout.xml
//   - samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml
//   - samples/captured/decoded/binarydata/extracted/__components.xml
//
// XML hierarchy (per __block_layout.xml internal docstring):
//   <EffectLayouts>
//     <EditorControls name="<block>">
//       <EffectVariants>
//         <EffectVariant value="..." name="<variant>">
//           <Page name="<page>" layout="...">
//             <Parameters>
//               <Row>
//                 <EditorControl name="<label>" parameterName="<symbolic-id>" type="<widget>" .../>
//
// "block" is the AM4-Edit block container (Global, Amp, Drive, Cab,
// etc.). "variant" is per-block variation. "page" is which
// AM4-Edit page (first / expert / Mix / Audio / Footswitches /
// Tuner / etc.). "type" is the widget class (knob / slider /
// toggle / dropdown1 / dropdown1p5 / dropdownExpert / sliderExpert
// / sectionLabel / spacer / meterGainInput / etc.).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SOURCES = [
    {
        path: 'samples/captured/decoded/binarydata/extracted/__block_layout.xml',
        page_default: 'first',
    },
    {
        path: 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml',
        page_default: 'expert',
    },
    {
        path: 'samples/captured/decoded/binarydata/extracted/__components.xml',
        page_default: 'components',
    },
] as const;

const OUT_JSON = 'samples/captured/decoded/labels/editor-controls.json';
const OUT_TS   = 'src/fractal/am4/editorControlLabels.ts';

mkdirSync('samples/captured/decoded/labels', { recursive: true });

// ── Tag-stream walker ─────────────────────────────────────────────
// The XML files are well-formed, simple, no DTD, no CDATA, no
// namespaces. We tokenise with a single regex over the whole
// content and walk the tag stream, keeping a stack of open elements.

interface TagToken {
    kind: 'open' | 'close' | 'self' | 'comment' | 'pi';
    name: string;
    attrs: Record<string, string>;
    raw: string;
}

const TAG_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w-]*)\s*>|<([A-Za-z_][\w-]*)\b([^>]*?)(\/?)>/g;
const ATTR_RE = /([A-Za-z_][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

function decodeEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#10;/g, '\n')
        .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    raw.replace(ATTR_RE, (_, k, v) => {
        out[k] = decodeEntities(v);
        return '';
    });
    return out;
}

function* tokenize(xml: string): Generator<TagToken> {
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(xml)) !== null) {
        const raw = m[0];
        if (raw.startsWith('<!--')) {
            yield { kind: 'comment', name: '', attrs: {}, raw };
            continue;
        }
        if (raw.startsWith('<?')) {
            yield { kind: 'pi', name: '', attrs: {}, raw };
            continue;
        }
        if (m[1] !== undefined) {
            yield { kind: 'close', name: m[1], attrs: {}, raw };
            continue;
        }
        const tagName = m[2];
        const attrText = m[3] ?? '';
        const isSelf = m[4] === '/';
        yield {
            kind: isSelf ? 'self' : 'open',
            name: tagName,
            attrs: parseAttrs(attrText),
            raw,
        };
    }
}

// ── Walker that captures EditorControl rows with parent context ──

interface EditorControlEntry {
    /** Display label (`<EditorControl name="...">`). */
    label: string;
    /** Symbolic ID (`<EditorControl parameterName="...">`). */
    parameterName: string;
    /** Widget type. */
    controlType: string;
    /** Block container (e.g. "Amp", "Drive"). */
    block: string;
    /** Variant within the block. */
    variant: string;
    /** Page within the variant ("Audio", "Footswitches", first/expert page label). */
    page: string;
    /** Source file the entry came from. */
    source: string;
    /** Page layer ("first" / "expert" / "components") — derived from source. */
    pageLayer: string;
    /** All raw attributes, for unusual cases. */
    raw: Record<string, string>;
}

const all: EditorControlEntry[] = [];

interface StackFrame {
    name: string;
    attrs: Record<string, string>;
}

for (const src of SOURCES) {
    const xml = readFileSync(src.path, 'utf8');
    const stack: StackFrame[] = [];

    function findAttrUp(elName: string, attrName: string): string | undefined {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === elName) return stack[i].attrs[attrName];
        }
        return undefined;
    }

    for (const tok of tokenize(xml)) {
        if (tok.kind === 'open') {
            stack.push({ name: tok.name, attrs: tok.attrs });
        } else if (tok.kind === 'close') {
            // pop the matching open
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].name === tok.name) {
                    stack.length = i;
                    break;
                }
            }
        } else if (tok.kind === 'self') {
            if (tok.name === 'EditorControl') {
                const label = tok.attrs.name ?? '';
                const parameterName = tok.attrs.parameterName ?? '';
                const controlType = tok.attrs.type ?? '';

                const block   = findAttrUp('EditorControls', 'name')  ?? '';
                const variant = findAttrUp('EffectVariant', 'name')   ?? '';
                const page    = findAttrUp('Page', 'name')            ?? '';

                if (parameterName.length > 0) {
                    all.push({
                        label,
                        parameterName,
                        controlType,
                        block,
                        variant,
                        page,
                        source: src.path,
                        pageLayer: src.page_default,
                        raw: tok.attrs,
                    });
                }
            }
            // self-closing tags don't push to the stack
        }
        // comments and PIs are no-ops
    }
}

console.log(`Parsed ${all.length} <EditorControl/> entries with parameterName`);

// ── Stats ─────────────────────────────────────────────────────────
const byBlock: Record<string, number> = {};
const byPageLayer: Record<string, number> = {};
const byControlType: Record<string, number> = {};
for (const e of all) {
    byBlock[e.block]            = (byBlock[e.block]            ?? 0) + 1;
    byPageLayer[e.pageLayer]    = (byPageLayer[e.pageLayer]    ?? 0) + 1;
    byControlType[e.controlType]= (byControlType[e.controlType]?? 0) + 1;
}
console.log('\nby block:');
for (const [b, n] of Object.entries(byBlock).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(b || '<no-block>').padEnd(28)} ${n}`);
}
console.log('\nby pageLayer:');
for (const [p, n] of Object.entries(byPageLayer).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(20)} ${n}`);
}
console.log('\nby controlType (top 12):');
for (const [t, n] of Object.entries(byControlType).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${(t || '<none>').padEnd(20)} ${n}`);
}

// ── Write the full JSON dump ──────────────────────────────────────

writeFileSync(OUT_JSON, JSON.stringify({
    firmwareSource: 'AM4-Edit.exe (Mar 20 2026 build)',
    extractedAt: new Date().toISOString(),
    sourceFiles: SOURCES.map(s => s.path),
    totalEntries: all.length,
    entries: all,
}, null, 2));
console.log(`\nWrote ${OUT_JSON}`);

// ── Generate src/protocol/editorControlLabels.ts ──────────────────
//
// Shape: Map keyed by parameterName. Each value lists every context
// the parameterName appears in (block × variant × page × pageLayer)
// with the label used in that context. Most parameterNames have a
// single label across all contexts; a few are context-dependent
// (DISTORT_TREBLE = "Treble" on amp, "Tone" on drive).

interface LabelContext {
    block: string;
    variant: string;
    page: string;
    pageLayer: string;
    label: string;
    controlType: string;
}

const byParam: Map<string, LabelContext[]> = new Map();
for (const e of all) {
    const list = byParam.get(e.parameterName) ?? [];
    list.push({
        block: e.block,
        variant: e.variant,
        page: e.page,
        pageLayer: e.pageLayer,
        label: e.label,
        controlType: e.controlType,
    });
    byParam.set(e.parameterName, list);
}

// For each parameterName, derive a canonical label = the most-common
// label across contexts (ties broken by pageLayer="first" preference).
function canonicalLabel(contexts: LabelContext[]): string {
    const counts: Record<string, number> = {};
    for (const c of contexts) counts[c.label] = (counts[c.label] ?? 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 1) return entries[0][0];
    // Prefer "first" pageLayer when tied.
    const tieScore = entries[0][1];
    const tied = entries.filter(([_, n]) => n === tieScore).map(([l]) => l);
    for (const c of contexts) {
        if (c.pageLayer === 'first' && tied.includes(c.label)) return c.label;
    }
    return entries[0][0];
}

const tsLines: string[] = [];
tsLines.push('/**');
tsLines.push(' * Generated by scripts/parse-am4edit-labels.ts. Do not hand-edit.');
tsLines.push(' *');
tsLines.push(' * Source: AM4-Edit.exe embedded JUCE BinaryData ZIP.');
tsLines.push(' *   __block_layout.xml         — first-page knobs');
tsLines.push(' *   __block_layout_expert.xml  — expert/advanced-page knobs');
tsLines.push(' *   __components.xml           — non-block UI elements');
tsLines.push(' *');
tsLines.push(' * The mapping is keyed by AM4-Edit\'s symbolic parameter ID');
tsLines.push(' * (e.g. DISTORT_TREBLE). Each entry has:');
tsLines.push(' *   - canonicalLabel: the display name used by the AM4-Edit UI');
tsLines.push(' *     (most-common across contexts; ties resolved to the first-page label).');
tsLines.push(' *   - contexts: every place this parameterName appears, with the');
tsLines.push(' *     label used in that context. Use the context-matched label when');
tsLines.push(' *     a tool surface knows the active block (DISTORT_TREBLE shows as');
tsLines.push(' *     "Treble" on amp, "Tone" on drive).');
tsLines.push(' */');
tsLines.push('');
tsLines.push('export interface EditorControlContext {');
tsLines.push('    block: string;');
tsLines.push('    variant: string;');
tsLines.push('    page: string;');
tsLines.push('    pageLayer: \'first\' | \'expert\' | \'components\';');
tsLines.push('    label: string;');
tsLines.push('    controlType: string;');
tsLines.push('}');
tsLines.push('');
tsLines.push('export interface EditorControlEntry {');
tsLines.push('    parameterName: string;');
tsLines.push('    canonicalLabel: string;');
tsLines.push('    contexts: readonly EditorControlContext[];');
tsLines.push('}');
tsLines.push('');
tsLines.push(`export const EDITOR_CONTROL_FIRMWARE = 'AM4-Edit Mar 20 2026 build';`);
tsLines.push('');
tsLines.push('export const EDITOR_CONTROLS: Readonly<Record<string, EditorControlEntry>> = {');
const sortedParams = [...byParam.keys()].sort();
for (const pname of sortedParams) {
    const ctx = byParam.get(pname)!;
    const canonical = canonicalLabel(ctx);
    tsLines.push(`    ${JSON.stringify(pname)}: {`);
    tsLines.push(`        parameterName: ${JSON.stringify(pname)},`);
    tsLines.push(`        canonicalLabel: ${JSON.stringify(canonical)},`);
    tsLines.push(`        contexts: [`);
    for (const c of ctx) {
        tsLines.push(`            ${JSON.stringify(c)},`);
    }
    tsLines.push(`        ],`);
    tsLines.push(`    },`);
}
tsLines.push('};');
tsLines.push('');
tsLines.push(`export const EDITOR_CONTROL_PARAMETER_NAMES = Object.keys(EDITOR_CONTROLS);`);
tsLines.push('');
tsLines.push('/**');
tsLines.push(' * Resolve the AM4-Edit display label for a parameterName, optionally');
tsLines.push(' * preferring the label used in a specific block/page context.');
tsLines.push(' *');
tsLines.push(' * Returns the canonical label when no context match is found, or');
tsLines.push(' * undefined if the parameterName is unknown.');
tsLines.push(' */');
tsLines.push('export function resolveEditorControlLabel(');
tsLines.push('    parameterName: string,');
tsLines.push('    context?: { block?: string; pageLayer?: string },');
tsLines.push('): string | undefined {');
tsLines.push('    const entry = EDITOR_CONTROLS[parameterName];');
tsLines.push('    if (!entry) return undefined;');
tsLines.push('    if (!context) return entry.canonicalLabel;');
tsLines.push('');
tsLines.push('    // Filter contexts by the requested block / pageLayer, then');
tsLines.push('    // return the MOST-COMMON label within the filtered set. This');
tsLines.push('    // matters for blocks like Amp where different amp variants');
tsLines.push('    // use different labels for the same wire param (e.g. simple');
tsLines.push('    // amps show "Tone", standard amps show "Treble" for');
tsLines.push('    // DISTORT_TREBLE).');
tsLines.push('    const filtered = entry.contexts.filter(c => {');
tsLines.push('        if (context.block && c.block !== context.block) return false;');
tsLines.push('        if (context.pageLayer && c.pageLayer !== context.pageLayer) return false;');
tsLines.push('        return true;');
tsLines.push('    });');
tsLines.push('    if (filtered.length === 0) return entry.canonicalLabel;');
tsLines.push('    const counts = new Map<string, number>();');
tsLines.push('    for (const c of filtered) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);');
tsLines.push('    let bestLabel = filtered[0].label;');
tsLines.push('    let bestCount = 0;');
tsLines.push('    for (const [l, n] of counts) {');
tsLines.push('        if (n > bestCount) { bestCount = n; bestLabel = l; }');
tsLines.push('    }');
tsLines.push('    return bestLabel;');
tsLines.push('}');
tsLines.push('');

writeFileSync(OUT_TS, tsLines.join('\n'));
console.log(`Wrote ${OUT_TS}  (${tsLines.length} lines, ${sortedParams.length} parameterNames)`);
