/**
 * Axe-Fx III SET_PARAMETER hypothesis probe.
 *
 * Ports the wire-decode question to the device: the v1.4 PDF does NOT
 * document per-parameter writes on the III, but the AxeEdit III binary
 * + community sources point at multiple candidate opcodes. This probe
 * builds one outgoing SysEx frame per ranked hypothesis and watches
 * inbound for the device's response (success echo OR
 * `0x64 MULTIPURPOSE_RESPONSE` error frame). Whichever frame the
 * device acknowledges or echoes is the winner.
 *
 * Target operation under test:
 *
 *   axefx3_set_parameter(block='Reverb 1', param_id=0, value=0)
 *
 * Why this target. Reverb 1 has effect ID 66 per v1.4 Appendix 1
 * (a hardware-verifiable starting point). paramId 0 of REVERB is
 * REVERB_TYPE per Ghidra Session 82 mining; setting value 0 should
 * select the first reverb algorithm (a small, audible change if the
 * frame is accepted, an error code if rejected). Value 0 is the
 * safest test value — no out-of-range concerns.
 *
 * READ-ONLY-EXCEPT-FOR-THIS-PROBE policy: this script sends ONLY the
 * candidate SET frames listed below. It does NOT save the preset.
 * Switching presets discards the working buffer, so the probe is
 * fully reversible.
 *
 * SETUP CHECKLIST (founder + Axe-Fx III owner):
 *
 *   1. Power on the Axe-Fx III. USB connected.
 *   2. Switch to a scratch preset that contains a Reverb 1 block. (Any
 *      factory preset with reverb works; the probe doesn't care
 *      what's IN reverb 1 currently — only that it exists so paramId
 *      writes have a target.)
 *   3. Close AxeEdit III and Claude Desktop. Windows MIDI ports are
 *      single-writer; both apps hold the III port exclusively.
 *   4. Optional: connect a guitar + speakers so you can audibly
 *      confirm any reverb-type change. Not required — the device's
 *      response frames tell us what it accepted.
 *
 * Run:
 *
 *   npx tsx scripts/_research/probe-axefx3-setparam-hypothesis.ts
 *
 * EXPECTED ACCEPTANCE OUTCOMES (per hypothesis):
 *
 *   - SUCCESS: the device echoes back a 0x02 (or whichever fn we
 *     probed) frame with the same effectId + paramId. That's the
 *     winner — wire shape confirmed. Front panel may also show a
 *     reverb-type change.
 *
 *   - REJECTED (USEFUL NEGATIVE): the device sends back
 *     `F0 00 01 74 10 64 [echoed_fn] [result_code] [cs] F7`. The
 *     `echoed_fn` confirms the device PARSED the function byte (so
 *     the envelope is fine) and the `result_code` tells us what was
 *     wrong with the rest of the payload. Common codes:
 *       - 0x04 MIDI_ERROR_MSG_NOT_RECOGNIZED → fn byte unsupported
 *       - 0x03 MIDI_ERROR_BAD_ARGUMENT → fn supported, payload bad
 *       - 0x06 MIDI_ERROR_INVALID_PARAMID → paramId out of range
 *     Full code table in SYSEX-MAP-AXE-FX-III.md.
 *
 *   - SILENT (AMBIGUOUS): the device ignores the frame entirely.
 *     This is INCONCLUSIVE — could mean (a) the fn byte hit a code
 *     path that doesn't ack writes (some II GETs don't ack on certain
 *     blocks per wiki), or (b) the envelope was malformed before
 *     fn parsing. Pair with an active-state read after each probe to
 *     distinguish.
 *
 * Each hypothesis is built BYTE-EXACT here so this script is also a
 * documentation artifact: when the III contributor runs it, the
 * output enumerates every candidate envelope with its rationale + the
 * device response observed, locking the wire decode in the session
 * log.
 *
 * **No III hardware available at the founder's site as of Session 89
 * — this script is designed to be hardware-ready for the first III
 * contributor to run. Without hardware, `--dry-run` mode is the
 * default and prints the candidate frames without attempting a
 * MIDI open.**
 */

import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

