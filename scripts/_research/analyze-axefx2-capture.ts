/**
 * Axe-Fx II passive-capture deep analyzer.
 *
 * Reads a `.syx` capture and surfaces:
 *   - Per-function-byte: count, average length, unique-message-shape
 *     samples (deduplicated by full byte content).
 *
 * Use case: identifying "event" messages (low-count, distinctive shape)
 * vs idle background traffic (high-count, frequent shape). For example,
 * when capturing a channel-toggle, the channel-switch message is rare
 * — looking at the rare function bytes' unique shapes narrows the
 * decode space dramatically.
 *
 * Usage:
 *   npx tsx scripts/analyze-axefx2-capture.ts <path-to.syx>
 *   npx tsx scripts/analyze-axefx2-capture.ts <path-to.syx> --fn=0x0B
 *     (filter to a specific function byte)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface SysExMessage {
    readonly offset: number;
    readonly bytes: Uint8Array;
    readonly fn: number;
}

function splitAxeFxII(buf: Uint8Array): SysExMessage[] {
    const messages: SysExMessage[] = [];
    let i = 0;
    while (i < buf.length) {
        if (buf[i] !== 0xf0) { i++; continue; }
        const start = i;
        let end = i + 1;
        while (end < buf.length && buf[end] !== 0xf7) end++;
        if (end >= buf.length) break;
        const bytes = buf.subarray(start, end + 1);
        if (
            bytes.length >= 7 &&
            bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x74 && bytes[4] === 0x07
        ) {
            messages.push({ offset: start, bytes, fn: bytes[5] });
        }
        i = end + 1;
    }
    return messages;
}

function hex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

const arg = process.argv[2];
const fnFilterArg = process.argv.find((a) => a.startsWith('--fn='));
const fnFilter = fnFilterArg ? parseInt(fnFilterArg.split('=')[1], 16) : undefined;

if (!arg) {
    console.error('Usage: analyze-axefx2-capture <path-to.syx> [--fn=0xNN]');
    process.exit(1);
}
const absPath = path.resolve(arg);
if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
}

const buf = readFileSync(absPath);
const messages = splitAxeFxII(buf);

console.log(`File: ${absPath}`);
console.log(`Total Axe-Fx II SysEx messages: ${messages.length}`);
console.log('');

// Per-function-byte stats.
type Stats = { count: number; lengths: Set<number>; uniqueShapes: Map<string, number> };
const byFn = new Map<number, Stats>();
for (const m of messages) {
    let s = byFn.get(m.fn);
    if (!s) {
        s = { count: 0, lengths: new Set(), uniqueShapes: new Map() };
        byFn.set(m.fn, s);
    }
    s.count++;
    s.lengths.add(m.bytes.length);
    const key = hex(m.bytes);
    s.uniqueShapes.set(key, (s.uniqueShapes.get(key) ?? 0) + 1);
}

const sortedFns = [...byFn.entries()].sort(([a], [b]) => a - b);

if (fnFilter !== undefined) {
    const s = byFn.get(fnFilter);
    if (!s) {
        console.log(`No messages found with function byte 0x${fnFilter.toString(16)}.`);
        process.exit(0);
    }
    console.log(`Function 0x${fnFilter.toString(16).padStart(2, '0')}: ${s.count} messages, ` +
                `${s.uniqueShapes.size} unique shapes, lengths=[${[...s.lengths].sort((a, b) => a - b).join(', ')}].`);
    console.log('');
    console.log('All unique message shapes (count × hex):');
    const sortedShapes = [...s.uniqueShapes.entries()].sort(([, a], [, b]) => b - a);
    for (const [shape, count] of sortedShapes) {
        console.log(`  ${count.toString().padStart(5)}× ${shape}`);
    }
} else {
    console.log('Function-byte summary:');
    console.log('');
    console.log(' fn   total   unique  lengths                      sample shapes (top 3 by count)');
    console.log('───  ──────  ───────  ───────────────────────────  ─────────────────────────────────');
    for (const [fn, s] of sortedFns) {
        const lens = [...s.lengths].sort((a, b) => a - b).join(',');
        const topShapes = [...s.uniqueShapes.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3);
        const fnHex = `0x${fn.toString(16).padStart(2, '0')}`;
        const lensCol = lens.padEnd(28);
        console.log(`${fnHex}  ${s.count.toString().padStart(6)}  ${s.uniqueShapes.size.toString().padStart(7)}  ${lensCol}`);
        for (const [shape, count] of topShapes) {
            const truncated = shape.length > 90 ? shape.slice(0, 90) + ' …' : shape;
            console.log(`                                                    ${count.toString().padStart(4)}× ${truncated}`);
        }
    }
    console.log('');
    console.log('Tip: rare function bytes (1-10 total) are usually "event" messages —');
    console.log('look at their shapes to identify channel-switch / scene-switch /');
    console.log('block-add / etc. encodings. Re-run with --fn=0xNN to see all shapes.');
}
