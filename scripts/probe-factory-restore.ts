/**
 * Factory-restore feasibility probe (research-only, dry-run by default).
 *
 * Goal: prove we can replay a single factory preset's stored bytes back to
 * the AM4 to reset that preset location to factory state. The factory bank
 * file `samples/factory/AM4-Factory-Presets-1p01.syx` (1,284,608 bytes =
 * 104 x 12,352) is a clean concatenation of all 104 factory preset dumps in
 * the documented 0x77 / 0x78 / 0x79 envelope (SYSEX-MAP.md §10b).
 *
 * What this script does:
 *
 *   1. Parse the factory bank with the project's `parsePresetBank` helper.
 *      That validates every envelope and every Fractal XOR checksum, so a
 *      successful parse already proves the file is structurally sound.
 *   2. Print a per-slot summary table: bank/sub-index decoded from the 0x77
 *      header, the sentinel byte values, the chunk count, and the byte
 *      length per slot.
 *   3. For the target slot (default Z04), print every SysEx message that
 *      WOULD be sent to the device, byte-by-byte, with a "WOULD SEND"
 *      prefix and the wait recommendation between messages.
 *   4. With `--send` AND an explicit `--slot=...`, actually transmit those
 *      bytes to the AM4 via `connectAM4`. NO `--send` = NO MIDI port.
 *
 * Hard rules baked in:
 *
 *   - Default mode is dry-run. The MIDI port is not opened unless
 *     `--send` is set. (The founder is currently running HW-068 against
 *     the same hardware; do not contend for the port.)
 *   - In `--send` mode, the slot must be passed explicitly via
 *     `--slot=A01..Z04`. There is no implicit Z04 default in send mode.
 *   - One slot per invocation. There is no "send all 104" option.
 *   - Exit code is non-zero on any structural anomaly (bad checksum,
 *     wrong model byte, header count != 104, ...).
 *
 * Run:
 *
 *   # dry-run, default Z04
 *   npx tsx scripts/probe-factory-restore.ts
 *
 *   # dry-run, peek at A01
 *   npx tsx scripts/probe-factory-restore.ts --slot=A01
 *
 *   # actually send (founder only, when no other AM4 work is in flight)
 *   npx tsx scripts/probe-factory-restore.ts --send --slot=Z04
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  HEADER_LEN,
  CHUNK_LEN,
  FOOTER_LEN,
  CHUNKS_PER_PRESET,
  PRESET_DUMP_LEN,
  parsePresetBank,
  type ParsedPresetDump,
} from '@/fractal/am4/presetDump.js';
import {
  TOTAL_LOCATIONS,
  formatLocationCode,
  parseLocationCode,
} from '@/fractal/am4/locations.js';
import {
  buildGetPresetName,
  parseGetPresetNameResponse,
} from '@/fractal/am4/setParam.js';
import type { MidiConnection } from '@/fractal/am4/midi.js';

const BANK_PATH = 'samples/factory/AM4-Factory-Presets-1p01.syx';

/**
 * Recommended inter-message delay. The Fractal Presets Update Guide
 * leaves Fractal-Bot in charge of pacing, so we do not have a documented
 * minimum. 30 ms is well clear of the AM4's observed 30-60 ms ack window
 * (CLAUDE.md performance budget) and matches the conservative pacing
 * other write probes in this repo use. Adjust upward if the device
 * NACKs in `--send` mode.
 */
const INTER_MESSAGE_DELAY_MS = 30;

/**
 * Pause between slots in --range mode. The device needs a breath after a
 * full 6-message dump finishes (it's writing flash). Empirically the
 * 500 ms initial value was NOT enough: hardware testing 2026-05-08 over a
 * 20-slot G01..K04 range saw ~9 of 20 slots fail with timeouts or silent
 * non-landing dumps. Bumping to 1500 ms gives flash significantly more
 * breathing room between dumps; the 20-slot batch goes from ~20 s to ~40 s
 * wall time, which is fine for a setup-time operation. Adjust further if
 * the device still shows signs of stress.
 */
const INTER_SLOT_DELAY_MS = 1500;

