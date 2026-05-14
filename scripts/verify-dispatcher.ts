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
  describeDevice,
  encodeSetParam,
  listParams,
  requireDevice,
  resolveBlockName,
  resolveParamName,
  resolveChannel,
} from '@mcp-midi-control/core/protocol-generic/dispatcher.js';
import {
  listRegisteredDevices,
  registerDevice as registerMcpDevice,
  resolveDevice,
} from '@mcp-midi-control/core/protocol-generic/registry.js';
import { DispatchError } from '@mcp-midi-control/core/protocol-generic/types.js';
import { AM4_DESCRIPTOR } from '@mcp-midi-control/am4/descriptor.js';
import { buildSetParam } from '@mcp-midi-control/am4/setParam.js';
import { prepareApplyPresetWrites } from '@mcp-midi-control/am4/tools/applyExecutor.js';
import { AXEFX2_DESCRIPTOR } from '@mcp-midi-control/axe-fx-ii/descriptor.js';
import {
  buildSetBlockParameterValue,
  buildStorePreset,
  buildSwitchPreset,
  displayToWire,
} from '@mcp-midi-control/axe-fx-ii/setParam.js';

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
//
// Order matters: Axe-Fx II registers BEFORE AM4 so the more-specific
// `/axe-?fx/i` regex fires first on port names like "Fractal Axe-Fx II
// Port 1". AM4's `/Fractal/i` regex remains as catch-all. Matches the
// production registration order in `src/server/index.ts`.

console.log('Registering Axe-Fx II descriptor.');
registerMcpDevice(AXEFX2_DESCRIPTOR);

console.log('Registering AM4 descriptor.');
registerMcpDevice(AM4_DESCRIPTOR);

const devices = listRegisteredDevices();
assert(
  'AM4 descriptor registers and lists',
  devices.length >= 2 && devices.some((d) => d.id === 'am4'),
);
assert(
  'Axe-Fx II descriptor registers and lists',
  devices.some((d) => d.id === 'axe-fx-ii'),
);

assert('resolveDevice("am4") matches', resolveDevice('am4')?.id === 'am4');
assert('resolveDevice("AM4") case-insensitive', resolveDevice('AM4')?.id === 'am4');
assert('resolveDevice("Fractal AM4") display_name', resolveDevice('Fractal AM4')?.id === 'am4');
assert('resolveDevice("AM4 MIDI 1") port_match regex', resolveDevice('AM4 MIDI 1')?.id === 'am4');
assert('resolveDevice("Fractal Audio AM4") regex', resolveDevice('Fractal Audio AM4')?.id === 'am4');
assert('resolveDevice("nope") miss returns undefined', resolveDevice('nope') === undefined);

// Axe-Fx II port resolution — confirm the more-specific regex wins
// against ambiguous "Fractal X" port names.
assert(
  'resolveDevice("axe-fx-ii") canonical id',
  resolveDevice('axe-fx-ii')?.id === 'axe-fx-ii',
);
assert(
  'resolveDevice("Fractal Axe-Fx II XL+") display_name',
  resolveDevice('Fractal Axe-Fx II XL+')?.id === 'axe-fx-ii',
);
assert(
  'resolveDevice("Axe-Fx II Port 1") matches /axe-?fx/i',
  resolveDevice('Axe-Fx II Port 1')?.id === 'axe-fx-ii',
);
assert(
  'resolveDevice("AxeFx") matches /axe-?fx/i (no-dash form)',
  resolveDevice('AxeFx')?.id === 'axe-fx-ii',
);
assert(
  'resolveDevice("Fractal Axe-Fx II Port 1") prefers Axe-Fx II over AM4 /Fractal/i fallback',
  resolveDevice('Fractal Axe-Fx II Port 1')?.id === 'axe-fx-ii',
);

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

// ── describe_device pure introspection ──────────────────────────────

console.log('\ndescribe_device introspection:');

const desc = describeDevice('AM4');
assert('describe_device returns Fractal AM4', desc.device === 'Fractal AM4');
assert('describe_device id is am4', desc.id === 'am4');
assert(
  'describe_device.capabilities.slot_model = linear',
  desc.capabilities.slot_model === 'linear',
);
assert(
  'describe_device.capabilities.scene_count = 4',
  desc.capabilities.scene_count === 4,
);
assert(
  'describe_device.capabilities.channel_names = A/B/C/D',
  desc.capabilities.channel_names?.join('/') === 'A/B/C/D',
);
assert(
  'describe_device.blocks includes amp, drive, reverb, delay',
  ['amp', 'drive', 'reverb', 'delay'].every((b) => desc.blocks.includes(b)),
);
assert(
  'describe_device.canonical_terms.channel mentions A/B/C/D',
  desc.canonical_terms.channel.includes('A/B/C/D'),
);

