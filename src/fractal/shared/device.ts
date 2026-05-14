/**
 * Fractal device abstraction.
 *
 * Each Fractal device family member (AM4, Axe-Fx II XL+, Axe-Fx III,
 * FM3, FM9, VP4) implements `FractalDevice` to expose its protocol
 * details (model byte, parameter registry, message builders) and its
 * capability flags (scene count, slot count, channels per block).
 *
 * The MCP server holds a single `activeDevice: FractalDevice`
 * reference and dispatches tool calls through it. Adding a new device
 * means adding a new implementation under `src/fractal/<device-name>/`,
 * not touching the server tools.
 *
 * Designed 2026-05-04 (Session 47, Path C of multi-device roadmap).
 * v0.1.0 ships AM4 only; Axe-Fx II is the first follow-up.
 */
import type { ParamId } from '@/fractal/shared/types.js';

/**
 * Minimal shape every device's parameter entry shares. Each device's
 * own param type extends this with device-specific fields (AM4's `unit`,
 * `scaling`, `pidLow`/`pidHigh`; Axe-Fx II's `paramId`, `groupCode`,
 * `controlType`, etc.). The shared interface is intentionally narrow so
 * tool-surface code that walks any device's registry only depends on
 * these universal fields.
 */
export interface BaseParam {
  readonly block: string;
  readonly name: string;
  readonly displayMin?: number;
  readonly displayMax?: number;
  readonly enumValues?: Readonly<Record<number, string>>;
}

/**
 * Identifies a parsed inbound SysEx message's role. Used by the
 * predicate functions on `FractalDevice` so the server can wait for
 * the right kind of response without knowing the protocol details.
 */
export interface ReadResponse {
  pidLow: number;
  pidHigh: number;
  /** The 32-bit unsigned int packed into the response payload. */
  asUInt32LE(): number;
  /** The Q15-normalized [0,1] internal float for use with `decode`. */
  asInternalFloat(): number;
}

/**
 * Per-device capability flags. The server uses these for tool input
 * validation (`scene` ≤ `sceneCount`, etc.) and for capability-aware
 * tool descriptions. Adding a new capability here requires updating
 * every device's implementation — by design, so the surface stays
 * honest.
 */
export interface DeviceCapabilities {
  /**
   * Number of scenes per preset.
   *   - AM4 = 4 (the outlier — smallest device in the family)
   *   - Axe-Fx II XL+ = 8 (per the official Scenes Mini-Manual,
   *     Fractal Audio: `Axe-Fx-II-Scenes-Mini-Manual-1.02.pdf`)
   *   - Axe-Fx III, FM3, FM9, VP4 = 8 (per their respective manuals)
   */
  readonly sceneCount: number;
  /**
   * Number of effect slots in the signal chain. AM4 = 4 (linear).
   * Axe-Fx II XL+ = 12. Axe-Fx III/FM9 = grid (effectively up to 16+
   * slots arranged in rows × columns).
   */
  readonly slotCount: number;
  /**
   * Channels available per block. AM4 = 4 (A/B/C/D). Axe-Fx III also
   * 4. Some devices may not have channels at all (`'none'`).
   */
  readonly channelsPerBlock: 'A-D' | 'A-H' | 'none';
  /**
   * Routing topology. Linear = the AM4's "blocks in series" model.
   * Grid = Axe-Fx III/FM9 row × column matrix routing. v0.1.0 supports
   * 'linear' only; grid devices land at v0.2 with a routing schema
   * extension to apply_preset.
   */
  readonly routing: 'linear' | 'grid';
  /**
   * Total preset locations. AM4 = 104 (banks A-Z × 4). Axe-Fx II = 384.
   * Axe-Fx III = 512. Used for write-safety bounds checks and for
   * `formatLocationCode`.
   */
  readonly presetLocationCount: number;
}

/**
 * Information returned by a device's `identify()` call. Populated
 * from the wire response to GET_FIRMWARE_VERSION (function 0x08) at
 * server startup.
 */
export interface DeviceIdentity {
  readonly modelByte: number;
  readonly firmwareVersion: string;
  readonly buildDate?: string;
}

/**
 * Block-type registry: enum values like `{ amp: 0x003a, drive: 0x0076,
 * ... }` mapping block-type names to their wire-level pidLow.
 */
export type BlockTypeRegistry = Readonly<Record<string, number>>;

/**
 * Parameter registry: every addressable parameter on the device,
 * keyed by `<block>.<name>`. Each device exposes its own param shape
 * (which extends `BaseParam`); generic-tool code only walks the shared
 * fields. AM4's `KNOWN_PARAMS` and Axe-Fx II's `AXE_FX_II_PARAMS` both
 * satisfy this.
 */
export type ParamRegistry = Readonly<Record<string, BaseParam>>;

