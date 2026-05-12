// FindAxeEditRouting.java — Ghidra GhidraScript
//
// Goal: locate the AxeEdit code that builds the 0x06 routing-write SysEx
// (function we've confirmed via HW-108 click-to-connect capture is the
// cable-add/remove operation on Axe-Fx II), and decompile it so we can
// transcribe the payload-byte logic to TypeScript.
//
// Adapted from FindEncoder.java (AM4-Edit's SET_PARAM encoder hunt).
// Same three-tier strategy: symbol-table walk, byte-pattern search in
// code, instruction-walk for cross-references to interesting regions.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit-routing.txt
//
// Key differences from FindEncoder.java:
//   - Target binary is Axe-Edit.exe (12MB) instead of AM4-Edit.exe
//   - SysEx envelope uses model byte 0x07 (Axe-Fx II XL+) instead of 0x15 (AM4)
//   - Function byte of interest is 0x06 (routing-write, confirmed by
//     session-68-click-connect.syx — ACK F0 00 01 74 07 64 06 00 60 F7)
//   - Symbol patterns target routing/cable/grid/connect terminology
//
// What we want to find:
//   1. The function that builds a `F0 00 01 74 07 06 [payload...] [cs] F7` message
//   2. The payload assembly — specifically, what positions hold:
//      - effectId (or cell index, or row/col)
//      - routing mask (0x01..0x0F bit pattern, "feed from row N of prev col")
//      - any reserved/unused bytes
//   3. The set of result_codes the device responds with in the 0x64 ack
//      and what each one means (so we can map 0x01 / 0x0C / 0x00 / etc.)
//
// @category AxeFxII

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

