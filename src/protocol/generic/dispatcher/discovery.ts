/**
 * Discovery executors — pure-introspection helpers that surface device
 * schema and lineage corpus without any MIDI I/O.
 *
 * Routes for the `describe_device`, `list_params`, and `lookup_lineage`
 * MCP tools.
 */

import {
  DispatchError,
  type DeviceDescriptor,
} from '@/protocol/generic/types.js';

import { requireDevice } from './core.js';
import { resolveBlockName } from './resolvers.js';

/**
 * Pure descriptor-introspection helper for `describe_device`. No I/O —
 * returns the registered capabilities + canonical terms + block roster.
 * The dynamic identity (firmware version, model byte echo) comes from
 * `send_identity_request` (BK-049 Layer 0) and is merged on top of this
 * by the tool handler when available.
 */
export function describeDevice(port: string): {
  device: string;
  id: string;
  capabilities: DeviceDescriptor['capabilities'];
  canonical_terms: DeviceDescriptor['canonical_terms'];
  blocks: readonly string[];
  block_types: readonly string[];
  agent_guidance?: DeviceDescriptor['agent_guidance'];
} {
  const desc = requireDevice(port);
  return {
    device: desc.display_name,
    id: desc.id,
    capabilities: desc.capabilities,
    canonical_terms: desc.canonical_terms,
    blocks: Object.keys(desc.blocks),
    block_types: desc.block_types ? Object.keys(desc.block_types) : [],
    agent_guidance: desc.agent_guidance,
  };
}

/**
 * Pure introspection for `list_params(port, block?, name?)`. When `name`
 * is supplied AND the param is an enum, the response carries the full
 * enum table — collapses the legacy `*_list_enum_values` tools into the
 * same surface per BK-051 audit (Session 63).
 */
export interface ListParamsEntry {
  block: string;
  name: string;
  display_name: string;
  unit: string;
  display_min?: number;
  display_max?: number;
  has_aliases?: readonly string[];
  enum_values?: Readonly<Record<number, string>>;
  /** Manufacturer UI label (e.g. AM4-Edit's "Master Volume" for `amp.master`). */
  host_label?: string;
  /** Firmware-internal symbolic identifier (e.g. `DISTORT_MASTER`). */
  parameter_name?: string;
  /**
   * Per-block-type applicability annotation when the param is type-gated
   * (e.g. "applies only when amp.type ∈ [Plexi100W, 1959SLP]"). Absent
   * when the param applies universally. Load-bearing for type-gated
   * params on AM4 — writing a gated param on an incompatible type
   * silently no-ops on the device.
   */
  applies_only_when?: string;
}

export function listParams(args: { port: string; block?: string; name?: string }): {
  device: string;
  blocks: readonly string[];
  params: readonly ListParamsEntry[];
  live_confirmation: string;
} {
  const desc = requireDevice(args.port);
  const entries: ListParamsEntry[] = [];
  const wantBlock = args.block !== undefined
    ? resolveBlockName(desc, args.block)
    : undefined;
  for (const [block, schema] of Object.entries(desc.blocks)) {
    if (wantBlock !== undefined && block !== wantBlock) continue;
    const aliasReverse: Record<string, string[]> = {};
    for (const [alias, canonical] of Object.entries(schema.aliases ?? {})) {
      aliasReverse[canonical] ??= [];
      aliasReverse[canonical].push(alias);
    }
    for (const [name, param] of Object.entries(schema.params)) {
      if (args.name !== undefined && name !== args.name) continue;
      const aliasList = aliasReverse[name];
      const includeEnum =
        args.name !== undefined && param.enum_values !== undefined;
      entries.push({
        block,
        name,
        display_name: param.display_name,
        unit: param.unit,
        display_min: param.display_min,
        display_max: param.display_max,
        has_aliases: aliasList && aliasList.length > 0 ? aliasList : undefined,
        enum_values: includeEnum ? param.enum_values : undefined,
        host_label: param.host_label,
        parameter_name: param.parameter_name,
        applies_only_when: param.applies_only_when,
      });
    }
  }
  // P5-011 item 4 / HW-012 — Claude Desktop sometimes thinks the connector
  // isn't attached when in fact it is but the tool schemas hadn't been
  // loaded yet. Getting this response proves mcp-midi-tools is live and
  // its tools callable. Kept on the unified list_params surface after
  // am4_list_params was removed v0.3.
  const live_confirmation =
    'mcp-midi-tools MCP server is live and reachable. The unified tool ' +
    'surface (apply_preset, set_param, set_params, set_block, set_bypass, ' +
    'switch_preset, switch_scene, save_preset, rename, scan_locations, ' +
    'restore_defaults, get_param, get_params, describe_device, list_params, ' +
    'lookup_lineage) is registered — pass port as the device id (e.g. "am4", ' +
    '"axe-fx-ii", "hydrasynth") to address the device. A connected device is ' +
    'detected at the OS level via list_midi_ports; this tool responds ' +
    'regardless of whether the device itself is plugged in.';
  return {
    device: desc.display_name,
    blocks: Object.keys(desc.blocks),
    params: entries,
    live_confirmation,
  };
}

/**
 * Pure lookup for `lookup_lineage`. No MIDI I/O — purely a query against
 * the descriptor's static lineage corpus.
 */
export function executeLookupLineage(args: {
  port: string;
  block_type: string;
  name?: string;
  real_gear?: string;
  manufacturer?: string;
  model?: string;
  include_quotes?: boolean;
}): { device: string; ok: boolean; text: string } {
  const descriptor = requireDevice(args.port);
  if (!descriptor.capabilities.supports_lineage) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `${descriptor.display_name} does not have a lineage corpus.`,
    );
  }
  if (descriptor.reader.lookupLineage === undefined) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `lookup_lineage is not implemented for ${descriptor.display_name}.`,
    );
  }
  const result = descriptor.reader.lookupLineage(args);
  return { ...result, device: descriptor.display_name };
}
