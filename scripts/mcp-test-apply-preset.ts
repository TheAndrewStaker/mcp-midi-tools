/**
 * MCP-driven hardware test harness for `axefx2_apply_preset_at`.
 *
 * Spawns the SHIPPED MCP server (`dist/server/index.js` — the same
 * binary Claude Desktop loads) as a child process and drives it via
 * JSON-RPC over stdio, exactly as the in-Desktop agent does. This is
 * the canonical regression harness for hardware-touching changes per
 * the founder's directive (feedback_drive_mcp_tools memory) and the
 * MCP community workflow (custom Client + StdioClientTransport for
 * scripted tests; Inspector for interactive; Desktop only for final
 * sign-off).
 *
 * SETUP:
 *   1. `npm run build` so dist/server/index.js is current.
 *   2. Close Claude Desktop AND AxeEdit (single-writer MIDI port).
 *   3. `npm run mcp-test-apply [-- --slot N --preset NAME]`
 *
 * Defaults: slot 604, "glassy-clean" preset spec.
 *
 * What it does:
 *   - Spawns the MCP server and connects.
 *   - Calls `tools/list` and prints the registered tool descriptions
 *     for `axefx2_apply_preset_at` + `axefx2_get_grid_layout` so the
 *     test path matches exactly what an agent would see and interpret.
 *   - Calls `axefx2_apply_preset_at` with the requested spec.
 *   - Calls `axefx2_get_grid_layout` and parses the chain-break warning
 *     (added gridRender.ts Session 70b).
 *   - Reports pass/fail. Exits non-zero on failure.
 *
 * Pass criteria:
 *   - apply_preset_at returns no isError
 *   - get_grid_layout response does NOT contain "CHAIN BREAK"
 *
 * Does NOT verify audio. The founder confirms audio out-of-band; this
 * is the wire-level regression that catches silent-preset bugs before
 * they ever reach the agent's conversation.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = path.resolve(process.cwd(), 'dist', 'server', 'index.js');

// ── CLI ────────────────────────────────────────────────────────────────

interface CliOpts {
  slot: number;
  presetName: keyof typeof PRESETS;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { slot: 604, presetName: 'glassy-clean' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slot') opts.slot = parseInt(argv[++i], 10);
    else if (a === '--preset') opts.presetName = argv[++i] as keyof typeof PRESETS;
  }
  if (!Number.isInteger(opts.slot) || opts.slot < 1 || opts.slot > 16384) {
    throw new Error(`--slot must be 1..16384, got ${opts.slot}`);
  }
  if (!(opts.presetName in PRESETS)) {
    throw new Error(`--preset must be one of: ${Object.keys(PRESETS).join(', ')}; got "${opts.presetName}"`);
  }
  return opts;
}

// ── Preset specs ───────────────────────────────────────────────────────

// Each spec matches axefx2_apply_preset_at's input shape: `blocks` array
// with `block` slug + optional `params` map of display-unit values. The
// MCP tool's encode layer translates display → wire under the hood.

const PRESETS = {
  // Minimal — single block. Edge case: only col 1 occupied, the rest
  // of row 2 is shunts only. Exercises the "11-cable chain to OUTPUT
  // via 11 shunts" path.
  'amp-only': {
    name: 'Amp Only',
    blocks: [
      { block: 'Amp 1', params: { input_drive: 5, master_volume: 5 } },
    ],
  },
  // Two-block edge case — Amp + Cab, the classic minimal tone.
  'amp-cab': {
    name: 'Amp Cab',
    blocks: [
      { block: 'Amp 1', params: { input_drive: 5, master_volume: 5 } },
      { block: 'Cab 1' },
    ],
  },
  // The canonical 4-block Glassy Clean chain (Session 71 oracle).
  'glassy-clean': {
    name: 'Glassy Clean',
    blocks: [
      { block: 'Compressor 1' },
      {
        block: 'Amp 1',
        params: { input_drive: 3.5, bass: 4.5, middle: 5.0, treble: 6.5, presence: 6.0, master_volume: 5.0 },
      },
      { block: 'Cab 1' },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  },
  // 6-block chain — Comp + Drive + Amp + Cab + Delay + Reverb.
  'high-gain': {
    name: 'High Gain',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      {
        block: 'Amp 1',
        params: { input_drive: 7.5, bass: 5, middle: 4, treble: 6, presence: 6, master_volume: 5 },
      },
      { block: 'Cab 1' },
      { block: 'Delay 1', params: { mix: 15 } },
      { block: 'Reverb 1', params: { mix: 20 } },
    ],
  },
  // Same 6-block shape, different param emphasis (more modulation).
  'ambient-lead': {
    name: 'Ambient Lead',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      {
        block: 'Amp 1',
        params: { input_drive: 5.5, bass: 4, middle: 5, treble: 6, presence: 6, master_volume: 5 },
      },
      { block: 'Cab 1' },
      { block: 'Delay 1', params: { mix: 35 } },
      { block: 'Reverb 1', params: { mix: 40 } },
    ],
  },
  // Saturated stack: Wah + Compressor + Drive + Drive + Amp + Cab +
  // Chorus + Delay + Reverb. 9 blocks → only 3 shunt cells. Stresses
  // the "long chain, fewer shunts" path.
  'saturated-stack': {
    name: 'Saturated Stack',
    blocks: [
      { block: 'Wah 1' },
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      { block: 'Drive 2' },
      {
        block: 'Amp 1',
        params: { input_drive: 6.5, bass: 5, middle: 4.5, treble: 6, presence: 6, master_volume: 5 },
      },
      { block: 'Cab 1' },
      { block: 'Chorus 1' },
      { block: 'Delay 1', params: { mix: 20 } },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  },
  // Max chain length — 12 content blocks fill all of row 2, zero
  // shunts. Stresses the "no shunt extension needed" path. The
  // applyExecutor's shunt loop should be a no-op here.
  'max-12-blocks': {
    name: 'Max 12 Blocks',
    blocks: [
      { block: 'Wah 1' },
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      { block: 'Drive 2' },
      { block: 'Amp 1', params: { input_drive: 5, master_volume: 5 } },
      { block: 'Cab 1' },
      { block: 'Chorus 1' },
      { block: 'Flanger 1' },
      { block: 'Phaser 1' },
      { block: 'Delay 1', params: { mix: 18 } },
      { block: 'Multi Delay 1' },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  },
} as const;

// ── MCP response helpers ───────────────────────────────────────────────

function extractText(callResult: unknown): string {
  if (!callResult || typeof callResult !== 'object') return '<no response>';
  const r = callResult as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const parts = (r.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!);
  return parts.join('\n') + (r.isError ? '\n  [tool returned isError=true]' : '');
}

function isError(callResult: unknown): boolean {
  return !!(callResult as { isError?: boolean })?.isError;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseCli(process.argv);
  const preset = PRESETS[opts.presetName];

  console.log(`MCP-driven apply test`);
  console.log(`  slot:   ${opts.slot}`);
  console.log(`  preset: ${opts.presetName} ("${preset.name}", ${preset.blocks.length} blocks)`);
  console.log('');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: 'pipe',
  });
  if (transport.stderr) {
    transport.stderr.on('data', (buf: Buffer) => {
      process.stderr.write(`[server] ${buf.toString()}`);
    });
  }

  const client = new Client(
    { name: 'mcp-test-apply-preset', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    console.log('✓ Connected to MCP server.\n');

    // ── 1. List tools, print descriptions for the tools we'll call. ──
    const { tools } = await client.listTools();
    const applyTool = tools.find((t) => t.name === 'axefx2_apply_preset_at');
    const gridTool = tools.find((t) => t.name === 'axefx2_get_grid_layout');
    if (!applyTool || !gridTool) {
      console.error('❌ Required tools not registered: axefx2_apply_preset_at and/or axefx2_get_grid_layout');
      process.exit(1);
    }

    console.log('── Tool descriptions (what the agent sees) ───────────────────');
    console.log(`\n[axefx2_apply_preset_at]\n${(applyTool.description ?? '').slice(0, 600)}${(applyTool.description ?? '').length > 600 ? '\n…' : ''}`);
    console.log(`\n[axefx2_get_grid_layout]\n${(gridTool.description ?? '').slice(0, 400)}${(gridTool.description ?? '').length > 400 ? '\n…' : ''}`);
    console.log('\n──────────────────────────────────────────────────────────────\n');

    // ── 2. Apply the preset to the target slot. ──
    console.log(`Calling axefx2_apply_preset_at(slot=${opts.slot}, name="${preset.name}", ${preset.blocks.length} blocks)…`);
    const applyArgs: Record<string, unknown> = {
      slot: opts.slot,
      name: preset.name,
      blocks: preset.blocks,
      save_authorized: true,
      on_active_preset_edited: 'discard',
    };
    const applyResp = await client.callTool({
      name: 'axefx2_apply_preset_at',
      arguments: applyArgs,
    });
    const applyText = extractText(applyResp);
    if (isError(applyResp)) {
      console.error('❌ apply_preset_at returned isError:');
      console.error(applyText);
      process.exit(2);
    }
    // Print a digest — the tool's response is usually a multi-line summary.
    const applyLines = applyText.split('\n');
    console.log(`✓ apply_preset_at ok. Response digest:`);
    for (const l of applyLines.slice(0, 3)) console.log(`    ${l}`);
    if (applyLines.length > 3) console.log(`    … (${applyLines.length - 3} more lines)`);
    console.log('');

    // ── 3. Read grid layout, check for chain break. ──
    console.log(`Calling axefx2_get_grid_layout…`);
    const gridResp = await client.callTool({
      name: 'axefx2_get_grid_layout',
      arguments: {},
    });
    const gridText = extractText(gridResp);
    if (isError(gridResp)) {
      console.error('❌ get_grid_layout returned isError:');
      console.error(gridText);
      process.exit(3);
    }
    console.log(gridText);
    console.log('');

    // ── 4. Verdict. ──
    const hasBreak = /CHAIN BREAK/i.test(gridText);
    if (hasBreak) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('❌ FAIL — get_grid_layout reports a chain break.');
      console.log('   Signal will not flow end-to-end. Inspect cell masks above.');
      process.exit(4);
    } else {
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`🎯 PASS — slot ${opts.slot} ("${preset.name}") chain reads clean.`);
      console.log(`   Founder can audition slot ${opts.slot} for audio confirmation.`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(99);
});
