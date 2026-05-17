import fs from 'node:fs';

const s3raw = JSON.parse(fs.readFileSync('samples/captured/decoded/cache-section3.json', 'utf8'));
const s2 = JSON.parse(fs.readFileSync('samples/captured/decoded/cache-section2.json', 'utf8'));
const s3 = Array.isArray(s3raw) ? s3raw : s3raw.records || [];

const all = [...s2, ...s3];

// REVERB = block 14, DELAY = block 16
const REVERB_BLOCK = 14;
const DELAY_BLOCK = 16;

const REVERB_GAPS = [
  { id: 0x33, name: 'INPUTSELECT' },
  { id: 0x35, name: 'LOWSLOPE' },
  { id: 0x36, name: 'HIGHSLOPE' },
  { id: 0x3b, name: 'PITCHDIR' },
  { id: 0x3d, name: 'PITCHPOS' },
  { id: 0x40, name: 'PREDLYTEMPO' },
  { id: 0x44, name: 'SPRINGTYPE' },
  { id: 0x46, name: 'PREDLYTAP' },
];

const DELAY_GAPS = [
  { id: 0x0b, name: 'TYPE' },
  { id: 0x1c, name: 'LFO1TYPE' },
  { id: 0x1d, name: 'LFO2TYPE' },
  { id: 0x21, name: 'TEMPOR' },
  { id: 0x2b, name: 'RUN' },
  { id: 0x2c, name: 'MODE' },
  { id: 0x34, name: 'LFO1TARGET' },
  { id: 0x35, name: 'LFO2TARGET' },
  { id: 0x36, name: 'LFO1TEMPO' },
  { id: 0x37, name: 'LFO2TEMPO' },
  { id: 0x39, name: 'LFO3TYPE' },
  { id: 0x3b, name: 'LFO3TEMPO' },
  { id: 0x47, name: 'MAXDEPTH' },
  { id: 0x51, name: 'LFO4TYPE' },
  { id: 0x53, name: 'LFO4TEMPO' },
  { id: 0x56, name: 'LFO4TARGET' },
  { id: 0x59, name: 'SVFTYPE' },
];

function inspect(block, gaps, label) {
  console.log(`\n=== ${label} (block=${block}) ===`);
  for (const g of gaps) {
    const rec = all.find(r => r.block === block && r.id === g.id);
    if (!rec) {
      console.log(`  id=${g.id} (0x${g.id.toString(16)}) ${g.name}: NO CACHE RECORD`);
      continue;
    }
    const summary = rec.kind === 'enum'
      ? `enum [${(rec.values || []).join(', ')}]`
      : `${rec.kind} typecode=${rec.typecode} a=${rec.a} b=${rec.b} c=${rec.c}`;
    console.log(`  id=${g.id} (0x${g.id.toString(16)}) ${g.name}: ${summary}`);
  }
}

inspect(REVERB_BLOCK, REVERB_GAPS, 'REVERB');
inspect(DELAY_BLOCK, DELAY_GAPS, 'DELAY');
