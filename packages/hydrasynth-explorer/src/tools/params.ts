/**
 * Hydrasynth param tools — system CC, macros, and engine NRPN writes.
 *
 * 4 tools:
 *   - hydra_set_param          — system CCs (master vol, sustain, …)
 *   - hydra_set_macro          — Macros 1-8 (CCs 16-23)
 *   - hydra_set_engine_param   — single NRPN write (1175 params)
 *   - hydra_set_engine_params  — batch NRPN writes
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { HYDRASYNTH_PARAMS, HYDRASYNTH_PARAMS_BY_ID } from '../params.js';
import { findHydraNrpn } from '../nrpn.js';
import { findMatchingNrpns, formatNrpnHit, resolveNrpnValue } from '../encoding.js';

import {
  ENGINE_PARAM_CHEAT_SHEET,
  ENV_TIME_SECONDS_TO_INDEX,
  HYDRA_DEV_MODE_PREAMBLE,
  DEFAULT_CHANNEL,
  ccBytes,
  ensureMidi,
  runEngineParamBatch,
  sendNrpn,
} from './shared.js';

export function registerHydrasynthParamTools(server: McpServer): void {

// hydra_set_param --------------------------------------------------------

server.registerTool('hydra_set_param', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to set a SYSTEM CC on the user\'s ASM Hydrasynth Explorer — these are',
    'the always-on MIDI controls that work regardless of the device\'s Param TX/RX setting:',
    'Master Volume (system.master_volume), Modulation Wheel (system.modulation_wheel),',
    'Sustain Pedal (system.sustain_pedal), Expression Pedal (system.expression_pedal),',
    'Bank Select MSB/LSB (system.bank_select_msb / .bank_select_lsb), All Notes Off',
    '(system.all_notes_off). 7 parameters total.',
    '',
    'For ANY OTHER engine parameter (oscillators, filters, envelopes, mixer, FX, etc.)',
    'use hydra_set_engine_param (single) or hydra_set_engine_params (batch) — those use',
    'NRPN, which is the device\'s standard mode for engine control and covers 1175',
    'parameters including the wave/filter/FX type selectors that aren\'t on CCs at all.',
    '',
    'Values are 0..127 (raw MIDI CC range). No wire-ack is expected.',
  ].join('\n'),
  inputSchema: {
    id: z.string().describe(
      'System parameter id — one of: system.master_volume, system.modulation_wheel, system.sustain_pedal, system.expression_pedal, system.bank_select_msb, system.bank_select_lsb, system.all_notes_off.',
    ),
    value: z.number().int().min(0).max(127).describe(
      'Raw MIDI CC value 0..127.',
    ),
  },
}, async ({ id, value }) => {
  const param = HYDRASYNTH_PARAMS_BY_ID.get(id);
  if (!param) {
    const suggestions = HYDRASYNTH_PARAMS
      .filter((p) => p.category === 'system')
      .map((p) => p.id);
    throw new Error(
      `Unknown parameter id "${id}". hydra_set_param only handles System CCs. Available ids: ${suggestions.join(', ')}. For engine parameters use hydra_set_engine_param.`,
    );
  }
  if (param.category !== 'system') {
    throw new Error(
      `"${id}" is an engine parameter, not a System CC. Use hydra_set_engine_param("${id}", value) instead — it sends NRPN, accepts the same name, and the device listens on NRPN for engine control. CC-style and canonical NRPN names both resolve.`,
    );
  }
  const conn = ensureMidi();
  conn.send(ccBytes(DEFAULT_CHANNEL, param.cc, value));
  return {
    content: [{
      type: 'text',
      text: `Sent CC ${param.cc} = ${value} (${param.module} → ${param.parameter}). System CC — always responds.`,
    }],
  };
});

// hydra_set_macro --------------------------------------------------------

server.registerTool('hydra_set_macro', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to set one of the user\'s Macro controls on the Hydrasynth Explorer.',
    'Macros 1-8 are patch-defined: each loaded patch wires its 8 Macros to whatever',
    'synthesis parameters the patch designer chose, via the mod matrix. So "Macro 1"',
    'might be filter sweep on one patch and reverb mix on another — there\'s no fixed',
    'mapping. Macros are an excellent first lever for tone tweaks because they\'re',
    'curated by the patch designer to be musically useful for that patch.',
    '',
    'Macros are CCs 16-23 internally. Like other engine CCs they require Param TX/RX = CC',
    'on the device.',
  ].join('\n'),
  inputSchema: {
    macro: z.number().int().min(1).max(8).describe('Macro number 1..8 (1-indexed, matching the device\'s display).'),
    value: z.number().int().min(0).max(127).describe('Macro value 0..127.'),
  },
}, async ({ macro, value }) => {
  const cc = 15 + macro; // Macro 1 = CC 16, Macro 8 = CC 23
  const conn = ensureMidi();
  conn.send(ccBytes(DEFAULT_CHANNEL, cc, value));
  return {
    content: [{
      type: 'text',
      text: `Sent Macro ${macro} = ${value} (CC ${cc}). The audible effect depends on the currently-loaded patch's mod matrix routing.`,
    }],
  };
});

// hydra_set_engine_param -------------------------------------------------

server.registerTool('hydra_set_engine_param', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Set ONE synthesis-engine parameter on the user\'s Hydrasynth Explorer.',
    'Use for single-knob tweaks on top of an already-loaded patch ("nudge',
    'cutoff up", "shorten release"). For 2+ knob tweaks use',
    '`hydra_set_engine_params` (batch). For whole-patch fresh builds use',
    '`hydra_apply_patch` (atomic SysEx, audible-by-construction).',
    '',
    '**DON\'T pre-discover names. Just call this.** This tool already knows',
    'every engine parameter (1175 of them). The cheat-sheet below covers',
    '~95% of patch-tweaking work. Skip hydra_param_catalog for normal use',
    '— both the CC-style names it returns ("mixer.osc1_vol", "env1.attack")',
    'AND the canonical NRPN names ("mixerosc1vol", "env1attacksyncoff")',
    'work directly here. Only call hydra_param_catalog if a write here',
    'genuinely fails on a name you can\'t guess from the patterns below.',
    '',
    ENGINE_PARAM_CHEAT_SHEET,
    '',
    ENV_TIME_SECONDS_TO_INDEX,
    '',
    'VOLUME LANGUAGE: when the user says "louder / quieter / wetter",',
    'pick the right knob — `amplevel` is the main output trim (0..128),',
    '`mixer.osc{1,2,3}_vol` is per-oscillator level (drive into the',
    'filter), `<fx>.dry_wet` / `<fx>wet` (prefx / delay / reverb /',
    'postfx / mutator) is each FX\'s wet/dry mix (0..100%). Hydrasynth',
    'is a synth so there\'s no "input gain" — oscillator level is the',
    'closest analog. Full cross-device cheat sheet: docs/VOLUME-CONTROL.md.',
    '',
    'IMPORTANT — DEVICE PRECONDITION: writes only respond when Param TX/RX',
    'is set to NRPN on System Setup → MIDI page 10. If writes seem inert,',
    'check that first.',
    '',
    'No wire-ack — consumer MIDI synths don\'t echo NRPN. Confirmation is',
    'audible / observable on the device only.',
  ].join('\n'),
  inputSchema: {
    name: z.string().describe(
      'Canonical NRPN parameter name (e.g. "filter1type", "osc1semi", "prefxtype", "env1attacksyncoff") OR CC-style alias (e.g. "filter1.cutoff", "mixer.osc1_vol", "env1.attack"). Both resolve.',
    ),
    value: z.union([z.number(), z.string()]).describe(
      'Numeric value (0..16383) OR — for enum-typed params — the display name as a string. Examples: filter1type=10 or filter1type="Vowel"; prefxtype=40 or prefxtype="Lo-Fi"; osc1type=0 or osc1type="Sine". Most non-enum params use only 0..127 (the low 7 bits); osc cents / wavescan / mod-matrix amount use the full 14-bit range. The tool response includes the parameter\'s notes for per-param ranges and signedness.',
    ),
  },
}, async ({ name, value }) => {
  const entry = findHydraNrpn(name);
  if (!entry) {
    const hits = findMatchingNrpns(name, 8);
    const lines = hits.length > 0
      ? `\nClosest matches:\n${hits.map(formatNrpnHit).join('\n')}`
      : ' Call hydra_param_catalog with a related query for fallback discovery.';
    throw new Error(`Unknown NRPN parameter "${name}".${lines}`);
  }
  const { wire: resolvedValue, scaled, bipolar } = resolveNrpnValue(entry, value);
  const conn = ensureMidi();
  sendNrpn(conn, DEFAULT_CHANNEL, entry, resolvedValue);
  const ccLine = entry.cc !== undefined
    ? ` (also on CC ${entry.cc} for 7-bit access.)`
    : '';
  let inputDisplay: string;
  if (typeof value === 'string') {
    inputDisplay = `"${value}" (resolved to ${resolvedValue})`;
  } else if (bipolar) {
    inputDisplay = `${value} → wire ${resolvedValue} (bipolar: display ${value >= 0 ? '+' : ''}${value} on ${entry.displayMin}..+${entry.displayMax})`;
  } else if (scaled) {
    inputDisplay = `${value} → wire ${resolvedValue} (auto-scaled 0..127 → 0..${entry.wireMax})`;
  } else {
    inputDisplay = `${resolvedValue}`;
  }
  const noteLine = entry.notes ? `\nRange/encoding: ${entry.notes}` : '';
  return {
    content: [{
      type: 'text',
      text: `Sent NRPN MSB=0x${entry.msb.toString(16).padStart(2, '0')} LSB=0x${entry.lsb.toString(16).padStart(2, '0')} value=${inputDisplay} (${name}).${ccLine} Reminder: requires Param TX/RX = NRPN on the device.${noteLine}`,
    }],
  };
});

// hydra_set_engine_params (batch) ----------------------------------------

server.registerTool('hydra_set_engine_params', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Use for incremental NRPN tweaks on top of an already-loaded patch** —',
    'small/medium batches of knob changes, not whole-patch builds. Examples:',
    '"make it brighter" (raise filter cutoff + resonance), "add some chorus"',
    '(set prefxtype + prefxwet), "punchier attack" (shorten env1 attack +',
    'raise env1amount). Each NRPN write is atomic; nothing destructive runs',
    'before your params land.',
    '',
    '**For FRESH-PATCH BUILDS, do NOT use this tool — use `hydra_apply_patch`',
    'instead.** That sends one atomic SysEx dump starting from the factory',
    'INIT buffer, so all hardwired routings (env1 → VCA, mod matrix, mutators)',
    'are intact by construction. This tool sends a sequence of NRPN writes',
    'that can\'t replace destructively-set state from a prior patch — recipes',
    'fail in subtle ways ("fizzy attack then silence" if env→VCA is missing).',
    'Whole-patch tone authoring is `hydra_apply_patch`\'s job.',
    '',
    '**DON\'T pre-discover names. Just send the batch.** This tool already',
    'knows all 1175 engine parameters. The cheat-sheet below covers ~95% of',
    'patch tweaking. Skip hydra_param_catalog for normal use — both CC-style',
    'names ("mixer.osc1_vol", "env1.attack") and canonical NRPN names',
    '("mixerosc1vol", "env1attacksyncoff") work here directly. Only fall',
    'back to hydra_param_catalog if a name genuinely fails AND you can\'t',
    'guess it from the patterns below.',
    '',
    ENGINE_PARAM_CHEAT_SHEET,
    '',
    ENV_TIME_SECONDS_TO_INDEX,
    '',
    'EXAMPLE — incremental tweaks ("brighter and more saturated"):',
    '  hydra_set_engine_params({ params: [',
    '    { name: "filter1.cutoff", value: 95 },',
    '    { name: "filter1.res", value: 35 },',
    '    { name: "filter1drive", value: 25 },',
    '    { name: "amplevel", value: 100 },',
    '  ]})',
    '',
    'ORDERING — per edisyn, put type-changing writes first (modes, types,',
    'LFO waveforms, BPM-sync flags, wavescan waves) followed by continuous-',
    'value writes (cutoffs, envelopes, mixer, macros). The device needs time',
    'to reconfigure routing before downstream values land. The tool does NOT',
    'reorder for you.',
    '',
    'IMPORTANT — DEVICE PRECONDITION: Param TX/RX must be NRPN on System',
    'Setup → MIDI page 10. With Param TX/RX = CC, the entire batch is',
    'silently ignored.',
  ].join('\n'),
  inputSchema: {
    params: z.array(z.object({
      name: z.string().describe('Canonical NRPN parameter name (e.g. "filter1type", "osc2semi", "env1attacksyncoff") OR CC-style alias ("filter1.cutoff", "mixer.osc1_vol", "env1.attack"). Both resolve.'),
      value: z.union([z.number(), z.string()]).describe('Display value (0..128 auto-scales for unipolar; signed N for bipolar) OR enum display name string (e.g. "Vowel", "Lo-Fi", "Sine"). See cheat-sheet for value semantics.'),
    }))
      .min(1)
      .max(300)
      .describe('Ordered list of NRPN writes to send. The server sends each as a 4-CC sequence with ~3 ms between sequences for pacing.'),
  },
}, async ({ params }) => {
  return runEngineParamBatch(params);
});

}
