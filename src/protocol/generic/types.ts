/**
 * BK-051 unified tool surface — type contracts.
 *
 * The generic dispatcher layer that lets a single set of MCP tools
 * (`set_param`, `get_param`, `apply_preset`, etc.) work against every
 * registered device, dispatched by `port`. Per-device behavior lives in
 * a `DeviceDescriptor` each device package registers at bootstrap.
 *
 * Design reference: Session 63 (2026-05-11) — see STATE.md Recent
 * breakthroughs entry. Spec lives in `docs/_private/04-BACKLOG.md`
 * BK-051. This module is the type-only foundation; runtime registry
 * is `./registry.ts`, dispatch logic is `./dispatcher.ts`.
 *
 * Coexists with the older Fractal-only `FractalDevice` interface in
 * `src/fractal/shared/device.ts`. That stays as the wire-protocol
 * contract for Fractal devices; `DeviceDescriptor` here is the MCP
 * tool-surface contract that wraps any device (Fractal or otherwise).
 */

import type { MidiConnection } from '@/fractal/am4/midi.js';

// ── Canonical vocabulary ────────────────────────────────────────────

/**
 * The Fractal-anchored terms the LLM-facing surface uses everywhere.
 * Per-device descriptors map them to the device's native display word
 * (e.g. Hydrasynth's "module" instead of "block"); the LLM still types
 * "block" and the dispatcher resolves via `block_aliases`.
 *
 * Anti-pattern: never write "preset slot" — `slot` is the signal-chain
 * position INSIDE a preset, `location` is where a preset is stored.
 * The CLAUDE.md terminology rule applies to descriptor authors too.
 */
export type CanonicalTerm =
  | 'block'
  | 'slot'
  | 'preset'
  | 'scene'
  | 'channel'
  | 'location';

export interface CanonicalTermMap {
  block: string;     // AM4: 'block', Hydra: 'module'
  slot: string;      // AM4: 'slot', Axe-Fx II: 'grid position'
  preset: string;    // AM4/AFII: 'preset', Hydra: 'patch'
  scene: string;     // AM4: 'scene', Hydra: '(no scenes)'
  channel: string;   // AM4: 'channel (A/B/C/D)', AFII: 'channel (X/Y)'
  location: string;  // AM4: 'preset location (A01..Z04)'
}

// ── Capabilities ───────────────────────────────────────────────────

/**
 * Drives validation gates + the `describe_device` payload. A capability
 * absence (e.g. `has_scenes=false` on Hydrasynth) is the difference
 * between an alias-resolvable input and a hard-fail error.
 */
export interface DeviceCapabilities {
  slot_model: 'linear' | 'grid';
  slot_count?: number;                          // linear: 4 for AM4
  grid?: { rows: number; cols: number };        // grid: 4×8 for Axe-Fx II
  has_scenes: boolean;
  scene_count?: number;
  has_channels: boolean;
  channel_names?: readonly string[];            // ['A','B','C','D'] or ['X','Y']
  channel_blocks?: readonly string[];           // which blocks expose channels
  preset_location_format?: RegExp;
  supports_save: boolean;
  supports_factory_restore: boolean;
  supports_lineage: boolean;
  has_macros?: boolean;
}

// ── Param / block schema ────────────────────────────────────────────

/**
 * Display-unit label surfaced to the LLM in `describe_device` and
 * `list_params` output. Stored as a string so per-device descriptors
 * can pass their native unit names through verbatim rather than
 * lossy-collapsing into a generic taxonomy.
 *
 * Standard cross-device values (use these when they fit so the LLM
 * sees consistent vocabulary across devices):
 *   'knob' | 'db' | 'ms' | 'percent' | 'hz' | 'seconds' | 'enum' |
 *   'bool' | 'count' | 'semitones' | 'ratio' | 'degrees' |
 *   'bipolar_percent' | 'opaque'
 *
 * Device-native values are accepted unchanged. AM4 ships with
 * 'knob_0_10', 'knob_0_20', 'pf', 'rotary_mic_spacing', 'amp_geq_band'
 * which the manual / front panel use directly — the LLM should see
 * those words, not a coarsened generic substitute. The encode/decode
 * closures on each `ParamSchema` handle the scaling correctly
 * regardless of what `unit` reports.
 *
 * Session 63 cont (Session B chunk 1, 2026-05-11) — was a closed enum
 * collapsing AM4 units lossily; widened to `string` to fix open item
 * #4 carried from Session A.
 */
