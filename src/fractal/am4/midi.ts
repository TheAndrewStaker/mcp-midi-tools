/**
 * Generic MIDI port wrapper, used by the AM4 server today and the broader
 * "MCP MIDI Tools" surface (BK-030) tomorrow.
 *
 * Wraps node-midi to:
 *   - find a port by name-substring match
 *   - enable SysEx (off by default in node-midi)
 *   - return promises for clean async/await usage
 *
 * Caller must call `close()` to release ports.
 */
import midi, { Input, Output } from 'midi';

export interface MidiConnection {
  send: (bytes: number[]) => void;
  /**
   * Last error thrown by the underlying `output.sendMessage` call, or
   * `undefined` if the most recent send succeeded. node-midi's WinMM
   * backend prints `MidiOutWinMM::sendMessage: error sending sysex
   * message` to stderr and silently fails on a stale handle, which
   * leaves the tool reporting "success" while 0/22 chunks land. Tools
   * doing multi-message dumps (Hydrasynth patch, AM4 apply_preset)
   * read this after each send to bail loudly on the first failure
   * instead of looping through 22 broken writes. The Hydrasynth
   * yungatita test (2026-05-12) is the case that drove this.
   */
  lastSendError?: Error;
  /** Resolves with the next inbound SysEx message, or rejects on timeout. */
  receiveSysEx: (timeoutMs?: number) => Promise<number[]>;
  /**
   * Wait for the first inbound SysEx that satisfies `predicate`. Non-matching
   * messages are silently dropped until `timeoutMs` elapses. Register BEFORE
   * the outgoing write so the response can't race ahead of the listener.
   */
  receiveSysExMatching: (
    predicate: (bytes: number[]) => boolean,
    timeoutMs?: number,
  ) => Promise<number[]>;
  /**
   * Subscribe to ALL inbound messages (SysEx + non-SysEx). Returns an
   * unsubscribe function. When `hasInput` is false (no input port found),
   * the handler is registered but will never fire — diagnostic tools that
   * report "n messages observed" stay safe to call.
   */
  onMessage: (handler: (bytes: number[]) => void) => () => void;
  /**
   * True when an input port was successfully opened. Diagnostic surfaces
   * (the inbound-capture timeline in `apply_preset` / `set_param` / etc.)
   * read this flag so they can say "no input port — capture is empty by
   * construction" instead of silently reporting an empty timeline.
   */
  hasInput: boolean;
  close: () => void;
}

/**
 * Backwards-compat alias retained while the codebase migrates from the
 * single-device era. New code should use `MidiConnection`.
 */
export type AM4Connection = MidiConnection;

function findPortByName(
  port: Input | Output,
  needles: string[],
): number {
  for (let i = 0; i < port.getPortCount(); i++) {
    const name = port.getPortName(i).toLowerCase();
    if (needles.some((n) => name.includes(n.toLowerCase()))) return i;
  }
  return -1;
}

export interface MidiPortInfo {
  index: number;
  name: string;
  direction: 'input' | 'output';
  /** True when this port's name matched one of the supplied needles. */
  matched: boolean;
  /**
   * Back-compat alias for `matched` against the AM4 needles. Stays populated
   * when the default AM4 needles are used, so existing call sites that read
   * `looksLikeAM4` keep working until they're migrated.
   */
  looksLikeAM4: boolean;
}

const AM4_PORT_NEEDLES = ['am4', 'fractal'] as const;

function enumeratePorts(
  port: Input | Output,
  direction: 'input' | 'output',
  needles: readonly string[],
): MidiPortInfo[] {
  const out: MidiPortInfo[] = [];
  for (let i = 0; i < port.getPortCount(); i++) {
    const name = port.getPortName(i);
    const lower = name.toLowerCase();
    const matched = needles.some((n) => lower.includes(n.toLowerCase()));
    const looksLikeAM4 = AM4_PORT_NEEDLES.some((n) => lower.includes(n));
    out.push({ index: i, name, direction, matched, looksLikeAM4 });
  }
  return out;
}

/**
 * List every MIDI input and output the OS exposes, without opening any
 * connection. Used by the `list_midi_ports` MCP tool, the "AM4 not found"
 * diagnostic, and (post-BK-030) any device-discovery flow that wants to
 * tag ports against its own name pattern.
 *
 * `needles` (default: AM4) controls which ports get `matched: true`. The
 * `looksLikeAM4` field always tags against the AM4 needles regardless of
 * what `needles` is, so AM4-specific call sites stay readable.
 *
 * Opens and immediately releases short-lived node-midi handles so a
 * subsequent `connect()` still sees a clean state.
 */
export function listMidiPorts(
  needles: readonly string[] = AM4_PORT_NEEDLES,
): { inputs: MidiPortInfo[]; outputs: MidiPortInfo[] } {
  const input = new midi.Input();
  const output = new midi.Output();
  try {
    return {
      inputs: enumeratePorts(input, 'input', needles),
      outputs: enumeratePorts(output, 'output', needles),
    };
  } finally {
    input.closePort();
    output.closePort();
  }
}

/**
 * Build the "no port found" error message. Lists what the OS does see so
 * the user can diagnose a typo / wrong-device situation. AM4-specific
 * install hints are appended only when the caller passes them via
 * `notFoundHints` — generic devices don't need the Fractal driver link.
 */
