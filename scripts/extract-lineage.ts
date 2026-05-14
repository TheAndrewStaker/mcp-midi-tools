/**
 * MCP MIDI Control — Model Lineage Extractor (P3-007)
 *
 * Parses Fractal Audio's wiki scrape + Blocks Guide PDF-text into
 * per-type lineage records, cross-referenced against the canonical
 * AM4 catalog in src/protocol/cacheEnums.ts.
 *
 * Emits (committed in repo):
 *   src/fractal/shared/lineage/amp-lineage.json     (matched to AMP_TYPES)
 *   src/fractal/shared/lineage/drive-lineage.json   (matched to DRIVE_TYPES)
 *   src/fractal/shared/lineage/reverb-lineage.json  (matched to REVERB_TYPES)
 *   src/fractal/shared/lineage/delay-lineage.json   (matched to DELAY_TYPES)
 *   src/fractal/shared/lineage/cab-lineage.json     (standalone; no enum yet)
 *   plus per-block files for compressor / phaser / chorus / flanger / wah.
 *
 * Sources (all local + gitignored, no network):
 *   docs/_private/wiki/Amp_models_list.md
 *   docs/_private/wiki/Drive_block.md
 *   docs/_private/wiki/Reverb_block.md
 *   docs/_private/wiki/Delay_block.md
 *   docs/_private/wiki/Cab_models_list.md
 *   docs/manuals/Fractal-Audio-Blocks-Guide.txt
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AMP_TYPES, DRIVE_TYPES, REVERB_TYPES, DELAY_TYPES, COMPRESSOR_TYPES,
  CHORUS_TYPES, FLANGER_TYPES, PHASER_TYPES, WAH_TYPES,
} from '@mcp-midi-control/am4/cacheEnums.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WIKI_DIR = path.join(ROOT, 'docs', '_private', 'wiki');
const MANUALS_DIR = path.join(ROOT, 'docs', 'manuals');
const OUT_DIR = path.join(ROOT, 'packages', 'core', 'src', 'fractal-shared', 'lineage');

// ─── Types ───────────────────────────────────────────────────────────────────

type SourceTag =
  | 'fractal-blocks-guide'
  | 'fractal-wiki'
  | 'fractal-forum-quote'
  | 'heuristic-inferred';

/** `BasedOn` intentionally matches Fractal Audio's own phrasing — they
 *  consistently say "Based on X" in the wiki, Blocks Guide, and forum
 *  posts. Keeping the field name aligned with their vocabulary reduces
 *  cognitive overhead for contributors and matches what the agent will
 *  naturally "grep" for in queries like "what's this based on?". */
interface BasedOn {
  /** Distilled short noun phrase for reverse-lookup display / keyword match. */
  primary: string;
  /** Optional structured manufacturer when parseable (e.g. "MXR", "Fender"). */
  manufacturer?: string;
  /** Optional structured model ID when parseable (e.g. "M-102", "5F1", "2290"). */
  model?: string;
  /** Optional structured product name when parseable (e.g. "Dyna Comp", "Tube Screamer"). */
  productName?: string;
  /** Where the primary came from. */
  source: SourceTag;
}

interface FractalQuote {
  text: string;
  url?: string;
  attribution?: string;
}

/** HW-033: per-type knob list extracted from wiki "Controls:" prose. The
 *  Fractal wiki's per-type bodies frequently document the modeled device's
 *  physical control set ("The pedal has these controls: Drive, Tone, Level").
 *  Combined with the Drive_block.md line 232 rule — "The controls on the
 *  Basic page of the Drive correspond with the knobs on the modeled
 *  devices" — these labels tare a strong wiki-derived prior for the AM4-Edit
 *  Basic-page knob list per type. Used by `scripts/build-type-knobs.ts` to
 *  populate `docs/TYPE-KNOBS.md` rows for types we haven't hardware-captured.
 *  Always treat as a prior, not a guarantee — see TYPE-KNOBS.md notes. */
interface ControlsList {
  values: string[];
  /** The raw text captured before splitting + cleaning. Lets reviewers
   *  cross-check the parser's output against the source sentence. */
  raw: string;
  source: SourceTag;
}

interface BaseRecord {
  am4Name: string;
  wikiName?: string;
  basedOn?: BasedOn;
  description?: string;
  /** Where `description` came from. Nullable when description is absent. */
  descriptionSource?: SourceTag;
  controls?: ControlsList;
  fractalQuotes: FractalQuote[];
  flags: string[];
}

interface AmpRecord extends BaseRecord {
  family?: string;
  powerTubes?: string;
  matchingDynaCab?: string;
  originalCab?: string;
  artistNotes: string[];
}

interface DriveRecord extends BaseRecord {
  categories: string[];
  clipTypes: string[];
}

interface ReverbRecord extends BaseRecord {
  familyType?: string;
}

type DelayRecord = BaseRecord;
type CompressorRecord = BaseRecord;