export type Unit = string;

/** The standard cross-device unit values — provided for editor autocomplete
 *  + as a discoverability anchor in code reviews. Not enforced. */
export const STANDARD_UNITS = [
  'knob',
  'db',
  'ms',
  'percent',
  'hz',
  'seconds',
  'enum',
  'bool',
  'count',
  'semitones',
  'ratio',
  'degrees',
  'bipolar_percent',
  'opaque',
] as const;

export interface ParamSchema {
  display_name: string;
  unit: Unit;
  display_min?: number;
  display_max?: number;
  /** For `unit: 'enum'` only — wire index → display name. */
  enum_values?: Readonly<Record<number, string>>;
  /**
   * Display → wire conversion. Throws on out-of-range or unresolvable enum.
   * The dispatcher invokes this in step 4 of the request lifecycle; the
   * writer/reader below only ever sees wire values.
   */
  encode: (display: number | string) => number;
  /** Wire → display conversion. Used by readers + by enum reporting. */
  decode: (wire: number) => number | string;
}

export interface BlockSchema {
  display_name: string;
  params: Readonly<Record<string, ParamSchema>>;
  /** Param-name aliases. e.g. `{ decay: 'time' }` so `reverb.decay` resolves to `reverb.time`. */
  aliases?: Readonly<Record<string, string>>;
}

export interface BlockTypeMeta {
  /** Wire value for `set_block(block_type=...)`. */
  wire_value: number;
  display_name: string;
}

// ── Slot / location refs ────────────────────────────────────────────

/**
 * Discriminated by `capabilities.slot_model`. Linear devices use a
 * 1-based slot index; grid devices use `{ row, col }`.
 */
export type SlotRef = number | { row: number; col: number };

/**
 * Devices accept different location encodings. The descriptor's
 * `parse_location` / `format_location` adapters convert at the
 * dispatcher boundary so writer/reader code only ever sees the
 * device's canonical form (often a number index).
 */
export type LocationRef = string | number;

// ── Reader / writer adapter contracts ───────────────────────────────

export interface DispatchCtx {
  /** Live MIDI handle, scoped to this device's connection label. */
  conn: MidiConnection;
  /** The descriptor the dispatcher resolved. */
  descriptor: DeviceDescriptor;
}

export interface ReadResult {
  block: string;
  name: string;
  wire_value: number;
  display_value: number | string;
  unit: Unit;
  /** Raw wire bytes that produced this read, for diagnostics. */
  raw_response?: number[];
}

export interface BatchReadResult {
  reads: readonly ReadResult[];
  /** Indices in the original `queries[]` that failed to read; reason in `errors`. */
  failed_indices: readonly number[];
  errors?: Readonly<Record<number, string>>;
}

export interface WriteResult {
  /** What operation produced this result — 'set_param', 'switch_preset', etc.
   *  Optional for back-compat with the param-only Session B chunk 1. */
  op?: string;
  /** Target of the op — e.g. 'amp.gain' for set_param, 'M03' for switch_preset.
   *  Optional for back-compat. */
  target?: string;
  /** Operation acked on the wire. The semantics of "ack" vary per op —
   *  set_param's echo, switch_preset's write-echo, save's command-ack. */
  acked: boolean;
  /** Soft-warning when ack succeeded but the side effect may not have
   *  landed (e.g. block not placed in active preset). */
  warning?: string;
  // ── Param-write specific (only populated by set_param / set_params) ──
  block?: string;
  name?: string;
  wire_value?: number;
  display_value?: number | string;
  channel?: string;
}

