/**
 * Hardware smoke test for the new `axefx2_test_apply` MCP tool — one-
 * call build-and-verify. Spawns the MCP server via StdioClientTransport
 * just like Claude Desktop would, calls the tool, parses the JSON
 * verdict, prints it.
 *
 * Run: npm run build && npx tsx scripts/mcp-test-test-apply.ts
 */

import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = path.resolve(process.cwd(), 'dist', 'server', 'index.js');

function extractText(callResult: unknown): string {
  if (!callResult || typeof callResult !== 'object') return '<no response>';
  const r = callResult as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const parts = (r.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!);
  return parts.join('\n') + (r.isError ? '\n  [tool returned isError=true]' : '');
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
    { name: 'mcp-test-test-apply', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // Sanity check that the new tool is registered.
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'axefx2_test_apply');
    if (!tool) {
      console.error('❌ axefx2_test_apply not registered. Rebuild dist?');
      process.exit(1);
    }
    console.log(`✓ axefx2_test_apply registered. Description length: ${(tool.description ?? '').length} chars.\n`);

    // Call it with a 4-block chain. Working-buffer only — no slot, no save.
    console.log('Calling axefx2_test_apply with Comp + Amp + Cab + Reverb (working buffer)…\n');
    const resp = await client.callTool({
      name: 'axefx2_test_apply',
      arguments: {
        name: 'Verify Build',
        on_active_preset_edited: 'discard',
        blocks: [
          { block: 'Compressor 1' },
          { block: 'Amp 1', params: { input_drive: 4, master_volume: 5 } },
          { block: 'Cab 1' },
          { block: 'Reverb 1', params: { mix: 25 } },
        ],
      },
    });

    const text = extractText(resp);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('❌ Tool returned non-JSON text:');
      console.error(text);
      process.exit(2);
    }

    console.log('Tool response (parsed):');
    console.log(JSON.stringify(parsed, null, 2));
    console.log('');

    const r = parsed as { ok?: boolean; verdict?: string; chainBreaks?: unknown[] };
    if (r.ok === true) {
      console.log('🎯 PASS — test_apply returned ok=true.');
      console.log(`   Verdict: ${r.verdict}`);
    } else {
      console.log('❌ FAIL — test_apply returned ok=false.');
      console.log(`   Verdict: ${r.verdict}`);
      console.log(`   chainBreaks: ${JSON.stringify(r.chainBreaks)}`);
      process.exit(3);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(99);
});
