/**
 * MCP MIDI Tools — Fractal Audio Wiki Scraper
 *
 * Fetches all AM4-relevant wiki pages and saves them as markdown
 * files in docs/wiki/. Uses MediaWiki's ?action=raw endpoint to
 * get clean wikitext without nav chrome.
 *
 * Usage:
 *   npx ts-node scripts/scrape-wiki.ts
 *
 * Output:
 *   docs/wiki/[PageName].md  — one file per page
 *   docs/wiki/_index.md      — table of contents with fetch status
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WIKI_BASE = 'https://wiki.fractalaudio.com/wiki/index.php';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'wiki');
const DELAY_MS = 800; // be polite to the server

// ─── Page list ───────────────────────────────────────────────────────────────
// Grouped by priority for the project.
// P0 = block parameters (core to preset building)
// P1 = protocol/technical (core to reverse engineering)
// P2 = concepts (useful context for Claude)
// P3 = hardware/UI (mostly covered by manual, low priority)

const PAGES: Array<{ title: string; priority: 'P0' | 'P1' | 'P2' | 'P3'; notes: string }> = [
  // P0 — Block parameters (what Claude needs to build presets)
  { title: 'Amp_block',               priority: 'P0', notes: 'All amp parameters, channels, boost options' },
  { title: 'Amp_models_list',         priority: 'P0', notes: 'Complete list of amp model names — critical for preset building' },
  { title: 'Cab_block',               priority: 'P0', notes: 'DynaCab integration, cab parameters' },
  { title: 'Cab_models_list',         priority: 'P0', notes: 'All factory cab names' },
  { title: 'DynaCabs',                priority: 'P0', notes: 'DynaCab technology, mic placement, parameters' },
  { title: 'Delay_block',             priority: 'P0', notes: 'All delay types and parameters' },
  { title: 'Reverb_block',            priority: 'P0', notes: 'All reverb types and parameters' },
  { title: 'Drive_block',             priority: 'P0', notes: 'All drive/overdrive pedal types' },
  { title: 'Filter_block',            priority: 'P0', notes: 'Envelope filter, auto-wah, bandpass types' },
  { title: 'Chorus_block',            priority: 'P0', notes: 'Chorus types and parameters' },
  { title: 'Compressor_block',        priority: 'P0', notes: 'Compressor types and parameters' },
  { title: 'Flanger_block',           priority: 'P0', notes: 'Flanger types and parameters' },
  { title: 'Phaser_block',            priority: 'P0', notes: 'Phaser types and parameters' },
  { title: 'Wah_block',               priority: 'P0', notes: 'Wah types and parameters' },
  { title: 'Rotary_block',            priority: 'P0', notes: 'Rotary speaker types and parameters' },
  { title: 'Gate/Expander_block',     priority: 'P0', notes: 'Noise gate types and parameters' },
  { title: 'Tremolo/Panner_block',    priority: 'P0', notes: 'Tremolo and panner types' },
  { title: 'Volume/Panner_block',     priority: 'P0', notes: 'Volume and pan parameters' },
  { title: 'EQ',                      priority: 'P0', notes: 'EQ overview covering GEQ and PEQ on AM4' },
  { title: 'Graphic_EQ_block',        priority: 'P0', notes: 'GEQ parameters' },
  { title: 'Parametric_EQ_block',     priority: 'P0', notes: 'PEQ parameters' },
  { title: 'Enhancer_block',          priority: 'P0', notes: 'Enhancer parameters' },
  { title: 'Effects_list',            priority: 'P0', notes: 'Master list of all effects available on AM4' },
  { title: 'Noise_gate',              priority: 'P0', notes: 'Input noise gate parameters' },

  // P1 — Protocol and preset structure (reverse engineering)
  { title: 'MIDI_SysEx',              priority: 'P1', notes: 'SysEx protocol — already fetched but save locally' },
  { title: 'MIDI',                    priority: 'P1', notes: 'MIDI implementation, PC/CC tables' },
  { title: 'Presets',                 priority: 'P1', notes: 'Preset structure, .syx format, import/export' },
  { title: 'Scenes',                  priority: 'P1', notes: 'Scene structure, switching, per-scene block states' },
  { title: 'Channels',                priority: 'P1', notes: 'Channel system — 4 channels per block' },
  { title: 'Modifiers_and_controllers', priority: 'P1', notes: 'Modifier system, controllers, expression pedal mapping' },
  { title: 'Auto-Engage',             priority: 'P1', notes: 'Auto-engage for expression pedals' },
  { title: 'Scene_MIDI_block',        priority: 'P1', notes: 'MIDI output per scene' },
  { title: 'Tempo_and_Metronome',     priority: 'P1', notes: 'BPM, tap tempo, MIDI clock sync' },
  { title: 'Spillover',               priority: 'P1', notes: 'Gapless switching, spillover behavior' },

  // P2 — Concepts (useful context for tone building)
  { title: 'AM4_amp_modeler',         priority: 'P2', notes: 'Main AM4 overview page' },
  { title: 'AM4_firmware_release_notes', priority: 'P2', notes: 'What changed in each firmware — tracks new features' },
  { title: 'Amp_modeling_release_notes', priority: 'P2', notes: 'Amp model additions and changes over time' },
  { title: 'Factory_presets',         priority: 'P2', notes: 'Factory preset list and descriptions' },
  { title: 'Describing_sound',        priority: 'P2', notes: 'Fractal vocabulary for describing tone — useful for NL→params' },
  { title: 'Impulse_responses_(IR)',  priority: 'P2', notes: 'IR format, loading, UltraRes' },
  { title: 'CPU_usage',               priority: 'P2', notes: 'CPU limits, block cost — needed for preset validation' },
  { title: 'FRFR',                    priority: 'P2', notes: 'FRFR output setup — affects cab/output settings' },
  { title: 'Fletcher-Munson',         priority: 'P2', notes: 'Loudness compensation — explains some tone differences' },
  { title: 'A_beginner\'s_guide',     priority: 'P2', notes: 'Beginner overview — good context for onboarding' },
  { title: 'Cliff\'s_Tech_Notes',     priority: 'P2', notes: 'Deep technical notes from Fractal founder' },
  { title: 'Speakers_and_microphones', priority: 'P2', notes: 'Speaker/mic interaction with DynaCabs' },
  { title: 'Digital_I/O_and_recording', priority: 'P2', notes: 'USB audio, SPDIF routing' },
  { title: 'Setup_menu',              priority: 'P2', notes: 'All Setup parameters — global settings' },

  // P3 — Hardware/UI (mostly covered by manual)
  { title: 'Expression_pedals_and_external_switches', priority: 'P3', notes: 'Pedal/switch wiring and setup' },
  { title: 'Input_block',             priority: 'P3', notes: 'Input block parameters' },
  { title: 'Output_block',            priority: 'P3', notes: 'Output block parameters' },
  { title: 'Input_impedance',         priority: 'P3', notes: 'Auto-Z impedance system' },
  { title: 'Audio_in_and_out',        priority: 'P3', notes: 'I/O specifications' },
  { title: 'USB',                     priority: 'P3', notes: 'USB audio setup' },
  { title: 'Latency',                 priority: 'P3', notes: 'Latency measurements' },
  { title: 'Firmware',                priority: 'P3', notes: 'Firmware update process' },
  { title: 'Reset',                   priority: 'P3', notes: 'Factory reset procedure' },
  { title: 'Tuner',                   priority: 'P3', notes: 'Tuner operation' },
  { title: 'Library',                 priority: 'P3', notes: 'Block library system' },
  { title: 'Fractal-Bot',             priority: 'P3', notes: 'Fractal-Bot utility' },
  { title: 'Editors',                 priority: 'P3', notes: 'AM4-Edit overview' },
  { title: 'Owners_Manuals',          priority: 'P3', notes: 'Links to manual PDFs' },
  { title: 'MIDI_controllers',        priority: 'P3', notes: 'Third-party MIDI controller setup' },
  { title: 'Axe-Change',              priority: 'P3', notes: 'AxeChange preset sharing site' },
  { title: 'Cab-Lab',                 priority: 'P3', notes: 'Cab-Lab IR tool' },
  { title: 'EV-1_and_EV-2_pedals',   priority: 'P3', notes: 'Fractal expression pedals' },
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) return fetchText(location).then(resolve).catch(reject);
        return reject(new Error(`Redirect with no location from ${url}`));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Convert wikitext cell/inline content to markdown. Narrower than the
// page-level converter: no headings or lists — just inline formatting,
// links, templates, refs, and HTML stripping. Used both for table cells
// and for prose.
function convertInlineWikitext(text: string, escapePipes: boolean): string {
  let s = text;
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/<ref[^>]*\/>/g, '');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2](https://wiki.fractalaudio.com/wiki/index.php?title=$1)');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '[$1](https://wiki.fractalaudio.com/wiki/index.php?title=$1)');
  s = s.replace(/\[https?:\/\/([^\s\]]+)\s([^\]]+)\]/g, '[$2](https://$1)');
  s = s.replace(/\[https?:\/\/([^\s\]]+)\]/g, '[link](https://$1)');
  s = s.replace(/'''(.+?)'''/g, '**$1**');
  s = s.replace(/''(.+?)''/g, '_$1_');
  s = s.replace(/\[\[File:[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[Image:[^\]]*\]\]/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  if (escapePipes) {
    s = s.replace(/\|/g, '\\|');
  }
  return s;
}

// Strip MediaWiki cell attributes: `style="..." | content` → `content`.
// Uses a negative lookahead to avoid chewing into `||` cell separators.
function stripCellAttrs(cell: string): string {
  const m = cell.match(/^\s*(?:[a-zA-Z_\-:]+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)\s*)+\|(?!\|)([\s\S]*)$/);
  return m ? m[1] : cell;
}

// Parse a single MediaWiki `{|...|}` table block into a GFM markdown table.
function parseWikiTable(wikitable: string): string {
  const lines = wikitable.split(/\r?\n/);
  // Drop the opening `{|...` and closing `|}` lines.
  const body = lines.slice(1, -1);

  interface Row { isHeader: boolean; cells: string[] }
  const rows: Row[] = [];
  let current: Row | null = null;
  let caption: string | null = null;

  const pushRow = () => { if (current) rows.push(current); };

  for (const rawLine of body) {
    const line = rawLine.replace(/^\s+/, '');

    if (line.startsWith('|+')) {
      caption = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('|-')) {
      pushRow();
      current = { isHeader: false, cells: [] };
      continue;
    }
    if (!current) {
      // Implicit first row if no leading `|-`.
      current = { isHeader: false, cells: [] };
    }
    if (line.startsWith('!')) {
      current.isHeader = true;
      const content = line.slice(1);
      const parts = content.split(/\s*!!\s*/);
      for (const p of parts) current.cells.push(stripCellAttrs(p));
      continue;
    }
    if (line.startsWith('|}')) {
      break;
    }
    if (line.startsWith('|')) {
      const content = line.slice(1);
      const parts = content.split(/\s*\|\|\s*/);
      for (const p of parts) current.cells.push(stripCellAttrs(p));
      continue;
    }
    // Continuation of the previous cell (multi-line content).
    if (current.cells.length > 0) {
      current.cells[current.cells.length - 1] += ' ' + line;
    }
  }
  pushRow();

  if (rows.length === 0) return '';

  const maxCols = Math.max(...rows.map(r => r.cells.length), 1);
  const pad = (cells: string[]) => {
    const out = [...cells];
    while (out.length < maxCols) out.push('');
    return out;
  };
  const renderCell = (c: string) => {
    const s = convertInlineWikitext(c, true).replace(/\s+/g, ' ').trim();
    return s.length === 0 ? ' ' : s;
  };

  const hasHeader = rows[0].isHeader;
  const headerCells = hasHeader ? rows[0].cells : Array(maxCols).fill('');
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const out: string[] = [];
  if (caption) out.push(`**${convertInlineWikitext(caption, false).trim()}**`, '');
  out.push(`| ${pad(headerCells).map(renderCell).join(' | ')} |`);
  out.push(`| ${Array(maxCols).fill('---').join(' | ')} |`);
  for (const r of dataRows) {
    out.push(`| ${pad(r.cells).map(renderCell).join(' | ')} |`);
  }
  return out.join('\n');
}

