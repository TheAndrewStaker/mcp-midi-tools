// FindAxeEditHeaderEmitters.java — focused follow-up to FindAxeEditRouting.java
//
// The previous run found two functions containing the literal Fractal SysEx
// envelope `F0 00 01 74`:
//   FUN_0055d2e0  (at code address 0055d336)
//   FUN_0055d940  (at code address 0055d98a)
//
// Both got cut off when the symbol-pattern match flooded the 250-function
// decompile cap with JUCE classes. This script decompiles ONLY these two
// (plus their direct callers, which are the per-function wrappers like
// "buildSetRoutingMessage" or "buildSetParamMessage").
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit-headers.txt
//
// @category AxeFxII

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class FindAxeEditHeaderEmitters extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit-headers.txt";

    // Two functions that contain literal F0 00 01 74 bytes — confirmed by
    // FindAxeEditRouting.java's byte-pattern search.
    private static final long[] TARGET_ADDRS = {
        0x0055d2e0L,
        0x0055d940L,
    };

    // For each target function, also decompile its direct callers (one level
    // up). The targets are likely envelope-emitters (write F0 00 01 74 [model]
    // [fn]); the callers are per-function wrappers (write the rest of the
    // payload before/after calling the emitter).
    private static final int MAX_CALLERS_PER_TARGET = 20;

    private final List<String> lines = new ArrayList<>();
    private DecompInterface decomp;

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
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        ReferenceManager refMgr = currentProgram.getReferenceManager();
        decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        w("================================================================================");
        w("AxeEdit RE - FindAxeEditHeaderEmitters.java (focused follow-up)");
        w("Decompiling two F0-00-01-74 byte-pattern hits + their direct callers.");
        w("================================================================================");

        Set<Address> decompiled = new HashSet<>();
        List<Function> order = new ArrayList<>();

        for (long addr : TARGET_ADDRS) {
            Address fa = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addr);
            Function target = funcMgr.getFunctionAt(fa);
            if (target == null) {
                w("\n!! target FUN_" + Long.toHexString(addr) + " not found (Ghidra didn't recognize a function at this address)");
                continue;
            }
            if (decompiled.add(target.getEntryPoint())) order.add(target);

            // Walk callers — every xref to the function's entry point.
            int callerCount = 0;
            for (Reference r : refMgr.getReferencesTo(target.getEntryPoint())) {
                Function caller = funcMgr.getFunctionContaining(r.getFromAddress());
                if (caller == null) continue;
                if (!decompiled.add(caller.getEntryPoint())) continue;
                order.add(caller);
                callerCount++;
                if (callerCount >= MAX_CALLERS_PER_TARGET) break;
            }
        }

        w("\nTotal functions to decompile: " + order.size()
          + " (targets=" + TARGET_ADDRS.length + ", callers up to "
          + MAX_CALLERS_PER_TARGET + "/target)");

        // Mark the two targets so they're easy to find in the output.
        Set<Long> targetSet = new HashSet<>();
        for (long a : TARGET_ADDRS) targetSet.add(a);

        for (Function f : order) {
            boolean isTarget = targetSet.contains(f.getEntryPoint().getOffset());
            w("\n################################################################################");
            w("# " + (isTarget ? "[TARGET — emits F0 00 01 74] " : "[CALLER] ")
              + f.getName() + " @ " + f.getEntryPoint());
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
