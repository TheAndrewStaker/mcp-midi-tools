/**
 * Verify that the OUT-side 5-byte packed tails in the launch capture
 * unpack to u32 LE = 0..103 in arrival order. Confirms the OUT request
 * shape for `am4_get_preset_name(location)`.
 */

import { unpackValue, packValue } from 'fractal-midi/shared';

// First 8 captured tails (frames 45,49,53,57,61,65,69,73 — index 0..7).
const tails = [
  [0x00, 0x00, 0x00, 0x00, 0x00], // index 0
  [0x00, 0x40, 0x00, 0x00, 0x00], // index 1
  [0x01, 0x00, 0x00, 0x00, 0x00], // index 2
  [0x01, 0x40, 0x00, 0x00, 0x00], // index 3
  [0x02, 0x00, 0x00, 0x00, 0x00], // index 4
  [0x02, 0x40, 0x00, 0x00, 0x00], // index 5
  [0x03, 0x00, 0x00, 0x00, 0x00], // index 6
  [0x03, 0x40, 0x00, 0x00, 0x00], // index 7
];

console.log('OUT tail decode → u32 LE location index:');
for (let i = 0; i < tails.length; i++) {
  const raw = unpackValue(new Uint8Array(tails[i]), 4);
  const u32 = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
  console.log(`  i=${i} tail=[${tails[i].map(b => b.toString(16).padStart(2, '0')).join(' ')}] → raw=[${Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join(' ')}] → u32=${u32}  ${u32 === i ? 'OK' : 'MISMATCH'}`);
}

// Now show the complete OUT message we'd build to read location 0 (A01).
function buildSep14(value: number): [number, number] { return [value & 0x7f, (value >> 7) & 0x7f]; }

function buildGetPresetName(location: number): number[] {
  const PIDLOW_NAME = 0x00CE;
  const PIDHIGH_NAME = 0x000B;
  const ACTION_READ_NAME = 0x0012;
  const HDR3 = 0x0000;
  const HDR4 = 0x0004;
  const u32 = new Uint8Array(4);
  new DataView(u32.buffer).setUint32(0, location, true);
  const packed = packValue(u32);
  const body = [
    0x15, // model
    0x01, // function (PARAM_RW)
    ...buildSep14(PIDLOW_NAME),
    ...buildSep14(PIDHIGH_NAME),
    ...buildSep14(ACTION_READ_NAME),
    ...buildSep14(HDR3),
    ...buildSep14(HDR4),
    ...Array.from(packed),
  ];
  // Fractal checksum: XOR of all bytes from 0xF0 through last body byte, & 0x7F.
  const all = [0xF0, 0x00, 0x01, 0x74, ...body];
  const cs = all.reduce((a, b) => a ^ b, 0) & 0x7f;
  return [0xF0, 0x00, 0x01, 0x74, ...body, cs, 0xF7];
}

console.log('\nBuilt example messages:');
for (const loc of [0, 1, 103]) {
  const msg = buildGetPresetName(loc);
  console.log(`  loc=${loc.toString().padStart(3, ' ')} (${msg.length} bytes): ${msg.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
}
