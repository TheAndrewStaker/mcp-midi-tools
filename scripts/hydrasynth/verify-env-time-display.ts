/**
 * Sanity check: for `env*{attack,decay,release}syncoff`, given the user-
 * facing 0..128 value, compute what the Hydrasynth should display per
 * the per-param time table in `nrpn.ts`. Used to confirm whether a
 * "displayed time doesn't match what we sent" report is a wire-path bug
 * or just the documented exponential mapping.
 */

type Bucket = { width: number; startMs: number; stepMs: number };

// env*attacksyncoff, env*holdsyncoff: 129 entries, 0-36 sec.
const ATTACK_BUCKETS: Bucket[] = [
  { width: 20, startMs: 0,     stepMs: 1 },
  { width: 10, startMs: 20,    stepMs: 2 },
  { width: 10, startMs: 40,    stepMs: 4 },
  { width: 10, startMs: 80,    stepMs: 8 },
  { width: 10, startMs: 160,   stepMs: 16 },
  { width: 10, startMs: 320,   stepMs: 32 },
  { width: 10, startMs: 640,   stepMs: 64 },
  { width: 10, startMs: 1280,  stepMs: 128 },
  { width: 10, startMs: 2560,  stepMs: 256 },
  { width: 10, startMs: 5120,  stepMs: 512 },
  { width: 10, startMs: 10000, stepMs: 1000 }, // 10-20 sec by 1
  { width: 9,  startMs: 20000, stepMs: 2000 }, // 20-36 sec by 2
];

// env*decaysyncoff, env*releasesyncoff: 128 entries, 0-60 sec.
const DECAY_RELEASE_BUCKETS: Bucket[] = [
  { width: 20, startMs: 0,     stepMs: 2 },   // 0-40 ms by 2
  { width: 10, startMs: 40,    stepMs: 4 },
  { width: 10, startMs: 80,    stepMs: 8 },
  { width: 10, startMs: 160,   stepMs: 16 },
  { width: 10, startMs: 320,   stepMs: 32 },
  { width: 10, startMs: 640,   stepMs: 64 },
  { width: 10, startMs: 1280,  stepMs: 128 },
  { width: 10, startMs: 2560,  stepMs: 256 },
  { width: 10, startMs: 5120,  stepMs: 512 },
  { width: 6,  startMs: 10000, stepMs: 1000 }, // 10-16 sec by 1
  { width: 22, startMs: 16000, stepMs: 2000 }, // 16-60 sec by 2
];

function indexToMs(idx: number, buckets: Bucket[]): number {
  let cursor = 0;
  for (const b of buckets) {
    if (idx < cursor + b.width) {
      return b.startMs + (idx - cursor) * b.stepMs;
    }
    cursor += b.width;
  }
  return -1;
}

function format(ms: number): string {
  if (ms >= 1000) {
    // > 1 sec: floor to 2 decimals.
    return (Math.floor(ms / 10) / 100).toFixed(2) + ' sec';
  }
  return ms + ' ms';
}

const cases = [
  { name: 'env1attacksyncoff',  sent: 98,  table: 'attack',  reported: '4.60 sec' },
  { name: 'env1decaysyncoff',   sent: 72,  table: 'decay',   reported: '1.53 sec' },
  { name: 'env1releasesyncoff', sent: 96,  table: 'decay',   reported: '8.19 sec' },
  { name: 'env2attacksyncoff',  sent: 100, table: 'attack',  reported: '5.12 sec' },
  { name: 'env2decaysyncoff',   sent: 0,   table: 'decay',   reported: '0 (= default)' },
  { name: 'env2releasesyncoff', sent: 98,  table: 'decay',   reported: '9.21 sec' },
];

console.log('User-sent value → Hydrasynth display:');
console.log('name                          sent  table  → wire    idx  computed     reported');
console.log('------------------------------+-----+------+--------+----+-------------+----------');
for (const c of cases) {
  const wire = c.sent * 64;
  const idx = c.sent; // For both tables, on the device side: index = wire/64.
  const ms = indexToMs(idx, c.table === 'attack' ? ATTACK_BUCKETS : DECAY_RELEASE_BUCKETS);
  const computed = format(ms);
  console.log(
    `${c.name.padEnd(30)} ${String(c.sent).padStart(4)}  ${c.table.padEnd(6)} ${String(wire).padStart(6)}  ${String(idx).padStart(3)}  ${computed.padEnd(12)} ${c.reported}`,
  );
}
