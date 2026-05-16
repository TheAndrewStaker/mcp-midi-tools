/**
 * Mine all forum corpora for Axe-Fx III function-0x01 captures.
 *
 * Function 0x01 is the undocumented (NOT in v1.4 PDF) write that
 * appears in real III SysEx captures whenever AxeEdit / a footswitch
 * sets a parameter or modifier. Decoding its field layout unlocks
 * `axefx3_set_param`.
 *
 * What this script does:
 *   1. Finds every `F0 00 01 74 10 01 …` byte run across all forum
 *      JSONs under docs/_private/.
 *   2. Normalizes each capture into a clean hex array.
 *   3. Groups by payload length (likely a constant for the function).
 *   4. Aligns captures byte-by-byte and surfaces which byte positions
 *      are constant vs. variable — the structural skeleton.
 *
 * Run: npx tsx scripts/_research/mine-axefx3-fn01.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
const PRIVATE = resolve(ROOT, 'docs/_private');

interface Source {
  content: string;
  author: string;
  thread: string;
  postUrl?: string;
}

function loadAllSources(): Source[] {
  const out: Source[] = [];
  const files = readdirSync(PRIVATE).filter((n) => /^forum-.+\.json$/.test(n));
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(PRIVATE, f), 'utf8'));
    if (data.threads) {
      for (const t of data.threads) {
        for (const p of (t.posts ?? [])) {
          out.push({
            content: p.content ?? '',
            author: p.author ?? '???',
            thread: t.title ?? '',
          });
        }
      }
    } else if (data.results) {
      for (const r of data.results) {
        out.push({
          content: r.snippet ?? '',
          author: r.author ?? '???',
          thread: r.title ?? '',
          postUrl: r.url ?? '',
        });
      }
    }
  }
  return out;
}

interface Capture {
  bytes: number[];
  source: Source;
  contextLabel: string;
}

/**
 * Parse a hex run starting at `F0 00 01 74 10 01` and continuing
 * until the matching `F7`. Tolerates space/dash/comma/newline
 * separators. Returns the raw byte array (including F0/F7) or null
 * if no valid run found.
 */
function extractCapturesFromText(text: string): Array<{ bytes: number[]; startIdx: number }> {
  const results: Array<{ bytes: number[]; startIdx: number }> = [];
  // Find every "F0 00 01 74 10 01" occurrence
  const re = /F0[\s,-]*0?0[\s,-]*0?1[\s,-]*7[A4][\s,-]*10[\s,-]*01/gi;
  for (const match of text.matchAll(re)) {
    const startIdx = match.index ?? 0;
    // Walk forward, collecting hex byte pairs until F7
    const rest = text.slice(startIdx);
    const bytes: number[] = [];
    const tokenRe = /([0-9a-fA-F]{2})/g;
    for (const tk of rest.matchAll(tokenRe)) {
      const b = Number.parseInt(tk[1], 16);
      bytes.push(b);
      if (b === 0xf7 && bytes.length > 1) break;
      if (bytes.length > 200) break; // safety
    }
    // Validate: starts with F0 00 01 74 10 01 and ends with F7
    if (
      bytes.length >= 8
      && bytes[0] === 0xf0
      && bytes[1] === 0x00
      && bytes[2] === 0x01
      && bytes[3] === 0x74
      && bytes[4] === 0x10
      && bytes[5] === 0x01
      && bytes[bytes.length - 1] === 0xf7
    ) {
      results.push({ bytes, startIdx });
    }
  }
  return results;
}

function fmtHex(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase();
}

function hexLine(bytes: number[]): string {
  return bytes.map(fmtHex).join(' ');
}

// ── Run ────────────────────────────────────────────────────────────

const sources = loadAllSources();
console.log(`Loaded ${sources.length} post/snippet sources.\n`);

