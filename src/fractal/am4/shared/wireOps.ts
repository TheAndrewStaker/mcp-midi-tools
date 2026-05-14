/**
 * Wire-op helpers shared across every AM4 tool that does a SET write:
 * `sendAndAwaitAck` (send + classify ack), `formatAcklessHint` (response
 * fragment when no ack arrives), and the inbound-MIDI capture helpers
 * (`recordInbound` + `formatInboundCapture`) that produce the labelled
 * `[+NNNms] LABEL` timeline appended to every high-value tool response.
 *
 * Diagnostic surface — high-value AM4 tools subscribe to ALL inbound MIDI
 * for the duration of their wire activity, then append a `[+NNNms] LABEL`
 * timeline + one-line ack summary to their response. Helps surface stale-
 * handle / wrong-port / wedged-device situations without requiring a
 * separate `am4_test_navigate` round-trip — when `am4_apply_preset` reports
 * "10 writes, 8 acked" the timeline shows whether the missing 2 writes
 * got NACKs, no response at all, or were absorbed by an unrelated AM4-
 * Edit poll.
 *
 * Mirrors the pattern from Hydra's `hydra_apply_init` /
 * `hydra_apply_patch` — same shape, AM4-specific labels via
 * `describeAm4InboundMessage`.
 */

import {
    toHex,
    type MidiConnection,
} from '@/core/midi/transport.js';
import { describeAm4InboundMessage } from '@/fractal/am4/midi.js';

import {
    STALE_HANDLE_TIMEOUT_THRESHOLD,
    WRITE_ECHO_TIMEOUT_MS,
    recordAckOutcome,
} from '@/server/shared/connections.js';

/**
 * Send a command and wait for the expected ack frame. `predicate` is the
 * shape matcher — `isCommandAck` for 18-byte addressing-only acks (save,
 * rename), `isWriteEcho` for the 64-byte SET_PARAM/placement/scene-switch
 * echo. Returns:
 *   - { acked: true, ackBytes } if a matching frame arrived in the window.
 *   - { acked: false, captured } otherwise — `captured` is every inbound
 *     SysEx we saw, for diagnostic display on failure.
 *
 * Calls `recordAckOutcome` with the classification so the stale-handle
 * counter stays accurate.
 */
export async function sendAndAwaitAck(
    conn: MidiConnection,
    bytes: number[],
    predicate: (write: number[], response: number[]) => boolean,
): Promise<
    | { acked: true; ackBytes: number[]; captured: number[][] }
    | { acked: false; captured: number[][] }
> {
    const captured: number[][] = [];
    const unsubscribe = conn.onMessage((msg) => {
        if (msg[0] === 0xf0) captured.push([...msg]);
    });
    const ackPromise = conn.receiveSysExMatching(
        (resp) => predicate(bytes, resp),
        WRITE_ECHO_TIMEOUT_MS,
    );
    conn.send(bytes);
    try {
        const ackBytes = await ackPromise;
        unsubscribe();
        recordAckOutcome(true);
        return { acked: true, ackBytes, captured };
    } catch {
        unsubscribe();
        recordAckOutcome(false);
        return { acked: false, captured };
    }
}

export function formatAcklessHint(captured: number[][]): string {
    const capturedBlock = captured.length === 0
        ? '  (none)'
        : captured.map((m, i) => `  [${i}] (${m.length}B) ${toHex(m)}`).join('\n');
    return (
        `No command-ack within ${WRITE_ECHO_TIMEOUT_MS} ms. ` +
        `Inbound SysEx during the window:\n${capturedBlock}\n` +
        `If this keeps happening, the MIDI handle may be stale (AM4-Edit briefly ` +
        `open? USB replug?). Server auto-reconnects after ` +
        `${STALE_HANDLE_TIMEOUT_THRESHOLD} consecutive ack-less writes, or call ` +
        `reconnect_midi to force a fresh handle now.`
    );
}

export interface InboundCapture {
    /** Snapshot of (ms-since-start, bytes) for every inbound message seen. */
    observed: Array<{ ms: number; bytes: number[] }>;
    /** Tear down the subscription. Always call (in a finally). */
    unsubscribe: () => void;
    /** True when the underlying connection has an open input port. */
    hasInput: boolean;
    /** Used by `formatInboundCapture` to produce the [+NNNms] timeline. */
    startMs: number;
}

/**
 * Subscribe to every inbound MIDI message for the duration of a tool
 * call. Caller MUST invoke `capture.unsubscribe()` (typically in a
 * finally block) — leaving the subscription dangling adds noise to the
 * next tool call's capture.
 */
export function recordInbound(conn: MidiConnection): InboundCapture {
    const startMs = Date.now();
    const observed: Array<{ ms: number; bytes: number[] }> = [];
    const unsubscribe = conn.onMessage((bytes) => {
        observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
    });
    return {
        observed,
        unsubscribe,
        hasInput: conn.hasInput,
        startMs,
    };
}

/**
 * Format the captured timeline + ack summary as a multi-line block to
 * append to a tool response. Includes:
 *   - Header line with hasInput state and message count.
 *   - One labelled line per observed message (`[+NNNms] LABEL`), where
 *     LABEL comes from `describeAm4InboundMessage` — Save ACK / Rename
 *     ACK / SET_PARAM write echo / Multipurpose NACK rc=0x05 / etc.
 *   - One-line summary tallying write-echo / command-ack / NACK / OK /
 *     other so a "did anything land?" question is answerable at a
 *     glance without re-reading the full timeline.
 *
 * Caller is responsible for prepending its own context (e.g. "Inbound
 * MIDI during apply_preset:") — this function returns the block only.
 */
export function formatInboundCapture(capture: InboundCapture): string {
    const lines: string[] = [];
    lines.push(
        `Inbound MIDI capture (hasInput=${capture.hasInput}, ${capture.observed.length} message${capture.observed.length === 1 ? '' : 's'}):`,
    );
    if (!capture.hasInput) {
        lines.push('  (no input port open — capture is empty by construction)');
    } else if (capture.observed.length === 0) {
        lines.push('  (none — device sent nothing back during this call)');
    } else {
        for (const { ms, bytes } of capture.observed) {
            lines.push(`  [+${ms.toString().padStart(4)}ms] ${describeAm4InboundMessage(bytes)}`);
        }
    }
    // Compact ack-summary tally. The classifier is keyed off the leading
    // tokens in `describeAm4InboundMessage`'s output so it stays in sync
    // with the labels the caller actually sees in the timeline above.
    let writeEchos = 0;
    let commandAcks = 0;
    let nacks = 0;
    let multipurposeOk = 0;
    let other = 0;
    for (const { bytes } of capture.observed) {
        const label = describeAm4InboundMessage(bytes);
        if (label.startsWith('SET_PARAM write echo')) writeEchos++;
        else if (label.startsWith('Save ACK') || label.startsWith('Rename ACK') || label.startsWith('Command ACK')) commandAcks++;
        else if (label.includes('NACK')) nacks++;
        else if (label.includes(': OK')) multipurposeOk++;
        else other++;
    }
    if (capture.observed.length > 0) {
        lines.push(
            `Summary: ${writeEchos} write-echo, ${commandAcks} command-ack, ${multipurposeOk} multipurpose-OK, ${nacks} NACK, ${other} other.`,
        );
    }
    return lines.join('\n');
}
