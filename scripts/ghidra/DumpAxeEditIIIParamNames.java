// DumpAxeEditIIIParamNames.java — Ghidra GhidraScript
//
// Final extraction: full parameter NAME list per III effect type.
//
// V2's metadata-pointer-decode proved the per-effect table layout:
//
//   struct ParamDescriptor {
//     int32   paramId;       // wire paramId for this entry
//     int32   padding;       // always 0
//     const char* nameStr;   // 64-bit pointer to NUL-terminated symbolic
//                            // name like "REVERB_TYPE", "GLOBAL_TUNER_SOURCE"
//   };  // 16 bytes total
//
// V2 verified: case 0xc paramId 0 → nameStr = "REVERB_TYPE", case 0x1
// paramId 100 → "GLOBAL_TUNER_SOURCE". Effect type is identified by
// the prefix of the first param's name (REVERB_* → reverb, GLOBAL_* →
// global, DELAY_* → delay, etc.).
//
// This script extracts:
//   - For each effect-type case (49 cases from FUN_140397a40):
//     - The case index
//     - The full list of (paramId, paramName) pairs
//   - Outputs both as text and as a JSON file ready to consume into the
//     III TypeScript parameter dictionary
//
// Output:
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-paramnames.txt
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-paramnames.json
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpAxeEditIIIParamNames extends GhidraScript {

    private static final String OUTPUT_TXT =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-paramnames.txt";
    private static final String OUTPUT_JSON =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-paramnames.json";

    // (caseIdx, virtualAddress) — same dispatcher cases as V1/V2.
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
        { 0x29, 0x1412c16e0L },
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

    private static final int STRIDE = 16;
    private static final int MAX_ENTRIES = 512;
    private static final int MAX_NAME_LEN = 96;

    private final List<String> txtLines = new ArrayList<>();
    private final List<String> jsonChunks = new ArrayList<>();

    private void w(String s) {
        txtLines.add(s);
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

    // Read NUL-terminated ASCII at the given address. Returns null if
    // the bytes aren't printable or the string is empty.
    private String readNulTerminatedAscii(Memory mem, Address addr) {
        if (addr == null) return null;
        try {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < MAX_NAME_LEN; i++) {
                byte b = mem.getByte(addr.add(i));
                if (b == 0) break;
                if (b < 0x20 || b >= 0x7f) return null;
                sb.append((char)(b & 0xff));
            }
            return sb.length() > 0 ? sb.toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String escapeJson(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '"': out.append("\\\""); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int)c));
                    else out.append(c);
            }
        }
        return out.toString();
    }

    @Override
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        var as = currentProgram.getAddressFactory().getDefaultAddressSpace();

        w("================================================================================");
        w("Axe-Edit III RE — DumpAxeEditIIIParamNames.java");
        w("  Per-effect parameter NAMES dereferenced from metadata pointers.");
        w("================================================================================");

        jsonChunks.add("{");
        jsonChunks.add("  \"_source\": \"FUN_140397a40 effect-type dispatcher, Axe-Edit III v1.14.31\",");
        jsonChunks.add("  \"_stride_bytes\": 16,");
        jsonChunks.add("  \"_struct\": \"{ int32 paramId; int32 padding; const char* nameStr; }\",");
        jsonChunks.add("  \"effect_types\": {");

        boolean firstEffect = true;
        // Track which case-indices we've already processed (some share tables)
        Map<Long, Long> tableAddrToCase = new LinkedHashMap<>();

        for (long[] pair : CASE_TO_DAT) {
            long caseIdx = pair[0];
            long virtualAddr = pair[1];

            // De-dupe by table address (cases 0x29-0x2d share a table,
            // cases 0x2e-0x31 share a table). Keep the lowest case-
            // index for the JSON key.
            if (tableAddrToCase.containsKey(virtualAddr)) {
                w("");
                w("## case 0x" + Long.toHexString(caseIdx) + "  → DAT_"
                    + Long.toHexString(virtualAddr)
                    + " (shares table with case 0x"
                    + Long.toHexString(tableAddrToCase.get(virtualAddr)) + ")");
                continue;
            }
            tableAddrToCase.put(virtualAddr, caseIdx);

            w("");
            w("## case 0x" + Long.toHexString(caseIdx) + "  → DAT_" + Long.toHexString(virtualAddr));

            List<int[]> entries = new ArrayList<>(); // (paramId, ?)
            List<String> names = new ArrayList<>();
            String effectFamily = null;

            try {
                Address a = as.getAddress(virtualAddr);
                for (int i = 0; i < MAX_ENTRIES; i++) {
                    Address entryAddr = a.add((long) i * STRIDE);
                    int paramId = readIntLE(mem, entryAddr);
                    if (paramId == -1) break;
                    long ptr = readLongLE(mem, entryAddr.add(8));
                    String name = null;
                    if (ptr >= 0x140000000L && ptr < 0x150000000L) {
                        name = readNulTerminatedAscii(mem, as.getAddress(ptr));
                    }
                    entries.add(new int[]{ paramId, 0 });
                    names.add(name == null ? "?" : name);
                    if (effectFamily == null && name != null) {
                        int u = name.indexOf('_');
                        if (u > 0) effectFamily = name.substring(0, u);
                    }
                }
            } catch (Exception e) {
                w("  ERROR: " + e.getMessage());
                continue;
            }

            w("  effectFamily: " + (effectFamily != null ? effectFamily : "(unknown)"));
            w("  paramCount: " + entries.size());
            for (int i = 0; i < entries.size(); i++) {
                w(String.format("    [%3d]  paramId=%-7d  name=%s",
                    i, entries.get(i)[0], names.get(i)));
            }

            // JSON
            if (!firstEffect) jsonChunks.add(",");
            firstEffect = false;
            jsonChunks.add("    \"case_0x" + Long.toHexString(caseIdx) + "\": {");
            jsonChunks.add("      \"caseIdx\": " + caseIdx + ",");
            jsonChunks.add("      \"tableAddr\": \"0x" + Long.toHexString(virtualAddr) + "\",");
            if (effectFamily != null)
                jsonChunks.add("      \"effectFamily\": \"" + effectFamily + "\",");
            jsonChunks.add("      \"paramCount\": " + entries.size() + ",");
            StringBuilder params = new StringBuilder("      \"params\": [");
            for (int i = 0; i < entries.size(); i++) {
                if (i > 0) params.append(", ");
                params.append("{\"paramId\":").append(entries.get(i)[0])
                    .append(", \"name\":\"").append(escapeJson(names.get(i))).append("\"}");
            }
            params.append("]");
            jsonChunks.add(params.toString());
            jsonChunks.add("    }");
        }

        jsonChunks.add("");
        jsonChunks.add("  }");
        jsonChunks.add("}");

        // Summary
        w("");
        w("================================================================================");
        w("Summary");
        w("================================================================================");
        int totalParams = 0;
        Set<Integer> uniqueIds = new TreeSet<>();
        Map<String, Integer> familyCount = new TreeMap<>();
        for (long[] pair : CASE_TO_DAT) {
            // recompute (we de-duped; just count from the table addrs we kept)
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_TXT))) {
            for (String s : txtLines) pw.println(s);
        }
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_JSON))) {
            for (String s : jsonChunks) pw.println(s);
        }
        println("\nWrote " + txtLines.size() + " lines to " + OUTPUT_TXT);
        println("Wrote JSON to " + OUTPUT_JSON);
    }
}
