// SeekParamTablesII.java — Ghidra GhidraScript
//
// Bypass the failed dispatcher-xref technique on the 32-bit Axe-Edit
// (II generation) binary. Instead of finding the dispatcher first and
// reading its case targets, scan the binary directly for runs of the
// ParamDescriptor struct pattern.
//
// AM4 / Axe-Edit III ship 16-byte ParamDescriptors (64-bit binaries):
//
//     struct ParamDescriptor {
//         int32   paramId;       // -1 terminates
//         int32   padding;
//         const char* nameStr;   // 64-bit pointer
//     };
//
// On Axe-Edit (II), 32-bit, the same logical struct collapses to either
// 8 bytes (no padding) or 12 bytes (with int32 padding kept). Both are
// attempted; whichever matches more entries wins per-table.
//
//     // 8-byte variant
//     struct ParamDescriptor8 {
//         int32   paramId;       // -1 terminates
//         const char* nameStr;   // 32-bit pointer
//     };
//
//     // 12-byte variant
//     struct ParamDescriptor12 {
//         int32   paramId;       // -1 terminates
//         int32   padding;
//         const char* nameStr;   // 32-bit pointer
//     };
//
// Algorithm:
//
// 1. INDEX. Walk the image and find every NUL-terminated ASCII string
//    that matches a Fractal symbol pattern (uppercase, underscore-
//    delimited, starts with a known family prefix). Record each
//    symbol's virtual address.
//
// 2. CANDIDATE. Scan each .rdata-like memory block on 4-byte alignment.
//    At each offset, check whether the bytes at that offset look like
//    a ParamDescriptor entry — paramId in plausible range and pointer
//    resolves to a known Fractal symbol.
//
// 3. EXTEND. From each candidate seed, extend forward at +stride until
//    either paramId==-1 (terminator) or pattern breaks. Tables with
//    fewer than MIN_TABLE_ENTRIES are discarded as false positives.
//
// 4. DEDUPE. Tables found at the same address via 8-stride and 12-
//    stride: prefer the one with more valid entries.
//
// 5. EMIT. Per-table: address, stride, effect family (inferred from
//    first symbol prefix), and the (paramId, symbol) list.
//
// Cross-check against existing Phase 1 dump's 1,125 symbols: a
// successful run should land somewhere in the 800-1100 range (some
// symbols are layout strings like AMP_LAYOUT_BASIC, not in any
// ParamDescriptor table — same as on AM4/III).
//
// Output:
//   samples/captured/decoded/ghidra-axeedit2-paramtables.txt
//   samples/captured/decoded/ghidra-axeedit2-paramtables.json
//
// @category AxeFxII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class SeekParamTablesII extends GhidraScript {

    private static final String OUTPUT_TXT =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit2-paramtables.txt";
    private static final String OUTPUT_JSON =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit2-paramtables.json";

    // Fractal symbol family prefixes — same list as MineAxeEditII,
    // plus a few III-only families that may or may not appear on II.
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

    private static final int MAX_NAME_LEN = 96;
    private static final int MIN_TABLE_ENTRIES = 3;
    private static final int MAX_TABLE_ENTRIES = 1024;
    private static final int MAX_PARAM_ID = 1000;
    // 32-bit Windows PE — image base typically 0x00400000, image
    // size typically <0x02000000.
    private static final long PTR_MIN = 0x00400000L;
    private static final long PTR_MAX = 0x02000000L;

    private final List<String> txtLines = new ArrayList<>();
    private final List<String> jsonChunks = new ArrayList<>();

    private Memory mem;
    private AddressSpace as;

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

    // Phase 1: index all Fractal-symbol strings by virtual address.
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
                    // Must be NUL-terminated: byte before must be NUL or
                    // be at start of a memory block — otherwise it's a
                    // substring hit inside a longer string.
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
        int stride;
        List<int[]> entries = new ArrayList<>();   // (paramId, ptrAsInt)
        List<String> symbols = new ArrayList<>();
        String effectFamily;
    }

    // Try to extend a candidate seed at (addr, stride). Returns the
    // table or null if it doesn't reach MIN_TABLE_ENTRIES.
    private TableHit extendTable(Address seed, int stride, Map<Long, String> symbols) throws Exception {
        TableHit t = new TableHit();
        t.startAddr = seed.getOffset();
        t.stride = stride;
        for (int i = 0; i < MAX_TABLE_ENTRIES; i++) {
            Address entryAddr = seed.add((long) i * stride);
            int paramId;
            int ptr;
            try {
                paramId = readIntLE(entryAddr);
                ptr = readIntLE(entryAddr.add(stride - 4));
            } catch (Exception e) {
                break;
            }
            if (paramId == -1) break;
            // Plausibility: paramId small, ptr in image range and
            // points to a known symbol.
            if (paramId < 0 || paramId > MAX_PARAM_ID) break;
            long ptrL = ptr & 0xffffffffL;
            if (ptrL < PTR_MIN || ptrL > PTR_MAX) break;
            String sym = symbols.get(ptrL);
            if (sym == null) break;
            t.entries.add(new int[]{ paramId, ptr });
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

        w("================================================================================");
        w("Axe-Edit (II) param-table seeker — SeekParamTablesII.java");
        w("  program:    " + currentProgram.getName());
        w("  image base: " + currentProgram.getImageBase());
        w("================================================================================");

        // Phase 1: index symbols.
        w("");
        w("## Phase 1 — index Fractal-symbol strings");
        Map<Long, String> symbols = indexFractalSymbols();
        w("  " + symbols.size() + " Fractal symbols indexed");

        // Phase 2: scan all initialized memory blocks for table seeds.
        // For each 4-byte aligned offset, check both 8-stride and
        // 12-stride. Track best result per (startAddr) to dedupe.
        w("");
        w("## Phase 2 — seek ParamDescriptor patterns");
        Map<Long, TableHit> bestByAddr = new LinkedHashMap<>();
        long scanned = 0;
        int hitsRaw = 0;
        for (MemoryBlock block : mem.getBlocks()) {
            if (!block.isInitialized()) continue;
            if (block.isExecute()) continue; // skip .text
            Address start = block.getStart();
            Address end = block.getEnd();
            w("  scanning block " + block.getName() + " ["
                + start + " - " + end + "]");
            long n = block.getSize();
            for (long off = 0; off <= n - 8; off += 4) {
                if (monitor.isCancelled()) break;
                Address a = start.add(off);
                // Quick filter: paramId should be small int.
                int paramId;
                try {
                    paramId = readIntLE(a);
                } catch (Exception e) {
                    continue;
                }
                if (paramId < 0 || paramId > MAX_PARAM_ID) continue;
                // Try both strides.
                for (int stride : new int[]{ 8, 12 }) {
                    TableHit t = extendTable(a, stride, symbols);
                    if (t == null) continue;
                    hitsRaw++;
                    TableHit prev = bestByAddr.get(t.startAddr);
                    if (prev == null || t.entries.size() > prev.entries.size()) {
                        bestByAddr.put(t.startAddr, t);
                    }
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

        // Phase 3: drop tables that are subtables of other tables
        // (false matches starting at offset +stride into a larger
        // table). A table starting INSIDE another table's range is
        // discarded.
        w("");
        w("## Phase 3 — drop nested subtables");
        List<TableHit> tables = new ArrayList<>(bestByAddr.values());
        tables.sort((a, b) -> Long.compare(a.startAddr, b.startAddr));
        List<TableHit> keep = new ArrayList<>();
        for (TableHit t : tables) {
            boolean nested = false;
            for (TableHit other : keep) {
                long otherEnd = other.startAddr + (long) other.entries.size() * other.stride;
                if (t.startAddr > other.startAddr && t.startAddr < otherEnd) {
                    nested = true;
                    break;
                }
            }
            if (!nested) keep.add(t);
        }
        w("  " + keep.size() + " top-level tables after nesting filter");

        // Phase 4: emit.
        w("");
        w("## Phase 4 — discovered ParamDescriptor tables");
        keep.sort((a, b) -> Integer.compare(b.entries.size(), a.entries.size()));

        jsonChunks.add("{");
        jsonChunks.add("  \"_source\": \"SeekParamTablesII direct-scan over Axe-Edit.exe (II)\",");
        jsonChunks.add("  \"_strides_tested\": [8, 12],");
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
                + "  (stride=" + t.stride + ", entries=" + t.entries.size() + ")");
            for (int i = 0; i < t.entries.size(); i++) {
                w(String.format("  [%3d]  paramId=%-5d  %s",
                    i, t.entries.get(i)[0], t.symbols.get(i)));
            }

            if (!firstTable) jsonChunks.add(",");
            firstTable = false;
            jsonChunks.add("    {");
            jsonChunks.add("      \"startAddr\": \"0x" + Long.toHexString(t.startAddr) + "\",");
            jsonChunks.add("      \"stride\": " + t.stride + ",");
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
