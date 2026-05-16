// MineAxeEditIII.java — Ghidra GhidraScript
//
// One-shot comprehensive scrape of Axe-Edit III.exe (v1.14.31, the III
// generation, model byte 0x10). Targets every concrete lead we already
// know is in the binary, so the founder runs this once and Claude gets
// a single text dump back covering all of them.
//
// Targets (each becomes a section in the output):
//
//  A) SysEx header byte pattern `F0 00 01 74 10` — III envelope.
//     For each hit: dump the emitting function + up to N direct callers
//     (the per-function wrappers that build payloads before/after).
//     Mirrors the AxeEdit II workflow that produced ghidra-axeedit-
//     headers.txt (model byte 0x07 there).
//
//  B) SYSEX_* string-pool xrefs. 23 ASCII strings starting at .rdata
//     offset 0x5aaf80 in the file (see scripts/_research/mine-axeedit3-
//     sysex-table.ts). For each string the script:
//       - locates the address by content match (findBytes)
//       - lists all xrefs and their containing functions
//       - decompiles the union of those functions (deduped, capped)
//     The function that references ALL 23 strings is the enum-name
//     lookup (a switch statement); its body gives function-byte → name
//     for every SysEx function the III source defines. The function
//     that references ONE is the message-builder for that specific
//     SysEx function. Both are gold.
//
//  C) MIDI_ERROR_BAD_CHKSUM anchor. Already-known result code 0x00
//     (Session 81 decode). The function that references this string
//     processes inbound 0x64 MULTIPURPOSE_RESPONSE frames — useful
//     for understanding how the III emits error responses to the host.
//
//  D) Format-string anchors: msg_getBlockString, msg_getParamInfo,
//     msg_getCommonString. The functions that build these strings are
//     the param-info-by-id and block-string-by-id lookups. Their
//     bodies tell us how AxeEdit asks the III for per-block param
//     metadata (a wire request we don't yet know the shape of).
//
//  E) CSV export column headers — "EffectType", "Param Label",
//     "ParamId", "Type", "Units", "Precision", "Low Limit",
//     "High Limit", "Multiplier", "Resolution", "Strings". These
//     anchor AxeEdit's "export all params to CSV" code path. The
//     function that emits them is one xref-walk away from the data
//     table that feeds the export — which would be the full per-
//     effect parameter dictionary we currently lack.
//
//  F) Symbol-name pattern scan. Walks the entire symbol table and
//     dumps anything whose name contains: SysEx/sysex/Sysex, MIDI/Midi,
//     send.*[Mm]essage, build.*[Mm]essage, Fractal, dsp_usage,
//     getParam, encodePacket, decodePacket. Compact list — addresses
//     only — so we have a starting bibliography of potentially-named
//     functions in the binary.
//
//  G) Memory section summary: every PE section + size, so we know
//     where .text, .rdata, .data, .rsrc live for follow-up scans.
//
// Run:
//   1. Open the Ghidra project that has Axe-Edit III.exe imported.
//   2. Window → Script Manager → Manage Script Directories →
//      add C:\dev\mcp-midi-tools\scripts\ghidra if it isn't there.
//   3. Find MineAxeEditIII in the script list → right-click → Run.
//   4. Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-mine.txt
//
// Expected wall time: 5-15 minutes for full pass on a 20 MB binary
// (decompilation dominates). Adjust MAX_DECOMPILE_PER_TARGET if it
// takes too long.
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MineAxeEditIII extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-mine.txt";

    // 23 SYSEX_* names (from mine-axeedit3-sysex-table.ts, idx order).
    private static final String[] SYSEX_NAMES = {
        "SYSEX_A3_TUNER",
        "SYSEX_A3_TEMPO",
        "SYSEX_SETGET_LOOPER",
        "SYSEX_GET_SCENENAME",
        "SYSEX_FS_PASSTHRU_MESSAGE",
        "SYSEX_SETGET_TEMPO",
        "SYSEX_PATCH_STATUS",
        "SYSEX_GUI_CONTROL",
        "SYSEX_FS_MESSAGE",
        "SYSEX_DSP_MESSAGE",
        "SYSEX_GET_PATCHNAME",
        "SYSEX_SETGET_SCENE",
        "SYSEX_SETGET_CHANNEL",
        "SYSEX_SETGET_BYPASS",
        "SYSEX_FOOTSWITCH_END",
        "SYSEX_A3_SYSTEM_DATA_START",
        "SYSEX_SYSTEM_DUMP",
        "SYSEX_FOOTSWITCH_DUMP",
        "SYSEX_EFFECT_DUMP",
        "SYSEX_FOOTSWITCH_DATA",
        "SYSEX_FOOTSWITCH_START",
        "SYSEX_A3_SYSTEM_DATA_END",
        "SYSEX_A3_SYSTEM_DATA",
    };

    // Documented-by-v1.4 anchors. Used to label cases in the union-decompile.
    private static final Map<String, Integer> KNOWN_FN_BYTES = new LinkedHashMap<>() {{
        put("SYSEX_SETGET_BYPASS",  0x0A);
        put("SYSEX_SETGET_CHANNEL", 0x0B);
        put("SYSEX_SETGET_SCENE",   0x0C);
        put("SYSEX_GET_PATCHNAME",  0x0D);
        put("SYSEX_GET_SCENENAME",  0x0E);
        put("SYSEX_SETGET_LOOPER",  0x0F);
        put("SYSEX_PATCH_STATUS",   0x13);
        put("SYSEX_SETGET_TEMPO",   0x14);
    }};

    private static final String[] ERROR_ANCHORS = {
        "MIDI_ERROR_BAD_CHKSUM",       // 0x00 — first entry of the table
        "MIDI_ERROR_INVALID_FXID",     // 0x05 — anchor we already verified
        "MIDI_ERROR_DSP_OVERLOAD",     // 0x0C — handy mid-table anchor
    };

    private static final String[] FORMAT_ANCHORS = {
        "msg_getBlockString",
        "msg_getParamInfo",
        "msg_getCommonString",
    };

    private static final String[] CSV_ANCHORS = {
        "EffectType",
        "Param Label",
        "ParamId",
        "Low Limit",
        "High Limit",
        "Multiplier",
        "Resolution",
    };

    // Parameter-symbol anchors. 8,643 references in __block_layout.xml
    // use names like REVERB_TIME, DELAY_FEEDLR. The binary contains
    // these as ASCII strings (5,765 EFFECT_*, 213 REVERB_*, etc., per
    // scripts/_research/analyze-param-symbol-tables.ts). Each acts as
    // an anchor: the function that xrefs MANY of these is the symbol-
    // to-paramId resolver — its body tells us how AxeEdit converts
    // XML-style symbol names to wire-level paramIds (or paramId enums).
    //
    // Sample anchors only (one or two per block family). The full
    // table walk happens in MineAxeEditIIIParamResolver.java.
    private static final String[] PARAM_SYMBOL_ANCHORS = {
        // Reverb (we already know v1.4 documents Reverb)
        "REVERB_TYPE", "REVERB_TIME", "REVERB_MIX",
        // Delay
        "DELAY_TYPE", "DELAY_TEMPO", "DELAY_MIX",
        // Drive (DISTORT in Fractal's internal naming)
        "DISTORT_DRIVE", "DISTORT_LEVEL",
        // Amp
        "AMP_GAIN", "AMP_TYPE", "AMP_MASTER",
        // Cab
        "CAB_TYPE", "CAB_LEVEL",
        // Chorus
        "CHORUS_RATE", "CHORUS_DEPTH", "CHORUS_MIX",
        // Globals (system-wide, not per-block)
        "GLOBAL_REVERBMIX", "GLOBAL_TUNER_SOURCE", "GLOBAL_METRONOME",
        // Effect-type enum names (62 of these in the binary)
        "EFFECT_CAB", "EFFECT_DISTORT", "EFFECT_REVERB",
        // ID_* effect identifiers (the same as Appendix 1)
        "ID_CAB1", "ID_REVERB1", "ID_DISTORT1",
        // ID_* post-v1.4 additions confirmed to exist in the binary
        // (208-entry run @ 0x59d8b0 per analyze-param-symbol-tables.ts).
        // These don't appear in v1.4 Appendix 1; their wire IDs unlock
        // post-firmware-1.13 block addressing.
        "ID_DYNDIST1", "ID_SHUNT", "ID_PERFORM",
    };

    // High-value AxeEdit-internal function names that suggest message
    // builders / dump senders. Confirmed in the strings dump.
    private static final String[] FUNCTION_NAME_ANCHORS = {
        "SendFileSystem",   // 0x598a88 — likely sends SYSEX_SYSTEM_DUMP
        "SendFileBank",     // 0x598b00 — sends bank dump
        "SendFileCab",      // 0x598bc0 — sends cab IR dump
        "EffectParameter",  // 0x5e95a0 — likely the param container class
        "msg_getBlockString",
        "msg_getParamInfo",
    };

    // Symbol-name substrings of interest (case-insensitive contains).
    private static final String[] SYMBOL_PATTERNS = {
        "sysex", "Fractal", "fractal", "midi_send", "MidiSend",
        "buildMessage", "encodePacket", "decodePacket",
        "dsp_usage", "getParam", "blockString", "patchStatus",
        "looperState", "getTempo", "setTempo", "getScene",
    };

    // SysEx header byte pattern — III is model byte 0x10.
    private static final byte[] III_HEADER = { (byte)0xF0, 0x00, 0x01, 0x74, 0x10 };

    // Caps to keep wall-time bounded.
    private static final int MAX_DECOMPILE_PER_TARGET = 6;
    private static final int MAX_HEADER_CALLERS_PER_TARGET = 10;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private SymbolTable symTab;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private Memory mem;
    private DecompInterface decomp;
    private final Set<Address> alreadyDecompiled = new HashSet<>();

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

    private void decompileOnce(Function f, String tag) {
        if (f == null) return;
        if (!alreadyDecompiled.add(f.getEntryPoint())) {
            w("  (already dumped: " + f.getName() + " @ " + f.getEntryPoint() + ")");
            return;
        }
        w("\n  --- " + tag + ": " + f.getName() + " @ " + f.getEntryPoint() + " ---");
        w("  signature: " + f.getSignature());
        String body = decompile(f);
        for (String line : body.split("\n")) w("    " + line);
    }

    // Find all occurrences of a NUL-terminated ASCII string in the program's
    // .rdata-ish memory. Returns the addresses of the start of each match.
    private List<Address> findStringAddresses(String s) {
        byte[] needle = (s + "\0").getBytes(StandardCharsets.US_ASCII);
        List<Address> hits = new ArrayList<>();
        Address from = program.getMinAddress();
        while (from != null) {
            Address hit = mem.findBytes(from, needle, null, true, monitor);
            if (hit == null) break;
            hits.add(hit);
            from = hit.add(1);
        }
        return hits;
    }

    private Set<Function> functionsReferencing(Address strAddr) {
        Set<Function> out = new LinkedHashSet<>();
        for (Reference r : refMgr.getReferencesTo(strAddr)) {
            Function f = funcMgr.getFunctionContaining(r.getFromAddress());
            if (f != null) out.add(f);
        }
        return out;
    }

    // SECTION A — F0 00 01 74 10 byte-pattern scan
    private void sectionA() {
        w("\n\n================================================================================");
        w("SECTION A — III SysEx header byte pattern F0 00 01 74 10");
        w("================================================================================");
        List<Address> hits = new ArrayList<>();
        Address from = program.getMinAddress();
        while (from != null) {
            Address hit = mem.findBytes(from, III_HEADER, null, true, monitor);
            if (hit == null) break;
            hits.add(hit);
            from = hit.add(1);
        }
        w("Byte-pattern hits: " + hits.size());
        for (Address h : hits) {
            MemoryBlock block = mem.getBlock(h);
            String blockName = block == null ? "?" : block.getName();
            w("  hit @ " + h + " (section=" + blockName + ")");
        }
        // Decompile the function containing each code-section hit + up to N callers.
        Set<Function> emitters = new LinkedHashSet<>();
        for (Address h : hits) {
            Function f = funcMgr.getFunctionContaining(h);
            if (f != null) emitters.add(f);
        }
        w("\nDistinct emitting functions: " + emitters.size());
        for (Function f : emitters) {
            decompileOnce(f, "[EMITTER]");
            // Walk callers up to one level.
            int n = 0;
            for (Reference r : refMgr.getReferencesTo(f.getEntryPoint())) {
                Function caller = funcMgr.getFunctionContaining(r.getFromAddress());
                if (caller == null) continue;
                decompileOnce(caller, "[CALLER of " + f.getName() + "]");
                if (++n >= MAX_HEADER_CALLERS_PER_TARGET) break;
            }
        }
    }

    // SECTION B — SYSEX_* string-pool xrefs
    private void sectionB() {
        w("\n\n================================================================================");
        w("SECTION B — SYSEX_* string-pool xrefs");
        w("================================================================================");

        // Per-string xref map.
        Map<String, Set<Function>> stringToFuncs = new LinkedHashMap<>();
        Map<Function, Set<String>> funcToStrings = new LinkedHashMap<>();
        Map<String, List<Address>> stringAddrs = new LinkedHashMap<>();

        for (String s : SYSEX_NAMES) {
            List<Address> addrs = findStringAddresses(s);
            stringAddrs.put(s, addrs);
            if (addrs.isEmpty()) {
                w("  " + s + ": NOT FOUND in memory");
                continue;
            }
            Set<Function> refs = new LinkedHashSet<>();
            for (Address a : addrs) refs.addAll(functionsReferencing(a));
            stringToFuncs.put(s, refs);
            String fnByte = KNOWN_FN_BYTES.containsKey(s)
                ? String.format(" [v1.4: 0x%02X]", KNOWN_FN_BYTES.get(s))
                : "";
            w(String.format("  %-32s  @ %s  refs=%d%s",
                s, addrs.get(0), refs.size(), fnByte));
            for (Function f : refs) {
                funcToStrings.computeIfAbsent(f, k -> new LinkedHashSet<>()).add(s);
            }
        }

        // Identify the "enum-name lookup" function — references most/all strings.
        // The function that references all 23 is the most valuable single dump
        // (it's the switch (fn) → string lookup).
        w("\nFunctions ranked by SYSEX_* references:");
        funcToStrings.entrySet().stream()
            .sorted((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()))
            .limit(8)
            .forEach(e -> w(String.format("  %2d refs  %s @ %s",
                e.getValue().size(),
                e.getKey().getName(),
                e.getKey().getEntryPoint())));

        // Decompile top-ranked functions (enum-name lookup is here).
        w("\nDecompile top SYSEX_*-referencing functions:");
        int n = 0;
        for (var entry : funcToStrings.entrySet().stream()
            .sorted((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()))
            .toList()) {
            if (n++ >= MAX_DECOMPILE_PER_TARGET) break;
            decompileOnce(entry.getKey(),
                "[SYSEX_LOOKUP, " + entry.getValue().size() + " strings]");
        }

        // For each documented anchor, dump the single-string referencer
        // (likely the per-function message-builder for that fn).
        w("\nPer-string singleton referencers (single-fn message builders):");
        for (String s : KNOWN_FN_BYTES.keySet()) {
            Set<Function> refs = stringToFuncs.get(s);
            if (refs == null) continue;
            // Pick functions that reference ONLY this SYSEX_* string.
            for (Function f : refs) {
                Set<String> all = funcToStrings.get(f);
                if (all != null && all.size() == 1 && all.contains(s)) {
                    decompileOnce(f, "[BUILDER for " + s + " fn=0x"
                        + Integer.toHexString(KNOWN_FN_BYTES.get(s)) + "]");
                }
            }
        }
    }

    // SECTION C/D/E — generic string-anchor decompile
    private void sectionStringAnchors(String header, String[] anchors) {
        w("\n\n================================================================================");
        w(header);
        w("================================================================================");
        for (String s : anchors) {
            List<Address> addrs = findStringAddresses(s);
            if (addrs.isEmpty()) {
                w("\n## " + s + ": NOT FOUND in memory");
                continue;
            }
            w("\n## " + s + " @ " + addrs.get(0) + (addrs.size() > 1
                ? " (and " + (addrs.size() - 1) + " more occurrences)" : ""));
            Set<Function> refs = functionsReferencing(addrs.get(0));
            w("  caller functions: " + refs.size());
            int n = 0;
            for (Function f : refs) {
                if (n++ >= MAX_DECOMPILE_PER_TARGET) break;
                decompileOnce(f, "[ref " + s + "]");
            }
        }
    }

    // SECTION F — symbol-name pattern scan
    private void sectionF() {
        w("\n\n================================================================================");
        w("SECTION F — symbol-name pattern scan");
        w("================================================================================");
        SymbolIterator it = symTab.getSymbolIterator();
        int total = 0, matched = 0;
        Map<String, List<Symbol>> bucket = new LinkedHashMap<>();
        for (String p : SYMBOL_PATTERNS) bucket.put(p, new ArrayList<>());
        while (it.hasNext()) {
            Symbol s = it.next();
            total++;
            String n = s.getName();
            for (String p : SYMBOL_PATTERNS) {
                if (n.contains(p) || n.toLowerCase().contains(p.toLowerCase())) {
                    bucket.get(p).add(s);
                    matched++;
                    break;
                }
            }
        }
        w("Scanned " + total + " symbols; " + matched + " matched a pattern.");
        for (var entry : bucket.entrySet()) {
            if (entry.getValue().isEmpty()) continue;
            w("\n  pattern \"" + entry.getKey() + "\" — " + entry.getValue().size() + " matches:");
            for (Symbol s : entry.getValue()) {
                w("    " + s.getAddress() + "  " + s.getName());
            }
        }
    }

    // SECTION G — memory section summary
    private void sectionG() {
        w("\n\n================================================================================");
        w("SECTION G — PE memory section summary");
        w("================================================================================");
        for (MemoryBlock blk : mem.getBlocks()) {
            w(String.format("  %-12s  start=%s  end=%s  size=%d bytes (%d KB)  exec=%s read=%s write=%s",
                blk.getName(),
                blk.getStart(),
                blk.getEnd(),
                blk.getSize(),
                blk.getSize() / 1024,
                blk.isExecute(),
                blk.isRead(),
                blk.isWrite()));
        }
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        symTab = program.getSymbolTable();
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        mem = program.getMemory();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("Axe-Edit III RE — MineAxeEditIII.java");
        w("  program:           " + program.getName());
        w("  image base:        " + program.getImageBase());
        w("  min/max addresses: " + program.getMinAddress() + " .. " + program.getMaxAddress());
        w("================================================================================");

        sectionA();
        sectionB();
        sectionStringAnchors("SECTION C — MIDI_ERROR_* xrefs (0x64 response handler)", ERROR_ANCHORS);
        sectionStringAnchors("SECTION D — msg_* format-string xrefs (param/block lookup builders)", FORMAT_ANCHORS);
        sectionStringAnchors("SECTION E — CSV export column-header xrefs (parameter dictionary)", CSV_ANCHORS);
        sectionStringAnchors("SECTION E2 — parameter-symbol-name xrefs (symbol → paramId resolver)", PARAM_SYMBOL_ANCHORS);
        sectionStringAnchors("SECTION E3 — internal function-name string xrefs (SendFile*, msg_*, EffectParameter)", FUNCTION_NAME_ANCHORS);
        sectionF();
        sectionG();

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
