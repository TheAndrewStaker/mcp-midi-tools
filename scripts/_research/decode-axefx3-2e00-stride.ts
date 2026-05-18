/**
 * Stride analysis for `2E 00` frame: test the hypothesis that the dense
 * body (offsets 32-351 in the payload, ~320 bytes) is 8 entries × 40
 * bytes each — matching either the III's 8 scenes or 8 snapshots.
 *
 * Tries several stride candidates (32, 40, 48, 56, 64) and prints rows
 * aligned by that stride so the structure (if any) is visually apparent.
 */

const FRAME_HEX = `
F0 00 01 74 10 01 2E 00 00 00 00 00 3F 01 00 00 00 00 00 00 05 4B 00 20 00 00 00 00 00 00 00 20 00 00 00 1D 2D 37 10 4A 04 41 01 18 65 30 59 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 00 4C 32 58 2C 42 02 11 4A 6C 30 5E 24 02 69 01 1A 6B 2B 08 06 24 19 2C 40 20 10 08 04 02 01 00 40 20 10 08 00 04 1B 21 5E 72 32 18 2D 42 02 4D 6E 65 36 1B 0E 32 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 00 21 5A 0D 77 13 11 42 6C 10 14 6E 76 2B 31 58 73 10 0B 24 04 41 64 60 30 18 08 04 02 01 00 40 20 10 08 04 00 02 05 70 65 23 16 04 04 6B 3D 48 65 10 0B 24 04 1B 49 6A 6E 31 5A 04 02 01 00 40 20 10 08 04 02 01 00 40 20 00 10 2F 06 2A 19 30 20 26 5B 6C 46 29 00 5A 20 26 19 2C 16 21 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 00 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 00 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 00 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 00 02 28 00 00 00 14 00 00 00 05 68 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 2E 00 00 20 00 00 00 00 00 5F 40 00 60 00 00 00 00 00 00 00 00 00 00 00 00 00 00 0B 20 00 04 00 00 00 00 00 03 50 00 08 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 24 00 00 40 0C 60 00 10 00 3E 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1B 60 00 08 01 4E 00 01 00 0D 10 00 10 00 46 00 01 00 04 70 00 08 00 21 00 00 40 00 20 08 01 00 00 20 40 10 00 24 04 02 00 16 20 00 20 00 56 00 04 00 00 78 10 40 00 53 00 00 10 01 34 00 02 00 06 20 40 20 00 0C 04 04 00 05 30 00 40 00 03 02 08 00 0B 30 00 02 00 00 00 00 00 00 00 08 04 00 03 40 40 40 00 4C 00 08 00 00 70 21 00 00 2C 00 00 20 00 00 00 00 00 02 01 00 40 03 48 00 08 00 1C 60 01 00 00 0A 04 10 00 00 00 00 00 00 00 00 00 00 07 70 00 38 00 00 00 00 00 00 00 00 00 00 03 00 42 00 00 00 00 00 00 00 00 00 00 00 0A 02 09 00 00 00 00 00 00 00 00 00 00 01 1C 00 00 00 00 00 00 00 00 00 00 00 00 01 30 20 10 00 00 00 00 00 00 00 00 00 00 1B 00 04 00 00 00 00 00 00 00 00 00 00 00 04 04 02 00 00 00 00 00 00 00 00 00 00 06 70 00 40 00 00 00 00 00 00 00 00 00 00 0A 40 02 20 00 00 00 00 00 00 00 00 00 01 3E 00 00 00 00 5C F7
`;

const bytes = FRAME_HEX.trim().split(/\s+/).map((h) => parseInt(h, 16));
const payload = bytes.slice(8, bytes.length - 2);

// Body region (offsets 32..360 in payload, where the dense pattern lives)
const bodyStart = 32;
const bodyEnd = 360;
const body = payload.slice(bodyStart, bodyEnd);
console.log(`Body region: ${body.length} bytes (offsets ${bodyStart}..${bodyEnd - 1})`);

