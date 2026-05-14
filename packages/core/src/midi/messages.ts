/**
 * Pure message builders for general MIDI traffic. Imported by the
 * generic send_* MCP tools (BK-030 Session B). Lives under
 * `src/protocol/generic/` because none of these are AM4-specific —
 * when BK-012 splits the protocol layer into packages, this file
 * becomes the seed of `midi-core`.
 *
 * Channel convention: every function in this module takes a
 * **0-indexed** channel (0..15). The MCP tool layer presents channels
 * 1-indexed (1..16) to match musician convention; the conversion lives
 * there, not here.
 */

const MAX_7BIT = 127;
const MAX_14BIT = 16383;

function require7bit(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_7BIT) {
    throw new Error(`${name} must be an integer 0..127, got ${value}`);
  }
}

function require14bit(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_14BIT) {
    throw new Error(`${name} must be an integer 0..16383, got ${value}`);
  }
}

function requireChannel(channel: number): void {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new Error(`channel must be an integer 0..15 (internal 0-indexed), got ${channel}`);
  }
}

/**
 * Control Change: status `0xB0 | channel`, controller, value.
 */
export function buildControlChange(
  channel: number,
  controller: number,
  value: number,
): number[] {
  requireChannel(channel);
  require7bit('controller', controller);
  require7bit('value', value);
  return [0xB0 | channel, controller, value];
}

/**
 * Note On: status `0x90 | channel`, note, velocity.
 * Velocity 0 is interpreted as Note Off by most devices, but callers
 * who want an explicit Note Off should use `buildNoteOff` instead.
 */
export function buildNoteOn(
  channel: number,
  note: number,
  velocity: number,
): number[] {
  requireChannel(channel);
  require7bit('note', note);
  require7bit('velocity', velocity);
  return [0x90 | channel, note, velocity];
}

/**
 * Note Off: status `0x80 | channel`, note, release-velocity.
 * Most MIDI devices ignore release velocity; pass 0 if you don't care.
 */
export function buildNoteOff(
  channel: number,
  note: number,
  releaseVelocity: number,
): number[] {
  requireChannel(channel);
  require7bit('note', note);
  require7bit('releaseVelocity', releaseVelocity);
  return [0x80 | channel, note, releaseVelocity];
}

/**
 * Program Change: status `0xC0 | channel`, program.
 */
export function buildProgramChange(channel: number, program: number): number[] {
  requireChannel(channel);
  require7bit('program', program);
  return [0xC0 | channel, program];
}

/**
 * Bank Select MSB (CC 0).
 */
export function buildBankSelectMSB(channel: number, bank: number): number[] {
  return buildControlChange(channel, 0, bank);
}

/**
 * Bank Select LSB (CC 32).
 */
export function buildBankSelectLSB(channel: number, bank: number): number[] {
  return buildControlChange(channel, 32, bank);
}

/**
 * NRPN write: emits the standard 3- or 4-message sequence.
 *
 *   CC 99 (0x63) — NRPN parameter MSB
 *   CC 98 (0x62) — NRPN parameter LSB
 *   CC  6 (0x06) — Data Entry MSB
 *   CC 38 (0x26) — Data Entry LSB     (only when high-res)
 *
 * `value` is 7-bit (0..127) when `highRes` is false, 14-bit
 * (0..16383) when true. Returns a flat byte array containing all
 * three or four messages back-to-back; the caller can stream them
 * to the device in a single `send` call or split them up.
 *
 * Doesn't emit the optional NRPN-Null reset (CC 99=127, CC 98=127)
 * — devices that need it tend to send their own from the panel side,
 * and emitting it makes back-to-back NRPN writes slower.
 */
