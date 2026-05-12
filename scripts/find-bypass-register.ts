/**
 * HW-071 — find the live bypass-read register (HW-066 follow-up).
 *
 * HW-066 confirmed `pidHigh=0x0003` is NOT the live bypass register on
 * AM4: reads at that address return a static value per block that does
 * not track bypass writes (audio + LCD + script all confirm the WRITE
 * lands; only the read is wrong). The bypass-state mapping in
 * `src/server/index.ts:1481` was deduced from HW-047 active-state-only
 * captures and never empirically validated against the bypassed state.
 *
 * This script sweeps pidHigh values at one block's pidLow looking for
 * a register whose read DOES track bypass-on / bypass-off writes.
 *
 * Method (one block — reverb, pidLow=0x0042):
 *   1. Write bypass(true) at (0x0042, 0x0003). Sleep.
 *   2. Read u32 at (0x0042, pidHigh) for every pidHigh in the sweep.
 *   3. Write bypass(false) at (0x0042, 0x0003). Sleep.
 *   4. Read u32 at (0x0042, pidHigh) for every pidHigh again.
 *   5. Diff: any pidHigh whose two reads differ is a candidate live
 *      bypass register. Reads that time out are recorded as NO_READ
 *      and flagged separately.
 *
 * Why reverb: definitely placed in Z04 (HW-064 setup), audibly bright
 * so audio truth is unambiguous, and one of the four blocks HW-064
 * specifically called out as misreporting.
 *
 * If the sweep finds a hit on reverb at pidHigh=X, sanity-check on amp
 * by setting `BLOCK_PID_LOW = 0x003a` and re-running — same pidHigh
 * should track for both blocks. If reverb returns nothing, widen the
 * pidHigh range or move to slot-position-keyed addressing
 * (pidLow=0x00CE family) as a follow-up.
 *
 * Setup:
 *   - AM4 plugged in.
 *   - Close AM4-Edit (it polls and would noise the reads).
 *   - Z04 loaded with reverb placed in the chain.
 *
 * Run:
 *   npx tsx scripts/find-bypass-register.ts
 */
import { connectAM4 } from '@/fractal/am4/midi.js';
import {
  buildReadParam,
  buildSetBlockBypass,
  isReadResponse,
  parseReadResponse,
} from '@/fractal/am4/setParam.js';

const BLOCK_PID_LOW = 0x0042; // reverb
const BLOCK_LABEL = 'reverb';
const BYPASS_WRITE_PID_HIGH = 0x0003;

const PID_HIGH_MIN = 0x0000;
const PID_HIGH_MAX = 0x002f;

const ACK_AFTER_WRITE_MS = 500;
const READ_TIMEOUT_MS = 400;
const READ_SPACING_MS = 30;

