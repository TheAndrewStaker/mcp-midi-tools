/**
 * scripts/probe-amp-knob-applicability.ts
 *
 * Hardware-empirical applicability probe for AM4 amp knobs. Validates the
 * XML-extracted TYPE_APPLICABILITY data against what the device actually
 * does when you write a knob.
 *
 * Procedure per amp type:
 *   1. Switch the active amp.type to the named model (so subsequent writes
 *      target this type's register set, not whichever was previously active).
 *   2. For each iconic front-panel knob, run a read-write-read cycle:
 *        baseline = read current value
 *        write    = baseline + delta (clamped into the knob's display range)
 *        observed = read again after the write
 *      Classify:
 *        applied   → observed == write                  (write took)
 *        no-op     → observed == baseline               (silent ignore)
 *        cross-talk → observed != write && != baseline   (write hit a different register)
 *   3. Compare against TYPE_APPLICABILITY for the same (block, param). Flag
 *      mismatches (XML says applies, hardware says no-op — or vice versa).
 *
 * Usage:
 *   npx tsx scripts/probe-amp-knob-applicability.ts "5F8 Tweed Normal"
 *   npx tsx scripts/probe-amp-knob-applicability.ts "Deluxe Verb Vibrato"
 *   npx tsx scripts/probe-amp-knob-applicability.ts --wire 185
 *
 * SAFETY:
 *   - Mutates the AM4 working buffer. Does NOT save to any preset location.
 *   - Restores each probed knob to its original baseline after the test.
 *   - The amp.type write itself is NOT reverted — the active type stays at
 *     whatever was probed. Switch presets after to discard the buffer.
 *
 * Output: per-knob row showing XML expectation, observed behavior, and a
 * verdict (CONFIRM / MISMATCH / N/A). Exit 0 on full agreement, 1 on any
 * MISMATCH so the script can be wired into a regression harness later.
 */

import { connectAM4 } from '@/fractal/am4/midi.js';
import {
  buildSetParam,
  isWriteEcho,
} from '@/fractal/am4/setParam.js';
import { sendReadAndParse } from '@/fractal/am4/shared/readOps.js';
import { sendAndAwaitAck } from '@/fractal/am4/shared/wireOps.js';
import { KNOWN_PARAMS, type Param, type ParamKey } from '@/fractal/am4/params.js';
import { decode as am4Decode } from '@/fractal/am4/params.js';
import { AMP_TYPES } from '@/fractal/am4/cacheEnums.js';
import { TYPE_APPLICABILITY } from '@/fractal/am4/typeApplicability.js';
import { checkApplicability } from '@/fractal/am4/applicability.js';

const ICONIC_KNOBS = ['gain', 'bass', 'mid', 'treble', 'presence', 'master', 'level', 'depth'];

interface ProbeRow {
  knob: string;
  xmlApplicable: 'true' | 'false' | 'unknown';
  baseline: number;
  written: number;
  observed: number;
  verdict: 'CONFIRM' | 'MISMATCH' | 'CROSS-TALK' | 'NO-DATA';
  note: string;
}

function pickWriteTarget(baseline: number, param: Param): number {
  // Pick a value clearly different from baseline, inside the display range.
  const min = param.displayMin;
  const max = param.displayMax;
  const mid = (min + max) / 2;
  // If baseline is near max, write near min; if near min, write near max.
  // Otherwise pick a value offset by a third of the range.
  if (baseline > mid) {
    return Math.max(min, baseline - (max - min) / 3);
  }
  return Math.min(max, baseline + (max - min) / 3);
}

function approxEqual(a: number, b: number, eps = 0.05): boolean {
  return Math.abs(a - b) <= eps;
}

