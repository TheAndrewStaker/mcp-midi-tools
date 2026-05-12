/**
 * Hydrasynth discovery tools — enum-table inspection + NRPN catalog search.
 *
 * 2 tools:
 *   - hydra_list_enum_values  — index→name dump for a named enum table
 *   - hydra_param_catalog     — fuzzy search across the 1175-entry NRPN
 *                               catalog (canonical name, alias, notes)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { HYDRASYNTH_ENUMS } from '../enums.js';
import { findMatchingNrpns, formatNrpnHit } from '../encoding.js';

import { HYDRA_DEV_MODE_PREAMBLE } from './shared.js';

export function registerHydrasynthDiscoveryTools(server: McpServer): void {

// hydra_list_enum_values --------------------------------------------------

server.registerTool('hydra_list_enum_values', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to inspect the named lookup tables backing the Hydrasynth\'s',
    'enum-typed parameters — wave names (OSC_WAVES, 219 entries), filter types',
    '(FILTER_1_TYPES = 16, FILTER_2_TYPES = 2), FX types (FX_TYPES = 10), mutant',
    'modes, ARP modes, vibrato rates, and ~40 more. 49 tables / 2716 entries total.',
    '',
    'When you call hydra_set_engine_param or hydra_set_engine_params for an',
    'enum-typed parameter (filter1type, osc1type, prefxtype, postfxtype,',
    'mutator1mode, etc.), the value field accepts the display name as a string',
    '— e.g. filter1type="Vowel" instead of filter1type=10. This tool helps',
    'you discover which display names a given table contains.',
    '',
    'Without an argument, returns the list of table names + entry counts.',
    'With a name, returns the index→name mapping for that table.',
  ].join('\n'),
  inputSchema: {
    name: z.string().optional().describe('Optional enum-table name (e.g. "FILTER_1_TYPES", "OSC_WAVES", "FX_TYPES"). Case-sensitive. Omit to list all tables.'),
  },
}, async ({ name }) => {
  if (!name) {
    const summary = Object.entries(HYDRASYNTH_ENUMS)
      .map(([n, t]) => `  ${n.padEnd(28)} ${Object.keys(t).length} entries`)
      .join('\n');
    return {
      content: [{
        type: 'text',
        text: `${Object.keys(HYDRASYNTH_ENUMS).length} enum tables:\n${summary}`,
      }],
    };
  }
  const table = HYDRASYNTH_ENUMS[name];
  if (!table) {
    const closest = Object.keys(HYDRASYNTH_ENUMS)
      .filter((n) => n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase().slice(0, 4)))
      .slice(0, 6);
    throw new Error(
      `Unknown enum table "${name}". ${closest.length > 0 ? `Closest matches: ${closest.join(', ')}.` : 'Call hydra_list_enum_values without an argument to see all tables.'}`,
    );
  }
  const rows = Object.entries(table).map(([idx, val]) => `  ${String(idx).padStart(3)}  ${val}`).join('\n');
  return {
    content: [{
      type: 'text',
      text: `${name} (${Object.keys(table).length} entries):\n${rows}`,
    }],
  };
});

// hydra_param_catalog ----------------------------------------------------

server.registerTool('hydra_param_catalog', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Fallback discovery for the full 1175-entry NRPN parameter catalog.**',
    '',
    'Do not call this routinely. The cheat-sheets in hydra_set_engine_param /',
    'hydra_set_engine_params already cover ~95% of patch building, and those tools\'',
    'error responses suggest closest matches when a name doesn\'t resolve. Reach for',
    'this tool ONLY when:',
    '  - the user asks for an exotic param (mod-matrix routing, ribbon controller,',
    '    advanced wavescan slot, BPM-sync edge cases) AND',
    '  - the cheat-sheet doesn\'t list it AND',
    '  - the engine-param error suggestions weren\'t enough.',
    '',
    'Search semantics (`query`):',
    '  - Substring + relaxed match across canonical name, CC-style aliases, and',
    '    notes. Case-insensitive, punctuation-insensitive.',
    '  - Examples:',
    '      query: "vibrato"  → voicevibratoamount, voicevibratoratesyncoff, …',
    '      query: "ringmod"  → ringmoddepth, ringmodsource1/2, mixerringmodvol, …',
    '      query: "vowel"    → params with Vowel-related notes',
    '      query: "mod1"     → mod1source / mod1depth / mod1destination',
    '      query: "filter1.res"  → exact alias hit (filter1resonance)',
    '',
    'Each result line shows: canonical name, CC-style alias (if any), slot index for',
    'multi-slot params, enum-table linkage for type-typed params, and a truncated',
    'note. Bounded to 30 results by default.',
    '',
    'Without a query, returns a one-line meta-help pointer back to the cheat-sheets',
    'in the engine-param tool descriptions.',
  ].join('\n'),
  inputSchema: {
    query: z.string().optional().describe('Substring / fuzzy query against parameter names, aliases, and notes. Omit for meta-help.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results to return. Default 30.'),
  },
}, async ({ query, limit }) => {
  if (!query) {
    return {
      content: [{
        type: 'text',
        text: [
          '1175 NRPN parameters total, organized into ~15 families.',
          '',
          'For routine patch building, use the cheat-sheets embedded in:',
          '  - hydra_set_engine_param  (single-write description)',
          '  - hydra_set_engine_params (batch description)',
          '',
          'Both tools accept canonical NRPN names (e.g. "filter1cutoff") AND',
          'CC-catalog dot-style names (e.g. "filter1.cutoff"). Both forms resolve.',
          '',
          'Pass a `query` to this tool to substring-search the full catalog when a',
          'parameter isn\'t in the cheat-sheets — e.g. query: "ribbon", query: "mod1",',
          'query: "wavescan". Results are ranked by relevance (name > alias > notes).',
        ].join('\n'),
      }],
    };
  }
  const hits = findMatchingNrpns(query, limit ?? 30);
  if (hits.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No parameters match "${query}". Try a broader term (e.g. "filter" instead of "filtercutoffenv"). For type/wave/FX names, see hydra_list_enum_values instead.`,
      }],
    };
  }
  return {
    content: [{
      type: 'text',
      text: `${hits.length} match(es) for "${query}" (canonical name [alias] [slot] [enum] — notes):\n${hits.map(formatNrpnHit).join('\n')}`,
    }],
  };
});

}
