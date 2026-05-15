/**
 * AM4-specific MIDI helpers. Thin wrappers over the generic transport
 * in `@/core/midi/transport.ts` plus the AM4 SysEx-aware inbound
 * message describer used by every AM4 tool's diagnostic timeline.
 *
 * Generic MIDI port enumeration / connect / hex helpers live in
 * `@/core/midi/transport.ts`. Re-exported below until call sites are
 * migrated to import from core directly.
 */

import {
  connect,
  listMidiPorts as listMidiPortsGeneric,
  mockConnect,
  type MidiConnection,
  type MidiPortInfo as GenericMidiPortInfo,
  type MockResponder,
} from '@mcp-midi-control/core/midi/transport.js';
import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

export {
  connect,
  toHex,
  type ConnectOptions,
  type MidiConnection,
} from '@mcp-midi-control/core/midi/transport.js';

/** Substrings used to find AM4 ports — `am4` matches Windows/Mac, `fractal` covers some driver variants. */
export const AM4_PORT_NEEDLES = ['am4', 'fractal'] as const;

/**
 * Backwards-compat alias retained while the codebase migrates from the
 * single-device era. New code should use `MidiConnection` from
 * `@/core/midi/transport`.
 */
export type AM4Connection = MidiConnection;

/**
 * AM4-flavored port info: the generic `MidiPortInfo` plus a
 * `looksLikeAM4` flag tagged against the AM4 needle list. Existing
 * call sites read `looksLikeAM4` directly; new code should pass the
 * AM4 needles into `listMidiPorts` and read `matched` instead.
 */
export interface MidiPortInfo extends GenericMidiPortInfo {
  looksLikeAM4: boolean;
}

/**
 * AM4-flavored port enumeration. Always tags `looksLikeAM4` against
 * the AM4 needle list, regardless of what `needles` is passed.
 * Defaults to the AM4 needles, so AM4-specific callers can call
 * `listMidiPorts()` with no args.
 */
export function listMidiPorts(
  needles: readonly string[] = AM4_PORT_NEEDLES,
): { inputs: MidiPortInfo[]; outputs: MidiPortInfo[] } {
  const both = listMidiPortsGeneric(needles);
  const tag = (p: GenericMidiPortInfo): MidiPortInfo => ({
    ...p,
    looksLikeAM4: AM4_PORT_NEEDLES.some((n) => p.name.toLowerCase().includes(n)),
  });
  return {
    inputs: both.inputs.map(tag),
    outputs: both.outputs.map(tag),
  };
}

/**
 * Open a connection to the AM4. Thin wrapper around `connect()` that
 * supplies the AM4-specific name needles and the install/driver hints
 * users hit during AM4 onboarding.
 *
 * When `MCP_MOCK_TRANSPORT=1` is set in the environment, returns a
 * mock connection backed by `am4MockResponder` (no USB). Lets the
 * agent-regression harness exercise the full dispatcher pipeline
 * (display → wire encoding, channel switching, validator-layer error
 * envelopes, applyExecutor) against in-memory state. Real-hardware
 * release-gate tests (launch-verify, Desktop e2e) ignore the flag.
 */
export function connectAM4(): MidiConnection {
  if (process.env.MCP_MOCK_TRANSPORT === '1') {
    return mockConnect({ responder: am4MockResponder });
  }
  return connect({
    needles: AM4_PORT_NEEDLES,
    notFoundLeadIn: 'AM4 not found in the MIDI device list. Common causes:',
    notFoundHints: [
      '  - AM4 is powered off or not connected by USB',
      '  - AM4 USB driver not installed (https://www.fractalaudio.com/am4-downloads/)',
      '',
      'Once the AM4 is visible, call `list_midi_ports` to confirm the server sees it, then retry. Use `reconnect_midi` to force a fresh handle.',
    ],
  });
}

