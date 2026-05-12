# find_encoder.py — Ghidra Jython script
#
# Locates the AM4-Edit code that builds a 0x01 SET_PARAM SysEx message and
# decompiles it (plus near-callees) so we can transcribe the float-packing
# logic to TypeScript without an interactive Ghidra session.
#
# Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-encoder.txt
#
# Run from inside Ghidra:
#   1. Window -> Script Manager (or click the green play icon).
#   2. Click the "Manage Script Directories" toolbar button (looks like a
#      bullet list with a green plus). Add C:\dev\mcp-midi-tools\scripts\ghidra.
#      Close the dialog.
#   3. Refresh script list (the circular-arrow button).
#   4. Filter for "find_encoder" -> select it -> click the green Run arrow.
#   5. Watch the console pane; it prints progress and the final output path.
#
# @category AM4
# @keybinding
# @menupath
# @toolbar

from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.symbol import RefType

OUTPUT_PATH = r"C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-encoder.txt"

# Strings that should anchor us into the SET_PARAM code path.
ANCHOR_STRINGS = [
    "MESSAGE_SET_PARAM",
    "DebugSetParamDlg",
    "MESSAGE_GET_PARAM",
    "MESSAGE_DEFAULT_PARAM",
]

# Function-name substrings worth grabbing in addition to anchor xrefs.
NAME_PATTERNS = [
    "setparam",
    "set_param",
    "debugsetparam",
    "msg_setparam",
    "message_set",
    "encodeparam",
    "encode_param",
    "packfloat",
    "pack_float",
    "tofloat32",
    "float_to_bytes",
    "tomidi",
    "tosysex",
    "to_sysex",
    "build_sysex",
    "buildsysex",
    "sevenbit",
    "seven_bit",
    "to7bit",
]

# Class namespaces of obvious interest.
NAMESPACE_PATTERNS = [
    "DebugSetParamDlg",
    "Debug",
]

MAX_FUNCTIONS = 60
MAX_CALLEES_PER_FUNC = 6  # decompile up to N functions called by each anchor function

monitor = ConsoleTaskMonitor()
program = currentProgram
memory = program.getMemory()
listing = program.getListing()
funcMgr = program.getFunctionManager()
refMgr = program.getReferenceManager()
symMgr = program.getSymbolTable()

decomp = DecompInterface()
decomp.openProgram(program)


def _bytes(s):
    # Jython 2.7: encode to a Java byte[] for memory.findBytes.
    arr = bytearray(s.encode("ascii") + b"\x00")
    return bytes(arr)


def find_string_addrs(text):
    found = []
    pat = _bytes(text)
    init_set = memory.getAllInitializedAddressSet()
    cur = init_set.getMinAddress()
    end = init_set.getMaxAddress()
    while cur is not None and cur.compareTo(end) <= 0:
        hit = memory.findBytes(cur, pat, None, True, monitor)
        if hit is None:
            break
        found.append(hit)
        cur = hit.add(1)
    return found


def find_pointer_refs(addr):
    # Find raw 8-byte LE pointers to addr anywhere in initialized memory.
    val = addr.getOffset()
    pat = bytearray(8)
    for i in range(8):
        pat[i] = (val >> (i * 8)) & 0xFF
    found = []
    init_set = memory.getAllInitializedAddressSet()
    cur = init_set.getMinAddress()
    end = init_set.getMaxAddress()
    while cur is not None and cur.compareTo(end) <= 0:
        hit = memory.findBytes(cur, bytes(pat), None, True, monitor)
        if hit is None:
            break
        found.append(hit)
        cur = hit.add(1)
        if len(found) > 32:
            break  # cap; we just need a few
    return found


def xrefs_to(addr):
    return [r.getFromAddress() for r in refMgr.getReferencesTo(addr)]


def func_at_or_containing(addr):
    f = funcMgr.getFunctionContaining(addr)
    return f


def decompile(func):
    if func is None:
        return "// (no function)"
    res = decomp.decompileFunction(func, 90, monitor)
    if not res.decompileCompleted():
        return "// decompile failed: " + str(res.getErrorMessage())
    dc = res.getDecompiledFunction()
    if dc is None:
        return "// (no decompiled function)"
    return dc.getC()


def callees_of(func):
    out = []
    body = func.getBody()
    if body is None:
        return out
    seen = set()
    for ref in refMgr.getReferenceIterator(body.getMinAddress()):
        if not body.contains(ref.getFromAddress()):
            continue
        if ref.getReferenceType() not in (RefType.UNCONDITIONAL_CALL, RefType.CONDITIONAL_CALL,
                                          RefType.COMPUTED_CALL, RefType.COMPUTED_JUMP):
            continue
        callee = funcMgr.getFunctionAt(ref.getToAddress())
        if callee is None:
            continue
        if callee.getEntryPoint() in seen:
            continue
        seen.add(callee.getEntryPoint())
        out.append(callee)
        if len(out) >= MAX_CALLEES_PER_FUNC:
            break
    return out


