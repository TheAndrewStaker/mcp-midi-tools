/**
 * `am4_test_navigate` — bypass-the-stack diagnostic primitive.
 *
 * Confirms the wire path is alive when a high-level tool fails inscrutably.
 * Sends a raw mode-switch SysEx with no high-level mediation, no param
 * resolution, no channel-cache updates — just F0 00 01 74 15 12 [mode]
 * [cksum] F7 → captures inbound → reports.
 *
 * Mode-switch bytes are documented in CLAUDE.md (AM4 SysEx Quick
 * Reference). They're the simplest commands the AM4 supports — if these
 * don't ack with a 0x64 OK, no other tool will work either, and the
 * caller knows the problem is below the protocol layer (USB driver,
 * stale handle, AM4 powered off, AM4-Edit holding the port). Equivalent
 * in role to Hydra-explorer's `hydra_navigate_to`.
 *
 * Checksums verified against CLAUDE.md fixed bytes — XOR of [F0 .. last
 * payload byte] masked & 0x7F. We use the literal bytes from the docs
 * rather than reconstructing them so this tool stays correct even if a
 * downstream regression breaks the checksum builder.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { toHex } from '@/fractal/am4/midi.js';

import { ensureMidi } from '@/server/shared/connections.js';
import { recordInbound, formatInboundCapture } from '@/server/shared/wireOps.js';

const AM4_MODE_SWITCH_BYTES: Record<'presets' | 'scenes' | 'effects' | 'amp' | 'tuner', number[]> = {
    presets: [0xf0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x48, 0x4a, 0xf7],
    scenes: [0xf0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x49, 0x4b, 0xf7],
    effects: [0xf0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x4a, 0x48, 0xf7],
    amp: [0xf0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x58, 0x5a, 0xf7],
    tuner: [0xf0, 0x00, 0x01, 0x74, 0x15, 0x12, 0x18, 0x1a, 0xf7],
};

/**
 * How long we wait for the device's inbound response after sending a
 * mode-switch. The expected ack is a 0x64 MULTIPURPOSE_RESPONSE with
 * RC=0x00, typically arriving within 30-60 ms (per `CLAUDE.md` SysEx
 * round-trip note). 250 ms is a generous window — long enough that
 * a slow driver still completes, short enough that a hung device
 * surfaces as "no inbound" within a quarter second.
 */
const MODE_SWITCH_DRAIN_MS = 250;

export function registerDiagnosticsTools(server: McpServer): void {
    server.registerTool('am4_test_navigate', {
        description: [
            '**Diagnostic primitive — bypass the stack.** Sends ONE raw mode-switch',
            'SysEx command to the AM4 and captures any inbound MIDI for ~250 ms after.',
            'No high-level mediation. No param resolution. No channel-cache updates.',
            'No retries. Just bytes-on-the-wire.',
            '',
            'Use this when a high-level tool (apply_preset, set_param, save_to_location,',
            'switch_preset, ...) fails inscrutably and you need to confirm the wire path',
            'is alive at all. The mode-switch family is the simplest message the AM4',
            'supports — if these don\'t ack with a `Multipurpose response for fn=0x12: OK`,',
            'no other tool will work either, and the problem is below the protocol layer',
            '(USB driver hung, stale MIDI handle, AM4 powered off, USB cable seated wrong).',
            '',
            'Modes available — these are the device\'s top-level navigation buttons:',
            '  • `presets` — Presets mode (default boot mode, shows the preset list)',
            '  • `scenes`  — Scenes mode (the per-scene mixer view inside a preset)',
            '  • `effects` — Effects mode (block-level signal-chain view)',
            '  • `amp`     — Amp mode (focused amp parameters)',
            '  • `tuner`   — Tuner mode (the chromatic tuner; mutes audio)',
            '',
            'Reading the response: a healthy device emits a single inbound message —',
            '`F0 00 01 74 15 64 12 00 [cs] F7` — labelled as `Multipurpose response',
            'for fn=0x12: OK`. The tool surfaces this in the labelled timeline plus',
            'the one-line ack summary. If hasInput=true and 0 messages arrive, the',
            'device is wedged or unplugged. If hasInput=false the input port wasn\'t',
            'opened at connect time — `reconnect_midi` may help.',
            '',
            'Does NOT change preset / scene / channel state in any meaningful way —',
            'mode is a UI selector; pressing it on the front panel is the same action.',
            'Audio output is unaffected EXCEPT in `tuner` mode, which mutes audio',
            'until the user navigates away.',
        ].join('\n'),
        inputSchema: {
            mode: z.enum(['presets', 'scenes', 'effects', 'amp', 'tuner']).describe(
                'Which mode to navigate to. The five values map to the AM4\'s documented mode-switch SysEx commands (see CLAUDE.md AM4 SysEx Quick Reference).',
            ),
        },
    }, async ({ mode }) => {
        const bytes = AM4_MODE_SWITCH_BYTES[mode];
        const conn = ensureMidi();
        const capture = recordInbound(conn);
        const sentMs = Date.now();
        try {
            conn.send(bytes);
            // Drain inbound MIDI for the configured window. Plain sleep, no
            // ack-driven flow control — point of this tool is to observe what
            // ACTUALLY comes back without making protocol-level assumptions.
            await new Promise<void>((resolve) => setTimeout(resolve, MODE_SWITCH_DRAIN_MS));
        } finally {
            capture.unsubscribe();
        }
        const elapsedMs = Date.now() - sentMs;

        const lines: string[] = [];
        lines.push(`Mode-switch sent: mode="${mode}" (${bytes.length}B SysEx, drain ${MODE_SWITCH_DRAIN_MS} ms, total ${elapsedMs} ms).`);
        lines.push(`Sent: ${toHex(bytes)}`);
        lines.push('');
        lines.push('Expected: a single `Multipurpose response for fn=0x12: OK` within ~50 ms.');
        lines.push('  - 1 OK + 0 other = device responding normally; the wire path is alive.');
        lines.push('  - 0 messages with hasInput=true = device wedged or unplugged.');
        lines.push('  - 0 messages with hasInput=false = input port not open; try reconnect_midi.');
        lines.push('  - Multiple messages or NACK = capture them and check SYSEX-MAP.md.');
        lines.push('');
        lines.push(formatInboundCapture(capture));

        return {
            content: [{ type: 'text', text: lines.join('\n') }],
        };
    });
}
