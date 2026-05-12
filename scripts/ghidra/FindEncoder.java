// FindEncoder.java — Ghidra GhidraScript (revised)
//
// Goal: locate the AM4-Edit code that builds a 0x01 SET_PARAM SysEx message
// and decompile it (plus near-callees) so we can transcribe the float-packing
// logic to TypeScript.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-encoder.txt
//
// Strategy (v2):
//   1. Walk the FULL symbol table (not just named functions) — C++ class
//      methods come through as mangled symbols like "?SetParam@DebugSetParamDlg@@..."
//      even when the function itself isn't given a friendly name.
//   2. Byte-search for the AM4 SysEx envelope "F0 00 01 74" in code. Any
//      function emitting that constant is in our path.
//   3. Walk every instruction in .text and check whether its operand
//      resolves to the debug-message pointer table (1413c7c40-ish). This
//      forces us to find xrefs Ghidra didn't auto-create.
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class FindEncoder extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-encoder.txt";

    // C++ mangled-name substrings (case-insensitive) that hint at the encoder.
    private static final String[] SYMBOL_PATTERNS = {
        "setparam", "set_param",
        "debugsetparam",
        "msg_set", "messageset",
        "encodeparam", "encode_param",
        "packfloat", "pack_float",
        "tomidi", "to_midi",
        "tosysex", "to_sysex", "buildsysex", "build_sysex",
        "sevenbit", "seven_bit", "to7bit",
        "param.*sysex", "sysex.*param",
        "writeparam", "write_param",
        "value.*to.*byte", "byte.*from.*value",
        "fractalbot", "fractal_bot",  // Fractal-Bot is the librarian sub-app
    };

    // The pointer table region we discovered at 1413c7c40-1413c7c88.
    // Widen a bit in case the table extends.
    private static final long PTR_TABLE_START = 0x1413c7c00L;
    private static final long PTR_TABLE_END   = 0x1413c7e00L;

    // Class names whose vftables we want to dump and decompile every method of.
    private static final String[] VTABLE_CLASSES = {
        "DebugSetParamDlg",
    };

    // Functions whose CALLERS we want to chase (they're tiny helpers
    // probably called from many builders, including SET_PARAM).
    private static final long[] HELPER_FUNCS_TO_TRACE_CALLERS = {
        0x1401df150L,  // builds the 6-byte F0 00 01 74 [fn] [model] header
    };

    // SysEx envelope bytes: F0 00 01 74 (start, then Fractal manufacturer ID).
    private static final byte[] SYSEX_PATTERN = { (byte)0xF0, 0x00, 0x01, 0x74 };
    // Stricter: F0 00 01 74 15 01 (full SET_PARAM header up to action byte).
    private static final byte[] SETPARAM_PATTERN = { (byte)0xF0, 0x00, 0x01, 0x74, 0x15, 0x01 };

    private static final int MAX_FUNCTIONS = 250;
    private static final int MAX_CALLEES_PER_FUNC = 8;

    private final List<String> lines = new ArrayList<>();
    private DecompInterface decomp;
    private Program program;
    private Memory memory;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private SymbolTable symTbl;
    private Listing listing;

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private List<Address> xrefsToFunc(Function f) {
        List<Address> out = new ArrayList<>();
        for (Reference r : refMgr.getReferencesTo(f.getEntryPoint())) {
            out.add(r.getFromAddress());
        }
        return out;
    }

    private List<Address> findBytePattern(byte[] pat, int max) throws Exception {
        List<Address> found = new ArrayList<>();
        AddressSetView init = memory.getAllInitializedAddressSet();
        Address cur = init.getMinAddress();
        Address end = init.getMaxAddress();
        while (cur != null && cur.compareTo(end) <= 0) {
            Address hit = memory.findBytes(cur, pat, null, true, monitor);
            if (hit == null) break;
            found.add(hit);
            cur = hit.add(1);
            if (found.size() >= max) break;
        }
        return found;
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    private List<Function> calleesOf(Function f) {
        List<Function> out = new ArrayList<>();
        if (f.getBody() == null) return out;
        Set<Address> seen = new HashSet<>();
        InstructionIterator it = listing.getInstructions(f.getBody(), true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            if (!ins.getFlowType().isCall()) continue;
            for (Reference r : ins.getReferencesFrom()) {
                if (r.getReferenceType() != RefType.UNCONDITIONAL_CALL
                    && r.getReferenceType() != RefType.CONDITIONAL_CALL
                    && r.getReferenceType() != RefType.COMPUTED_CALL) continue;
                Function callee = funcMgr.getFunctionAt(r.getToAddress());
                if (callee == null) continue;
                if (!seen.add(callee.getEntryPoint())) continue;
                out.add(callee);
                if (out.size() >= MAX_CALLEES_PER_FUNC) return out;
            }
        }
        return out;
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        memory = program.getMemory();
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        symTbl = program.getSymbolTable();
        listing = program.getListing();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        // Two-tier: priority funcs are vftable methods + helper callers (always
        // decompiled). Secondary is everything else, capped.
        Map<Address, Function> priority = new TreeMap<>();
        Map<Address, Function> toDecompile = new TreeMap<>();

        w("================================================================================");
        w("AM4-Edit RE - FindEncoder.java (v2)");
        w("================================================================================");

        // ---- 1. Symbol-table walk (mangled C++ symbols) ----
        w("\n## Symbol-table matches (case-insensitive substring on full symbol name)");
        SymbolIterator allSyms = symTbl.getAllSymbols(true);
        int symCount = 0;
        int symMatches = 0;
        while (allSyms.hasNext()) {
            Symbol s = allSyms.next();
            symCount++;
            String nm = s.getName(true).toLowerCase(); // includes namespace
            for (String p : SYMBOL_PATTERNS) {
                String needle = p.replace(".*", "");
                if (nm.contains(needle)) {
                    symMatches++;
                    Address addr = s.getAddress();
                    Function f = funcMgr.getFunctionContaining(addr);
                    String fnInfo = f == null ? "(not in function)" : "func=" + f.getName() + " @ " + f.getEntryPoint();
                    w("  [" + p + "]  " + s.getName(true) + " @ " + addr + "  " + fnInfo);
                    if (f != null && !toDecompile.containsKey(f.getEntryPoint()))
                        toDecompile.put(f.getEntryPoint(), f);
                    break;
                }
            }
        }
        w("  (scanned " + symCount + " symbols, " + symMatches + " matches)");

        // ---- 2. Byte-pattern search for SysEx envelope in CODE ----
        w("\n## Byte-pattern search: SET_PARAM full header (F0 00 01 74 15 01)");
        List<Address> sysexHits = findBytePattern(SETPARAM_PATTERN, 50);
        w("  hits: " + sysexHits.size());
        for (Address h : sysexHits) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            if (f != null && !toDecompile.containsKey(f.getEntryPoint()))
                toDecompile.put(f.getEntryPoint(), f);
        }

        w("\n## Byte-pattern search: shorter SysEx envelope (F0 00 01 74)");
        List<Address> sysexShortHits = findBytePattern(SYSEX_PATTERN, 80);
        w("  hits: " + sysexShortHits.size());
        for (Address h : sysexShortHits) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            if (f != null && !toDecompile.containsKey(f.getEntryPoint()))
                toDecompile.put(f.getEntryPoint(), f);
        }

        // ---- 3. Walk all instructions, find ones referencing our pointer-table region ----
        w("\n## Instructions referencing pointer-table region "
          + Long.toHexString(PTR_TABLE_START) + "-" + Long.toHexString(PTR_TABLE_END));
        InstructionIterator allIns = listing.getInstructions(true);
        int insMatches = 0;
        Set<Address> ptrXrefFuncs = new HashSet<>();
        while (allIns.hasNext()) {
            Instruction ins = allIns.next();
            for (int op = 0; op < ins.getNumOperands(); op++) {
                Address ref = null;
                Object[] objs = ins.getOpObjects(op);
                for (Object o : objs) {
                    if (o instanceof Address) {
                        ref = (Address) o;
                    } else if (o instanceof Scalar) {
                        long v = ((Scalar) o).getUnsignedValue();
                        if (v >= PTR_TABLE_START && v < PTR_TABLE_END) {
                            ref = ins.getAddress().getNewAddress(v);
                        }
                    }
                    if (ref != null) {
                        long v = ref.getOffset();
                        if (v >= PTR_TABLE_START && v < PTR_TABLE_END) {
                            insMatches++;
                            Function f = funcMgr.getFunctionContaining(ins.getAddress());
                            if (f != null && ptrXrefFuncs.add(f.getEntryPoint())) {
                                w("  ins @ " + ins.getAddress() + "  refs " + ref
                                  + "  in func " + f.getName() + " @ " + f.getEntryPoint());
                                if (!toDecompile.containsKey(f.getEntryPoint()))
                                    toDecompile.put(f.getEntryPoint(), f);
                            } else if (f == null) {
                                w("  ins @ " + ins.getAddress() + "  refs " + ref + "  (no func)");
                            }
                        }
                    }
                }
            }
        }
        w("  (total instruction matches: " + insMatches + "; unique containing functions: " + ptrXrefFuncs.size() + ")");

        // ---- 3b. Walk vftables and decompile every method ----
        w("\n## Walking vftables for: " + String.join(", ", VTABLE_CLASSES));
        for (String cls : VTABLE_CLASSES) {
            SymbolIterator vsyms = symTbl.getAllSymbols(true);
            Set<Address> vtableAddrs = new TreeSet<>();
            while (vsyms.hasNext()) {
                Symbol s = vsyms.next();
                String n = s.getName(true);
                if (n.contains(cls + "::vftable") && !n.contains("vftable_meta_ptr")) {
                    vtableAddrs.add(s.getAddress());
                }
            }
            for (Address vt : vtableAddrs) {
                w("  vftable @ " + vt);
                // Read up to 32 8-byte function pointers
                Address cur = vt;
                for (int i = 0; i < 32; i++) {
                    long ptr;
                    try {
                        ptr = memory.getLong(cur);
                    } catch (Exception e) { break; }
                    if (ptr == 0) break;
                    Address fnAddr = vt.getNewAddress(ptr);
                    Function f = funcMgr.getFunctionAt(fnAddr);
                    if (f == null) f = funcMgr.getFunctionContaining(fnAddr);
                    String fname = f == null ? "<no func>" : f.getName();
                    w("    [" + i + "] -> " + fnAddr + "  " + fname);
                    if (f != null && !priority.containsKey(f.getEntryPoint())) {
                        priority.put(f.getEntryPoint(), f);
                    }
                    cur = cur.add(8);
                }
            }
        }

        // ---- 3c. Find all callers of small helper functions ----
        w("\n## Tracing callers of helper functions");
        for (long h : HELPER_FUNCS_TO_TRACE_CALLERS) {
            Address ha = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(h);
            Function helper = funcMgr.getFunctionAt(ha);
            if (helper == null) { w("  helper @ " + Long.toHexString(h) + " not found"); continue; }
            w("  helper " + helper.getName() + " @ " + ha);
            int count = 0;
            for (Address xref : xrefsToFunc(helper)) {
                Function f = funcMgr.getFunctionContaining(xref);
                if (f == null) continue;
                if (priority.containsKey(f.getEntryPoint())) continue;
                priority.put(f.getEntryPoint(), f);
                count++;
                w("    caller: " + f.getName() + " @ " + f.getEntryPoint() + "  (call site " + xref + ")");
            }
            w("    (added: " + count + " caller funcs)");
        }

        // ---- 4. 1-level callees of priority functions (also priority) ----
        w("\n## Adding 1-level callees of priority (vftable + helper-caller) functions");
        List<Function> priorityFuncs = new ArrayList<>(priority.values());
        int added = 0;
        for (Function af : priorityFuncs) {
            for (Function callee : calleesOf(af)) {
                if (!priority.containsKey(callee.getEntryPoint())) {
                    priority.put(callee.getEntryPoint(), callee);
                    added++;
                }
            }
        }
        w("  (added: " + added + ")");

        // Build final list: priority first, then secondary (deduped), capped.
        Map<Address, Function> finalSet = new LinkedHashMap<>();
        for (Function f : priority.values()) finalSet.put(f.getEntryPoint(), f);
        for (Function f : toDecompile.values()) {
            if (finalSet.size() >= MAX_FUNCTIONS) break;
            if (!finalSet.containsKey(f.getEntryPoint())) finalSet.put(f.getEntryPoint(), f);
        }

        w("\n================================================================================");
        w("Decompiling " + finalSet.size() + " functions"
          + "  (priority=" + priority.size() + ", secondary=" + toDecompile.size()
          + ", cap=" + MAX_FUNCTIONS + ")");
        w("================================================================================");
        List<Function> all = new ArrayList<>(finalSet.values());

        for (Function f : all) {
            w("\n################################################################################");
            w("# " + f.getName() + " @ " + f.getEntryPoint());
            w("# parent namespace: " + f.getParentNamespace());
            w("# signature: " + f.getSignature());
            w("################################################################################");
            w(decompile(f));
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
