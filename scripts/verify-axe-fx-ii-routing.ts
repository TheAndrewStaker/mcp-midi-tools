/**
 * Verify the v0.4 routing-walk in Axe-Fx II's applyExecutor produces
 * byte-exact SET_CELL_ROUTING ops for an explicit-routing preset
 * spec. Pure transpiler check — no MIDI, no hardware required.
 *
 * Covers two cases:
 *   1. Wet/dry split (the FRACTAL-PRESET-SCHEMA.md worked example) —
 *      cab on row 2 col 3 fans out to delay on row 1 col 4 + reverb
 *      on row 3 col 4, both merge into a mixer at row 2 col 5. Asserts
 *      that the explicit-routing mode emits exactly the cables listed
 *      in the spec and SKIPS auto-shunt-extension + auto-row-2-cabling
 *      that the legacy linear mode adds.
 *
 *   2. AM4-style linear (no routing[]) — confirms legacy mode still
 *      auto-extends shunts to col 12 and cables every adjacent row-2
 *      pair. Byte-identical to pre-v0.4 behavior — the routing[]
 *      additions must NOT regress the existing v0.1 path.
 *
 * Run via:  npx tsx scripts/verify-axe-fx-ii-routing.ts
 * Wired into npm test for regression coverage.
 */
import {
  buildApplyPresetAtOps,
  type ApplyPresetAtInput,
} from '@mcp-midi-control/axe-fx-ii/tools/applyExecutor.js';
import { buildSetCellRouting } from '@mcp-midi-control/axe-fx-ii/setParam.js';

function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  OK    ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Case 1: explicit-routing wet/dry split.
// ─────────────────────────────────────────────────────────────────
//
// Topology:
//   col 1   col 2   col 3   col 4    col 5
//   ───────────────────────────────────────
//   row 1                   delay ─┐
//   row 2   comp    amp    cab ──┼─ mixer
//   row 3                   reverb ┘
//
// Routing edges (in order, all on adjacent columns):
//   comp R2C1 → amp R2C2
//   amp R2C2 → cab R2C3
//   cab R2C3 → delay R1C4
//   cab R2C3 → reverb R3C4
//   delay R1C4 → mixer R2C5
//   reverb R3C4 → mixer R2C5
console.log('\nCase 1 — explicit-routing wet/dry split');

const wetDry: ApplyPresetAtInput = {
  preset_number: 666,
  blocks: [
    { id: 'comp',   block: 'Compressor 1', row: 2, col: 1 },
    { id: 'amp',    block: 'Amp 1',        row: 2, col: 2 },
    { id: 'cab',    block: 'Cab 1',        row: 2, col: 3 },
    { id: 'delay',  block: 'Delay 1',      row: 1, col: 4 },
    { id: 'reverb', block: 'Reverb 1',     row: 3, col: 4 },
    { id: 'mixer',  block: 'Mixer',        row: 2, col: 5 },
  ],
  routing: [
    { from: 'comp',   to: 'amp' },
    { from: 'amp',    to: 'cab' },
    { from: 'cab',    to: 'delay' },
    { from: 'cab',    to: 'reverb' },
    { from: 'delay',  to: 'mixer' },
    { from: 'reverb', to: 'mixer' },
  ],
};

const wetDryOps = buildApplyPresetAtOps(wetDry, { wire: true });

const wetDryPlaceBlocks = wetDryOps.filter((o) => o.kind === 'place_block');
const wetDryCables = wetDryOps.filter((o) => o.kind === 'cable');

check(
  'explicit-routing places exactly 6 content blocks',
  wetDryPlaceBlocks.length === 6,
  `got ${wetDryPlaceBlocks.length}`,
);
check(
  'explicit-routing emits exactly 6 cables (no auto-shunt cabling)',
  wetDryCables.length === 6,
  `got ${wetDryCables.length}`,
);

// Spot-check the wire bytes of the parallel split: cab → delay (R2C3 → R1C4).
const expectedCabToDelay = buildSetCellRouting({
  srcRow: 2, srcCol: 3, dstRow: 1, dstCol: 4, connect: true,
});
const cabToDelay = wetDryCables.find((o) => /cab.*delay/.test(o.summary));
check(
  'cab → delay cable byte-exact against buildSetCellRouting',
  cabToDelay !== undefined && hex(cabToDelay.bytes) === hex(expectedCabToDelay),
  cabToDelay ? `got ${hex(cabToDelay.bytes)} vs ${hex(expectedCabToDelay)}` : 'op not found',
);

