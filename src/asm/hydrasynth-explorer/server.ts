#!/usr/bin/env node
/**
 * Hydrasynth Explorer — MCP server (stdio).
 *
 * Side-branch exploratory work — see CLAUDE.md and
 * `memory/feedback_am4_depth_gates_wave_expansion.md`. This server
 * is meant to run alongside the AM4 server in Claude Desktop, not
 * replace it.
 *
 * M1 tool surface (output-only — the MIDI input listener for
 * bidirectional Macro triggers is M5):
 *
 *   - hydra_set_param      write any of the 117 charted CC params by id
 *   - hydra_set_macro      shorthand for Macros 1-8 (CCs 16-23)
 *   - hydra_switch_patch   bank-select MSB/LSB + Program Change
 *   - hydra_play_note      Note On + (after duration) Note Off
 *   - hydra_list_enum_values discover enum-table contents (wave/filter/FX names)
 *   - hydra_param_catalog  fallback search across the full 1175-entry NRPN catalog
 *
 * MIDI is opened lazily on the first tool call so the server can
 * register with Claude Desktop even if the Hydrasynth is unplugged.
 *
 * Run standalone for a sanity check:
 *   npx tsx src/asm/hydrasynth-explorer/server.ts
 *
 * Claude Desktop wiring — add to %APPDATA%\Claude\claude_desktop_config.json:
 *
 *   "hydrasynth": {
 *     "command": "npx",
 *     "args": ["tsx", "C:\\\\dev\\\\mcp-midi-tools\\\\src\\\\asm\\\\hydrasynth-explorer\\\\server.ts"],
 *     "env": {}
 *   }
 *
 * Important: CCs 0/1/7/11/32/64/123 (the "system" category in
 * params.ts) work whether the device's Param TX/RX is set to CC,
 * NRPN, or Off. The other 110 CCs require Param TX/RX = CC on the
 * device's MIDI page 10 — otherwise the device receives the bytes
 * but doesn't act on them.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import {
  HYDRASYNTH_PARAMS,
  HYDRASYNTH_PARAMS_BY_ID,
} from './params.js';
import { findHydraNrpn, type HydrasynthNrpn } from './nrpn.js';
import { HYDRASYNTH_ENUMS } from './enums.js';
import {
  resolveNrpnValue,
  nrpnMessagesFor,
  findMatchingNrpns,
  formatNrpnHit,
} from './encoding.js';
import {
  connectHydrasynth,
  listHydrasynthOutputs,
  type HydrasynthConnection,
} from './midi.js';
import { wrapSysex, unwrapSysex } from './sysexEnvelope.js';
import { splitIntoChunks, PATCH_CHUNK_COUNT, encodePatch } from './patchEncoder.js';
import { INIT_PATCH_BUFFER } from './initPatchBuffer.js';

// -- MIDI lazy-init -------------------------------------------------------

let midi: HydrasynthConnection | undefined;
let midiError: Error | undefined;

function ensureMidi(): HydrasynthConnection {
  if (midi) return midi;
  if (midiError) throw midiError;
  try {
    midi = connectHydrasynth();
    return midi;
  } catch (err) {
    midiError = err instanceof Error ? err : new Error(String(err));
    throw midiError;
  }
}

/**
 * Reset cached MIDI state so the next ensureMidi() re-attempts connect.
 * Used by hydra_reconnect_midi when the user plugs in the device after
 * the server has already cached "not connected" — without this, every
 * subsequent tool call keeps throwing the same stale error forever.
 *
 * Session 47 / HW-060 follow-up: founder reported the device-plugged-
 * in-mid-session case where list_midi_ports saw the device momentarily
 * but apply_patch kept failing because the cached midiError prevented
 * re-connect.
 */
/**
 * Last successful `hydra_apply_patch` call's overrides + timestamp.
 * Used to flag near-duplicate retries — Session 48 ambient-pad bug:
 * Claude Desktop misread the missing chunk-acks as failure and looped
 * the same call four times. The retry detection is a soft signal in
 * the response text only; the wire write still happens (the user
 * might be deliberately re-testing).
 */
let lastApplyPatch: { signature: string; targetSlot: string; at: number } | undefined;

const APPLY_PATCH_DUP_WINDOW_MS = 30_000;

function resetMidiHandle(): { wasConnected: boolean; previousError: string | undefined } {
  const wasConnected = midi !== undefined;
  const previousError = midiError?.message;
  if (midi) {
    try {
      midi.close?.();
    } catch {
      // best-effort close — if it throws, the underlying handle is
      // dead anyway and we want to reset on the way out.
    }
  }
  midi = undefined;
  midiError = undefined;
  return { wasConnected, previousError };
}

// -- MIDI-byte helpers ----------------------------------------------------

const DEFAULT_CHANNEL = 1;

function ccBytes(channel: number, cc: number, value: number): number[] {
  const status = 0xB0 | ((channel - 1) & 0x0F);
  return [status, cc & 0x7F, value & 0x7F];
}

/**
 * Send a Hydrasynth NRPN write — 4 sequential CC messages.
 *
 * Each CC must be its own `sendMessage()` call. node-midi expects one
 * MIDI message per invocation; bundling 12 bytes into one call makes
 * the device only see the first CC (the NRPN address MSB).
 *
 * Encoding logic (multi-slot dataMsb, 14-bit value split) lives in
 * `encoding.ts` so it can be golden-tested without a MIDI handle.
 */
function sendNrpn(conn: HydrasynthConnection, channel: number, entry: HydrasynthNrpn, value: number): void {
  for (const msg of nrpnMessagesFor(entry, channel, value)) {
    conn.send(msg);
  }
}

function noteOnBytes(channel: number, note: number, velocity: number): number[] {
  const status = 0x90 | ((channel - 1) & 0x0F);
  return [status, note & 0x7F, velocity & 0x7F];
}

function noteOffBytes(channel: number, note: number): number[] {
  const status = 0x80 | ((channel - 1) & 0x0F);
  return [status, note & 0x7F, 0x00];
}

function programChangeBytes(channel: number, program: number): number[] {
  const status = 0xC0 | ((channel - 1) & 0x0F);
  return [status, program & 0x7F];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// -- Note-name parser -----------------------------------------------------

const SEMITONE_BY_LETTER: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * Accept either a raw MIDI note number (60) or a scientific pitch
 * notation string ("C4", "F#3", "Bb-1"). Returns the 0..127 note.
 *
 * Octave numbering: middle C = C4 = 60 (the Yamaha convention used
 * by the Hydrasynth manual and most modern DAWs).
 */
function parseNote(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 127) {
      throw new Error(`Note number out of range 0..127: ${input}`);
    }
    return Math.round(input);
  }
  const m = input.trim().match(/^([A-G])([#b]?)(-?\d+)$/i);
  if (!m) {
    throw new Error(
      `Cannot parse note "${input}". Expected a number 0..127 or a name like "C4", "F#3", "Bb-1".`,
    );
  }
  const semitone = SEMITONE_BY_LETTER[m[1]!.toUpperCase()]!;
  const accidental = m[2] === '#' ? 1 : m[2]?.toLowerCase() === 'b' ? -1 : 0;
  const octave = Number.parseInt(m[3]!, 10);
  const note = (octave + 1) * 12 + semitone + accidental;
  if (note < 0 || note > 127) {
    throw new Error(`Note "${input}" resolves to ${note}, outside MIDI range 0..127.`);
  }
  return note;
}

// -- Bank parser ----------------------------------------------------------

/** Accept "A".."H" (case-insensitive) or 0..7. Returns 0..7. */
function parseBank(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0 || input > 7) {
      throw new Error(`Bank index out of range 0..7: ${input}`);
    }
    return input;
  }
  const letter = input.trim().toUpperCase();
  if (!/^[A-H]$/.test(letter)) {
    throw new Error(`Bank "${input}" must be a letter A..H or a number 0..7.`);
  }
  return letter.charCodeAt(0) - 'A'.charCodeAt(0);
}

// -- Param-name cheat sheet ----------------------------------------------

/**
 * Single-line dev-mode preamble prepended to every Hydrasynth tool's
 * description. Tells the calling LLM (Claude Desktop, primarily) that
 * the surface is changing — memorized param names, ranges, or behaviors
 * from prior sessions may be stale. Live tool descriptions and error
 * messages are authoritative.
 *
 * Kept compact (one paragraph) so it doesn't bury the actual tool
 * documentation. Single-source so cross-tool wording stays consistent.
 */
const HYDRA_DEV_MODE_PREAMBLE = [
  '⚠ This Hydrasynth tool surface is in active development. Treat THIS',
  '  description and runtime error messages as authoritative — do NOT',
  '  rely on memorized param names, value ranges, or behaviors from',
  '  prior sessions. If a write fails on a name, call',
  '  `hydra_param_catalog({ search: "<keyword>" })` to see what is',
  '  currently mapped. Tool API may change between sessions.',
  '',
].join('\n');

/**
 * Inline cheat sheet of common engine parameter names — shared by both
 * `hydra_set_engine_param` and `hydra_set_engine_params` descriptions.
 *
 * The catalog is large (1175 entries) but most patch-design work uses
 * the same ~50 parameters. Listing them in the tool description means
 * Claude doesn't need to call `hydra_param_catalog` to discover names —
 * which was burning multiple round-trips per patch build.
 *
 * Naming patterns to deduce the rest:
 *   - Slot families (osc1/2/3, env1/2/3/4/5, lfo1/2/3/4/5, filter1/2,
 *     mutator1/2/3/4, mod1..32) follow {family}{slot}{field} convention:
 *     osc1type, env3decaysyncoff, lfo2gain, etc.
 *   - Time-domain envelope+lfo params have *syncoff* (free-running ms)
 *     and *syncon* (BPM-synced) variants — use *syncoff* by default.
 *   - CC-style dot names ("env1.attack", "mixer.osc1_vol", "filter1.res")
 *     are accepted as aliases everywhere alongside the canonical NRPN
 *     names — pick whichever feels natural.
 */
