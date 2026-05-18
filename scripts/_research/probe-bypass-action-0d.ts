/**
 * HW-066 — directed test: read bypass register with action=0x0d.
 *
 * Earlier sub-tests proved (block_pidLow, pidHigh=0x0003) is the right
 * write address — bypass writes there land on the audio engine and on
 * the front panel — but reads at the same address using action=0x0e
 * return a static value per block that doesn't track the writes.
 *
 * Capture analysis of `session-46-front-panel-dly-rev-bypass.pcapng`
 * showed AM4-Edit polls the same address with **action=0x0d** and gets
 * a 64-byte response (vs our 0x0e reader's 23-byte response). The
 * 0x0d response payload appears to track bypass state: rough byte
 * patterns for delay's bypass register were ON ~ 0x3035 in bytes 2-3,
 * OFF ~ 0x0001 in bytes 2-3.
 *
 * This script measures it cleanly. For each of amp/drive/reverb/delay,
 * scenes 1+2:
 *   1. Switch scene.
 *   2. Write bypass=ON. Sleep 500 ms.
 *   3. Send a read at (block_pidLow, 0x0003) with action=0x0d.
 *   4. Capture the FULL response (any length) and print as hex.
 *   5. Write bypass=OFF. Sleep 500 ms.
 *   6. Read again, capture, print.
 *   7. Diff the two captured response bytes; highlight every byte
 *      offset whose value differs between ON and OFF.
 *
 * The byte offsets that change consistently across all 4 blocks
 * (and consistently between ON and OFF) are the bypass-state
 * encoding bytes. Once identified, we can write a parser for the
 * 0x0d response shape and switch `am4_get_block_bypass` to use it.
 *
 * Setup:
 *   - AM4 plugged in.
 *   - Close AM4-Edit (otherwise its polling will mix with ours).
 *   - Z04 loaded with amp / reverb / delay placed (HW-064 setup).
 *     Drive may or may not be placed; if not, drive's row is still
 *     informative — it tells us whether the read register encodes
 *     placement vs bypass.
 *
 * Run:
 *   npx tsx scripts/probe-bypass-action-0d.ts
 */
import { connectAM4 } from '@mcp-midi-control/am4/midi.js';
import {
  buildReadParam,
  buildSetBlockBypass,
  buildSwitchScene,
} from 'fractal-midi/am4';
import { BLOCK_TYPE_VALUES } from 'fractal-midi/am4';

const BYPASS_PID_HIGH = 0x0003;
const READ_ACTION = 0x0d;
const ACK_AFTER_WRITE_MS = 500;
const READ_TIMEOUT_MS = 600;

const BLOCKS: Array<{ name: string; pidLow: number }> = [
  { name: 'amp',    pidLow: BLOCK_TYPE_VALUES.amp },
  { name: 'drive',  pidLow: BLOCK_TYPE_VALUES.drive },
  { name: 'reverb', pidLow: BLOCK_TYPE_VALUES.reverb },
  { name: 'delay',  pidLow: BLOCK_TYPE_VALUES.delay },
];

const SCENES = [0, 1] as const;

interface Reading {
  block: string;
  scene: number;
  intent: 'bypassed' | 'active';
  bytes: number[];
}

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const FRACTAL_MFR = [0x00, 0x01, 0x74];
const AM4_MODEL = 0x15;
const FUNC_PARAM_RW = 0x01;

/**
 * Predicate: accepts ANY 0x01 read response from the AM4 to our request,
 * regardless of length, as long as the envelope and the request-echoed
 * fields (pidLow, pidHigh, action) match the outgoing read.
 */