function buildNotFoundError(
  needles: readonly string[],
  ins: string[],
  outs: string[],
  leadIn: string | undefined,
  extraHints: string[],
): Error {
  const noPorts = ins.length === 0 && outs.length === 0;
  const needleDesc = needles.map((n) => `"${n}"`).join(' or ');
  const lines: string[] = [
    leadIn ?? `No MIDI port matching ${needleDesc} found.`,
    ...extraHints,
  ];
  if (noPorts) {
    lines.push('No MIDI ports of any kind are visible — this usually means a MIDI driver is missing.');
  } else {
    lines.push(`MIDI ports the server can see (none matched ${needleDesc}):`);
    lines.push('Inputs:');
    lines.push(...(ins.length ? ins : ['  (none)']));
    lines.push('Outputs:');
    lines.push(...(outs.length ? outs : ['  (none)']));
  }
  return new Error(lines.join('\n'));
}

export interface ConnectOptions {
  /**
   * Case-insensitive substrings; the first port whose name contains any
   * needle wins. Bidirectional — applied to both inputs and outputs.
   */
  needles: readonly string[];
  /**
   * Optional first line of the "not found" error. Defaults to a generic
   * `No MIDI port matching ...` message; AM4 callers override it with
   * `AM4 not found in the MIDI device list.` so the user sees the same
   * familiar phrasing they always have.
   */
  notFoundLeadIn?: string;
  /**
   * Optional install / driver hints appended to the "not found" error.
   * AM4 callers pass driver download + AM4-Edit exclusivity warnings;
   * generic callers usually leave this empty.
   */
  notFoundHints?: string[];
}

/**
 * Open a MIDI input + output pair matching the given needles. Throws
 * with a diagnostic message listing visible ports if no match is found.
 */
export function connect(opts: ConnectOptions): MidiConnection {
  const input = new midi.Input();
  const output = new midi.Output();

  const inputPort = findPortByName(input, [...opts.needles]);
  const outputPort = findPortByName(output, [...opts.needles]);

  if (inputPort === -1 || outputPort === -1) {
    const ins: string[] = [];
    for (let i = 0; i < input.getPortCount(); i++) ins.push(`  [${i}] ${input.getPortName(i)}`);
    const outs: string[] = [];
    for (let i = 0; i < output.getPortCount(); i++) outs.push(`  [${i}] ${output.getPortName(i)}`);
    throw buildNotFoundError(opts.needles, ins, outs, opts.notFoundLeadIn, opts.notFoundHints ?? []);
  }

  // Enable SysEx (false = don't ignore SysEx); ignore timing + active-sensing.
  input.ignoreTypes(false, true, true);

  const handlers = new Set<(bytes: number[]) => void>();
  input.on('message', (_dt: number, bytes: number[]) => {
    for (const h of handlers) h(bytes);
  });

  input.openPort(inputPort);
  output.openPort(outputPort);

  // Track send errors on a separate cell so the `send` arrow can read /
  // write without TS forward-reference issues; the conn object exposes
  // the cell via a getter so callers see live state.
  const sendErrCell: { value?: Error } = {};
  const send = (bytes: number[]): void => {
    try {
      output.sendMessage(bytes);
      sendErrCell.value = undefined;
    } catch (err) {
      sendErrCell.value = err instanceof Error ? err : new Error(String(err));
      throw sendErrCell.value;
    }
  };
  const conn: MidiConnection = {
    send,
    get lastSendError(): Error | undefined { return sendErrCell.value; },
    receiveSysEx: (timeoutMs = 1000) =>
      new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          handlers.delete(handler);
          reject(new Error(`Timeout waiting for SysEx response after ${timeoutMs}ms`));
        }, timeoutMs);
        const handler = (bytes: number[]) => {
          if (bytes[0] !== 0xf0) return;
          clearTimeout(timer);
          handlers.delete(handler);
          resolve(bytes);
        };
        handlers.add(handler);
      }),
    receiveSysExMatching: (predicate, timeoutMs = 1000) =>
      new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          handlers.delete(handler);
          reject(new Error(`Timeout waiting for matching SysEx after ${timeoutMs}ms`));
        }, timeoutMs);
        const handler = (bytes: number[]) => {
          if (bytes[0] !== 0xf0) return;
          if (!predicate(bytes)) return;
          clearTimeout(timer);
          handlers.delete(handler);
          resolve(bytes);
        };
        handlers.add(handler);
      }),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    // Today `connect()` always opens both Input and Output (and throws on
    // either failure), so `hasInput` is always true here. The flag exists
    // on the interface so diagnostic tools can branch without caring
    // whether they're talking to AM4 (always bidirectional) or a future
    // output-only device (some USB-MIDI driver configurations).
    hasInput: true,
    close: () => {
      handlers.clear();
      input.closePort();
      output.closePort();
    },
  };
  return conn;
}

/**
 * Open a connection to the AM4. Thin wrapper around `connect()` that
 * supplies the AM4-specific name needles and the install/driver hints
 * users hit during AM4 onboarding.
 */
export function connectAM4(): MidiConnection {
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

export function toHex(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return arr.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// -- AM4 inbound-message describer -----------------------------------------

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
