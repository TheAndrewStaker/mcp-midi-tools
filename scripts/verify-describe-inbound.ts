/**
 * Verify `describeAm4InboundMessage` returns sensible labels for the
 * AM4 inbound SysEx envelopes the server actually observes — write
 * echoes, command-acks, NACKs, mode-switch acks, and a few non-AM4
 * fallbacks. Pure unit-style assertions; no hardware required.
 *
 * Why this matters: the inbound-capture timeline that `apply_preset` /
 * `set_param` / `save_to_location` / `am4_test_navigate` print at the
 * end of their responses pipes every observed message through this
 * decoder. A regression here would silently degrade diagnostic output
 * for every tool that surfaces inbound MIDI.
 *
 * Run:  npx tsx scripts/verify-describe-inbound.ts
 */

import { describeAm4InboundMessage } from '@/fractal/am4/midi.js';

function bytes(hex: string): number[] {
  const stripped = hex.replace(/\s+/g, '');
  const out: number[] = [];
  for (let i = 0; i < stripped.length; i += 2) out.push(parseInt(stripped.slice(i, i + 2), 16));
  return out;
}

interface Case {
  label: string;
  input: number[];
  /** Substring expected in the description (case-sensitive). */
  expectContains: string;
}

const cases: Case[] = [
  {
    // Session 19 capture — 64-byte SET_PARAM write echo for amp.gain=6.
    // Distinguished from the 23-byte receipt-echo by hdr4=0x0028.
    label: '64-byte SET_PARAM write echo (amp.gain=6, A01 capture)',
    input: bytes(
      'f000017415013a000b000100000028004c262313794e32191f4d4563' +
      '014000000000000000000000000000000000000000000000000000000000' +
      '000000007af7',
    ),
    expectContains: 'SET_PARAM write echo',
  },
  {
    // SYSEX-MAP §6g — 18-byte save-to-location command-ack.
    // Action 0x001B = SAVE_TO_LOCATION.
    label: '18-byte Save ACK (action=0x001B)',
    // SYSEX-MAP §6g canonical capture:
    // F0 00 01 74 15 01 [00 00] [00 00] [1B 00] 00 00 00 00 0A F7
    //                   pidLow  pidHigh action  hdr4+pad  cs end
    input: bytes('f0 00 01 74 15 01 00 00 00 00 1b 00 00 00 00 00 0a f7'),
    expectContains: 'Save ACK',
  },
  {
    // SYSEX-MAP §6g — 18-byte preset-rename command-ack. pidLow=0x00CE
    // pidHigh=0x000B action=0x000C.
    label: '18-byte Preset Rename ACK (action=0x000C)',
    input: bytes('f000017415014e010b000c000000000000 59 f7'),
    expectContains: 'Rename ACK',
  },
  {
    // SYSEX-MAP §6 0x64 MULTIPURPOSE_RESPONSE — NACK for 0x0F GET_PRESET_NAME.
    label: '0x64 MULTIPURPOSE_RESPONSE NACK rc=0x05 for 0x0F',
    input: bytes('f000017415640f057ef7'),
    expectContains: 'NACK rc=0x05',
  },
  {
    // 0x64 MULTIPURPOSE_RESPONSE OK for 0x12 mode switch.
    label: '0x64 MULTIPURPOSE_RESPONSE OK for 0x12',
    input: bytes('f0000174156412 00 76f7'),
    expectContains: 'OK',
  },
  {
    // SYSEX-MAP §6 — 0x14 GET_PRESET_NUMBER response, slot 0 (A01).
    label: '0x14 Preset Number response (slot 0)',
    input: bytes('f00001741514000004f7'),
    expectContains: 'slot=0',
  },
  {
    // 0x14 with non-zero slot — 14-bit decode (low first then high).
    // slot 5: PP=0x05 QQ=0x00.
    label: '0x14 Preset Number response (slot 5)',
    input: bytes('f0000174151405 00 06 f7'),
    expectContains: 'slot=5',
  },
  {
    // 0x08 firmware response — payload starts MAJ MIN R1..R5 + ASCII date.
    // We only label the version pair.
    label: '0x08 Firmware version response (v2.00)',
    input: bytes('f000017415080200030405000067f7'),
    expectContains: 'v2.0',
  },
  {
    // Unknown function byte — still labelled with the raw fn so logs are
    // searchable by hex.
    label: 'Unknown function 0x42 — graceful fallback',
    input: bytes('f0000174154200 12 f7'),
    expectContains: 'function 0x42',
  },
  {
    // Non-SysEx CC — server should still describe it (PC echoes during
    // bank/preset navigation surface here).
    label: 'CC ch=1 #7=64 (non-SysEx fallback)',
    input: [0xb0, 0x07, 0x40],
    expectContains: 'CC ch=1',
  },
  {
    // Non-AM4 SysEx — preserves bytes for log searchability.
    label: 'non-AM4 SysEx (different manufacturer)',
    input: bytes('f07e7f060105f7'),
    expectContains: 'non-AM4 SysEx',
  },
  {
    // Truncated SysEx (no F7 terminator) — common in malformed captures.
    label: 'Truncated SysEx (missing F7)',
    input: bytes('f000017415 01 00'),
    expectContains: 'truncated',
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const actual = describeAm4InboundMessage(c.input);
  if (actual.includes(c.expectContains)) {
    console.log(`✓ ${c.label} → "${actual}"`);
    pass++;
  } else {
    console.error(`✗ ${c.label}`);
    console.error(`    expected to contain: "${c.expectContains}"`);
    console.error(`    got:                 "${actual}"`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} cases pass.`);
if (fail > 0) {
  process.exitCode = 1;
}
