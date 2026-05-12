/**
 * BK-051 generic device registry.
 *
 * Each device package calls `registerDevice(descriptor)` at module load
 * (typically from `src/<vendor>/<device>/descriptor.ts`, imported by
 * `src/server/index.ts` at bootstrap). The dispatcher then resolves an
 * incoming MCP tool call's `port` argument to a registered descriptor
 * via `resolveDevice(port)`.
 *
 * Coexists with the older Fractal-only registry in
 * `src/fractal/shared/device.ts`. This one lives at the MCP-tool-
 * surface layer; that one lives at the Fractal-wire-protocol layer.
 *
 * Registration is process-global and idempotent by descriptor `id` —
 * re-registering the same `id` replaces the previous entry (useful for
 * tests; production has one registration per device per process).
 */

import type { DeviceDescriptor } from './types.js';

const REGISTRY = new Map<string, DeviceDescriptor>();

export function registerDevice(descriptor: DeviceDescriptor): void {
  REGISTRY.set(descriptor.id, descriptor);
}

export function unregisterDevice(id: string): void {
  REGISTRY.delete(id);
}

/** Used by tests to reset state between cases. */
export function clearRegistry(): void {
  REGISTRY.clear();
}

export function listRegisteredDevices(): readonly DeviceDescriptor[] {
  return [...REGISTRY.values()];
}

export function getDeviceById(id: string): DeviceDescriptor | undefined {
  return REGISTRY.get(id);
}

/**
 * Resolve a `port` argument from an MCP tool call to a registered
 * descriptor.
 *
 * Match order:
 *   1. Exact `id` match (`port: 'am4'` finds the AM4 descriptor).
 *   2. Exact `display_name` match (case-insensitive).
 *   3. Any of the descriptor's `port_match` patterns matching the
 *      caller's `port` string. RegExp patterns use `.test()`; string
 *      patterns are case-insensitive substring matches.
 *
 * Registration order acts as the tiebreaker when multiple descriptors
 * match the same port — first registered wins. AM4 / Axe-Fx II /
 * Hydrasynth have non-overlapping port names in practice; the
 * tiebreaker is a guardrail, not a routine path.
 *
 * Returns undefined when no descriptor matches — caller (dispatcher
 * step 1) throws a `port_not_found` DispatchError with the list of
 * registered devices in the error details.
 */
export function resolveDevice(port: string): DeviceDescriptor | undefined {
  if (port.length === 0) return undefined;
  const portLower = port.toLowerCase();

  // 1. Exact id match.
  const byId = REGISTRY.get(port) ?? REGISTRY.get(portLower);
  if (byId) return byId;

  // 2. Exact display_name match (case-insensitive).
  for (const desc of REGISTRY.values()) {
    if (desc.display_name.toLowerCase() === portLower) return desc;
  }

  // 3. port_match pattern scan.
  for (const desc of REGISTRY.values()) {
    for (const matcher of desc.port_match) {
      if (matcher.pattern instanceof RegExp) {
        if (matcher.pattern.test(port)) return desc;
      } else {
        if (portLower.includes(matcher.pattern.toLowerCase())) return desc;
      }
    }
  }

  return undefined;
}
