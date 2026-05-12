/**
 * One-shot fixer for the 🟡 scaling mismatches + 2 confirmed-wrong
 * hand entries surfaced by `audit-handparams-vs-cache.ts`. Reads
 * `src/protocol/params.ts`, edits each affected param entry in place,
 * writes back. Idempotent — running twice is a no-op.
 *
 * Why a script instead of 19 individual edits: avoids hand-type
 * variance (some entries are one-line, some span 6 lines with comments
 * interspersed). The script matches by `'block.name'` key prefix and
 * inserts/edits within that entry's block scope.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'src/fractal/am4/params.ts';
const src = readFileSync(PATH, 'utf8');

interface Fix {
  key: string;
  /** Either add `scaling: 'log10',` (if not present) or fix a numeric field. */
  kind: 'addLog10' | 'fixDisplayMax';
  newDisplayMax?: number;
  /** Comment to add at the entry. */
  comment: string;
}

const FIXES: Fix[] = [
  // 17 hand entries with cache typecode 64/68/80 missing scaling: 'log10'.
  // Audit flagged each as 🟡 — firmware stores log10-normalized; without
  // the scaling field the runtime decode falls back to linear and
  // readbacks come out wrong (HW-053 Friedman test confirmed this on
  // amp.presence_freq specifically — write 3 → AM4 displays 3.000 ✓ but
  // get_param returns 7).
  { key: 'amp.b_plus_time_constant', kind: 'addLog10', comment: 'typecode 68 = log10 (HW-053b cont audit)' },
  { key: 'amp.cab_master_high_cut',  kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.cab2_low_cut',         kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.cathode_time_const',   kind: 'addLog10', comment: 'typecode 68 = log10 (HW-053b cont audit)' },
  { key: 'amp.hi_slope',             kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.input_eq_q',           kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.low_q',                kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.power_tube_hardness',  kind: 'addLog10', comment: 'typecode 80 = log10 (HW-053b cont audit)' },
  { key: 'amp.presence_freq',        kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053 confirmed: write 3 → AM4 3.000 ✓ but readback was 7 with linear decode)' },
  { key: 'amp.screen_frequency',     kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.screen_q',             kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.speaker_impedance',    kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.spkr_time_constant',   kind: 'addLog10', comment: 'typecode 68 = log10 (HW-053b cont audit)' },
  { key: 'amp.xformer_drive',        kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'amp.xformer_matching',     kind: 'addLog10', comment: 'typecode 64 = log10 (HW-053b cont audit)' },
  { key: 'reverb.dwell',             kind: 'addLog10', comment: 'typecode 80 = log10 (HW-053b cont audit)' },
  { key: 'delay.lo_fi_drive',        kind: 'addLog10', comment: 'typecode 80 = log10 (HW-053b cont audit)' },

  // amp.bright_cap typecode 72 — not in our LOG10_TYPECODES set yet, but
  // HW-053 hardware data confirms log10 storage (write 220 → AM4 220.0 pF ✓
  // but readback was 4480 pF with linear decode; (4480-10)/9990 = 0.4475
  // matches log10 Q15 = log10(220/10)/log10(10000/10) = 0.4477). Hand-add
  // scaling: 'log10' here without changing the LOG10_TYPECODES set.
  { key: 'amp.bright_cap', kind: 'addLog10', comment: 'typecode 72 = log10 — HW-053 hardware-confirmed (write 220 → AM4 220 ✓; linear readback gave 4480)' },

  // amp.negative_feedback: cache a=0, b=0.1, c=100 → real display range
  // is 0..10 (a*c..b*c), NOT 0..100. HW-053 confirmed: write 5 → AM4
  // shows 5.00 ✓; linear readback returned 50 (because hand entry's
  // displayMax=100 mis-stretched the decode). Fix displayMax 100 → 10.
  { key: 'amp.negative_feedback', kind: 'fixDisplayMax', newDisplayMax: 10, comment: 'HW-053: cache b*c = 10, not 100. Hand entry was off by 10×; readback came out 50 instead of 5.' },
];

let result = src;
const applied: string[] = [];
const skipped: string[] = [];

for (const fix of FIXES) {
  // Find the entry by its key. Each entry starts with `'<key>': {`
  // and ends with `  },` at the same indent. Use a regex to capture
  // the block.
  const keyEsc = fix.key.replace(/[.]/g, '\\.');
  const re = new RegExp(
    `('${keyEsc}':\\s*\\{[^{}]*?)\\n(\\s*)\\},`,
    'm',
  );
  const m = result.match(re);
  if (!m) {
    skipped.push(`${fix.key}: entry not found by regex`);
    continue;
  }
  const body = m[1];
  const indent = m[2];

  if (fix.kind === 'addLog10') {
    if (body.includes("scaling: 'log10'")) {
      skipped.push(`${fix.key}: already has scaling: 'log10'`);
      continue;
    }
    if (body.includes("scaling:")) {
      skipped.push(`${fix.key}: has different scaling field, manual review needed`);
      continue;
    }
    const replacement = `${body}\n${indent}  // ${fix.comment}\n${indent}  scaling: 'log10',\n${indent}},`;
    result = result.replace(m[0], replacement);
    applied.push(fix.key);
  } else if (fix.kind === 'fixDisplayMax') {
    const oldMax = fix.newDisplayMax!;
    // Match `displayMax: <number>` and replace.
    const dmRe = /displayMax:\s*\d+(?:\.\d+)?/;
    if (!dmRe.test(body)) {
      skipped.push(`${fix.key}: no displayMax field found`);
      continue;
    }
    const newBody = body.replace(dmRe, `displayMax: ${oldMax}`);
    const replacement = `${newBody}\n${indent}  // HW-053b cont audit: ${fix.comment}\n${indent}},`;
    result = result.replace(m[0], replacement);
    applied.push(fix.key);
  }
}

writeFileSync(PATH, result);

console.log(`Applied ${applied.length} fix(es):`);
for (const k of applied) console.log(`  ✓ ${k}`);
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  - ${s}`);
}
