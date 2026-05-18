/**
 * One-shot probe: test if fn 0x06 (routing-write) uses the SET_PARAM
 * (2,2,3,1) payload shape with paramId 0.
 *
 * Hypothesis from Ghidra decode (Session 68):
 *   - FUN_005503a0 is the SET_BLOCK_PARAMETER_VALUE builder (8-byte payload:
 *     2-byte effectId septet + 2-byte paramId septet + 3-byte value septet +
 *     1-byte reserved).
 *   - Function 0x06 (routing-write, confirmed via HW-108 click-to-connect
 *     capture) may reuse the SAME payload shape, just with a different
 *     fn byte and paramId = 0 acting as the routing-mask register.
 *
 * What this script does:
 *   1. Connect to the Axe-Fx II.
 *   2. Reload slot 1 (factory default) for a clean baseline.
 *   3. Read grid, report AMP1's mask at cell (col 5, row 2) = cell index 17.
 *   4. Send the probe: F0 00 01 74 07 06 6a 00 00 00 02 00 00 00 76 F7
 *      Payload bytes: [effectId=0x6a=AMP1, 0x00, paramId=0, 0x00, mask=2, 0x00, 0x00, 0x00]
 *   5. Wait 500ms for inbound, log every frame received.
 *   6. Re-read grid, report AMP1's mask again.
 *   7. Print verdict.
 *
 * SETUP: Axe-Fx II plugged in. Claude Desktop MUST be CLOSED so this script
 * can open the MIDI port (Windows MIDI is single-writer per port).
 *
 * Run: npx tsx scripts/probe-axefx2-routing.ts
 */

import { connectAxeFxII } from '@mcp-midi-control/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
} from 'fractal-midi/axe-fx-ii';

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function readGrid(conn: ReturnType<typeof connectAxeFxII>): Promise<ReturnType<typeof parseGetGridLayoutResponse>> {
  const respPromise = conn.receiveSysExMatching(isGetGridLayoutResponse, 1000);
  conn.send(buildGetGridLayout());
  const bytes = await respPromise;
  return parseGetGridLayoutResponse(bytes);
}

