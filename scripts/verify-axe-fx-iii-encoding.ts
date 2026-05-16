/**
 * Verify Axe-Fx III SysEx builders + parsers — byte-exact goldens
 * against the v1.4 PDF spec.
 *
 * No hardware required. The Axe-Fx III project ships without a
 * maintainer who owns the device, so this script is the project's
 * only protection against the builders drifting away from
 * `docs/manuals/AxeFx3-MIDI-3rdParty.txt`.
 *
 * Each expected hex string is computed by hand from the spec
 * envelope `F0 00 01 74 10 [fn] [payload...] [cs] F7` with checksum
 * `(XOR of every byte from F0 through last payload byte) & 0x7F`.
 *
 * Run:  npx tsx scripts/verify-axe-fx-iii-encoding.ts
 */

import {
  buildSetBypass,
  buildGetBypass,
  buildSetChannel,
  buildGetChannel,
  buildSetScene,
  buildGetScene,
  buildQueryPatchName,
  buildQuerySceneName,
  buildSetLooper,
  buildGetLooperState,
  buildTempoTap,
  buildSetTuner,
  buildSetTempo,
  buildGetTempo,
  buildStatusDump,
  isSetGetBypassResponse,
  isSetGetChannelResponse,
  isSetGetSceneResponse,
  isQueryPatchNameResponse,
  isQuerySceneNameResponse,
  isSetGetLooperResponse,
  isSetGetTempoResponse,
  isStatusDumpResponse,
  parseBypassResponse,
  parseChannelResponse,
  parseSceneResponse,
  parseQueryPatchNameResponse,
  parseQuerySceneNameResponse,
  parseLooperStateResponse,
  parseTempoResponse,
  parseStatusDumpResponse,
} from '@mcp-midi-control/axe-fx-iii/setParam.js';
import { resolveEffectId, AXE_FX_III_BLOCKS } from '@mcp-midi-control/axe-fx-iii/blockTypes.js';
import { fractalChecksum } from '@mcp-midi-control/core/fractal-shared/checksum.js';

function hex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function asBytes(s: string): number[] {
  if (s.length % 2 !== 0) throw new Error(`asBytes: odd length ${s.length}`);
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) {
    out.push(Number.parseInt(s.slice(i, i + 2), 16));
  }
  return out;
}

let failures = 0;
function check(label: string, built: readonly number[], expected: string): void {
  const got = hex(built);
  if (got === expected) {
    console.log(`  ✓ ${label}  (${built.length}B  ${got})`);
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`      built:    ${got}`);
    console.log(`      expected: ${expected}`);
    failures += 1;
  }
}

function checkEqual<T>(label: string, got: T, expected: T): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`      got:      ${a}`);
    console.log(`      expected: ${b}`);
    failures += 1;
  }
}

console.log('Axe-Fx III byte-exact goldens (v1.4 PDF spec)\n');

// ── 0x0A SET/GET BYPASS ─────────────────────────────────────────────
console.log('set_bypass / get_bypass (function 0x0A):');
// Compressor 1 = effect ID 46 = 0x2E. encode14(46) = [0x2E, 0x00].
check('buildSetBypass(46, false)', buildSetBypass(46, false),
  'f000017410' + '0a' + '2e0000' + '31' + 'f7');
check('buildSetBypass(46, true)', buildSetBypass(46, true),
  'f000017410' + '0a' + '2e0001' + '30' + 'f7');
check('buildGetBypass(46)', buildGetBypass(46),
  'f000017410' + '0a' + '2e007f' + '4e' + 'f7');
// Reverb 1 = effect ID 66 = 0x42.
check('buildSetBypass(66, false)', buildSetBypass(66, false),
  'f000017410' + '0a' + '420000' + '5d' + 'f7');

// ── 0x0B SET/GET CHANNEL ────────────────────────────────────────────
console.log('\nset_channel / get_channel (function 0x0B):');
check('buildSetChannel(46, 0)', buildSetChannel(46, 0),
  'f000017410' + '0b' + '2e0000' + '30' + 'f7');
