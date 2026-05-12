/**
 * MCP MIDI Tools — TYPE-KNOBS wiki-derived rows generator (HW-033)
 *
 * Reads `src/knowledge/{block}-lineage.json` and emits a per-type table
 * row for each entry whose `controls` field was populated by
 * `scripts/extract-lineage.ts`. The output is `docs/TYPE-KNOBS-WIKI.md`,
 * a separate file from the manually-maintained `docs/TYPE-KNOBS.md`.
 *
 * Why a separate file: hardware-captured rows in TYPE-KNOBS.md are the
 * authoritative source. Wiki-derived rows are a prior — useful for
 * agent hinting on uncatalogued types, but never to be confused with
 * captured truth. Keeping them in a sibling file makes the provenance
 * explicit. Once enough types are captured, we can decide whether to
 * merge inline or retire this file.
 *
 * Cross-reference: each wiki control label is fuzzy-matched against
 * `params.ts` knob names (per block). The matching is best-effort —
 * Fractal renames knobs in their UI ("Tone" on a Klon Centaur is the
 * "drive.tone" register; "Output" on the same pedal is "drive.level").
 * Unmatched labels are surfaced for review rather than silently dropped.
 *
 * Run via `npm run build-type-knobs`. Re-run after `npm run extract-lineage`
 * picks up new wiki content.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'src', 'knowledge');
const OUT = path.join(ROOT, 'docs', 'TYPE-KNOBS-WIKI.md');

interface ControlsList {
  values: string[];
  raw: string;
  source: string;
}

interface LineageRecord {
  am4Name: string;
  basedOn?: { primary?: string; productName?: string };
  controls?: ControlsList;
}

interface LineageFile {
  records: LineageRecord[];
}

/** Per-block alias map for fuzzy wiki-label → params.ts key resolution.
 *  Lowercase keys; values are the suffix-after-block (e.g. "drive" maps to
 *  "<block>.drive"). Unmapped labels are flagged in the output rather than
 *  silently dropped — helps reviewers spot wiki vocabulary the param
 *  registry doesn't yet cover. */
const ALIAS: Record<string, Record<string, string>> = {
  drive: {
    'drive': 'drive', 'gain': 'drive', 'distortion': 'drive', 'overdrive': 'drive',
    'sustain': 'drive', 'fuzz': 'drive', 'expander': 'drive',
    'tone': 'tone', 'treble': 'tone', 'tone control': 'tone',
    'level': 'level', 'volume': 'level', 'vol': 'level', 'out level': 'level',
    'output': 'level', 'loudness': 'level', 'balance': 'level',
    'mix': 'mix', 'blend': 'mix',
    'bass': 'bass', 'low': 'bass', 'low cut': 'low_cut', 'bass cut': 'low_cut',
    'mid': 'mid', 'middle': 'mid', 'low mids': 'mid', 'mids': 'mid',
    'mid freq': 'mid_freq', 'hi mids': 'mid_freq',
    'high cut': 'high_cut', 'spectrum': 'mid_freq',
  },
  reverb: {
    'mix': 'mix', 'level': 'level', 'time': 'time', 'decay': 'time',
    'pre-delay': 'predelay', 'predelay': 'predelay',
    'high cut': 'high_cut', 'low cut': 'low_cut',
    'size': 'size', 'plate size': 'size',
  },
  delay: {
    'mix': 'mix', 'level': 'level', 'time': 'time', 'delay time': 'time',
    'feedback': 'feedback', 'tempo': 'tempo',
  },
  compressor: {
    'mix': 'mix', 'blend': 'mix', 'level': 'level', 'output': 'level',
    'threshold': 'threshold', 'compression': 'threshold',
    'ratio': 'ratio', 'attack': 'attack', 'release': 'release',
    'auto': 'auto_makeup', 'auto makeup': 'auto_makeup',
  },
  amp: {
    'gain': 'gain', 'drive': 'gain',
    'bass': 'bass', 'mid': 'mid', 'middle': 'mid', 'treble': 'treble',
    'master': 'master', 'depth': 'depth', 'presence': 'presence',
    'level': 'level', 'volume': 'level',
  },
  phaser: {
    'rate': 'rate', 'depth': 'depth', 'feedback': 'feedback',
    'mix': 'mix', 'tempo': 'tempo',
  },
  chorus: {
    'rate': 'rate', 'depth': 'depth', 'mix': 'mix', 'tempo': 'tempo',
  },
  flanger: {
    'rate': 'rate', 'depth': 'depth', 'feedback': 'feedback',
    'mix': 'mix', 'tempo': 'tempo',
  },
  wah: {
    'mix': 'mix', 'frequency': 'freq', 'freq': 'freq',
  },
};

