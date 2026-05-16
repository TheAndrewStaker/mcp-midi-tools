/**
 * Triage a forum-post dump for SysEx / preset-decode relevance.
 *
 * Reads the JSON output from forum-scrape-search.js (or the batch
 * variants) and ranks each result by keyword matches in title +
 * snippet. Groups by thread so we know which threads carry the most
 * decode-relevant signal — those are the ones worth fully scraping
 * with forum-scrape-thread.js (or the batch thread scraper).
 *
 * Run:
 *   npx tsx scripts/_research/triage-forum-posts.ts
 *
 *   # or point at a specific dump:
 *   npx tsx scripts/_research/triage-forum-posts.ts \
 *     docs/_private/forum-search-<timestamp>.json
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { argv } from 'node:process';

const ROOT = resolve(import.meta.dirname ?? __dirname, '../..');
const PRIVATE_DIR = resolve(ROOT, 'docs/_private');

// Pick the requested file or the most-recent forum-search dump.
function findDumpFile(): string {
  if (argv[2]) return resolve(argv[2]);
  const candidates = readdirSync(PRIVATE_DIR)
    .filter((n) => /^forum-search-.+\.json$/.test(n))
    .map((n) => join(PRIVATE_DIR, n));
  if (candidates.length === 0) {
    throw new Error('No forum-search-*.json files in docs/_private/');
  }
  // Newest by name (timestamps sort lexicographically).
  return candidates.sort().reverse()[0];
}

interface RawResult {
  title: string;
  url: string;
  author: string;
  datetime: string;
  display: string;
  context: string;
  snippet: string;
  page: number;
  /**
   * Optional — present only when the dump came from
   * docs/_private/forum-scrape-searches-batch.js. Lists which forum
   * search queries surfaced this result. Multi-query hits = high
   * signal.
   */
  matched_queries?: string[];
}

interface Dump {
  meta: Record<string, unknown>;
  results: RawResult[];
}

/**
 * Keyword groups → relevance points. Title hits weight more than
 * snippet hits. Title-only "sysex" outscores snippet-only.
 */
const KEYWORD_WEIGHTS: Array<{ pattern: RegExp; title: number; snippet: number; label: string }> = [
  { pattern: /\bsysex\b/i,                  title: 10, snippet: 4, label: 'sysex' },
  { pattern: /\bmidi\b/i,                   title: 4,  snippet: 1, label: 'midi' },
  { pattern: /\b\.syx\b/i,                  title: 8,  snippet: 3, label: '.syx' },
  { pattern: /\bpreset.*(file|format|dump|parse|decode|structure)\b/i,
                                            title: 10, snippet: 5, label: 'preset-format' },
  { pattern: /\b(parameter|param).*?(id|value|encoding|map)\b/i,
                                            title: 8,  snippet: 4, label: 'param-id' },
  { pattern: /\bblock.*?(id|enum|effect|list)\b/i,
                                            title: 6,  snippet: 3, label: 'block-id' },
  { pattern: /\b(reverse[- ]?engineer|decode|deconstruct)\b/i,
                                            title: 8,  snippet: 4, label: 'reverse-engineer' },
  { pattern: /\b0x[0-9a-f]{2,}\b/i,         title: 4,  snippet: 3, label: 'hex-byte' },
  { pattern: /\b(F0|f0)\s*00\s*01\s*74\b/i, title: 12, snippet: 8, label: 'fractal-prefix' },
  { pattern: /\bfractool|fracpad\b/i,       title: 5,  snippet: 2, label: 'closed-editor' },
  { pattern: /\b(checksum|crc|xor)\b/i,     title: 4,  snippet: 2, label: 'checksum' },
  { pattern: /\b(huffman|compress)\b/i,     title: 6,  snippet: 3, label: 'compression' },
  { pattern: /\b(third[- ]?party|3rd[- ]?party)\b/i,
                                            title: 5,  snippet: 2, label: 'third-party' },
  { pattern: /\b(axeedit|axe[- ]?edit)\b/i, title: 3,  snippet: 1, label: 'axeedit' },
  { pattern: /\b(controller|bank|program|pc|cc)\b.*\b(switch|change)\b/i,
                                            title: 3,  snippet: 1, label: 'midi-ctrl' },
  { pattern: /\b(protocol|wire format|encoding scheme|opcode)\b/i,
                                            title: 8,  snippet: 4, label: 'protocol' },
];

interface ScoredResult extends RawResult {
  threadId: string;
  score: number;
  matchedLabels: string[];
}

function extractThreadId(url: string): string {
  // .../threads/<slug>.<id>/post-<postnum>  → return <slug>.<id>
  const m = url.match(/\/threads\/([^/]+)\//);
  return m?.[1] ?? url;
}

function scoreResult(r: RawResult): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const { pattern, title, snippet, label } of KEYWORD_WEIGHTS) {
    if (pattern.test(r.title)) {
      score += title;
      matched.push(`${label}:title`);
    }
    if (pattern.test(r.snippet)) {
      score += snippet;
      matched.push(`${label}:snippet`);
    }
  }
  // Bonus: results that hit multiple forum search queries in a
  // batch search are inherently higher-signal. +3 per extra query.
  if (r.matched_queries && r.matched_queries.length > 1) {
    const bonus = (r.matched_queries.length - 1) * 3;
    score += bonus;
    matched.push(`multi-query+${bonus}`);
  }
  return { score, matched };
}