public class FindAxeEditRouting extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit-routing.txt";

    // C++ mangled-name substrings (case-insensitive) that hint at the
    // routing-edit code path. Cast a wide net — Fractal's class names
    // could use any of these conventions.
    private static final String[] SYMBOL_PATTERNS = {
        // Routing concepts
        "routing", "route", "router",
        "cable", "connect", "disconnect",
        "edge", "wire", "link",
        // Grid / cell terminology
        "gridcell", "grid_cell", "cell_route", "cellroute",
        "set_grid", "setgrid",
        "input_mask", "inputmask", "feedfrom", "feed_from",
        // Generic encoder / message-builder patterns
        "writerouting", "write_routing",
        "tosysex", "to_sysex", "buildsysex", "build_sysex",
        "encoderoute", "encode_route",
        "msg_set", "messageset",
        // Click-to-connect UI hooks
        "onconnect", "on_connect", "clickconnect", "click_connect",
        "addcable", "add_cable",
        "togglerouting", "toggle_routing",
        // Generic Axe-Fx II / Fractal class hints
        "axefx", "axe_fx", "fractalbot", "fractal_bot",
    };

    // SysEx envelope bytes. Axe-Fx II model is 0x07.
    // Wide search: F0 00 01 74 (start + Fractal manufacturer ID).
    // Narrow search: F0 00 01 74 07 06 (the routing-write header).
    private static final byte[] SYSEX_WIDE    = { (byte)0xF0, 0x00, 0x01, 0x74 };
    private static final byte[] SYSEX_AXEFX2  = { (byte)0xF0, 0x00, 0x01, 0x74, 0x07 };
    private static final byte[] ROUTING_HDR   = { (byte)0xF0, 0x00, 0x01, 0x74, 0x07, 0x06 };

    // Also useful: byte-search for the standalone 0x06 in code (might be
    // assembled into a buffer separately from the envelope).
    // We also look for 0x07 (model byte) constants since Axe-Fx II is the
    // only Fractal device that uses this model byte.
    private static final byte FN_ROUTING  = 0x06;
    private static final byte MODEL_AXEFX2 = 0x07;

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

        Map<Address, Function> priority = new TreeMap<>();
        Map<Address, Function> toDecompile = new TreeMap<>();

        w("================================================================================");
        w("AxeEdit RE - FindAxeEditRouting.java");
        w("Target: function 0x06 (routing-write) on Axe-Fx II XL+ (model byte 0x07)");
        w("Confirmed Session 68 via click-to-connect ACK F0 00 01 74 07 64 06 00 60 F7");
        w("================================================================================");

        // ---- 1. Symbol-table walk ----
        w("\n## Symbol-table matches (case-insensitive substring on full symbol name)");
        SymbolIterator allSyms = symTbl.getAllSymbols(true);
        int symCount = 0;
        int symMatches = 0;
        while (allSyms.hasNext()) {
            Symbol s = allSyms.next();
            symCount++;
            String nm = s.getName(true).toLowerCase();
            for (String p : SYMBOL_PATTERNS) {
                if (nm.contains(p)) {
                    symMatches++;
                    Address addr = s.getAddress();
                    Function f = funcMgr.getFunctionContaining(addr);
                    String fnInfo = f == null ? "(not in function)" : "func=" + f.getName() + " @ " + f.getEntryPoint();
                    w("  [" + p + "]  " + s.getName(true) + " @ " + addr + "  " + fnInfo);
                    if (f != null && !priority.containsKey(f.getEntryPoint()))
                        priority.put(f.getEntryPoint(), f);
                    break;
                }
            }
        }
        w("  (scanned " + symCount + " symbols, " + symMatches + " matches)");

        // ---- 2a. Byte-pattern search: full routing header ----
        w("\n## Byte-pattern search: F0 00 01 74 07 06 (routing-write full header) — HIGHEST SIGNAL");
        List<Address> routingHits = findBytePattern(ROUTING_HDR, 50);
        w("  hits: " + routingHits.size());
        for (Address h : routingHits) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            // These are CRITICAL — full-header hits are the routing builder.
            // Add to priority so they're guaranteed decompiled even past the cap.
            if (f != null && !priority.containsKey(f.getEntryPoint()))
                priority.put(f.getEntryPoint(), f);
        }

        // ---- 2b. Byte-pattern: Axe-Fx II envelope without function byte ----
        // Catches builders that assemble the envelope first then append the function byte.
        w("\n## Byte-pattern search: F0 00 01 74 07 (Axe-Fx II envelope, any function)");
        List<Address> axefxHits = findBytePattern(SYSEX_AXEFX2, 80);
        w("  hits: " + axefxHits.size());
        for (Address h : axefxHits) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            if (f != null && !toDecompile.containsKey(f.getEntryPoint()))
                toDecompile.put(f.getEntryPoint(), f);
        }

        // ---- 2c. Byte-pattern: shorter envelope ----
        w("\n## Byte-pattern search: F0 00 01 74 (any Fractal SysEx)");
        List<Address> fractalHits = findBytePattern(SYSEX_WIDE, 100);
        w("  hits: " + fractalHits.size());
        for (Address h : fractalHits) {
            Function f = funcMgr.getFunctionContaining(h);
            if (f == null) continue;
            String fname = f.getName();
            w("    " + h + "  func=" + fname);
            if (!toDecompile.containsKey(f.getEntryPoint()))
                toDecompile.put(f.getEntryPoint(), f);
        }

        // ---- 3. Walk all instructions, find ones using literal 0x06 + 0x07 together ----
        // A routing-builder function likely writes both 0x07 (model) and 0x06 (fn)
        // as immediate values, possibly in adjacent stores. We can't easily detect
        // adjacency, but functions that emit both as immediates within their body
        // are strong candidates.
        w("\n## Instructions using immediate value 0x06 (routing function byte)");
        InstructionIterator allIns = listing.getInstructions(true);
        int insMatches = 0;
        Map<Address, Integer> funcImm06Count = new HashMap<>();
        Map<Address, Integer> funcImm07Count = new HashMap<>();
        while (allIns.hasNext()) {
            Instruction ins = allIns.next();
            Function f = funcMgr.getFunctionContaining(ins.getAddress());
            if (f == null) continue;
            for (int op = 0; op < ins.getNumOperands(); op++) {
                Object[] objs = ins.getOpObjects(op);
                for (Object o : objs) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar) o).getUnsignedValue();
                        if (v == 0x06) {
                            funcImm06Count.merge(f.getEntryPoint(), 1, Integer::sum);
                            insMatches++;
                        } else if (v == 0x07) {
                            funcImm07Count.merge(f.getEntryPoint(), 1, Integer::sum);
                        }
                    }
                }
            }
        }

        // Cross-reference: functions that emit BOTH 0x06 and 0x07 immediates are
        // the most-likely routing-builders.
        w("\n## Functions emitting BOTH 0x06 AND 0x07 immediates (likely routing-builders)");
        Set<Address> bothImms = new HashSet<>(funcImm06Count.keySet());
        bothImms.retainAll(funcImm07Count.keySet());
        for (Address fa : bothImms) {
            Function f = funcMgr.getFunctionAt(fa);
            if (f == null) continue;
            int c06 = funcImm06Count.getOrDefault(fa, 0);
            int c07 = funcImm07Count.getOrDefault(fa, 0);
            w("  " + f.getName() + " @ " + fa + "  0x06=" + c06 + ", 0x07=" + c07);
            if (!priority.containsKey(fa)) priority.put(fa, f);
        }
        w("  (total instructions with imm 0x06: " + insMatches + "; functions emitting both 0x06+0x07: " + bothImms.size() + ")");

        // ---- 4. 1-level callees of priority functions ----
        w("\n## Adding 1-level callees of priority functions");
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

        // Build final list.
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
