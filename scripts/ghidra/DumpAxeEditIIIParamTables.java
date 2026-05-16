// DumpAxeEditIIIParamTables.java — Ghidra GhidraScript
//
// Phase-3 follow-up to MineAxeEditIIIParamResolver.java. That script
// identified `FUN_140397a40` as the effect-type → param-table
// dispatcher in AxeEdit III. The dispatcher is a switch statement
// where each case maps an effect-type index to a `DAT_xxx` pointer.
// Each `DAT_xxx` is a `-1`-terminated int array of paramIds for that
// effect type's parameter list — exactly the per-effect parameter
// dictionary we've been missing.
//
// This script reads the bytes at each known DAT_xxx address and dumps
// the int array, giving us the wire-level paramId list per effect
// type. Combined with the symbolic name strings nearby in .rdata, this
// is the III parameter dictionary in one extract.
//
// Why this works even when Ghidra's data-reference analyzer hasn't
// fully populated string xrefs:
//   - The switch-statement case bodies contain immediate references to
//     the DAT_xxx addresses (Ghidra recognized those during the initial
//     decompile pass)
//   - Once we have the addresses, reading raw bytes via `mem.getInt()`
//     doesn't require any xref analysis — just memory access
//
// Addresses come from the FUN_140397a40 decompile output captured in
// ghidra-axeedit3-paramresolver.txt (Phase 4). Each (caseIdx, DAT)
// pair is hardcoded below; re-run after binary updates to refresh.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-paramtables.txt
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpAxeEditIIIParamTables extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-paramtables.txt";

    // (caseIdx, virtualAddress) pairs from FUN_140397a40 decompile.
    // caseIdx is the switch value (effect-type internal enum).
    // virtualAddress is where the param-list int array lives.
    private static final long[][] CASE_TO_DAT = {
        { 0x01, 0x1412bc840L },
        { 0x02, 0x1412c3c90L },
        { 0x03, 0x1412bfab0L },
        // case 4, 6, 0x1b: return -1 — no table (skipped here)
        { 0x05, 0x1412c39d0L },
        { 0x07, 0x1412c2cf0L },
        { 0x08, 0x1412c0670L },
        { 0x09, 0x1412bd7e0L },
        { 0x0a, 0x1412c1790L },
        { 0x0b, 0x1412bb7c0L },
        { 0x0c, 0x1412bda00L },
        { 0x0d, 0x1412c2750L },
        { 0x0e, 0x1412bfc50L },
        { 0x0f, 0x1412c2f80L },
        { 0x10, 0x1412c03f0L },
        { 0x11, 0x1412c5150L },
        { 0x12, 0x1412c1580L },
        { 0x13, 0x1412c1250L },
        { 0x14, 0x1412c0f00L },
        { 0x15, 0x1412bc2b0L },
        { 0x16, 0x1412bb650L },
        { 0x17, 0x1412c07d0L },
        { 0x18, 0x1412bb380L },
        { 0x19, 0x1412c4e80L },
        { 0x1a, 0x1412c4db0L },
        { 0x1c, 0x1412c25d0L },
        { 0x1d, 0x1412c2f50L },
        { 0x1e, 0x1412bb5e0L },
        { 0x1f, 0x1412c2090L },
        { 0x20, 0x1412c3590L },
        { 0x21, 0x1412bf870L },
        { 0x22, 0x1412c4cb0L },
        { 0x23, 0x1412bbfb0L },
        { 0x24, 0x1412c3bb0L },
        { 0x25, 0x1412c2340L },
        { 0x26, 0x1412bf550L },
        { 0x27, 0x1412c4870L },
        { 0x28, 0x1412bc400L },
        // case 0x29-0x2d share DAT_1412c16e0 (5 cases collapsed)
        { 0x29, 0x1412c16e0L },
        // case 0x2e-0x31 share DAT_1412c4b00 (4 cases collapsed)
        { 0x2e, 0x1412c4b00L },
        { 0x32, 0x1412c3a20L },
        { 0x33, 0x1412bc0f0L },
        { 0x34, 0x1412c0600L },
        { 0x35, 0x1412bf470L },
        { 0x36, 0x1412bc380L },
        { 0x37, 0x1412c10a0L },
        { 0x38, 0x1412bf290L },
        { 0x39, 0x1412bc500L },
        { 0x3a, 0x1412bd7d0L },
        { 0x3b, 0x1412c1490L },
    };

    // Cap on the per-table read in case the array isn't actually
    // -1-terminated (e.g. if our address is wrong, we'd dump garbage
    // forever).
    private static final int MAX_ENTRIES_PER_TABLE = 256;

    private final List<String> lines = new ArrayList<>();

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private int readIntLE(Memory mem, Address addr) throws Exception {
        byte[] buf = new byte[4];
        mem.getBytes(addr, buf);
        return (buf[0] & 0xff)
            | ((buf[1] & 0xff) << 8)
            | ((buf[2] & 0xff) << 16)
            | ((buf[3] & 0xff) << 24);
    }

    @Override
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        var as = currentProgram.getAddressFactory().getDefaultAddressSpace();

        w("================================================================================");
        w("Axe-Edit III RE — DumpAxeEditIIIParamTables.java");
        w("  Reads per-effect-type parameter-ID tables identified from");
        w("  FUN_140397a40's switch statement.");
        w("================================================================================");

        Map<Long, List<Integer>> tablesByAddr = new LinkedHashMap<>();

        for (long[] pair : CASE_TO_DAT) {
            long caseIdx = pair[0];
            long virtualAddr = pair[1];

            w("");
            w("## case 0x" + Long.toHexString(caseIdx)
                + "  → DAT_" + Long.toHexString(virtualAddr));

            // Reuse previously-read table if multiple cases share one
            // pointer (cases 0x29-0x2d, 0x2e-0x31).
            List<Integer> entries;
            if (tablesByAddr.containsKey(virtualAddr)) {
                entries = tablesByAddr.get(virtualAddr);
                w("  (already read above; " + entries.size() + " entries)");
                continue;
            } else {
                entries = new ArrayList<>();
                try {
                    Address a = as.getAddress(virtualAddr);
                    for (int i = 0; i < MAX_ENTRIES_PER_TABLE; i++) {
                        int v = readIntLE(mem, a.add((long) i * 4));
                        if (v == -1) break;
                        entries.add(v);
                    }
                } catch (Exception e) {
                    w("  ERROR reading bytes: " + e.getMessage());
                    continue;
                }
                tablesByAddr.put(virtualAddr, entries);
            }

            w("  " + entries.size() + " param IDs:");
            StringBuilder sb = new StringBuilder("    ");
            for (int i = 0; i < entries.size(); i++) {
                if (i > 0 && i % 8 == 0) {
                    w(sb.toString());
                    sb = new StringBuilder("    ");
                }
                sb.append(String.format("%5d ", entries.get(i)));
            }
            if (sb.length() > 4) w(sb.toString());
        }

        // Summary
        w("");
        w("================================================================================");
        w("Summary");
        w("================================================================================");
        w("Total unique tables read: " + tablesByAddr.size());
        int totalParams = tablesByAddr.values().stream().mapToInt(List::size).sum();
        w("Total parameter-ID entries (sum across all tables): " + totalParams);
        // Histogram: param ID range
        int minId = Integer.MAX_VALUE, maxId = Integer.MIN_VALUE;
        Set<Integer> uniqueIds = new HashSet<>();
        for (var t : tablesByAddr.values()) {
            for (int v : t) {
                if (v < minId) minId = v;
                if (v > maxId) maxId = v;
                uniqueIds.add(v);
            }
        }
        w("Param-ID range observed: " + minId + " .. " + maxId
            + " (" + uniqueIds.size() + " unique)");

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
