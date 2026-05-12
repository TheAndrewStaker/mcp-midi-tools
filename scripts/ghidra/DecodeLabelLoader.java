// DecodeLabelLoader.java — Ghidra GhidraScript
//
// Goal (Session 46 cont 2 follow-up): decompile AM4-Edit's UI-knob-label
// loader and the inner functions that produce display labels like
// "Treble" / "High Treble" from symbolic IDs like DISTORT_TREBLE.
//
// WinDbg (2026-05-03) pinned the loader entry at runtime VA
//   AM4_Edit + 0x18fe59
// with a body cluster at +0x18d000..+0x190000. The live symbolic-ID
// .rdata pool is at RVA 0x6a8aa8. AM4-Edit's preferred ImageBase is
// 0x140000000, so in Ghidra:
//   loader entry        = 0x14018fe59
//   body cluster        = 0x14018d000 .. 0x140190000
//   symbolic-ID pool    = 0x1406a8aa8
//
// Win32 LoadStringA / .rsrc hypothesis was disproven — labels do NOT
// go through Win32 string-resource APIs. So this script does not chase
// imports; it walks the call tree of the pinned loader and dumps:
//   1. The loader function's decompilation.
//   2. Each callee whose entry is inside the body cluster — full
//      decompilation.
//   3. Depth-1 callees outside the cluster (likely helpers like a
//      string constructor / hash / memcpy) — decompiled as well, but
//      not their callees, to keep output bounded.
//   4. Every data reference inside those functions, with the .rdata
//      target's nearby bytes (±64) when the target lands in .rdata.
//   5. A hex window around the symbolic-ID pool, plus any *other*
//      .rdata table the loader reads from — that second table is the
//      most likely home of the display labels.
//
// Output: samples\captured\decoded\ghidra-label-loader.txt
//
// How to run (GUI):
//   1. Open project C:\Users\Steph\ghidra-am4-edit.gpr in Ghidra.
//      Open the AM4-Edit.exe program inside it.
//   2. Window -> Script Manager -> Manage Script Directories ->
//      add C:\dev\mcp-midi-tools\scripts\ghidra (if not present).
//   3. Find DecodeLabelLoader -> Run.
//
// How to run (headless — preferred, no GUI clicks):
//   See scripts\ghidra\run-decode-label-loader.cmd in this repo.
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressFactory;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DecodeLabelLoader extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-label-loader.txt";

    // All addresses below are post-ImageBase (Ghidra-style), assuming
    // ImageBase = 0x140000000. We resolve them at runtime against the
    // current program's image base in case Ghidra rebased.
    private static final long LOADER_OFFSET    = 0x18fe59L;
    private static final long CLUSTER_LO_OFF   = 0x18d000L;
    private static final long CLUSTER_HI_OFF   = 0x190000L;
    private static final long SYMID_POOL_OFF   = 0x6a8aa8L;

    // Cap on bytes shown around each .rdata target hit.
    private static final int  RDATA_WINDOW = 64;

    // Depth-1 callee cap to keep output bounded if a helper is hit by
    // many callers in the cluster.
    private static final int  MAX_DEPTH1_OUTSIDE = 12;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private Listing listing;
    private Memory memory;
    private DecompInterface decomp;

    private Address imageBase;
    private Address loaderEntry;
    private Address clusterLo;
    private Address clusterHi;
    private Address symIdPool;

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private static String hex(long v) { return "0x" + Long.toHexString(v); }

    private boolean inCluster(Address a) {
        if (a == null) return false;
        return a.compareTo(clusterLo) >= 0 && a.compareTo(clusterHi) < 0;
    }

    private MemoryBlock blockOf(Address a) {
        return a == null ? null : memory.getBlock(a);
    }

    private String blockNameOf(Address a) {
        MemoryBlock b = blockOf(a);
        return b == null ? "?" : b.getName();
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    private List<Address> dataRefsFrom(Function f) {
        List<Address> out = new ArrayList<>();
        if (f == null) return out;
        InstructionIterator it = listing.getInstructions(f.getBody(), true);
        while (it.hasNext()) {
            Instruction insn = it.next();
            for (Reference r : insn.getReferencesFrom()) {
                if (r.getReferenceType().isData()) {
                    out.add(r.getToAddress());
                }
            }
        }
        return out;
    }

    private Set<Function> calleesOf(Function f) {
        Set<Function> out = new LinkedHashSet<>();
        if (f == null) return out;
        InstructionIterator it = listing.getInstructions(f.getBody(), true);
        while (it.hasNext()) {
            Instruction insn = it.next();
            if (!insn.getFlowType().isCall()) continue;
            for (Reference r : insn.getReferencesFrom()) {
                if (!r.getReferenceType().isCall()) continue;
                Function callee = funcMgr.getFunctionAt(r.getToAddress());
                if (callee == null) callee = funcMgr.getFunctionContaining(r.getToAddress());
                if (callee != null) out.add(callee);
            }
        }
        return out;
    }

    private String hexDump(Address start, int length) {
        StringBuilder sb = new StringBuilder();
        byte[] buf = new byte[length];
        try {
            int n = memory.getBytes(start, buf);
            for (int i = 0; i < n; i += 16) {
                sb.append(String.format("    %s  ", start.add(i)));
                StringBuilder ascii = new StringBuilder();
                for (int j = 0; j < 16 && i + j < n; j++) {
                    int b = buf[i + j] & 0xff;
                    sb.append(String.format("%02x ", b));
                    ascii.append((b >= 0x20 && b < 0x7f) ? (char) b : '.');
                }
                sb.append("  |").append(ascii).append("|\n");
            }
        } catch (MemoryAccessException e) {
            sb.append("    (read failed: ").append(e.getMessage()).append(")\n");
        }
        return sb.toString();
    }

    @Override
    public void run() throws Exception {
        program     = currentProgram;
        funcMgr     = program.getFunctionManager();
        refMgr      = program.getReferenceManager();
        listing     = program.getListing();
        memory      = program.getMemory();
        decomp      = new DecompInterface();
        decomp.openProgram(program);

        imageBase   = program.getImageBase();
        AddressFactory af = program.getAddressFactory();
        loaderEntry = imageBase.add(LOADER_OFFSET);
        clusterLo   = imageBase.add(CLUSTER_LO_OFF);
        clusterHi   = imageBase.add(CLUSTER_HI_OFF);
        symIdPool   = imageBase.add(SYMID_POOL_OFF);

        w("================================================================================");
        w("AM4-Edit RE — DecodeLabelLoader");
        w("  imageBase    = " + imageBase);
        w("  loaderEntry  = " + loaderEntry);
        w("  cluster      = " + clusterLo + " .. " + clusterHi);
        w("  symIdPool    = " + symIdPool);
        w("================================================================================");

        // ----- 1. Resolve the loader function ---------------------------------
        Function loader = funcMgr.getFunctionAt(loaderEntry);
        boolean exactEntry = loader != null;
        if (loader == null) loader = funcMgr.getFunctionContaining(loaderEntry);
        if (loader == null) {
            w("\nFATAL: no function at or containing " + loaderEntry +
              "  -- run auto-analysis first, or the address is mid-data.");
        } else {
            w("\nLoader function:");
            w("  name        : " + loader.getName());
            w("  entry       : " + loader.getEntryPoint() +
              (exactEntry ? "  (exact match)" : "  (loaderEntry was inside body)"));
            w("  body        : " + loader.getBody().getMinAddress() +
              " .. " + loader.getBody().getMaxAddress());
            w("  param count : " + loader.getParameterCount());
            w("  signature   : " + loader.getSignature());
        }

        // ----- 2. Walk callees ------------------------------------------------
        // Cluster set = loader + everything it calls that lives inside the
        // pinned body cluster, transitively. Outside-cluster set = depth-1
        // callees that fall outside the cluster (helpers).
        Set<Function> clusterSet = new LinkedHashSet<>();
        Set<Function> outsideSet = new LinkedHashSet<>();
        if (loader != null) {
            Deque<Function> stack = new ArrayDeque<>();
            stack.push(loader);
            clusterSet.add(loader);
            while (!stack.isEmpty()) {
                Function f = stack.pop();
                for (Function c : calleesOf(f)) {
                    if (inCluster(c.getEntryPoint())) {
                        if (clusterSet.add(c)) stack.push(c);
                    } else {
                        outsideSet.add(c);
                    }
                }
            }
        }
        w("\nCall-tree summary:");
        w("  in-cluster funcs : " + clusterSet.size());
        w("  depth-1 outside  : " + outsideSet.size() +
            " (will decompile up to " + MAX_DEPTH1_OUTSIDE + ")");

        // ----- 3. Decompile cluster funcs ------------------------------------
        w("\n================================================================================");
        w("CLUSTER FUNCTIONS (loader + transitive in-cluster callees)");
        w("================================================================================");
        Set<Address> seenDataTargets = new LinkedHashSet<>();
        for (Function f : clusterSet) {
            w("\n----- " + f.getName() + " @ " + f.getEntryPoint() +
              "  (block " + blockNameOf(f.getEntryPoint()) + ") -----");
            w("  signature : " + f.getSignature());
            w("  body      : " + f.getBody().getMinAddress() +
              " .. " + f.getBody().getMaxAddress());

            // Data refs from this function — the data targets are where
            // the labels almost certainly live.
            List<Address> drefs = dataRefsFrom(f);
            w("  data refs : " + drefs.size());
            // Distinct, with block name.
            Map<Address, Integer> distinct = new LinkedHashMap<>();
            for (Address a : drefs) distinct.merge(a, 1, Integer::sum);
            int shown = 0;
            for (Map.Entry<Address, Integer> e : distinct.entrySet()) {
                Address a = e.getKey();
                seenDataTargets.add(a);
                w("    -> " + a + "  block=" + blockNameOf(a) + "  count=" + e.getValue());
                if (++shown >= 40) {
                    w("    (... " + (distinct.size() - shown) + " more distinct targets)");
                    break;
                }
            }

            w("\n  decompilation:");
            for (String line : decompile(f).split("\n")) w("    " + line);
        }

        // ----- 4. Decompile depth-1 outside callees --------------------------
        w("\n================================================================================");
        w("DEPTH-1 OUTSIDE-CLUSTER CALLEES (helpers — likely string ctor, hash, memcpy)");
        w("================================================================================");
        int decN = 0;
        for (Function f : outsideSet) {
            if (decN++ >= MAX_DEPTH1_OUTSIDE) {
                w("\n  (... " + (outsideSet.size() - MAX_DEPTH1_OUTSIDE) +
                  " more outside-cluster callees skipped)");
                break;
            }
            w("\n----- " + f.getName() + " @ " + f.getEntryPoint() +
              "  (block " + blockNameOf(f.getEntryPoint()) + ") -----");
            w("  signature : " + f.getSignature());
            w("\n  decompilation:");
            for (String line : decompile(f).split("\n")) w("    " + line);
        }

        // ----- 5. Hex windows around interesting data targets ----------------
        // Filter to .rdata targets only — any other section (data, text)
        // is unlikely to host display labels.
        w("\n================================================================================");
        w("HEX WINDOWS — .rdata targets the loader/cluster reads");
        w("================================================================================");

        // Always show the symbolic-ID pool window first.
        w("\n[symbolic-ID pool window @ " + symIdPool + "]");
        w(hexDump(symIdPool, 256));

        int windowCount = 0;
        for (Address a : seenDataTargets) {
            MemoryBlock b = blockOf(a);
            if (b == null) continue;
            String bn = b.getName().toLowerCase();
            if (!bn.contains("rdata") && !bn.contains(".data") && !bn.contains("data")) continue;
            // Skip the symbolic-ID pool itself (already shown).
            if (a.equals(symIdPool)) continue;
            // De-noise: keep windows reasonable in count.
            if (windowCount++ >= 20) {
                w("\n(... cap of 20 .rdata windows reached)");
                break;
            }
            Address start = a.subtract(Math.min(RDATA_WINDOW, (int)(a.getOffset() - imageBase.getOffset())));
            w("\n[target " + a + " in " + b.getName() + "]");
            w(hexDump(start, RDATA_WINDOW * 2));
        }

        // ----- 6. Memory map + .rdata block list -----------------------------
        w("\n================================================================================");
        w("MEMORY BLOCKS (for orientation)");
        w("================================================================================");
        for (MemoryBlock blk : memory.getBlocks()) {
            w(String.format("  %-12s  %s..%s  size=%d (%d KB)  perms=%s",
                blk.getName(),
                blk.getStart(), blk.getEnd(),
                blk.getSize(), blk.getSize() / 1024,
                (blk.isRead() ? "r" : "-") +
                (blk.isWrite() ? "w" : "-") +
                (blk.isExecute() ? "x" : "-")));
        }

        // ----- Write file ----------------------------------------------------
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        } catch (Exception e) {
            println("ERROR writing output: " + e.getMessage());
            return;
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
