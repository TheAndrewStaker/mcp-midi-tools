/**
 * BK-051 dispatcher — 6-step request lifecycle for unified MCP tools.
 *
 * Every unified named-device tool (`set_param`, `get_param`,
 * `apply_preset`, `set_block`, etc., registered in Session B) routes
 * through this module. The dispatcher owns validation centrally so
 * the error envelope is consistent across devices.
 *
 * Lifecycle (Session 63 design §3):
 *   1. resolveDevice(port) → descriptor
 *   2. capability gate (e.g. switch_scene against has_scenes=false)
 *   3. argument normalization (block/param/channel/location aliasing)
 *   4. value validation + display→wire encoding
 *   5. ensureConnection(label)
 *   6. hand-off to descriptor.writer / descriptor.reader
 *
 * Session A scope: only the pure `encode*` paths land here. Sessions
 * B onward add the `execute*` wrappers that open a real MIDI handle
 * and call the descriptor's execute methods. The split keeps the
 * verify-dispatcher.ts golden hardware-free.
 */

import { DispatchError, type DeviceDescriptor, type DispatchErrorDetails } from './types.js';
import { listRegisteredDevices, resolveDevice } from './registry.js';

// ── Step 1: port resolution ────────────────────────────────────────

/**
 * Resolves `port` to a registered descriptor or throws a
 * `port_not_found` DispatchError with the list of known devices.
 */
export function requireDevice(port: string): DeviceDescriptor {
  const desc = resolveDevice(port);
  if (desc) return desc;
  const known = listRegisteredDevices()
    .map((d) => d.display_name)
    .join(', ');
  const details: DispatchErrorDetails = {
    valid_options: listRegisteredDevices().map((d) => d.display_name),
    retry_action: 'Call list_midi_ports to see what is connected.',
  };
  throw new DispatchError(
    'port_not_found',
    '(no device matched)',
    known.length > 0
      ? `No registered device matches port '${port}'. Known devices: ${known}.`
      : `No registered device matches port '${port}'. No devices are registered yet.`,
    details,
  );
}

// ── Step 3a: block-name normalization ───────────────────────────────

/**
 * Resolves a (possibly aliased / native-vocabulary) block name to its
 * canonical name within the descriptor. Throws `unknown_block` if no
 * match. Forgiving lookup: descriptor canonical block names always
 * match; device-native synonyms in `block_aliases` match too.
 */
export function resolveBlockName(
  descriptor: DeviceDescriptor,
  input: string,
): string {
  if (input in descriptor.blocks) return input;
  const aliased = descriptor.block_aliases?.[input];
  if (aliased !== undefined && aliased in descriptor.blocks) return aliased;
  const valid = Object.keys(descriptor.blocks);
  // Cap inline list at 8; longer lists go behind a list_params hint.
  const sample = valid.slice(0, 8).join(', ');
  const details: DispatchErrorDetails = {
    valid_options: valid.length <= 8 ? valid : undefined,
    valid_options_tool: valid.length > 8 ? 'list_params(port)' : undefined,
    retry_action: valid.length > 8
      ? `Call list_params for the full block list on ${descriptor.display_name}.`
      : undefined,
  };
  throw new DispatchError(
    'unknown_block',
    descriptor.display_name,
    valid.length > 8
      ? `Block '${input}' is not valid on ${descriptor.display_name}. First few: ${sample}… (call list_params for the full list).`
      : `Block '${input}' is not valid on ${descriptor.display_name}. Blocks: ${sample}.`,
    details,
  );
}

// ── Step 3b: param-name normalization ───────────────────────────────

/**
 * Returns the canonical (post-alias) param name within a block. Throws
 * `unknown_param` on miss. Per the design's "forgiveness over
 * strictness" rule, aliases resolve silently — the result of the
 * downstream tool call reports the canonical name back, so the LLM's
 * summary uses the right word.
 *
 * For the unified surface, callers should report aliasing in their
 * success envelope (e.g. `{ param_resolved_from: 'reverb.decay' →
 * 'reverb.time' }`). The dispatcher doesn't synthesize that report — it
 * just resolves silently.
 */
export function resolveParamName(
  descriptor: DeviceDescriptor,
  block: string,
  input: string,
): { name: string; aliased_from?: string } {
  const schema = descriptor.blocks[block];
  if (schema === undefined) {
    throw new DispatchError(
      'unknown_block',
      descriptor.display_name,
      `Block '${block}' is not registered on ${descriptor.display_name}.`,
    );
  }
  if (input in schema.params) return { name: input };
  const aliased = schema.aliases?.[input];
  if (aliased !== undefined && aliased in schema.params) {
    return { name: aliased, aliased_from: input };
  }
  // Suggest the closest match within Levenshtein distance ≤ 2.
  const suggestion = nearestParam(input, Object.keys(schema.params));
  const valid = Object.keys(schema.params);
  const details: DispatchErrorDetails = {
    suggestion,
    valid_options_tool: 'list_params(port, block)',
    retry_action: suggestion
      ? `Did you mean '${block}.${suggestion}' on ${descriptor.display_name}?`
      : `Call list_params(port='${descriptor.id}', block='${block}') for the full param list.`,
  };
  throw new DispatchError(
    'unknown_param',
    descriptor.display_name,
    suggestion
      ? `Parameter '${block}.${input}' is not valid on ${descriptor.display_name} — did you mean '${block}.${suggestion}'?`
      : `Parameter '${block}.${input}' is not valid on ${descriptor.display_name}. Known params for ${block}: ${valid.slice(0, 8).join(', ')}${valid.length > 8 ? `… (${valid.length} total — call list_params for the full list)` : ''}.`,
    details,
  );
}