interface CabRecord {
  wikiName: string;
  creator?: string;
  creatorPrefix?: string;
  sourceDescription?: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function readLines(p: string): string[] {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/);
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2019']/g, '')            // smart/straight apostrophe
    .replace(/[®™]/g, '')
    // Preserve `+` — it differentiates "IIC+" from "IIC++" (Mesa Mark
    // IIC+ vs the Metallica-custom IIC++ are different amps in AMP_TYPES
    // and collapsing them loses that distinction plus all the artist
    // attribution that lives in the IIC++ prose).
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

function matchCanonical(
  catalog: readonly string[],
  candidate: string,
): string | undefined {
  const norm = normalizeForMatch(candidate);
  if (!norm) return undefined;
  // Exact match only. startsWith-style fuzzy matching collapses wiki
  // channel-variants (e.g. "BRIT JVM OD1 ORANGE" → "Brit JVM OD1") which
  // loses distinction between canonical amps and their per-channel wiki
  // sub-entries. Flagged unmatched records preserve the data instead.
  for (const c of catalog) if (normalizeForMatch(c) === norm) return c;
  // Trailing " Delay" suffix is noisy in the Blocks Guide vs the AM4 enum
  // ("Ping-Pong Delay" vs "Ping-Pong"). Try once without it.
  const stripped = norm.replace(/\s+delay$/, '');
  if (stripped !== norm) {
    for (const c of catalog) if (normalizeForMatch(c) === stripped) return c;
  }
  return undefined;
}

// ─── BasedOn builder (BK-021) ─────────────────────────────────────────────
//
// Given a source text ("Based on MXR's M-102 Dyna Comp pedal."), extracts a
// structured `BasedOn` record with:
//   - primary       : distilled short noun phrase ("MXR M-102 Dyna Comp")
//   - manufacturer  : "MXR"         (when recognized)
//   - model         : "M-102"       (when parseable)
//   - productName   : "Dyna Comp"   (the remainder after brand + model)
//
// The parser is deliberately conservative: it populates structured fields
// only when the pattern is unambiguous, and falls back to a primary-only
// record for allusion-style inputs ("legendary original from Denmark") that
// don't name the real hardware. A small hardcoded model→brand table covers
// famous models whose names alone imply the manufacturer (2290 → TC
// Electronic, 1176 → Urei, LA-2A → Teletronix, etc.).

/** Common guitar/audio manufacturers that appear in Fractal's lineage text.
 *  Artist names are deliberately EXCLUDED — Dweezil Zappa and Keith Urban
 *  get mentioned as former owners of the amp Fractal modeled, but the
 *  manufacturer is Fender in both cases. Artist attribution lives in
 *  block-specific `artistNotes` fields, not in `basedOn.manufacturer`.
 */
const KNOWN_MANUFACTURERS: readonly string[] = [
  // Amps
  'Fender', 'Marshall', 'Mesa/Boogie', 'Mesa', 'Boogie', 'Bogner',
  'Friedman', 'Vox', 'Orange', 'Matchless', 'Diezel', 'Soldano',
  'Peavey', 'Hiwatt', 'ENGL', 'EVH', 'Randall', 'Ampeg', 'Dr. Z',
  'Two-Rock', 'Morgan', 'PRS', 'Suhr', 'Dumble', 'Trainwreck',
  'Fortin', 'Carvin', 'Victoria', 'Rivera', 'Supro', 'Magnatone',
  'Divided by 13', 'Cameron', 'Gibson', 'Kustom', 'Paul Reed Smith',
  'Rockman', 'Scholz Research',
  // Drive / FX pedals
  'Ibanez', 'Boss', 'MXR', 'Dunlop', 'Electro-Harmonix', 'EHX',
  'Pro Co', 'ProCo', 'DOD', 'Tycobrahe', 'Dallas Arbiter',
  'Dan Armstrong', 'Klon', 'Xotic', 'Lovepedal', 'Fulltone',
  'Wampler', 'Analog Man', 'Horizon Devices', 'JHS', 'Vemuram',
  'Maxon', 'Keeley', 'Nobelium', 'Darkglass', 'Catalinbread',
  'MI Audio', 'Paul Cochrane', 'Sola Sound', 'Morley', 'Colorsound',
  'Korg', 'Uni-Vibe', 'Mu-Tron', 'Mutron', 'A/DA',
  // Studio / rack
  'TC Electronic', 'Lexicon', 'Bricasti', 'Urei', 'Teletronix',
  'EMT', 'SSL', 'Fairchild', 'Maestro', 'Eventide', 'Strymon',
  'Line 6', 'Line6',
];

/**
 * Well-known model numbers whose brand is unambiguous even when Fractal's
 * text doesn't name it (e.g. "2290" alone means TC Electronic 2290).
 * Used for allusion-style descriptions and for am4Name-driven inference.
 */
const MODEL_TO_BRAND: Readonly<Record<string, { manufacturer: string; productName?: string }>> = {
  '2290': { manufacturer: 'TC Electronic', productName: '2290 Dynamic Digital Delay' },
  '1176': { manufacturer: 'Urei', productName: '1176 Limiting Amplifier' },
  'LA-2A': { manufacturer: 'Teletronix', productName: 'LA-2A Leveling Amplifier' },
  '140': { manufacturer: 'EMT', productName: '140 Plate Reverb' },
  'M-102': { manufacturer: 'MXR', productName: 'Dyna Comp' },
  'DM-2': { manufacturer: 'Boss', productName: 'DM-2 Delay' },
  'DM-Two': { manufacturer: 'Boss', productName: 'DM-2 Delay' },
  'TS-808': { manufacturer: 'Ibanez', productName: 'TS-808 Tube Screamer' },
  'TS-9': { manufacturer: 'Ibanez', productName: 'TS-9 Tube Screamer' },
  'TS9': { manufacturer: 'Ibanez', productName: 'TS-9 Tube Screamer' },
  'DS-1': { manufacturer: 'Boss', productName: 'DS-1 Distortion' },
  'OD-1': { manufacturer: 'Boss', productName: 'OD-1 Overdrive' },
  'SD-1': { manufacturer: 'Boss', productName: 'SD-1 Super Overdrive' },
  'CE-1': { manufacturer: 'Boss', productName: 'CE-1 Chorus' },
  'CE-2': { manufacturer: 'Boss', productName: 'CE-2 Chorus' },
  'Phase 90': { manufacturer: 'MXR', productName: 'Phase 90' },
  'Phase 100': { manufacturer: 'MXR', productName: 'Phase 100' },
  '5150': { manufacturer: 'Peavey', productName: '5150' },
  '5153': { manufacturer: 'EVH', productName: '5150 III' },
  '1959': { manufacturer: 'Marshall', productName: '1959 Super Lead Plexi' },
  '1987': { manufacturer: 'Marshall', productName: '1987 Plexi' },
};

const DESCRIPTOR_WORDS = new Set([
  'narrow-panel', 'wide-panel', 'vintage', 'modern', 'classic', 'original',
  'reissue', 'custom', 'legendary', 'famous', 'standard', 'deluxe',
  'first', 'second', 'third', 'latest', 'late', 'early', 'mid', 'new',
  'old', 'handwired', 'handbuilt', 'the', 'a', 'an',
  'high-power', 'low-power', 'high', 'low', 'power',
  'blackface', 'silverface', 'brownface',
  // Connector words: stray prepositions left over after stripping brand/
  // model from phrases like "custom model of MESA/Boogie IIC+"
  'of', 'from', 'by', 'with', 'like', 'via', 'inspired', 'based',
  // Evaluative adjectives that commonly appear in Fractal prose but
  // aren't part of a product name
  'venerable', 'aforementioned', 'so-called', 'popular', 'famed',
  'boutique', 'vintage-style', 'multifunctional', 'stereo', 'mono',
]);

/** Artists whose possessive form appears in amp wiki parens — used
 *  internally to strip their names from `productName` so the product
 *  noun phrase stays clean (e.g. "Keith Urban's 1959 narrow-panel
 *  high-power Fender Tweed Twin, 5F8" → productName "Tweed Twin 5F8"
 *  instead of "Keith Urbans ... Tweed Twin 5F8"). NOT exposed as a
 *  schema field — this list exists only for the `extractProductName`
 *  cleanup step. Agents wanting to reverse-search by artist use the
 *  fuzzy `real_gear` filter on `lookup_lineage`, which substring-
 *  matches the full description prose where artist references live.
 *  Extend only when a new paren-level artist possessive appears. */
const KNOWN_ARTISTS: readonly string[] = [
  'Keith Urban',
  'Dweezil Zappa',
  'Joe Satriani',
  'Steve Vai',
];

function detectArtist(phrase: string): string | undefined {
  for (const artist of KNOWN_ARTISTS) {
    const re = new RegExp(`\\b${artist.replace(/\s+/g, '\\s+')}(?:[’']s)?\\b`, 'i');
    if (re.test(phrase)) return artist;
  }
  return undefined;
}

/** Extract the gear-reference clause from a free-text lineage statement.
 *  Handles three input shapes:
 *    (1) Prefix form: "Based on the X." → captures "X"
 *    (2) Mid-sentence: "The Tube Compressor is based on a Fairchild." → "Fairchild"
 *    (3) No lineage verb (amp paren text): "Ibanez TS-9 Tube Screamer" → pass-through
 *  The capture stops at the first sentence break or explicit continuation
 *  word ("famous for", "used on", "unlike", "which") so fluff after the
 *  gear name doesn't bleed into the phrase. "e.g." is NOT a stop word —
 *  "rackmount compressors, e.g. LA-2A" needs LA-2A to remain captured.
 */
function extractGearPhrase(text: string): string {
  const cleaned = text
    .replace(/\s*\[link\]\([^)]*\)\s*/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');

  const startRe =
    /\b(?:based on|inspired by|modeled after|recreates(?:\s+the\s+sound\s+of)?)\s+(?:the\s+|a\s+|an\s+)?/i;
  const startMatch = cleaned.match(startRe);
  if (!startMatch || startMatch.index === undefined) return cleaned;

  const afterStart = cleaned.slice(startMatch.index + startMatch[0].length);

  // Find the first sentence boundary ("X. Y" where X is alphanumeric,
  // the next char is a space, and the following char is a capital
  // letter), skipping abbreviation periods ("e.g.", "i.e.") — their
  // signature is a period two chars before the period we're testing.
  const findSentenceEnd = (s: string): number => {
    for (let i = 1; i < s.length - 2; i++) {
      if (s[i] !== '.') continue;
      if (s[i + 1] !== ' ') continue;
      if (!/[A-Z]/.test(s[i + 2])) continue;
      // Abbreviation skip: "e.g. X" has a period 2 chars back
      if (i >= 2 && s[i - 2] === '.') continue;
      return i;
    }
    return -1;
  };

  // Stop at explicit continuation-word boundaries OR at a true sentence
  // boundary. Whichever comes first wins.
  const stopRe = /;|\s+(?:famous|used|unlike|which|that|but\s|set\s+the\s+|with\s+the\s+)/i;
  const stopMatch = afterStart.match(stopRe);
  const continuationIdx = stopMatch?.index ?? -1;
  const sentenceIdx = findSentenceEnd(afterStart);
  let cut = -1;
  if (continuationIdx >= 0 && sentenceIdx >= 0) cut = Math.min(continuationIdx, sentenceIdx);
  else cut = continuationIdx >= 0 ? continuationIdx : sentenceIdx;

  let captured = cut >= 0 ? afterStart.slice(0, cut) : afterStart;
  captured = captured.replace(/[,\s]+$/, '');
  return captured.trim();
}

/** Does this string look like a real-gear reference at all? */
function mentionsRealGear(text: string): boolean {
  return /\b(based on|inspired by|modeled after|recreates)\b/i.test(text);
}

/** Longest-first brand match against the KNOWN_MANUFACTURERS list. */
function detectManufacturer(phrase: string): string | undefined {
  const sorted = [...KNOWN_MANUFACTURERS].sort((a, b) => b.length - a.length);
  for (const brand of sorted) {
    const re = new RegExp(`\\b${brand.replace(/[-/.\s]/g, '[\\s\\-/.]+')}\\b`, 'i');
    if (re.test(phrase)) return brand;
  }
  return undefined;
}

/** Model-number shapes we accept:
 *    - Hyphenated letter-digit:     M-102, TS-9, TS-808, LA-2A, OD-1, DS-1
 *    - Letter(s) + digit(s):        TS9, TS808, DM2, SD1
 *    - Digit-letter-digit:          5F1, 5F8, 6G3, 6G12 (Fender-style codes)
 *    - Pure 4-5 digit numbers:      1176, 1959, 2290, 5153
 *  Rejected: wattages ("100W"), cab sizes ("4x12"), tube names ("6L6",
 *  "EL34", "KT88"), short decimals ("26.0"), 3-digit bare numbers ("260").
 */
const MODEL_RE = new RegExp(
  '\\b(' +
    '[A-Z]{1,4}-\\d+[A-Z0-9]{0,4}|' + // "M-102", "LA-2A"
    '[A-Z]{1,4}\\d+[A-Z0-9]{0,3}|' +  // "TS9", "DM2"
    '\\d[A-Z]\\d+[A-Z0-9]{0,3}|' +    // "5F1", "6G12"
    '\\d{4,5}' +                      // "1176", "2290"
  ')\\b',
);

function isModelLike(token: string): boolean {
  if (!MODEL_RE.test(token)) return false;
  if (/^\d+W$/i.test(token)) return false;     // wattage
  if (/^\d+x\d+$/i.test(token)) return false;  // cab size
  if (/^\d+V\d+$/i.test(token)) return false;  // tube 6V6
  if (/^\d+L\d+$/i.test(token)) return false;  // tube 6L6
  if (/^EL\d+$/i.test(token)) return false;    // tube EL34
  if (/^KT\d+$/i.test(token)) return false;    // tube KT88
  if (/^(19|20)\d{2}$/.test(token) && !(token in MODEL_TO_BRAND)) return false; // year
  return true;
}

/** Find the first plausible model identifier in a phrase. Scans all
 *  MODEL_RE matches and returns the first that passes isModelLike —
 *  handles phrases like "1965 blackface Fender Bassman AB165" where
 *  "1965" matches MODEL_RE but is a year (rejected by isModelLike),
 *  so we should return "AB165" instead.
 */
function detectModel(phrase: string): string | undefined {
  const re = new RegExp(MODEL_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(phrase)) !== null) {
    if (isModelLike(m[0])) return m[0];
  }
  return undefined;
}

/** Detect wiki parens / descriptions that signal a Fractal-original effect
 *  with no real-gear lineage ("custom model", "FAS original", "Our own
 *  take...", "designed by Fractal Audio"). These should produce no
 *  basedOn — their absence signals the Fractal-original nature.
 */
function isFractalOriginal(phrase: string): boolean {
  const p = phrase.toLowerCase();
  return (
    /^custom\b/i.test(p) ||
    /\bfas original\b/i.test(p) ||
    /\bfractal audio\b.*\b(original|own|design)/i.test(p) ||
    /^our own\b/i.test(p) ||
    /^fractal\s+(audio\s+)?original/i.test(p)
  );
}

/**
 * Build a structured BasedOn from a raw lineage text (paren, Blocks
 * Guide row, forum quote body, etc.). Returns undefined if the text
 * contains no identifiable real-gear content.
 */
