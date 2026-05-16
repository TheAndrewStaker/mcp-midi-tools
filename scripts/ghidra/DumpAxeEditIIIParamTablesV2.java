// DumpAxeEditIIIParamTablesV2.java — Ghidra GhidraScript
//
// V2 revision based on what V1 revealed:
//
//   The DAT_xxx tables aren't `-1`-terminated int arrays — they're
//   arrays of 16-byte structs:
//
//     struct ParamDescriptor {
//       int32   paramId;       // wire paramId value
//       int32   padding;       // always 0
//       void*   metadata;      // 64-bit pointer (split as ptrLow/ptrHigh in V1)
//     };
//
//   Each struct is 16 bytes. The array is terminated either by
//   paramId == -1 OR runs longer than V1's 256-int cap (64 entries).
//   Case 2 in V1's dump shows paramIds 0..60+ in sequential order
//   (with a 175/176/177 cluster) — that's the entire param list for
//   one effect type. Case 3 starts at 0 and goes sequential too.
//
// This V2:
//   - Iterates with stride=16 bytes
//   - Reads only the paramId (first 4 bytes)
//   - Terminator: paramId == -1 OR i >= MAX_ENTRIES_PER_TABLE (4096
//     bytes = 256 entries max)
//   - Also dereferences metadata pointer for the FIRST entry of each
//     effect type and dumps that struct (24 bytes worth) to see what
//     per-param info is stored
//   - Cross-references each effect-type case-index to a hypothesized
//     III effect-family name (using nearby ID_* and EFFECT_* strings
//     as hints)
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-paramtables-v2.txt
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpAxeEditIIIParamTablesV2 extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-paramtables-v2.txt";

    // (caseIdx, virtualAddress) — same as V1.
    private static final long[][] CASE_TO_DAT = {
        { 0x01, 0x1412bc840L },
        { 0x02, 0x1412c3c90L },
        { 0x03, 0x1412bfab0L },
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
        { 0x29, 0x1412c16e0L }, // shared with 0x2a, 0x2b, 0x2c, 0x2d
        { 0x2e, 0x1412c4b00L }, // shared with 0x2f, 0x30, 0x31
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

    // Stride: 16 bytes per ParamDescriptor entry.
    private static final int STRIDE = 16;
    // Max entries per effect-type table before we bail.
    private static final int MAX_ENTRIES = 512;

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

    private long readLongLE(Memory mem, Address addr) throws Exception {
        byte[] buf = new byte[8];
        mem.getBytes(addr, buf);
        long v = 0;
        for (int i = 0; i < 8; i++) v |= ((long)(buf[i] & 0xff)) << (i * 8);
        return v;
    }

    @Override
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        var as = currentProgram.getAddressFactory().getDefaultAddressSpace();

        w("================================================================================");
        w("Axe-Edit III RE — DumpAxeEditIIIParamTablesV2.java");
        w("  Per-effect parameter ID tables from FUN_140397a40 dispatcher,");
        w("  read with proper 16-byte struct stride and -1 terminator detection.");
        w("================================================================================");

        Map<Long, List<Integer>> tablesByAddr = new LinkedHashMap<>();
        Map<Long, List<Long>> metadataPtrsByAddr = new LinkedHashMap<>();

        for (long[] pair : CASE_TO_DAT) {
            long caseIdx = pair[0];
            long virtualAddr = pair[1];

            w("");
            w("## case 0x" + Long.toHexString(caseIdx)
                + "  → DAT_" + Long.toHexString(virtualAddr));

            if (tablesByAddr.containsKey(virtualAddr)) {
                List<Integer> already = tablesByAddr.get(virtualAddr);
                w("  (already read above; " + already.size() + " params)");
                continue;
            }

            List<Integer> paramIds = new ArrayList<>();
            List<Long> metadataPtrs = new ArrayList<>();
            boolean hitTerminator = false;
            try {
                Address a = as.getAddress(virtualAddr);
                for (int i = 0; i < MAX_ENTRIES; i++) {
                    Address entryAddr = a.add((long) i * STRIDE);
                    int paramId = readIntLE(mem, entryAddr);
                    if (paramId == -1) {
                        hitTerminator = true;
                        break;
                    }
                    long ptr = readLongLE(mem, entryAddr.add(8));
                    paramIds.add(paramId);
                    metadataPtrs.add(ptr);
                }
            } catch (Exception e) {
                w("  ERROR reading bytes: " + e.getMessage());
                continue;
            }
            tablesByAddr.put(virtualAddr, paramIds);
            metadataPtrsByAddr.put(virtualAddr, metadataPtrs);

            w("  " + paramIds.size() + " params"
                + (hitTerminator ? " (-1 terminator hit)" : " (capped at " + MAX_ENTRIES + ")"));

            // Param ID list
            StringBuilder sb = new StringBuilder("  paramIds: ");
            for (int i = 0; i < paramIds.size(); i++) {
                if (i > 0 && i % 16 == 0) {
                    w(sb.toString());
                    sb = new StringBuilder("            ");
                }
                sb.append(String.format("%5d ", paramIds.get(i)));
            }
            if (sb.length() > 12) w(sb.toString());

            // First-entry metadata peek: dereference the first metadata
            // pointer and dump 24 bytes (6 ints) as a hint of what's
            // there.
            if (!metadataPtrs.isEmpty()) {
                long firstPtr = metadataPtrs.get(0);
                w("  first metadata ptr: 0x" + Long.toHexString(firstPtr)
                    + "  (paramId=" + paramIds.get(0) + ")");
                if (firstPtr >= 0x140000000L && firstPtr < 0x150000000L) {
                    try {
                        Address mAddr = as.getAddress(firstPtr);
                        StringBuilder mb = new StringBuilder("    first 6 ints at metadata ptr:");
                        for (int i = 0; i < 6; i++) {
                            int v = readIntLE(mem, mAddr.add(i * 4L));
                            mb.append(String.format(" %d", v));
                        }
                        w(mb.toString());
                        // Try reading as a string (some metadata entries
                        // might start with a string pointer at offset 0)
                        long maybeStr = readLongLE(mem, mAddr);
                        if (maybeStr >= 0x140000000L && maybeStr < 0x150000000L) {
                            Address sAddr = as.getAddress(maybeStr);
                            StringBuilder strBuf = new StringBuilder();
                            for (int k = 0; k < 64; k++) {
                                byte b = mem.getByte(sAddr.add(k));
                                if (b == 0) break;
                                if (b < 0x20 || b >= 0x7f) { strBuf.setLength(0); break; }
                                strBuf.append((char)(b & 0xff));
                            }
                            if (strBuf.length() > 0) {
                                w("    string at first ptr in metadata: \"" + strBuf + "\"");
                            }
                        }
                    } catch (Exception e) {
                        w("    (couldn't dereference metadata ptr: " + e.getMessage() + ")");
                    }
                } else {
                    w("    (ptr out of image range — likely not a pointer)");
                }
            }
        }

        // Summary
        w("");
        w("================================================================================");
        w("Summary");
        w("================================================================================");
        w("Total distinct tables read: " + tablesByAddr.size());
        int totalParams = 0;
        int minId = Integer.MAX_VALUE, maxId = Integer.MIN_VALUE;
        Set<Integer> uniqueIds = new TreeSet<>();
        for (var t : tablesByAddr.values()) {
            totalParams += t.size();
            for (int v : t) {
                if (v < minId) minId = v;
                if (v > maxId) maxId = v;
                uniqueIds.add(v);
            }
        }
        w("Total parameter-ID entries (sum across all tables): " + totalParams);
        w("Param-ID range observed: " + minId + " .. " + maxId
            + " (" + uniqueIds.size() + " unique)");

        // Per-table size histogram
        w("");
        w("Per-table param counts:");
        for (var e : tablesByAddr.entrySet()) {
            w(String.format("  DAT_%x  →  %d params",
                e.getKey(), e.getValue().size()));
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
