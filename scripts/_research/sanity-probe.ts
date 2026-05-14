/**
 * HW-046 — Q16 denominator sanity probe (HW-044 follow-up).
 *
 * HW-044 (Session 42) decoded the 0x01 / readType=0x0E read-response
 * shape: 5 packed-septet bytes after `hdr4=0x0004`, unpack to 4 raw
 * bytes, interpret as u32 LE. Two interpretations remain consistent
 * with the single knob sample we have (amp.gain = 3.00 → u32 19660):
 *
 *   - Q16 with 65535 denominator: displayValue = u32 / 65535 × scale
 *   - Q16 with 65536 denominator: displayValue = u32 / 65536 × scale
 *
 * Both fit 19660 to within rounding. To disambiguate (and to confirm
 * the rule across multiple knob positions), this script reads three
 * knob_0_10 params on the amp block. Founder reads each value off the
 * AM4 display (or AM4-Edit's Basic page) and reports them; we decode
 * and pick the formula that matches all three byte-exact.
 *
 * Capture procedure (founder-side):
 *   1. AM4 connected via USB. AM4-Edit must NOT be open (it polls).
 *   2. Note current display values for amp.bass / amp.mid /
 *      amp.treble. Best if they're three *different* non-zero, non-
 *      extreme values (e.g. 4.0, 6.5, 7.5) — round numbers (5.0) are
 *      OK but multiple distinct values disambiguate the rule faster.
 *   3. Start USBPcap on the AM4's USB endpoint, save to
 *      `samples/captured/session-NN-q16sanity.pcapng`.
 *   4. Run `npm run sanity-probe` (or `npx tsx scripts/sanity-probe.ts`).
 *   5. Stop the capture.
 *   6. Signal "HW-046 done" + saved path + the three display values.
 */
import { connectAM4, describeAm4InboundMessage, toHex } from '@mcp-midi-control/am4/midi.js';
import { buildReadParam } from '@mcp-midi-control/am4/setParam.js';

interface ReadTarget {
  label: string;
  pidLow: number;
  pidHigh: number;
}

const READS: ReadTarget[] = [
  { label: 'amp.bass   (0x003A / 0x000C)', pidLow: 0x003a, pidHigh: 0x000c },
  { label: 'amp.mid    (0x003A / 0x000D)', pidLow: 0x003a, pidHigh: 0x000d },
  { label: 'amp.treble (0x003A / 0x000E)', pidLow: 0x003a, pidHigh: 0x000e },
];

const RESPONSE_WINDOW_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('=== HW-046 Q16 sanity probe ===\n');

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  const inbound: number[][] = [];
  const unsubscribe = conn.onMessage((bytes) => {
    inbound.push(bytes);
    console.log(`📥 ${describeAm4InboundMessage(bytes)}`);
    console.log(`   raw: ${toHex(bytes)}\n`);
  });

  try {
    for (const target of READS) {
      const before = inbound.length;
      const msg = buildReadParam({ pidLow: target.pidLow, pidHigh: target.pidHigh });
      console.log(`→ READ ${target.label}`);
      console.log(`   raw: ${toHex(msg)}`);
      conn.send(msg);
      await sleep(RESPONSE_WINDOW_MS);
      const got = inbound.length - before;
      if (got === 0) {
        console.log(`   (no response within ${RESPONSE_WINDOW_MS} ms)\n`);
      }
    }
  } finally {
    unsubscribe();
    conn.close();
  }

  console.log('=== SUMMARY ===');
  console.log(`Inbound messages observed: ${inbound.length}`);
  console.log('');
  if (inbound.length === 0) {
    console.log('⚠ No inbound SysEx received.');
    console.log('  - The MIDI input handle may be stale — try `reconnect_midi`.');
    console.log('  Capture file is still useful: it records the outbound reads we sent.');
  } else {
    console.log('✅ Capture useful — the pcapng has the wire bytes.');
    console.log('   Founder: signal "HW-046 done" + the saved pcapng path,');
    console.log('   and the AM4-Edit (or front-panel) display values for');
    console.log('   amp.bass / amp.mid / amp.treble at capture time.');
  }
}

main().catch((err) => {
  console.error('\n❌ sanity-probe failed:', err.message);
  process.exit(1);
});