function buildBasedOn(
  text: string,
  source: SourceTag,
  opts: { am4Name?: string } = {},
): BasedOn | undefined {
  if (!text) return undefined;
  const phrase = extractGearPhrase(text);
  if (!phrase) return undefined;

  const manufacturer = detectManufacturer(phrase);
  const model = detectModel(phrase);

  // Fractal-original signal: skip only when there's NO real-gear
  // reference in the phrase. "custom model" alone means Fractal-
  // original (FAS Boost), but "custom model of MESA/Boogie IIC+"
  // means a custom Fractal interpretation of a real Mesa — real gear
  // lineage still applies.
  if (isFractalOriginal(phrase) && !manufacturer && !model) return undefined;

  // If the detected model's MODEL_TO_BRAND entry conflicts with the
  // detected manufacturer, the model match is likely a false positive
  // (e.g. "1959 narrow-panel Fender Tweed" — "1959" is a year here, not
  // a Marshall model). Drop the model to keep the lookup from polluting
  // the product name.
  const lookup = model ? MODEL_TO_BRAND[model] : undefined;
  const modelConflicts =
    !!lookup &&
    !!manufacturer &&
    lookup.manufacturer.toLowerCase() !== manufacturer.toLowerCase();
  const finalModel = modelConflicts ? undefined : model;
  const finalLookup = modelConflicts ? undefined : lookup;

  // Detect artist possessive in the phrase so it can be stripped from
  // productName. The artist name itself isn't surfaced as a schema
  // field (see KNOWN_ARTISTS comment) — this is pure sanitization.
  const artist = detectArtist(phrase);

  // Priority 1: structured parse succeeded — we recognized a brand, a
  // model, or both. Prefer the curated product name from MODEL_TO_BRAND
  // when the model is famous (LA-2A → "LA-2A Leveling Amplifier"); fall
  // back to extraction from the phrase otherwise.
  if (manufacturer || finalModel) {
    const resolvedManufacturer = manufacturer ?? finalLookup?.manufacturer;
    const productName = finalLookup?.productName ??
      extractProductName(phrase, resolvedManufacturer, finalModel, artist);
    const primary = buildPrimary(phrase, resolvedManufacturer, finalModel, productName);
    return {
      primary,
      ...(resolvedManufacturer ? { manufacturer: resolvedManufacturer } : {}),
      ...(finalModel ? { model: finalModel } : {}),
      ...(productName ? { productName } : {}),
      source,
    };
  }

  // Priority 2: allusion rescue — the text itself didn't name anything
  // ("legendary original from Denmark"), but am4Name has a famous model
  // token. Emits a `heuristic-inferred` record using MODEL_TO_BRAND.
  if (opts.am4Name) {
    const inferred = inferBasedOnFromAm4Name(opts.am4Name);
    if (inferred) return inferred;
  }

  // Priority 3: unstructured primary — we can't parse brand/model but
  // the text is some kind of gear reference. Preserve the raw phrase so
  // reverse substring-search still works; leave structured fields absent
  // so callers can tell parse was unstructured. Strip artist possessives
  // (e.g. "Dweezil Zappa's Blankenship Leeds 21" → "Blankenship Leeds 21")
  // to keep primary clean.
  let cleanedPhrase = phrase;
  if (artist) {
    cleanedPhrase = cleanedPhrase
      .replace(new RegExp(`\\b${artist.replace(/\s+/g, '\\s+')}(?:[’']s)?\\b`, 'ig'), '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return { primary: cleanedPhrase || phrase, source };
}

function inferBasedOnFromAm4Name(am4Name: string): BasedOn | undefined {
  for (const [key, info] of Object.entries(MODEL_TO_BRAND)) {
    const re = new RegExp(`\\b${key.replace(/[-.]/g, '\\$&')}\\b`, 'i');
    if (re.test(am4Name)) {
      const primary = info.productName
        ? `${info.manufacturer} ${info.productName}`
        : `${info.manufacturer} ${key}`;
      return {
        primary,
        manufacturer: info.manufacturer,
        model: key,
        productName: info.productName,
        source: 'heuristic-inferred',
      };
    }
  }
  return undefined;
}

/** Whatever's left of the phrase after stripping brand + model + artist +
 *  descriptors + year tokens. */
function extractProductName(
  phrase: string,
  manufacturer: string | undefined,
  model: string | undefined,
  artist?: string,
): string | undefined {
  let remaining = phrase;
  if (manufacturer) {
    remaining = remaining.replace(
      new RegExp(`\\b${manufacturer.replace(/[-/.\s]/g, '[\\s\\-/.]+')}(?:[’']s)?\\b`, 'ig'),
      '',
    );
  }
  if (model) {
    remaining = remaining.replace(
      new RegExp(`\\b${model.replace(/[-.]/g, '\\$&')}\\b`, 'g'),
      '',
    );
  }
  if (artist) {
    remaining = remaining.replace(
      new RegExp(`\\b${artist.replace(/\s+/g, '\\s+')}(?:[’']s)?\\b`, 'ig'),
      '',
    );
  }
  // Strip "e.g.", "i.e.", "cf." abbreviations + parenthetical inserts +
  // year tokens — all historical/structural fluff that shouldn't be part
  // of the product name.
  remaining = remaining
    .replace(/\b(?:e\.g\.|i\.e\.|cf\.)\s*/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '');
  const tokens = remaining
    .split(/[\s,]+/)
    .map(t => t.replace(/[®™()\[\]"'.]/g, '').trim())
    .filter(Boolean)
    .filter(t => !DESCRIPTOR_WORDS.has(t.toLowerCase()))
    .filter(t => !/^(pedal|pedals|amp|amplifier|amps|amplifiers|unit|units|reverb|delay|compressor|distortion|overdrive|drive|fuzz|chorus|flanger|phaser|wah|tremolo|booster|boost|preamp|channel|model|type)$/i.test(t));
  const joined = tokens.join(' ').trim();
  return joined.length > 0 ? joined : undefined;
}

/** Build the distilled `primary` noun phrase. Skips `model` if productName
 *  already contains it (e.g. "LA-2A Leveling Amplifier" has "LA-2A"), so
 *  we don't emit "Teletronix LA-2A LA-2A Leveling Amplifier". */
function buildPrimary(
  phrase: string,
  manufacturer: string | undefined,
  model: string | undefined,
  productName: string | undefined,
): string {
  const parts: string[] = [];
  if (manufacturer) parts.push(manufacturer);
  const modelInProduct = productName && model &&
    productName.toLowerCase().includes(model.toLowerCase());
  if (model && !modelInProduct) parts.push(model);
  if (productName) parts.push(productName);
  if (parts.length === 0) return phrase;
  return parts.join(' ');
}

// Split a drive taxonomy member line: "Name &bull; Name &bull; ..."
function splitBulletList(line: string): string[] {
  return line
    .split(/\s*&bull;\s*/)
    .map(s => s.replace(/\*\*/g, '').trim())
    .filter(s => s.length > 0)
    .map(s => s.replace(/\s*\(all\)\s*$/i, '').trim());
}

// Extract `[link text](url)` from a markdown fragment.
function extractFirstUrl(s: string): string | undefined {
  const m = s.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/);
  return m ? m[1] : undefined;
}

// ─── Controls extractor (HW-033) ─────────────────────────────────────────────
//
// Parses per-type wiki bodies for "Controls:" / "the pedal has these
// controls:" / "the pedal has X, Y, Z knobs" / etc. patterns and returns the
// comma-separated list of modeled-device knob names. See `ControlsList` doc
// comment for design rationale.
//
// Patterns are tried in priority order; first successful match wins. The
// captured raw text is then split on commas / "and" / "&" / colons (for
// inline sub-lists like "four EQ knobs: Low, Low Mids, ..."), parentheticals
// stripped, and tokens that don't look like knob names dropped.

const CONTROLS_PATTERNS: readonly RegExp[] = [
  // 1. "Original controls (on the N-knob version)? (are)?: <list>."
  /\b[Oo]riginal\s+controls(?:\s+on\s+the\s+\S+-knob\s+version)?(?:\s+are)?\s*[:.]\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 2. "Controls on the (original\s+)?(pedal|amp|unit|model)(\s+include)?: <list>."
  /\b[Cc]ontrols\s+on\s+the\s+(?:original\s+)?(?:pedal|amp|unit|model)(?:\s+include)?\s*:\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 3. "models the original controls: <list>." (Phaser inline form)
  /\bmodels\s+the\s+original\s+controls?\s*:?\s*([^.!?\n]+?)\s*[.!?\n]/i,
  // 4. "Controls: <list>." anchored at sentence start
  /(?:^|[.!?\n]\s*)[Cc]ontrols\s*:\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 5. "Controls are (:) <list>." anchored at sentence start
  /(?:^|[.!?\n]\s*)[Cc]ontrols\s+are\s*:?\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 6. "the pedal's/amp's controls are (:) <list>." (curly + straight quotes)
  /\b[Tt]he\s+(?:pedal|amp|unit)[’']s\s+controls?\s+are\s*:?\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 7. "the (adj-)?pedal has (these|just|the)? (N)? control(s): <list>." Note
  //    optional "s" — wiki sometimes typos "control" (TS808 entry). Allow one
  //    optional adjective ("The diode-based pedal has...", "The classic
  //    pedal has...") since several drive entries use that phrasing.
  /\b[Tt]he\s+(?:[\w-]+\s+)?(?:pedal|amp|unit)\s+has\s+(?:these\s+|just\s+|the\s+)?(?:two\s+|three\s+|four\s+|five\s+|six\s+|seven\s+)?controls?\s*:\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 8. "the pedal has N knobs: <list>."
  /\b[Tt]he\s+(?:[\w-]+\s+)?(?:pedal|amp|unit)\s+has\s+(?:two|three|four|five|six)\s+knobs\s*:\s*([^.!?\n]+?)\s*[.!?\n]/,
  // 9. "the (adj-)?pedal has <Title-Case list> knobs[.]?" — e.g. "Gain,
  //    Volume, Bass and Treble knobs". Title-cased start anchors against
  //    random prose.
  /\b[Tt]he\s+(?:[\w-]+\s+)?(?:pedal|amp|unit)\s+has\s+([A-Z][A-Za-z0-9 ,/\-']*?)\s+knobs\b/,
  // 10. "the X has Y, Z and W controls" — e.g. "Original controls are: Vol,
  //     Gain, Tone and Voice." (covered by #1) but also "the model has
  //     Drive, Tone and Level controls."
  /\b[Tt]he\s+(?:model|original)\s+has\s+([A-Z][A-Za-z0-9 ,/\-']*?)\s+controls\b/,
];

const NON_KNOB_TOKENS = new Set([
  // Prose count-prefix words that survive splitting before "EQ knobs:"
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  // Pure descriptors that occasionally bleed in. Keep "EQ" — it's a real
  // knob label on some pedals (Tube Drive 4-Knob version, etc.).
  'active', 'passive', 'modeled', 'optional',
]);

/** Split the raw captured list into individual knob tokens.
 *
 *  Steps:
 *    1. Strip parentheticals so embedded commas don't fragment the list
 *       ("Drive (model: X)" → "Drive"; "Bass (cuts bass), Tone" → "Bass, Tone").
 *    2. Strip leading articles + "a/the/an".
 *    3. Split on `,` `;` `:` `and` `&`.
 *    4. Drop tokens not starting with [A-Z0-9] (prose continuation).
 *    5. Drop count-prefix phrases like "four EQ knobs" (after a colon split,
 *       "four EQ knobs" + "Low" become two tokens — only the second is a knob).
 *    6. Cap each token at 3 words to avoid catching trailing prose; knob
 *       names like "Low Cut" / "Mid Freq" / "Auto Makeup" stay intact.
 */
function splitControlList(raw: string): string[] {
  // First strip balanced inline parens iteratively, then strip orphan parens
  // (the wiki has typos like "Drive))" — the outer `)` sits outside any
  // balanced pair after iterative removal).
  let noParens = raw;
  let prev = '';
  while (noParens !== prev) {
    prev = noParens;
    noParens = noParens.replace(/\s*\([^()]*\)/g, '');
  }
  noParens = noParens.replace(/[()]/g, '').trim();

  const parts = noParens
    .split(/\s*[,;:]\s*|\s+and\s+|\s*&\s*/)
    .map(t => t.replace(/^(?:a|an|the)\s+/i, '').trim())
    .filter(Boolean);

  // Connective words signal that a relative clause has leaked into the
  // token (e.g. wiki prose like "Glass switch which sets the type to..."
  // becomes "Glass which sets" after the comma split). Truncate before
  // them so only the knob noun phrase survives.
  const CONNECTIVE_RE = /\s+(?:which|that|when|where|sets?|setting|controls|controlling|of|in|on|at|for|with|to)\s/i;

  const keep: string[] = [];
  for (const p of parts) {
    if (!/^[A-Z0-9]/.test(p)) continue;
    // Drop count-prefix phrases ("four EQ knobs", "three knobs", etc.)
    if (/^(?:Two|Three|Four|Five|Six|Seven|Eight)\s+/.test(p)) continue;
    if (/^(?:EQ\s+)?[Kk]nobs?$/.test(p)) continue;
    if (/^(?:EQ|Tone)\s+(?:knob|control)s?$/i.test(p)) continue;
    // Truncate before any leaked relative clause.
    const connMatch = p.match(CONNECTIVE_RE);
    const trimmed = connMatch && connMatch.index !== undefined
      ? p.slice(0, connMatch.index).trim()
      : p;
    if (!trimmed) continue;
    // Cap at 3 words; knob names beyond that are usually wiki prose.
    const words = trimmed.split(/\s+/).slice(0, 3);
    const truncated = words.join(' ').replace(/[.,;:)]+$/, '').trim();
    if (!truncated) continue;
    if (NON_KNOB_TOKENS.has(truncated)) continue;
    keep.push(truncated);
  }
  return keep;
}

/** Iteratively strip *balanced* parenthetical content. Wiki prose like
 *  "Tone (doesn't affect the mid-hump) and Level" contains periods inside
 *  parens ("(2.8 kHz)") that break sentence-boundary regexes, so we strip
 *  them before pattern matching.
 *
 *  Important: must NOT use a depth-counting strip — the wiki has unbalanced
 *  parens (BB Pre's body has an unclosed `(` on the "Bluesbreakers (read
 *  more...)" line whose closer never arrives, plus Octave Distortion has a
 *  stray extra `)`). A depth-based strip would eat the entire rest of the
 *  body. The iterative-innermost approach only removes balanced pairs and
 *  leaves orphan parens in place. */
function stripParensForMatching(text: string): string {
  let prev = '';
  let curr = text;
  while (curr !== prev) {
    prev = curr;
    curr = curr.replace(/\([^()]*\)/g, '');
  }
  return curr;
}

/** Run all CONTROLS_PATTERNS over the body text; return the first match's
 *  cleaned token list, or undefined. Body should be raw wiki text including
 *  newlines — the patterns use `\n` as a sentence boundary. Parentheticals
 *  are stripped before matching so periods like "(2.8 kHz)" don't bound the
 *  match early. */
function extractControlsFromBody(body: string): ControlsList | undefined {
  const masked = stripParensForMatching(body);
  for (const re of CONTROLS_PATTERNS) {
    const m = masked.match(re);
    if (!m) continue;
    const raw = m[1].trim();
    const values = splitControlList(raw);
    if (values.length === 0) continue;
    return { values, raw, source: 'fractal-wiki' };
  }
  return undefined;
}

// ─── Amp parser ──────────────────────────────────────────────────────────────

function parseAmpFamilies(lines: string[]): Map<string, string> {
  // Lines like: "> FENDER — name1, name2, ..."  (some use no space before em dash)
  const map = new Map<string, string>();
  const re = /^>\s+([A-Z][A-Z0-9]*)\s*—\s*(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const family = m[1];
    const members = m[2].split(/,\s*/);
    for (const mem of members) {
      // Expand patterns like "5F1 Tweed (EC)" → "5F1 Tweed" and "5F1 Tweed EC"
      const paren = mem.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (paren) {
        map.set(normalizeForMatch(paren[1]), family);
        map.set(normalizeForMatch(`${paren[1]} ${paren[2]}`), family);
      } else {
        map.set(normalizeForMatch(mem), family);
      }
    }
  }
  return map;
}

function lookupFamily(fam: Map<string, string>, ampName: string): string | undefined {
  const norm = normalizeForMatch(ampName);
  // Try progressively shorter prefixes — wiki family stems are short
  for (const [key, family] of fam) {
    if (norm === key || norm.startsWith(key + ' ')) return family;
  }
  return undefined;
}

function extractAmps(): AmpRecord[] {
  const src = path.join(WIKI_DIR, 'Amp_models_list.md');
  const lines = readLines(src);
  const families = parseAmpFamilies(lines);

  const ENTRY_RE = /^   1\.\s+([A-Z0-9][A-Z0-9 '\/\-+&.]*?)(?:\s*\(([^)]+)\))?\s*$/;
  const QUOTE_RE = /^1\.\s+"([^"]+)"(?:\s*\[[^\]]*\]\((https?:\/\/[^)]+)\))?/;

  const entries: Array<{ start: number; end: number; name: string; paren?: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ENTRY_RE);
    if (m) {
      if (entries.length > 0) entries[entries.length - 1].end = i;
      entries.push({ start: i, end: lines.length, name: m[1].trim(), paren: m[2]?.trim() });
    }
  }

  const records: AmpRecord[] = [];
  for (const e of entries) {
    const canonical = matchCanonical(AMP_TYPES, e.name);
    const rec: AmpRecord = {
      am4Name: canonical ?? e.name,
      wikiName: e.name,
      fractalQuotes: [],
      artistNotes: [],
      flags: canonical ? [] : ['VERIFY: no AMP_TYPES enum match'],
    };
    if (e.paren) {
      const built = buildBasedOn(e.paren, 'fractal-wiki', { am4Name: canonical ?? e.name });
      if (built) rec.basedOn = built;
    }
    const fam = lookupFamily(families, e.name);
    if (fam) rec.family = fam;

    const body = lines.slice(e.start + 1, e.end);
    const bodyText = body.join('\n');
    for (let i = 0; i < body.length; i++) {
      const line = body[i];
      if (/^Power tubes:/.test(line)) {
        rec.powerTubes = line.replace(/^Power tubes:\s*/, '').trim();
      } else if (/^Cab:\s*$/.test(line)) {
        for (let j = i + 1; j < Math.min(i + 6, body.length); j++) {
          const orig = body[j].match(/^-\s*original:\s*(.+)$/);
          const dyn = body[j].match(/^-\s*matching DynaCab:\s*(.+)$/);
          if (orig) rec.originalCab = orig[1].trim();
          if (dyn) rec.matchingDynaCab = dyn[1].trim();
        }
      }
      const q = line.match(QUOTE_RE);
      if (q) {
        rec.fractalQuotes.push({
          text: q[1].trim(),
          url: q[2],
          attribution: 'Fractal Audio',
        });
      }
    }
    // HW-033: most amp wiki bodies don't document a knob list (amps are
    // usually described by tonestack / power-section topology), but some do
    // — e.g. signature artist amps with custom knob layouts. Try anyway.
    const controls = extractControlsFromBody(bodyText);
    if (controls) rec.controls = controls;
    records.push(rec);
  }

  // Per-variant descriptions: some parent amp entries ship a
  // "Current models:" / "Models:" / "Previous models:" bullet block
  // where each bullet names a sibling variant with a short description
  // (e.g. FRIEDMAN BE 2010's block enumerates BE C45, BE V1, BE V2
  // with a one-line variant description each). These bullets don't live
  // on the sibling's own wiki heading, so the sibling records are
  // otherwise description-less. Pull them across.
  backfillAmpVariantDescriptions(records, lines, entries);

  // Sibling inheritance: variants like "5F8 Tweed Jumped" and "5F8 Tweed
  // Normal" don't get their own wiki paren — the lineage lives on a
  // sibling (e.g. "5F8 Tweed Bright"). Back-fill missing fields from the
  // closest sibling with data so the JSON doesn't carry hollow records.
  backfillAmpSiblings(records);
  return records;
}

/** Parse "Current models:" / "Previous models:" / "Models:" bullet blocks
 *  from each parent amp entry and attach per-variant descriptions to
 *  matching canonical sibling records. Bullet format:
 *    - <short-name>: <description>
 *  Matching: a bullet's short name matches a canonical amp when its
 *  normalized tokens are a suffix of the canonical's normalized tokens.
 *  Example: bullet "BE V1" matches canonical "Friedman BE V1".
 */
function backfillAmpVariantDescriptions(
  records: AmpRecord[],
  lines: string[],
  entries: Array<{ start: number; end: number; name: string; paren?: string }>,
): void {
  const HEADER_RE = /^(Current\s+models|Previous\s+models|Models)\s*:\s*$/i;
  const BULLET_RE = /^-\s+([A-Z0-9][A-Za-z0-9 '\-\/\.+]+?)\s*:\s+(.+?)\s*$/;
  const byCanonical = new Map<string, AmpRecord>();
  for (const r of records) byCanonical.set(r.am4Name.toLowerCase(), r);

  for (const e of entries) {
    // Collect all bullet (shortName, description) pairs from any
    // "Models:"-style header blocks inside the entry's body.
    const bullets: Array<{ shortName: string; description: string }> = [];
    let inBlock = false;
    for (let i = e.start + 1; i < e.end; i++) {
      const line = lines[i];
      if (HEADER_RE.test(line.trim())) { inBlock = true; continue; }
      if (!inBlock) continue;
      if (line.trim() === '') continue;
      const m = line.match(BULLET_RE);
      if (m) {
        bullets.push({ shortName: m[1].trim(), description: m[2].trim() });
        continue;
      }
      // Any non-bullet line ends the block (prose resumes).
      if (!/^-\s/.test(line)) inBlock = false;
    }
    if (bullets.length === 0) continue;

    // The parent amp's family prefix (e.g. "Friedman" from "Friedman BE 2010")
    // is inferred from the paren or first word of the canonical name —
    // used to reconstruct full canonical names from short bullet labels.
    const parentCanonical = matchCanonical(AMP_TYPES, e.name);
    const parentTokens = parentCanonical
      ? parentCanonical.toLowerCase().split(/\s+/)
      : e.name.toLowerCase().split(/\s+/);

    for (const b of bullets) {
      const bulletTokens = b.shortName.toLowerCase().split(/\s+/);
      // Find a canonical whose token sequence ends with the bullet's tokens
      // AND starts with at least one parent token (so "BE V1" matches
      // "Friedman BE V1" but not an unrelated amp).
      let target: AmpRecord | undefined;
      for (const [key, rec] of byCanonical) {
        const keyTokens = key.split(/\s+/);
        if (keyTokens.length < bulletTokens.length) continue;
        const tail = keyTokens.slice(keyTokens.length - bulletTokens.length);
        if (tail.join(' ') !== bulletTokens.join(' ')) continue;
        const sharesPrefix = keyTokens.some(t => parentTokens.includes(t));
        if (!sharesPrefix) continue;
        target = rec;
        break;
      }
      if (!target) continue;
      // Don't overwrite an existing description the record already has
      // (e.g. from a drive-style Blocks Guide row).
      if (target.description) continue;
      target.description = b.description;
      target.descriptionSource = 'fractal-wiki';
    }
  }
}

function backfillAmpSiblings(records: AmpRecord[]): void {
  // Index records that carry paren-derived lineage (the "rich" siblings).
  const rich: AmpRecord[] = records.filter(r => r.basedOn || r.powerTubes || r.originalCab);

  for (const r of records) {
    // Only back-fill records that are truly hollow on the lineage fields.
    const needsInspired = !r.basedOn;
    const needsTubes = !r.powerTubes;
    const needsCab = !r.originalCab && !r.matchingDynaCab;
    if (!needsInspired && !needsTubes && !needsCab) continue;

    const sibling = findAmpSibling(r, rich);
    if (!sibling) continue;

    if (needsInspired && sibling.basedOn) {
      // Preserve all structured fields (manufacturer/model/productName) so
      // BK-021's schema invariants hold on inherited records too — a
      // reverse lookup by `manufacturer: "Marshall"` should match
      // "1959SLP Normal" just like it matches "1959SLP Jumped".
      r.basedOn = { ...sibling.basedOn };
    }
    if (needsTubes && sibling.powerTubes) r.powerTubes = sibling.powerTubes;
    if (!r.originalCab && sibling.originalCab) r.originalCab = sibling.originalCab;
    if (!r.matchingDynaCab && sibling.matchingDynaCab) r.matchingDynaCab = sibling.matchingDynaCab;
    r.flags.push(`INHERITED: lineage from sibling "${sibling.am4Name}"`);
  }
}

function findAmpSibling(r: AmpRecord, rich: AmpRecord[]): AmpRecord | undefined {
  const tokens = r.am4Name.toLowerCase().split(/\s+/);
  // Try progressively shorter prefixes (drop last token, then second-last…).
  // A candidate is a sibling if its name either starts with "<prefix> "
  // (suffix-variant case: "Archean Clean" ← "Archean Bright") OR equals
  // the prefix exactly (base-of-variant case: "Archean Clean" ← "Archean").
  for (let n = tokens.length - 1; n >= 1; n--) {
    const prefix = tokens.slice(0, n).join(' ');
    for (const cand of rich) {
      if (cand.am4Name === r.am4Name) continue;
      const candLower = cand.am4Name.toLowerCase();
      if (candLower === prefix || candLower.startsWith(prefix + ' ')) return cand;
    }
  }
  return undefined;
}

// ─── Drive parser ────────────────────────────────────────────────────────────

interface Taxonomy {
  categories: Map<string, string[]>; // drive name (normalized) → category list
  clipTypes: Map<string, string[]>;
}

function parseDriveTaxonomy(lines: string[]): Taxonomy {
  const categories = new Map<string, string[]>();
  const clipTypes = new Map<string, string[]>();

  // Two taxonomies: "Per category" (line ~96) and "Per clip type" (line ~128)
  // Both use: header "   - Label**" followed by member list with &bull; separators
  const HEADER_RE = /^   - ([A-Za-z][A-Za-z0-9 ,\-\/]+)\*\*\s*$/;

  let mode: 'category' | 'cliptype' | null = null;
  let currentLabel: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Per category/.test(line)) mode = 'category';
    else if (/Per clip type/.test(line)) mode = 'cliptype';
    else if (/^1\.\s+Overdrive, distortion, fuzz/.test(line)) break; // taxonomies end

    if (!mode) continue;
    const h = line.match(HEADER_RE);
    if (h) {
      currentLabel = h[1].trim();
      continue;
    }
    if (currentLabel && /&bull;/.test(line)) {
      const members = splitBulletList(line);
      const target = mode === 'category' ? categories : clipTypes;
      for (const m of members) {
        const key = normalizeForMatch(m);
        if (!key) continue;
        if (!target.has(key)) target.set(key, []);
        target.get(key)!.push(currentLabel);
      }
      currentLabel = null;
    }
  }
  return { categories, clipTypes };
}

function extractDrives(): DriveRecord[] {
  const wikiSrc = path.join(WIKI_DIR, 'Drive_block.md');
  const lines = readLines(wikiSrc);
  const taxonomy = parseDriveTaxonomy(lines);

  // Entry scan — only below the taxonomy block. Each entry is
  //   "   1. NAME (inspired-by)"
  // The first entries before line ~500 are section headings, not drives.
  const ENTRY_RE = /^   1\.\s+([A-Z0-9][A-Z0-9 '\/\-+&.]*?)(?:\s*\(([^)]+)\))?\s*$/;
  const entryStart = lines.findIndex(l => /^1\.\s+Drive models$/.test(l));
  const scanFrom = entryStart >= 0 ? entryStart : 0;

  const entries: Array<{ start: number; end: number; name: string; paren?: string }> = [];
  for (let i = scanFrom; i < lines.length; i++) {
    const m = lines[i].match(ENTRY_RE);
    if (m) {
      if (entries.length > 0) entries[entries.length - 1].end = i;
      entries.push({ start: i, end: lines.length, name: m[1].trim(), paren: m[2]?.trim() });
    }
  }

  const blocksGuide = parseBlocksGuideDriveTable();

  const FRACTAL_QUOTE_RE = /^_"([^"]+)"_\s*\[Fractal Audio\]\((https?:\/\/[^)]+)\)/;

  const records: DriveRecord[] = [];
  for (const e of entries) {
    const canonical = matchCanonical(DRIVE_TYPES, e.name);
    const rec: DriveRecord = {
      am4Name: canonical ?? e.name,
      wikiName: e.name,
      categories: taxonomy.categories.get(normalizeForMatch(e.name)) ?? [],
      clipTypes: taxonomy.clipTypes.get(normalizeForMatch(e.name)) ?? [],
      fractalQuotes: [],
      flags: canonical ? [] : ['VERIFY: no DRIVE_TYPES enum match'],
    };
    // Build structured basedOn from the wiki paren (preferred source —
    // concise and authoritative). If no paren, try the Blocks Guide row
    // as a fallback.
    if (e.paren) {
      const built = buildBasedOn(e.paren, 'fractal-wiki', { am4Name: canonical ?? e.name });
      if (built) rec.basedOn = built;
    }
    const bg = blocksGuide.get(normalizeForMatch(e.name));
    if (bg) {
      rec.description = bg;
      rec.descriptionSource = 'fractal-blocks-guide';
      if (!rec.basedOn && mentionsRealGear(bg)) {
        const built = buildBasedOn(bg, 'fractal-blocks-guide', { am4Name: canonical ?? e.name });
        if (built) rec.basedOn = built;
      }
    }

    const body = lines.slice(e.start + 1, e.end);
    const bodyText = body.join('\n');
    for (const line of body) {
      const q = line.match(FRACTAL_QUOTE_RE);
      if (q) {
        rec.fractalQuotes.push({
          text: q[1].trim(),
          url: q[2],
          attribution: 'Fractal Audio',
        });
      }
    }
    // HW-033: pull modeled-device knob list from wiki "Controls:" / "the
    // pedal has X knobs" prose. Drive is the highest-yield block — most
    // pedal-style entries document their knob set explicitly.
    const controls = extractControlsFromBody(bodyText);
    if (controls) rec.controls = controls;
    records.push(rec);
  }
  return records;
}

// Parse the Drive TYPE→DESCRIPTION table in the Blocks Guide PDF text.
// Starts at the line matching "^TYPE\s+DESCRIPTION" after the Drive section.
function parseBlocksGuideDriveTable(): Map<string, string> {
  return parseBlocksGuideTypeTable('drive');
}

function parseBlocksGuideDelayTable(): Map<string, string> {
  return parseBlocksGuideTypeTable('delay');
}

function parseBlocksGuideTypeTable(which: 'drive' | 'delay'): Map<string, string> {
  const src = path.join(MANUALS_DIR, 'Fractal-Audio-Blocks-Guide.txt');
  const lines = readLines(src);
  const map = new Map<string, string>();

  // Both tables: two header lines ("TYPE  DESCRIPTION"), then rows where
  // columns are separated by 2+ spaces. Rows ending before the next section.
  const TABLE_START = /^TYPE\s{2,}DESCRIPTION\s*$/;
  const ROW_RE = /^([A-Za-z0-9][A-Za-z0-9 '\/\-+&.]+?)\s{2,}(.+?)\s*$/;

  // Pick the right table occurrence. There are exactly two.
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (TABLE_START.test(lines[i])) starts.push(i);
  if (starts.length < 2) return map;
  const start = which === 'delay' ? starts[0] : starts[1];

  // PDF extraction replaces ® with "�" (U+FFFD) and ™ with "TM".
  const clean = (s: string) => s
    .replace(/[®™\uFFFD]/g, '')
    .replace(/(\w)TM\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Track the last non-"As above" description so we can expand
  // "As above, but stereo in/stereo out" rows — those are Blocks-Guide
  // table shorthand that only makes sense inline; stored on its own it
  // reads as "As above, but stereo in/stereo out" with no referent.
  let lastConcreteDesc: string | undefined;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    // Stop on section break (line starts with non-row content, e.g. "SPILLOVER" or " CONFIG PAGE")
    if (/^\s*(SPILLOVER|CONFIG|BASIC|ADVANCED|EQ)\b/.test(line)) break;
    if (/FRACTAL AUDIO BLOCKS GUIDE/.test(line)) continue; // page footer
    if (/^\s*\d+\s*$/.test(line)) continue;               // page number
    const m = line.match(ROW_RE);
    if (!m) continue;
    const name = clean(m[1]);
    let desc = clean(m[2]);
    if (!/[a-z]/.test(desc)) continue;

    // "As above, but stereo in/stereo out." → expand using the preceding
    // concrete description. Yields e.g. "Stereo version of Digital Mono:
    // Full-range, pristine modern digital delay."
    const aboveMatch = desc.match(/^as above,?\s*(?:but\s+)?(.+)$/i);
    if (aboveMatch && lastConcreteDesc) {
      desc = `Stereo variant — ${lastConcreteDesc.replace(/\.$/, '')}, ${aboveMatch[1]}`;
    } else {
      lastConcreteDesc = desc;
    }

    map.set(normalizeForMatch(name), desc);
  }
  return map;
}

// ─── Reverb parser ───────────────────────────────────────────────────────────

// Lowercase, split on non-alphanumeric, drop short tokens. Used to test
// whether a candidate quote adds content beyond an existing description.
const QUOTE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'based', 'that', 'this', 'type', 'types',
  'from', 'into', 'than', 'have', 'has', 'will', 'can', 'are', 'was',
  'were', 'been', 'its', 'their', 'our', 'your', 'pedal', 'pedals',
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
}

// "North and South Church" → ["North Church", "South Church"]. A trailing
// noun (Church / Plate / Hall) is shared between both halves of the "A and B"
// pattern.
function expandCompoundKey(key: string): string[] {
  const m = key.match(/^(.+?)\s+and\s+(.+?)\s+(\S+)$/i);
  if (!m) return [key];
  return [`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`];
}

function extractReverbs(): ReverbRecord[] {
  const src = path.join(WIKI_DIR, 'Reverb_block.md');
  const lines = readLines(src);

  // Family-level descriptions:
  //   "**Spring  : A spring reverb in a guitar amp or standalone reverb tank**"
  const FAMILY_RE = /^\*\*([A-Z][A-Za-z ]+?)\s*:\s*(.+?)\*\*\s*$/;
  const familyDescriptions = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(FAMILY_RE);
    if (!m) continue;
    const name = m[1].trim();
    const desc = m[2].trim();
    // Single-word family names (Spring/Room/Chamber/Hall/Plate/Studio/Tunnel)
    if (/^[A-Z][a-z]+$/.test(name)) {
      familyDescriptions.set(name.toLowerCase(), desc);
    } else {
      // Multi-word specific callouts: e.g. "London Plate", "North and South Church"
      // Keep separately — we'll attach to matching REVERB_TYPES entries if present.
      familyDescriptions.set(name.toLowerCase(), desc);
    }
  }

  // Block-level Fractal quotes — all of them, since reverb has no per-type quotes
  const blockQuotes: FractalQuote[] = [];
  let inQuoteBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/FRACTAL AUDIO QUOTES/.test(line)) {
      inQuoteBlock = true;
      continue;
    }
    if (!inQuoteBlock) continue;
    // A quote starts after a `[link](URL)` line and is prose until blank line.
    const urlMatch = line.match(/^\[link\]\((https?:\/\/[^)]+)\)\s*$/);
    if (urlMatch) {
      // Collect following non-blank prose lines as the quote body.
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') {
          if (body.length > 0) break;
          continue;
        }
        if (/^\[link\]/.test(lines[j])) break;
        if (/FRACTAL AUDIO QUOTES/.test(lines[j])) { inQuoteBlock = false; break; }
        body.push(lines[j].trim());
        if (body.length >= 10) break; // safety
      }
      if (body.length > 0) {
        blockQuotes.push({
          text: body.join(' ').trim(),
          url: urlMatch[1],
          attribution: 'Fractal Audio',
        });
      }
    }
  }

  const records: ReverbRecord[] = [];
  for (const canonical of REVERB_TYPES) {
    // Match the family by prefix: "Spring, Small" → Spring
    const familyKey = canonical.split(/[ ,]/)[0].toLowerCase();
    const familyDesc = familyDescriptions.get(familyKey);
    const rec: ReverbRecord = {
      am4Name: canonical,
      familyType: familyDesc ? familyKey[0].toUpperCase() + familyKey.slice(1) : undefined,
      description: familyDesc,
      fractalQuotes: [],
      flags: familyDesc ? [] : ['VERIFY: no family description found'],
    };
    // basedOn is ONLY populated when the wiki description explicitly
    // references real hardware ("Based on the EMT 140...", "Inspired by the
    // Bricasti..."). Generic algorithmic descriptions like "a spring reverb
    // in a guitar amp" are not lineage — they go in `description`, not here.
    if (familyDesc && mentionsRealGear(familyDesc)) {
      const built = buildBasedOn(familyDesc, 'fractal-wiki', { am4Name: canonical });
      if (built) rec.basedOn = built;
    }
    // Token-set match: the wiki key "London Plate" should match canonical
    // "Plate, London" regardless of word order. Skip tokens that are the
    // generic family name (e.g. "plate") so "South Church" only matches
    // canonicals containing "south" + "church", not every Plate type.
    // Compound keys like "North and South Church" are split on " and " so
    // each half ("North Church", "South Church") matches its canonical.
    const canonicalTokens = new Set(normalizeForMatch(canonical).split(' '));
    const GENERIC = new Set(['plate', 'hall', 'room', 'spring', 'studio', 'chamber', 'tunnel', 'and', 'the']);
    for (const [key, val] of familyDescriptions) {
      if (!mentionsRealGear(val)) continue;
      const compoundParts = key.includes(' and ')
        ? expandCompoundKey(key)
        : [key];
      for (const part of compoundParts) {
        const distinctive = normalizeForMatch(part)
          .split(' ')
          .filter(t => t.length >= 3 && !GENERIC.has(t));
        if (distinctive.length === 0) continue;
        if (distinctive.every(t => canonicalTokens.has(t))) {
          // Pass through buildBasedOn so markdown links get stripped and
          // manufacturer/productName structured fields are populated
          // (e.g. "Inspired by the [Bricasti](url)" → Bricasti M7).
          const built = buildBasedOn(val, 'fractal-wiki', { am4Name: canonical });
          if (built) rec.basedOn = built;
        }
      }
    }
    // HW-033: reverb wiki almost never lists modeled-device knobs (algorithmic
    // descriptions dominate), but try the family description anyway in case a
    // hardware-emulation entry like "EMT 140" or "Bricasti M7" mentions them.
    if (familyDesc) {
      const controls = extractControlsFromBody(familyDesc);
      if (controls) rec.controls = controls;
    }
    records.push(rec);
  }

  // Emit block-level quotes on a synthetic __block__ record (last entry) so
  // they don't repeat across 79 entries.
  records.push({
    am4Name: '__block_level__',
    description: 'Block-level Fractal Audio quotes for the Reverb block',
    fractalQuotes: blockQuotes,
    flags: [],
  });

  return records;
}

// ─── Delay parser ────────────────────────────────────────────────────────────

function extractDelays(): DelayRecord[] {
  const src = path.join(WIKI_DIR, 'Delay_block.md');
  const lines = readLines(src);
  const blocksGuide = parseBlocksGuideDelayTable();

  // Per-type quote blocks: "   1. Type Name" (indented) followed by
  // "**FRACTAL AUDIO QUOTES**" and quotes.
  const TYPE_HEADER_RE = /^   1\.\s+(.+?)\s*$/;
  const FRACTAL_QUOTE_RE = /^\[link\]\((https?:\/\/[^)]+)\)\s*$/;

  // Map canonical → per-type Fractal quotes
  const quotesByType = new Map<string, FractalQuote[]>();
  let currentType: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(TYPE_HEADER_RE);
    if (h && !/Delay types|Per category|Per clip type/.test(h[1])) {
      const canonical = matchCanonical(DELAY_TYPES, h[1]);
      currentType = canonical ?? h[1];
      if (!quotesByType.has(currentType)) quotesByType.set(currentType, []);
      continue;
    }
    if (!currentType) continue;
    const urlMatch = line.match(FRACTAL_QUOTE_RE);
    if (urlMatch) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') {
          if (body.length > 0) break;
          continue;
        }
        if (/^\[link\]/.test(lines[j])) break;
        if (/^   1\./.test(lines[j])) break;
        if (/FRACTAL AUDIO QUOTES/.test(lines[j])) break;
        body.push(lines[j].trim());
        if (body.length >= 15) break;
      }
      if (body.length > 0) {
        quotesByType.get(currentType)!.push({
          text: body.join(' ').trim(),
          url: urlMatch[1],
          attribution: 'Fractal Audio',
        });
      }
    }
  }

  const records: DelayRecord[] = [];
  for (const canonical of DELAY_TYPES) {
    const key = normalizeForMatch(canonical);
    const desc = blocksGuide.get(key) ?? blocksGuide.get(`${key} delay`);
    const quotes = quotesByType.get(canonical) ?? [];
    const rec: DelayRecord = {
      am4Name: canonical,
      description: desc,
      descriptionSource: desc ? 'fractal-blocks-guide' : undefined,
      fractalQuotes: quotes,
      flags: desc ? [] : ['VERIFY: no Blocks Guide description'],
    };
    // BK-021: always populate `basedOn` when any real-gear lineage is
    // available, so its absence unambiguously means "Fractal-original, no
    // real-gear model" (e.g. Zephyr). Three signal sources in priority
    // order:
    //   (a) Blocks Guide description with "based on X" phrase.
    //   (b) Forum quote mentioning real gear (for entries where the BG
    //       description is too vague to extract from, like "2290 w/
    //       Modulation" → "legendary original from Denmark").
    //   (c) am4Name allusion heuristic — if the canonical name contains a
    //       famous model number ("2290", "1176"), infer manufacturer from
    //       the MODEL_TO_BRAND table. Tagged `heuristic-inferred`.
    if (desc && mentionsRealGear(desc)) {
      const built = buildBasedOn(desc, 'fractal-blocks-guide', { am4Name: canonical });
      if (built) rec.basedOn = built;
    }
    if (!rec.basedOn) {
      for (const q of quotes) {
        if (!mentionsRealGear(q.text)) continue;
        const built = buildBasedOn(q.text, 'fractal-forum-quote', { am4Name: canonical });
        if (built) {
          rec.basedOn = built;
          break;
        }
      }
    }
    if (!rec.basedOn) {
      const inferred = inferBasedOnFromAm4Name(canonical);
      if (inferred) rec.basedOn = inferred;
    }
    // HW-033: delay wiki rarely lists per-type knobs (the block is mostly
    // algorithmic), but Blocks Guide rows + forum quotes occasionally do.
    // Try extraction over both sources concatenated.
    const haystack = [desc ?? '', ...quotes.map(q => q.text)].join('\n');
    const controls = extractControlsFromBody(haystack);
    if (controls) rec.controls = controls;
    records.push(rec);
  }
  return records;
}

