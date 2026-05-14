/**
 * AM4 working-buffer fingerprint cache — closes the front-panel-edit
 * blind spot in the safe-edit gate.
 *
 * Why this exists. Captured Session 74 HW-107: AM4 emits zero
 * unsolicited MIDI traffic when the user turns a knob on the front
 * panel. There is no device-sourced dirty broadcast like the Axe-Fx
 * II's 0x74 state-dump triple. AM4-Edit detects edits by polling
 * the device continuously (~60 SysEx queries/s in session-59-am4-
 * edit-sync.syx) — too expensive for the MCP server to mirror.
 *
 * Lazy alternative: do ONE buffer-dump query on the path we
 * actually need to know — just before we navigate away. The
 * `am4_request_active_buffer_dump` primitive (Session 51 HW-045)
 * gives us 12,352 bytes of stored-form working-buffer content in
 * ~150-200ms. Hashing those bytes and comparing to a cached
 * "expected clean" fingerprint detects edits made by any source
 * (front-panel, AM4-Edit running alongside us, our own writes
 * we forgot to mark dirty) in one round-trip.
 *
 * Cache semantics:
 *   - Indexed by AM4 location index (0..103, A1..Z4).
 *   - Refreshed on every CLEAN transition: post-save, post-switch.
 *   - In-memory only; resets on server restart (fail-safe: first
 *     post-restart switch can't compare and warns instead of refusing).
 *
 * What this catches:
 *   - User turns knob on front panel → next switch refuses.
 *   - User switches scenes on front panel without saving → next switch refuses.
 *   - AM4-Edit edits the buffer in parallel with our server → next switch refuses.
 *   - A "clean" buffer that's actually dirty because our code-side
 *     classifier (markAM4Dirty/markAM4Clean) drifted → refused.
 *
 * What this does NOT catch:
 *   - Front-panel edits between two switch_preset attempts on the
 *     same preset (the fingerprint refresh after the first switch
 *     captures whatever was on screen at that moment).
 *
 * Hash choice: SHA-256 truncated to 16 bytes (128 bits). Buffer is
 * 12,352 bytes; SHA-256 of that range takes <1ms on any modern CPU
 * and the truncated digest is more than enough to avoid collisions
 * (birthday-bound 2^64 distinct buffers, far more than the 2^14
 * possible AM4 preset states).
 */

import { createHash } from 'node:crypto';

interface CachedFingerprint {
  hash: string;
  capturedAt: number;
}

const cache = new Map<number, CachedFingerprint>();

/**
 * Compute a stable fingerprint for a working-buffer dump. The dump
 * comes from `am4_request_active_buffer_dump` and consists of the
 * concatenated chunk payloads (headerBytes + chunkBytes + footerBytes).
 * We hash only the chunk payload — the header and footer carry
 * bank/sub addresses and a checksum, both of which can vary in ways
 * unrelated to working-buffer state (e.g. SysEx framing details).
 */
export function fingerprintDump(chunkBytes: readonly (readonly number[])[]): string {
  // chunkBytes is the array of payload chunks (one per inbound 0x78
  // message). Hash them in order — concatenated content is what the
  // working buffer's stored-form bytes look like end-to-end.
  const hash = createHash('sha256');
  for (const chunk of chunkBytes) {
    hash.update(Uint8Array.from(chunk));
  }
  return hash.digest('hex').slice(0, 32);
}

export function cacheFingerprint(locationIndex: number, hash: string): void {
  if (!Number.isInteger(locationIndex) || locationIndex < 0 || locationIndex > 103) {
    throw new Error(`bufferFingerprint.cache: location ${locationIndex} out of AM4 range 0..103`);
  }
  cache.set(locationIndex, { hash, capturedAt: Date.now() });
}

export function getCachedFingerprint(locationIndex: number): CachedFingerprint | undefined {
  return cache.get(locationIndex);
}

export function clearCachedFingerprint(locationIndex: number): void {
  cache.delete(locationIndex);
}

/** Mostly for tests — clear the entire cache. */
export function clearAllCachedFingerprints(): void {
  cache.clear();
}