check('buildSetChannel(46, 1)', buildSetChannel(46, 1),
  'f000017410' + '0b' + '2e0001' + '31' + 'f7');
check('buildSetChannel(46, 3)', buildSetChannel(46, 3),
  'f000017410' + '0b' + '2e0003' + '33' + 'f7');
check('buildGetChannel(46)', buildGetChannel(46),
  'f000017410' + '0b' + '2e007f' + '4f' + 'f7');

// ── 0x0C SET/GET SCENE ──────────────────────────────────────────────
console.log('\nset_scene / get_scene (function 0x0C):');
check('buildSetScene(0)', buildSetScene(0),
  'f000017410' + '0c' + '00' + '19' + 'f7');
check('buildSetScene(7)', buildSetScene(7),
  'f000017410' + '0c' + '07' + '1e' + 'f7');
check('buildGetScene()', buildGetScene(),
  'f000017410' + '0c' + '7f' + '66' + 'f7');

// ── 0x0D QUERY PATCH NAME ───────────────────────────────────────────
console.log('\nquery_patch_name (function 0x0D):');
check('buildQueryPatchName(0)', buildQueryPatchName(0),
  'f000017410' + '0d' + '0000' + '18' + 'f7');
check('buildQueryPatchName(1023)', buildQueryPatchName(1023),
  'f000017410' + '0d' + '7f07' + '60' + 'f7');
// Spec says current = "dd dd = 7F 7F" (TWO sentinel bytes).
check("buildQueryPatchName('current')", buildQueryPatchName('current'),
  'f000017410' + '0d' + '7f7f' + '18' + 'f7');

// ── 0x0E QUERY SCENE NAME ───────────────────────────────────────────
console.log('\nquery_scene_name (function 0x0E):');
check('buildQuerySceneName(0)', buildQuerySceneName(0),
  'f000017410' + '0e' + '00' + '1b' + 'f7');
check('buildQuerySceneName(7)', buildQuerySceneName(7),
  'f000017410' + '0e' + '07' + '1c' + 'f7');
check("buildQuerySceneName('current')", buildQuerySceneName('current'),
  'f000017410' + '0e' + '7f' + '64' + 'f7');

// ── 0x0F SET/GET LOOPER ─────────────────────────────────────────────
console.log('\nlooper (function 0x0F):');
check("buildSetLooper('record')", buildSetLooper('record'),
  'f000017410' + '0f' + '00' + '1a' + 'f7');
check("buildSetLooper('play')", buildSetLooper('play'),
  'f000017410' + '0f' + '01' + '1b' + 'f7');
check("buildSetLooper('half_speed')", buildSetLooper('half_speed'),
  'f000017410' + '0f' + '05' + '1f' + 'f7');
check('buildGetLooperState()', buildGetLooperState(),
  'f000017410' + '0f' + '7f' + '65' + 'f7');

// ── 0x10 TEMPO TAP ──────────────────────────────────────────────────
console.log('\ntempo_tap (function 0x10):');
check('buildTempoTap()', buildTempoTap(),
  'f000017410' + '10' + '05' + 'f7');

// ── 0x11 TUNER ON/OFF ───────────────────────────────────────────────
console.log('\ntuner (function 0x11):');
check('buildSetTuner(true)', buildSetTuner(true),
  'f000017410' + '11' + '01' + '05' + 'f7');
check('buildSetTuner(false)', buildSetTuner(false),
  'f000017410' + '11' + '00' + '04' + 'f7');

// ── 0x13 STATUS DUMP ────────────────────────────────────────────────
console.log('\nstatus_dump (function 0x13):');
check('buildStatusDump()', buildStatusDump(),
  'f000017410' + '13' + '06' + 'f7');

// ── 0x14 SET/GET TEMPO ──────────────────────────────────────────────
console.log('\ntempo (function 0x14):');
// 120 BPM = 0x78. encode14(120) = [0x78, 0x00].
check('buildSetTempo(120)', buildSetTempo(120),
  'f000017410' + '14' + '7800' + '79' + 'f7');
