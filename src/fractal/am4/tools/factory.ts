/**
 * Factory-restore tools (2 tools): `am4_restore_factory` (single slot) and
 * `am4_restore_factory_range` (contiguous range, ≤26 slots, ≤1 bank).
 *
 * Both replay the embedded factory bank's stored-form bytes
 * (samples/factory/AM4-Factory-Presets-1p01.syx) for the target slot
 * directly to the device, bypassing the working buffer entirely.
 * Hardware-verified Session 51 (2026-05-08): G03 was overwritten with
 * the factory Deluxe Tweed preset cleanly, all 4 scenes intact. Direct
 * slot writes via the 0x77 / 0x78 / 0x79 stream are fire-and-forget at
 * 30 ms inter-message pacing; no ack is expected on this command family.
 *
 * Verification: pre/post name comparison (rationale documented in
 * RestoreVerifyResult below). The range tool inherits apply_setlist's
 * on_error / dry_run / verify shape so callers can reuse the patterns.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
    loadFactoryBank,
    sendFactoryRestore,
} from '@/fractal/am4/factoryBank.js';
import { formatLocationDisplay, parseLocationCode } from '@/fractal/am4/locations.js';
import type { MidiConnection } from '@/fractal/am4/midi.js';

import { ensureMidi } from '@/server/shared/connections.js';
import { readPresetName } from '@/server/shared/readOps.js';

// --- am4_restore_factory + am4_restore_factory_range verification --------
//
// Both restore tools verify each slot via pre/post name comparison rather
// than extracting the factory name from the bank file's masked chunk
// payload. Rationale: BK-036 has only partially decoded the masked chunk
// region (cleartext block-layout table at 0x00E..0x06D is byte-identical
// across captures, but the preset name field within the masked area has
// not been confirmed byte-exact in code). Pre/post comparison sidesteps
// the decode dependency:
//
//   1. Read the name BEFORE the restore (whatever is currently there).
//   2. Send the 6-message restore stream.
//   3. Read the name AFTER. A successful restore produces a non-empty
//      name that differs from the pre-restore name (the user-customised
//      content has been replaced by the factory preset name).
//
// Failure modes surfaced:
//   - Post-restore name == "<EMPTY>": hard fail. Factory presets are
//     never empty; an empty readback means the restore did not land.
//   - Post-restore name == pre-restore name (and pre-restore name was
//     non-empty): soft warning. Either the slot was already factory
//     and the restore was a no-op (legitimate), or the restore did not
//     land. We cannot distinguish these without the bank-file name
//     decode, so we surface as a soft warning rather than a hard fail.
//   - Read failure / timeout on post: hard fail. Save status unknown.
interface RestoreVerifyResult {
    ok: boolean;
    severity: 'ok' | 'warning' | 'error';
    preRestoreName: string;
    postRestoreName: string;
    message: string;
}

async function verifyRestoredSlot(
    conn: MidiConnection,
    locationIndex: number,
    preRestoreName: string,
): Promise<RestoreVerifyResult> {
    let postRestoreName: string;
    try {
        const parsed = await readPresetName(conn, locationIndex);
        postRestoreName = parsed.isEmpty ? '<EMPTY>' : parsed.name;
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            severity: 'error',
            preRestoreName,
            postRestoreName: '<read-failed>',
            message:
                `verification timeout: could not read back preset name at ${formatLocationDisplay(locationIndex)} (${reason}). ` +
                `Restore status unknown.`,
        };
    }
    if (postRestoreName === '<EMPTY>') {
        return {
            ok: false,
            severity: 'error',
            preRestoreName,
            postRestoreName,
            message:
                `verification failure: post-restore name at ${formatLocationDisplay(locationIndex)} is <EMPTY>. ` +
                `Factory presets are never empty - the restore did not land.`,
        };
    }
    if (
        preRestoreName !== '<EMPTY>'
        && preRestoreName.trim().toLowerCase() === postRestoreName.trim().toLowerCase()
    ) {
        return {
            ok: false,
            severity: 'warning',
            preRestoreName,
            postRestoreName,
            message:
                `verification soft warning: pre-restore name "${preRestoreName}" equals post-restore name "${postRestoreName}". ` +
                `Either the slot was already factory (restore was a no-op) or the restore did not land. ` +
                `Cannot disambiguate without bank-file name decode.`,
        };
    }
    return {
        ok: true,
        severity: 'ok',
        preRestoreName,
        postRestoreName,
        message: `verified: pre="${preRestoreName}" -> post="${postRestoreName}"`,
    };
}

async function readNameOrPlaceholder(
    conn: MidiConnection,
    locationIndex: number,
): Promise<string> {
    try {
        const parsed = await readPresetName(conn, locationIndex);
        return parsed.isEmpty ? '<EMPTY>' : parsed.name;
    } catch {
        return '<read-failed>';
    }
}

export function registerFactoryTools(server: McpServer): void {
    server.registerTool('am4_restore_factory', {
        description: [
            'Reset a single AM4 preset location to its factory state. Replays',
            'the embedded factory bank\'s stored-form bytes for the target slot',
            'directly to the device, bypassing the working buffer entirely.',
            'DESTRUCTIVE: overwrites whatever is currently at the location with',
            'no possibility of recovery via the working buffer. Call only when',
            'the user has explicitly asked to reset / restore / revert / factory-',
            'default a slot. Confirm before calling on a slot that may hold',
            'user-customised content - run `am4_scan_locations` or',
            '`am4_get_preset_name` first if the user hasn\'t already.',
            'Working buffer untouched. Active location pointer untouched.',
            'Guitarist can keep playing on a different preset during the restore.',
            'Performance: ~250 ms per restore (6 messages, 30 ms pacing,',
            '~50 ms per message wire time). With verify=true (default) add ~100 ms',
            'for the pre/post name reads. Still inside the conversational latency',
            'budget; no progress message needed.',
            'VERIFICATION (default on): the tool reads the slot name BEFORE the',
            'restore, then reads it AFTER. A successful restore produces a non-',
            'empty name that differs from the pre-restore name. Hard-fail cases:',
            'post-restore reads as <EMPTY> (factory presets are never empty), or',
            'the post-read times out. Soft-warning case: post equals pre (either',
            'the slot was already factory or the restore did not land - we cannot',
            'distinguish without a bank-file name decode). Pass verify=false to',
            'skip both reads if the caller explicitly accepts silent-failure risk.',
            'Confirmed working: hardware-verified 2026-05-08 (Session 51): G03',
            'restored to factory Deluxe Tweed cleanly with all 4 scenes intact.',
        ].join(' '),
        inputSchema: {
            location: z.string().describe(
                'AM4 preset location, format: bank letter A..Z + sub-index 01..04 (e.g. "A01", "G03", "Z04"). Short and zero-padded forms both accepted.',
            ),
            verify: z.boolean().optional().describe(
                'Read the slot name pre and post restore and surface mismatches. Default true. Pass false only if the caller explicitly accepts silent-failure risk.',
            ),
        },
    }, async ({ location, verify }) => {
        const startMs = Date.now();
        const verifyEnabled = verify ?? true;
        const normalized = String(location).trim().toUpperCase();
        let locationIndex: number;
        try {
            locationIndex = parseLocationCode(normalized);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        location: normalized,
                        step: 'validate',
                        error: `Invalid location "${location}": ${reason}`,
                        wallTimeMs: Date.now() - startMs,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        // Surface bank-file load failures (missing file / bad parse) as a clean
        // tool-level error before opening the MIDI port. The error message
        // points the user at the download URL.
        try {
            loadFactoryBank();
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        location: formatLocationDisplay(locationIndex),
                        step: 'bank-load',
                        error: reason,
                        wallTimeMs: Date.now() - startMs,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        const conn = ensureMidi();
        try {
            // Pre-restore name read so we can compare post-restore. Cheap (~50 ms)
            // and the only path the project has to verify the restore actually
            // landed without decoding the masked chunk payload (BK-036).
            const preRestoreName = verifyEnabled
                ? await readNameOrPlaceholder(conn, locationIndex)
                : '<not-read>';
            const result = await sendFactoryRestore(conn, locationIndex);
            const verifyResult = verifyEnabled
                ? await verifyRestoredSlot(conn, locationIndex, preRestoreName)
                : undefined;
            if (verifyResult && verifyResult.severity === 'error') {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            ok: false,
                            location: formatLocationDisplay(locationIndex),
                            step: 'verify',
                            error: verifyResult.message,
                            preRestoreName: verifyResult.preRestoreName,
                            postRestoreName: verifyResult.postRestoreName,
                            totalBytes: result.totalBytes,
                            messageCount: result.messageCount,
                            wallTimeMs: Date.now() - startMs,
                        }, null, 2),
                    }],
                    isError: true,
                };
            }
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: true,
                        location: formatLocationDisplay(locationIndex),
                        totalBytes: result.totalBytes,
                        messageCount: result.messageCount,
                        ...(verifyResult
                            ? {
                                verified: verifyResult.severity === 'ok',
                                verifyMessage: verifyResult.message,
                                preRestoreName: verifyResult.preRestoreName,
                                postRestoreName: verifyResult.postRestoreName,
                            }
                            : { verified: false, verifyMessage: 'verification skipped (verify=false)' }),
                        wallTimeMs: Date.now() - startMs,
                    }, null, 2),
                }],
            };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        location: formatLocationDisplay(locationIndex),
                        step: 'send',
                        error:
                            `Factory restore for ${formatLocationDisplay(locationIndex)} failed: ${reason}. ` +
                            `If this is the first failed write in a while, the MIDI handle may be stale - call reconnect_midi.`,
                        wallTimeMs: Date.now() - startMs,
                    }, null, 2),
                }],
                isError: true,
            };
        }
    });

    server.registerTool('am4_restore_factory_range', {
        description: [
            'Bulk-reset a contiguous range of AM4 preset locations to their',
            'factory state. Use this when the user asks to "reset banks G',
            'through K to stock" or similar. Same destructive semantics as',
            '`am4_restore_factory`, scaled to the range: the embedded factory',
            'bank\'s stored-form bytes for each target slot are replayed',
            'directly to the device, bypassing the working buffer.',
            'DESTRUCTIVE WHOLESALE WRITE - this tool wipes every location in',
            'the range with no recovery via the working buffer. Higher blast',
            'radius than per-preset builds: a 20-slot range can clobber a',
            'gig-ready setlist in ~5 seconds. Confirmation discipline is',
            'mandatory:',
            '  1. Run `am4_scan_locations` over the range FIRST to surface the',
            '     current names for every slot.',
            '  2. List the slots that would be wiped, in slot order, with their',
            '     current names ("G01: Breakdown - Tom Petty", "G02: Billie Jean -',
            '     Michael Jackson", ...).',
            '  3. Ask the user to confirm with "go" or equivalent BEFORE calling',
            '     this tool. The user explicitly opted in to a per-slot wipe by',
            '     seeing the list and saying go.',
            'This confirmation gate is REQUIRED for ranges, NOT optional. Apply',
            'discipline applies in spirit even when the user said "reset banks',
            'G-K" - they may have forgotten which slots in that range hold work',
            'they want to keep. The scan + list + confirm pattern is cheap',
            '(~100ms wire for the scan) and is the only way to catch a "wait,',
            'don\'t wipe G02, that\'s the new tone I built" moment before flash',
            'burns. Empty target ranges (factory presets only) still need the',
            'list-and-confirm pass for symmetry; agents should not introduce',
            'inconsistency by sometimes confirming and sometimes not.',
            'Build operations (am4_apply_preset_at, am4_apply_setlist) do NOT',
            'need this gate - the user\'s build ask IS the confirmation. The',
            'distinction is wholesale-wipe vs creative-build: wholesale-wipe',
            'destroys; creative-build replaces with content the user asked for.',
            'Working buffer untouched. Active location pointer untouched.',
            'Performance: ~250 ms per slot. A 20-slot range ships in ~5',
            'seconds. For >10 slots, narrate the wall-time estimate up front.',
            'Failure semantics: same as `am4_apply_setlist`. `on_error="stop"`',
            '(default) halts immediately on first error and surfaces',
            '`remaining`. `on_error="continue"` logs each error in per-entry',
            'results and proceeds.',
            'Per-slot verification (default on): each slot is read pre and post',
            'restore; mismatches surface as per-entry errors handled by',
            '`on_error`. See `am4_restore_factory` for full semantics.',
            'Dry run: pass `dry_run: true` to validate the range without',
            'sending any wire bytes. Default false.',
        ].join(' '),
        inputSchema: {
            from: z.string().describe(
                'Inclusive start of the restore range, format A01..Z04 (e.g. "G01" for the start of bank G).',
            ),
            to: z.string().describe(
                'Inclusive end of the restore range, format A01..Z04 (e.g. "K04" for the end of bank K).',
            ),
            on_error: z.enum(['stop', 'continue']).optional().describe(
                'Failure handling. "stop" (default) halts on first error; "continue" logs the error and proceeds.',
            ),
            dry_run: z.boolean().optional().describe(
                'Validate the range without sending any wire bytes. Returns { ok, totalSlots, message }. Default false.',
            ),
            verify: z.boolean().optional().describe(
                'After each slot, read the name pre and post and surface mismatches. Default true. Pass false only if the caller explicitly accepts silent-failure risk.',
            ),
        },
    }, async ({ from, to, on_error, dry_run, verify }) => {
        const startMs = Date.now();
        const onError: 'stop' | 'continue' = on_error ?? 'stop';
        const dryRun = dry_run ?? false;
        const verifyEnabled = verify ?? true;
        const fromNorm = String(from).trim().toUpperCase();
        const toNorm = String(to).trim().toUpperCase();
        let fromIdx: number;
        let toIdx: number;
        try {
            fromIdx = parseLocationCode(fromNorm);
            toIdx = parseLocationCode(toNorm);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        step: 'validate',
                        error: `Invalid range "${from}".."${to}": ${reason}`,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        if (fromIdx > toIdx) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        step: 'validate',
                        error:
                            `Invalid range: "${from}" (index ${fromIdx}) is after "${to}" (index ${toIdx}). ` +
                            `Pass from <= to (e.g. from="G01", to="K04").`,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        const totalSlots = toIdx - fromIdx + 1;
        // Hard ceiling at 26 slots, matching `am4_apply_setlist`. Restoring
        // every location at once is a power-user operation that doesn't
        // belong behind a single tool call - encourage the user to confirm
        // bank-by-bank intent.
        const RANGE_CEILING = 26;
        if (totalSlots > RANGE_CEILING) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        step: 'validate',
                        error:
                            `Range size ${totalSlots} exceeds the per-call ceiling of ${RANGE_CEILING} slots. ` +
                            `Split the restore into multiple calls (e.g. one bank at a time).`,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        // Surface bank-file load failures up front, before opening MIDI.
        try {
            loadFactoryBank();
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: false,
                        step: 'bank-load',
                        error: reason,
                    }, null, 2),
                }],
                isError: true,
            };
        }
        if (dryRun) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        ok: true,
                        totalSlots,
                        message: `Dry run: range ${formatLocationDisplay(fromIdx)}..${formatLocationDisplay(toIdx)} validated (${totalSlots} slot(s)). No writes performed.`,
                    }, null, 2),
                }],
            };
        }
        // Live execution.
        const conn = ensureMidi();
        const results: {
            location: string;
            status: 'ok' | 'error';
            error?: string;
            preRestoreName?: string;
            postRestoreName?: string;
            wallTimeMs: number;
        }[] = [];
        let restored = 0;
        let failed = 0;
        let stopIndex: number | undefined;
        for (let i = 0; i < totalSlots; i++) {
            const locationIndex = fromIdx + i;
            const display = formatLocationDisplay(locationIndex);
            const slotStart = Date.now();
            try {
                const preRestoreName = verifyEnabled
                    ? await readNameOrPlaceholder(conn, locationIndex)
                    : '<not-read>';
                const r = await sendFactoryRestore(conn, locationIndex);
                const verifyResult = verifyEnabled
                    ? await verifyRestoredSlot(conn, locationIndex, preRestoreName)
                    : undefined;
                if (verifyResult && verifyResult.severity === 'error') {
                    failed++;
                    results.push({
                        location: display,
                        status: 'error',
                        error: verifyResult.message,
                        preRestoreName: verifyResult.preRestoreName,
                        postRestoreName: verifyResult.postRestoreName,
                        wallTimeMs: Date.now() - slotStart,
                    });
                    if (onError === 'stop') {
                        stopIndex = i;
                        break;
                    }
                    continue;
                }
                restored++;
                results.push({
                    location: display,
                    status: 'ok',
                    wallTimeMs: r.wallTimeMs,
                    ...(verifyResult
                        ? {
                            preRestoreName: verifyResult.preRestoreName,
                            postRestoreName: verifyResult.postRestoreName,
                        }
                        : {}),
                });
            } catch (err) {
                failed++;
                const reason = err instanceof Error ? err.message : String(err);
                results.push({
                    location: display,
                    status: 'error',
                    error: reason,
                    wallTimeMs: Date.now() - slotStart,
                });
                if (onError === 'stop') {
                    stopIndex = i;
                    break;
                }
            }
        }
        const remaining =
            stopIndex !== undefined
                ? Array.from({ length: totalSlots - stopIndex - 1 }, (_, k) =>
                    formatLocationDisplay(fromIdx + stopIndex! + 1 + k),
                )
                : [];
        const summary = {
            total: totalSlots,
            restored,
            failed,
            remaining,
            results,
            totalWallTimeMs: Date.now() - startMs,
        };
        return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            isError: failed > 0,
        };
    });
}
