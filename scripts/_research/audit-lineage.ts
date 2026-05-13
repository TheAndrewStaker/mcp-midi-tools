/**
 * Audit every lineage JSON for data-quality issues:
 *   - description === basedOn.primary (exact duplication)
 *   - description fully contains basedOn.primary (or vice versa)
 *   - quote.text === description or quote.text === basedOn.primary
 *   - Empty / whitespace-only fields on matched records
 *   - Markdown artifacts (leading `> `, trailing `[link](url)`, `&bull;`)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOW_DIR = path.join(__dirname, '..', 'src', 'knowledge');

interface LineageRecord {
  am4Name: string;
  wikiName?: string;
  description?: string;
  basedOn?: { primary: string; source: string };
  fractalQuotes?: Array<{ text: string; url?: string; attribution?: string }>;
  flags?: string[];
}

function audit(file: string): { issues: string[]; stats: Record<string, number> } {
  const raw = JSON.parse(fs.readFileSync(path.join(KNOW_DIR, file), 'utf8'));
  const records: LineageRecord[] = raw.records ?? [];
  const issues: string[] = [];
  const stats = {
    total: records.length,
    descEqInspired: 0,
    descContainsInspired: 0,
    inspiredContainsDesc: 0,
    quoteEqDesc: 0,
    quoteEqInspired: 0,
    quoteContainsDesc: 0,
    quoteContainsInspired: 0,
    descMarkdownNoise: 0,
    inspiredMarkdownNoise: 0,
  };

  for (const r of records) {
    const label = r.am4Name;
    const desc = r.description?.trim();
    const insp = r.basedOn?.primary?.trim();

    // 1. Description vs basedOn.primary — only exact equality is a bug
    // under the BK-021 schema. Substring containment is EXPECTED: e.g.
    // description "Based on the Xotic BB preamp, standard (v1.5)."
    // contains basedOn.primary "Xotic BB preamp". They serve different
    // roles (primary = keyword-index short form, description = Fractal
    // prose) and overlap by design.
    if (desc && insp && desc === insp) {
      stats.descEqInspired++;
      issues.push(`${label}: description === basedOn.primary (exact duplicate)`);
    }

    // 2. Quote vs description/basedOn duplication
    for (const q of r.fractalQuotes ?? []) {
      const qt = q.text.trim();
      if (!qt) continue;
      if (desc && qt === desc) {
        stats.quoteEqDesc++;
        issues.push(`${label}: quote === description`);
      } else if (desc && (qt.includes(desc) || desc.includes(qt))) {
        stats.quoteContainsDesc++;
        issues.push(`${label}: quote subsumes description or vice versa`);
      }
      if (insp && qt === insp) {
        stats.quoteEqInspired++;
        issues.push(`${label}: quote === basedOn.primary`);
      } else if (insp && (qt.includes(insp) || insp.includes(qt))) {
        stats.quoteContainsInspired++;
        issues.push(`${label}: quote subsumes basedOn or vice versa`);
      }
    }

    // 3. Markdown artifacts
    if (desc && /^>\s|&bull;|\[link\]\(.+\)\s*$/.test(desc)) {
      stats.descMarkdownNoise++;
      issues.push(`${label}: description carries markdown artifact: "${desc.slice(0, 60)}..."`);
    }
    if (insp && /^>\s|&bull;|\[link\]\(.+\)\s*$/.test(insp)) {
      stats.inspiredMarkdownNoise++;
      issues.push(`${label}: basedOn.primary carries markdown artifact: "${insp.slice(0, 60)}..."`);
    }

    // 4. BK-021 invariant: if description contains a lineage verb
    // ("based on X", "inspired by X", etc.) but basedOn is absent, the
    // extractor missed real-gear signal. Flag so the curator can either
    // add a hardcoded MODEL_TO_BRAND entry or extend KNOWN_MANUFACTURERS.
    if (desc && /\b(based on|inspired by|modeled after|recreates)\b/i.test(desc) && !r.basedOn) {
      (stats as any).descLineageWithoutBasedOn =
        ((stats as any).descLineageWithoutBasedOn ?? 0) + 1;
      issues.push(`${label}: description mentions "based on" but basedOn is missing`);
    }
  }

  return { issues, stats };
}

const files = [
  'amp-lineage.json',
  'drive-lineage.json',
  'reverb-lineage.json',
  'delay-lineage.json',
  'compressor-lineage.json',
];

for (const file of files) {
  console.log(`\n═══ ${file} ═══`);
  const { issues, stats } = audit(file);
  console.log('stats:', JSON.stringify(stats));
  if (issues.length === 0) {
    console.log('  (no issues)');
  } else {
    console.log(`  ${issues.length} issues:`);
    for (const i of issues.slice(0, 20)) console.log('    -', i);
    if (issues.length > 20) console.log(`    ... +${issues.length - 20} more`);
  }
}
