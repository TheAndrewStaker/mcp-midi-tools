/**
 * Factory-preset fingerprints — derived at runtime from the user's local
 * copy of `samples/factory/AM4-Factory-Presets-1p01.syx`.
 *
 * A fingerprint is a SHA-256 hash over the four chunk payloads of one
 * preset dump (4 × 3074 = 12,296 bytes), encoded as a hex string. The
 * 0x77 header is excluded because it encodes the target location, which
 * differs between an export of the active preset (uses the 0x7F sentinel)
 * and a stored-export (uses the real bank/sub-index). The 0x79 footer is
 * excluded because it's a header-or-content-derived value (SYSEX-MAP.md
 * §10b — believed to be a content checksum, but its exact derivation is
 * not yet pinned down). Hashing only the chunks gives us a fingerprint
 * that's stable across export contexts.
 *
 * Fingerprints are NOT committed. Two reasons:
 *   1. Avoid distributing derived metadata of Fractal-IP content. The
 *      hashes are one-way, but the cleaner story is "you provide the
 *      bank file; we derive fingerprints locally."
 *   2. Firmware-version drift — if Fractal ships a new factory bank in
 *      a future firmware update, the user drops in the new bank file
 *      and the gate re-classifies correctly without a code change.
 *
 * Performance: hashing 104 × ~12 KB chunks takes a few ms. Done once at
 * server start; cached for the lifetime of the process.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { formatLocationCode } from 'fractal-midi/am4';
import {
  type ParsedPresetDump,
  parsePresetBank,
} from '../presetDump.js';

/**
 * Hash one parsed preset dump's content. Stable across header-payload
 * variations — i.e., two dumps of the same preset that only differ in
 * the location-encoding bytes will produce the same fingerprint.
 */
export function fingerprintPresetDump(parsed: ParsedPresetDump): string {
  const hash = createHash('sha256');
  for (const chunk of parsed.chunkPayloads) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Read the factory bank file and return a map from location code
 * "A01".."Z04" → SHA-256 fingerprint hex.
 *
 * Returns null if the bank file is absent. Callers should treat that as
 * "factory-state classification unavailable" and degrade to "treat all
 * locations as user-modified" — strictly safer than guessing.
 */
export function loadFactoryFingerprints(
  bankPath: string,
): Map<string, string> | null {
  if (!existsSync(bankPath)) return null;
  const bytes = new Uint8Array(readFileSync(bankPath));
  const presets = parsePresetBank(bytes);
  const out = new Map<string, string>();
  for (let i = 0; i < presets.length; i++) {
    out.set(formatLocationCode(i), fingerprintPresetDump(presets[i]));
  }
  return out;
}
