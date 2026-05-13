/**
 * Hydrasynth Explorer agent guidance — migrated from the long device-
 * namespaced tool descriptions in `src/asm/hydrasynth-explorer/tools/
 * {params,patch,navigation,discovery}.ts`.
 *
 * v0.3 removed several device-namespaced tools (hydra_switch_patch,
 * hydra_set_engine_param/s, hydra_param_catalog, hydra_list_enum_values);
 * the LLM no longer sees those guidance blocks through tool descriptions.
 * They surface instead via `describe_device({ port: 'hydrasynth' }).
 * agent_guidance`.
 */

export const HYDRASYNTH_AGENT_GUIDANCE: Readonly<Record<string, string>> = {
  device_precondition: [
    'IMPORTANT — DEVICE PRECONDITION: NRPN engine-param writes (the unified',
    'set_param / set_params surface) only respond when Param TX/RX is set',
    'to NRPN on System Setup → MIDI page 10. If writes seem inert, check',
    'that first. System CCs (master volume, sustain pedal, etc. — call',
    'hydra_set_param for those) work regardless of the Param TX/RX setting.',
  ].join(' '),

  ack_caveat: [
    'No wire-ack — consumer MIDI synths don\'t echo NRPN. Confirmation is',
    'audible / observable on the device only. The set_param response says',
    'acked=true to signal "wire bytes sent successfully"; it does NOT',
    'confirm the device actually applied the change.',
  ].join(' '),

  volume_language: [
    'When the user says "louder / quieter / wetter", pick the right knob:',
    '`amplevel` is the main output trim (0..128), `mixer.osc{1,2,3}_vol`',
    'is per-oscillator level (drive into the filter), `<fx>.dry_wet` /',
    '`<fx>wet` (prefx / delay / reverb / postfx / mutator) is each FX\'s',
    'wet/dry mix (0..100%). Hydrasynth is a synth so there\'s no "input',
    'gain" — oscillator level is the closest analog. Full cheat sheet:',
    'docs/VOLUME-CONTROL.md.',
  ].join(' '),

  param_name_aliases: [
    'Both NRPN canonical names ("filter1type", "osc1semi", "prefxtype",',
    '"env1attacksyncoff") and CC-style aliases ("filter1.cutoff",',
    '"mixer.osc1_vol", "env1.attack") resolve via set_param. Skip the',
    'list_params discovery step for normal tweaks — the unified resolver',
    'accepts whichever form the agent / user types.',
  ].join(' '),

  macro_model: [
    'Macros 1-8 (CCs 16-23) are patch-defined: each loaded patch wires',
    'its 8 Macros to whatever synthesis parameters the patch designer',
    'chose, via the mod matrix. So "Macro 1" might be filter sweep on one',
    'patch and reverb mix on another — there\'s no fixed mapping. Macros',
    'are an excellent first lever for tone tweaks because they\'re curated',
    'by the patch designer to be musically useful for that patch. Use the',
    'hydra_set_macro tool to drive them.',
  ].join(' '),

  fresh_build_vs_tweak: [
    'For FRESH-PATCH BUILDS use hydra_apply_patch (atomic SysEx, starts',
    'from the factory INIT buffer so all hardwired routings — env1 → VCA,',
    'mod matrix, mutators — are intact by construction). For INCREMENTAL',
    'tweaks on top of an already-loaded patch, use set_param / set_params',
    '(NRPN writes). NRPN sequences can\'t replace destructively-set state',
    'from a prior patch — recipes fail in subtle ways ("fizzy attack then',
    'silence" if env→VCA is missing) when you try whole-patch builds via',
    'sequential NRPN writes.',
  ].join(' '),

  patch_addressing: [
    'Patches are addressed by Bank+Patch — "A001".."H128" form (letter',
    'A..H + patch 1..128). 1024 total locations (8 banks × 128).',
    'switch_preset uses Bank Select MSB=0 + LSB=bank + Program Change=patch.',
    'No SysEx-level "get patch name" primitive on Hydrasynth, so',
    'scan_locations is not supported.',
  ].join(' '),
};
