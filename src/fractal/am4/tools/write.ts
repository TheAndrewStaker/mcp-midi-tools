/**
 * AM4 working-buffer write tools (4 tools):
 * - `am4_set_param` — single-param write with optional channel switch + ack.
 * - `am4_set_params` — batched param writes with up-front validation.
 * - `am4_set_block_type` — place / clear a block at a signal-chain slot.
 * - `am4_set_block_bypass` — silence / activate a block on the active scene.
 *
 * The `am4_set_param` description is the longest in the project and carries
 * the agent-behavior contract (RELATIVE-CHANGE / TEMPO/TIME / CHANNEL/SCENE /
 * ENUM-NAME / REVERB.TYPE / PARAM-NAME ALIASES discipline blocks). The
 * description text MUST stay byte-exact with the original — it's load-
 * bearing for setlist building and tone-shaping behavior.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    KNOWN_PARAMS,
    type Param,
} from '@/fractal/am4/params.js';
import { resolveBridge } from '@/fractal/am4/parameterBridge.js';
import {
    BLOCK_NAMES_BY_VALUE,
    BLOCK_TYPE_VALUES,
    resolveBlockType,
    type BlockTypeName,
} from '@/fractal/am4/blockTypes.js';
import {
    buildSetBlockBypass,
    buildSetBlockType,
    buildSetParam,
    isWriteEcho,
} from '@/fractal/am4/setParam.js';
import { toHex } from '@/fractal/am4/midi.js';

import {
    STALE_HANDLE_TIMEOUT_THRESHOLD,
    WRITE_ECHO_TIMEOUT_MS,
    ensureMidi,
    recordAckOutcome,
} from '@/server/shared/connections.js';
import {
    CHANNEL_BLOCKS,
    channelStatusLine,
    observeWrittenParam,
    preflightApplicabilityWarning,
    resolveChannel,
    switchBlockChannel,
} from '@/server/shared/channels.js';
import { paramKey, resolveValue } from '@/server/shared/paramHelpers.js';
import {
    formatAcklessHint,
    formatInboundCapture,
    recordInbound,
    sendAndAwaitAck,
} from '@/server/shared/wireOps.js';
import { markAM4Dirty } from '@/fractal/am4/tools/safeEdit.js';

export function registerWriteTools(server: McpServer): void {
    server.registerTool('am4_set_param', {
        description: [
            'Use this tool to write a single parameter on the user\'s AM4. Do not',
            'produce a written spec instead of calling this tool unless the user',
            'explicitly asks for a dry run (e.g. "draft a preset", "without touching',
            'the hardware", "what would the params look like").',
            'Write a single parameter on the connected Fractal AM4. The parameter',
            'is addressed by (block, name) — e.g. block="amp", name="gain". For',
            'numeric params, pass the user-facing display value (0–10 knob, dB,',
            'ms, %). For enum params, pass the dropdown name ("1959SLP Normal")',
            'or wire index (0).',
            'VOLUME LANGUAGE: when the user says "louder / quieter / more reverb",',
            'pick the right knob — `amp.gain` is INPUT DRIVE (changes character),',
            '`amp.master` is amp master (preserves character), `amp.level` is',
            'post-amp dB trim for preset-to-preset matching. `<fx>.mix` is the',
            'wet/dry on each effect. Full per-device cheat sheet:',
            'docs/VOLUME-CONTROL.md.',
            'RELATIVE-CHANGE DISCIPLINE — IMPORTANT for words like "more", "less",',
            '"a bit", "significantly", "raise/lower", "increase/decrease", "double/halve":',
            'these only have meaning relative to the current value. Call `am4_get_param`',
            'FIRST to read the starting point, then compute the absolute target and',
            'pass that to set_param. Without the read, the agent is guessing the',
            'absolute value (gain at 2.0 → +3 is "significantly"; gain at 8.0 → +1',
            'is "significantly"). Skip the read only when the user gives an absolute',
            'value ("set the gain to 6", "treble at 4").',
            'TEMPO/TIME DISCIPLINE — IMPORTANT for delay / chorus / flanger / phaser /',
            'tremolo / rotary: each of these blocks has a `tempo` enum (NONE plus',
            'musical divisions 1/64..1/2..1..4). When `tempo` is anything other than',
            'NONE, the AM4 LOCKS the block\'s timing param to (song tempo × division)',
            'and SILENTLY IGNORES absolute writes to that timing param. The locked',
            'param is `delay.time` for delay and `rate` for chorus / flanger / phaser /',
            'tremolo / rotary. Read the `tempo` value alongside time/rate before',
            'planning a change so you know which side of the sync to write.',
            'For DELAY specifically: tempo-synced repeats are the PROFESSIONAL DEFAULT',
            'for guitarists in modern popular music. When the user asks for a delay',
            'tone — especially "ambient", "obvious", "rhythmic", "Edge / U2 style",',
            '"post-rock", "shoegaze", "worship", "atmospheric" — REACH FOR `delay.tempo`',
            'FIRST and pick a musical division: 1/4 DOT is the iconic Edge sound,',
            '1/4 for clear rhythmic repeats, 1/2 DOT or 1/2 for ambient washes,',
            '1/8 DOT for rhythmic urgency, 1/8 for tighter syncopation. Fall back',
            'to absolute `delay.time` only when the user explicitly asks for a',
            'specific ms count, calls out free-time / rockabilly / slapback, or',
            'is playing without a tempo reference.',
            'For MODULATION blocks (chorus / flanger / phaser / rotary): free-Hz',
            '`rate` is the typical default — these are textural, not rhythmic, and',
            'tempo sync rarely matches the ask. Tremolo is the exception: rhythmic',
            'chops (1/8 / 1/16 tempo) are common alongside vintage Hz-rate tremolo.',
            'When you DO need to write `time` or `rate` in absolute units, FIRST',
            'set the block\'s `tempo` to "NONE" — otherwise the write is silently',
            'overridden. Order: (1) set tempo to "NONE", (2) write time/rate.',
            'Going the other direction (setting tempo to a division) does not',
            'require clearing time/rate first — the AM4 just stops reading it.',
            'CHANNEL/SCENE MODEL — IMPORTANT for user requests that mention scenes:',
            'Each block (amp/drive/reverb/delay) holds its parameter values in one',
            'of four channels A/B/C/D. Scenes are selectors — they choose which',
            'channel each block uses (plus per-block bypass state), they don\'t',
            'store param values themselves. Two scenes pointing at the same',
            'channel will both reflect any write to that channel. If the user says',
            '"change the amp gain on scene 2" they usually mean "on whichever',
            'channel scene 2 uses for Amp" — pass the `channel` argument to target',
            'a specific A/B/C/D. Without `channel`, the write goes to whatever',
            'channel the block is on now, which may be shared across multiple',
            'scenes. Only amp / drive / reverb / delay have channels; other blocks',
            '(chorus, flanger, phaser, …) ignore the `channel` argument.',
            'ENUM-NAME REPORTING — when you write an enum param (amp.type,',
            'drive.type, reverb.type, delay.type, compressor.type, etc.), the',
            'response surfaces the FULL resolved name in parentheses, e.g.',
            '`compressor.type = 8 (JFET Studio Compressor)`. When summarizing the',
            'change to the user, use that resolved name verbatim — not the shorthand',
            'you typed in. The relaxed matcher accepts partial names ("Studio" →',
            '"JFET Studio Compressor"), so the resolved name disambiguates which',
            'specific model loaded. Saying "I set the compressor to Studio" when the',
            'response said "JFET Studio Compressor" mis-describes the result.',
            'REVERB.TYPE NAMING CONVENTION — IMPORTANT: reverb types follow a',
            '"Category, Subtype" pattern: "Room, Small" / "Room, Medium" / "Room,',
            'Large" / "Hall, Small" / "Hall, Medium" / "Plate, Medium" / "Plate,',
            'London" / "Spring, Tube" / "Chamber, Deep" / "Echo, Plate" / "SFX',
            'Pegasus" / "Cloud, Cumulonimbus" etc. Pass the FULL "Category,',
            'Subtype" string. Passing just "Room" or "Plate" matches multiple',
            'entries and is rejected as ambiguous. When the user says "small',
            'room reverb" → "Room, Small"; "plate reverb" → "Plate, Medium" (or',
            'call list_enum_values for the full list and pick a specific one).',
            'Default sizes when the user is non-specific: Room/Hall/Plate →',
            '"Medium" subtype; Spring → "Medium" or "Tube" for vintage.',
            'PARAM-NAME ALIASES — common synonyms resolve silently to the',
            'canonical registered name: `reverb.decay` / `reverb.length` →',
            '`reverb.time`; `delay.length` → `delay.time`; `delay.repeats` →',
            '`delay.feedback`; `<modulation_block>.speed` → `<...>.rate` (chorus,',
            'flanger, phaser, tremolo, rotary). The response shows the canonical',
            'name in the ack ("delay.feedback = 50"); use that name in your',
            'summary, not the alias you passed in.',
            'IMPORTANT: the tool cannot currently tell whether a write actually',
            'landed on the audio path. If the target block isn\'t placed in the',
            'active preset, the AM4 still acknowledges the write on the wire but',
            'produces no audible change. The response includes the raw ack bytes',
            'for diagnostic purposes, but the only trustworthy signal that a',
            'change took effect is the user confirming via the AM4\'s own display.',
            'If the user expects an audible change and reports none, the likely',
            'cause is that the target block isn\'t placed in the active preset.',
            'Call list_params first if unsure what is available.',
        ].join(' '),
        inputSchema: {
            block: z.string().describe('Block name, e.g. "amp", "drive", "reverb", "delay"'),
            name: z.string().describe('Parameter name within the block, e.g. "gain", "type", "mix"'),
            value: z.union([z.number(), z.string()]).describe(
                'Display value. Numbers for knobs/dB/ms/%, strings for enum dropdowns.',
            ),
            channel: z.union([z.string(), z.number()]).optional().describe(
                'Optional. If supplied, the server first writes the block\'s channel selector to this A/B/C/D (or 0..3), then the param. Only valid for amp / drive / reverb / delay. Omit to write to whichever channel the block is currently on.',
            ),
        },
    }, async ({ block, name, value, channel }) => {
        const key = paramKey(block, name);
        const param: Param = KNOWN_PARAMS[key];
        const resolved = resolveValue(param, value);
        const bytes = buildSetParam(key, resolved);
        const conn = ensureMidi();
        // Subscribe to inbound MIDI for the entire tool call (channel switch +
        // param write) so a single timeline covers both writes if the caller
        // passed `channel`. Hydra-explorer-style diagnostic surface.
        const capture = recordInbound(conn);
        let channelSwitched = false;
        let result: Awaited<ReturnType<typeof sendAndAwaitAck>>;
        try {
            if (channel !== undefined) {
                const switchResult = await switchBlockChannel(conn, block, channel);
                channelSwitched = switchResult.switched;
            }
            result = await sendAndAwaitAck(conn, bytes, isWriteEcho);
            markAM4Dirty();
        } finally {
            capture.unsubscribe();
        }
        const enumNameFor = (idx: number): string | undefined => {
            const vals = param.enumValues as Record<number, string> | undefined;
            return vals?.[idx];
        };
        const display = param.unit === 'enum'
            ? `${resolved} (${enumNameFor(resolved) ?? '?'})`
            : String(resolved);
        const inboundBlock = formatInboundCapture(capture);
        // Append the AM4-Edit canonical label when bound, so the agent's
        // user-facing summary uses the word the user reads on the AM4-Edit
        // screen. e.g. `amp.bright_cap (AM4-Edit: "Bright Cap")`.
        const bridge = resolveBridge(param.block, param.name);
        const labelTag = bridge ? ` (AM4-Edit: "${bridge.canonicalLabel}")` : '';
        if (result.acked) {
            observeWrittenParam(param.block, param.name, resolved);
            const channelLine = channelStatusLine(param.block, channelSwitched);
            const applicabilityWarning = preflightApplicabilityWarning(key);
            const applicabilityLine = applicabilityWarning ? `\n\n${applicabilityWarning}` : '';
            return {
                content: [{
                    type: 'text',
                    text:
                        `Sent ${key}${labelTag} = ${display}. AM4 wire-acked the write.${channelLine} NOTE: the ack does NOT ` +
                        `confirm an audible change — if the user expected a sound change and reports none, the ` +
                        `${param.block} block may not be placed in the active preset, or the write landed on a ` +
                        `channel the current scene isn't using.${applicabilityLine}\n\n${inboundBlock}`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Sent ${key}${labelTag} = ${display}. No ack within ${WRITE_ECHO_TIMEOUT_MS} ms — this is unusual ` +
                    `(the AM4 normally acks every write).\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured) +
                    `\n\n${inboundBlock}`,
            }],
        };
    });

    server.registerTool('am4_set_params', {
        description: [
            'Use this tool to batch-apply multiple parameter writes on the user\'s',
            'AM4 in one call. Do not produce a written spec instead of calling this',
            'tool unless the user explicitly asks for a dry run.',
            'Apply multiple parameter writes in one call. Prefer this over many',
            'set_param calls when applying a scene, preset, or any grouped change —',
            'it\'s less chatty and validates all inputs before sending any MIDI',
            '(a bad value in one entry rejects the whole call with nothing sent).',
            'Same value rules as set_param: numbers for knobs/dB/ms/%, strings or',
            'wire indices for enum params. Writes are sent in the provided order.',
            'Each entry accepts an optional per-write `channel` (A/B/C/D or 0..3)',
            'for amp / drive / reverb / delay — see set_param\'s description for the',
            'channel/scene model. Different entries in the same batch can target',
            'different channels: the server switches as needed and reports which',
            'channel each write landed on.',
            'IMPORTANT: same caveat as set_param — the AM4 acks every write on the',
            'wire whether or not the target block is placed or the current scene is',
            'pointing at the channel you wrote to. An ack is not a confirmation of',
            'audible change. If the user expects audible changes and reports none,',
            'the most likely causes are (a) one or more target blocks are not placed',
            'in the active preset, or (b) the write landed on a channel the active',
            'scene isn\'t using.',
        ].join(' '),
        inputSchema: {
            writes: z.array(z.object({
                block: z.string().describe('Block name, e.g. "amp", "drive", "reverb", "delay"'),
                name: z.string().describe('Parameter name within the block, e.g. "gain", "type", "mix"'),
                value: z.union([z.number(), z.string()]).describe('Display value'),
                channel: z.union([z.string(), z.number()]).optional().describe(
                    'Optional. A/B/C/D (or 0..3). The server switches the block\'s channel before the write. Only valid for amp/drive/reverb/delay.',
                ),
            })).describe('List of (block, name, value, channel?) writes to apply in order'),
        },
    }, async ({ writes }) => {
        if (writes.length === 0) {
            return { content: [{ type: 'text', text: 'No writes supplied. Nothing to do.' }] };
        }
        // Validate + encode every entry BEFORE sending any MIDI. A bad value in
        // entry 7 would otherwise leave entries 0..6 half-sent; the pre-flight
        // pass keeps input-validation failures atomic. Channel indices also
        // validated here so a bad "E" channel letter rejects the whole batch.
        const prepared = writes.map((w, i) => {
            try {
                const key = paramKey(w.block, w.name);
                const param: Param = KNOWN_PARAMS[key];
                const resolved = resolveValue(param, w.value);
                const bytes = buildSetParam(key, resolved);
                const enumNameFor = (idx: number): string | undefined =>
                    (param.enumValues as Record<number, string> | undefined)?.[idx];
                const display = param.unit === 'enum'
                    ? `${resolved} (${enumNameFor(resolved) ?? '?'})`
                    : String(resolved);
                if (w.channel !== undefined) {
                    if (!CHANNEL_BLOCKS.has(param.block)) {
                        throw new Error(`Block "${param.block}" doesn't have channels; drop the \`channel\` argument (only amp/drive/reverb/delay expose A/B/C/D).`);
                    }
                    resolveChannel(w.channel); // throws on invalid input
                }
                return { key, param, bytes, display, channel: w.channel };
            } catch (err) {
                throw new Error(`writes[${i}] (${w.block}.${w.name} = ${w.value}): ${err instanceof Error ? err.message : String(err)}`);
            }
        });
        const conn = ensureMidi();
        const lines: string[] = [];
        let acked = 0;
        let unacked = 0;
        for (let i = 0; i < prepared.length; i++) {
            const { key, param, display, bytes, channel } = prepared[i];
            let channelSwitched = false;
            if (channel !== undefined) {
                try {
                    const result = await switchBlockChannel(conn, param.block, channel);
                    channelSwitched = result.switched;
                } catch (err) {
                    lines.push(`  ✗ ${key} = ${display} — channel switch failed: ${err instanceof Error ? err.message : String(err)}`);
                    unacked++;
                    continue;
                }
            }
            const echoPromise = conn.receiveSysExMatching(
                (resp) => isWriteEcho(bytes, resp),
                WRITE_ECHO_TIMEOUT_MS,
            );
            conn.send(bytes);
            markAM4Dirty();
            try {
                await echoPromise;
                acked++;
                recordAckOutcome(true);
                observeWrittenParam(param.block, param.name, resolveValue(param, writes[i].value));
                const channelLine = channelStatusLine(param.block, channelSwitched);
                const applicabilityWarning = preflightApplicabilityWarning(key);
                const applicabilityLine = applicabilityWarning ? ` ⚠ type-gated; current ${param.block}.type may not expose this knob (see set_param applicability advisory).` : '';
                lines.push(`  ✓ ${key} = ${display} — wire-acked.${channelLine}${applicabilityLine}`);
            } catch {
                unacked++;
                recordAckOutcome(false);
                lines.push(`  ? ${key} = ${display} — no ack within ${WRITE_ECHO_TIMEOUT_MS} ms (USB/driver issue?)`);
            }
        }
        const summary =
            unacked === 0
                ? `Sent all ${prepared.length} writes; AM4 wire-acked each one. Acks do NOT confirm audible change — if the user reports no change on the device, the target blocks may not be placed in the active preset, or writes may have landed on channels the current scene isn't using (see per-write channel notes).`
                : `Sent ${prepared.length} writes; ${acked} acked, ${unacked} un-acked (un-acked across multiple writes suggests a stale MIDI handle — server auto-reconnects after ${STALE_HANDLE_TIMEOUT_THRESHOLD} consecutive ack-less writes, or call reconnect_midi to force).`;
        return {
            content: [{ type: 'text', text: `${summary}\n${lines.join('\n')}` }],
        };
    });

    server.registerTool('am4_set_block_type', {
        description: [
            'Use this tool to place or clear a block in one of the AM4\'s four',
            'signal-chain slots on the user\'s hardware. Do not produce a written',
            'spec instead of calling this tool unless the user explicitly asks for',
            'a dry run.',
            'Place a block (or clear the slot) at one of the AM4\'s four signal-chain',
            'positions. The AM4 has 4 block slots, numbered 1..4 left-to-right in the',
            'signal chain. Each slot can hold at most one block of a given type, and',
            'a preset\'s layout is defined by which block is in which slot.',
            'Block types (case-insensitive): "none" (empty slot), "amp", "compressor",',
            '"geq", "peq", "reverb", "delay", "chorus", "flanger", "rotary", "phaser",',
            '"wah", "volpan", "tremolo", "filter", "drive", "enhancer", "gate".',
            'Typical use: build a preset by first calling set_block_type for each slot',
            'to lay out the chain, then use set_param / set_params to dial in the',
            'parameters for each placed block.',
            'Same ack caveat as set_param: the AM4 wire-acks the placement; whether',
            'it was actually accepted is best confirmed by the user on the device.',
        ].join(' '),
        inputSchema: {
            position: z.number().int().min(1).max(4).describe(
                'Slot position in the signal chain (1..4). Slot 1 is leftmost / first.',
            ),
            block_type: z.string().describe(
                'Block name (e.g. "compressor", "reverb", "drive") or "none" to clear.',
            ),
        },
    }, async ({ position, block_type }) => {
        const value = resolveBlockType(block_type);
        if (value === undefined) {
            const known = Object.keys(BLOCK_TYPE_VALUES).join(', ');
            throw new Error(`Unknown block_type "${block_type}". Known: ${known}`);
        }
        const pos = position as 1 | 2 | 3 | 4;
        const bytes = buildSetBlockType(pos, value);
        const displayName = BLOCK_NAMES_BY_VALUE[value] ?? `0x${value.toString(16)}`;
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isWriteEcho);
        markAM4Dirty();
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Placed ${displayName} in slot ${pos}. AM4 wire-acked the change. ` +
                        `Cross-check on the AM4 if the layout matters.`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Sent block placement (slot ${pos} → ${displayName}). No ack within ` +
                    `${WRITE_ECHO_TIMEOUT_MS} ms — this is unusual.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });

    server.registerTool('am4_set_block_bypass', {
        description: [
            'Use this tool to silence (bypass) or reactivate a block on the user\'s',
            'AM4. Do not produce a written spec instead of calling this tool unless',
            'the user explicitly asks for a dry run.',
            'Silence (bypass = true) or reactivate (bypass = false) a block on the',
            'currently-active scene. A bypassed block passes its input through',
            'unchanged — the block stays in the slot with all its params intact, it',
            'just makes no sound. Common use: "mute the drive on the clean scene"',
            '(switch to that scene first, then set_block_bypass drive true).',
            'Scene-scoping is implicit — this writes the working-buffer state, and',
            'the AM4 automatically saves it to whichever scene is active right now.',
            'To configure bypass on a specific scene, issue switch_scene first and',
            'then set_block_bypass; the tool does not accept a scene argument.',
            'Block names (case-insensitive): "amp", "compressor", "geq", "peq",',
            '"reverb", "delay", "chorus", "flanger", "rotary", "phaser", "wah",',
            '"volpan", "tremolo", "filter", "drive", "enhancer", "gate". "none" is',
            'rejected — an empty slot has no bypass state.',
        ].join(' '),
        inputSchema: {
            block: z.string().describe(
                'Block name (e.g. "amp", "drive", "reverb"). Rejects "none".',
            ),
            bypassed: z.boolean().describe(
                'true = bypass (silence the block). false = activate.',
            ),
        },
    }, async ({ block, bypassed }) => {
        const value = resolveBlockType(block);
        if (value === undefined || value === BLOCK_TYPE_VALUES.none) {
            const known = (Object.keys(BLOCK_TYPE_VALUES) as BlockTypeName[])
                .filter((n) => n !== 'none')
                .join(', ');
            throw new Error(`Unknown or invalid block "${block}". Known: ${known}`);
        }
        const displayName = BLOCK_NAMES_BY_VALUE[value] ?? `0x${value.toString(16)}`;
        const bytes = buildSetBlockBypass(value, bypassed);
        const conn = ensureMidi();
        const result = await sendAndAwaitAck(conn, bytes, isWriteEcho);
        markAM4Dirty();
        const stateWord = bypassed ? 'bypassed' : 'active';
        if (result.acked) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `Set ${displayName} to ${stateWord} on the active scene. AM4 ` +
                        `wire-acked the change. To change a different scene's bypass, ` +
                        `switch_scene first and re-issue.`,
                }],
            };
        }
        return {
            content: [{
                type: 'text',
                text:
                    `Sent ${displayName} → ${stateWord}. No ack within ` +
                    `${WRITE_ECHO_TIMEOUT_MS} ms — this is unusual.\n` +
                    `Sent (${bytes.length}B): ${toHex(bytes)}\n` +
                    formatAcklessHint(result.captured),
            }],
        };
    });
}
