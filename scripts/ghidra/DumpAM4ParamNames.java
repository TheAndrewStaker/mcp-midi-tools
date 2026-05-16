// DumpAM4ParamNames.java — Ghidra GhidraScript
//
// AM4-Edit parallel of DumpAxeEditIIIParamNames.java. The two binaries
// share the same effect-type → param-table dispatcher pattern:
//
//   AxeEdit III:  FUN_140397a40  (49 cases 1..0x3b)
//   AM4-Edit:     FUN_1402e3da0  (50 cases 1..0x3c — case 0x3c is NEW,
//                                 not present in the III dispatcher)
//
// Same 16-byte struct shape per entry: { int paramId, int padding,
// const char* nameStr }, terminated by paramId == -1. This script
// dereferences each DAT_xxx address from AM4-Edit's dispatcher and
// extracts (paramId, paramName) pairs per effect.
//
// AM4's case 0x3c is the most-anticipated unlock: cases 4, 6, 0x1b
// in both dispatchers return -1, and the III is missing AMP. AM4 has
// an AMP block (we already use it heavily). The new case 0x3c is the
// strongest candidate for AMP's parameter table.
//
// Output:
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-am4-paramnames.txt
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-am4-paramnames.json
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpAM4ParamNames extends GhidraScript {

    private static final String OUTPUT_TXT =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-am4-paramnames.txt";
    private static final String OUTPUT_JSON =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-am4-paramnames.json";

    // (caseIdx, virtualAddress) — AM4-Edit dispatcher FUN_1402e3da0.
    // Cases 4, 6, 0x1b are absent (default → goto switchD_caseD_4 →
    // returns -1, like the III). Case 0x3c is NEW (AM4-specific).
    private static final long[][] CASE_TO_DAT = {
        { 0x01, 0x14141a9f0L },
        { 0x02, 0x141420bc0L },
        { 0x03, 0x14141ce60L },
        { 0x05, 0x141420980L },
        { 0x07, 0x14141fcd0L },
        { 0x08, 0x14141d900L },
        { 0x09, 0x14141b040L },
        { 0x0a, 0x14141e930L },
        { 0x0b, 0x14141a090L },
        { 0x0c, 0x14141b200L },
        { 0x0d, 0x14141f7c0L },
        { 0x0e, 0x14141d000L },
        { 0x0f, 0x14141ff10L },
        { 0x10, 0x14141d720L },
        { 0x11, 0x141421ec0L },
        { 0x12, 0x14141e7b0L },
        { 0x13, 0x14141e4f0L },
        { 0x14, 0x14141e250L },
        { 0x15, 0x14141a840L },
        { 0x16, 0x141419f90L },
        { 0x17, 0x14141d9e0L },
        { 0x18, 0x141419d20L },
        { 0x19, 0x141421c30L },
        { 0x1a, 0x141421640L },
        { 0x1c, 0x14141f6a0L },
        { 0x1d, 0x14141fee0L },
        { 0x1e, 0x141419f20L },
        { 0x1f, 0x14141f230L },
        { 0x20, 0x141420540L },
        { 0x21, 0x14141cca0L },
        { 0x22, 0x141421540L },
        { 0x23, 0x14141a5f0L },
        { 0x24, 0x141420b50L },
        { 0x25, 0x14141f470L },
        { 0x26, 0x14141c980L },
        { 0x27, 0x1414211e0L },
        { 0x28, 0x14141a920L },
        { 0x29, 0x14141e8a0L }, // shared with 0x2a-0x2d (INPUT 1-5 share params)
        { 0x2e, 0x141421410L }, // shared with 0x2f-0x31 (OUTPUT 1-4 share params)
        { 0x32, 0x1414209c0L },
        { 0x33, 0x14141a6d0L },
        { 0x34, 0x14141d890L },
        { 0x35, 0x14141c920L },
        { 0x36, 0x14141a8a0L },
        { 0x37, 0x14141e3a0L },
        { 0x38, 0x14141c910L },
        { 0x39, 0x14141a9e0L },
        { 0x3a, 0x14141b030L },
        { 0x3b, 0x14141e6c0L },
        { 0x3c, 0x1414216d0L }, // ← NEW vs III. Likely AMP.
    };

    private static final int STRIDE = 16;
    private static final int MAX_ENTRIES = 1024;
    private static final int MAX_NAME_LEN = 96;
    // AM4-Edit image-base range for pointer validation.
    private static final long IMAGE_BASE_MIN = 0x140000000L;
    private static final long IMAGE_BASE_MAX = 0x142000000L;

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
        w("AM4-Edit RE — DumpAM4ParamNames.java");
        w("  Per-effect parameter NAMES from FUN_1402e3da0 dispatcher.");
        w("================================================================================");

        jsonChunks.add("{");
        jsonChunks.add("  \"_source\": \"FUN_1402e3da0 effect-type dispatcher, AM4-Edit\",");
        jsonChunks.add("  \"_stride_bytes\": 16,");
        jsonChunks.add("  \"_struct\": \"{ int32 paramId; int32 padding; const char* nameStr; }\",");
        jsonChunks.add("  \"effect_types\": {");

        boolean firstEffect = true;
        Map<Long, Long> tableAddrToCase = new LinkedHashMap<>();

        for (long[] pair : CASE_TO_DAT) {
            long caseIdx = pair[0];
            long virtualAddr = pair[1];

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

            List<int[]> entries = new ArrayList<>();
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
                    if (ptr >= IMAGE_BASE_MIN && ptr < IMAGE_BASE_MAX) {
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
