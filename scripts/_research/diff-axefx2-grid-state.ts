/**
 * Diff all `0x20` grid-state frames in an Axe-Fx II passive capture.
 *
 * fn 0x20 carries the device's full routing-grid state (200-byte payload).
 * When AxeEdit clicks a "+" to add a cable, the device broadcasts a new
 * 0x20 reflecting the new state. Diffing consecutive 0x20 frames shows
 * exactly which bytes mutated → pins down the routing-mask byte position
 * and tells us cell index + mask value pairs without needing to know the
 * write-side function byte.
 *
 * Usage: npx tsx scripts/diff-axefx2-grid-state.ts <path.syx>
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function splitSysEx(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xf0) { i++; continue; }
    let end = i + 1;
    while (end < buf.length && buf[end] !== 0xf7) end++;
    if (end >= buf.length) break;
    const bytes = buf.subarray(i, end + 1);
    if (
      bytes.length >= 7 &&
      bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x74 && bytes[4] === 0x07
    ) out.push(bytes);
    i = end + 1;
  }
  return out;
}

function hex(b: number): string { return b.toString(16).padStart(2, '0'); }
function hex4(b: number): string { return b.toString(16).padStart(4, '0'); }

const arg = process.argv[2];
if (!arg) { console.error('Usage: diff-axefx2-grid-state <path.syx>'); process.exit(1); }
const abs = path.resolve(arg);
if (!existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(1); }

const frames = splitSysEx(readFileSync(abs));
const gridFrames = frames.filter((f) => f[5] === 0x20);

console.log(`Total Axe-Fx II frames: ${frames.length}`);
console.log(`fn 0x20 grid-state frames: ${gridFrames.length}`);
if (gridFrames.length === 0) { console.log('Nothing to diff.'); process.exit(0); }
console.log('');

// Show sizes — confirm they match before byte-diffing
console.log('Sizes:', gridFrames.map((f) => f.length).join(', '));
if (new Set(gridFrames.map((f) => f.length)).size > 1) {
  console.log('⚠  Frame sizes vary — diff below uses min length.');
}
const minLen = Math.min(...gridFrames.map((f) => f.length));
console.log('');

// Print first frame in cell-stride view (assume 16-byte stride after the
// 6-byte header f0/00/01/74/07/20; payload starts at offset 6).
const PAYLOAD_START = 6;
const CHECKSUM_AND_F7 = 2;

function dumpGrid(f: Uint8Array, label: string): void {
  console.log(`── ${label} (len=${f.length}) ─────────────────────────`);
  // The payload (between header and cs+F7) is 200 - 6 - 2 = 192 bytes.
  // 192 / 16 = 12 cells exactly, OR 192 / 12 = 16 cells. Show in 16-byte
  // rows and a separate 12-byte view so the structure is visible.
  const payload = f.subarray(PAYLOAD_START, f.length - CHECKSUM_AND_F7);
  console.log(`  payload bytes: ${payload.length}`);
  console.log(`  16-byte stride (likely cells; col-major):`);
  for (let i = 0; i * 16 < payload.length; i++) {
    const row = payload.subarray(i * 16, (i + 1) * 16);
    const ascii = Array.from(row).map((b) => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
    console.log(`    cell ${i.toString().padStart(2)}: ${Array.from(row).map(hex).join(' ')}  | ${ascii}`);
  }
  console.log('');
}

dumpGrid(gridFrames[0], 'GRID #0');

// Diff each subsequent frame against frame[0]
for (let n = 1; n < gridFrames.length; n++) {
  const a = gridFrames[0];
  const b = gridFrames[n];
  console.log(`──── DIFF: GRID #${n} vs GRID #0 ────────────────────────`);
  let diffs = 0;
  const cellDiffs = new Map<number, Array<{ pos: number; before: number; after: number }>>();
  for (let i = 0; i < minLen - CHECKSUM_AND_F7; i++) {
    if (a[i] !== b[i]) {
      diffs++;
      const payloadOffset = i - PAYLOAD_START;
      if (payloadOffset >= 0) {
        const cellIdx = Math.floor(payloadOffset / 16);
        const byteInCell = payloadOffset % 16;
        if (!cellDiffs.has(cellIdx)) cellDiffs.set(cellIdx, []);
        cellDiffs.get(cellIdx)!.push({ pos: byteInCell, before: a[i], after: b[i] });
      }
    }
  }
  if (diffs === 0) {
    console.log('  identical');
  } else {
    console.log(`  ${diffs} byte(s) differ (excluding checksum):`);
    for (const [cellIdx, changes] of [...cellDiffs.entries()].sort(([x], [y]) => x - y)) {
      console.log(`  cell ${cellIdx}:`);
      for (const c of changes) {
        const tag =
          c.pos === 0 ? '(blockId_lo)' :
          c.pos === 1 ? '(blockId_hi)' :
          c.pos === 2 ? '(MASK?)     ' :
          `(byte[${c.pos}])`;
      console.log(`     byte ${c.pos.toString().padStart(2)} ${tag}  0x${hex(c.before)} → 0x${hex(c.after)}`);
      }
    }
    // Also show the changed cells' full rows for context
    console.log('  changed cells (after-state, full 16-byte row):');
    const payload = b.subarray(PAYLOAD_START, b.length - CHECKSUM_AND_F7);
    for (const cellIdx of [...cellDiffs.keys()].sort((x, y) => x - y)) {
      const row = payload.subarray(cellIdx * 16, (cellIdx + 1) * 16);
      const blockId = row[0] | (row[1] << 7);
      console.log(`    cell ${cellIdx.toString().padStart(2)} (blockId=${blockId}=0x${hex4(blockId)}): ${Array.from(row).map(hex).join(' ')}`);
    }
  }
  console.log('');
}