const ENGINE_PARAM_CHEAT_SHEET = `
Common parameter names (both styles work — pick whichever):

OSCILLATORS  — osc1/osc2/osc3 (slot-disambiguated):
  osc1type / osc2type / osc3type           wave selector — accepts names: "Sine", "Triangle", "Saw", "Square", "Pulse 1".."Pulse 6", "Horizon 1..8", and ~200 more (call hydra_list_enum_values("OSC_WAVES"))
  osc1semi / osc2semi / osc3semi           coarse pitch (-36..+36 semitones)
  osc1cent / osc2cent / osc3cent           fine tune (-50..+50 cents)
  osc1mode / osc2mode / osc3mode           "Single" or "WaveScan"
  osc1wavscan / osc2wavscan                wavescan position
  osc1keytrack / osc2keytrack / osc3keytrack

MIXER  (canonical or dot-style):
  mixerosc1vol / mixer.osc1_vol            OSC 1 volume
  mixerosc2vol / mixer.osc2_vol            OSC 2 volume
  mixerosc3vol / mixer.osc3_vol            OSC 3 volume
  mixerosc1pan / mixer.osc1_pan            OSC 1 pan (etc. for osc2/osc3)
  mixernoisevol / mixer.noise_vol          noise volume
  mixerringmodvol / mixer.ring_mod_vol     ring-mod volume

FILTER 1  (use names for type — "LP Ladder 12", "LP Ladder 24", "Vowel", "BP 3-Ler", etc., 16 options):
  filter1type
  filter1cutoff / filter1.cutoff
  filter1resonance / filter1.res
  filter1drive / filter1.drive
  filter1keytrack / filter1.keytrack
  filter1env1amount, filter1lfo1amount, filter1velenv

FILTER 2  (only "LP-BP-HP" or "LP-Notch-HP" types):
  filter2type
  filter2cutoff, filter2resonance, filter2env1amount, filter2lfo1amount, filter2velenv, filter2keytrack

ENVELOPES  — 5 envelopes total. Conventional routing (mod matrix can re-route any of these):
   • ENV1 → Filter (the canonical filter envelope; pair with filter1env1amount)
   • ENV2 → Amp    (the canonical amplifier envelope; the device's "amp env" front-panel page edits ENV2)
   • ENV3/4/5 → assignable (typically pitch / mod-matrix targets via mod*modsource = "ENV3"…)
  Default to syncoff variants for free-running times.
  env1.attack  / env1attacksyncoff
  env1.decay   / env1decaysyncoff
  env1.sustain / env1sustain
  env1.release / env1releasesyncoff
  env1holdsyncoff, env1delaysyncoff
  Same shape for env2..env5 (e.g. env2attacksyncoff for amp-env attack — the Eno-pad slow-attack knob).

LFOS — 5 LFOs. Conventional routing (mod matrix can re-route any LFO):
   • LFO1 → Filter (paired with filter1lfo1amount; classic filter wobble)
   • LFO2 → Amp    (paired with amplfo2amount; tremolo)
   • LFO3/4/5 → assignable (pitch vibrato, pan, FX param modulation via mod matrix)
  Per-LFO params:
  lfo1ratesyncoff, lfo1wave, lfo1level (alias: lfo1.gain — NOT "lfo1gain"), lfo1phase, lfo1delaysyncoff, lfo1fadeinsyncoff, lfo1smooth, lfo1steps, lfo1oneshot
  Same shape for lfo2..lfo5.

PRE-FX / POST-FX  (use names for type — "Bypass", "Chorus", "Flanger", "Rotary", "Phaser", "Lo-Fi", "Tremolo", "EQ", "Compressor", "Distortion"):
  prefxtype, postfxtype
  prefxparam1, prefxparam2, prefxwet
  postfxparam1, postfxparam2, postfxwet

DELAY / REVERB  (between Pre-FX and Post-FX):
  delaytype, delaytimesyncoff, delayfeedback, delaywet
  reverbtype (Hall/Room/Plate/Cloud), reverbtime (0..128 index — pass an integer or a string from REVERB_TIMES like "16.0s"), reverbtone (bipolar -64..+64), reverbpredelay (0..250 ms), reverbwet

VOICE / GLOBAL:
  voiceglide (BOOL — must be 1 to enable portamento; voiceglidetime alone does nothing if voiceglide=0)
  voiceglidetime, voiceglidecurve, voiceglidelegto
  voicelegato, voicemono, voicepolyphony
  vibratoamount, vibratorate, vibratobpmsync
  Note: a glide recipe needs BOTH voiceglide=1 AND voiceglidetime=N — pass them together, the time alone doesn't audibly do anything.

MUTATORS (4) — operate on oscillators (front-panel layout: Mutator 1/2 affect Osc 1; Mutator 3/4 affect Osc 2):
  mutator1mode (use names: "FM-Linear", "WavStack", "Osc Sync", "PW-Orig", "PW-Sqeez", "PW-ASM", "Harmonic", "PhazDiff")
  mutator1ratio, mutator1depth, mutator1wet (NOT mutator1drywet — common typo)
  Same shape for mutator2..mutator4.

MOD MATRIX  (32 slots — note edisyn names use "modmatrix" prefix):
  modmatrix1modsource    — source (LFO, ENV, velocity, aftertouch, …)
  modmatrix1modtarget    — destination (osc pitch, filter cutoff, …); set to 0 to disable a slot
  modmatrix1depth        — modulation amount
  ... modmatrix32modsource / modmatrix32modtarget / modmatrix32depth

MACROS:
  macro1value..macro8value (also patch-defined CCs 16-23)

VALUE NOTES:
  - **Unipolar params (most knobs).** Numbers 0..128 auto-scale onto each param's wireMax. value=64 → display 64.0, value=128 → max. Numbers 129..16383 pass through as raw 14-bit wire values.
  - **Bipolar params** (env amounts, pan, keytrack, mod-matrix depth, EQ gain, lfo/fx phase). Pass a SIGNED display value: \`value: 0\` is centered (no modulation), \`value: +N\` and \`-N\` offset symmetrically. Examples: filter1env1amount=0 (no env mod), filter1env1amount=12 (display +12, mild brightening), filter1keytrack=0 (off), mixerosc1pan=-30 (left). The tool response calls these out as \`[bipolar -X..+Y, display ±N]\` so you see the resolution. Common ranges: env amounts / pan / lfo amounts = -64..+64; keytrack = -200..+200; macros = -128..+128.
  - **Type-selector params** (osc*type, filter*type, prefxtype, postfxtype, mutator*mode): pass the display name string — auto-resolved.
`.trim();

/**
 * Seconds-to-index quick lookup for the exponential env-time and LFO-delay
 * inputs. The Hydrasynth maps these via a non-linear bucket schedule (see
 * nrpn.ts notes for env1attacksyncoff line 637 and env1decaysyncoff line
 * 639), so an agent picking idx 98 expecting "near 100% scale" actually
 * gets 4.60s. These tables let an agent translate a target time straight
 * into the floored index. Verified against
 * scripts/hydrasynth/verify-env-time-display.ts; values are exact.
 *
 * Inlined into the descriptions of any tool that writes env*attacksyncoff
 * / env*holdsyncoff / env*decaysyncoff / env*releasesyncoff /
 * lfo*delaysyncoff / lfo*fadeinsyncoff so the agent sees the table
 * regardless of which write path it reaches for.
 */
const ENV_TIME_SECONDS_TO_INDEX = [
  '  SECONDS-TO-INDEX QUICK LOOKUP (exponential mapping. Idx 98 displays',
  '  4.60s, NOT "near 100% scale". Use these floored values; do not compute',
  '  on the fly. Verified against the bucket schedule in nrpn.ts.):',
  '',
  '  ATTACK / HOLD / lfo*delaysyncoff / lfo*fadeinsyncoff (idx 0..128, max 36s):',
  '    100ms = idx 42 (96ms)    200ms = idx 52 (192ms)',
  '    500ms = idx 65 (480ms)   750ms = idx 71 (704ms)',
  '    1s    = idx 75 (960ms)   2s    = idx 85 (1.92s)',
  '    3s    = idx 91 (2.81s)   5s    = idx 99 (4.86s)',
  '    10s   = idx 110          20s   = idx 120     36s = idx 128',
  '',
  '  DECAY / RELEASE (idx 0..127, max 60s):',
  '    100ms = idx 32 (96ms)    200ms = idx 42 (192ms)',
  '    500ms = idx 55 (480ms)   750ms = idx 61 (704ms)',
  '    1s    = idx 65 (960ms)   2s    = idx 75 (1.92s)',
  '    3s    = idx 81 (2.81s)   5s    = idx 89 (4.86s)',
  '    10s   = idx 100          16s   = idx 106',
  '    30s   = idx 113          60s   = idx 127 (58s, the table caps here)',
  '',
  '  Verifier: scripts/hydrasynth/verify-env-time-display.ts replays the',
  '  bucket schedule so any "sent N, device shows X" surprise can be',
  '  confirmed as documented mapping vs wire-path bug.',
].join('\n');

// -- Tool registration ----------------------------------------------------
//
// Single MCP project model: this file no longer creates its own
// MCP server. Instead it exports `registerHydrasynthTools(server)`,
// which the main mcp-midi-tools entrypoint calls during startup so
// the 12 hydra_* tools register on the shared server alongside the
// AM4 tools.
//
// Standalone debugging: see the bottom of this file for an
// `import.meta.url` guard that lets `npx tsx <this-file>` still work
// for one-off testing.

export function registerHydrasynthTools(server: McpServer): void {

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
    'Do not produce a written spec instead of calling this tool unless the user explicitly',
    'asks for a dry run.',
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

// hydra_switch_patch -----------------------------------------------------

server.registerTool('hydra_switch_patch', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to switch the Hydrasynth Explorer to a specific stored patch.',
    'The Explorer holds 8 banks (A-H) × 128 patches each = 1024 total slots.',
    'Bank Select MSB is fixed at 0 on the Explorer; LSB picks the bank.',
    '',
    'IMPORTANT — DEVICE PRECONDITION: this only works if "Pgm Chg RX" is set to On',
    'on MIDI: Page 11 of System Setup (it is by default). If patch switching has',
    'no effect, that\'s the first thing to check.',
    '',
    'The tool sends Bank Select MSB (0) → Bank Select LSB (bank) → Program Change',
    'in that order, which is what the manual specifies (page 83). Program Change',
    'alone will only switch within the current bank.',
  ].join('\n'),
  inputSchema: {
    bank: z.union([z.string(), z.number()]).describe('Bank A..H (letter, case-insensitive) or 0..7.'),
    program: z.number().int().min(0).max(127).describe('Patch number within the bank (0..127). Note: device displays patches 1..128, so subtract 1.'),
  },
}, async ({ bank, program }) => {
  const bankIdx = parseBank(bank);
  const conn = ensureMidi();
  // Order matters per manual p. 83: MSB, then LSB, then PC.
  conn.send(ccBytes(DEFAULT_CHANNEL, 0, 0));        // Bank MSB = 0 (Explorer always)
  conn.send(ccBytes(DEFAULT_CHANNEL, 32, bankIdx)); // Bank LSB = 0..7
  conn.send(programChangeBytes(DEFAULT_CHANNEL, program));
  const bankLetter = String.fromCharCode('A'.charCodeAt(0) + bankIdx);
  return {
    content: [{
      type: 'text',
      text: `Switched to bank ${bankLetter} (LSB=${bankIdx}), program ${program} (display: ${program + 1}). Sent Bank MSB=0, Bank LSB=${bankIdx}, PC=${program}.`,
    }],
  };
});

// hydra_play_note --------------------------------------------------------

