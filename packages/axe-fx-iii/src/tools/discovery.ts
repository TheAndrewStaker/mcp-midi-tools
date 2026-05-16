/**
 * Axe-Fx III discovery tools — STATUS_DUMP + block roster.
 *
 * Tools registered:
 *   - axefx3_status_dump   (function 0x13)
 *   - axefx3_list_blocks   (pure data — block roster from blockTypes.ts)
 *
 * STATUS_DUMP returns one row per block currently placed in the
 * active preset. Per v1.4 spec, each row carries the effect ID
 * (from Appendix 1), the bypass state, the active channel, and
 * the channel count.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AXE_FX_III_BLOCKS } from '../blockTypes.js';
import {
  buildStatusDump,
  isStatusDumpResponse,
  parseStatusDumpResponse,
} from '../setParam.js';

import {
  BETA_NOTE,
  GET_RESPONSE_TIMEOUT_MS,
  ensureConn,
  toHex,
} from './shared.js';

/** Lookup: effectId → block descriptor + instance number. */
function describeEffectId(effectId: number): string {
  for (const b of AXE_FX_III_BLOCKS) {
    if (b.firstId === null) continue;
    if (effectId >= b.firstId && effectId < b.firstId + b.instances) {
      const instance = effectId - b.firstId + 1;
      return b.instances > 1 ? `${b.name} ${instance}` : b.name;
    }
  }
  return `(unknown ID; possibly AMP / Dynamic Distortion / NAM)`;
}

export function registerAxeFxIIIDiscoveryTools(server: McpServer): void {

  server.registerTool('axefx3_status_dump', {
    description: [
      'Send a STATUS_DUMP request to the Axe-Fx III. Returns one row',
      'per block in the active preset:',
      '',
      '  effect_id | block name (resolved) | bypassed | channel',
      '',
      'Per v1.4 spec, each row carries the effect ID (Appendix 1),',
      'the bypass state, the active channel (A..D), and the channel',
      'count this block supports.',
      '',
      'Use this to (a) see what blocks the active preset contains,',
      '(b) decode any unrecognized effect IDs (AMP / NAM / Dynamic',
      'Distortion all show as "unknown ID" — capture these for the',
      'community decode workflow).',
      '',
      'Wire: STATUS_DUMP (function 0x13). Response is a stream of',
      '`id_lo id_hi dd` triples, one per block. dd packs:',
      '  - bit 0    → bypass (0 = engaged, 1 = bypassed)',
      '  - bits 3:1 → current channel index (0..7; III blocks ≤ 4)',
      '  - bits 6:4 → channel count for this block (0..7)',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const reqBytes = buildStatusDump();
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isStatusDumpResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_status_dump failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}\n` +
        '\nMost likely causes: device not connected (check list_midi_ports), ' +
        'response framing differs from the v1.4 spec, or the input port ' +
        'isn\'t open. Try axefx3_reconnect_midi.',
      );
    }
    let entries;
    try {
      entries = parseStatusDumpResponse(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_status_dump: response decode failed: ${msg}\n` +
        `Raw response (${response.length}B): ${toHex(response)}\n`,
      );
    }

    const lines: string[] = [];
    lines.push(`STATUS_DUMP — ${entries.length} block${entries.length === 1 ? '' : 's'} in active preset.`);
    lines.push('');
    lines.push('  effect_id | block (resolved)              | bypassed | channel');
    lines.push('  ' + '-'.repeat(68));
    for (const e of entries) {
      const id = e.effectId.toString().padStart(5);
      const name = describeEffectId(e.effectId).padEnd(30);
      const byp = e.bypassed ? 'yes' : 'no ';
      const ch = ['A', 'B', 'C', 'D'][e.channel] ?? `?(${e.channel})`;
      lines.push(`  ${id}     | ${name} | ${byp}      | ${ch}`);
    }
    lines.push('');
    lines.push(`Sent (${reqBytes.length}B): ${toHex(reqBytes)}`);
    lines.push(`Recv (${response.length}B): ${toHex(response)}`);
    lines.push('');
    lines.push(BETA_NOTE);

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  });


  server.registerTool('axefx3_list_blocks', {
    description: [
      'Return the Axe-Fx III block roster — all block types AxeEdit',
      'III recognizes, with display names, 3-letter group codes, and',
      'v1.4 spec effect IDs where documented. Pure data, no MIDI.',
      '',
      'Spec-confirmed effect IDs are from v1.4 PDF Appendix 1.',
      'Blocks with firstId=null are either (a) absent from the v1.4',
      'enumeration (AMP — mysteriously omitted) or (b) added after',
      'firmware 1.13 when v1.4 was published (NAM, Dynamic Distortion).',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {},
  }, async () => {
    const lines: string[] = [];
    lines.push(`Axe-Fx III block roster (${AXE_FX_III_BLOCKS.length} entries):`);
    lines.push('');
    lines.push('  group | name                       | instances | effect IDs       | confidence');
    lines.push('  ' + '-'.repeat(82));
    for (const b of AXE_FX_III_BLOCKS) {
      const code = b.groupCode.padEnd(5);
      const name = b.name.padEnd(26);
      const inst = b.instances.toString().padStart(2);
      const ids =
        b.firstId === null
          ? '(not in v1.4)   '
          : b.instances === 1
            ? `${b.firstId}              `.padEnd(16)
            : `${b.firstId}..${b.firstId + b.instances - 1}         `.padEnd(16);
      const conf = b.confidence;
      lines.push(`  ${code} | ${name} |     ${inst}    | ${ids} | ${conf}`);
    }
    lines.push('');
    lines.push('To address a block via SysEx (bypass / channel writes), pass the');
    lines.push('block name + instance number to axefx3_set_bypass / axefx3_set_channel.');
    lines.push('Effect IDs are resolved internally from this table.');
    lines.push('');
    lines.push(BETA_NOTE);
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  });

}
