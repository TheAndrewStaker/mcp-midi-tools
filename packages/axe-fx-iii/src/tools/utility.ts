/**
 * Axe-Fx III utility tools — tempo, tuner, looper.
 *
 * Tools registered:
 *   - axefx3_tempo_tap                (function 0x10)
 *   - axefx3_set_tempo / get_tempo    (function 0x14)
 *   - axefx3_set_tuner                (function 0x11)
 *   - axefx3_set_looper / get_looper  (function 0x0F)
 *
 * All wire envelopes are v1.4 spec verbatim.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  buildTempoTap,
  buildSetTempo,
  buildGetTempo,
  buildSetTuner,
  buildSetLooper,
  buildGetLooperState,
  isSetGetTempoResponse,
  isSetGetLooperResponse,
  parseTempoResponse,
  parseLooperStateResponse,
  type LooperAction,
} from 'fractal-midi/axe-fx-iii';

import {
  BETA_NOTE,
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  formatMultipurposeError,
  sendAndWatchForError,
  toHex,
} from './shared.js';

export function registerAxeFxIIIUtilityTools(server: McpServer): void {

  server.registerTool('axefx3_tempo_tap', {
    description: [
      'Send a tempo-tap to the Axe-Fx III — equivalent to one press',
      'of the front-panel TAP button. Each call counts as one tap;',
      'the III computes BPM from the inter-tap interval.',
      '',
      'Wire: TEMPO_TAP (function 0x10). No payload.',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const bytes = buildTempoTap();
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent TEMPO_TAP.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_set_tempo', {
    description: [
      'Set the master tempo (BPM) on the Axe-Fx III.',
      '',
      'Wire: SET_TEMPO (function 0x14). Payload is the BPM as a 14-bit',
      'LS-first septet pair. The III front-panel range is roughly',
      '30..250 BPM; the wire accepts the full 14-bit range and the',
      'device clamps.',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      bpm: z.number().int().min(1).max(16383).describe(
        'Tempo in BPM (typical range 30..250).',
      ),
    },
  }, async ({ bpm }) => {
    const bytes = buildSetTempo(bpm);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_TEMPO → ${bpm} BPM.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_tempo', {
    description: [
      'Read the current master tempo (BPM) from the Axe-Fx III.',
      '',
      'Wire: GET_TEMPO (function 0x14 with `dd dd = 7F 7F`).',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildGetTempo();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetTempoResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_tempo failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const { bpm } = parseTempoResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `Tempo: ${bpm} BPM.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_set_tuner', {
    description: [
      "Turn the Axe-Fx III's tuner display on or off.",
      '',
      'Wire: TUNER_ON_OFF (function 0x11). `dd = 0` off, `dd = 1` on.',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      on: z.boolean().describe('true → tuner display on, false → tuner off.'),
    },
  }, async ({ on }) => {
    const bytes = buildSetTuner(on);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent TUNER_ON_OFF → ${on ? 'ON' : 'OFF'}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  const LOOPER_ACTIONS = ['record', 'play', 'undo', 'once', 'reverse', 'half_speed'] as const;

  server.registerTool('axefx3_set_looper', {
    description: [
      "Trigger a Looper button-press on the Axe-Fx III. Equivalent to",
      "pressing the corresponding button on the III's Looper page.",
      '',
      'Wire: SET_LOOPER (function 0x0F). dd values per spec:',
      '  0 = Record, 1 = Play, 2 = Undo, 3 = Once,',
      '  4 = Reverse, 5 = Half-speed',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      action: z.enum(LOOPER_ACTIONS).describe(
        'Looper button: record, play, undo, once, reverse, half_speed.',
      ),
    },
  }, async ({ action }) => {
    const bytes = buildSetLooper(action as LooperAction);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_LOOPER → ${action}.\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx3_get_looper_state', {
    description: [
      "Read the Looper state on the Axe-Fx III. Returns each looper",
      'flag (recording, playing, overdubbing, once, reverse, half-speed).',
      '',
      'Wire: GET_LOOPER (function 0x0F with `dd = 0x7F`). Response is',
      'a single byte bitfield: bit0=Record, 1=Play, 2=Overdub, 3=Once,',
      '4=Reverse, 5=Half-speed.',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildGetLooperState();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetLooperResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_looper_state failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const s = parseLooperStateResponse(response);
    const active = [
      s.recording  && 'recording',
      s.playing    && 'playing',
      s.overdubbing && 'overdubbing',
      s.once       && 'once',
      s.reverse    && 'reverse',
      s.halfSpeed  && 'half-speed',
    ].filter(Boolean).join(', ') || '(idle)';
    return {
      content: [{
        type: 'text',
        text:
          `Looper state: ${active}.\n` +
          `Raw bitfield: 0x${s.raw.toString(16).padStart(2, '0')}\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });

}