// ── list_params pure introspection ──────────────────────────────────

console.log('\nlist_params introspection:');

const allParams = listParams({ port: 'AM4' });
assert(
  'list_params(port) returns multiple entries',
  allParams.params.length > 50,
  `got ${allParams.params.length} entries`,
);

const ampOnly = listParams({ port: 'AM4', block: 'amp' });
assert(
  'list_params(port, block=amp) scopes to amp block',
  ampOnly.params.every((p) => p.block === 'amp') && ampOnly.params.length > 5,
);

const reverbTime = listParams({ port: 'AM4', block: 'reverb', name: 'time' });
assert(
  'list_params(reverb, time) returns single entry',
  reverbTime.params.length === 1 && reverbTime.params[0].name === 'time',
);

const reverbTimeEntry = reverbTime.params[0];
assert(
  'list_params unit passes AM4-native name through (open item #4)',
  reverbTimeEntry.unit === 'seconds',
  `got unit=${reverbTimeEntry.unit}`,
);
assert(
  'list_params reverb.time advertises aliases (decay, length)',
  reverbTimeEntry.has_aliases !== undefined
    && reverbTimeEntry.has_aliases.includes('decay')
    && reverbTimeEntry.has_aliases.includes('length'),
  `got aliases=${reverbTimeEntry.has_aliases?.join('/')}`,
);

const ampType = listParams({ port: 'AM4', block: 'amp', name: 'type' });
assert(
  'list_params(amp, type) enum includes full enum_values table',
  ampType.params[0].enum_values !== undefined
    && Object.keys(ampType.params[0].enum_values).length > 10,
);

// Confirm a knob_0_10 param surfaces its native unit name now (was
// previously collapsing to "knob" before open item #4 fix).
const ampGain = listParams({ port: 'AM4', block: 'amp', name: 'gain' });
assert(
  'list_params(amp, gain) unit is knob_0_10 (native AM4 name preserved)',
  ampGain.params[0].unit === 'knob_0_10',
  `got unit=${ampGain.params[0].unit}`,
);

// ── BK-051 Session B-cont — apply_preset PresetSpec validation ─────
//
// Pure-path coverage for the unified `apply_preset` tool: PresetSpec
// translation onto AM4 ApplyPresetInput goes through prepareApplyPresetWrites,
// which surfaces validation errors before any MIDI. We exercise the same
// failure shapes the legacy `am4_apply_preset` smoke covers.

console.log('\nPresetSpec validation (via prepareApplyPresetWrites):');

function expectApplyError(label: string, spec: unknown, fragment: string): void {
  try {
    prepareApplyPresetWrites(spec as Parameters<typeof prepareApplyPresetWrites>[0]);
    failed++;
    console.error(`  ✗ ${label}\n      expected error, got success`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(fragment)) {
      passed++;
    } else {
      failed++;
      console.error(`  ✗ ${label}\n      expected error to include "${fragment}", got: ${msg}`);
    }
  }
}

expectApplyError(
  'duplicate slot position',
  { slots: [
    { position: 1, block_type: 'amp' },
    { position: 1, block_type: 'drive' },
  ] },
  'used twice',
);

expectApplyError(
  'unknown block_type',
  { slots: [{ position: 1, block_type: 'not_a_real_block' }] },
  'unknown block_type',
);

expectApplyError(
  'channels on a block without channels',
  { slots: [{ position: 1, block_type: 'compressor', channels: { A: { ratio: 4 } } }] },
  "doesn't have channels",
);

expectApplyError(
  'duplicate scene index',
  {
    slots: [{ position: 1, block_type: 'amp' }],
    scenes: [
      { index: 1, channels: { amp: 'A' } },
      { index: 1, channels: { amp: 'B' } },
    ],
  },
  'used twice',
);

// Note: name validation runs through buildSetPresetName which throws on
// overlong/non-ASCII names. 32-char name is the boundary.
expectApplyError(
  'overlong preset name (33 chars)',
  { slots: [{ position: 1, block_type: 'amp' }], name: 'x'.repeat(33) },
  'name',
);

