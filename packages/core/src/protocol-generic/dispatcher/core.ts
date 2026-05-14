/**
 * Dispatcher core — step-1 port resolution and step-5 connection setup.
 *
 * Every unified MCP tool routes through one of the `execute*` wrappers in
 * the sibling family files (`params.ts`, `navigation.ts`, etc.); each of
 * those wrappers starts by calling `requireDevice(port)` here, runs its
 * family-specific validation, then calls `openCtx(descriptor)` to obtain
 * the MIDI handle right before delegating to the descriptor's writer or
 * reader.
 */

import { ensureConnection } from '../../server-shared/connections.js';
import {
  DispatchError,
  type DeviceDescriptor,
  type DispatchCtx,
  type DispatchErrorDetails,
} from '../types.js';
import { listRegisteredDevices, resolveDevice } from '../registry.js';

/**
 * Resolves `port` to a registered descriptor or throws a
 * `port_not_found` DispatchError with the list of known devices.
 */
export function requireDevice(port: string): DeviceDescriptor {
  const desc = resolveDevice(port);
  if (desc) return desc;
  const known = listRegisteredDevices()
    .map((d) => d.display_name)
    .join(', ');
  const details: DispatchErrorDetails = {
    valid_options: listRegisteredDevices().map((d) => d.display_name),
    retry_action: 'Call list_midi_ports to see what is connected.',
  };
  throw new DispatchError(
    'port_not_found',
    '(no device matched)',
    known.length > 0
      ? `No registered device matches port '${port}'. Known devices: ${known}.`
      : `No registered device matches port '${port}'. No devices are registered yet.`,
    details,
  );
}

/**
 * Open the MIDI handle for a descriptor and bundle it into the
 * `DispatchCtx` envelope the writer / reader sees. Step-5 of the
 * dispatcher's 6-step lifecycle.
 */
export function openCtx(descriptor: DeviceDescriptor): DispatchCtx {
  const label = descriptor.connection_label ?? descriptor.id;
  const conn = ensureConnection(label);
  return { conn, descriptor };
}