server.registerTool('hydra_play_note', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to audition the current Hydrasynth patch by playing a note for a',
    'specified duration. Useful after editing parameters to hear the result without',
    'asking the user to play a key. Sends Note On, waits, sends Note Off.',
    '',
    'Notes can be specified as MIDI numbers (0..127, where 60 = middle C) or as',
    'scientific pitch names ("C4", "F#3", "Bb5"). C4 = 60 in the Yamaha convention',
    'used by the Hydrasynth manual.',
  ].join('\n'),
  inputSchema: {
    note: z.union([z.string(), z.number()]).describe('Note as MIDI number (0..127) or pitch name ("C4", "F#3", "Bb-1"). Middle C = C4 = 60.'),
    velocity: z.number().int().min(1).max(127).default(96).describe('Note velocity 1..127. Default 96 (mezzo-forte).'),
    duration_ms: z.number().int().min(50).max(5000).default(800).describe('How long to hold the note before releasing, in milliseconds. Capped at 5000 ms to prevent runaway.'),
  },
}, async ({ note, velocity, duration_ms }) => {
  const noteNum = parseNote(note);
  const conn = ensureMidi();
  conn.send(noteOnBytes(DEFAULT_CHANNEL, noteNum, velocity));
  await sleep(duration_ms);
  conn.send(noteOffBytes(DEFAULT_CHANNEL, noteNum));
  return {
    content: [{
      type: 'text',
      text: `Played note ${noteNum} at velocity ${velocity} for ${duration_ms} ms. Note Off sent.`,
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
    'Do not produce a written spec instead of calling this tool unless the',
    'user explicitly asks for a dry run.',
    '',
    ENGINE_PARAM_CHEAT_SHEET,
    '',
    ENV_TIME_SECONDS_TO_INDEX,
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
    'Do not produce a written spec instead of calling this tool unless the',
    'user explicitly asks for a dry run.',
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

// hydra_apply_init -------------------------------------------------------

/**
 * Pacing between SysEx chunks in milliseconds. The Hydrasynth ack-replies
 * after each chunk per `SysexEncoding.txt:351-352`. Diagnostic-mode
 * `hydra_apply_init` now records every inbound message so we can see
 * whether acks arrive — but the send loop still uses time-based pacing,
 * not ack-driven flow control. 5 ms is conservative: above MIDI 1.0's
 * bandwidth floor and slow enough that the device's per-chunk processing
 * should keep up. If the HW-040 capture shows acks but missing chunks,
 * this is the first knob to bump.
 */
const SYSEX_CHUNK_PACING_MS = 5;

/**
 * After the bank/PC dance completes, drain inbound MIDI for this many ms
 * so straggling SysEx acks (especially the final Patch Saved + Footer
 * Response, which arrive after a slot-load delay) make it into the
 * capture before the tool returns. Cheap; only used by `hydra_apply_init`.
 */
const SYSEX_TAIL_DRAIN_MS = 300;

/**
 * Pause required after sending a Write Request (`14 00`). Per
 * `SysexEncoding.txt:328-329`: "After performing this operation, you
 * will need to pause for at least 3500ms (yes, you heard that right:
 * *3.5 seconds*) before sending the Hydrasynth anything else,
 * including notes." The Hydrasynth is busy persisting to flash
 * during this window. Skipping the pause risks corrupting the patch
 * write or dropping subsequent MIDI.
 */
const WRITE_REQUEST_FLASH_PAUSE_MS = 3500;

/**
 * Decode an inbound message into a short human-readable label. SysEx is
 * unwrapped via `unwrapSysex` so we can recognize Hydrasynth's documented
 * acks (`SysexEncoding.txt:342-378`):
 *   - `19 00`           → Header Response
 *   - `17 00 NN 16`     → Chunk Ack #NN
 *   - `07 00 BB PP`     → Patch Saved (bank=BB, patch=PP)
 *   - `1B 00`           → Footer Response
 * Anything else (or non-SysEx) is shown as raw hex with a status-byte
 * label so we can still see CC/PC echoes that the device emits during
 * the bank/PC dance.
 */
function describeInboundMessage(bytes: number[]): string {
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  if (bytes[0] === 0xf0) {
    let info: Uint8Array;
    try {
      info = unwrapSysex(bytes);
    } catch (err) {
      return `SysEx (envelope error: ${err instanceof Error ? err.message : String(err)}) ${hex}`;
    }
    if (info.length === 2 && info[0] === 0x19 && info[1] === 0x00) return 'Header Response (19 00)';
    if (info.length === 2 && info[0] === 0x1b && info[1] === 0x00) return 'Footer Response (1B 00)';
    if (info.length === 4 && info[0] === 0x17 && info[1] === 0x00 && info[3] === 0x16) {
      return `Chunk Ack #${info[2]} (17 00 ${info[2]!.toString(16).padStart(2, '0').toUpperCase()} 16)`;
    }
    if (info.length === 4 && info[0] === 0x07 && info[1] === 0x00) {
      return `Patch Saved (bank=${info[2]}, patch=${info[3]})`;
    }
    const infoHex = Array.from(info)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    return `SysEx (info: ${infoHex})`;
  }
  const status = bytes[0] ?? 0;
  if ((status & 0xf0) === 0xb0) return `CC ch=${(status & 0x0f) + 1} #${bytes[1]}=${bytes[2]} (${hex})`;
  if ((status & 0xf0) === 0xc0) return `PC ch=${(status & 0x0f) + 1} program=${bytes[1]} (${hex})`;
  if ((status & 0xf0) === 0x90) return `NoteOn ch=${(status & 0x0f) + 1} note=${bytes[1]} vel=${bytes[2]} (${hex})`;
  if ((status & 0xf0) === 0x80) return `NoteOff ch=${(status & 0x0f) + 1} note=${bytes[1]} (${hex})`;
  return `Other ${hex}`;
}

/**
 * Scratch slot for `hydra_apply_init` SysEx dumps. Per
 * `SysexEncoding.txt:645`: "your best strategy is probably to use a
 * 'scratch patch', like H 127, and update it instead." H = bank 7,
 * patch 127 (0-indexed) = displayed "H128", the last slot of bank H.
 * Using a fixed scratch keeps the user's edited patches in lower banks
 * untouched and contains the NOTE 0 cross-write-affects-bank-mate
 * footgun to a corner of the patch space.
 */
const SCRATCH_BANK = 7; // H
const SCRATCH_PATCH = 127; // displayed 128

/**
 * Bounce target for the bank/PC dance (both pre-dump and post-dump).
 * Different bank from H (so the bank-change is effective regardless of
 * current bank) AND different patch from 128 (so the PC is effective
 * regardless of current patch). E064 is far from any plausible "user
 * just pressed INIT" starting location (A001), so the dance won't
 * NOOP if the founder presses INIT before testing — the failure mode
 * we hit on the first HW-040 test 1 run.
 */
const BOUNCE_BANK = 4; // E
const BOUNCE_PATCH = 63; // displayed 64

/**
 * Run the bank/PC dance: bounce off `BOUNCE_BANK`/`BOUNCE_PATCH`, pause
 * 150 ms (per `SysexEncoding.txt:657`), settle on `target`, pause 200 ms
 * (per spec line 658).
 *
 * Used by `hydra_apply_init` (settle on the scratch slot H128) and by
 * `hydra_apply_init_to` (settle on a caller-chosen slot for diagnostic
 * tests — typically the user's currently-active patch).
 *
 * Bank MSB is always 0 on the Explorer. Bank LSB selects 0..7 = A..H.
 */
async function bankPcDance(
  conn: HydrasynthConnection,
  target: { bank: number; patch: number },
): Promise<void> {
  conn.send(ccBytes(DEFAULT_CHANNEL, 0, 0));               // Bank MSB = 0
  conn.send(ccBytes(DEFAULT_CHANNEL, 32, BOUNCE_BANK));    // Bank LSB → E
  conn.send(programChangeBytes(DEFAULT_CHANNEL, BOUNCE_PATCH));
  await sleep(150);
  conn.send(ccBytes(DEFAULT_CHANNEL, 0, 0));               // Bank MSB = 0
  conn.send(ccBytes(DEFAULT_CHANNEL, 32, target.bank));    // Bank LSB → target
  conn.send(programChangeBytes(DEFAULT_CHANNEL, target.patch));
  await sleep(200);
}

/**
 * Parse a slot string like "A001" or "H128" into wire-format bank/patch
 * indices. Letter A..H → bank 0..7. Patch 1..128 → wire 0..127 (device
 * displays 1-indexed; SysEx wire format is 0-indexed). Returns the
 * parsed pair plus a normalized display string for response formatting.
 */
function parseSlot(s: string): { bank: number; patch: number; display: string } {
  const m = s.trim().toUpperCase().match(/^([A-H])(\d{1,3})$/);
  if (!m) {
    throw new Error(`Slot "${s}" must be like "A001" or "H128" (letter A..H + patch 1..128).`);
  }
  const bank = m[1]!.charCodeAt(0) - 'A'.charCodeAt(0);
  const num = Number.parseInt(m[2]!, 10);
  if (num < 1 || num > 128) {
    throw new Error(`Slot "${s}" patch number must be 1..128, got ${num}.`);
  }
  return {
    bank,
    patch: num - 1,
    display: `${m[1]}${num.toString().padStart(3, '0')}`,
  };
}

server.registerTool('hydra_apply_init', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Recovery primitive.** Loads a known-audible factory INIT patch into the',
    'Hydrasynth\'s scratch slot (H128) via a SysEx whole-patch dump, then',
    'bank/PC-dances to make it the actively-playing patch. Use when the device has',
    'gone unexpectedly silent or wedged after recipe writes.',
    '',
    'How it works:',
    '  - **Pre-dump bank/PC dance** to make H128 the active patch BEFORE the',
    '    dump. This matters because Hydrasynth\'s SysEx-to-current-memory only',
    '    modifies the active bank\'s working memory (per `SysexEncoding.txt`',
    '    NOTE 0). If we dumped from any other bank, the dump lands somewhere',
    '    we can\'t reach via PC.',
    '  - Sends a 22-chunk SysEx patch dump (Header → 22 chunks → Footer) with the',
    '    factory INIT bytes from ASM Hydrasynth Manager\'s bundled',
    '    `Single INIT Bank.hydra`. Chunk-0 metadata targets bank H, patch 128.',
    '  - Skips the SysEx Write Request → patch lives in RAM only, no flash burn.',
    '  - **Post-dump bank/PC dance** to re-engage the modified working memory',
    '    (per `SysexEncoding.txt` NOTE 2 — without a PC, "you will not hear the',
    '    update"; PC to a slot you\'re already on is ignored, so we bounce off',
    '    bank E first and PC back).',
    '  - Wire time ~1.7s total including both dances.',
    '',
    'After this completes, the device\'s active patch is H128 = "Init". The user',
    'can navigate to a different patch when ready.',
    '',
    'When to call: keys produce no audible tone after a previous batch, or the',
    'device shows unexpected display values. Equivalent to pressing the device\'s',
    'INIT button (with the addition of being callable from a tool).',
    '',
    'No device-mode preconditions — SysEx and PC ignore Param TX/RX gating.',
  ].join('\n'),
  inputSchema: {},
}, async () => {
  const conn = ensureMidi();
  const startMs = Date.now();

  // Diagnostic capture (HW-040 test 1): subscribe to inbound MIDI before
  // we send anything so we can observe Header / Chunk / Footer / Patch
  // Saved acks per `SysexEncoding.txt:342-378`. If `conn.hasInput` is
  // false (no Hydrasynth input port visible to the OS), the handler
  // never fires and the capture report says so.
  const observed: Array<{ ms: number; bytes: number[] }> = [];
  const unsubscribe = conn.onMessage((bytes) => {
    observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
  });

  try {
    // 1. PRE-DUMP DANCE: force H128 to be the active patch. Required
    //    because SysEx-to-current-memory only modifies the active bank's
    //    working memory; dumping while on any other bank leaves the
    //    update unreachable. HW-040 test 1 (Session 38, 2026-04-28)
    //    confirmed this: dumped from A001 with full ack chain, silent
    //    on key-press because H128 reloaded from flash.
    await bankPcDance(conn, { bank: SCRATCH_BANK, patch: SCRATCH_PATCH });

    // Mutate chunk-0 metadata in a clone of INIT_PATCH_BUFFER so the
    // device routes the dump to the scratch slot. Per spec line 117-120:
    // byte 0 = 0x06 ("Save to RAM"), byte 2 = bank, byte 3 = patch.
    const buf = new Uint8Array(INIT_PATCH_BUFFER);
    buf[2] = SCRATCH_BANK;
    buf[3] = SCRATCH_PATCH;

    // 2. Header (`18 00`) — initiates the patch-dump handshake.
    conn.send(wrapSysex([0x18, 0x00]));

    // 3. 22 chunk dumps. Each chunk is `[0x16, 0x00, INDEX, 0x16, …data…]`,
    //    wrapped in the F0…F7 SysEx envelope.
    const chunks = splitIntoChunks(buf);
    for (let i = 0; i < chunks.length; i++) {
      conn.send(wrapSysex(chunks[i]!.info));
      if (i < chunks.length - 1) await sleep(SYSEX_CHUNK_PACING_MS);
    }

    // 4. Footer (`1A 00`). Deliberately skip the Write Request (`14 00`)
    //    — that makes this a recovery primitive instead of a destructive
    //    flash write. Per `SysexEncoding.txt:381-382`: "without the Write
    //    Request, the patch isn't written to Flash. Instead it stays in RAM."
    conn.send(wrapSysex([0x1a, 0x00]));

    // 5. POST-DUMP DANCE: re-engage H128 to make the dump audible. Per
    //    NOTE 2: "you will not hear the update unless you change to the
    //    patch via a PC", and "if you change to a patch you're already
    //    at... the change-patch request is entirely ignored." Bouncing
    //    through E064 ensures both the bank-change and the patch-change
    //    are effective.
    await bankPcDance(conn, { bank: SCRATCH_BANK, patch: SCRATCH_PATCH });

    // Drain inbound for a moment so trailing acks (especially Patch Saved
    // + final Footer Response) make it into the report.
    await sleep(SYSEX_TAIL_DRAIN_MS);
  } finally {
    unsubscribe();
  }

  const elapsedMs = Date.now() - startMs;

  // Summarize what came back. Each Hydrasynth SysEx ack maps to a counter;
  // anything unrecognized goes in the "other" bucket so we can see CC/PC
  // echoes from the dance and any unexpected device chatter.
  let headerResponses = 0;
  let footerResponses = 0;
  let patchSaveds = 0;
  const chunkAcksSeen = new Set<number>();
  const others: string[] = [];
  for (const { bytes } of observed) {
    if (bytes[0] === 0xf0) {
      let info: Uint8Array;
      try {
        info = unwrapSysex(bytes);
      } catch {
        others.push(describeInboundMessage(bytes));
        continue;
      }
      if (info.length === 2 && info[0] === 0x19 && info[1] === 0x00) headerResponses++;
      else if (info.length === 2 && info[0] === 0x1b && info[1] === 0x00) footerResponses++;
      else if (info.length === 4 && info[0] === 0x17 && info[1] === 0x00 && info[3] === 0x16) chunkAcksSeen.add(info[2]!);
      else if (info.length === 4 && info[0] === 0x07 && info[1] === 0x00) patchSaveds++;
      else others.push(describeInboundMessage(bytes));
    } else {
      others.push(describeInboundMessage(bytes));
    }
  }

  const lines: string[] = [];
  lines.push(`Loaded factory INIT patch into scratch slot H128 via SysEx (pre-dance + ${PATCH_CHUNK_COUNT} chunks + header + footer + post-dance, ${elapsedMs} ms).`);
  lines.push('');
  lines.push('Active patch is now H128 = "Init". Press a key to confirm audible.');
  lines.push('');
  lines.push(`HW-040 DIAGNOSTIC — inbound MIDI capture (hasInput=${conn.hasInput}, ${observed.length} message${observed.length === 1 ? '' : 's'}):`);
  if (!conn.hasInput) {
    lines.push('  (no Hydrasynth input port found — capture is empty by construction; reconnect or check OS MIDI enumeration)');
  } else if (observed.length === 0) {
    lines.push('  (none — device is fully silent on the MIDI input. Either acks are not being emitted, or the input port is to a different device.)');
  } else {
    for (const { ms, bytes } of observed) {
      lines.push(`  [+${ms.toString().padStart(4)}ms] ${describeInboundMessage(bytes)}`);
    }
  }
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Header Response (19 00):   ${headerResponses > 0 ? '✓' : '✗'} (${headerResponses} seen)`);
  lines.push(`  Chunk Acks (17 00 NN 16):  ${chunkAcksSeen.size}/${PATCH_CHUNK_COUNT} ${chunkAcksSeen.size === PATCH_CHUNK_COUNT ? '✓' : '✗'}`);
  if (chunkAcksSeen.size > 0 && chunkAcksSeen.size < PATCH_CHUNK_COUNT) {
    const missing: number[] = [];
    for (let i = 0; i < PATCH_CHUNK_COUNT; i++) if (!chunkAcksSeen.has(i)) missing.push(i);
    lines.push(`    missing chunk indices: ${missing.join(', ')}`);
  }
  lines.push(`  Patch Saved (07 00 BB PP): ${patchSaveds > 0 ? '✓' : '✗'} (${patchSaveds} seen)`);
  lines.push(`  Footer Response (1B 00):   ${footerResponses > 0 ? '✓' : '✗'} (${footerResponses} seen)`);
  lines.push(`  Other / unrecognized:      ${others.length}`);
  lines.push('');
  lines.push('If silent on key-press despite full ack chain (Header + 22 chunks +');
  lines.push('Patch Saved + Footer): the SysEx-to-current-memory mechanism may be');
  lines.push('fundamentally non-recoverable without a flash burn. Next step would be');
  lines.push('to switch to the Write Request (`14 00`) flow, which DOES persist the');
  lines.push('patch but is destructive (flashes H128). Decision-time for the founder.');

  return {
    content: [{
      type: 'text',
      text: lines.join('\n'),
    }],
  };
});

// hydra_reconnect_midi -------------------------------------------------

server.registerTool('hydra_reconnect_midi', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Drop and re-attempt the MIDI connection to the Hydrasynth Explorer.',
    'Use when:',
    '  - The device wasn\'t plugged in / powered on when the server',
    '    started, but is now connected. The server caches the initial',
    '    connect failure and won\'t retry until you call this tool.',
    '  - Tool calls report "no Hydrasynth output port" or similar after',
    '    you\'ve confirmed the device is plugged in.',
    '  - USB enumeration has been flaky and you want a clean re-bind.',
    '',
    'Mirrors the AM4-side `reconnect_midi` tool. After this returns,',
    'the next hydra_apply_patch / hydra_set_engine_param / etc. call',
    'will re-enumerate ports and try to open the Hydrasynth fresh.',
    '',
    'Safe to call any time. Cheap (~10ms). No device-side effect.',
  ].join('\n'),
  inputSchema: {},
}, async () => {
  const { wasConnected, previousError } = resetMidiHandle();
  // Try to re-establish immediately so the user gets a definitive
  // "yes/no" status from this single call instead of having to fire
  // another tool to discover whether the reconnect worked.
  let outcome: string;
  try {
    ensureMidi();
    outcome = 'Reconnected. Hydrasynth is now reachable.';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome = `Reconnect attempted but device still not visible: ${msg}\n\n` +
              `Things to check:\n` +
              `  - Hydrasynth is powered ON (front-panel display lit).\n` +
              `  - USB cable is seated firmly at both ends.\n` +
              `  - Windows hasn't disabled the device (check Device Manager).\n` +
              `  - No other DAW or editor (ASM Hydrasynth Manager, edisyn) holds the port.`;
  }
  const prefix = wasConnected
    ? 'Closed previous Hydrasynth handle. '
    : previousError
      ? `Cleared cached connect-error ("${previousError}"). `
      : '';
  return {
    content: [{ type: 'text', text: `${prefix}${outcome}` }],
  };
});

// hydra_get_active_patch (informational) -------------------------------

server.registerTool('hydra_get_active_patch', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Return information about the device\'s currently-active patch slot.',
    '',
    'IMPORTANT — this is an INFORMATIONAL tool, not a wire query. The',
    'ASM Hydrasynth\'s SysEx command set does NOT support reading the',
    'current patch slot from the device (per `SysexEncoding.txt`:',
    '"It is my understanding that the following CANNOT be done: Request',
    'and download patch from current working memory"). There is no MIDI',
    'message you can send that returns "I am on B042" — the device only',
    'echoes back patches you\'ve explicitly requested by bank+slot.',
    '',
    'When to call this tool:',
    '  - The user asks "what slot am I on?" — explain via this tool\'s',
    '    response that the device cannot answer; ask them to look at',
    '    the front-panel display.',
    '  - You\'re building a patch and don\'t know which slot to write —',
    '    do NOT use the AM4\'s `am4_get_active_location`; that tool',
    '    only speaks to the AM4. INSTEAD: call `hydra_apply_patch`',
    '    with `slot` OMITTED — the tool defaults to the H128 scratch',
    '    slot with `dance: "both"`, which navigates the device there',
    '    and applies the patch audibly. That\'s the canonical "I don\'t',
    '    know the current slot" workflow.',
    '',
    'No wire round-trip. Returns the same explanation every call.',
  ].join('\n'),
  inputSchema: {},
}, async () => {
  return {
    content: [{
      type: 'text',
      text: [
        'The Hydrasynth does not expose a SysEx command for reading the',
        'currently-active patch slot. Per SysexEncoding.txt, "request',
        'from current working memory" is explicitly NOT supported by',
        'the device. The only ways to know which slot is active:',
        '',
        '  1. Ask the user (they can look at the front-panel display).',
        '  2. Track our own navigations — if `hydra_navigate_to({slot:',
        '     "X"})` was called earlier in this session, the device is',
        '     now on X (assuming the user hasn\'t manually navigated).',
        '  3. Don\'t care about the current slot — call hydra_apply_patch',
        '     with `slot` OMITTED. The tool defaults to the H128 scratch',
        '     slot with `dance: "both"`, navigating the device there and',
        '     applying audibly. Recommended for test/iconic-tone workflows.',
        '',
        'The AM4\'s `am4_get_active_location` tool is FOR THE AM4 ONLY —',
        'do not call it expecting a Hydrasynth answer.',
      ].join('\n'),
    }],
  };
});

