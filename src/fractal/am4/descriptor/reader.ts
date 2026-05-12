/**
 * AM4 DeviceDescriptor — `DeviceReader` implementation.
 *
 * 4 read operations:
 *   - `getParam` — single-value read via `sendReadAndParse` with optional
 *     pre-read channel switch (so callers can target A/B/C/D without a
 *     separate switch call).
 *   - `getParams` — batch wrapper around `getParam`; collects errors per
 *     entry instead of throwing.
 *   - `scanLocations` — readPresetName loop across a contiguous range,
 *     returning name + is_empty per slot.
 *   - `lookupLineage` — Fractal-authored lineage lookup against the
 *     shared corpus (amps / drives / reverbs / delays).
 *
 * All wire-side I/O is delegated to `sendReadAndParse` / `readPresetName`
 * from `@/server/shared/readOps.js`; the runLineageLookup pipeline is
 * file-only.
 */

import type {
  DeviceReader,
  DispatchCtx,
  ReadResult,
  ScannedLocation,
} from '@/protocol/generic/types.js';
import { DispatchError } from '@/protocol/generic/types.js';

import {
  KNOWN_PARAMS,
  decode as am4Decode,
  type Param,
  type ParamKey,
} from '@/fractal/am4/params.js';
import { formatLocationDisplay } from '@/fractal/am4/locations.js';
import { readPresetName, sendReadAndParse } from '@/server/shared/readOps.js';
import {
  CHANNEL_BLOCKS,
  switchBlockChannel,
} from '@/server/shared/channels.js';
import {
  LINEAGE_BLOCKS,
  formatLineageRecord,
  runLineageLookup,
} from '@/fractal/shared/lineageLookup.js';

import { parseAm4Location } from './schema.js';

// ── Reader adapter ──────────────────────────────────────────────────
//
// `getParam` wraps the existing `sendReadAndParse` + `decode` pipeline
// from the legacy `am4_get_param` handler. The dispatcher pre-resolves
// the canonical (block, name); this method does the wire round-trip
// and returns the display value. Optional channel switch happens
// before the read so callers can target A/B/C/D explicitly without
// a separate switch tool call.

export const reader: DeviceReader = {
  async getParam(
    ctx: DispatchCtx,
    block: string,
    name: string,
    channel?: string | number,
  ): Promise<ReadResult> {
    const key = `${block}.${name}` as ParamKey;
    const param: Param = KNOWN_PARAMS[key];
    if (channel !== undefined && CHANNEL_BLOCKS.has(block)) {
      await switchBlockChannel(ctx.conn, block, channel);
    }
    const parsed = await sendReadAndParse(ctx.conn, param.pidLow, param.pidHigh);
    const wire = param.unit === 'enum'
      ? parsed.asUInt32LE()
      : parsed.asInternalFloat();
    const display = param.unit === 'enum'
      ? ((param.enumValues as Record<number, string> | undefined)?.[Math.round(wire)] ?? Math.round(wire))
      : am4Decode(param, wire);
    return {
      block,
      name,
      wire_value: wire,
      display_value: display,
      unit: param.unit,
    };
  },

  async getParams(ctx: DispatchCtx, queries) {
    const reads: ReadResult[] = [];
    const failed_indices: number[] = [];
    const errors: Record<number, string> = {};
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      try {
        reads.push(await reader.getParam(ctx, q.block, q.name, q.channel));
      } catch (err) {
        failed_indices.push(i);
        errors[i] = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      reads,
      failed_indices,
      errors: failed_indices.length > 0 ? errors : undefined,
    };
  },

  async scanLocations(ctx, from, to) {
    const fromIdx = parseAm4Location(from);
    const toIdx = parseAm4Location(to);
    if (fromIdx > toIdx) {
      throw new DispatchError(
        'bad_location',
        'Fractal AM4',
        `Scan range invalid: ${from} (idx ${fromIdx}) is after ${to} (idx ${toIdx}). Pass from <= to.`,
      );
    }
    const scanned: ScannedLocation[] = [];
    let failed_at: string | undefined;
    let failed_reason: string | undefined;
    for (let i = fromIdx; i <= toIdx; i++) {
      try {
        const parsed = await readPresetName(ctx.conn, i);
        scanned.push({
          location: formatLocationDisplay(i),
          name: parsed.name,
          is_empty: parsed.isEmpty,
        });
      } catch (err) {
        failed_at = formatLocationDisplay(i);
        failed_reason = err instanceof Error ? err.message : String(err);
        break;
      }
    }
    return { scanned, failed_at, failed_reason };
  },

  lookupLineage(query) {
    const blockType = query.block_type;
    if (!LINEAGE_BLOCKS.includes(blockType as typeof LINEAGE_BLOCKS[number])) {
      return {
        ok: false,
        text: `Block type '${blockType}' has no Fractal-authored lineage corpus. Valid: ${LINEAGE_BLOCKS.join(', ')}.`,
      };
    }
    const result = runLineageLookup({
      block_type: blockType as typeof LINEAGE_BLOCKS[number],
      name: query.name,
      real_gear: query.real_gear,
      manufacturer: query.manufacturer,
      model: query.model,
    });
    if (!result.found) {
      const detail = result.shape === 'structured'
        ? [
            query.manufacturer && `manufacturer="${query.manufacturer}"`,
            query.model && `model="${query.model}"`,
          ].filter(Boolean).join(', ')
        : (query.name ?? query.real_gear ?? '(unknown query)');
      return {
        ok: false,
        text: `No ${blockType} lineage records match ${detail}. ${result.totalScanned} records scanned.`,
      };
    }
    const withQuotes = query.include_quotes ?? true;
    if (result.shape === 'forward') {
      return { ok: true, text: formatLineageRecord(result.hits[0].record, withQuotes) };
    }
    const blocks = result.hits.map(
      (h) => `── ${'am4Name' in h ? h.am4Name : '?'} ──\n${formatLineageRecord(h.record, withQuotes, 3)}`,
    );
    return {
      ok: true,
      text: `${result.hits.length} ${blockType} match(es)${result.hits.length > 10 ? ' (showing top 10)' : ''}:\n\n${blocks.join('\n\n')}`,
    };
  },
};
