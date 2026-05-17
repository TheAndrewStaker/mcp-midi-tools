import fs from 'node:fs';

const cat = JSON.parse(fs.readFileSync('samples/captured/decoded/ghidra-am4-paramnames.json', 'utf8'));

const wanted = {
  FLANGER: [0x12, 0x14, 0x15, 0x16, 0x1b, 0x1c, 0x1d, 0x1f, 0x22],
  PHASER:  [0x0b, 0x0d, 0x15, 0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x25],
  FILTER:  [0x0e, 0x11, 0x16, 0x17, 0x1b, 0x1d, 0x24, 0x25, 0x26, 0x28],
};

for (const [fam, ids] of Object.entries(wanted)) {
  console.log(`\n=== ${fam} ===`);
  const want = new Set(ids);
  for (const [typeName, e] of Object.entries(cat.effect_types)) {
    if (e.effectFamily !== fam || !Array.isArray(e.params)) continue;
    for (const p of e.params) {
      if (want.has(p.paramId)) {
        console.log(`  variant=${typeName}  pid=0x${p.paramId.toString(16).padStart(4,'0')}  name=${p.name}  ${JSON.stringify(p)}`);
      }
    }
  }
}
