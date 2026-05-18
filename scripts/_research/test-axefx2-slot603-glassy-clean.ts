/**
 * Session 71 verification: build "Glassy Clean" at slot 603 using the
 * shipped applyExecutor (post unique-shunt-ID fix), then read back the
 * grid and verify every row-2 cell has the correct routing mask.
 *
 * Authorization: founder explicitly requested "test on slot 603". This
 * script will OVERWRITE slot 603's saved preset. Run only when the
 * founder has confirmed slot 603 is OK to clobber.
 *
 * Pre-flight: close Claude Desktop AND AxeEdit before running (single-
 * writer MIDI port constraint on Windows). The MCP server in Claude
 * Desktop holds the port exclusively.
 *
 * Usage:
 *   npx tsx scripts/test-axefx2-slot603-glassy-clean.ts
 *
 * Expected outcome on success:
 *   - All 12 row-2 cells filled (4 content blocks + 8 shunts at
 *     unique blockIds 200..207)
 *   - All cells at col 2..12 have routing_mask = 0x02 (feed from
 *     row 2 of prev col)
 *   - Slot 603 saved as "Glassy Clean"
 *   - Audio flows when founder plays a note
 */

import { connectAxeFxII, type AxeFxIIConnection } from '@mcp-midi-control/axe-fx-ii/midi.js';
import {
  buildGetGridLayout,
  buildSwitchPreset,
  isGetGridLayoutResponse,
  parseGetGridLayoutResponse,
  type GridCell,
} from 'fractal-midi/axe-fx-ii';
import {
  buildApplyPresetAtOps,
  runApplyPresetAtOps,
  type ApplyConn,
} from '@mcp-midi-control/axe-fx-ii/tools/applyExecutor.js';

const SLOT_603_DISPLAY = 603;
const SLOT_603_WIRE = 602; // 0-based wire preset number

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function readGrid(conn: AxeFxIIConnection): Promise<GridCell[]> {
  const respPromise = conn.receiveSysExMatching(isGetGridLayoutResponse, 1500);
  conn.send(buildGetGridLayout());
  return parseGetGridLayoutResponse(await respPromise);
}

function maskHex(m: number): string {
  return `0x${m.toString(16).padStart(2, '0')}`;
}

function summarizeRow2(grid: GridCell[]): string {
  const row2 = grid.filter((c) => c.row === 2).sort((a, b) => a.col - b.col);
  const lines: string[] = [];
  for (const c of row2) {
    const kind =
      c.blockId === 0 ? '·empty'
      : c.blockId >= 200 && c.blockId <= 235 ? `SHUNT(${c.blockId})`
      : `BLOCK(${c.blockId})`;
    lines.push(`  col ${String(c.col).padStart(2)}: ${kind.padEnd(14)}  mask=${maskHex(c.routingFlags)}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log('Test: Glassy Clean build at slot 603 via shipped applyExecutor\n');

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

  // Build the apply op-sequence using the SHIPPED applyExecutor — this
  // verifies the exact code path the MCP server runs.
  const ops = buildApplyPresetAtOps({
    preset_number: SLOT_603_WIRE,
    name: 'Glassy Clean',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Amp 1', params: { input_drive: 3.5, bass: 4.5, middle: 5.0, treble: 6.5, presence: 6.0, master_volume: 5.0 } },
      { block: 'Cab 1' },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  });

  console.log(`Built ${ops.length} ops. Breakdown:`);
  const byKind: Record<string, number> = {};
  for (const op of ops) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  for (const [k, n] of Object.entries(byKind)) {
    console.log(`  ${k.padEnd(14)}: ${n}`);
  }
  console.log('');

  // Print the shunt-placement ops to confirm unique IDs.
  console.log('Shunt placements (verify unique blockIds):');
  for (const op of ops) {
    if (op.kind === 'place_block' && op.summary.includes('SHUNT')) {
      console.log(`  ${op.summary}`);
    }
  }
  console.log('');

  console.log('Running apply against device...');
  const applyConn: ApplyConn = {
    send: (b) => conn.send(b),
    receiveSysExMatching: (pred, t) => conn.receiveSysExMatching(pred, t),
  };
  const result = await runApplyPresetAtOps(applyConn, ops);
  console.log(`\nApply result: ok=${result.ok} acks=${result.acks} bytes=${result.totalBytes} elapsed=${result.elapsedMs}ms`);
  if (result.lastNack) {
    console.log(`⚠ lastNack: "${result.lastNack.summary}" → resultCode=0x${result.lastNack.resultCode.toString(16)}`);
  }
  // Print last 25 summaries for visibility.
  console.log('Last 25 op outcomes:');
  for (const s of result.summaries.slice(-25)) {
    console.log(s);
  }
  console.log('');

  // Reload slot 603 to verify the SAVED state (not just the working buffer).
  console.log(`Step verify-1: Reloading slot 603 (wire ${SLOT_603_WIRE}) to read saved state...`);
  conn.send(buildSwitchPreset(SLOT_603_WIRE));
  await sleep(400);

  console.log('Step verify-2: Reading grid layout from working buffer (post-reload)...');
  const grid = await readGrid(conn);
  console.log('\nRow 2 state on slot 603:');
  console.log(summarizeRow2(grid));

  // Verify: every cell col 2..12 should have mask 0x02; col 1 may be 0 (INPUT implicit).
  const row2 = grid.filter((c) => c.row === 2).sort((a, b) => a.col - b.col);
  const broken: GridCell[] = [];
  const empty: GridCell[] = [];
  for (const c of row2) {
    if (c.blockId === 0) empty.push(c);
    if (c.col > 1 && c.routingFlags === 0) broken.push(c);
  }

  console.log('');
  if (empty.length === 0 && broken.length === 0) {
    console.log('🎯 SUCCESS — row 2 is fully populated end-to-end with correct routing masks.');
    console.log('   Founder should hear audio when they play a note. Don\'t reload the preset before testing.');
  } else {
    if (empty.length > 0) {
      console.log(`⚠ ${empty.length} EMPTY cell${empty.length === 1 ? '' : 's'} in row 2:`);
      for (const c of empty) console.log(`     col ${c.col}: blockId=0 (chain broken here)`);
    }
    if (broken.length > 0) {
      console.log(`⚠ ${broken.length} cell${broken.length === 1 ? '' : 's'} with broken cable (mask=0 past col 1):`);
      for (const c of broken) console.log(`     col ${c.col}: blockId=${c.blockId} mask=0x00 (expected 0x02)`);
    }
    console.log('   Chain is broken — signal will not flow end-to-end.');
  }

  conn.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
