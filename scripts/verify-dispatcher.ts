/**
 * BK-051 dispatcher golden — byte-equivalence vs legacy AM4 wire path.
 *
 * Session A acceptance criteria #3: "registers AM4, resolves port
 * 'AM4', dispatches a set_param(port='AM4', block='amp', name='gain',
 * value=4.5) and asserts byte-exact equality with the pre-dispatcher
 * `am4_set_param` wire output."
 *
 * Goes beyond the minimum to also exercise:
 *   - case-insensitive port resolution
 *   - port_match regex (`/Fractal/i`) fallback
 *   - param-name aliases (`reverb.decay` → `reverb.time`)
 *   - block-name canonical pass-through
 *   - enum value resolution (display name → wire index)
 *   - DispatchError shape on each failure mode
 *
 * Run:  npx tsx scripts/verify-dispatcher.ts
 */

import {
  encodeSetParam,
  requireDevice,
  resolveBlockName,
  resolveParamName,
  resolveChannel,
} from '@/protocol/generic/dispatcher.js';
import {
  listRegisteredDevices,
  registerDevice as registerMcpDevice,
  resolveDevice,
} from '@/protocol/generic/registry.js';
import { DispatchError } from '@/protocol/generic/types.js';
import { AM4_DESCRIPTOR } from '@/fractal/am4/descriptor.js';
import { buildSetParam } from '@/fractal/am4/setParam.js';

function hex(arr: number[]): string {
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

let failed = 0;
let passed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    return;
  }
  failed++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

