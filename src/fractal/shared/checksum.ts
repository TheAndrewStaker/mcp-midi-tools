/**
 * Fractal SysEx XOR checksum.
 * Confirmed across all observed AM4 messages — see docs/SYSEX-MAP.md.
 *
 *   cs = (XOR of every byte from F0 through the last data byte) & 0x7F
 *
 * The result is appended just before the F7 terminator.
 */
export function fractalChecksum(bytes: readonly number[]): number {
  let acc = 0;
  for (const b of bytes) acc ^= b;
  return acc & 0x7f;
}
