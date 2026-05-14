/**
 * Fractal device registry entry point. Importing this file registers
 * every Fractal device the build supports with `FRACTAL_DEVICE_REGISTRY`.
 *
 * v0.1.0: AM4 only.
 * v0.1.1 onwards: Axe-Fx II XL+ joins; uncomment the import below
 *   when the AXE_FX_II_DEVICE stub gets filled in.
 *
 * Adding a new Fractal device:
 *   1. Implement FractalDevice in src/fractal/<slug>/device.ts.
 *   2. Add the import below so the import-side-effect calls
 *      registerDevice().
 *   3. Server picks it up at startup with no other code changes.
 */
import '@mcp-midi-control/am4/device.js';
// import '@mcp-midi-control/axe-fx-ii/device.js';   // uncomment for v0.1.1
