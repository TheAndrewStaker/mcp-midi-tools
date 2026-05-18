/**
 * Slot-666 focused probe for fn 0x06 (routing-write).
 *
 * Hard-won context from session-68 + session-69 captures:
 *
 *   1. Fn 0x06 IS the routing-write — both click-capture .syx files contain
 *      `0x64 06 00` MULTIPURPOSE_RESPONSE acks from the device, proving
 *      AxeEdit successfully sent inbound fn 0x06 messages.
 *   2. Earlier Session 68 sweep probed against SLOT 1 — but slot 1's chain
 *      doesn't match what we were addressing. The 0x01 "args unknown" rain
 *      was mostly "block not in this preset" rejection.
 *   3. fn 0x20 grid-state decode is now confirmed: 12 cols × 4 rows × 4
 *      bytes/cell in column-major. routing_mask lives at byte[2] of each
 *      cell. mask = 0x02 means "outbound cable to next column same row."
 *
 * This script runs against slot 666 ("Glassy Clean") where we KNOW the
 * chain: Comp (blockId 100=0x64) at R2C1, Amp (106=0x6a) at R2C2,
 * Cab (108=0x6c) at R2C3, Reverb (110=0x6e) at R2C4.
 *
 * Probe strategy: target Comp's outbound mask. Comp is at cell index 1
 * (col 0 row 1, 0-indexed; 4-byte stride). Current mask is 0x02 (cabled
 * to Amp). Set target mask = 0x03 (different bit pattern, unambiguous
 * if it lands) so any grid mutation is detectable.
 *
 * Each probe tries one payload shape. Between probes that mutate state,
 * we reload slot 666 (preset switch discards working buffer — no save
 * happens — so this is safe). At end we leave slot 666 reloaded so the
 * founder sees the original Glassy Clean state.
 *
 * Run: npx tsx scripts/probe-axefx2-routing-slot666.ts
 *
 * SETUP: Axe-Fx II plugged in. Claude Desktop CLOSED. AxeEdit CLOSED.
 */

import { connectAxeFxII, type AxeFxIIConnection } from '@mcp-midi-control/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
  type GridCell,
} from 'fractal-midi/axe-fx-ii';

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function fractalCs(envelope: number[], csPos: number): number {
  let cs = 0;
  for (let i = 1; i < csPos; i++) cs ^= envelope[i];
  return cs & 0x7f;
}

function buildProbe(payload: number[]): number[] {
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x06, ...payload];
  const cs = fractalCs(head, head.length);
  return [...head, cs, 0xf7];
}

async function readGrid(conn: AxeFxIIConnection): Promise<GridCell[]> {
  const respPromise = conn.receiveSysExMatching(isGetGridLayoutResponse, 1500);
  conn.send(buildGetGridLayout());
  return parseGetGridLayoutResponse(await respPromise);
}

const SLOT_666_WIRE = 665; // 1-indexed display → 0-indexed wire
const COMP1_BLOCK_ID = 100; // 0x64
const AMP1_BLOCK_ID = 106;  // 0x6a
const CAB1_BLOCK_ID = 108;  // 0x6c
const REVERB1_BLOCK_ID = 110; // 0x6e

// Comp is at col 0 row 1 (0-indexed), absolute cell index in column-major
// (col * 4 + row) = 1. Library's GetGridLayout response uses a flat array;
// we'll find Comp by blockId after reading to avoid index-encoding ambiguity.
const TARGET_BLOCK_ID = COMP1_BLOCK_ID;
const TARGET_BLOCK_LABEL = 'COMP1';
const TARGET_NEW_MASK = 0x03; // distinct from baseline 0x02

interface ProbeShape {
  label: string;
  payload: number[];
}

/** All shapes target COMP1 (blockId 0x64, col 0 row 1). Loaded as slot 666
 *  Glassy Clean. Currently has mask 0x02 (cabled to Amp). We're trying to
 *  set it to 0x03 — any change away from 0x02 confirms the shape worked. */
