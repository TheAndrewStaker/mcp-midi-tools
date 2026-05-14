/**
 * Axe-Fx II agent guidance — migrated from the long device-namespaced
 * tool descriptions in `src/fractal/axe-fx-ii/tools/{discovery,params,
 * navigation,preset}.ts`.
 *
 * v0.3 removed the device-namespaced tool surface; the LLM no longer
 * sees these guidance blocks through tool descriptions. They surface
 * instead via `describe_device({ port: 'axe-fx-ii' }).agent_guidance`.
 */

export const AXEFX2_AGENT_GUIDANCE: Readonly<Record<string, string>> = {
  channel_model: [
    'Axe-Fx II blocks expose two channels — X and Y — NOT the AM4 four',
    '(A/B/C/D). Scenes pick which channel each block uses (plus per-block',
    'bypass). When the user says "scene 2", that\'s a selector for per-',
    'block channel + bypass state within the current preset; it doesn\'t',
    'duplicate the params (channels hold the params, scenes pick which',
    'channel each block uses).',
  ].join(' '),

  preset_location_format: [
    'Axe-Fx II presets are addressed by integer slot index 0..16383 on',
    'the wire. The FRONT PANEL displays preset numbers as wire+1 (front-',
    'panel #1 is wire 0). The user usually thinks in front-panel numbers',
    '— pass the same integer the user names; describe_device reports the',
    'preset_location_format.',
  ].join(' '),

  param_addressing: [
    'Params are addressed by (block, name) where `block` resolves on',
    'block instance display name ("Amp 1", "Delay 1") OR effectId',
    'integer, and `name` is the snake-case param key (effect_type, gain,',
    'mix, etc.). All instances of the same block group (e.g. Amp 1 / Amp',
    '2) share the same param table — list_params per group covers every',
    'instance.',
  ].join(' '),

  set_param_interpret: [
    'Numeric set_param values are interpreted in display units by default.',
    'For wire-level writes (raw 0..65534), some param types lack a',
    'calibrated display range and the unified set_param accepts the wire',
    'integer directly — see list_params for the param\'s controlType.',
    'Enum / select params accept the display name string OR the wire',
    'index. The relaxed matcher disambiguates partial names; the ack',
    'reports the full resolved name in parentheses.',
  ].join(' '),

  lineage_matchvia: [
    'lookup_lineage returns a `matchVia` field naming the lookup-path',
    'used to find the wiki entry (NOT a confidence rating on the data):',
    '  direct         — exact name match. Trust the data.',
    '  abbrev-expand  — Axe-Fx II truncates words to fit its 16-char',
    '                   display ("NRML"→"NORMAL", "MDRN"→"MODERN").',
    '                   Same model, different label. Trust the data.',
    '  reverb-swap    — reverb labels invert word order ("MEDIUM HALL"',
    '                   matches wiki "Hall, Medium"). Trust the data.',
    '  prefix         — Axe-Fx II uses a family-head abbreviation that',
    '                   prefixes a more specific wiki entry. Family-',
    '                   level lineage is solid; specifics approximate.',
    '  unmatched      — no wiki record. Model exists in firmware, but',
    '                   lineage prose isn\'t sourced.',
    'Do NOT hedge on direct / abbrev-expand / reverb-swap — those are',
    'known-good display-string conventions. Hedge only on prefix /',
    'unmatched, or when the record\'s `flags` array surfaces a substantive',
    'data-quality issue (cross-attributed forum quotes, inherited basedOn).',
  ].join(' '),

  lineage_flags: [
    'Substantive lineage flags to surface to the user:',
    '  INHERITED — basedOn / tubes / cab were back-filled from a sibling',
    '    amp record. For amp-family siblings (Plexi 50W Normal/High) this',
    '    is fine; for non-sibling inheritance basedOn might be wrong.',
    '  Forum quotes naming a different amp family than the record — known',
    '    AM4 wiki-parser bug where cross-cutting "Regarding the following',
    '    X models" prose attaches to the prior entry. Filter; don\'t',
    '    surface as authoritative.',
    'Block coverage: amp (259 enum / 196 matched), drive (36 / 34),',
    'reverb (43 / 25), delay (18 / 17). Compressor / chorus / flanger /',
    'phaser / wah are AM4-only for now.',
  ].join(' '),

  save_intent_required: [
    'SAVE INTENT REQUIRED: call save / persist tools (apply_preset with',
    'target_location, save_preset) ONLY when the user has explicitly asked',
    'to save / persist / store / keep the preset. apply_preset without',
    'target_location is reversible (switch presets to discard); save is',
    'not. When in doubt, apply without target_location and ask whether to',
    'persist.',
  ].join(' '),

  apply_preset_fresh_vs_tweak: [
    'TWEAK vs FRESH: apply_preset REPLACES the working-buffer layout. If',
    'the user says "tweak my current tone", call set_param / set_block /',
    'set_bypass for the targeted change instead. apply_preset is for fresh',
    'designs ("build me a clean tone").',
  ].join(' '),
};