async function probeKnob(
  conn: ReturnType<typeof connectAM4>,
  ampWireIndex: number,
  knob: string,
): Promise<ProbeRow> {
  const key = `amp.${knob}` as ParamKey;
  if (!(key in KNOWN_PARAMS)) {
    return {
      knob,
      xmlApplicable: 'unknown',
      baseline: NaN,
      written: NaN,
      observed: NaN,
      verdict: 'NO-DATA',
      note: 'Not registered in KNOWN_PARAMS — skipped.',
    };
  }
  const param: Param = KNOWN_PARAMS[key];

  // Cross-reference XML-extracted applicability.
  const applicability = TYPE_APPLICABILITY[key];
  let xmlApplicable: 'true' | 'false' | 'unknown';
  if (applicability === undefined) {
    xmlApplicable = 'unknown';
  } else {
    const check = checkApplicability(key, { currentTypes: { amp: ampWireIndex } });
    xmlApplicable = check.applicable === true ? 'true'
                  : check.applicable === false ? 'false'
                  : 'unknown';
  }

  // Read baseline.
  let baseline: number;
  try {
    const parsed = await sendReadAndParse(conn, param.pidLow, param.pidHigh);
    baseline = am4Decode(param, parsed.asInternalFloat());
  } catch (err) {
    return {
      knob,
      xmlApplicable,
      baseline: NaN,
      written: NaN,
      observed: NaN,
      verdict: 'NO-DATA',
      note: `Baseline read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Write a target value.
  const written = pickWriteTarget(baseline, param);
  const writeBytes = buildSetParam(key, written);
  const writeResult = await sendAndAwaitAck(conn, writeBytes, isWriteEcho);
  if (!writeResult.acked) {
    // Even no ack is data — but we should still try to read back.
  }

  // Settle briefly, then read again.
  await new Promise((r) => setTimeout(r, 50));

  let observed: number;
  try {
    const parsed = await sendReadAndParse(conn, param.pidLow, param.pidHigh);
    observed = am4Decode(param, parsed.asInternalFloat());
  } catch (err) {
    return {
      knob,
      xmlApplicable,
      baseline,
      written,
      observed: NaN,
      verdict: 'NO-DATA',
      note: `Read-back failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Classify behavior.
  const tookWrite = approxEqual(observed, written);
  const stayedBaseline = approxEqual(observed, baseline);
  let verdict: ProbeRow['verdict'];
  let note: string;
  if (tookWrite) {
    verdict = xmlApplicable === 'false' ? 'MISMATCH' : 'CONFIRM';
    note = xmlApplicable === 'false'
      ? `XML says no-op, hardware accepted the write. XML may need correction.`
      : `Write landed cleanly.`;
  } else if (stayedBaseline) {
    verdict = xmlApplicable === 'true' ? 'MISMATCH' : 'CONFIRM';
    note = xmlApplicable === 'true'
      ? `XML says applies, hardware silently no-op'd. XML may need correction.`
      : `Silent no-op (knob not exposed on this amp type) — matches XML.`;
  } else {
    verdict = 'CROSS-TALK';
    note = `Read-back is neither baseline (${baseline.toFixed(2)}) nor written (${written.toFixed(2)}) — observed ${observed.toFixed(2)}. Wire register may be reused for a different param on this amp model.`;
  }

  // Best-effort restore baseline.
  try {
    const restoreBytes = buildSetParam(key, baseline);
    await sendAndAwaitAck(conn, restoreBytes, isWriteEcho);
  } catch {
    // Restore failure is non-fatal — note it in the comment.
    note += ' (baseline restore failed)';
  }

  return { knob, xmlApplicable, baseline, written, observed, verdict, note };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: probe-amp-knob-applicability.ts "<amp type name>"');
    console.error('   or: probe-amp-knob-applicability.ts --wire <index>');
    process.exit(2);
  }

  let ampWireIndex: number;
  let ampName: string;
  if (args[0] === '--wire' && args[1] !== undefined) {
    ampWireIndex = parseInt(args[1], 10);
    if (!Number.isInteger(ampWireIndex) || ampWireIndex < 0 || ampWireIndex >= AMP_TYPES.length) {
      console.error(`Wire index out of range [0..${AMP_TYPES.length - 1}]: ${args[1]}`);
      process.exit(2);
    }
    ampName = AMP_TYPES[ampWireIndex];
  } else {
    ampName = args.join(' ');
    ampWireIndex = AMP_TYPES.indexOf(ampName);
    if (ampWireIndex < 0) {
      console.error(`Amp type "${ampName}" not found in AMP_TYPES. Pass --wire <N> for index-based selection, or check the exact spelling via lookup_lineage.`);
      process.exit(2);
    }
  }

  console.log(`=== AM4 amp knob applicability probe ===`);
  console.log(`Target amp: "${ampName}" (wire index ${ampWireIndex})`);
  console.log(`Iconic knobs probed: ${ICONIC_KNOBS.join(', ')}\n`);

  const conn = connectAM4();
  console.log('✅ AM4 connected.\n');

  // Switch the active amp.type to the target. Use buildSetParam with
  // amp.type so subsequent reads/writes see this type's register set.
  console.log(`Switching amp.type → "${ampName}" (wire ${ampWireIndex})...`);
  const typeKey = 'amp.type' as ParamKey;
  const typeBytes = buildSetParam(typeKey, ampWireIndex);
  const typeWriteResult = await sendAndAwaitAck(conn, typeBytes, isWriteEcho);
  if (!typeWriteResult.acked) {
    console.error(`⚠️  amp.type write did not ack — proceeding anyway. The device may not be in a state that accepts param writes (e.g. no amp block placed in the active preset).`);
  }
  // Settle so the device's amp model is fully loaded before probing knobs.
  await new Promise((r) => setTimeout(r, 200));
  console.log();

  const rows: ProbeRow[] = [];
  for (const knob of ICONIC_KNOBS) {
    process.stdout.write(`  probing amp.${knob}... `);
    const row = await probeKnob(conn, ampWireIndex, knob);
    rows.push(row);
    console.log(row.verdict);
  }

  console.log();
  console.log('=== Results ===\n');
  const col = (s: string, n: number) => s.padEnd(n);
  console.log(
    col('knob', 11) +
    col('xml', 10) +
    col('baseline', 10) +
    col('written', 10) +
    col('observed', 10) +
    col('verdict', 12) +
    'note',
  );
  console.log('-'.repeat(120));
  for (const r of rows) {
    const fmt = (v: number) => Number.isNaN(v) ? '-' : v.toFixed(2);
    console.log(
      col(r.knob, 11) +
      col(r.xmlApplicable, 10) +
      col(fmt(r.baseline), 10) +
      col(fmt(r.written), 10) +
      col(fmt(r.observed), 10) +
      col(r.verdict, 12) +
      r.note,
    );
  }

  console.log();
  const mismatches = rows.filter((r) => r.verdict === 'MISMATCH' || r.verdict === 'CROSS-TALK');
  if (mismatches.length === 0) {
    console.log('✅ All probed knobs match XML expectations.');
    conn.close();
    process.exit(0);
  }
  console.log(`⚠️  ${mismatches.length} mismatch(es) found:`);
  for (const m of mismatches) {
    console.log(`  - amp.${m.knob}: ${m.verdict} — ${m.note}`);
  }
  console.log('\nThese are candidates for XML correction or hardware-confirmed overrides.');
  conn.close();
  process.exit(1);
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