async function main(): Promise<void> {
  console.log('Connecting to Axe-Fx II...');
  let conn: ReturnType<typeof connectAxeFxII>;
  try {
    conn = connectAxeFxII();
  } catch (err) {
    console.error('❌ Failed to connect:', err instanceof Error ? err.message : err);
    console.error('   Make sure (1) the Axe-Fx II is powered on + USB connected,');
    console.error('   AND (2) Claude Desktop is CLOSED (it holds the port exclusively).');
    process.exit(1);
  }
  if (!conn.hasInput) {
    console.error('❌ Connected output but no input port available — cannot capture responses.');
    process.exit(1);
  }
  console.log('✓ Connected (bidirectional).\n');

  // Step 1: reload slot 1 for a clean baseline. Wire 0 = display slot 1.
  console.log('Step 1: Reloading slot 1 (factory default chain)...');
  conn.send(buildSwitchPreset(0));
  await sleep(200);

  // Step 2: baseline grid read
  console.log('Step 2: Reading baseline grid...');
  const baseline = await readGrid(conn);
  const ampCellIdx = 17; // col 5 row 2 = cell index 17 in column-major (col-1)*4+(row-1)
  const ampBefore = baseline[ampCellIdx];
  console.log(`  AMP1 cell @ idx ${ampCellIdx} (col 5 row 2): blockId=${ampBefore.blockId} mask=0x${ampBefore.routingFlags.toString(16).padStart(2, '0')}`);
  if (ampBefore.blockId !== 106) {
    console.warn(`  ⚠ Expected blockId 106 (AMP1) at cell 17, got ${ampBefore.blockId}. Slot 1 may not have factory chain — check device front panel.`);
  }

  // Step 3: send the probe and capture inbound for 500ms.
  // SET_PARAM-style payload: effectId 0x6a (AMP1) | paramId 0 | value 2 | reserved 0
  // Septet pair encoding: each value split into [low7, high7]
  // For 14-bit values: low = v & 0x7F, high = (v >> 7) & 0x7F
  // For 21-bit value (3 septets): byte0 = v & 0x7F, byte1 = (v >> 7) & 0x7F, byte2 = (v >> 14) & 0x7F
  const probeBytes = [
    0xF0, 0x00, 0x01, 0x74, 0x07, 0x06, // envelope: F0 + mfr + model + fn
    0x6a, 0x00,                          // effectId septet pair: AMP1 (106)
    0x00, 0x00,                          // paramId septet pair: 0
    0x02, 0x00, 0x00,                    // value septet triple: 2
    0x00,                                // reserved
    0x76,                                // checksum: XOR of bytes 1..N = 0x76
    0xF7,                                // end
  ];
  console.log(`\nStep 3: Sending probe (${probeBytes.length} bytes):`);
  console.log(`  ${toHex(probeBytes)}`);

  const inboundFrames: { ms: number; bytes: number[] }[] = [];
  const startMs = Date.now();
  const unsubscribe = conn.onMessage((b) => {
    inboundFrames.push({ ms: Date.now() - startMs, bytes: [...b] });
  });
  conn.send(probeBytes);
  await sleep(500);
  unsubscribe();

  console.log(`\nStep 4: Captured ${inboundFrames.length} inbound frame(s) during 500ms window:`);
  for (const { ms, bytes } of inboundFrames) {
    const isAck = bytes.length >= 8 && bytes[5] === 0x64 && bytes[6] === 0x06;
    const tag = isAck ? '  ★ 0x64 MULTIPURPOSE_RESPONSE for fn 0x06' : '';
    console.log(`  [+${ms.toString().padStart(4)}ms] (${bytes.length}B) ${toHex(bytes)}${tag}`);
    if (isAck) {
      const resultCode = bytes[7];
      const resultMeaning =
        resultCode === 0x00 ? 'OK ✓' :
        resultCode === 0x01 ? 'invalid args / unknown' :
        resultCode === 0x0c ? 'content rejected' :
        `unknown (0x${resultCode.toString(16).padStart(2, '0')})`;
      console.log(`     result_code = 0x${resultCode.toString(16).padStart(2, '0')} (${resultMeaning})`);
    }
  }

  // Step 5: re-read grid
  console.log('\nStep 5: Re-reading grid after probe...');
  const after = await readGrid(conn);
  const ampAfter = after[ampCellIdx];
  console.log(`  AMP1 cell @ idx ${ampCellIdx}: blockId=${ampAfter.blockId} mask=0x${ampAfter.routingFlags.toString(16).padStart(2, '0')}`);

  // Verdict
  console.log('\n========================================');
  console.log('VERDICT');
  console.log('========================================');
  const ackFrame = inboundFrames.find((f) => f.bytes.length >= 8 && f.bytes[5] === 0x64 && f.bytes[6] === 0x06);
  const ackOk = ackFrame !== undefined && ackFrame.bytes[7] === 0x00;
  const maskChanged = ampBefore.routingFlags !== ampAfter.routingFlags;

  if (ackOk && maskChanged) {
    console.log('🎯 JACKPOT — fn 0x06 IS SET_BLOCK_PARAMETER-style with paramId 0 = routing-mask.');
    console.log(`   AMP1 mask: 0x${ampBefore.routingFlags.toString(16)} → 0x${ampAfter.routingFlags.toString(16)}`);
    console.log('   Ready to ship buildSetCellRouting() with this payload shape.');
  } else if (ackOk && !maskChanged) {
    console.log('🤔 Ack OK but no grid mutation — paramId 0 is not the routing-mask register.');
    console.log('   Try paramIds 1, 254, 255, 256 in followup probes.');
  } else if (ackFrame !== undefined) {
    const rc = ackFrame.bytes[7];
    if (rc === 0x0c) {
      console.log('❌ result_code 0x0C — addressing valid, content/values rejected.');
      console.log('   Format right but value encoding wrong. Try different value septets.');
    } else if (rc === 0x01) {
      console.log('❌ result_code 0x01 — args/shape unknown to firmware.');
      console.log('   Payload shape (2,2,3,1) is not what fn 0x06 expects. Try 3-byte (1+1+1) variant next.');
    } else {
      console.log(`❌ Unknown result_code 0x${rc.toString(16).padStart(2, '0')}`);
    }
  } else {
    console.log('❌ No ack received within 500ms.');
    console.log('   Could mean fn 0x06 silently ignored this payload OR window too short.');
  }

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
