/**
 * HW-064 follow-up — directed read-encoding test for block bypass.
 *
 * HW-064 turn 9 surfaced a disagreement between `am4_get_block_bypass`'s
 * read result and the actual hardware audio path: reverb was audibly
 * playing on scene 1 but the read returned `bypassed`. The current
 * decode rule (`u32 === 0 → bypassed`) was inferred — HW-047 (Session
 * 43) only captured the ACTIVE state (u32 = 32767) and the bypassed-
 * state mapping was deduced by polarity inversion, never measured.
 *
 * This script measures both states empirically. For each of the four
 * blocks (amp, drive, reverb, delay), across two scenes, it:
 *
 *   1. switches scene
 *   2. writes float32(1.0) to the bypass register (intent: bypassed)
 *   3. reads pidHigh=0x0003 and prints raw u32
 *   4. writes float32(0.0) (intent: active)
 *   5. reads, prints raw u32
 *
 * Founder runs the script with audio monitoring on the AM4 and notes
 * for each (block, scene, intent) triple whether the audio path is
 * actually silent (bypassed) or playing (active). Comparing audio
 * truth to the raw u32 column tells us the actual encoding.
 *
 * **Three possible outcomes:**
 *
 *   (a) float32(1.0) → u32 = 0 (current decode is correct).
 *       Then HW-064 turn 9's reverb mismatch is NOT a polarity issue;
 *       it's something else — likely the auto-active write path in
 *       apply_preset not firing for all blocks. Run the auto-active
 *       follow-up test (TODO post-this-script).
 *   (b) float32(1.0) → u32 ≠ 0 (current decode is INVERTED).
 *       Flip `index.ts:1481` polarity. Confirm against HW-047 evidence
 *       (HW-047 said active = 32767; if bypassed also = 32767, that's
 *       garbage — investigate further).
 *   (c) Reads come back stale or scene-unscoped (same u32 across
 *       scenes / writes don't change the read).
 *       Fix the read addressing — current pidLow=blockTypeValue may
 *       be reading a different register than intended.
 *
 * **Setup before running:**
 *   - Connect AM4 via USB.
 *   - Close AM4-Edit (it polls and would noise the test).
 *   - Load a preset that has all four blocks placed (so reads return
 *     meaningful values). The script does NOT modify the working
 *     buffer's block layout; it only writes bypass flags.
 *     Z04 should already have amp/reverb/delay placed from HW-064;
 *     before running this script, manually add a drive block to
 *     slot 4 if missing, OR run apply_preset via the MCP first to
 *     place all four blocks.
 *
 * **Usage:**
 *   npx tsx scripts/decode-bypass-encoding.ts
 *
 * Output is a table of (block, scene, intent, raw_u32). Founder
 * cross-references with audio truth and replies with the mapping.
 */
import { connectAM4 } from '@mcp-midi-control/am4/midi.js';
import {
  buildReadParam,
  buildSetBlockBypass,
  buildSetParam,
  buildSwitchScene,
  isReadResponse,
  parseReadResponse,
} from 'fractal-midi/am4';
import { BLOCK_TYPE_VALUES } from 'fractal-midi/am4';

const BYPASS_PID_HIGH = 0x0003;
// Held long enough that audio truth and the front panel can be observed
// per state; reads still complete in the same window.
const ACK_WINDOW_MS = 2000;
const READ_TIMEOUT_MS = 500;

// amp.gain — used as the read-pipeline sanity check.
const AMP_GAIN_PID_LOW = 0x003a;
const AMP_GAIN_PID_HIGH = 0x000b;

const BLOCKS: Array<{ name: string; pidLow: number }> = [
  { name: 'amp', pidLow: BLOCK_TYPE_VALUES.amp },
  { name: 'drive', pidLow: BLOCK_TYPE_VALUES.drive },
  { name: 'reverb', pidLow: BLOCK_TYPE_VALUES.reverb },
  { name: 'delay', pidLow: BLOCK_TYPE_VALUES.delay },
];

const SCENES = [0, 1] as const; // scenes 1 + 2 for scoping check

