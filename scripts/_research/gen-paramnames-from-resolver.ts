/**
 * Emit `src/protocol/paramNamesGenerated.ts` — friendly parameter names
 * synthesized from the resolver MISSING set.
 *
 * Background. `paramNames.ts` is the hand-curated wire-id → friendly-name
 * registry — the source of agent-callable parameter names. Coverage was
 * ~226 entries built incrementally from hardware captures. Session 46
 * cont 4 (2026-05-03) extracted the full per-variant resolver from
 * AM4-Edit.exe (1,818 bindings across 50 dispatch tables), making the
 * resolver the firmware-truth authority for `(block, cache_id) → parameterName`.
 * The diff report `samples/captured/decoded/labels/resolver-vs-paramnames.json`
 * has 651 MISSING entries — wire addresses the resolver knows but
 * `paramNames.ts` has no friendly name for.
 *
 * This script consumes diff.missing, intersected with the BLOCKS catalog
 * (the 17 cache-driven blocks gen-params-from-cache.ts knows how to
 * walk), and emits a friendly-name per surviving entry.
 *
 * Pipeline order:
 *   1. `npx tsx scripts/parse-cache.ts`            — parses the cache.
 *   2. `npx tsx scripts/extract-variant-resolver.ts` — extracts resolver.
 *   3. `npx tsx scripts/report-resolver-vs-paramnames.ts` — builds diff.
 *   4. `npx tsx scripts/gen-paramnames-from-resolver.ts` — THIS SCRIPT.
 *   5. `npx tsx scripts/gen-params-from-cache.ts`   — emits cacheParams.ts
 *      after merging hand + generated names.
 *
 * parameterName picking (when a cacheId has multiple variant bindings):
 *   - Score each candidate by whether it has a meaningful canonical
 *     label in EDITOR_CONTROLS (label != parameterName, non-empty,
 *     length > 1 char).
 *   - Among meaningful candidates, prefer (configurable per block) so
 *     the amp block's primary identity (DISTORT_*) wins over the
 *     cab-section secondary identity (CABINET_*). Other blocks fall back
 *     to alphabetical order for stability.
 *
 * Friendly-name synthesis:
 *   - Snake-case the canonicalLabel: "Bright Cap" → "bright_cap".
 *   - Fall back to lowercased parameterName when the canonical label is
 *     missing / equals the parameterName / is too short ("1k", "100").
 *   - When two cacheIds in the same block produce the same friendly name,
 *     suffix the second one with `_${parameterNameTail}` for stability.
 *
 * Filtering:
 *   - Skip cacheIds without a cache record (UI-only IDs like 65292+ —
 *     buttons / graphs that don't address a wire param).
 *   - Skip records the cache pipeline already drops (blockHeader,
 *     a===b degenerate floats).
 *   - Skip enum-kind records. The existing gen-params-from-cache.ts
 *     pipeline only knows how to attach one enum import per block (the
 *     block's primary Type enum — typically at cacheId=10 / 19 / 20).
 *     Non-Type enums (OFF/ON toggles, amp wiring modes, tube types,
 *     etc.) need a per-(block, cacheId) enum-resolution mechanism we
 *     haven't built yet. Until that lands, any enum record in MISSING
 *     stays out of the generated set rather than risking emission with
 *     the wrong enum import. Tracked for follow-up: ~140 enum records
 *     across the BLOCKS catalog that the resolver knows but we can't
 *     yet emit safely.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDITOR_CONTROLS } from 'fractal-midi/am4';
import { PARAM_NAMES, type ParamNameEntry } from 'fractal-midi/am4';
import { KNOWN_PARAMS } from 'fractal-midi/am4';

function nameOfHandEntry(entry: ParamNameEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/**
 * Build a per-block set of friendly names already taken by hand-curated
 * entries in `paramNames.ts` + `params.ts:KNOWN_PARAMS`. The generator
 * must not emit a name that collides with a hand entry (even at a
 * different cacheId), because the downstream cache pipeline keys
 * CACHE_PARAMS by `${block}.${name}` — a duplicate would silently
 * overwrite one entry with the other.
 *
 * `params.ts:KNOWN_PARAMS` is also consulted because many hand-authored
 * entries are not in `paramNames.ts` — they live directly in KNOWN_PARAMS
 * because they need a unit / range override the cache-c=1 default would
 * misclassify (e.g. `amp.xformer_low_freq` is `hz` 10..20000 but cache
 * c=1 alone would suggest `db`).
 */
