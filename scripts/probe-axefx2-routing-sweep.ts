/**
 * Sweep probe: try multiple payload shapes against fn 0x06 to find the
 * one that returns result_code = 0x00 (OK).
 *
 * Hypotheses (smallest first — fn 0x06 likely takes a simple payload
 * since we already know it has a 4-byte length floor):
 *
 *   A. [cell_idx, mask, reserved] — 3 bytes raw (matches DAT_e00770's
 *      (1,1,1) schema)
 *   B. [cell_idx_septet_lo, cell_idx_septet_hi, mask] — 3 bytes septet
 *   C. [cell_idx, mask, reserved, pad] — 4 bytes raw
 *   D. [row, col, mask, reserved] — 4 bytes raw
 *   E. [col, row, mask, reserved] — 4 bytes raw (alt order)
 *   F. [effectId_lo, effectId_hi, mask, reserved] — 4 bytes (AxeEdit
 *      probably addresses by block, not cell, since "Click to connect"
 *      is per-block UI)
 *   G. [cell_idx_septet_lo, cell_idx_septet_hi, mask, reserved] — 4 bytes
 *
 * Target: AMP1 at slot 1's chain — effectId 106 (0x6a), cell index 17
 * (col 5 row 2), current mask 0x02. We'll probe each shape with mask=0
 * (different from baseline 2) so any grid mutation is unambiguous.
 *
 * Run: npx tsx scripts/probe-axefx2-routing-sweep.ts
 *
 * SETUP: Axe-Fx II plugged in. Claude Desktop CLOSED.
 */

import { connectAxeFxII, type AxeFxIIConnection } from '@/fractal/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
  type GridCell,
} from '@/fractal/axe-fx-ii/setParam.js';

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Compute Fractal XOR-and-0x7F checksum over bytes between F0 and the
 *  position before cs. Returns the checksum byte. */
function fractalCs(envelope: number[], cs_position: number): number {
  let cs = 0;
  // XOR everything from index 1 (after F0) up to position before cs.
  for (let i = 1; i < cs_position; i++) cs ^= envelope[i];
  return cs & 0x7f;
}

/** Build an fn 0x06 probe frame from a payload byte array.
 *  Returns the full frame including F0 prefix, model, fn, payload, cs, F7. */
function buildProbe(payload: number[]): number[] {
  const head = [0xf0, 0x00, 0x01, 0x74, 0x07, 0x06, ...payload];
  const cs = fractalCs(head, head.length);
  return [...head, cs, 0xf7];
}

async function readGrid(conn: AxeFxIIConnection): Promise<GridCell[]> {
  const respPromise = conn.receiveSysExMatching(isGetGridLayoutResponse, 1000);
  conn.send(buildGetGridLayout());
  return parseGetGridLayoutResponse(await respPromise);
}

const AMP1_EFFECT_ID = 106; // 0x6a
const AMP1_CELL_IDX = 17;   // col 5 row 2 in column-major
const TARGET_MASK = 0x00;   // different from baseline 0x02 — any flip = success

interface ProbeShape {
  label: string;
  payload: number[];
}

const SHAPES: ProbeShape[] = [
  { label: 'A. [cell_idx, mask, reserved] (3 bytes raw)',
    payload: [AMP1_CELL_IDX, TARGET_MASK, 0x00] },
  { label: 'B. [cell_idx_septet_lo, cell_idx_septet_hi, mask] (3 bytes septet)',
    payload: [AMP1_CELL_IDX & 0x7f, (AMP1_CELL_IDX >> 7) & 0x7f, TARGET_MASK] },
  { label: 'C. [cell_idx, mask, 0, 0] (4 bytes raw)',
    payload: [AMP1_CELL_IDX, TARGET_MASK, 0x00, 0x00] },
  { label: 'D. [row=2, col=5, mask, reserved] (4 bytes raw)',
    payload: [0x02, 0x05, TARGET_MASK, 0x00] },
  { label: 'E. [col=5, row=2, mask, reserved] (4 bytes raw)',
    payload: [0x05, 0x02, TARGET_MASK, 0x00] },
  { label: 'F. [effectId_lo, effectId_hi, mask, reserved] (4 bytes septet)',
    payload: [AMP1_EFFECT_ID & 0x7f, (AMP1_EFFECT_ID >> 7) & 0x7f, TARGET_MASK, 0x00] },
  { label: 'G. [cell_idx_lo, cell_idx_hi, mask, reserved] (4 bytes septet)',
    payload: [AMP1_CELL_IDX & 0x7f, (AMP1_CELL_IDX >> 7) & 0x7f, TARGET_MASK, 0x00] },
  // Longer shapes — 5/6 bytes — in case fn 0x06 wants more context
  { label: 'H. [effectId_lo, effectId_hi, row, col, mask, reserved] (6 bytes)',
    payload: [AMP1_EFFECT_ID & 0x7f, (AMP1_EFFECT_ID >> 7) & 0x7f, 0x02, 0x05, TARGET_MASK, 0x00] },
  { label: 'I. [effectId_lo, effectId_hi, cell_idx, mask, reserved] (5 bytes)',
    payload: [AMP1_EFFECT_ID & 0x7f, (AMP1_EFFECT_ID >> 7) & 0x7f, AMP1_CELL_IDX, TARGET_MASK, 0x00] },
];

