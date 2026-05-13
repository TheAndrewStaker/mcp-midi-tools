/**
 * AM4 agent guidance — migrated from the long device-namespaced tool
 * descriptions in `src/fractal/am4/tools/{write,read,navigation,apply}.ts`.
 *
 * v0.3 removed the device-namespaced tool surface; the LLM no longer sees
 * these guidance blocks through tool descriptions. They surface instead
 * via `describe_device({ port: 'am4' }).agent_guidance` so the agent can
 * load them once per session and refer to them while planning
 * tone-building / preset-applying calls.
 *
 * Topic keys are device-defined — read the corresponding topic to
 * understand the behavioral contract. Keys are stable across releases.
 */

export const AM4_AGENT_GUIDANCE: Readonly<Record<string, string>> = {
  volume_language: [
    'When the user says "louder / quieter / more reverb", pick the right knob:',
    '`amp.gain` is INPUT DRIVE (changes character), `amp.master` is amp master',
    '(preserves character), `amp.level` is post-amp dB trim for preset-to-preset',
    'matching. `<fx>.mix` is the wet/dry on each effect. Full per-device cheat',
    'sheet: docs/VOLUME-CONTROL.md.',
  ].join(' '),

  relative_change: [
    'IMPORTANT for words like "more", "less", "a bit", "significantly",',
    '"raise/lower", "increase/decrease", "double/halve": these only have',
    'meaning relative to the current value. Call `get_param` FIRST to read',
    'the starting point, then compute the absolute target and pass that to',
    '`set_param`. Without the read, the agent is guessing the absolute value',
    '(gain at 2.0 → +3 is "significantly"; gain at 8.0 → +1 is',
    '"significantly"). Skip the read only when the user gives an absolute',
    'value ("set the gain to 6", "treble at 4"). Same anchor pattern works',
    'for read-before-tweak summaries: "amp.gain is currently 3.00; I\'ll',
    'change it to 6.50" gives the user a chance to redirect.',
  ].join(' '),

  tempo_time_discipline: [
    'IMPORTANT for delay / chorus / flanger / phaser / tremolo / rotary: each',
    'of these blocks has a `tempo` enum (NONE plus musical divisions',
    '1/64..1/2..1..4). When `tempo` is anything other than NONE, the AM4',
    'LOCKS the block\'s timing param to (song tempo × division) and SILENTLY',
    'IGNORES absolute writes to that timing param. The locked param is',
    '`delay.time` for delay and `rate` for chorus / flanger / phaser /',
    'tremolo / rotary. Read the `tempo` value alongside time/rate before',
    'planning a change so you know which side of the sync to write. When you',
    'DO need to write `time` or `rate` in absolute units, FIRST set the',
    'block\'s `tempo` to "NONE" — otherwise the write is silently overridden.',
    'Order: (1) set tempo to "NONE", (2) write time/rate. Going the other',
    'direction (setting tempo to a division) does not require clearing',
    'time/rate first — the AM4 just stops reading it.',
  ].join(' '),

  delay_tempo_default: [
    'For DELAY specifically: tempo-synced repeats are the PROFESSIONAL DEFAULT',
    'for guitarists in modern popular music. When the user asks for a delay',
    'tone — especially "ambient", "obvious", "rhythmic", "Edge / U2 style",',
    '"post-rock", "shoegaze", "worship", "atmospheric" — REACH FOR `delay.tempo`',
    'FIRST and pick a musical division: 1/4 DOT is the iconic Edge sound, 1/4',
    'for clear rhythmic repeats, 1/2 DOT or 1/2 for ambient washes, 1/8 DOT',
    'for rhythmic urgency, 1/8 for tighter syncopation. Fall back to absolute',
    '`delay.time` only when the user explicitly asks for a specific ms count,',
    'calls out free-time / rockabilly / slapback, or is playing without a',
    'tempo reference.',
    'For MODULATION blocks (chorus / flanger / phaser / rotary): free-Hz',
    '`rate` is the typical default — these are textural, not rhythmic, and',
    'tempo sync rarely matches the ask. Tremolo is the exception: rhythmic',
    'chops (1/8 / 1/16 tempo) are common alongside vintage Hz-rate tremolo.',
  ].join(' '),

  channel_scene_model: [
    'IMPORTANT for user requests that mention scenes: Each block',
    '(amp/drive/reverb/delay) holds its parameter values in one of four',
    'channels A/B/C/D. Scenes are selectors — they choose which channel each',
    'block uses (plus per-block bypass state), they don\'t store param values',
    'themselves. Two scenes pointing at the same channel will both reflect',
    'any write to that channel. If the user says "change the amp gain on',
    'scene 2" they usually mean "on whichever channel scene 2 uses for Amp"',
    '— pass the `channel` argument to `set_param` to target a specific',
    'A/B/C/D. Without `channel`, the write goes to whatever channel the',
    'block is on now, which may be shared across multiple scenes. Only amp /',
    'drive / reverb / delay have channels; other blocks (chorus, flanger,',
    'phaser, …) ignore the `channel` argument.',
  ].join(' '),

  enum_name_reporting: [
    'When you write an enum param (amp.type, drive.type, reverb.type,',
    'delay.type, compressor.type, etc.), the response surfaces the FULL',
    'resolved name in parentheses, e.g. `compressor.type = 8 (JFET Studio',
    'Compressor)`. When summarizing the change to the user, use that',
    'resolved name verbatim — not the shorthand you typed in. The relaxed',
    'matcher accepts partial names ("Studio" → "JFET Studio Compressor"),',
    'so the resolved name disambiguates which specific model loaded. Saying',
    '"I set the compressor to Studio" when the response said "JFET Studio',
    'Compressor" mis-describes the result.',
  ].join(' '),

  reverb_naming_convention: [
    'IMPORTANT: reverb types follow a "Category, Subtype" pattern: "Room,',
    'Small" / "Room, Medium" / "Room, Large" / "Hall, Small" / "Hall, Medium"',
    '/ "Plate, Medium" / "Plate, London" / "Spring, Tube" / "Chamber, Deep"',
    '/ "Echo, Plate" / "SFX Pegasus" / "Cloud, Cumulonimbus" etc. Pass the',
    'FULL "Category, Subtype" string. Passing just "Room" or "Plate" matches',
    'multiple entries and is rejected as ambiguous. When the user says',
    '"small room reverb" → "Room, Small"; "plate reverb" → "Plate, Medium"',
    '(or call list_params(port, "reverb", "type") for the full list and',
    'pick a specific one). Default sizes when the user is non-specific:',
    'Room/Hall/Plate → "Medium" subtype; Spring → "Medium" or "Tube" for',
    'vintage.',
  ].join(' '),

  param_name_aliases: [
    'Common synonyms resolve silently to the canonical registered name:',
    '`reverb.decay` / `reverb.length` → `reverb.time`; `delay.length` →',
    '`delay.time`; `delay.repeats` → `delay.feedback`;',
    '`<modulation_block>.speed` → `<...>.rate` (chorus, flanger, phaser,',
    'tremolo, rotary). The response shows the canonical name in the ack',
    '("delay.feedback = 50"); use that name in your summary, not the alias',
    'you passed in.',
  ].join(' '),

  ack_caveat: [
    'IMPORTANT: the AM4 wire-acks every write whether or not the target',
    'block is placed in the active preset, or whether the write landed on',
    'a channel the current scene is using. The response includes the raw',
    'ack bytes for diagnostics, but the only trustworthy signal that a',
    'change took effect is the user confirming via the AM4\'s own display.',
    'If the user expects an audible change and reports none, the likely',
    'cause is (a) the target block isn\'t placed in the active preset, or',
    '(b) the write landed on a channel the active scene isn\'t using.',
  ].join(' '),

  save_intent_required: [
    'SAVE INTENT REQUIRED: call save / persist tools (apply_preset with',
    'target_location, save_preset, switch_preset-with-save) ONLY when the',
    'user has explicitly asked to save, persist, store, or keep the preset',
    '(e.g. "save this", "put it on Z04", "keep this one"). Do NOT call save',
    'as an automatic follow-up to apply_preset — apply is reversible (the',
    'user can switch presets to discard), save is not. A request like "build',
    'a preset for X" is a try-it-out ask; without an explicit save phrase,',
    'apply and let the user decide whether to save. When in doubt, use',
    'apply_preset (with its optional name field) without target_location and',
    'ask the user whether to persist.',
  ].join(' '),

  write_safety_locations: [
    'Any A01..Z04 preset location is accepted for save (the historical',
    'Z04-only hard-gate was lifted Session 49; saves to inactive locations',
    'are a real workflow, HW-064). Agents must still treat saves as',
    'destructive: confirm before overwriting non-empty locations. "save to',
    'A01" without context is suspicious and worth a single-sentence "are',
    'you sure? A01 currently has X" before proceeding. The user\'s scratch',
    'slot for try-it-out tone work is "Z04" by convention.',
  ].join(' '),

  rename_persistence: [
    'Rename writes target the working buffer only. The new name does NOT',
    'persist across preset loads on its own — pair the rename with a save',
    '(apply_preset with target_location, or save_preset) to persist.',
    'Confirmed HW-002 (2026-04-19): rename alone is lost when a different',
    'preset is loaded; rename + save persists correctly.',
  ].join(' '),

  apply_preset_fresh_vs_tweak: [
    'TWEAK vs FRESH: `apply_preset` REPLACES the working-buffer block layout.',
    'If the user says "tweak my current tone" or "just adjust the reverb",',
    'do NOT call apply_preset — call `set_param` or `set_block` for the',
    'targeted change. apply_preset is for fresh designs ("build me a clean',
    'tone", "design a Mesa rectifier preset"). FRESH-BUILD CLEARING: unlisted',
    'slots get block_type="none" and unlisted scenes are reset to defaults',
    'on every call.',
  ].join(' '),
};