function lookupAlias(block: string, label: string): string | undefined {
  const map = ALIAS[block];
  if (!map) return undefined;
  const normalized = label
    .toLowerCase()
    .replace(/[®™()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (map[normalized]) return `${block}.${map[normalized]}`;
  // Try first word as fallback ("Drive switch" → "drive")
  const firstWord = normalized.split(/[\s/]/)[0];
  if (map[firstWord]) return `${block}.${map[firstWord]}`;
  return undefined;
}

function loadLineage(filename: string): LineageFile | undefined {
  const p = path.join(KNOWLEDGE_DIR, filename);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as LineageFile;
}

interface Row {
  typeName: string;
  rawWikiLabels: string[];
  mappedParams: string[];
  unmapped: string[];
  basedOn?: string;
}

function buildRows(block: string, file: LineageFile): Row[] {
  const rows: Row[] = [];
  for (const r of file.records) {
    if (!r.controls || r.controls.values.length === 0) continue;
    const mapped: string[] = [];
    const unmapped: string[] = [];
    for (const label of r.controls.values) {
      const key = lookupAlias(block, label);
      if (key) mapped.push(key);
      else unmapped.push(label);
    }
    rows.push({
      typeName: r.am4Name,
      rawWikiLabels: r.controls.values,
      mappedParams: Array.from(new Set(mapped)),
      unmapped,
      basedOn: r.basedOn?.primary ?? r.basedOn?.productName,
    });
  }
  return rows;
}

function emitBlock(block: string, label: string, rows: Row[]): string {
  const lines: string[] = [];
  lines.push(`## ${label} (\`${block}\`)`);
  lines.push('');
  if (rows.length === 0) {
    lines.push('_No wiki-derived control lists extracted for this block yet._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`Wiki-derived per-type knob lists, extracted by`);
  lines.push(`\`scripts/extract-lineage.ts\` from Fractal wiki "Controls:" prose.`);
  lines.push(`These are **priors**, not ground truth — Fractal occasionally`);
  lines.push(`renames or adds knobs vs. the modeled device. Always trust a`);
  lines.push(`hardware capture over a wiki-derived row when they disagree.`);
  lines.push('');
  lines.push('| Type | Modeled device | Wiki-derived knobs | Mapped params | Unmapped wiki labels |');
  lines.push('|------|---------------|--------------------|---------------|---------------------|');
  for (const r of rows) {
    const wiki = r.rawWikiLabels.join(', ');
    const mapped = r.mappedParams.join(', ') || '—';
    const unmapped = r.unmapped.length > 0 ? r.unmapped.join(', ') : '—';
    const based = r.basedOn ?? '—';
    lines.push(`| ${r.typeName} | ${based} | ${wiki} | ${mapped} | ${unmapped} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const blocks: Array<{ block: string; label: string; file: string }> = [
    { block: 'drive', label: 'Drive', file: 'drive-lineage.json' },
    { block: 'reverb', label: 'Reverb', file: 'reverb-lineage.json' },
    { block: 'delay', label: 'Delay', file: 'delay-lineage.json' },
    { block: 'compressor', label: 'Compressor', file: 'compressor-lineage.json' },
    { block: 'amp', label: 'Amp', file: 'amp-lineage.json' },
    { block: 'phaser', label: 'Phaser', file: 'phaser-lineage.json' },
    { block: 'chorus', label: 'Chorus', file: 'chorus-lineage.json' },
    { block: 'flanger', label: 'Flanger', file: 'flanger-lineage.json' },
    { block: 'wah', label: 'Wah', file: 'wah-lineage.json' },
  ];

  const allRows = blocks.map(b => {
    const file = loadLineage(b.file);
    return { ...b, rows: file ? buildRows(b.block, file) : [] };
  });

  const totalRows = allRows.reduce((s, b) => s + b.rows.length, 0);
  const unmappedTotal = allRows.reduce(
    (s, b) => s + b.rows.reduce((r, x) => r + x.unmapped.length, 0), 0,
  );

  const out: string[] = [];
  out.push('# Type → Knob Map — Wiki-derived (HW-033)');
  out.push('');
  out.push('**Auto-generated from `src/knowledge/{block}-lineage.json`. Do not edit by');
  out.push('hand — re-run `npm run build-type-knobs` after `npm run extract-lineage`');
  out.push('to refresh.**');
  out.push('');
  out.push('Companion to `docs/TYPE-KNOBS.md` (the manually-maintained record of');
  out.push('hardware-captured per-type knob sets). Both files exist because');
  out.push('Fractal\'s wiki documents what the modeled device looks like, while AM4');
  out.push('hardware reveals what AM4-Edit actually exposes. Per the wiki rule');
  out.push('(`docs/wiki/Drive_block.md` line 232: "The controls on the Basic page of');
  out.push('the Drive correspond with the knobs on the modeled devices"), wiki-derived');
  out.push('knobs are a strong prior for the AM4-Edit Basic page knob set, but Fractal');
  out.push('sometimes adds or renames knobs (Klon Centaur\'s wiki Tone/Output appear in');
  out.push('AM4-Edit as drive.tone/drive.level, plus a universal drive.mix that\'s not');
  out.push('on the original pedal).');
  out.push('');
  out.push('## How to use this file');
  out.push('');
  out.push('- For an uncatalogued type the user asks about, look up the row here as a');
  out.push('  starting hint of which params will exist on AM4-Edit\'s Basic page.');
  out.push('- "Mapped params" lists the `params.ts` keys we matched the wiki labels');
  out.push('  to. "Unmapped wiki labels" surfaces vocabulary the registry doesn\'t');
  out.push('  cover yet — review against `params.ts` to see if a missing param');
  out.push('  should be added (often a switch like "Bump switch" / "Mode switch"');
  out.push('  that maps to an enum, or a Fractal-renamed knob).');
  out.push('- When a hardware capture lands for a type, prefer the captured row in');
  out.push('  `docs/TYPE-KNOBS.md` over this file\'s entry.');
  out.push('');
  out.push(`## Coverage summary`);
  out.push('');
  out.push(`- **${totalRows} types** have wiki-derived knob lists across ${allRows.filter(b => b.rows.length).length} blocks.`);
  out.push(`- **${unmappedTotal} unmapped wiki labels** await review (knobs the wiki names but \`params.ts\` doesn't yet register).`);
  out.push('');
  for (const b of allRows) {
    out.push(`- ${b.label}: ${b.rows.length} types`);
  }
  out.push('');
  out.push('---');
  out.push('');

  for (const b of allRows) {
    out.push(emitBlock(b.block, b.label, b.rows));
  }

  fs.writeFileSync(OUT, out.join('\n'), 'utf8');
  console.log(`Wrote ${path.relative(ROOT, OUT)} — ${totalRows} types, ${unmappedTotal} unmapped wiki labels.`);
}

main();
