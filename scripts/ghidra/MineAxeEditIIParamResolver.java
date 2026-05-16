// MineAxeEditIIParamResolver.java — Ghidra GhidraScript
//
// Port of MineAM4EditParamResolver.java to Axe-Edit.exe (the II
// generation, model byte 0x07). Hypothesis: II shares the codebase
// ancestry with AM4-Edit and AxeEdit III, so the same effect-type →
// param-table dispatcher pattern + the same symbolic-name convention
// (REVERB_*, DELAY_*, DISTORT_*, etc.) should be present.
//
// If true, this completes the Fractal-family parameter dictionary:
//   - AM4-Edit:    FUN_1402e3da0  → 1732 paramId/name pairs
//   - Axe-Edit III: FUN_140397a40  → 2216 paramId/name pairs
//   - Axe-Edit (II): FUN_???        → TBD (this script discovers it)
//
// The II spec differs from III/AM4 in function bytes (II uses 0x02
// SET_PARAMETER_VALUE; III/AM4 use 0x01) and Appendix-1-style effect
// IDs (separate enum). But the per-effect param dictionary
// structure should be identical.
//
// Output:
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit2-paramresolver.txt
//
// @category AxeFxII

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

public class MineAxeEditIIParamResolver extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-axeedit2-paramresolver.txt";

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
        "CABINET_", "DYNDIST_",
    };

    private static final int MAX_RESOLVERS_TO_DECOMPILE = 5;
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

    private Map<String, List<Address>> findParamSymbolsViaBytes() throws Exception {
        Map<String, List<Address>> hits = new LinkedHashMap<>();
        for (String prefix : PREFIXES) {
            byte[] needle = prefix.getBytes(StandardCharsets.US_ASCII);
            Address from = program.getMinAddress();
            while (from != null) {
                Address hit = mem.findBytes(from, needle, null, true, monitor);
                if (hit == null) break;
                String value = readAsciizAt(hit);
                if (value != null && value.startsWith(prefix)) {
                    hits.computeIfAbsent(value, k -> new ArrayList<>()).add(hit);
                }
                from = hit.add(1);
            }
        }
        w("  found " + hits.size() + " unique param strings via byte-pattern scan");
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
        w("Axe-Edit (II generation) RE — MineAxeEditIIParamResolver.java");
        w("  program:    " + program.getName());
        w("  image base: " + program.getImageBase());
        w("================================================================================");

        w("\n## Phase 1 — byte-pattern scan for parameter-symbol strings");
        Map<String, List<Address>> symbols = findParamSymbolsViaBytes();
        w("\nTotal unique param-symbol strings found: " + symbols.size());

        w("\n## Phase 2 — collect xref-containing functions for each symbol");
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