/**
 * Retry a post-restore name read once after this delay if the first read
 * times out. Empirically the device sometimes goes briefly unresponsive
 * for ~200-500 ms after absorbing a dump while flash settles; a single
 * retry recovers cleanly without false-flagging the slot as a hard
 * failure.
 */
const POST_READ_RETRY_DELAY_MS = 500;

interface CliArgs {
  slot: string; // canonical "A01".."Z04"
  slotExplicit: boolean;
  range: { from: string; to: string } | undefined;
  send: boolean;
}

function parseCli(argv: string[]): CliArgs {
  let slot = 'Z04';
  let slotExplicit = false;
  let range: { from: string; to: string } | undefined;
  let send = false;
  for (const arg of argv) {
    if (arg === '--send') {
      send = true;
    } else if (arg.startsWith('--slot=')) {
      const raw = arg.slice('--slot='.length).trim();
      if (raw === '') {
        throw new Error('--slot= was empty. Pass e.g. --slot=Z04');
      }
      // Validate via parseLocationCode and re-emit the canonical 3-char
      // form so the rest of the script speaks one shape.
      slot = formatLocationCode(parseLocationCode(raw));
      slotExplicit = true;
    } else if (arg.startsWith('--range=')) {
      const raw = arg.slice('--range='.length).trim();
      const parts = raw.split('..');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `--range= must be FROM..TO (e.g. --range=G01..K04). Got: ${raw}`,
        );
      }
      const fromCanon = formatLocationCode(parseLocationCode(parts[0]));
      const toCanon = formatLocationCode(parseLocationCode(parts[1]));
      if (parseLocationCode(fromCanon) > parseLocationCode(toCanon)) {
        throw new Error(`--range FROM > TO: ${fromCanon} > ${toCanon}`);
      }
      range = { from: fromCanon, to: toCanon };
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(
        `Unknown argument: ${arg}. Run with --help for usage.`,
      );
    }
  }
  if (range && slotExplicit) {
    throw new Error(
      '--range and --slot are mutually exclusive. Pass one or the other.',
    );
  }
  return { slot, slotExplicit, range, send };
}

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/probe-factory-restore.ts [--slot=<A01..Z04> | --range=FROM..TO] [--send]

  --slot=<code>      Target single preset location. Default Z04 in dry-run; required in --send mode.
  --range=FROM..TO   Target a contiguous range, e.g. --range=G01..K04 (20 slots). Mutually exclusive with --slot.
  --send             Actually transmit bytes to the AM4. Default OFF (dry-run).
  --help, -h         Show this help.

Behaviour:
  * Dry-run (no --send) is read-only: it parses the factory bank, prints a
    summary table, and prints the "WOULD SEND" byte sequence for the chosen
    slot or the slot list for the chosen range. The MIDI port is NOT opened.
  * Send mode requires an explicit --slot or --range. There is no implicit default.
  * Range mode restores every slot in the range to its factory state, in order,
    with a 500 ms pause between slots so the device has time to flush flash.

Examples:
  # Dry-run, default Z04
  npx tsx scripts/probe-factory-restore.ts

  # Dry-run, peek at A01
  npx tsx scripts/probe-factory-restore.ts --slot=A01

  # Restore one slot to factory
  npx tsx scripts/probe-factory-restore.ts --send --slot=Z04

  # Reset banks G through K (20 slots) to factory before re-running a setlist test
  npx tsx scripts/probe-factory-restore.ts --send --range=G01..K04`);
}

function hex(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase();
}

function hexSlice(bytes: Uint8Array, max = 32): string {
  if (bytes.length <= max) return Array.from(bytes).map(hex).join(' ');
  const head = Array.from(bytes.slice(0, max)).map(hex).join(' ');
  return `${head} ... (${bytes.length - max} more bytes)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Inter-message delay between the restore stream and the post-restore
 * name read. Gives the device a moment to commit the flash write before
 * we ask it what's at the slot. 100 ms is conservative; the AM4's
 * documented ack window is 30-60 ms.
 */
const POST_RESTORE_VERIFY_DELAY_MS = 100;

/** Timeout for the verification name read. Matches the production tool. */
const VERIFY_READ_TIMEOUT_MS = 300;

