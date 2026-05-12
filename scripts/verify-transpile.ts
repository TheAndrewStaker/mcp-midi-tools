/**
 * Verify the IR transpiler emits one correct SET_PARAM message per entry.
 * Run:  npx tsx scripts/verify-transpile.ts
 */
import { buildSetParam } from '@/fractal/am4/setParam.js';
import { transpile } from '@/fractal/am4/ir/transpile.js';
import type { WorkingBufferIR } from '@/fractal/am4/ir/preset.js';

function hex(arr: number[]): string {
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ir: WorkingBufferIR = {
  params: {
    'amp.gain': 7.5,
    'amp.bass': 6,
    'reverb.mix': 30,
  },
};

const got = transpile(ir);
const expected = [
  buildSetParam('amp.gain', 7.5),
  buildSetParam('amp.bass', 6),
  buildSetParam('reverb.mix', 30),
];

let pass = 0;
const total = expected.length;

if (got.length !== total) {
  console.log(`✗ Expected ${total} messages, got ${got.length}`);
  process.exit(1);
}

for (let i = 0; i < total; i++) {
  const ok = hex(got[i]) === hex(expected[i]);
  if (ok) pass++;
  console.log(`message ${i}: ${ok ? '✓ MATCH' : '✗ MISMATCH'}`);
  console.log(`  got     : ${hex(got[i])}`);
  console.log(`  expected: ${hex(expected[i])}`);
}

console.log(`\n${pass}/${total} messages match.`);

// Independent sanity: amp.bass=6 must equal the captured AM4-Edit write.
const captured = 'f000017415013a000c000100000004004d2623137801f7';
const bass = hex(got[1]);
const captureOk = bass === captured;
console.log(
  `\namp.bass=6 vs captured wire bytes: ${captureOk ? '✓ MATCH' : '✗ MISMATCH'}`,
);
if (!captureOk) {
  console.log(`  got     : ${bass}`);
  console.log(`  captured: ${captured}`);
}

process.exit(pass === total && captureOk ? 0 : 1);