/** Helper: hex-format a byte array uppercase, space-separated. */
function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Helper: pretty-print as a single contiguous hex string (for grep). */
function toHexCompact(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Probe target ───────────────────────────────────────────────────

const AXE_FX_III_MODEL_ID = 0x10;

/** Reverb 1 — effect ID 66 per v1.4 Appendix 1. */
const TARGET_EFFECT_ID = 66;

/** REVERB paramId 0 = REVERB_TYPE per Ghidra catalog. */
const TARGET_PARAM_ID = 0;

/**
 * Value 0 — selects the first entry in the REVERB_TYPE enum. Safe to
 * write: a reverb-type change is audible but harmless and reversible
 * (the preset can be reloaded with no save). On the AM4 the first
 * reverb type is "Hall, Small" — likely similar on the III.
 */
const TARGET_VALUE = 0;

// ── Envelope encoders ─────────────────────────────────────────────

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const FRACTAL_PREFIX = [0x00, 0x01, 0x74] as const;

function encode14LsFirst(n: number): [number, number] {
  if (!Number.isInteger(n) || n < 0 || n > 0x3fff) {
    throw new Error(`encode14LsFirst: ${n} out of range`);
  }
  return [n & 0x7f, (n >> 7) & 0x7f];
}

function encode14MsFirst(n: number): [number, number] {
  if (!Number.isInteger(n) || n < 0 || n > 0x3fff) {
    throw new Error(`encode14MsFirst: ${n} out of range`);
  }
  return [(n >> 7) & 0x7f, n & 0x7f];
}

function packValue16LsFirst(value: number): [number, number, number] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`packValue16LsFirst: ${value} out of range`);
  }
  return [value & 0x7f, (value >> 7) & 0x7f, (value >> 14) & 0x03];
}

function envelopeWithChecksum(payload: readonly number[]): number[] {
  const head = [SYSEX_START, ...FRACTAL_PREFIX, AXE_FX_III_MODEL_ID, ...payload];
  return [...head, fractalChecksum(head), SYSEX_END];
}

// ── Candidate hypotheses ──────────────────────────────────────────
//
// Ranked highest → lowest confidence. Each hypothesis is one MIDI
// send + 250 ms inbound listen.

interface Hypothesis {
  /** Short id (printed in output + suitable as session-log tag). */
  id: string;
  /** Human-readable title for the probe summary table. */
  title: string;
  /** Wire fn byte under test. */
  fn: number;
  /** Confidence ranking note for the session log. */
  confidence: string;
  /** Where the hypothesis came from. */
  evidence: string;
  /** Built outgoing frame bytes. */
  frame: number[];
}

