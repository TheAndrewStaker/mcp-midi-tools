/**
 * Axe-Fx III SET / GET PARAMETER tools (function 0x02).
 *
 * 🟡 III hardware-untested as of Session 84. Wire shape ported from
 * the Axe-Fx II's hardware-verified encoder (II uses model byte 0x03;
 * III uses 0x10). Community evidence chain documented in
 * `../setParam.ts` on `FN_SET_PARAMETER`. The III may reject these
 * writes — when it does, the device emits a
 * `0x64 MULTIPURPOSE_RESPONSE` which we catch via `sendAndWatchForError`
 * and surface inline in the tool reply.
 *
 * Tools registered:
 *   - axefx3_set_parameter(block, param_id, value) — write a raw 16-bit
 *     wire value into one paramId on one block instance.
 *   - axefx3_get_parameter(block, param_id) — query the same.
 *
 * Why "raw wire value" not "display value": the III has no public
 * per-param display calibration (the v1.4 PDF documents zero
 * parameter-level metadata). Until per-paramId display ranges land,
 * callers compute display↔wire themselves. The Ghidra catalog at
 * `samples/captured/decoded/ghidra-axeedit3-paramnames.json` lists
 * every paramId by symbolic name (e.g. paramId 0 of REVERB =
 * `REVERB_TYPE`); use that to figure out which paramId to target.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { resolveEffectId } from '../blockTypes.js';
import {
  buildSetParameter,
  buildGetParameter,
  isSetGetParameterResponse,
  parseSetGetParameterResponse,
} from '../setParam.js';

import {
  BETA_NOTE,
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  formatMultipurposeError,
  sendAndWatchForError,
  toHex,
} from './shared.js';

const BLOCK_INPUT_DESCRIPTION = [
  'Block reference. Accepts:',
  '  - "Reverb 1", "Drive 2", "Compressor 4" — name + instance number',
  '  - "Reverb" (no instance defaults to instance 1)',
  '  - "REV", "DRV", "CMP" — 3-letter group code',
  '',
  "AMP / Dynamic Distortion / NAM / Global Block / Shunt aren't",
  "addressable from the v1.4 spec (no effect ID) — these will refuse.",
  'Call axefx3_list_blocks for the full catalog.',
].join('\n');

const UNTESTED_BANNER = [
  '⚠ 0x02 SET_PARAMETER is NOT in the v1.4 spec — it is Fractal\'s',
  'historical (Axe-Fx II era) opcode that community evidence shows',
  'still exists in the Axe-Fx III firmware code path. This tool builds',
  'the II wire shape with the III\'s model byte. Untested on real III',
  'hardware as of Session 84 (founder owns II XL+, not III). If the',
  'device rejects the write, you\'ll see a 0x64 MULTIPURPOSE_RESPONSE',
  'in the reply — that\'s diagnostic, not silent failure.',
].join('\n');

export function registerAxeFxIIIParamTools(server: McpServer): void {

  server.registerTool('axefx3_set_parameter', {
    description: [
      'Set the wire-level value of one parameter on one block on the',
      'Axe-Fx III. Targets the ACTIVE scene only.',
      '',
      UNTESTED_BANNER,
      '',
      'Wire: SET_PARAMETER (function 0x02, action 0x01). Payload:',
      '  id id     = 14-bit effect ID per v1.4 Appendix 1 (LS-first)',
      '  pid pid   = 14-bit paramId (LS-first) — see Ghidra catalog at',
      '              samples/captured/decoded/ghidra-axeedit3-paramnames.json',
      '              for the paramId→symbolic-name table per effect family.',
      '  v0 v1 v2  = 16-bit value (0..65534) packed into 3 septets:',
      '              v0 = bits 6..0, v1 = bits 13..7, v2 = bits 15..14',
      '  action    = 0x01 (SET commit)',
      '',
      'Value range: raw wire 0..65534 (16-bit). Caller computes',
      'display↔wire — the III publishes no per-param display calibration.',
      '',
      NO_ACK_NOTE,
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
      param_id: z.number().int().min(0).max(0x3fff).describe(
        'Parameter ID within the block (0..16383). See the Ghidra catalog ' +
        'for the paramId→symbolic-name table.',
      ),
      value: z.number().int().min(0).max(65534).describe(
        'Raw 16-bit wire value (0..65534). Display→wire conversion is the ' +
        "caller's responsibility — III has no published display calibration.",
      ),
    },
  }, async ({ block, param_id, value }) => {
    const effectId = resolveEffectId(block);
    const bytes = buildSetParameter(effectId, param_id, value);
    const c = ensureConn();
    const errorReport = await sendAndWatchForError(c, bytes);
    const errorBlock = errorReport
      ? `\n${formatMultipurposeError(errorReport)}\n`
      : '';
    return {
      content: [{
        type: 'text',
        text:
          `Sent SET_PARAMETER → ${block} (effect ID ${effectId}), ` +
          `paramId ${param_id}, value ${value} (raw wire 0..65534).\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          errorBlock +
          `\n${NO_ACK_NOTE}\n\n${BETA_NOTE}`,
      }],
    };
  });

  server.registerTool('axefx3_get_parameter', {
    description: [
      'Query the wire-level value of one parameter on one block on the',
      'Axe-Fx III. Targets the ACTIVE scene only.',
      '',
      UNTESTED_BANNER,
      '',
      'Wire: GET_PARAMETER (function 0x02, action 0x00). Payload:',
      '  id id     = 14-bit effect ID (LS-first)',
      '  pid pid   = 14-bit paramId (LS-first)',
      '  00 00 00  = value-field placeholder (must be present, zero on query)',
      '  action    = 0x00 (QUERY)',
      '',
      'Response (II wiki shape; III response shape unverified): same',
      'envelope echoing effectId + paramId + the actual 16-bit wire value',
      'in the value field, plus possibly a trailing label string. We read',
      'the deterministic 7-byte payload and ignore trailing bytes.',
      '',
      BETA_NOTE,
    ].join('\n'),
    inputSchema: {
      block: z.string().describe(BLOCK_INPUT_DESCRIPTION),
      param_id: z.number().int().min(0).max(0x3fff).describe(
        'Parameter ID within the block (0..16383).',
      ),
    },
  }, async ({ block, param_id }) => {
    const effectId = resolveEffectId(block);
    const reqBytes = buildGetParameter(effectId, param_id);
    const c = ensureConn();
    const responsePromise = c.receiveSysExMatching(
      isSetGetParameterResponse,
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx3_get_parameter(${block}, paramId=${param_id}) failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}\n` +
        `\nLikely cause: device doesn't honor 0x02 SET_PARAMETER on this firmware. ` +
        `If a 0x64 frame arrived but didn't match the predicate, run axefx3_probe_sysex with the same payload to see the raw bytes.`,
      );
    }
    const parsed = parseSetGetParameterResponse(response);
    return {
      content: [{
        type: 'text',
        text:
          `${block} (effect ID ${parsed.effectId}) paramId ${parsed.paramId} ` +
          `= ${parsed.value} (raw wire 0..65534).\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n` +
          `\n${BETA_NOTE}`,
      }],
    };
  });
}
