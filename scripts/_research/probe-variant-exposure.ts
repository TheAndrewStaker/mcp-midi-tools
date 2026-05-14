/**
 * One-shot probe: for a list of parameterNames, list every AM4-Edit UI
 * variant (block + variant + page + page-layer) that exposes each one.
 * Used in Session 46 cont 5 to answer the founder's question of which
 * amp types expose the rare knobs picked for the HW-053 spot-check sweep.
 */
import { EDITOR_CONTROLS } from '@mcp-midi-control/am4/editorControlLabels.js';

const TARGETS = [
  'DISTORT_PRESFREQ',
  'DISTORT_BETA',
  'DISTORT_SCREENFREQ',
  'DISTORT_TIMECONST',
  'DISTORT_CBRATIO',
];

for (const t of TARGETS) {
  const entry = EDITOR_CONTROLS[t];
  if (!entry) {
    console.log(`\n=== ${t} → NOT FOUND in EDITOR_CONTROLS ===`);
    continue;
  }
  console.log(`\n=== ${t} ===`);
  console.log(`canonical label: "${entry.canonicalLabel}"`);
  console.log(`appears in ${entry.contexts.length} UI contexts`);
  // Group by (block, variant) to collapse the per-page repetition.
  const byVariant = new Map<string, { page: string; layer: string; label: string }[]>();
  for (const c of entry.contexts) {
    const k = `${c.block} / ${c.variant}`;
    if (!byVariant.has(k)) byVariant.set(k, []);
    byVariant.get(k)!.push({ page: c.page, layer: c.pageLayer, label: c.label });
  }
  for (const [k, ctxs] of byVariant) {
    const pages = [...new Set(ctxs.map((c) => `${c.page}/${c.layer}`))];
    const labels = [...new Set(ctxs.map((c) => c.label))];
    console.log(`  ${k}`);
    console.log(`    pages: ${pages.join(', ')}`);
    console.log(`    labels: ${labels.map((l) => `"${l}"`).join(', ')}`);
  }
}