function makeAnyReadResponseMatcher(read: number[]): (resp: number[]) => boolean {
  return (resp) => {
    if (resp.length < 17) return false;
    if (resp[0] !== SYSEX_START || resp[resp.length - 1] !== SYSEX_END) return false;
    if (resp[1] !== FRACTAL_MFR[0] || resp[2] !== FRACTAL_MFR[1] || resp[3] !== FRACTAL_MFR[2]) return false;
    if (resp[4] !== AM4_MODEL || resp[5] !== FUNC_PARAM_RW) return false;
    // pidLow (6..7), pidHigh (8..9), action (10..11) must echo the request.
    for (let i = 6; i < 12; i++) if (resp[i] !== read[i]) return false;
    return true;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readRaw(
  conn: ReturnType<typeof connectAM4>,
  pidLow: number,
): Promise<number[]> {
  const msg = buildReadParam({ pidLow, pidHigh: BYPASS_PID_HIGH }, READ_ACTION);
  const respPromise = conn.receiveSysExMatching(makeAnyReadResponseMatcher(msg), READ_TIMEOUT_MS);
  conn.send(msg);
  return respPromise;
}

function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function diffOffsets(a: number[], b: number[]): number[] {
  const out: number[] = [];
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

function annotateDiff(bytes: number[], diffOffs: number[]): string {
  return bytes
    .map((b, i) => {
      const h = b.toString(16).padStart(2, '0');
      return diffOffs.includes(i) ? `[${h}]` : h;
    })
    .join(' ');
}

async function main(): Promise<void> {
  console.log('=== HW-066 / action=0x0d bypass-read probe ===\n');
  console.log('Reads at (block_pidLow, pidHigh=0x0003) using action 0x0d');
  console.log('(AM4-Edit\'s polling action). Prints full response as hex,');
  console.log('then diffs ON vs OFF to identify bypass-encoding bytes.\n');

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  const readings: Reading[] = [];

  try {
    for (const sceneIndex of SCENES) {
      console.log(`>>> Scene ${sceneIndex + 1} (wire index ${sceneIndex})`);
      conn.send(buildSwitchScene(sceneIndex));
      await sleep(ACK_AFTER_WRITE_MS);

      for (const block of BLOCKS) {
        // Bypass ON
        conn.send(buildSetBlockBypass(block.pidLow, true));
        await sleep(ACK_AFTER_WRITE_MS);
        let onResp: number[];
        try {
          onResp = await readRaw(conn, block.pidLow);
        } catch (err) {
          console.log(`  ${block.name.padEnd(7)} | ON  → READ FAILED: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        readings.push({ block: block.name, scene: sceneIndex + 1, intent: 'bypassed', bytes: onResp });
        console.log(`  ${block.name.padEnd(7)} | ON  (${onResp.length}B) | ${hex(onResp)}`);

        // Bypass OFF
        conn.send(buildSetBlockBypass(block.pidLow, false));
        await sleep(ACK_AFTER_WRITE_MS);
        let offResp: number[];
        try {
          offResp = await readRaw(conn, block.pidLow);
        } catch (err) {
          console.log(`  ${block.name.padEnd(7)} | OFF → READ FAILED: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        readings.push({ block: block.name, scene: sceneIndex + 1, intent: 'active', bytes: offResp });
        console.log(`  ${block.name.padEnd(7)} | OFF (${offResp.length}B) | ${hex(offResp)}`);

        // Per-pair diff
        const diffs = diffOffsets(onResp, offResp);
        if (diffs.length === 0) {
          console.log(`  ${block.name.padEnd(7)} | DIFF: identical responses ❌ (read still doesn't track bypass with action=0x0d)`);
        } else {
          console.log(`  ${block.name.padEnd(7)} | DIFF: byte offsets [${diffs.join(', ')}] differ ✅`);
          console.log(`  ${block.name.padEnd(7)} | ON  annotated: ${annotateDiff(onResp, diffs)}`);
          console.log(`  ${block.name.padEnd(7)} | OFF annotated: ${annotateDiff(offResp, diffs)}`);
        }
        console.log();
      }
    }
  } finally {
    conn.close();
  }

  // ─── Cross-block diff: which offsets change consistently? ──────────────
  console.log('--- Cross-block diff summary ---\n');
  const offsetCounts = new Map<number, number>();
  let pairsExamined = 0;

  for (let i = 0; i + 1 < readings.length; i += 2) {
    const a = readings[i];
    const b = readings[i + 1];
    if (a.block !== b.block || a.scene !== b.scene) continue;
    pairsExamined++;
    for (const off of diffOffsets(a.bytes, b.bytes)) {
      offsetCounts.set(off, (offsetCounts.get(off) ?? 0) + 1);
    }
  }

  console.log(`Examined ${pairsExamined} (ON, OFF) pairs across all blocks/scenes.`);
  if (offsetCounts.size === 0) {
    console.log('No offsets ever changed between bypass ON and OFF.');
    console.log('Action 0x0d is also not the right read — investigate further');
    console.log('(slot-position keyed addressing, or device-pushed events).\n');
    return;
  }

  console.log('Offsets that changed and how often (most consistent first):\n');
  const sorted = [...offsetCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [off, count] of sorted) {
    const fraction = `${count}/${pairsExamined}`;
    const tag = count === pairsExamined ? ' ⭐ universal' : '';
    console.log(`  byte ${off.toString().padStart(2)}: changed in ${fraction} pairs${tag}`);
  }

  console.log('\nConclusion key:');
  console.log('  • Offsets marked ⭐ are the bypass-encoding bytes — they');
  console.log('    flipped between ON/OFF for every block tested.');
  console.log('  • If exactly 4 contiguous offsets are universal, that\'s a');
  console.log('    32-bit field — likely the same Q15-style encoding used by');
  console.log('    other params. Read the 4-byte LE u32 at that offset to');
  console.log('    decode bypass state.');
  console.log('  • Compare the universal offsets\' ON-value vs OFF-value across');
  console.log('    blocks: if the SAME value-pair holds for every block, that\'s');
  console.log('    the encoding. If it differs by block, the encoding may be');
  console.log('    block-type-dependent (less likely).\n');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
