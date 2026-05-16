/**
 * Validate packages/am4/src/params.ts against the Ghidra-extracted
 * AM4 parameter catalog. Catches:
 *
 *   1. pidLow doesn't match blockTypes.ts for the named block
 *   2. pidHigh >= 10 doesn't map to a Ghidra paramId in the block's
 *      family (suggests a typo or wrong family assignment)
 *   3. pidHigh in [0..9] not in the documented generic-param set
 *      (0=level, 1=mix, 2=balance, 4=bypass_mode)
 *   4. pidHigh == 0x07D2 (2002) on a non-channel-select param
 *
 * Exits 0 on clean, 1 on any error found. Suitable for integration
 * into preflight once the catalog stabilizes.
 *
 * Usage:
 *   npx tsx scripts/_research/validate-params-against-catalog.ts
 *   npx tsx scripts/_research/validate-params-against-catalog.ts --verbose
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');

const PARAMS_TS = 'packages/am4/src/params.ts';
const BLOCK_TYPES_TS = 'packages/am4/src/blockTypes.ts';
const GHIDRA_AM4 = 'samples/captured/decoded/ghidra-am4-paramnames.json';

// Parse blockTypes.ts → { block: pidLow }
const blockTypesSrc = readFileSync(BLOCK_TYPES_TS, 'utf-8');
const blockPidLow: Record<string, number> = {};
for (const m of blockTypesSrc.matchAll(/^\s+([a-z]+):\s+(0x[0-9a-fA-F]+),/gm)) {
  blockPidLow[m[1]] = parseInt(m[2], 16);
}

// Block → catalog family (some blocks share families). Mirror the
// FAMILY_TO_BLOCKS map in generate-am4-params-from-catalog.ts but
// inverted.
const BLOCK_TO_FAMILY: Record<string, string> = {
  amp: 'DISTORT',
  drive: 'DISTORT',
  reverb: 'REVERB',
  delay: 'DELAY',
  chorus: 'CHORUS',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  rotary: 'ROTARY',
  tremolo: 'TREMOLO',
  wah: 'WAH',
  filter: 'FILTER',
  compressor: 'COMP',
  geq: 'GEQ',
  peq: 'PEQ',
  gate: 'GATE',
  enhancer: 'ENHANCER',
  volpan: 'VOLUME',
  cab: 'CABINET',
  // ingate is AM4-specific (input gate) — not in dispatcher catalog,
  // so skip catalog validation for it
};

// Generic params (pidHigh 0..9) and their known meanings.
const GENERIC_PIDHIGH: Record<number, string> = {
  0x0000: 'level',
  0x0001: 'mix',
  0x0002: 'balance',
  0x0004: 'bypass_mode',
};

const CHANNEL_REGISTER = 0x07d2; // 2002

// Load Ghidra catalog → { family: { paramId: name } }
const catalog = JSON.parse(readFileSync(GHIDRA_AM4, 'utf-8'));
const catalogByFamily: Record<string, Record<number, string>> = {};
for (const eff of Object.values(catalog.effect_types) as any[]) {
  if (!eff.effectFamily) continue;
  catalogByFamily[eff.effectFamily] ??= {};
  for (const p of eff.params as { paramId: number; name: string }[]) {
    catalogByFamily[eff.effectFamily][p.paramId] = p.name;
  }
}

// Parse params.ts entries.
const paramsTs = readFileSync(PARAMS_TS, 'utf-8');
const entryRe = /^\s+'([a-z]+\.[a-z0-9_]+)':\s*\{[\s\S]*?block:\s*'([a-z]+)',\s*name:\s*'([a-z0-9_]+)',[\s\S]*?pidLow:\s*(0x[0-9a-fA-F]+),\s*pidHigh:\s*(0x[0-9a-fA-F]+)/gm;
const entries: { key: string; block: string; name: string; pidLow: number; pidHigh: number }[] = [];
for (const m of paramsTs.matchAll(entryRe)) {
  entries.push({
    key: m[1],
    block: m[2],
    name: m[3],
    pidLow: parseInt(m[4], 16),
    pidHigh: parseInt(m[5], 16),
  });
}

console.log(`Loaded ${entries.length} entries from ${PARAMS_TS}`);
console.log(`Block-type pidLow table: ${Object.keys(blockPidLow).length} blocks`);
console.log(`Ghidra catalog: ${Object.keys(catalogByFamily).length} families`);
console.log('');

interface Issue {
  severity: 'error' | 'warn';
  key: string;
  message: string;
}
const issues: Issue[] = [];

// Reverse map: pidLow value → block name (for cross-block detection).
// Includes blockTypes.ts entries PLUS known-addressable pidLows that
// aren't placeable blocks on AM4 (e.g. cab at 0x3e — documented §6k).
const EXTRA_PIDLOW_TO_BLOCK: Record<number, string> = {
  0x003e: 'cab',  // §6k — addressable but not in BLOCK_TYPE_VALUES (not placeable as a slot block)
};
const pidLowToBlock: Record<number, string> = { ...EXTRA_PIDLOW_TO_BLOCK };
for (const [block, pidLow] of Object.entries(blockPidLow)) {
  pidLowToBlock[pidLow] = block;
}

for (const e of entries) {
  // Check 1: pidLow matches blockTypes.ts for the named block
  const expectedPidLow = blockPidLow[e.block];
  if (expectedPidLow === undefined) {
    issues.push({
      severity: 'warn',
      key: e.key,
      message: `block "${e.block}" not in blockTypes.ts BLOCK_TYPE_VALUES (skipping pidLow check)`,
    });
  } else if (e.pidLow !== expectedPidLow) {
    // Cross-block addressing: e.g. amp.cab_* uses cab's pidLow because
    // the AM4 routes amp-UI cab settings to the cab block at wire level.
    // This is allowed by design but worth surfacing for review.
    const actualBlock = pidLowToBlock[e.pidLow];
    if (actualBlock) {
      issues.push({
        severity: 'warn',
        key: e.key,
        message: `cross-block addressing: tagged "${e.block}" but pidLow=0x${e.pidLow.toString(16)} is the "${actualBlock}" block. Allowed if AM4 routes UI through that block internally (e.g. amp's integrated cab).`,
      });
    } else {
      issues.push({
        severity: 'error',
        key: e.key,
        message: `pidLow=0x${e.pidLow.toString(16)} doesn't match any block in blockTypes.ts. ${e.block} expects 0x${expectedPidLow.toString(16)}.`,
      });
    }
  }

  // Check 2: pidHigh range cases
  if (e.pidHigh === CHANNEL_REGISTER) {
    // Channel-select register — should only be on *.channel entries
    if (e.name !== 'channel') {
      issues.push({
        severity: 'warn',
        key: e.key,
        message: `pidHigh=0x07D2 (channel-select) on non-channel param "${e.name}"`,
      });
    }
  } else if (e.pidHigh < 10) {
    // Generic param
    if (!(e.pidHigh in GENERIC_PIDHIGH)) {
      issues.push({
        severity: 'warn',
        key: e.key,
        message: `pidHigh=0x${e.pidHigh.toString(16)} is in generic range but not in documented generic-param set (0=level, 1=mix, 2=balance, 4=bypass_mode)`,
      });
    } else if (verbose) {
      console.log(`  ✓ ${e.key} — generic ${GENERIC_PIDHIGH[e.pidHigh]}`);
    }
  } else {
    // Block-specific paramId — must exist in catalog for the family
    // that owns this pidLow (not necessarily e.block's family — cross-
    // block addressing uses a different family's catalog).
    const actualBlock = pidLowToBlock[e.pidLow] ?? e.block;
    const family = BLOCK_TO_FAMILY[actualBlock];
    if (!family) {
      // No family mapping (e.g. ingate, blocks not in the dispatcher) — skip
      continue;
    }
    const catalogName = catalogByFamily[family]?.[e.pidHigh];
    if (!catalogName) {
      issues.push({
        severity: 'error',
        key: e.key,
        message: `pidHigh=${e.pidHigh} (=0x${e.pidHigh.toString(16)}) has NO entry in Ghidra ${family} catalog (looked up via pidLow=0x${e.pidLow.toString(16)} → ${actualBlock} block). Likely typo OR a param that's truly missing from the dispatcher (rare).`,
      });
    } else if (verbose) {
      console.log(`  ✓ ${e.key} → ${family}_paramId=${e.pidHigh} → ${catalogName}`);
    }
  }
}

const errors = issues.filter((i) => i.severity === 'error');
const warns = issues.filter((i) => i.severity === 'warn');

console.log('');
console.log('## Validation report');
console.log(`  Total entries:  ${entries.length}`);
console.log(`  Errors:         ${errors.length}`);
console.log(`  Warnings:       ${warns.length}`);
console.log('');

if (errors.length > 0) {
  console.log('### ERRORS');
  console.log('');
  for (const e of errors) {
    console.log(`  ✗ ${e.key}: ${e.message}`);
  }
  console.log('');
}

if (warns.length > 0) {
  console.log('### WARNINGS');
  console.log('');
  for (const w of warns.slice(0, 50)) {
    console.log(`  ⚠ ${w.key}: ${w.message}`);
  }
  if (warns.length > 50) console.log(`  ... ${warns.length - 50} more (use --verbose)`);
  console.log('');
}

if (errors.length === 0 && warns.length === 0) {
  console.log('✅ All entries pass validation.');
}

process.exit(errors.length > 0 ? 1 : 0);