lines = []


def w(s):
    lines.append(s)
    print(s)


w("=" * 80)
w("AM4-Edit RE - find_encoder.py")
w("Program: " + program.getName())
w("=" * 80)

functions_to_decompile = {}  # entry address -> function

# ---- 1. Anchor strings ----
for anchor in ANCHOR_STRINGS:
    w("\n## Anchor string: " + anchor)
    addrs = find_string_addrs(anchor)
    if not addrs:
        w("  (not found in initialized memory)")
        continue
    for sa in addrs:
        w("  string @ " + str(sa))

        direct = xrefs_to(sa)
        w("    direct xrefs: " + str(len(direct)))
        for r in direct[:10]:
            f = func_at_or_containing(r)
            fname = f.getName() if f else "<no func>"
            w("      - " + str(r) + "  in " + fname)
            if f and f.getEntryPoint() not in functions_to_decompile:
                functions_to_decompile[f.getEntryPoint()] = f

        ptrs = find_pointer_refs(sa)
        w("    raw 8-byte LE pointer hits: " + str(len(ptrs)))
        for pa in ptrs[:5]:
            w("      pointer @ " + str(pa))
            for r in xrefs_to(pa)[:10]:
                f = func_at_or_containing(r)
                fname = f.getName() if f else "<no func>"
                w("        xref @ " + str(r) + "  in " + fname)
                if f and f.getEntryPoint() not in functions_to_decompile:
                    functions_to_decompile[f.getEntryPoint()] = f

# ---- 2. Function name patterns ----
w("\n## Functions matching name patterns")
matched = 0
for f in funcMgr.getFunctions(True):
    name = f.getName().lower()
    if any(p in name for p in NAME_PATTERNS):
        w("  " + f.getName() + " @ " + str(f.getEntryPoint()) + "  ns=" + str(f.getParentNamespace()))
        if f.getEntryPoint() not in functions_to_decompile:
            functions_to_decompile[f.getEntryPoint()] = f
        matched += 1
w("  (total: " + str(matched) + ")")

# ---- 3. Functions in interesting namespaces ----
w("\n## Functions in namespaces matching: " + ", ".join(NAMESPACE_PATTERNS))
matched = 0
for f in funcMgr.getFunctions(True):
    ns = str(f.getParentNamespace())
    if any(p.lower() in ns.lower() for p in NAMESPACE_PATTERNS):
        if f.getEntryPoint() not in functions_to_decompile:
            functions_to_decompile[f.getEntryPoint()] = f
            matched += 1
            w("  " + f.getName() + " @ " + str(f.getEntryPoint()) + "  ns=" + ns)
w("  (added: " + str(matched) + ")")

# ---- 4. Pull in 1-level callees of every anchor function ----
w("\n## Adding 1-level callees of anchor functions")
anchor_funcs = list(functions_to_decompile.values())
added = 0
for af in anchor_funcs:
    for callee in callees_of(af):
        if callee.getEntryPoint() not in functions_to_decompile:
            functions_to_decompile[callee.getEntryPoint()] = callee
            added += 1
w("  (added: " + str(added) + ")")

# Cap output
all_funcs = sorted(functions_to_decompile.values(), key=lambda f: f.getEntryPoint().getOffset())
if len(all_funcs) > MAX_FUNCTIONS:
    w("\n## Capping decompilation at %d / %d functions" % (MAX_FUNCTIONS, len(all_funcs)))
    all_funcs = all_funcs[:MAX_FUNCTIONS]

w("\n" + "=" * 80)
w("Decompiling %d functions" % len(all_funcs))
w("=" * 80)

for func in all_funcs:
    w("\n" + "#" * 80)
    w("# " + func.getName() + " @ " + str(func.getEntryPoint()))
    w("# parent namespace: " + str(func.getParentNamespace()))
    w("# signature: " + str(func.getSignature()))
    w("#" * 80)
    code = decompile(func)
    w(code if code else "// (no decompilation)")

# Write file
try:
    f = open(OUTPUT_PATH, "w")
    f.write("\n".join(lines))
    f.close()
    print("\nWrote %d lines to %s" % (len(lines), OUTPUT_PATH))
except Exception as e:
    print("FAILED to write output: " + str(e))
