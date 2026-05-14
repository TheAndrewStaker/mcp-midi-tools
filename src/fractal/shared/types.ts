/**
 * Shared Fractal-protocol types used by multiple device packages.
 *
 * Lifted out of per-device files so device modules don't have to
 * cross-import each other for fundamental protocol shapes (every
 * Fractal device since the AM4 has used the same 14-bit pidLow/pidHigh
 * addressing for parameters).
 */

/**
 * Two-coordinate address of a parameter in a Fractal device's wire
 * protocol. Both fields are 14-bit unsigned ints, transmitted as
 * septet pairs in the SysEx payload.
 *
 * AM4: `pidLow` selects the block/slot, `pidHigh` is the parameter
 * register within that block.
 * Axe-Fx II / III / FM3 / FM9 use the same shape with device-specific
 * encoding details documented per device.
 */
export interface ParamId {
  pidLow: number;
  pidHigh: number;
}
