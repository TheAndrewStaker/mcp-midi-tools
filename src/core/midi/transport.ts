/**
 * Generic MIDI transport — port enumeration + open/connect wrapper around
 * node-midi. Device-agnostic; used by every device package and the
 * generic-MIDI primitive tools (`send_cc`, `send_note`, …).
 *
 * Wraps node-midi to:
 *   - find a port by name-substring match
 *   - enable SysEx (off by default in node-midi)
 *   - return promises for clean async/await usage
 *
 * Caller must call `close()` to release ports.
 *
 * Device-specific connector wrappers (e.g. `connectAM4`,
 * `connectAxeFxII`) live in their device packages and delegate to
 * `connect()` here with device-specific needles + onboarding hints.
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
   * instead of looping through 22 broken writes.
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

function findPortByName(
  port: Input | Output,
  needles: readonly string[],
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
}

function enumeratePorts(
  port: Input | Output,
  direction: 'input' | 'output',
  needles: readonly string[],
): MidiPortInfo[] {
  const out: MidiPortInfo[] = [];
  for (let i = 0; i < port.getPortCount(); i++) {
    const name = port.getPortName(i);
    const lower = name.toLowerCase();
    const matched = needles.length > 0 && needles.some((n) => lower.includes(n.toLowerCase()));
    out.push({ index: i, name, direction, matched });
  }
  return out;
}

/**
 * List every MIDI input and output the OS exposes, without opening any
 * connection. Used by the `list_midi_ports` MCP tool, every device-
 * specific "device not found" diagnostic, and ad-hoc discovery tooling.
 *
 * `needles` controls which ports get `matched: true`. Default (empty
 * array) leaves every port's `matched` field false — caller filters by
 * its own substring rules.
 *
 * Opens and immediately releases short-lived node-midi handles so a
 * subsequent `connect()` still sees a clean state.
 */
export function listMidiPorts(
  needles: readonly string[] = [],
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
 * the user can diagnose a typo / wrong-device situation. Device-specific
 * install hints are appended only when the caller passes them via
 * `notFoundHints`.
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
   * `No MIDI port matching ...` message; device-specific callers override
   * it (e.g. AM4 uses `AM4 not found in the MIDI device list.`).
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

  const inputPort = findPortByName(input, opts.needles);
  const outputPort = findPortByName(output, opts.needles);

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
    hasInput: true,
    close: () => {
      handlers.clear();
      input.closePort();
      output.closePort();
    },
  };
  return conn;
}

export function toHex(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  return arr.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
