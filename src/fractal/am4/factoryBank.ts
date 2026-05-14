/**
 * AM4 factory-bank loader and per-slot replay helpers.
 *
 * Wraps the `samples/factory/AM4-Factory-Presets-1p01.syx` file (104 ×
 * 12,352 bytes; six SysEx messages per slot under the documented
 * 0x77 / 0x78 / 0x79 envelope, see SYSEX-MAP.md §10b) into:
 *
 *   - `loadFactoryBank()`         - lazy, cached parse of the bank file
 *   - `getFactoryRestoreMessages` - per-slot 6-message replay sequence
 *   - `sendFactoryRestore`        - fire-and-forget restore helper
 *
 * The replay model is verbatim: the bank file's per-slot stored-form
 * bytes go straight back to the device at the same location they were
 * captured from, no rewriting. Hardware-verified Session 51 (2026-05-08)
 * via `scripts/probe-factory-restore.ts --send --slot=G03`: G03 was
 * overwritten with the factory Deluxe Tweed preset cleanly, all 4
 * scenes intact.
 *
 * Cross-location restore (replay slot N's bytes to slot M) is NOT
 * supported here - the chunk payloads are believed to be masked by the
 * 0x77 header location bytes (BK-036), so a simple header-rewrite
 * would land scrambled content at the new location. Same-location
 * replay is mask-free by construction.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHUNK_LEN,
  CHUNKS_PER_PRESET,
  FOOTER_LEN,
  HEADER_LEN,
  PRESET_DUMP_LEN,
  parsePresetBank,
  type ParsedPresetDump,
} from '@/fractal/am4/presetDump.js';
import {
  TOTAL_LOCATIONS,
  formatLocationCode,
} from '@/fractal/am4/locations.js';
import type { MidiConnection } from '@/core/midi/transport.js';

/**
 * Inter-message pacing on factory restore. The Fractal Presets Update
 * Guide leaves Fractal-Bot in charge of pacing; 30 ms is well clear of
 * the AM4's 30-60 ms ack window (CLAUDE.md performance budget) and
 * matches what `scripts/probe-factory-restore.ts` validated on hardware
 * Session 51.
 */
export const RESTORE_INTER_MESSAGE_DELAY_MS = 30;

/** Number of SysEx messages emitted per slot during a restore. */
export const RESTORE_MESSAGES_PER_SLOT = 1 + CHUNKS_PER_PRESET + 1; // header + 4 chunks + footer

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the factory bank path. The file is gitignored (see
 * `samples/factory/README.md`); production installs ship it alongside
 * the bundled server. Tries, in order:
 *
 *   1. `AM4_FACTORY_BANK_PATH` env var (escape hatch for tests / weird
 *      install layouts).
 *   2. `<project-root>/samples/factory/AM4-Factory-Presets-1p01.syx`
 *      relative to this module's location. Walks up from the compiled
 *      `dist/...` location (depth ≈ 4) and from the source layout
 *      (`src/fractal/am4/`, depth = 4) - both land at project root.
 */
export function resolveBankPath(): string {
  const fromEnv = process.env.AM4_FACTORY_BANK_PATH;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  // Walk from this module up four levels to project root. Same depth in
  // src/ and dist/ trees: `src/fractal/am4/` and `dist/fractal/am4/`.
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return path.join(projectRoot, 'samples', 'factory', 'AM4-Factory-Presets-1p01.syx');
}

interface CachedBank {
  readonly bytes: Uint8Array;
  readonly presets: readonly ParsedPresetDump[];
  readonly path: string;
}

let cached: CachedBank | undefined;

/**
 * Load and validate the factory bank, caching the parse result for the
 * lifetime of the process. Throws if the file is missing or malformed
 * (bad envelope, bad checksum, wrong slot count). Re-parsing on every
 * tool call would burn ~5 ms on a 1.28 MB file with 104 envelope checks
 * - cheap, but pointless when the bytes never change.
 *
 * Pass `force=true` to bust the cache (used by tests).
 */