export interface BatchWriteResult {
  writes: readonly WriteResult[];
  acked_count: number;
  unacked_count: number;
}

export interface BlockChange {
  block_type?: string;          // canonical block name, e.g. "amp", or "none" to clear
  bypassed?: boolean;
  channel?: string | number;    // 'A'..'D' / 'X'..'Y' / 0..3
}

export interface PresetSpec {
  /** Per-slot block placement + per-channel params. Device-validated. */
  slots: readonly PresetSlotSpec[];
  /** Per-scene channel/bypass selections. Devices without scenes ignore this. */
  scenes?: readonly SceneSpec[];
  name?: string;
}

export interface PresetSlotSpec {
  slot: SlotRef;
  block_type: string;
  params?: Readonly<Record<string, Readonly<Record<string, number | string>>>>;  // channel → params
  bypassed?: boolean;
}

export interface SceneSpec {
  scene: number;
  /** Per-block channel selection on this scene. */
  channels: Readonly<Record<string, string | number>>;
  /** Per-block bypass selection on this scene. */
  bypassed?: Readonly<Record<string, boolean>>;
  name?: string;
}

export interface ApplyResult {
  ok: boolean;
  steps: number;
  duration_ms: number;
  failed_step?: { index: number; description: string; error: string };
  /** Optional warning carried through to the LLM (e.g. unack count) when ok=true. */
  warning?: string;
}

export interface SetlistEntrySpec {
  location: LocationRef;
  spec: PresetSpec;
}

export interface SetlistApplyOptions {
  /** "stop" (default) halts on first failure; "continue" logs each error. */
  on_error?: 'stop' | 'continue';
  /** Validate every entry without sending wire bytes. */
  dry_run?: boolean;
  /** After each successful apply, read the preset name back and compare. */
  verify?: boolean;
}

export interface SetlistEntryResult {
  location: string;
  status: 'ok' | 'error';
  error?: string;
  wallTimeMs: number;
}

export interface ApplySetlistResult {
  ok: boolean;
  total: number;
  applied: number;
  failed: number;
  remaining: readonly string[];
  results: readonly SetlistEntryResult[];
  totalWallTimeMs: number;
  finalActiveLocation?: string;
}

export interface RestoreDefaultsOptions {
  verify?: boolean;
}

export interface RestoreDefaultsRangeOptions extends SetlistApplyOptions {
  /** Same on_error / dry_run / verify shape as SetlistApplyOptions. */
}

export interface RestoreDefaultsResult {
  ok: boolean;
  location: string;
  message?: string;
  wallTimeMs: number;
  verified?: boolean;
  preRestoreName?: string;
  postRestoreName?: string;
  totalBytes?: number;
  messageCount?: number;
}

export interface RestoreDefaultsRangeResult {
  ok: boolean;
  total: number;
  restored: number;
  failed: number;
  remaining: readonly string[];
  results: readonly {
    location: string;
    status: 'ok' | 'error';
    error?: string;
    preRestoreName?: string;
    postRestoreName?: string;
    wallTimeMs: number;
  }[];
  totalWallTimeMs: number;
}

export interface ParamQuery {
  block: string;
  name: string;
  channel?: string | number;
}

export interface WriteOp extends ParamQuery {
  value: number | string;
}

/**
 * Reader contract. The dispatcher calls these after step-5 connection
 * setup. Inputs are pre-validated (block/name resolved to canonical,
 * channel resolved to the device's native form).
 */
export interface ScannedLocation {
  location: string;
  name: string;
  is_empty: boolean;
}

export interface LineageQuery {
  block_type: string;
  name?: string;
  real_gear?: string;
  manufacturer?: string;
  model?: string;
  include_quotes?: boolean;
}

