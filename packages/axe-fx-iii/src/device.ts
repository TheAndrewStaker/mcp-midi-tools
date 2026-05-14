/**
 * Axe-Fx III device registry entry point. Importing this file
 * registers the III with the BK-051 unified `DeviceDescriptor`
 * registry — and, as a transitive side effect of importing
 * `./midi.js`, also registers the III's connector factory with
 * `connections.ts` so `ensureConnection('axe-fx-iii')` routes
 * through `connectAxeFxIII()`.
 *
 * Importing this module (or anything that transitively imports it,
 * e.g. server-all's index.ts) is the sole registration entrypoint.
 */
import './midi.js';
import { registerDevice } from '@mcp-midi-control/core/protocol-generic/registry.js';
import { AXEFX3_DESCRIPTOR } from './descriptor.js';

registerDevice(AXEFX3_DESCRIPTOR);
export { AXEFX3_DESCRIPTOR };