export function buildNRPN(
  channel: number,
  parameterMSB: number,
  parameterLSB: number,
  value: number,
  highRes = false,
): number[] {
  requireChannel(channel);
  require7bit('parameterMSB', parameterMSB);
  require7bit('parameterLSB', parameterLSB);
  if (highRes) {
    require14bit('value', value);
  } else {
    require7bit('value', value);
  }
  const out: number[] = [];
  out.push(...buildControlChange(channel, 99, parameterMSB));
  out.push(...buildControlChange(channel, 98, parameterLSB));
  if (highRes) {
    const dataMSB = (value >> 7) & 0x7F;
    const dataLSB = value & 0x7F;
    out.push(...buildControlChange(channel, 6, dataMSB));
    out.push(...buildControlChange(channel, 38, dataLSB));
  } else {
    out.push(...buildControlChange(channel, 6, value));
  }
  return out;
}

/**
 * Pitch Bend: status `0xE0 | channel`, LSB, MSB. 14-bit signed value.
 * `signedValue` is the musician convention -8192..+8191 (0 = no bend,
 * +8191 = max bend up, -8192 = max bend down). Mapped to wire 0..16383
 * with center at 8192. Bend range (how many semitones max bend covers)
 * is set per-synth and not part of this message.
 */
export function buildPitchBend(channel: number, signedValue: number): number[] {
  requireChannel(channel);
  if (!Number.isInteger(signedValue) || signedValue < -8192 || signedValue > 8191) {
    throw new Error(`pitch-bend value must be an integer -8192..+8191, got ${signedValue}`);
  }
  const wireValue = signedValue + 8192;
  return [0xE0 | channel, wireValue & 0x7F, (wireValue >> 7) & 0x7F];
}

/**
 * Channel Pressure (channel aftertouch): status `0xD0 | channel`,
 * pressure (0..127). Single value affecting every currently-held note
 * on the channel — for per-key aftertouch use Poly Pressure (0xA0)
 * which isn't built here yet.
 */
export function buildChannelPressure(channel: number, pressure: number): number[] {
  requireChannel(channel);
  require7bit('pressure', pressure);
  return [0xD0 | channel, pressure];
}

/**
 * Song Position Pointer: status `0xF2`, LSB, MSB. 14-bit beat position
 * where one beat = 6 MIDI Timing Clock pulses (24 PPQN / 4). System
 * common — no channel. Devices use it to jump to a specific bar/beat
 * in a sequenced song before responding to Start/Continue.
 */
export function buildSongPosition(beats: number): number[] {
  require14bit('beats', beats);
  return [0xF2, beats & 0x7F, (beats >> 7) & 0x7F];
}

/** Timing Clock Start (0xFA). System real-time, single byte, no channel. */
export function buildTimingClockStart(): number[] {
  return [0xFA];
}

/** Timing Clock Stop (0xFC). System real-time, single byte, no channel. */
export function buildTimingClockStop(): number[] {
  return [0xFC];
}

/** Timing Clock Continue (0xFB). System real-time, single byte, no channel. */
export function buildTimingClockContinue(): number[] {
  return [0xFB];
}

/**
 * Validate a raw SysEx frame. Caller-supplied bytes must already
 * include the F0/F7 framing — we don't add or strip it. Every other
 * byte must be a 7-bit value (0..127), per the MIDI spec.
 *
 * Returns the bytes unchanged on success; throws with a descriptive
 * message on framing or content errors.
 */
export function validateSysEx(bytes: readonly number[]): number[] {
  if (bytes.length < 2) {
    throw new Error(`SysEx frame too short (${bytes.length} bytes); minimum is F0 F7.`);
  }
  if (bytes[0] !== 0xF0) {
    throw new Error(`SysEx frame must start with F0, got 0x${bytes[0].toString(16).padStart(2, '0').toUpperCase()}.`);
  }
  if (bytes[bytes.length - 1] !== 0xF7) {
    throw new Error(`SysEx frame must end with F7, got 0x${bytes[bytes.length - 1].toString(16).padStart(2, '0').toUpperCase()}.`);
  }
  for (let i = 1; i < bytes.length - 1; i++) {
    const b = bytes[i];
    if (!Number.isInteger(b) || b < 0 || b > MAX_7BIT) {
      throw new Error(
        `SysEx body byte at index ${i} is invalid: 0x${(b >>> 0).toString(16)} (must be 0..127, no F0/F7 in body).`,
      );
    }
  }
  return [...bytes];
}
