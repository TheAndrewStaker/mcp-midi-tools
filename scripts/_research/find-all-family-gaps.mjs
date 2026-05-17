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
  ['CHORUS', 0x004e],
  ['FLANGER', 0x0052],
  ['PHASER', 0x005a],
  ['FILTER', 0x0072],
  ['TREMOLO', 0x006a],
  ['ROTARY', 0x0056],
  ['ENHANCER', 0x007a],
  ['COMP', 0x002e],
  ['GATE', 0x0092],
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
  const mirrorable = cat0.filter(x => !sP.has(x.paramId) && sC.has(x.paramId));
  const handAuthor = cat0.filter(x => !sP.has(x.paramId) && !sC.has(x.paramId));
  console.log(`${fam.padEnd(10)} catalog=${cat0.length.toString().padStart(3)}  params.ts=${sP.size.toString().padStart(3)}  cacheParams=${sC.size.toString().padStart(3)}  mirror=${mirrorable.length.toString().padStart(3)}  handauth=${handAuthor.length.toString().padStart(3)}`);
  if (mirrorable.length > 0) {
    console.log(`  mirrorable:`);
    for (const x of mirrorable) console.log(`    0x${x.paramId.toString(16).padStart(4, '0')} ${x.name}`);
  }
}
