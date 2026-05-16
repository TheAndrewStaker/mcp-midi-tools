/**
 * Goldens for `createSysExAssembler` in packages/core/src/midi/transport.ts.
 *
 * Why this exists. node-midi's WinMM backend (RtMidi.cpp:2538-2582)
 * fires the `message` event once per MIM_LONGDATA buffer (1024 bytes
 * each on Windows), then clears its accumulator. A 3082-byte AM4
 * preset-dump chunk arrives as 3-4 separate fragments, which made
 * `assertDumpMessageShape` throw "expected 3082 bytes, got 1024 /
 * 2048" and silently failed the working-buffer dirty gate. The
 * assembler glues fragments at the inbound seam so downstream parsers
 * see one F0…F7 message per emit, the contract everything assumes.
 *
 * These goldens run in `npm test`. No hardware needed.
 */

import { createSysExAssembler } from '../packages/core/src/midi/transport.js';

type Case = {
  name: string;
  fragments: number[][];
  expected: number[][];
};

function buildFragmentedSysex(payloadLen: number, fragSize: number): number[][] {
  // F0 .. payload .. F7. Payload bytes are an ascending counter mod 128
  // so we'd notice any byte-shuffling.
  const total: number[] = [0xf0];
  for (let i = 0; i < payloadLen; i++) total.push(i & 0x7f);
  total.push(0xf7);
  const frags: number[][] = [];
  for (let i = 0; i < total.length; i += fragSize) {
    frags.push(total.slice(i, i + fragSize));
  }
  return frags;
}

function reassembledLength(frags: number[][]): number {
  return frags.reduce((n, f) => n + f.length, 0);
}

const cases: Case[] = [
  {
    name: 'single-fragment complete SysEx passes through unchanged',
    fragments: [[0xf0, 0x00, 0x01, 0x74, 0x15, 0x77, 0x7f, 0xf7]],
    expected: [[0xf0, 0x00, 0x01, 0x74, 0x15, 0x77, 0x7f, 0xf7]],
  },
  {
    name: 'short MIDI (CC) passes through unchanged',
    fragments: [[0xb0, 0x07, 0x40]],
    expected: [[0xb0, 0x07, 0x40]],
  },
  {
    // The actual production case. RT_SYSEX_BUFFER_SIZE = 1024.
    name: 'AM4 0x78 chunk (3082 bytes, 4 fragments of ≤1024 bytes)',
    fragments: buildFragmentedSysex(3080, 1024),
    expected: [(() => {
      const m = buildFragmentedSysex(3080, 1024);
      return m.flat();
    })()],
  },
  {
    name: '2KB SysEx split across 2 fragments',
    fragments: buildFragmentedSysex(2046, 1024),
    expected: [(() => {
      const m = buildFragmentedSysex(2046, 1024);
      return m.flat();
    })()],
  },
  {
    name: 'two complete short SysEx back-to-back, each in its own fragment',
    fragments: [
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x10, 0x10, 0xf7],
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x10, 0x20, 0xf7],
    ],
    expected: [
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x10, 0x10, 0xf7],
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x10, 0x20, 0xf7],
    ],
  },
  {
    name: 'short MIDI interleaved before SysEx — both delivered',
    fragments: [
      [0xc0, 0x05],
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x77, 0xf7],
    ],
    expected: [
      [0xc0, 0x05],
      [0xf0, 0x00, 0x01, 0x74, 0x15, 0x77, 0xf7],
    ],
  },
  {
    name: 'empty fragment is dropped silently',
    fragments: [[], [0xf0, 0x00, 0xf7]],
    expected: [[0xf0, 0x00, 0xf7]],
  },
];

let failed = 0;
for (const c of cases) {
  const collected: number[][] = [];
  const assemble = createSysExAssembler((bytes) => {
    collected.push(bytes);
  });
  for (const frag of c.fragments) assemble(frag);

  const ok =
    collected.length === c.expected.length &&
    collected.every(
      (got, i) =>
        got.length === c.expected[i].length &&
        got.every((b, j) => b === c.expected[i][j]),
    );

  if (ok) {
    const totalLen = reassembledLength(collected);
    console.log(`  PASS  ${c.name}  (${collected.length} message(s), ${totalLen} bytes)`);
  } else {
    failed++;
    console.error(`  FAIL  ${c.name}`);
    console.error(`    expected: ${c.expected.length} message(s), lengths [${c.expected.map((m) => m.length).join(', ')}]`);
    console.error(`    got:      ${collected.length} message(s), lengths [${collected.map((m) => m.length).join(', ')}]`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${cases.length} sysex-assembler cases failed`);
  process.exit(1);
}
console.log(`\nverify-sysex-assembler: ${cases.length}/${cases.length} cases passed`);
