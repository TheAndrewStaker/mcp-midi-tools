/**
 * Passive MIDI capture — device-agnostic, no virtual ports needed.
 *
 * Opens a MIDI input port as a parallel listener (shares the port with
 * any other app reading it; Windows MIDI permits shared read access on
 * most drivers) and writes every received SysEx / channel message to a
 * raw `.syx` file on disk.
 *
 * **Why this approach works** (and why we landed on it after fighting
 * loopMIDI / rtpMIDI / ipMIDI / MIDI-OX for hours during HW-085 on
 * 2026-05-10/11):
 *
 *   - Windows MIDI input ports are SHARED-readable. This script can
 *     open `AXE-FX II MIDI In` while AxeEdit is also reading it; both
 *     see the same byte stream.
 *   - No virtual MIDI driver needed → no AxeEdit port filtering, no
 *     trial limits, no driver state to recover from, no MIDI-OX UI
 *     archaeology.
 *   - Output side (host → device) would need a bridge to intercept
 *     (the editor app's writes), but the input side (device → host) is
 *     the half that carries the wire format we want to decode.
 *     Capturing device responses is enough for most protocol RE — the
 *     bytes are byte-exact, which is what we test our decoder against.
 *
 * **What this WON'T capture:**
 *
 *   - Bytes sent FROM an editor app (AxeEdit, AM4-Edit, etc.) TO the
 *     device. Windows MIDI output ports are write-only; we can't
 *     passively read them. If you need outgoing captures, you need a
 *     virtual-port bridge (loopMIDI for non-Fractal apps; ipMIDI for
 *     AxeEdit / AM4-Edit since Fractal editors filter loopMIDI). See
 *     `scripts/sniff.ts` for the pre-existing bridge-based sniffer.
 *
 * Usage:
 *
 *   # List available MIDI input ports and exit (no capture):
 *   npx tsx scripts/capture-midi-passive.ts
 *
 *   # Capture from the first port whose name contains the substring
 *   # (case-insensitive match):
 *   npx tsx scripts/capture-midi-passive.ts <port-substring> <output.syx>
 *
 *   # Convenience npm aliases — port substring is pre-baked, you only
 *   # supply the output path:
 *   npm run capture-axefx2 -- <output.syx>     # matches "axe-fx" / "axefx"
 *   npm run capture-am4 -- <output.syx>        # matches "am4"
 *   npm run capture-midi -- <port-substring> <output.syx>  # generic
 *
 * Press Ctrl+C to stop. The output file is appended-to as messages
 * arrive, so partial captures survive crashes / Ctrl+C / power loss.
 *
 * If you see "Failed to open port" — another app may be holding the
 * port with exclusive access. Quit that app, re-run this script, then
 * relaunch the app AFTER the capture script is running (Windows MIDI
 * permits multiple readers if the second reader gets in first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import midi from 'midi';

interface PortInfo {
    index: number;
    name: string;
}

function listInputPorts(): PortInfo[] {
    const input = new midi.Input();
    const ports: PortInfo[] = [];
    try {
        for (let i = 0; i < input.getPortCount(); i++) {
            ports.push({ index: i, name: input.getPortName(i) });
        }
    } finally {
        try { input.closePort(); } catch { /* not opened */ }
    }
    return ports;
}

function findPortBySubstring(needle: string): PortInfo | null {
    const lower = needle.toLowerCase();
    for (const p of listInputPorts()) {
        if (p.name.toLowerCase().includes(lower)) return p;
    }
    return null;
}

function printUsageAndPorts(): void {
    console.error('Passive MIDI capture — saves device → host SysEx to a `.syx` file.\n');
    console.error('Usage:');
    console.error('  npx tsx scripts/capture-midi-passive.ts <port-substring> <output.syx>\n');
    console.error('Convenience aliases (port substring is pre-baked, supply only the path):');
    console.error('  npm run capture-axefx2 -- <output.syx>       # matches Axe-Fx II ports');
    console.error('  npm run capture-am4 -- <output.syx>          # matches AM4 ports');
    console.error('  npm run capture-midi -- <port-substring> <output.syx>  # generic\n');
    console.error('Examples:');
    console.error('  npm run capture-axefx2 -- samples/captured/my-axefx2.syx');
    console.error('  npx tsx scripts/capture-midi-passive.ts hydra samples/captured/foo.syx\n');
    console.error('Available MIDI input ports:');
    const ports = listInputPorts();
    if (ports.length === 0) {
        console.error('  (no MIDI input ports found — plug in your device and confirm the driver is installed)');
    } else {
        for (const p of ports) console.error(`  [${p.index}] ${p.name}`);
    }
}

const portArg = process.argv[2];
const outPathArg = process.argv[3];

if (!portArg || !outPathArg) {
    printUsageAndPorts();
    process.exit(portArg && !outPathArg ? 1 : 0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const absOut = path.isAbsolute(outPathArg)
    ? outPathArg
    : path.resolve(__dirname, '..', outPathArg);

fs.mkdirSync(path.dirname(absOut), { recursive: true });

const port = findPortBySubstring(portArg);
if (!port) {
    console.error(`❌ No MIDI input port found whose name contains "${portArg}" (case-insensitive).`);
    console.error('\nAvailable input ports:');
    const ports = listInputPorts();
    if (ports.length === 0) {
        console.error('  (none — plug in your device and confirm the driver is installed)');
    } else {
        for (const p of ports) console.error(`  [${p.index}] ${p.name}`);
    }
    process.exit(1);
}

console.error(`✓ Found input port matching "${portArg}": [${port.index}] "${port.name}"`);

const input = new midi.Input();
const stream = fs.createWriteStream(absOut, { flags: 'a' });
let messageCount = 0;
let byteCount = 0;
const start = Date.now();

// Don't ignore SysEx (false). Do ignore timing clock + active-sensing
// (true, true) so we capture the protocol-meaningful messages, not
// the 24 PPQN clock spam and 0xFE keep-alive bytes.
input.ignoreTypes(false, true, true);

input.on('message', (_dt, bytes) => {
    messageCount++;
    byteCount += bytes.length;
    stream.write(Buffer.from(bytes));
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stderr.write(
        `\r[${elapsed}s] ${messageCount} messages, ${byteCount} bytes → ${path.basename(absOut)}     `,
    );
});

try {
    input.openPort(port.index);
} catch (err) {
    console.error(`\n❌ Failed to open port ${port.index}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('   This usually means another app is holding the port with exclusive access.');
    console.error('   Quit that app, re-run this script, then relaunch the app AFTER the capture is running.');
    process.exit(1);
}

console.error(`Capturing to: ${absOut}`);
console.error('Trigger MIDI traffic on the device or in your editor. Press Ctrl+C to stop.\n');

process.on('SIGINT', () => {
    console.error('\n\nStopping...');
    try { input.closePort(); } catch { /* already closed */ }
    stream.end(() => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.error(`✓ Saved ${messageCount} messages (${byteCount} bytes) over ${elapsed}s to:`);
        console.error(`  ${absOut}`);
        process.exit(0);
    });
});
