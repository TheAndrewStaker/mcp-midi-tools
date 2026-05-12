// Frida hook v2 — uses modern API + hooks text-rendering and memory-
// allocation APIs which are always dynamically linked even when the
// CRT is static. Defers hook installation via polling until target
// modules are loaded.
//
// What we hook:
//   - user32!DrawTextW / DrawTextExW — when AM4-Edit draws text via
//     Win32 user-mode rendering. The lpString arg is the displayed text.
//   - gdi32!ExtTextOutW / TextOutW — lower-level text rendering.
//   - user32!SetWindowTextW — when AM4-Edit sets window/control titles.
//   - kernel32!HeapAlloc — buffer allocation.
//
// For each call where the text/buffer contains a known label, log
// the source address + caller (return address). The caller's offset
// within AM4-Edit.exe gives us the function in Ghidra to inspect.

const TARGET_STRINGS = [
    'Bright Cap',
    'High Treble',
    'Master Vol Trim',
    'Saturation Drive',
    'Negative Feedback',
    'Variac',
    'Spring Tone',
    'Slew Rate',
    'Bass Focus',
    'Knee Type',
    'Sidechain Source',
    'Auto Makeup',
    'Bit Reduce',
    'Power Tube',
    'Mod Phase',
    'Pre-Delay',
];

// Encode targets in both ASCII and UTF-16LE (Win32 UI APIs use wide chars).
const TARGET_ASCII = TARGET_STRINGS.map((s) => {
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
    return { str: s, bytes: buf };
});
const TARGET_UTF16 = TARGET_STRINGS.map((s) => {
    const buf = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
        buf[i * 2] = s.charCodeAt(i);
        buf[i * 2 + 1] = 0;
    }
    return { str: s, bytes: buf };
});

let totalCalls = 0;
let matchedCalls = 0;
const seenSources = new Set();
const seenLabels = new Set();
const hooked = [];
const hookedAlready = new Set();

function findInBuffer(arr, targetSet) {
    for (const t of targetSet) {
        const tb = t.bytes;
        const first = tb[0];
        for (let i = 0; i + tb.length <= arr.length; i++) {
            if (arr[i] !== first) continue;
            let m = true;
            for (let j = 1; j < tb.length; j++) {
                if (arr[i + j] !== tb[j]) { m = false; break; }
            }
            if (m) return { str: t.str, off: i };
        }
    }
    return null;
}

function readBuffer(ptr, byteLen) {
    if (byteLen <= 0 || byteLen > 1_000_000) return null;
    try {
        return new Uint8Array(ptr.readByteArray(Math.min(byteLen, 4096)));
    } catch (e) {
        return null;
    }
}

function logHit(api, src, hit, encoding, retAddr, extra) {
    matchedCalls++;
    const srcKey = src.toString();
    const isFirstSource = !seenSources.has(srcKey);
    seenSources.add(srcKey);
    const isFirstLabel = !seenLabels.has(hit.str);
    seenLabels.add(hit.str);

    console.log('');
    console.log('=== ' + api + ' MATCH "' + hit.str + '" (' + encoding + ') ===');
    console.log('  src=' + src + '  retAddr=' + retAddr + '  ' + extra);
    console.log('  match offset within source: +' + hit.off);

    // Source module
    try {
        const mod = Process.findModuleByAddress(src);
        if (mod) {
            console.log('  src module: ' + mod.name + '  base=' + mod.base + '  src-base=' + src.sub(mod.base));
        } else {
            console.log('  src module: <heap or non-module memory>');
        }
    } catch (e) { console.log('  src module: error ' + e.message); }

    // Caller
    try {
        const callerMod = Process.findModuleByAddress(retAddr);
        if (callerMod) {
            console.log('  caller: ' + callerMod.name + '+' + retAddr.sub(callerMod.base));
        } else {
            console.log('  caller: ' + retAddr);
        }
    } catch (e) { console.log('  caller: error ' + e.message); }

    if (isFirstLabel) {
        // Print stack trace for first sighting of each label
        try {
            console.log('  stack:');
            const bt = Thread.backtrace(this.context, Backtracer.ACCURATE).slice(0, 8);
            for (const frame of bt) {
                const fmod = Process.findModuleByAddress(frame);
                console.log('    ' + frame + (fmod ? '  ' + fmod.name + '+' + frame.sub(fmod.base) : ''));
            }
        } catch (e) { /* backtrace might fail outside onEnter */ }
    }
}

