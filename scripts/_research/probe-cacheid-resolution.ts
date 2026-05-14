import { resolveAllCacheIds, PARAMETER_NAME_TO_CACHE_ID } from '@mcp-midi-control/am4/variantResolverTables.js';

console.log('DELAY_OFFSET:', resolveAllCacheIds('delay', 'DELAY_OFFSET'));
console.log('DELAY_SPLICETIME:', resolveAllCacheIds('delay', 'DELAY_SPLICETIME'));
console.log('DELAY_RATE4:', resolveAllCacheIds('delay', 'DELAY_RATE4'));

console.log('\nReverse lookup — what binds to delay cache_id 73 / 42 / 82?');
const delayMap = PARAMETER_NAME_TO_CACHE_ID.delay;
for (const [pn, cids] of Object.entries(delayMap)) {
  for (const c of [73, 42, 82]) {
    if (cids.includes(c)) console.log(`  ${pn} → ${cids}`);
  }
}
