// SeekParamTables64.java — Ghidra GhidraScript
//
// 64-bit sibling of SeekParamTablesII.java (32-bit). Direct-pattern-
// scan technique applied to AM4-Edit.exe (64-bit) and Axe-Edit III.exe
// (64-bit) — bypasses the dispatcher entirely and recovers the
// ParamDescriptor catalog by scanning data sections for the struct
// pattern.
//
// Cross-validation purpose: AM4 and III already have catalogs via the
// dispatcher-walk technique (`DumpAM4ParamNames.java` /
// `DumpAxeEditIIIParamNames.java`, Session 82). This script provides
// an INDEPENDENT recovery path. Expected outcomes:
//   - 100% agreement with the dispatcher catalogs → confidence floor.
//   - Surfaces entries the dispatcher missed (case 0x3a empty table
//     on AM4, etc.) → new params unlock.
//   - Surfaces dispatcher entries this script misses (unreferenced
//     symbols, indirect tables) → method-limit characterisation.
//
// 64-bit ParamDescriptor (16 bytes):
//
//     struct ParamDescriptor64 {
//         int32   paramId;       // -1 terminates
//         int32   padding;       // always 0
//         const char* nameStr;   // 64-bit pointer (8 bytes)
//     };
//
// Pointer plausibility for both AM4-Edit and AxeEdit III: image base
// is 0x140000000 (Windows x64 PE default); image size typically
// 0x20-30 MB. Pointer range checked against the actual image bounds
// at runtime (more robust than hardcoded).
//
// Output:
//   samples/captured/decoded/ghidra-<program>-paramtables.{txt,json}
//   where <program> is derived from the loaded binary name
//   (am4edit / axeedit3).
//
// @category Fractal

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class SeekParamTables64 extends GhidraScript {

    private static final String OUT_DIR =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\";

    private static final String[] PREFIXES = {
        "GLOBAL_", "EFFECT_",
        "REVERB_", "DELAY_", "CHORUS_", "AMP_", "DRIVE_", "CAB_",
        "DISTORT_", "COMP_", "EQ_", "WAH_", "PHASER_", "FLANGER_",
        "PITCH_", "FILTER_", "GATE_", "LOOPER_", "TREMOLO_", "ROTARY_",
        "ENHANCER_", "VOLUME_", "PAN_", "FUZZ_", "FORMANT_", "SYNTH_",
        "VOCODER_", "RINGMOD_", "RESONATOR_", "TONEMATCH_", "RTA_",
        "GRAPHEQ_", "PARAEQ_", "MIXER_", "MULTITAP_", "MEGATAP_",
        "PLEXDELAY_", "PLEX_", "TENTAP_", "CROSSOVER_", "MULTIBAND_",
        "MULTICOMP_", "CONTROLLERS_", "PERPRESET_", "FOOTSWITCH_",
        "SCENE_", "MODIFIER_", "ID_", "CABINET_", "DYNDIST_", "PEQ_",
        "GEQ_", "INPUT_", "OUTPUT_", "IRPLAYER_", "IRCAPTURE_",
        "FDBKRET_", "FDBKSEND_", "MIDIBLOCK_", "MOD_", "PATCH_",
    };

    // 64-bit struct: int32 paramId + int32 padding + int64 pointer = 16 bytes
    private static final int STRIDE = 16;
    private static final int MAX_NAME_LEN = 96;
    private static final int MIN_TABLE_ENTRIES = 3;
    private static final int MAX_TABLE_ENTRIES = 1024;
    private static final int MAX_PARAM_ID = 1000;

    private final List<String> txtLines = new ArrayList<>();
    private final List<String> jsonChunks = new ArrayList<>();

    private Memory mem;
    private AddressSpace as;
    private long ptrMin;
    private long ptrMax;

    private void w(String s) {
        txtLines.add(s);
        println(s);
    }

    private int readIntLE(Address addr) throws Exception {
        byte[] buf = new byte[4];
        mem.getBytes(addr, buf);
        return (buf[0] & 0xff)
            | ((buf[1] & 0xff) << 8)
            | ((buf[2] & 0xff) << 16)
            | ((buf[3] & 0xff) << 24);
    }

    private long readLongLE(Address addr) throws Exception {
        byte[] buf = new byte[8];
        mem.getBytes(addr, buf);
        long v = 0;
        for (int i = 0; i < 8; i++) v |= ((long) (buf[i] & 0xff)) << (i * 8);
        return v;
    }

    private boolean isAsciiPrintable(byte b) {
        return b >= 0x20 && b < 0x7f;
    }

    private String readNulTerminatedAscii(Address addr) {
        if (addr == null) return null;
        try {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < MAX_NAME_LEN; i++) {
                byte b = mem.getByte(addr.add(i));
                if (b == 0) break;
                if (!isAsciiPrintable(b)) return null;
                sb.append((char) (b & 0xff));
            }
            return sb.length() > 0 ? sb.toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean looksLikeFractalSymbol(String s) {
        if (s.length() < 5) return false;
        for (String p : PREFIXES) {
            if (s.startsWith(p) && s.length() > p.length()) return true;
        }
        return false;
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
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.toString();
    }

    private Map<Long, String> indexFractalSymbols() throws Exception {
        Map<Long, String> result = new HashMap<>();
        for (String prefix : PREFIXES) {
            byte[] needle = prefix.getBytes(StandardCharsets.US_ASCII);
            Address from = currentProgram.getMinAddress();
            int progressMod = 0;
            while (from != null && !monitor.isCancelled()) {
                Address hit = mem.findBytes(from, needle, null, true, monitor);
                if (hit == null) break;
                String value = readNulTerminatedAscii(hit);
                if (value != null && looksLikeFractalSymbol(value)) {
                    boolean validStart;
                    try {
                        byte b = mem.getByte(hit.add(-1));
                        validStart = (b == 0);
                    } catch (Exception e) {
                        validStart = true;
                    }
                    if (validStart) {
                        result.put(hit.getOffset(), value);
                    }
                }
                from = hit.add(1);
                if (++progressMod % 500 == 0) {
                    monitor.setMessage("indexing " + prefix + " — " + result.size() + " symbols");
                }
            }
        }
        return result;
    }

    private static class TableHit {
        long startAddr;
        List<int[]> entries = new ArrayList<>();
        List<Long> pointers = new ArrayList<>();
        List<String> symbols = new ArrayList<>();
        String effectFamily;
    }

    private TableHit extendTable(Address seed, Map<Long, String> symbols) throws Exception {
        TableHit t = new TableHit();
        t.startAddr = seed.getOffset();
        for (int i = 0; i < MAX_TABLE_ENTRIES; i++) {
            Address entryAddr = seed.add((long) i * STRIDE);
            int paramId;
            long ptr;
            try {
                paramId = readIntLE(entryAddr);
                ptr = readLongLE(entryAddr.add(8));
            } catch (Exception e) {
                break;
            }
            if (paramId == -1) break;
            if (paramId < 0 || paramId > MAX_PARAM_ID) break;
            if (ptr < ptrMin || ptr > ptrMax) break;
            String sym = symbols.get(ptr);
            if (sym == null) break;
            t.entries.add(new int[]{ paramId, 0 });
            t.pointers.add(ptr);
            t.symbols.add(sym);
            if (t.effectFamily == null) {
                int u = sym.indexOf('_');
                if (u > 0) t.effectFamily = sym.substring(0, u);
            }
        }
        return t.entries.size() >= MIN_TABLE_ENTRIES ? t : null;
    }

    @Override
    public void run() throws Exception {
        mem = currentProgram.getMemory();
        as = currentProgram.getAddressFactory().getDefaultAddressSpace();

        // Derive output file name from program name. Strip extension
        // and special chars to get a clean slug.
        String progName = currentProgram.getName().toLowerCase();
        String slug = progName
            .replaceAll("\\.exe$", "")
            .replaceAll("[^a-z0-9]+", "");
        String outTxt = OUT_DIR + "ghidra-" + slug + "-paramtables.txt";
        String outJson = OUT_DIR + "ghidra-" + slug + "-paramtables.json";

        // Derive ptr-range from actual image bounds (more robust than
        // hardcoding 0x140000000 — Axe-Edit III may ASLR-shift).
        Address minA = currentProgram.getMinAddress();
        Address maxA = currentProgram.getMaxAddress();
        ptrMin = minA.getOffset();
        ptrMax = maxA.getOffset();

        w("================================================================================");
        w("64-bit ParamDescriptor seeker — SeekParamTables64.java");
        w("  program:    " + currentProgram.getName() + " (out slug: " + slug + ")");
        w("  image base: " + currentProgram.getImageBase());
        w("  ptr range:  0x" + Long.toHexString(ptrMin) + " - 0x" + Long.toHexString(ptrMax));
        w("================================================================================");

        w("");
        w("## Phase 1 — index Fractal-symbol strings");
        Map<Long, String> symbols = indexFractalSymbols();
        w("  " + symbols.size() + " Fractal symbols indexed");

        w("");
        w("## Phase 2 — seek ParamDescriptor patterns (stride=16)");
        Map<Long, TableHit> bestByAddr = new LinkedHashMap<>();
        long scanned = 0;
        int hitsRaw = 0;
        for (MemoryBlock block : mem.getBlocks()) {
            if (!block.isInitialized()) continue;
            if (block.isExecute()) continue;
            Address start = block.getStart();
            Address end = block.getEnd();
            w("  scanning block " + block.getName() + " ["
                + start + " - " + end + "]");
            long n = block.getSize();
            for (long off = 0; off <= n - STRIDE; off += 4) {
                if (monitor.isCancelled()) break;
                Address a = start.add(off);
                int paramId;
                try {
                    paramId = readIntLE(a);
                } catch (Exception e) {
                    continue;
                }
                if (paramId < 0 || paramId > MAX_PARAM_ID) continue;
                TableHit t = extendTable(a, symbols);
                if (t == null) continue;
                hitsRaw++;
                TableHit prev = bestByAddr.get(t.startAddr);
                if (prev == null || t.entries.size() > prev.entries.size()) {
                    bestByAddr.put(t.startAddr, t);
                }
                scanned++;
                if (scanned % 500000 == 0) {
                    monitor.setMessage("scanned " + scanned + " offsets, "
                        + bestByAddr.size() + " tables found");
                }
            }
        }
        w("  scanned " + scanned + " 4-byte-aligned offsets, "
            + hitsRaw + " raw candidates, "
            + bestByAddr.size() + " distinct tables (>= "
            + MIN_TABLE_ENTRIES + " entries)");

        w("");
        w("## Phase 3 — drop nested subtables");
        List<TableHit> tables = new ArrayList<>(bestByAddr.values());
        tables.sort((a, b) -> Long.compare(a.startAddr, b.startAddr));
        List<TableHit> keep = new ArrayList<>();
        for (TableHit t : tables) {
            boolean nested = false;
            for (TableHit other : keep) {
                long otherEnd = other.startAddr + (long) other.entries.size() * STRIDE;
                if (t.startAddr > other.startAddr && t.startAddr < otherEnd) {
                    nested = true;
                    break;
                }
            }
            if (!nested) keep.add(t);
        }
        w("  " + keep.size() + " top-level tables after nesting filter");

        w("");
        w("## Phase 4 — discovered ParamDescriptor tables");
        keep.sort((a, b) -> Integer.compare(b.entries.size(), a.entries.size()));

        jsonChunks.add("{");
        jsonChunks.add("  \"_source\": \"SeekParamTables64 direct-scan over " + currentProgram.getName() + "\",");
        jsonChunks.add("  \"_stride\": " + STRIDE + ",");
        jsonChunks.add("  \"_min_table_entries\": " + MIN_TABLE_ENTRIES + ",");
        jsonChunks.add("  \"symbol_total\": " + symbols.size() + ",");
        jsonChunks.add("  \"tables\": [");

        int totalEntries = 0;
        Set<String> uniqueSymbols = new HashSet<>();
        boolean firstTable = true;
        for (TableHit t : keep) {
            totalEntries += t.entries.size();
            uniqueSymbols.addAll(t.symbols);
            w("");
            w("### " + (t.effectFamily != null ? t.effectFamily : "???")
                + "  @ 0x" + Long.toHexString(t.startAddr)
                + "  (entries=" + t.entries.size() + ")");
            for (int i = 0; i < t.entries.size(); i++) {
                w(String.format("  [%3d]  paramId=%-5d  %s",
                    i, t.entries.get(i)[0], t.symbols.get(i)));
            }

            if (!firstTable) jsonChunks.add(",");
            firstTable = false;
            jsonChunks.add("    {");
            jsonChunks.add("      \"startAddr\": \"0x" + Long.toHexString(t.startAddr) + "\",");
            jsonChunks.add("      \"effectFamily\": "
                + (t.effectFamily != null ? "\"" + t.effectFamily + "\"" : "null") + ",");
            jsonChunks.add("      \"paramCount\": " + t.entries.size() + ",");
            StringBuilder params = new StringBuilder("      \"params\": [");
            for (int i = 0; i < t.entries.size(); i++) {
                if (i > 0) params.append(", ");
                params.append("{\"paramId\":").append(t.entries.get(i)[0])
                    .append(", \"name\":\"").append(escapeJson(t.symbols.get(i))).append("\"}");
            }
            params.append("]");
            jsonChunks.add(params.toString());
            jsonChunks.add("    }");
        }
        jsonChunks.add("  ],");
        jsonChunks.add("  \"summary\": {");
        jsonChunks.add("    \"tables\": " + keep.size() + ",");
        jsonChunks.add("    \"totalParamEntries\": " + totalEntries + ",");
        jsonChunks.add("    \"uniqueSymbolsInTables\": " + uniqueSymbols.size() + ",");
        jsonChunks.add("    \"symbolsIndexed\": " + symbols.size());
        jsonChunks.add("  }");
        jsonChunks.add("}");

        w("");
        w("## Summary");
        w("  symbols indexed in binary:   " + symbols.size());
        w("  ParamDescriptor tables:      " + keep.size());
        w("  total entries across tables: " + totalEntries);
        w("  unique symbols in tables:    " + uniqueSymbols.size()
            + " (" + (symbols.size() == 0 ? 0 : (uniqueSymbols.size() * 100 / symbols.size())) + "% of indexed)");

        try (PrintWriter pw = new PrintWriter(new FileWriter(outTxt))) {
            for (String s : txtLines) pw.println(s);
        }
        try (PrintWriter pw = new PrintWriter(new FileWriter(outJson))) {
            for (String s : jsonChunks) pw.println(s);
        }
        println("\nWrote " + txtLines.size() + " lines to " + outTxt);
        println("Wrote JSON to " + outJson);
    }
}
