/**
 * Hardware verification: send the decoded fn 0x37 + fn 0x06 sequence and
 * confirm Amp's routing mask flips 0x00 → 0x02 (= "cable to next-column
 * same-row cell" = Cab).
 *
 * Decoded payload format (from samples/captured/session-70-axefx2-connect-
 * r2c2-to-r2c3.pcapng, Session 70):
 *
 *   Preamble:  F0 00 01 74 07 37 [blockId_lo] [blockId_hi] [cs] F7
 *              SET_TARGET_BLOCK = source block of the new cable
 *
 *   Routing:   F0 00 01 74 07 06 [src_cell] [dst_cell] [set] [cs] F7
 *              src_cell, dst_cell = column-major linear index (col*4 + row, 0-indexed)
 *              set = 0x01 to add cable, 0x00 to remove (TBD)
 *
 * Test target: cable Amp (R2C2, cell 5) → Cab (R2C3, cell 9) on slot 666.
 * Expected outcome: Amp's routing mask in fn 0x20 grid state flips 0x00 → 0x02.
 *
 * SETUP: Axe-Fx II plugged in. Claude Desktop CLOSED. AxeEdit CLOSED.
 * Run: npx tsx scripts/verify-axefx2-routing-write.ts
 */

import { connectAxeFxII, type AxeFxIIConnection } from '@mcp-midi-control/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
  type GridCell,
} from 'fractal-midi/axe-fx-ii';
import { fractalChecksum } from 'fractal-midi/shared';

const SLOT_666_WIRE = 665;
const AMP1_BLOCK_ID = 106; // 0x6a
const AMP_CELL_IDX = 5;    // R2C2 col-major: col 1 × 4 + row 1 = 5
const CAB_CELL_IDX = 9;    // R2C3 col-major: col 2 × 4 + row 1 = 9
const SET_FLAG_ADD = 0x01;

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function buildHandshakeFw(): number[] {
  // fn 0x08 GET_FIRMWARE_VERSION — empty payload. Step 1 of AxeEdit's
  // session handshake.
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x08];
  return [...head, fractalChecksum(head), 0xf7];
}

function buildHandshakeEditMode(): number[] {
  // fn 0x47 "editor mode hello" — empty payload. AxeEdit sends this
  // immediately after fn 0x08; device replies with 8-byte capabilities
  // blob. Likely puts the device into edit-friendly mode so subsequent
  // write-class functions (fn 0x06 routing, fn 0x05 grid placement etc.)
  // actually mutate the working buffer instead of silently no-op'ing.
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x47];
  return [...head, fractalChecksum(head), 0xf7];
}

function buildSetTargetBlock(blockId: number): number[] {
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x37, blockId & 0x7f, (blockId >> 7) & 0x7f];
  return [...head, fractalChecksum(head), 0xf7];
}

function buildSetCellRouting(srcCell: number, dstCell: number, set: number): number[] {
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x06, srcCell & 0x7f, dstCell & 0x7f, set & 0x7f];
  return [...head, fractalChecksum(head), 0xf7];
}

async function readGrid(conn: AxeFxIIConnection): Promise<GridCell[]> {
  const respPromise = conn.receiveSysExMatching(isGetGridLayoutResponse, 1500);
  conn.send(buildGetGridLayout());
  return parseGetGridLayoutResponse(await respPromise);
}

function findCellByBlockId(grid: GridCell[], blockId: number): GridCell | undefined {
  return grid.find((c) => c.blockId === blockId);
}

async function probeOnce(conn: AxeFxIIConnection, frame: number[], label: string): Promise<number | null> {
  const inbound: number[][] = [];
  const unsub = conn.onMessage((b) => inbound.push([...b]));
  conn.send(frame);
  await sleep(200);
  unsub();
  // Find the 0x64 ack for this fn byte (fn is at index 5 of our outbound frame)
  const fn = frame[5];
  const ack = inbound.find((b) => b.length >= 8 && b[5] === 0x64 && b[6] === fn);
  const rc = ack ? ack[7] : null;
  const rcLabel = rc === null ? '(no ack)'
    : rc === 0x00 ? '✅ OK'
    : rc === 0x01 ? '❌ args/shape unknown'
    : rc === 0x0c ? '⚠ content rejected'
    : `? 0x${rc.toString(16).padStart(2, '0')}`;
  console.log(`  ${label}: ${toHex(frame)}`);
  console.log(`    ack: ${ack ? toHex(ack) : '(none)'}  ${rcLabel}`);
  return rc;
}

