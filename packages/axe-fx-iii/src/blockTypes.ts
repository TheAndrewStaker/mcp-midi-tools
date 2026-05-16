/**
 * Axe-Fx III block-type catalog with effect IDs from v1.4 PDF Appendix 1.
 *
 * Effect IDs are 14-bit values used in the `id id` payload position
 * of functions 0x0A (SET_BYPASS), 0x0B (SET_CHANNEL), and the
 * response triples from 0x13 (STATUS_DUMP). Source:
 * `docs/manuals/AxeFx3-MIDI-3rdParty.txt` Appendix 1.
 *
 * Per the PDF, each block-type that supports up to 4 instances has 4
 * consecutive effect IDs (e.g. `ID_COMP1 = 46, ID_COMP2 = 47,
 * ID_COMP3 = 48, ID_COMP4 = 49`). Singletons have one ID. This file
 * exposes the first-instance ID + instance count; resolvers compute
 * `instance_N_id = firstId + (N-1)`.
 *
 * Anomalies / unknowns documented in `docs/SYSEX-MAP-AXE-FX-III.md`:
 *   - **AMP is absent from v1.4 Appendix 1.** AMP effect IDs are
 *     either in the 3..34 reserved range or deliberately omitted. The
 *     AMP block entry below carries `firstId: null` until a STATUS_DUMP
 *     against a preset containing AMP decodes its ID.
 *   - **Post-firmware-1.13 blocks have no effect ID in the v1.4 PDF**:
 *     NAM, Dynamic Distortion, IR Capture (as a block; the Appendix
 *     has `ID_IRCAPTURE = 36` for the utility), and recent layouts.
 *     These also carry `firstId: null`.
 *   - **`ID_DISTORT`** in the PDF maps to what AxeEdit III displays as
 *     the **Drive** block (DRV). Same hardware, different name.
 *   - **`ID_FUZZ`** is a separate effect-ID range from `ID_DISTORT`,
 *     yet AxeEdit III may collapse both under the Drive picker. We
 *     model FUZZ as its own catalog entry per the spec.
 */

/** Confidence tag for each catalog entry's `firstId`. */
export type ConfidenceTag =
  | 'spec-v1.4'         // documented verbatim in v1.4 PDF Appendix 1
  | 'editor-asset'      // extracted from AxeEdit-III installer assets
  | 'inferred-from-ii'  // inferred from Axe-Fx II family conventions
  | 'pending-capture';  // not yet sourced — placeholder

export interface AxeFxIIIBlock {
  /**
   * First-instance effect ID (e.g. ID_REVERB1 = 66). `null` if the
   * block isn't in v1.4 Appendix 1. To address instance N (1-based),
   * compute `firstId + (N - 1)`.
   */
  firstId: number | null;
  /** Number of instances this block-type supports on the III. */
  instances: number;
  /** Display name as shown in AxeEdit III. */
  name: string;
  /** Three-letter group code Fractal uses internally (AMP, CMP, REV, ...). */
  groupCode: string;
  /** Devices that ship this block; absent = all (III + FM9 + FM3). */
  availability?: 'iii-only' | 'iii+fm9' | 'iii+fm9+fm3' | 'utility-only';
  /** Confidence tag for this entry. */
  confidence: ConfidenceTag;
}

/**
 * The Axe-Fx III block-type catalog. Order is roughly the order
 * AxeEdit III displays them in its block-picker palette. Effect IDs
 * are from v1.4 Appendix 1 where documented.
 */
