/**
 * HW-047 — Read-state encoding probe.
 *
 * Reads the four "current device state" registers in one capture so we
 * can wire `get_active_scene`, `get_active_location`, `get_block_bypass`,
 * and `get_active_channel` MCP tools. Encoding is uncertain because the
 * write-side of these uses a mix of u32 (scene switch) and float32
 * (preset switch, bypass, channel) — the read response may come back as
 * /65534 Q-format (like knob params, per HW-046) or as raw u32. One
 * capture decides.
 *
 * Reads sent (all readType=0x0E, same shape as HW-044):
 *   1. Active scene index            — pidLow=0x00CE, pidHigh=0x000D
 *   2. Active preset location index  — pidLow=0x00CE, pidHigh=0x000A
 *   3. Amp block bypass state        — pidLow=0x003A, pidHigh=0x0003
 *   4. Amp block active channel      — pidLow=0x003A, pidHigh=0x07D2
 *
 * Capture procedure (founder-side):
 *   1. Connect AM4 via USB. Close AM4-Edit (it polls and would noise the
 *      capture).
 *   2. Note current AM4 display state:
 *      - Active scene number (1..4)
 *      - Current preset location (e.g. "W04")
 *      - Whether the amp block is bypassed in the active scene (yes/no)
 *      - Amp's current channel (A/B/C/D)
 *      If amp isn't placed in the active preset, the bypass + channel
 *      reads will still return whatever's stored — that's fine for
 *      encoding decode; just note that amp wasn't placed.
 *   3. Start USBPcap on the AM4's USB endpoint, save to
 *      `samples/captured/session-NN-state-probe.pcapng`.
 *   4. Run `npm run state-probe`.
 *   5. Stop the capture.
 *   6. Signal "HW-047 done" + saved path + the four display values.
 */
import { connectAM4, describeAm4InboundMessage, toHex } from '@/fractal/am4/midi.js';
import { buildReadParam } from '@/fractal/am4/setParam.js';

interface ReadTarget {
  label: string;
  pidLow: number;
  pidHigh: number;
}

const READS: ReadTarget[] = [
  { label: 'active scene    (0x00CE / 0x000D)', pidLow: 0x00ce, pidHigh: 0x000d },
  { label: 'active preset   (0x00CE / 0x000A)', pidLow: 0x00ce, pidHigh: 0x000a },
  { label: 'amp bypass      (0x003A / 0x0003)', pidLow: 0x003a, pidHigh: 0x0003 },
  { label: 'amp channel     (0x003A / 0x07D2)', pidLow: 0x003a, pidHigh: 0x07d2 },
];

const RESPONSE_WINDOW_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('=== HW-047 read-state encoding probe ===\n');

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
    console.log('   Founder: signal "HW-047 done" + the saved pcapng path + the');
    console.log('   four display values noted at capture time:');
    console.log('   - Active scene number (1..4)');
    console.log('   - Current preset location code (e.g. W04)');
    console.log('   - Amp bypass state (on / off; or "amp not placed")');
    console.log('   - Amp current channel (A/B/C/D; or "amp not placed")');
  }
}

main().catch((err) => {
  console.error('\n❌ state-probe failed:', err.message);
  process.exit(1);
});
