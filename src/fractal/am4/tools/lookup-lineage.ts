/**
 * Lineage lookup MCP tools — `am4_lookup_lineage` (single-ask) and
 * `am4_lookup_lineages` (batched).
 *
 * Both tools return Fractal Audio's authored lineage info for AM4
 * models — what real hardware an algorithm is modeled after, Fractal's
 * description, and forum quotes from Cliff. Self-contained: no MIDI
 * I/O, no protocol-level dependencies; pure dictionary lookup against
 * `src/fractal/shared/lineage/<block>-lineage.json` via the helpers in
 * `@/fractal/shared/lineageLookup.js`.
 *
 * Extracted from `src/server/index.ts` Session 54 as the first
 * cleavage of the 5139-line server split. Tool descriptions are
 * preserved byte-for-byte — they're load-bearing for agent behavior.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    LINEAGE_BLOCKS,
    type LineageLookupAsk,
    formatLineageRecord,
    runLineageLookup,
} from '@/fractal/shared/lineageLookup.js';

export function registerLineageLookupTools(server: McpServer): void {
    server.registerTool('am4_lookup_lineage', {
        description: [
            'Look up Fractal Audio\'s authored lineage info for an AM4 model — what',
            'real hardware it\'s modeled after, Fractal\'s own description of the',
            'algorithm, and forum quotes from the developer. Data lives in',
            'src/fractal/shared/lineage/*-lineage.json and is sourced from the Fractal wiki +',
            'Blocks Guide PDF; only Fractal-authored content is stored (no',
            'community-inferred genre/era tags, no third-party reviews).',
            'Three call shapes (exactly one required):',
            '  (a) forward — { block_type, name }: return the record matching that',
            '      canonical AM4 name (case-insensitive).',
            '  (b) reverse by real-gear term — { block_type, real_gear }: substring',
            '      search across basedOn / description / forum quotes. Returns the',
            '      top 10 ranked matches. Use for fuzzy queries — including artist',
            '      references like "Keith Urban sound" or "Cantrell tone" which',
            '      match artist names in Fractal\'s description prose.',
            '  (c) structured filter — { block_type, manufacturer?, model? }:',
            '      exact-match against basedOn\'s structured fields. Most precise',
            '      for queries like "classic MXR phaser" (manufacturer="MXR") or',
            '      "LA-2A" (model="LA-2A"). Multiple structured fields AND together.',
            'Response text is designed to be read by Claude, not shown verbatim to',
            'the user — pull out the am4Name and summarize the lineage in your',
            'own words.',
            'For multi-amp lookups (e.g. surveying iconic amps for a setlist',
            'build), use `am4_lookup_lineages` (plural) instead: it batches N',
            'lookups into one tool call, saving 5-10s of inference per skipped',
            'round.',
        ].join(' '),
        inputSchema: {
            block_type: z.enum(LINEAGE_BLOCKS).describe(
                'Which block\'s lineage to query. Currently amp/drive/reverb/delay/compressor/phaser/chorus/flanger/wah (cab coming once the AM4 cab enum is decoded; gate/tremolo/geq/filter/enhancer/peq/rotary/volpan are algorithmic-only and not in the lineage set).',
            ),
            name: z.string().optional().describe(
                'Canonical AM4 model name for forward lookup (e.g. "T808 OD", "Optical Compressor", "5F1 Tweed Champlifier"). Case-insensitive.',
            ),
            real_gear: z.string().optional().describe(
                'Real-hardware query for fuzzy reverse search (e.g. "1176", "Tube Screamer", "LA-2A", "EMT 140", "Fender Twin"). Returns the top AM4 models whose lineage text mentions the term.',
            ),
            manufacturer: z.string().optional().describe(
                'Exact manufacturer filter (case-insensitive): "MXR", "Fender", "Ibanez", "Boss", "Marshall", "TC Electronic". Use alone or combined with model.',
            ),
            model: z.string().optional().describe(
                'Exact model identifier filter (case-insensitive): "M-102", "TS-9", "LA-2A", "5F1", "1176", "2290". Use alone or combined with manufacturer.',
            ),
            include_quotes: z.boolean().optional().describe(
                'Whether to include Fractal Audio forum quotes in the response. Default true. Pass false for a terser response when you only need the description/basedOn summary (some records have 15+ quotes).',
            ),
        },
    }, async ({ block_type, name, real_gear, manufacturer, model, include_quotes }) => {
        const withQuotes = include_quotes ?? true;
        const result = runLineageLookup({ block_type, name, real_gear, manufacturer, model });

        if (!result.found) {
            // Re-expand the miss reason to the same hint-rich prose the tool used
            // before refactoring, so single-ask UX is unchanged.
            if (result.shape === 'structured') {
                const filter = [
                    manufacturer && `manufacturer="${manufacturer}"`,
                    model && `model="${model}"`,
                ].filter(Boolean).join(', ');
                return {
                    content: [{
                        type: 'text',
                        text: `No ${block_type} records match ${filter}. ${result.totalScanned} records scanned. ` +
                            `Try a fuzzy search with real_gear if you\'re unsure of the exact brand/model spelling, ` +
                            `or list valid manufacturer/model values by reading src/fractal/shared/lineage/${block_type}-lineage.json.`,
                    }],
                };
            }
            if (result.shape === 'forward') {
                return {
                    content: [{
                        type: 'text',
                        text:
                            `No ${block_type} lineage record matches "${name}". The ${block_type}-lineage.json ` +
                            `catalog has ${result.totalScanned} records; try a reverse search with real_gear if you ` +
                            `know the real hardware but not the exact AM4 name.`,
                    }],
                };
            }
            // reverse miss
            return {
                content: [{
                    type: 'text',
                    text:
                        `No ${block_type} records mention "${real_gear}". Searched across ${result.totalScanned} records ` +
                        `(am4Name, wikiName, basedOn, description, fractalQuotes). Try a different spelling ` +
                        `(e.g. "TS9" vs "Tube Screamer", "EVH" vs "5150") or widen the query.`,
                }],
            };
        }

        if (result.shape === 'forward') {
            return {
                content: [{
                    type: 'text',
                    text: formatLineageRecord(result.hits[0].record, withQuotes),
                }],
            };
        }

        if (result.shape === 'structured') {
            const blocks = result.hits.map(
                (h) => `── ${h.am4Name} ──\n${formatLineageRecord(h.record, withQuotes, 3)}`,
            );
            return {
                content: [{
                    type: 'text',
                    text: `${result.hits.length} ${block_type} matches${result.hits.length > 10 ? ' (showing top 10)' : ''}:\n\n${blocks.join('\n\n')}`,
                }],
            };
        }

        // reverse hit
        const blocks = result.hits.map(
            (h) => `── ${h.am4Name} (score ${h.score}) ──\n${formatLineageRecord(h.record, withQuotes, 3)}`,
        );
        return {
            content: [{
                type: 'text',
                text:
                    `Top ${result.hits.length} ${block_type} matches for "${real_gear}":\n\n${blocks.join('\n\n')}`,
            }],
        };
    });

    server.registerTool('am4_lookup_lineages', {
        description: [
            'Validate amp / drive / compressor model enum names before a batch of',
            'destructive writes. Returns the registered canonical enum string for',
            'each ask in one call. Drop-in plural variant of `am4_lookup_lineage`.',
            'WHEN TO USE - this is a CORRECTNESS GATE, not an optimization. The',
            '`am4_apply_preset` / `am4_apply_preset_at` validator REJECTS the entire',
            'call on any unknown enum value, costing a full retry round. Use this',
            'tool to surface the canonical enum string BEFORE writing whenever you',
            'are not 100% sure of the spelling. Specifically: ALL `drive` block',
            'types (no shortcut table covers them - PI Fuzz vs Fuzz Pi vs Big Muff',
            'is a real distinction the validator will reject), amp model variants',
            '(the iconic-amps shortcut table in `am4_apply_preset_at` gives you the',
            'amp FAMILY, not the exact enum suffix - "Dizzy V4" vs "Dizzy V4',
            'Silver 4" is a real distinction), and any compressor / cab / reverb /',
            'delay model you are reaching for from memory rather than the iconic',
            'shortcuts list. For amps that are clearly on the shortcuts list (Vox',
            'AC30, Plexi, Mesa Mark, etc.) the lookup is optional - shortcuts give',
            'the canonical name there.',
            'Iconic use case: at the start of a setlist build, batch every drive',
            'pedal you are considering plus any amp variants you are not 100% sure',
            'about into one lookup_lineages call. Then build presets without',
            'further lineage round-trips and without retry loops on enum mismatches.',
            'Per-ask shape matches `am4_lookup_lineage` exactly:',
            '`{ block_type, name?, real_gear?, manufacturer?, model? }`. Each ask',
            'must supply exactly one of (name) / (real_gear) / (manufacturer and/or',
            'model). Per-ask result is `{ ask, found, hits? | reason }` so partial',
            'successes surface cleanly: a single bad ask never aborts the batch.',
            'Returns full per-ask provenance (the original ask is echoed in each',
            'result entry) so you can correlate results back to the original asks',
            'even after re-ordering or deduplication.',
        ].join(' '),
        inputSchema: {
            asks: z.array(z.object({
                block_type: z.enum(LINEAGE_BLOCKS),
                name: z.string().optional(),
                real_gear: z.string().optional(),
                manufacturer: z.string().optional(),
                model: z.string().optional(),
            })).describe(
                'List of lineage queries to run. Each entry takes the same shape as `am4_lookup_lineage` input. Empty array returns empty results without erroring.',
            ),
            include_quotes: z.boolean().optional().describe(
                'Whether to include Fractal Audio forum quotes in each per-ask hit. Default false (terser response — batch lookups usually feed planning, not user-facing prose). Pass true if you want quote-rich responses.',
            ),
        },
    }, async ({ asks, include_quotes }) => {
        const withQuotes = include_quotes ?? false;
        if (!Array.isArray(asks) || asks.length === 0) {
            const body = {
                results: [],
                asksProcessed: 0,
                asksFound: 0,
                message: 'No asks supplied; nothing to look up. Pass `asks: [{ block_type, name | real_gear | manufacturer | model }, ...]`.',
            };
            return {
                content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
            };
        }

        type PerAskOutput =
            | {
                ask: LineageLookupAsk;
                found: true;
                shape: 'forward' | 'reverse' | 'structured';
                hitCount: number;
                topHit: {
                    am4Name: string;
                    summary: string;
                    score?: number;
                };
                otherHits?: Array<{ am4Name: string; score?: number }>;
                totalScanned: number;
            }
            | {
                ask: LineageLookupAsk;
                found: false;
                shape: 'forward' | 'reverse' | 'structured' | 'invalid';
                reason: string;
                totalScanned?: number;
            };

        const results: PerAskOutput[] = [];
        for (const rawAsk of asks) {
            const ask: LineageLookupAsk = {
                block_type: rawAsk.block_type,
                name: rawAsk.name,
                real_gear: rawAsk.real_gear,
                manufacturer: rawAsk.manufacturer,
                model: rawAsk.model,
            };
            try {
                const r = runLineageLookup(ask);
                if (r.found) {
                    const top = r.hits[0];
                    const otherHits = r.hits.slice(1).map((h) => ({ am4Name: h.am4Name, ...(h.score !== undefined ? { score: h.score } : {}) }));
                    results.push({
                        ask: r.ask,
                        found: true,
                        shape: r.shape,
                        hitCount: r.hits.length,
                        topHit: {
                            am4Name: top.am4Name,
                            summary: formatLineageRecord(top.record, withQuotes, 3),
                            ...(top.score !== undefined ? { score: top.score } : {}),
                        },
                        ...(otherHits.length > 0 ? { otherHits } : {}),
                        totalScanned: r.totalScanned,
                    });
                } else {
                    results.push({
                        ask: r.ask,
                        found: false,
                        shape: r.shape,
                        reason: r.reason,
                        totalScanned: r.totalScanned,
                    });
                }
            } catch (err) {
                // Shape-validation failures (exactly-one-call-shape, real_gear too
                // short, etc.) become per-ask invalid entries so the batch keeps
                // processing the remaining asks. The single-ask tool throws here;
                // the batch tool absorbs and reports.
                results.push({
                    ask,
                    found: false,
                    shape: 'invalid',
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }

        const asksFound = results.filter((r) => r.found).length;
        const body = {
            results,
            asksProcessed: results.length,
            asksFound,
        };
        return {
            content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
        };
    });
}
