/**
 * MCP regression suite: runs every preset shape through `axefx2_test_apply`
 * (non-destructive, working-buffer-only) and reports pass/fail for each.
 *
 * Use this as a pre-commit / pre-release regression check for changes
 * affecting `applyExecutor`, `setParam.ts`, or the descriptor's apply
 * path. Doesn't overwrite any saved slot — each shape lands in the
 * working buffer, gets verified, then the next shape overwrites it.
 *
 * Run: npm run build && npx tsx scripts/mcp-test-preset-suite.ts
 *
 * Exit code: 0 if all shapes pass, non-zero if any fail.
 */

import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = path.resolve(process.cwd(), 'packages', 'server-all', 'dist', 'server', 'index.js');

interface BlockSpec {
  block: string | number;
  bypass?: boolean;
  channel?: 'X' | 'Y';
  params?: Record<string, number>;
}

interface PresetSpec {
  name: string;
  blocks: BlockSpec[];
}

const SUITE: Record<string, PresetSpec> = {
  'amp-only': {
    name: 'Amp Only',
    blocks: [
      { block: 'Amp 1', params: { input_drive: 5, master_volume: 5 } },
    ],
  },
  'amp-cab': {
    name: 'Amp Cab',
    blocks: [
      { block: 'Amp 1', params: { input_drive: 5, master_volume: 5 } },
      { block: 'Cab 1' },
    ],
  },
  'glassy-clean': {
    name: 'Glassy Clean',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Amp 1', params: { input_drive: 3.5, bass: 4.5, treble: 6.5, master_volume: 5 } },
      { block: 'Cab 1' },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  },
  'high-gain': {
    name: 'High Gain',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      { block: 'Amp 1', params: { input_drive: 7.5, master_volume: 5 } },
      { block: 'Cab 1' },
      { block: 'Delay 1', params: { mix: 15 } },
      { block: 'Reverb 1', params: { mix: 20 } },
    ],
  },
  'ambient-lead': {
    name: 'Ambient Lead',
    blocks: [
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      { block: 'Amp 1', params: { input_drive: 5.5, master_volume: 5 } },
      { block: 'Cab 1' },
      { block: 'Delay 1', params: { mix: 35 } },
      { block: 'Reverb 1', params: { mix: 40 } },
    ],
  },
  'saturated-stack': {
    name: 'Saturated Stack',
    blocks: [
      { block: 'Wah 1' },
      { block: 'Compressor 1' },
      { block: 'Drive 1' },
      { block: 'Drive 2' },
      { block: 'Amp 1', params: { input_drive: 6.5, master_volume: 5 } },
      { block: 'Cab 1' },
      { block: 'Chorus 1' },
      { block: 'Delay 1', params: { mix: 20 } },
      { block: 'Reverb 1', params: { mix: 25 } },
    ],
  },
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
};

function extractText(callResult: unknown): string {
  if (!callResult || typeof callResult !== 'object') return '<no response>';
  const r = callResult as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const parts = (r.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text!);
  return parts.join('\n') + (r.isError ? '\n  [tool returned isError=true]' : '');
}

interface ShapeResult {
  shape: string;
  ok: boolean;
  blockCount: number;
  verdict: string;
  chainBreaks: number;
  elapsedMs: number;
  opsTotal: number;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: 'pipe',
  });
  if (transport.stderr) {
    transport.stderr.on('data', (buf: Buffer) => process.stderr.write(`[server] ${buf.toString()}`));
  }
  const client = new Client(
    { name: 'mcp-test-preset-suite', version: '1.0.0' },
    { capabilities: {} },
  );

  const results: ShapeResult[] = [];
  try {
    await client.connect(transport);
    console.log(`MCP preset suite — ${Object.keys(SUITE).length} shapes via axefx2_test_apply (non-destructive)\n`);

    for (const [key, preset] of Object.entries(SUITE)) {
      process.stdout.write(`${key.padEnd(20)} (${preset.blocks.length.toString().padStart(2)} blocks) …`);
      const t0 = Date.now();
      const resp = await client.callTool({
        name: 'axefx2_test_apply',
        arguments: {
          name: preset.name,
          blocks: preset.blocks,
          on_active_preset_edited: 'discard',
        },
      });
      const text = extractText(resp);
      let parsed: { ok?: boolean; verdict?: string; chainBreaks?: unknown[]; elapsedMs?: number; opsTotal?: number };
      try {
        parsed = JSON.parse(text);
      } catch {
        results.push({ shape: key, ok: false, blockCount: preset.blocks.length, verdict: 'unparseable response', chainBreaks: -1, elapsedMs: Date.now() - t0, opsTotal: 0 });
        console.log(' ❌ unparseable');
        continue;
      }
      const r: ShapeResult = {
        shape: key,
        ok: !!parsed.ok,
        blockCount: preset.blocks.length,
        verdict: parsed.verdict ?? '(no verdict)',
        chainBreaks: Array.isArray(parsed.chainBreaks) ? parsed.chainBreaks.length : -1,
        elapsedMs: parsed.elapsedMs ?? Date.now() - t0,
        opsTotal: parsed.opsTotal ?? 0,
      };
      results.push(r);
      console.log(` ${r.ok ? '✓' : '✗'}  ${r.elapsedMs}ms  ${r.opsTotal} ops  ${r.chainBreaks > 0 ? `${r.chainBreaks} breaks` : 'clean'}`);
    }
  } finally {
    await client.close();
  }

  console.log('\n══════════════════════════════════════════════════════════');
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`Summary: ${passed.length}/${results.length} shapes passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`  ✗ ${f.shape} (${f.blockCount} blocks): ${f.verdict}`);
    }
    process.exit(1);
  } else {
    console.log('All shapes passed — applyExecutor wire-level chain integrity verified.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(99);
});
