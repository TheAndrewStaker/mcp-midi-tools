// Split docs/_private/HARDWARE-TASKS.md into per-device files +
// archive. One-shot refactor script — not part of preflight. Run via
// `npx tsx scripts/split-hardware-tasks.ts` from the repo root.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'docs/_private/HARDWARE-TASKS.md';
const lines = readFileSync(SRC, 'utf8').split('\n');

// Build heading map: hw → [start, end].
type Heading = { hw: string; start: number; end: number; line: string };
const headings: Heading[] = [];
lines.forEach((line, i) => {
    const m = line.match(/^### (HW-\d+[a-z]?) /);
    if (m) headings.push({ hw: m[1], start: i, end: -1, line });
});
for (let i = 0; i < headings.length; i++) {
    headings[i].end = i + 1 < headings.length ? headings[i + 1].start : lines.length;
}

function section(hw: string): string {
    const h = headings.find(x => x.hw === hw);
    if (!h) return '';
    return lines.slice(h.start, h.end).join('\n').trimEnd();
}

interface Row {
    hw: string;
    kind: 'capture' | 'desktop' | 'chat';
    priority: string;
    notes: string;
}

const am4Active: Row[] = [
    { hw: 'HW-067', kind: 'capture', priority: 'P0', notes: 'Main Levels page decode (sub-tasks HW-067a/b/c)' },
    { hw: 'HW-073', kind: 'capture', priority: 'P1', notes: 'AM4-Edit Refresh Preset Names + Display Preset List' },
    { hw: 'HW-051', kind: 'capture', priority: 'P3', notes: 'Reverb Spring + Hall Expert captures' },
    { hw: 'HW-043', kind: 'capture', priority: 'P3', notes: '6 remaining Expert-Edit captures (Flanger/Phaser/Tremolo/Filter/Enhancer/In-Gate)' },
    { hw: 'HW-045', kind: 'capture', priority: 'P3', notes: 'AM4-Edit File→Export request — stored-preset variant (working buffer variant shipped)' },
    { hw: 'HW-026', kind: 'capture', priority: 'P3', notes: 'Reverb pidHigh=0x0000 (likely Level)' },
    { hw: 'HW-049', kind: 'capture', priority: 'P3', notes: 'Presence-applied-when-not-displayed probe' },
    { hw: 'HW-017', kind: 'capture', priority: 'P3', notes: 'Disambiguate count-type candidates (3 captures)' },
    { hw: 'HW-023', kind: 'capture', priority: 'P3', notes: 'Secondary-block first-page residuals (largely closed by HW-040)' },
    { hw: 'HW-030', kind: 'capture', priority: 'P3', notes: 'type → exposed first-page knobs lazy-fill' },
    { hw: 'HW-062', kind: 'desktop', priority: 'P0', notes: 'Clean-VM install + first-conversation smoke (gates v0.1.0 launch)' },
    { hw: 'HW-064', kind: 'desktop', priority: 'P1', notes: 'Multi-turn conversation drift (10-turn script)' },
    { hw: 'HW-068', kind: 'desktop', priority: 'P2', notes: 'Setlist workflow demo + test (v0.2)' },
    { hw: 'HW-069', kind: 'desktop', priority: 'P2', notes: 'delay.time precision sweep' },
    { hw: 'HW-065', kind: 'desktop', priority: 'P2', notes: 'save_to_location end-to-end round-trip' },
    { hw: 'HW-050', kind: 'desktop', priority: 'P0', notes: 'Launch demo capture (Claude Desktop + AM4 display side-by-side)' },
    { hw: 'HW-016', kind: 'desktop', priority: 'P3', notes: 'BK-039 first-turn smoke re-test (partial pass)' },
    { hw: 'HW-072', kind: 'desktop', priority: 'P2', notes: 'Factory-data extraction tier 2 (one-time founder run)' },
    { hw: 'HW-038', kind: 'chat', priority: 'P3', notes: 'pidLow=0x0003 stray writes — one-line founder recall' },
    { hw: 'HW-039', kind: 'chat', priority: 'P3', notes: 'Compressor Sidechain + post-EQ — Expert-page label dictation' },
    { hw: 'HW-032', kind: 'chat', priority: 'P3', notes: 'Residual decode (no founder action)' },
    { hw: 'HW-042', kind: 'chat', priority: 'P3', notes: 'Chorus Expert-Edit decode (already captured, no founder action)' },
];

const hydraActive: Row[] = [
    { hw: 'HW-063', kind: 'desktop', priority: 'P1', notes: 'Iconic-tone diversity sweep (7 song-driven patches)' },
    { hw: 'HW-061', kind: 'desktop', priority: 'P2', notes: 'Launch demo addendum: Hydrasynth' },
];

const closed = headings
    .filter(h => h.line.includes('✅'))
    .map(h => h.hw);

console.log(`AM4 active: ${am4Active.length}`);
console.log(`Hydra active: ${hydraActive.length}`);
console.log(`Closed: ${closed.length}`);

const anchor = (hw: string) => hw.toLowerCase().replace(/-/g, '');

function header(title: string): string {
    return [
        `# Hardware Tasks — ${title}`,
        '',
        '> Per-device active hardware queue. Closed items live in',
        '> [HARDWARE-TASKS-ARCHIVE.md](HARDWARE-TASKS-ARCHIVE.md).',
        '>',
        '> **Status key:** 🔜 pending • ⏳ done, awaiting decode • 🟡 partial • ✅ moved to archive',
        '>',
        '> **Done signal:** `HW-NNN done` in chat with the saved path or observed behavior.',
        '',
        ''
    ].join('\n');
}

function table(rows: Row[], title: string): string {
    if (rows.length === 0) return '';
    let md = `## ${title}\n\n| HW | Priority | Notes |\n|---|---|---|\n`;
    for (const r of rows) {
        md += `| [${r.hw}](#${anchor(r.hw)}) | ${r.priority} | ${r.notes} |\n`;
    }
    return md + '\n';
}

function sectionsFor(rows: Row[]): string {
    let md = '## Active task descriptions\n\n';
    for (const r of rows) {
        const s = section(r.hw);
        if (s) md += `<a id="${anchor(r.hw)}"></a>\n\n${s}\n\n---\n\n`;
    }
    return md;
}

const am4 = header('Fractal AM4') +
    '## Quick orient\n\n' +
    'AM4 surface is largely validated end-to-end (v0.1.0 ships AM4 + Hydrasynth).\n' +
    'Active items split into three categories:\n\n' +
    '- 📷 **Capture-required** — needs USBPcap + AM4-Edit for wire-byte capture.\n' +
    '- 🎛️ **Desktop tests** — Claude Desktop conversational verification + device.\n' +
    '- 💬 **Chat-only** — founder one-line answer or label dictation, no capture.\n\n' +
    table(am4Active.filter(r => r.kind === 'capture'), '📷 Capture-required tasks') +
    table(am4Active.filter(r => r.kind === 'desktop'), '🎛️ Desktop tests') +
    table(am4Active.filter(r => r.kind === 'chat'), '💬 Chat-only tasks') +
    '---\n\n' +
    sectionsFor(am4Active);

writeFileSync('docs/_private/HARDWARE-TASKS-AM4.md', am4);
console.log(`Wrote HARDWARE-TASKS-AM4.md (${am4.split('\n').length} lines)`);

const hydra = header('ASM Hydrasynth Explorer') +
    '## Quick orient\n\n' +
    'Hydrasynth surface validated end-to-end Session 47 (HW-058, HW-060).\n' +
    "`apply_patch` covers one iconic tone; HW-063 (active) extends to pad/bass/arp\n" +
    'categories. Add bug-fix items as they surface — a multi-turn drift script\n' +
    "analogous to HW-064 hasn't been run on Hydrasynth yet, queue when AM4 clears.\n\n" +
    '- 📷 **Capture-required** — none active.\n' +
    '- 🎛️ **Desktop tests** — see below.\n\n' +
    table(hydraActive.filter(r => r.kind === 'desktop'), '🎛️ Desktop tests') +
    '---\n\n' +
    sectionsFor(hydraActive);

writeFileSync('docs/_private/HARDWARE-TASKS-HYDRASYNTH.md', hydra);
console.log(`Wrote HARDWARE-TASKS-HYDRASYNTH.md (${hydra.split('\n').length} lines)`);

const closedSorted = closed.slice().sort((a, b) => {
    const na = parseInt(a.replace(/[^0-9]/g, ''));
    const nb = parseInt(b.replace(/[^0-9]/g, ''));
    return na - nb || a.localeCompare(b);
});

let archive = '# Hardware Tasks — Archive (closed)\n\n' +
    '> Closed hardware tasks across all devices. Ordered by HW-NNN ascending.\n' +
    '> Detailed findings preserved inline; cross-reference SESSIONS.md for the\n' +
    '> chronological trail of decode work.\n\n' +
    '## Index\n\n| HW | Title |\n|---|---|\n';
for (const hw of closedSorted) {
    const h = headings.find(x => x.hw === hw)!;
    const cleanTitle = h.line
        .replace(/^### /, '')
        .replace(/[✅⏳🔜🟡].*$/u, '')
        .replace(/—/g, '')
        .replace(hw, '')
        .replace(/^\s*\(?\s*partial\s*\)?\s*/i, '')
        .trim();
    archive += `| [${hw}](#${anchor(hw)}) | ${cleanTitle} |\n`;
}
archive += '\n---\n\n## Closed task details\n\n';
for (const hw of closedSorted) {
    const s = section(hw);
    if (s) archive += `<a id="${anchor(hw)}"></a>\n\n${s}\n\n---\n\n`;
}
writeFileSync('docs/_private/HARDWARE-TASKS-ARCHIVE.md', archive);
console.log(`Wrote HARDWARE-TASKS-ARCHIVE.md (${archive.split('\n').length} lines)`);