async function main(): Promise<void> {
  console.log('Connecting to Axe-Fx II...');
  let conn: AxeFxIIConnection;
  try { conn = connectAxeFxII(); }
  catch (err) {
    console.error('❌ Connect failed:', err instanceof Error ? err.message : err);
    console.error('   Close Claude Desktop AND AxeEdit, then retry.');
    process.exit(1);
  }
  if (!conn.hasInput) {
    console.error('❌ No input port — close Claude Desktop / AxeEdit and retry.');
    process.exit(1);
  }
  console.log('✓ Connected.\n');

  // Two-step handshake matching AxeEdit's connection sequence (decoded
  // from samples/captured/session-70-axefx2-connect.pcapng):
  //   1. fn 0x08 GET_FIRMWARE_VERSION → device replies with firmware blob
  //   2. fn 0x47 EDIT_MODE_HELLO → device replies with 8-byte capabilities
  // Without (2) the device appears to silently ignore routing writes —
  // fn 0x06 ack returns 0x00 OK but the working buffer doesn't mutate.
  console.log('Step 0a: fn 0x08 GET_FIRMWARE_VERSION handshake...');
  {
    const inbound: number[][] = [];
    const unsub = conn.onMessage((b) => inbound.push([...b]));
    conn.send(buildHandshakeFw());
    await sleep(400);
    unsub();
    const resp = inbound.find((b) => b.length > 7 && b[5] === 0x08);
    console.log(`   response: ${resp ? resp.map((x) => x.toString(16).padStart(2, '0')).join(' ') : '(none)'}`);
  }

  console.log('Step 0b: fn 0x47 EDIT_MODE_HELLO handshake...');
  {
    const inbound: number[][] = [];
    const unsub = conn.onMessage((b) => inbound.push([...b]));
    conn.send(buildHandshakeEditMode());
    await sleep(400);
    unsub();
    const resp = inbound.find((b) => b.length > 7 && b[5] === 0x47);
    console.log(`   response: ${resp ? resp.map((x) => x.toString(16).padStart(2, '0')).join(' ') : '(none)'}`);
  }
  console.log('');

  // Reload slot 666 for clean baseline
  console.log('Step 1: Loading slot 666 (Glassy Clean) for clean baseline...');
  conn.send(buildSwitchPreset(SLOT_666_WIRE));
  await sleep(400);

  console.log('Step 2: Reading baseline grid...');
  const baseline = await readGrid(conn);
  const ampBaseline = findCellByBlockId(baseline, AMP1_BLOCK_ID);
  if (!ampBaseline) {
    console.error('❌ AMP1 not found in slot 666. Did slot 666 contents change?');
    conn.close();
    process.exit(1);
  }
  const baselineMask = ampBaseline.routingFlags;
  console.log(`   AMP1 baseline mask: 0x${baselineMask.toString(16).padStart(2, '0')}`);
  console.log('');

  // Send the decoded sequence
  console.log('Step 3a: Try fn 0x06 ALONE (no 0x37 preamble) — does device behavior differ?');
  const routingFrameOnly = buildSetCellRouting(AMP_CELL_IDX, CAB_CELL_IDX, SET_FLAG_ADD);
  await probeOnce(conn, routingFrameOnly, 'fn 0x06 alone [5,9,1]');
  console.log('');

  console.log('Step 3b: Read grid after solo fn 0x06...');
  await sleep(150);
  const afterSolo = await readGrid(conn);
  const ampAfterSolo = findCellByBlockId(afterSolo, AMP1_BLOCK_ID);
  console.log(`   AMP1 mask after solo 0x06: 0x${(ampAfterSolo?.routingFlags ?? -1).toString(16).padStart(2,'0')}`);
  console.log('');

  console.log('Step 3c: Now try fn 0x37 + fn 0x06 sequence...');
  const targetFrame = buildSetTargetBlock(AMP1_BLOCK_ID);
  const routingFrame = buildSetCellRouting(AMP_CELL_IDX, CAB_CELL_IDX, SET_FLAG_ADD);
  await probeOnce(conn, targetFrame, 'fn 0x37 SET_TARGET_BLOCK=AMP1');
  await probeOnce(conn, routingFrame, 'fn 0x06 SET_CELL_ROUTING [5,9,1]');
  console.log('');

  // Read grid to confirm — dump RAW bytes too in case our parser is wrong
  console.log('Step 4: Reading grid to confirm mask flip...');
  await sleep(150);
  const rawInbound: number[][] = [];
  const unsub = conn.onMessage((b) => rawInbound.push([...b]));
  conn.send(buildGetGridLayout());
  await sleep(400);
  unsub();
  const rawGrid = rawInbound.find((b) => b.length >= 8 && b[5] === 0x20 && b.length > 100);
  if (rawGrid) {
    console.log(`   RAW fn 0x20 response (${rawGrid.length} bytes):`);
    console.log(`     ${rawGrid.map((x) => x.toString(16).padStart(2,'0')).join(' ')}`);
  } else {
    console.log(`   RAW fn 0x20 response NOT received in 400ms window.`);
  }
  const after = await readGrid(conn);
  console.log('   All occupied cells (after-state):');
  for (const c of after) {
    if (c.blockId > 0 && c.blockId < 250) {
      console.log(`     blockId=${c.blockId.toString().padStart(3)}=0x${c.blockId.toString(16).padStart(2,'0')}  mask=0x${c.routingFlags.toString(16).padStart(2,'0')}`);
    }
  }
  const ampAfter = findCellByBlockId(after, AMP1_BLOCK_ID);
  const afterMask = ampAfter?.routingFlags ?? -1;
  console.log(`   AMP1 mask after:   0x${afterMask.toString(16).padStart(2, '0')}`);

  const flipped = afterMask !== baselineMask && afterMask >= 0;
  if (flipped && afterMask === 0x02) {
    console.log(`\n🎯 SUCCESS — Amp mask flipped 0x${baselineMask.toString(16).padStart(2, '0')} → 0x${afterMask.toString(16).padStart(2, '0')} (cable added).`);
    console.log('   Routing-write fully decoded. Ready to ship buildSetCellRouting + goldens.');
  } else if (flipped) {
    console.log(`\n⚠ Mask flipped but not to expected 0x02: 0x${baselineMask.toString(16).padStart(2, '0')} → 0x${afterMask.toString(16).padStart(2, '0')}`);
  } else {
    console.log(`\n❌ Mask did NOT flip. Routing-write did not land.`);
    console.log('   Either the SET_TARGET_BLOCK preamble is wrong, the cell-index encoding is off, or the device returned an error.');
  }

  // Clean exit — reload slot 666 to discard working-buffer changes
  console.log('\nStep 5: Reloading slot 666 to discard working-buffer changes...');
  conn.send(buildSwitchPreset(SLOT_666_WIRE));
  await sleep(300);

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