// ── BK-051 Wave 2 — Axe-Fx II descriptor byte-equivalence ──────────
//
// Mirror the AM4 byte-equivalence checks against the Axe-Fx II
// descriptor: assert the dispatcher's `encodeSetParam` path produces
// the same wire bytes as direct calls to legacy `buildSetBlockParam
// eterValue` / `buildSwitchPreset` / `buildStorePreset`. Covers linear
// calibration, log10 calibration, enum string→index, and the
// MSB-first preset-number byte order for STORE.

console.log('\nAxe-Fx II byte-equivalence checks:');

type AxeFxByteCase = {
  label: string;
  port: string;
  block: string;
  name: string;
  value: number | string;
  legacy: () => number[];
};

const axefx2Cases: AxeFxByteCase[] = [
  {
    label: 'amp.bass=6.0 (linear knob 0..10) — display→wire via descriptor matches legacy displayToWire',
    port: 'axe-fx-ii',
    block: 'amp',
    name: 'bass',
    value: 6.0,
    legacy: () => buildSetBlockParameterValue(
      { effectId: 106, paramId: 2 },
      displayToWire(6.0, { displayMin: 0, displayMax: 10 }),
    ),
  },
  {
    label: 'amp.input_drive=4.5 — case-insensitive port "AxeFx"',
    port: 'AxeFx',
    block: 'amp',
    name: 'input_drive',
    value: 4.5,
    legacy: () => buildSetBlockParameterValue(
      { effectId: 106, paramId: 1 },
      displayToWire(4.5, { displayMin: 0, displayMax: 10 }),
    ),
  },
  {
    label: 'reverb.mix=30 (percent 0..100) — display→wire linear',
    port: 'axe-fx-ii',
    block: 'reverb',
    name: 'mix',
    value: 30,
    legacy: () => buildSetBlockParameterValue(
      { effectId: 110, paramId: 13 },
      displayToWire(30, { displayMin: 0, displayMax: 100 }),
    ),
  },
  {
    label: 'amp.preamp_low_cut=100 Hz — log10 scale',
    port: 'axe-fx-ii',
    block: 'amp',
    name: 'preamp_low_cut',
    value: 100,
    legacy: () => buildSetBlockParameterValue(
      { effectId: 106, paramId: 6 },
      displayToWire(100, { displayMin: 10, displayMax: 1000, displayScale: 'log10' }),
    ),
  },
  {
    label: 'amp.balance=-50 (bipolar -100..+100) — display→wire linear',
    port: 'axe-fx-ii',
    block: 'amp',
    name: 'balance',
    value: -50,
    legacy: () => buildSetBlockParameterValue(
      { effectId: 106, paramId: 22 },
      displayToWire(-50, { displayMin: -100, displayMax: 100 }),
    ),
  },
  {
    label: 'amp.tone_stack — exact enum string→wire index',
    port: 'axe-fx-ii',
    block: 'amp',
    name: 'tone_stack',
    // Use the first label verbatim from AMP_TONE_STACK_VALUES so the
    // resolver hits the exact-match path. The dispatcher and the legacy
    // path arrive at the same wire integer through the same enum table.
    value: Object.values(AXEFX2_DESCRIPTOR.blocks.amp.params.tone_stack.enum_values ?? {})[0],
    legacy: () => buildSetBlockParameterValue(
      { effectId: 106, paramId: 34 },
      AXEFX2_DESCRIPTOR.blocks.amp.params.tone_stack.encode(
        Object.values(AXEFX2_DESCRIPTOR.blocks.amp.params.tone_stack.enum_values ?? {})[0],
      ),
    ),
  },
];