function buildHypotheses(): Hypothesis[] {
  const out: Hypothesis[] = [];

  // ── H1: II-ported 0x02 (current shipping wire shape) ────────────
  //
  // The 16-byte II encoder ported to III by swapping the model byte
  // 0x03→0x10 (commit 6b8ab07, Session 85). Encoded values are LS-
  // first 14-bit septet pairs for effectId + paramId, LS-first 3-
  // septet pack for the 16-bit value, action byte 0x01 (SET commit).
  //
  // Evidence: prs22 forum thread #49417 (2012) for the II wire shape;
  // Chris Hurley thread #140602 (2018) used the same on II XL+; the
  // AxeEdit III binary contains code paths reachable via 0x02 (Ghidra
  // Session 82 caller-list). Single highest-confidence candidate.
  out.push({
    id: 'H1_II_PORT_0x02_LE',
    title: 'fn=0x02, II-shape, LS-first 14-bit + 3-septet 16-bit value, SET action',
    fn: 0x02,
    confidence: 'HIGHEST — matches shipping axefx3_set_parameter encoder',
    evidence:
      'II hardware-verified on Q8.02 (HW-075). AxeEdit III binary uses 0x02 ' +
      '(Ghidra Session 82). prs22 forum #49417 + Chris Hurley #140602.',
    frame: envelopeWithChecksum([
      0x02,
      ...encode14LsFirst(TARGET_EFFECT_ID),
      ...encode14LsFirst(TARGET_PARAM_ID),
      ...packValue16LsFirst(TARGET_VALUE),
      0x01, // SET action
    ]),
  });

  // ── H2: 0x02 with QUERY action (round-trip safer test) ───────────
  //
  // Same envelope as H1 but action=0x00 (QUERY). This is the
  // axefx3_get_parameter path. If the III silently ignores SETs but
  // responds to GETs, this hypothesis succeeds where H1 fails, giving
  // us a read-only confirmation of the wire shape.
  //
  // Evidence: identical to H1; pure safer-variant ranking.
  out.push({
    id: 'H2_II_PORT_0x02_QUERY',
    title: 'fn=0x02, II-shape, QUERY action (safer — read-only)',
    fn: 0x02,
    confidence: 'HIGH — read-only variant of H1; preferred if H1 has no audible effect',
    evidence:
      'II GET tested HW-077. III response shape unverified — may carry a label ' +
      'string after the value field per II convention.',
    frame: envelopeWithChecksum([
      0x02,
      ...encode14LsFirst(TARGET_EFFECT_ID),
      ...encode14LsFirst(TARGET_PARAM_ID),
      0x00, 0x00, 0x00, // value field zero (per II wiki: any value OK on QUERY)
      0x00, // QUERY action
    ]),
  });

  // ── H3: 0x02 with MS-first 14-bit fields ─────────────────────────
  //
  // The II's STORE_PRESET (0x1D) and GET_PRESET_NUMBER (0x14) use
  // MS-first byte ordering (HW-100 / HW-102), contrary to the wiki.
  // Possible the III's SET_PARAMETER also uses MS-first. Tests the
  // hypothesis by swapping the byte order of effectId + paramId only;
  // the value field stays LS-first (the 3-septet pack has a natural
  // bit-order that's independent of "endianness").
  //
  // Evidence: II MS-first variants are hardware-verified for two
  // other 14-bit fields; cross-application to per-block SET_PARAM is
  // an extension of the same firmware quirk.
  out.push({
    id: 'H3_0x02_MS_FIRST_IDS',
    title: 'fn=0x02, MS-first 14-bit effectId/paramId, LS-first value, SET',
    fn: 0x02,
    confidence: 'MEDIUM — II STORE_PRESET / GET_PRESET_NUMBER are MS-first per HW-100/102',
    evidence:
      'II 0x1D STORE_PRESET + 0x14 GET_PRESET_NUMBER use MS-first byte ordering ' +
      'despite wiki saying LS-first. Extension to III 0x02 is the firmware quirk.',
    frame: envelopeWithChecksum([
      0x02,
      ...encode14MsFirst(TARGET_EFFECT_ID),
      ...encode14MsFirst(TARGET_PARAM_ID),
      ...packValue16LsFirst(TARGET_VALUE),
      0x01,
    ]),
  });

  // ── H4: fn=0x01 long-payload (AmpBoost capture shape) ────────────
  //
  // Real-world captures of AxeEdit III / FC-12 traffic show ~16-byte
  // payloads under function 0x01 — undocumented in v1.4. From
  // SYSEX-MAP-AXE-FX-III.md §"Function 0x01":
  //
  //   Amp 1 Boost on:  F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 7C 03 00 00 00 00 2B F7
  //   Amp 1 Boost off: F0 00 01 74 10 01 52 00 3A 00 28 00 00 00 00 00 00 00 00 00 00 54 F7
  //
  // The capture's payload after the fn byte is 16 bytes:
  //   [52 00] [3A 00] [28 00 00 00 00] [7C 03 00 00 00 00] [00]
  //
  // Tentative shape: [effectId × 2 LS-first][paramId × 2 LS-first]
  //                  [5-byte ? — context / address / etc.]
  //                  [6-byte value][1-byte ? trailing]
  //
  // The on/off pair differs only in the `7C 03 → 00 00` swap inside
  // the value region, so that's where the 0/N gets written. We mimic
  // the observed prefix exactly except for swapping the (effectId,
  // paramId) = (Amp 1 = 82, 58) to Reverb 1 (66, 0) and the value
  // bytes to 0 (matching the off-frame).
  //
  // (Note: the capture's first 14-bit pair `52 00` decodes to 82,
  // which the post labels as Amp 1. AMP is NOT enumerated in v1.4
  // Appendix 1 — it's in the unaccounted-for 3..34 / post-firmware-
  // 1.13 range. We use 66 = 0x42 for Reverb 1 which IS in v1.4
  // Appendix 1, so the resolver / target is unambiguous.)
  //
  // Evidence: USB capture of real AxeEdit III traffic. The shape is
  // observed but the field semantics aren't decoded — this probe is
  // worth running to see if the III ACKs OR rejects it.
  const fn01Payload = [
    0x01, // fn
    0x42, 0x00, // effectId 66 (Reverb 1) LS-first 14-bit septet pair
    0x00, 0x00, // paramId 0 LS-first 14-bit septet pair
    0x28, 0x00, 0x00, 0x00, 0x00, // 5-byte ? — copied verbatim from Amp 1 Boost capture
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 6-byte value field set to all-zero (off-shape)
    0x00, // 1-byte trailing ? — also zero in the off-shape capture
  ];
  out.push({
    id: 'H4_fn0x01_LONG_PAYLOAD',
    title: 'fn=0x01, 16-byte payload (AxeEdit III capture shape, value=0)',
    fn: 0x01,
    confidence: 'MEDIUM-LOW — observed in captures but field semantics unverified',
    evidence:
      'AxeEdit III / FC-12 captures in SYSEX-MAP-AXE-FX-III.md §"Function 0x01". ' +
      'Amp 1 Boost on/off pair differs only in value bytes, confirming shape. ' +
      'effectId swapped from Amp 1 (82) to Reverb 1 (66); value-region zeroed.',
    frame: envelopeWithChecksum(fn01Payload),
  });

  // ── H5: fn=0x12 undocumented (Ghidra 2× caller, model field) ─────
  //
  // Ghidra Session 82 catalog of AxeEdit III fn bytes lists 0x12 as
  // "undocumented (2× callers), payload `local_res10, 1, model-from-
  // struct`". Plausible candidate for a SET_PARAMETER-adjacent op:
  // the payload-includes-model pattern matches how SET_PARAMETER
  // varies across the family. We probe the same II-shape payload
  // under 0x12 to see if the device parses it.
  //
  // Evidence: Ghidra caller-list only. No capture, no community
  // mention. Speculative — but cheap to probe.
  out.push({
    id: 'H5_fn0x12_II_SHAPE',
    title: 'fn=0x12, II-shape payload (undocumented opcode, Ghidra Session 82)',
    fn: 0x12,
    confidence: 'LOW — speculative; 0x12 seen in Ghidra caller-list but no capture',
    evidence:
      'Ghidra Session 82 mined fn-byte inventory marks 0x12 as undocumented with ' +
      '2 caller sites. Probing the same payload shape as H1 under fn=0x12 to see ' +
      'if it parses.',
    frame: envelopeWithChecksum([
      0x12,
      ...encode14LsFirst(TARGET_EFFECT_ID),
      ...encode14LsFirst(TARGET_PARAM_ID),
      ...packValue16LsFirst(TARGET_VALUE),
      0x01,
    ]),
  });

  return out;
}

