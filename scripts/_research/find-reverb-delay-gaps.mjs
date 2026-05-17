import fs from 'node:fs';

const cat = JSON.parse(fs.readFileSync('samples/captured/decoded/ghidra-am4-paramnames.json', 'utf8'));
const p = fs.readFileSync('packages/am4/src/params.ts', 'utf8');

function gather(fam) {
  const r = [];
  for (const e of Object.values(cat.effect_types)) {
    if (e.effectFamily === fam && Array.isArray(e.params)) {
      for (const x of e.params) r.push(x);
    }
  }
  return r;
}

for (const [fam, pidLow] of [['REVERB', 0x42], ['DELAY', 0x46]]) {
  const hex = pidLow.toString(16).padStart(4, '0');
  const re = new RegExp(`pidLow:\\s*0x${hex},\\s*pidHigh:\\s*(0x[0-9a-fA-F]+)`, 'gs');
  const seen = new Set();
  let m;
  while ((m = re.exec(p))) seen.add(parseInt(m[1], 16));
  const miss = gather(fam).filter(x => x.paramId >= 10 && !seen.has(x.paramId));
  console.log(`\n=== ${fam} pidLow=0x${hex} - ${seen.size} seen, ${miss.length} missing ===`);
  for (const x of miss) {
    console.log(`  0x${x.paramId.toString(16).padStart(4, '0')}  ${x.name}`);
  }
}