export const AXE_FX_III_BLOCKS: readonly AxeFxIIIBlock[] = [
  // Compositing utilities (singletons, IDs from PDF Appendix)
  { firstId: 2,    instances: 1, name: 'Controllers',          groupCode: 'CTR', confidence: 'spec-v1.4' },
  // (IDs 3-34 reserved or unenumerated in v1.4)
  { firstId: 35,   instances: 1, name: 'Tuner',                groupCode: 'TUN', confidence: 'spec-v1.4' },
  { firstId: 36,   instances: 1, name: 'IR Capture',           groupCode: 'IRC', availability: 'utility-only', confidence: 'spec-v1.4' },
  { firstId: 37,   instances: 5, name: 'Input',                groupCode: 'IN',  confidence: 'spec-v1.4' },
  { firstId: 42,   instances: 4, name: 'Output',               groupCode: 'OUT', confidence: 'spec-v1.4' },

  // Signal-chain blocks (4 instances each unless noted)
  { firstId: 46,   instances: 4, name: 'Compressor',           groupCode: 'CMP', confidence: 'spec-v1.4' },
  { firstId: 50,   instances: 4, name: 'Graphic EQ',           groupCode: 'GEQ', confidence: 'spec-v1.4' },
  { firstId: 54,   instances: 4, name: 'Parametric EQ',        groupCode: 'PEQ', confidence: 'spec-v1.4' },
  { firstId: 58,   instances: 4, name: 'Drive',                groupCode: 'DRV', confidence: 'spec-v1.4' },
  { firstId: 62,   instances: 4, name: 'Cab',                  groupCode: 'CAB', confidence: 'spec-v1.4' },
  { firstId: 66,   instances: 4, name: 'Reverb',               groupCode: 'REV', confidence: 'spec-v1.4' },
  { firstId: 70,   instances: 4, name: 'Delay',                groupCode: 'DLY', confidence: 'spec-v1.4' },
  { firstId: 74,   instances: 4, name: 'Multitap Delay',       groupCode: 'MTD', confidence: 'spec-v1.4' },
  { firstId: 78,   instances: 4, name: 'Chorus',               groupCode: 'CHO', confidence: 'spec-v1.4' },
  { firstId: 82,   instances: 4, name: 'Flanger',              groupCode: 'FLG', confidence: 'spec-v1.4' },
  { firstId: 86,   instances: 4, name: 'Rotary',               groupCode: 'ROT', confidence: 'spec-v1.4' },
  { firstId: 90,   instances: 4, name: 'Phaser',               groupCode: 'PHA', confidence: 'spec-v1.4' },
  { firstId: 94,   instances: 4, name: 'Wah',                  groupCode: 'WAH', confidence: 'spec-v1.4' },
  { firstId: 98,   instances: 4, name: 'Formant',              groupCode: 'FRM', confidence: 'spec-v1.4' },
  { firstId: 102,  instances: 4, name: 'Volume/Pan',           groupCode: 'VOL', confidence: 'spec-v1.4' },
  { firstId: 106,  instances: 4, name: 'Pan/Tremolo',          groupCode: 'PTR', confidence: 'spec-v1.4' },
  { firstId: 110,  instances: 4, name: 'Pitch',                groupCode: 'PIT', confidence: 'spec-v1.4' },
  { firstId: 114,  instances: 4, name: 'Filter',               groupCode: 'FIL', confidence: 'spec-v1.4' },
  { firstId: 118,  instances: 4, name: 'Fuzz',                 groupCode: 'FUZ', confidence: 'spec-v1.4' },
  { firstId: 122,  instances: 4, name: 'Enhancer',             groupCode: 'ENH', confidence: 'spec-v1.4' },
  { firstId: 126,  instances: 4, name: 'Mixer',                groupCode: 'MIX', confidence: 'spec-v1.4' },
  { firstId: 130,  instances: 4, name: 'Synth',                groupCode: 'SYN', confidence: 'spec-v1.4' },
  { firstId: 134,  instances: 4, name: 'Vocoder',              groupCode: 'VOC', availability: 'iii-only', confidence: 'spec-v1.4' },
  { firstId: 138,  instances: 4, name: 'Megatap Delay',        groupCode: 'MGD', confidence: 'spec-v1.4' },
  { firstId: 142,  instances: 4, name: 'Crossover',            groupCode: 'XOV', availability: 'iii+fm9', confidence: 'spec-v1.4' },
  { firstId: 146,  instances: 4, name: 'Gate/Expander',        groupCode: 'GAT', confidence: 'spec-v1.4' },
  { firstId: 150,  instances: 4, name: 'Ring Modulator',       groupCode: 'RNG', confidence: 'spec-v1.4' },
  { firstId: 154,  instances: 4, name: 'Multiband Compressor', groupCode: 'MBC', confidence: 'spec-v1.4' },
  { firstId: 158,  instances: 4, name: 'Ten-Tap Delay',        groupCode: 'TTD', confidence: 'spec-v1.4' },
  { firstId: 162,  instances: 4, name: 'Resonator',            groupCode: 'RES', confidence: 'spec-v1.4' },
  { firstId: 166,  instances: 4, name: 'Looper',               groupCode: 'LPR', confidence: 'spec-v1.4' },
  { firstId: 170,  instances: 4, name: 'Tone Match',           groupCode: 'TMA', availability: 'iii-only', confidence: 'spec-v1.4' },
  { firstId: 174,  instances: 4, name: 'Real-Time Analyzer',   groupCode: 'RTA', availability: 'iii-only', confidence: 'spec-v1.4' },
  { firstId: 178,  instances: 4, name: 'Plex Delay',           groupCode: 'PLX', confidence: 'spec-v1.4' },
  { firstId: 182,  instances: 4, name: 'Send',                 groupCode: 'SND', confidence: 'spec-v1.4' },
  { firstId: 186,  instances: 4, name: 'Return',               groupCode: 'RTN', confidence: 'spec-v1.4' },
  { firstId: 190,  instances: 1, name: 'Scene MIDI',           groupCode: 'SMI', confidence: 'spec-v1.4' },
  { firstId: 191,  instances: 4, name: 'Multiplexer',          groupCode: 'MUX', confidence: 'spec-v1.4' },
  { firstId: 195,  instances: 4, name: 'IR Player',            groupCode: 'IRP', availability: 'iii-only', confidence: 'spec-v1.4' },
  { firstId: 199,  instances: 1, name: 'Foot Controller',      groupCode: 'FC',  confidence: 'spec-v1.4' },
  { firstId: 200,  instances: 1, name: 'Preset FC',            groupCode: 'PFC', confidence: 'spec-v1.4' },

  // ── Blocks NOT in v1.4 Appendix 1 ───────────────────────────────
  // AMP is mysteriously absent from v1.4 — either in the 3..34
  // reserved range or deliberately omitted from the 3rd-party MIDI
  // surface. STATUS_DUMP against a preset containing AMP would
  // decode the real ID.
  { firstId: null, instances: 4, name: 'Amp',                  groupCode: 'AMP', confidence: 'pending-capture' },

  // Post-firmware-1.13 additions (PDF predates these by ~6 years)
  { firstId: null, instances: 4, name: 'Dynamic Distortion',   groupCode: 'DYD', availability: 'iii-only', confidence: 'pending-capture' },
  { firstId: null, instances: 4, name: 'NAM',                  groupCode: 'NAM', availability: 'iii-only', confidence: 'pending-capture' },

  // Editor-asset-only entries — UI surface exists, no SysEx ID confirmed
  { firstId: null, instances: 1, name: 'Global Block',         groupCode: 'GBK', availability: 'iii-only', confidence: 'editor-asset' },
  // Shunt is a grid-layout primitive (a pass-through cell); the III
  // exposes it in the editor but the v1.4 PDF doesn't enumerate it.
  { firstId: null, instances: 1, name: 'Shunt',                groupCode: 'SHT', confidence: 'editor-asset' },
] as const;

