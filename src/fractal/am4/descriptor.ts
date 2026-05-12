/**
 * AM4 DeviceDescriptor — top-level assembler for the BK-051 unified tool
 * surface.
 *
 * Wraps the existing AM4 protocol code (params.ts, blockTypes.ts,
 * setParam.ts, locations.ts) into the `DeviceDescriptor` contract from
 * `src/protocol/generic/types.ts`. The wire layer is byte-frozen — no
 * code under `src/fractal/am4/` outside this descriptor directory is
 * modified. This file is the translation layer between the legacy
 * direct-call shape and the dispatcher-routed shape.
 *
 * Coexists with `src/fractal/am4/device.ts` (the Fractal-protocol-layer
 * `FractalDevice` instance used by the cross-Fractal device registry).
 * Both registries hold an AM4 entry; they serve different layers.
 *
 * Split into a per-role directory (Session 65) so the writer object
 * (~720 LOC of execute methods + pure builders) doesn't sit alongside
 * the reader, schema helpers, and the top-level descriptor literal:
 *
 *   - `descriptor/schema.ts`  — makeEncode / makeDecode / buildBlocks /
 *                                buildBlockTypes / parseAm4Location
 *   - `descriptor/writer.ts`  — DeviceWriter (14 methods)
 *   - `descriptor/reader.ts`  — DeviceReader (4 methods)
 *
 * Consumers continue to import `AM4_DESCRIPTOR` from
 * `@/fractal/am4/descriptor.js`; the directory split is internal.
 */

import type { DeviceDescriptor } from '@/protocol/generic/types.js';

import { TOTAL_LOCATIONS } from '@/fractal/am4/locations.js';

import { buildBlocks, buildBlockTypes } from './descriptor/schema.js';
import { reader } from './descriptor/reader.js';
import { writer } from './descriptor/writer.js';

export const AM4_DESCRIPTOR: DeviceDescriptor = {
  id: 'am4',
  display_name: 'Fractal AM4',
  connection_label: 'am4',                      // matches AM4_LABEL in connections.ts
  port_match: [
    { pattern: /AM4/i },
    { pattern: /Fractal/i },
  ],
  capabilities: {
    slot_model: 'linear',
    slot_count: 4,
    has_scenes: true,
    scene_count: 4,
    has_channels: true,
    channel_names: ['A', 'B', 'C', 'D'],
    channel_blocks: ['amp', 'drive', 'reverb', 'delay'],
    preset_location_format: /^[A-Z](0[1-4])$/,
    supports_save: true,
    supports_factory_restore: true,
    supports_lineage: true,
  },
  canonical_terms: {
    block: 'block',
    slot: 'slot 1–4',
    preset: 'preset',
    scene: 'scene 1–4',
    channel: 'channel A/B/C/D',
    location: `location A01..Z04 (${TOTAL_LOCATIONS} total)`,
  },
  blocks: buildBlocks(),
  block_types: buildBlockTypes(),
  reader,
  writer,
};