const HAND_NAMES_BY_BLOCK = new Map<string, Set<string>>();
for (const [block, entries] of Object.entries(PARAM_NAMES)) {
  const set = new Set<string>();
  for (const entry of Object.values(entries)) set.add(nameOfHandEntry(entry));
  HAND_NAMES_BY_BLOCK.set(block, set);
}
for (const param of Object.values(KNOWN_PARAMS)) {
  const set = HAND_NAMES_BY_BLOCK.get(param.block) ?? new Set<string>();
  set.add(param.name);
  HAND_NAMES_BY_BLOCK.set(param.block, set);
}

/**
 * Per-(block, cacheId) reservation. If KNOWN_PARAMS already addresses
 * this wire address, the generator skips it entirely — the hand entry
 * is authoritative for unit / range overrides the cache signature alone
 * cannot supply, and re-emitting a generated entry at the same address
 * would either duplicate the friendly name or generate a different
 * friendly name pointing at the same wire register.
 */
const HAND_CACHE_IDS_BY_BLOCK = new Map<string, Set<number>>();
for (const param of Object.values(KNOWN_PARAMS)) {
  const set = HAND_CACHE_IDS_BY_BLOCK.get(param.block) ?? new Set<number>();
  set.add(param.pidHigh);
  HAND_CACHE_IDS_BY_BLOCK.set(param.block, set);
}

interface CacheRec {
  offset: number;
  block: number;
  id: number;
  typecode?: number;
  kind: 'float' | 'enum' | 'blockHeader';
  a?: number; b?: number; c?: number; d?: number;
  values?: string[];
}

interface MissingEntry {
  block: string;
  cacheId: number;
  resolverParameterNames: string[];
  canonicalLabels: string[];
}

interface Diff {
  missing: MissingEntry[];
}

interface BlockSpec {
  blockName: string;
  section: 'S2' | 'S3';
  cacheBlock: number;
  /**
   * Optional parameterName-prefix preference list for variant-ambiguity
   * tiebreaks. The first prefix that matches one of the candidates wins.
   * Defaults to alphabetical when absent.
   */
  variantPreference?: string[];
}

const BLOCKS: BlockSpec[] = [
  // amp's primary identity is the amp/distort section. The cab section
  // (CABINET_*) shares the block envelope but is conceptually secondary —
  // prefer DISTORT_* names when both are meaningful at the same cacheId.
  { blockName: 'amp',        section: 'S2', cacheBlock: 5,  variantPreference: ['DISTORT_', 'CABINET_'] },
  { blockName: 'drive',      section: 'S3', cacheBlock: 9 },
  { blockName: 'reverb',     section: 'S3', cacheBlock: 0 },
  // delay shares cacheIds across DELAY_/MULTITAP_/PLEX_ variants. The
  // standard delay variant is the primary identity.
  { blockName: 'delay',      section: 'S3', cacheBlock: 1,  variantPreference: ['DELAY_', 'MULTITAP_', 'PLEX_'] },
  { blockName: 'chorus',     section: 'S3', cacheBlock: 2 },
  { blockName: 'flanger',    section: 'S3', cacheBlock: 3 },
  { blockName: 'phaser',     section: 'S3', cacheBlock: 5 },
  { blockName: 'wah',        section: 'S3', cacheBlock: 6 },
  { blockName: 'compressor', section: 'S2', cacheBlock: 2 },
  { blockName: 'geq',        section: 'S2', cacheBlock: 3 },
  { blockName: 'filter',     section: 'S3', cacheBlock: 8 },
  { blockName: 'tremolo',    section: 'S3', cacheBlock: 7 },
  { blockName: 'enhancer',   section: 'S3', cacheBlock: 10 },
  { blockName: 'gate',       section: 'S3', cacheBlock: 11 },
  { blockName: 'volpan',     section: 'S3', cacheBlock: 12 },
  { blockName: 'peq',        section: 'S2', cacheBlock: 4 },
  { blockName: 'rotary',     section: 'S3', cacheBlock: 4 },
];