/**
 * Read the preset name at `locationIndex` via the same wire command the
 * production `am4_get_preset_name` tool uses. Returns "<EMPTY>" for
 * empty slots and "<read-failed>" on timeout / decode failure (so a
 * verification mismatch surfaces clearly without the script aborting).
 */
async function readPresetNameSafeOnce(
  conn: MidiConnection,
  locationIndex: number,
): Promise<string> {
  const bytes = buildGetPresetName(locationIndex);
  const predicate = (resp: number[]): boolean => {
    if (resp.length < 16) return false;
    for (let i = 0; i < 6; i++) if (resp[i] !== bytes[i]) return false;
    return true;
  };
  try {
    const respPromise = conn.receiveSysExMatching(predicate, VERIFY_READ_TIMEOUT_MS);
    conn.send(bytes);
    const resp = await respPromise;
    const parsed = parseGetPresetNameResponse(resp, locationIndex);
    return parsed.isEmpty ? '<EMPTY>' : parsed.name;
  } catch {
    return '<read-failed>';
  }
}

/**
 * Read the preset name with one retry on timeout. Empirically the AM4
 * sometimes goes briefly unresponsive (~200-500 ms) right after absorbing
 * a 6-message factory-restore dump while flash settles. A single retry
 * after `POST_READ_RETRY_DELAY_MS` recovers cleanly without false-flagging
 * the slot as a hard failure (hardware testing 2026-05-08, range G01..K04
 * showed multiple slots time out on first read but respond fine on a
 * follow-up). Returns "<read-failed>" only after both attempts fail.
 */
async function readPresetNameSafe(
  conn: MidiConnection,
  locationIndex: number,
): Promise<string> {
  const first = await readPresetNameSafeOnce(conn, locationIndex);
  if (first !== '<read-failed>') return first;
  await sleep(POST_READ_RETRY_DELAY_MS);
  return readPresetNameSafeOnce(conn, locationIndex);
}

type VerifyStatus = 'ok' | 'fail' | 'unverified';

interface SlotVerifyOutcome {
  status: VerifyStatus;
  pre: string;
  post: string;
  message: string;
}

/**
 * Compare pre/post-restore name reads. Three-state outcome:
 *
 *   ok          - pre readable, post readable, post differs from pre
 *   fail        - timeout, EMPTY post, or pre==post on a user-modified pre
 *   unverified  - pre-read failed (with retry), can't confirm a change
 *                 even though post may look fine. Common at the start of a
 *                 batch (USB still settling) or right after the device went
 *                 transiently unresponsive on the previous slot.
 *
 * Hardware testing 2026-05-08 showed the original 2-state classifier
 * false-positively reported "ok" when pre-read had failed but post-read
 * happened to return a user save name from a prior write that the
 * restore actually didn't land. The unverified state surfaces those
 * cases so the founder can re-run them.
 */
function classifyVerifyOutcome(pre: string, post: string): SlotVerifyOutcome {
  if (post === '<read-failed>') {
    return {
      status: 'fail',
      pre,
      post,
      message: 'verification timeout: post-restore name read failed (after retry). Restore status unknown.',
    };
  }
  if (post === '<EMPTY>') {
    return {
      status: 'fail',
      pre,
      post,
      message: 'verification failure: post-restore name is <EMPTY>. Factory presets are never empty - restore did not land.',
    };
  }
  if (pre === '<read-failed>') {
    return {
      status: 'unverified',
      pre,
      post,
      message: `unverified: pre-restore name read failed; post-restore name is "${post}". Cannot confirm restore landed - re-run this slot in isolation if it matters.`,
    };
  }
  if (
    pre !== '<EMPTY>'
    && pre.trim().toLowerCase() === post.trim().toLowerCase()
  ) {
    return {
      status: 'fail',
      pre,
      post,
      message: `verification mismatch: pre-restore = "${pre}", post-restore = "${post}", expected change. Restore likely did not land OR slot was already factory (probe cannot disambiguate without bank-file name decode - tracked as v0.1.x follow-up).`,
    };
  }
  return {
    status: 'ok',
    pre,
    post,
    message: `verified: pre="${pre}" -> post="${post}"`,
  };
}