// ── Run ───────────────────────────────────────────────────────────

const dumpPath = findDumpFile();
console.log(`Triaging: ${basename(dumpPath)}\n`);

const dump: Dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
console.log(`Total posts: ${dump.results.length}`);

const scored: ScoredResult[] = dump.results.map((r) => {
  const { score, matched } = scoreResult(r);
  return { ...r, threadId: extractThreadId(r.url), score, matchedLabels: matched };
});

const nonZero = scored.filter((r) => r.score > 0);
console.log(`Posts with any keyword hit: ${nonZero.length} (${((nonZero.length / dump.results.length) * 100).toFixed(1)}%)\n`);

// Group by thread.
interface ThreadAgg {
  threadId: string;
  title: string;
  posts: ScoredResult[];
  totalScore: number;
  postCount: number;
}

const byThread = new Map<string, ThreadAgg>();
for (const r of nonZero) {
  const agg = byThread.get(r.threadId) ?? {
    threadId: r.threadId,
    title: r.title,
    posts: [],
    totalScore: 0,
    postCount: 0,
  };
  agg.posts.push(r);
  agg.totalScore += r.score;
  agg.postCount += 1;
  byThread.set(r.threadId, agg);
}

const threads = [...byThread.values()].sort((a, b) => b.totalScore - a.totalScore);

console.log('─'.repeat(72));
console.log(`Top 20 threads by total SysEx-relevance score:\n`);
console.log('   #  score  posts  title');
console.log('  ─── ───── ────── ─────────────────────────────────────────');
for (const [i, t] of threads.slice(0, 20).entries()) {
  const idx = (i + 1).toString().padStart(3);
  const score = t.totalScore.toString().padStart(5);
  const count = t.postCount.toString().padStart(6);
  const title = t.title.length > 50 ? t.title.slice(0, 47) + '...' : t.title;
  console.log(`  ${idx} ${score} ${count}  ${title}`);
}

// Detailed top 10 — list the highest-scoring posts in each thread.
console.log('\n' + '─'.repeat(72));
console.log('Detail for top 10 threads (best 2-3 posts each):\n');
for (const t of threads.slice(0, 10)) {
  console.log(`\n[score ${t.totalScore}, ${t.postCount} matching posts]  ${t.title}`);
  console.log(`   thread URL: https://forum.fractalaudio.com/threads/${t.threadId}/`);
  const top = [...t.posts].sort((a, b) => b.score - a.score).slice(0, 3);
  for (const p of top) {
    console.log(`     • [${p.score}]  ${p.url}`);
    if (p.matchedLabels.length > 0) {
      console.log(`         matched: ${p.matchedLabels.join(', ')}`);
    }
    if (p.matched_queries && p.matched_queries.length > 0) {
      console.log(`         search queries: ${p.matched_queries.join('  |  ')}`);
    }
    if (p.snippet) {
      const snip = p.snippet.replace(/\s+/g, ' ').slice(0, 200);
      console.log(`         snippet: ${snip}${p.snippet.length > 200 ? '…' : ''}`);
    }
  }
}

// Summary: the actually-scrapable list.
console.log('\n' + '─'.repeat(72));
console.log('Threads worth scraping next (score >= 10, sorted by score):');
const candidates = threads.filter((t) => t.totalScore >= 10);
for (const t of candidates) {
  console.log(`  https://forum.fractalaudio.com/threads/${t.threadId}/   [${t.postCount} posts, score ${t.totalScore}]`);
  console.log(`    "${t.title}"`);
}

// Ready-to-paste JS array for the batch scraper. The user copies
// THIS block into forum-scrape-threads-batch.js and runs it once.
console.log('\n' + '─'.repeat(72));
console.log('Paste this into the THREAD_URLS array in docs/_private/forum-scrape-threads-batch.js:\n');
const SCRAPE_THRESHOLD = 10;
const MEGA_THREAD_POST_THRESHOLD = 50;
const scrapeTargets = candidates
  .filter((t) => t.postCount < MEGA_THREAD_POST_THRESHOLD)
  .map((t) => `    'https://forum.fractalaudio.com/threads/${t.threadId}/',  // [score ${t.totalScore}, ${t.postCount} posts] ${t.title.slice(0, 50)}`);
console.log('  const THREAD_URLS = [');
for (const line of scrapeTargets) console.log(line);
console.log('  ];');

const skipped = candidates.filter((t) => t.postCount >= MEGA_THREAD_POST_THRESHOLD);
if (skipped.length > 0) {
  console.log(`\nSkipped (${MEGA_THREAD_POST_THRESHOLD}+ matching posts — spot-scrape by URL instead of full thread):`);
  for (const t of skipped) {
    console.log(`  ${t.title} (${t.postCount} posts, score ${t.totalScore})`);
    console.log(`    https://forum.fractalaudio.com/threads/${t.threadId}/`);
  }
}

console.log('\nDone.');
console.log(`\nNext: edit docs/_private/forum-scrape-threads-batch.js with the array above,`);
console.log(`then paste it into the forum's dev tools console. One download covers them all.`);
