/**
 * Navigation, save, rename, dump tools (7 tools):
 * - `am4_save_to_location` — persist working buffer to a slot.
 * - `am4_set_preset_name` — rename working buffer.
 * - `am4_save_preset` — composite rename + save.
 * - `am4_set_scene_name` — rename a scene in the working buffer.
 * - `am4_switch_preset` — load a stored slot into the working buffer.
 * - `am4_request_active_buffer_dump` — non-destructive dump (BK-036 probe).
 * - `am4_switch_scene` — switch active scene within the current preset.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    buildRequestActiveBufferDump,
    buildSaveToLocation,
    buildSetPresetName,
    buildSetSceneName,
    buildSwitchPreset,
    buildSwitchScene,
    isCommandAck,
    isWriteEcho,
} from '@/fractal/am4/setParam.js';
import { receivePresetDumpStream } from '@/fractal/am4/presetDump.js';
import { formatLocationCode, parseLocationCode } from '@/fractal/am4/locations.js';
import { toHex } from '@/fractal/am4/midi.js';

import { ensureMidi } from '@/server/shared/connections.js';
import { invalidateChannelCache } from '@/server/shared/channels.js';
import {
    formatAcklessHint,
    formatInboundCapture,
    recordInbound,
    sendAndAwaitAck,
} from '@/server/shared/wireOps.js';

const PRESET_DUMP_RECEIVE_TIMEOUT_MS = 2000;

export function registerNavigationTools(server: McpServer): void {
    server.registerTool('am4_save_to_location', {
        description: [
            'Use this tool to persist the working-buffer preset to a preset location',
            'on the user\'s AM4. Do not produce a written spec instead of calling',
            'this tool unless the user explicitly asks for a dry run.',
            'SAVE INTENT REQUIRED: call this tool ONLY when the user has explicitly',
            'asked to save, persist, store, or keep the preset (e.g. "save this",',
            '"put it on Z04", "keep this one"). Do NOT call save_to_location as an',
            'automatic follow-up to apply_preset — apply is reversible (the user can',
            'switch presets to discard), save is not. A request like "build a preset',
            'for X" is a try-it-out ask; without an explicit save phrase, apply and',
            'let the user decide whether to save.',
            'Persist the AM4\'s current working-buffer preset (everything laid out',
            'via apply_preset / set_block_type / set_param) into a preset location',
            'so it survives power-cycling. Location naming is the AM4\'s native',
            'format: bank letter A..Z + sub-index 01..04 (e.g. "A01", "M03", "Z04"),',
            '104 total preset locations across 26 banks.',
            'CANONICAL FLOW FOR PERSISTING A NAMED PRESET: call set_preset_name first',
            'to rename the working buffer, then save_to_location to persist. Or use',
            'the composite save_preset tool, which does both in one call.',
            'WRITE SAFETY: any A01..Z04 location is accepted (the historical Z04-only',
            'hard-gate was lifted Session 49 — saves to inactive locations are a real',
            'workflow, confirmed HW-064 where the device sat on Z03 and the save',
            'persisted to Z04 successfully). Agents must still treat saves as',
            'destructive: do NOT call this tool unless the user has explicitly asked',
            'to save / persist / store. If the target location is non-empty, confirm',
            'the user knows they are about to overwrite it; "save to A01" without',
            'context is suspicious and worth a single-sentence "are you sure? A01',
            'currently has X" before proceeding. The user\'s scratch slot for',
            'try-it-out tone work is "Z04" by convention.',
            'The ack shape is the standard 18-byte command-ack — the tool reports',
            'success cleanly; if no ack arrives, the raw inbound SysEx is dumped',
            'for diagnostic visibility.',
        ].join(' '),
        inputSchema: {
            location: z.string().describe(
                'AM4 preset location, format: bank letter A..Z + sub-index 01..04 (e.g. "A01", "M03", "Z04"). 104 valid locations across 26 banks. By convention "Z04" is the scratch slot.',
            ),
        },
    }, async ({ location }) => {
        const normalized = location.trim().toUpperCase();
        const locationIndex = parseLocationCode(normalized);
        const bytes = buildSaveToLocation(locationIndex);
        const conn = ensureMidi();
        // Hydra-explorer-style inbound capture so the response shows whether
        // the device emitted Save ACK + how long it took. Save is one of the
        // tools where a missing ack genuinely matters (no audible feedback —
        // user can't tell whether their preset persisted), so the timeline
        // here pays for itself diagnostically more often than for set_param.
        const capture = recordInbound(conn);
        let result: Awaited<ReturnType<typeof sendAndAwaitAck>>;
        try {
            result = await sendAndAwaitAck(conn, bytes, isCommandAck);
        } finally {
            capture.unsubscribe();
        }
        const inboundBlock = formatInboundCapture(capture);
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Saved working buffer to ${formatLocationCode(locationIndex)}. AM4 ack received.\n\n${inboundBlock}`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Save to ${formatLocationCode(locationIndex)} sent but no ack received. ` +
                    `Verify on the AM4 (navigate to the location and check the expected ` +
                    `layout / params are present).\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured) +
                    `\n\n${inboundBlock}`,
            }],
        };
    });

    server.registerTool('am4_set_preset_name', {
        description: [
            'Use this tool to rename the AM4\'s working-buffer preset on the user\'s',
            'hardware. Do not produce a written spec instead of calling this tool',
            'unless the user explicitly asks for a dry run.',
            'Rename the AM4\'s current working-buffer preset. Names can be up to 32',
            'ASCII-printable characters; shorter names are space-padded on the wire',
            '(AM4 convention).',
            'SCOPE: writes to the working buffer only. The name does NOT persist',
            'across preset loads on its own — call save_to_location afterward to',
            'write the working buffer (including the new name) to a preset location.',
            'Or use the composite save_preset tool, which does rename + save in one',
            'call. Confirmed on hardware HW-002 (2026-04-19): rename alone is lost',
            'when a different preset is loaded, while rename + save_to_location',
            'persists correctly.',
            'WRITE SAFETY: any A01..Z04 location accepted (historical Z04-only gate',
            'lifted Session 49). Same as save_to_location, the rename is destructive',
            'in the sense that it changes the working-buffer name; only persists if',
            'paired with save_to_location.',
        ].join(' '),
        inputSchema: {
            location: z.string().describe(
                'AM4 preset location, format: bank letter A..Z + sub-index 01..04. By convention "Z04" is the scratch slot.',
            ),
            name: z.string().max(32).describe(
                'New preset name, up to 32 ASCII-printable characters. Shorter names are space-padded to 32 on the wire.',
            ),
        },
    }, async ({ location, name }) => {
        const normalized = location.trim().toUpperCase();
        const locationIndex = parseLocationCode(normalized);
        const bytes = buildSetPresetName(locationIndex, name);
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isCommandAck);
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Renamed working-buffer preset → "${name}". AM4 ack received. ` +
                        `The name is in the working buffer only — call save_to_location to persist.`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Rename sent for "${name}" but no ack received. ` +
                    `Verify on the AM4 display or in AM4-Edit.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });

    server.registerTool('am4_save_preset', {
        description: [
            'Use this tool to rename AND persist the working-buffer preset to a',
            'location on the user\'s AM4 in one call. Do not produce a written spec',
            'instead of calling this tool unless the user explicitly asks for a dry',
            'run.',
            'SAVE INTENT REQUIRED: call this tool ONLY when the user has explicitly',
            'asked to save, persist, or store the preset. Same rule as',
            'save_to_location — apply_preset is reversible; save_preset is not. A',
            'bare "make me a preset for Y" is a try-it-out ask, not a save ask.',
            'When in doubt, use apply_preset (with its optional name field) and ask',
            'the user whether to persist.',
            'Compose set_preset_name + save_to_location into a single call. The',
            'canonical flow for persisting a named preset: renames the working',
            'buffer, then saves it to the target location. Fails cleanly if the',
            'rename step doesn\'t ack (save is skipped to avoid persisting the',
            'old name).',
            'WRITE SAFETY: any A01..Z04 location accepted (Z04-only gate lifted',
            'Session 49). Same destructive-save semantics as save_to_location —',
            'agents must not auto-call this without an explicit save phrase from',
            'the user, and should confirm before overwriting a non-empty slot.',
            'Use this instead of chaining set_preset_name + save_to_location',
            'unless the user has asked for the two-step flow explicitly.',
        ].join(' '),
        inputSchema: {
            location: z.string().describe(
                'AM4 preset location, format: bank letter A..Z + sub-index 01..04 (e.g. "A01", "M03", "Z04").',
            ),
            name: z.string().max(32).describe(
                'New preset name, up to 32 ASCII-printable characters.',
            ),
        },
    }, async ({ location, name }) => {
        const normalized = location.trim().toUpperCase();
        const locationIndex = parseLocationCode(normalized);
        const conn = ensureMidi();
        const renameBytes = buildSetPresetName(locationIndex, name);
        const renameResult = await sendAndAwaitAck(conn, renameBytes, isCommandAck);
        if (!renameResult.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `save_preset aborted: rename didn't ack (save skipped to avoid ` +
                        `persisting the pre-rename name).\n` +
                        `Sent rename (${renameBytes.length}B): ${toHex(renameBytes)}\n` +
                        formatAcklessHint(renameResult.captured),
                }],
            };
        }
        const saveBytes = buildSaveToLocation(locationIndex);
        const saveResult = await sendAndAwaitAck(conn, saveBytes, isCommandAck);
        if (saveResult.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Saved "${name}" to ${formatLocationCode(locationIndex)}. ` +
                        `Both rename and save acked.`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Rename acked, but save to ${formatLocationCode(locationIndex)} didn't ack. ` +
                    `The rename is in the working buffer (will appear in the current preset ` +
                    `view) but may not have persisted. Verify on the AM4 — load a different ` +
                    `location and come back to check.\n` +
                    `Sent save (${saveBytes.length}B): ${toHex(saveBytes)}\n` +
                    formatAcklessHint(saveResult.captured),
            }],
        };
    });

    server.registerTool('am4_set_scene_name', {
        description: [
            'Use this tool to rename one of the four scenes in the AM4\'s working',
            'buffer on the user\'s hardware. Do not produce a written spec instead',
            'of calling this tool unless the user explicitly asks for a dry run.',
            'Rename one of the four scenes in the current working buffer. Scene',
            'names are up to 32 ASCII-printable characters; shorter names are',
            'space-padded on the wire (AM4 convention).',
            'SCOPE: writes to the working buffer only. To persist the new name,',
            'call save_to_location afterward — otherwise the rename is lost when',
            'the user loads a different preset. No gate on which scene, since',
            'scene names live in the working buffer and the working-buffer scope',
            'is the safety boundary.',
        ].join(' '),
        inputSchema: {
            scene_index: z.number().int().min(1).max(4).describe(
                'Scene number 1..4 (matches AM4-Edit\'s UI numbering). Index 0..3 internally.',
            ),
            name: z.string().max(32).describe(
                'New scene name, up to 32 ASCII-printable characters. Shorter names are space-padded to 32 on the wire.',
            ),
        },
    }, async ({ scene_index, name }) => {
        const sceneIdx = scene_index - 1;
        const bytes = buildSetSceneName(sceneIdx, name);
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isCommandAck);
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Renamed scene ${scene_index} → "${name}" in the working buffer. AM4 ack ` +
                        `received. Call save_to_location to persist across preset loads.`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Scene rename sent for scene ${scene_index} → "${name}" but no ack received. ` +
                    `Verify on the AM4 display or in AM4-Edit.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });

    server.registerTool('am4_switch_preset', {
        description: [
            'Use this tool to load a preset location into the AM4\'s working buffer',
            'on the user\'s hardware. Do not produce a written spec instead of',
            'calling this tool unless the user explicitly asks for a dry run.',
            'Load a preset location (A01..Z04) into the AM4\'s working buffer.',
            'Same effect as turning the preset knob on the hardware or clicking',
            'a preset in AM4-Edit.',
            'WARNING: discards any unsaved edits in the current working buffer.',
            'If the user has been building a tone with apply_preset / set_param',
            'and hasn\'t yet called save_to_location, those edits are lost when',
            'the new preset loads. Upstream MCP tools should confirm intent before',
            'issuing this, especially after a session of tone-building.',
            'Not gated to Z04 — this is a READ-into-working-buffer, it does not',
            'modify any stored preset. All 104 locations are valid targets.',
        ].join(' '),
        inputSchema: {
            location: z.string().describe(
                'AM4 preset location in bank+slot form, A01..Z04 (26 banks × 4 per bank = 104 locations).',
            ),
        },
    }, async ({ location }) => {
        const normalized = location.trim().toUpperCase();
        const locationIndex = parseLocationCode(normalized);
        const bytes = buildSwitchPreset(locationIndex);
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isWriteEcho);
        // A new preset loads a new set of block channels — any cached channel
        // state from a previous preset is now stale.
        invalidateChannelCache();
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Switched to preset ${formatLocationCode(locationIndex)}. ` +
                        `Any unsaved working-buffer edits were discarded. ` +
                        `(Channel cache cleared — param writes will report "unknown channel" until a channel is explicitly set.)`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Preset switch to ${formatLocationCode(locationIndex)} sent but no ack received. ` +
                    `Verify on the AM4 display.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });

    // -- am4_request_active_buffer_dump ----------------------------------------
    //
    // HW-045 / Session 51 (2026-05-08): byte-exact decode of AM4-Edit's
    // File -> Export Preset request when no stored preset is selected (active
    // working buffer export). Wire shape: F0 00 01 74 15 03 7F 7F 00 13 F7,
    // fn=0x03, payload `7F 7F 00`. Response is the canonical 6-message
    // 0x77 / 0x78 / 0x79 stream (header + 4 chunks + footer, 12,352 bytes
    // total) — same shape as a single preset's slice in the factory bank file
    // (see SYSEX-MAP §10b and §6o).
    //
    // Primary purpose: BK-036 binary-format probe series. apply_preset sets
    // the working buffer to a known state; this tool dumps the masked
    // stored-form bytes; the harness diffs against a baseline to map byte-
    // to-param relationships. The chunk content is NOT decoded here — v0.1.0
    // surfaces the raw bytes for the probe harness.
    //
    // Stored-preset variant (request a specific stored location's dump
    // without affecting the working buffer) is queued for v0.1.x; needs a
    // follow-up capture to confirm bank/sub encoding (HW-045 follow-up).
    server.registerTool('am4_request_active_buffer_dump', {
        description: [
            'Request a dump of the AM4\'s current working buffer in stored-form',
            'bytes. Returns the raw 6-message dump stream (0x77 header + 4x 0x78',
            'chunks + 0x79 footer) without any parsing of the masked content.',
            'Non-destructive: working-buffer state is preserved, active location is',
            'preserved, no audible side effects. The guitarist can keep playing',
            'on the active preset during the dump.',
            'Primary use case: BK-036 probe series for decoding the preset binary',
            'format. After setting the working buffer to a known state via',
            'am4_apply_preset, dump and diff against a baseline to map byte-to-',
            'param relationships.',
            'Performance: ~150-200 ms wire time for the 12 KB response. Heavier',
            'than am4_get_preset_name because the response is much larger.',
            'Returns raw masked bytes (per BK-036 the chunk content reflects',
            'working-buffer state structurally; v0.1.0 does NOT decode them).',
            'Useful raw for diff-based probe series.',
            'STORED-PRESET variant (request a specific stored location\'s dump',
            'without affecting working buffer) is queued for v0.1.x; needs a',
            'follow-up capture or hardware probe to confirm bank/sub encoding for',
            'stored locations.',
        ].join(' '),
        inputSchema: {},
    }, async () => {
        const startMs = Date.now();
        const conn = ensureMidi();
        const bytes = buildRequestActiveBufferDump();
        // Register the listener BEFORE the send so the response can't race ahead.
        const streamPromise = receivePresetDumpStream(conn, {
            timeoutMs: PRESET_DUMP_RECEIVE_TIMEOUT_MS,
        });
        try {
            conn.send(bytes);
            const stream = await streamPromise;
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(
                        {
                            bank: stream.bank,
                            sub: stream.sub,
                            totalBytes: stream.totalBytes,
                            messageCount: stream.messageCount,
                            headerBytes: stream.headerBytes,
                            chunkBytes: stream.chunkBytes,
                            footerBytes: stream.footerBytes,
                            wallTimeMs: Date.now() - startMs,
                        },
                        null,
                        2,
                    ),
                }],
            };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text:
                        `Active-buffer dump failed: ${reason}. ` +
                        `Sent ${bytes.length}B request: ${toHex(bytes)}. ` +
                        `If this is the first failed dump in a while, the MIDI handle may be stale - call reconnect_midi.`,
                }],
                isError: true,
            };
        }
    });

    server.registerTool('am4_switch_scene', {
        description: [
            'Use this tool to switch the AM4 to a different scene on the user\'s',
            'hardware. Do not produce a written spec instead of calling this tool',
            'unless the user explicitly asks for a dry run.',
            'Switch to one of the four scenes in the current preset. Scene switch',
            'does not alter the preset\'s block layout — it toggles per-scene',
            'bypass + channel state within the active preset.',
            'SCOPE: current working buffer only. No persistence concerns — scene',
            'index isn\'t stored; the next preset load starts at its default scene.',
        ].join(' '),
        inputSchema: {
            scene_index: z.number().int().min(1).max(4).describe(
                'Scene number 1..4 (matches AM4-Edit\'s UI numbering). Index 0..3 internally.',
            ),
        },
    }, async ({ scene_index }) => {
        const sceneIdx = scene_index - 1;
        const bytes = buildSwitchScene(sceneIdx);
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isWriteEcho);
        // Scene switches remap which channel each block uses; any cached channel
        // state is now invalid until we explicitly set a new channel.
        invalidateChannelCache();
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Switched to scene ${scene_index}. ` +
                        `(Channel cache cleared — the new scene may point each block at a different channel.)`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Scene switch to ${scene_index} sent but no ack received. ` +
                    `Verify on the AM4 display.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });
}