function wikiToMarkdown(wikitext: string, title: string): string {
  let md = wikitext;

  // Pull out tables FIRST so their contents don't get mangled by the
  // prose-level conversions below. Each table becomes a placeholder token,
  // the token is swapped back for GFM markdown at the end.
  const tables: string[] = [];
  md = md.replace(/\{\|[\s\S]*?\n\|\}/g, (match) => {
    const idx = tables.length;
    tables.push(parseWikiTable(match));
    return `\u0000WIKITABLE_${idx}\u0000`;
  });

  // Noinclude / categories / magic words / file links
  md = md.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '');
  md = md.replace(/\[\[Category:[^\]]*\]\]/gi, '');
  md = md.replace(/__[A-Z]+__/g, '');
  md = md.replace(/\[\[File:[^\]]*\]\]/gi, '');
  md = md.replace(/\[\[Image:[^\]]*\]\]/gi, '');

  // Headings
  md = md.replace(/^======\s*(.+?)\s*======$/gm, '###### $1');
  md = md.replace(/^=====\s*(.+?)\s*=====$/gm, '##### $1');
  md = md.replace(/^====\s*(.+?)\s*====$/gm, '#### $1');
  md = md.replace(/^===\s*(.+?)\s*===$/gm, '### $1');
  md = md.replace(/^==\s*(.+?)\s*==$/gm, '## $1');
  md = md.replace(/^=\s*(.+?)\s*=$/gm, '# $1');

  // Refs, templates, inline formatting, wiki + external links
  md = md.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  md = md.replace(/<ref[^>]*\/>/g, '');
  md = md.replace(/\{\{[^{}]*\}\}/g, '');
  md = md.replace(/'''(.+?)'''/g, '**$1**');
  md = md.replace(/''(.+?)''/g, '_$1_');
  md = md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2](https://wiki.fractalaudio.com/wiki/index.php?title=$1)');
  md = md.replace(/\[\[([^\]]+)\]\]/g, '[$1](https://wiki.fractalaudio.com/wiki/index.php?title=$1)');
  md = md.replace(/\[https?:\/\/([^\s\]]+)\s([^\]]+)\]/g, '[$2](https://$1)');
  md = md.replace(/\[https?:\/\/([^\s\]]+)\]/g, '[link](https://$1)');

  // Lists
  md = md.replace(/^\*\*\*\s*/gm, '      - ');
  md = md.replace(/^\*\*\s*/gm, '   - ');
  md = md.replace(/^\*\s*/gm, '- ');
  md = md.replace(/^###\s+/gm, '      1. ');
  md = md.replace(/^##\s+/gm, '   1. ');
  md = md.replace(/^#\s+/gm, (m) => m.startsWith('# ') && !m.startsWith('##') ? '1. ' : m);

  // Definition lists
  md = md.replace(/^;\s*(.+)$/gm, '**$1**');
  md = md.replace(/^:\s*(.+)$/gm, '> $1');

  // Remaining HTML tags
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<[^>]+>/g, '');

  // Splice tables back in
  md = md.replace(/\u0000WIKITABLE_(\d+)\u0000/g, (_, idx) => tables[Number(idx)] ?? '');

  // Collapse excessive blank lines
  md = md.replace(/\n{4,}/g, '\n\n\n');

  // Add header
  const header = [
    `# ${title.replace(/_/g, ' ')}`,
    '',
    `> Source: https://wiki.fractalaudio.com/wiki/index.php?title=${title}`,
    `> Fetched: ${new Date().toISOString().split('T')[0]}`,
    `> This is a community-maintained wiki page for Fractal Audio products.`,
    '',
    '---',
    '',
  ].join('\n');

  return header + md.trim();
}

function safeFilename(title: string): string {
  return title.replace(/\//g, '_').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface FetchResult {
  title: string;
  priority: string;
  status: 'ok' | 'skip' | 'error';
  filename: string;
  bytes?: number;
  error?: string;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results: FetchResult[] = [];
  const priorityFilter = process.argv[2]; // e.g. "P0" to only fetch P0 pages

  console.log(`\nFractal Audio Wiki Scraper`);
  console.log(`Output: ${OUT_DIR}`);
  if (priorityFilter) {
    console.log(`Filter: ${priorityFilter} only`);
  }
  console.log(`Pages: ${PAGES.length} total\n`);

  for (const page of PAGES) {
    if (priorityFilter && page.priority !== priorityFilter) {
      results.push({ title: page.title, priority: page.priority, status: 'skip', filename: '' });
      continue;
    }

    const filename = safeFilename(page.title) + '.md';
    const filepath = path.join(OUT_DIR, filename);

    // Skip if already fetched (re-run safe)
    if (fs.existsSync(filepath)) {
      const size = fs.statSync(filepath).size;
      console.log(`  ✓ ${page.title} (cached, ${size} bytes)`);
      results.push({ title: page.title, priority: page.priority, status: 'ok', filename, bytes: size });
      continue;
    }

    const url = `${WIKI_BASE}?title=${encodeURIComponent(page.title)}&action=raw`;
    process.stdout.write(`  ↓ ${page.title} ... `);

    try {
      const raw = await fetchText(url);

      if (raw.trim().length === 0) {
        console.log('empty');
        results.push({ title: page.title, priority: page.priority, status: 'error', filename, error: 'empty response' });
        continue;
      }

      const md = wikiToMarkdown(raw, page.title);
      fs.writeFileSync(filepath, md, 'utf8');
      console.log(`${md.length} bytes`);
      results.push({ title: page.title, priority: page.priority, status: 'ok', filename, bytes: md.length });

      await sleep(DELAY_MS);
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      results.push({ title: page.title, priority: page.priority, status: 'error', filename, error: err.message });
    }
  }

  // Write index
  const ok = results.filter(r => r.status === 'ok');
  const errors = results.filter(r => r.status === 'error');
  const skipped = results.filter(r => r.status === 'skip');

  const index = [
    '# Fractal Audio Wiki — AM4 Pages',
    '',
    `> Scraped: ${new Date().toISOString().split('T')[0]}`,
    `> Pages fetched: ${ok.length} | Errors: ${errors.length} | Skipped: ${skipped.length}`,
    '',
    '---',
    '',
    '## P0 — Block parameters (preset building)',
    '',
    ...results
      .filter(r => r.priority === 'P0' && r.status === 'ok')
      .map(r => `- [${r.title.replace(/_/g, ' ')}](./${r.filename})`),
    '',
    '## P1 — Protocol and preset structure',
    '',
    ...results
      .filter(r => r.priority === 'P1' && r.status === 'ok')
      .map(r => `- [${r.title.replace(/_/g, ' ')}](./${r.filename})`),
    '',
    '## P2 — Concepts and context',
    '',
    ...results
      .filter(r => r.priority === 'P2' && r.status === 'ok')
      .map(r => `- [${r.title.replace(/_/g, ' ')}](./${r.filename})`),
    '',
    '## P3 — Hardware and UI',
    '',
    ...results
      .filter(r => r.priority === 'P3' && r.status === 'ok')
      .map(r => `- [${r.title.replace(/_/g, ' ')}](./${r.filename})`),
    '',
    errors.length > 0 ? '## Errors\n' : '',
    ...errors.map(r => `- ❌ ${r.title}: ${r.error}`),
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, '_index.md'), index, 'utf8');

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done. ${ok.length} pages saved to docs/wiki/`);
  if (errors.length > 0) {
    console.log(`${errors.length} errors — check _index.md`);
  }
  console.log(`Index: docs/wiki/_index.md`);
}

main().catch(console.error);