// Try stride alignment — print first `n` bytes of each candidate
function showStride(stride: number, label: string) {
  console.log(`\n=== Stride ${stride} (${label}) ===`);
  const entries = Math.floor(body.length / stride);
  console.log(`  ${entries} entries × ${stride} bytes = ${entries * stride} / ${body.length}`);
  for (let i = 0; i < entries; i++) {
    const row = body.slice(i * stride, (i + 1) * stride);
    const hex = row.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  E${i.toString().padStart(2, "0")}  ${hex}`);
  }
  const leftover = body.length % stride;
  if (leftover) {
    console.log(`  (leftover ${leftover} bytes)`);
  }
}

showStride(40, "8 entries — III's 8 scenes hypothesis");
showStride(41, "stride 41 (test off-by-one)");
showStride(32, "stride 32 (alt — 10 entries)");

// Septet-decode the body and try stride on the decoded data too
function septetDecodeLSF(input: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 8) {
    const group = input.slice(i, i + 8);
    if (group.length < 2) break;
    const high = group[group.length - 1];
    for (let j = 0; j < group.length - 1; j++) {
      const highBit = ((high >> j) & 1) << 7;
      out.push(group[j] | highBit);
    }
  }
  return out;
}

console.log(`\n=== Septet-decoded body (LSF), ${body.length} → 7/8 size ===`);
const decoded = septetDecodeLSF(body);
console.log(`Decoded length: ${decoded.length}`);
const decHex = decoded.map((b) => b.toString(16).padStart(2, "0")).join(" ");
for (let i = 0; i < decoded.length; i += 35) {
  const slice = decoded.slice(i, i + 35);
  const hex = slice.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  +${i.toString().padStart(3, " ")}  ${hex}`);
}

// ----- Find where the "default pattern" runs end exactly -----
// Pattern is: at offset where pattern starts, the byte is one of:
//   {04, 02, 01, 00, 40, 20, 10, 08} in a 8-byte rotating sequence.
// We can test bytes[i+8] === bytes[i] to detect pattern continuation.
console.log(`\n=== Pattern boundary detection ===`);
console.log(`Payload positions where bytes[i] === bytes[i+8] (pattern stride):`);
let runStart = -1;
const patternRuns: Array<{ start: number; end: number; len: number }> = [];
for (let i = 0; i < payload.length - 8; i++) {
  const same = payload[i] === payload[i + 8];
  if (same && runStart === -1) runStart = i;
  if (!same && runStart !== -1) {
    if (i - runStart >= 8) {
      patternRuns.push({ start: runStart, end: i, len: i - runStart });
    }
    runStart = -1;
  }
}
if (runStart !== -1 && payload.length - runStart >= 8) {
  patternRuns.push({ start: runStart, end: payload.length - 8, len: payload.length - 8 - runStart });
}
patternRuns.forEach((r) =>
  console.log(`  pattern run: offset ${r.start}..${r.end} (length ${r.len})`),
);

// Now find the "real data" between pattern runs
console.log(`\nReal-data regions (between pattern runs):`);
patternRuns.forEach((r, idx) => {
  if (idx === 0) {
    if (r.start > 0) {
      const data = payload.slice(0, r.start);
      console.log(`  pre-body 0..${r.start - 1}: ${data.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    }
  } else {
    const prev = patternRuns[idx - 1];
    const data = payload.slice(prev.end + 8, r.start);
    if (data.length > 0) {
      console.log(`  +${prev.end + 8} (${data.length}B): ${data.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    }
  }
});

// Tail (after the last pattern run)
if (patternRuns.length > 0) {
  const last = patternRuns[patternRuns.length - 1];
  const tail = payload.slice(last.end + 8);
  console.log(`  tail (after last pattern, ${tail.length}B):`);
  for (let i = 0; i < tail.length; i += 24) {
    console.log(`    +${(last.end + 8 + i).toString().padStart(3, " ")}  ${tail.slice(i, i + 24).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
}
