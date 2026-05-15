/**
 * Axe-Fx III descriptor export. Importing this file brings in the
 * MIDI connector side-effect (via `./midi.js`) so that
 * `ensureConnection('axe-fx-iii')` routes through `connectAxeFxIII()`.
 *
 * Device registration (registerDevice) is intentionally NOT done here
 * as a side effect — the caller (server-all/src/server/index.ts) calls
 * `registerMcpDevice(AXEFX3_DESCRIPTOR)` explicitly, matching the same
 * explicit-registration pattern used by AM4, Axe-Fx II, and Hydrasynth.
 * This keeps test scripts that import the descriptor clean (no global
 * registry mutations on import).
 */
import './midi.js';
export { AXEFX3_DESCRIPTOR } from './descriptor.js';