function buildShapes(): ProbeShape[] {
  const bid = TARGET_BLOCK_ID;
  const m = TARGET_NEW_MASK;
  // col 0, row 1 in 0-indexed; col 1, row 2 in 1-indexed
  return [
    // ── 2-byte shapes ──
    { label: '2A  [blockId_lo, mask]',
      payload: [bid & 0x7f, m] },

    // ── 3-byte shapes ──
    { label: '3A  [blockId_lo, blockId_hi, mask]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, m] },
    { label: '3B  [col0, row0, mask]    (0-indexed)',
      payload: [0, 1, m] },
    { label: '3C  [col1, row1, mask]    (1-indexed)',
      payload: [1, 2, m] },
    { label: '3D  [row0, col0, mask]',
      payload: [1, 0, m] },
    { label: '3E  [cellIdx_colmajor, 0, mask]   (cell=1)',
      payload: [1, 0, m] },

    // ── 4-byte shapes (0x0C was returned for [0x64,0x00,0x04,0x02] in Session 68;
    //    that's nearly this exact shape but with mask 0x02 — try variants) ──
    { label: '4A  [blockId_lo, blockId_hi, mask, 0]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, m, 0] },
    { label: '4B  [blockId_lo, blockId_hi, 0, mask]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 0, m] },
    { label: '4C  [blockId_lo, blockId_hi, 4, mask]  (revisit 0x0C hit)',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 4, m] },
    { label: '4D  [col0, row0, mask, 0]',
      payload: [0, 1, m, 0] },
    { label: '4E  [col1, row1, mask, 0]',
      payload: [1, 2, m, 0] },
    { label: '4F  [cellIdx, 0, mask, 0]',
      payload: [1, 0, m, 0] },

    // ── 5-byte shapes ──
    { label: '5A  [blockId_lo, blockId_hi, col0, row0, mask]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 0, 1, m] },
    { label: '5B  [blockId_lo, blockId_hi, row0, col0, mask]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 1, 0, m] },
    { label: '5C  [srcCol, srcRow, dstCol, dstRow, mask]  (R2C1→R2C2)',
      payload: [0, 1, 1, 1, m] },
    { label: '5D  [srcBlockId_lo, srcBlockId_hi, dstBlockId_lo, dstBlockId_hi, mask]  (Comp→Amp)',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, AMP1_BLOCK_ID & 0x7f, (AMP1_BLOCK_ID >> 7) & 0x7f, m] },

    // ── 6-byte shapes ──
    { label: '6A  [blockId_lo, blockId_hi, col0, row0, mask, 0]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 0, 1, m, 0] },
    { label: '6B  [blockId_lo, blockId_hi, row0, col0, mask, 0]',
      payload: [bid & 0x7f, (bid >> 7) & 0x7f, 1, 0, m, 0] },
  ];
}

interface ProbeResult {
  shape: ProbeShape;
  resultCode: number | null;
  ackBytes: number[] | null;
  maskOfTargetAfter: number;
  maskFlipped: boolean;
}

function describeRc(rc: number | null): string {
  if (rc === null) return '— no response';
  switch (rc) {
    case 0x00: return '✅ OK (state mutated — slot 666 reload incoming)';
    case 0x01: return '   args/shape unknown';
    case 0x02: return '?  result 0x02';
    case 0x03: return '?  result 0x03';
    case 0x04: return '?  result 0x04';
    case 0x0c: return '⚠  content rejected (selector valid, content rejected)';
    default:   return `?  unknown 0x${rc.toString(16).padStart(2, '0')}`;
  }
}

function findCellByBlockId(grid: GridCell[], blockId: number): GridCell | undefined {
  return grid.find((c) => c.blockId === blockId);
}

async function probeOne(conn: AxeFxIIConnection, shape: ProbeShape, baselineMask: number): Promise<ProbeResult> {
  const frame = buildProbe(shape.payload);
  const inboundFrames: number[][] = [];
  const unsubscribe = conn.onMessage((b) => inboundFrames.push([...b]));
  conn.send(frame);
  await sleep(120);
  unsubscribe();

  const ack = inboundFrames.find((b) => b.length >= 8 && b[5] === 0x64 && b[6] === 0x06);
  const resultCode = ack ? ack[7] : null;
  const ackBytes = ack ? [...ack] : null;

  // Re-read grid to see if target's mask changed
  const grid = await readGrid(conn);
  const cell = findCellByBlockId(grid, TARGET_BLOCK_ID);
  const maskAfter = cell?.routingFlags ?? -1;
  const maskFlipped = maskAfter !== baselineMask && maskAfter >= 0;

  return { shape, resultCode, ackBytes, maskOfTargetAfter: maskAfter, maskFlipped };
}

async function reloadSlot666(conn: AxeFxIIConnection): Promise<void> {
  conn.send(buildSwitchPreset(SLOT_666_WIRE));
  await sleep(300);
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

  console.log(`Step 1: Switching to slot 666 (Glassy Clean)...`);
  await reloadSlot666(conn);

  console.log(`Step 2: Reading baseline grid...`);
  const baseline = await readGrid(conn);
  const targetBaseline = findCellByBlockId(baseline, TARGET_BLOCK_ID);
  if (!targetBaseline) {
    console.error(`❌ ${TARGET_BLOCK_LABEL} (blockId ${TARGET_BLOCK_ID}=0x${TARGET_BLOCK_ID.toString(16)}) not found in slot 666's grid.`);
    console.error(`   This script assumes slot 666 = "Glassy Clean" with Comp/Amp/Cab/Reverb at R2C1..C4.`);
    console.error(`   Either slot 666 contents have changed or wire-slot 665 isn't display-slot 666.`);
    console.error(`   Found blocks:`);
    for (const c of baseline) if (c.blockId > 0) {
      console.error(`     blockId=${c.blockId}=0x${c.blockId.toString(16)} mask=0x${c.routingFlags.toString(16).padStart(2,'0')}`);
    }
    conn.close();
    process.exit(1);
  }
  const baselineMask = targetBaseline.routingFlags;
  console.log(`   ${TARGET_BLOCK_LABEL} found. baseline mask=0x${baselineMask.toString(16).padStart(2,'0')}`);
  console.log(`   Target new mask: 0x${TARGET_NEW_MASK.toString(16).padStart(2,'0')}`);
  console.log('');

  const shapes = buildShapes();
  console.log(`Step 3: Running ${shapes.length} probe shapes...\n`);

  const results: ProbeResult[] = [];
  for (const shape of shapes) {
    console.log(`── ${shape.label}`);
    const frame = buildProbe(shape.payload);
    console.log(`   payload: ${toHex(shape.payload)}`);
    console.log(`   frame:   ${toHex(frame)}`);
    const result = await probeOne(conn, shape, baselineMask);
    console.log(`   ack: ${result.ackBytes ? toHex(result.ackBytes) : '(none)'}  ${describeRc(result.resultCode)}`);
    console.log(`   ${TARGET_BLOCK_LABEL} mask after: 0x${result.maskOfTargetAfter.toString(16).padStart(2,'0')}${result.maskFlipped ? ' ★ FLIPPED!' : ''}`);
    if (result.maskFlipped || result.resultCode === 0x00) {
      console.log(`   ★★★ HIT — reloading slot 666 before next probe`);
      await reloadSlot666(conn);
    }
    console.log('');
    results.push(result);
  }

  // Final: leave slot 666 in known state
  console.log('Step 4: Reloading slot 666 (clean state on exit)...');
  await reloadSlot666(conn);

  // Summary
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  const hits = results.filter((r) => r.maskFlipped || r.resultCode === 0x00);
  const contentRejected = results.filter((r) => r.resultCode === 0x0c);
  const argsUnknown = results.filter((r) => r.resultCode === 0x01);

  if (hits.length > 0) {
    console.log(`🎯 HITS (${hits.length}) — these shapes mutated state:`);
    for (const r of hits) {
      console.log(`   ${r.shape.label}`);
      console.log(`     payload: ${toHex(r.shape.payload)}`);
      console.log(`     ack rc: 0x${(r.resultCode ?? 0).toString(16).padStart(2,'0')}  mask: 0x${baselineMask.toString(16).padStart(2,'0')} → 0x${r.maskOfTargetAfter.toString(16).padStart(2,'0')}`);
    }
  }
  if (contentRejected.length > 0) {
    console.log(`\n⚠  CONTENT REJECTED (0x0C) — shape likely close:`);
    for (const r of contentRejected) {
      console.log(`   ${r.shape.label}  payload=${toHex(r.shape.payload)}`);
    }
  }
  console.log(`\n   args unknown (0x01): ${argsUnknown.length}`);

  if (hits.length === 0 && contentRejected.length === 0) {
    console.log('\nNo shape mutated state or returned 0x0C.');
    console.log('Next: try varying the mask value (we used 0x03; AxeEdit may have used 0x02 to ADD a bit, not REPLACE).');
    console.log('Or: try with the routing register at a different paramId encoding (8-byte SET_PARAM shape).');
  }

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