// And the merge: reverb → mixer (R3C4 → R2C5).
const expectedReverbToMixer = buildSetCellRouting({
  srcRow: 3, srcCol: 4, dstRow: 2, dstCol: 5, connect: true,
});
const reverbToMixer = wetDryCables.find((o) => /reverb.*mixer/.test(o.summary));
check(
  'reverb → mixer cable (cross-row merge) byte-exact',
  reverbToMixer !== undefined && hex(reverbToMixer.bytes) === hex(expectedReverbToMixer),
  reverbToMixer ? `got ${hex(reverbToMixer.bytes)} vs ${hex(expectedReverbToMixer)}` : 'op not found',
);

// Confirm no shunts placed (the explicit-routing skip).
const wetDryShuntPlacements = wetDryPlaceBlocks.filter((o) => /SHUNT/.test(o.summary));
check(
  'explicit-routing does NOT auto-place shunts',
  wetDryShuntPlacements.length === 0,
  `got ${wetDryShuntPlacements.length} shunt placements`,
);

// ─────────────────────────────────────────────────────────────────
// Case 2: legacy linear (no routing[]) — must still auto-extend.
// ─────────────────────────────────────────────────────────────────
console.log('\nCase 2 — legacy linear preset (no routing[])');

const linear: ApplyPresetAtInput = {
  preset_number: 600,
  blocks: [
    { block: 'Compressor 1' },
    { block: 'Amp 1' },
    { block: 'Cab 1' },
    { block: 'Reverb 1' },
  ],
};

const linearOps = buildApplyPresetAtOps(linear, { wire: true });
const linearPlaceBlocks = linearOps.filter((o) => o.kind === 'place_block');
const linearCables = linearOps.filter((o) => o.kind === 'cable');
const linearShuntPlacements = linearPlaceBlocks.filter((o) => /SHUNT/.test(o.summary));

// 4 content blocks + 8 shunts = 12 cells filled on row 2.
check(
  'legacy mode auto-extends shunts to col 12',
  linearShuntPlacements.length === 8,
  `expected 8 shunt placements (cols 5..12), got ${linearShuntPlacements.length}`,
);
check(
  'legacy mode emits 11 cables for row-2 chain (col1→col2..col11→col12)',
  linearCables.length === 11,
  `got ${linearCables.length}`,
);

// Confirm the row-2 cable byte-shape: col 1 → col 2.
const expectedRow2Col1To2 = buildSetCellRouting({
  srcRow: 2, srcCol: 1, dstRow: 2, dstCol: 2, connect: true,
});
const row2Col1To2 = linearCables.find((o) => /col 1 → row 2 col 2/.test(o.summary));
check(
  'legacy row-2 col 1 → col 2 cable byte-exact',
  row2Col1To2 !== undefined && hex(row2Col1To2.bytes) === hex(expectedRow2Col1To2),
  row2Col1To2 ? `got ${hex(row2Col1To2.bytes)}` : 'op not found',
);

// ─────────────────────────────────────────────────────────────────
// Case 3: explicit-routing validation — adjacent-column requirement.
// ─────────────────────────────────────────────────────────────────
console.log('\nCase 3 — adjacent-column rejection');

const offColumn: ApplyPresetAtInput = {
  preset_number: 666,
  blocks: [
    { id: 'comp', block: 'Compressor 1', row: 2, col: 1 },
    { id: 'amp',  block: 'Amp 1',        row: 2, col: 5 },  // skipped cols 2-4
  ],
  routing: [
    { from: 'comp', to: 'amp' },  // col 1 → col 5: not adjacent
  ],
};

let offColumnRejected = false;
let offColumnError = '';
try {
  buildApplyPresetAtOps(offColumn, { wire: true });
} catch (err) {
  offColumnRejected = true;
  offColumnError = (err as Error).message;
}
check(
  'off-column routing edge throws at build time',
  offColumnRejected && /adjacent|col.*\+ 1|insert.*shunt/i.test(offColumnError),
  offColumnRejected ? offColumnError.slice(0, 80) : 'no error thrown',
);

// ─────────────────────────────────────────────────────────────────
// Case 4: explicit-routing validation — missing block id reference.
// ─────────────────────────────────────────────────────────────────
console.log('\nCase 4 — unknown block id rejection');

const badId: ApplyPresetAtInput = {
  preset_number: 666,
  blocks: [
    { id: 'comp', block: 'Compressor 1', row: 2, col: 1 },
    { id: 'amp',  block: 'Amp 1',        row: 2, col: 2 },
  ],
  routing: [
    { from: 'comp', to: 'mystery_block' },  // typo / non-existent id
  ],
};

let badIdRejected = false;
let badIdError = '';
try {
  buildApplyPresetAtOps(badId, { wire: true });
} catch (err) {
  badIdRejected = true;
  badIdError = (err as Error).message;
}
check(
  'unknown block id in routing edge throws at build time',
  badIdRejected && /mystery_block|no block with that id|Known ids/i.test(badIdError),
  badIdRejected ? badIdError.slice(0, 80) : 'no error thrown',
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✓ Axe-Fx II v0.4 routing-walk verified.');