const DECODED_DIR = 'samples/captured/decoded';
const s2: CacheRec[] = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section2.json'), 'utf8'));
const s3: CacheRec[] = JSON.parse(readFileSync(join(DECODED_DIR, 'cache-section3.json'), 'utf8')).records;

const diff: Diff = JSON.parse(
  readFileSync(join(DECODED_DIR, 'labels', 'resolver-vs-paramnames.json'), 'utf8'),
);

function findCacheRecord(spec: BlockSpec, cacheId: number): CacheRec | undefined {
  const src = spec.section === 'S2' ? s2 : s3;
  return src.find((r) => r.block === spec.cacheBlock && r.id === cacheId);
}

/**
 * Score a (parameterName, canonicalLabel) candidate. Higher is better.
 * 100 = real XML label; 50 = label === parameterName (resolver knew the
 * name but no XML metadata); 0 = no entry in EDITOR_CONTROLS at all.
 */
function scoreCandidate(parameterName: string, canonicalLabel: string): number {
  const editorEntry = EDITOR_CONTROLS[parameterName];
  if (!editorEntry) return 0;
  const label = editorEntry.canonicalLabel ?? canonicalLabel;
  if (!label || label.length === 0) return 25;
  if (label === parameterName) return 50;
  return 100;
}

interface PickedCandidate {
  parameterName: string;
  canonicalLabel: string;
}

function pickCandidate(entry: MissingEntry, spec: BlockSpec): PickedCandidate | undefined {
  if (entry.resolverParameterNames.length === 0) return undefined;
  const candidates = entry.resolverParameterNames.map((p, i) => ({
    parameterName: p,
    canonicalLabel: entry.canonicalLabels[i] ?? '',
    score: scoreCandidate(p, entry.canonicalLabels[i] ?? ''),
  }));
  // Highest score wins. On ties, apply variant preference; else alphabetical.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (spec.variantPreference) {
      const aRank = spec.variantPreference.findIndex((p) => a.parameterName.startsWith(p));
      const bRank = spec.variantPreference.findIndex((p) => b.parameterName.startsWith(p));
      const aR = aRank === -1 ? 999 : aRank;
      const bR = bRank === -1 ? 999 : bRank;
      if (aR !== bR) return aR - bR;
    }
    return a.parameterName.localeCompare(b.parameterName);
  });
  return candidates[0];
}

/**
 * Snake-case a display label. Strip non-alphanumeric, lowercase, collapse
 * whitespace runs to single underscore. "Bright Cap" -> "bright_cap";
 * "L/R Time Ratio" -> "l_r_time_ratio"; "# of Springs" -> "of_springs".
 */