/**
 * Slice the bank's per-preset bytes back out of the source buffer. The
 * `parsed` value's payload arrays are slices of the source, so we use the
 * outer index instead of re-emitting via `serializePresetDump` (which
 * would also work and is byte-identical per the verify-preset-dump
 * golden, but slicing the original bytes keeps "what the file contains
 * vs what we send" trivially the same artefact).
 */
function bankSliceForIndex(bank: Uint8Array, index: number): Uint8Array {
  return bank.subarray(index * PRESET_DUMP_LEN, (index + 1) * PRESET_DUMP_LEN);
}

/**
 * Cut one preset's slice into its 6 individual SysEx messages: 1 header,
 * 4 chunks, 1 footer. Each is a byte-identical view onto the source slice.
 */
function splitMessages(presetSlice: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let cursor = 0;
  out.push(presetSlice.subarray(cursor, cursor + HEADER_LEN));
  cursor += HEADER_LEN;
  for (let i = 0; i < CHUNKS_PER_PRESET; i++) {
    out.push(presetSlice.subarray(cursor, cursor + CHUNK_LEN));
    cursor += CHUNK_LEN;
  }
  out.push(presetSlice.subarray(cursor, cursor + FOOTER_LEN));
  return out;
}

interface PerSlotSummary {
  slotIndex: number;
  code: string;
  bankByte: number;
  subByte: number;
  trailerBytes: string; // payload[2..4] as hex string
  totalBytes: number;
  messageCount: number;
}

function summarizeBank(presets: ParsedPresetDump[]): PerSlotSummary[] {
  return presets.map((p, i) => ({
    slotIndex: i,
    code: formatLocationCode(i),
    bankByte: p.headerPayload[0],
    subByte: p.headerPayload[1],
    trailerBytes: Array.from(p.headerPayload.slice(2, 5)).map(hex).join(' '),
    totalBytes: p.raw.length,
    messageCount: 1 + CHUNKS_PER_PRESET + 1, // header + chunks + footer
  }));
}

function printSummary(summaries: PerSlotSummary[]): void {
  console.log('Per-slot summary (104 expected):');
  console.log('  idx  code  bank  sub   trailer       bytes   msgs');
  // Print the first 4 (one bank), an ellipsis, and the last 4. Full table
  // is too noisy for a probe-output console; the structural-anomaly check
  // covers the middle implicitly.
  const head = summaries.slice(0, 4);
  const tail = summaries.slice(summaries.length - 4);
  for (const s of head) {
    console.log(
      `  ${String(s.slotIndex).padStart(3)}  ${s.code}   0x${hex(s.bankByte)}  0x${hex(s.subByte)}  ${s.trailerBytes}   ${s.totalBytes}   ${s.messageCount}`,
    );
  }
  console.log('  ...');
  for (const s of tail) {
    console.log(
      `  ${String(s.slotIndex).padStart(3)}  ${s.code}   0x${hex(s.bankByte)}  0x${hex(s.subByte)}  ${s.trailerBytes}   ${s.totalBytes}   ${s.messageCount}`,
    );
  }
}

interface StructuralChecks {
  ok: boolean;
  problems: string[];
  uniqueTrailers: Set<string>;
  nonAm4Headers: number;
  badBanks: number;
  badSubs: number;
  ordering: 'monotonic' | 'non-monotonic';
}