check('buildGetTempo()', buildGetTempo(),
  'f000017410' + '14' + '7f7f' + '01' + 'f7');

// ── Range-check refusals ────────────────────────────────────────────
console.log('\nrange-check refusals:');
function checkThrows(label: string, fn: () => unknown, matcher: RegExp): void {
  let threw: string | undefined;
  try { fn(); threw = '(no throw)'; } catch (err) { threw = (err as Error).message; }
  if (matcher.test(threw)) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}: ${threw}`);
    failures += 1;
  }
}
checkThrows('buildSetScene(-1) throws', () => buildSetScene(-1), /out of range/);
checkThrows('buildSetScene(8) throws',  () => buildSetScene(8),  /out of range/);
checkThrows('buildSetChannel(46, 4) throws', () => buildSetChannel(46, 4 as 0), /out of range/);
checkThrows('buildQueryPatchName(1024) throws', () => buildQueryPatchName(1024), /out of range/);

// ── resolveEffectId from blockTypes ─────────────────────────────────
console.log('\nresolveEffectId (block name → effect ID):');
checkEqual('resolveEffectId("Compressor 1")', resolveEffectId('Compressor 1'), 46);
checkEqual('resolveEffectId("CMP")',          resolveEffectId('CMP'),          46);
checkEqual('resolveEffectId("Reverb 1")',     resolveEffectId('Reverb 1'),     66);
checkEqual('resolveEffectId("Reverb 2")',     resolveEffectId('Reverb 2'),     67);
checkEqual('resolveEffectId("Drive 1")',      resolveEffectId('Drive 1'),      58);
checkEqual('resolveEffectId("Drive 4")',      resolveEffectId('Drive 4'),      61);
checkEqual('resolveEffectId("DRV", 3)',       resolveEffectId('DRV', 3),       60);
checkEqual('resolveEffectId("Scene MIDI")',   resolveEffectId('Scene MIDI'),   190);
checkThrows('resolveEffectId("Amp") throws (not in v1.4)', () => resolveEffectId('Amp'), /no effect ID in the v1.4 spec/);
checkThrows('resolveEffectId("NAM") throws (post-1.13)', () => resolveEffectId('NAM'), /no effect ID in the v1.4 spec/);
checkThrows('resolveEffectId("Bogus")', () => resolveEffectId('Bogus'), /Unknown Axe-Fx III block/);

// Verify the catalog is internally consistent — every 'spec-v1.4'
// entry has a firstId; nothing else does.
console.log('\nblockTypes.ts catalog consistency:');
let mismatches = 0;
for (const b of AXE_FX_III_BLOCKS) {
  const hasId = b.firstId !== null;
  const claimsSpec = b.confidence === 'spec-v1.4';
  if (hasId !== claimsSpec) {
    console.log(`  ✗ ${b.name}: firstId=${b.firstId} confidence=${b.confidence}`);
    mismatches += 1;
  }
}
if (mismatches === 0) {
  console.log(`  ✓ all ${AXE_FX_III_BLOCKS.length} entries consistent (spec-v1.4 ⇔ firstId set)`);
} else {
  failures += mismatches;
}

// ── Response predicates + parsers (round-trip on synthetic input) ───
console.log('\nresponse predicates + parsers:');

// 0x0A bypass response: effect ID 66 (Reverb 1), bypassed.
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0a, 0x42, 0x00, 0x01];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('isSetGetBypassResponse(synth)', isSetGetBypassResponse(synth), true);
  checkEqual('parseBypassResponse(synth)', parseBypassResponse(synth),
    { effectId: 66, bypassed: true });
}

// 0x0B channel response: effect ID 46 (Compressor 1), channel C (2).
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0b, 0x2e, 0x00, 0x02];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('parseChannelResponse(synth)', parseChannelResponse(synth),
    { effectId: 46, channel: 2 });
}

// 0x0C scene response: scene 3.
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0c, 0x03];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('parseSceneResponse(synth)', parseSceneResponse(synth), { scene: 3 });
}

// 0x0D QUERY PATCH NAME response: preset 257, name "Crunch Lead"
{
  const name = 'Crunch Lead';
  const padded = name + ' '.repeat(32 - name.length);
  const ascii = Array.from(padded).map((c) => c.charCodeAt(0));
  // preset 257 = 0x101 -> encode14 = [0x01, 0x02]
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0d, 0x01, 0x02, ...ascii];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('isQueryPatchNameResponse(synth)', isQueryPatchNameResponse(synth), true);
  checkEqual('parseQueryPatchNameResponse(synth)', parseQueryPatchNameResponse(synth),
    { presetNumber: 257, name: 'Crunch Lead' });
}

// 0x0E QUERY SCENE NAME response: scene 3, name "Verse"
{
  const name = 'Verse';
  const padded = name + ' '.repeat(32 - name.length);
  const ascii = Array.from(padded).map((c) => c.charCodeAt(0));
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0e, 0x03, ...ascii];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('parseQuerySceneNameResponse(synth)', parseQuerySceneNameResponse(synth),
    { scene: 3, name: 'Verse' });
}

// 0x0F LOOPER state response: recording + overdubbing -> 0b00000101 = 0x05.
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x0f, 0x05];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('parseLooperStateResponse(synth)', parseLooperStateResponse(synth), {
    recording: true,
    playing: false,
    overdubbing: true,
    once: false,
    reverse: false,
    halfSpeed: false,
    raw: 0x05,
  });
}

// 0x14 tempo response: 120 BPM.
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x14, 0x78, 0x00];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('parseTempoResponse(synth)', parseTempoResponse(synth), { bpm: 120 });
}

// 0x13 STATUS_DUMP with 3 entries:
//   (effectId=66, bypass=0, channel=0, channel_count=4) → dd = 0b01000000 = 0x40
//   (effectId=46, bypass=1, channel=2, channel_count=2) → dd = 0b00100101 = 0x25
//   (effectId=70, bypass=0, channel=1, channel_count=4) → dd = 0b01000010 = 0x42
{
  const enc = (n: number): [number, number] => [n & 0x7f, (n >> 7) & 0x7f];
  const triples = [
    ...enc(66), 0x40,
    ...enc(46), 0x25,
    ...enc(70), 0x42,
  ];
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x13, ...triples];
  const synth = [...head, fractalChecksum(head), 0xf7];
  checkEqual('isStatusDumpResponse(synth)', isStatusDumpResponse(synth), true);
  const entries = parseStatusDumpResponse(synth);
  checkEqual('parseStatusDumpResponse(synth)', entries, [
    { effectId: 66, bypassed: false, channel: 0, channelCount: 4 },
    { effectId: 46, bypassed: true,  channel: 2, channelCount: 2 },
    { effectId: 70, bypassed: false, channel: 1, channelCount: 4 },
  ]);
}

// Non-responses must be rejected.
{
  checkEqual('isStatusDumpResponse(wrong fn)',
    isStatusDumpResponse(asBytes('f000017410' + '0d' + '0000' + '18' + 'f7')), false);
  checkEqual('isStatusDumpResponse(wrong model)',
    isStatusDumpResponse(asBytes('f000017415' + '13' + '06' + 'f7')), false);
  checkEqual('isStatusDumpResponse(short frame)',
    isStatusDumpResponse([0xf0, 0xf7]), false);
}

// Parser refuses malformed STATUS_DUMP payload.
{
  const head = [0xf0, 0x00, 0x01, 0x74, 0x10, 0x13, 0x01, 0x02];
  const bad = [...head, fractalChecksum(head), 0xf7];
  let caught: string | undefined;
  try { parseStatusDumpResponse(bad); } catch (err) { caught = (err as Error).message; }
  checkEqual('parseStatusDumpResponse rejects non-triple payload',
    typeof caught === 'string' && /multiple of 3/.test(caught), true);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
