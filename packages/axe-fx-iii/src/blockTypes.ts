/**
 * Axe-Fx III block-type catalog.
 *
 * **Status: 🟡 names + group codes verified from Fractal's AxeEdit III
 * editor assets; numeric `effectId` values are NULL pending capture
 * decoding.** Fractal's official "Axe-Fx III MIDI for Third-Party
 * Devices" PDF does not publish the per-block effectId space — they
 * point integrators at AxeEdit III for any deep editing. We extracted
 * the block roster from `samples/captured/decoded/binarydata/
 * axe-edit-iii-allzips/extracted/blocks/{overlay,bg}/*.svg|png` — the
 * filenames map 1:1 to the block group codes Fractal uses internally.
 *
 * To populate `effectId`: a community beta tester runs the discovery
 * workflow in `docs/_private/HARDWARE-TASKS-AXEFX3.md` — a `0x13
 * STATUS_DUMP` returns `id id dd` triples for every block in the
 * active preset, giving us the effect-index → block-type mapping in
 * one capture. Until that lands, `effectId` is `null` and any tool
 * that needs a numeric id throws a clear "🟡 effectId pending
 * community capture" error.
 *
 * Cross-device note: the roster is shared with FM9 and FM3 (and partly
 * VP4) — the per-device `availability` field on each entry records
 * which devices ship which blocks (e.g. FM9 omits Vocoder, Tone Match;
 * FM3 also omits Crossover). Source citation in the JSON file at
 * `samples/captured/decoded/axe-fx-iii-wiki-blocktypes.json`.
 */

/** Confidence tag for each catalog entry. */
export type ConfidenceTag =
  | 'wiki-direct'        // documented verbatim in cached Fractal wiki
  | 'editor-asset'       // extracted from AxeEdit-III installer assets
  | 'inferred-from-ii'   // inferred from Axe-Fx II / AM4 family conventions
  | 'pending-capture';   // not yet sourced — placeholder

export interface AxeFxIIIBlock {
  /** Numeric effectId, NULL until a capture session decodes it. */
  id: number | null;
  /** Display name as shown in AxeEdit III. */
  name: string;
  /** Three-letter group code Fractal uses internally (AMP, CMP, REV, ...). */
  groupCode: string;
  /** Devices that ship this block; absent = all (III + FM9 + FM3). */
  availability?: 'iii-only' | 'iii+fm9' | 'iii+fm9+fm3';
  /** Confidence tag for this entry. */
  confidence: ConfidenceTag;
}

/**
 * The 47-block roster of the Axe-Fx III family. Order is roughly the
 * order AxeEdit III displays them in its block-picker palette. `id`
 * is uniformly `null` until a community capture decodes the effectId
 * space.
 */
