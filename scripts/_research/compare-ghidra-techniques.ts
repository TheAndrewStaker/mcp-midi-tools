/**
 * Cross-validate the dispatcher-walk catalog (Session 82) against the
 * direct-pattern-scan catalog (Session 94, SeekParamTables64.java) for
 * AM4-Edit.exe and Axe-Edit III.exe.
 *
 * Both techniques recover (paramId, symbolicName) pairs from the
 * editor binary. They use independent mechanisms:
 *
 *   Dispatcher walk (Session 82):
 *     - Find the switch dispatcher (per-effect param table lookup).
 *     - For each case, dereference the table pointer.
 *     - Walk the table at +16 stride until paramId == -1.
 *     - Strict: only finds params reachable from the dispatcher's
 *       case arms.
 *
 *   Direct pattern scan (Session 94):
 *     - Index every Fractal-prefixed string in .rdata.
 *     - Scan every 4-byte-aligned data offset for runs of the
 *       ParamDescriptor struct shape pointing at indexed strings.
 *     - Finds tables regardless of how they're dispatched.
 *
 * Per-technique gaps (predicted):
 *   - Dispatcher misses tables not reachable from its switch (e.g.
 *     tables loaded indirectly, or tables present in .rdata but
 *     never wired into the dispatcher). Found on AM4: direct-scan
 *     found 162 more.
 *   - Direct-scan misses tables under MIN_TABLE_ENTRIES (=3) plus
 *     tables whose first symbol's pointer happens to fall outside
 *     the indexed-string set (e.g. firmware-internal names not in
 *     PREFIXES list). Found on III: dispatcher found 66 more.
 *
 * Output: per-binary report listing
 *   - matched: present in both techniques with same paramId
 *   - dispatcher-only: in dispatcher catalog, not in direct-scan
 *   - direct-scan-only: in direct-scan, not in dispatcher
 *   - id-disagreement: same symbol, different paramId (should be 0)
 *
 * Run:
 *   npx tsx scripts/_research/compare-ghidra-techniques.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface DispatcherEffect {
  caseIdx: number;
  effectFamily?: string;
  params: { paramId: number; name: string }[];
}
interface DispatcherDump {
  effect_types: Record<string, DispatcherEffect>;
}

interface DirectScanTable {
  effectFamily: string | null;
  params: { paramId: number; name: string }[];
}
interface DirectScanDump {
  tables: DirectScanTable[];
}

interface ComparisonReport {
  device: string;
  dispatcherTotal: number;
  directScanTotal: number;
  matched: number;
  dispatcherOnly: { name: string; paramId: number; effectFamily?: string }[];
  directScanOnly: { name: string; paramId: number; effectFamily?: string }[];
  idDisagreements: {
    name: string;
    dispatcherPid: number;
    directScanPid: number;
  }[];
}

function flattenDispatcher(dump: DispatcherDump): {
  byName: Map<string, { paramId: number; effectFamily?: string }>;
  total: number;
} {
  const byName = new Map<string, { paramId: number; effectFamily?: string }>();
  let total = 0;
  for (const eff of Object.values(dump.effect_types)) {
    for (const p of eff.params) {
      total++;
      // First wins (a symbol may appear under multiple dispatcher
      // cases — e.g. AM4's INPUT 1-5 share a table).
      if (!byName.has(p.name)) {
        byName.set(p.name, {
          paramId: p.paramId,
          effectFamily: eff.effectFamily,
        });
      }
    }
  }
  return { byName, total };
}

function flattenDirectScan(dump: DirectScanDump): {
  byName: Map<string, { paramId: number; effectFamily?: string }>;
  total: number;
} {
  const byName = new Map<string, { paramId: number; effectFamily?: string }>();
  let total = 0;
  // Pick the canonical (largest) table per family — discard nested
  // / duplicate variants that the direct-scan emits for some families.
  const canonical: Record<string, DirectScanTable> = {};
  for (const t of dump.tables) {
    const fam = t.effectFamily ?? 'UNKNOWN';
    if (!canonical[fam] || t.params.length > canonical[fam].params.length) {
      canonical[fam] = t;
    }
  }
  for (const t of Object.values(canonical)) {
    for (const p of t.params) {
      total++;
      // Drop cross-family ghost entries (a table's first entry's
      // family-prefix sometimes leaks layout-string symbols).
      if (t.effectFamily && !p.name.startsWith(t.effectFamily + '_')) continue;
      if (!byName.has(p.name)) {
        byName.set(p.name, {
          paramId: p.paramId,
          effectFamily: t.effectFamily ?? undefined,
        });
      }
    }
  }
  return { byName, total };
}

function compare(
  device: string,
  dispatcher: ReturnType<typeof flattenDispatcher>,
  directScan: ReturnType<typeof flattenDirectScan>,
): ComparisonReport {
  const report: ComparisonReport = {
    device,
    dispatcherTotal: dispatcher.total,
    directScanTotal: directScan.total,
    matched: 0,
    dispatcherOnly: [],
    directScanOnly: [],
    idDisagreements: [],
  };
  for (const [name, d] of dispatcher.byName) {
    const ds = directScan.byName.get(name);
    if (!ds) {
      report.dispatcherOnly.push({
        name,
        paramId: d.paramId,
        effectFamily: d.effectFamily,
      });
    } else if (ds.paramId !== d.paramId) {
      report.idDisagreements.push({
        name,
        dispatcherPid: d.paramId,
        directScanPid: ds.paramId,
      });
    } else {
      report.matched++;
    }
  }
  for (const [name, ds] of directScan.byName) {
    if (!dispatcher.byName.has(name)) {
      report.directScanOnly.push({
        name,
        paramId: ds.paramId,
        effectFamily: ds.effectFamily,
      });
    }
  }
  return report;
}

function topFamilies(
  entries: { effectFamily?: string }[],
  topN = 10,
): { family: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const f = e.effectFamily ?? '(unknown)';
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function emitReport(r: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.device} — Ghidra technique comparison`);
  lines.push('');
  lines.push(`- dispatcher catalog: ${r.dispatcherTotal} entries (Session 82)`);
  lines.push(`- direct-scan catalog: ${r.directScanTotal} entries (Session 94)`);
  lines.push(`- matched (same name, same paramId): ${r.matched}`);
  lines.push(`- dispatcher-only (direct-scan missed): ${r.dispatcherOnly.length}`);
  lines.push(`- direct-scan-only (dispatcher missed): ${r.directScanOnly.length}`);
  lines.push(`- paramId disagreements: ${r.idDisagreements.length}`);
  lines.push('');
  if (r.idDisagreements.length > 0) {
    lines.push('## paramId disagreements (RED FLAG — should be 0)');
    lines.push('');
    for (const d of r.idDisagreements) {
      lines.push(
        `  ${d.name}: dispatcher=${d.dispatcherPid} directScan=${d.directScanPid}`,
      );
    }
    lines.push('');
  }
  lines.push('## dispatcher-only — what direct-scan missed');
  lines.push('');
  if (r.dispatcherOnly.length === 0) {
    lines.push('  (none — direct-scan covers the dispatcher catalog completely)');
  } else {
    lines.push('Top families:');
    for (const f of topFamilies(r.dispatcherOnly)) {
      lines.push(`  ${f.family.padEnd(20)} ${f.count}`);
    }
    lines.push('');
    lines.push('First 30 missing:');
    for (const e of r.dispatcherOnly.slice(0, 30)) {
      lines.push(`  paramId=${String(e.paramId).padStart(4)}  ${e.name}`);
    }
  }
  lines.push('');
  lines.push('## direct-scan-only — what dispatcher missed');
  lines.push('');
  if (r.directScanOnly.length === 0) {
    lines.push('  (none — dispatcher covers the direct-scan catalog completely)');
  } else {
    lines.push('Top families:');
    for (const f of topFamilies(r.directScanOnly)) {
      lines.push(`  ${f.family.padEnd(20)} ${f.count}`);
    }
    lines.push('');
    lines.push('First 30 dispatcher-missed:');
    for (const e of r.directScanOnly.slice(0, 30)) {
      lines.push(`  paramId=${String(e.paramId).padStart(4)}  ${e.name}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ── AM4 comparison ────────────────────────────────────────────────────
console.log('Loading AM4 catalogs…');
const am4Dispatcher = flattenDispatcher(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-am4-paramnames.json',
      'utf8',
    ),
  ),
);
const am4DirectScan = flattenDirectScan(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-am4edit-paramtables.json',
      'utf8',
    ),
  ),
);
const am4Report = compare('AM4-Edit', am4Dispatcher, am4DirectScan);

// ── III comparison ────────────────────────────────────────────────────
console.log('Loading III catalogs…');
const iiiDispatcher = flattenDispatcher(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-axeedit3-paramnames.json',
      'utf8',
    ),
  ),
);
const iiiDirectScan = flattenDirectScan(
  JSON.parse(
    readFileSync(
      'samples/captured/decoded/ghidra-axeeditiii-paramtables.json',
      'utf8',
    ),
  ),
);
const iiiReport = compare('AxeEdit III', iiiDispatcher, iiiDirectScan);

// ── Write combined report ─────────────────────────────────────────────
const out =
  '# Ghidra dispatcher vs direct-scan — cross-validation\n\n' +
  'Generated by `scripts/_research/compare-ghidra-techniques.ts`. ' +
  'Cross-checks the Session 82 dispatcher-walk against the Session 94 ' +
  'direct-pattern-scan for both AM4-Edit and Axe-Edit III.\n\n' +
  'paramId disagreements MUST be 0 — if not, one of the techniques has a ' +
  'wire-correctness bug and the catalog is unsafe to ship.\n\n' +
  '---\n\n' +
  emitReport(am4Report) +
  '\n---\n\n' +
  emitReport(iiiReport);

writeFileSync(
  'samples/captured/decoded/ghidra-techniques-comparison.md',
  out,
  'utf8',
);

// ── Console summary ───────────────────────────────────────────────────
console.log('');
console.log('=== AM4 ===');
console.log(
  `  dispatcher: ${am4Report.dispatcherTotal}  directScan: ${am4Report.directScanTotal}`,
);
console.log(`  matched: ${am4Report.matched}`);
console.log(`  dispatcher-only (direct-scan missed): ${am4Report.dispatcherOnly.length}`);
console.log(`  direct-scan-only (dispatcher missed): ${am4Report.directScanOnly.length}`);
console.log(`  paramId disagreements: ${am4Report.idDisagreements.length}`);
console.log('');
console.log('=== III ===');
console.log(
  `  dispatcher: ${iiiReport.dispatcherTotal}  directScan: ${iiiReport.directScanTotal}`,
);
console.log(`  matched: ${iiiReport.matched}`);
console.log(`  dispatcher-only (direct-scan missed): ${iiiReport.dispatcherOnly.length}`);
console.log(`  direct-scan-only (dispatcher missed): ${iiiReport.directScanOnly.length}`);
console.log(`  paramId disagreements: ${iiiReport.idDisagreements.length}`);
console.log('');
console.log(
  'Wrote samples/captured/decoded/ghidra-techniques-comparison.md',
);