// ── Inbound response classification ───────────────────────────────

function isFractalIIIFrame(bytes: readonly number[]): boolean {
  return (
    bytes.length >= 7 &&
    bytes[0] === SYSEX_START &&
    bytes[1] === FRACTAL_PREFIX[0] &&
    bytes[2] === FRACTAL_PREFIX[1] &&
    bytes[3] === FRACTAL_PREFIX[2] &&
    bytes[4] === AXE_FX_III_MODEL_ID &&
    bytes[bytes.length - 1] === SYSEX_END
  );
}

function classifyResponse(bytes: readonly number[], expectedFn: number): string {
  if (!isFractalIIIFrame(bytes)) {
    return `non-III frame (${bytes.length}B): ${toHex(bytes.slice(0, 8))}…`;
  }
  const fn = bytes[5];
  if (fn === 0x64) {
    // MULTIPURPOSE_RESPONSE: [echoed_fn, result_code]
    if (bytes.length >= 10) {
      const echoedFn = bytes[6];
      const resultCode = bytes[7];
      return (
        `❌ MULTIPURPOSE_RESPONSE (0x64): echoed_fn=0x${echoedFn.toString(16)} ` +
        `result_code=0x${resultCode.toString(16).padStart(2, '0')} ` +
        `(${describeResultCode(resultCode)})`
      );
    }
    return `❌ MULTIPURPOSE_RESPONSE (0x64), too short to parse: ${toHex(bytes)}`;
  }
  if (fn === expectedFn) {
    return `✓ ECHO of fn=0x${fn.toString(16)} (${bytes.length}B): ${toHex(bytes)}`;
  }
  return `? unrelated fn=0x${fn.toString(16)} (${bytes.length}B): ${toHex(bytes)}`;
}