// ── Lookups ────────────────────────────────────────────────────────

/** Lookup: lowercase block name → block descriptor. Case-insensitive. */
const NAMES_BY_LOWER: Map<string, AxeFxIIIBlock> = new Map(
  AXE_FX_III_BLOCKS.map((b) => [b.name.toLowerCase(), b] as const),
);

/** Lookup: groupCode → block descriptor. */
const BY_GROUP_CODE: Map<string, AxeFxIIIBlock> = new Map(
  AXE_FX_III_BLOCKS.map((b) => [b.groupCode, b] as const),
);

/**
 * Resolve a user-supplied block reference (display name or group code)
 * to its block descriptor. Returns `undefined` if not found.
 */
export function resolveBlock(input: string): AxeFxIIIBlock | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  return (
    NAMES_BY_LOWER.get(trimmed.toLowerCase()) ?? BY_GROUP_CODE.get(trimmed.toUpperCase())
  );
}

/**
 * Resolve a "block + instance" reference (e.g. "Reverb 1", "Drive 2",
 * "REV 3") to a concrete effect ID. Returns the effect ID, or throws
 * with a helpful message if the block is unknown OR has no effect ID
 * in the v1.4 spec (AMP, NAM, etc.).
 *
 * Accepts both:
 *   - `"Reverb 1"` (display name + instance number)
 *   - `"REV"` or `"Reverb"` (no instance → defaults to instance 1)
 *   - `{ block: 'Reverb', instance: 2 }` (object form, see overload)
 */
export function resolveEffectId(
  blockName: string,
  instance?: number,
): number {
  // Try parsing trailing instance number out of the name itself.
  const m = blockName.match(/^(.+?)\s*(\d+)?\s*$/);
  const baseName = m?.[1]?.trim() ?? blockName;
  const trailingNum = m?.[2] ? Number.parseInt(m[2], 10) : undefined;
  const resolvedInstance = instance ?? trailingNum ?? 1;

  const block = resolveBlock(baseName);
  if (!block) {
    throw new Error(
      `Unknown Axe-Fx III block "${blockName}". Try a name like "Reverb 1", ` +
        '"Drive 2", or a 3-letter group code like "REV". Call ' +
        '`axefx3_list_blocks` for the full catalog.',
    );
  }
  if (block.firstId === null) {
    throw new Error(
      `Axe-Fx III "${block.name}" has no effect ID in the v1.4 spec ` +
        '(either reserved / unenumerated or added in firmware > 1.13). ' +
        `${block.confidence === 'pending-capture' ? 'Run axefx3_status_dump against a preset that contains this block to decode its real effect ID.' : 'This block is shipping editor-only and may not be addressable via 3rd-party MIDI.'}`,
    );
  }
  if (resolvedInstance < 1 || resolvedInstance > block.instances) {
    throw new Error(
      `Axe-Fx III ${block.name} instance ${resolvedInstance} out of range ` +
        `(1..${block.instances}).`,
    );
  }
  return block.firstId + (resolvedInstance - 1);
}