/**
 * AM4-specific mock response synthesizer. Given an outgoing SysEx
 * frame, returns the inbound responses the AM4 would emit.
 *
 * Recognized shapes (see `setParam.ts` for outgoing layouts, this file's
 * `describeAm4InboundMessage` for inbound ack envelopes):
 *
 *   - 0x01 PARAM_RW + action=0x0001 (WRITE) → 64-byte write-echo
 *     (hdr4=0x0028). Satisfies `isWriteEcho` predicate.
 *   - 0x01 PARAM_RW + action≠WRITE (save/rename/preset-switch) →
 *     18-byte command-ack (hdr4=0x0000). Satisfies `isCommandAck`.
 *   - 0x12 mode switch → no response (write-only, no ack expected).
 *   - 0x01 PARAM_RW + action=0x0026 (READ) → 64-byte READ response,
 *     same shape as the write-echo (hdr4=0x0028, dummy 40-byte
 *     value descriptor). Sufficient for `get_param` to resolve;
 *     the value won't reflect real state (no in-memory state model
 *     yet — added if/when read-back tests need it).
 *
 * Predicate-only correctness: the AM4 ack predicates check structural
 * fields (envelope + function + addressing + hdr4) but ignore the
 * payload bytes. The mock fills the payload with zeros. If a future
 * test needs a specific value read-back, extend this with an
 * in-memory device-state map.
 */
const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const ACTION_WRITE_LO = 0x01; // 14-bit septet encoding of action 0x0001
const HDR4_WRITE_ECHO_LO = 0x28; // hdr4 = 0x0028 (40-byte descriptor)

export const am4MockResponder: MockResponder = (outgoing) => {
  if (outgoing.length < 8) return [];
  if (outgoing[0] !== SYSEX_START) return [];
  // Envelope: F0 00 01 74 15 [fn] ...
  if (outgoing[1] !== 0x00 || outgoing[2] !== 0x01 || outgoing[3] !== 0x74 || outgoing[4] !== 0x15) {
    return [];
  }
  const fn = outgoing[5];
  if (fn !== 0x01) return []; // mode switches (0x12) etc. are write-only — no ack
  if (outgoing.length < 12) return [];
  const actionLo = outgoing[10];
  const actionHi = outgoing[11];
  const isWriteAction = actionLo === ACTION_WRITE_LO && actionHi === 0x00;

  if (isWriteAction) {
    // 64-byte write-echo. Predicate isWriteEcho only checks bytes 0..15
    // for structural fields — the 40-byte payload (bytes 16..55) is
    // ignored. Zero-filled payload + correct header is sufficient.
    const body: number[] = new Array<number>(62).fill(0);
    body[0] = SYSEX_START;
    // bytes 1..9: copy envelope + fn + pidLow + pidHigh from outgoing.
    for (let i = 1; i <= 9; i++) body[i] = outgoing[i] ?? 0;
    body[10] = ACTION_WRITE_LO;
    body[11] = 0x00;
    body[12] = 0x00;
    body[13] = 0x00;
    body[14] = HDR4_WRITE_ECHO_LO;
    body[15] = 0x00;
    // bytes 16..61: zero-filled payload — already initialized.
    const cs = fractalChecksum(body);
    return [[...body, cs, SYSEX_END]];
  }

  // 18-byte command-ack. Predicate isCommandAck requires exact length 18,
  // bytes 0..11 copied from outgoing, bytes 12..15 all zero.
  const ack: number[] = new Array<number>(16).fill(0);
  ack[0] = SYSEX_START;
  for (let i = 1; i <= 11; i++) ack[i] = outgoing[i] ?? 0;
  // bytes 12..15 stay zero.
  const cs = fractalChecksum(ack);
  return [[...ack, cs, SYSEX_END]];
};

// Register the AM4 connector with the shared connection registry as a
// side effect of loading this module. Importing anything from `am4/midi.ts`
// (or any module that transitively imports it) makes `ensureConnection(
// AM4_LABEL)` route through `connectAM4()` automatically. Tools and
// scripts that don't import this module fall back to the generic
// substring connect — fine for ad-hoc port lookups.
import { registerConnector, AM4_LABEL } from '@mcp-midi-control/core/server-shared/connections.js';
registerConnector(AM4_LABEL, connectAM4);

