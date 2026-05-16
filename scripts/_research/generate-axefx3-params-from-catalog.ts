/**
 * Emit `packages/axe-fx-iii/src/params.ts` — paramId/name catalog
 * skeleton seeded from the Ghidra-mined Axe-Edit III dispatcher table.
 *
 * Background. Session 82 mined `FUN_140397a40`, the effect-type
 * dispatcher in Axe-Edit III v1.14.31. Each `case 0xN` of that switch
 * loads a 16-byte-strided `ParamDescriptor` table; we extracted
 * `(paramId, namePointer)` pairs from every table and wrote the result
 * to `samples/captured/decoded/ghidra-axeedit3-paramnames.json` —
 * 49 effect families, ~2.2k paramIds total. (The JSON is gitignored
 * under `samples/`; read it via the absolute path baked in below.)
 *
 * What we KNOW about each entry:
 *   - the effect family (REVERB, DELAY, COMP, …)
 *   - the wire-level paramId within the family (14-bit slot in 0x02
 *     SET_PARAMETER frames; sentinels at 65520+ are firmware-internal
 *     markers like *_SET_ALL / *_VAL_ALL and are NOT addressable over
 *     the wire — they fail the encode14 range guard, but we keep them
 *     in the catalog because future Ghidra mining may give them a
 *     different role)
 *   - the symbol name Axe-Edit III uses internally (e.g. `REVERB_TYPE`,
 *     `COMP_THRESH`)
 *
 * What we do NOT know (deliberately deferred — needs III hardware):
 *   - display unit (dB, ms, knob 0..10, enum, …)
 *   - display range (min, max)
 *   - per-param scaling (linear vs log10)
 *   - enum value tables (the symbol name `COMP_TYPE` doesn't expose the
 *     enum vocabulary — that needs a separate Ghidra pass + capture)
 *
 * Until hardware verification lands, every entry stamps `unit:
 * 'unverified'`. An audit grep for `'unverified'` finds everything that
 * still needs III-side calibration. The 0x02 SET_PARAMETER tool surface
 * does NOT consume this metadata today (it accepts raw 16-bit wire
 * values from the caller), so a documentary-only catalog is safe to
 * ship — it gives `axefx3_list_params` and per-paramId name lookup a
 * source of truth without pretending we know more than we do.
 *
 * Pipeline (idempotent — re-running emits a byte-stable file):
 *   1. Read JSON from `samples/captured/decoded/ghidra-axeedit3-paramnames.json`.
 *   2. Iterate `effect_types.case_0xN` in numeric caseIdx order.
 *      - Skip cases without an `effectFamily` field (case 0x3a in the
 *        current catalog has `paramCount: 0` and no family — they're
 *        empty dispatcher slots).
 *   3. For each family, sort params by paramId ascending.
 *   4. Emit a TypeScript file with: Unit type, Param interface,
 *      `PARAMS` flat array, `PARAMS_BY_FAMILY` map, and
 *      `PARAM_BY_KEY` map keyed by `'FAMILY.NAME'`.
 *
 * Run with:
 *   npx tsx scripts/_research/generate-axefx3-params-from-catalog.ts
 *
 * Output is committed alongside this script — both files travel
 * together so future agents can reproduce.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const CATALOG_PATH = join(
  REPO_ROOT,
  'samples',
  'captured',
  'decoded',
  'ghidra-axeedit3-paramnames.json',
);

const OUTPUT_PATH = join(
  REPO_ROOT,
  'packages',
  'axe-fx-iii',
  'src',
  'params.ts',
);

// ── Catalog JSON shape ─────────────────────────────────────────────

interface CatalogParam {
  paramId: number;
  name: string;
}

interface CatalogCase {
  caseIdx: number;
  tableAddr: string;
  /** Absent on empty / unassigned dispatcher slots. */
  effectFamily?: string;
  paramCount: number;
  params: CatalogParam[];
}

