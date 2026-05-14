/**
 * Active device selection. v0.1.0 single-device path: defaults to AM4.
 * v0.1.1 onwards: device identified via SysEx at startup, then this
 * accessor returns whichever device matched.
 *
 * The MCP server imports `activeDevice` and dispatches every protocol
 * call through it. Tool implementations stay device-agnostic at the
 * call site; per-device differences are encapsulated in each device's
 * `FractalDevice` implementation.
 */
import {
  FRACTAL_DEVICE_REGISTRY,
  type FractalDevice,
} from '@mcp-midi-control/core/fractal-shared/device.js';

// Side-effect import: registers all built-in devices with the registry.
import './index.js';

/**
 * Currently-active device. v0.1.0: always the first registered device
 * (AM4). When v0.1.1's runtime device-identification lands, this becomes
 * a mutable reference set by the identify-at-startup logic.
 */
let _activeDevice: FractalDevice = FRACTAL_DEVICE_REGISTRY[0];
if (!_activeDevice) {
  throw new Error(
    'No FractalDevice registered. Did src/fractal/index.ts forget to import a device file?',
  );
}

export function getActiveDevice(): FractalDevice {
  return _activeDevice;
}

/**
 * Set the active device. Used by the server's startup-identify logic
 * (v0.1.1+) and by tests. Idempotent — passing the current device is
 * a no-op.
 */
export function setActiveDevice(device: FractalDevice): void {
  _activeDevice = device;
}

/**
 * Convenient export that re-evaluates `getActiveDevice()` on each
 * access via a Proxy. Lets tools write `activeDevice.buildSetParam(...)`
 * naturally without remembering to call a getter — and any future
 * `setActiveDevice()` call becomes visible immediately.
 */
export const activeDevice: FractalDevice = new Proxy({} as FractalDevice, {
  get(_, prop) {
    return (getActiveDevice() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