// -- AM4 inbound-message describer -----------------------------------------

import { toHex } from '@mcp-midi-control/core/midi/transport.js';

/**
 * AM4 SysEx envelope prefix: F0 00 01 74 15. Anything that doesn't start
 * with these 5 bytes (after the 0xF0) is non-AM4 SysEx and gets a generic
 * "non-AM4 SysEx" label so we still report it instead of pretending nothing
 * arrived.
 */
const AM4_SYSEX_PREFIX = [0x00, 0x01, 0x74, 0x15] as const;

/**
 * Decode 14-bit septet-encoded little-endian pair: low byte (bits 0-6) +
 * high byte (bits 7-13). Used by every AM4 ack we label here — function
 * arguments, action codes, and PP/QQ preset-number fields all follow this.
 */
function decode14(lo: number, hi: number): number {
  return ((hi & 0x7f) << 7) | (lo & 0x7f);
}

/**
 * Human-readable label for an inbound MIDI message — primarily AM4 SysEx
 * acks/responses, with a sensible fallback for non-SysEx (CC / PC / Note)
 * and non-AM4 SysEx so diagnostic tools never hide messages.
 *
 * AM4 envelope: `F0 00 01 74 15 [function] [payload...] [checksum] F7`.
 * Documented function bytes that we label (cross-reference
 * `docs/SYSEX-MAP.md`):
 *
 *   - 0x01 PARAM_RW — write echo (64B, hdr4=0x0028) or 18B command-ack
 *           (save / preset-rename / scene-rename — addressing-only echo
 *           with zero payload).
 *   - 0x08 GET_FIRMWARE_VERSION response.
 *   - 0x14 GET_PRESET_NUMBER response (PP=bits 0-6, QQ=bits 7-13).
 *   - 0x12 mode switch (only ever sent outbound; included for round-trip
 *           captures — labelled "Mode switch" if it ever turns up inbound).
 *   - 0x64 MULTIPURPOSE_RESPONSE — generic ACK/NACK `[FN, RC]`. RC=0x00
 *           OK, RC=0x05 "parsed but not honored" (the NACK class — see
 *           SYSEX-MAP §6 on 0x0F GET_PRESET_NAME for the canonical
 *           example).
 *
 * Anything else (recognised function but unrecognised payload shape) gets
 * labelled `function 0xNN` so unknowns are still searchable in logs.
 *
 * Pure function — no I/O, no state. Goldens-friendly.
 */
