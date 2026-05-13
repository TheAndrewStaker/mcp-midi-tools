/**
 * Drill into the cache-file read pattern. AM4-Edit reads the cache 26,941
 * times in a session — find out at what offsets and how many bytes per read.
 * That tells us where in the file the labels live.
 */

import { readFileSync } from 'node:fs';

interface Event { time: string; op: string; path: string; result: string; detail: string; }

function parseCsv(p: string): Event[] {
  const text = readFileSync(p, 'utf8');
  const lines = text.split('\n');
  const events: Event[] = [];
  for (const line of lines) {
    if (!line.startsWith('"')) continue;
    const cells = parseCsvRow(line);
    if (cells.length < 7) continue;
    const [time, proc, , op, path, result, detail] = cells;
    if (proc !== 'AM4-Edit.exe') continue;
    events.push({ time, op, path, result, detail });
  }
  return events;
}
function parseCsvRow(line: string): string[] {
  const out: string[] = []; let i = 0;
  while (i < line.length) {
    if (line[i] === '"') i++;
    let j = i;
    while (j < line.length) {
      if (line[j] === '"' && (j + 1 >= line.length || line[j + 1] === ',' || line[j + 1] === '\r' || line[j + 1] === '\n')) break;
      j++;
    }
    out.push(line.slice(i, j));
    i = j + 1;
    if (line[i] === ',') i++;
  }
  return out;
}

const csvPath = process.argv[2];
const events = parseCsv(csvPath);

// Cache reads — pull offset + length from Detail
const cacheReads = events.filter(e =>
  e.path && e.path.toLowerCase().includes('effectdefinitions') && e.op === 'ReadFile',
);
console.log(`cache ReadFile events: ${cacheReads.length}\n`);

// Detail format: "Offset: 12345, Length: 67, ..."
interface Read { offset: number; length: number; raw: string }
const reads: Read[] = [];
for (const e of cacheReads) {
  const m = e.detail.match(/Offset:\s*([\d,]+)[, ]+Length:\s*([\d,]+)/);
  if (m) {
    reads.push({
      offset: parseInt(m[1].replaceAll(',', ''), 10),
      length: parseInt(m[2].replaceAll(',', ''), 10),
      raw: e.detail.slice(0, 80),
    });
  }
}
console.log(`parsed ${reads.length} reads with offset+length`);

// Histogram of read lengths
const lenHist = new Map<number, number>();
for (const r of reads) lenHist.set(r.length, (lenHist.get(r.length) ?? 0) + 1);
console.log('\nread length histogram:');
for (const [len, n] of [...lenHist].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${n.toString().padStart(6)}× length=${len.toString().padStart(6)}`);
}

// Range of offsets accessed
if (reads.length > 0) {
  const offs = reads.map(r => r.offset);
  const minOff = Math.min(...offs);
  const maxOff = Math.max(...offs);
  console.log(`\noffset range: 0x${minOff.toString(16)} .. 0x${maxOff.toString(16)} (= ${minOff}..${maxOff})`);

  // Histogram offsets in 4KB buckets to see the access pattern
  const buckets = new Map<number, number>();
  for (const r of reads) {
    const bucket = Math.floor(r.offset / 4096);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  console.log('\noffset-bucket (4KB) hits, sorted by activity:');
  for (const [b, n] of [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${n.toString().padStart(6)}×  bucket 0x${(b * 4096).toString(16).padStart(6)} .. 0x${(b * 4096 + 4095).toString(16)}`);
  }
}

// File size vs total bytes read (do they read whole file repeatedly, or chunks?)
const totalBytes = reads.reduce((s, r) => s + r.length, 0);
console.log(`\ntotal bytes read from cache: ${totalBytes.toLocaleString()}`);

// First 30 reads
console.log('\nfirst 30 reads:');
for (const r of reads.slice(0, 30)) {
  console.log(`  off=0x${r.offset.toString(16).padStart(6,'0')}  len=${r.length.toString().padStart(6)}`);
}

// Look at WriteFile and RegSetValue too
console.log('\n--- writes ---');
for (const e of events.filter(e => e.op === 'WriteFile' || e.op === 'RegSetValue')) {
  console.log(`  ${e.op}  [${e.result}]  ${e.path}`);
  console.log(`    ${e.detail.slice(0, 120)}`);
}

// TCP activity
console.log('\n--- TCP ---');
for (const e of events.filter(e => e.op.startsWith('TCP'))) {
  console.log(`  ${e.op}  ${e.path}  ${e.detail.slice(0, 80)}`);
}