// ─── Compressor parser ──────────────────────────────────────────────────────

function extractCompressors(): CompressorRecord[] {
  const src = path.join(WIKI_DIR, 'Compressor_block.md');
  const lines = readLines(src);

  // Scope scan to the "Compressor types" section only. Parameter sections
  // below (Attack/Release, Threshold, etc.) also use **Name** headers but
  // are NOT compressor types.
  const typesStart = lines.findIndex(l => /^1\.\s+Compressor types\s*$/.test(l));
  const typesEnd = lines.findIndex(
    (l, i) => i > typesStart && /^1\.\s+Position on the grid\s*$/.test(l),
  );
  if (typesStart < 0 || typesEnd < 0) {
    console.warn('  compressor: could not locate types section bounds');
    return [];
  }

  interface Entry {
    name: string;
    description?: string;
    quotes: FractalQuote[];
  }

  // Wiki uses:
  //   **Name**
  //   > description line (possibly multi-line as several `> ...` lines)
  //   ...
  //   - FRACTAL AUDIO QUOTES**
  //   [link](url)
  //   Quote prose
  //
  // Multi-variant headers: "**Dynami-Comp Classic | Modern | Soft**" share
  // one description across 3 canonical enum entries.
  const HEADER_RE = /^\*\*([A-Z][^*]+?)\*\*\s*$/;
  const DESC_RE = /^>\s+(.+)$/;
  const QUOTE_URL_RE = /^\[link\]\((https?:\/\/[^)]+)\)\s*$/;

  // First pass: locate entry headers + line ranges.
  interface EntrySpan { name: string; start: number; end: number; }
  const spans: EntrySpan[] = [];
  for (let i = typesStart; i < typesEnd; i++) {
    const h = lines[i].match(HEADER_RE);
    if (h) {
      if (spans.length > 0) spans[spans.length - 1].end = i;
      spans.push({ name: h[1].trim(), start: i, end: typesEnd });
    }
  }

  const entries: Entry[] = [];
  for (const span of spans) {
    const e: Entry = { name: span.name, quotes: [] };
    // Collect description (> lines immediately after header, possibly
    // multiple) and URL-sourced quote blocks (the normal [link](url) + prose
    // pattern).
    let inQuoteBlock = false;
    for (let i = span.start + 1; i < span.end; i++) {
      const line = lines[i];
      const d = line.match(DESC_RE);
      if (d) {
        e.description = (e.description ? e.description + ' ' : '') + d[1].trim();
        continue;
      }
      if (/FRACTAL AUDIO QUOTES/.test(line)) { inQuoteBlock = true; continue; }
      if (!inQuoteBlock) continue;
      const u = line.match(QUOTE_URL_RE);
      if (!u) continue;
      const body: string[] = [];
      for (let j = i + 1; j < span.end; j++) {
        if (lines[j].trim() === '') {
          if (body.length > 0) break;
          continue;
        }
        if (/^\[link\]/.test(lines[j])) break;
        if (/FRACTAL AUDIO QUOTES/.test(lines[j])) break;
        if (/^\*\*/.test(lines[j])) break;
        body.push(lines[j].trim());
        if (body.length >= 10) break;
      }
      if (body.length > 0) {
        e.quotes.push({
          text: body.join(' ').trim(),
          url: u[1],
          attribution: 'Fractal Audio',
        });
      }
    }

    // Second pass: real-gear sweep across the full entry scope. Some
    // lineage statements (e.g. "Based on a VCA feedback design (e.g., SSL
    // Bus Compressor)") live inside a FRACTAL AUDIO QUOTES block as plain
    // prose with no [link](url) — the URL-driven pass above misses them.
    // Skip description lines (which start with "> ") and anything already
    // captured as a quote so we don't duplicate existing content.
    for (let i = span.start + 1; i < span.end; i++) {
      const raw = lines[i];
      if (/^\s*>/.test(raw)) continue;
      const line = raw.trim();
      if (!mentionsRealGear(line)) continue;
      // Strip leading bullet markers and trailing [link] annotations for
      // readability.
      const cleaned = line
        .replace(/^[-*]\s*/, '')
        .replace(/\s*\[link\]\([^)]*\)\s*$/, '')
        .trim();
      if (!cleaned) continue;
      // Deduplicate against existing quotes and description content.
      if (e.description && e.description.includes(cleaned)) continue;
      if (e.quotes.some(q => q.text === cleaned || q.text.includes(cleaned))) continue;
      e.quotes.push({ text: cleaned, attribution: 'Fractal Audio' });
    }
    entries.push(e);
  }

  // Expand multi-variant headers. "Dynami-Comp Classic | Modern | Soft" →
  // three entries, all sharing the same description and quote list.
  const expanded: Entry[] = [];
  for (const e of entries) {
    if (!e.name.includes(' | ')) { expanded.push(e); continue; }
    const parts = e.name.split(' | ').map(s => s.trim());
    // First part carries the full "Prefix Variant1" form. Strip the last
    // token (the variant) to get the shared prefix.
    const prefixTokens = parts[0].split(/\s+/);
    const variant0 = prefixTokens.pop()!;
    const prefix = prefixTokens.join(' ');
    for (const p of [variant0, ...parts.slice(1)]) {
      expanded.push({
        name: `${prefix} ${p}`.trim(),
        description: e.description,
        quotes: e.quotes,
      });
    }
  }

  const records: CompressorRecord[] = [];
  for (const canonical of COMPRESSOR_TYPES) {
    const canonicalTokens = new Set(normalizeForMatch(canonical).split(' '));

    // First try a bidirectional token-set match — handles word-order
    // differences like "VCA Classic Compressor" vs "Classic VCA Compressor".
    let match: Entry | undefined;
    for (const e of expanded) {
      const entryTokens = new Set(normalizeForMatch(e.name).split(' '));
      const allCanonIn = [...canonicalTokens].every(t => entryTokens.has(t));
      const allEntryIn = [...entryTokens].every(t => canonicalTokens.has(t));
      if (allCanonIn && allEntryIn) { match = e; break; }
    }
    // Fall back to one-way match (canonical tokens ⊆ entry tokens).
    if (!match) {
      for (const e of expanded) {
        const entryTokens = new Set(normalizeForMatch(e.name).split(' '));
        if ([...canonicalTokens].every(t => entryTokens.has(t))) { match = e; break; }
      }
    }

    // Strip wiki markdown noise from descriptions:
    //   - Trailing `[link](url)` (wiki citation markers)
    //   - Inline `[text](url)` named links (keep "text", drop url)
    //   - Trailing paren-wrapped URLs
    let cleanDesc = match?.description
      ?.replace(/\s*\[link\]\([^)]*\)\s*/g, ' ')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    // Rename-note handling: if description is only a rename note like
    // "Previously titled Tube Compressor." or "Previously: Studio FF
    // Compressor.", move it to flags so the agent doesn't read it as
    // the effect's description. The real lineage lives in basedOn
    // (populated below) or in fractalQuotes.
    const renameFlags: string[] = [];
    if (cleanDesc && /^previously[\s:,]/i.test(cleanDesc)) {
      renameFlags.push(`RENAME_NOTE: ${cleanDesc}`);
      cleanDesc = undefined;
    }

    const baseFlags: string[] = match ? [] : ['VERIFY: no wiki entry found'];
    const rec: CompressorRecord = {
      am4Name: canonical,
      wikiName: match?.name,
      description: cleanDesc,
      descriptionSource: cleanDesc ? 'fractal-wiki' : undefined,
      fractalQuotes: [...(match?.quotes ?? [])],
      flags: [...baseFlags, ...renameFlags],
    };
    // BK-021: always populate `basedOn` when description carries real-gear
    // lineage (e.g. "Based on MXR's M-102 Dyna Comp pedal."). Before the
    // migration this was skipped to avoid duplication; now we emit a
    // structured short form (primary + manufacturer + model + productName)
    // which is distinct from the description prose by design.
    if (cleanDesc && mentionsRealGear(cleanDesc)) {
      const built = buildBasedOn(cleanDesc, 'fractal-wiki', { am4Name: canonical });
      if (built) rec.basedOn = built;
    }
    // Forum-quote fallback: if the description-based extraction above
    // produced no basedOn (common when the wiki entry has no `>
    // description` line — Vari-Mu Tube, VCA Bus Compressor, etc.),
    // scan the entry's forum quotes for a gear reference and build
    // structured basedOn from that. The quote is MOVED out of
    // fractalQuotes so the same text doesn't live in two fields.
    if (match && !rec.basedOn) {
      for (let i = 0; i < rec.fractalQuotes.length; i++) {
        const q = rec.fractalQuotes[i];
        if (!mentionsRealGear(q.text)) continue;
        const built = buildBasedOn(q.text, 'fractal-forum-quote', { am4Name: canonical });
        if (!built) continue;
        rec.basedOn = built;
        rec.fractalQuotes.splice(i, 1);
        break;
      }
    }

    // Final flag pass: if after all extraction we still have nothing —
    // no description, no basedOn, no quotes — mark it so callers
    // know this entry is underspecified (e.g. VCA FF/FB Sustainer have
    // bare wiki headers with no content beneath).
    if (!rec.description && !rec.basedOn && rec.fractalQuotes.length === 0) {
      rec.flags.push('VERIFY: wiki entry has no description, lineage, or quotes');
    }

    // HW-033: compressor wiki occasionally documents modeled-pedal knobs
    // (Solo Dallas Schaffer, Keeley, Xotic SP have explicit knob lines).
    // Run extraction over description + concatenated quote bodies.
    const haystack = [
      cleanDesc ?? '',
      ...rec.fractalQuotes.map(q => q.text),
    ].join('\n');
    const controls = extractControlsFromBody(haystack);
    if (controls) rec.controls = controls;

    records.push(rec);
  }
  return records;
}

