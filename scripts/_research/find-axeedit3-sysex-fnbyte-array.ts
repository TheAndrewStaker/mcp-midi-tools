/**
 * Search Axe-Edit III.exe for a u8 array mapping enum-index → function byte
 * for the SYSEX_* string pool.
 *
 * From mine-axeedit3-sysex-table.ts we know enum-index → fn-byte for 8
 * anchors:
 *   idx 2  → 0x0f, idx 3  → 0x0e
 *   idx 5  → 0x14, idx 6  → 0x13
 *   idx 10 → 0x0d, idx 11 → 0x0c, idx 12 → 0x0b, idx 13 → 0x0a
 *
 * The string pool has 23 entries. If a parallel u8 array exists, it's
 * 23 bytes long with the constraints above. Scan the whole binary
 * looking for any 23-byte window that matches all 8 constraints; the
 * remaining 15 unknown bytes give us the function-byte assignments for
 * the undocumented entries (DSP_MESSAGE, GUI_CONTROL, etc.) for free.
 *
 * Also tries u16 (2 bytes per entry) and u32 (4 bytes per entry)
 * encodings in case the table is wider.
 */

import { readFileSync } from 'node:fs';

const EXE = 'C:\\Program Files\\Fractal Audio\\Axe-Edit III\\Axe-Edit III.exe';
const buf = readFileSync(EXE);
console.log(`scanning ${EXE} (${buf.length.toLocaleString()} bytes)`);

// Anchor table: enum index → expected function byte.
const N = 23;
const anchors: Array<{ idx: number; fn: number }> = [
  { idx: 2, fn: 0x0f },
  { idx: 3, fn: 0x0e },
  { idx: 5, fn: 0x14 },
  { idx: 6, fn: 0x13 },
  { idx: 10, fn: 0x0d },
  { idx: 11, fn: 0x0c },
  { idx: 12, fn: 0x0b },
  { idx: 13, fn: 0x0a },
];

function scanU8(stride: number, label: string): number[] {
  const hits: number[] = [];
  for (let base = 0; base + N * stride <= buf.length; base++) {
    let ok = true;
    for (const a of anchors) {
      const pos = base + a.idx * stride;
      // For u8 stride=1; for u16/u32 stride=2/4, read little-endian
      // first byte (function byte fits in one byte, but the array
      // could be wider with the value in the low byte).
      const v = buf[pos];
      if (v !== a.fn) {
        ok = false;
        break;
      }
      // For wider strides, require higher bytes to be zero.
      if (stride > 1) {
        for (let k = 1; k < stride; k++) {
          if (buf[pos + k] !== 0) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) break;
    }
    if (ok) hits.push(base);
  }
  console.log(`stride=${stride} (${label}): ${hits.length} hit${hits.length === 1 ? '' : 's'}`);
  for (const h of hits.slice(0, 10)) {
    const bytes: string[] = [];
    for (let i = 0; i < N; i++) {
      bytes.push('0x' + buf[h + i * stride].toString(16).padStart(2, '0'));
    }
    console.log(`  @ 0x${h.toString(16).padStart(6, '0')}: [${bytes.join(', ')}]`);
  }
  return hits;
}

console.log('');
console.log('Searching for parallel function-byte array (23 entries):');
console.log('');
scanU8(1, 'u8');
scanU8(2, 'u16 LE');
scanU8(4, 'u32 LE');

// Loosen the search: maybe the table isn't exactly 23 entries — maybe
// the SYSEX_* string pool is a subset of a larger enum that includes
// non-SYSEX entries. Try N=32, N=48, N=64 with anchor indices the
// same.
console.log('');
console.log('Trying with table size guesses larger than 23 (anchor positions fixed at idx 2..13):');
for (const guess of [32, 48, 64, 96, 128]) {
  for (let base = 0; base + guess <= buf.length; base++) {
    let ok = true;
    for (const a of anchors) {
      if (buf[base + a.idx] !== a.fn) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const bytes: string[] = [];
    for (let i = 0; i < guess; i++) bytes.push('0x' + buf[base + i].toString(16).padStart(2, '0'));
    console.log(`  size=${guess} @ 0x${base.toString(16).padStart(6, '0')}: [${bytes.join(', ')}]`);
    break; // first hit per size
  }
}