export interface DeviceReader {
  getParam(ctx: DispatchCtx, block: string, name: string, channel?: string | number): Promise<ReadResult>;
  getParams(ctx: DispatchCtx, queries: readonly ParamQuery[]): Promise<BatchReadResult>;
  /** Bulk-scan stored preset locations for their names. */
  scanLocations?(ctx: DispatchCtx, from: string | number, to: string | number): Promise<{
    scanned: readonly ScannedLocation[];
    failed_at?: string;
    failed_reason?: string;
  }>;
  /** Educational/discovery lookup (Fractal lineage corpus, manufacturer
   *  catalog, etc.). Pure data lookup — no MIDI I/O. */
  lookupLineage?(query: LineageQuery): { ok: boolean; text: string };
}

/**
 * Rename target — either the working-buffer preset itself or one of
 * its scenes. Scene targets use the `'scene:N'` form (1-indexed to
 * match user-facing scene numbering).
 */
export type RenameTarget = 'preset' | `scene:${number}`;

/**
 * Writer contract. Two layers:
 *
 *   - **Pure builders** (`build*`) return wire bytes without sending.
 *     Used by `verify-dispatcher.ts` and other byte-equality goldens.
 *     Available for every supported op so tests can assert wire-output
 *     identity with the pre-dispatcher path.
 *
 *   - **Execute methods** (`setParam`, `setBlock`, `applyPreset`, ...)
 *     send bytes + await ack + return result envelopes. Used by the
 *     unified MCP tool handlers (Session B). Optional in Session A — a
 *     descriptor can ship pure builders only and add execute methods
 *     in a follow-up session without breaking the dispatcher.
 */
export interface DeviceWriter {
  // ── Pure builders (no I/O) ────────────────────────────────────
  /** Returns the wire bytes for a `set_param` write. Inputs are pre-validated. */
  buildSetParam(block: string, name: string, wireValue: number): number[];
  /**
   * Returns the wire bytes for a channel-switch write. Returns an empty
   * array when the device doesn't expose channels for this block.
   */
  buildChannelSwitch?(block: string, channel: number): number[];
  buildSetBlock?(slot: SlotRef, change: BlockChange): readonly number[][];
  buildSwitchPreset?(location: LocationRef): number[];
  buildSavePreset?(location: LocationRef, name?: string): number[];
  buildSwitchScene?(scene: number): number[];

  // ── Execute (I/O — optional for Session A) ────────────────────
  setParam?(ctx: DispatchCtx, block: string, name: string, wireValue: number, channel?: string | number): Promise<WriteResult>;
  setParams?(ctx: DispatchCtx, ops: readonly WriteOp[]): Promise<BatchWriteResult>;
  setBlock?(ctx: DispatchCtx, slot: SlotRef, change: BlockChange): Promise<WriteResult>;
  setBypass?(ctx: DispatchCtx, block: string, bypassed: boolean): Promise<WriteResult>;
  applyPreset?(ctx: DispatchCtx, spec: PresetSpec, target?: LocationRef): Promise<ApplyResult>;
  applySetlist?(
    ctx: DispatchCtx,
    entries: readonly SetlistEntrySpec[],
    options?: SetlistApplyOptions,
  ): Promise<ApplySetlistResult>;
  switchPreset?(ctx: DispatchCtx, location: LocationRef): Promise<WriteResult>;
  savePreset?(ctx: DispatchCtx, location: LocationRef, name?: string): Promise<WriteResult>;
  switchScene?(ctx: DispatchCtx, scene: number): Promise<WriteResult>;
  rename?(ctx: DispatchCtx, target: RenameTarget, name: string): Promise<WriteResult>;
  /** Restore the device's defaults for a single location (or range). */
  restoreDefaults?(
    ctx: DispatchCtx,
    target: LocationRef,
    options?: RestoreDefaultsOptions,
  ): Promise<RestoreDefaultsResult>;
  restoreDefaultsRange?(
    ctx: DispatchCtx,
    from: LocationRef,
    to: LocationRef,
    options?: RestoreDefaultsRangeOptions,
  ): Promise<RestoreDefaultsRangeResult>;

