/**
 * Fractal AM4 device implementation. Wraps the existing AM4 protocol
 * code (params, blockTypes, locations, setParam) behind the
 * `FractalDevice` interface so the MCP server can dispatch through
 * `activeDevice` without knowing it's an AM4 specifically.
 *
 * v0.1.0: this is the only fully-implemented device. Adding Axe-Fx II
 * (queued as v0.1.1 per docs/MULTI-DEVICE-ROADMAP.md) means writing a
 * sibling `axe-fx-ii/device.ts` and registering it. No server tool
 * changes required.
 */
import {
  FractalDevice,
  DeviceCapabilities,
  DeviceIdentity,
  ReadResponse,
  registerDevice,
} from 'fractal-midi/shared';
import {
  KNOWN_PARAMS,
  PARAM_ALIASES,
  type ParamKey,
} from 'fractal-midi/am4';
import {
  AM4_MODEL_ID,
  type ParamId,
  buildSetParam,
  buildReadParam,
  buildSetBlockType,
  buildSetBlockBypass,
  buildSwitchScene,
  buildSwitchPreset,
  buildSetPresetName,
  buildSetSceneName,
  buildSaveToLocation,
  isWriteEcho,
  isCommandAck,
  isReadResponse,
  parseReadResponse,
} from 'fractal-midi/am4';
import {
  BLOCK_TYPE_VALUES,
  BLOCK_NAMES_BY_VALUE,
  resolveBlockType,
} from 'fractal-midi/am4';
import {
  TOTAL_LOCATIONS,
  parseLocationCode,
  formatLocationCode,
  formatLocationDisplay,
} from 'fractal-midi/am4';

const CAPABILITIES: DeviceCapabilities = {
  sceneCount: 4,
  slotCount: 4,
  channelsPerBlock: 'A-D',
  routing: 'linear',
  presetLocationCount: TOTAL_LOCATIONS, // 104
};

export const AM4_DEVICE: FractalDevice = {
  modelByte: AM4_MODEL_ID,
  displayName: 'Fractal AM4',
  slug: 'am4',
  capabilities: CAPABILITIES,
  // AM4-Edit's port name on Windows winmm contains "AM4"; on Linux/Mac
  // the ALSA/CoreMIDI name pattern is the same in practice.
  midiPortPattern: /AM4/i,

  knownParams: KNOWN_PARAMS,
  blockTypes: BLOCK_TYPE_VALUES,
  paramAliases: PARAM_ALIASES,

  formatLocationCode,
  formatLocationDisplay,
  parseLocationCode,
  resolveBlockType,
  blockNameForValue: (value: number) => BLOCK_NAMES_BY_VALUE[value],

  buildSetParam: (key: string, displayValue: number) =>
    buildSetParam(key as ParamKey, displayValue),
  buildReadParam: (param: ParamId, readType?: number) =>
    buildReadParam(param, readType),
  buildSetBlockType,
  buildSetBlockBypass,
  buildSwitchScene,
  buildSwitchPreset,
  buildSetPresetName,
  buildSetSceneName,
  buildSaveToLocation,

  isWriteEcho,
  isCommandAck,
  isReadResponse,
  parseReadResponse: (bytes: number[]): ReadResponse => parseReadResponse(bytes),

  // identify() not yet implemented for AM4. Server falls back to the
  // default device (AM4) when no identify() succeeds — same behavior
  // as v0.1.0 single-device path. Wiring this up is part of v0.1.1
  // when Axe-Fx II lands and runtime device selection becomes meaningful.
};

registerDevice(AM4_DEVICE);
