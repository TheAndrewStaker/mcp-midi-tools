// Recon: enumerate loaded modules + count calls into text-rendering APIs.
// Also hook DirectWrite + Direct2D + GDI+ exports to see which AM4-Edit
// is actually using.

const TEXT_DLLS = [
    'dwrite.dll',     // DirectWrite — modern text
    'd2d1.dll',       // Direct2D
    'gdiplus.dll',    // GDI+
    'user32.dll',     // classic GDI text via user32
    'gdi32.dll',      // classic GDI text
    'gdi32full.dll',
    'd3d11.dll',      // direct GPU
    'd3d12.dll',
    'dcomp.dll',      // DirectComposition
    'dxgi.dll',
    'opengl32.dll',
    'msftedit.dll',   // RichEdit
    'comctl32.dll',   // common controls
    'usp10.dll',      // Uniscribe
];

const callCounts = new Map();
function bump(name) {
    callCounts.set(name, (callCounts.get(name) || 0) + 1);
}

function hookAndCount(modName, fnName) {
    let mod = null;
    try { mod = Process.findModuleByName(modName); } catch (e) {}
    if (!mod) return false;
    let addr = null;
    try { addr = mod.findExportByName(fnName); } catch (e) {}
    if (!addr) return false;
    const key = modName + '!' + fnName;
    Interceptor.attach(addr, {
        onEnter() { bump(key); },
    });
    return true;
}

// Hook a generous set of text-related APIs
const APIS_TO_HOOK = [
    // user32 / GDI text
    ['user32.dll', 'DrawTextW'],
    ['user32.dll', 'DrawTextExW'],
    ['user32.dll', 'SetWindowTextW'],
    ['user32.dll', 'SetWindowTextA'],
    ['gdi32.dll', 'TextOutW'],
    ['gdi32.dll', 'TextOutA'],
    ['gdi32.dll', 'ExtTextOutW'],
    ['gdi32.dll', 'ExtTextOutA'],
    ['gdi32full.dll', 'ExtTextOutW'],
    // DirectWrite
    ['dwrite.dll', 'DWriteCreateFactory'],
    // Direct2D
    ['d2d1.dll', 'D2D1CreateFactory'],
    // GDI+
    ['gdiplus.dll', 'GdipDrawString'],
    // Uniscribe
    ['usp10.dll', 'ScriptStringAnalyse'],
    ['usp10.dll', 'ScriptStringOut'],
    // RichEdit
    ['msftedit.dll', 'CreateWindowExW'],
    // Heap allocation as baseline
    ['kernel32.dll', 'HeapAlloc'],
    ['kernel32.dll', 'VirtualAlloc'],
    ['ntdll.dll', 'NtCreateFile'],
    ['ntdll.dll', 'NtReadFile'],
];

const installed = [];
const failed = [];
for (const [m, f] of APIS_TO_HOOK) {
    if (hookAndCount(m, f)) installed.push(m + '!' + f);
    else failed.push(m + '!' + f);
}

console.log('=== Recon hook installation ===');
console.log('installed (' + installed.length + '):');
for (const x of installed) console.log('  ' + x);
console.log('not loaded / not available (' + failed.length + '):');
for (const x of failed) console.log('  ' + x);

// Periodic report
let tick = 0;
setInterval(() => {
    tick++;
    console.log('');
    console.log('=== tick ' + tick + ' (5s intervals) ===');
    // Sort by count, top 25
    const entries = [...callCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, v] of entries.slice(0, 25)) {
        console.log('  ' + v.toString().padStart(8) + '  ' + k);
    }

    // Module enum on first tick
    if (tick === 1) {
        console.log('\n=== loaded text-related modules ===');
        for (const dll of TEXT_DLLS) {
            const m = Process.findModuleByName(dll);
            if (m) console.log('  LOADED: ' + dll + ' base=' + m.base + ' size=' + m.size);
            else console.log('  not loaded: ' + dll);
        }

        // Also enumerate ALL loaded modules briefly
        console.log('\n=== all loaded modules ===');
        const all = Process.enumerateModules();
        console.log('  total: ' + all.length);
        for (const m of all) {
            // Filter to interesting ones (graphics/text/audio/UI)
            const n = m.name.toLowerCase();
            if (n.includes('d3d') || n.includes('d2d') || n.includes('dwrite') ||
                n.includes('gdi') || n.includes('text') || n.includes('font') ||
                n.includes('render') || n.includes('graphic') || n.includes('jucy') ||
                n.includes('juce')) {
                console.log('    ' + m.name + ' base=' + m.base);
            }
        }
    }
}, 5000);

console.log('\nResume the process, navigate around AM4-Edit, then close it.');
