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

const FAMS = [
  ['FLANGER', 0x0052],
  ['PHASER', 0x005a],
  ['FILTER', 0x0072],
  ['COMP', 0x002e],
];

for (const [fam, pidLow] of FAMS) {
  const hex = pidLow.toString(16).padStart(4, '0');
  const pat = 'pidLow:\\s*0x' + hex + ',\\s*pidHigh:\\s*(0x[0-9a-fA-F]+)';
  const reP = new RegExp(pat, 'gs');
  const reC = new RegExp(pat, 'gs');
  const sP = new Set();
  const sC = new Set();
  let m;
  while ((m = reP.exec(params))) sP.add(parseInt(m[1], 16));
  while ((m = reC.exec(cache))) sC.add(parseInt(m[1], 16));
  const cat0 = gather(fam).filter(x => x.paramId >= 10);
  const handAuthor = cat0.filter(x => !sP.has(x.paramId) && !sC.has(x.paramId));
  console.log(`\n=== ${fam} hand-auth (${handAuthor.length}) ===`);
  for (const x of handAuthor) {
    console.log(`  0x${x.paramId.toString(16).padStart(4, '0')}  ${x.name}`);
  }
}