/**
 * The contract every Fractal device implementation satisfies.
 *
 * Implementations live under `src/fractal/<device-name>/device.ts`
 * and export a single instance: `export const AM4_DEVICE: FractalDevice`,
 * `export const AXE_FX_II_DEVICE: FractalDevice`, etc.
 *
 * Methods that build wire bytes return `number[]` to match the
 * existing `node-midi` send signature; methods that read return
 * structured types so the server doesn't need protocol-level knowledge.
 */
export interface FractalDevice {
  // ── Identity ─────────────────────────────────────────────────
  /** Wire-level model byte (e.g. 0x15 for AM4, 0x03 for Axe-Fx II XL+). */
  readonly modelByte: number;
  /** Display name shown in tool descriptions and logs. */
  readonly displayName: string;
  /** Short slug used in URLs / file paths (e.g. "am4", "axe-fx-ii"). */
  readonly slug: string;
  /** Capability flags consulted by tools for validation + UX. */
  readonly capabilities: DeviceCapabilities;
  /**
   * Optional substring used to filter MIDI ports during discovery.
   * Hardware-specific; e.g. AM4's port name contains "AM4". Used by
   * `connect()` when no port is explicitly requested.
   */
  readonly midiPortPattern?: RegExp;

  // ── Registries ───────────────────────────────────────────────
  readonly knownParams: ParamRegistry;
  readonly blockTypes: BlockTypeRegistry;
  /**
   * Display-name aliases for parameters (e.g. `mix_level` → `mix`).
   * Empty for devices without aliases.
   */
  readonly paramAliases: Readonly<Record<string, string>>;

  // ── Display / format helpers ─────────────────────────────────
  /** Convert a 0-based location index to a human display ("A01" / "U4" / etc.). */
  formatLocationCode(locationIndex: number): string;
  /** Same but in Fractal's preferred display style ("U4" not "U04"). */
  formatLocationDisplay(locationIndex: number): string;
  /** Parse "A01" / "U4" / "Z04" → 0-based location index. Throws on invalid. */
  parseLocationCode(code: string): number;
  /** Resolve a block-type display name or wire value to its wire value. */
  resolveBlockType(input: string | number): number | undefined;
  /** Reverse-lookup: wire value → display name. */
  blockNameForValue(value: number): string | undefined;

  // ── Wire builders ────────────────────────────────────────────
  buildSetParam(key: string, displayValue: number): number[];
  buildReadParam(param: ParamId, readType?: number): number[];
  buildSetBlockType(slot: 1 | 2 | 3 | 4, blockTypeValue: number): number[];
  buildSetBlockBypass(blockPidLow: number, bypassed: boolean): number[];
  buildSwitchScene(sceneIndex: number): number[];
  buildSwitchPreset(locationIndex: number): number[];
  buildSetPresetName(locationIndex: number, name: string): number[];
  buildSetSceneName(sceneIndex: number, name: string): number[];
  buildSaveToLocation(locationIndex: number): number[];

  // ── Wire parsers ─────────────────────────────────────────────
  isWriteEcho(write: number[], response: number[]): boolean;
  isCommandAck(write: number[], response: number[]): boolean;
  isReadResponse(read: number[], response: number[]): boolean;
  parseReadResponse(bytes: number[]): ReadResponse;

  // ── Lifecycle ────────────────────────────────────────────────
  /**
   * Send a firmware-identify request and return parsed device info.
   * Used at server startup to confirm which device is connected.
   * Returns undefined if the device doesn't respond within the
   * implementation's chosen timeout.
   */
  identify?(send: (bytes: number[]) => void, recv: () => Promise<number[]>): Promise<DeviceIdentity | undefined>;
}

/**
 * Registry of all supported Fractal devices. Server walks this at
 * startup, asking each registered device's `identify()` (if defined)
 * to find a match against the connected hardware.
 *
 * Order matters for fallback: when no device responds to identify,
 * the first entry is used as the default. AM4 is the v0.1.0 default
 * since it's the only fully-implemented device.
 */
export const FRACTAL_DEVICE_REGISTRY: FractalDevice[] = [];

export function registerDevice(device: FractalDevice): void {
  FRACTAL_DEVICE_REGISTRY.push(device);
}

/**
 * Pick a device by its model byte. Returns undefined if no registered
 * device matches — caller decides whether to fall back to the default.
 */
export function deviceByModelByte(modelByte: number): FractalDevice | undefined {
  return FRACTAL_DEVICE_REGISTRY.find((d) => d.modelByte === modelByte);
}

/**
 * Pick a device by slug (used for explicit selection via env var or
 * config flag).
 */
export function deviceBySlug(slug: string): FractalDevice | undefined {
  return FRACTAL_DEVICE_REGISTRY.find((d) => d.slug === slug);
}
