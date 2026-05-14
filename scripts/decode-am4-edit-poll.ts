/**
 * Decode AM4-Edit's polling pattern from a passive .syx capture.
 *
 * The capture is inbound-only (host receives from device). AM4-Edit
 * polls the AM4 continuously and the responses tell us what queries
 * the editor uses to detect front-panel edits. If we identify a
 * response that varies based on the working buffer's edit state, we
 * can use the same query as a "poll-before-switch" dirty check.
 *
 * Splits the .syx file into individual envelopes (F0…F7), groups by
 * function byte, and reports:
 *   - Total envelope count
 *   - Distribution by function byte (byte[5])
 *   - For the most common function, distribution by action byte (byte[6])
 *   - First 3 envelopes of each (function, action) pair so the
 *     payload shape is visible
 *
 * Usage:
 *   npx tsx scripts/decode-am4-edit-poll.ts <capture.syx>
 */
import fs from 'fs';
import path from 'path';

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;

interface Envelope {
  bytes: number[];
  funcByte: number;
  actionByte: number;
  payloadLen: number;
}

function splitEnvelopes(buf: Buffer): Envelope[] {
  const envelopes: Envelope[] = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== SYSEX_START) { i++; continue; }
    const start = i;
    let end = i + 1;
    while (end < buf.length && buf[end] !== SYSEX_END) end++;
    if (end >= buf.length) break;
    const bytes = Array.from(buf.subarray(start, end + 1));
    envelopes.push({
      bytes,
      funcByte: bytes[5] ?? 0,
      actionByte: bytes[6] ?? 0,
      payloadLen: bytes.length,
    });
    i = end + 1;
  }
  return envelopes;
}

function toHex(b: number): string { return b.toString(16).padStart(2, '0'); }
function toHexBytes(bytes: readonly number[], max: number = 24): string {
  const slice = bytes.slice(0, max);
  return slice.map(toHex).join(' ') + (bytes.length > max ? ` … (${bytes.length} total)` : '');
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: tsx scripts/decode-am4-edit-poll.ts <capture.syx>');
  process.exit(1);
}

const absPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
const buf = fs.readFileSync(absPath);
const envelopes = splitEnvelopes(buf);

console.log(`Capture: ${absPath}`);
console.log(`Size:    ${buf.length} bytes`);
console.log(`SysEx envelopes: ${envelopes.length}`);
console.log('');

// Group by (funcByte, actionByte)
const groups = new Map<string, Envelope[]>();
for (const env of envelopes) {
  const key = `${toHex(env.funcByte)}:${toHex(env.actionByte)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(env);
}

console.log('Distribution by (function:action):');
console.log('  count    func:action   typical-len  example-bytes');
const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [key, envs] of sortedGroups) {
  const lens = new Set(envs.map((e) => e.payloadLen));
  const lenSummary = lens.size === 1
    ? `${envs[0].payloadLen} bytes`
    : `${Math.min(...lens)}..${Math.max(...lens)} bytes`;
  console.log(`  ${String(envs.length).padStart(5)}    ${key}         ${lenSummary.padStart(14)}  ${toHexBytes(envs[0].bytes, 16)}`);
}
console.log('');

// For each group, show first 3 envelopes for visual comparison
console.log('Sample envelopes per (function:action):');
for (const [key, envs] of sortedGroups.slice(0, 6)) {
  console.log(`\n[${key}] — first ${Math.min(3, envs.length)} of ${envs.length}:`);
  for (let i = 0; i < Math.min(3, envs.length); i++) {
    console.log(`  ${i}: ${toHexBytes(envs[i].bytes, 32)}`);
  }
}

// Identify envelopes whose payload VARIES across samples (likely the
// fingerprint — edits change the payload). Stable-payload envelopes are
// metadata (preset name, location index, etc.).
console.log('\nPayload-variation analysis (which envelope class CHANGES across the capture?):');
for (const [key, envs] of sortedGroups.slice(0, 6)) {
  if (envs.length < 2) continue;
  const allSame = envs.every((e) => e.bytes.length === envs[0].bytes.length &&
    e.bytes.every((b, i) => b === envs[0].bytes[i]));
  const distinctPayloads = new Set(envs.map((e) => e.bytes.join(','))).size;
  console.log(`  [${key}]  ${allSame ? 'IDENTICAL across all samples' : `${distinctPayloads} distinct payloads / ${envs.length} captures`}`);
}
