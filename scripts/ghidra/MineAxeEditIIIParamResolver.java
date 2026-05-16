// MineAxeEditIIIParamResolver.java — Ghidra GhidraScript
//
// Focused follow-up to MineAxeEditIII.java. Hunts for the single
// most-valuable function in AxeEdit III: the one that resolves a
// symbolic parameter name (e.g. "REVERB_TIME", "GLOBAL_REVERBMIX")
// to its numeric wire paramId. That function's decompiled body is the
// entire III parameter dictionary in one xref-walk.
//
// Why we need this:
//   __block_layout.xml uses 8,643 parameter-name strings of the form
//   GLOBAL_*, EFFECT_*, REVERB_*, DELAY_*, AMP_*, DRIVE_*, CAB_*,
//   CHORUS_*, etc. The XML maps "where does this widget go" but NOT
//   "what wire paramId does GLOBAL_REVERBMIX correspond to." The
//   binary must do that mapping at startup (when it parses the XML
//   into AxeEdit's runtime state). The function that does this is the
//   gateway to the entire III SET_PARAM wire surface.
//
// How it works:
//   1. Scan the binary for every ASCII string matching one of the
//      parameter-symbol prefixes. (~600 unique strings; 8000+ raw hits
//      after counting duplicates.)
//   2. For each unique string, walk xrefs to its address, find the
//      containing function.
//   3. Rank functions by # of distinct param-symbol strings they
//      reference. The function at the top of the list is almost
//      certainly the resolver (it's the only place where the entire
//      enum is touched).
//   4. Decompile the top-3 functions in full. Also decompile their
//      direct callers (one level up) to see how the resolved paramId
//      flows downstream.
//
// Expected outcome:
//   The top function will be either:
//     (a) A giant switch on string-hash → integer (paramId enum value)
//     (b) A linear scan through a const char* paramNames[] array
//     (c) A hash-table lookup using a std::unordered_map or similar
//
//   In any of these cases, the decompiled C source will tell us:
//     - The structure of the lookup
//     - The integer paramId enum values for each symbol
//     - Whether there's a parallel data table elsewhere we can mine
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit3-paramresolver.txt
//
// Run after MineAxeEditIII.java has produced its overview dump. This
// script is targeted — it ignores everything except the param-symbol
// xref walk.
//
// @category AxeFxIII

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MineAxeEditIIIParamResolver extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit3-paramresolver.txt";

    // Param-symbol prefixes. The string-survey
    // (scripts/_research/analyze-param-symbol-tables.ts) confirms:
    //   GLOBAL_   746 raw / 249 unique
    //   EFFECT_  5765 raw /  62 unique
    //   REVERB_   213 raw /  71 unique
    //   DELAY_    267 raw /  89 unique
    //   CHORUS_    96 raw /  32 unique
    //   ID_     20490 raw / many (effect identifiers)
    // Plus AMP_, DRIVE_, CAB_, COMP_, EQ_, WAH_, PHASER_, FLANGER_,
    // PITCH_, FILTER_, GATE_, LOOPER_ etc. (TBD counts; included
    // defensively).
    private static final String[] PREFIXES = {
        "GLOBAL_", "EFFECT_",
        "REVERB_", "DELAY_", "CHORUS_", "AMP_", "DRIVE_", "CAB_",
        "DISTORT_", "COMP_", "EQ_", "WAH_", "PHASER_", "FLANGER_",
        "PITCH_", "FILTER_", "GATE_", "LOOPER_", "TREMOLO_", "ROTARY_",
        "ENHANCER_", "VOLUME_", "PAN_", "FUZZ_", "FORMANT_", "SYNTH_",
        "VOCODER_", "RINGMOD_", "RESONATOR_", "TONEMATCH_", "RTA_",
        "GRAPHEQ_", "PARAEQ_", "MIXER_", "MULTITAP_", "MEGATAP_",
        "PLEXDELAY_", "TENTAP_", "CROSSOVER_", "MULTIBAND_",
        "PERPRESET_", "FOOTSWITCH_", "SCENE_", "MODIFIER_", "ID_",
    };

    // Decompile the top-N resolvers by symbol-reference count.
    private static final int MAX_RESOLVERS_TO_DECOMPILE = 5;

    // For each top resolver, walk up to N callers.
    private static final int MAX_CALLERS_PER_RESOLVER = 5;

    private final List<String> lines = new ArrayList<>();
    private Program program;
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
        DecompileResults r = decomp.decompileFunction(f, 120, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    private boolean isAsciiPrintable(byte b) {
        return b >= 0x20 && b < 0x7f;
    }

    // Read a NUL-terminated ASCII string at the given address. Returns
    // null if the bytes aren't printable or the string is empty.
    private String readAsciizAt(Address addr) {
        try {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 128; i++) {
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

    // Walk the program's memory looking for occurrences of NUL-
    // terminated ASCII strings that start with any of our PREFIXES.
    // Returns a map of unique-string-value → list-of-addresses.
    private Map<String, List<Address>> findParamSymbols() throws Exception {
        Map<String, List<Address>> hits = new LinkedHashMap<>();
        for (String prefix : PREFIXES) {
            byte[] needle = prefix.getBytes(StandardCharsets.US_ASCII);
            Address from = program.getMinAddress();
            while (from != null) {
                Address hit = mem.findBytes(from, needle, null, true, monitor);
                if (hit == null) break;
                // Read the full string at this hit.
                String value = readAsciizAt(hit);
                if (value != null && value.startsWith(prefix)) {
                    hits.computeIfAbsent(value, k -> new ArrayList<>()).add(hit);
                }
                from = hit.add(1);
            }
            w("  scanned " + prefix + " — " + hits.size() + " unique symbols so far");
        }
        return hits;
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        mem = program.getMemory();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("Axe-Edit III RE — MineAxeEditIIIParamResolver.java");
        w("  program:    " + program.getName());
        w("  image base: " + program.getImageBase());
        w("================================================================================");

        w("\n## Phase 1 — scan binary for parameter-symbol strings");
        Map<String, List<Address>> symbols = findParamSymbols();
        w("\nTotal unique param-symbol strings found: " + symbols.size());

        w("\n## Phase 2 — collect xref-containing functions for each symbol");
        // function entry → set of unique symbols that reference it
        Map<Function, Set<String>> funcToSymbols = new LinkedHashMap<>();
        int totalRefs = 0;
        for (var entry : symbols.entrySet()) {
            String sym = entry.getKey();
            for (Address strAddr : entry.getValue()) {
                for (Reference r : refMgr.getReferencesTo(strAddr)) {
                    Function f = funcMgr.getFunctionContaining(r.getFromAddress());
                    if (f == null) continue;
                    funcToSymbols.computeIfAbsent(f, k -> new HashSet<>()).add(sym);
                    totalRefs++;
                }
            }
        }
        w("\nFunctions touching at least one param-symbol: " + funcToSymbols.size()
            + " (totalRefs=" + totalRefs + ")");

        w("\n## Phase 3 — rank functions by # of distinct symbols referenced");
        List<Map.Entry<Function, Set<String>>> ranked = new ArrayList<>(funcToSymbols.entrySet());
        ranked.sort((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()));
        w("\nTop 30 functions by symbol-reference count:");
        for (int i = 0; i < Math.min(30, ranked.size()); i++) {
            var e = ranked.get(i);
            w(String.format("  %3d. %4d symbols  %s @ %s",
                i + 1,
                e.getValue().size(),
                e.getKey().getName(),
                e.getKey().getEntryPoint()));
        }

        w("\n## Phase 4 — decompile the top resolver(s)");
        for (int i = 0; i < Math.min(MAX_RESOLVERS_TO_DECOMPILE, ranked.size()); i++) {
            var e = ranked.get(i);
            Function f = e.getKey();
            if (!alreadyDecompiled.add(f.getEntryPoint())) continue;

            w("\n################################################################################");
            w("# [RESOLVER #" + (i + 1) + ", " + e.getValue().size() + " symbols] "
                + f.getName() + " @ " + f.getEntryPoint());
            w("# signature: " + f.getSignature());
            w("# Sample symbols referenced (up to 30): "
                + e.getValue().stream().sorted().limit(30).toList());
            w("################################################################################");
            w(decompile(f));

            // Walk callers up to one level. These are the functions
            // that actually USE the resolver's output — they'll show
            // us how paramIds flow into SET_PARAM message builders.
            w("\n# --- callers of " + f.getName() + " (up to "
                + MAX_CALLERS_PER_RESOLVER + ") ---");
            int callerCount = 0;
            for (Reference r : refMgr.getReferencesTo(f.getEntryPoint())) {
                Function caller = funcMgr.getFunctionContaining(r.getFromAddress());
                if (caller == null) continue;
                if (!alreadyDecompiled.add(caller.getEntryPoint())) continue;
                w("\n# [CALLER of " + f.getName() + "] " + caller.getName() + " @ " + caller.getEntryPoint());
                w("# signature: " + caller.getSignature());
                w(decompile(caller));
                if (++callerCount >= MAX_CALLERS_PER_RESOLVER) break;
            }
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