for (const tc of axefx2Cases) {
  let dispatcherBytes: number[] | undefined;
  let legacyBytes: number[] | undefined;
  try {
    const fromDispatcher = encodeSetParam({
      port: tc.port,
      block: tc.block,
      name: tc.name,
      value: tc.value,
    });
    dispatcherBytes = fromDispatcher.bytes;
    legacyBytes = tc.legacy();
    const eq = dispatcherBytes.length === legacyBytes.length
      && dispatcherBytes.every((b, i) => b === legacyBytes![i]);
    assert(
      tc.label,
      eq,
      eq ? undefined : `dispatcher: ${hex(dispatcherBytes)}\n      legacy:     ${hex(legacyBytes)}`,
    );
  } catch (err) {
    failed++;
    console.error(`  ✗ ${tc.label}\n      threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Range / enum error envelopes for Axe-Fx II.
expectThrows(
  'encodeSetParam(amp.bass=15) throws value_out_of_range',
  () => encodeSetParam({ port: 'axe-fx-ii', block: 'amp', name: 'bass', value: 15 }),
  'value_out_of_range',
);

expectThrows(
  'encodeSetParam(amp.tone_stack="ZZZ") throws unknown_enum_value',
  () => encodeSetParam({ port: 'axe-fx-ii', block: 'amp', name: 'tone_stack', value: 'ZZZ' }),
  'unknown_enum_value',
);

// switchPreset + savePreset byte-equivalence — assert the pure
// builders produce the same envelope as the legacy buildSwitchPreset /
// buildStorePreset.
console.log('\nAxe-Fx II preset-navigation byte-equivalence:');

{
  // Descriptor now takes 1-indexed display slot — slot 700 → wire 699.
  const fromDescriptor = AXEFX2_DESCRIPTOR.writer.buildSwitchPreset!(700);
  const fromLegacy = buildSwitchPreset(699);
  const eq = fromDescriptor.length === fromLegacy.length
    && fromDescriptor.every((b, i) => b === fromLegacy[i]);
  assert(
    'buildSwitchPreset(slot 700) — descriptor wire=699 matches legacy buildSwitchPreset(699)',
    eq,
    eq ? undefined : `dispatcher: ${hex(fromDescriptor)}\n      legacy:     ${hex(fromLegacy)}`,
  );
}
{
  // Descriptor: slot 700 (display) → wire 699 → MSB-first STORE bytes.
  const fromDescriptor = AXEFX2_DESCRIPTOR.writer.buildSavePreset!(700);
  const fromLegacy = buildStorePreset(699);
  const eq = fromDescriptor.length === fromLegacy.length
    && fromDescriptor.every((b, i) => b === fromLegacy[i]);
  assert(
    'buildSavePreset(slot 700) — descriptor wire=699 matches legacy (MSB-first byte order)',
    eq,
    eq ? undefined : `dispatcher: ${hex(fromDescriptor)}\n      legacy:     ${hex(fromLegacy)}`,
  );
}
{
  // bspaulding/axe-fx-midi golden (Mark II, wire preset 217 = display
  // slot 218) — same shape as our XL+ encoder with MSB-first ordering.
  const fromDescriptor = AXEFX2_DESCRIPTOR.writer.buildSavePreset!(218);
  const fromLegacy = buildStorePreset(217);
  const eq = fromDescriptor.length === fromLegacy.length
    && fromDescriptor.every((b, i) => b === fromLegacy[i]);
  assert(
    'buildSavePreset(slot 218) — descriptor wire=217 matches legacy (bspaulding cross-check)',
    eq,
    eq ? undefined : `dispatcher: ${hex(fromDescriptor)}\n      legacy:     ${hex(fromLegacy)}`,
  );
}
// Boundary checks for the new 1-indexed slot semantics.
{
  let threw = false;
  let msg = '';
  try { AXEFX2_DESCRIPTOR.writer.buildSwitchPreset!(0); }
  catch (err) { threw = true; msg = err instanceof Error ? err.message : String(err); }
  assert(
    'buildSwitchPreset(slot 0) rejected — slot is 1-indexed',
    threw,
    threw ? undefined : 'expected error, got success',
  );
}
{
  let threw = false;
  try { AXEFX2_DESCRIPTOR.writer.buildSwitchPreset!(16385); }
  catch { threw = true; }
  assert(
    'buildSwitchPreset(slot 16385) rejected — out of range',
    threw,
  );
}

// describeDevice on Axe-Fx II surfaces the grid slot model.
console.log('\nAxe-Fx II describe_device introspection:');

const axefxDesc = describeDevice('axe-fx-ii');
assert(
  'describe_device(axe-fx-ii).slot_model = grid',
  axefxDesc.capabilities.slot_model === 'grid',
);
assert(
  'describe_device(axe-fx-ii).scene_count = 8',
  axefxDesc.capabilities.scene_count === 8,
);
assert(
  'describe_device(axe-fx-ii).channel_names = X/Y',
  axefxDesc.capabilities.channel_names?.join('/') === 'X/Y',
);
assert(
  'describe_device(axe-fx-ii).supports_save = true',
  axefxDesc.capabilities.supports_save === true,
);
assert(
  'describe_device(axe-fx-ii).supports_factory_restore = false',
  axefxDesc.capabilities.supports_factory_restore === false,
);
assert(
  'describe_device(axe-fx-ii).blocks includes amp, reverb, delay, drive',
  ['amp', 'reverb', 'delay', 'drive'].every((b) => axefxDesc.blocks.includes(b)),
);

// list_params on Axe-Fx II surfaces unit metadata for calibrated knobs.
const axefxBass = listParams({ port: 'axe-fx-ii', block: 'amp', name: 'bass' });
assert(
  'list_params(axe-fx-ii, amp, bass) reports knob unit + display range 0..10',
  axefxBass.params.length === 1
    && axefxBass.params[0].unit === 'knob'
    && axefxBass.params[0].display_min === 0
    && axefxBass.params[0].display_max === 10,
  `got ${JSON.stringify(axefxBass.params[0])}`,
);
const axefxLowCut = listParams({ port: 'axe-fx-ii', block: 'amp', name: 'preamp_low_cut' });
assert(
  'list_params(axe-fx-ii, amp, preamp_low_cut) reports hz unit (log10 scale)',
  axefxLowCut.params.length === 1 && axefxLowCut.params[0].unit === 'hz',
  `got unit=${axefxLowCut.params[0]?.unit}`,
);

// ── Hydrasynth descriptor (BK-031) ──────────────────────────────────
//
// Registers via the descriptor at server boot. Verify the basic shape:
// device resolves, has the right capabilities, modules appear as
// "blocks" in describe_device.
console.log('\nHydrasynth descriptor introspection:');

// Register the Hydrasynth descriptor explicitly here — verify-dispatcher
// is a stand-alone script that doesn't go through server/index.ts boot.
const { HYDRASYNTH_DESCRIPTOR } = await import('@mcp-midi-control/hydrasynth-explorer/descriptor.js');
registerMcpDevice(HYDRASYNTH_DESCRIPTOR);

const hydraDesc = describeDevice('hydrasynth');
assert(
  'describe_device(hydrasynth).slot_model = linear',
  hydraDesc.capabilities.slot_model === 'linear',
);
assert(
  'describe_device(hydrasynth).has_scenes = false (synth, no scenes)',
  hydraDesc.capabilities.has_scenes === false,
);
assert(
  'describe_device(hydrasynth).has_channels = false',
  hydraDesc.capabilities.has_channels === false,
);
assert(
  'describe_device(hydrasynth).has_macros = true',
  hydraDesc.capabilities.has_macros === true,
);
assert(
  'describe_device(hydrasynth).slot_count = 1024 (8 banks × 128)',
  hydraDesc.capabilities.slot_count === 1024,
);
assert(
  'describe_device(hydrasynth).blocks includes osc1/filter1/lfo1/macros',
  ['osc1', 'filter1', 'lfo1', 'macros'].every((b) => hydraDesc.blocks.includes(b)),
  `got blocks=[${hydraDesc.blocks.slice(0, 15).join(', ')}...]`,
);

// Hydrasynth pure-builder byte-equivalence — switch_preset for "A001"
// emits Bank MSB=0 + Bank LSB=0 + PC=0 (8 bytes total).
{
  const bytes = HYDRASYNTH_DESCRIPTOR.writer.buildSwitchPreset!('A001');
  const expected = [0xB0, 0x00, 0x00, 0xB0, 0x20, 0x00, 0xC0, 0x00];
  const eq = bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
  assert(
    'buildSwitchPreset("A001") emits Bank MSB+LSB+PC for bank 0 patch 0',
    eq,
    eq ? undefined : `dispatcher: ${hex(bytes)}\n      expected:    ${hex(expected)}`,
  );
}
{
  // Bank H, patch 128 → bank 7, patch 127. Bank MSB stays 0; LSB=7; PC=0x7F.
  const bytes = HYDRASYNTH_DESCRIPTOR.writer.buildSwitchPreset!('H128');
  const expected = [0xB0, 0x00, 0x00, 0xB0, 0x20, 0x07, 0xC0, 0x7F];
  const eq = bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
  assert(
    'buildSwitchPreset("H128") emits last-bank last-patch navigation',
    eq,
    eq ? undefined : `dispatcher: ${hex(bytes)}\n      expected:    ${hex(expected)}`,
  );
}
// Reject malformed location strings.
{
  let threw = false;
  try { HYDRASYNTH_DESCRIPTOR.writer.buildSwitchPreset!('I001'); }
  catch { threw = true; }
  assert('buildSwitchPreset("I001") rejected (bank out of A..H range)', threw);
}

// Reporting ───────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
