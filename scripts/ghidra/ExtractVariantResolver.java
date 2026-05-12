// ExtractVariantResolver.java — Ghidra GhidraScript
//
// Goal: extract the variant→cache_id resolver from AM4-Edit.exe.
//
// Anchor: cont 3's loader trace identified FUN_14018ddf0 as the "page
// processor" that walks <Page> elements per <EffectVariant>. At line
// equivalent to 1796 in the existing decompilation it makes an indirect
// vtable call:
//
//     iVar8 = (**(code **)(*param_1 + 0x10))(param_1, effectType, &paramName);
//
// That vtable[2] method (`*(this->vtable + 0x10)`) is the resolver — given
// (effectType, parameterName) it returns the cache_id (or -1 if not bound).
// Once decompiled it should reveal either (a) a per-block static table or
// (b) a dispatch-by-effectType switch into per-block resolvers, each with
// its own table.
//
// Strategy:
//   1. Decompile FUN_14018ddf0 (the call site) — same as cont 3 but freshly
//      so any updated analysis is captured.
//   2. Decompile FUN_14018bf60 — the effect-name lookup at param_1+0x18.
//      Tells us the table-of-names format the registry uses; the
//      parameterName resolver likely uses the same shape.
//   3. Find every vtable in .rdata that has at least 5 function-pointer
//      slots, where slot 2 (offset 0x10) is a function in .text. For each:
//        - Decompile slot 2.
//        - Score it for "looks like a parameterName resolver" (calls
//          string-compare functions, takes (this, int, string&) shape,
//          contains many .rdata refs that look like parameterName strings
//          such as DISTORT_*, FUZZ_*, REVERB_*).
//   4. Top-scoring vtable + slot-2 function: decompile fully, dump every
//      callee's signature + first 200 lines, dump every .rdata pointer it
//      references with a hex window.
//
// Output: samples/captured/decoded/ghidra-variant-resolver.txt
//
// How to run:
//   set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC
//   scripts\ghidra\run-extract-variant-resolver.cmd
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
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class ExtractVariantResolver extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-variant-resolver.txt";

    // Anchors from the existing label-loader trace.
    private static final long ADDR_PAGE_PROCESSOR = 0x14018ddf0L;  // FUN_14018ddf0
    private static final long ADDR_EFFECT_NAME_LOOKUP = 0x14018bf60L; // FUN_14018bf60
    private static final long ADDR_LOADER = 0x14018fbd0L;            // FUN_14018fbd0

    // Vtable scan parameters.
    private static final int  VTABLE_MIN_SLOTS = 5;
    private static final int  VTABLE_MAX_SLOTS = 32;
    private static final int  CANDIDATES_TO_DECOMPILE = 6;
    private static final int  CALLEE_DECOMPILE_LIMIT  = 12;
    private static final int  CALLEE_LINE_LIMIT       = 200;

    // Strings that, if referenced in a function's .rdata, score it as a
    // likely parameterName resolver. Mostly the well-known prefixes.
    private static final String[] RESOLVER_HINT_STRINGS = {
        "DISTORT_", "FUZZ_", "REVERB_", "DELAY_", "CHORUS_", "FLANGER_",
        "PHASER_", "WAH_", "COMP_", "TREMOLO_", "FILTER_", "GATE_",
        "ENHANCER_", "ROTARY_", "VOLUME_", "GEQ_", "PEQ_", "BLOCK_",
        "CABINET_", "OUTPUT_", "GLOBAL_", "INPUT_", "MULTITAP_",
        "PLEX_", "MEGATAP_",
    };

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private Memory memory;
    private FunctionManager funcMgr;
    private Listing listing;
    private DecompInterface decomp;

    private void w(String s) { lines.add(s); println(s); }
    private static String hex(long v) { return "0x" + Long.toHexString(v); }

    private String hexDump(Address at, int before, int after) {
        StringBuilder sb = new StringBuilder();
        long start = at.getOffset() - before;
        int total = before + after;
        byte[] buf = new byte[total];
        try {
            memory.getBytes(at.getNewAddress(start), buf);
        } catch (Exception e) {
            return "  <cannot read: " + e.getMessage() + ">";
        }
        for (int row = 0; row < total; row += 16) {
            sb.append(String.format("  %s:  ", hex(start + row)));
            StringBuilder ascii = new StringBuilder();
            for (int col = 0; col < 16 && row + col < total; col++) {
                int b = buf[row + col] & 0xff;
                sb.append(String.format("%02x ", b));
                ascii.append((b >= 0x20 && b < 0x7f) ? (char) b : '.');
            }
            sb.append(" ").append(ascii).append("\n");
        }
        return sb.toString();
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    /**
     * Read 8 bytes little-endian as an unsigned long.
     */
    private long readQword(Address at) {
        try {
            byte[] b = new byte[8];
            memory.getBytes(at, b);
            long v = 0;
            for (int i = 7; i >= 0; i--) v = (v << 8) | (b[i] & 0xffL);
            return v;
        } catch (Exception e) {
            return 0;
        }
    }

    private boolean isInTextBlock(Address a) {
        MemoryBlock blk = memory.getBlock(a);
        return blk != null && blk.getName().equals(".text") && blk.isExecute();
    }

    private boolean isInRdataBlock(Address a) {
        MemoryBlock blk = memory.getBlock(a);
        return blk != null && (blk.getName().equals(".rdata") || blk.getName().equals(".data"));
    }

    /**
     * Walk a memory block looking for vtables — runs of 8-byte pointers
     * that all point into .text. Returns the list of (vtable-base, slot-count)
     * pairs that have at least VTABLE_MIN_SLOTS function-pointer slots.
     */
    private List<long[]> scanVtables(MemoryBlock blk) {
        List<long[]> out = new ArrayList<>();
        long lo = blk.getStart().getOffset();
        long hi = blk.getEnd().getOffset();
        long cur = lo;
        while (cur + 8 <= hi) {
            // Skip if not 8-byte aligned (vtables typically are).
            if ((cur & 7) != 0) { cur++; continue; }
            int slots = 0;
            long probe = cur;
            while (probe + 8 <= hi && slots < VTABLE_MAX_SLOTS) {
                long ptr = readQword(blk.getStart().getNewAddress(probe));
                if (ptr == 0) break;
                Address pa;
                try { pa = blk.getStart().getNewAddress(ptr); } catch (Exception e) { break; }
                if (!isInTextBlock(pa)) break;
                slots++;
                probe += 8;
            }
            if (slots >= VTABLE_MIN_SLOTS) {
                out.add(new long[] { cur, slots });
                cur = probe;  // skip past the vtable we just identified
            } else {
                cur += 8;
            }
        }
        return out;
    }

    /**
     * Score a function for "looks like a parameterName resolver" by
     * decompiling and counting hint-string occurrences and string-compare-
     * function callees.
     */
    private int scoreResolverCandidate(Function f) {
        String src = decompile(f);
        if (src == null || src.startsWith("// decompile")) return 0;
        int score = 0;
        for (String hint : RESOLVER_HINT_STRINGS) {
            if (src.contains("\"" + hint)) score += 5;
        }
        // Bonus for taking 3 args (this, int, string&) shape.
        if (src.contains("undefined4 param_2") && src.contains("longlong param_3")) score += 2;
        if (src.contains("param_2") && src.contains("param_3")) score += 1;
        // Bonus for string-compare-style operations (memcmp, strcmp callees).
        if (src.contains("strcmp") || src.contains("memcmp")) score += 3;
        // Bonus for switch / case-like dispatch patterns.
        if (src.contains("switch") || src.contains("case ")) score += 2;
        return score;
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        memory = program.getMemory();
        funcMgr = program.getFunctionManager();
        listing = program.getListing();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("AM4-Edit RE — ExtractVariantResolver");
        w("  page-processor anchor:  FUN_14018ddf0  (vtable[2] indirect call site)");
        w("  effect-name lookup:     FUN_14018bf60  (param_1+0x18 table lookup)");
        w("  loader entry:           FUN_14018fbd0");
        w("================================================================================");

        // 1. Decompile the page-processor and the effect-name lookup.
        w("\n## Decompilation: FUN_14018ddf0 (page-processor; contains vtable[2] call)");
        Function pageProc = funcMgr.getFunctionAt(toAddr(ADDR_PAGE_PROCESSOR));
        w(decompile(pageProc));

        w("\n## Decompilation: FUN_14018bf60 (effect-name lookup at param_1+0x18)");
        Function effLookup = funcMgr.getFunctionAt(toAddr(ADDR_EFFECT_NAME_LOOKUP));
        w(decompile(effLookup));

        // 2. Scan .rdata for vtable candidates.
        w("\n## Scanning .rdata for vtable candidates (>= " + VTABLE_MIN_SLOTS + " slots) ...");
        List<long[]> candidates = new ArrayList<>();
        for (MemoryBlock blk : memory.getBlocks()) {
            if (!isInRdataBlock(blk.getStart())) continue;
            w("  scanning block " + blk.getName() + "  " + blk.getStart() + ".." + blk.getEnd());
            candidates.addAll(scanVtables(blk));
        }
        w("  total vtable candidates: " + candidates.size());

        // 3. Score each candidate by inspecting the function at slot 2.
        w("\n## Scoring each candidate's slot-2 function ...");
        List<long[]> ranked = new ArrayList<>();   // {vtable_addr, slots, slot2_fn, score}
        for (long[] vt : candidates) {
            long vtAddr = vt[0];
            int slots = (int) vt[1];
            long slot2Fn = readQword(toAddr(vtAddr + 0x10));
            if (slot2Fn == 0) continue;
            Function f = funcMgr.getFunctionAt(toAddr(slot2Fn));
            if (f == null) continue;
            int score = scoreResolverCandidate(f);
            if (score > 0) {
                ranked.add(new long[] { vtAddr, slots, slot2Fn, score });
            }
        }
        ranked.sort((a, b) -> Long.compare(b[3], a[3]));  // highest score first

        w("  top 20 candidates by score:");
        w("  " + String.format("%-18s %5s %5s %-18s", "vtable", "slots", "score", "slot2_fn"));
        int shown = 0;
        for (long[] c : ranked) {
            if (shown++ >= 20) break;
            w("  " + String.format("%-18s %5d %5d %-18s",
                hex(c[0]), c[1], c[3], hex(c[2])));
        }

        // 4. For top CANDIDATES_TO_DECOMPILE, dump full slot-2 decompilation
        // plus the vtable layout and surrounding context.
        w("\n================================================================================");
        w("Top " + Math.min(ranked.size(), CANDIDATES_TO_DECOMPILE) + " candidates — full detail");
        w("================================================================================");

        for (int i = 0; i < Math.min(ranked.size(), CANDIDATES_TO_DECOMPILE); i++) {
            long[] c = ranked.get(i);
            long vtAddr = c[0];
            int slots = (int) c[1];
            long slot2Fn = c[2];
            int score = (int) c[3];

            w("\n--------------------------------------------------------------------------------");
            w("# Candidate " + (i + 1) + "  vtable=" + hex(vtAddr) + "  slots=" + slots + "  score=" + score);
            w("--------------------------------------------------------------------------------");

            w("\n### Vtable layout:");
            for (int s = 0; s < slots; s++) {
                long ptr = readQword(toAddr(vtAddr + s * 8L));
                Function f = funcMgr.getFunctionAt(toAddr(ptr));
                String fname = f == null ? "<no fn>" : f.getName();
                w(String.format("  slot %2d  offset %#x  -> %s  (%s)", s, s * 8, hex(ptr), fname));
            }

            w("\n### Slot-2 (offset 0x10) decompilation:");
            Function slot2 = funcMgr.getFunctionAt(toAddr(slot2Fn));
            String src = decompile(slot2);
            w(src);

            w("\n### Vtable surrounding hex (±64 bytes):");
            w(hexDump(toAddr(vtAddr), 64, 64 + slots * 8));

            // Decompile each function called BY slot-2 (these may be the
            // per-block resolvers).
            w("\n### Slot-2 callees (first " + CALLEE_DECOMPILE_LIMIT + " unique):");
            Set<Address> callees = new LinkedHashSet<>();
            if (slot2 != null) {
                for (Function callee : slot2.getCalledFunctions(monitor)) {
                    callees.add(callee.getEntryPoint());
                    if (callees.size() >= CALLEE_DECOMPILE_LIMIT) break;
                }
            }
            int ci = 0;
            for (Address calleeAddr : callees) {
                if (ci++ >= CALLEE_DECOMPILE_LIMIT) break;
                Function callee = funcMgr.getFunctionAt(calleeAddr);
                if (callee == null) continue;
                w("\n  --- callee " + ci + ": " + callee.getName() + " @ " + calleeAddr + " ---");
                String calleeSrc = decompile(callee);
                String[] calleeLines = calleeSrc.split("\n");
                int show = Math.min(calleeLines.length, CALLEE_LINE_LIMIT);
                for (int li = 0; li < show; li++) {
                    w("  " + calleeLines[li]);
                }
                if (calleeLines.length > show) {
                    w("  // ... (" + (calleeLines.length - show) + " more lines)");
                }
            }
        }

        // 5. Extra: list every function in .text that references a STRING
        // matching one of the resolver hint prefixes — this gives an
        // alternative path even if the vtable scan misses.
        w("\n================================================================================");
        w("Bonus: functions referencing parameterName-prefix strings");
        w("================================================================================");
        // Heuristic: scan .rdata for short ASCII strings starting with hint
        // prefixes; their xrefs are likely the per-block resolvers.
        Set<Address> resolverFns = new LinkedHashSet<>();
        for (String hint : RESOLVER_HINT_STRINGS) {
            byte[] pat = hint.getBytes();
            Address from = memory.getAllInitializedAddressSet().getMinAddress();
            int found = 0;
            while (from != null && found < 20) {
                Address hit = memory.findBytes(from, pat, null, true, monitor);
                if (hit == null) break;
                if (isInRdataBlock(hit)) {
                    for (var ref : program.getReferenceManager().getReferencesTo(hit)) {
                        Function f = funcMgr.getFunctionContaining(ref.getFromAddress());
                        if (f != null) resolverFns.add(f.getEntryPoint());
                    }
                    found++;
                }
                from = hit.add(1);
            }
        }
        w("  unique referencing functions: " + resolverFns.size());
        int dumped = 0;
        for (Address fa : resolverFns) {
            if (dumped++ >= 8) break;
            Function f = funcMgr.getFunctionAt(fa);
            if (f == null) continue;
            w("\n--- " + f.getName() + " @ " + fa + " ---");
            String src = decompile(f);
            String[] sl = src.split("\n");
            int show = Math.min(sl.length, 80);
            for (int li = 0; li < show; li++) w("  " + sl[li]);
            if (sl.length > show) w("  // ... (" + (sl.length - show) + " more lines)");
        }

        dump();
    }

    private void dump() {
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        } catch (Exception e) {
            println("ERROR writing output: " + e.getMessage());
            return;
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
