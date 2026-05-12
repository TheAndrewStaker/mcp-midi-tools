/**
 * Axe-Fx II block ID dictionary (generated).
 *
 * Source: Fractal Audio Wiki "MIDI_SysEx" page, "Axe-Fx II MIDI SysEx:
 * Block IDs" table, cached at
 * `docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html`.
 *
 * Wire context: the Axe-Fx II family addresses each block by its
 * 14-bit `effectId` in the GET/SET_BLOCK_PARAMETER_VALUE message
 * (function `0x02`). Multiple instances of the same block group
 * (e.g. Amp 1 + Amp 2) have distinct ids but share the parameter
 * table — see `KNOWN_PARAMS` in `./params.ts`, keyed by group code.
 *
 * **DO NOT EDIT BY HAND** — regenerate via:
 *   npx tsx scripts/extract-axe-fx-ii-params.ts
 *
 * Status: 🟢 hardware-verified on Q8.02 (2026-05-10). HW-076 read
 * the active preset's grid layout (12 blocks across 4 rows × 12
 * columns) and the resolved block IDs matched the device's front-
 * panel display + AxeEdit's rendering. HW-075 then wrote params to
 * Amp 1 and Reverb 1 by ID + saw the audible/visible result — block
 * ID resolution proven end to end. Factory bank file references
 * (`samples/factory/Axe-Fx-II_XL+_Bank-{A,B,C}_Q8p02.syx`) line up
 * with the registry as expected.
 */

export interface AxeFxIIBlock {
    /** 14-bit `effectId` used in GET/SET_BLOCK_PARAMETER_VALUE. */
    readonly id: number;
    /** Display name (e.g. "Amp 1", "Reverb 2"). */
    readonly name: string;
    /** 3-letter group code shared by all instances (e.g. "AMP"). */
    readonly groupCode: string;
    /** Whether the block exposes a bypass toggle. */
    readonly canBypass: boolean;
    /** Whether the AX8 floorboard exposes this block. */
    readonly availableOnAX8: boolean;
}