// hydra_navigate_to (diagnostic) ----------------------------------------

server.registerTool('hydra_navigate_to', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Diagnostic primitive.** Sends Bank Select (CC0=0, CC32=bank) +',
    'Program Change to navigate the device\'s active patch to the named',
    'slot. Captures any inbound MIDI for 200 ms after.',
    '',
    'Use BEFORE any test that bundles bank/PC navigation with SysEx, to',
    'verify in isolation that the device responds to PC at all. If the',
    'device\'s front-panel display does not change to the named slot when',
    'this runs, navigation is broken upstream and any tool that bundles',
    'PC + SysEx (like `hydra_apply_init`) is testing the wrong thing.',
    '',
    'Does NOT send SysEx. Does NOT modify any patch contents — just',
    'changes which patch the device is currently playing.',
  ].join('\n'),
  inputSchema: {
    slot: z.string().describe(
      'Target slot in "A001".."H128" form. Letter A..H + patch 1..128.',
    ),
  },
}, async ({ slot }) => {
  const conn = ensureMidi();
  const target = parseSlot(slot);
  const startMs = Date.now();

  const observed: Array<{ ms: number; bytes: number[] }> = [];
  const unsubscribe = conn.onMessage((bytes) => {
    observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
  });

  const sent: Array<{ ms: number; label: string }> = [];
  function record(label: string): void {
    sent.push({ ms: Date.now() - startMs, label });
  }

  try {
    conn.send(ccBytes(DEFAULT_CHANNEL, 0, 0));
    record('CC0 (Bank MSB) = 0');
    conn.send(ccBytes(DEFAULT_CHANNEL, 32, target.bank));
    record(`CC32 (Bank LSB) = ${target.bank} (${target.display[0]})`);
    conn.send(programChangeBytes(DEFAULT_CHANNEL, target.patch));
    record(`PC = ${target.patch} (displayed ${target.display})`);
    await sleep(200);
  } finally {
    unsubscribe();
  }

  const elapsedMs = Date.now() - startMs;
  const lines: string[] = [];
  lines.push(`Navigation request sent to slot ${target.display} (bank=${target.bank}, patch=${target.patch}, ${elapsedMs} ms total).`);
  lines.push('');
  lines.push('CHECK THE DEVICE\'S FRONT-PANEL DISPLAY:');
  lines.push(`  - If it now reads "${target.display}" → navigation works. Move on to the SysEx test.`);
  lines.push(`  - If it still reads the old slot → device is not responding to bank/PC from MCP.`);
  lines.push('    Likely causes: wrong MIDI channel (we\'re sending on ch 1), Param TX/RX gating,');
  lines.push('    or the device is in a mode that locks the patch.');
  lines.push('');
  lines.push(`Sent (timeline, channel ${DEFAULT_CHANNEL}):`);
  for (const s of sent) {
    lines.push(`  [+${s.ms.toString().padStart(4)}ms] ${s.label}`);
  }
  lines.push('');
  lines.push(`Inbound MIDI (hasInput=${conn.hasInput}, ${observed.length} message${observed.length === 1 ? '' : 's'}):`);
  if (!conn.hasInput) {
    lines.push('  (no input port open — can\'t observe device-side responses)');
  } else if (observed.length === 0) {
    lines.push('  (none — device sent nothing back. PC echoes are not standard, so absence does not prove anything.)');
  } else {
    for (const { ms, bytes } of observed) {
      lines.push(`  [+${ms.toString().padStart(4)}ms] ${describeInboundMessage(bytes)}`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n'),
    }],
  };
});