interface Row {
  block: string;
  scene: number;
  intent: 'baseline' | 'bypassed' | 'active';
  rawU32: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readU32At(
  conn: ReturnType<typeof connectAM4>,
  pidLow: number,
  pidHigh: number,
): Promise<number> {
  const msg = buildReadParam({ pidLow, pidHigh });
  const respPromise = conn.receiveSysExMatching(
    (resp) => isReadResponse(msg, resp),
    READ_TIMEOUT_MS,
  );
  conn.send(msg);
  const resp = await respPromise;
  return parseReadResponse(resp).asUInt32LE();
}

async function readBypassU32(
  conn: ReturnType<typeof connectAM4>,
  pidLow: number,
): Promise<number> {
  return readU32At(conn, pidLow, BYPASS_PID_HIGH);
}

async function ampGainSanity(
  conn: ReturnType<typeof connectAM4>,
): Promise<{ readBefore: number; readAfter: number; differs: boolean }> {
  // Write a known gain (2.5), then a different one (8.0), reading after each.
  // If the read pipeline works, the two u32s differ. If they're identical,
  // reads are broken globally — bypass test results would be inconclusive.
  conn.send(buildSetParam('amp.gain', 2.5));
  await sleep(ACK_WINDOW_MS);
  const readBefore = await readU32At(conn, AMP_GAIN_PID_LOW, AMP_GAIN_PID_HIGH);

  conn.send(buildSetParam('amp.gain', 8.0));
  await sleep(ACK_WINDOW_MS);
  const readAfter = await readU32At(conn, AMP_GAIN_PID_LOW, AMP_GAIN_PID_HIGH);

  return { readBefore, readAfter, differs: readBefore !== readAfter };
}

async function main(): Promise<void> {
  console.log('=== HW-064 follow-up: directed bypass-encoding test ===\n');
  console.log('Setup check: load a preset with amp + drive + reverb + delay placed.');
  console.log('If any block is missing, the read will return whatever firmware');
  console.log('happens to have for that pidLow (no audio meaning) — the test row');
  console.log('for that block is unreliable. HW-064 Z04 has amp/reverb/delay;');
  console.log('add drive to slot 4 first if you haven\'t.\n');

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  const rows: Row[] = [];
  let gainSanity: { readBefore: number; readAfter: number; differs: boolean } | undefined;

  try {
    // ─── Pipeline sanity check ───────────────────────────────────────────
    // Confirms the read pipeline itself works against a known-good param
    // (amp.gain). If two writes of different values produce two different
    // reads, reads work. If they produce the same read, reads are broken
    // GLOBALLY — and any conclusion about the bypass register would be
    // tainted by a separate read bug. Run this first.
    console.log('--- Step 1/3 — read pipeline sanity check (amp.gain) ---');
    console.log('Writing amp.gain=2.5, then amp.gain=8.0, reading after each.');
    console.log('You should hear the amp gain shift between low and high. If reads');
    console.log('return different u32s, the pipeline works and we trust the bypass');
    console.log('test below.\n');
    gainSanity = await ampGainSanity(conn);
    console.log(`  amp.gain after 2.5 → u32=${gainSanity.readBefore}`);
    console.log(`  amp.gain after 8.0 → u32=${gainSanity.readAfter}`);
    console.log(`  pipeline works: ${gainSanity.differs ? 'YES ✅' : 'NO ❌ (reads are stale globally — stop here)'}\n`);

    if (!gainSanity.differs) {
      console.log('Halting: reads are not tracking writes for amp.gain either.');
      console.log('This isn\'t a bypass-decode issue — it\'s a read-pipeline issue.');
      console.log('Try `reconnect_midi`, then re-run.\n');
      return;
    }

    // ─── Step 2 ─────────────────────────────────────────────────────────
    console.log('--- Step 2/3 — bypass writes + reads, slow walk ---');
    console.log('Each block holds bypassed for 2s, then active for 2s. For each');
    console.log('state, watch the AM4 LCD\'s bypass indicator AND listen to the');
    console.log('audio. If both flip on each write, the WRITE side is fine and');
    console.log('the read u32 below is the only thing left to interpret.\n');

    for (const sceneIndex of SCENES) {
      console.log(`>>> Scene ${sceneIndex + 1} (wire index ${sceneIndex})`);
      conn.send(buildSwitchScene(sceneIndex));
      await sleep(ACK_WINDOW_MS);

      for (const block of BLOCKS) {
        // Baseline read (before any bypass write to this block this scene)
        const u32Baseline = await readBypassU32(conn, block.pidLow);
        rows.push({ block: block.name, scene: sceneIndex + 1, intent: 'baseline', rawU32: u32Baseline });
        console.log(`  ${block.name.padEnd(7)} | baseline (no write yet)        → u32=${u32Baseline}`);

        // Bypass ON
        console.log(`  ${block.name.padEnd(7)} | writing float32(1.0) — listen: ${block.name} should go SILENT for 2s, LCD bypass indicator should turn ON.`);
        conn.send(buildSetBlockBypass(block.pidLow, true));
        await sleep(ACK_WINDOW_MS);
        const u32After1 = await readBypassU32(conn, block.pidLow);
        rows.push({ block: block.name, scene: sceneIndex + 1, intent: 'bypassed', rawU32: u32After1 });
        console.log(`  ${block.name.padEnd(7)} | after float32(1.0)             → u32=${u32After1}`);

        // Bypass OFF
        console.log(`  ${block.name.padEnd(7)} | writing float32(0.0) — listen: ${block.name} should come BACK for 2s, LCD bypass indicator should turn OFF.`);
        conn.send(buildSetBlockBypass(block.pidLow, false));
        await sleep(ACK_WINDOW_MS);
        const u32After0 = await readBypassU32(conn, block.pidLow);
        rows.push({ block: block.name, scene: sceneIndex + 1, intent: 'active', rawU32: u32After0 });
        console.log(`  ${block.name.padEnd(7)} | after float32(0.0)             → u32=${u32After0}\n`);
      }
    }
  } finally {
    conn.close();
  }

  // ─── Step 3 ───────────────────────────────────────────────────────────
  console.log('--- Step 3/3 — summary table ---\n');
  console.log('block   | scene | state                     | read u32   | current decode says');
  console.log('--------|-------|---------------------------|------------|--------------------');
  for (const r of rows) {
    const stateLabel =
      r.intent === 'baseline' ? 'baseline (no write)' :
      r.intent === 'bypassed' ? 'after float32(1.0) bypass' :
                                'after float32(0.0) active';
    const currentDecode = r.rawU32 === 0 ? 'bypassed' : 'active';
    console.log(
      `${r.block.padEnd(7)} | ${String(r.scene).padEnd(5)} | ${stateLabel.padEnd(25)} | ${String(r.rawU32).padEnd(10)} | ${currentDecode}`,
    );
  }

  console.log('\n--- Conclusion key ---\n');
  console.log('Pipeline sanity (amp.gain): ' + (gainSanity?.differs ? 'works ✅' : 'BROKEN ❌'));
  console.log('Per-block: compare baseline vs after-1.0 vs after-0.0 u32s.\n');
  console.log('  • If all three u32s are IDENTICAL within a block → that block\'s');
  console.log('    bypass register is unresponsive to writes. The read at');
  console.log('    pidHigh=0x0003 is reading a static value (likely a firmware');
  console.log('    default or a different register entirely). Fix path: find');
  console.log('    the actual live-bypass register — try nearby pidHighs');
  console.log('    (0x0002, 0x0004) or slot-position addressing.');
  console.log('  • If after-1.0 and after-0.0 differ but baseline matches one of');
  console.log('    them → reads ARE tracking writes. Compare to audio truth:');
  console.log('       - audio matches current decode → done, no fix needed.');
  console.log('       - audio inverted from current decode → polarity flip at');
  console.log('         src/server/index.ts:1481 (`u32 === 0` → `u32 !== 0`).\n');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
