import fs from 'node:fs';

const vt = fs.readFileSync('packages/am4/src/variantResolverTables.ts', 'utf8');
const candidates = [
  'CABINET_BANK2', 'CABINET_TYPE2', 'CABINET_LEVEL1', 'CABINET_LEVEL2',
  'CABINET_PAN2', 'CABINET_PROXIMITY1', 'CABINET_PROXIMITY2',
  'CABINET_MUTE1', 'CABINET_MUTE2', 'CABINET_LOCUT', 'CABINET_ZOOM',
  'CABINET_PRETYPE', 'CABINET_BASS', 'CABINET_MID', 'CABINET_SMOOTH1',
  'CABINET_SMOOTH2', 'CABINET_ORDER', 'CABINET_LOSLOPE2', 'CABINET_HISLOPE2',
  'CABINET_LOCUT1', 'CABINET_DYNACAB_TYPE1', 'CABINET_DYNACAB_TYPE2',
  'CABINET_DYNACAB_MIC1', 'CABINET_DYNACAB_MIC2', 'CABINET_DYNACAB_R2',
  'CABINET_DYNACAB_Z1', 'CABINET_DYNACAB_Z2', 'CABINET_GAINMONITOR',
];

for (const s of candidates) {
  const re = new RegExp(`"${s}":\\s*\\[([^\\]]+)\\]`);
  const m = re.exec(vt);
  console.log(s.padEnd(28), m ? `cacheId(s)=${m[1]}` : '— no cross-block resolver');
}
