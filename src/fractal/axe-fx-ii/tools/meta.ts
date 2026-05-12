/**
 * Axe-Fx II meta tools — reconnect_midi + describeAxeFxIIPortStatus.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { listAxeFxIIOutputs } from '@/fractal/axe-fx-ii/midi.js';

import { resetAxeFxIIConnection } from './shared.js';

export function registerAxeFxIIMetaTools(server: McpServer): void {


  server.registerTool('axefx2_reconnect_midi', {
    description: [
      'Use this tool to drop the cached Axe-Fx II MIDI handle and force a',
      'fresh port-open on the next axefx2_* tool call. Useful when the user',
      'plugged the device in mid-session and the cached "not connected"',
      'error keeps masking the now-working port, or when an earlier tool',
      'call timed out (USB handle may have gone stale).',
      '',
      'This does NOT affect the AM4 connection (use reconnect_midi for that)',
      'or the Hydrasynth connection (hydra_reconnect_midi).',
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const result = resetAxeFxIIConnection();
    const lines = [
      `Axe-Fx II connection cache cleared.`,
      `  Was connected: ${result.wasConnected ? 'yes' : 'no'}`,
    ];
    if (result.previousError) {
      lines.push(`  Previous cached error: ${result.previousError}`);
    }
    lines.push(
      '',
      'The next axefx2_* tool call will re-attempt connectAxeFxII().',
      'Run list_midi_ports if you want to confirm the OS is currently',
      'exposing an Axe-Fx II port before retrying.',
    );
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  });

}

/**
 * Startup-banner helper — describes whether an Axe-Fx II output port is
 * visible right now, without opening it.
 */
export function describeAxeFxIIPortStatus(): string {
  try {
    const outputs = listAxeFxIIOutputs();
    const axe = outputs.find((p) => p.looksLikeAxeFxII);
    if (axe) return `Axe-Fx II detected at output [${axe.index}]: "${axe.name}"`;
    if (outputs.length === 0) return 'no MIDI outputs visible';
    return `Axe-Fx II not visible among ${outputs.length} output(s)`;
  } catch (err) {
    return `port scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
