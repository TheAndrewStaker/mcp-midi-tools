/**
 * Byte-0 sub-selector sweep for fn 0x06 (routing-write).
 *
 * Session 68 finding: with payload shape [byte0, 0x00, 0x04, 0x02],
 *   - byte0 = 0x64 → device returned result_code 0x0C (content rejected)
 *   - all other tried payload shapes returned 0x01 (args/shape unknown)
 *
 * The unique 0x0C return strongly suggests byte 0 of the fn 0x06 payload
 * is a SUB-SELECTOR that gates which of several routing sub-commands the
 * rest of the payload encodes. 0x64 is one valid value; the others are
 * unknown.
 *
 * This script sweeps byte 0 across 0x00..0x7F with the rest of the payload
 * held constant, and records each result code. Any value that returns 0x0C
 * (or anything other than 0x01 / no-response) is a candidate sub-selector
 * worth further investigation.
 *
 * Interpretation key:
 *   0x00 — OK, command accepted (and we just mutated state — script reloads slot 1)
 *   0x01 — args/shape unknown for this selector (the common failure)
 *   0x0C — content rejected (selector valid, but the payload semantics are wrong)
 *   anything else — unexpected; log it
 *
 * Run: npx tsx scripts/probe-axefx2-routing-selector-sweep.ts
 *
 * SETUP: Axe-Fx II plugged in. Claude Desktop CLOSED. AxeEdit CLOSED.
 *
 * Output: a table of byte0 → resultCode + a summary of selector candidates.
 * Total wire time ~6-10 seconds (128 probes × ~50ms each).
 */

import { connectAxeFxII, type AxeFxIIConnection } from '@mcp-midi-control/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
  type GridCell,
} from '@mcp-midi-control/axe-fx-ii/setParam.js';

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Fractal XOR-and-0x7F checksum over bytes [1..csPos). */
function fractalCs(envelope: number[], csPos: number): number {
  let cs = 0;
  for (let i = 1; i < csPos; i++) cs ^= envelope[i];
  return cs & 0x7f;
}

/** Build an fn 0x06 frame from a payload. */
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

/** Payload tail held constant across the sweep — same shape that produced
 *  0x0C on byte0=0x64 in Session 68 (`[0x64, 0x00, 0x04, 0x02]`). */
const PAYLOAD_TAIL = [0x00, 0x04, 0x02];

/** Cell we expect to be stable across the sweep (AMP1 on slot 1). Used to
 *  detect accidental state mutation if a selector happens to be a working
 *  routing-write command. */
const SENTINEL_CELL_IDX = 17;

interface ProbeResult {
  byte0: number;
  resultCode: number | null;
  inbound: number[][];
  maskAfter: number;
}

async function probeOne(conn: AxeFxIIConnection, byte0: number): Promise<ProbeResult> {
  const payload = [byte0, ...PAYLOAD_TAIL];
  const frame = buildProbe(payload);

  const inboundFrames: number[][] = [];
  const unsubscribe = conn.onMessage((b) => inboundFrames.push([...b]));
  conn.send(frame);
  await sleep(50);
  unsubscribe();

  const ack = inboundFrames.find((b) => b.length >= 8 && b[5] === 0x64 && b[6] === 0x06);
  const resultCode = ack ? ack[7] : null;

  return { byte0, resultCode, inbound: inboundFrames, maskAfter: -1 };
}

function describeResult(rc: number | null): string {
  if (rc === null) return '— no response';
  switch (rc) {
    case 0x00: return '✅ OK (state may have mutated)';
    case 0x01: return '   args/shape unknown';
    case 0x02: return '?  result 0x02';
    case 0x03: return '?  result 0x03';
    case 0x04: return '?  result 0x04';
    case 0x0c: return '⚠  content rejected (selector likely valid)';
    default:   return `?  result 0x${rc.toString(16).padStart(2, '0')}`;
  }
}

