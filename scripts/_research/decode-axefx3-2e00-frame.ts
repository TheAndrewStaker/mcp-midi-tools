/**
 * Decode the Axe-Fx III sub-action `2E 00` frame (uncatalogued).
 *
 * Source: passive sniff captured by forum user j20056 (thread #203336),
 * archived in docs/_private/forum-batch-2026-05-16T01-20-21-643Z.txt
 * around line 78 (sequence 651 in the original log).
 *
 * Goal: identify field layout. Hypotheses to test:
 *   H1 — preset-grid snapshot (4×16 block-slot table)
 *   H2 — scene state batch (8 scenes × bypass/channel)
 *   H3 — routing dump (grid cell types + connections)
 *   H4 — modifier map (block × parameter × source)
 *
 * Mechanical analysis only — no hardware, just byte-level.
 */

const FRAME_HEX = `
F0 00 01 74 10 01 2E 00 00 00 00 00 3F 01 00 00 00 00 00 00 05 4B 00 20 00 00 00 00 00 00 00 20 00 00 00 1D 2D 37 10 4A 04 41 01 18 65 30 59 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 00 4C 32 58 2C 42 02 11 4A 6C 30 5E 24 02 69 01 1A 6B 2B 08 06 24 19 2C 40 20 10 08 04 02 01 00 40 20 10 08 00 04 1B 21 5E 72 32 18 2D 42 02 4D 6E 65 36 1B 0E 32 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 00 21 5A 0D 77 13 11 42 6C 10 14 6E 76 2B 31 58 73 10 0B 24 04 41 64 60 30 18 08 04 02 01 00 40 20 10 08 04 00 02 05 70 65 23 16 04 04 6B 3D 48 65 10 0B 24 04 1B 49 6A 6E 31 5A 04 02 01 00 40 20 10 08 04 02 01 00 40 20 00 10 2F 06 2A 19 30 20 26 5B 6C 46 29 00 5A 20 26 19 2C 16 21 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 00 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 00 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 00 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 04 02 01 00 40 20 10 08 00 02 28 00 00 00 14 00 00 00 05 68 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 2E 00 00 20 00 00 00 00 00 5F 40 00 60 00 00 00 00 00 00 00 00 00 00 00 00 00 00 0B 20 00 04 00 00 00 00 00 03 50 00 08 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 24 00 00 40 0C 60 00 10 00 3E 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1B 60 00 08 01 4E 00 01 00 0D 10 00 10 00 46 00 01 00 04 70 00 08 00 21 00 00 40 00 20 08 01 00 00 20 40 10 00 24 04 02 00 16 20 00 20 00 56 00 04 00 00 78 10 40 00 53 00 00 10 01 34 00 02 00 06 20 40 20 00 0C 04 04 00 05 30 00 40 00 03 02 08 00 0B 30 00 02 00 00 00 00 00 00 00 08 04 00 03 40 40 40 00 4C 00 08 00 00 70 21 00 00 2C 00 00 20 00 00 00 00 00 02 01 00 40 03 48 00 08 00 1C 60 01 00 00 0A 04 10 00 00 00 00 00 00 00 00 00 00 07 70 00 38 00 00 00 00 00 00 00 00 00 00 03 00 42 00 00 00 00 00 00 00 00 00 00 00 0A 02 09 00 00 00 00 00 00 00 00 00 00 01 1C 00 00 00 00 00 00 00 00 00 00 00 00 01 30 20 10 00 00 00 00 00 00 00 00 00 00 1B 00 04 00 00 00 00 00 00 00 00 00 00 00 04 04 02 00 00 00 00 00 00 00 00 00 00 06 70 00 40 00 00 00 00 00 00 00 00 00 00 0A 40 02 20 00 00 00 00 00 00 00 00 00 01 3E 00 00 00 00 5C F7
`;

const bytes = FRAME_HEX.trim().split(/\s+/).map((h) => parseInt(h, 16));

console.log(`Total frame bytes: ${bytes.length}`);
console.log(`Payload bytes (between fn and cs): ${bytes.length - 9}`);

// Verify checksum: XOR of F0..last-payload-byte AND 0x7F = byte before F7
let cs = 0;
for (let i = 0; i < bytes.length - 2; i++) cs ^= bytes[i];
cs &= 0x7f;
const expectedCs = bytes[bytes.length - 2];
console.log(
  `Checksum: computed=0x${cs.toString(16).padStart(2, "0")} expected=0x${expectedCs.toString(16).padStart(2, "0")} match=${cs === expectedCs}`,
);

// ----- Header analysis -----
console.log(`\nHeader bytes (pos 0..7):`);
for (let i = 0; i <= 7; i++) {
  console.log(`  pos ${i}: 0x${bytes[i].toString(16).padStart(2, "0")}`);
}

// ----- Payload region (after fn + 2-byte sub-action) -----
const payload = bytes.slice(8, bytes.length - 2);
console.log(`\nPayload region: ${payload.length} bytes`);

// Hex-dump payload in 16-byte rows with offset
console.log(`\nPayload hex dump (offset = bytes after pos 8):`);
for (let i = 0; i < payload.length; i += 16) {
  const row = payload.slice(i, i + 16);
  const hex = row.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const offHex = i.toString(16).padStart(3, "0");
  const offDec = i.toString().padStart(3, " ");
  console.log(`  +${offHex} (${offDec})  ${hex}`);
}

