/**
 * Axe-Fx II MIDI connection helper.
 *
 * Mirrors the pattern in `src/asm/hydrasynth-explorer/midi.ts` —
 * device-scoped port discovery + lazy-opened bidirectional handle.
 * Looks for "axe-fx" / "axefx" in port names (case-insensitive).
 *
 * Why a separate helper from the AM4 one: both devices are made by
 * Fractal Audio, so the AM4 helper's `fractal` needle would also match
 * Axe-Fx II ports — leaving the user's two-Fractal-device-plugged-in
 * setup ambiguous. Splitting the needles keeps the device routing
 * unambiguous when both are present.
 *
 * Status: 🟢 hardware-verified on Axe-Fx II XL+ Quantum 8.02
 * (2026-05-10). Bidirectional MIDI handle proven by HW-080 (preset
 * name read, function 0x0F) + HW-076 (grid layout read, function
 * 0x20) + HW-077 (param read, function 0x02 GET) + HW-075 (param
 * write + bypass, function 0x02 SET). Port discovery via the
 * `axe-fx` / `axefx` needles routes correctly on the founder's
 * two-Fractal-device setup.
 */
import midi, { Input, Output } from 'midi';

const AXE_FX_II_PORT_NEEDLES = ['axe-fx', 'axefx'];

export interface AxeFxIIConnection {
  send: (bytes: number[]) => void;
  /**
   * Subscribe to inbound MIDI from the Axe-Fx II. Returns an
   * unsubscribe function. When `hasInput` is false (no input port
   * found), the handler is registered but will never fire.
   *
   * Active-sensing (0xFE) and MIDI timing clock (0xF8) are filtered
   * by `ignoreTypes(false, true, true)` so the handler only sees
   * meaningful messages (SysEx, CC, PC, notes).
   */
  onMessage: (handler: (bytes: number[]) => void) => () => void;
  /**
   * Wait for the first inbound SysEx that satisfies `predicate`. Non-
   * matching messages are silently dropped until `timeoutMs` elapses.
   * Throws on timeout. Caller MUST register before sending the request
   * so the device's response can't race ahead of the listener.
   *
   * Throws synchronously if `hasInput` is false — GET tools that need
   * a response are unusable without an input port.
   */
  receiveSysExMatching: (
    predicate: (bytes: number[]) => boolean,
    timeoutMs?: number,
  ) => Promise<number[]>;
  /** True when an input port was successfully opened. */
  hasInput: boolean;
  close: () => void;
}

export interface AxeFxIIPortInfo {
  index: number;
  name: string;
  looksLikeAxeFxII: boolean;
}

function findAxeFxIIOutputIndex(out: Output): number {
  for (let i = 0; i < out.getPortCount(); i++) {
    const name = out.getPortName(i).toLowerCase();
    if (AXE_FX_II_PORT_NEEDLES.some((n) => name.includes(n))) return i;
  }
  return -1;
}

function findAxeFxIIInputIndex(input: Input): number {
  for (let i = 0; i < input.getPortCount(); i++) {
    const name = input.getPortName(i).toLowerCase();
    if (AXE_FX_II_PORT_NEEDLES.some((n) => name.includes(n))) return i;
  }
  return -1;
}

/**
 * Enumerate output ports without opening any. Used by the startup
 * banner so the server can log a verdict ("Axe-Fx II detected" /
 * "Axe-Fx II not visible") at boot, before any tool call.
 */
export function listAxeFxIIOutputs(): AxeFxIIPortInfo[] {
  const out = new midi.Output();
  try {
    const result: AxeFxIIPortInfo[] = [];
    for (let i = 0; i < out.getPortCount(); i++) {
      const name = out.getPortName(i);
      const lower = name.toLowerCase();
      result.push({
        index: i,
        name,
        looksLikeAxeFxII: AXE_FX_II_PORT_NEEDLES.some((n) => lower.includes(n)),
      });
    }
    return result;
  } finally {
    try { out.closePort(); } catch { /* not opened */ }
  }
}

/**
 * Open the Axe-Fx II output, plus the input if the OS exposes one.
 * Throws on no output port; falls back to output-only on no input
 * port (writes still work, GET responses lose visibility).
 *
 * Caller surfaces the throw to the user as an MCP error response.
 */
export function connectAxeFxII(): AxeFxIIConnection {
  const out = new midi.Output();
  const outIdx = findAxeFxIIOutputIndex(out);
  if (outIdx < 0) {
    const visible: string[] = [];
    for (let i = 0; i < out.getPortCount(); i++) {
      visible.push(`[${i}] ${out.getPortName(i)}`);
    }
    try { out.closePort(); } catch { /* not opened */ }
    throw new Error(
      `Axe-Fx II not found. Looked for any output port whose name contains: ` +
      `${AXE_FX_II_PORT_NEEDLES.join(' / ')}. Visible outputs: ${visible.length === 0 ? '(none)' : visible.join(', ')}. ` +
      `Likely causes: device not powered on, USB cable not seated, or the Fractal USB driver isn't installed.`,
    );
  }
  out.openPort(outIdx);

  const input = new midi.Input();
  const inIdx = findAxeFxIIInputIndex(input);
  let inputOpen = false;
  const handlers = new Set<(bytes: number[]) => void>();

  if (inIdx >= 0) {
    // Don't ignore SysEx (false), do ignore timing clock + active-sensing (true, true).
    // Wire the listener BEFORE openPort so we don't race the device.
    input.ignoreTypes(false, true, true);
    input.on('message', (_dt: number, bytes: number[]) => {
      for (const h of handlers) {
        try { h(bytes); } catch { /* swallow handler errors so one bad subscriber can't break others */ }
      }
    });
    input.openPort(inIdx);
    inputOpen = true;
  } else {
    try { input.closePort(); } catch { /* never opened */ }
  }

  return {
    send: (bytes) => out.sendMessage(bytes),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    receiveSysExMatching: (predicate, timeoutMs = 1000) => {
      if (!inputOpen) {
        return Promise.reject(new Error(
          'No Axe-Fx II input port available. GET tools (axefx2_get_param, ' +
          'axefx2_get_grid_layout, axefx2_get_preset_name) require a bidirectional ' +
          'MIDI connection. Confirm the OS exposes both Axe-Fx II input and output ' +
          'ports via list_midi_ports — some USB-MIDI driver configurations expose ' +
          'output only.',
        ));
      }
      return new Promise<number[]>((resolve, reject) => {
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
      });
    },
    hasInput: inputOpen,
    close: () => {
      handlers.clear();
      try { out.closePort(); } catch { /* already closed */ }
      if (inputOpen) {
        try { input.closePort(); } catch { /* already closed */ }
      }
    },
  };
}
