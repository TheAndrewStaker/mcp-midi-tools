/**
 * Pure-data discovery tools — `am4_list_params`, `am4_list_block_types`,
 * `am4_list_enum_values`. No MIDI dependencies; they walk the in-memory
 * param / block-type registries and emit a human-readable catalog.
 *
 * `am4_list_params` is the connector live-confirmation tool — its leading
 * line proves the MCP server is reachable, addressing HW-012's
 * "is the connector attached?" UX gap.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    KNOWN_PARAMS,
    type Param,
} from '@/fractal/am4/params.js';
import { resolveBridge } from '@/fractal/am4/parameterBridge.js';
import { describeApplicability } from '@/fractal/am4/applicability.js';
import {
    BLOCK_TYPE_VALUES,
    type BlockTypeName,
} from '@/fractal/am4/blockTypes.js';

import { paramKey } from '@/server/shared/paramHelpers.js';

export function registerLookupTools(server: McpServer): void {
    server.registerTool('am4_list_params', {
        description: [
            'List every parameter the server can write. Use this to discover',
            'capabilities — or as a quick sanity check that the mcp-midi-tools MCP',
            'connector is live and its tools are callable (the response opens with',
            'a confirmation line). If you were about to tell the user "I don\'t',
            'have the connector in this session" without having actually tried a',
            'tool call, call this tool first; if it returns, the connector is',
            'attached and every AM4 tool is available to use.',
            '',
            'Each row is annotated with:',
            '  - [AM4-Edit: "<label>", <PARAMETER_NAME>] — the canonical display',
            '    label the user sees on AM4-Edit\'s UI plus the firmware symbolic',
            '    ID, when known. Use the canonical label in agent output so your',
            '    vocabulary matches what the user reads on screen.',
            '  - {{applies only when <TYPE_ENUM>=[<types>]}} — per-type',
            '    applicability (which amp/delay/reverb/etc. types expose this',
            '    knob). When this annotation is present, the firmware will ack',
            '    writes on any type but the knob only AUDIBLY responds on the',
            '    listed types. Before calling set_param on a type-gated param,',
            '    confirm the active block type matches one of the listed values',
            '    (use get_param on `<block>.type` to read the current type) — if',
            '    not, switch type first OR pick a different param.',
            '  - {{applies to any type (special-cased on: ...)}} — universally',
            '    available, with informational notes about types that have a',
            '    different label or page placement for this param.',
            '  Rows with no {{...}} annotation either have applicability data',
            '  showing always-on or are out-of-band params with no XML decode',
            '  (channel, level, etc.) — treat as always-applicable.',
        ].join(' '),
        inputSchema: {},
    }, async () => {
        const rows = Object.entries(KNOWN_PARAMS).map(([key, p]) => {
            const base = `${key} — unit=${p.unit}, range=[${p.displayMin}..${p.displayMax}]`;
            const enumNote = p.unit === 'enum' && p.enumValues
                ? ` (${Object.keys(p.enumValues).length} options; call list_enum_values for names)`
                : '';
            // Surface the AM4-Edit canonical label when we have a bridge
            // binding. The agent should use this label when describing the
            // parameter to the user — it matches what the user reads on the
            // AM4-Edit screen.
            const bridge = resolveBridge(p.block, p.name);
            const labelNote = bridge
                ? ` [AM4-Edit: "${bridge.canonicalLabel}", ${bridge.parameterName}]`
                : '';
            // Per-type applicability annotation (Session 46 cont 5+ —
            // typeApplicability decode). Tells the agent which AM4 block-type
            // values expose this knob. Empty string = always-on (no decoration
            // needed); undefined = no applicability data (out-of-band registers,
            // params not in the XML — agent should treat as always-on).
            const applicabilityNote = describeApplicability(key);
            const typeNote = applicabilityNote ? ` {{${applicabilityNote}}}` : '';
            return `  ${base}${enumNote}${labelNote}${typeNote}`;
        });
        // Leading confirmation line addresses HW-012 — Claude Desktop sometimes
        // thinks the connector isn't attached when in fact it is but the tool
        // schemas hadn't been loaded yet. Getting this response proves the
        // connector is live.
        const liveConfirmation =
            'mcp-midi-tools MCP server is live and reachable. The unified tool ' +
            'surface (apply_preset, set_param, set_params, set_block, set_bypass, ' +
            'switch_preset, switch_scene, save_preset, rename, scan_locations, ' +
            'restore_defaults, get_param, get_params, describe_device, list_params, ' +
            'lookup_lineage) is registered — pass port="am4" to address this device. ' +
            'A connected AM4 is detected at the OS level via list_midi_ports; this ' +
            'tool responds regardless of whether the AM4 itself is plugged in.';
        return {
            content: [{
                type: 'text',
                text: `${liveConfirmation}\n\nAvailable parameters (${rows.length}):\n${rows.join('\n')}`,
            }],
        };
    });

    // am4_list_block_types removed Phase G — describe_device('am4')
    // returns block_types. am4_list_enum_values removed Phase G —
    // list_params({ port: 'am4', block, name }) returns the enum table.
}
