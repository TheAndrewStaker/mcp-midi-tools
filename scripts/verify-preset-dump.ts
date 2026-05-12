/**
 * Preset-dump round-trip golden.
 *
 * Validates that `src/protocol/presetDump.ts` parses every byte of the
 * factory bank and a single-preset export, then re-emits a byte-identical
 * stream. Run via `npm test` or `npm run verify-preset-dump`.
 *
 * Test fixtures live under `samples/factory/` and are git-ignored Fractal
 * IP — see `samples/factory/README.md` for the file list. If a fixture is
 * missing, that fixture's checks are skipped (with a clear notice) rather
 * than failing — keeps `npm test` green on a fresh clone where the founder
 * hasn't dropped the factory bank in yet.
 *
 * Bonus output: the bank-file analysis prints a per-byte distinct-value
 * count for the 0x77 header payload across the 104 dumps. This is how we
 * decode the target-location byte without a hardware capture — whichever
 * byte takes 104 distinct values IS the location encoding (SYSEX-MAP.md
 * §10b notes the byte meaning was previously TBD).
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  HEADER_PAYLOAD_LEN,
  PRESET_DUMP_LEN,
  parsePresetBank,
  parsePresetDump,
  serializePresetDump,
} from '@/fractal/am4/presetDump.js';

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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDiffOffset(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// ---------------------------------------------------------------------------
// Single preset round-trip (samples/factory/A01-original.syx)
// ---------------------------------------------------------------------------

console.log('Single-preset round-trip (samples/factory/A01-original.syx):');
if (!existsSync(SINGLE_PATH)) {
  console.log(`  SKIP  ${SINGLE_PATH} not present (Fractal-IP file — see samples/factory/README.md)`);
  skipped++;
} else {
  const single = new Uint8Array(readFileSync(SINGLE_PATH));
  check(
    `file is exactly ${PRESET_DUMP_LEN} bytes`,
    single.length === PRESET_DUMP_LEN,
    `got ${single.length}`,
  );
  if (single.length === PRESET_DUMP_LEN) {
    let parsed;
    try {
      parsed = parsePresetDump(single);
      ok('parsePresetDump validated all envelopes + checksums');
    } catch (e) {
      bad('parsePresetDump', (e as Error).message);
    }
    if (parsed) {
      const reemitted = serializePresetDump(parsed);
      const eq = bytesEqual(reemitted, single);
      if (eq) {
        ok('parse → serialize is byte-identical');
      } else {
        bad('parse → serialize is byte-identical', `first diff at offset ${firstDiffOffset(reemitted, single)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Full bank round-trip (samples/factory/AM4-Factory-Presets-1p01.syx)
// ---------------------------------------------------------------------------

console.log('\nFull-bank round-trip (samples/factory/AM4-Factory-Presets-1p01.syx):');
if (!existsSync(BANK_PATH)) {
  console.log(`  SKIP  ${BANK_PATH} not present (Fractal-IP file — see samples/factory/README.md)`);
  skipped++;
} else {
  const bank = new Uint8Array(readFileSync(BANK_PATH));
  const expectedBankLen = 104 * PRESET_DUMP_LEN;
  check(
    `bank is exactly 104 × ${PRESET_DUMP_LEN} bytes`,
    bank.length === expectedBankLen,
    `got ${bank.length}`,
  );

  if (bank.length === expectedBankLen) {
    let presets: ReturnType<typeof parsePresetBank> | undefined;
    try {
      presets = parsePresetBank(bank);
      ok('parsePresetBank validated all 104 × 6 messages');
    } catch (e) {
      bad('parsePresetBank', (e as Error).message);
    }

    if (presets) {
      check('parsed 104 preset dumps', presets.length === 104, `got ${presets.length}`);

      let firstMismatchIdx = -1;
      for (let i = 0; i < presets.length; i++) {
        const reemitted = serializePresetDump(presets[i]);
        const original = bank.subarray(i * PRESET_DUMP_LEN, (i + 1) * PRESET_DUMP_LEN);
        if (!bytesEqual(reemitted, original)) {
          firstMismatchIdx = i;
          break;
        }
      }
      if (firstMismatchIdx === -1) {
        ok('every preset round-trips byte-identically');
      } else {
        bad('every preset round-trips byte-identically', `mismatch at preset index ${firstMismatchIdx}`);
      }

      // Header-payload analysis: which byte encodes the target location?
      console.log('\n  Header-payload analysis (which 0x77 byte encodes location):');
      for (let b = 0; b < HEADER_PAYLOAD_LEN; b++) {
        const values: number[] = [];
        const seen = new Set<number>();
        for (const p of presets) {
          const v = p.headerPayload[b];
          values.push(v);
          seen.add(v);
        }
        const sorted = [...seen].sort((x, y) => x - y);
        const sample = sorted
          .slice(0, 8)
          .map((v) => '0x' + v.toString(16).padStart(2, '0'))
          .join(', ');
        const tail = sorted.length > 8 ? `, ... (${sorted.length} distinct)` : '';
        const monotonic =
          sorted.length === 104 && values.every((v, i) => v === values[0] + i)
            ? '  ← matches index 0..103 monotonically'
            : '';
        console.log(`    byte[${b}]: ${seen.size} distinct values: ${sample}${tail}${monotonic}`);
      }

      // Footer-payload analysis: should be uniformly distinct (footer is a
      // content hash per SYSEX-MAP.md §10b — every preset has different content).
      console.log('\n  Footer-payload analysis (each preset should have distinct content):');
      const footerKeys = new Set<string>();
      for (const p of presets) {
        footerKeys.add(Array.from(p.footerPayload).map((v) => v.toString(16)).join(' '));
      }
      check(
        '104 presets have 104 distinct footer payloads',
        footerKeys.size === 104,
        `got ${footerKeys.size} distinct footer payloads`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

console.log('');
if (fail > 0) {
  console.log(`FAILED: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}.`);
  process.exit(1);
}
const skipNote = skipped ? ` (${skipped} fixture(s) absent — populate samples/factory/ to run)` : '';
console.log(`OK: ${pass} checks passed${skipNote}.`);
