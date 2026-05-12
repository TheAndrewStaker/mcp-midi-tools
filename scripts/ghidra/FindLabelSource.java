// FindLabelSource.java — Ghidra GhidraScript
//
// Goal: locate where AM4-Edit produces UI knob labels at runtime.
//
// Context (Session 46, 2026-05-03): Labels like "Treble", "Presence",
// "Sag", "Bright Cap" are NOT findable as plain bytes in AM4-Edit.exe
// in any encoding (ASCII, UTF-16LE/BE, Pascal, length-prefixed). They
// are also NOT in the cache file (verified — cache contains only enum
// value lists like amp model names, plus typecode/range data).
// Zlib-compressed-blob hypothesis was tested and disproved (only image
// data is compressed). So labels live somewhere we haven't inspected.
//
// Two remaining hypotheses to test:
//   A) Win32 string resources (.rsrc section). Labels accessed via
//      LoadStringA / LoadStringW / FindResource / LoadResource / MFC
//      AfxLoadString equivalents.
//   B) Custom encoding (XOR, offset, packed). Labels accessed via a
//      custom decoder function.
//
// This script:
//   1. Lists every xref to LoadStringA, LoadStringW, FindResourceA/W,
//      LoadResource, LockResource, AfxFindResource (MFC).
//   2. For each xref, decompiles the calling function so we can read
//      what's being requested and how the result is used.
//   3. Counts and dumps. The output goes to a file the founder sends
//      to Claude for follow-up analysis.
//
// Output:
//   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-label-source.txt
//
// How to run:
//   1. Open existing project at C:\Users\Steph\ghidra-am4-edit.gpr in
//      Ghidra. Open the AM4-Edit.exe program inside it.
//   2. Window -> Script Manager -> Manage Script Directories ->
//      add C:\dev\mcp-midi-tools\scripts\ghidra if not there.
//   3. Find FindLabelSource in the list, right-click -> Run.
//   4. When done (~1-3 minutes), send Claude the output file path.
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class FindLabelSource extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-label-source.txt";

    // Symbols of interest. Each is a Win32 / MFC API that AM4-Edit
    // would use if labels live in .rsrc string resources.
    private static final String[] TARGET_SYMBOLS = {
        // Win32 string-resource APIs
        "LoadStringA", "LoadStringW",
        "FindResourceA", "FindResourceW",
        "FindResourceExA", "FindResourceExW",
        "LoadResource", "LockResource",
        "SizeofResource",
        // MFC + ATL string-resource helpers
        "AfxLoadString", "AfxLoadStringW",
        "GetResource", "GetStringTable",
        // CRT / std::string helpers (in case labels are computed)
        "memcpy", // catches struct table copies
        // zlib / inflate (already disproved for labels but listed for completeness)
        "inflate", "uncompress",
    };

    // Cap on functions decompiled per target symbol — keeps output bounded.
    private static final int MAX_DECOMPILE_PER_SYMBOL = 10;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private SymbolTable symTab;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private DecompInterface decomp;

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private String hex(long v) { return "0x" + Long.toHexString(v); }

    private List<Symbol> findSymbols(String name) {
        List<Symbol> out = new ArrayList<>();
        SymbolIterator it = symTab.getSymbols(name);
        while (it.hasNext()) {
            Symbol s = it.next();
            if (s.getName().equals(name)) out.add(s);
        }
        return out;
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        symTab = program.getSymbolTable();
        funcMgr = program.getFunctionManager();
        refMgr = program.getReferenceManager();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("AM4-Edit RE - FindLabelSource.java");
        w("  target symbols: " + TARGET_SYMBOLS.length);
        w("  max decompile per symbol: " + MAX_DECOMPILE_PER_SYMBOL);
        w("================================================================================");

        for (String target : TARGET_SYMBOLS) {
            w("\n## " + target);
            List<Symbol> syms = findSymbols(target);
            if (syms.isEmpty()) {
                w("  (not imported / no symbol — skip)");
                continue;
            }
            for (Symbol sym : syms) {
                Address symAddr = sym.getAddress();
                w("  symbol at " + symAddr);

                // Enumerate xrefs (call sites) to this symbol.
                Set<Function> callers = new LinkedHashSet<>();
                for (Reference r : refMgr.getReferencesTo(symAddr)) {
                    Function f = funcMgr.getFunctionContaining(r.getFromAddress());
                    if (f != null) callers.add(f);
                    if (callers.size() <= 50) {
                        String fname = f == null ? "<no func>" : f.getName();
                        w("    xref from " + r.getFromAddress() + "  in " + fname);
                    }
                }
                if (callers.size() > 50) w("    (... and " + (callers.size() - 50) + " more)");
                w("    total caller functions: " + callers.size());

                // Decompile up to MAX_DECOMPILE_PER_SYMBOL caller functions.
                int n = 0;
                for (Function f : callers) {
                    if (n++ >= MAX_DECOMPILE_PER_SYMBOL) break;
                    w("\n  ----- decompile: " + f.getName() + " @ " + f.getEntryPoint() + " -----");
                    w("  signature: " + f.getSignature());
                    String body = decompile(f);
                    // Indent body for readability
                    for (String line : body.split("\n")) w("    " + line);
                }
            }
        }

        // Also check the .rsrc section size + entry count, to confirm
        // whether AM4-Edit even has a string-resource section worth
        // mining.
        w("\n## .rsrc section analysis");
        var memBlocks = program.getMemory().getBlocks();
        for (var blk : memBlocks) {
            if (blk.getName().toLowerCase().contains("rsrc")) {
                w("  block: " + blk.getName()
                    + "  start=" + blk.getStart()
                    + "  end=" + blk.getEnd()
                    + "  size=" + blk.getSize() + " bytes ("
                    + (blk.getSize() / 1024) + " KB)");
            }
        }

        // Dump output
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        } catch (Exception e) {
            println("ERROR writing output: " + e.getMessage());
            return;
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
