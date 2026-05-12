/**
 * Axe-Fx II layout tools — bypass writes, grid reads, and per-cell
 * block placement on the 4×12 routing grid.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { BLOCK_BY_ID } from '@/fractal/axe-fx-ii/blockTypes.js';
import {
  buildGetGridLayout,
  buildSetBlockBypass as buildSetBlockBypassEnvelope,
  buildSetGridCell,
  isGetGridLayoutResponse,
  isSetGridCellResponse,
  parseGetGridLayoutResponse,
  parseSetGridCellResponse,
} from '@/fractal/axe-fx-ii/setParam.js';

import { renderGridAscii, renderGridJson, renderGridMarkdown, renderGridSummary } from './gridRender.js';
import {
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  findBlock,
  toHex,
} from './shared.js';

export function registerAxeFxIILayoutTools(server: McpServer): void {


  server.registerTool('axefx2_set_block_bypass', {
    description: [
      'Use this tool to bypass or engage a block on the user\'s Axe-Fx II.',
      'Per the wiki, bypass uses the same SET_BLOCK_PARAMETER_VALUE function',
      'with paramId = 255: value 0 engages the block, value 1 bypasses it.',
      '',
      'Some blocks (Mixer, Input, Output, Controllers, Feedback Send/Return)',
      'don\'t expose a bypass — call axefx2_list_block_types to see which',
      'blocks have `canBypass: true`. Trying to bypass a no-bypass block',
      'will still send the wire bytes (the device ignores them) but the',
      'tool surfaces a warning rather than fabricating success.',
      '',
      'NO-ACK PROTOCOL — same caveat as axefx2_set_param. The signal of',
      'success is the user hearing the block engage / disengage and the',
      'device\'s LED state changing.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId. Call axefx2_list_block_types for the full set.',
      ),
      bypassed: z.boolean().describe(
        'true = bypass (block out of signal path), false = engage (block in signal path).',
      ),
    },
  }, async ({ block, bypassed }) => {
    const target = findBlock(block);
    const bytes = buildSetBlockBypassEnvelope(target.id, bypassed);
    const c = ensureConn();
    c.send(bytes);
    const noBypassWarning = target.canBypass
      ? ''
      : `\n\nWARNING: ${target.name} (group ${target.groupCode}) is documented as no-bypass per the wiki. ` +
        `The wire write was sent (${bytes.length} bytes) but the device likely ignored it.`;
    return {
      content: [{
        type: 'text',
        text:
          `Sent bypass=${bypassed ? 'BYPASS' : 'ENGAGE'} for ${target.name} ` +
          `(${target.groupCode}, effectId ${target.id}, paramId 255).\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}${noBypassWarning}\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx2_get_grid_layout', {
    description: [
      'Use this tool to read the active preset\'s 4-row × 12-column block-',
      'placement grid on the user\'s Axe-Fx II. Sends GET_GRID_LAYOUT_AND_',
      'ROUTING (function 0x20) and parses the 48-cell response. Each cell',
      'reports a block ID + a routing-input mask saying which rows of the',
      'previous column connect to its input.',
      '',
      'CRITICAL FOR HONEST AGENT BEHAVIOR — the MVP does NOT support',
      'changing the grid layout (no add/remove/rearrange/cabling). When',
      'the user asks for a tone change, call this FIRST so you know which',
      'blocks are actually placed in the chain. Don\'t suggest tweaks to a',
      'block ("more reverb decay") if it\'s not on the grid — instead say',
      '"I don\'t see a reverb in the chain; please add Reverb 1 to the',
      'grid via the device or AxeEdit, then I can dial it in".',
      '',
      'Cell semantics:',
      '- blockId 100..170 = a placed block (Amp 1 = 106, Reverb 1 = 110, etc).',
      '  Cross-reference axefx2_list_block_types output.',
      '- blockId 200..235 = a shunt (signal pass-through, no effect, used',
      '  to draw cabling around or through a column).',
      '- blockId 0 = empty cell.',
      '',
      'Routing mask: 4 bits, one per row of the previous column.',
      '- mask & 0x01 → connect from row 1 of previous column',
      '- mask & 0x02 → connect from row 2',
      '- mask & 0x04 → connect from row 3',
      '- mask & 0x08 → connect from row 4',
      '- mask = 0    → no input (start of a new chain or empty cell)',
      '',
      'Output formats:',
      '  - `summary` (default) — one-line-per-row prose. Reads well on any',
      '    chat width, surfaces the iconic single-serial-row case as natural',
      '    "CPR1 → WAH1 → ... → REV1" prose. Best for chat UX.',
      '  - `markdown` — markdown table that renders as a real HTML table in',
      '    Claude Desktop / Cursor / Continue. Use when the grid is non-trivial',
      '    (multi-row, parallel paths) and the spatial layout matters.',
      '  - `ascii` — fixed-width 4×12 grid. Useful in terminal-based MCP',
      '    clients or wide monitors. Wraps badly in narrow chat windows.',
      '  - `json` — raw cell array for machine parsing.',
    ].join('\n'),
    inputSchema: {
      format: z.enum(['summary', 'markdown', 'ascii', 'json']).optional().describe(
        'Output rendering. "summary" (default) for one-line-per-row prose; "markdown" for a chat-rendered table; "ascii" for fixed-width grid; "json" for raw cell array.',
      ),
    },
  }, async ({ format }) => {
    const reqBytes = buildGetGridLayout();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isGetGridLayoutResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_grid_layout failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const cells = parseGetGridLayoutResponse(response);
    const rendered = format === 'json'
      ? renderGridJson(cells)
      : format === 'ascii'
        ? renderGridAscii(cells)
        : format === 'markdown'
          ? renderGridMarkdown(cells)
          : renderGridSummary(cells);
    return {
      content: [{
        type: 'text',
        text:
          `Axe-Fx II grid layout (4 rows × 12 columns, 48 cells):\n\n${rendered}\n\n`,
      }],
    };
  });


  server.registerTool('axefx2_set_block_at_cell', {
    description: [
      'Place a block at a specific grid cell on the Axe-Fx II — the wire-',
      'level write that AxeEdit fires when you drag a block from its',
      'palette onto a grid position. Sends function 0x05 SET_GRID_CELL.',
      '',
      'WHAT IT DOES:',
      '  - Places a block at the specified (row, col) cell.',
      '  - If the block was already on the grid elsewhere, the device',
      '    MOVES it (clears its previous position).',
      '  - Pass `block: "empty"` (or numeric 0) to CLEAR the cell.',
      '',
      'CHAIN ROUTING — row 2 auto-routes; other rows do NOT:',
      '  Row 2 is the device\'s canonical signal lane. When you place a',
      '  block on row 2, the device assigns its input mask to :2 ("feed',
      '  from row 2 of previous column"). Practical effect: building a',
      '  fresh linear chain on row 2 by placing blocks left-to-right',
      '  (col 1 → 2 → 3 → ...) WORKS — each block automatically reads',
      '  from the upstream block on the same row.',
      '',
      '  Rows 1, 3, and 4 do NOT auto-route. Placements on those rows',
      '  land with mask 0 (no input). They are isolated islands until',
      '  explicit routing control ships (see "ROUTING LIMITATIONS" below).',
      '  For now, build chains on row 2.',
      '',
      'CHAIN ROUTING — additional break case:',
      '  REMOVING a block from row 2 then RE-PLACING another block in',
      '  the SAME cell does NOT auto-restore the downstream cell\'s',
      '  routing mask. If you clear cell N then re-write something there,',
      '  cell N+1\'s input mask was cleared by the device when the feeder',
      '  vanished and is NOT restored when the new block arrives.',
      '',
      'RECOMMENDED USAGE PATTERNS:',
      '  - Building a preset from scratch on row 2: clear row 2 cells',
      '    1..N first (with `block: "empty"`), then place blocks',
      '    left-to-right on row 2. All masks come out as :2 → linear',
      '    chain works automatically. This is what axefx2_apply_preset_at',
      '    does internally.',
      '  - Modifying an existing row-2 chain: re-place every block from',
      '    the edit point onward to refresh their routing masks.',
      '  - Single-block tweaks within an existing layout: works fine if',
      '    you replace a block with another in the SAME cell.',
      '',
      'ROUTING LIMITATIONS (open decode work):',
      '  Explicit routing-mask control (for parallel chains, multi-row',
      '  layouts, FX loops, stereo splits) requires either: (a) byte[3]',
      '  of the 0x05 payload controlling routing — currently set to 0',
      '  by this tool — pending hardware verification, or (b) a separate',
      '  function 0x06 write — also undecoded. Either decode unlocks',
      '  rows 1/3/4 + parallel routing. Tracked as a follow-up.',
      '',
      'POSITION CONVENTION:',
      '  - `row`: 1..4 (1-indexed, matches device front-panel display).',
      '  - `col`: 1..12 (1-indexed).',
      '  - Wire format uses col-major cell index = (col-1)*4 + (row-1).',
      '    The tool handles the conversion.',
      '',
      'BLOCK REFERENCE:',
      '  - Named blocks (preferred): "Amp 1", "Compressor 1", "Reverb 2"',
      '    etc. — case-insensitive, matched against the blockTypes',
      '    catalog (IDs 100..170).',
      '  - Numeric IDs: pass the 14-bit effect ID directly. Useful for',
      '    Shunts (IDs 200..235, not in the named catalog) — pass 200',
      '    for a generic pass-through cell.',
      '  - "empty" or 0: clears the cell.',
      '',
      'Status: 🟢 wire format hardware-validated on Q8.02 XL+',
      '(session-63 probe sequence, 2026-05-11). Probe-and-observe decode',
      'using passive capture; no bridge required. Routing auto-restore',
      'limitation documented above and queued as a follow-up decode.',
    ].join('\n'),
    inputSchema: {
      row: z.number().int().min(1).max(4).describe(
        'Grid row 1..4 (1 = top row, 2 = main signal lane on most factory presets).',
      ),
      col: z.number().int().min(1).max(12).describe(
        'Grid column 1..12 (1 = leftmost / chain start).',
      ),
      block: z.union([z.string(), z.number()]).describe(
        'Block to place. Display name (e.g. "Amp 1"), numeric effect ID, "empty"/"clear" to clear the cell, or "shunt" for a pass-through. Shunt IDs 200..235 also accepted as numbers.',
      ),
    },
  }, async ({ row, col, block }) => {
    // Resolve block reference to a numeric ID.
    let blockId: number;
    let displayName: string;
    if (typeof block === 'number') {
      blockId = block;
      if (blockId === 0) {
        displayName = '<empty>';
      } else if (blockId >= 200 && blockId <= 235) {
        displayName = `Shunt (ID ${blockId})`;
      } else {
        const named = BLOCK_BY_ID[blockId];
        displayName = named ? `${named.name} (ID ${blockId})` : `Block ID ${blockId}`;
      }
    } else {
      const norm = block.trim().toLowerCase();
      if (norm === 'empty' || norm === 'clear' || norm === 'none') {
        blockId = 0;
        displayName = '<empty>';
      } else if (norm === 'shunt') {
        blockId = 200;
        displayName = 'Shunt';
      } else {
        const named = findBlock(block);
        blockId = named.id;
        displayName = `${named.name} (ID ${named.id})`;
      }
    }

    const bytes = buildSetGridCell({ row, col, blockId });
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGridCellResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(bytes);

    let ackText: string;
    try {
      const ack = await responsePromise;
      const parsed = parseSetGridCellResponse(ack);
      if (parsed.ok) {
        ackText =
          `Device ACK: 0x64 echoed_fn=0x05 result_code=0x00 (OK).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}`;
      } else {
        ackText =
          `Device NACK: 0x64 echoed_fn=0x05 result_code=0x` +
          `${parsed.resultCode.toString(16).padStart(2, '0')} ` +
          `(NOT OK — the device parsed the frame but rejected it).\n` +
          `Recv (${ack.length}B): ${toHex(ack)}\n` +
          `Common cause: device firmware refused the placement. The` +
          ` working buffer is likely unchanged; verify with` +
          ` axefx2_get_grid_layout.`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ackText =
        `No 0x64 ACK arrived within ${GET_RESPONSE_TIMEOUT_MS}ms: ${msg}.\n` +
        `The SET_GRID_CELL bytes were sent successfully; verify the` +
        ` change with axefx2_get_grid_layout.`;
    }

    const cellIdx = (col - 1) * 4 + (row - 1);
    return {
      content: [{
        type: 'text',
        text:
          `Placed ${displayName} at row ${row}, col ${col} ` +
          `(cell index ${cellIdx}).\n` +
          `Wire (${bytes.length}B): ${toHex(bytes)}\n\n` +
          ackText + '\n\n' +
          `Next step: call axefx2_get_grid_layout to see the new grid` +
          ` state. Note: routing/cabling is NOT auto-propagated to` +
          ` downstream cells — if you modified an existing chain, you` +
          ` may need to re-place downstream blocks to restore their` +
          ` input masks.`,
      }],
    };
  });

}
