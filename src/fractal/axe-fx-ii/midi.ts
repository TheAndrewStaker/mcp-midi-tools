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

import { markClean, markDirty } from '@/server/shared/bufferDirty.js';

const AXE_FX_II_PORT_NEEDLES = ['axe-fx', 'axefx'];
const AXEFX_DIRTY_LABEL = 'axe-fx-ii';

// Fractal Axe-Fx II model byte (Q8.02 XL+). All envelopes targeted at /
// emitted by the device carry this in byte[4]; foreign envelopes don't
// affect our buffer-dirty state.
const AXE_FX_II_XL_PLUS_MODEL_ID = 0x07;

// ── Dirty-state classification — DEVICE-SOURCED (not heuristic) ───────
//
// Decoded from passive captures across 6 distinct device states
// (Session 68 analysis of session-58 + session-61 captures):
//
//   - direct-sync (read-only)   → 0 state broadcasts
//   - preset-change (switch)    → 0 state broadcasts
//   - save-attempt (store)      → 0 state broadcasts
//   - knob-turn (edit)          → 1 state broadcast triple
//   - block-add (edit)          → 1 state broadcast triple
//   - grid-move (edit)          → 1 state broadcast triple
//
// The device emits a 0x74/0x75/0x76 state-broadcast triple EXACTLY when
// the working buffer is edited — whether by AxeEdit, by our MCP server,
// or by the user touching a knob on the device front panel. It does
// NOT emit on reads, preset switches, or saves. Receiving a 0x74 frame
// is therefore an AUTHORITATIVE dirty signal from the device itself,
// not a heuristic on our part.
//
// The clean signal stays code-sourced because the device doesn't
// announce "I'm clean now" — but the OPERATIONS that produce a clean
// state are unambiguous: switch_preset (0x3C) loads a stored slot;
// store_preset (0x1D) commits the working buffer to a slot. We mark
// clean when WE issue those envelopes. A SAVE pressed on the device's
// own front panel won't be reflected (false-dirty on next check), but
// that's a fail-safe degradation — the agent will warn the user, who
// can confirm and discard.

const CLEAN_FUNCTIONS = new Set<number>([
  0x3c, // SWITCH_PRESET / LOAD_PRESET
  0x1d, // STORE_PRESET
]);

function isCleanOutbound(bytes: readonly number[]): boolean {
  if (bytes.length < 8) return false;
  if (bytes[0] !== 0xf0) return false;
  if (bytes[1] !== 0x00 || bytes[2] !== 0x01 || bytes[3] !== 0x74) return false;
  if (bytes[4] !== AXE_FX_II_XL_PLUS_MODEL_ID) return false;
  return CLEAN_FUNCTIONS.has(bytes[5]);
}

function isStateBroadcastInbound(bytes: readonly number[]): boolean {
  if (bytes.length < 6) return false;
  if (bytes[0] !== 0xf0) return false;
  if (bytes[1] !== 0x00 || bytes[2] !== 0x01 || bytes[3] !== 0x74) return false;
  if (bytes[4] !== AXE_FX_II_XL_PLUS_MODEL_ID) return false;
  // The header byte 0x74 is sufficient — chunks (0x75) and footers
  // (0x76) always follow a header, so we don't need to count all three.
  return bytes[5] === 0x74;
}

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
      // Device-sourced dirty signal: every state-broadcast triple from
      // the device means the working buffer was edited. No heuristic /
      // no timing window — the captures prove the device only emits
      // these on edits (not on reads/switches/saves).
      if (isStateBroadcastInbound(bytes)) {
        markDirty(AXEFX_DIRTY_LABEL);
      }
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
    send: (bytes) => {
      // The DIRTY signal comes from the device (inbound state-broadcast
      // triples); we don't infer it from our outbound writes. We DO mark
      // clean when we issue switch_preset / store_preset because those
      // operations transition the buffer to a known-clean state (device
      // doesn't announce that transition, so we record it here).
      if (isCleanOutbound(bytes)) markClean(AXEFX_DIRTY_LABEL);
      out.sendMessage(bytes);
    },
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
