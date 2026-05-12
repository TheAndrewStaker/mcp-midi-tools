// FindParamTable.java — Ghidra GhidraScript
//
// Goal: locate AM4-Edit's static parameter metadata table(s). We expect
// either (a) a contiguous string array of enum values (e.g. all drive
// types) or (b) an array of structs like { name_ptr, pidHigh, scale, unit }.
//
// Strategy:
//   1. Byte-pattern search for a curated set of parameter/enum names
//      in BOTH ASCII and UTF-16LE (Qt/WinAPI apps frequently use UTF-16).
//   2. For each hit, scan ±256 bytes for OTHER hits from our list —
//      adjacency means a string array or metadata table.
//   3. For each hit, enumerate xrefs (instruction operands and data refs).
//   4. For any function that xrefs a clustered hit, decompile it — that
//      is likely the table-iteration / dropdown-populate code.
//   5. Hex-dump ±128 bytes around each clustered hit.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-paramtable.txt
//
// How to run:
//   1. Ghidra → Window → Script Manager → Manage Script Directories →
//      add C:\dev\mcp-midi-tools\scripts\ghidra if not already present.
//   2. Find FindParamTable in the list → Run. (Double-click or green arrow.)
//   3. When it finishes, send me the output file path.
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

import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class FindParamTable extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-paramtable.txt";

    // Curated needles. Expanded 2026-04-21 for BK-032 — every BG-documented
    // knob label we want to deduce without a hardware capture. Each must
    // live somewhere in .rdata if AM4-Edit binds labels to pidHighs at
    // compile time (already proven for "Gain"/"Bass"/"Master" at 50 hits
    // each, clustered at 0x140559b20).
    private static final String[] NEEDLES = {
        // Session 05 anchor — TS808 is pidHigh 8 on Drive, proven by wire.
        // Finding it here lets us validate any label→pidHigh extraction
        // technique against a known binding.
        "TS808",

        // Amp / drive / compressor shared knob labels.
        "Gain", "Bass", "Mid", "Treble", "Presence", "Master",
        "Depth", "Level", "Mix", "Drive", "Tone", "Rate", "Feedback",
        "Manual", "Order", "Tempo", "Threshold", "Ratio", "Attack",
        "Release", "Compression", "Dynamics", "Knee", "Knee Type",
        "Auto Makeup", "Detector", "Look Ahead", "Light Type",
        "Mid Frequency", "High Mid", "Low Cut", "High Cut", "Bass Focus",
        "Clip Type", "Clip Shape", "Bias", "Slew Rate", "Bass Response",
        "Dry Level", "Diode", "Bit Reduce", "Bit Reduction", "Sample Rate",

        // Reverb-block specific (BG §Reverb Basic Page + Spring section).
        "Time", "Size", "Predelay", "Pre Delay", "Pre-Delay",
        "Crossover", "Crossover Frequency", "Low Freq Time",
        "High Freq Time", "Early Level", "Late Level",
        "Number Of Springs", "Spring Tone", "Spring Drive", "Boiiinnng!",
        "Shimmer", "Shimmer Intensity", "Shift 1", "Shift 2",

        // Delay-block specific (BG §Delay Config Page).
        "Master Feedback", "Echo Pan", "Spread", "Right Post Delay",
        "Motor Speed", "Head 1 Time", "Head 2 Ratio",
        "L/R Time Ratio", "Number Of Taps", "Taps",
        "Start Freq", "Stop Freq", "Sweep Rate", "Sweep Phase",
        "Run", "Trigger Restart", "Crossfade Time",

        // Modulation blocks (chorus / flanger / phaser / tremolo).
        "Number Of Voices", "Voices", "Delay Time",
        "LFO Type", "LFO Phase", "LFO Duty Cycle", "LFO Quantize",
        "LFO Hicut", "Auto Depth", "Phase Reverse", "Thru-Zero",
        "VCR Type", "VCR Bias", "Exponent", "Astable Beta",
        "Feedback Point", "Minimum Frequency", "Maximum Frequency",
        "Minimum Time", "Maximum Time",

        // Wah / Filter / Gate / GEQ block-specific.
        "Frequency", "Resonance", "Min Freq", "Max Freq",
        "Band 1", "Band 2", "Band 3", "Band 4", "Band 5",
        "Band 6", "Band 7", "Band 8", "Band 9", "Band 10",
        "Hold Time",

        // Amp Advanced-page candidates (cross-reference our Session 29
        // cont 2 additions + remaining first-page amp candidates).
        "Out Boost", "Output Boost", "Out Boost Level", "Amp Section",
        "Tonestack Type", "Tonestack Location", "Master Vol Location",
        "Power Amp Modeling", "Supply Sag", "Preamp Sag",
        "Negative Feedback",

        // Block-type labels (not per-knob but useful for context).
        "Reverb", "Delay", "Chorus", "Phaser", "Tremolo", "Flanger",
        "Compressor", "Pitch", "Wah", "Filter", "Amp", "Cab",
        "Enhancer", "Gate", "Volume", "Pan", "Looper",

        // Reverb type variants.
        "Plate", "Hall", "Spring", "Room", "Cave", "Chamber",
        "Plex", "Plex Verb", "Shimmer Verb",

        // Delay type variants.
        "Digital", "Analog", "Tape", "Ping Pong", "Multi Tap",
        "Ducking", "Reverse", "Sweep", "Vintage Digital",
    };

    // When two needle hits are within this many bytes, flag as a cluster.
    private static final long CLUSTER_WINDOW = 256L;

    // Max functions to decompile (caps the output size).
    private static final int MAX_DECOMPILE = 40;

    // ±this many bytes hex-dumped around each clustered hit.
    private static final int HEX_DUMP_RADIUS = 128;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private Memory memory;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private Listing listing;
    private DecompInterface decomp;

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private List<Address> findAll(byte[] pat, int maxHits) throws Exception {
        List<Address> out = new ArrayList<>();
        AddressSetView init = memory.getAllInitializedAddressSet();
        Address cur = init.getMinAddress();
        Address end = init.getMaxAddress();
        while (cur != null && cur.compareTo(end) <= 0) {
            Address hit = memory.findBytes(cur, pat, null, true, monitor);
            if (hit == null) break;
            out.add(hit);
            cur = hit.add(1);
            if (out.size() >= maxHits) break;
        }
        return out;
    }

    private byte[] ascii(String s) {
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    private byte[] utf16le(String s) {
        byte[] src = s.getBytes(StandardCharsets.UTF_16LE);
        // Don't require terminator — we may match substrings inside larger strings.
        return src;
    }

    private String hex(long v) { return "0x" + Long.toHexString(v); }

    private String hexDump(Address at, int before, int after) {
        StringBuilder sb = new StringBuilder();
        long start = at.getOffset() - before;
        int total = before + after;
        byte[] buf = new byte[total];
        Address startAddr = at.getNewAddress(start);
        try {
            memory.getBytes(startAddr, buf);
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

    private List<Address> xrefsTo(Address target) {
        List<Address> out = new ArrayList<>();
        for (Reference r : refMgr.getReferencesTo(target)) {
            out.add(r.getFromAddress());
        }
        return out;
    }

    /**
     * Walk the program's instructions once and record every instruction
     * whose operand contains an address within the given range. Returns
     * a map: referenced-address → list-of-instruction-addresses.
     */
    private Map<Long, List<Address>> scanInstructionRefs(long lo, long hi) {
        Map<Long, List<Address>> map = new HashMap<>();
        InstructionIterator it = listing.getInstructions(true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            for (int op = 0; op < ins.getNumOperands(); op++) {
                for (Object o : ins.getOpObjects(op)) {
                    long v = -1;
                    if (o instanceof Address) v = ((Address) o).getOffset();
                    else if (o instanceof Scalar) v = ((Scalar) o).getUnsignedValue();
                    if (v >= lo && v <= hi) {
                        map.computeIfAbsent(v, k -> new ArrayList<>()).add(ins.getAddress());
                    }
                }
            }
        }
        return map;
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    private static class Hit {
        final String needle;
        final String encoding; // "ASCII" or "UTF-16LE"
        final Address addr;
        Hit(String needle, String enc, Address a) {
            this.needle = needle; this.encoding = enc; this.addr = a;
        }
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        memory = program.getMemory();
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        listing = program.getListing();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("AM4-Edit RE - FindParamTable.java");
        w("  needles: " + NEEDLES.length);
        w("  cluster window: " + CLUSTER_WINDOW + " bytes");
        w("================================================================================");

        // -------- 1. Find every occurrence of every needle ----------
        List<Hit> allHits = new ArrayList<>();
        w("\n## Search results");
        for (String n : NEEDLES) {
            List<Address> a = findAll(ascii(n), 50);
            List<Address> u = findAll(utf16le(n), 50);
            w(String.format("  %-14s  ASCII=%d  UTF-16LE=%d", n, a.size(), u.size()));
            for (Address x : a) allHits.add(new Hit(n, "ASCII", x));
            for (Address x : u) allHits.add(new Hit(n, "UTF-16LE", x));
        }
        w("  (total hits: " + allHits.size() + ")");

        if (allHits.isEmpty()) {
            w("\nNo hits for any needle — strings may be in an external .dat file,");
            w("in an encrypted resource, or obfuscated. List sibling files next to");
            w("AM4-Edit.exe in its install directory.");
            dump();
            return;
        }

        // -------- 2. Cluster hits by proximity ----------
        allHits.sort(Comparator.comparingLong(h -> h.addr.getOffset()));
        List<List<Hit>> clusters = new ArrayList<>();
        List<Hit> cur = new ArrayList<>();
        long lastAddr = -1;
        for (Hit h : allHits) {
            long a = h.addr.getOffset();
            if (lastAddr < 0 || a - lastAddr > CLUSTER_WINDOW) {
                if (!cur.isEmpty()) clusters.add(cur);
                cur = new ArrayList<>();
            }
            cur.add(h);
            lastAddr = a;
        }
        if (!cur.isEmpty()) clusters.add(cur);

        // Sort clusters by size (largest first) — those are the metadata tables.
        clusters.sort((x, y) -> y.size() - x.size());

        w("\n## Clusters (>=2 hits within " + CLUSTER_WINDOW + " bytes), largest first");
        w("  total clusters: " + clusters.size());
        int meaningfulClusters = 0;
        for (List<Hit> c : clusters) {
            if (c.size() < 2) break;
            meaningfulClusters++;
            long span = c.get(c.size() - 1).addr.getOffset() - c.get(0).addr.getOffset();
            Address first = c.get(0).addr;
            MemoryBlock blk = memory.getBlock(first);
            w(String.format("  [%d hits, span %d bytes]  first=%s  block=%s",
                c.size(), span, first, blk == null ? "?" : blk.getName()));
            for (Hit h : c) {
                w(String.format("    %s  [%s]  %s", h.addr, h.encoding, h.needle));
            }
        }
        w("  (meaningful clusters: " + meaningfulClusters + ")");

        // -------- 3. For top clusters, hex-dump + xref + instruction-scan ----------
        Set<Address> funcsToDecompile = new LinkedHashSet<>();

        int toShow = Math.min(meaningfulClusters, 5);
        w("\n## Detail on top " + toShow + " clusters");

        for (int ci = 0; ci < toShow; ci++) {
            List<Hit> c = clusters.get(ci);
            Address first = c.get(0).addr;
            Address last = c.get(c.size() - 1).addr;
            long lo = first.getOffset() - HEX_DUMP_RADIUS;
            long hi = last.getOffset() + HEX_DUMP_RADIUS;

            w("\n### Cluster " + (ci + 1) + ": " + first + " .. " + last);

            // Hex dump around each hit (skip duplicates by rounding to 16-byte lines).
            w("\n  HEX DUMP (±" + HEX_DUMP_RADIUS + " bytes around first and last hit):");
            w(hexDump(first, HEX_DUMP_RADIUS, HEX_DUMP_RADIUS));
            if (!first.equals(last)) {
                w(hexDump(last, HEX_DUMP_RADIUS, HEX_DUMP_RADIUS));
            }

            // Xrefs (both data and code refs).
            w("  DIRECT xrefs to each hit (via Ghidra reference manager):");
            for (Hit h : c) {
                List<Address> xrefs = xrefsTo(h.addr);
                if (xrefs.isEmpty()) continue;
                w("    " + h.addr + "  (" + h.needle + "):");
                for (Address x : xrefs) {
                    Function f = funcMgr.getFunctionContaining(x);
                    String fname = f == null ? "<no func>" : (f.getName() + " @ " + f.getEntryPoint());
                    w("      from " + x + "  in " + fname);
                    if (f != null) funcsToDecompile.add(f.getEntryPoint());
                }
            }

            // Full instruction scan for operand refs into the cluster region
            // (covers cases Ghidra did not auto-resolve as xrefs).
            w("\n  INSTRUCTION SCAN: operands referencing "
                + hex(lo) + " .. " + hex(hi) + ":");
            Map<Long, List<Address>> insRefs = scanInstructionRefs(lo, hi);
            int totalInsRefs = 0;
            for (Map.Entry<Long, List<Address>> e : insRefs.entrySet()) {
                for (Address insAddr : e.getValue()) {
                    totalInsRefs++;
                    Function f = funcMgr.getFunctionContaining(insAddr);
                    String fname = f == null ? "<no func>" : (f.getName() + " @ " + f.getEntryPoint());
                    if (totalInsRefs <= 30) {  // cap noise
                        w("    ref " + hex(e.getKey()) + " <- ins " + insAddr + "  in " + fname);
                    }
                    if (f != null) funcsToDecompile.add(f.getEntryPoint());
                }
            }
            if (totalInsRefs > 30) {
                w("    (... and " + (totalInsRefs - 30) + " more)");
            }
            if (totalInsRefs == 0) w("    (none)");
        }

        // -------- 4. Decompile all collected functions ----------
        w("\n================================================================================");
        w("Decompiling " + Math.min(funcsToDecompile.size(), MAX_DECOMPILE)
            + " functions that reference clustered strings"
            + "  (total candidates: " + funcsToDecompile.size() + ")");
        w("================================================================================");

        int n = 0;
        for (Address entry : funcsToDecompile) {
            if (n++ >= MAX_DECOMPILE) break;
            Function f = funcMgr.getFunctionAt(entry);
            if (f == null) continue;
            w("\n################################################################################");
            w("# " + f.getName() + " @ " + entry);
            w("# namespace: " + f.getParentNamespace());
            w("# signature: " + f.getSignature());
            w("################################################################################");
            w(decompile(f));
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
