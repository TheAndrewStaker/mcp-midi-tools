/**
 * Axe-Fx II discovery tools — list block types, list params, list enum
 * values, lookup lineage. Read-side / data-side surface; no MIDI I/O
 * for the list/lookup family (lineage is a static JSON lookup).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  AXE_FX_II_BLOCKS,
  resolveBlock,
} from '@/fractal/axe-fx-ii/blockTypes.js';
import { KNOWN_PARAMS, type AxeFxIIParam } from '@/fractal/axe-fx-ii/params.js';
import {
  AXE_FX_II_LINEAGE_BLOCKS,
  formatAxeFxIILineageRecord,
  runAxeFxIILineageLookup,
  type AxeFxIILineageLookupResult,
} from '@/fractal/axe-fx-ii/lineageLookup.js';

import { findBlock, findParam } from './shared.js';

export function registerAxeFxIIDiscoveryTools(server: McpServer): void {


  server.registerTool('axefx2_list_block_types', {
    description: [
      'Use this tool to list every addressable block instance on the user\'s',
      'Axe-Fx II family device. The Axe-Fx II exposes multiple instances of',
      'most block groups (Amp 1 + Amp 2, Reverb 1 + Reverb 2, etc.) — each',
      'instance has a unique 14-bit effectId used in the wire address. All',
      'instances of the same group share the same parameter table; pick the',
      'instance the user is editing (usually "1" unless they\'ve placed a',
      'second one in the signal chain).',
      '',
      'Returns 71 block instances per the wiki. The optional `group` filter',
      'narrows by 3-letter group code (AMP, CPR, REV, DLY, CHO, FLG, PHA,',
      'WAH, GTE, FIL, DRV, ENH, PIT, etc.) — useful when the agent only',
      'cares about which Amp / Drive / Reverb instances exist.',
    ].join('\n'),
    inputSchema: {
      group: z.string().optional().describe(
        'Optional 3-letter group code to filter by (case-insensitive). e.g. "AMP" returns just the Amp instances.',
      ),
    },
  }, async ({ group }) => {
    const filter = group?.trim().toUpperCase();
    const matches = filter
      ? AXE_FX_II_BLOCKS.filter((b) => b.groupCode === filter)
      : AXE_FX_II_BLOCKS.slice();
    if (filter && matches.length === 0) {
      const allGroups = [...new Set(AXE_FX_II_BLOCKS.map((b) => b.groupCode))].sort();
      return {
        content: [{
          type: 'text',
          text: `No blocks match group "${filter}". Valid group codes: ${allGroups.join(', ')}.`,
        }],
      };
    }
    const lines = matches.map((b) =>
      `  ${String(b.id).padStart(3)}  ${b.name.padEnd(22)} (group: ${b.groupCode}${b.canBypass ? '' : ', no-bypass'})`,
    );
    return {
      content: [{
        type: 'text',
        text: [
          `Axe-Fx II addressable blocks${filter ? ` (filtered to ${filter})` : ''}: ${matches.length} instance(s).`,
          'Format: <effectId> <name> (group, flags)',
          ...lines,
          '',
        ].join('\n'),
      }],
    };
  });


  server.registerTool('axefx2_list_params', {
    description: [
      'Use this tool to list every wiki-documented parameter for a given',
      'Axe-Fx II block group. The block group is the 3-letter code (AMP /',
      'CPR / REV / DLY / etc.) or the lowercase block slug (amp / compressor /',
      'reverb / delay) — both resolve. All instances of the same group share',
      'the parameter table, so the listing is per-group rather than per-',
      'instance.',
      '',
      'Each row reports the wire `paramId` (0..255), the snake-case key the',
      'agent passes to axefx2_set_param, the wiki control type (knob / select /',
      'switch), and the wiki-documented display range when populated. Most',
      'knobs have unpopulated ranges in the wiki — for those, treat the wire',
      'value as the source of truth and set 0..65534 directly until display-',
      'range anchors come from a hardware spotcheck.',
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(
        'Block group, e.g. "amp" / "AMP" / "compressor" / "CPR" / "reverb" / "delay". Resolves on both 3-letter wiki code and lowercase slug.',
      ),
    },
  }, async ({ block }) => {
    const upper = block.trim().toUpperCase();
    const lower = block.trim().toLowerCase();
    const all = Object.values(KNOWN_PARAMS) as readonly AxeFxIIParam[];
    const matches = all.filter((p) => p.groupCode === upper || p.block === lower);
    if (matches.length === 0) {
      const groups = [...new Set(all.map((p) => `${p.groupCode}/${p.block}`))].slice(0, 12);
      return {
        content: [{
          type: 'text',
          text:
            `No params for block "${block}". Try the 3-letter group code or the lowercase slug. ` +
            `Sample valid blocks: ${groups.join(', ')}, ...`,
        }],
      };
    }
    const sorted = matches.slice().sort((a, b) => a.paramId - b.paramId);
    const lines = sorted.map((p) => {
      const range = (p.displayMin !== undefined && p.displayMax !== undefined)
        ? ` [${p.displayMin}..${p.displayMax}${p.step !== undefined ? ` step ${p.step}` : ''}]`
        : '';
      const label = p.xmlLabel ? ` "${p.xmlLabel.replace(/\n/g, ' ')}"` : '';
      const enumNote = p.enumValues ? ` (enum, ${Object.keys(p.enumValues).length} values)` : '';
      return `  ${String(p.paramId).padStart(3)}  ${p.name.padEnd(28)} ${p.controlType}${range}${enumNote}${label}`;
    });
    return {
      content: [{
        type: 'text',
        text: [
          `Axe-Fx II params for ${matches[0].block} (group ${matches[0].groupCode}): ${matches.length} parameter(s).`,
          'Format: <paramId> <name> <controlType> [<displayMin..displayMax>] (enum) "<xmlLabel>"',
          ...lines,
          '',
        ].join('\n'),
      }],
    };
  });


  server.registerTool('axefx2_list_enum_values', {
    description: [
      'Use this tool to list the dropdown options for an enum/select',
      'parameter on the user\'s Axe-Fx II — e.g. `amp.effect_type`',
      '(amp model dropdown), `drive.effect_type`, `cab.cab`,',
      '`delay.tempo` (tempo-sync division select), `amp.tone_stack`,',
      '`amp.power_type`, etc. Returns the integer wire value the',
      'device expects + the display name the device shows for each',
      'option.',
      '',
      'Use this BEFORE `axefx2_set_param` on any select/enum param',
      'when the user describes a value by name ("set the amp to a',
      'Plexi", "switch delay to dotted-eighth tempo"). The tool',
      'response gives you the wire integer to pass to set_param with',
      '`interpret: "wire"`.',
      '',
      'Returns an error if the param is not a select/enum type — call',
      '`axefx2_list_params` first to see the param\'s controlType.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Delay 1" or numeric effectId. Call axefx2_list_block_types for the full set.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. e.g. "effect_type", "tempo", "tone_stack". Call axefx2_list_params for the full set.',
      ),
    },
  }, async ({ block, name }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      const groupParams = Object.values(KNOWN_PARAMS as Readonly<Record<string, AxeFxIIParam>>)
        .filter((p) => p.groupCode === target.groupCode);
      const sample = groupParams.slice(0, 8).map((p) => p.name).join(', ');
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Sample valid names: ${sample}, ... — call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }
    if (!param.enumValues) {
      // Two distinct cases produce no enumValues:
      //   1. controlType is 'knob' / 'switch' / 'unknown' — not an enum
      //      semantically; the caller should use axefx2_set_param with
      //      a numeric value (display or wire depending on calibration).
      //   2. controlType is 'select' but the registry has no enum table
      //      backing it (wiki documented the param as a select but didn't
      //      list the dropdown values). The caller still has to write a
      //      numeric wire value, but should also flag the registry gap
      //      for a future calibration sweep to populate.
      if (param.controlType === 'select') {
        throw new Error(
          `${target.name} → ${param.name} is type 'select' but the registry has no ` +
          `enum values populated (gap from the wiki scrape — the wiki documents the ` +
          `param as a select but doesn't list the dropdown options). Pass a wire ` +
          `integer to axefx2_set_param with \`interpret: "wire"\`. Wire 0 is ` +
          `conventionally "None"/"Off" on Fractal selects, but verify by reading ` +
          `back the device label.`,
        );
      }
      throw new Error(
        `${target.name} → ${param.name} is not an enum param (controlType=${param.controlType}). ` +
        `It accepts a numeric value — use axefx2_set_param directly.`,
      );
    }
    const entries = Object.entries(param.enumValues)
      .map(([idx, label]) => ({ idx: Number(idx), label }))
      .sort((a, b) => a.idx - b.idx);
    const rows = entries.map((e) => `  ${String(e.idx).padStart(3)}: ${e.label}`).join('\n');
    return {
      content: [{
        type: 'text',
        text:
          `${target.name} → ${param.name} (paramId ${param.paramId}, group ${target.groupCode}): ` +
          `${entries.length} enum option(s).\n` +
          `Format: <wire_value>: <display_name>\n${rows}\n`,
      }],
    };
  });


  server.registerTool('axefx2_lookup_lineage', {
    description: [
      'Look up Fractal Audio\'s authored lineage info for an Axe-Fx II model —',
      'what real hardware it\'s modeled after, Fractal\'s own description of',
      'the algorithm, and forum quotes from the developer. Data is keyed off',
      'the Axe-Fx II enum tables (UPPERCASE display names like "59 BASSGUY"',
      'or "PLEXI 100W HI 1") and inherits the prose from the shared Fractal',
      'wiki — same source as `am4_lookup_lineage`.',
      '',
      'Status: 🟢 hardware-validated on Q8.02 via HW-084 (2026-05-10) —',
      'all 5 query classes (direct / abbrev-expand / reverse / structured /',
      'reverb-swap) return non-empty ranked results, `matchVia` honestly',
      'surfaced. Known data-quality issues tracked in BACKLOG: forum quotes',
      'are inherited across sibling enum entries in some records (so a',
      'Bassman record may carry Plexi-related quotes — flag the user and',
      'lean on `basedOn` rather than reciting prose), and some enum entries',
      'have no lineage record at all (USA Mark series, Recto Org variants).',
      'Each record carries a `matchVia` field that names the lookup-path used to',
      'find the wiki entry — NOT a confidence rating on the data itself.',
      'When summarizing to the user, do NOT hedge on `direct` /',
      '`abbrev-expand` / `reverb-swap` matches — those are known-good',
      'display-string conventions, the data is reliable. Hedging on them',
      'makes the tool look unreliable when it is not. Hedge only when the',
      'matchVia is `prefix` or `unmatched`, or when the record\'s `flags`',
      'array surfaces a substantive data-quality issue (cross-attributed',
      'forum quotes, missing wiki entry, etc.).',
      '',
      'matchVia values:',
      '  - `direct`         — exact name match against the wiki entry.',
      '                       Same wiki record, same model. Trust the data.',
      '  - `abbrev-expand`  — Axe-Fx II truncates words to fit its 16-char',
      '                       display ("NRML"→"NORMAL", "VIB"→"VIBRATO",',
      '                       "MDRN"→"MODERN", "OR"→"ORANGE"). Same model,',
      '                       different label. Trust the data — a Bassguy',
      '                       Normal IS a Bassguy NRML.',
      '  - `reverb-swap`    — reverb display labels invert wiki word order',
      '                       ("MEDIUM HALL" matches wiki "Hall, Medium").',
      '                       Same algorithm, different label. Trust the data.',
      '  - `prefix`         — Axe-Fx II uses a family-head abbreviation that',
      '                       PREFIXES a more specific wiki entry ("USA IIC+"',
      '                       could match "USA Mark IIC+ Lead Bright" or',
      '                       "USA Mark IIC+ Rhythm"). Family-level lineage',
      '                       (manufacturer, era, basic topology) is solid.',
      '                       Specifics (which channel, which mod) are',
      '                       approximate — surface that to the user.',
      '  - `unmatched`      — no wiki record found. The model name is real',
      '                       (it\'s in the firmware), but lineage prose is',
      '                       not yet sourced. Tell the user the model exists',
      '                       but lineage data isn\'t available.',
      '',
      'Substantive flags to surface to the user when present:',
      '  - `INHERITED: lineage from sibling "X"` — basedOn / tubes / cab',
      '    were back-filled from a sibling amp record. For amp-family',
      '    siblings (Plexi 50W Normal/High/Jumped) this is fine — the same',
      '    real amp at slightly different settings. For non-sibling',
      '    inheritance, basedOn might be wrong; check the sibling name vs',
      '    the model name and flag if they\'re from different families.',
      '  - Forum quotes that mention a different amp family than the record',
      '    name (e.g. Plexi quotes on a Bassguy record) — there is a known',
      '    AM4 wiki-parser bug where cross-cutting "Regarding the following',
      '    X models" prose attaches to the prior entry. If the quotes name a',
      '    different amp than the record, FILTER them — don\'t surface them',
      '    as authoritative. Tracked for fix in extract-lineage.ts.',
      '',
      'Three call shapes (exactly one required):',
      '  (a) forward — { block_type, name }: return the record matching that',
      '      Axe-Fx II display name (case-insensitive substring match against',
      '      axefx2Name, am4Name, or wikiName).',
      '  (b) reverse by real_gear — { block_type, real_gear }: substring',
      '      search across basedOn / description / forum quotes. Returns the',
      '      top 10 ranked matches. Use for fuzzy queries — including artist',
      '      references ("Cantrell tone", "Knopfler clean") which match the',
      '      artist names in Fractal\'s description prose.',
      '  (c) structured filter — { block_type, manufacturer?, model? }:',
      '      exact-match against basedOn\'s structured fields. Most precise',
      '      for queries like "MXR phaser" (manufacturer="MXR") or "1176"',
      '      (model="1176"). Multiple structured fields AND together.',
      '',
      'Block coverage: amp (259 enum / 196 matched), drive (36 / 34),',
      'reverb (43 / 25), delay (18 / 17). Compressor / chorus / flanger /',
      'phaser / wah lineage exists for AM4 but isn\'t yet re-keyed for the',
      'Axe-Fx II — defer to `am4_lookup_lineage` for those blocks until',
      'the extractor covers them.',
      '',
      'Response text is designed to be read by Claude, not shown verbatim',
      'to the user — pull out the axefx2Name + match status and summarize',
      'the lineage in your own words.',
    ].join(' '),
    inputSchema: {
      block_type: z.enum(AXE_FX_II_LINEAGE_BLOCKS).describe(
        'Which block\'s lineage to query. Currently amp / drive / reverb / delay (cab is post-MVP; compressor / phaser / chorus / flanger / wah are AM4-only for now).',
      ),
      name: z.string().optional().describe(
        'Axe-Fx II display name for forward lookup. Case-insensitive. Examples: "59 BASSGUY", "PLEXI 100W HI 1", "RECTO2 RED MDRN", "MEDIUM HALL", "PI FUZZ".',
      ),
      real_gear: z.string().optional().describe(
        'Real-hardware query for fuzzy reverse search (e.g. "1176", "Tube Screamer", "EMT 140", "Fender Twin"). Returns the top Axe-Fx II models whose lineage text mentions the term.',
      ),
      manufacturer: z.string().optional().describe(
        'Exact manufacturer filter (case-insensitive): "Fender", "Marshall", "Mesa", "MXR", "Ibanez", "TC Electronic". Use alone or combined with model.',
      ),
      model: z.string().optional().describe(
        'Exact model identifier filter (case-insensitive): "TS-9", "LA-2A", "5F1", "1176", "2290". Use alone or combined with manufacturer.',
      ),
      include_quotes: z.boolean().optional().describe(
        'Whether to include Fractal Audio forum quotes in the response. Default true. Pass false for a terser response when you only need the description / basedOn summary.',
      ),
    },
  }, async ({ block_type, name, real_gear, manufacturer, model, include_quotes }) => {
    const withQuotes = include_quotes ?? true;
    let result: AxeFxIILineageLookupResult;
    try {
      result = runAxeFxIILineageLookup({ block_type, name, real_gear, manufacturer, model });
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }

    if (!result.found) {
      if (result.shape === 'structured') {
        const filter = [
          manufacturer && `manufacturer="${manufacturer}"`,
          model && `model="${model}"`,
        ].filter(Boolean).join(', ');
        return {
          content: [{
            type: 'text',
            text:
              `No ${block_type} records match ${filter}. ${result.totalScanned} records scanned. ` +
              `Try a fuzzy search with real_gear if you're unsure of the exact brand/model spelling.`,
          }],
        };
      }
      if (result.shape === 'forward') {
        return {
          content: [{
            type: 'text',
            text:
              `No ${block_type} lineage record matches "${name}". The Axe-Fx II ${block_type}-lineage ` +
              `catalog has ${result.totalScanned} records; try a reverse search with real_gear if you ` +
              `know the real hardware but not the exact Axe-Fx II display name.`,
          }],
        };
      }
      // reverse miss
      return {
        content: [{
          type: 'text',
          text:
            `No ${block_type} records mention "${real_gear}". Searched across ${result.totalScanned} records. ` +
            `Try a different spelling (e.g. "TS9" vs "Tube Screamer", "EVH" vs "5150") or widen the query.`,
        }],
      };
    }

    if (result.shape === 'forward') {
      return {
        content: [{
          type: 'text',
          text: formatAxeFxIILineageRecord(result.hits[0].record, withQuotes),
        }],
      };
    }

    if (result.shape === 'structured') {
      const blocks = result.hits.map(
        (h) => `── ${h.axefx2Name} ──\n${formatAxeFxIILineageRecord(h.record, withQuotes, 3)}`,
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
      (h) => `── ${h.axefx2Name} (score ${h.score}) ──\n${formatAxeFxIILineageRecord(h.record, withQuotes, 3)}`,
    );
    return {
      content: [{
        type: 'text',
        text:
          `Top ${result.hits.length} ${block_type} matches for "${real_gear}":\n\n${blocks.join('\n\n')}`,
      }],
    };
  });

}