export const AXE_FX_III_BLOCKS: readonly AxeFxIIIBlock[] = [
  { id: null, name: 'Amp',                  groupCode: 'AMP', confidence: 'editor-asset' },
  { id: null, name: 'Cab',                  groupCode: 'CAB', confidence: 'editor-asset' },
  { id: null, name: 'Drive',                groupCode: 'DRV', confidence: 'editor-asset' },
  { id: null, name: 'Reverb',               groupCode: 'REV', confidence: 'editor-asset' },
  { id: null, name: 'Delay',                groupCode: 'DLY', confidence: 'editor-asset' },
  { id: null, name: 'Multitap Delay',       groupCode: 'MTD', confidence: 'editor-asset' },
  { id: null, name: 'Ten-Tap Delay',        groupCode: 'TTD', confidence: 'editor-asset' },
  { id: null, name: 'Megatap Delay',        groupCode: 'MGD', confidence: 'editor-asset' },
  { id: null, name: 'Plex Delay',           groupCode: 'PLX', confidence: 'editor-asset' },
  { id: null, name: 'Chorus',               groupCode: 'CHO', confidence: 'editor-asset' },
  { id: null, name: 'Flanger',              groupCode: 'FLG', confidence: 'editor-asset' },
  { id: null, name: 'Phaser',               groupCode: 'PHA', confidence: 'editor-asset' },
  { id: null, name: 'Rotary',               groupCode: 'ROT', confidence: 'editor-asset' },
  { id: null, name: 'Pitch',                groupCode: 'PIT', confidence: 'editor-asset' },
  { id: null, name: 'Synth',                groupCode: 'SYN', confidence: 'editor-asset' },
  { id: null, name: 'Resonator',            groupCode: 'RES', confidence: 'editor-asset' },
  { id: null, name: 'Ring Modulator',       groupCode: 'RNG', confidence: 'editor-asset' },
  { id: null, name: 'Vocoder',              groupCode: 'VOC', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'Tone Match',           groupCode: 'TMA', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'IR Player',            groupCode: 'IRP', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'Real-Time Analyzer',   groupCode: 'RTA', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'Crossover',            groupCode: 'XOV', availability: 'iii+fm9',     confidence: 'editor-asset' },
  { id: null, name: 'Compressor',           groupCode: 'CMP', confidence: 'editor-asset' },
  { id: null, name: 'Multiband Compressor', groupCode: 'MBC', confidence: 'editor-asset' },
  { id: null, name: 'Graphic EQ',           groupCode: 'GEQ', confidence: 'editor-asset' },
  { id: null, name: 'Parametric EQ',        groupCode: 'PEQ', confidence: 'editor-asset' },
  { id: null, name: 'Filter',               groupCode: 'FIL', confidence: 'editor-asset' },
  { id: null, name: 'Wah',                  groupCode: 'WAH', confidence: 'editor-asset' },
  { id: null, name: 'Formant',              groupCode: 'FRM', confidence: 'editor-asset' },
  { id: null, name: 'Volume/Pan',           groupCode: 'VOL', confidence: 'editor-asset' },
  { id: null, name: 'Pan/Tremolo',          groupCode: 'PTR', confidence: 'editor-asset' },
  { id: null, name: 'Gate/Expander',        groupCode: 'GAT', confidence: 'editor-asset' },
  { id: null, name: 'Enhancer',             groupCode: 'ENH', confidence: 'editor-asset' },
  { id: null, name: 'Mixer',                groupCode: 'MIX', confidence: 'editor-asset' },
  { id: null, name: 'Multiplexer',          groupCode: 'MUX', confidence: 'editor-asset' },
  { id: null, name: 'Looper',               groupCode: 'LPR', confidence: 'editor-asset' },
  { id: null, name: 'Send',                 groupCode: 'SND', confidence: 'editor-asset' },
  { id: null, name: 'Return',               groupCode: 'RTN', confidence: 'editor-asset' },
  { id: null, name: 'Input',                groupCode: 'IN',  confidence: 'editor-asset' },
  { id: null, name: 'Output',               groupCode: 'OUT', confidence: 'editor-asset' },
  { id: null, name: 'Shunt',                groupCode: 'SHT', confidence: 'editor-asset' },
  { id: null, name: 'Scene MIDI',           groupCode: 'SMI', confidence: 'editor-asset' },
  { id: null, name: 'Controllers',          groupCode: 'CTR', confidence: 'editor-asset' },
  { id: null, name: 'Global Block',         groupCode: 'GBK', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'Dynamic Distortion',   groupCode: 'DYD', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'IR Capture',           groupCode: 'IRC', availability: 'iii-only',    confidence: 'editor-asset' },
  { id: null, name: 'NAM',                  groupCode: 'NAM', availability: 'iii-only',    confidence: 'editor-asset' },
] as const;

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
 * to its block descriptor. Returns `undefined` if not found. Numeric
 * effectId lookup intentionally NOT supported until effectIds are
 * decoded — calling code that needs an id should check
 * `block.id !== null` and surface a "pending capture" error.
 */
export function resolveBlock(input: string): AxeFxIIIBlock | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  return (
    NAMES_BY_LOWER.get(trimmed.toLowerCase()) ?? BY_GROUP_CODE.get(trimmed.toUpperCase())
  );
}