export function loadFactoryBank(force = false): CachedBank {
  if (cached && !force) return cached;
  const bankPath = resolveBankPath();
  if (!existsSync(bankPath)) {
    throw new Error(
      `Factory bank file not found at ${bankPath}. ` +
        `Download AM4-Factory-Presets-1p01.syx from https://www.fractalaudio.com/am4-downloads/ ` +
        `and drop it into samples/factory/, or set AM4_FACTORY_BANK_PATH to its location.`,
    );
  }
  const bytes = new Uint8Array(readFileSync(bankPath));
  if (bytes.length !== TOTAL_LOCATIONS * PRESET_DUMP_LEN) {
    throw new Error(
      `Factory bank file at ${bankPath} has unexpected size ${bytes.length}; ` +
        `expected ${TOTAL_LOCATIONS * PRESET_DUMP_LEN} (${TOTAL_LOCATIONS} × ${PRESET_DUMP_LEN}).`,
    );
  }
  const presets = parsePresetBank(bytes);
  cached = { bytes, presets, path: bankPath };
  return cached;
}

/**
 * Slice the bank's per-preset bytes back out of the source buffer for
 * `locationIndex` (0..103). Returns a view into the cached buffer; do
 * NOT mutate.
 */
export function getFactoryPresetBytes(locationIndex: number): Uint8Array {
  if (!Number.isInteger(locationIndex) || locationIndex < 0 || locationIndex >= TOTAL_LOCATIONS) {
    throw new Error(
      `Factory bank location index must be integer 0..${TOTAL_LOCATIONS - 1}, got ${locationIndex}.`,
    );
  }
  const bank = loadFactoryBank();
  return bank.bytes.subarray(
    locationIndex * PRESET_DUMP_LEN,
    (locationIndex + 1) * PRESET_DUMP_LEN,
  );
}

/**
 * Cut one preset's slice into its 6 individual SysEx messages: 1
 * header (0x77, 13 B), 4 chunks (0x78, 3082 B each), 1 footer (0x79,
 * 11 B). Each return value is a byte-identical view into the cached
 * bank buffer.
 */
export function getFactoryRestoreMessages(locationIndex: number): Uint8Array[] {
  const slice = getFactoryPresetBytes(locationIndex);
  const out: Uint8Array[] = [];
  let cursor = 0;
  out.push(slice.subarray(cursor, cursor + HEADER_LEN));
  cursor += HEADER_LEN;
  for (let i = 0; i < CHUNKS_PER_PRESET; i++) {
    out.push(slice.subarray(cursor, cursor + CHUNK_LEN));
    cursor += CHUNK_LEN;
  }
  out.push(slice.subarray(cursor, cursor + FOOTER_LEN));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FactoryRestoreResult {
  /** Wire index 0..103 of the restored location. */
  readonly locationIndex: number;
  /** Canonical 3-char location code, e.g. "G03". */
  readonly location: string;
  /** Total bytes transmitted (12,352 for a normal slot). */
  readonly totalBytes: number;
  /** Number of SysEx messages sent (always 6). */
  readonly messageCount: number;
  /** Wall time from first send call to last send call returning. */
  readonly wallTimeMs: number;
}

/**
 * Send the 6-message factory-restore stream for `locationIndex` to the
 * device. Fire-and-forget per the probe-confirmed pattern - the AM4
 * does not ack 0x77 / 0x78 / 0x79 messages in any documented way, so
 * the helper just paces the writes and returns wall-clock metadata.
 *
 * The caller is responsible for opening the MIDI port (typically via
 * the server's `ensureMidi`) and for any pre-flight safety prompts.
 */
export async function sendFactoryRestore(
  conn: MidiConnection,
  locationIndex: number,
): Promise<FactoryRestoreResult> {
  const messages = getFactoryRestoreMessages(locationIndex);
  const bytes = getFactoryPresetBytes(locationIndex);
  const startMs = Date.now();
  for (let i = 0; i < messages.length; i++) {
    conn.send(Array.from(messages[i]));
    if (i < messages.length - 1) await sleep(RESTORE_INTER_MESSAGE_DELAY_MS);
  }
  return {
    locationIndex,
    location: formatLocationCode(locationIndex),
    totalBytes: bytes.length,
    messageCount: messages.length,
    wallTimeMs: Date.now() - startMs,
  };
}
