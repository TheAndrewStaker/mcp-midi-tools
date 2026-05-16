/**
 * Verify the baseline-warmup closes the "first navigation after server
 * restart silently proceeds" gap.
 *
 * Without warm-up (pre-fix): first AM4 call is set_param → dirties the
 * buffer → first switch_preset without on_active_preset_edited sees no
 * cached baseline → falls through to proceed → edit lost silently.
 *
 * With warm-up: set_param's writer entry calls warmupAM4BaselineIfNeeded
 * BEFORE the wire write. The warm-up captures the pre-edit clean state
 * as the baseline. The subsequent switch_preset's gate compares current
 * (dirty) to baseline (clean) → mismatch → REFUSE.
 *
 * This script exercises that exact sequence as the FIRST AM4 traffic
 * the server sees after spawn. A pass = "REFUSING TO NAVIGATE..." in
 * step 3. A fail = silent proceed (dirty edits lost).
 *
 * Run: npm run build && npx tsx scripts/_research/probe-warmup-baseline.ts
 */
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER_ENTRY = path.resolve(process.cwd(), 'packages', 'server-all', 'dist', 'server', 'index.js');

function extractText(r: unknown): string {
  if (!r || typeof r !== 'object') return '<no response>';
  const c = r as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  return (c.content ?? [])
    .filter((x) => x.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text!)
    .join('\n') + (c.isError ? '\n[isError=true]' : '');
}

function isError(r: unknown): boolean {
  return Boolean((r as { isError?: boolean })?.isError);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: 'pipe',
  });
  if (transport.stderr) transport.stderr.on('data', (b: Buffer) => process.stderr.write(`[server] ${b.toString()}`));
  const client = new Client({ name: 'probe-warmup-baseline', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);

  console.log('Step 1: set_param amp.gain 6 — FIRST AM4 traffic after server spawn.');
  console.log('         The writer will warm-up baseline transparently before sending the wire write.');
  const t0 = Date.now();
  const setR = await client.callTool({
    name: 'set_param',
    arguments: { port: 'am4', block: 'amp', name: 'gain', value: 6 },
  });
  const setMs = Date.now() - t0;
  console.log(`  → (${setMs} ms) set_param ok=${!isError(setR)}: ${extractText(setR).slice(0, 120)}`);

  console.log('\nStep 2: switch_preset A1 — NO on_active_preset_edited flag.');
  console.log('         Expected: REFUSING TO NAVIGATE (baseline was warmed pre-set_param).');
  const switchR = await client.callTool({
    name: 'switch_preset',
    arguments: { port: 'am4', location: 'A1' },
  });
  const switchText = extractText(switchR);
  const refused = isError(switchR) && /unsaved|dirty|edited|discard|save_active_first|REFUSING/i.test(switchText);
  console.log(`  → refused=${refused}: ${switchText.slice(0, 300)}`);

  console.log('\nStep 3: cleanup — discard-switch back to Z3 to leave a clean state.');
  await client.callTool({
    name: 'switch_preset',
    arguments: { port: 'am4', location: 'Z3', on_active_preset_edited: 'discard' },
  });

  await client.close();

  console.log('');
  if (refused) {
    console.log('✓ PASS — warm-up closed the first-navigation-after-restart gap.');
    process.exit(0);
  } else {
    console.log('✗ FAIL — gate proceeded silently. Warm-up did not seed the baseline before set_param.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
