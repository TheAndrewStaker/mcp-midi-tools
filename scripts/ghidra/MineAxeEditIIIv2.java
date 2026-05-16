// MineAxeEditIIIv2.java — Ghidra GhidraScript
//
// Revision of MineAxeEditIII.java using the patterns proven against
// AM4-Edit.exe and Axe-Edit.exe (II generation) in
// scripts/ghidra/FindEncoder.java + FindAxeEditRouting.java. Those
// scripts produced 9k-85k useful lines per run; v1 of this script
// produced 1921 lines that were mostly "refs=0" because v1 relied on
// `findBytes` + `getReferencesTo(arbitraryAddr)`, which requires
// Ghidra's data-reference analyzer to have populated refs to every
// .rdata string. That analyzer did NOT run on this binary (verified
// by the v1 dump showing every SYSEX_*/MIDI_*/symbol anchor with
// `refs=0`).
//
// Techniques applied here:
//
//   1. Walk `symTbl.getAllSymbols(true)` with substring filters
//      (mangle-aware). Ghidra's String Analyzer creates `s_<prefix>_<addr>`
//      symbols for every literal it identifies in .rdata; refs to those
//      symbols are populated automatically and survive even when the
//      data-ref analyzer misses things. C++ method names mangle as
//      `?MethodName@ClassName@@...` and also surface via this walk.
//
//   2. Byte-search the SysEx envelope `F0 00 01 74 10` ACROSS
//      `getAllInitializedAddressSet()` only — not the full address space
//      (the III binary's max address spans into uninitialized external
//      space at 0xff0000xxxx). Each hit's containing function is added
//      to the decompile queue.
//
//   3. Instruction-walk fallback: walk every instruction in the
//      executable memory and check whether any operand resolves to a
//      target string address (the 23 SYSEX_* anchors at 0x1405abf80..
//      0x1405ac298 + selected param-symbol anchors). This catches refs
//      that Ghidra's data-ref analyzer missed but that decompilation
//      can still recognize.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-v2.txt
//
// @category AxeFxIII

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
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class MineAxeEditIIIv2 extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-v2.txt";

    // Symbol-name substring patterns (case-insensitive contains on the
    // full namespace-qualified symbol name). Ghidra's String Analyzer
    // creates `s_<text>_<address>` symbols; these patterns catch both
    // those and any C++ method/class names that mangle through. Order
    // matters only for which bucket a symbol gets assigned to (first
    // match wins).
    private static final String[] SYMBOL_PATTERNS = {
        // Protocol-enum strings (most valuable)
        "sysex_", "midi_error_", "midi_in", "midi_out",
        // msg_* format strings — param/block info builders
        "msg_get", "msg_set", "msg_send", "msg_send_",
        // Parameter-symbol strings used by __block_layout.xml
        "reverb_", "delay_", "chorus_", "distort_", "comp_", "wah_",
        "phaser_", "flanger_", "pitch_", "filter_", "gate_", "looper_",
        "fuzz_", "formant_", "synth_", "vocoder_", "ringmod_",
        "resonator_", "tonematch_", "mixer_", "multitap_", "megatap_",
        "plexdelay_", "tentap_", "crossover_", "multiband_",
        "perpreset_", "footswitch_",
        // Block-type / effect-id enum strings
        "id_distort", "id_reverb", "id_delay", "id_cab", "id_chorus",
        "id_dyndist", "id_shunt", "id_perform", "id_ctrl",
        "effect_", "global_",
        // Function name hints (sendfilesystem, etc.)
        "sendfile", "sendsysex", "sendmidi", "sendmessage", "buildmessage",
        "encodepacket", "decodepacket", "encodemessage", "decodemessage",
        "fractalbot", "fractal_", "axefx", "axeedit",
        // Resolver-pattern hints
        "getparam", "setparam", "getparaminfo", "paramlist", "paramtable",
        "effecttype", "effectparam", "blockparam",
        // C++ class names worth dumping vftables of
        "midiengine", "midimanager", "midicontroller", "sysexmanager",
        "messagebuilder", "messagebuilder",
    };

    // SysEx envelope byte patterns for III (model byte 0x10).
    private static final byte[] III_ENVELOPE_FULL = {
        (byte) 0xF0, 0x00, 0x01, 0x74, 0x10,
    };
    private static final byte[] III_ENVELOPE_SHORT = {
        (byte) 0xF0, 0x00, 0x01, 0x74,
    };

    // Target string addresses for the instruction-walk fallback. These
    // are the 23 SYSEX_* anchor strings; any LEA/MOV instruction with
    // an operand resolving to one of these is a reference, regardless
    // of whether Ghidra's data-ref analyzer caught it.
    private static final long[] SYSEX_STRING_ADDRS = {
        0x1405abf80L, // SYSEX_A3_TUNER
        0x1405abf90L, // SYSEX_A3_TEMPO
        0x1405abfa0L, // SYSEX_SETGET_LOOPER (fn 0x0F)
        0x1405abfb8L, // SYSEX_GET_SCENENAME (fn 0x0E)
        0x1405abfd0L, // SYSEX_FS_PASSTHRU_MESSAGE
        0x1405abff8L, // SYSEX_SETGET_TEMPO (fn 0x14)
        0x1405ac010L, // SYSEX_PATCH_STATUS (fn 0x13)
        0x1405ac028L, // SYSEX_GUI_CONTROL
        0x1405ac048L, // SYSEX_FS_MESSAGE
        0x1405ac070L, // SYSEX_DSP_MESSAGE
        0x1405ac0b8L, // SYSEX_GET_PATCHNAME (fn 0x0D)
        0x1405ac0d0L, // SYSEX_SETGET_SCENE (fn 0x0C)
        0x1405ac0e8L, // SYSEX_SETGET_CHANNEL (fn 0x0B)
        0x1405ac100L, // SYSEX_SETGET_BYPASS (fn 0x0A)
        0x1405ac150L, // SYSEX_FOOTSWITCH_END
        0x1405ac1c0L, // SYSEX_A3_SYSTEM_DATA_START
        0x1405ac1e0L, // SYSEX_SYSTEM_DUMP
        0x1405ac200L, // SYSEX_FOOTSWITCH_DUMP
        0x1405ac218L, // SYSEX_EFFECT_DUMP
        0x1405ac238L, // SYSEX_FOOTSWITCH_DATA
        0x1405ac250L, // SYSEX_FOOTSWITCH_START
        0x1405ac268L, // SYSEX_A3_SYSTEM_DATA_END
        0x1405ac298L, // SYSEX_A3_SYSTEM_DATA
    };

    private static final int MAX_BYTE_PATTERN_HITS = 100;
    private static final int MAX_SYMBOLS_TO_DECOMPILE = 30;
    private static final int MAX_INSTRUCTION_XREF_FUNCS = 30;

    private final List<String> lines = new ArrayList<>();
    private DecompInterface decomp;
    private Program program;
    private Memory memory;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private SymbolTable symTbl;
    private Listing listing;
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

    private void decompileOnce(Function f, String label) {
        if (f == null) return;
        if (!alreadyDecompiled.add(f.getEntryPoint())) {
            w("  (already dumped: " + f.getName() + " @ " + f.getEntryPoint() + ")");
            return;
        }
        w("\n  --- " + label + ": " + f.getName() + " @ " + f.getEntryPoint() + " ---");
        w("  signature: " + f.getSignature());
        String body = decompile(f);
        for (String line : body.split("\n")) w("    " + line);
    }

    private List<Address> findBytePattern(byte[] pat, int max) throws Exception {
        List<Address> found = new ArrayList<>();
        AddressSetView init = memory.getAllInitializedAddressSet();
        Address cur = init.getMinAddress();
        Address end = init.getMaxAddress();
        while (cur != null && cur.compareTo(end) <= 0) {
            Address hit = memory.findBytes(cur, pat, null, true, monitor);
            if (hit == null) break;
            found.add(hit);
            cur = hit.add(1);
            if (found.size() >= max) break;
        }
        return found;
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        memory = program.getMemory();
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        symTbl = program.getSymbolTable();
        listing = program.getListing();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("Axe-Edit III RE — MineAxeEditIIIv2.java");
        w("  Uses the proven AM4-Edit pattern: symbol-table walk +");
        w("  byte-pattern search + instruction-operand walk.");
        w("================================================================================");

        // ---- 1. Symbol-table walk ----
        w("\n## SECTION 1 — Symbol-table walk (Ghidra's s_XXX strings + C++ classes)");
        Map<String, List<Symbol>> buckets = new LinkedHashMap<>();
        for (String p : SYMBOL_PATTERNS) buckets.put(p, new ArrayList<>());

        SymbolIterator allSyms = symTbl.getAllSymbols(true);
        int symCount = 0;
        int symMatches = 0;
        while (allSyms.hasNext()) {
            Symbol s = allSyms.next();
            symCount++;
            String nm = s.getName(true).toLowerCase();
            for (String p : SYMBOL_PATTERNS) {
                if (nm.contains(p)) {
                    buckets.get(p).add(s);
                    symMatches++;
                    break;
                }
            }
        }
        w("Scanned " + symCount + " symbols; " + symMatches + " matched a pattern.");
        for (var entry : buckets.entrySet()) {
            if (entry.getValue().isEmpty()) continue;
            w("\n  pattern \"" + entry.getKey() + "\" — " + entry.getValue().size() + " matches:");
            int cap = 0;
            for (Symbol s : entry.getValue()) {
                Function f = funcMgr.getFunctionContaining(s.getAddress());
                String fnInfo = f == null ? "(not in function)" : "func=" + f.getName();
                w("    " + s.getAddress() + "  " + s.getName(true) + "  " + fnInfo);
                if (cap++ >= 30) {
                    w("    … (" + (entry.getValue().size() - 30) + " more)");
                    break;
                }
            }
        }

        // ---- 2. Byte-pattern search: III SysEx envelope ----
        w("\n## SECTION 2 — Byte-pattern search: F0 00 01 74 10 (III envelope)");
        List<Address> envHits = findBytePattern(III_ENVELOPE_FULL, MAX_BYTE_PATTERN_HITS);
        w("  hits (full envelope incl. model byte): " + envHits.size());
        Set<Function> envEmitters = new LinkedHashSet<>();
        for (Address h : envHits) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            if (f != null) envEmitters.add(f);
        }

        w("\n## SECTION 2b — Byte-pattern search: F0 00 01 74 (envelope without model)");
        List<Address> envShortHits = findBytePattern(III_ENVELOPE_SHORT, MAX_BYTE_PATTERN_HITS);
        w("  hits (envelope without model byte): " + envShortHits.size());
        for (Address h : envShortHits.subList(0, Math.min(40, envShortHits.size()))) {
            MemoryBlock blk = memory.getBlock(h);
            String blkName = blk == null ? "?" : blk.getName();
            Function f = funcMgr.getFunctionContaining(h);
            String fname = f == null ? "<no func>" : f.getName();
            w("    " + h + "  block=" + blkName + "  func=" + fname);
            if (f != null) envEmitters.add(f);
        }

        // ---- 3. Instruction-walk fallback ----
        w("\n## SECTION 3 — Instruction-walk: operands resolving to SYSEX_* string addresses");
        Set<Long> targetSet = new HashSet<>();
        for (long a : SYSEX_STRING_ADDRS) targetSet.add(a);

        InstructionIterator allIns = listing.getInstructions(true);
        int insScanned = 0;
        int insMatches = 0;
        Map<Long, List<Function>> targetToFuncs = new HashMap<>();
        for (long a : SYSEX_STRING_ADDRS) targetToFuncs.put(a, new ArrayList<>());

        while (allIns.hasNext()) {
            Instruction ins = allIns.next();
            insScanned++;
            for (int op = 0; op < ins.getNumOperands(); op++) {
                Object[] objs = ins.getOpObjects(op);
                for (Object o : objs) {
                    long addr = -1;
                    if (o instanceof Address) addr = ((Address) o).getOffset();
                    else if (o instanceof Scalar) addr = ((Scalar) o).getUnsignedValue();
                    if (addr < 0) continue;
                    if (!targetSet.contains(addr)) continue;
                    Function f = funcMgr.getFunctionContaining(ins.getAddress());
                    if (f == null) continue;
                    targetToFuncs.get(addr).add(f);
                    insMatches++;
                }
            }
            // Also try ins.getReferencesFrom() — Ghidra-resolved refs.
            for (Reference r : ins.getReferencesFrom()) {
                long toAddr = r.getToAddress().getOffset();
                if (!targetSet.contains(toAddr)) continue;
                Function f = funcMgr.getFunctionContaining(ins.getAddress());
                if (f == null) continue;
                List<Function> list = targetToFuncs.get(toAddr);
                if (!list.contains(f)) {
                    list.add(f);
                    insMatches++;
                }
            }
        }
        w("  scanned " + insScanned + " instructions; " + insMatches + " operand matches");

        // Per-target summary
        String[] targetNames = {
            "SYSEX_A3_TUNER", "SYSEX_A3_TEMPO", "SYSEX_SETGET_LOOPER", "SYSEX_GET_SCENENAME",
            "SYSEX_FS_PASSTHRU_MESSAGE", "SYSEX_SETGET_TEMPO", "SYSEX_PATCH_STATUS",
            "SYSEX_GUI_CONTROL", "SYSEX_FS_MESSAGE", "SYSEX_DSP_MESSAGE",
            "SYSEX_GET_PATCHNAME", "SYSEX_SETGET_SCENE", "SYSEX_SETGET_CHANNEL",
            "SYSEX_SETGET_BYPASS", "SYSEX_FOOTSWITCH_END", "SYSEX_A3_SYSTEM_DATA_START",
            "SYSEX_SYSTEM_DUMP", "SYSEX_FOOTSWITCH_DUMP", "SYSEX_EFFECT_DUMP",
            "SYSEX_FOOTSWITCH_DATA", "SYSEX_FOOTSWITCH_START", "SYSEX_A3_SYSTEM_DATA_END",
            "SYSEX_A3_SYSTEM_DATA",
        };
        w("\n  Per-SYSEX_* string xref counts (deduped functions):");
        Map<Function, Integer> funcToSymbolCount = new HashMap<>();
        for (int i = 0; i < SYSEX_STRING_ADDRS.length; i++) {
            Set<Function> seen = new LinkedHashSet<>(targetToFuncs.get(SYSEX_STRING_ADDRS[i]));
            w("    " + targetNames[i] + "  @ 0x" + Long.toHexString(SYSEX_STRING_ADDRS[i])
                + "  → " + seen.size() + " functions");
            for (Function f : seen) {
                funcToSymbolCount.merge(f, 1, Integer::sum);
            }
        }

        w("\n## SECTION 4 — Functions ranked by # of SYSEX_* string operands");
        List<Map.Entry<Function, Integer>> ranked = new ArrayList<>(funcToSymbolCount.entrySet());
        ranked.sort((a, b) -> Integer.compare(b.getValue(), a.getValue()));
        for (int i = 0; i < Math.min(15, ranked.size()); i++) {
            var e = ranked.get(i);
            w(String.format("  %3d. %2d symbols  %s @ %s",
                i + 1, e.getValue(), e.getKey().getName(), e.getKey().getEntryPoint()));
        }

        // ---- 4. Decompile the highest-value functions ----
        w("\n## SECTION 5 — Decompile candidates");

        // Priority order: envelope emitters first, then top SYSEX_*-ref'd functions.
        Set<Function> toDump = new LinkedHashSet<>(envEmitters);
        for (var e : ranked) {
            if (toDump.size() >= MAX_SYMBOLS_TO_DECOMPILE) break;
            toDump.add(e.getKey());
        }

        for (Function f : toDump) {
            String tag = envEmitters.contains(f)
                ? "[ENVELOPE EMITTER]"
                : "[SYSEX-XREF (" + funcToSymbolCount.getOrDefault(f, 0) + " syms)]";
            decompileOnce(f, tag);
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
