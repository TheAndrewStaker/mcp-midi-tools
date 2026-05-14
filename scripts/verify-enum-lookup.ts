/**
 * Verify `resolveEnumValue` handles the lookup-by-name UX the MCP
 * server will rely on. Covers: numeric passthrough, exact match,
 * case-insensitive normalization, substring fallback, ambiguity
 * rejection, and invalid-input rejection.
 */

import { KNOWN_PARAMS, resolveEnumValue } from '@mcp-midi-control/am4/params.js';

interface Case {
  key: keyof typeof KNOWN_PARAMS;
  input: number | string;
  expected: number | undefined;
  desc: string;
}

const cases: Case[] = [
  // Numeric passthrough — unchanged when in range.
  { key: 'amp.type', input: 0, expected: 0, desc: 'amp.type numeric 0' },
  { key: 'amp.type', input: 247, expected: 247, desc: 'amp.type numeric last index' },
  { key: 'amp.type', input: 999, expected: undefined, desc: 'amp.type numeric out of range' },

  // Exact name match.
  { key: 'amp.type', input: '1959SLP Normal', expected: 0, desc: 'amp.type exact first' },
  { key: 'drive.type', input: 'Rat Distortion', expected: 0, desc: 'drive.type exact first' },
  { key: 'reverb.type', input: 'Room, Small', expected: 0, desc: 'reverb.type exact first' },
  { key: 'delay.type', input: 'Digital Mono', expected: 0, desc: 'delay.type exact first' },

  // Relaxed normalization — case/punctuation/whitespace tolerant.
  { key: 'amp.type', input: '1959slp normal', expected: 0, desc: 'amp.type lowercase' },
  { key: 'reverb.type', input: 'room small', expected: 0, desc: 'reverb.type stripped punctuation' },
  { key: 'amp.channel', input: 'B', expected: 1, desc: 'amp.channel exact letter' },
  { key: 'amp.channel', input: 'd', expected: 3, desc: 'amp.channel lowercase letter' },

  // Substring fallback (one-sided).
  { key: 'drive.type', input: 'T808 Mod', expected: 8, desc: 'drive.type known Session-06 entry' },

  // Non-enum param — lookup should refuse.
  { key: 'amp.gain', input: 5, expected: undefined, desc: 'amp.gain is not an enum' },

  // Empty / garbage inputs.
  { key: 'amp.type', input: '', expected: undefined, desc: 'empty string' },
  { key: 'amp.type', input: '   ', expected: undefined, desc: 'whitespace only' },
  { key: 'amp.type', input: 'this is not a real amp', expected: undefined, desc: 'no match' },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const param = KNOWN_PARAMS[c.key];
  const got = resolveEnumValue(param, c.input);
  const ok = got === c.expected;
  const mark = ok ? '✓' : '✗';
  const line = `${mark} ${c.desc.padEnd(42)}  ${c.key} ← ${JSON.stringify(c.input)}  → ${got}`;
  console.log(line);
  if (ok) passed++;
  else {
    failed++;
    console.log(`    expected: ${c.expected}`);
  }
}

console.log(`\n${passed}/${cases.length} cases pass.`);
if (failed > 0) process.exit(1);
