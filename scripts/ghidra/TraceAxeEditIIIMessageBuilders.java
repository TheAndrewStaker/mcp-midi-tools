// TraceAxeEditIIIMessageBuilders.java — Ghidra GhidraScript
//
// MineAxeEditIIIv2.java identified the III's generic SysEx message
// builders — functions that take a `function byte` as a parameter and
// emit a Fractal SysEx envelope (F0 00 01 74 <model> <fn> ... F7).
//
// From v2 dump analysis:
//
//   FUN_14014d2a0 — hardcoded fn=0x77 (preset-store HEADER)
//   FUN_1403396c0 — fn=0x00 (or set elsewhere)
//   FUN_14033de60 — special, only 4 bytes
//   FUN_1403430d0 — fn=0x00 (or set elsewhere)
//   FUN_1403434b0 — GENERIC: takes (param_3=model, param_2=fn) ← key
//   FUN_1403437d0 — GENERIC: takes (param_5=model, local_88=fn)
//
// FUN_1403434b0 is the most useful generic message builder. Every
// caller passes a specific fn byte for the SysEx message it wants to
// build. By walking up to its callers and decompiling each, we get
// the complete set of fn bytes AxeEdit III sends — including the
// undocumented ones (DSP_MESSAGE, EFFECT_DUMP, FOOTSWITCH_*, etc.).
//
// This script:
//   1. Walks callers of FUN_1403434b0 and FUN_1403437d0
//   2. Decompiles each caller (the per-function message wrappers)
//   3. Looks for constant fn bytes in each caller's body
//
// Also: walks callers of FUN_14014d2a0 (the 0x77 preset-header
// emitter) to find which higher-level code initiates a preset save.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-message-builders.txt
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class TraceAxeEditIIIMessageBuilders extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-message-builders.txt";

    // Generic SysEx envelope builders. Each takes (model, fn) as args
    // and writes F0 00 01 74 <model> <fn> [payload] <cs> F7.
    private static final long[] GENERIC_BUILDERS = {
        0x1403434b0L,  // FUN_1403434b0 — generic, args (param_3=model, param_2=fn)
        0x1403437d0L,  // FUN_1403437d0 — generic, args (param_5=model, local_88=fn)
    };

    // Fixed-function builders. Each has a hardcoded fn byte. Tracing
    // their callers shows where in AxeEdit each protocol opcode is
    // triggered from.
    private static final long[][] FIXED_BUILDERS = {
        { 0x14014d2a0L, 0x77 }, // preset-store HEADER (confirmed via local_43 = 0x77)
        // FUN_1403396c0, FUN_14033de60, FUN_1403430d0 may also have
        // hardcoded fns — add them here once decoded.
    };

    private static final int MAX_CALLERS_PER_BUILDER = 60;
    private static final int MAX_CALLERS_TO_DECOMPILE = 30;

    private final List<String> lines = new ArrayList<>();
    private DecompInterface decomp;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private final Set<Address> alreadyDecompiled = new HashSet<>();

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    @Override
    public void run() throws Exception {
        Program program = currentProgram;
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        decomp = new DecompInterface();
        decomp.openProgram(program);
        var as = program.getAddressFactory().getDefaultAddressSpace();

        w("================================================================================");
        w("Axe-Edit III RE — TraceAxeEditIIIMessageBuilders.java");
        w("  Trace callers of generic SysEx message builders to enumerate");
        w("  every function byte AxeEdit III sends.");
        w("================================================================================");

        for (long addr : GENERIC_BUILDERS) {
            Address ba = as.getAddress(addr);
            Function builder = funcMgr.getFunctionAt(ba);
            if (builder == null) {
                w("\n!! Generic builder FUN_" + Long.toHexString(addr) + " not found");
                continue;
            }
            w("\n");
            w("################################################################################");
            w("## GENERIC BUILDER: " + builder.getName() + " @ " + builder.getEntryPoint());
            w("##   Signature: " + builder.getSignature());
            w("################################################################################");

            // Find unique caller functions.
            Set<Function> callers = new LinkedHashSet<>();
            for (Reference r : refMgr.getReferencesTo(builder.getEntryPoint())) {
                Function c = funcMgr.getFunctionContaining(r.getFromAddress());
                if (c != null) callers.add(c);
                if (callers.size() >= MAX_CALLERS_PER_BUILDER) break;
            }
            w("Found " + callers.size() + " caller function(s)");

            // List them first (compact)
            int idx = 0;
            for (Function c : callers) {
                w("  " + (++idx) + ". " + c.getName() + " @ " + c.getEntryPoint());
            }

            // Then decompile up to MAX_CALLERS_TO_DECOMPILE
            int decompiled = 0;
            for (Function c : callers) {
                if (decompiled >= MAX_CALLERS_TO_DECOMPILE) {
                    w("\n  (capping decompile at " + MAX_CALLERS_TO_DECOMPILE
                        + "; " + (callers.size() - decompiled) + " more callers not dumped)");
                    break;
                }
                if (!alreadyDecompiled.add(c.getEntryPoint())) continue;
                w("");
                w("  ----- CALLER: " + c.getName() + " @ " + c.getEntryPoint() + " -----");
                w("  signature: " + c.getSignature());
                String body = decompile(c);
                for (String line : body.split("\n")) w("    " + line);
                decompiled++;
            }
        }

        // Fixed-fn builders
        for (long[] pair : FIXED_BUILDERS) {
            long addr = pair[0];
            long fn = pair[1];
            Address ba = as.getAddress(addr);
            Function builder = funcMgr.getFunctionAt(ba);
            if (builder == null) continue;
            w("\n");
            w("################################################################################");
            w("## FIXED-FN BUILDER: " + builder.getName()
                + " @ " + builder.getEntryPoint()
                + "  (fn=0x" + Long.toHexString(fn) + ")");
            w("##   Signature: " + builder.getSignature());
            w("################################################################################");

            Set<Function> callers = new LinkedHashSet<>();
            for (Reference r : refMgr.getReferencesTo(builder.getEntryPoint())) {
                Function c = funcMgr.getFunctionContaining(r.getFromAddress());
                if (c != null) callers.add(c);
                if (callers.size() >= MAX_CALLERS_PER_BUILDER) break;
            }
            w("Found " + callers.size() + " caller function(s)");
            int idx = 0;
            for (Function c : callers) {
                w("  " + (++idx) + ". " + c.getName() + " @ " + c.getEntryPoint());
            }
            // Decompile only the first 5 since fn is already known
            int decompiled = 0;
            for (Function c : callers) {
                if (decompiled >= 5) break;
                if (!alreadyDecompiled.add(c.getEntryPoint())) continue;
                w("");
                w("  ----- CALLER: " + c.getName() + " @ " + c.getEntryPoint() + " -----");
                w("  signature: " + c.getSignature());
                String body = decompile(c);
                for (String line : body.split("\n")) w("    " + line);
                decompiled++;
            }
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
