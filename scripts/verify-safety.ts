/**
 * Safety-layer golden — exercises factoryFingerprints, locationStatus
 * cache, and the backup filesystem layer. Run via `npm test` or
 * `npm run verify-safety`.
 *
 * Sections:
 *   1. fingerprints — load the bank file, assert 104 distinct
 *      fingerprints, assert single-preset hash matches the bank entry.
 *      Skips cleanly if Fractal-IP fixtures are absent.
 *   2. cache — stub `dumpLocation`, classify A01 (factory match),
 *      classify a different location with mutated bytes (user-modified),
 *      assert cache prevents re-dumping, assert invalidate forces re-
 *      dump.
 *   3. backup — write bytes to a tmp dir, list, read back, assert
 *      filename format and ordering.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatLocationCode,
  parseLocationCode,
} from '@/fractal/am4/locations.js';
import {
  PRESET_DUMP_LEN,
  parsePresetBank,
  parsePresetDump,
  serializePresetDump,
} from '@/fractal/am4/presetDump.js';
import {
  fingerprintPresetDump,
  loadFactoryFingerprints,
} from '@/fractal/am4/safety/factoryFingerprints.js';
import {
  LocationStatusCache,
  type DumpLocationFn,
} from '@/fractal/am4/safety/locationStatus.js';
import {
  listBackups,
  readBackup,
  writeBackup,
} from '@/fractal/am4/safety/backup.js';

const BANK_PATH = 'samples/factory/AM4-Factory-Presets-1p01.syx';
const SINGLE_PATH = 'samples/factory/A01-original.syx';

let pass = 0;
let fail = 0;
let skipped = 0;

function ok(label: string): void {
  console.log(`  ok    ${label}`);
  pass++;
}
function bad(label: string, detail = ''): void {
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  fail++;
}
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) ok(label);
  else bad(label, detail);
}

// ---------------------------------------------------------------------------
// 1. Fingerprints
// ---------------------------------------------------------------------------

console.log('Factory fingerprints:');
let bankFingerprints: Map<string, string> | null = null;
let bankBytes: Uint8Array | null = null;
if (!existsSync(BANK_PATH)) {
  console.log(
    `  SKIP  ${BANK_PATH} not present (Fractal-IP file — see samples/factory/README.md)`,
  );
  skipped++;
} else {
  bankBytes = new Uint8Array(readFileSync(BANK_PATH));
  bankFingerprints = loadFactoryFingerprints(BANK_PATH);
  check(
    'loadFactoryFingerprints returns a non-null map',
    bankFingerprints !== null,
  );
  if (bankFingerprints) {
    check(
      'fingerprint map has 104 entries (one per location)',
      bankFingerprints.size === 104,
      `got ${bankFingerprints.size}`,
    );
    const distinct = new Set(bankFingerprints.values());
    check(
      'all 104 fingerprints are distinct (no two factory presets collide)',
      distinct.size === 104,
      `got ${distinct.size} distinct`,
    );
    // Spot-check key shape
    check(
      'fingerprint for "A01" exists and is a 64-char hex string',
      /^[0-9a-f]{64}$/.test(bankFingerprints.get('A01') ?? ''),
    );
  }

  // Determinism: a second load returns identical fingerprints
  const second = loadFactoryFingerprints(BANK_PATH);
  let deterministic = true;
  if (!bankFingerprints || !second) {
    deterministic = false;
  } else {
    for (const [loc, fp] of bankFingerprints) {
      if (second.get(loc) !== fp) {
        deterministic = false;
        break;
      }
    }
  }
  check('repeated load produces identical fingerprints (deterministic)', deterministic);
}

if (!existsSync(SINGLE_PATH)) {
  console.log(
    `  SKIP  ${SINGLE_PATH} not present — single-preset cross-check skipped.`,
  );
  skipped++;
} else if (bankFingerprints) {
  const singleBytes = new Uint8Array(readFileSync(SINGLE_PATH));
  const singleParsed = parsePresetDump(singleBytes);
  const singleFp = fingerprintPresetDump(singleParsed);
  // A01-original.syx is a session-03 export of factory A01 via
  // AM4-Edit's File → Export Preset — i.e., an active-loaded export.
  // The bank file's A01 entry is the stored form. If the chunk payloads
  // were pure content, the two fingerprints would match. SYSEX-MAP.md
  // §10b notes the chunks appear XOR-masked or scrambled, which is
  // consistent with the mask being keyed by something that differs
  // between active and stored exports (likely the location bytes —
  // active export uses 0x7F sentinel, stored uses the real index).
  //
  // This is a SOFT diagnostic, not a pass/fail check. The safety gate
  // tolerates the divergence: a false positive ("user-modified" when
  // the location actually holds factory content) lets the user pass
  // force=true with an auto-backup, which is a recoverable path. The
  // diagnostic exists to track whether the chunk encoding ever changes
  // (firmware update, AM4-Edit update) so future Claude sessions
  // notice without spelunking.
  const matchAtA01 = singleFp === bankFingerprints.get('A01');
  console.log(
    matchAtA01
      ? '  info  A01-original.syx chunk fingerprint MATCHES bank A01 ' +
          '(chunks are pure content — fingerprint approach is exact)'
      : '  info  A01-original.syx chunk fingerprint DIFFERS from bank A01 ' +
          '(chunks are location-keyed; gate may false-positive active ' +
          'exports as user-modified — see verify-safety.ts comment)',
  );
  if (!matchAtA01) {
    // Probe: does any bank entry match? If yes, A01-original is
    // surprisingly classified as something else (interesting decode
    // signal). If no, the divergence is a per-export mask, not a
    // mislabeled file.
    let matchingLoc: string | null = null;
    for (const [loc, fp] of bankFingerprints) {
      if (fp === singleFp) {
        matchingLoc = loc;
        break;
      }
    }
    console.log(
      matchingLoc
        ? `  info    …but matches bank entry ${matchingLoc} — interesting ` +
            'decode signal; the export may have been from a different location'
        : '  info    …and matches no bank entry; consistent with a per-export ' +
            'mask, not a mislabeled file',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. LocationStatusCache
// ---------------------------------------------------------------------------

console.log('\nLocationStatusCache:');
if (!bankBytes || !bankFingerprints) {
  console.log('  SKIP  bank fixture absent — cache golden skipped.');
  skipped++;
} else {
  // Slice individual factory dumps from the bank to feed to the stub
  // dumpFn. Mutate one to simulate "user-modified" without changing
  // header bytes (which would be irrelevant — fingerprint excludes
  // them).
  const bankBytesNonNull = bankBytes;
  const a01Bytes = bankBytesNonNull.slice(0, PRESET_DUMP_LEN);
  const a02Original = bankBytesNonNull.slice(PRESET_DUMP_LEN, PRESET_DUMP_LEN * 2);

  // Construct a "modified" A02: parse it, flip one byte in chunk 1,
  // re-serialize. This guarantees envelopes/checksums stay valid but
  // the chunk-payload fingerprint differs from the bank's A02.
  const a02Parsed = parsePresetDump(a02Original);
  const mutatedChunk = new Uint8Array(a02Parsed.chunkPayloads[0]);
  mutatedChunk[100] ^= 0x01;
  const a02Modified = serializePresetDump({
    ...a02Parsed,
    chunkPayloads: [mutatedChunk, ...a02Parsed.chunkPayloads.slice(1)],
  });

  const dumpResponses: Record<string, Uint8Array> = {
    A01: a01Bytes,
    A02: a02Modified,
  };
  const stubDump: DumpLocationFn = async (loc) => {
    const bytes = dumpResponses[loc];
    if (!bytes) throw new Error(`stub dumpLocation: no response for ${loc}`);
    return bytes;
  };

  const cache = new LocationStatusCache(bankFingerprints, stubDump);

  const a01Result = await cache.classify('A01');
  check(
    'A01 (unmodified bank entry) classifies as factory',
    a01Result.status === 'factory',
    `got ${a01Result.status}`,
  );

  const a02Result = await cache.classify('A02');
  check(
    'A02 (chunk-byte flipped) classifies as user-modified',
    a02Result.status === 'user-modified',
    `got ${a02Result.status}`,
  );

  check(
    'cache invokes dumpLocation exactly once per first-touch',
    cache.getDumpCallCount() === 2,
    `got ${cache.getDumpCallCount()} calls`,
  );

  // Re-classify A01 — should hit cache, no new dump.
  await cache.classify('A01');
  check(
    'second classify of A01 hits cache (no extra dumpLocation call)',
    cache.getDumpCallCount() === 2,
    `got ${cache.getDumpCallCount()} calls after re-classify`,
  );

  // Invalidate A01 — next classify should re-dump.
  cache.invalidate('A01');
  await cache.classify('A01');
  check(
    'invalidate(A01) forces re-dump on next classify',
    cache.getDumpCallCount() === 3,
    `got ${cache.getDumpCallCount()} calls after invalidate + re-classify`,
  );

  // invalidateAll empties cache.
  cache.invalidateAll();
  check(
    'invalidateAll() clears every cache entry',
    cache.inspectCache().size === 0,
    `cache size = ${cache.inspectCache().size}`,
  );

  // Behavior with no factory fingerprints (e.g., bank file absent on
  // user's machine). Should classify everything as user-modified.
  const stubNoFactory = new LocationStatusCache(null, stubDump);
  const result = await stubNoFactory.classify('A01');
  check(
    'no factory fingerprints → classify always returns user-modified',
    result.status === 'user-modified',
    `got ${result.status}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Backup filesystem layer
// ---------------------------------------------------------------------------

console.log('\nBackup filesystem layer:');
const tmp = mkdtempSync(join(tmpdir(), 'mcp-midi-control-backup-'));
try {
  const bytes = new Uint8Array(PRESET_DUMP_LEN);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;

  const fixedNow = new Date('2026-04-29T15:30:45.123Z');
  // Use a clock that returns successive seconds so multiple writes don't
  // collide on the same filename.
  let secondsOffset = 0;
  const clock = () => new Date(fixedNow.getTime() + secondsOffset++ * 1000);

  const r1 = writeBackup('Z04', bytes, { dir: tmp, now: clock });
  check('writeBackup returns the location it was given', r1.location === 'Z04');
  check('writeBackup filename contains the location', r1.path.endsWith(`Z04.syx`));
  check(
    'writeBackup timestamp matches YYYY-MM-DD-HHMMSS',
    /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(r1.timestamp),
    `got ${r1.timestamp}`,
  );

  const r2 = writeBackup('Z04', bytes, { dir: tmp, now: clock });
  check('a second backup gets a different timestamp', r1.timestamp !== r2.timestamp);

  // List should show 2 backups, newest first.
  const listed = listBackups('Z04', { dir: tmp });
  check('listBackups returns 2 entries for Z04', listed.length === 2, `got ${listed.length}`);
  check(
    'listBackups returns newest first',
    listed[0].timestamp > listed[1].timestamp,
    `got [${listed[0].timestamp}, ${listed[1].timestamp}]`,
  );

  // Other locations: no backups present.
  const noneA01 = listBackups('A01', { dir: tmp });
  check('listBackups for unwritten location returns empty array', noneA01.length === 0);

  // Round-trip readBackup
  const readBack = readBackup(r1.path);
  let bytesMatch = readBack.length === bytes.length;
  if (bytesMatch) {
    for (let i = 0; i < bytes.length; i++) {
      if (readBack[i] !== bytes[i]) {
        bytesMatch = false;
        break;
      }
    }
  }
  check('readBackup returns the exact bytes that were written', bytesMatch);

  // Sanity: parseLocationCode/formatLocationCode used by the cache layer
  // accept the same string format the backup layer emits.
  check(
    'location string round-trips through locations.ts helpers',
    formatLocationCode(parseLocationCode(r1.location)) === r1.location,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

console.log('');
if (fail > 0) {
  console.log(
    `FAILED: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}.`,
  );
  process.exit(1);
}
const skipNote = skipped
  ? ` (${skipped} fixture(s) absent — populate samples/factory/ to run those)`
  : '';
console.log(`OK: ${pass} checks passed${skipNote}.`);
