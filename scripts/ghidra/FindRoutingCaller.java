// FindRoutingCaller.java — find AxeEdit's caller of FUN_0055d2e0 that passes 0x06.
//
// Established Session 68:
//   FUN_0055d2e0(buf, functionByte, modelByte) — SysEx envelope builder.
//   FUN_0055d7a0(buf, payloadPtr, payloadLen, functionByte) — generic
//     "build envelope + append payload" wrapper (calls FUN_0055d2e0).
//   FUN_0055d100 — send-wrapper that computes XOR-and-0x7F checksum.
//
// The routing-write builder must call FUN_0055d2e0 (or FUN_0055d7a0) with
// the function byte arg = 0x06. This script:
//   1. Finds every xref to FUN_0055d2e0 + FUN_0055d7a0.
//   2. For each call site, scans the preceding ~20 instructions for
//      an immediate value of 6 being loaded into a register or pushed.
//   3. Reports + decompiles each matching caller function.
//
// On x86 __fastcall:
//   - FUN_0055d2e0(param_1=ECX, param_2=DL, param_3=stack)
//     The function byte (param_2) lives in EDX/DL → look for "mov dl, 6"
//     or "mov edx, 6" before the call.
//   - FUN_0055d7a0(param_1=ECX, param_2=EDX, param_3=stack, param_4=stack)
//     The function byte (param_4) is the 4th arg → look for "push 6"
//     before the call.
//
// We scan for ANY use of immediate 0x06 within the call-site window, so
// we catch both calling conventions plus inlined/optimized variants.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-routing-caller.txt
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
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class FindRoutingCaller extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-routing-caller.txt";

    // Envelope-builder functions found in the previous pass. Any caller
    // passing 0x06 to one of these is the routing-write builder.
    private static final long[] ENVELOPE_FUNCS = {
        0x0055d2e0L,  // FUN_0055d2e0 — direct envelope builder
        0x0055d7a0L,  // FUN_0055d7a0 — wrapper (build + append payload)
        0x0055d100L,  // FUN_0055d100 — send-wrapper (cs computation)
        0x0055ce90L,  // FUN_0055ce90 — another wrapper found in xrefs
    };

    // How many instructions to look back from the call site for an
    // immediate value of 0x06. 20 is generous; routing-builder code that
    // sets up the call should be within a few instructions.
    private static final int LOOKBACK_INSTRUCTIONS = 20;

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

    /** Returns true if any instruction in the window preceding `callSite`
     *  has an immediate operand equal to `imm`. Walks backwards up to
     *  `windowInsns` instructions or until the start of the containing
     *  function, whichever comes first. */
    private boolean hasImmediateBefore(Address callSite, long imm, int windowInsns, Listing listing, FunctionManager funcMgr) {
        Function containing = funcMgr.getFunctionContaining(callSite);
        if (containing == null) return false;
        Address fnStart = containing.getEntryPoint();

        // Walk backwards
        Instruction ins = listing.getInstructionAt(callSite);
        if (ins == null) ins = listing.getInstructionContaining(callSite);
        if (ins == null) return false;

        for (int i = 0; i < windowInsns; i++) {
            ins = ins.getPrevious();
            if (ins == null) break;
            if (ins.getAddress().compareTo(fnStart) < 0) break;
            for (int op = 0; op < ins.getNumOperands(); op++) {
                Object[] objs = ins.getOpObjects(op);
                for (Object o : objs) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar) o).getUnsignedValue();
                        if (v == imm) return true;
                    }
                }
            }
        }
        return false;
    }

    @Override
    public void run() throws Exception {
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        ReferenceManager refMgr = currentProgram.getReferenceManager();
        Listing listing = currentProgram.getListing();
        decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        w("================================================================================");
        w("AxeEdit RE - FindRoutingCaller.java");
        w("Goal: find caller of FUN_0055d2e0 / FUN_0055d7a0 / etc. that passes 0x06");
        w("================================================================================");

        Set<Address> matchedCallers = new LinkedHashSet<>();
        Map<Address, List<Address>> callSitesByFunc = new LinkedHashMap<>();

        for (long envAddr : ENVELOPE_FUNCS) {
            Address fa = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(envAddr);
            Function envelope = funcMgr.getFunctionAt(fa);
            if (envelope == null) {
                w("\n!! envelope function FUN_" + Long.toHexString(envAddr) + " not found");
                continue;
            }
            w("\n## Scanning callers of " + envelope.getName() + " @ " + fa);
            int totalCallers = 0;
            int matchingCallers = 0;
            for (Reference r : refMgr.getReferencesTo(envelope.getEntryPoint())) {
                Address callSite = r.getFromAddress();
                Function caller = funcMgr.getFunctionContaining(callSite);
                if (caller == null) continue;
                totalCallers++;
                if (hasImmediateBefore(callSite, 0x06, LOOKBACK_INSTRUCTIONS, listing, funcMgr)) {
                    matchingCallers++;
                    if (matchedCallers.add(caller.getEntryPoint())) {
                        w("  MATCH: " + caller.getName() + " @ " + caller.getEntryPoint()
                          + "  call site=" + callSite);
                    } else {
                        w("  (also matches at call site=" + callSite + ")");
                    }
                    callSitesByFunc.computeIfAbsent(caller.getEntryPoint(), k -> new ArrayList<>()).add(callSite);
                }
            }
            w("  (callers scanned: " + totalCallers + ", with 0x06 in window: " + matchingCallers + ")");
        }

        // Also check if any of those matched functions has "0x07" in the same
        // window — that'd be the model byte (Axe-Fx II), boosting confidence
        // it's truly the routing-write call (vs e.g. a SET_PARAM with
        // unrelated value=6).
        w("\n## Decompiling " + matchedCallers.size() + " matched caller functions");

        for (Address fa : matchedCallers) {
            Function f = funcMgr.getFunctionAt(fa);
            if (f == null) continue;
            List<Address> sites = callSitesByFunc.get(fa);
            w("\n################################################################################");
            w("# " + f.getName() + " @ " + fa);
            w("# parent namespace: " + f.getParentNamespace());
            w("# signature: " + f.getSignature());
            w("# call sites with 0x06 preceding: " + sites);
            // Check if 0x07 is also in window — strong indicator of Axe-Fx II routing
            boolean has07 = false;
            for (Address site : sites) {
                if (hasImmediateBefore(site, 0x07, LOOKBACK_INSTRUCTIONS, listing, funcMgr)) {
                    has07 = true;
                    break;
                }
            }
            if (has07) {
                w("# *** ALSO has 0x07 (model byte) in window — high confidence routing builder ***");
            }
            w("################################################################################");
            w(decompile(f));
        }

        if (matchedCallers.isEmpty()) {
            w("\n!! No callers found with 0x06 in the preceding " + LOOKBACK_INSTRUCTIONS + " instructions.");
            w("!! Possible reasons:");
            w("!!   1. The function byte is loaded from a struct field, not an immediate.");
            w("!!      In that case, the routing builder loads 0x06 into a struct earlier");
            w("!!      and the call site just dereferences. Try widening LOOKBACK_INSTRUCTIONS,");
            w("!!      or scanning for stores of 0x06 into stack slots.");
            w("!!   2. AxeEdit might use a different envelope-builder path entirely.");
            w("!!      Try scanning for ALL functions that contain 'mov [...], 0x06' followed");
            w("!!      by a call within ~30 instructions.");
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