  /**
   * Cross-device safe-edit gate (see `docs/SAFE-EDIT-WORKFLOW.md`).
   * Called by the dispatcher BEFORE any navigation operation
   * (apply-at-slot, setlist, switch_preset) when target_location is
   * set. Implementations check `isDirty(label)` and either let the
   * caller proceed, refuse with a structured warning, or save the
   * working buffer to its active slot first.
   *
   * Devices without a dirty signal (e.g. Hydrasynth) omit this
   * method — the dispatcher treats omission as "no gate" and
   * proceeds. The `save_authorized` gate is enforced elsewhere
   * (always at the dispatcher, regardless of device capability).
   */
  guardActiveBufferOrSave?(
    ctx: DispatchCtx,
    mode: 'warn' | 'discard' | 'save_active_first',
  ): Promise<GuardResult>;
}

/**
 * Result envelope from `guardActiveBufferOrSave`. Mirrors the per-
 * device shape (`DirtyGuardResult` in `src/server/shared/safeEdit.ts`)
 * intentionally so the dispatcher can pass it through unchanged.
 */
export interface GuardResult {
  /** Whether the caller may proceed with the navigation. */
  proceed: boolean;
  /** Tool-result text when proceed=false (the warning to surface). */
  warningText?: string;
  /** Human-readable detail for the proceed=true case (after save_active_first). */
  savedDetail?: string;
  /** When proceed=true after save_active_first, the slot the buffer was saved to. */
  savedSlot?: number | string;
}

// ── Top-level descriptor ────────────────────────────────────────────

export interface DeviceDescriptor {
  // -- identity --
  id: string;                                   // 'am4', 'axe-fx-ii', 'hydrasynth'
  display_name: string;                         // 'Fractal AM4'

  // -- port matching --
  port_match: readonly { pattern: RegExp | string }[];
  /** Defaults to `id` if absent. Used by `connections.ts` as the cache key. */
  connection_label?: string;

  // -- LLM-facing surface --
  capabilities: DeviceCapabilities;
  canonical_terms: CanonicalTermMap;

  // -- schema --
  blocks: Readonly<Record<string, BlockSchema>>;
  /** Device-native block-name → canonical-name. e.g. `{ module: 'block' }` on Hydra. */
  block_aliases?: Readonly<Record<string, string>>;
  /** For `set_block(block_type=...)`. Optional — devices may not expose typed slots. */
  block_types?: Readonly<Record<string, BlockTypeMeta>>;

  // -- adapters --
  reader: DeviceReader;
  writer: DeviceWriter;
}

// ── Error envelope ─────────────────────────────────────────────────

export type ErrorCode =
  | 'port_not_found'
  | 'capability_not_supported'
  | 'unknown_block'
  | 'unknown_param'
  | 'param_name_aliased'         // info-level; auto-resolved, surfaces in result
  | 'value_out_of_range'
  | 'unknown_enum_value'
  | 'ambiguous_enum_value'
  | 'bad_channel'
  | 'bad_location'
  | 'block_not_placed'           // soft-fail — write acked but block isn't in preset
  | 'no_ack'
  | 'stale_handle'
  | 'save_authorization_required' // gate refusal: apply-at-slot called without save_authorized=true
  | 'buffer_dirty';               // gate refusal: nav/save-at-slot while active buffer has unsaved edits

export interface DispatchErrorDetails {
  /** Single best near-match — printed inline ("did you mean X?"). */
  suggestion?: string;
  /** Small (≤8) valid options for inline listing. */
  valid_options?: readonly string[];
  /** Reference to a discovery tool when the valid set is too big to list. */
  valid_options_tool?: string;
  /** Recovery hint — what the LLM should try next. */
  retry_action?: string;
}

/**
 * The only error type the dispatcher throws. Centralized so every
 * device's errors share the same envelope and the LLM gets a stable
 * surface to recover from.
 */
export class DispatchError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly device: string,            // descriptor.display_name
    message: string,
    public readonly details?: DispatchErrorDetails,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}