// ----- Run-length analysis: find repeated patterns -----
console.log(`\n--- Pattern: 4-byte sliding window repeats ---`);
const patternHits = new Map<string, number[]>();
for (let i = 0; i <= payload.length - 4; i++) {
  const key = payload
    .slice(i, i + 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (!patternHits.has(key)) patternHits.set(key, []);
  patternHits.get(key)!.push(i);
}
const repeated = [...patternHits.entries()].filter(([, v]) => v.length >= 2);
repeated
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10)
  .forEach(([key, positions]) => {
    console.log(`  ${key}: ${positions.length}× at offsets [${positions.join(", ")}]`);
  });

// ----- Look at the dominant repeating pattern: `04 02 01 00 40 20 10 08` -----
// This 8-byte pattern smells like a right-shift bit-pack: each byte is
// the previous shifted right by 1, then wrapping. Specifically:
//   04 = 0000 0100
//   02 = 0000 0010
//   01 = 0000 0001
//   00 = 0000 0000 (would be 80, but high bit reserved in SysEx)
//   40 = 0100 0000  ← would be the "low bit shifted out, top bit shifted in"
//   20 = 0010 0000
//   10 = 0001 0000
//   08 = 0000 1000
// So the pattern is a 1-bit walking pattern with a phase shift at byte 4.
// This is the 7-bit septet representation of "all-zero" bits! When you
// pack 56 bits (8 bytes × 7 = 56 useful) where ONE bit per 8-byte group
// is set, you get exactly this pattern. Position of the 1-bit:
//   byte 0 bit 2 (04) → bit  2 in 7-bit
//   byte 1 bit 1 (02) → bit  9
//   byte 2 bit 0 (01) → bit 16
//   byte 3 bit ? (00) → bit ?
//   byte 4 bit 6 (40) → bit ?
//
// Actually re-read: this looks more like an UNPACK ARTIFACT — when you
// have a long sequence of zero data bytes (8-bit), pack them into
// 7-bit septets, the septet-packer reads 7 bits at a time from an
// "all-zero" stream and emits 0x00 for each. But the seventh byte holds
// the high bits of 7 source bytes, so the pattern only fits "all zero"
// when the 8th byte (the bit-collector) gives `00`.
//
// Wait — the pattern is repeated as a constant non-zero envelope. That
// means it's an UNDERLYING BIT PATTERN encoded into septets. Let me
// reverse the septet packing:
//
//   bytes [04 02 01 00 40 20 10 08] = 8 bytes
//   8-byte septet-encoded → 7-byte raw
//   Decoded value (LS-first, byte 0 = bits 6..0 of source byte 0):
//     04 02 01 00 40 20 10 08 ⇒ check bit pattern

function septetDecode(input: number[]): number[] {
  // Convert 7-bit-MSB-cleared bytes back to 8-bit data.
  // Standard scheme: in groups of 8 input bytes, byte[7] holds the
  // high bits of byte[0..6]. Result: 7 output bytes per 8 input.
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 8) {
    const group = input.slice(i, i + 8);
    if (group.length < 2) break;
    const high = group[0]; // MS-first variant: first byte is the high-bit collector
    // We don't know which variant Fractal uses — try both.
    for (let j = 1; j < group.length; j++) {
      const dataByte = group[j];
      const highBit = ((high >> (j - 1)) & 1) << 7;
      out.push(dataByte | highBit);
    }
  }
  return out;
}

function septetDecodeLSF(input: number[]): number[] {
  // LS-first variant: byte[7] holds high bits of byte[0..6]
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

console.log(`\n--- 8→7 septet decode (high-bit first variant) ---`);
const decodedHF = septetDecode(payload);
console.log(`Decoded length: ${decodedHF.length}`);
const decHfHex = decodedHF.map((b) => b.toString(16).padStart(2, "0")).join(" ");
console.log(`Decoded (first 64): ${decHfHex.slice(0, 64 * 3)}`);

console.log(`\n--- 8→7 septet decode (high-bit last variant) ---`);
const decodedLSF = septetDecodeLSF(payload);
console.log(`Decoded length: ${decodedLSF.length}`);
const decLsfHex = decodedLSF.map((b) => b.toString(16).padStart(2, "0")).join(" ");
console.log(`Decoded (first 64): ${decLsfHex.slice(0, 64 * 3)}`);

// ----- Zero-run analysis -----
console.log(`\n--- Zero-run analysis on raw payload ---`);
let runStart = -1;
const zeroRuns: Array<{ start: number; length: number }> = [];
for (let i = 0; i < payload.length; i++) {
  if (payload[i] === 0) {
    if (runStart === -1) runStart = i;
  } else if (runStart !== -1) {
    zeroRuns.push({ start: runStart, length: i - runStart });
    runStart = -1;
  }
}
if (runStart !== -1) zeroRuns.push({ start: runStart, length: payload.length - runStart });
zeroRuns.sort((a, b) => b.length - a.length);
console.log(`Top 10 zero runs:`);
zeroRuns.slice(0, 10).forEach((r) => {
  console.log(`  start=${r.start} length=${r.length}`);
});

// ----- Non-zero density per 16-byte row -----
console.log(`\n--- Non-zero density per 16-byte row ---`);
for (let i = 0; i < payload.length; i += 16) {
  const row = payload.slice(i, i + 16);
  const nz = row.filter((b) => b !== 0).length;
  const bar = "#".repeat(nz);
  console.log(`  row +${i.toString(16).padStart(3, "0")}  nz=${nz.toString().padStart(2, " ")}  ${bar}`);
}