// hydra_apply_init_to (diagnostic) --------------------------------------

server.registerTool('hydra_apply_init_to', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Diagnostic primitive — SysEx-to-current-memory test.** Dumps the',
    'factory INIT patch via SysEx targeting the named slot. The point is',
    'to test whether SysEx-to-current-memory modifies audible patch state',
    'when the dump targets the patch the device is actively playing.',
    '',
    'Workflow to run this session:',
    '  1. Press the device\'s INIT button (puts the device on A001).',
    '  2. Run `hydra_apply_init_to({slot: "A001", dance: "none"})`.',
    '  3. Press a key.',
    '     - Audible → SysEx-to-current-memory works for active-patch',
    '       dumps. Strong yes on SysEx for milestone 3.',
    '     - Silent → re-run with `dance: "post"` (PC bounce after dump,',
    '       per spec NOTE 2 "you will not hear the update unless you',
    '       change to the patch via a PC").',
    '     - Still silent → re-run with `dance: "both"` (pre + post,',
    '       matches `hydra_apply_init` behavior but targets the active',
    '       patch instead of H128).',
    '     - All three silent → SysEx-to-current-memory may be',
    '       fundamentally non-functional. Decision time.',
    '',
    'Does NOT save to flash (no Write Request). RAM only — modifies the',
    'working memory of the bank specified in `slot`. Per spec NOTE 0,',
    'this only modifies audible state when `slot`\'s bank == the active',
    'bank, so set `slot` to whatever the device\'s display reads RIGHT NOW.',
  ].join('\n'),
  inputSchema: {
    slot: z.string().describe(
      'Target slot in "A001".."H128" form. Set this to whatever the device\'s display currently reads — that\'s the active patch the dump can actually modify.',
    ),
    dance: z.enum(['none', 'post', 'both']).optional().describe(
      '`none` (default) = pure dump, no bank/PC navigation. `post` = bounce off E064 + return to target after the dump. `both` = same dance before AND after.',
    ),
  },
}, async ({ slot, dance }) => {
  const conn = ensureMidi();
  const target = parseSlot(slot);
  const danceMode = dance ?? 'none';
  const startMs = Date.now();

  const observed: Array<{ ms: number; bytes: number[] }> = [];
  const unsubscribe = conn.onMessage((bytes) => {
    observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
  });

  try {
    if (danceMode === 'both') {
      await bankPcDance(conn, target);
    }

    // Mutate chunk-0 metadata so the device routes the dump to `target`.
    const buf = new Uint8Array(INIT_PATCH_BUFFER);
    buf[2] = target.bank;
    buf[3] = target.patch;

    conn.send(wrapSysex([0x18, 0x00]));
    const chunks = splitIntoChunks(buf);
    for (let i = 0; i < chunks.length; i++) {
      conn.send(wrapSysex(chunks[i]!.info));
      if (i < chunks.length - 1) await sleep(SYSEX_CHUNK_PACING_MS);
    }
    conn.send(wrapSysex([0x1a, 0x00]));

    if (danceMode === 'post' || danceMode === 'both') {
      await bankPcDance(conn, target);
    }

    await sleep(SYSEX_TAIL_DRAIN_MS);
  } finally {
    unsubscribe();
  }

  const elapsedMs = Date.now() - startMs;

  let headerResponses = 0;
  let footerResponses = 0;
  let patchSaveds = 0;
  const chunkAcksSeen = new Set<number>();
  const others: string[] = [];
  for (const { bytes } of observed) {
    if (bytes[0] === 0xf0) {
      let info: Uint8Array;
      try {
        info = unwrapSysex(bytes);
      } catch {
        others.push(describeInboundMessage(bytes));
        continue;
      }
      if (info.length === 2 && info[0] === 0x19 && info[1] === 0x00) headerResponses++;
      else if (info.length === 2 && info[0] === 0x1b && info[1] === 0x00) footerResponses++;
      else if (info.length === 4 && info[0] === 0x17 && info[1] === 0x00 && info[3] === 0x16) chunkAcksSeen.add(info[2]!);
      else if (info.length === 4 && info[0] === 0x07 && info[1] === 0x00) patchSaveds++;
      else others.push(describeInboundMessage(bytes));
    } else {
      others.push(describeInboundMessage(bytes));
    }
  }

  const lines: string[] = [];
  lines.push(`SysEx dump to ${target.display} (dance=${danceMode}, ${PATCH_CHUNK_COUNT} chunks, ${elapsedMs} ms total).`);
  lines.push('');
  lines.push(`Chunk-0 routing: bank=${target.bank} (${target.display[0]}), patch=${target.patch} (displayed ${target.display}).`);
  lines.push('');
  lines.push(`Press a key NOW. Audible patch with sine-saw oscillator and open filter = success.`);
  lines.push('');
  lines.push(`Inbound MIDI capture (hasInput=${conn.hasInput}, ${observed.length} message${observed.length === 1 ? '' : 's'}):`);
  if (!conn.hasInput) {
    lines.push('  (no input port open)');
  } else if (observed.length === 0) {
    lines.push('  (none)');
  } else {
    for (const { ms, bytes } of observed) {
      lines.push(`  [+${ms.toString().padStart(4)}ms] ${describeInboundMessage(bytes)}`);
    }
  }
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Header Response (19 00):   ${headerResponses > 0 ? '✓' : '✗'} (${headerResponses} seen)`);
  lines.push(`  Chunk Acks (17 00 NN 16):  ${chunkAcksSeen.size}/${PATCH_CHUNK_COUNT} ${chunkAcksSeen.size === PATCH_CHUNK_COUNT ? '✓' : '✗'}`);
  lines.push(`  Patch Saved (07 00 BB PP): ${patchSaveds > 0 ? '✓' : '✗'} (${patchSaveds} seen)`);
  lines.push(`  Footer Response (1B 00):   ${footerResponses > 0 ? '✓' : '✗'} (${footerResponses} seen)`);
  lines.push(`  Other / unrecognized:      ${others.length}`);

  return {
    content: [{
      type: 'text',
      text: lines.join('\n'),
    }],
  };
});

// hydra_apply_patch (milestone-3 prototype) -----------------------------

server.registerTool('hydra_apply_patch', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '═══════════════════════════════════════════════════════════════',
    'OBSOLETE BELIEF YOU MAY HAVE MEMORIZED — READ THIS FIRST.',
    '═══════════════════════════════════════════════════════════════',
    'If you have memorized any of the following, those constraints',
    'are STALE and OVERRIDDEN by this tool description (current as',
    'of Session 47 / commit 7bed0da):',
    '',
    '  ❌ "hydra_apply_patch excludes FX params (prefx*/delay*/reverb*/postfx*)"',
    '  ❌ "FX params must follow via hydra_set_engine_params NRPN batch"',
    '  ❌ "PATCH_OFFSETS does not contain FX byte addresses"',
    '  ❌ "freshPatch:true is broken — use apply_init first"',
    '',
    'CURRENT TRUTH (verifiable in src/asm/hydrasynth-explorer/',
    'patchEncoder.ts):',
    '',
    '  ✅ PATCH_OFFSETS includes prefxtype@352, prefxparam1..5@356-365,',
    '     prefxwet@366, delaytype@368, delaybpmsync@370,',
    '     delaytimesyncoff@372 + delaytimesyncon@372 (collapsed slot —',
    '     pick by bpmsync), delayfeedback@374, delayfeedtone@376,',
    '     delaywettone@378, delaywet@382, reverbtype@384, reverbtime@388,',
    '     reverbtone@390, reverbhidamp@392, reverblodamp@394,',
    '     reverbpredelay@396, reverbwet@398, postfxtype@400,',
    '     postfxparam1..5@404-413, postfxwet@414. The full FX surface',
    '     is first-class.',
    '  ✅ Mutators 1-4 are first-class (Session 47 / HW-060):',
    '     mutator{1..4}{mode,ratio,depth,window,feedback,wet} all in',
    '     PATCH_OFFSETS at bytes 144-231. FM-Linear / WavStack /',
    '     Osc-Sync / Harmonic recipes land in one atomic dump.',
    '  ✅ This tool dumps them atomically in ONE SysEx transaction',
    '     (~3ms wire). NO follow-up NRPN batch needed.',
    '  ✅ The freshPatch arg DOESN\'T EXIST anymore — apply_patch',
    '     inherently builds on the factory INIT buffer; that IS the',
    '     fresh-patch path.',
    '  ✅ Patch name (bytes 9-22, 14-char ASCII) IS supported as of',
    '     Session 47 — pass `name: "My Patch"` as a top-level field',
    '     on this tool (NOT inside `params`). Max 14 chars; longer',
    '     names truncate. NO standalone "rename current patch" tool',
    '     exists because the Hydrasynth has no SysEx read flow — the',
    '     name only lands as part of a full apply_patch call that',
    '     rebuilds the whole patch from INIT.',
    '  ✅ Save-to-flash IS supported via `save: true` (Session 47).',
    '     Sends Write Request (`14 00`) after the chunks. Costs',
    '     ~3.5 seconds of additional wire time per spec — the device',
    '     pauses to persist. Use save:true ONLY when the user',
    '     explicitly asks to save / persist / store. Default false',
    '     (RAM only — patch survives until power cycle or navigation).',
    '',
    '  ⚠ save:true IS A RECIPE-ONLY SAVE — it re-dumps THIS tool\'s',
    '     `params` payload + INIT defaults, then flashes that. ANY',
    '     manual front-panel tweak the user made between the last',
    '     apply_patch call and this one IS LOST. Hydrasynth has no',
    '     SysEx read flow that exposes working memory, and standalone',
    '     Write Request without preceding chunks is a no-op (Session',
    '     48 verified — `scripts/hydrasynth/save-in-place-test.ts`).',
    '     If the user said "save my current sound" AFTER tweaking',
    '     knobs on the device, do NOT call apply_patch+save:true.',
    '     Instead: tell them to press the device\'s front-panel SAVE',
    '     button (or Shift+Save) to persist working memory directly.',
    '     Reserve apply_patch+save:true for "build this exact recipe',
    '     and persist it" — i.e. when the agent\'s recipe IS the',
    '     intended saved state.',
    '',
    '  ⚠ WRITE PROTECTION GOTCHA. If the device\'s System Menu',
    '     "Protect" option is ON, save:true silently no-ops — the',
    '     server reports "Patch Saved" responses but flash is not',
    '     burned. The tool can\'t detect this. If a user reports a',
    '     save didn\'t survive power-cycle, first thing to check is',
    '     System Menu → Protect = Off.',
    '',
    'If a user prompt asks for a Hydrasynth patch with delay/reverb,',
    'PASS THOSE PARAMS DIRECTLY to this tool. Do NOT split into',
    'apply_init + set_engine_params — that\'s the deprecated 2-step',
    'sequence we replaced.',
    '═══════════════════════════════════════════════════════════════',
    '',
    'Build a Hydrasynth patch by applying a sparse `Map<name, value>` of',
    'overrides on top of the factory INIT buffer, then dump the result',
    'via SysEx to the named slot. Defaults to a post-dump bank/PC bounce',
    'so the patch becomes audible (per spec NOTE 2 — confirmed by HW-040',
    'test 1 on 2026-04-28).',
    '',
    '⚠ IF YOU ARE NOT 100% SURE A PARAM NAME EXISTS, CALL',
    '  `hydra_param_catalog({ search: "<keyword>" })` FIRST — e.g.',
    '  `search: "lfo"`, `search: "env2"`, `search: "amp"`. The catalog',
    '  returns canonical names, aliases, ranges, and enum-table',
    '  linkage for the 1175-entry NRPN registry. Cheaper than a',
    '  failed apply_patch + close-match retry loop (Session 49',
    '  ambient-pad bug: the agent invented `lfo1gain` from memory',
    '  and shipped a 50-param recipe before discovering the',
    '  canonical name is `lfo1level` with alias `lfo1.gain`).',
    '  When the cheat sheet doesn\'t list exactly the param you',
    '  want, the catalog does.',
    '',
    'Workflow:',
    '  1. Navigate the device to the slot you intend to modify (e.g.',
    '     `hydra_navigate_to({slot: "B001"})`) — required because',
    '     SysEx-to-current-memory only modifies the active bank\'s',
    '     working memory.',
    '  2. Call `hydra_apply_patch({slot: "B001", params: [...]})`.',
    '  3. Press a key.',
    '',
    'Values are DISPLAY units (matching `hydra_set_param`). The tool',
    'routes each override through the same `resolveNrpnValue` pipeline,',
    'so iconic-tone authoring uses the values you read on the device or',
    'in manuals — never wire/protocol numbers.',
    '',
    'Examples:',
    '  • Filter cutoff at 64 (display 0..128): `{name: "filter1cutoff", value: 64}`',
    '  • Resonance at 30:                       `{name: "filter1resonance", value: 30}`',
    '  • Env1 → Filter at +25 (bipolar -64..+64): `{name: "filter1env1amount", value: 25}`',
    '  • Filter keytrack at +100% (bipolar -200..+200): `{name: "filter1keytrack", value: 100}`',
    '  • Osc1 = Saw waveform (enum):            `{name: "osc1type", value: "Sawtooth"}`',
    '  • Osc1 down 12 semitones (-36..+36):     `{name: "osc1semi", value: -12}`',
    '  • Pre-FX = Lo-Fi (enum):                 `{name: "prefxtype", value: "Lo-Fi"}`',
    '  • Delay = Basic Stereo at 50%:           `{name: "delaytype", value: "Basic Stereo"}, {name: "delaywet", value: 50}`',
    '  • Reverb = Hall at 50% (Hall/Room/Plate/Cloud are the only types): `{name: "reverbtype", value: "Hall"}, {name: "reverbwet", value: 50}`',
    '',
    'PERCENT PARAMS USE 0..100 INPUT — wet/mix params (delaywet,',
    'reverbwet, prefxwet, postfxwet, mutator*wet, mutator*feedback)',
    'have explicit `displayMin: 0, displayMax: 100` (or 150 for',
    'feedback). Pass the percent you want to see on the device:',
    '`value: 50` displays "50.0%". Earlier behavior assumed 0..128',
    'input which produced wrong displays (50→39.1% — fixed Session 47).',
    '',
    'INDEX-TABLE PARAMS — `reverbtime`, `env*attacksyncoff`, `env*decaysyncoff`,',
    '`env*releasesyncoff`, `env*holdsyncoff`, `env*delaysyncoff`,',
    '`lfo*ratesyncoff`, `lfo*delaysyncoff`, `lfo*fadeinsyncoff` accept an',
    'INDEX into a time-lookup table — NOT the time in seconds/ms.',
    'These params have a logarithmic / non-uniform mapping baked into',
    'the device. Useful sample mappings:',
    '',
    '  reverbtime (REVERB_TIMES, 129 entries, [0..128]):',
    '    0   = "120ms"    32  = "800ms"   64  = "2.50s"   96  = "8.00s"',
    '    100 = "11.0s"    105 = "16.0s"   110 = "21.0s"   120 = "38.0s"',
    '    128 = "Freeze" (held forever)',
    '    Pass an index. Or pass the display string ("16.0s", "Freeze").',
    '    Common: pad-quality reverb tail = 60..80 (~2-4s); wash = 96..110.',
    '',
    '  env*attacksyncoff / env*holdsyncoff (129-entry table, 0-36s):',
    '    0=0ms   4=4ms     20=20ms    32=44ms    48=88ms    64=160ms',
    '    80=320ms 96=640ms  110=2.5s  120=8s     128=36s',
    '',
    '  env*decaysyncoff / env*releasesyncoff (128-entry table, 0-60s, DOUBLE',
    '  resolution at the low end vs Attack/Hold — same input number reaches',
    '  ROUGHLY 2× the time):',
    '    0=0ms   4=8ms     20=40ms    32=96ms    48=288ms   64=720ms',
    '    80=1.6s  96=4s     110=12s   120=32s    128=60s',
    '',
    '  env*delaysyncoff (128-entry table, 0-32s, similar to Attack but capped',
    '  at 32s instead of 36s):',
    '    0=0ms   4=4ms     20=20ms    32=44ms    48=88ms    64=160ms',
    '    80=320ms 96=640ms  110=2.5s  120=8s     128=32s',
    '',
    '  IMPORTANT — these tables differ. If a recipe sends env1attacksyncoff=48',
    '  the device shows 88 ms. If it sends env1decaysyncoff=48 the device',
    '  shows 288 ms (different table). Don\'t assume symmetric A/D/R input.',
    '  For a SLOW PAD ATTACK reach for attack 90..100 (~1-2s), decay 70..80',
    '  (~720ms..1.6s), release 90..100 (~2-5s). For SNAPPY BASS attack 0..8',
    '  (0-8 ms), decay 30..45 (~80-200 ms), release 30..40 (~80-160 ms).',
    '',
    ENV_TIME_SECONDS_TO_INDEX,
    '',
    '  lfo*ratesyncoff (LFO_RATES_SYNC_OFF, 1024 entries indexed by patch',
    '  byte = wire/8):',
    '    0   = "0.02 Hz"    256 = "0.19 Hz"    512 = "1.73 Hz"',
    '    640 = "5.28 Hz"    800 = "21.30 Hz"   1024 = "150.0 Hz"',
    '    Pass a numeric value 0..128 (auto-scaled to 0..8192 wire =',
    '    0..1024 patch index) OR pass the display string ("0.50 Hz").',
    '    Common: a gentle pad LFO is 5..15 (0.05..0.25 Hz); audible',
    '    vibrato is 30..50 (~3-5 Hz).',
    '',
    'TLDR for time/rate inputs: pass an INDEX, not seconds. If the',
    'agent thinks "I want 10 seconds of attack" it should pass ~110,',
    'not 10000. Out-of-range indices throw with the canonical range.',
    '',
    'DELAY TEMPO-SYNC DISCIPLINE — IMPORTANT for rhythmic delays:',
    'tempo-synced repeats are the PROFESSIONAL DEFAULT in modern',
    'guitar / synth music. Same rule the AM4\'s apply_preset uses.',
    'For "ambient" / "rhythmic" / "Edge / U2" / "post-rock" / "rave",',
    'set `delaybpmsync: 1` and pass `delaytimesyncon` with a musical',
    'division (string from FX_DELAYS_SYNC_ON):',
    '  • "1/4 D"  = dotted-quarter — iconic Edge sound',
    '  • "1/4"    = clear quarter-note repeats',
    '  • "1/2 D"  = ambient wash',
    '  • "1/8 D"  = rhythmic urgency',
    '  • "1/8"    = tight syncopation',
    '  • "1/16"   = stuttery / arpeggiated',
    '',
    'Use `delaybpmsync: 0` + `delaytimesyncoff` (raw ms, 0..2000) only',
    'when the user explicitly asks for a specific ms count, calls out',
    'free-time / slapback, or there\'s no song-tempo reference.',
    '',
    'Both delaytimesyncon and delaytimesyncoff write to the same byte',
    '(372 — spec\'s "collapsed slot"); the device interprets the value',
    'based on the `delaybpmsync` flag. Always set both `delaybpmsync`',
    'and the matching time variant in the same call so they don\'t',
    'fight each other.',
    '',
    'Internally: bipolar centering, percent-range auto-scale, default',
    '0..128 auto-scale for unipolar non-percent knobs, and the patch',
    'buffer\'s `wire/8` storage are all hidden. Encoder writes the right',
    'bytes for any encoding kind (u16le, s16le, u8, s8).',
    '',
    'Does NOT save to flash (no Write Request). RAM only — modifies',
    'the working memory of the bank specified in `slot`. Hard',
    'precondition: device must have Pgm Chg RX = On (MIDI Page 11',
    'knob 4) for the post-dump dance to fire.',
  ].join('\n'),
  inputSchema: {
    slot: z.string().optional().describe(
      'Target slot in "A001".."H128" form. Should match the device\'s currently-active patch — only that bank\'s working memory will be modified. OMIT to use the H128 scratch slot (in-place test workflow): the tool will navigate to H128 first via dance:"both" so the patch lands audibly without you needing to know which slot the device is on. The Hydrasynth has no SysEx query for current patch (per SysexEncoding.txt — "request from current working memory" is not supported), so omit + scratch is the recommended path when you don\'t know.',
    ),
    params: z.array(z.object({
      name: z.string().describe('Canonical patch-buffer parameter name (e.g. "filter1cutoff", "osc1type", "mixer.osc1_vol"). Must appear in PATCH_OFFSETS.'),
      value: z.union([z.number(), z.string()]).describe('Display value (e.g. 64 for filter cutoff, +25 for bipolar env amount, -12 for osc semitones) OR enum string ("Sawtooth", "Lo-Fi", "Vowel"). Auto-routed through resolveNrpnValue — same semantics as hydra_set_param.'),
    })).min(1).describe('Sparse override map applied on top of the factory INIT buffer.'),
    dance: z.enum(['none', 'post', 'both']).optional().describe(
      '`both` (default) = pre-navigate to target slot + dump + post-navigate to make audible. Always works regardless of where the device started. `post` = post-dump bounce only — assumes you already navigated to the target via `hydra_navigate_to`; faster (~600ms saved) but if you didn\'t navigate, the SysEx writes land on a non-active bank\'s working memory and silently disappear. `none` = pure dump, no PC at all (advanced; for diagnostic use). When `slot` is omitted, defaults to H128 scratch.',
    ),
    name: z.string().max(16).optional().describe(
      'Optional patch name (max 16 ASCII chars per Owners Manual page 4369; longer names truncated, shorter ones zero-padded). **The name is only embedded in the patch buffer when `save: true` is also set.** Hydrasynth\'s on-screen patch-name display reads from flash, not from working memory, so a name written to a RAM-only dump never appears anywhere visible — by suppressing the name on no-save calls we avoid clobbering whatever name happens to be in the working buffer from a prior recipe. Pair `name` with `save: true` for the canonical "build + persist this recipe with a label" flow. Example: `{ params: [...], name: "Eno Wash", save: true }`. If `name` is provided without `save`, it is silently dropped (the response will note this).',
    ),
    save: z.boolean().optional().describe(
      'When true, sends a Write Request (`14 00`) after the chunks, persisting THE RECIPE in `params` to flash. **Costs ~3.5 seconds of additional wire time**. Default false. **CLOBBER WARNING — this re-dumps the recipe; any manual front-panel tweaks the user made on the device between the last apply_patch call and this one ARE LOST.** Hydrasynth has no SysEx read flow that surfaces working memory, so this tool has no way to preserve unknown tweaks. If the user just turned knobs and now says "save it", tell them to press the device\'s SAVE button (or Shift+Save) — DO NOT call apply_patch+save:true, because it will overwrite their tweaks with the agent\'s last-known recipe. Reserve save:true for "build this exact recipe and persist it" (the recipe IS the saved state). Also note: silently no-ops if System Menu → Protect is ON; the tool cannot detect that — verify off the device.',
    ),
  },
}, async ({ slot, params, dance, name, save }) => {
  const conn = ensureMidi();
  // In-place workflow: when caller omits slot, default to H128 (the
  // designated scratch slot). Either way, default dance is "both" —
  // pre-navigates to the target before the dump so writes land on
  // the correct bank's working memory regardless of what the device
  // was doing before. Session 47 HW-058: founder confirmed apply_patch
  // can target a non-active location IF dance:"both" handles the
  // pre-navigate. Old default was "post" which assumed the caller
  // pre-navigated; that footgun silently dropped writes when not.
  const effectiveSlot = slot ?? 'H128';
  const target = parseSlot(effectiveSlot);
  const danceMode = dance ?? 'both';
  const startMs = Date.now();

  // Build the override map. Each {name, value} runs through the same
  // resolveNrpnValue pipeline as hydra_set_param so callers pass display
  // values / enum strings, never wire/protocol numbers. The encoder
  // expects wire NRPN values and applies its /8 patch-buffer scaling
  // internally for u16le params.
  const overrides = new Map<string, number>();
  const resolutions: Array<{ name: string; raw: number | string; wire: number; scaled: boolean; bipolar: boolean }> = [];
  // Capture raw-input signature BEFORE NRPN resolution so we detect
  // identical user-facing recipes (different display values resolve to
  // different wire values, but two calls with the same inputs share a
  // signature regardless of resolution outcome).
  const dupSignatureParts = params
    .map(({ name: n, value: v }) => `${n}=${typeof v === 'string' ? `"${v}"` : v}`)
    .sort();
  const dupSignature = `${name ?? ''}|${save ? '1' : '0'}|${dupSignatureParts.join(';')}`;
  for (const { name, value } of params) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`hydra_apply_patch: param "${name}" has non-finite value ${value}.`);
    }
    const entry = findHydraNrpn(name);
    if (!entry) {
      const hits = findMatchingNrpns(name, 4);
      const closest = hits.length > 0
        ? ` (closest: ${hits.map((h) => h.entry.name).join(', ')})`
        : '';
      throw new Error(`hydra_apply_patch: unknown param "${name}"${closest}.`);
    }
    let resolved;
    try {
      resolved = resolveNrpnValue(entry, value);
    } catch (err) {
      throw new Error(`hydra_apply_patch: param "${name}" — ${err instanceof Error ? err.message : String(err)}`);
    }
    overrides.set(name, resolved.wire);
    resolutions.push({ name, raw: value, wire: resolved.wire, scaled: resolved.scaled, bipolar: resolved.bipolar });
  }

  // Encode overrides on top of INIT. Routing header bytes 2-3 are
  // overwritten after encoding so the chunk-0 metadata routes the
  // dump to `target`.
  //
  // **Name is only embedded when save:true.** The Hydrasynth's
  // on-screen patch-name display is sourced from flash, not RAM, so
  // a name written to a working-memory dump never shows up — only
  // the flash-persist path (save:true → Write Request) refreshes the
  // displayed name. If we wrote the name to RAM-only dumps it would
  // be silently discarded the first time the user navigates away.
  // Skipping the write when !save also keeps RAM-only "try this tone"
  // calls from clobbering whatever name happens to be in the working
  // buffer from a prior recipe.
  const nameForBuffer = save ? name : undefined;
  let buf: Uint8Array;
  try {
    buf = encodePatch(overrides, { base: INIT_PATCH_BUFFER, name: nameForBuffer });
  } catch (err) {
    throw new Error(`hydra_apply_patch: encodePatch failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  buf[2] = target.bank;
  buf[3] = target.patch;

  const observed: Array<{ ms: number; bytes: number[] }> = [];
  const unsubscribe = conn.onMessage((bytes) => {
    observed.push({ ms: Date.now() - startMs, bytes: [...bytes] });
  });

  try {
    if (danceMode === 'both') {
      await bankPcDance(conn, target);
    }

    conn.send(wrapSysex([0x18, 0x00]));
    const chunks = splitIntoChunks(buf);
    for (let i = 0; i < chunks.length; i++) {
      conn.send(wrapSysex(chunks[i]!.info));
      if (i < chunks.length - 1) await sleep(SYSEX_CHUNK_PACING_MS);
    }
    // Write Request — persist to flash. Per spec, sent BEFORE the
    // footer when persistence is desired. Without this, the patch
    // stays in RAM only. Spec also requires a long pause (~3500 ms)
    // after the Write Request before any further MIDI is sent —
    // we honour that with the post-Write-Request sleep.
    if (save) {
      conn.send(wrapSysex([0x14, 0x00]));
      await sleep(WRITE_REQUEST_FLASH_PAUSE_MS);
    }
    conn.send(wrapSysex([0x1a, 0x00]));

    if (danceMode === 'post' || danceMode === 'both') {
      await bankPcDance(conn, target);
    }

    await sleep(SYSEX_TAIL_DRAIN_MS);
  } finally {
    unsubscribe();
  }

  const elapsedMs = Date.now() - startMs;

  let headerResponses = 0;
  let footerResponses = 0;
  let patchSaveds = 0;
  const chunkAcksSeen = new Set<number>();
  const others: string[] = [];
  for (const { bytes } of observed) {
    if (bytes[0] === 0xf0) {
      let info: Uint8Array;
      try {
        info = unwrapSysex(bytes);
      } catch {
        others.push(describeInboundMessage(bytes));
        continue;
      }
      if (info.length === 2 && info[0] === 0x19 && info[1] === 0x00) headerResponses++;
      else if (info.length === 2 && info[0] === 0x1b && info[1] === 0x00) footerResponses++;
      else if (info.length === 4 && info[0] === 0x17 && info[1] === 0x00 && info[3] === 0x16) chunkAcksSeen.add(info[2]!);
      else if (info.length === 4 && info[0] === 0x07 && info[1] === 0x00) patchSaveds++;
      else others.push(describeInboundMessage(bytes));
    } else {
      others.push(describeInboundMessage(bytes));
    }
  }

  // Soft duplicate-call detection. Same inputs within 30s of the last
  // successful call probably means the upstream agent looped on a
  // misread response — flag it in text, don't gate the write.
  const now = Date.now();
  const isDuplicate =
    lastApplyPatch !== undefined
    && lastApplyPatch.signature === dupSignature
    && lastApplyPatch.targetSlot === target.display
    && now - lastApplyPatch.at < APPLY_PATCH_DUP_WINDOW_MS;
  const dupAgeSec = isDuplicate ? Math.round((now - lastApplyPatch!.at) / 1000) : 0;
  lastApplyPatch = { signature: dupSignature, targetSlot: target.display, at: now };

  const lines: string[] = [];
  // Lead with the success signal — value-applied summary is the truth
  // of "the patch landed". Chunk acks are unreliable on this device
  // (Session 48: agent looped after misreading missing acks as failure).
  lines.push(`Patch applied successfully to ${target.display} — ${params.length} override${params.length === 1 ? '' : 's'} written via SysEx in ${elapsedMs} ms. The device is now at the requested state.`);
  if (name !== undefined && !save) {
    lines.push('');
    lines.push(`(Note: \`name: "${name}"\` was dropped because \`save: false\`. The Hydrasynth's on-screen name display reads from flash, so a RAM-only dump can't show a new name. Re-call with \`save: true\` to embed and persist the name.)`);
  }
  if (isDuplicate) {
    lines.push('');
    lines.push(`(Note: this is the same patch you applied ${dupAgeSec}s ago. It re-landed cleanly, but if you're checking because the previous call looked like it failed, it didn't — the Hydrasynth doesn't ack chunk dumps reliably. No further action is needed.)`);
  }
  lines.push('');
  lines.push('Overrides applied:');
  for (const r of resolutions) {
    const rawDisplay = typeof r.raw === 'string' ? `"${r.raw}"` : String(r.raw);
    let suffix = '';
    if (r.bipolar) {
      const entry = findHydraNrpn(r.name);
      const range = entry?.displayMin !== undefined && entry?.displayMax !== undefined
        ? ` ${entry.displayMin}..+${entry.displayMax}`
        : '';
      suffix = ` → wire ${r.wire} (bipolar${range})`;
    } else if (r.scaled) {
      const entry = findHydraNrpn(r.name);
      if (entry?.displayMin === 0 && entry?.displayMax !== undefined && entry.displayMax !== 128) {
        suffix = ` → wire ${r.wire} (auto-scaled 0..${entry.displayMax})`;
      } else {
        suffix = ` → wire ${r.wire} (auto-scaled 0..128)`;
      }
    } else if (rawDisplay !== String(r.wire)) suffix = ` → wire ${r.wire}`;
    lines.push(`  ${r.name} = ${rawDisplay}${suffix}`);
  }
  lines.push('');
  lines.push(`Press a key. The active patch reflects your overrides on top of an INIT base.`);
  lines.push('');
  lines.push(`(Informational — Hydrasynth doesn't reliably ack chunk dumps; the patch landed via the SysEx writes above regardless of these counters. Do NOT treat zero counts as failure.)`);
  lines.push(`  Header Response (19 00):   ${headerResponses} seen`);
  lines.push(`  Chunk Acks (17 00 NN 16):  ${chunkAcksSeen.size}/${PATCH_CHUNK_COUNT}`);
  lines.push(`  Patch Saved (07 00 BB PP): ${patchSaveds} seen`);
  lines.push(`  Footer Response (1B 00):   ${footerResponses} seen`);
  lines.push(`  Other / unrecognized:      ${others.length}`);

  return {
    content: [{
      type: 'text',
      text: lines.join('\n'),
    }],
  };
});