export const AXE_FX_II_BLOCKS: readonly AxeFxIIBlock[] = [
  { id: 100, name: "Compressor 1", groupCode: "CPR", canBypass: true, availableOnAX8: true },
  { id: 101, name: "Compressor 2", groupCode: "CPR", canBypass: true, availableOnAX8: false },
  { id: 102, name: "Graphic EQ 1", groupCode: "GEQ", canBypass: true, availableOnAX8: true },
  { id: 103, name: "Graphic EQ 2", groupCode: "GEQ", canBypass: true, availableOnAX8: true },
  { id: 104, name: "Parametric EQ 1", groupCode: "PEQ", canBypass: true, availableOnAX8: true },
  { id: 105, name: "Parametric EQ 2", groupCode: "PEQ", canBypass: true, availableOnAX8: true },
  { id: 106, name: "Amp 1", groupCode: "AMP", canBypass: true, availableOnAX8: true },
  { id: 107, name: "Amp 2", groupCode: "AMP", canBypass: true, availableOnAX8: false },
  { id: 108, name: "Cab 1", groupCode: "CAB", canBypass: true, availableOnAX8: true },
  { id: 109, name: "Cab 2", groupCode: "CAB", canBypass: true, availableOnAX8: false },
  { id: 110, name: "Reverb 1", groupCode: "REV", canBypass: true, availableOnAX8: true },
  { id: 111, name: "Reverb 2", groupCode: "REV", canBypass: true, availableOnAX8: false },
  { id: 112, name: "Delay 1", groupCode: "DLY", canBypass: true, availableOnAX8: true },
  { id: 113, name: "Delay 2", groupCode: "DLY", canBypass: true, availableOnAX8: true },
  { id: 114, name: "Multi Delay 1", groupCode: "MTD", canBypass: true, availableOnAX8: true },
  { id: 115, name: "Multi Delay 2", groupCode: "MTD", canBypass: true, availableOnAX8: false },
  { id: 116, name: "Chorus 1", groupCode: "CHO", canBypass: true, availableOnAX8: true },
  { id: 117, name: "Chorus 2", groupCode: "CHO", canBypass: true, availableOnAX8: false },
  { id: 118, name: "Flanger 1", groupCode: "FLG", canBypass: true, availableOnAX8: true },
  { id: 119, name: "Flanger 2", groupCode: "FLG", canBypass: true, availableOnAX8: false },
  { id: 120, name: "Rotary Speaker 1", groupCode: "ROT", canBypass: true, availableOnAX8: true },
  { id: 121, name: "Rotary Speaker 2", groupCode: "ROT", canBypass: true, availableOnAX8: false },
  { id: 122, name: "Phaser 1", groupCode: "PHA", canBypass: true, availableOnAX8: true },
  { id: 123, name: "Phaser 2", groupCode: "PHA", canBypass: true, availableOnAX8: false },
  { id: 124, name: "Wah 1", groupCode: "WAH", canBypass: true, availableOnAX8: true },
  { id: 125, name: "Wah 2", groupCode: "WAH", canBypass: true, availableOnAX8: false },
  { id: 126, name: "Formant", groupCode: "FRM", canBypass: true, availableOnAX8: true },
  { id: 127, name: "Volume/Pan 1", groupCode: "VOL", canBypass: true, availableOnAX8: true },
  { id: 128, name: "Tremolo/Panner 1", groupCode: "TRM", canBypass: true, availableOnAX8: true },
  { id: 129, name: "Tremolo/Panner 2", groupCode: "TRM", canBypass: true, availableOnAX8: false },
  { id: 130, name: "Pitch 1", groupCode: "PIT", canBypass: true, availableOnAX8: true },
  { id: 131, name: "Filter 1", groupCode: "FIL", canBypass: true, availableOnAX8: true },
  { id: 132, name: "Filter 2", groupCode: "FIL", canBypass: true, availableOnAX8: true },
  { id: 133, name: "Drive 1", groupCode: "DRV", canBypass: true, availableOnAX8: true },
  { id: 134, name: "Drive 2", groupCode: "DRV", canBypass: true, availableOnAX8: true },
  { id: 135, name: "Enhancer", groupCode: "ENH", canBypass: true, availableOnAX8: true },
  { id: 136, name: "FX Loop", groupCode: "FXL", canBypass: true, availableOnAX8: true },
  { id: 137, name: "Mixer", groupCode: "MIX", canBypass: false, availableOnAX8: false },
  { id: 138, name: "Mixer 2", groupCode: "MIX", canBypass: false, availableOnAX8: false },
  { id: 139, name: "Input Noise Gate", groupCode: "INPUT", canBypass: false, availableOnAX8: true },
  { id: 140, name: "Output", groupCode: "OUTPUT", canBypass: false, availableOnAX8: true },
  { id: 141, name: "Controllers", groupCode: "CONTROLLERS", canBypass: false, availableOnAX8: true },
  { id: 142, name: "Feedback Send", groupCode: "SND", canBypass: false, availableOnAX8: false },
  { id: 143, name: "Feedback Return", groupCode: "RTN", canBypass: false, availableOnAX8: false },
  { id: 144, name: "Synth 1", groupCode: "SYN", canBypass: true, availableOnAX8: true },
  { id: 145, name: "Synth 2", groupCode: "SYN", canBypass: true, availableOnAX8: false },
  { id: 146, name: "Vocoder", groupCode: "VOC", canBypass: true, availableOnAX8: false },
  { id: 147, name: "Megatap Delay", groupCode: "MGT", canBypass: true, availableOnAX8: false },
  { id: 148, name: "Crossover 1", groupCode: "XVR", canBypass: true, availableOnAX8: false },
  { id: 149, name: "Crossover 2", groupCode: "XVR", canBypass: true, availableOnAX8: false },
  { id: 150, name: "Gate Expander", groupCode: "GTE", canBypass: true, availableOnAX8: true },
  { id: 151, name: "Gate Expander 2", groupCode: "GTE", canBypass: true, availableOnAX8: false },
  { id: 152, name: "Ring Modulator", groupCode: "RNG", canBypass: true, availableOnAX8: true },
  { id: 153, name: "Pitch 2", groupCode: "PIT", canBypass: true, availableOnAX8: false },
  { id: 154, name: "Multiband Compressor 1", groupCode: "MBC", canBypass: true, availableOnAX8: false },
  { id: 155, name: "Multiband Compressor 2", groupCode: "MBC", canBypass: true, availableOnAX8: false },
  { id: 156, name: "Quad Chorus 1", groupCode: "QCH", canBypass: true, availableOnAX8: false },
  { id: 157, name: "Quad Chorus 2", groupCode: "QCH", canBypass: true, availableOnAX8: false },
  { id: 158, name: "Resonator 1", groupCode: "RES", canBypass: true, availableOnAX8: false },
  { id: 159, name: "Resonator 2", groupCode: "RES", canBypass: true, availableOnAX8: false },
  { id: 160, name: "Graphic EQ 3", groupCode: "GEQ", canBypass: true, availableOnAX8: false },
  { id: 161, name: "Graphic EQ 4", groupCode: "GEQ", canBypass: true, availableOnAX8: false },
  { id: 162, name: "Parametric EQ 3", groupCode: "PEQ", canBypass: true, availableOnAX8: false },
  { id: 163, name: "Parametric EQ 4", groupCode: "PEQ", canBypass: true, availableOnAX8: false },
  { id: 164, name: "Filter 3", groupCode: "FIL", canBypass: true, availableOnAX8: false },
  { id: 165, name: "Filter 4", groupCode: "FIL", canBypass: true, availableOnAX8: false },
  { id: 166, name: "Volume/Pan 2", groupCode: "VOL", canBypass: true, availableOnAX8: true },
  { id: 167, name: "Volume/Pan 3", groupCode: "VOL", canBypass: true, availableOnAX8: false },
  { id: 168, name: "Volume/Pan 4", groupCode: "VOL", canBypass: true, availableOnAX8: false },
  { id: 169, name: "Looper", groupCode: "LPR", canBypass: true, availableOnAX8: true },
  { id: 170, name: "Tone Match", groupCode: "TMA", canBypass: true, availableOnAX8: false },
] as const;

