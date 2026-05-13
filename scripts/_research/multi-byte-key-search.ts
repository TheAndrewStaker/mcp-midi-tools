/**
 * Search AM4-Edit.exe for known labels under multi-byte XOR keys and
 * reversed-byte / nibble-flipped variants. Single-byte XOR/Caesar were
 * already ruled out; these are the next-cheapest encoding hypotheses
 * before going to Frida.
 */

import { readFileSync } from 'node:fs';

const exe = readFileSync('C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe');

const TARGETS = ['Bright Cap', 'Saturation Drive', 'Negative Feedback', 'High Treble'];

// 1. Common multi-byte XOR keys (recurring patterns in audio software)
const KEYS_HEX = [
  '46726163', // "Frac"
  '46726163 74616c', // "Fractal"
  '414d3445 64697420', // "AM4Edit "
  '20202020', // 4 spaces (common pattern in lazy XOR)
  '01010101',
  '7f7f7f7f',
  '55aa55aa', // alternating
  'aa55aa55',
  'deadbeef',
  '12345678',
  '89abcdef',
  // Try byte sequences starting with a single common XOR
  '02', '03', '04', '07', '0a', '10', '20', '7f', '80', 'a5',
];

function applyXorKey(s: string, keyBytes: Buffer): Buffer {
  const out = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

function searchExe(needle: Buffer, max = 3): number[] {
  const out: number[] = [];
  let pos = 0;
  while (pos < exe.length - needle.length) {
    const idx = exe.indexOf(needle, pos);
    if (idx < 0) break;
    out.push(idx);
    pos = idx + 1;
    if (out.length >= max) break;
  }
  return out;
}

console.log('=== multi-byte XOR keys ===');
for (const target of TARGETS) {
  console.log(`\n"${target}":`);
  let any = false;
  for (const keyHex of KEYS_HEX) {
    const keyBytes = Buffer.from(keyHex.replaceAll(' ', ''), 'hex');
    const enc = applyXorKey(target, keyBytes);
    const hits = searchExe(enc);
    if (hits.length > 0) {
      any = true;
      console.log(`  XOR with "${keyHex}":  ${hits.length} hits  ${hits.map(h => '0x' + h.toString(16)).join(', ')}`);
    }
  }
  if (!any) console.log(`  no multi-byte XOR matches.`);
}

// 2. Reversed bytes
console.log('\n=== reversed-byte search ===');
for (const target of TARGETS) {
  const reversed = Buffer.from([...Buffer.from(target, 'ascii')].reverse());
  const hits = searchExe(reversed);
  if (hits.length > 0) {
    console.log(`"${target}" reversed: ${hits.length} hits  ${hits.map(h => '0x' + h.toString(16)).join(', ')}`);
  } else {
    console.log(`"${target}" reversed: no hits`);
  }
}

// 3. Nibble-swapped (each byte's high/low nibbles flipped — uncommon but cheap)
console.log('\n=== nibble-swapped search ===');
for (const target of TARGETS) {
  const enc = Buffer.alloc(target.length);
  for (let i = 0; i < target.length; i++) {
    const c = target.charCodeAt(i);
    enc[i] = ((c & 0x0f) << 4) | ((c & 0xf0) >> 4);
  }
  const hits = searchExe(enc);
  console.log(`"${target}" nibble-swap: ${hits.length} hits${hits.length > 0 ? ' [' + hits.map(h => '0x' + h.toString(16)).join(', ') + ']' : ''}`);
}

// 4. Bit-not (~bytes)
console.log('\n=== bitwise-not search ===');
for (const target of TARGETS) {
  const enc = Buffer.alloc(target.length);
  for (let i = 0; i < target.length; i++) enc[i] = (~target.charCodeAt(i)) & 0xff;
  const hits = searchExe(enc);
  console.log(`"${target}" ~bytes: ${hits.length} hits${hits.length > 0 ? ' [' + hits.map(h => '0x' + h.toString(16)).join(', ') + ']' : ''}`);
}

// 5. ROT-byte: each byte rotated left N bits
console.log('\n=== bit-rotation search ===');
for (const target of TARGETS) {
  for (let rot = 1; rot < 8; rot++) {
    const enc = Buffer.alloc(target.length);
    for (let i = 0; i < target.length; i++) {
      const c = target.charCodeAt(i);
      enc[i] = ((c << rot) | (c >> (8 - rot))) & 0xff;
    }
    const hits = searchExe(enc);
    if (hits.length > 0) {
      console.log(`"${target}" rotL${rot}: ${hits.length} hits  [${hits.map(h => '0x' + h.toString(16)).join(', ')}]`);
    }
  }
}

// 6. SUM-with-position (each char = c + i * k for some k)
console.log('\n=== position-add encoding ===');
for (const target of TARGETS) {
  for (let k = 1; k <= 16; k++) {
    const enc = Buffer.alloc(target.length);
    let ok = true;
    for (let i = 0; i < target.length; i++) {
      const v = target.charCodeAt(i) + i * k;
      if (v > 255) { ok = false; break; }
      enc[i] = v;
    }
    if (!ok) continue;
    const hits = searchExe(enc);
    if (hits.length > 0) {
      console.log(`"${target}" pos+${k}*i: ${hits.length} hits  [${hits.map(h => '0x' + h.toString(16)).join(', ')}]`);
    }
  }
}