async function main(): Promise<void> {
  console.log('Connecting to Axe-Fx II...');
  let conn: AxeFxIIConnection;
  try { conn = connectAxeFxII(); }
  catch (err) {
    console.error('❌ Connect failed:', err instanceof Error ? err.message : err);
    console.error('   Close Claude Desktop and AxeEdit, then retry.');
    process.exit(1);
  }
  if (!conn.hasInput) {
    console.error('❌ No input port — close Claude Desktop / AxeEdit and retry.');
    process.exit(1);
  }
  console.log('✓ Connected.\n');

  // Reload slot 1 for a clean baseline
  conn.send(buildSwitchPreset(0));
  await sleep(200);

  const baseline = await readGrid(conn);
  const baselineMask = baseline[SENTINEL_CELL_IDX]?.routingFlags ?? -1;
  console.log(`Baseline: cell ${SENTINEL_CELL_IDX} blockId=${baseline[SENTINEL_CELL_IDX]?.blockId} mask=0x${baselineMask.toString(16).padStart(2, '0')}`);
  console.log(`Payload tail held constant: ${toHex(PAYLOAD_TAIL)}`);
  console.log(`Sweeping byte 0 across 0x00..0x7F (128 probes)...\n`);

  const results: ProbeResult[] = [];
  for (let b = 0; b < 0x80; b++) {
    const result = await probeOne(conn, b);
    results.push(result);

    // Brief inline tick — print one line for any non-0x01 result so the
    // sweep is visibly making progress + interesting hits surface live
    if (result.resultCode !== 0x01) {
      const hex = b.toString(16).padStart(2, '0').toUpperCase();
      console.log(`  byte0 0x${hex} (${b.toString().padStart(3)}): ${describeResult(result.resultCode)}`);
    }

    // If we got OK, slot 1 state may have changed — reload before continuing
    if (result.resultCode === 0x00) {
      conn.send(buildSwitchPreset(0));
      await sleep(200);
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');

  const ok = results.filter((r) => r.resultCode === 0x00);
  const contentRejected = results.filter((r) => r.resultCode === 0x0c);
  const argsUnknown = results.filter((r) => r.resultCode === 0x01);
  const noResponse = results.filter((r) => r.resultCode === null);
  const other = results.filter((r) =>
    r.resultCode !== null &&
    r.resultCode !== 0x00 &&
    r.resultCode !== 0x01 &&
    r.resultCode !== 0x0c
  );

  console.log(`Total probes:        ${results.length}`);
  console.log(`✅ OK   (0x00):       ${ok.length}`);
  console.log(`⚠  Content rejected (0x0C): ${contentRejected.length}`);
  console.log(`   Args unknown    (0x01): ${argsUnknown.length}`);
  console.log(`   No response:          ${noResponse.length}`);
  console.log(`?  Other:                ${other.length}`);

  if (ok.length > 0) {
    console.log(`\n🎯 ACCEPTED — these selectors caused 0x00 (state mutated, slot 1 reloaded between):`);
    for (const r of ok) {
      console.log(`   byte0 = 0x${r.byte0.toString(16).padStart(2, '0')} (${r.byte0})`);
    }
  }
  if (contentRejected.length > 0) {
    console.log(`\n⚠  CONTENT REJECTED — these selectors are valid; payload tail [${toHex(PAYLOAD_TAIL)}] was rejected:`);
    for (const r of contentRejected) {
      console.log(`   byte0 = 0x${r.byte0.toString(16).padStart(2, '0')} (${r.byte0})`);
    }
    console.log(`\n   Next step: re-sweep payload TAIL with each valid byte0 fixed.`);
    console.log(`   Each 0x0C selector is one sub-command of fn 0x06.`);
  }
  if (other.length > 0) {
    console.log(`\n?  UNEXPECTED result codes — worth investigating:`);
    for (const r of other) {
      const rc = r.resultCode!.toString(16).padStart(2, '0');
      console.log(`   byte0 = 0x${r.byte0.toString(16).padStart(2, '0')} (${r.byte0}) → 0x${rc}`);
    }
  }
  if (contentRejected.length === 0 && ok.length === 0) {
    console.log('\nNo selector returned anything other than 0x01 or no-response.');
    console.log('Hypothesis: byte 0 is NOT a sub-selector with this payload shape.');
    console.log('Try sweeping with a different payload length (3 or 5 bytes) or fall');
    console.log('back to the debugger / passive-capture approach (HW-108).');
  }

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
