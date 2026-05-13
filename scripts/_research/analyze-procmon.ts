/**
 * Analyze a Procmon CSV export of AM4-Edit.exe activity.
 *
 * Goals:
 *   1. List every non-system file path AM4-Edit opens, with op + result.
 *      A file we missed (label table, definitions blob) shows up here.
 *   2. List every USB / device path it touches.
 *   3. Diff two traces: WHAT IS DIFFERENT when a device is connected.
 *
 * Run:
 *   npx tsx scripts/analyze-procmon.ts <csv-path> [--diff <other-csv>]
 *     [--label <baseline|compare>]
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const csvPath = args[0];
if (!csvPath) {
  console.error('Usage: analyze-procmon.ts <csv-path> [--diff <other-csv>]');
  process.exit(1);
}

interface Event {
  time: string;
  op: string;
  path: string;
  result: string;
  detail: string;
}

function parseCsv(path: string): Event[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const events: Event[] = [];
  for (const line of lines) {
    if (!line.startsWith('"')) continue;
    const cells = parseCsvRow(line);
    if (cells.length < 7) continue;
    const [time, proc, , op, p, result, detail] = cells;
    if (proc !== 'AM4-Edit.exe') continue;
    events.push({ time, op, path: p, result, detail });
  }
  return events;
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let i = 0;
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

function isSystemPath(p: string): boolean {
  const lower = p.toLowerCase();
  if (lower.includes('\\windows\\')) return true;
  if (lower.includes('\\system32\\')) return true;
  if (lower.includes('\\syswow64\\')) return true;
  if (lower.includes('\\winsxs\\')) return true;
  if (lower.includes('\\drivers\\')) return true;
  if (lower.includes('\\globalroot\\')) return true;
  if (lower.includes('\\namedpipe\\')) return true;
  if (lower.includes('\\registry\\')) return true;
  if (lower.includes('microsoft.net') && lower.includes('\\system')) return true;
  return false;
}

function isDevicePath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.includes('\\usb#') || lower.includes('\\hid#') ||
         lower.includes('usbpcap') || lower.includes('\\?\\usb') ||
         lower.includes('\\midi') || lower.includes('hkmidi') ||
         lower.includes('mmeapi') || lower.includes('\\fractal');
}

const events = parseCsv(csvPath);
console.log(`\n=== ${csvPath} ===`);
console.log(`AM4-Edit events: ${events.length}`);

// Op histogram
const opHist = new Map<string, number>();
for (const e of events) opHist.set(e.op, (opHist.get(e.op) ?? 0) + 1);
console.log('\nOps by count:');
for (const [op, n] of [...opHist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(6)}  ${op}`);
}

// Distinct non-system file paths
const pathInfo = new Map<string, { ops: Set<string>; results: Set<string>; count: number }>();
for (const e of events) {
  if (e.op !== 'CreateFile' && e.op !== 'ReadFile' && e.op !== 'CreateFileMapping') continue;
  if (!e.path) continue;
  if (isSystemPath(e.path)) continue;
  if (!pathInfo.has(e.path)) pathInfo.set(e.path, { ops: new Set(), results: new Set(), count: 0 });
  const info = pathInfo.get(e.path)!;
  info.ops.add(e.op);
  info.results.add(e.result);
  info.count++;
}

console.log(`\nNon-system file paths AM4-Edit opens: ${pathInfo.size}`);
const sortedPaths = [...pathInfo.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [p, info] of sortedPaths) {
  console.log(`  ${info.count.toString().padStart(6)}  ${[...info.ops].join('+')}  [${[...info.results].join(',')}]  ${p}`);
}

// Device paths (USB / HID / MIDI / Fractal)
const devicePaths = new Map<string, { ops: Set<string>; count: number }>();
for (const e of events) {
  if (!e.path) continue;
  if (!isDevicePath(e.path)) continue;
  if (!devicePaths.has(e.path)) devicePaths.set(e.path, { ops: new Set(), count: 0 });
  const info = devicePaths.get(e.path)!;
  info.ops.add(e.op);
  info.count++;
}
console.log(`\nUSB/HID/MIDI/Fractal device paths: ${devicePaths.size}`);
for (const [p, info] of [...devicePaths.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${info.count.toString().padStart(6)}  ${[...info.ops].join('+')}  ${p}`);
}

// Operations on AM4-Edit's own AppData cache file
const cachePath = 'C:\\Users\\Steph\\AppData\\Roaming\\Fractal Audio\\AM4-Edit\\effectDefinitions_15_2p0.cache';
const cacheEvents = events.filter(e => e.path && e.path.toLowerCase().includes('effectdefinitions'));
console.log(`\nEvents on effectDefinitions cache: ${cacheEvents.length}`);
for (const e of cacheEvents.slice(0, 30)) {
  console.log(`  ${e.time}  ${e.op}  [${e.result}]  ${e.detail.slice(0, 80)}`);
}
