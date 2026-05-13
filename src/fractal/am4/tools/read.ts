/**
 * AM4 working-buffer + device-state read tools (8 tools).
 *
 * - `am4_get_block_layout` — 4-slot block-type read (HW-044).
 * - `am4_get_param` / `am4_get_params` — single + batched param reads (HW-044).
 * - `am4_get_active_scene` / `am4_get_active_location` — device-state reads
 *   (HW-047).
 * - `am4_get_preset_name` / `am4_scan_locations` — non-destructive name
 *   reads (HW-070).
 * - `am4_get_block_bypass` — long-form bypass-flag read (HW-066).
 *
 * All tools share `sendReadAndParse` / `readPresetName` from
 * `@/server/shared/readOps.js`. They never modify device state or the
 * connection cache except for `lastKnownType` cache writes via
 * `observeReadParam` (so a subsequent `set_param` can preflight
 * applicability without an extra round-trip).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    KNOWN_PARAMS,
    decode,
    formatDisplay,
    formatUnitSuffix,
    type Param,
} from '@/fractal/am4/params.js';
import { resolveBridge } from '@/fractal/am4/parameterBridge.js';
import {
    BLOCK_NAMES_BY_VALUE,
    BLOCK_TYPE_VALUES,
    resolveBlockType,
} from '@/fractal/am4/blockTypes.js';
import { formatLocationDisplay, parseLocationCode } from '@/fractal/am4/locations.js';
import {
    BLOCK_SLOT_PID_HIGH_BASE,
    BLOCK_SLOT_PID_LOW,
    buildReadParam,
    isReadResponseLong,
    parseLongReadBypassFlag,
    parseReadResponse,
    READ_TYPE_LONG,
} from '@/fractal/am4/setParam.js';

import { ensureMidi } from '@/server/shared/connections.js';
import { observeReadParam, switchBlockChannel } from '@/server/shared/channels.js';
import { paramKey } from '@/server/shared/paramHelpers.js';
import { READ_RESPONSE_TIMEOUT_MS, readPresetName, sendReadAndParse } from '@/server/shared/readOps.js';

// -- Device-state register addresses (HW-047, Session 43) -------------------
//
// Three "what is the device currently doing" reads, decoded HW-047:
// active scene, active preset location, per-block bypass. Each register
// uses a different encoding (scene + preset = raw u32 LE int; bypass =
// inverted Q15-ish where 0 = bypassed, 32767 = active). The fourth
// register we tried (per-block channel at pidHigh=0x07D2) returned an
// encoding we couldn't decode in HW-047 — `get_active_channel` is queued
// as HW-048 for follow-up.

const SCENE_STATE_PID_LOW = 0x00ce;
const SCENE_STATE_PID_HIGH = 0x000d;
const LOCATION_STATE_PID_LOW = 0x00ce;
const LOCATION_STATE_PID_HIGH = 0x000a;
const BYPASS_STATE_PID_HIGH = 0x0003;

export function registerReadTools(server: McpServer): void {
    server.registerTool('am4_get_block_layout', {
        description: [
            'Read the current 4-slot block layout from the AM4 working buffer.',
            'Returns the block type at each signal-chain position 1..4 — e.g.',
            '"Slot 1: filter, Slot 2: amp, Slot 3: delay, Slot 4: reverb" — or',
            '"none" for empty slots. Use this BEFORE proposing layout changes so',
            'the user can see the diff in chat ("you currently have drive→amp→',
            'delay→reverb; I\'ll change slot 1 from drive to compressor").',
            'Read-only, ~4 wire round-trips, < 200 ms total. Does not affect any',
            'audible state. Block names match the dictionary in list_block_types.',
            'For per-block bypass state (which slots are off in the current scene)',
            'this tool does not yet read; use the AM4 display or AM4-Edit for that',
            'until the bypass-read decode lands.',
        ].join(' '),
        inputSchema: {},
    }, async () => {
        const conn = ensureMidi();
        const slots: { position: 1 | 2 | 3 | 4; name: string; pidLow: number }[] = [];
        for (const position of [1, 2, 3, 4] as const) {
            const pidHigh = BLOCK_SLOT_PID_HIGH_BASE + (position - 1);
            try {
                const parsed = await sendReadAndParse(conn, BLOCK_SLOT_PID_LOW, pidHigh);
                const u32 = parsed.asUInt32LE();
                const name = BLOCK_NAMES_BY_VALUE[u32] ?? `unknown(0x${u32.toString(16)})`;
                slots.push({ position, name, pidLow: u32 });
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                return {
                    content: [{
                        type: 'text',
                        text:
                            `Slot-${position} read failed: ${reason}. ` +
                            `Stopped after reading ${slots.length}/4 slots. ` +
                            `If this is the first failed read in a while, the MIDI handle ` +
                            `may be stale — call reconnect_midi and retry.`,
                    }],
                    isError: true,
                };
            }
        }
        const summary = slots
            .map((s) => `  Slot ${s.position}: ${s.name} (pidLow=0x${s.pidLow.toString(16).padStart(4, '0')})`)
            .join('\n');
        return {
            content: [{
                type: 'text',
                text:
                    `Working-buffer block layout (read from AM4):\n${summary}\n\n` +
                    `Note: this tool reads which block occupies each slot, not whether ` +
                    `each block is bypassed in the current scene. "none" = empty slot.`,
            }],
        };
    });

    server.registerTool('am4_get_param', {
        description: [
            'Read the current value of a single parameter from the AM4 working',
            'buffer. Returns the display value (knob 0-10, dB, ms, %, enum name).',
            'PRIMARY USE: anchor relative-change requests. When the user says',
            '"more gain", "a bit less treble", "increase the master significantly",',
            '"double the delay time", call this FIRST to read the starting value,',
            'then compute the absolute target and call set_param with it. Without',
            'reading first, the agent has to guess the absolute value and will',
            'usually miss (gain at 2.0 → +3 = "significantly"; gain at 8.0 → +1 =',
            '"significantly"; same word, very different writes).',
            'SECONDARY USE: summarize before changing — "amp.gain is currently 3.00;',
            'I\'ll change it to 6.50" gives the user a chance to redirect.',
            'TEMPO PAIRING: when reading `delay.time` or any modulation `rate`',
            '(chorus / flanger / phaser / tremolo / rotary), read the block\'s',
            '`tempo` in the SAME call (use get_params). If `tempo` is non-NONE,',
            'the timing is locked to song tempo and the time/rate value reported',
            'is the derived/effective number, not a free setting — see set_param\'s',
            'TEMPO/TIME DISCIPLINE for the write-side rule.',
            'Mirrors set_param\'s addressing: pass block ("amp") and name ("gain").',
            'For amp/drive/reverb/delay params, the read returns whatever channel',
            'the block is currently on (same channel-scoping caveat as set_param)',
            '— pass `channel` to read a specific A/B/C/D, or omit for the active',
            'channel.',
            'Read-only, single wire round-trip, < 100 ms.',
        ].join(' '),
        inputSchema: {
            block: z.string().describe('Block name, e.g. "amp", "drive", "reverb", "delay"'),
            name: z.string().describe('Parameter name within the block, e.g. "gain", "type", "mix"'),
            channel: z.union([z.string(), z.number()]).optional().describe(
                'Optional. If supplied, the server first switches the block to this A/B/C/D before reading. Only valid for amp / drive / reverb / delay. Omit to read whatever channel the block is currently on.',
            ),
        },
    }, async ({ block, name, channel }) => {
        const key = paramKey(block, name);
        const param: Param = KNOWN_PARAMS[key];
        const conn = ensureMidi();
        let channelSwitched = false;
        if (channel !== undefined) {
            const switchResult = await switchBlockChannel(conn, block, channel);
            channelSwitched = switchResult.switched;
        }
        let parsed: ReturnType<typeof parseReadResponse>;
        try {
            parsed = await sendReadAndParse(conn, param.pidLow, param.pidHigh);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text:
                        `Read of ${key} failed: ${reason}. ` +
                        `If this is the first failed read in a while, the MIDI handle ` +
                        `may be stale — call reconnect_midi and retry.`,
                }],
                isError: true,
            };
        }
        const u32 = parsed.asUInt32LE();
        let display: string;
        let numericForCache = NaN;
        if (param.unit === 'enum') {
            const enumName = param.enumValues?.[u32];
            display = enumName !== undefined
                ? `"${enumName}" (wire index ${u32})`
                : `wire index ${u32} (no enum name registered for this index — possible cache drift)`;
            numericForCache = u32;
        } else {
            const value = decode(param, parsed.asInternalFloat());
            display = `${formatDisplay(param, value)}${formatUnitSuffix(param)}`;
            numericForCache = value;
        }
        // Populate lastKnownType cache when the agent reads a block-type enum,
        // so the next set_param on that block can preflight applicability
        // without an extra wire round-trip.
        if (Number.isFinite(numericForCache)) {
            observeReadParam(param.block, param.name, numericForCache);
        }
        const channelLine = channelSwitched ? ` (switched ${block} channel before reading)` : '';
        const bridge = resolveBridge(param.block, param.name);
        const labelTag = bridge ? ` (AM4-Edit: "${bridge.canonicalLabel}")` : '';
        return {
            content: [{
                type: 'text',
                text: `${key}${labelTag} = ${display}${channelLine}`,
            }],
        };
    });

    server.registerTool('am4_get_params', {
        description: [
            'Read multiple parameters from the AM4 working buffer in one call.',
            'Each entry is {block, name} — same addressing as set_param / get_param.',
            'Use this before bulk changes (e.g. "what is the amp\'s tone stack',
            'currently?") to summarize state in one round before issuing writes.',
            'Reads run sequentially against the wire (~50 ms each); for N params',
            'this is ~N × 50 ms total. Read-only, no audible side effects.',
        ].join(' '),
        inputSchema: {
            params: z.array(z.object({
                block: z.string(),
                name: z.string(),
            })).describe('Array of {block, name} entries to read.'),
        },
    }, async ({ params }) => {
        if (params.length === 0) {
            return { content: [{ type: 'text', text: 'No params requested.' }] };
        }
        const conn = ensureMidi();
        const lines: string[] = [];
        for (const { block, name } of params) {
            const key = paramKey(block, name);
            const param: Param = KNOWN_PARAMS[key];
            try {
                const parsed = await sendReadAndParse(conn, param.pidLow, param.pidHigh);
                const u32 = parsed.asUInt32LE();
                let display: string;
                if (param.unit === 'enum') {
                    const enumName = param.enumValues?.[u32];
                    display = enumName !== undefined ? `"${enumName}"` : `wire index ${u32}`;
                } else {
                    const value = decode(param, parsed.asInternalFloat());
                    display = `${formatDisplay(param, value)}${formatUnitSuffix(param)}`;
                }
                const bridge = resolveBridge(param.block, param.name);
                const labelTag = bridge ? ` (AM4-Edit: "${bridge.canonicalLabel}")` : '';
                lines.push(`  ${key}${labelTag} = ${display}`);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                lines.push(`  ${key} = <read failed: ${reason}>`);
            }
        }
        return {
            content: [{
                type: 'text',
                text: `Read ${params.length} param(s):\n${lines.join('\n')}`,
            }],
        };
    });

    server.registerTool('am4_get_active_scene', {
        description: [
            'Read the AM4\'s currently active scene number (1..4). Use this when',
            'the user asks "what scene am I on?" or as part of a session-opener',
            'that summarizes current device state. Read-only, single round-trip,',
            '< 100 ms. Wire address: pidLow=0x00CE, pidHigh=0x000D — same family',
            'as preset switch and block placement. Encoding decoded HW-047:',
            'raw u32 little-endian integer = scene index (0..3); display = index + 1.',
        ].join(' '),
        inputSchema: {},
    }, async () => {
        const conn = ensureMidi();
        try {
            const parsed = await sendReadAndParse(conn, SCENE_STATE_PID_LOW, SCENE_STATE_PID_HIGH);
            const sceneIndex = parsed.asUInt32LE();
            if (sceneIndex < 0 || sceneIndex > 3) {
                return {
                    content: [{
                        type: 'text',
                        text: `AM4 returned an unexpected scene index ${sceneIndex} (expected 0..3). Raw u32 = 0x${sceneIndex.toString(16)}.`,
                    }],
                    isError: true,
                };
            }
            return {
                content: [{
                    type: 'text',
                    text: `Active scene: ${sceneIndex + 1} (wire index ${sceneIndex})`,
                }],
            };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: `Active-scene read failed: ${reason}. If this is the first failed read in a while, the MIDI handle may be stale — call reconnect_midi.`,
                }],
                isError: true,
            };
        }
    });

    server.registerTool('am4_get_active_location', {
        description: [
            'Read the AM4\'s currently active preset location code (e.g. "W04",',
            '"A01", "Z04"). Use this when the user asks "what preset am I on?"',
            'or to anchor "tweak this preset" requests. Read-only, single round-',
            'trip, < 100 ms. Wire address: pidLow=0x00CE, pidHigh=0x000A. Encoding',
            'decoded HW-047: raw u32 little-endian integer = location index 0..103,',
            'mapped to A01..Z04 via the standard 4-per-bank scheme.',
        ].join(' '),
        inputSchema: {},
    }, async () => {
        const conn = ensureMidi();
        try {
            const parsed = await sendReadAndParse(conn, LOCATION_STATE_PID_LOW, LOCATION_STATE_PID_HIGH);
            const locationIndex = parsed.asUInt32LE();
            if (locationIndex < 0 || locationIndex > 103) {
                return {
                    content: [{
                        type: 'text',
                        text: `AM4 returned an unexpected location index ${locationIndex} (expected 0..103). Raw u32 = 0x${locationIndex.toString(16)}.`,
                    }],
                    isError: true,
                };
            }
            const code = formatLocationDisplay(locationIndex);
            return {
                content: [{
                    type: 'text',
                    text: `Active preset location: ${code} (wire index ${locationIndex})`,
                }],
            };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: `Active-location read failed: ${reason}. If this is the first failed read in a while, the MIDI handle may be stale — call reconnect_midi.`,
                }],
                isError: true,
            };
        }
    });

    // am4_get_preset_name removed Phase G — same data via
    // scan_locations({ port: 'am4', from: 'M03', to: 'M03' }) which
    // returns a single-entry results array with the same shape. The
    // unified scan_locations handles single-location reads; the
    // device-namespaced tool was a thin convenience that's no longer
    // load-bearing.

    server.registerTool('am4_scan_locations', {
        description: [
            'Bulk-scan a range of preset locations (inclusive) and return their',
            'stored names. Non-destructive: working-buffer state is preserved.',
            'Iconic use: setlist-load opener. Before bulk-applying patches into a',
            'target bank range, scan the range first to find which locations',
            'already hold custom presets the user might want to back up, and which',
            'are empty / safe to overwrite.',
            'Empty locations come back as { name: "<EMPTY>", isEmpty: true } so',
            'you can preserve that wording in chat output ("M03 is empty; M04',
            'holds your "Texas Blues" preset").',
            'Performance: each location is one wire round-trip (~3-5 ms on the',
            'AM4); a full 104-location scan is ~350 ms, a one-bank scan (4',
            'locations) is effectively instant. Well within the conversational',
            'latency budget — no progress message needed.',
            'On a mid-loop failure (e.g. a single timeout on one location) the',
            'scan aborts and surfaces the partial results plus the failure',
            'location so the caller can decide whether to retry or back off.',
            'Wire details same as am4_get_preset_name — see that tool\'s docs.',
        ].join(' '),
        inputSchema: {
            from: z.string().describe(
                'Inclusive start of the scan range, format A01..Z04 (e.g. "A01" for the start of bank A).',
            ),
            to: z.string().describe(
                'Inclusive end of the scan range, format A01..Z04 (e.g. "A04" for the end of bank A; "Z04" for end of all banks).',
            ),
        },
    }, async ({ from, to }) => {
        const fromNorm = from.trim().toUpperCase();
        const toNorm = to.trim().toUpperCase();
        let fromIdx: number;
        let toIdx: number;
        try {
            fromIdx = parseLocationCode(fromNorm);
            toIdx = parseLocationCode(toNorm);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{ type: 'text', text: `Invalid range "${from}".."${to}": ${reason}` }],
                isError: true,
            };
        }
        if (fromIdx > toIdx) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Invalid range: "${from}" (index ${fromIdx}) is after "${to}" (index ${toIdx}). ` +
                        `Pass from <= to (e.g. from="A01", to="Z04" for a full scan).`,
                }],
                isError: true,
            };
        }
        const conn = ensureMidi();
        const results: { location: string; name: string; isEmpty: boolean }[] = [];
        let failureLocation: string | undefined;
        let failureReason: string | undefined;
        for (let i = fromIdx; i <= toIdx; i++) {
            try {
                const parsed = await readPresetName(conn, i);
                results.push({
                    location: formatLocationDisplay(i),
                    name: parsed.name,
                    isEmpty: parsed.isEmpty,
                });
            } catch (err) {
                failureLocation = formatLocationDisplay(i);
                failureReason = err instanceof Error ? err.message : String(err);
                break;
            }
        }
        const lines = results.map((r) => `  ${r.location}: ${r.isEmpty ? '<EMPTY>' : `"${r.name}"`}`);
        if (failureLocation !== undefined) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Scan aborted at ${failureLocation}: ${failureReason}.\n` +
                        `Partial results (${results.length}/${toIdx - fromIdx + 1} scanned):\n` +
                        (lines.length > 0 ? lines.join('\n') : '  (no locations scanned)') +
                        `\n\nIf this is the first failed read in a while, the MIDI handle may be stale — call reconnect_midi.`,
                }],
                isError: true,
            };
        }
        const total = results.length;
        const populated = results.filter((r) => !r.isEmpty).length;
        return {
            content: [{
                type: 'text',
                text:
                    `Scanned ${total} location(s) ${formatLocationDisplay(fromIdx)}..${formatLocationDisplay(toIdx)} ` +
                    `(${populated} populated, ${total - populated} empty):\n` +
                    lines.join('\n'),
            }],
        };
    });

    server.registerTool('am4_get_block_bypass', {
        description: [
            'Read whether a block is bypassed (silent) or active in the AM4\'s',
            'currently-selected scene. Returns "active" or "bypassed". Use this',
            'when the user asks "is the amp on?" or before changing a param on a',
            'block they may have toggled off. Read-only, single round-trip,',
            '< 100 ms. Wire address: pidLow=blockTypeValue (e.g. amp=0x003A),',
            'pidHigh=0x0003, action=0x0d (long-form param descriptor read — the',
            'same poll AM4-Edit uses to keep its UI in sync with front-panel',
            'bypass toggles). Bypass flag is byte 22 of the 64-byte response;',
            'value 1 = bypassed, value 0 = active. Encoding pinned HW-066',
            '(Session 48). Tracks live state regardless of whether the bypass',
            'last changed via this MCP tool, the front panel, or AM4-Edit.',
        ].join(' '),
        inputSchema: {
            block: z.string().describe('Block name, e.g. "amp", "drive", "reverb", "delay", "compressor", "filter"'),
        },
    }, async ({ block }) => {
        const blockTypeValue = resolveBlockType(block);
        if (blockTypeValue === undefined) {
            const known = Object.keys(BLOCK_TYPE_VALUES).join(', ');
            return {
                content: [{
                    type: 'text',
                    text: `Unknown block "${block}". Known: ${known}.`,
                }],
                isError: true,
            };
        }
        if (blockTypeValue === BLOCK_TYPE_VALUES.none) {
            return {
                content: [{
                    type: 'text',
                    text: `"none" isn't a real block — it represents an empty slot. Pass a real block name like "amp" or "drive".`,
                }],
                isError: true,
            };
        }
        const conn = ensureMidi();
        try {
            const readBytes = buildReadParam(
                { pidLow: blockTypeValue, pidHigh: BYPASS_STATE_PID_HIGH },
                READ_TYPE_LONG,
            );
            const respPromise = conn.receiveSysExMatching(
                (resp) => isReadResponseLong(readBytes, resp),
                READ_RESPONSE_TIMEOUT_MS,
            );
            conn.send(readBytes);
            const resp = await respPromise;
            const bypassed = parseLongReadBypassFlag(resp);
            return {
                content: [{
                    type: 'text',
                    text: `${block} is ${bypassed ? 'bypassed' : 'active'} in the current scene.`,
                }],
            };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: `Bypass read for ${block} failed: ${reason}. If this is the first failed read in a while, the MIDI handle may be stale — call reconnect_midi.`,
                }],
                isError: true,
            };
        }
    });
}
