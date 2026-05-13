/**
 * Sweep every lineage JSON's `description` field for quality issues:
 *   - Empty or very short descriptions on matched records
 *   - Markdown artifacts (`[link](url)`, `&bull;`, HTML entities, bare URLs)
 *   - PDF-extraction artifacts (® ™ U+FFFD replacement char)
 *   - Non-description content masquerading as description
 *     (e.g. "Previously titled X", "See above", rename notes)
 *   - Leading bullet/list markers that shouldn't be there
 *   - Trailing punctuation / whitespace oddities
 *   - Suspiciously duplicated content across sibling records
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
  flags?: string[];
}

interface Finding {
  file: string;
  name: string;
  category: string;
  detail: string;
}

function sweep(file: string): Finding[] {
  const raw = JSON.parse(fs.readFileSync(path.join(KNOW_DIR, file), 'utf8'));
  const records: LineageRecord[] = raw.records ?? [];
  const findings: Finding[] = [];

  // Track descriptions to find dup content across siblings.
  const descCounts = new Map<string, string[]>();

  for (const r of records) {
    const label = r.am4Name;
    const d = r.description;

    if (d === undefined || d === '') {
      // Empty is acceptable for records with an basedOn or flag;
      // only flag if BOTH description AND basedOn are missing on
      // a "matched" record (no VERIFY flag).
      const hasFlag = (r.flags ?? []).some(f => /VERIFY/.test(f));
      if (!r.basedOn && !hasFlag) {
        findings.push({ file, name: label, category: 'EMPTY', detail: 'no description, no basedOn, no VERIFY flag' });
      }
      continue;
    }

    // Very short descriptions (under 20 chars) that aren't empty — suspect
    if (d.length < 20) {
      findings.push({ file, name: label, category: 'SHORT', detail: `${d.length} chars: "${d}"` });
    }

    // Markdown noise
    if (/\[link\]\([^)]+\)/.test(d)) {
      findings.push({ file, name: label, category: 'MD_LINK', detail: `"[link](url)" inside description` });
    }
    if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(d)) {
      findings.push({ file, name: label, category: 'MD_LINK_NAMED', detail: `embedded named markdown link: ${d.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/)![0].slice(0, 60)}...` });
    }
    if (/&bull;|&amp;|&quot;|&lsquo;|&rsquo;|&ldquo;|&rdquo;/.test(d)) {
      findings.push({ file, name: label, category: 'HTML_ENTITY', detail: `unescaped HTML entity in description` });
    }
    if (/https?:\/\/\S+/.test(d) && !/\[[^\]]+\]\(https?:/.test(d)) {
      findings.push({ file, name: label, category: 'BARE_URL', detail: `bare URL not wrapped in markdown link` });
    }
    if (d.startsWith('- ') || d.startsWith('* ')) {
      findings.push({ file, name: label, category: 'LIST_MARKER', detail: `starts with bullet marker: "${d.slice(0, 40)}..."` });
    }
    if (d.startsWith('> ')) {
      findings.push({ file, name: label, category: 'BLOCKQUOTE', detail: `starts with "> " blockquote marker` });
    }

    // PDF encoding artifacts
    if (/[\uFFFD®™]/.test(d)) {
      findings.push({ file, name: label, category: 'PDF_ARTIFACT', detail: `replacement char / ® / ™ embedded` });
    }

    // Non-description content
    if (/^previously\s+(titled|named|called)/i.test(d)) {
      findings.push({ file, name: label, category: 'RENAME_NOTE', detail: `description is a rename note, not a description: "${d}"` });
    }
    if (/^see\s+(above|below|\w+\b)/i.test(d) && d.length < 30) {
      findings.push({ file, name: label, category: 'CROSSREF', detail: `description is a cross-reference only: "${d}"` });
    }

    // Trailing whitespace / weird quoting
    if (d !== d.trim()) {
      findings.push({ file, name: label, category: 'WHITESPACE', detail: `leading or trailing whitespace` });
    }
    // Unmatched parens/quotes
    const parenDelta = (d.match(/\(/g) ?? []).length - (d.match(/\)/g) ?? []).length;
    if (parenDelta !== 0) {
      findings.push({ file, name: label, category: 'UNBALANCED_PAREN', detail: `parentheses unbalanced by ${parenDelta}` });
    }

    // Track for dup detection
    const norm = d.trim();
    if (!descCounts.has(norm)) descCounts.set(norm, []);
    descCounts.get(norm)!.push(label);
  }

  // Duplicate descriptions across multiple records
  for (const [desc, names] of descCounts) {
    if (names.length > 1 && desc.length > 30) {
      findings.push({
        file,
        name: names.join(' / '),
        category: 'DUP_ACROSS_RECORDS',
        detail: `${names.length} records share identical description: "${desc.slice(0, 60)}..."`,
      });
    }
  }

  return findings;
}

const files = [
  'amp-lineage.json',
  'drive-lineage.json',
  'reverb-lineage.json',
  'delay-lineage.json',
  'compressor-lineage.json',
];

let total = 0;
const byCategory = new Map<string, number>();

for (const file of files) {
  const findings = sweep(file);
  total += findings.length;
  console.log(`\n═══ ${file} — ${findings.length} finding(s) ═══`);
  if (findings.length === 0) {
    console.log('  (clean)');
    continue;
  }
  // Group by category for easier reading
  const byCat = new Map<string, Finding[]>();
  for (const f of findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f);
  }
  for (const [cat, list] of byCat) {
    console.log(`  [${cat}] ${list.length}`);
    for (const f of list.slice(0, 8)) {
      console.log(`    - ${f.name}: ${f.detail}`);
    }
    if (list.length > 8) console.log(`    ... +${list.length - 8} more`);
  }
}

console.log(`\n═══ TOTAL: ${total} findings across all files ═══`);
for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${n}`);
}
