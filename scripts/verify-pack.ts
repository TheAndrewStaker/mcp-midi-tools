/**
 * MCP MIDI Tools — Verify the cracked SET_PARAM encoding
 *
 * Hypothesis (from Ghidra reverse-engineering of FUN_140156d10 / FUN_140156af0
 * in AM4-Edit.exe, session 05): the value field is a standard sliding-window
 * 8-to-7 bit-pack of the IEEE 754 little-endian float bytes. 4 input bytes
 * become 5 wire septets (each with bit 7 = 0).
 *
 * Two prior errors corrected here:
 *   1. Wire value field is 5 bytes, not 6. The leading "00" we saw belonged
 *      to the 5th 14-bit header field (byte count = 0x0004 = bytes "04 00").
 *   2. The displayed parameter value is not the internal float — there's a
 *      per-parameter scale (Amp Gain ×0.1, EQ band ÷12 dB, ...).
 */

function packValue(rawBytes: Uint8Array): Uint8Array {
  // Sliding 8-to-7 pack: N input bytes → N+1 wire septets.
  // Each iteration k=1..N: extract high (8-k) bits to current wire byte
  // (OR'd with carry from prev), save low k bits as carry to next.
  const out = new Uint8Array(rawBytes.length + 1);
  let carry = 0;
  for (let i = 0; i < rawBytes.length; i++) {
    const k = i + 1;
    const b = rawBytes[i];
    out[i] = (((b >> k) & 0x7f) | carry) & 0x7f;
    carry = ((~(0x7f << k) & b) << (7 - k)) & 0x7f;
  }
  out[rawBytes.length] = carry;
  return out;
}

function unpackValue(wire: Uint8Array, rawLen: number): Uint8Array {
  // Inverse of packValue: N+1 wire septets → N raw bytes.
  const out = new Uint8Array(rawLen);
  let carry = 0;
  for (let i = 0; i < wire.length; i++) {
    const k = i + 1;
    const b = wire[i] & 0x7f;
    if (i > 0) out[i - 1] |= ((~(0x7f >> k) & b) >> (8 - k)) & 0xff;
    if (i < rawLen) out[i] = (b << k) & 0xff;
  }
  return out;
}

function packFloat32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return packValue(new Uint8Array(buf));
}

function unpackFloat32LE(wire: Uint8Array): number {
  const raw = unpackValue(wire, 4);
  return new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
}

function hex(b: Uint8Array | number[]): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

// All 10 captured (displayed_value, internal_scale_factor, wire_5_bytes)
// from sessions 04 and 05. The "wire" column is bytes 16..20 of the
// 23-byte SET_PARAM message (the 5 packed value bytes — NOT the leading
// "00" which belongs to the count header field).
type Sample = { label: string; displayed: number; scale: number; wire: number[] };

const SAMPLES: Sample[] = [
  // Amp Gain (param @ field0=0x3A, field1=0x0B). Internal scale = displayed / 10.
  { label: 'AmpGain 0.0',  displayed: 0.0,  scale: 0.1, wire: [0x00, 0x00, 0x00, 0x00, 0x00] },
  { label: 'AmpGain 0.25', displayed: 0.25, scale: 0.1, wire: [0x66, 0x73, 0x19, 0x43, 0x60] },
  { label: 'AmpGain 0.5',  displayed: 0.5,  scale: 0.1, wire: [0x66, 0x73, 0x09, 0x43, 0x68] },
  { label: 'AmpGain 1.0',  displayed: 1.0,  scale: 0.1, wire: [0x66, 0x73, 0x19, 0x43, 0x68] },
  { label: 'AmpGain 1.5',  displayed: 1.5,  scale: 0.1, wire: [0x4d, 0x26, 0x23, 0x13, 0x70] },
  { label: 'AmpGain 2.0',  displayed: 2.0,  scale: 0.1, wire: [0x66, 0x73, 0x09, 0x43, 0x70] },
  { label: 'AmpGain 2.5',  displayed: 2.5,  scale: 0.1, wire: [0x00, 0x00, 0x10, 0x03, 0x70] },
  { label: 'AmpGain 3.0',  displayed: 3.0,  scale: 0.1, wire: [0x4d, 0x26, 0x33, 0x13, 0x70] },
  { label: 'AmpGain 4.0',  displayed: 4.0,  scale: 0.1, wire: [0x66, 0x73, 0x19, 0x43, 0x70] },
  // EQ band 1 gain (different parameter address). Internal scale guessed at -1/12 dB.
  { label: 'EQ -1.0 dB',   displayed: -1.0, scale: 1 / 12, wire: [0x55, 0x6a, 0x55, 0x2b, 0x68] },
];

let passed = 0;
let failed = 0;

console.log('=== Pack verification (encode displayed × scale → wire) ===');
for (const s of SAMPLES) {
  const internal = s.displayed * s.scale;
  const got = packFloat32LE(internal);
  const expected = new Uint8Array(s.wire);
  const ok = got.length === expected.length && got.every((b, i) => b === expected[i]);
  if (ok) passed++; else failed++;
  console.log(
    `  ${s.label.padEnd(18)} internal=${internal.toFixed(6).padStart(10)}  ` +
    `expect [${hex(expected)}]  got [${hex(got)}]  ${ok ? 'OK' : 'FAIL'}`
  );
}
console.log(`\nPack: ${passed}/${passed + failed} samples match.`);

console.log('\n=== Unpack verification (wire → internal float) ===');
let upPass = 0;
let upFail = 0;
for (const s of SAMPLES) {
  const internal = unpackFloat32LE(new Uint8Array(s.wire));
  const expected = s.displayed * s.scale;
  const ok = Math.abs(internal - expected) < 1e-6;
  if (ok) upPass++; else upFail++;
  console.log(
    `  ${s.label.padEnd(18)} expected=${expected.toFixed(6).padStart(10)}  ` +
    `got=${internal.toFixed(6).padStart(10)}  ${ok ? 'OK' : 'FAIL'}`
  );
}
console.log(`\nUnpack: ${upPass}/${upPass + upFail} samples match.\n`);

if (failed === 0 && upFail === 0) {
  console.log('🎯 Encoding fully verified. Ready to build setParam.');
} else {
  console.log('❌ Verification failed. Do not proceed to setParam build.');
  process.exit(1);
}
