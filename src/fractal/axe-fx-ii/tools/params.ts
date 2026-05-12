/**
 * Axe-Fx II param tools — single get / set. Resolves (block, name) to
 * the wire encoder, sends via the cached connection, awaits a response
 * for reads, and surfaces NO_ACK_NOTE on writes.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { KNOWN_PARAMS, type AxeFxIIParam } from '@/fractal/axe-fx-ii/params.js';
import {
  buildGetBlockParameterValue,
  buildSetBlockParameterValue,
  displayToWire,
  isGetBlockParameterResponse,
  parseGetBlockParameterResponse,
} from '@/fractal/axe-fx-ii/setParam.js';

import {
  GET_RESPONSE_TIMEOUT_MS,
  NO_ACK_NOTE,
  ensureConn,
  findBlock,
  findParam,
  toHex,
} from './shared.js';

export function registerAxeFxIIParamTools(server: McpServer): void {


  server.registerTool('axefx2_set_param', {
    description: [
      'Use this tool to write a single parameter on the user\'s Axe-Fx II',
      'family device. The parameter is addressed by `block` (block instance,',
      'e.g. "Amp 1" or effectId 106) and `name` (snake-case parameter name,',
      'e.g. "input_drive"). Use axefx2_list_block_types to discover instances',
      'and axefx2_list_params to discover param names per block group.',
      '',
      'DISPLAY-FIRST CONTRACT — `value` is a display-unit number for params',
      'with hardware-calibrated displayMin/displayMax (HW-079, 2026-05-11),',
      'and a raw 0..65534 wire integer for everything else. The tool resolves',
      'which mode to use from the param\'s registry entry:',
      '',
      '  - amp.bass / amp.middle / amp.treble / amp.master_volume /',
      '    amp.input_drive — accept 0..10 (knob display, e.g. bass: 6.0).',
      '  - All other params — accept raw wire 0..65534 (e.g. bass: 39321).',
      '',
      'When the param has populated `displayMin`/`displayMax`, pass display',
      'values like `4.5` (gain at 4.5/10) or `6.0` (bass at 6.0/10). The',
      'tool converts to wire internally using a linear mapping and surfaces',
      'the converted wire value in the response. If you pass a value that\'s',
      'numerically inside the display range (0..10 for calibrated knobs), the',
      'tool treats it as a display value; if it\'s above displayMax, the tool',
      'treats it as a wire integer for backwards-compat. To bypass auto-',
      'detection entirely, set `interpret: "wire"` to force wire-integer mode',
      'or `interpret: "display"` to force display mode (errors if param has',
      'no calibration).',
      '',
      'For ENUM/SELECT params (e.g. amp.tone_stack), pass the integer enum',
      'index — call axefx2_list_params or axefx2_list_enum_values for the',
      'set. Display-first conversion does NOT apply to selects.',
      '',
      'NO-ACK PROTOCOL — the Axe-Fx II SET function does not produce a wire',
      'ack. The signal that the change took is audible (the user hears the',
      'change) and the device\'s display reflects the new value. If the user',
      'expected an audible change and reports none, likely causes: (a) the',
      'addressed block isn\'t on the active preset\'s signal chain, (b) the',
      'wire value falls outside the param\'s display range and the device',
      'clamped silently, or (c) MIDI port routing — confirm with',
      'list_midi_ports that an Axe-Fx port is visible.',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId (106 / 110). Call axefx2_list_block_types for the full set.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. e.g. "input_drive", "bass", "master_volume". Call axefx2_list_params for the full set.',
      ),
      value: z.number().min(0).max(65534).describe(
        'Display value (for calibrated knobs like amp.bass=6.0) or raw wire 0..65534 for uncalibrated params. Tool auto-detects mode from param calibration.',
      ),
      interpret: z.enum(['auto', 'wire', 'display']).optional().describe(
        'Force value interpretation. "auto" (default) infers from param calibration. "wire" treats value as raw 0..65534. "display" treats value as display unit (errors if param uncalibrated).',
      ),
    },
  }, async ({ block, name, value, interpret }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      const groupParams = Object.values(KNOWN_PARAMS as Readonly<Record<string, AxeFxIIParam>>)
        .filter((p) => p.groupCode === target.groupCode);
      const sample = groupParams.slice(0, 8).map((p) => p.name).join(', ');
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Sample valid names: ${sample}, ... — call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }

    const hasCalibration = param.displayMin !== undefined && param.displayMax !== undefined;
    const mode = interpret ?? 'auto';
    // Force display when explicitly requested; force wire when explicitly
    // requested; auto-detect: if calibrated AND value fits inside the
    // display range, treat as display; otherwise treat as wire.
    let useDisplay: boolean;
    if (mode === 'display') {
      if (!hasCalibration) {
        throw new Error(
          `Param "${name}" on ${target.name} has no calibrated display range — ` +
          `pass a wire value (0..65534) or omit \`interpret: "display"\`.`,
        );
      }
      useDisplay = true;
    } else if (mode === 'wire') {
      useDisplay = false;
    } else {
      useDisplay = hasCalibration && value <= (param.displayMax ?? 0);
    }

    let wireValue: number;
    let displayValueUsed: number | undefined;
    if (useDisplay) {
      displayValueUsed = value;
      wireValue = displayToWire(value, {
        displayMin: param.displayMin as number,
        displayMax: param.displayMax as number,
        displayScale: param.displayScale,
      });
    } else {
      if (!Number.isInteger(value) || value < 0 || value > 65534) {
        throw new Error(
          `Wire value out of range: ${value} (valid 0..65534). ` +
          `If you meant a display value, pass \`interpret: "display"\` (requires the param to have calibrated displayMin/displayMax).`,
        );
      }
      wireValue = value;
    }

    const bytes = buildSetBlockParameterValue(
      { effectId: target.id, paramId: param.paramId },
      wireValue,
    );
    const c = ensureConn();
    c.send(bytes);
    const enumLabel = param.enumValues?.[wireValue];
    const enumLine = enumLabel ? `\nValue ${wireValue} matches enum: "${enumLabel}".` : '';
    const scaleLabel = param.displayScale ?? 'linear';
    const modeLine = useDisplay
      ? `Display ${displayValueUsed} → wire ${wireValue} via [${param.displayMin}..${param.displayMax}] ${scaleLabel}.`
      : hasCalibration
        ? `Wire ${wireValue} (raw — not a display value; calibrated range is [${param.displayMin}..${param.displayMax}] ${scaleLabel}).`
        : `Wire ${wireValue} (uncalibrated param; pass wire 0..65534).`;
    return {
      content: [{
        type: 'text',
        text:
          `Sent ${target.name} (${target.groupCode}, effectId ${target.id}) → ${param.name} ` +
          `(paramId ${param.paramId}).\n` +
          `${modeLine}${enumLine}\n` +
          `Wrote ${bytes.length} bytes: ${toHex(bytes)}\n` +
          `\n${NO_ACK_NOTE}`,
      }],
    };
  });


  server.registerTool('axefx2_get_param', {
    description: [
      'Use this tool to read the current value of a single parameter on the',
      'user\'s Axe-Fx II. Sends GET_BLOCK_PARAMETER_VALUE (function 0x02,',
      'action 0x00) and waits for the device\'s response, which returns BOTH',
      'the wire value (0..65534) and the display label string the device',
      'shows on its UI ("5.00", "Plexi 50W Hi", "12.0 dB", etc.). The label',
      'is firmware-truth — use it verbatim when summarizing to the user.',
      '',
      'RELATIVE-CHANGE DISCIPLINE — call this BEFORE axefx2_set_param when',
      'the user says "more / less / a bit / increase / decrease" or any',
      'other relative phrasing. Without the read, the agent is guessing the',
      'starting point.',
      '',
      'Failure modes:',
      '- "No Axe-Fx II input port available" — the OS exposes only an',
      '  output port, no input. Check list_midi_ports.',
      '- "Timeout waiting for matching SysEx" — request sent but no',
      '  response in 800ms. Likely causes: addressed block not placed in',
      '  the active preset (Axe-Fx II silently absorbs reads on absent',
      '  blocks), Q8.02 firmware uses a different function-byte for GET',
      '  on this paramId (capture HW-074 to verify), or USB handle stale',
      '  (try axefx2_reconnect_midi).',
    ].join('\n'),
    inputSchema: {
      block: z.union([z.string(), z.number()]).describe(
        'Block instance — display name like "Amp 1" / "Reverb 1" or numeric effectId.',
      ),
      name: z.string().describe(
        'Parameter name within the block, snake-case. Call axefx2_list_params for the full set.',
      ),
    },
  }, async ({ block, name }) => {
    const target = findBlock(block);
    const param = findParam(target, name);
    if (!param) {
      throw new Error(
        `Unknown param "${name}" for ${target.name} (group ${target.groupCode}). ` +
        `Call axefx2_list_params({ block: "${target.groupCode}" }) for the full list.`,
      );
    }
    const targetId = { effectId: target.id, paramId: param.paramId };
    const reqBytes = buildGetBlockParameterValue(targetId);
    const c = ensureConn();
    // Register the listener BEFORE sending so the response can't race
    // ahead of the predicate registration.
    const responsePromise = c.receiveSysExMatching(
      (bytes) => isGetBlockParameterResponse(bytes, targetId),
      GET_RESPONSE_TIMEOUT_MS,
    );
    c.send(reqBytes);
    let response: number[];
    try {
      response = await responsePromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `axefx2_get_param failed: ${msg}\n` +
        `Sent ${reqBytes.length} bytes: ${toHex(reqBytes)}`,
      );
    }
    const parsed = parseGetBlockParameterResponse(response);
    const enumLabel = param.enumValues?.[parsed.value];
    const enumNote = enumLabel ? ` (enum: "${enumLabel}")` : '';
    return {
      content: [{
        type: 'text',
        text:
          `${target.name} → ${param.name} = ${parsed.value} (wire 0..65534).\n` +
          `Device label: "${parsed.label}"${enumNote}.\n` +
          `Sent (${reqBytes.length}B): ${toHex(reqBytes)}\n` +
          `Recv (${response.length}B): ${toHex(response)}\n`,
      }],
    };
  });

}
