/**
 * Navigation tools — preset / scene / location moves and bulk scanning.
 *
 * Tools registered here:
 *   - `switch_preset(port, location)` — load a stored preset into working buffer
 *   - `save_preset(port, location, name?)` — persist working buffer to a location
 *   - `switch_scene(port, scene)` — change active scene
 *   - `rename(port, target, name)` — rename the working-buffer preset or a scene
 *   - `scan_locations(port, from, to)` — bulk-scan stored preset names
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  executeRename,
  executeSavePreset,
  executeScanLocations,
  executeSwitchPreset,
  executeSwitchScene,
} from '@/protocol/generic/dispatcher.js';
import {
  ON_EDITED_DESCRIPTION,
  ON_EDITED_SCHEMA,
} from '@/server/shared/safeEdit.js';

import { PORT_DESC, asError, asText } from './shared.js';

export function registerNavigationTools(server: McpServer): void {
  server.registerTool('switch_preset', {
    description: [
      'Load a stored preset location into the device\'s working buffer.',
      'Same effect as turning the preset knob on the hardware or selecting',
      'a preset in the device\'s editor app.',
      'WARNING: discards any unsaved edits in the current working buffer.',
      'If the user has been tone-building via apply_preset / set_param and',
      'hasn\'t yet called save_preset, those edits are lost. Confirm intent',
      'before issuing this after a session of building, especially if any',
      'set_param / set_block writes are still un-persisted.',
      'Location format depends on the device — call describe_device to see',
      'the preset_location_format regex (AM4: A1..Z4 unpadded matching the',
      'device display; Axe-Fx II: 1..16384 1-indexed front-panel slot;',
      'Hydrasynth: A1..H8). Pass either the string form or a numeric index.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      location: z.union([z.string(), z.number()]).describe(
        'Preset location. See describe_device.capabilities.preset_location_format for the device\'s expected shape.',
      ),
      on_active_preset_edited: ON_EDITED_SCHEMA.describe(ON_EDITED_DESCRIPTION),
    },
  }, async ({ port, location, on_active_preset_edited }) => {
    try {
      const result = await executeSwitchPreset({ port, location, on_active_preset_edited });
      if (result.refused) {
        return {
          content: [{ type: 'text', text: result.warningText ?? 'navigation refused' }],
          isError: true,
        };
      }
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  server.registerTool('save_preset', {
    description: [
      'Persist the device\'s working-buffer preset to a stored location.',
      'Optional `name` argument renames the preset first (composite rename',
      '+ save). Same destructive-write semantics as the legacy device-',
      'namespaced save tools — call this ONLY when the user has explicitly',
      'asked to save / persist / store / keep the preset; apply_preset is',
      'reversible (switch presets to discard), save_preset is not.',
      'A bare "make me a preset for X" is a try-it-out ask, not a save ask.',
      'When in doubt, apply_preset first and ask whether to persist.',
      'If the target location is non-empty, confirm with the user before',
      'overwriting. The user\'s scratch location on AM4 is "Z04" by',
      'convention.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      location: z.union([z.string(), z.number()]).describe(
        'Storage location. See describe_device for the device\'s shape.',
      ),
      name: z.string().max(32).optional().describe(
        'Optional new name (up to 32 chars). If supplied, the preset is renamed before saving.',
      ),
    },
  }, async ({ port, location, name }) => {
    try {
      const result = await executeSavePreset({ port, location, name });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  server.registerTool('switch_scene', {
    description: [
      'Switch the active scene within the current preset. Scene switch',
      'does not change the preset\'s block layout — it toggles per-scene',
      'bypass + channel state. Devices without scenes (e.g. Hydrasynth)',
      'reject this call with a capability error.',
      'SCOPE: current working buffer only. Scene index is not stored on',
      'preset load — the next preset load starts at its default scene.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      scene: z.number().int().describe(
        'Scene number (1-indexed). Range depends on the device — AM4: 1..4; Axe-Fx II: 1..8.',
      ),
    },
  }, async ({ port, scene }) => {
    try {
      const result = await executeSwitchScene({ port, scene });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  server.registerTool('rename', {
    description: [
      'Rename the working-buffer preset or one of its scenes. Target is',
      '"preset" (working-buffer preset name) or "scene:N" (1-indexed scene',
      'number). Devices without scenes reject scene targets.',
      'SCOPE: writes to the working buffer only. The rename persists across',
      'preset loads only if save_preset is called afterward. Without a',
      'subsequent save, loading a different preset discards the rename.',
      'AM4 NOTE: rename(target="preset") needs a paired save_preset to',
      'land — the AM4 wire protocol requires a location even for "rename',
      'the working buffer". Use save_preset(location, name) for the full',
      'rename + persist flow; rename(target="scene:N") on AM4 writes the',
      'scene name into the working buffer and waits for save_preset.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      target: z.string().describe(
        'Rename target — "preset" or "scene:N" (1-indexed).',
      ),
      name: z.string().min(1).max(32).describe(
        'New name (1..32 chars). Shorter names are space-padded on the wire by the device.',
      ),
    },
  }, async ({ port, target, name }) => {
    try {
      const result = await executeRename({ port, target, name });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });

  server.registerTool('scan_locations', {
    description: [
      'Bulk-scan a range of stored preset locations and return their',
      'names. Non-destructive — working buffer and active location are',
      'preserved. Iconic use: setlist-load opener. Before bulk-applying',
      'patches into a target bank range, scan first to find which locations',
      'already hold custom presets the user might want to back up, and',
      'which are empty / safe to overwrite.',
      'Empty locations come back with is_empty=true so you can preserve',
      'that wording in chat ("M03 is empty; M04 holds your Texas Blues").',
      'On a mid-loop failure, the scan aborts and surfaces partial results',
      'plus the failure location so the caller can retry or back off.',
    ].join(' '),
    inputSchema: {
      port: z.string().describe(PORT_DESC),
      from: z.union([z.string(), z.number()]).describe(
        'Inclusive start of the scan range. AM4: "A01"..."Z04"; Axe-Fx II: 0..383; etc.',
      ),
      to: z.union([z.string(), z.number()]).describe(
        'Inclusive end of the scan range. Pass from <= to.',
      ),
    },
  }, async ({ port, from, to }) => {
    try {
      const result = await executeScanLocations({ port, from, to });
      return asText(result);
    } catch (err) {
      return asError(err);
    }
  });
}