function snakeCase(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Strip the block-prefix (e.g. DISTORT_, FUZZ_, CHORUS_, BLOCK_) from a
 * parameterName so the fallback friendly name is human-readable rather
 * than carrying the noisy prefix. "DISTORT_BRIGHTCAP" -> "brightcap";
 * "BLOCK_OUTBOOSTDB" -> "outboostdb".
 */
function stripParameterPrefix(parameterName: string): string {
  const idx = parameterName.indexOf('_');
  if (idx === -1) return parameterName.toLowerCase();
  return parameterName.slice(idx + 1).toLowerCase();
}

/**
 * Decide whether a candidate label is too thin to use as the friendly
 * name (numeric-only like "100" / "1k", single character, empty). For
 * these cases we fall back to the parameterName tail for readability.
 */
function isThinLabel(label: string): boolean {
  if (!label || label.length === 0) return true;
  if (label.length === 1) return true;
  if (/^[0-9.]+k?$/i.test(label.trim())) return true;
  return false;
}

/**
 * Detect when the snake-cased result of a label is too thin to use as a
 * friendly name. Catches cases like "B+" (snake → "b") and "1k" (snake →
 * "1k") where the source label looked OK but the snake-case strips the
 * non-alphanumeric punctuation that carried the meaning.
 */
function isThinSnake(snake: string): boolean {
  if (!snake || snake.length <= 2) return true;
  return false;
}

/**
 * Synthesize the friendly name. Prefer the canonical label snake-cased;
 * fall back to lowered parameterName tail when the label is missing,
 * equals the parameterName, or is too thin.
 */
function synthesizeName(picked: PickedCandidate): string {
  const editorEntry = EDITOR_CONTROLS[picked.parameterName];
  const label = editorEntry?.canonicalLabel ?? picked.canonicalLabel;
  if (
    !label ||
    label === picked.parameterName ||
    isThinLabel(label)
  ) {
    return stripParameterPrefix(picked.parameterName);
  }
  const snake = snakeCase(label);
  if (isThinSnake(snake)) return stripParameterPrefix(picked.parameterName);
  return snake;
}

interface GeneratedNameEntry {
  block: string;
  cacheId: number;
  parameterName: string;
  canonicalLabel: string;
  friendlyName: string;
}

function generate(): { entries: GeneratedNameEntry[]; skipped: { reason: string; entry: MissingEntry }[] } {
  const entries: GeneratedNameEntry[] = [];
  const skipped: { reason: string; entry: MissingEntry }[] = [];
  // Per-block reservation map so we can detect within-block name collisions
  // and disambiguate by appending the parameterName tail.
  const blockNames = new Map<string, Map<string, GeneratedNameEntry>>();

  for (const m of diff.missing) {
    const spec = BLOCKS.find((s) => s.blockName === m.block);
    if (!spec) {
      skipped.push({ reason: 'block not in BLOCKS catalog', entry: m });
      continue;
    }
    const rec = findCacheRecord(spec, m.cacheId);
    if (!rec) {
      skipped.push({ reason: `no cache record for (${m.block}, cacheId=${m.cacheId})`, entry: m });
      continue;
    }
    if (rec.kind === 'blockHeader') {
      skipped.push({ reason: 'blockHeader', entry: m });
      continue;
    }
    if (rec.kind === 'enum') {
      // See file header for the enum-skip rationale (one-import-per-block
      // limitation in the cache pipeline). Re-enable once we have a
      // per-(block, cacheId) enum-values lookup.
      skipped.push({ reason: 'enum kind (pending per-cacheId enum lookup)', entry: m });
      continue;
    }
    if (rec.kind === 'float' && rec.a !== undefined && rec.b !== undefined && rec.a === rec.b) {
      skipped.push({ reason: 'float a===b (degenerate)', entry: m });
      continue;
    }
    const handCacheIds = HAND_CACHE_IDS_BY_BLOCK.get(m.block) ?? new Set<number>();
    if (handCacheIds.has(m.cacheId)) {
      // KNOWN_PARAMS already covers this wire address with a hand-authored
      // entry (often with a unit/range override the cache signature alone
      // would misclassify). Skip — hand entry is authoritative.
      skipped.push({ reason: 'KNOWN_PARAMS already covers this (block, cacheId)', entry: m });
      continue;
    }
    const picked = pickCandidate(m, spec);
    if (!picked) {
      skipped.push({ reason: 'no candidate parameterName', entry: m });
      continue;
    }
    const editorEntry = EDITOR_CONTROLS[picked.parameterName];
    const canonicalLabel = editorEntry?.canonicalLabel ?? picked.canonicalLabel ?? '';
    let friendlyName = synthesizeName(picked);

    let perBlock = blockNames.get(m.block);
    if (!perBlock) {
      perBlock = new Map();
      blockNames.set(m.block, perBlock);
    }
    const handReserved = HAND_NAMES_BY_BLOCK.get(m.block) ?? new Set<string>();
    const isCollision = (name: string): boolean =>
      perBlock!.has(name) || handReserved.has(name);
    if (isCollision(friendlyName)) {
      // Collision within block — append parameterName tail to disambiguate.
      const tail = stripParameterPrefix(picked.parameterName);
      friendlyName = `${friendlyName}_${tail}`;
      // If the disambiguated name still collides (rare), append the cacheId.
      if (isCollision(friendlyName)) {
        friendlyName = `${friendlyName}_id${m.cacheId}`;
      }
    }
    const out: GeneratedNameEntry = {
      block: m.block,
      cacheId: m.cacheId,
      parameterName: picked.parameterName,
      canonicalLabel,
      friendlyName,
    };
    perBlock.set(friendlyName, out);
    entries.push(out);
  }

  return { entries, skipped };
}

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatBlock(block: string, perBlock: GeneratedNameEntry[]): string {
  const sorted = [...perBlock].sort((a, b) => a.cacheId - b.cacheId);
  const lines: string[] = [`  ${block}: {`];
  for (const e of sorted) {
    const labelComment = e.canonicalLabel && e.canonicalLabel !== e.parameterName
      ? ` // ${e.canonicalLabel.replace(/[\r\n]+/g, ' ').slice(0, 60)} (${e.parameterName})`
      : ` // ${e.parameterName}`;
    lines.push(`    ${e.cacheId}: '${escapeString(e.friendlyName)}',${labelComment}`);
  }
  lines.push('  },');
  return lines.join('\n');
}

function main(): void {
  const { entries, skipped } = generate();
  const byBlock = new Map<string, GeneratedNameEntry[]>();
  for (const e of entries) {
    if (!byBlock.has(e.block)) byBlock.set(e.block, []);
    byBlock.get(e.block)!.push(e);
  }
  const blockOrder = BLOCKS.map((s) => s.blockName).filter((b) => byBlock.has(b));
  const body = blockOrder.map((b) => formatBlock(b, byBlock.get(b)!)).join('\n');
  const header = `/**
 * Generated by scripts/gen-paramnames-from-resolver.ts — do not hand-edit.
 *
 * Friendly parameter names synthesized from the resolver MISSING set.
 * Each entry is a (cache_id → snake_case_name) binding for a wire address
 * the AM4-Edit variant resolver knows about but \`paramNames.ts\` has no
 * hand-curated entry for.
 *
 * Source authority chain (firmware-truth):
 *   1. AM4-Edit.exe variant resolver (FUN_1402e3da0)
 *      -> src/protocol/variantResolverTables.ts
 *      provides (block, parameterName, cache_id) bindings.
 *   2. AM4-Edit.exe BinaryData ZIP -> __block_layout*.xml
 *      -> src/protocol/editorControlLabels.ts
 *      provides parameterName -> canonical display label.
 *   3. AM4-Edit metadata cache (effectDefinitions_15_2p0.cache)
 *      -> samples/captured/decoded/cache-section{2,3}.json
 *      provides typecode / a / b / c -> unit + display range.
 *
 * Merge with the hand-curated \`paramNames.ts\` happens in
 * \`scripts/gen-params-from-cache.ts\`. Resolver-derived entries are
 * firmware-truth (from AM4-Edit.exe's per-variant dispatcher), so they
 * win on (block, cache_id) → parameterName conflicts. Hand-curated
 * entries from \`paramNames.ts\` were seeded from hardware captures —
 * messy and occasionally mis-bound — so they yield to the resolver
 * where the two disagree. For THIS regen, the generator only emits to
 * cache_ids where \`paramNames.ts\` has no entry (the diff's MISSING
 * set), so there is no actual conflict to resolve; the conflict-
 * resolution rule applies to future broader regenerations.
 *
 * Coverage as of regen: ${entries.length} new wire-bound friendly names
 * across ${byBlock.size} blocks.
 *
 * Comment beside each entry shows: <canonicalLabel> (<parameterName>) —
 * the canonical AM4-Edit display label as users will see it on screen,
 * paired with the firmware symbolic ID for cross-reference.
 */
import type { ParamNameEntry } from './paramNames.js';

export const GENERATED_PARAM_NAMES: Readonly<Record<string, Readonly<Record<number, ParamNameEntry>>>> = {
${body}
} as const;

export const GENERATED_PARAM_NAMES_FIRMWARE = 'AM4-Edit Mar 20 2026 build';
`;
  const outPath = 'src/fractal/am4/paramNamesGenerated.ts';
  writeFileSync(outPath, header);
  console.log(`wrote ${outPath} — ${entries.length} entries across ${byBlock.size} blocks`);
  for (const [b, es] of byBlock) console.log(`  ${b}: ${es.length}`);
  console.log(`\nSkipped: ${skipped.length}`);
  const reasonCounts = new Map<string, number>();
  for (const s of skipped) reasonCounts.set(s.reason, (reasonCounts.get(s.reason) ?? 0) + 1);
  for (const [r, n] of reasonCounts) console.log(`  ${r}: ${n}`);
}

main();