interface ReadOutcome {
  pidHigh: number;
  u32: number | 'NO_READ';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readU32(
  conn: ReturnType<typeof connectAM4>,
  pidLow: number,
  pidHigh: number,
): Promise<number | 'NO_READ'> {
  try {
    const msg = buildReadParam({ pidLow, pidHigh });
    const respPromise = conn.receiveSysExMatching(
      (resp) => isReadResponse(msg, resp),
      READ_TIMEOUT_MS,
    );
    conn.send(msg);
    const resp = await respPromise;
    return parseReadResponse(resp).asUInt32LE();
  } catch {
    return 'NO_READ';
  }
}

async function readSweep(
  conn: ReturnType<typeof connectAM4>,
): Promise<ReadOutcome[]> {
  const out: ReadOutcome[] = [];
  for (let pidHigh = PID_HIGH_MIN; pidHigh <= PID_HIGH_MAX; pidHigh++) {
    const u32 = await readU32(conn, BLOCK_PID_LOW, pidHigh);
    out.push({ pidHigh, u32 });
    await sleep(READ_SPACING_MS);
  }
  return out;
}

function fmtU32(v: number | 'NO_READ'): string {
  return v === 'NO_READ' ? 'NO_READ' : String(v);
}

async function main(): Promise<void> {
  console.log(`=== HW-071 bypass-register sweep on ${BLOCK_LABEL} (pidLow=0x${BLOCK_PID_LOW.toString(16)}) ===\n`);
  console.log(`Sweeping pidHigh 0x${PID_HIGH_MIN.toString(16).padStart(4, '0')}..0x${PID_HIGH_MAX.toString(16).padStart(4, '0')}.`);
  console.log('Two passes: one after bypass=ON write, one after bypass=OFF write.');
  console.log('Any pidHigh whose u32 differs between the two passes is a');
  console.log(`candidate live-bypass register for ${BLOCK_LABEL}.\n`);

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  let onPass: ReadOutcome[] = [];
  let offPass: ReadOutcome[] = [];

  try {
    console.log('--- Pass 1: writing bypass=ON, then reading sweep ---');
    conn.send(buildSetBlockBypass(BLOCK_PID_LOW, true));
    await sleep(ACK_AFTER_WRITE_MS);
    onPass = await readSweep(conn);
    console.log(`Read ${onPass.length} pidHighs.\n`);

    console.log('--- Pass 2: writing bypass=OFF, then reading sweep ---');
    conn.send(buildSetBlockBypass(BLOCK_PID_LOW, false));
    await sleep(ACK_AFTER_WRITE_MS);
    offPass = await readSweep(conn);
    console.log(`Read ${offPass.length} pidHighs.\n`);
  } finally {
    conn.close();
  }

  console.log('--- Full sweep table ---\n');
  console.log('pidHigh | u32 after bypass=ON | u32 after bypass=OFF | differs?');
  console.log('--------|---------------------|----------------------|---------');
  const diffs: Array<{ pidHigh: number; on: number | 'NO_READ'; off: number | 'NO_READ' }> = [];
  for (let i = 0; i < onPass.length; i++) {
    const on = onPass[i];
    const off = offPass[i];
    const differs = on.u32 !== off.u32;
    if (differs) diffs.push({ pidHigh: on.pidHigh, on: on.u32, off: off.u32 });
    const tag = differs ? '⚡ DIFF' : '';
    console.log(
      `0x${on.pidHigh.toString(16).padStart(4, '0')}  | ${fmtU32(on.u32).padEnd(19)} | ${fmtU32(off.u32).padEnd(20)} | ${tag}`,
    );
  }

  console.log('\n--- Conclusion ---\n');
  if (diffs.length === 0) {
    console.log(`No pidHigh in 0x${PID_HIGH_MIN.toString(16)}..0x${PID_HIGH_MAX.toString(16)} tracks bypass writes for ${BLOCK_LABEL}.`);
    console.log('Next step: widen the sweep, OR try slot-position addressing');
    console.log('(pidLow=0x00CE family). The live bypass state may not be');
    console.log('readable via the standard param-read at all — in which case');
    console.log('fall back to in-process state mirroring (track bypass intent');
    console.log('on the server when we issue the write, return cached state');
    console.log('from am4_get_block_bypass).');
  } else {
    console.log(`Found ${diffs.length} pidHigh(s) whose read changed between bypass states:`);
    for (const d of diffs) {
      console.log(`  pidHigh=0x${d.pidHigh.toString(16).padStart(4, '0')} — bypass=ON → ${fmtU32(d.on)}, bypass=OFF → ${fmtU32(d.off)}`);
    }
    console.log('\nMost likely live bypass register: the pidHigh where the two');
    console.log('values are most distinguishable (e.g. 0 vs 32767, or any clear');
    console.log('binary split). Sanity-check by re-running this script with');
    console.log(`BLOCK_PID_LOW set to 0x003a (amp) — the same pidHigh should`);
    console.log('track on amp too. Then update src/server/index.ts:1351\'s');
    console.log('BYPASS_STATE_PID_HIGH and confirm the encoding maps correctly.');
  }
  console.log();
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