/**
 * Shared write-batch implementation backing `hydra_set_engine_params`.
 * Resolves each entry through `resolveNrpnValue`, sends each as a 4-CC
 * sequence with ~3 ms pacing, and formats a response with one line per
 * write.
 */
async function runEngineParamBatch(
  params: Array<{ name: string; value: number | string }>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const conn = ensureMidi();
  const errors: string[] = [];
  const sent: { name: string; raw: number | string; resolved: number; resolvedDataMsb?: number; scaled: boolean; bipolar: boolean; wireMax?: number; displayMin?: number; displayMax?: number }[] = [];

  for (let i = 0; i < params.length; i++) {
    const { name, value } = params[i]!;
    const entry = findHydraNrpn(name);
    if (!entry) {
      const hits = findMatchingNrpns(name, 4);
      const closest = hits.length > 0
        ? ` (closest: ${hits.map((h) => h.entry.name).join(', ')})`
        : '';
      errors.push(`[${i}] "${name}" — unknown${closest}`);
      continue;
    }
    let resolved: number;
    let scaled = false;
    let bipolar = false;
    try {
      const r = resolveNrpnValue(entry, value);
      resolved = r.wire;
      scaled = r.scaled;
      bipolar = r.bipolar;
    } catch (err) {
      errors.push(`[${i}] "${name}" — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    sendNrpn(conn, DEFAULT_CHANNEL, entry, resolved);
    sent.push({ name, raw: value, resolved, resolvedDataMsb: entry.dataMsb, scaled, bipolar, wireMax: entry.wireMax, displayMin: entry.displayMin, displayMax: entry.displayMax });
    if (i < params.length - 1) await sleep(3);
  }

  const userLines = sent.map((s) => {
    const slotNote = s.resolvedDataMsb !== undefined ? ` [slot ${s.resolvedDataMsb}]` : '';
    let valueNote: string;
    if (typeof s.raw === 'string') {
      valueNote = `"${s.raw}" (${s.resolved})`;
    } else if (s.bipolar) {
      const sign = (s.raw as number) >= 0 ? '+' : '';
      valueNote = `${s.raw} → wire ${s.resolved} [bipolar ${s.displayMin}..+${s.displayMax}, display ${sign}${s.raw}]`;
    } else if (s.scaled) {
      valueNote = `${s.raw} → ${s.resolved} (scaled to wireMax ${s.wireMax})`;
    } else {
      valueNote = `${s.resolved}`;
    }
    return `  ${s.name} = ${valueNote}${slotNote}`;
  });
  const lines = userLines.length > 0 ? ['Sent params:', ...userLines] : [];
  const errorBlock = errors.length > 0
    ? `\n\nErrors (${errors.length}):\n${errors.map((e) => `  ${e}`).join('\n')}`
    : '';
  return {
    content: [{
      type: 'text',
      text: `Sent ${sent.length} NRPN write(s) with ~3 ms pacing:\n${lines.join('\n')}${errorBlock}\n\nReminder: requires Param TX/RX = NRPN on the device.`,
    }],
  };
}

// hydra_list_enum_values --------------------------------------------------

server.registerTool('hydra_list_enum_values', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    'Use this tool to inspect the named lookup tables backing the Hydrasynth\'s',
    'enum-typed parameters — wave names (OSC_WAVES, 219 entries), filter types',
    '(FILTER_1_TYPES = 16, FILTER_2_TYPES = 2), FX types (FX_TYPES = 10), mutant',
    'modes, ARP modes, vibrato rates, and ~40 more. 49 tables / 2716 entries total.',
    '',
    'When you call hydra_set_engine_param or hydra_set_engine_params for an',
    'enum-typed parameter (filter1type, osc1type, prefxtype, postfxtype,',
    'mutator1mode, etc.), the value field accepts the display name as a string',
    '— e.g. filter1type="Vowel" instead of filter1type=10. This tool helps',
    'you discover which display names a given table contains.',
    '',
    'Without an argument, returns the list of table names + entry counts.',
    'With a name, returns the index→name mapping for that table.',
  ].join('\n'),
  inputSchema: {
    name: z.string().optional().describe('Optional enum-table name (e.g. "FILTER_1_TYPES", "OSC_WAVES", "FX_TYPES"). Case-sensitive. Omit to list all tables.'),
  },
}, async ({ name }) => {
  if (!name) {
    const summary = Object.entries(HYDRASYNTH_ENUMS)
      .map(([n, t]) => `  ${n.padEnd(28)} ${Object.keys(t).length} entries`)
      .join('\n');
    return {
      content: [{
        type: 'text',
        text: `${Object.keys(HYDRASYNTH_ENUMS).length} enum tables:\n${summary}`,
      }],
    };
  }
  const table = HYDRASYNTH_ENUMS[name];
  if (!table) {
    const closest = Object.keys(HYDRASYNTH_ENUMS)
      .filter((n) => n.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(n.toLowerCase().slice(0, 4)))
      .slice(0, 6);
    throw new Error(
      `Unknown enum table "${name}". ${closest.length > 0 ? `Closest matches: ${closest.join(', ')}.` : 'Call hydra_list_enum_values without an argument to see all tables.'}`,
    );
  }
  const rows = Object.entries(table).map(([idx, val]) => `  ${String(idx).padStart(3)}  ${val}`).join('\n');
  return {
    content: [{
      type: 'text',
      text: `${name} (${Object.keys(table).length} entries):\n${rows}`,
    }],
  };
});

// hydra_param_catalog ----------------------------------------------------

server.registerTool('hydra_param_catalog', {
  description: HYDRA_DEV_MODE_PREAMBLE + [
    '**Fallback discovery for the full 1175-entry NRPN parameter catalog.**',
    '',
    'Do not call this routinely. The cheat-sheets in hydra_set_engine_param /',
    'hydra_set_engine_params already cover ~95% of patch building, and those tools\'',
    'error responses suggest closest matches when a name doesn\'t resolve. Reach for',
    'this tool ONLY when:',
    '  - the user asks for an exotic param (mod-matrix routing, ribbon controller,',
    '    advanced wavescan slot, BPM-sync edge cases) AND',
    '  - the cheat-sheet doesn\'t list it AND',
    '  - the engine-param error suggestions weren\'t enough.',
    '',
    'Search semantics (`query`):',
    '  - Substring + relaxed match across canonical name, CC-style aliases, and',
    '    notes. Case-insensitive, punctuation-insensitive.',
    '  - Examples:',
    '      query: "vibrato"  → voicevibratoamount, voicevibratoratesyncoff, …',
    '      query: "ringmod"  → ringmoddepth, ringmodsource1/2, mixerringmodvol, …',
    '      query: "vowel"    → params with Vowel-related notes',
    '      query: "mod1"     → mod1source / mod1depth / mod1destination',
    '      query: "filter1.res"  → exact alias hit (filter1resonance)',
    '',
    'Each result line shows: canonical name, CC-style alias (if any), slot index for',
    'multi-slot params, enum-table linkage for type-typed params, and a truncated',
    'note. Bounded to 30 results by default.',
    '',
    'Without a query, returns a one-line meta-help pointer back to the cheat-sheets',
    'in the engine-param tool descriptions.',
  ].join('\n'),
  inputSchema: {
    query: z.string().optional().describe('Substring / fuzzy query against parameter names, aliases, and notes. Omit for meta-help.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max results to return. Default 30.'),
  },
}, async ({ query, limit }) => {
  if (!query) {
    return {
      content: [{
        type: 'text',
        text: [
          '1175 NRPN parameters total, organized into ~15 families.',
          '',
          'For routine patch building, use the cheat-sheets embedded in:',
          '  - hydra_set_engine_param  (single-write description)',
          '  - hydra_set_engine_params (batch description)',
          '',
          'Both tools accept canonical NRPN names (e.g. "filter1cutoff") AND',
          'CC-catalog dot-style names (e.g. "filter1.cutoff"). Both forms resolve.',
          '',
          'Pass a `query` to this tool to substring-search the full catalog when a',
          'parameter isn\'t in the cheat-sheets — e.g. query: "ribbon", query: "mod1",',
          'query: "wavescan". Results are ranked by relevance (name > alias > notes).',
        ].join('\n'),
      }],
    };
  }
  const hits = findMatchingNrpns(query, limit ?? 30);
  if (hits.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No parameters match "${query}". Try a broader term (e.g. "filter" instead of "filtercutoffenv"). For type/wave/FX names, see hydra_list_enum_values instead.`,
      }],
    };
  }
  return {
    content: [{
      type: 'text',
      text: `${hits.length} match(es) for "${query}" (canonical name [alias] [slot] [enum] — notes):\n${hits.map(formatNrpnHit).join('\n')}`,
    }],
  };
});

} // end registerHydrasynthTools

