/**
 * Hydrasynth navigation + play tools.
 *
 * 2 tools (v0.3):
 *   - hydra_play_note     — audition the active patch
 *   - hydra_navigate_to   — diagnostic primitive (bank/PC, no SysEx) with
 *                           inbound MIDI capture
 *
 * hydra_switch_patch removed v0.3 — use unified
 *   switch_preset({ port:'hydrasynth', location })
 * The unified switchPreset routes through descriptor.writer.switchPreset
 * which sends the same Bank Select MSB / LSB / PC sequence.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  DEFAULT_CHANNEL,
  HYDRA_DEV_MODE_PREAMBLE,
  ccBytes,
  describeInboundMessage,
  ensureMidi,
  noteOffBytes,
  noteOnBytes,
  parseBank,
  parseNote,
  parseSlot,
  programChangeBytes,
  sleep,
} from './shared.js';

export function registerHydrasynthNavigationTools(server: McpServer): void {

// hydra_switch_patch removed v0.3 — use unified
// switch_preset({ port:'hydrasynth', location: 'A001' }).

// hydra_play_note --------------------------------------------------------
// TODO: hoist into protocol/generic/tools.ts as play_note(port, note,
// velocity, duration_ms) during v0.3 cleanup. The implementation here
// IS the primitive (no wrapped tool below it) and is identical across
// MIDI devices — note-on/off bytes don't vary by vendor. AM4 and
// Axe-Fx II don't expose play-note tools today; unification only
// becomes valuable when one of them does. Leaving device-namespaced
// keeps churn off this PR.

server.registerTool('hydra_play_note', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to audition the current Hydrasynth patch by playing a note for a',
    'specified duration. Useful after editing parameters to hear the result without',
    'asking the user to play a key. Sends Note On, waits, sends Note Off.',
    '',
    'Notes can be specified as MIDI numbers (0..127, where 60 = middle C) or as',
    'scientific pitch names ("C4", "F#3", "Bb5"). C4 = 60 in the Yamaha convention',
    'used by the Hydrasynth manual.',
  ].join('\n'),
  inputSchema: {
    note: z.union([z.string(), z.number()]).describe('Note as MIDI number (0..127) or pitch name ("C4", "F#3", "Bb-1"). Middle C = C4 = 60.'),
    velocity: z.number().int().min(1).max(127).default(96).describe('Note velocity 1..127. Default 96 (mezzo-forte).'),
    duration_ms: z.number().int().min(50).max(5000).default(800).describe('How long to hold the note before releasing, in milliseconds. Capped at 5000 ms to prevent runaway.'),
  },
}, async ({ note, velocity, duration_ms }) => {
  const noteNum = parseNote(note);
  const conn = ensureMidi();
  conn.send(noteOnBytes(DEFAULT_CHANNEL, noteNum, velocity));
  await sleep(duration_ms);
  conn.send(noteOffBytes(DEFAULT_CHANNEL, noteNum));
  return {
    content: [{
      type: 'text',
      text: `Played note ${noteNum} at velocity ${velocity} for ${duration_ms} ms. Note Off sent.`,
    }],
  };
});

// hydra_navigate_to (diagnostic) ----------------------------------------

server.registerTool('hydra_navigate_to', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Diagnostic primitive.** Sends Bank Select (CC0=0, CC32=bank) +',
    'Program Change to navigate the device\'s active patch to the named',
    'slot. Captures any inbound MIDI for 200 ms after.',
    '',
    'Use BEFORE any test that bundles bank/PC navigation with SysEx, to',
    'verify in isolation that the device responds to PC at all. If the',
    'device\'s front-panel display does not change to the named slot when',
    'this runs, navigation is broken upstream and any tool that bundles',
    'PC + SysEx (like `hydra_apply_init`) is testing the wrong thing.',
    '',
    'Does NOT send SysEx. Does NOT modify any patch contents — just',
    'changes which patch the device is currently playing.',
  ].join('\n'),
  inputSchema: {
    slot: z.string().describe(
      'Target slot in "A001".."H128" form. Letter A..H + patch 1..128.',
    ),
  },
}, async ({ slot }) => {
  const conn = ensureMidi();
  const target = parseSlot(slot);
  const startMs = Date.now();

  const observed: Array<{ ms: number; bytes: number[] }> = [];
  const unsubscribe = conn.onMessage((bytes) => {
    observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
  });

  const sent: Array<{ ms: number; label: string }> = [];
  function record(label: string): void {
    sent.push({ ms: Date.now() - startMs, label });
  }

  try {
    conn.send(ccBytes(DEFAULT_CHANNEL, 0, 0));
    record('CC0 (Bank MSB) = 0');
    conn.send(ccBytes(DEFAULT_CHANNEL, 32, target.bank));
    record(`CC32 (Bank LSB) = ${target.bank} (${target.display[0]})`);
    conn.send(programChangeBytes(DEFAULT_CHANNEL, target.patch));
    record(`PC = ${target.patch} (displayed ${target.display})`);
    await sleep(200);
  } finally {
    unsubscribe();
  }

  const elapsedMs = Date.now() - startMs;
  const lines: string[] = [];
  lines.push(`Navigation request sent to slot ${target.display} (bank=${target.bank}, patch=${target.patch}, ${elapsedMs} ms total).`);
  lines.push('');
  lines.push('CHECK THE DEVICE\'S FRONT-PANEL DISPLAY:');
  lines.push(`  - If it now reads "${target.display}" → navigation works. Move on to the SysEx test.`);
  lines.push(`  - If it still reads the old slot → device is not responding to bank/PC from MCP.`);
  lines.push('    Likely causes: wrong MIDI channel (we\'re sending on ch 1), Param TX/RX gating,');
  lines.push('    or the device is in a mode that locks the patch.');
  lines.push('');
  lines.push(`Sent (timeline, channel ${DEFAULT_CHANNEL}):`);
  for (const s of sent) {
    lines.push(`  [+${s.ms.toString().padStart(4)}ms] ${s.label}`);
  }
  lines.push('');
  lines.push(`Inbound MIDI (hasInput=${conn.hasInput}, ${observed.length} message${observed.length === 1 ? '' : 's'}):`);
  if (!conn.hasInput) {
    lines.push('  (no input port open — can\'t observe device-side responses)');
  } else if (observed.length === 0) {
    lines.push('  (none — device sent nothing back. PC echoes are not standard, so absence does not prove anything.)');
  } else {
    for (const { ms, bytes } of observed) {
      lines.push(`  [+${ms.toString().padStart(4)}ms] ${describeInboundMessage(bytes)}`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n'),
    }],
  };
});

}