/** Reverse lookup: effectId → block. */
export const BLOCK_BY_ID: Readonly<Record<number, AxeFxIIBlock>> =
    Object.freeze(Object.fromEntries(AXE_FX_II_BLOCKS.map((b) => [b.id, b])));

/** Group code → list of effectIds (in order). e.g. AMP → [106, 107]. */
export const IDS_BY_GROUP: Readonly<Record<string, readonly number[]>> = (() => {
    const out: Record<string, number[]> = {};
    for (const b of AXE_FX_II_BLOCKS) {
        (out[b.groupCode] ??= []).push(b.id);
    }
    return Object.freeze(
        Object.fromEntries(
            Object.entries(out).map(([k, v]) => [k, Object.freeze(v.slice())]),
        ),
    );
})();

/** Block name (e.g. "Amp 1") → block. Case-insensitive. */
const NAMES_BY_LOWER: Record<string, AxeFxIIBlock> = Object.fromEntries(
    AXE_FX_II_BLOCKS.map((b) => [b.name.toLowerCase(), b]),
);

/** Resolve a user-supplied block reference (id or name) to its block. */
export function resolveBlock(input: string | number): AxeFxIIBlock | undefined {
    if (typeof input === 'number') return BLOCK_BY_ID[input];
    return NAMES_BY_LOWER[input.trim().toLowerCase()];
}