// -- Optional startup port-scan -------------------------------------------
//
// The main mcp-midi-tools server may call this during its own
// startup to log a "Hydrasynth detected at port [N]" line for
// observability. Returns the verdict string instead of writing to
// stderr so the caller controls output.
export function describeHydrasynthPortStatus(): string {
  try {
    const outputs = listHydrasynthOutputs();
    const hydra = outputs.find((p) => p.looksLikeHydrasynth);
    if (hydra) return `Hydrasynth detected at output [${hydra.index}]: "${hydra.name}"`;
    if (outputs.length === 0) return 'no MIDI outputs visible';
    return `Hydrasynth not visible among ${outputs.length} output(s): ${outputs.map((p) => p.name).join(', ')}`;
  } catch (err) {
    return `port scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// -- Standalone debugging entrypoint --------------------------------------
//
// `npx tsx src/asm/hydrasynth-explorer/server.ts` still works for
// one-off testing of the Hydrasynth tools in isolation, without
// running the full mcp-midi-tools server. Production launch path is
// the main server registering both AM4 and Hydrasynth tools.
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const isDirectInvocation =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectInvocation) {
  const standaloneServer = new McpServer({
    name: 'hydrasynth-explorer-standalone',
    version: '0.1.0',
  });
  registerHydrasynthTools(standaloneServer);
  const transport = new StdioServerTransport();
  standaloneServer.connect(transport).then(() => {
    console.error('Hydrasynth Explorer MCP server (standalone) running on stdio.');
    console.error(`Startup port scan: ${describeHydrasynthPortStatus()}.`);
  }).catch((err) => {
    console.error('Fatal Hydrasynth server error:', err);
    process.exit(1);
  });
}