// ─── Generic "simple block" parser (chorus / flanger / phaser / wah) ────────
//
// These four block wikis use a mix of inline formats for their per-type
// entries:
//   (a) Phaser / Wah: "**Name : description**"   (bold one-liner)
//   (b) Flanger:      "1. Name: description"     (numbered inline)
//                     "1. Name"                   (numbered, no desc)
//   (c) Chorus:       "1. **Name**"               (numbered-bold, no desc)
//
// We parse whichever pattern matches each line and run `buildBasedOn` on
// any inline description. For entries with no inline description,
// basedOn is left empty unless the model name itself hits MODEL_TO_BRAND
// via `inferBasedOnFromAm4Name` (covers cases like "MXF-117" → MXR 117).

interface SimpleBlockConfig {
  blockLabel: string;
  wikiFile: string;
  catalog: readonly string[];
  typesHeader: RegExp;
  typesEnd: RegExp;
}

function extractSimpleBlock(cfg: SimpleBlockConfig): BaseRecord[] {
  const src = path.join(WIKI_DIR, cfg.wikiFile);
  const lines = readLines(src);

  const typesStart = lines.findIndex((l) => cfg.typesHeader.test(l));
  const typesEnd = lines.findIndex(
    (l, i) => i > typesStart && cfg.typesEnd.test(l),
  );
  if (typesStart < 0 || typesEnd < 0) {
    console.warn(`  ${cfg.blockLabel}: could not locate types section bounds`);
    return [];
  }

  // Patterns, most-specific first.
  const BOLD_ONELINER = /^\*\*([A-Z0-9][A-Za-z0-9 '\-\/]+?)\s*:\s*([^*]+?)\*\*\s*$/;
  const BOLD_NAME_ONLY = /^\*\*([A-Z0-9][A-Za-z0-9 '\-\/]+?)\*\*\s*$/;
  const NUMBERED_INLINE = /^1\.\s+([A-Z0-9][A-Za-z0-9 '\-\/\.]+?)\s*:\s*(.+?)\s*$/;
  const NUMBERED_BOLD = /^1\.\s+\*\*([A-Z0-9][A-Za-z0-9 '\-\/]+)\*\*\s*$/;
  const NUMBERED_PLAIN = /^1\.\s+([A-Z0-9][A-Za-z0-9 '\-\/\.]+?)\s*$/;

  interface Parsed { name: string; description?: string; }
  const parsed: Parsed[] = [];
  for (let i = typesStart + 1; i < typesEnd; i++) {
    const line = lines[i];
    let name: string | undefined;
    let desc: string | undefined;
    let m: RegExpMatchArray | null;
    if ((m = line.match(BOLD_ONELINER))) { name = m[1].trim(); desc = m[2].trim(); }
    else if ((m = line.match(NUMBERED_INLINE))) { name = m[1].trim(); desc = m[2].trim(); }
    else if ((m = line.match(NUMBERED_BOLD))) { name = m[1].trim(); }
    else if ((m = line.match(BOLD_NAME_ONLY))) { name = m[1].trim(); }
    else if ((m = line.match(NUMBERED_PLAIN))) { name = m[1].trim(); }
    if (!name) continue;
    // Skip common non-entry headings that could sneak past the regex
    // (e.g. "1. Parameters", "1. About the X block") — these have names
    // that don't look like effect types.
    if (/^(About|Parameters|Tips|Videos|Mono or stereo|Position|Set up|Auto-engage)$/i.test(name)) continue;
    parsed.push({ name, description: desc });
  }

  const records: BaseRecord[] = [];
  for (const canonical of cfg.catalog) {
    const match = parsed.find((p) => normalizeForMatch(p.name) === normalizeForMatch(canonical));
    const rec: BaseRecord = {
      am4Name: canonical,
      wikiName: match?.name,
      description: match?.description,
      descriptionSource: match?.description ? 'fractal-wiki' : undefined,
      fractalQuotes: [],
      flags: match ? [] : ['VERIFY: no wiki entry found'],
    };
    if (match?.description && mentionsRealGear(match.description)) {
      const built = buildBasedOn(match.description, 'fractal-wiki', { am4Name: canonical });
      if (built) rec.basedOn = built;
    }
    // Fall back to am4Name heuristic — catches "MXF-117" → "MXR 117",
    // "Japan CE-2" → Boss CE-2, etc. via MODEL_TO_BRAND.
    if (!rec.basedOn) {
      const inferred = inferBasedOnFromAm4Name(canonical);
      if (inferred) rec.basedOn = inferred;
    }
    if (!rec.basedOn && !rec.description) {
      rec.flags.push('VERIFY: no description or lineage identified');
    }
    // HW-033: phaser / chorus / flanger / wah inline entries occasionally
    // document the modeled device's knobs ("models the original controls:
    // Rate, Manual Shift, Feedback, Auto/Manual"). Run over the inline
    // description for each.
    if (match?.description) {
      const controls = extractControlsFromBody(match.description);
      if (controls) rec.controls = controls;
    }
    records.push(rec);
  }
  return records;
}

// ─── Cab parser ──────────────────────────────────────────────────────────────

function extractCabs(): { creators: Record<string, string>; cabs: CabRecord[] } {
  const src = path.join(WIKI_DIR, 'Cab_models_list.md');
  const lines = readLines(src);

  // Creator prefix legend: "   - AB** — [AustinBuddy](...)" or "   - XX** — plain name"
  const creators: Record<string, string> = { FAS: 'Fractal Audio' };
  const PREFIX_RE = /^\s+-\s+([A-Z]{2,3})\*\*\s*—\s*(?:\[([^\]]+)\]|([^\[\n]+))/;
  for (const line of lines) {
    const m = line.match(PREFIX_RE);
    if (!m) continue;
    creators[m[1]] = (m[2] ?? m[3] ?? '').trim();
  }

  // Cab row:  "N\t—\tCabName Prefix\t—\tCreator"
  const ROW_RE = /^\d+\s+—\s+(.+?)\s+—\s+([A-Za-z][A-Za-z .]+?)\s*$/;
  // Section header describing a group of cabs:
  //   "   - Based on a small Pignose with a single 4" speaker. Source: ...**"
  const SECTION_RE = /^\s+-\s+(Based on .+?)\*\*\s*$/;

  let currentSection: string | undefined;
  const cabs: CabRecord[] = [];

  for (const line of lines) {
    const sec = line.match(SECTION_RE);
    if (sec) {
      currentSection = sec[1].trim();
      continue;
    }
    const row = line.match(ROW_RE);
    if (!row) continue;
    const cabName = row[1].trim();
    const creator = row[2].trim();
    const prefixMatch = cabName.match(/\s([A-Z]{2,3})\s*$/);
    const rec: CabRecord = {
      wikiName: cabName,
      creator,
      creatorPrefix: prefixMatch ? prefixMatch[1] : undefined,
      sourceDescription: currentSection,
    };
    cabs.push(rec);
  }
  return { creators, cabs };
}

// ─── Write / report ──────────────────────────────────────────────────────────

function writeJson(filename: string, data: unknown): void {
  const p = path.join(OUT_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  wrote ${path.relative(ROOT, p)}`);
}

function coverage(label: string, canonical: readonly string[], records: BaseRecord[]): void {
  const matched = records.filter(r => canonical.includes(r.am4Name));
  const withInspired = matched.filter(r => r.basedOn).length;
  const withQuotes = matched.filter(r => r.fractalQuotes.length > 0).length;
  const withDesc = matched.filter(r => r.description).length;
  const withControls = matched.filter(r => r.controls && r.controls.values.length > 0).length;
  const unmatched = records.filter(r => !canonical.includes(r.am4Name) && r.am4Name !== '__block_level__');
  console.log(
    `  ${label.padEnd(8)} ` +
    `catalog=${canonical.length}  matched=${matched.length}  ` +
    `basedOn=${withInspired}  quotes=${withQuotes}  desc=${withDesc}  ` +
    `controls=${withControls}  unmatched=${unmatched.length}`,
  );
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Extracting lineage...\n');

  const amps = extractAmps();
  const drives = extractDrives();
  const reverbs = extractReverbs();
  const delays = extractDelays();
  const compressors = extractCompressors();
  const phasers = extractSimpleBlock({
    blockLabel: 'phaser',
    wikiFile: 'Phaser_block.md',
    catalog: PHASER_TYPES,
    typesHeader: /^1\.\s+Phaser types\s*$/,
    typesEnd: /^1\.\s+Mono or stereo\s*$/,
  });
  const choruses = extractSimpleBlock({
    blockLabel: 'chorus',
    wikiFile: 'Chorus_block.md',
    catalog: CHORUS_TYPES,
    typesHeader: /^1\.\s+Chorus types\s*$/,
    typesEnd: /^1\.\s+Parameters\s*$/,
  });
  const flangers = extractSimpleBlock({
    blockLabel: 'flanger',
    wikiFile: 'Flanger_block.md',
    catalog: FLANGER_TYPES,
    typesHeader: /^1\.\s+Flanger types\s*$/,
    typesEnd: /^1\.\s+(Parameters|Tips|Mono or stereo)\s*$/,
  });
  const wahs = extractSimpleBlock({
    blockLabel: 'wah',
    wikiFile: 'Wah_block.md',
    catalog: WAH_TYPES,
    typesHeader: /^1\.\s+Wah types\s*$/,
    typesEnd: /^1\.\s+Position on the grid\s*$/,
  });
  const { creators, cabs } = extractCabs();

  writeJson('amp-lineage.json', {
    _source: 'Fractal Audio wiki — Amp_models_list.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: AMP_TYPES.length,
    _recordCount: amps.length,
    records: amps,
  });
  writeJson('drive-lineage.json', {
    _source: 'Fractal Audio wiki — Drive_block.md + Blocks Guide PDF',
    _extractedAt: new Date().toISOString(),
    _catalogSize: DRIVE_TYPES.length,
    _recordCount: drives.length,
    records: drives,
  });
  writeJson('reverb-lineage.json', {
    _source: 'Fractal Audio wiki — Reverb_block.md (family-level)',
    _extractedAt: new Date().toISOString(),
    _catalogSize: REVERB_TYPES.length,
    _recordCount: reverbs.length,
    records: reverbs,
  });
  writeJson('delay-lineage.json', {
    _source: 'Fractal Audio wiki — Delay_block.md + Blocks Guide PDF',
    _extractedAt: new Date().toISOString(),
    _catalogSize: DELAY_TYPES.length,
    _recordCount: delays.length,
    records: delays,
  });
  writeJson('compressor-lineage.json', {
    _source: 'Fractal Audio wiki — Compressor_block.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: COMPRESSOR_TYPES.length,
    _recordCount: compressors.length,
    records: compressors,
  });
  writeJson('phaser-lineage.json', {
    _source: 'Fractal Audio wiki — Phaser_block.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: PHASER_TYPES.length,
    _recordCount: phasers.length,
    records: phasers,
  });
  writeJson('chorus-lineage.json', {
    _source: 'Fractal Audio wiki — Chorus_block.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: CHORUS_TYPES.length,
    _recordCount: choruses.length,
    records: choruses,
  });
  writeJson('flanger-lineage.json', {
    _source: 'Fractal Audio wiki — Flanger_block.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: FLANGER_TYPES.length,
    _recordCount: flangers.length,
    records: flangers,
  });
  writeJson('wah-lineage.json', {
    _source: 'Fractal Audio wiki — Wah_block.md',
    _extractedAt: new Date().toISOString(),
    _catalogSize: WAH_TYPES.length,
    _recordCount: wahs.length,
    records: wahs,
  });
  writeJson('cab-lineage.json', {
    _source: 'Fractal Audio wiki — Cab_models_list.md',
    _extractedAt: new Date().toISOString(),
    _recordCount: cabs.length,
    creators,
    records: cabs,
  });

  console.log('\nCoverage:');
  coverage('amp', AMP_TYPES, amps);
  coverage('drive', DRIVE_TYPES, drives);
  coverage('reverb', REVERB_TYPES, reverbs.filter(r => r.am4Name !== '__block_level__'));
  coverage('delay', DELAY_TYPES, delays);
  coverage('comp', COMPRESSOR_TYPES, compressors);
  coverage('phaser', PHASER_TYPES, phasers);
  coverage('chorus', CHORUS_TYPES, choruses);
  coverage('flanger', FLANGER_TYPES, flangers);
  coverage('wah', WAH_TYPES, wahs);
  console.log(`  cab      creators=${Object.keys(creators).length}  records=${cabs.length}`);
  console.log('\nDone.');
}

main();
