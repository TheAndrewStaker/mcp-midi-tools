/**
 * Audit a single block's KNOWN_PARAMS registrations against a screenshot.
 *
 * Input: a JSON file at docs/audit-input/<block>.json describing the
 * screenshot's knob labels and final displayed values. Founder authors
 * this once per block.
 *
 * Process:
 *   1. Run the streaming extractor on the relevant tshark dump (or use
 *      a pre-extracted list of pidHighs + final wire values).
 *   2. For each (label, displayValue) in the JSON, search every captured
 *      pidHigh and every plausible unit scale for `wire * scale === value`
 *      (or, for enum strings, `wire === enumIndex(label)`).
 *   3. Cross-reference each captured pidHigh with the current
 *      KNOWN_PARAMS registration.
 *   4. Emit a Markdown table for founder review.
 *
 * Run:  npx tsx scripts/audit-block-vs-screenshot.ts docs/audit-input/wah.json
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { unpackFloat32LE } from 'fractal-midi/shared';
import { KNOWN_PARAMS } from 'fractal-midi/am4';

interface KnobInput {
  label: string;
  displayValue: number | string;
}
interface AuditInput {
  block: string;
  pidLow: string;
  tsharkSource: string;
  knobs: KnobInput[];
}

interface CapturedWrite {
  pidHigh: number;
  hdr2: number;
  wire: number;
  writes: number;
  hex: string;
}

function decodeFrame(hex: string): { pidLow: number; pidHigh: number; hdr2: number; wire: number } | null {
  const b: number[] = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  if (b[0] !== 0xf0 || b[b.length - 1] !== 0xf7) return null;
  if (b[1] !== 0x00 || b[2] !== 0x01 || b[3] !== 0x74 || b[4] !== 0x15 || b[5] !== 0x01) return null;
  const r14 = (lo: number, hi: number) => (lo & 0x7f) | ((hi & 0x7f) << 7);
  const pidLow = r14(b[6], b[7]);
  const pidHigh = r14(b[8], b[9]);
  const hdr2 = r14(b[10], b[11]);
  const valueBytes = b.slice(16, b.length - 2);
  const wire = unpackFloat32LE(new Uint8Array(valueBytes));
  return { pidLow, pidHigh, hdr2, wire };
}

async function streamExtract(file: string, targetPidLow: number): Promise<CapturedWrite[]> {
  const last = new Map<number, CapturedWrite>();
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let cur: { frame?: number; direction?: 'IN' | 'OUT'; hex?: string } = {};
  const flush = () => {
    if (!cur.frame || !cur.hex || cur.direction !== 'OUT') return;
    if (cur.hex.length !== 46) return;
    const d = decodeFrame(cur.hex);
    if (!d) return;
    if (d.pidLow !== targetPidLow) return;
    if (d.pidHigh === 0x3e81) return;
    const prev = last.get(d.pidHigh);
    last.set(d.pidHigh, { pidHigh: d.pidHigh, hdr2: d.hdr2, wire: d.wire, writes: (prev?.writes ?? 0) + 1, hex: cur.hex });
  };
  for await (const line of rl) {
    const m = line.match(/^Frame (\d+):/);
    if (m) { flush(); cur = { frame: Number(m[1]) }; continue; }
    if (!cur.frame) continue;
    const e = line.match(/Direction:\s+(IN|OUT)/); if (e) cur.direction = e[1] as 'IN' | 'OUT';
    const r = line.match(/\[Reassembled data:\s+([0-9a-f]+)\]/); if (r) cur.hex = r[1];
  }
  flush();
  return Array.from(last.values()).sort((a, b) => a.pidHigh - b.pidHigh);
}

const SCALES: { name: string; factor: number }[] = [
  { name: '×1 (raw db/hz/count/ratio)', factor: 1 },
  { name: '×10 (knob_0_10)', factor: 10 },
  { name: '×12 (amp GEQ band — db ±12 stored as -1..1)', factor: 12 },
  { name: '×20 (knob_0_20)', factor: 20 },
  { name: '×100 (percent / bipolar_percent)', factor: 100 },
  { name: '×1000 (ms-stored-as-seconds)', factor: 1000 },
  { name: '×1000000 (pf)', factor: 1_000_000 },
  { name: '×57.2958 (degrees from radians)', factor: 57.29577951308232 },
  { name: '×31.831 (rotary.rate Hz from π-encoded radians)', factor: 31.83098793029785 },
];

function findScaleMatch(wire: number, target: number): { scale: number; name: string } | null {
  // Tolerance must be tight enough to distinguish adjacent knob steps. The
  // founder's wiggle methodology picks 2-decimal display values (1.11, 4.44,
  // 9.99 etc.), so wire * scale must equal target within ~0.005 absolute.
  // Using 0.05% relative = ±0.005 at target 9.99 — keeps float32 round-trip
  // noise within tolerance while rejecting wire=1.0 (display 10.0) when the
  // target is 9.99 (display from wire=0.999).
  for (const s of SCALES) {
    const eps = Math.max(Math.abs(target) * 0.0005, 0.001);
    if (Math.abs(wire * s.factor - target) <= eps) {
      return { scale: s.factor, name: s.name };
    }
  }
  return null;
}

function findRegisteredAtPidHigh(pidLow: number, pidHigh: number): { key: string; name: string }[] {
  const hits: { key: string; name: string }[] = [];
  for (const [key, p] of Object.entries(KNOWN_PARAMS)) {
    if ((p as any).pidLow === pidLow && (p as any).pidHigh === pidHigh) {
      hits.push({ key, name: (p as any).name });
    }
  }
  return hits;
}

function looksEnumIndex(wire: number): number | null {
  if (!Number.isFinite(wire)) return null;
  const r = Math.round(wire);
  if (Math.abs(wire - r) > 0.001) return null;
  if (r < 0 || r > 200) return null;
  return r;
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error('Usage: npx tsx scripts/audit-block-vs-screenshot.ts docs/audit-input/<block>.json');
    process.exit(1);
  }
  const input: AuditInput = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const pidLow = parseInt(input.pidLow, 16);
  const tshark = path.resolve(process.cwd(), input.tsharkSource);
  console.error(`Streaming ${tshark} for pidLow=${input.pidLow} ...`);
  const writes = await streamExtract(tshark, pidLow);
  console.error(`Extracted ${writes.length} distinct pidHighs.`);

  // For each screenshot knob, collect all (pidHigh, scale) candidates.
  // Then index per-pidHigh so the table can show every label that might map there.
  type Candidate = { label: string; pidHigh: number; scaleName: string };
  const allCandidates: Candidate[] = [];
  const unmatchedKnobs: string[] = [];

  for (const knob of input.knobs) {
    const cands: { pidHigh: number; scaleName: string }[] = [];
    if (typeof knob.displayValue === 'number') {
      for (const w of writes) {
        const m = findScaleMatch(w.wire, knob.displayValue);
        if (m) cands.push({ pidHigh: w.pidHigh, scaleName: m.name });
      }
    } else {
      // Enum / string label. Only match via registered enum metadata at the
      // pidHigh — no ON/OFF heuristic, since wire=1.0 collides with knob
      // values like 1 dB on EQ bands and would yield false positives.
      const target = knob.displayValue.trim();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
      for (const w of writes) {
        const idx = looksEnumIndex(w.wire);
        if (idx === null) continue;
        for (const p of Object.values(KNOWN_PARAMS)) {
          const pp = p as any;
          if (pp.pidLow !== pidLow || pp.pidHigh !== w.pidHigh) continue;
          if (!pp.enumValues) continue;
          const entry = pp.enumValues[idx];
          if (typeof entry === 'string' && norm(entry) === norm(target)) {
            cands.push({ pidHigh: w.pidHigh, scaleName: `enum match: ${entry}=${idx}` });
          }
        }
      }
    }
    if (cands.length === 0) {
      unmatchedKnobs.push(`${knob.label} (display = ${JSON.stringify(knob.displayValue)})`);
    } else {
      for (const c of cands) allCandidates.push({ label: knob.label, ...c });
    }
  }

  // Group candidates per pidHigh so we can show all possibilities in one row.
  const candsByPidHigh = new Map<number, Candidate[]>();
  for (const c of allCandidates) {
    if (!candsByPidHigh.has(c.pidHigh)) candsByPidHigh.set(c.pidHigh, []);
    candsByPidHigh.get(c.pidHigh)!.push(c);
  }
  // For verdict purposes, treat a row as "uniquely matched" only when exactly
  // one screenshot label has any candidate at this pidHigh AND that label's
  // candidates point only at this pidHigh (1-to-1 by label, not by row).
  const candCountByLabel = new Map<string, number>();
  for (const c of allCandidates) candCountByLabel.set(c.label, (candCountByLabel.get(c.label) ?? 0) + 1);

  console.log(`# Audit table — block: \`${input.block}\` (pidLow=${input.pidLow})\n`);
  console.log(`Source: \`${input.tsharkSource}\` + \`${inputFile}\`\n`);
  console.log(`| pidHigh | wire | hdr2 | writes | matched screenshot label(s) | matched scale | currently registered as | verdict |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const w of writes) {
    const cands = candsByPidHigh.get(w.pidHigh) ?? [];
    const reg = findRegisteredAtPidHigh(pidLow, w.pidHigh);
    const regList = reg.length === 0 ? '*(unregistered)*' : reg.map(r => `\`${r.key}\``).join(' AND ');

    // Pick a "primary" candidate for verdict purposes — prefer one whose label
    // has only this pidHigh as its match (i.e. unique on the label side).
    const uniqueOnLabelSide = cands.filter((c) => candCountByLabel.get(c.label) === 1);
    const primary = uniqueOnLabelSide[0] ?? cands[0];

    const labelCol = cands.length === 0
      ? '*(no match)*'
      : cands.map(c => candCountByLabel.get(c.label)! > 1 ? `${c.label}*` : c.label).join(' or ');
    const scaleCol = cands.length === 0 ? '—' : cands.map(c => c.scaleName).join(' / ');

    let verdict: string;
    if (cands.length === 0) {
      verdict = reg.length === 0 ? '— (not in screenshot, not registered)' : '— (registered, not wiggled this capture)';
    } else if (reg.length === 0) {
      verdict = `⚠ unregistered — should be **${primary.label}**`;
    } else if (reg.length > 1) {
      verdict = `⚠ DUPLICATE pidHigh; matches **${primary.label}**`;
    } else {
      const expectedKeyish = primary.label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const regKey = reg[0].key.split('.')[1];
      // Exact equality only — partial overlap (e.g. `q` matching `q_resonance`)
      // hides real drift.
      const match = regKey === expectedKeyish;
      if (uniqueOnLabelSide.length === 0 && cands.length > 1) {
        verdict = `⚠ ambiguous — multiple labels could match`;
      } else {
        verdict = match ? '✓ match' : `⚠ name drift — should be **${primary.label}**`;
      }
    }
    console.log(`| 0x${w.pidHigh.toString(16).padStart(4, '0')} | ${w.wire.toFixed(6)} | 0x${w.hdr2.toString(16).padStart(4, '0')} | ${w.writes} | ${labelCol} | ${scaleCol} | ${regList} | ${verdict} |`);
  }
  console.log(`\n*Labels marked \`*\` after the name had multiple pidHigh candidates — those rows need disambiguation. Verdict picks the label that only had ONE candidate (uniquely identifies this pidHigh).*`);
  if (unmatchedKnobs.length > 0) {
    console.log(`\n## Screenshot knobs with NO matching captured wire`);
    for (const u of unmatchedKnobs) console.log(`- ${u}`);
    console.log(`\n*(These were on the screenshot but no captured pidHigh's wire matched the displayed value at any plausible scale. Most likely: not wiggled this session, or the unit scale isn't in the search list.)*`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
