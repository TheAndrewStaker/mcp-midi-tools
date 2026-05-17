import fs from 'node:fs';

const cat = JSON.parse(fs.readFileSync('samples/captured/decoded/ghidra-am4-paramnames.json', 'utf8'));
const params = fs.readFileSync('packages/am4/src/params.ts', 'utf8');
const cache = fs.readFileSync('packages/am4/src/cacheParams.ts', 'utf8');

function gather(fam) {
  const r = [];
  for (const e of Object.values(cat.effect_types)) {
    if (e.effectFamily === fam && Array.isArray(e.params)) {
      for (const x of e.params) r.push(x);
    }
  }
  return r;
}

const fam = 'CABINET';
const pidLow = 0x003e;
const hex = pidLow.toString(16).padStart(4, '0');
const re = new RegExp(`pidLow:\s*0x${hex},\s*pidHigh:\s*(0x[0-9a-fA-F]+)`, 'gs');

const seenInParams = new Set();
let m;
while ((m = re.exec(params))) seenInParams.add(parseInt(m[1], 16));

const seenInCache = new Set();
re.lastIndex = 0;
while ((m = re.exec(cache))) seenInCache.add(parseInt(m[1], 16));

const catalog = gather(fam);
const missing = catalog.filter(x => x.paramId >= 10 && !seenInParams.has(x.paramId));
const inCacheNotParams = catalog.filter(x => x.paramId >= 10 && !seenInParams.has(x.paramId) && seenInCache.has(x.paramId));
const inNeither = catalog.filter(x => x.paramId >= 10 && !seenInParams.has(x.paramId) && !seenInCache.has(x.paramId));

console.log(`${fam} catalog: ${catalog.length} entries, paramId>=10: ${catalog.filter(x=>x.paramId>=10).length}`);
console.log(`params.ts (pidLow=0x${hex}): ${seenInParams.size} pidHighs`);
console.log(`cacheParams.ts (pidLow=0x${hex}): ${seenInCache.size} pidHighs`);
console.log(`\nMissing from params.ts (${missing.length}):`);
console.log(`  In cacheParams but not params.ts (mirror candidates, ${inCacheNotParams.length}):`);
for (const x of inCacheNotParams) console.log(`    0x${x.paramId.toString(16).padStart(4,'0')} ${x.name}`);
console.log(`  Not in cacheParams (hand-author candidates, ${inNeither.length}):`);
for (const x of inNeither) console.log(`    0x${x.paramId.toString(16).padStart(4,'0')} ${x.name}`);