const allCaptures: Capture[] = [];
for (const src of sources) {
  const found = extractCapturesFromText(src.content);
  for (const f of found) {
    // Brief context label: ~40 chars before the F0
    const ctxStart = Math.max(0, f.startIdx - 60);
    const ctxText = src.content.slice(ctxStart, f.startIdx).replace(/\s+/g, ' ').trim().slice(-40);
    allCaptures.push({ bytes: f.bytes, source: src, contextLabel: ctxText });
  }
}

console.log(`Found ${allCaptures.length} raw F0 00 01 74 10 01 ... F7 captures.\n`);

// Deduplicate identical byte sequences
const uniq = new Map<string, Capture & { count: number }>();
for (const c of allCaptures) {
  const key = hexLine(c.bytes);
  const existing = uniq.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    uniq.set(key, { ...c, count: 1 });
  }
}
console.log(`After dedup by byte-exact content: ${uniq.size} unique captures.\n`);

// Group by total length
const byLen = new Map<number, Array<Capture & { count: number }>>();
for (const c of uniq.values()) {
  const arr = byLen.get(c.bytes.length) ?? [];
  arr.push(c);
  byLen.set(c.bytes.length, arr);
}

console.log('Length distribution:');
for (const [len, items] of [...byLen.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${len.toString().padStart(3)} bytes: ${items.length} unique capture(s)`);
}
console.log();

// For each length group, list the captures and find which byte
// positions are constant vs. variable.
for (const [len, items] of [...byLen.entries()].sort((a, b) => a[0] - b[0])) {
  console.log('─'.repeat(72));
  console.log(`Length ${len} bytes — ${items.length} unique capture(s)`);
  console.log('─'.repeat(72));

  // Per-position distinct-value count
  const distinct: Set<number>[] = Array.from({ length: len }, () => new Set<number>());
  for (const it of items) {
    for (let i = 0; i < len; i += 1) distinct[i].add(it.bytes[i]);
  }

  // Header alignment row
  const positions = Array.from({ length: len }, (_, i) => i.toString().padStart(2, '0')).join(' ');
  console.log('pos: ' + positions);

  // Distinct counts row
  const distCounts = distinct
    .map((s) => s.size === 1 ? '..' : s.size.toString().padStart(2, ' '))
    .join(' ');
  console.log('uniq:' + distCounts);

  // Each capture, with constant-byte positions dimmed to "·· " for readability
  for (const it of items.slice(0, 12)) {
    const cols: string[] = [];
    for (let i = 0; i < len; i += 1) {
      cols.push(fmtHex(it.bytes[i]));
    }
    const tag = it.count > 1 ? `(×${it.count})` : '';
    console.log('     ' + cols.join(' ') + '  ' + tag);
    console.log('       [' + it.source.thread.slice(0, 50) + '] ' + it.source.author + ' — "' + it.contextLabel + '"');
  }
  if (items.length > 12) console.log(`     … and ${items.length - 12} more`);
  console.log();

  // Highlight which byte positions vary
  const varying = distinct
    .map((s, i) => ({ pos: i, count: s.size }))
    .filter((x) => x.count > 1 && x.count < items.length);
  if (varying.length > 0) {
    console.log(`Variable byte positions in this length-${len} group:`);
    for (const v of varying) {
      const values = [...distinct[v.pos]].sort((a, b) => a - b).map(fmtHex).join(' ');
      console.log(`  pos ${v.pos.toString().padStart(2)}: ${v.count} distinct values  →  ${values}`);
    }
    console.log();
  }
}

console.log('\nNext: pair captures with known parameter changes to decode field layout.');
console.log('Search the forum for more 0x01 examples:');
console.log('  https://forum.fractalaudio.com/search/<sid>/?q=%22F0+00+01+74+10+01%22');
console.log('  Specifically threads "Assigning a Footswitch on FC-12" and');
console.log('  "AxeFXIII MIDI Input receives TONS of messages" — both shown rich 0x01 traffic.');
