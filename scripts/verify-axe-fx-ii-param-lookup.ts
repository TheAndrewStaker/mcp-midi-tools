/**
 * Regression — `findParam(target, name)` resolves params consistently
 * with `axefx2_list_params` across every block group whose 3-letter
 * groupCode differs from the lowercase block slug.
 *
 * HW-086 (2026-05-11) surfaced a divergence: the pre-fix `paramKey`
 * built lookup keys from `groupCode` (e.g. `"vol.volume"`) while
 * `KNOWN_PARAMS` is keyed by block slug (e.g. `"volpan.volume"`). Any
 * block where the two diverge — VOL/volpan, CPR/compressor, CHO/chorus,
 * DLY/delay, REV/reverb, … — rejected valid param names with
 * `Unknown param "<name>"` even though `axefx2_list_params` reported
 * them as available.
 *
 * This script catches the regression without hitting the MCP-server
 * smoke (which now opens the device port and blocks on response
 * timeouts when a real Axe-Fx II is attached). Pure registry walk —
 * runs in <50ms.
 */
import { KNOWN_PARAMS } from '@/fractal/axe-fx-ii/params.js';
import { AXE_FX_II_BLOCKS, BLOCK_BY_ID, resolveBlock } from '@/fractal/axe-fx-ii/blockTypes.js';
import { findParam } from '@/fractal/axe-fx-ii/tools.js';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
    if (!ok) {
        failures++;
        console.error(`  FAIL — ${label}${detail ? `: ${detail}` : ''}`);
    }
}

// 1. Every entry in KNOWN_PARAMS must be findable via findParam(block, name)
//    for at least one block whose groupCode matches the entry's groupCode.
//    This is the parity check between list_params and get/set_param.
const groupsCovered = new Set<string>();
for (const entry of Object.values(KNOWN_PARAMS)) {
    const blockId = AXE_FX_II_BLOCKS.find((b) => b.groupCode === entry.groupCode)?.id;
    if (blockId === undefined) continue; // groupCode without a registered block instance (e.g. INPUT/OUTPUT — internal-only)
    const block = BLOCK_BY_ID[blockId];
    const resolved = findParam(block, entry.name);
    check(
        `findParam(${block.name}, "${entry.name}") resolves`,
        resolved !== undefined && resolved.paramId === entry.paramId,
        resolved
            ? `got paramId ${resolved.paramId}, expected ${entry.paramId}`
            : 'returned undefined',
    );
    groupsCovered.add(entry.groupCode);
}

// 2. Explicit asserts for the previously-broken groups — these are the
//    "block slug ≠ groupCode" combinations the bug specifically affected.
const slugVsGroupCases: Array<{ block: string; name: string; expectedPid: number }> = [
    // VOL / volpan
    { block: 'Volume/Pan 1', name: 'volume', expectedPid: 0 },
    { block: 'Volume/Pan 1', name: 'balance', expectedPid: 1 },
    { block: 'Volume/Pan 1', name: 'level', expectedPid: 6 },
    { block: 'Volume/Pan 1', name: 'bypass_mode', expectedPid: 7 },
    // CPR / compressor
    { block: 'Compressor 1', name: 'ratio', expectedPid: 1 },
    { block: 'Compressor 1', name: 'attack', expectedPid: 2 },
    // CHO / chorus
    { block: 'Chorus 1', name: 'rate', expectedPid: 2 },
    { block: 'Chorus 1', name: 'depth', expectedPid: 4 },
    // DLY / delay
    { block: 'Delay 1', name: 'time', expectedPid: 2 },
    { block: 'Delay 1', name: 'feedback', expectedPid: 4 },
    // REV / reverb — confirm via the param name shape the agent would use.
    { block: 'Reverb 1', name: 'mix', expectedPid: -1 }, // placeholder — fixed below if "mix" exists
];

// Resolve the actual REV mix paramId from the registry so we don't
// hard-code stale data.
const revMix = Object.values(KNOWN_PARAMS).find((p) => p.groupCode === 'REV' && p.name === 'mix');
if (revMix) {
    slugVsGroupCases[slugVsGroupCases.length - 1].expectedPid = revMix.paramId;
}

for (const { block, name, expectedPid } of slugVsGroupCases) {
    if (expectedPid < 0) {
        // REV/mix not in registry — skip rather than assert a wrong value.
        continue;
    }
    const target = resolveBlock(block);
    check(
        `resolveBlock("${block}") finds block`,
        target !== undefined,
        `resolveBlock returned undefined`,
    );
    if (!target) continue;
    const resolved = findParam(target, name);
    check(
        `findParam("${block}", "${name}") = pid${expectedPid}`,
        resolved !== undefined && resolved.paramId === expectedPid,
        resolved
            ? `got paramId ${resolved.paramId}`
            : `returned undefined — name lookup broken for group ${target.groupCode}`,
    );
}

// 3. Case-tolerance: agents sometimes uppercase or mixed-case the name.
{
    const target = resolveBlock('Volume/Pan 1');
    check('resolveBlock("Volume/Pan 1") works', target !== undefined);
    if (target) {
        check(
            'findParam tolerates uppercase name input',
            findParam(target, 'VOLUME')?.paramId === 0,
            'expected paramId 0 for "VOLUME"',
        );
        check(
            'findParam tolerates whitespace in name input',
            findParam(target, '  volume  ')?.paramId === 0,
            'expected paramId 0 for "  volume  "',
        );
    }
}

// 4. Negative — an unknown name still returns undefined (so tool wrappers
//    can throw "Unknown param" deliberately).
{
    const target = resolveBlock('Volume/Pan 1');
    if (target) {
        check(
            'findParam returns undefined for bogus name',
            findParam(target, 'not_a_real_param') === undefined,
            'expected undefined',
        );
    }
}

if (failures === 0) {
    process.exit(0);
}
console.error(`\nverify-axe-fx-ii-param-lookup: ${failures} failure(s) across ${groupsCovered.size} groups.`);
process.exit(1);
