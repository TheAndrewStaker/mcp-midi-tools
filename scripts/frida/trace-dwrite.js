// Frida hook v3 — DirectWrite-aware. AM4-Edit uses Direct2D + DirectWrite
// for text rendering (JUCE Windows backend). Classic GDI hooks caught
// zero label rendering. Need to hook DWrite/D2D APIs.
//
// Strategy:
//   1. Enumerate dwrite.dll, d2d1.dll, d3d11.dll exports — print
//      everything text-related so we know what's hookable.
//   2. Hook DWriteCreateFactory — captures the IDWriteFactory pointer.
//   3. From the factory, hook the CreateTextLayout vtable method
//      (vtable index 18 per official IDWriteFactory definition).
//      That method takes the wide string we want.
//   4. Also hook DWriteCreateFactory's other related entry points.
//   5. Also do a periodic memory scan for known labels and report the
//      addresses where they appear (gives us the runtime location
//      even if hook approach misses).

const TARGET_STRINGS = [
    'Bright Cap', 'High Treble', 'Master Vol Trim',
    'Saturation Drive', 'Negative Feedback', 'Variac',
    'Spring Tone', 'Slew Rate', 'Bass Focus', 'Knee Type',
    'Sidechain Source', 'Auto Makeup', 'Bit Reduce',
    'Power Tube', 'Mod Phase', 'Pre-Delay',
];
const TARGET_UTF16_BYTES = TARGET_STRINGS.map(s => {
    const buf = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) { buf[i * 2] = s.charCodeAt(i); }
    return { str: s, bytes: buf };
});
const TARGET_ASCII_BYTES = TARGET_STRINGS.map(s => {
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
    return { str: s, bytes: buf };
});

let totalDwriteCalls = 0;
let totalCreateLayoutCalls = 0;
let labelHits = 0;
const seenLabels = new Set();

function findInBuffer(arr, targets) {
    for (const t of targets) {
        const tb = t.bytes;
        const first = tb[0];
        for (let i = 0; i + tb.length <= arr.length; i++) {
            if (arr[i] !== first) continue;
            let m = true;
            for (let j = 1; j < tb.length; j++) if (arr[i + j] !== tb[j]) { m = false; break; }
            if (m) return { str: t.str, off: i };
        }
    }
    return null;
}

function readBuf(ptr, len) {
    if (len <= 0 || len > 100_000) return null;
    try { return new Uint8Array(ptr.readByteArray(Math.min(len, 8192))); }
    catch (e) { return null; }
}

function logHit(api, src, hit, encoding, retAddr, extra, ctx) {
    labelHits++;
    seenLabels.add(hit.str);
    console.log('');
    console.log('### HIT  ' + api + '  "' + hit.str + '"  (' + encoding + ')');
    console.log('  src=' + src + '  retAddr=' + retAddr + (extra ? '  ' + extra : ''));
    console.log('  match offset within source: +' + hit.off);
    try {
        const m = Process.findModuleByAddress(src);
        if (m) console.log('  src module: ' + m.name + '+' + src.sub(m.base));
        else console.log('  src module: <heap or non-module>');
    } catch (e) {}
    try {
        const cm = Process.findModuleByAddress(retAddr);
        if (cm) console.log('  caller module: ' + cm.name + '+' + retAddr.sub(cm.base));
    } catch (e) {}
    if (ctx) console.log('  context: ' + ctx);

    // Stack backtrace
    try {
        console.log('  stack:');
        const bt = Thread.backtrace(this.context, Backtracer.ACCURATE).slice(0, 8);
        for (const f of bt) {
            const fm = Process.findModuleByAddress(f);
            console.log('    ' + f + (fm ? '  ' + fm.name + '+' + f.sub(fm.base) : ''));
        }
    } catch (e) {}
}

console.log('=== DirectWrite hook v3 ===');

// Enumerate dwrite + d2d1 exports
function dumpExports(modName) {
    const m = Process.findModuleByName(modName);
    if (!m) { console.log(modName + ': not loaded'); return null; }
    console.log('\n--- ' + modName + ' exports (filtered) ---');
    const exports = m.enumerateExports();
    let printed = 0;
    for (const e of exports) {
        // Filter for text/format/layout/draw/factory functions
        const n = e.name.toLowerCase();
        if (n.includes('factory') || n.includes('text') || n.includes('layout') ||
            n.includes('format') || n.includes('draw') || n.includes('font') ||
            n.includes('create')) {
            console.log('  ' + e.name + ' @ ' + e.address);
            printed++;
            if (printed > 30) { console.log('  ...truncated'); break; }
        }
    }
    return m;
}

const dwrite = dumpExports('dwrite.dll');
const d2d1 = dumpExports('d2d1.dll');
const d3d11 = dumpExports('d3d11.dll');

