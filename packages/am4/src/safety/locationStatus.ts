/**
 * Classification cache for AM4 preset locations.
 *
 * Tells the write-gate whether a location currently holds factory-state
 * content or has been modified by the user, so save_to_location can
 * decide whether to refuse, warn, or proceed with a backup.
 *
 * AM4 has no cheap metadata-read command — GET_PRESET_NAME (0x0F) is
 * rejected on AM4 (SYSEX-MAP.md §5). The only way to know what's at a
 * location is a full preset dump (~5–8 s on the wire). Aggressive
 * caching is essential: first-touch is slow but every subsequent
 * classification of the same location is free, until our own write
 * tools modify that location (at which point the cache entry is dropped).
 *
 * The cache is process-scoped — no persistence across server restarts.
 * Persisting would risk stale data: the user might have edited a
 * location with AM4-Edit between sessions, restored from another
 * librarian, or installed new firmware. A clean restart forces a
 * fresh dump on first touch and is always correct.
 *
 * Known limitation — chunk payloads are per-export masked (verified
 * 2026-04-29 by `scripts/verify-safety.ts`). An active-loaded export
 * of factory A01 has different chunk bytes than the bank file's A01
 * entry. The mask appears keyed by header state (likely the location
 * bytes — 0x7F sentinel for active vs real index for stored). This
 * means our fingerprint approach can MATCH bank-form dumps as factory
 * but may MISS active-form dumps, classifying them as user-modified.
 * This is a tolerable false positive: the gate offers `force=true`
 * with auto-backup, so the user has a recoverable override path. The
 * decode workstream that would let us strip the mask before hashing
 * is tracked as a separate backlog item (§11 / preset binary format).
 */

import { parsePresetDump } from '../presetDump.js';
import { fingerprintPresetDump } from './factoryFingerprints.js';

export type LocationStatus = 'factory' | 'user-modified';

export interface LocationClassification {
  readonly status: LocationStatus;
  readonly fingerprint: string;
}

/**
 * Function the cache calls when it needs the current bytes at a
 * location. Should return a 12,352-byte preset dump. Provided by the
 * MCP server (which owns the MIDI connection); stubbed in tests.
 */
export type DumpLocationFn = (location: string) => Promise<Uint8Array>;

export class LocationStatusCache {
  private readonly cache = new Map<string, LocationClassification>();
  private dumpCallCount = 0;

  constructor(
    private readonly factoryFingerprints: Map<string, string> | null,
    private readonly dumpLocation: DumpLocationFn,
  ) {}

  /**
   * Classify a location. Cached after first call; re-dumps only after
   * `invalidate(location)` (or `invalidateAll`).
   */
  async classify(location: string): Promise<LocationClassification> {
    const cached = this.cache.get(location);
    if (cached !== undefined) return cached;

    this.dumpCallCount++;
    const bytes = await this.dumpLocation(location);
    const parsed = parsePresetDump(bytes);
    const fingerprint = fingerprintPresetDump(parsed);

    const factoryFp = this.factoryFingerprints?.get(location);
    const status: LocationStatus =
      factoryFp !== undefined && factoryFp === fingerprint
        ? 'factory'
        : 'user-modified';

    const result: LocationClassification = { status, fingerprint };
    this.cache.set(location, result);
    return result;
  }

  /** Drop the cache entry for `location`. Call after any write to that location. */
  invalidate(location: string): void {
    this.cache.delete(location);
  }

  /** Drop all cached entries. Call on disconnect / reconnect. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Test helper — number of dumpLocation calls since construction. */
  getDumpCallCount(): number {
    return this.dumpCallCount;
  }

  /** Test helper — peek at the current cache. */
  inspectCache(): ReadonlyMap<string, LocationClassification> {
    return this.cache;
  }
}
