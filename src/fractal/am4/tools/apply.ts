/**
 * AM4 high-level preset tools (3 tools): am4_apply_preset, am4_apply_preset_at,
 * am4_apply_setlist. The largest tool family in the project — apply_preset's
 * description carries multi-section agent guidance (control-surface discipline,
 * compressor type groups, scene structure for songs, naming discipline,
 * fresh-build clearing semantics). The tool descriptions are byte-exact with
 * the original; do not edit them during refactors.
 *
 * Internal helpers (prepareApplyPresetWrites / runApplyPresetWires /
 * formatApplyPresetResult / runApplyPresetAt + the preset-shape zod schemas
 * + ApplyPreset* types) live as module-level declarations so all three tools
 * share them.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { formatLocationDisplay, parseLocationCode } from '@/fractal/am4/locations.js';

import { ensureMidi } from '@/server/shared/connections.js';
import {
    formatInboundCapture,
    recordInbound,
} from '@/server/shared/wireOps.js';
import { readPresetName } from '@/server/shared/readOps.js';

import {
    formatApplyPresetResult,
    prepareApplyPresetWrites,
    runApplyPresetAt,
    runApplyPresetWires,
    type ApplyPresetAtFailure,
    type ApplyPresetAtResult,
    type ApplyPresetInput,
    type ApplyPresetPreparedWrite,
    type ApplyPresetSceneInput,
    type ApplyPresetSlotInput,
} from '@/fractal/am4/tools/applyExecutor.js';

export function registerApplyTools(server: McpServer): void {
    server.registerTool('am4_apply_preset', {
      description: [
        'Use this tool to apply a preset configuration (block layout + params +',
        'optional scene overrides and name) to the user\'s AM4. Do not produce',
        'a written spec instead of calling this tool unless the user explicitly',
        'asks for a dry run (e.g. "draft a preset I can review before pushing",',
        '"design a tone sheet without touching the hardware", "what would the',
        'params look like").',
        'Lay out an entire preset in one call: place (or clear) each block slot,',
        'fill in parameter values — either for the currently-active channel or',
        'for specific A/B/C/D channels — and optionally name the working-buffer',
        'preset at the end. Use this when the user is building a tone from',
        'scratch or applying a named preset concept — it replaces a sequence of',
        'set_block_type + set_param + channel-switch + set_preset_name calls',
        'with a single structured request.',
        'TWEAK vs FRESH - IMPORTANT: this tool REPLACES the working-buffer block',
        'layout. If the user says "tweak my current tone", "keep what I have but',
        'change X", "just adjust the reverb" - do NOT call apply_preset. Call',
        '`am4_get_block_layout` first to see what\'s placed, then make targeted',
        'changes via `am4_set_block_type` (one slot) and `am4_set_param` / `am4_set_params`',
        '(individual values). apply_preset is for fresh designs ("build me a',
        'clean tone", "design a Mesa rectifier preset"), not partial edits to',
        'whatever the user is currently playing. If you only want to nudge a',
        'single param without rebuilding the layout, do NOT call apply_preset:',
        'call set_param. apply_preset\'s clear-unlisted-slots-and-scenes behaviour',
        'will wipe state you wanted to keep.',
        'Each slot accepts these optional shapes (pick at most one per slot):',
        '  • params — writes to whichever channel the block is on now.',
        '    Example: { gain: 6, bass: 5 }.',
        '  • channel + params — switches to the specified channel first, then',
        '    writes params there. Example: { channel: "B", params: { gain: 8 } }.',
        '  • channels — per-channel param maps, one entry per channel you want',
        '    to fill. Keys are A/B/C/D (case-insensitive). Use this to',
        '    configure multiple channels of the same block in one call — e.g.',
        '    clean tone on channel A and lead tone on channel D. Example:',
        '    { channels: { A: { type: "Deluxe Verb Normal", gain: 3 },',
        '                  D: { type: "1959SLP Normal", gain: 8 } } }.',
        'Only amp / drive / reverb / delay have channels — `channel` and',
        '`channels` are rejected for other blocks. Channel maps are written in',
        'canonical A→B→C→D order so the last-written channel is predictable.',
        'Optional top-level fields:',
        '  • name — working-buffer preset name, up to 32 ASCII-printable chars.',
        '    Written AFTER all slot writes so the display reflects it immediately.',
        '    This does NOT save to a location — apply_preset remains working-',
        '    buffer-only. Example: { slots: [...], name: "Sailing - C. Cross" }.',
        '  • scenes — per-scene overrides. Each entry configures one of the four',
        '    scenes (index 1..4) by pointing each block at a specific channel',
        '    (`channels: { amp: "A", drive: "A" }`), setting per-block bypass',
        '    (`bypass: { drive: true }` silences drive on that scene), and/or',
        '    renaming (`name: "clean"`). A scene entry may specify any combination',
        '    of channels / bypass / name — at least one must be supplied.',
        '    All four scenes are written on every call (fresh-build clearing):',
        '    scenes you list use your config; scenes you do NOT list are reset',
        '    to defaults (channel A on every placed block, all blocks active,',
        '    name cleared). The AM4 lands on scene 1 by default when',
        '    apply_preset returns; pass top-level `landingScene` to override.',
        'CHANNEL/SCENE MODEL: channels (A/B/C/D) hold the param values; scenes',
        'pick which channel each block uses. If the user wants a preset where',
        'a block varies tone across scenes, use `slots[].channels` to fill',
        'the relevant channels with params, then use `scenes[].channels` to',
        'point each scene at the channel it should use.',
        'CONTROL-SURFACE DISCIPLINE — IMPORTANT for amp / drive params:',
        'Fractal models match the real hardware\'s control surface. A Fender',
        'Vibrolux Reverb has Volume / Bass / Treble / Reverb only — no Mid, no',
        'Presence, no separate Master. The AM4 omits absent knobs from the',
        'model\'s display. Writing nonexistent params is doubly wasted: (a) audibly',
        'inert (model engine has no circuit for them) and (b) not preserved —',
        'switching amp.type resets the tone-stack to the new model\'s defaults,',
        'so values "stored behind" a previous model don\'t pop up later.',
        '(Confirmed empirically Session 43, HW-049.)',
        'DEFAULT TO `am4_lookup_lineage` for amp and drive models. The call is cheap',
        '(~50 ms) and the result names the real circuit (manufacturer / model /',
        'era), which tells you what panel to expect. Skip the lookup ONLY for',
        'models you can confidently place as modern high-gain — Mesa Rectifier',
        '/ Boogie family, Diezel, Friedman, EVH 5150, modern post-JCM Marshall,',
        'Bogner, Engl — those reliably expose the full tone-stack (gain / bass',
        '/ mid / treble / presence / master) plus depth.',
        'Categories that USUALLY lack at least one tone-stack knob and will silently',
        'absorb writes if you assume otherwise:',
        '  • Vintage Fenders (Deluxe Reverb, Twin Reverb, Vibrolux, Vibroverb,',
        '    Princeton, Tweed family, Bassman, Champ) — typically NO Master,',
        '    often NO Mid, frequently NO Presence. Knopfler / SRV / Hendrix /',
        '    surf / country tones all live here.',
        '  • Vox AC15 / AC30 family + Top Boost variants — Top Cut instead of',
        '    Treble; no Master; no Mid on most.',
        '  • Pre-Master Marshall (JTM45 / Plexi 1959 / 1962 Bluesbreaker / 1987',
        '    50W) — NO Master volume.',
        '  • Tweed-era / class-A / boutique amps with named-quirk panels.',
        'Anything matching those categories — call `am4_lookup_lineage` first;',
        'don\'t guess. Vintage tones on a famous-name model is the most common',
        'place this discipline gets skipped.',
        'ENUM-NAME REPORTING — IMPORTANT when summarizing what was applied: use',
        'the FULL resolved enum name from the response, not the shorthand the',
        'caller passed in. Example: caller passes `compressor.type: "Studio"`,',
        'response says `compressor.type = 8 (JFET Studio Compressor)`. The',
        'user-facing summary should say "JFET Studio Compressor", not "Studio"',
        '— the resolved name disambiguates which exact model loaded (there\'s a',
        'JFET Studio AND a Studio compressor in the registry; the relaxed',
        'matcher picked one of them and the user deserves to know which).',
        'Same rule for amp.type, drive.type, reverb.type, delay.type, etc. —',
        'parrot the full registered name back, never just the input you sent.',
        'FRESH-PRESET BYPASS DISCIPLINE - IMPORTANT when building a fresh tone:',
        'scene bypass flags are stored separately from block placement and',
        'channel pointers. If the previous preset on the AM4 had a block',
        'bypassed in a particular scene, that bypass STAYS until something',
        'overwrites it. To prevent stale-state leak (e.g. building a Sultans',
        'preset on top of a U1 preset where comp + delay were bypassed in',
        'scene 1), apply_preset auto-defaults every placed block to active',
        '(bypass=false) in every scene you configure, UNLESS you explicitly set',
        '`bypass: { <block>: true }` in that scene\'s entry.',
        'FRESH-BUILD CLEARING: this tool now ACTIVELY CLEARS slots and scenes',
        'you don\'t list. Unlisted slot positions get block_type="none" written.',
        'Unlisted scenes get reset to defaults (channel A on every placed block,',
        'all blocks active, name reset). The device lands on scene 1 after the',
        'build so the user can play immediately on the first section. Override',
        'via `landingScene` if you need to leave the device on a specific scene',
        'for preview.',
        'TEMPO/TIME DISCIPLINE — IMPORTANT for delay / chorus / flanger / phaser /',
        'tremolo / rotary: each block has a `tempo` enum (NONE + musical divisions).',
        'When `tempo` is anything other than NONE, the AM4 LOCKS the block\'s',
        'timing — `delay.time` for delay, `rate` for the modulation blocks — to',
        '(song tempo × division) and silently ignores absolute writes to it.',
        'For DELAY: tempo-synced repeats are the PROFESSIONAL DEFAULT in modern',
        'guitar music. For "ambient" / "obvious" / "rhythmic" / "Edge" / "post-rock"',
        'requests, set `delay.tempo` first and pick a division (1/4 DOT = iconic',
        'Edge; 1/4 = clear repeats; 1/2 DOT or 1/2 = ambient wash; 1/8 DOT =',
        'rhythmic urgency). Use absolute `delay.time` only for "specific ms",',
        'slapback, or free-time asks. For MODULATION blocks (chorus / flanger /',
        'phaser / rotary), prefer free-Hz `rate` — these are textural, not',
        'rhythmic. Tremolo accepts both (rhythmic chops vs vintage warmth).',
        'When you DO write `time`/`rate` in absolute units, set the block\'s',
        '`tempo` to "NONE" FIRST in the same params/channels block — otherwise',
        'the write is silently overridden by the active sync.',
        'COMPRESSOR CONTROL-SURFACE DISCIPLINE — IMPORTANT, this is where',
        'agents trip up most often: the AM4\'s 19 compressor types fall into',
        'TWO distinct control-surface groups, and writing the wrong group\'s',
        'knobs to the wrong type silently no-ops.',
        '',
        '  STUDIO-COMP types (expose threshold, ratio, attack, release,',
        '  auto_makeup, knee_type, detector_type, level, mix):',
        '    • VCA Modern Compressor (0)',
        '    • VCA FF Sustainer (9)',
        '    • VCA Classic Compressor (13)',
        '    • VCA Bus Compressor (10)',
        '    • VCA FB Sustainer (11)',
        '    • Optical Compressor (4)        — LA-2A topology',
        '    • Vari-Mu Tube Compressor (5)',
        '    • Analog Compressor (6)         — also Analog Sustainer (14)',
        '    • JFET Studio Compressor (8)    — 1176 topology',
        '',
        '  PEDAL-STYLE types (expose compression, drive, tone, attack,',
        '  release, level, mix — but NOT threshold/ratio/auto_makeup):',
        '    • Dynami-Comp Classic (7) / Modern (2) / Soft (17)  — MXR Dyna Comp',
        '    • Econo-Dyno-Comp (1)',
        '    • JFET Pedal Compressor (15)',
        '    • Rockguy Compressor (16)',
        '    • Citrus Juicer (18)',
        '    • Compander (12)                — exposes ratio_compansion / time / threshold_thresh2',
        '    • Dynamics Processor (3)        — exposes dynamics / transients (bipolar -10..10)',
        '',
        'TRANSLATION when the user asks for "low threshold, high ratio" on',
        'a PEDAL comp: that\'s "high compression amount" on the pedal\'s',
        'single sensitivity knob. Set `compressor.compression: 8.5` (heavy',
        'squeeze) instead of writing threshold + ratio that don\'t exist.',
        'Studio comps DO accept threshold + ratio directly.',
        '',
        'BEFORE writing compressor params: if you\'re reaching for threshold',
        'or ratio, confirm the type is in the studio-comp list above. If',
        'the user picked a pedal type, use `compression` (0..10 amount)',
        'instead. Skipping this check means the writes ack on the wire',
        'but the device ignores them — the user hears a quieter version',
        'of the previous tone, not the one you described.',
        '',
        'LOUDNESS BUDGET — IMPORTANT for compression-heavy presets: heavy',
        'compressor settings (low threshold + high ratio + mix=100% on',
        'studio comps; high compression on pedal comps) can pull post-comp',
        'signal down 10–20 dB. Without makeup gain the user plays the',
        'preset and hears nothing. To compensate IN THE SAME apply_preset',
        'call:',
        '  • Studio-comp types: enable `compressor.auto_makeup: "On"`.',
        '  • Pedal-comp types: raise `compressor.level` (output level, dB)',
        '    by ~6–12 dB to match a clean reference, OR pick a less-',
        '    aggressive compression amount.',
        'Don\'t discover this when the user reports "preset is too quiet" —',
        'plan the level / auto_makeup write up front.',
        'SCENE STRUCTURE FOR SONGS — IMPORTANT when the user names a specific',
        'song or artist (not a generic tone request like "build me a heavy',
        'rhythm"): default to populating MULTIPLE scenes that match the song\'s',
        'distinct sections, not a single scene. AM4 scenes are the gigging',
        'guitarist\'s killer feature: one preset can hold a clean verse, a',
        'distorted chorus, and a screaming solo, switched between with the',
        'scene footswitch instead of fumbling through preset banks mid-song.',
        'Common patterns: 2 scenes (Verse + Chorus) for songs with a quiet/loud',
        'split; 3 scenes (Verse + Chorus + Solo, or Clean + Rhythm + Lead) for',
        'songs with a notable solo or bridge; 4 scenes when each section is',
        'distinct (Intro + Verse + Chorus + Solo). Each scene needs its own',
        'per-block channel + bypass mapping that realises that section\'s tone',
        '(e.g. drive bypassed in scene 1 / engaged in scene 2 / engaged with',
        'a different channel in scene 3). One-scene is acceptable ONLY when the',
        'song genuinely has one consistent tone start-to-finish (e.g. a punk',
        'track that is palm-muted crunch throughout) — and even then say so',
        'explicitly in your summary so the user knows you considered the',
        'arrangement and chose one scene deliberately. Do NOT default to one',
        'scene because it\'s simpler; the user is testing whether you understood',
        'the song\'s structure.',
        'NAMING DISCIPLINE — IMPORTANT for song-specific tones: set BOTH the',
        'preset name AND every populated scene\'s name. The preset name carries',
        'the song / artist identity ("Sandman", "Sultans of Swing", "Comfortably',
        'Numb"); each scene name carries its song-section role ("Verse",',
        '"Chorus", "Solo", "Intro", "Bridge", "Outro", "Rhythm", "Lead",',
        '"Clean"). A scene named "Solo" tells the user which footswitch to hit',
        'for the lead break; a leftover name from a previously-loaded preset',
        'hides that intent and looks unprofessional. Scene names are not',
        'auto-changed — pass scenes: [{ index: N, name: "<role>" }] for every',
        'scene you populate, alongside slots / preset name. For one-scene',
        'patches, name scene 1.',
        'Validation happens up-front; if any slot/param is invalid (duplicate',
        'position, unknown block type, unknown param for that block, value out',
        'of range, unknown enum name, channel on a block that doesn\'t have',
        'channels, conflicting channel+channels, unknown channel letter), or',
        'any scene entry is invalid (duplicate index, unknown block in',
        'channels/bypass map, non-A/B/C/D letter, bypass value not boolean,',
        'empty scene entry with no channels/bypass/name), the entire call is',
        'rejected with nothing sent. Same ack caveat as set_param/set_params:',
        'wire-acks confirm receipt, not audible change.',
        'REVERSIBILITY / SAVE INTENT: this call hits the WORKING BUFFER only.',
        'The user can audition the tone, tweak it, or switch presets to discard.',
        'Do NOT follow this call with save_to_location / save_preset unless the',
        'user has explicitly asked to save / persist / store the preset. A bare',
        '"make me a preset for X" or "build a tone for Y" is a try-it-out ask,',
        'not a save ask. When in doubt, apply and then ask the user whether to',
        'save.',
      ].join(' '),
      inputSchema: {
        slots: z.array(z.object({
          position: z.number().int().min(1).max(4).describe('Slot position 1..4 (1 = leftmost)'),
          block_type: z.string().describe(
            'Block name ("amp", "reverb", "compressor", "none", …). Call list_block_types for the full list.',
          ),
          channel: z.union([z.string(), z.number()]).optional().describe(
            'Optional A/B/C/D (or 0..3). Single-channel shortcut — switches the block to this channel, then writes `params` there. Mutually exclusive with `channels`. Rejected for blocks without channels.',
          ),
          params: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe(
            'Map of param name → display value within the block, e.g. { gain: 6, bass: 5 }. Writes to the current channel, or to `channel` if supplied. Mutually exclusive with `channels`. Omit to just place the block.',
          ),
          channels: z.record(
            z.string(),
            z.record(z.string(), z.union([z.number(), z.string()])),
          ).optional().describe(
            'Map of channel letter (A/B/C/D, case-insensitive) → params for that channel. Fills multiple channels of the same block in one slot, e.g. { A: { gain: 3 }, D: { gain: 8 } }. Mutually exclusive with `channel` and `params`. Only valid for amp / drive / reverb / delay.',
          ),
        })).min(1).describe('Ordered list of slots to configure'),
        name: z.string().max(32).optional().describe(
          'Optional working-buffer preset name (≤32 ASCII-printable chars). Written after all slot writes. Does NOT save — persistence still requires a separate save_to_location / save_preset call.',
        ),
        scenes: z.array(z.object({
          index: z.number().int().min(1).max(4).describe('Scene number 1..4 (matches AM4-Edit numbering).'),
          name: z.string().max(32).optional().describe(
            'Optional scene name (<=32 ASCII-printable chars). Space-padded on the wire.',
          ),
          channels: z.record(z.string(), z.string()).optional().describe(
            'Map of block name -> channel letter (A/B/C/D). Points this scene at a specific channel per block, e.g. { amp: "A", drive: "A" }. Only blocks with channels (amp / drive / reverb / delay) may appear.',
          ),
          bypass: z.record(z.string(), z.boolean()).optional().describe(
            'Map of block name -> bypass flag. true = silence the block on this scene (block stays in the slot, just passes input through); false = active. Example: { drive: true, reverb: false }.',
          ),
        })).max(4).optional().describe(
          'Per-scene overrides. Each scene entry configures one of the four scenes; at least one of channels / bypass / name must be supplied per entry. Scenes you do NOT list are AUTO-RESET to fresh-build defaults (channel A on every placed block, all blocks active, name cleared).',
        ),
        landingScene: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().describe(
          'Optional 1..4. The scene the AM4 lands on after the build. Defaults to 1 so the user can play immediately on the song\'s first section. Override only when you need to leave the device on a specific scene for preview.',
        ),
      },
    }, async ({ slots, name, scenes, landingScene }) => {
      let prepared: ApplyPresetPreparedWrite[];
      let nameWriteBytes: number[] | undefined;
      try {
        ({ prepared, nameWriteBytes } = prepareApplyPresetWrites({ slots, name, scenes, landingScene }));
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }

      // --- Send pass ---
      const conn = ensureMidi();
      const capture = recordInbound(conn);
      let runResult: ReturnType<typeof formatApplyPresetResult>;
      try {
        const wireResult = await runApplyPresetWires(conn, prepared, nameWriteBytes, name);
        runResult = formatApplyPresetResult(wireResult);
      } finally {
        capture.unsubscribe();
      }
      const body = [runResult.header, ...runResult.stateLines, ...runResult.lines, '', formatInboundCapture(capture)].join('\n');
      return {
        content: [{ type: 'text', text: body }],
      };
    });

    // --- am4_apply_preset internals (extracted into applyExecutor.ts) ---
    //
    // The validate + wire-send + result-format pipeline lives in
    // `src/fractal/am4/tools/applyExecutor.ts`. apply.ts imports it (above)
    // so the BK-051 unified `apply_preset` tool can share the same executor.
    // The types ApplyPreset{Slot,Scene,}Input + ApplyPresetAtResult are also
    // imported above for the tool handlers below.


    // Shared zod sub-schemas for the preset shape carried by apply_preset_at
    // and apply_setlist. Mirrors the inline schema on `am4_apply_preset` —
    // kept in lockstep with that tool's input. Validation depth still happens
    // inside `prepareApplyPresetWrites`; this is just the shallow shape gate.
    const presetSlotSchema = z.object({
      position: z.number().int().min(1).max(4),
      block_type: z.string(),
      channel: z.union([z.string(), z.number()]).optional(),
      params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      channels: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.string()]))).optional(),
    });
    const presetSceneSchema = z.object({
      index: z.number().int().min(1).max(4),
      name: z.string().max(32).optional(),
      channels: z.record(z.string(), z.string()).optional(),
      bypass: z.record(z.string(), z.boolean()).optional(),
    });
    const presetShapeSchema = z.object({
      slots: z.array(presetSlotSchema).min(1),
      name: z.string().max(32).optional(),
      scenes: z.array(presetSceneSchema).max(4).optional(),
      landingScene: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    });

    server.registerTool('am4_apply_preset_at', {
      description: [
        'Build a preset at a specific location atomically: switches the AM4 to',
        'the target, applies the new content, and saves. Replaces the apply_preset',
        '+ save_to_location two-call pattern.',
        'SAVE INTENT REQUIRED: call this tool ONLY when the user has explicitly',
        'asked to save, build at, persist to, or store the preset at a slot',
        '(e.g. "save this to G1", "build me X at H03", "put it on Z04"). Do NOT',
        'call apply_preset_at as the default for a try-it-out tone request. For',
        'tone work that should NOT save, use `am4_apply_preset` instead: that',
        'tool writes to the working buffer only and is reversible by switching',
        'presets.',
        'BATCH-LOOP PATTERN: For a multi-preset ask ("build me presets for',
        'these 14 songs", "load this setlist into G-K", etc.), call this tool',
        'N times in sequence. The user\'s ask IS the confirmation - they named',
        'the slots and the songs, so just build. Do NOT respond with a numbered',
        'plan of all N presets and a "go" gate first. That summary-first',
        'pattern is friction: it forces all-at-once cross-preset planning,',
        'which (a) is slower than per-preset focused decisions, (b) burns',
        'inference on prose the user didn\'t ask for, and (c) breaks the',
        'live-build flow where the user is playing patches as you save them.',
        'CORRECT shape: optional one-line acknowledgement ("starting the 14",',
        'or skip even that), one batched lookup_lineages pre-flight if any',
        'enum names are uncertain, one batched scan_locations pre-flight if',
        'overwrite-warning is needed, then loop apply_preset_at calling once',
        'per preset, narrating one short line between calls ("3 of 14 done:',
        'The Offering on G03, 2 scenes"). Each apply_preset_at call resolves',
        'THAT preset\'s full block config inside its own argument structure -',
        'that IS the focused per-preset decision moment. Multi-paragraph',
        'cross-preset analysis between calls is the failure mode this pattern',
        'is designed to PREVENT. The user can interrupt mid-batch if a preset',
        'is wrong; they don\'t need to pre-approve a plan.',
        'ICONIC AMP SHORTCUTS - the named amp on each line is the registered',
        'enum string, safe to use directly as `amp.type`. These cover the iconic',
        'artist/song mappings most setlists hit. For DRIVE pedals there is no',
        'shortcuts list - drive enum names (PI Fuzz, T808 OD, Big Muff Pi family,',
        'etc.) need a lineage lookup to confirm spelling before writes (the',
        'validator rejects "Fuzz Pi" even though "PI Fuzz" is right). Same for',
        'amp variants where the shortcut gives the family but not the exact',
        'suffix (Recto2 Red Modern vs Recto2 Orange Modern, Dizzy V4 vs Dizzy V4',
        'Silver 4). When in doubt, batch the unknowns through am4_lookup_lineages.',
        '  Mike Campbell / Tom Petty rhythms ........ Class-A 30W (Vox AC30)',
        '  Brian May / Queen ........................ Class-A 30W (Vox AC30)',
        '  The Edge / U2 ............................ Class-A 30W (Vox AC30)',
        '  Carlos Santana ........................... USA MK IIC+ (Mesa Boogie Mark)',
        '  Eddie Van Halen / Sammy ramps ............ Recto2 family (Mesa Dual Rectifier)',
        '  Modern djent / Sleep Token / Periphery ... Recto2 / Dizzy V4 (Mesa, Diezel)',
        '  David Gilmour clean rhythm ............... Hipower Brilliant (Hiwatt DR103)',
        '  David Gilmour leads ...................... Big Muff drive INTO Hipower',
        '  Hendrix / SRV / classic rock crunch ...... 1959SLP Normal/Jumped (Marshall Plexi)',
        '  Mark Knopfler clean ...................... Deluxe Verb Normal (Fender Deluxe Reverb)',
        '  Andy Summers / Police clean .............. Deluxe Verb Normal + chorus + delay',
        '  Lindsey Buckingham fingerpicked .......... Deluxe Verb Normal',
        '  Slash / GnR rhythm ....................... 1959SLP Normal',
        '  Pop punk / Green Day / Sum 41 ............ Recto2 Red Modern, scooped mids',
        '  Reggae / ska clean upstroke .............. Deluxe Verb Normal, low gain',
        '  Funk single-coil clean ................... Deluxe Verb Normal + heavy comp',
        'For amps NOT in this list, plus EVERY drive pedal you reference, batch',
        'them through `am4_lookup_lineages` (plural) at the start of the build',
        'so the canonical enum string is in hand before any apply_preset_at',
        'writes go out. One lineage round-trip is much cheaper than retrying',
        'failed apply_preset_at calls, which abort the whole call on enum',
        'mismatch.',
        'REVERB / DELAY CANONICAL-FORM CHEAT SHEET - common type-string',
        'mistakes. The validator does fuzzy / substring matching, so a guess',
        'that uniquely resolves to one canonical name is accepted. A guess',
        'that\'s ambiguous (matches multiple) or has no match at all gets',
        'rejected with the canonical list in the error message.',
        '  REVERB type format is `<Family>, <Size>` comma-separated. The',
        '  family-then-size order is mandatory. Canonical: `Room, Small`,',
        '  `Room, Medium`, `Room, Large`, `Hall, Small`, `Hall, Medium`,',
        '  `Hall, Large`, `Plate, Small`, `Plate, Medium`, `Plate, Large`,',
        '  `Spring, Small`, `Spring, Medium`, `Spring, Large`, `Chamber,',
        '  Small`, `Chamber, Medium`, `Chamber, Large`.',
        '  AMBIGUOUS / WRONG common guesses: `Medium Room` (wrong word order),',
        '  `Spring Reverb` (no match), `Plate Reverb` (no match). Bare family',
        '  names like `Spring` or `Hall` are AMBIGUOUS - Spring family alone',
        '  has 10 variants - so always include the size.',
        '  DELAY type canonical names: `Mono Tape`, `Stereo Tape`, `Analog',
        '  Mono`, `Analog Stereo`, `Digital Mono`, `Digital Stereo`, `Ping-',
        '  Pong`, `Reverse`, `Dual Delay`. The fuzzy matcher accepts',
        '  `Mono Tape Delay` / `Stereo Tape Delay` (suffix is harmless,',
        '  resolves uniquely). WRONG: `Tape Echo`, `Tape Delay` (no match',
        '  in registry; "Echo" not a valid keyword anywhere). Bare `Digital`',
        '  is AMBIGUOUS - matches Digital Mono / Digital Stereo / Vintage',
        '  Digital. Always specify mono/stereo or pick a non-Digital family.',
        '  AMP variant case study: `Dizzy V4` alone is AMBIGUOUS - matches',
        '  Silver 2 / Silver 3 / Silver 4. Same pattern for any amp-family',
        '  with numbered variants. Use lookup_lineages if you need the exact',
        '  variant for a song.',
        '  COMPRESSOR types are documented in the COMPRESSOR CONTROL-SURFACE',
        '  DISCIPLINE clause below - read that block before reaching for any',
        '  comp param.',
        'For any reverb / delay / compressor type that does NOT appear above,',
        'use lookup_lineages to confirm the canonical name before writing.',
        'DISPLAY HONESTY RATIONALE: the switch-first step ensures the AM4\'s',
        'active location matches the build target throughout, so the device\'s',
        'display label and the working buffer\'s content stay consistent. No',
        'silent drift if the user looks at the device mid-build, and no risk of',
        'saving content into a slot the user thinks they\'re still auditioning.',
        'PRE-FLIGHT SCAN: before calling on a non-empty target, run',
        '`am4_scan_locations` and surface what would be overwritten. Bulk',
        'overwrites of customised user presets are the worst failure mode for',
        'this workflow; surface the conflict and let the user confirm before',
        'destroying their work. Empty targets do not need this gate.',
        'PRESET SHAPE: the `preset` field accepts the full apply_preset input',
        '(slots, optional name, optional scenes, optional landingScene); same',
        'validation rules apply, and any validation failure rejects the entire',
        'call before any wire writes leave the host. See `am4_apply_preset` for',
        'the full schema including channel-shape rules, scene bypass defaults,',
        'control-surface discipline, and tempo / time gating.',
        'SLOT/SCENE SHAPE TLDR - the four schema mistakes that cost retries on',
        'every multi-preset batch if the agent guesses without reading this:',
        '  (1) On a slot, choose ONE of `channels` (per-channel A/B/C/D map)',
        '      OR `params` (single flat dict). Never both. Never combine with',
        '      a top-level `channel: "A"` shortcut either - mutually exclusive',
        '      with `channels`.',
        '  (2) Only `amp`, `drive`, `reverb`, `delay` expose channels A/B/C/D.',
        '      Mod / utility blocks - `chorus`, `flanger`, `phaser`, `rotary`,',
        '      `tremolo`, `compressor`, `gate`, `enhancer`, `wah`, `volpan`,',
        '      `filter`, `geq`, `peq` - take `params` only. Putting `channels`',
        '      on a mod block is rejected at validate.',
        '  (3) Scene `bypass` is keyed by BLOCK_TYPE STRING, not slot position',
        '      number. CORRECT: `bypass: { drive: true, reverb: false }`.',
        '      WRONG: `bypass: { "1": true, "2": false }`.',
        '  (4) Scene `channels` is also keyed by block_type string, same rule.',
        '      CORRECT: `channels: { amp: "B", drive: "A" }`. WRONG: keyed by',
        '      slot position.',
        'Mental model: the slot block itself has channels-or-params; the scene',
        'just *names* which block (by type) flips bypass / picks a channel for',
        'that scene. Slot positions are an internal index, never a key in scene',
        'config.',
        'FRESH-BUILD CLEARING: this tool inherits apply_preset\'s fresh-build',
        'clearing behaviour - unspecified slots get block_type="none" written',
        'and unspecified scenes are reset to defaults (channel A on every placed',
        'block, all blocks active, name cleared) on every call. The device lands',
        'on scene 1 by default after the build so the user can play immediately',
        'on the song\'s first section; override via preset.landingScene.',
        'PERFORMANCE: ~3-5 seconds wire time per preset depending on scene',
        'count and per-channel param density. Tell the user upfront if calling',
        'several in sequence; for >2 entries prefer `am4_apply_setlist` for one',
        'atomic batch with progress narration.',
        'OUTPUT: returns a JSON object with { ok, location, applied, wallTimeMs }',
        'on success, or { ok: false, location, step, error, wallTimeMs } on',
        'failure. The `step` field names which primitive failed (validate /',
        'switch / apply / save) for clean error attribution.',
      ].join(' '),
      inputSchema: {
        location: z.string().describe(
          'AM4 preset location, format: bank letter A..Z + sub-index 01..04 (e.g. "G01", "G1", "M03", "Z04"). Short and zero-padded forms both accepted.',
        ),
        preset: presetShapeSchema.describe(
          'Preset content to build at the target location. Same shape as am4_apply_preset\'s input: slots (required), optional name, optional scenes.',
        ),
      },
    }, async ({ location, preset }) => {
      const startMs = Date.now();
      const normalized = String(location).trim().toUpperCase();
      let locationIndex: number;
      try {
        locationIndex = parseLocationCode(normalized);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const failure: ApplyPresetAtFailure = {
          ok: false,
          location: normalized,
          step: 'validate',
          error: `Invalid location "${location}": ${reason}`,
          wallTimeMs: Date.now() - startMs,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          isError: true,
        };
      }
      const conn = ensureMidi();
      const capture = recordInbound(conn);
      let result: ApplyPresetAtResult;
      try {
        result = await runApplyPresetAt(conn, locationIndex, preset as ApplyPresetInput);
      } finally {
        capture.unsubscribe();
      }
      const body = [JSON.stringify(result, null, 2), '', formatInboundCapture(capture)].join('\n');
      return {
        content: [{ type: 'text', text: body }],
        isError: !result.ok,
      };
    });

    server.registerTool('am4_apply_setlist', {
      description: [
        'Bulk-apply a setlist to the AM4 in one call. Replaces a 30-tool-call',
        'apply+save loop with a single atomic batch. Each entry runs the same',
        'switch + apply + save sequence as `am4_apply_preset_at`; the batch',
        'shares one validation pass up front and one inbound-MIDI capture',
        'across the whole sequence.',
        'WHEN TO USE: Prefer this tool when you have a fully-specified setlist',
        'plan ready (loaded from a config file, copied from prior session notes,',
        'etc.) where every preset\'s slots / channels / params / scenes are',
        'decided up front. For CREATIVE batch builds where you are picking amp',
        'models, scene structures, and tone targets per song from natural-',
        'language direction, prefer calling `am4_apply_preset_at` in sequence',
        '(one per preset, narrating progress between calls) instead. Per-preset',
        'focused decisions are faster and more reliable than cramming 15',
        'simultaneous decisions into one tool call: each apply_preset_at result',
        'is an immediate checkpoint, vs apply_setlist where any single entry\'s',
        'validation error fails all of them. The user pastes the setlist prompt',
        'once and walks away in either flow; the difference is whether you',
        'think about the setlist once (apply_setlist) or in 15 small focused',
        'steps (apply_preset_at loop).',
        'DISPLAY-DRIFT CAVEAT: while the batch runs, the AM4\'s active location',
        'moves through the setlist (G01 -> G02 -> ... -> J03 etc.) as each',
        'preset is built and saved. If you were playing on a non-target preset',
        'before the batch, the AM4 will leave that slot. Post-batch state shows',
        'the last-built location with its content. Direct-to-slot writes that',
        'bypass this entirely are queued for v0.1.x once the preset binary',
        'format decode lands.',
        'PRE-FLIGHT SCAN: before calling on a target range that may contain',
        'non-empty user presets, run `am4_scan_locations` over the locations in',
        'the batch and surface what would be overwritten. Silent overwrites',
        'are the worst possible failure mode for this workflow. Empty targets',
        'or scratch slots (Z04) do not need this gate.',
        'PERFORMANCE: ~5-10 minutes wall time for a 15-preset setlist. Frame',
        'as a "load before the show" workflow, not "load between songs". Tell',
        'the user the wall-time estimate up front; do not start the batch and',
        'leave them watching a silent terminal.',
        'FAILURE SEMANTICS: `on_error="stop"` (default) halts immediately on',
        'first error and surfaces the failed location plus the unprocessed',
        '`remaining` list so the agent can decide whether to retry, rewind,',
        'or continue. `on_error="continue"` logs each error in the per-entry',
        'results and proceeds through the rest of the batch.',
        'DRY RUN: pass `dry_run: true` to run validation only; every entry is',
        'shape-validated against the same rules as live execution, but no wire',
        'writes leave the host. Useful for catching schema mistakes before',
        'committing to the wall time of a real batch.',
        'OUTPUT: returns { total, applied, failed, remaining, results,',
        'totalWallTimeMs, finalActiveLocation }. Per-entry results carry',
        '{ location, status, error?, wallTimeMs }. Caller can summarise from',
        'these without re-parsing prose.',
        'PER-ENTRY VERIFICATION: by default each successful apply is followed',
        'by an am4_get_preset_name read against the just-written location and',
        'the response is compared (case-insensitive trim) against the entry\'s',
        'preset.name. A mismatch (or read timeout) flips the entry to status',
        '"error" and on_error semantics handle the rest. Adds ~50 ms per',
        'entry; for a 20-slot batch that is ~1 s extra wall time. Disable',
        'with verify=false only if the caller explicitly accepts the silent-',
        'failure risk (e.g. an entry with no name set, or a perf-critical',
        'load where post-batch scan is acceptable).',
      ].join(' '),
      inputSchema: {
        presets: z.array(z.object({
          location: z.string(),
          preset: presetShapeSchema,
        })).min(1).max(26).describe(
          '1..26 setlist entries. Each entry pairs a target location with a preset shape (same as am4_apply_preset\'s input). Locations must be unique within the batch.',
        ),
        on_error: z.enum(['stop', 'continue']).optional().describe(
          'Failure handling. "stop" (default) halts on first error; "continue" logs the error and proceeds.',
        ),
        dry_run: z.boolean().optional().describe(
          'Validate every entry without sending any wire bytes. Returns { ok, total, validated, message }. Default false.',
        ),
        verify: z.boolean().optional().describe(
          'After each successful apply, read the preset name back and compare to entry.preset.name. Default true. Pass false only if the caller explicitly accepts silent-failure risk.',
        ),
      },
    }, async ({ presets, on_error, dry_run, verify }) => {
      const startMs = Date.now();
      const onError: 'stop' | 'continue' = on_error ?? 'stop';
      const dryRun = dry_run ?? false;
      const verifyEnabled = verify ?? true;

      // --- Validation pass: shape, location parsing, uniqueness, per-entry
      //     prepare. Up-front rejection means a batch with one bad entry never
      //     emits a partial wire write.
      const resolved: { shortLocation: string; locationIndex: number; preset: ApplyPresetInput }[] = [];
      const seenLocations = new Set<number>();
      for (let i = 0; i < presets.length; i++) {
        const entry = presets[i];
        const at = `presets[${i}]`;
        const normalized = String(entry.location).trim().toUpperCase();
        let locationIndex: number;
        try {
          locationIndex = parseLocationCode(normalized);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: false,
                step: 'validate',
                error: `${at}: invalid location "${entry.location}": ${reason}`,
              }, null, 2),
            }],
            isError: true,
          };
        }
        if (seenLocations.has(locationIndex)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: false,
                step: 'validate',
                error: `${at}: location ${formatLocationDisplay(locationIndex)} appears more than once in the batch; each location may appear at most once per call`,
              }, null, 2),
            }],
            isError: true,
          };
        }
        seenLocations.add(locationIndex);
        // Validate the preset shape via the shared prepare pass — same rules
        // as live execution, no wire bytes emitted. Failure here aborts the
        // whole batch (consistent with apply_preset's up-front rejection).
        try {
          prepareApplyPresetWrites(entry.preset as ApplyPresetInput);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ok: false,
                step: 'validate',
                error: `${at} (location ${formatLocationDisplay(locationIndex)}): ${reason}`,
              }, null, 2),
            }],
            isError: true,
          };
        }
        resolved.push({
          shortLocation: formatLocationDisplay(locationIndex),
          locationIndex,
          preset: entry.preset as ApplyPresetInput,
        });
      }

      if (dryRun) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              total: resolved.length,
              validated: resolved.length,
              message: `Validated ${resolved.length} entry/entries; no wire writes performed.`,
            }, null, 2),
          }],
        };
      }

      // --- Live execution. One inbound capture spans the whole batch so
      //     callers can inspect ack timeline across the sequence if needed.
      const conn = ensureMidi();
      const capture = recordInbound(conn);
      const results: { location: string; status: 'ok' | 'error'; error?: string; wallTimeMs: number }[] = [];
      let applied = 0;
      let failed = 0;
      let finalActiveLocation = resolved[0].shortLocation;
      let stopIndex: number | undefined;
      try {
        for (let i = 0; i < resolved.length; i++) {
          const r = resolved[i];
          const result = await runApplyPresetAt(conn, r.locationIndex, r.preset);
          finalActiveLocation = r.shortLocation;
          if (!result.ok) {
            failed++;
            results.push({
              location: r.shortLocation,
              status: 'error',
              error: `${result.step}: ${result.error}`,
              wallTimeMs: result.wallTimeMs,
            });
            if (onError === 'stop') {
              stopIndex = i;
              break;
            }
            continue;
          }
          // Per-entry verification: read the just-written name back and
          // compare to the expected name from the entry. This catches the
          // silent-failure case where the AM4 ack-ed each individual write
          // (so runApplyPresetAt returns ok=true) but the saved preset
          // didn't actually land at the target slot - usually because the
          // user nudged the preset knob mid-batch or USB contention dropped
          // a save packet. Without this check, the batch reports success
          // and the affected slot keeps its prior content silently.
          // Skipped if verify=false or if the entry has no expected name
          // to compare against (entry.preset.name omitted).
          const expectedName = r.preset.name?.trim();
          if (verifyEnabled && expectedName !== undefined && expectedName !== '') {
            const verifyStart = Date.now();
            let verifyError: string | undefined;
            try {
              const parsed = await readPresetName(conn, r.locationIndex);
              const actualName = parsed.isEmpty ? '<EMPTY>' : parsed.name;
              const expectedCmp = expectedName.toLowerCase();
              const actualCmp = actualName.trim().toLowerCase();
              if (expectedCmp !== actualCmp) {
                verifyError =
                  `verification mismatch: applied "${expectedName}" but device reads back "${actualName}". ` +
                  `The save likely did not land - the user may have nudged the preset knob mid-batch.`;
              }
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              verifyError =
                `verification timeout: could not read back preset name at ${r.shortLocation} (${reason}). ` +
                `Save status unknown.`;
            }
            if (verifyError) {
              failed++;
              results.push({
                location: r.shortLocation,
                status: 'error',
                error: verifyError,
                wallTimeMs: result.wallTimeMs + (Date.now() - verifyStart),
              });
              if (onError === 'stop') {
                stopIndex = i;
                break;
              }
              continue;
            }
          }
          applied++;
          results.push({ location: r.shortLocation, status: 'ok', wallTimeMs: result.wallTimeMs });
        }
      } finally {
        capture.unsubscribe();
      }

      const remaining =
        stopIndex !== undefined
          ? resolved.slice(stopIndex + 1).map((r) => r.shortLocation)
          : [];
      const summary = {
        total: resolved.length,
        applied,
        failed,
        remaining,
        results,
        totalWallTimeMs: Date.now() - startMs,
        finalActiveLocation,
      };
      const body = [JSON.stringify(summary, null, 2), '', formatInboundCapture(capture)].join('\n');
      return {
        content: [{ type: 'text', text: body }],
        isError: failed > 0,
      };
    });
}
