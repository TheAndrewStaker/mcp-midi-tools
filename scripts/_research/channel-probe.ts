/**
 * HW-048 — Per-block channel-state register encoding probe.
 *
 * HW-047 established that reading at (0x003A, 0x07D2) — the address
 * the channel WRITE side uses — returned u32 = 11244 when amp was on
 * channel B (= index 1), not the clean integer or Q15 we'd expected.
 * The wire address is correct for writes (Session 09 confirmed across
 * A/B/C/D), so the read must be returning derived/cached firmware
 * state, not the channel index directly.
 *
 * Three angles in one capture:
 *   (1) Re-read (0x003A, 0x07D2) at the start — confirms HW-047's
 *       u32 = 11244 is reproducible (or evolving).
 *   (2) Read adjacent pidHighs 0x07D1 and 0x07D3 — the actual channel-
 *       state register may live one step away from the write
 *       address.
 *   (3) Write→Read echo test: write channel B, immediately read
 *       (0x003A, 0x07D2). If the read returns the just-written
 *       float32(1.0) bit-pattern (low bytes after Q15 shift), the
 *       register IS the channel store. If it returns 11244 again or
 *       something else, the register is genuinely a separate piece
 *       of firmware state.
 *   (4) Sweep all four channels with a read after each switch. If
 *       the four u32 values cluster (e.g., ~11244 / ~22488 / ~33732
 *       / ~44976 — multiples of ~11244), then the channel index IS
 *       encoded but with a peculiar scale. If all four values are
 *       identical, the register is a per-block constant unrelated
 *       to channel.
 *
 * SAFETY: this script issues channel-switch WRITES (4 of them, one
 * per channel). It does NOT change params. The user's amp-block
 * channel will end up on D after the script (last channel walked).
 * Switch back manually afterwards if you want to preserve the
 * starting channel.
 *
 * Capture procedure (founder-side):
 *   1. Connect AM4 via USB. Close AM4-Edit. Note the starting amp
 *      channel.
 *   2. Start USBPcap on the AM4's USB endpoint, save to
 *      `samples/captured/session-NN-channel-probe.pcapng`.
 *   3. Run `npm run channel-probe` (or `npx tsx scripts/channel-probe.ts`).
 *   4. Stop the capture.
 *   5. Signal "HW-048 done" + saved path + the starting channel.
 *      (The script restores the starting channel at the end.)
 */
import { connectAM4, describeAm4InboundMessage, toHex } from '@mcp-midi-control/am4/midi.js';
import { buildReadParam, buildSetParam } from '@mcp-midi-control/am4/setParam.js';

const RESPONSE_WINDOW_MS = 500;
const CHANNEL_REG = { pidLow: 0x003a, pidHigh: 0x07d2 };
const CHANNEL_REG_BELOW = { pidLow: 0x003a, pidHigh: 0x07d1 };
const CHANNEL_REG_ABOVE = { pidLow: 0x003a, pidHigh: 0x07d3 };

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('=== HW-048 channel-register encoding probe ===\n');

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  const inbound: number[][] = [];
  const unsubscribe = conn.onMessage((bytes) => {
    inbound.push(bytes);
    console.log(`📥 ${describeAm4InboundMessage(bytes)}`);
    console.log(`   raw: ${toHex(bytes)}\n`);
  });

  async function send(label: string, msg: number[]): Promise<void> {
    console.log(`→ ${label}`);
    console.log(`   raw: ${toHex(msg)}`);
    conn.send(msg);
    await sleep(RESPONSE_WINDOW_MS);
  }

  try {
    // (1) Re-read the HW-047 address — confirms the 11244 finding holds.
    console.log('--- (1) Re-read primary channel register ---');
    await send('READ amp.channel @ (0x003A / 0x07D2)', buildReadParam(CHANNEL_REG));

    // (2) Read adjacent pidHighs.
    console.log('\n--- (2) Read adjacent pidHighs ---');
    await send('READ adjacent below @ (0x003A / 0x07D1)', buildReadParam(CHANNEL_REG_BELOW));
    await send('READ adjacent above @ (0x003A / 0x07D3)', buildReadParam(CHANNEL_REG_ABOVE));

    // (3) Write→Read echo test on channel B.
    console.log('\n--- (3) Write channel B then immediately re-read ---');
    await send('WRITE amp.channel = B (= 1)', buildSetParam('amp.channel', 1));
    await send('READ amp.channel (post-write-B)', buildReadParam(CHANNEL_REG));

    // (4) Sweep all four channels with a read after each switch.
    console.log('\n--- (4) Sweep A → B → C → D with reads ---');
    for (const ch of ['A', 'B', 'C', 'D'] as const) {
      const idx = ch.charCodeAt(0) - 'A'.charCodeAt(0);
      await send(`WRITE amp.channel = ${ch} (= ${idx})`, buildSetParam('amp.channel', idx));
      await send(`READ amp.channel (post-${ch})`, buildReadParam(CHANNEL_REG));
    }
  } finally {
    unsubscribe();
    conn.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Inbound messages observed: ${inbound.length}`);
  if (inbound.length === 0) {
    console.log('⚠ No inbound SysEx received.');
    console.log('  - The MIDI input handle may be stale — try `reconnect_midi`.');
  } else {
    console.log('✅ Capture useful — the pcapng has the wire bytes.');
    console.log('   Founder: signal "HW-048 done" + the saved pcapng path,');
    console.log('   and the starting channel (so the analysis can confirm');
    console.log('   the script restored it correctly at the end — last walked');
    console.log('   was D, so the script ends with channel D active).');
  }
}

main().catch((err) => {
  console.error('\n❌ channel-probe failed:', err.message);
  process.exit(1);
});