function structuralChecks(
  summaries: PerSlotSummary[],
  presets: ParsedPresetDump[],
): StructuralChecks {
  const problems: string[] = [];
  const uniqueTrailers = new Set<string>();
  let nonAm4Headers = 0;
  let badBanks = 0;
  let badSubs = 0;

  for (const s of summaries) {
    uniqueTrailers.add(s.trailerBytes);
    if (s.bankByte > 25) badBanks++;
    if (s.subByte > 3) badSubs++;
    if (s.totalBytes !== PRESET_DUMP_LEN) {
      problems.push(`slot ${s.code}: total bytes ${s.totalBytes} != ${PRESET_DUMP_LEN}`);
    }
  }

  if (presets.length !== TOTAL_LOCATIONS) {
    problems.push(`preset count ${presets.length} != ${TOTAL_LOCATIONS}`);
  }

  let monotonic = true;
  for (let i = 0; i < summaries.length; i++) {
    const expectedBank = Math.floor(i / 4);
    const expectedSub = i % 4;
    if (summaries[i].bankByte !== expectedBank || summaries[i].subByte !== expectedSub) {
      monotonic = false;
      break;
    }
  }

  // The 0x7F sentinel is what an *active-buffer* export emits in payload[0].
  // The factory bank should never contain it; flag if seen.
  for (const s of summaries) {
    if (s.bankByte === 0x7f) {
      problems.push(`slot ${s.code}: header bank byte is 0x7F (active sentinel) — not expected in a stored bank`);
      nonAm4Headers++;
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    uniqueTrailers,
    nonAm4Headers,
    badBanks,
    badSubs,
    ordering: monotonic ? 'monotonic' : 'non-monotonic',
  };
}

async function main(): Promise<number> {
  console.log('=== AM4 factory-restore probe (research-only) ===\n');

  const args = parseCli(process.argv.slice(2));

  if (!existsSync(BANK_PATH)) {
    console.error(`FAIL: factory bank not found at ${BANK_PATH}`);
    console.error('See samples/factory/README.md for download instructions.');
    return 2;
  }

  const bank = new Uint8Array(readFileSync(BANK_PATH));
  console.log(`Loaded ${BANK_PATH}`);
  console.log(`  size:           ${bank.length} bytes`);
  console.log(`  expected size:  ${TOTAL_LOCATIONS * PRESET_DUMP_LEN} bytes (104 x ${PRESET_DUMP_LEN})`);
  if (bank.length !== TOTAL_LOCATIONS * PRESET_DUMP_LEN) {
    console.error('FAIL: bank file size is not 104 x 12,352. Refusing to proceed.');
    return 3;
  }

  let presets: ParsedPresetDump[];
  try {
    presets = parsePresetBank(bank);
  } catch (e) {
    console.error('FAIL: parsePresetBank rejected the file.');
    console.error('  ' + (e instanceof Error ? e.message : String(e)));
    return 4;
  }
  console.log(`  parsed:         ${presets.length} preset dumps (every envelope + checksum validated)\n`);

  const summaries = summarizeBank(presets);
  printSummary(summaries);
  console.log();

  const checks = structuralChecks(summaries, presets);
  console.log('Structural checks:');
  console.log(`  preset count       = ${presets.length}                    (expect 104)`);
  console.log(`  ordering           = ${checks.ordering}             (expect monotonic A01..Z04)`);
  console.log(`  bank-byte range    = bad rows: ${checks.badBanks}             (expect 0)`);
  console.log(`  sub-byte range     = bad rows: ${checks.badSubs}             (expect 0)`);
  console.log(`  active sentinels   = ${checks.nonAm4Headers}                    (expect 0 in a stored bank)`);
  console.log(`  unique trailers    = ${checks.uniqueTrailers.size}                    (expect 1 — '00 20 00')`);
  if (!checks.ok) {
    console.error('\nStructural anomalies:');
    for (const p of checks.problems) console.error(`  - ${p}`);
    return 5;
  }
  console.log('  all green.\n');

  // ---- Range mode: reset every slot in [from..to] to factory --------------

  if (args.range) {
    const fromIdx = parseLocationCode(args.range.from);
    const toIdx = parseLocationCode(args.range.to);
    const slotCount = toIdx - fromIdx + 1;

    console.log(`Range: ${args.range.from}..${args.range.to} (${slotCount} slots, indices ${fromIdx}..${toIdx})`);
    console.log('Slots:');
    for (let i = fromIdx; i <= toIdx; i++) {
      const code = formatLocationCode(i);
      const slice = bankSliceForIndex(bank, i);
      console.log(`  ${code} (${slice.length}B, 6 messages)`);
    }
    console.log();

    if (!args.send) {
      const totalMessages = slotCount * (1 + CHUNKS_PER_PRESET + 1);
      const wireMs =
        slotCount * (1 + CHUNKS_PER_PRESET + 1 - 1) * INTER_MESSAGE_DELAY_MS +
        (slotCount - 1) * INTER_SLOT_DELAY_MS;
      console.log(`(dry-run) Would send ${totalMessages} messages total across ${slotCount} slots.`);
      console.log(`(dry-run) Estimated wall time: ~${(wireMs / 1000).toFixed(1)} s of pacing alone (plus per-message wire time).`);
      console.log(`(dry-run) Re-run with --send --range=${args.range.from}..${args.range.to} to transmit.`);
      console.log('(dry-run) MIDI port was NOT opened.');
      return 0;
    }

    console.log(`!!! --send is set. Restoring ${slotCount} slots (${args.range.from}..${args.range.to}) to factory state. !!!`);
    console.log(`!!! This OVERWRITES whatever is currently stored at every slot in that range. !!!`);
    console.log('!!! Make sure no other tool / probe / AM4-Edit session is talking to the device. !!!\n');

    const { connectAM4 } = await import('@/fractal/am4/midi.js');
    const conn = connectAM4();
    const failures: { slot: string; message: string; pre: string; post: string }[] = [];
    const unverified: { slot: string; message: string; pre: string; post: string }[] = [];
    let verified = 0;
    try {
      for (let i = fromIdx; i <= toIdx; i++) {
        const code = formatLocationCode(i);
        const slice = bankSliceForIndex(bank, i);
        const msgs = splitMessages(slice);
        const slotNum = i - fromIdx + 1;
        process.stdout.write(`[${slotNum}/${slotCount}] Restoring ${code}... `);
        // Pre-restore name read: cheap (~50 ms) and the only signal we
        // have that the restore actually landed without decoding the
        // masked chunk payload.
        const pre = await readPresetNameSafe(conn, i);
        for (let m = 0; m < msgs.length; m++) {
          conn.send(Array.from(msgs[m]));
          if (m < msgs.length - 1) await sleep(INTER_MESSAGE_DELAY_MS);
        }
        // Give the AM4 a moment to commit before we ask for the post-name.
        await sleep(POST_RESTORE_VERIFY_DELAY_MS);
        const post = await readPresetNameSafe(conn, i);
        const outcome = classifyVerifyOutcome(pre, post);
        if (outcome.status === 'ok') {
          verified++;
          console.log(`ok (${outcome.message}).`);
        } else if (outcome.status === 'unverified') {
          unverified.push({ slot: code, message: outcome.message, pre, post });
          console.log(`UNVERIFIED (${outcome.message}). Continuing.`);
        } else {
          failures.push({ slot: code, message: outcome.message, pre, post });
          console.log(`FAIL (${outcome.message}). Continuing.`);
        }
        if (i < toIdx) await sleep(INTER_SLOT_DELAY_MS);
      }
      console.log(`\nVerification summary: ${verified}/${slotCount} slots verified, ${unverified.length} unverified, ${failures.length} failed.`);
      if (failures.length > 0) {
        console.log('Failed slots:');
        for (const f of failures) {
          console.log(`  ${f.slot}: ${f.message}`);
        }
      }
      if (unverified.length > 0) {
        console.log('Unverified slots (pre-read failed; can\'t confirm restore landed):');
        for (const u of unverified) {
          console.log(`  ${u.slot}: pre="${u.pre}" post="${u.post}"`);
        }
      }
      if (failures.length > 0 || unverified.length > 0) {
        console.log('\nRecommended action: re-run the restore for the failed/unverified slots in isolation (--send --slot=<code>) once the AM4 USB session is quiescent. Pre-read failures are usually transient USB stalls and resolve on a fresh attempt.');
      } else {
        console.log('All slots verified via pre/post name comparison.');
      }
    } finally {
      conn.close();
    }
    return failures.length + unverified.length > 0 ? 7 : 0;
  }

  // ---- Pick the target slot ------------------------------------------------

  if (args.send && !args.slotExplicit) {
    console.error('FAIL: --send requires an explicit --slot=A01..Z04 or --range=FROM..TO. Refusing to send to default Z04.');
    return 6;
  }

  const targetIndex = parseLocationCode(args.slot);
  const target = presets[targetIndex];
  const targetSlice = bankSliceForIndex(bank, targetIndex);
  const messages = splitMessages(targetSlice);

  console.log(`Target slot: ${args.slot} (wire index ${targetIndex})`);
  console.log(`  header payload: ${Array.from(target.headerPayload).map(hex).join(' ')}`);
  console.log(`  bank=${hex(target.headerPayload[0])} sub=${hex(target.headerPayload[1])} trailer=${Array.from(target.headerPayload.slice(2, 5)).map(hex).join(' ')}`);
  console.log(`  total bytes:    ${targetSlice.length}`);
  console.log(`  message count:  ${messages.length}\n`);

  // ---- Print or send the messages -----------------------------------------

  if (!args.send) {
    console.log(`(dry-run) ${messages.length} messages that WOULD be sent to ${args.slot}:`);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const role =
        i === 0 ? 'header (0x77)' :
        i === messages.length - 1 ? 'footer (0x79)' :
        `chunk ${i} of ${CHUNKS_PER_PRESET} (0x78)`;
      console.log(`  WOULD SEND msg ${i + 1}/${messages.length} [${role}] (${m.length}B): ${hexSlice(m)}`);
    }
    console.log(`\n(dry-run) Recommended pacing between messages: ${INTER_MESSAGE_DELAY_MS} ms.`);
    console.log('(dry-run) Re-run with --send --slot=' + args.slot + ' to transmit.');
    console.log('(dry-run) MIDI port was NOT opened.');
    return 0;
  }

  // --- send mode -----------------------------------------------------------

  console.log('!!! --send is set. Sending ' + messages.length + ' messages to ' + args.slot + '. !!!');
  console.log('!!! This OVERWRITES whatever is currently stored at ' + args.slot + ' on the AM4. !!!');
  console.log('!!! Make sure no other tool / probe / AM4-Edit session is talking to the device. !!!\n');

  // Lazy-import the MIDI helper so the dry-run path never loads node-midi
  // at all (matters when the founder runs `--help` or peeks at the file
  // structure on a machine without the native build set up).
  const { connectAM4 } = await import('@/fractal/am4/midi.js');
  const conn = connectAM4();
  let verifyExitCode = 0;
  try {
    // Pre-restore name read so the post-restore comparison surfaces a
    // failure if the slot doesn't actually change.
    const pre = await readPresetNameSafe(conn, targetIndex);
    console.log(`  Pre-restore name at ${args.slot}: "${pre}"`);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const role =
        i === 0 ? 'header (0x77)' :
        i === messages.length - 1 ? 'footer (0x79)' :
        `chunk ${i} of ${CHUNKS_PER_PRESET} (0x78)`;
      console.log(`  SEND msg ${i + 1}/${messages.length} [${role}] (${m.length}B): ${hexSlice(m, 16)}`);
      conn.send(Array.from(m));
      if (i < messages.length - 1) await sleep(INTER_MESSAGE_DELAY_MS);
    }
    console.log('\nAll ' + messages.length + ' messages transmitted.');
    // Post-restore name read + classification. Fail-fast: the single-slot
    // path is research-only, so verification failures should always
    // surface with a non-zero exit code.
    await sleep(POST_RESTORE_VERIFY_DELAY_MS);
    const post = await readPresetNameSafe(conn, targetIndex);
    const outcome = classifyVerifyOutcome(pre, post);
    console.log(`  Post-restore name at ${args.slot}: "${post}"`);
    if (outcome.status === 'ok') {
      console.log(`Verification: ${outcome.message}`);
    } else if (outcome.status === 'unverified') {
      console.warn(`Verification UNVERIFIED: ${outcome.message}`);
      verifyExitCode = 7;
    } else {
      console.error(`Verification FAILED: ${outcome.message}`);
      verifyExitCode = 7;
    }
    console.log('Verify on the AM4 front panel:');
    console.log('  1. Switch to ' + args.slot + ' on the device. The factory preset name should appear.');
    console.log('  2. The preset audibly matches the factory tone for that location.');
  } finally {
    conn.close();
  }
  return verifyExitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