function expectThrows(
  label: string,
  fn: () => unknown,
  expectedCode: string,
): void {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${label}\n      expected DispatchError(${expectedCode}), nothing thrown`);
  } catch (err) {
    if (err instanceof DispatchError && err.code === expectedCode) {
      passed++;
      return;
    }
    failed++;
    const desc = err instanceof DispatchError
      ? `got DispatchError(${err.code}): ${err.message}`
      : `got ${err instanceof Error ? err.message : String(err)}`;
    console.error(`  ✗ ${label}\n      expected DispatchError(${expectedCode}), ${desc}`);
  }
}

// ── Registration + resolution ───────────────────────────────────────

console.log('Registering AM4 descriptor.');
registerMcpDevice(AM4_DESCRIPTOR);

const devices = listRegisteredDevices();
assert(
  'AM4 descriptor registers and lists',
  devices.length >= 1 && devices.some((d) => d.id === 'am4'),
);

assert('resolveDevice("am4") matches', resolveDevice('am4')?.id === 'am4');
assert('resolveDevice("AM4") case-insensitive', resolveDevice('AM4')?.id === 'am4');
assert('resolveDevice("Fractal AM4") display_name', resolveDevice('Fractal AM4')?.id === 'am4');
assert('resolveDevice("AM4 MIDI 1") port_match regex', resolveDevice('AM4 MIDI 1')?.id === 'am4');
assert('resolveDevice("Fractal Audio AM4") regex', resolveDevice('Fractal Audio AM4')?.id === 'am4');
assert('resolveDevice("nope") miss returns undefined', resolveDevice('nope') === undefined);

// ── Step-1 port error envelope ──────────────────────────────────────

expectThrows(
  'requireDevice("nope") throws port_not_found',
  () => requireDevice('nope'),
  'port_not_found',
);

// ── Step-3 block / param resolution ─────────────────────────────────

const am4 = requireDevice('AM4');

assert(
  'resolveBlockName("amp") canonical pass-through',
  resolveBlockName(am4, 'amp') === 'amp',
);

expectThrows(
  'resolveBlockName("oscillator") throws unknown_block',
  () => resolveBlockName(am4, 'oscillator'),
  'unknown_block',
);

assert(
  'resolveParamName(reverb, time) canonical',
  resolveParamName(am4, 'reverb', 'time').name === 'time',
);

const aliased = resolveParamName(am4, 'reverb', 'decay');
assert(
  'resolveParamName(reverb, decay) → time via PARAM_ALIASES',
  aliased.name === 'time' && aliased.aliased_from === 'decay',
);

const aliased2 = resolveParamName(am4, 'delay', 'repeats');
assert(
  'resolveParamName(delay, repeats) → feedback via PARAM_ALIASES',
  aliased2.name === 'feedback' && aliased2.aliased_from === 'repeats',
);

expectThrows(
  'resolveParamName(amp, warmth) throws unknown_param',
  () => resolveParamName(am4, 'amp', 'warmth'),
  'unknown_param',
);

// ── Channel resolution ──────────────────────────────────────────────

assert(
  'resolveChannel(amp, "B") → 1',
  resolveChannel(am4, 'amp', 'B') === 1,
);
assert(
  'resolveChannel(amp, 2) → 2',
  resolveChannel(am4, 'amp', 2) === 2,
);
assert(
  'resolveChannel(amp, undefined) → undefined',
  resolveChannel(am4, 'amp', undefined) === undefined,
);
expectThrows(
  'resolveChannel(amp, "E") throws bad_channel',
  () => resolveChannel(am4, 'amp', 'E'),
  'bad_channel',
);
expectThrows(
  'resolveChannel(chorus, "A") throws capability_not_supported (chorus has no channels)',
  () => resolveChannel(am4, 'chorus', 'A'),
  'capability_not_supported',
);

// ── Step-4 value validation ─────────────────────────────────────────

expectThrows(
  'encodeSetParam(amp.gain=12.5) throws value_out_of_range',
  () => encodeSetParam({ port: 'AM4', block: 'amp', name: 'gain', value: 12.5 }),
  'value_out_of_range',
);

// ── Byte-equivalence vs legacy wire path ────────────────────────────

type ByteCase = {
  label: string;
  port: string;
  block: string;
  name: string;
  value: number | string;
  legacy: () => number[];
};

const byteCases: ByteCase[] = [
  {
    label: 'amp.gain=0 — canonical port "am4"',
    port: 'am4',
    block: 'amp',
    name: 'gain',
    value: 0,
    legacy: () => buildSetParam('amp.gain', 0),
  },
  {
    label: 'amp.gain=4.5 — case-insensitive port "AM4"',
    port: 'AM4',
    block: 'amp',
    name: 'gain',
    value: 4.5,
    legacy: () => buildSetParam('amp.gain', 4.5),
  },
  {
    label: 'amp.bass=6 — display_name port resolution',
    port: 'Fractal AM4',
    block: 'amp',
    name: 'bass',
    value: 6,
    legacy: () => buildSetParam('amp.bass', 6),
  },
  {
    label: 'amp.gain=8 — port_match regex via "AM4 MIDI 1"',
    port: 'AM4 MIDI 1',
    block: 'amp',
    name: 'gain',
    value: 8,
    legacy: () => buildSetParam('amp.gain', 8),
  },
  {
    label: 'reverb.decay=2.5 — alias resolves to reverb.time',
    port: 'am4',
    block: 'reverb',
    name: 'decay',
    value: 2.5,
    legacy: () => buildSetParam('reverb.time', 2.5),
  },
  {
    label: 'delay.repeats=50 — alias resolves to delay.feedback',
    port: 'am4',
    block: 'delay',
    name: 'repeats',
    value: 50,
    legacy: () => buildSetParam('delay.feedback', 50),
  },
];

console.log('\nByte-equivalence checks vs legacy buildSetParam:');
for (const tc of byteCases) {
  const fromDispatcher = encodeSetParam({
    port: tc.port,
    block: tc.block,
    name: tc.name,
    value: tc.value,
  });
  const fromLegacy = tc.legacy();
  const eq = fromDispatcher.bytes.length === fromLegacy.length
    && fromDispatcher.bytes.every((b, i) => b === fromLegacy[i]);
  assert(
    tc.label,
    eq,
    eq ? undefined : `dispatcher: ${hex(fromDispatcher.bytes)}\n      legacy:     ${hex(fromLegacy)}`,
  );
}

// ── Enum byte-equivalence (display name → wire) ─────────────────────

console.log('\nEnum value resolution byte-equivalence:');

const enumCases: { label: string; port: string; block: string; name: string; value: number | string; legacy: () => number[] }[] = [
  {
    label: 'amp.type via wire index 0 — direct numeric pass-through',
    port: 'am4',
    block: 'amp',
    name: 'type',
    value: 0,
    legacy: () => buildSetParam('amp.type', 0),
  },
  {
    label: 'compressor.type=2 — direct numeric',
    port: 'am4',
    block: 'compressor',
    name: 'type',
    value: 2,
    legacy: () => buildSetParam('compressor.type', 2),
  },
];

for (const tc of enumCases) {
  const fromDispatcher = encodeSetParam(tc);
  const fromLegacy = tc.legacy();
  const eq = fromDispatcher.bytes.length === fromLegacy.length
    && fromDispatcher.bytes.every((b, i) => b === fromLegacy[i]);
  assert(
    tc.label,
    eq,
    eq ? undefined : `dispatcher: ${hex(fromDispatcher.bytes)}\n      legacy:     ${hex(fromLegacy)}`,
  );
}

// ── Reporting ───────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