interface Catalog {
  _source: string;
  _stride_bytes: number;
  _struct: string;
  effect_types: Record<string, CatalogCase>;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * TypeScript identifiers can't start with a digit and can't contain
 * special characters. The catalog's `name` field is the Axe-Edit III
 * internal symbol (e.g. `REVERB_TYPE`, `COMP_THRESH`) — those are
 * already valid TS identifiers, but we belt-and-suspenders the check
 * here in case a future catalog dump includes a stray character.
 */
function isValidIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/**
 * Quote a string for emission as a TypeScript object key. Bare keys
 * for valid identifiers, single-quoted strings for everything else.
 */
function emitKey(s: string): string {
  return isValidIdentifier(s) ? s : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Escape a string for emission as a single-quoted TS string literal. */
function emitString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const raw = readFileSync(CATALOG_PATH, 'utf8');
  const catalog: Catalog = JSON.parse(raw);

  // Collect (family → sorted params) — sorted by paramId ascending so
  // the emitted file is byte-stable across runs.
  const cases = Object.values(catalog.effect_types)
    .filter((c): c is CatalogCase & { effectFamily: string } =>
      typeof c.effectFamily === 'string' && c.params.length > 0,
    )
    .sort((a, b) => a.caseIdx - b.caseIdx);

  type FlatEntry = {
    family: string;
    paramId: number;
    name: string;
    caseIdx: number;
  };

  const flat: FlatEntry[] = [];
  for (const c of cases) {
    const sorted = [...c.params].sort((a, b) => a.paramId - b.paramId);
    for (const p of sorted) {
      flat.push({
        family: c.effectFamily,
        paramId: p.paramId,
        name: p.name,
        caseIdx: c.caseIdx,
      });
    }
  }

  // Sanity: count per family.
  const familyCounts: Record<string, number> = {};
  for (const e of flat) {
    familyCounts[e.family] = (familyCounts[e.family] ?? 0) + 1;
  }

  // Duplicate-key detection on (family, name) — the natural composite
  // key for our keyed lookup. This SHOULD be unique because the symbol
  // names mined from Axe-Edit III are themselves unique within a
  // family. If this ever fails, the catalog has an extraction bug.
  const seenFamName = new Set<string>();
  const dupFamName: string[] = [];
  for (const e of flat) {
    const k = `${e.family}.${e.name}`;
    if (seenFamName.has(k)) dupFamName.push(k);
    seenFamName.add(k);
  }
  if (dupFamName.length > 0) {
    throw new Error(
      `generator: catalog has ${dupFamName.length} duplicate (family, name) ` +
      `entries — refusing to emit. First few: ${dupFamName.slice(0, 5).join(', ')}`,
    );
  }

  // (family, paramId) is NOT a uniqueness constraint in this catalog.
  // Some families (notably FLANGER) keep firmware-legacy overlays —
  // new symbols at paramId 0..N (e.g. `FLANGER_TYPE` at 0) alongside
  // old symbols at the same IDs (`FLANGER_OLD_TYPE` at 0) so stored
  // presets from older firmware still decode. We surface a count so
  // it's visible in generator output, but the overlay is intentional
  // and shipped as-is in the emitted catalog.
  const paramIdSeen = new Set<string>();
  let overlayCount = 0;
  for (const e of flat) {
    const k = `${e.family}.${e.paramId}`;
    if (paramIdSeen.has(k)) overlayCount += 1;
    paramIdSeen.add(k);
  }

  const totalCount = flat.length;
  const familyCount = cases.length;

  // ── Emit TypeScript ──────────────────────────────────────────────

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * Axe-Fx III parameter catalog — SKELETON.");
  lines.push(" *");
  lines.push(" * Auto-generated by");
  lines.push(" *   scripts/_research/generate-axefx3-params-from-catalog.ts");
  lines.push(" * from");
  lines.push(" *   samples/captured/decoded/ghidra-axeedit3-paramnames.json");
  lines.push(" * (Ghidra-mined Axe-Edit III v1.14.31 effect-type dispatcher");
  lines.push(" * FUN_140397a40 — Session 82). DO NOT HAND-EDIT — re-run the");
  lines.push(" * generator to refresh.");
  lines.push(" *");
  lines.push(" * Coverage:");
  lines.push(` *   - ${totalCount} parameters across ${familyCount} effect families.`);
  lines.push(" *   - Every entry stamps `unit: 'unverified'`. The 0x02");
  lines.push(" *     SET_PARAMETER tool surface accepts raw 16-bit wire values");
  lines.push(" *     from the caller — display ↔ wire calibration is NOT yet");
  lines.push(" *     known for the III and lives outside this catalog. An audit");
  lines.push(" *     grep for `'unverified'` finds everything still needing");
  lines.push(" *     III hardware verification.");
  lines.push(" *");
  lines.push(" * Wire constraints (see ./setParam.ts):");
  lines.push(" *   - paramId is sent as a 14-bit septet pair → wire range is");
  lines.push(" *     0..16383. Catalog entries with paramId >= 65520 are");
  lines.push(" *     firmware-internal sentinels (e.g. *_SET_ALL, *_VAL_ALL)");
  lines.push(" *     and are NOT addressable via 0x02 SET_PARAMETER — they");
  lines.push(" *     will fail the encode14 range guard. They are retained in");
  lines.push(" *     this catalog as documentary entries because they show up");
  lines.push(" *     in the dispatcher tables; tooling that resolves a name to");
  lines.push(" *     a paramId should filter > 16383 before attempting a wire");
  lines.push(" *     write.");
  lines.push(" *");
  lines.push(" * Firmware-legacy overlays:");
  lines.push(" *   - (family, paramId) is NOT unique. Some families (notably");
  lines.push(" *     FLANGER) keep older symbol names alongside the current");
  lines.push(" *     ones at the same paramIds (e.g. `FLANGER_TYPE` and");
  lines.push(" *     `FLANGER_OLD_TYPE` both at paramId 0). The duplicates are");
  lines.push(" *     intentional — older firmware presets store under the");
  lines.push(" *     `_OLD_` symbols, while new writes use the current names.");
  lines.push(" *     The composite key `(family, name)` IS unique; use");
  lines.push(" *     `PARAM_BY_KEY` for stable lookup.");
  lines.push(" *");
  lines.push(" * 🟡 Untested on Axe-Fx III hardware as of Session 87. The 0x02");
  lines.push(" * SET_PARAMETER wire shape itself was ported from the Axe-Fx II");
  lines.push(" * encoder; whether III firmware honors it (and on which");
  lines.push(" * paramIds) is the next III contributor's verification task.");
  lines.push(" */");
  lines.push("");
  lines.push("// ── Types ──────────────────────────────────────────────────────────");
  lines.push("");
  lines.push("/**");
  lines.push(" * Display-unit tag for an Axe-Fx III parameter.");
  lines.push(" *");
  lines.push(" * Currently the only value is `'unverified'` — a sentinel that the");
  lines.push(" * per-paramId display calibration is not yet known. When III");
  lines.push(" * hardware verification surfaces real units (dB, ms, knob_0_10,");
  lines.push(" * enum, …) this union expands and per-entry unit fields flip from");
  lines.push(" * `'unverified'` to the real tag.");
  lines.push(" */");
  lines.push("export type Unit = 'unverified';");
  lines.push("");
  lines.push("/** One entry in the Axe-Fx III parameter catalog. */");
  lines.push("export interface Param {");
  lines.push("  /**");
  lines.push("   * Effect family symbol (e.g. `'REVERB'`, `'DELAY'`, `'COMP'`).");
  lines.push("   * Sourced from the dispatcher's case → table-of-params mapping.");
  lines.push("   */");
  lines.push("  family: string;");
  lines.push("  /**");
  lines.push("   * Parameter ID within the family. Wire-encoded as a 14-bit");
  lines.push("   * septet pair in 0x02 SET_PARAMETER frames. Values >= 65520 are");
  lines.push("   * firmware-internal sentinels and NOT wire-addressable — see");
  lines.push("   * file-level header for details.");
  lines.push("   */");
  lines.push("  paramId: number;");
  lines.push("  /**");
  lines.push("   * Symbol name from Axe-Edit III's binary (e.g. `'REVERB_TYPE'`).");
  lines.push("   * Stable across firmware releases of the same generation.");
  lines.push("   */");
  lines.push("  name: string;");
  lines.push("  /**");
  lines.push("   * Display unit tag. `'unverified'` until III hardware confirms");
  lines.push("   * the real shape — see file-level header.");
  lines.push("   */");
  lines.push("  unit: Unit;");
  lines.push("}");
  lines.push("");
  lines.push("// ── Catalog data ───────────────────────────────────────────────────");
  lines.push("");
  lines.push("/**");
  lines.push(" * Flat catalog of every (family, paramId) entry mined from the");
  lines.push(" * Axe-Edit III dispatcher. Sorted by family-case-index ascending,");
  lines.push(" * then paramId ascending within each family, for byte-stable");
  lines.push(" * regeneration.");
  lines.push(" */");
  lines.push("export const PARAMS: readonly Param[] = [");
  for (const e of flat) {
    lines.push(
      `  { family: ${emitString(e.family)}, paramId: ${e.paramId}, name: ${emitString(e.name)}, unit: 'unverified' },`,
    );
  }
  lines.push("];");
  lines.push("");
  lines.push("/**");
  lines.push(" * Lookup by family symbol. Each family's entry preserves the");
  lines.push(" * paramId-ascending order from `PARAMS`.");
  lines.push(" */");
  lines.push("export const PARAMS_BY_FAMILY: Readonly<Record<string, readonly Param[]>> = {");
  // Group while preserving caseIdx ordering.
  const byFamily = new Map<string, FlatEntry[]>();
  for (const e of flat) {
    let arr = byFamily.get(e.family);
    if (!arr) {
      arr = [];
      byFamily.set(e.family, arr);
    }
    arr.push(e);
  }
  for (const [family, entries] of byFamily) {
    lines.push(`  ${emitKey(family)}: [`);
    for (const e of entries) {
      lines.push(
        `    { family: ${emitString(e.family)}, paramId: ${e.paramId}, name: ${emitString(e.name)}, unit: 'unverified' },`,
      );
    }
    lines.push(`  ],`);
  }
  lines.push("};");
  lines.push("");
  lines.push("/**");
  lines.push(" * Lookup by `'FAMILY.NAME'` (the catalog's natural composite key).");
  lines.push(" * Example: `PARAM_BY_KEY['REVERB.REVERB_TYPE']` → the Reverb Type");
  lines.push(" * entry. Use this when callers reference a param by its symbolic");
  lines.push(" * name; use `PARAMS_BY_FAMILY[family]` when iterating a whole");
  lines.push(" * family.");
  lines.push(" */");
  lines.push("export const PARAM_BY_KEY: Readonly<Record<string, Param>> = {");
  for (const e of flat) {
    const key = `${e.family}.${e.name}`;
    lines.push(
      `  ${emitKey(key)}: { family: ${emitString(e.family)}, paramId: ${e.paramId}, name: ${emitString(e.name)}, unit: 'unverified' },`,
    );
  }
  lines.push("};");
  lines.push("");
  lines.push("/** Family symbols present in the catalog, in dispatcher-case order. */");
  lines.push("export const FAMILIES: readonly string[] = [");
  for (const family of byFamily.keys()) {
    lines.push(`  ${emitString(family)},`);
  }
  lines.push("];");
  lines.push("");

  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

  // Generator self-report.
  const familySummary = cases
    .map((c) => `${c.effectFamily}=${familyCounts[c.effectFamily!]}`)
    .join(', ');
  console.log(
    `generate-axefx3-params-from-catalog: wrote ${OUTPUT_PATH}\n` +
    `  ${totalCount} params across ${familyCount} families\n` +
    `  ${overlayCount} firmware-legacy paramId overlays (FLANGER_OLD_* etc.)\n` +
    `  families: ${familySummary}`,
  );
}

main();
