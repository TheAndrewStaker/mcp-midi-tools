/**
 * HW-044 — Read-shape probe for working-buffer state reads.
 *
 * Sends two 0x01 PARAMETER_R/W READ requests (readType=0x0e) and prints
 * every inbound SysEx with a human-readable label. The wire shape of the
 * response is what we need to decode in order to ship `get_block_layout`
 * and `get_param` MCP tools (the conversational-preset MVP needs to read
 * what's currently on the unit before proposing a change).
 *
 * Two reads chosen for cross-validation:
 *   1. pidLow=0x00CE, pidHigh=0x000F — slot-1 block. Response should
 *      carry the current block's pidLow as a parseable float32 at a
 *      fixed offset.
 *   2. pidLow=0x003A, pidHigh=0x000B — amp.gain. Well-known param with
 *      a knob_0_10 scale, easy to sanity-check the decoded value
 *      against the knob position the founder reads on AM4-Edit.
 *
 * Capture procedure (founder-side):
 *   1. Connect AM4 via USB. Close AM4-Edit (it polls and would noise
 *      the capture).
 *   2. Start USBPcap on the AM4's USB endpoint, save to
 *      `samples/captured/session-NN-readprobe.pcapng`.
 *   3. Run `npx tsx scripts/read-probe.ts` (or `npm run read-probe`).
 *   4. Stop the capture. Note on the AM4 display what preset is loaded
 *      and what's actually in slot 1 + the current amp gain knob value.
 *   5. Signal "HW-044 done" + saved path + slot-1 block name + amp gain.
 *
 * See HARDWARE-TASKS.md HW-044 for the full task spec.
 */
import { connectAM4, describeAm4InboundMessage, toHex } from '@mcp-midi-control/am4/midi.js';
import { buildReadParam } from '@mcp-midi-control/am4/setParam.js';

interface ReadTarget {
  label: string;
  pidLow: number;
  pidHigh: number;
}

const READS: ReadTarget[] = [
  { label: 'slot-1 block (0x00CE / 0x000F)', pidLow: 0x00ce, pidHigh: 0x000f },
  { label: 'amp.gain     (0x003A / 0x000B)', pidLow: 0x003a, pidHigh: 0x000b },
];

const RESPONSE_WINDOW_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('=== HW-044 read-shape probe ===\n');

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
    console.log('  Possible causes:');
    console.log('  - 0x0e is not the right readType — try 0x0d or another value.');
    console.log('  - The MIDI input handle is stale — try `reconnect_midi`.');
    console.log('  Capture file is still useful: it records the outbound reads we sent.');
  } else {
    console.log('✅ Capture useful regardless of decode — the pcapng has the wire bytes.');
    console.log('   Founder: signal "HW-044 done" + the saved pcapng path,');
    console.log('   the slot-1 block name on the AM4 display, and the current');
    console.log('   amp gain knob value (so we can sanity-check the decoded float).');
  }
}

main().catch((err) => {
  console.error('\n❌ read-probe failed:', err.message);
  process.exit(1);
});