// Hook factories for different signatures.
function hookDrawTextW(name, addr) {
    Interceptor.attach(addr, {
        onEnter(args) {
            totalCalls++;
            // DrawTextW(HDC hdc, LPCWSTR lpchText, int cchText, LPRECT lpRect, UINT format)
            const text = args[1];
            const cch = args[2].toInt32();
            const len = cch === -1 ? 256 : cch * 2; // -1 means null-terminated
            const buf = readBuffer(text, len);
            if (!buf) return;
            const hit = findInBuffer(buf, TARGET_UTF16);
            if (hit) {
                this._matched = hit;
                logHit(name, text, hit, 'UTF-16LE', this.returnAddress, 'cchText=' + cch);
            }
        },
    });
}

function hookSetWindowTextW(name, addr) {
    Interceptor.attach(addr, {
        onEnter(args) {
            totalCalls++;
            // SetWindowTextW(HWND hWnd, LPCWSTR lpString)
            const text = args[1];
            // Read up to 256 wide chars (512 bytes)
            const buf = readBuffer(text, 512);
            if (!buf) return;
            const hit = findInBuffer(buf, TARGET_UTF16);
            if (hit) {
                logHit(name, text, hit, 'UTF-16LE', this.returnAddress, '');
            }
        },
    });
}

function hookExtTextOutW(name, addr) {
    Interceptor.attach(addr, {
        onEnter(args) {
            totalCalls++;
            // ExtTextOutW(HDC hdc, int x, int y, UINT options, RECT* lpRect, LPCWSTR lpString, UINT c, INT* lpDx)
            const text = args[5];
            const c = args[6].toInt32();
            const len = c === -1 ? 256 : c * 2;
            const buf = readBuffer(text, len);
            if (!buf) return;
            const hit = findInBuffer(buf, TARGET_UTF16);
            if (hit) {
                logHit(name, text, hit, 'UTF-16LE', this.returnAddress, 'c=' + c);
            }
        },
    });
}

function hookHeapAlloc(name, addr) {
    Interceptor.attach(addr, {
        onLeave(retval) {
            // Return value is a pointer to the allocated block.
            // We don't know the size at exit time without saving from onEnter,
            // but we can probe a small fixed size for label patterns.
            totalCalls++;
            if (retval.isNull()) return;
            const buf = readBuffer(retval, 256);
            if (!buf) return;
            const hit = findInBuffer(buf, TARGET_ASCII);
            if (hit) {
                logHit(name, retval, hit, 'ASCII', this.returnAddress, '');
            }
        },
    });
}

const apisToHook = [
    { mod: 'user32.dll',   fn: 'DrawTextW',       hook: hookDrawTextW },
    { mod: 'user32.dll',   fn: 'DrawTextExW',     hook: hookDrawTextW },
    { mod: 'user32.dll',   fn: 'SetWindowTextW',  hook: hookSetWindowTextW },
    { mod: 'gdi32.dll',    fn: 'ExtTextOutW',     hook: hookExtTextOutW },
    { mod: 'gdi32full.dll', fn: 'ExtTextOutW',    hook: hookExtTextOutW },
    { mod: 'kernel32.dll', fn: 'HeapAlloc',       hook: hookHeapAlloc },
    { mod: 'ntdll.dll',    fn: 'RtlAllocateHeap', hook: hookHeapAlloc },
];

function tryHooks() {
    let installed = 0;
    for (const a of apisToHook) {
        const key = a.mod + '!' + a.fn;
        if (hookedAlready.has(key)) continue;
        let mod;
        try { mod = Process.findModuleByName(a.mod); } catch (e) { mod = null; }
        if (!mod) continue;
        let addr;
        try { addr = mod.findExportByName(a.fn); } catch (e) { addr = null; }
        if (!addr) continue;
        try {
            a.hook(key, addr);
            hookedAlready.add(key);
            hooked.push(key);
            installed++;
            console.log('[hook] installed: ' + key + ' @ ' + addr);
        } catch (e) {
            console.log('[hook] FAILED to install ' + key + ': ' + e.message);
        }
    }
    return installed;
}

console.log('=== Frida label-source trace v2 ===');
console.log('targets: ' + TARGET_STRINGS.length + ' labels');

// Try hooks immediately, then poll for the next 30 seconds in case
// modules load late.
tryHooks();
let pollCount = 0;
const pollHandle = setInterval(() => {
    pollCount++;
    const newHooks = tryHooks();
    if (newHooks > 0) console.log('[poll ' + pollCount + '] +' + newHooks + ' new hooks; total: ' + hooked.length);
    if (pollCount >= 60 || hooked.length === apisToHook.length) clearInterval(pollHandle);
}, 500);

// Status heartbeat
setInterval(() => {
    console.log('[stats] hooked APIs: ' + hooked.length + '/' + apisToHook.length + ', total calls: ' + totalCalls + ', label matches: ' + matchedCalls + ', distinct labels found: ' + seenLabels.size);
}, 5000);