// Hook DWriteCreateFactory if present
let factoryHooked = false;
if (dwrite) {
    const dwf = dwrite.findExportByName('DWriteCreateFactory');
    if (dwf) {
        console.log('\n[hook] dwrite!DWriteCreateFactory @ ' + dwf);
        Interceptor.attach(dwf, {
            onEnter(args) {
                this.factoryOut = args[2]; // IDWriteFactory** out parameter
                this.iid = args[1];
            },
            onLeave(retval) {
                if (retval.toInt32() !== 0) return; // S_OK = 0
                if (!this.factoryOut || this.factoryOut.isNull()) return;
                const factoryPtr = this.factoryOut.readPointer();
                console.log('  [DWriteCreateFactory] returned factory=' + factoryPtr);

                // Read vtable
                const vtable = factoryPtr.readPointer();
                console.log('  vtable=' + vtable);

                // IDWriteFactory vtable layout (relative slots after IUnknown's 3):
                //   0: QueryInterface
                //   1: AddRef
                //   2: Release
                //   3: GetSystemFontCollection
                //   4: CreateCustomFontCollection
                //   5: RegisterFontCollectionLoader
                //   6: UnregisterFontCollectionLoader
                //   7: CreateFontFileReference
                //   8: CreateCustomFontFileReference
                //   9: CreateFontFace
                //   10: CreateRenderingParams
                //   11: CreateMonitorRenderingParams
                //   12: CreateCustomRenderingParams
                //   13: RegisterFontFileLoader
                //   14: UnregisterFontFileLoader
                //   15: CreateTextFormat
                //   16: CreateTypography
                //   17: GetGdiInterop
                //   18: CreateTextLayout      ← THIS ONE
                //   19: CreateGdiCompatibleTextLayout
                //   20: CreateEllipsisTrimmingSign
                //   21: CreateTextAnalyzer
                //   22: CreateNumberSubstitution
                //   23: CreateGlyphRunAnalysis
                if (factoryHooked) return;
                factoryHooked = true;

                const ptrSize = Process.pointerSize;
                const layoutSlot = vtable.add(18 * ptrSize);
                const layoutFn = layoutSlot.readPointer();
                console.log('  CreateTextLayout @ ' + layoutFn);

                Interceptor.attach(layoutFn, {
                    onEnter(args) {
                        totalCreateLayoutCalls++;
                        // CreateTextLayout(this*, WCHAR* string, UINT32 stringLength, IDWriteTextFormat*, FLOAT maxWidth, FLOAT maxHeight, IDWriteTextLayout** out)
                        const str = args[1];
                        const len = args[2].toInt32();
                        const buf = readBuf(str, len * 2);
                        if (!buf) return;
                        const hit = findInBuffer(buf, TARGET_UTF16_BYTES);
                        if (hit) {
                            logHit('IDWriteFactory::CreateTextLayout', str, hit, 'UTF-16LE', this.returnAddress,
                                   'stringLength=' + len, 'first 32 chars = "' +
                                   String.fromCharCode.apply(null, Array.from(buf.slice(0, Math.min(64, buf.length))).filter((_, i) => i % 2 === 0).slice(0, 32)) + '"');
                        }
                    },
                });

                // Also hook CreateTextFormat (slot 15) — sets up font/style for a string
                const formatSlot = vtable.add(15 * ptrSize);
                const formatFn = formatSlot.readPointer();
                console.log('  CreateTextFormat @ ' + formatFn);
                Interceptor.attach(formatFn, {
                    onEnter(args) {
                        totalDwriteCalls++;
                    },
                });
            },
        });
    } else {
        // Try alternate names
        for (const alt of ['DWriteCreateFactory@@', '?DWriteCreateFactory@@YAJWAPEAU_GUID@@PEAPEAUIUnknown@@@Z']) {
            const a = dwrite.findExportByName(alt);
            if (a) console.log('[hook] dwrite!' + alt + ' @ ' + a);
        }
        console.log('[hook] DWriteCreateFactory not found by name; might need manual signature scan.');
    }
}

// Periodically scan process memory for label strings — gives us
// the runtime addresses regardless of how they got there.
let scanRound = 0;
function scanMemoryForLabels() {
    scanRound++;
    console.log('\n=== memory scan round ' + scanRound + ' ===');
    const ranges = Process.enumerateRanges('rw-');
    let scanned = 0;
    for (const r of ranges) {
        if (r.size > 50_000_000) continue; // skip huge ranges
        scanned++;
        for (const t of TARGET_UTF16_BYTES) {
            try {
                const pattern = Array.from(t.bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
                const matches = Memory.scanSync(r.base, r.size, pattern);
                for (const m of matches) {
                    console.log('  UTF-16: "' + t.str + '" found at ' + m.address);
                    // Print 64 bytes context
                    try {
                        const ctxBytes = m.address.sub(16).readByteArray(96);
                        if (ctxBytes) {
                            const arr = new Uint8Array(ctxBytes);
                            let hex = '', ascii = '';
                            for (const b of arr) {
                                hex += b.toString(16).padStart(2, '0') + ' ';
                                ascii += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.';
                            }
                            console.log('    ctx (-16): ' + hex);
                            console.log('    ascii    : ' + ascii);
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        }
        for (const t of TARGET_ASCII_BYTES) {
            try {
                const pattern = Array.from(t.bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
                const matches = Memory.scanSync(r.base, r.size, pattern);
                for (const m of matches) {
                    console.log('  ASCII : "' + t.str + '" found at ' + m.address);
                }
            } catch (e) {}
        }
    }
    console.log('  scanned ' + scanned + ' rw ranges');
}

// Periodic stats
let tick = 0;
setInterval(() => {
    tick++;
    console.log('[tick ' + tick + '] CreateTextLayout=' + totalCreateLayoutCalls + ', dwrite=' + totalDwriteCalls + ', label hits=' + labelHits + ', distinct labels seen=' + seenLabels.size + ' [' + [...seenLabels].slice(0, 5).join(', ') + ']');

    // After 10 seconds (tick 2), do a memory scan to confirm labels exist
    if (tick === 2) {
        scanMemoryForLabels();
    }
}, 5000);

console.log('\nResume with %resume, navigate to Amp block, wait for tick 2 scan, then close.');