// Subset of the 28-code MIDI_ERROR_* table from SYSEX-MAP-AXE-FX-III.md.
function describeResultCode(code: number): string {
  switch (code) {
    case 0x00: return 'BAD_CHKSUM';
    case 0x03: return 'BAD_ARGUMENT — fn parsed, payload rejected';
    case 0x04: return 'MSG_NOT_RECOGNIZED — fn unsupported';
    case 0x05: return 'INVALID_FXID — effect ID rejected';
    case 0x06: return 'INVALID_PARAMID — paramId out of range';
    case 0x07: return 'FX_NOT_IN_USE — Reverb 1 not in this preset';
    default: return `code 0x${code.toString(16).padStart(2, '0')} (see SYSEX-MAP-AXE-FX-III.md result code table)`;
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--live');

  const hypotheses = buildHypotheses();

  console.log('Axe-Fx III SET_PARAMETER hypothesis probe');
  console.log('==========================================\n');
  console.log(`Target: Reverb 1 (effectId=66), REVERB_TYPE (paramId=0), value=0`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no MIDI open; pass --live to send)' : 'LIVE (will open MIDI port)'}\n`);

  console.log(`Candidate envelopes (${hypotheses.length}):\n`);
  for (const h of hypotheses) {
    console.log(`[${h.id}] ${h.title}`);
    console.log(`  confidence: ${h.confidence}`);
    console.log(`  evidence:   ${h.evidence}`);
    console.log(`  fn byte:    0x${h.fn.toString(16).padStart(2, '0')}`);
    console.log(`  frame (${h.frame.length}B): ${toHex(h.frame)}`);
    console.log(`  compact:    ${toHexCompact(h.frame)}`);
    console.log();
  }

  if (dryRun) {
    console.log('Dry-run complete. No MIDI traffic sent.');
    console.log('To execute against real III hardware:');
    console.log('  1. Close AxeEdit III and Claude Desktop (Windows MIDI is single-writer)');
    console.log('  2. Switch the III to a scratch preset containing Reverb 1');
    console.log('  3. npx tsx scripts/_research/probe-axefx3-setparam-hypothesis.ts --live');
    console.log();
    console.log('Each hypothesis will be sent in sequence with a 250 ms inbound listen.');
    console.log('Update SYSEX-MAP-AXE-FX-III.md §"0x02 SET_PARAMETER hypothesis"');
    console.log('with the winning hypothesis once observed.');
    return;
  }

  // ── Live execution path ────────────────────────────────────────
  //
  // Import the III MIDI connector lazily so dry-run mode doesn't
  // trigger a native-module load (the worktree may not have the
  // node-midi binary built).
  console.log('Opening Axe-Fx III MIDI port...');
  const { connectAxeFxIII } = await import('@mcp-midi-control/axe-fx-iii/midi.js');
  let conn: Awaited<ReturnType<typeof connectAxeFxIII>>;
  try {
    conn = connectAxeFxIII();
  } catch (err) {
    console.error('❌ Failed to connect:', err instanceof Error ? err.message : err);
    console.error('   Make sure (1) Axe-Fx III is powered on + USB connected,');
    console.error('   AND (2) AxeEdit III + Claude Desktop are CLOSED (single-writer port).');
    process.exit(1);
  }
  if (!conn.hasInput) {
    console.error('❌ Opened output but no input port available — cannot capture responses.');
    process.exit(1);
  }
  console.log('✓ Connected (bidirectional)\n');

  // Sequential probe: send each frame, listen 250 ms for any inbound,
  // log everything we see.
  for (const h of hypotheses) {
    console.log(`─── Probe [${h.id}] ───`);
    console.log(`  Sending ${h.frame.length}B: ${toHex(h.frame)}`);
    const inbound: number[][] = [];
    const unsubscribe = conn.onMessage((bytes) => {
      // Only collect SysEx frames (start with F0 / end with F7); ignore
      // realtime + channel-voice clutter.
      if (bytes.length > 0 && bytes[0] === SYSEX_START) {
        inbound.push([...bytes]);
      }
    });
    try {
      conn.send(h.frame);
      if (conn.lastSendError) {
        console.log(`  ⚠ send error: ${conn.lastSendError.message}`);
        continue;
      }
      // Listen window. 250 ms is the same budget the
      // axefx3_set_parameter tool uses for sendAndWatchForError.
      await sleep(250);
    } finally {
      unsubscribe();
    }
    if (inbound.length === 0) {
      console.log(`  ⏵ no response (silent — ambiguous, see header for what that means)`);
    } else {
      for (const bytes of inbound) {
        console.log(`  ← ${classifyResponse(bytes, h.fn)}`);
      }
    }
    console.log();
    // Inter-probe pause so the III's state-broadcast (if any) doesn't
    // bleed into the next probe's listen window.
    await sleep(150);
  }

  console.log('Probe sweep complete.');
  console.log('Update SYSEX-MAP-AXE-FX-III.md §"0x02 SET_PARAMETER hypothesis"');
  console.log('with the winning hypothesis. The first frame whose response was');
  console.log('an ECHO of its fn byte is the answer.');

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
