/**
 * Axe-Fx III-specific MIDI helpers. Wraps the generic transport in
 * @mcp-midi-control/core/midi/transport with III-specific port-name
 * needles + onboarding hints.
 *
 * Status: 🟡 wiki-documented, awaiting community capture verification
 * (BK-015 community beta workflow). The wire envelope shape is shared
 * with AM4 + Axe-Fx II XL+ (same modern Fractal SysEx family,
 * `F0 00 01 74 [model] ... [checksum] F7`), so transport + connection
 * are low-risk. Block roster + param-ID space ARE device-specific and
 * are decoded from the cached Fractal wiki — 🟡 confidence tag per
 * blockTypes.ts / params.ts.
 */

import {
  connect,
  type MidiConnection,
} from '@mcp-midi-control/core/midi/transport.js';

export {
  connect,
  toHex,
  type ConnectOptions,
  type MidiConnection,
} from '@mcp-midi-control/core/midi/transport.js';

/**
 * Substrings used to find Axe-Fx III ports. The OS-side names vary by
 * USB driver / firmware version — these are the substrings we've seen
 * across Fractal's documentation:
 *
 *   - "Axe-Fx III"      — direct, most common after FW 9.x
 *   - "AXE-FX III"      — all-caps variant on some Windows drivers
 *   - "axefx3"          — some third-party / legacy class-compliant
 *                          names
 *
 * The match is case-insensitive (transport.ts lowercases both sides),
 * so any of these will match either case at the OS level. We
 * deliberately do NOT match the bare "Fractal" needle here — AM4 owns
 * that as a catch-all, so registration order in server-all/server/
 * index.ts puts Axe-Fx III BEFORE AM4 (per the registration-order
 * tiebreaking decision in DECISIONS.md row 40).
 */
export const AXE_FX_III_PORT_NEEDLES = ['axe-fx iii', 'axefx3', 'axe-fx 3'] as const;

/**
 * Open a connection to the Axe-Fx III. Thin wrapper around connect()
 * that supplies the III-specific name needles and the install/driver
 * hints users hit during III onboarding.
 *
 * Axe-Fx III uses a class-compliant USB-MIDI interface on Windows 10+
 * and macOS — no separate driver download required. The "MIDI" port
 * names appear as soon as the unit is plugged in and powered on.
 */
export function connectAxeFxIII(): MidiConnection {
  return connect({
    needles: AXE_FX_III_PORT_NEEDLES,
    notFoundLeadIn: 'Axe-Fx III not found in the MIDI device list. Common causes:',
    notFoundHints: [
      '  - Axe-Fx III is powered off or not connected by USB',
      '  - USB cable is data-only or not seated fully',
      '  - On Windows: AxeEdit III claimed the MIDI port exclusively — quit AxeEdit III then retry',
      '',
      'Once visible, call `list_midi_ports` to confirm the server sees it, then retry. Use `reconnect_midi` to force a fresh handle.',
    ],
  });
}

// Register the Axe-Fx III connector with the shared connection registry
// as a module-load side effect. Importing anything from this module
// (or any module that transitively imports it) makes
// `ensureConnection(AXEFX3_LABEL)` route through `connectAxeFxIII()`.
import { registerConnector, AXEFX3_LABEL } from '@mcp-midi-control/core/server-shared/connections.js';
registerConnector(AXEFX3_LABEL, connectAxeFxIII);
export { AXEFX3_LABEL };

// ── Startup banner helper ────────────────────────────────────────────

import midi from 'midi';

interface AxeFxIIIPortInfo {
  index: number;
  name: string;
  looksLikeAxeFxIII: boolean;
}

/**
 * Enumerate output ports without opening any. Used by the startup
 * banner so the server can log a verdict ("Axe-Fx III detected" /
 * "Axe-Fx III not visible") at boot — mirrors the AM4 + Axe-Fx II
 * + Hydrasynth startup-banner pattern for consistency.
 */
export function listAxeFxIIIOutputs(): AxeFxIIIPortInfo[] {
  const out = new midi.Output();
  try {
    const result: AxeFxIIIPortInfo[] = [];
    for (let i = 0; i < out.getPortCount(); i++) {
      const name = out.getPortName(i);
      const lower = name.toLowerCase();
      result.push({
        index: i,
        name,
        looksLikeAxeFxIII: AXE_FX_III_PORT_NEEDLES.some((n) => lower.includes(n)),
      });
    }
    return result;
  } finally {
    out.closePort();
  }
}

/**
 * Startup-banner helper — describes whether an Axe-Fx III output port
 * is visible right now, without opening it. Returns a single-line
 * string for the server's startup stderr log.
 */
export function describeAxeFxIIIPortStatus(): string {
  try {
    const outputs = listAxeFxIIIOutputs();
    const iii = outputs.find((p) => p.looksLikeAxeFxIII);
    if (iii) return `Axe-Fx III detected at output [${iii.index}]: "${iii.name}" (🟡 community beta — see HARDWARE-TASKS-AXEFX3.md)`;
    if (outputs.length === 0) return 'no MIDI outputs visible';
    return `Axe-Fx III not visible among ${outputs.length} output(s)`;
  } catch (err) {
    return `port scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