async function runProbe(conn: AxeFxIIConnection, shape: ProbeShape): Promise<{
  resultCode: number | null;
  inbound: number[][];
  maskAfter: number;
}> {
  const frame = buildProbe(shape.payload);
  const inboundFrames: number[][] = [];
  const unsubscribe = conn.onMessage((b) => inboundFrames.push([...b]));
  conn.send(frame);
  await sleep(300);
  unsubscribe();

  // Find the 0x64 ack for fn 0x06
  const ack = inboundFrames.find((b) => b.length >= 8 && b[5] === 0x64 && b[6] === 0x06);
  const resultCode = ack ? ack[7] : null;

  // Re-read grid to check mask
  const grid = await readGrid(conn);
  const maskAfter = grid[AMP1_CELL_IDX]?.routingFlags ?? -1;

  return { resultCode, inbound: inboundFrames, maskAfter };
}

async function main(): Promise<void> {
  console.log('Connecting to Axe-Fx II...');
  let conn: AxeFxIIConnection;
  try { conn = connectAxeFxII(); }
  catch (err) {
    console.error('❌ Connect failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (!conn.hasInput) {
    console.error('❌ No input port — close Claude Desktop / AxeEdit and retry.');
    process.exit(1);
  }
  console.log('✓ Connected.\n');

  // Reload slot 1 for clean baseline
  conn.send(buildSwitchPreset(0));
  await sleep(200);

  const baseline = await readGrid(conn);
  const baselineMask = baseline[AMP1_CELL_IDX]?.routingFlags ?? -1;
  console.log(`Baseline AMP1 mask at cell ${AMP1_CELL_IDX} (col 5 row 2): 0x${baselineMask.toString(16).padStart(2, '0')}`);
  if (baseline[AMP1_CELL_IDX]?.blockId !== 106) {
    console.warn(`⚠ Expected AMP1 (blockId 106) at cell ${AMP1_CELL_IDX}, got ${baseline[AMP1_CELL_IDX]?.blockId}. Probe may not be meaningful.`);
  }
  console.log('');

  const results: Array<{ shape: ProbeShape; resultCode: number | null; maskAfter: number; maskFlipped: boolean }> = [];

  for (const shape of SHAPES) {
    console.log(`── ${shape.label}`);
    console.log(`   payload: ${toHex(shape.payload)}`);
    const frame = buildProbe(shape.payload);
    console.log(`   frame:   ${toHex(frame)}`);
    const { resultCode, maskAfter } = await runProbe(conn, shape);
    const maskFlipped = maskAfter !== baselineMask && maskAfter >= 0;
    const rcStr = resultCode === null ? '(no ack)' : `0x${resultCode.toString(16).padStart(2, '0')}`;
    const rcMeaning =
      resultCode === 0x00 ? '✅ OK' :
      resultCode === 0x01 ? '❌ args unknown' :
      resultCode === 0x0c ? '⚠️ content rejected' :
      resultCode === null ? '⚠️ no response' :
      `? unknown`;
    console.log(`   ack: ${rcStr} ${rcMeaning}`);
    console.log(`   AMP1 mask after: 0x${maskAfter.toString(16).padStart(2, '0')}${maskFlipped ? ' ← FLIPPED!' : ''}`);
    if (resultCode === 0x00 || maskFlipped) {
      console.log('   ★ This is a hit — reload slot 1 before continuing other probes');
      conn.send(buildSwitchPreset(0));
      await sleep(200);
    }
    console.log('');
    results.push({ shape, resultCode, maskAfter, maskFlipped });
  }

  // Summary
  console.log('========================================');
  console.log('SUMMARY');
  console.log('========================================');
  const winners = results.filter((r) => r.resultCode === 0x00 || r.maskFlipped);
  const contentRejected = results.filter((r) => r.resultCode === 0x0c);
  const argsUnknown = results.filter((r) => r.resultCode === 0x01);
  if (winners.length > 0) {
    console.log(`🎯 WINNERS (${winners.length}):`);
    for (const w of winners) console.log(`   - ${w.shape.label}`);
  }
  if (contentRejected.length > 0) {
    console.log(`\n⚠️  CONTENT REJECTED (${contentRejected.length}) — shape might be right, content wrong:`);
    for (const r of contentRejected) console.log(`   - ${r.shape.label}`);
  }
  if (argsUnknown.length > 0) {
    console.log(`\n❌ SHAPE UNKNOWN (${argsUnknown.length}):`);
    for (const r of argsUnknown) console.log(`   - ${r.shape.label}`);
  }
  if (winners.length === 0 && contentRejected.length === 0) {
    console.log('\nAll shapes returned 0x01. fn 0x06 may require a struct/handle-based');
    console.log('addressing model rather than positional bytes. Consider:');
    console.log('  - debugger session at FUN_0055d2e0 to capture AxeEdit\'s actual payload');
    console.log('  - or accept deferral of multi-row routing decode for v0.1.0');
  }

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