function nearestParam(input: string, candidates: readonly string[]): string | undefined {
  const lower = input.toLowerCase();
  let best: { name: string; d: number } | undefined;
  for (const candidate of candidates) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d <= 2 && (best === undefined || d < best.d)) best = { name: candidate, d };
  }
  return best?.name;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 2) return 3;
  const dp: number[] = Array.from({ length: bl + 1 }, (_, j) => j);
  for (let i = 1; i <= al; i++) {
    let prev = i - 1;
    let curr = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      curr = a[i - 1] === b[j - 1]
        ? prev
        : Math.min(prev, dp[j], dp[j - 1]) + 1;
      dp[j - 1] = prev;
      prev = tmp;
      dp[j] = curr;
    }
  }
  return dp[bl];
}

// ── Step 3c: channel normalization ──────────────────────────────────

/**
 * Resolves a user-supplied channel (`'A'..'D'` / `'X'/'Y'` / `0..N-1`)
 * to its 0-based device-native index. Throws `bad_channel` if the
 * input doesn't match the descriptor's `channel_names`, or
 * `capability_not_supported` if the device has no channels at all.
 *
 * Returns undefined when `input` is undefined — caller (writer) treats
 * "no channel specified" as "write to whichever channel is active."
 */
export function resolveChannel(
  descriptor: DeviceDescriptor,
  block: string,
  input: string | number | undefined,
): number | undefined {
  if (input === undefined) return undefined;
  const caps = descriptor.capabilities;
  if (!caps.has_channels) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `Channels are not a concept on ${descriptor.display_name}. Drop the channel argument.`,
    );
  }
  const names = caps.channel_names ?? [];
  if (caps.channel_blocks && !caps.channel_blocks.includes(block)) {
    throw new DispatchError(
      'capability_not_supported',
      descriptor.display_name,
      `Block '${block}' on ${descriptor.display_name} does not expose channels — only ${caps.channel_blocks.join('/')} do. Drop the channel argument for this block.`,
    );
  }
  if (typeof input === 'number') {
    if (Number.isInteger(input) && input >= 0 && input < names.length) return input;
    throw new DispatchError(
      'bad_channel',
      descriptor.display_name,
      `Channel index ${input} is out of range on ${descriptor.display_name} (valid: 0..${names.length - 1} / ${names.join('/')}).`,
    );
  }
  const upper = input.toUpperCase();
  const idx = names.indexOf(upper);
  if (idx >= 0) return idx;
  throw new DispatchError(
    'bad_channel',
    descriptor.display_name,
    `Channel '${input}' is not valid on ${descriptor.display_name} (channels are ${names.join('/')}).`,
    { valid_options: names },
  );
}

// ── Step 4: value validation + display→wire encoding ────────────────

/**
 * Validates a (block, name) pair and runs the param's encoder. Returns
 * the wire-ready integer the writer expects. Throws one of the
 * value-class errors (`value_out_of_range`, `unknown_enum_value`,
 * `ambiguous_enum_value`) on failure.
 *
 * The encoder lives on the param schema; this function adds the
 * device + tool envelope around any error the encoder throws so the
 * LLM sees a consistent message.
 */
export function encodeValue(
  descriptor: DeviceDescriptor,
  block: string,
  name: string,
  value: number | string,
): number {
  const schema = descriptor.blocks[block]?.params[name];
  if (schema === undefined) {
    throw new DispatchError(
      'unknown_param',
      descriptor.display_name,
      `Parameter '${block}.${name}' is not registered on ${descriptor.display_name}.`,
    );
  }
  try {
    return schema.encode(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The param's encode() throws plain Error; classify here.
    const code =
      schema.unit === 'enum'
        ? (msg.toLowerCase().includes('ambiguous') ? 'ambiguous_enum_value' : 'unknown_enum_value')
        : 'value_out_of_range';
    throw new DispatchError(
      code,
      descriptor.display_name,
      `set_param: ${block}.${name} on ${descriptor.display_name} — ${msg}`,
    );
  }
}

// ── Convenience: encode-only set_param path used by goldens ─────────

/**
 * Pure-side full pipeline for `set_param`: resolve port → resolve
 * block/param → encode value → produce the wire bytes the dispatcher
 * WOULD send. Hardware-free; the verify-dispatcher.ts golden uses this
 * to assert byte-equivalence with the pre-dispatcher path.
 *
 * Does NOT produce channel-switch bytes — channel switching is the
 * writer's runtime responsibility. The golden only asserts the
 * param-write bytes match.
 */
export interface EncodedSetParam {
  device: string;
  canonical_block: string;
  canonical_name: string;
  wire_value: number;
  bytes: number[];
}

export function encodeSetParam(args: {
  port: string;
  block: string;
  name: string;
  value: number | string;
}): EncodedSetParam {
  const descriptor = requireDevice(args.port);
  const canonical_block = resolveBlockName(descriptor, args.block);
  const { name: canonical_name } = resolveParamName(descriptor, canonical_block, args.name);
  const wire_value = encodeValue(descriptor, canonical_block, canonical_name, args.value);
  const bytes = descriptor.writer.buildSetParam(canonical_block, canonical_name, wire_value);
  return {
    device: descriptor.display_name,
    canonical_block,
    canonical_name,
    wire_value,
    bytes,
  };
}
