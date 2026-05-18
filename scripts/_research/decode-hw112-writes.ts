// HW-112 — decode the two GLOBAL write payloads from session-95 capture.
// Confirms (1) pidLow=0x0001 = GLOBAL, (2) action=0x01 = WRITE, (3) what the
// founder actually toggled on the AM4-Edit Setup pages.

import { unpackValue } from '@mcp-midi-control/core/fractal-shared/packValue.js';

type Write = { frame: number; pidHigh: number; packed: number[] };

const writes: Write[] = [
  { frame:  6117, pidHigh: 99, packed: [0x3d, 0x45, 0x11, 0x63, 0x78] },
  { frame: 11589, pidHigh: 46, packed: [0x00, 0x00, 0x10, 0x03, 0x78] },
];

for (const w of writes) {
  const raw = unpackValue(new Uint8Array(w.packed), 4);
  const hex = [...raw].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const u32 = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
  const f32 = new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
  const internal = u32 / 65534;
  console.log(`Frame ${w.frame}: pidHigh=${w.pidHigh} (paramId)`);
  console.log(`  raw bytes:    ${hex}`);
  console.log(`  as u32 LE:    ${u32} (0x${u32.toString(16)})`);
  console.log(`  /65534:       ${internal}`);
  console.log(`  as f32 LE:    ${f32}`);
  console.log();
}