export function describeAm4InboundMessage(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  const hex = toHex(arr);
  if (arr.length === 0) return '(empty message)';
  if (arr[0] !== 0xf0) {
    const status = arr[0] ?? 0;
    if ((status & 0xf0) === 0xb0) return `CC ch=${(status & 0x0f) + 1} #${arr[1]}=${arr[2]} (${hex})`;
    if ((status & 0xf0) === 0xc0) return `PC ch=${(status & 0x0f) + 1} program=${arr[1]} (${hex})`;
    if ((status & 0xf0) === 0x90) return `NoteOn ch=${(status & 0x0f) + 1} note=${arr[1]} vel=${arr[2]} (${hex})`;
    if ((status & 0xf0) === 0x80) return `NoteOff ch=${(status & 0x0f) + 1} note=${arr[1]} (${hex})`;
    return `Other ${hex}`;
  }
  // SysEx: must end in 0xF7 to be parseable as a complete envelope.
  if (arr[arr.length - 1] !== 0xf7) {
    return `SysEx (truncated, no F7) ${hex}`;
  }
  // Check AM4 manufacturer prefix (after F0): 00 01 74 15.
  const prefixOk = AM4_SYSEX_PREFIX.every((b, i) => arr[i + 1] === b);
  if (!prefixOk) {
    return `non-AM4 SysEx ${hex}`;
  }
  if (arr.length < 8) {
    // Need at least F0 00 01 74 15 [fn] [cksum] F7 = 8 bytes.
    return `AM4 SysEx (too short, ${arr.length}B) ${hex}`;
  }
  const fn = arr[5]!;
  // Strip envelope (F0 + prefix + fn) and trailing (cksum + F7).
  // Indices [6 .. length-3] inclusive are payload.
  const payload = arr.slice(6, arr.length - 2);
  switch (fn) {
    case 0x01: {
      // PARAM_RW family. Two known shapes:
      //   - 64-byte SET_PARAM write-echo (hdr4 = 0x0028, 40-byte payload).
      //   - 18-byte command-ack (save / rename — addressing-only echo, zero
      //     payload, hdr4 = 0x0000).
      // Both share the [pidLow_septets, pidHigh_septets, action_septets, ...]
      // layout immediately after fn.
      if (payload.length < 6) return `function 0x01 PARAM_RW (short, ${arr.length}B) ${hex}`;
      const pidLow = decode14(payload[0]!, payload[1]!);
      const pidHigh = decode14(payload[2]!, payload[3]!);
      const action = decode14(payload[4]!, payload[5]!);
      const addr = `pidLow=0x${pidLow.toString(16).padStart(4, '0').toUpperCase()} pidHigh=0x${pidHigh.toString(16).padStart(4, '0').toUpperCase()} action=0x${action.toString(16).padStart(4, '0').toUpperCase()}`;
      // Save-to-location ack: action=0x001B.
      if (action === 0x001b) return `Save ACK (${addr})`;
      // Rename ack: action=0x000C.
      if (action === 0x000c) return `Rename ACK (${addr})`;
      // 18-byte command-ack shape (write-echo for save/rename family — zero
      // payload, action ≠ WRITE).
      if (arr.length === 18) return `Command ACK (${addr})`;
      // 64-byte SET_PARAM write echo (hdr4=0x0028, 40-byte payload).
      if (arr.length === 64 && action === 0x0001) return `SET_PARAM write echo (${addr})`;
      // Fall-through for shapes we haven't catalogued yet — include
      // addressing fields so future captures are identifiable in logs.
      return `function 0x01 PARAM_RW (${addr}, ${arr.length}B)`;
    }
    case 0x08: {
      // GET_FIRMWARE_VERSION response — payload starts MAJ MIN R1 R2 R3 R4 R5
      // followed by a null-terminated build-date ASCII string. Just label
      // the major.minor when we can decode them.
      if (payload.length >= 2) {
        return `Firmware version response (v${payload[0]}.${payload[1]})`;
      }
      return `function 0x08 GET_FIRMWARE_VERSION (short)`;
    }
    case 0x12:
      // Mode switch — outbound-only in normal use, but label it cleanly if
      // a capture ever sees it inbound (e.g. round-trip test, USB receipt
      // echo).
      return `Mode switch (function 0x12) ${hex}`;
    case 0x14: {
      // GET_PRESET_NUMBER response: F0 00 01 74 15 14 PP QQ [CS] F7.
      // 14-bit preset slot index, 0..103.
      if (payload.length >= 2) {
        const slot = decode14(payload[0]!, payload[1]!);
        return `Preset number response (slot=${slot})`;
      }
      return `function 0x14 GET_PRESET_NUMBER (short)`;
    }
    case 0x64: {
      // MULTIPURPOSE_RESPONSE: payload = [FN, RC]. RC=0x00 OK,
      // RC=0x05 NACK (command parsed but not honored).
      if (payload.length >= 2) {
        const echoedFn = payload[0]!;
        const rc = payload[1]!;
        const rcLabel = rc === 0x00 ? 'OK' : rc === 0x05 ? 'NACK rc=0x05 (parsed, not honored)' : `rc=0x${rc.toString(16).padStart(2, '0').toUpperCase()}`;
        return `Multipurpose response for fn=0x${echoedFn.toString(16).padStart(2, '0').toUpperCase()}: ${rcLabel}`;
      }
      return `function 0x64 MULTIPURPOSE_RESPONSE (short)`;
    }
    default:
      return `function 0x${fn.toString(16).padStart(2, '0').toUpperCase()} (${arr.length}B) ${hex}`;
  }
}
