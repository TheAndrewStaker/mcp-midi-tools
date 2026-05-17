/**
 * Audition executors — `play_note` / `play_chord`.
 *
 * Routes for the unified `play_note` and `play_chord` MCP tools. Both
 * are vendor-agnostic: Note On / Note Off are standard MIDI 1.0 status
 * bytes (0x90 / 0x80) every device accepts as input. The dispatcher
 * provides a default implementation that just sends bytes via the
 * descriptor's MIDI connection; per-device overrides via
 * `descriptor.writer.playNote?` / `playChord?` exist for cases that need
 * special handling (synth-block routing on Axe-Fx III, MPE channel
 * multiplexing on future controllers, etc.).
 *
 * Audibility is per-device and not enforced at the dispatcher — a synth
 * (Hydrasynth) sounds the patch; an audio processor (AM4, Axe-Fx II)
 * generally ignores notes. The descriptor surfaces this expectation
 * via `agent_guidance.note_response` so the agent narrates correctly.
 */

import type { WriteResult } from '../types.js';

import { openCtx, requireDevice } from './core.js';

const NOTE_ON_STATUS = 0x90;
const NOTE_OFF_STATUS = 0x80;

function clampChannel(channel: number): number {
  if (!Number.isInteger(channel) || channel < 1 || channel > 16) {
    throw new Error(`MIDI channel out of range 1..16: ${channel}`);
  }
  return channel;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function noteOnBytes(channel: number, note: number, velocity: number): number[] {
  return [NOTE_ON_STATUS | ((channel - 1) & 0x0f), note & 0x7f, velocity & 0x7f];
}

function noteOffBytes(channel: number, note: number): number[] {
  return [NOTE_OFF_STATUS | ((channel - 1) & 0x0f), note & 0x7f, 0x00];
}

/**
 * Full lifecycle for `play_note`. Validates inputs, opens the device's
 * MIDI handle, and dispatches to either the descriptor's `playNote`
 * override or the default Note On / sleep / Note Off sequence.
 */
export async function executePlayNote(args: {
  port: string;
  note: number;
  velocity: number;
  duration_ms: number;
  channel: number;
}): Promise<WriteResult & { device: string }> {
  const descriptor = requireDevice(args.port);
  const channel = clampChannel(args.channel);
  const ctx = openCtx(descriptor);

  if (descriptor.writer.playNote !== undefined) {
    const result = await descriptor.writer.playNote(
      ctx,
      args.note,
      args.velocity,
      args.duration_ms,
      channel,
    );
    return { ...result, device: descriptor.display_name };
  }

  ctx.conn.send(noteOnBytes(channel, args.note, args.velocity));
  await sleep(args.duration_ms);
  ctx.conn.send(noteOffBytes(channel, args.note));
  return {
    op: 'play_note',
    target: `note=${args.note} ch=${channel}`,
    acked: true,
    device: descriptor.display_name,
  };
}

/**
 * Full lifecycle for `play_chord`. Validates inputs, opens the device's
 * MIDI handle, and dispatches to either the descriptor's `playChord`
 * override or the default per-note Note On (optionally strummed) /
 * sleep / per-note Note Off sequence.
 */
export async function executePlayChord(args: {
  port: string;
  notes: readonly number[];
  velocity: number;
  duration_ms: number;
  strum_ms: number;
  channel: number;
}): Promise<WriteResult & { device: string }> {
  if (args.notes.length === 0) {
    throw new Error('play_chord requires at least one note.');
  }
  const descriptor = requireDevice(args.port);
  const channel = clampChannel(args.channel);
  const ctx = openCtx(descriptor);

  if (descriptor.writer.playChord !== undefined) {
    const result = await descriptor.writer.playChord(
      ctx,
      args.notes,
      args.velocity,
      args.duration_ms,
      args.strum_ms,
      channel,
    );
    return { ...result, device: descriptor.display_name };
  }

  for (let i = 0; i < args.notes.length; i++) {
    ctx.conn.send(noteOnBytes(channel, args.notes[i]!, args.velocity));
    if (args.strum_ms > 0 && i < args.notes.length - 1) {
      await sleep(args.strum_ms);
    }
  }
  await sleep(args.duration_ms);
  for (const note of args.notes) {
    ctx.conn.send(noteOffBytes(channel, note));
  }
  return {
    op: 'play_chord',
    target: `notes=[${args.notes.join(',')}] ch=${channel}`,
    acked: true,
    device: descriptor.display_name,
  };
}
