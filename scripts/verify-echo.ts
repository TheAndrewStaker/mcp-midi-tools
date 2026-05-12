/**
 * Verify `isWriteEcho` matches real captured device echoes and rejects
 * non-echo traffic. The byte sequences below come from
 * samples/captured/session-18-read-response-gain-a01.pcapng — the A01
 * capture where amp.gain was set to 6.0 via the hardware encoder.
 *
 * Why this matters: the server uses `isWriteEcho` to decide whether a
 * write to a placed block succeeded vs. was silently absorbed by the
 * device. A regression here would turn "write confirmed" into "write
 * lost" or vice versa — unit-testing it against real bytes is the only
 * way to catch that without hardware in the loop.
 *
 * Run:  npx tsx scripts/verify-echo.ts
 */

import { buildSetParam, isWriteEcho } from '@/fractal/am4/setParam.js';

function bytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// The canonical write we built: set amp.gain = 6 (internal 0.6).
const writeAmpGain6 = buildSetParam('amp.gain', 6);

interface Case {
  label: string;
  write: number[];
  response: number[];
  expected: boolean;
}

const cases: Case[] = [
  {
    label: '64-byte device echo (A01 capture, amp.gain write) — ACCEPT',
    write: writeAmpGain6,
    response: bytes(
      'f000017415013a000b000100000028004c262313794e32191f4d4563' +
      '014000000000000000000000000000000000000000000000000000000000' +
      '000000007af7',
    ),
    expected: true,
  },
  {
    label: '23-byte receipt-echo of our own write (hdr4=0x0004) — REJECT',
    // Session 19 hardware test: this frame appears on the input port even
    // when the target block is absent from the active preset (the write was
    // silently absorbed). Byte-identical to `buildSetParam('amp.gain', 6)`.
    // Treating it as success caused four confirmed false-positives against
    // live hardware before the fix.
    write: writeAmpGain6,
    response: bytes('f000017415013a000b000100000004004d2623137806f7'),
    expected: false,
  },
  {
    label: '23-byte receipt-echo of an absorbed reverb.type=Ambience write — REJECT',
    // Captured in the same Session 19 hardware test, different block/param:
    // reverb.type=21 (Ambience) sent to a preset with no reverb block placed.
    // The response was byte-identical to the outgoing write (same class of
    // receipt-echo as the amp.gain case above) — we assert the general
    // property "an outgoing write reflected back is not an apply-echo".
    write: buildSetParam('reverb.type', 21),
    response: buildSetParam('reverb.type', 21),
    expected: false,
  },
  {
    label: '23-byte AM4-Edit status poll response (action=0x0026) — REJECT',
    write: writeAmpGain6,
    response: bytes('f000017415013a000b00260000000400000000000002f7'),
    expected: false,
  },
  {
    label: 'Different pidHigh (amp.bass echo) — REJECT',
    write: writeAmpGain6,
    response: bytes('f000017415013a000c000100000004004d2623137801f7'),
    expected: false,
  },
  {
    label: 'Different pidLow (reverb echo) — REJECT',
    write: writeAmpGain6,
    response: bytes('f00001741501420001000100000004004d263313706cf7'),
    expected: false,
  },
  {
    label: 'Wrong manufacturer prefix — REJECT',
    write: writeAmpGain6,
    response: bytes('f07e7f060200000000000000f7'),
    expected: false,
  },
  {
    label: 'Too-short message (no room for header) — REJECT',
    write: writeAmpGain6,
    response: bytes('f000017415f7'),
    expected: false,
  },
];

let pass = 0;
for (const c of cases) {
  const got = isWriteEcho(c.write, c.response);
  const ok = got === c.expected;
  if (ok) pass++;
  const status = ok ? '✓' : '✗';
  console.log(`${status} ${c.label}`);
  if (!ok) {
    console.log(`  expected=${c.expected}, got=${got}`);
  }
}
console.log(`\n${pass}/${cases.length} echo-predicate cases pass.`);
process.exit(pass === cases.length ? 0 : 1);
