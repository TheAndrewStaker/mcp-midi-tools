/**
 * Per-port MIDI connection registry shared by every tool family.
 *
 * The connection layer is keyed by `label` so the server can hold open
 * handles to multiple MIDI ports concurrently. Each device contributes
 * its own connector factory via `registerConnector(label, factory)` at
 * module-load time — typically a side-effect of the device's `midi.ts`
 * being imported. Labels with no registered factory fall back to a
 * generic substring connect against the label string itself.
 *
 * Extracted from `src/server/index.ts` during the server.ts split — the
 * shared module the rest of the tools depend on.
 */

import { connect, type MidiConnection } from '../midi/transport.js';

/**
 * Max time we wait for the device to echo a WRITE after we send it. The
 * AM4 typically responds in well under 50 ms when the target block is
 * placed; if 300 ms passes we treat it as silent-absorb (block not in
 * the active preset) and surface a clear error instead of pretending
 * the write succeeded.
 */
export const WRITE_ECHO_TIMEOUT_MS = 300;

export const AM4_LABEL = 'am4';
export const AXEFX2_LABEL = 'axe-fx-ii';
export const AXEFX3_LABEL = 'axe-fx-iii';

/**
 * How many ack-less writes we tolerate before assuming the MIDI handle is
 * stale and forcing a reconnect on the next use. Two is chosen so a single
 * "block not placed" silent-absorb doesn't trigger a reconnect (that's a
 * legitimate no-ack and should keep the handle), but two in a row across
 * any tool calls looks like the handle is actually dead.
 */
export const STALE_HANDLE_TIMEOUT_THRESHOLD = 2;

interface RegistryEntry {
    conn: MidiConnection;
    consecutiveTimeouts: number;
}

const connections = new Map<string, RegistryEntry>();
const connectionErrors = new Map<string, Error>();
const connectorFactories = new Map<string, () => MidiConnection>();

/**
 * Register a device-specific connector factory. The factory is invoked
 * the first time a tool calls `ensureConnection(label)` for the given
 * label. Subsequent calls return the cached connection until a
 * forced/stale reconnect.
 *
 * Devices register at module-load time (typically in their `midi.ts`)
 * so the side effect happens whenever any code imports the device
 * package — including the server boot path and isolated test scripts.
 */
export function registerConnector(label: string, factory: () => MidiConnection): void {
    connectorFactories.set(label, factory);
}

/**
 * Call after a write/ack pair completes. Resets the stale-handle counter on
 * success; increments it on timeout. Counter is per-port — patterns like
 * "apply_preset 3 AM4 writes all time out" count as 3 consecutive against
 * the AM4 entry only, and don't drag down a separate Hydrasynth handle.
 */
export function recordAckOutcome(acked: boolean, label: string = AM4_LABEL): void {
    const entry = connections.get(label);
    if (!entry) return;
    if (acked) entry.consecutiveTimeouts = 0;
    else entry.consecutiveTimeouts++;
}

function closeMidiSafely(conn: MidiConnection | undefined): void {
    if (!conn) return;
    try {
        conn.close();
    } catch {
        // Closing a stale handle can throw; ignore — we're discarding it anyway.
    }
}

/**
 * Open or return a cached connection for `label`. The default label is
 * the AM4; future device packages will pass their own label.
 *
 * When the label has a registered connector factory, that factory is
 * invoked. Otherwise the label itself is used as a port-name substring
 * via the generic `connect()`. Devices needing a non-substring port
 * discovery path (e.g. Axe-Fx II's "Axe-Fx II Port 1" with a space the
 * label uses a dash for) must register a factory.
 */
export function ensureConnection(
    label: string = AM4_LABEL,
    forceReconnect = false,
): MidiConnection {
    const cached = connections.get(label);
    const stale = (cached?.consecutiveTimeouts ?? 0) >= STALE_HANDLE_TIMEOUT_THRESHOLD;
    if (forceReconnect || stale) {
        if (cached) closeMidiSafely(cached.conn);
        connections.delete(label);
        connectionErrors.delete(label);
    }
    const existing = connections.get(label);
    if (existing) return existing.conn;
    const cachedErr = connectionErrors.get(label);
    if (cachedErr) throw cachedErr;
    try {
        const factory = connectorFactories.get(label);
        const conn = factory ? factory() : connect({ needles: [label] });
        connections.set(label, { conn, consecutiveTimeouts: 0 });
        return conn;
    } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        connectionErrors.set(label, e);
        throw e;
    }
}

/**
 * Back-compat shim — every AM4-only call site continues to call this.
 * Forwards to `ensureConnection()` with the default AM4 label.
 */
export function ensureMidi(forceReconnect = false): MidiConnection {
    return ensureConnection(AM4_LABEL, forceReconnect);
}

process.on('exit', () => {
    for (const entry of connections.values()) closeMidiSafely(entry.conn);
    connections.clear();
});
