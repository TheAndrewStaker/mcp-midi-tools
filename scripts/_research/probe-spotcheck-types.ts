/**
 * One-shot probe: for the HW-053 spot-check param list, look up each
 * parameter's type-applicability gate and print which types expose it
 * (with display names from cacheEnums).
 */
import { readFileSync } from 'node:fs';

import {
  AMP_TYPES,
  DRIVE_TYPES,
  REVERB_TYPES,
  DELAY_TYPES,
  CHORUS_TYPES,
  FLANGER_TYPES,
  PHASER_TYPES,
  TREMOLO_TYPES,
  COMPRESSOR_TYPES,
  FILTER_TYPES,
  GEQ_TYPES,
  GATE_TYPES,
} from 'fractal-midi/am4';

const data = JSON.parse(readFileSync('samples/captured/decoded/labels/type-applicability.json', 'utf8'));

const ENUM_LOOKUP: Record<string, readonly string[]> = {
  AMP_TYPE: AMP_TYPES,
  DISTORT_TYPE: AMP_TYPES,
  CABINET_MODE: [], // unknown enum — keep raw indices
  DISTORT_MODE_1: [],
  DISTORT_EQTYPE: [],
  FUZZ_TYPE: DRIVE_TYPES,
  REVERB_TYPE: REVERB_TYPES,
  REVERB_BASETYPE: REVERB_TYPES,
  REVERB_SPRINGTYPE: [],
  REVERB_LOWSLOPE: [],
  REVERB_HIGHSLOPE: [],
  DELAY_TYPE: DELAY_TYPES,
  DELAY_MODEL: DELAY_TYPES,
  CHORUS_TYPE: CHORUS_TYPES,
  FLANGER_TYPE: FLANGER_TYPES,
  PHASER_TYPE: PHASER_TYPES,
  TREMOLO_TYPE: TREMOLO_TYPES,
  COMP_TYPE: COMPRESSOR_TYPES,
  FILTER_TYPE: FILTER_TYPES,
  GEQ_TYPE: GEQ_TYPES,
  GATE_TYPE: GATE_TYPES,
};

const SPOTS: [string, string, string][] = [
  ['Amp', 'DISTORT_PRESFREQ', 'presence_freq'],
  ['Amp', 'DISTORT_BETA', 'negative_feedback'],
  ['Amp', 'DISTORT_SCREENFREQ', 'screen_frequency'],
  ['Amp', 'DISTORT_TIMECONST', 'b_time_constant'],
  ['Amp', 'DISTORT_CBRATIO', 'cathode_resistance'],
  ['Reverb', 'REVERB_EARLYLEVEL', 'early_level'],
  ['Reverb', 'REVERB_REVERBLEVEL', 'late_level'],
  ['Reverb', 'REVERB_EARLYDIFF', 'early_diffusion'],
  ['Reverb', 'REVERB_WIDTH', 'pickup_spacing'],
  ['Reverb', 'REVERB_DRIVE', 'dwell'],
  ['Delay', 'DELAY_RATE1', 'mod_rate'],
  ['Delay', 'DELAY_SPEED', 'motor_speed'],
  ['Delay', 'DELAY_OFFSET', 'right_post_delay'],
  ['Delay', 'DELAY_SPLICETIME', 'crossfade_time'],
  ['Delay', 'DELAY_RATE4', 'pan_rate'],
  ['Filter', 'FILTER_START', 'start_frequency'],
  ['Filter', 'FILTER_STOP', 'stop_frequency'],
  ['Filter', 'FILTER_SENS', 'sensitivity'],
  ['Filter', 'FILTER_ATTACK', 'attack_time'],
  ['Filter', 'FILTER_RELEASE', 'release_time'],
];

console.log('| block.friendly | parameterName | exposes when | type names |');
console.log('|---|---|---|---|');
for (const [block, pname, friendly] of SPOTS) {
  const b = data.find((x: { blockName: string }) => x.blockName === block);
  if (!b) {
    console.log(`| ${block}.${friendly} | ${pname} | (block not found) | |`);
    continue;
  }
  const entries = b.parameters.filter((p: { parameterName: string }) => p.parameterName === pname);
  if (entries.length === 0) {
    console.log(`| ${block}.${friendly} | ${pname} | (not in XML) | — |`);
    continue;
  }
  // Collapse identical gates so we don't repeat the same row N times when
  // a knob appears on several pages with the same gate.
  const seen = new Set<string>();
  for (const e of entries) {
    const gate = e.pageGate ?? e.controlGate;
    const key = gate ? `${gate.typeEnum}|${(gate.values ?? []).join(',')}` : 'always';
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.always || !gate) {
      console.log(`| ${block}.${friendly} | ${pname} | **always (any type)** | — |`);
    } else {
      const enumName = gate.typeEnum;
      const vals = gate.values ?? [];
      const list = ENUM_LOOKUP[enumName] ?? [];
      const names = vals.map((v: number) => list[v] ?? `idx ${v}`);
      console.log(`| ${block}.${friendly} | ${pname} | ${enumName} = [${vals.join(',')}] | ${names.join(', ') || '(unknown enum)'} |`);
    }
  }
}
