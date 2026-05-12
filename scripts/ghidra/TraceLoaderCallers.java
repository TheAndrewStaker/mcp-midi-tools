// TraceLoaderCallers.java — Ghidra GhidraScript
//
// Goal: trace who calls the AM4-Edit label-loader (FUN_14018fbd0 at
// 0x14018fbd0) and what they pass as the parsed-XML root (param_2).
// The loader walks a pre-parsed pugixml tree; the data source is
// upstream. Three plausible shapes for the source:
//
//   a) Static text in .rdata, parsed once via pugixml's load_string /
//      load_buffer.
//   b) A resource (Win32 LoadResource/LockResource OR Qt QResource).
//   c) A file on disk, opened via CreateFileA/W, fopen, QFile, etc.
//
// This script:
//   1. Walks a configurable list of "loader entry candidates" (default:
//      0x14018fbd0). For each, finds every xref TO it.
//   2. For each calling function, dumps a header (name, entry, body)
//      and the decompiled C.
//   3. Scans the calling function for noteworthy callees:
//        - Win32 resource APIs (LoadResource / LockResource /
//          FindResource / SizeofResource).
//        - File APIs (CreateFileA / CreateFileW / fopen / _wfopen).
//        - Qt-style symbols if present (QResource, QFile).
//        - Any function whose name contains "xml", "parse", "load",
//          "pugi", "Pugi" (heuristic catch).
//   4. Walks the caller's data references and surfaces any string
//      target in .rdata — likely candidates for a filename or a
//      resource ID.
//   5. Two depths: depth-1 callers (the immediate parents) AND
//      depth-2 callers (parent's parents). Some XML init functions
//      are wrapper-thin so depth-1 alone may not surface the data
//      source.
//
// Output: samples\captured\decoded\ghidra-loader-callers.txt
//
// How to run (GUI, since headless lock is contentious):
//   1. Open project at C:\Users\Steph\ghidra-am4-edit.gpr.
//   2. Window -> Script Manager -> add C:\dev\mcp-midi-tools\scripts\ghidra
//      to the script directories if not already present.
//   3. Find TraceLoaderCallers -> right-click -> Run.
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class TraceLoaderCallers extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-loader-callers.txt";

    // Loader entry offsets from imageBase. Add more as the
    // investigation widens.
    private static final long[] LOADER_ENTRY_OFFSETS = {
        0x18fbd0L,   // FUN_14018fbd0 — the EditorControl/EffectParameter parser.
    };

    // Heuristic substrings: any callee whose symbol matches gets
    // flagged. Case-insensitive.
    private static final String[] NOTEWORTHY = {
        "loadresource", "findresource", "sizeofresource", "lockresource",
        "loadstring",   // Win32 LoadStringA/W
        "createfile",   // Win32 CreateFileA/W
        "fopen", "wfopen",
        "qresource", "qfile",
        "pugi",         // pugixml symbols (load_buffer, load_string, …)
        "xml_parse", "xmlparse",
        "load_buffer", "load_string", "load_file",
        "inflate", "uncompress",  // double-check: still no zlib path
        "decode", "decompress",
    };

    // Depth-2 cap: if depth-1 has many callers, the depth-2 set
    // explodes. Keep bounded.
    private static final int MAX_DEPTH2_DECOMPILES = 8;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private FunctionManager funcMgr;
    private ReferenceManager refMgr;
    private SymbolTable symTab;
    private Listing listing;
    private Memory memory;
    private DecompInterface decomp;
    private Address imageBase;

    private void w(String s) { lines.add(s); println(s); }

    private boolean isNoteworthy(String name) {
        if (name == null) return false;
        String n = name.toLowerCase();
        for (String h : NOTEWORTHY) if (n.contains(h)) return true;
        return false;
    }

    private MemoryBlock blockOf(Address a) {
        return a == null ? null : memory.getBlock(a);
    }

    private String blockNameOf(Address a) {
        MemoryBlock b = blockOf(a);
        return b == null ? "?" : b.getName();
    }

    private String decompile(Function f) {
        if (f == null) return "// (no function)";
        DecompileResults r = decomp.decompileFunction(f, 90, monitor);
        if (!r.decompileCompleted()) return "// decompile failed: " + r.getErrorMessage();
        DecompiledFunction dc = r.getDecompiledFunction();
        return dc != null ? dc.getC() : "// (no decompiled function)";
    }

    private Set<Function> callersOf(Function f) {
        Set<Function> out = new LinkedHashSet<>();
        if (f == null) return out;
        for (Reference r : refMgr.getReferencesTo(f.getEntryPoint())) {
            if (!r.getReferenceType().isCall()) continue;
            Function caller = funcMgr.getFunctionContaining(r.getFromAddress());
            if (caller != null) out.add(caller);
        }
        return out;
    }

    /** Lists notable callees + interesting data refs in a function. */
    private void summarizeFunction(Function f) {
        if (f == null) return;

        List<String> notableCallees = new ArrayList<>();
        Set<Address> dataTargets = new LinkedHashSet<>();

        InstructionIterator it = listing.getInstructions(f.getBody(), true);
        while (it.hasNext()) {
            Instruction insn = it.next();
            if (insn.getFlowType().isCall()) {
                for (Reference r : insn.getReferencesFrom()) {
                    if (!r.getReferenceType().isCall()) continue;
                    Function callee = funcMgr.getFunctionAt(r.getToAddress());
                    if (callee == null) callee = funcMgr.getFunctionContaining(r.getToAddress());
                    String calleeName = callee == null ? null : callee.getName();
                    if (isNoteworthy(calleeName)) {
                        notableCallees.add("    " + insn.getAddress() + " -> " + calleeName);
                    }
                }
            }
            for (Reference r : insn.getReferencesFrom()) {
                if (r.getReferenceType().isData()) {
                    dataTargets.add(r.getToAddress());
                }
            }
        }

        if (!notableCallees.isEmpty()) {
            w("  notable callees:");
            for (String s : notableCallees) w(s);
        } else {
            w("  notable callees: (none)");
        }

        // Surface only string-shaped data targets in .rdata: look for
        // null-terminated ASCII at the target.
        w("  string-like .rdata refs:");
        int shown = 0;
        for (Address a : dataTargets) {
            MemoryBlock b = blockOf(a);
            if (b == null) continue;
            String bn = b.getName().toLowerCase();
            if (!bn.contains("rdata")) continue;
            String s = readCStringSafe(a, 96);
            if (s == null || s.length() < 2) continue;
            // Filter: only print when it looks like a meaningful string
            // (printable, has at least one alpha).
            boolean hasAlpha = false;
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (Character.isLetter(c)) { hasAlpha = true; break; }
            }
            if (!hasAlpha) continue;
            w("    " + a + "  \"" + s + "\"");
            if (++shown >= 25) {
                w("    (... more truncated)");
                break;
            }
        }
    }

    /** Reads a null-terminated ASCII string up to maxLen at addr. */
    private String readCStringSafe(Address a, int maxLen) {
        try {
            byte[] buf = new byte[maxLen];
            int n = memory.getBytes(a, buf);
            int end = 0;
            while (end < n && buf[end] != 0) end++;
            if (end == 0) return "";
            // Reject strings with non-printable bytes (binary noise).
            for (int i = 0; i < end; i++) {
                int c = buf[i] & 0xff;
                if (c < 0x20 || c >= 0x7f) {
                    if (c == 0x09 || c == 0x0a || c == 0x0d) continue;
                    return null;
                }
            }
            return new String(buf, 0, end, java.nio.charset.StandardCharsets.US_ASCII);
        } catch (MemoryAccessException e) {
            return null;
        }
    }

    @Override
    public void run() throws Exception {
        program = currentProgram;
        funcMgr = program.getFunctionManager();
        refMgr  = program.getReferenceManager();
        symTab  = program.getSymbolTable();
        listing = program.getListing();
        memory  = program.getMemory();
        decomp  = new DecompInterface();
        decomp.openProgram(program);

        imageBase = program.getImageBase();

        w("================================================================================");
        w("AM4-Edit RE — TraceLoaderCallers");
        w("  imageBase = " + imageBase);
        w("================================================================================");

        for (long entryOff : LOADER_ENTRY_OFFSETS) {
            Address entryAddr = imageBase.add(entryOff);
            Function loader = funcMgr.getFunctionAt(entryAddr);
            if (loader == null) loader = funcMgr.getFunctionContaining(entryAddr);
            if (loader == null) {
                w("\nFATAL: no function at " + entryAddr);
                continue;
            }

            w("\n## Loader: " + loader.getName() + " @ " + loader.getEntryPoint());
            w("   body: " + loader.getBody().getMinAddress() +
              " .. " + loader.getBody().getMaxAddress());

            Set<Function> depth1 = callersOf(loader);
            w("   depth-1 callers: " + depth1.size());

            // Decompile each depth-1 caller.
            int idx = 0;
            for (Function caller : depth1) {
                idx++;
                w("\n--- depth-1 #" + idx + ": " + caller.getName() +
                  " @ " + caller.getEntryPoint() +
                  " (block " + blockNameOf(caller.getEntryPoint()) + ") ---");
                w("  signature: " + caller.getSignature());
                summarizeFunction(caller);
                w("\n  decompilation:");
                for (String line : decompile(caller).split("\n")) w("    " + line);
            }

            // Walk depth-2 (callers' callers). Keep bounded.
            Set<Function> depth2 = new LinkedHashSet<>();
            for (Function c : depth1) depth2.addAll(callersOf(c));
            depth2.removeAll(depth1);
            depth2.remove(loader);
            w("\n## Depth-2 callers (parents of depth-1): " + depth2.size());

            int n = 0;
            for (Function caller : depth2) {
                if (n++ >= MAX_DEPTH2_DECOMPILES) {
                    w("\n  (... " + (depth2.size() - MAX_DEPTH2_DECOMPILES) +
                      " more depth-2 callers skipped)");
                    break;
                }
                w("\n--- depth-2 #" + n + ": " + caller.getName() +
                  " @ " + caller.getEntryPoint() +
                  " (block " + blockNameOf(caller.getEntryPoint()) + ") ---");
                w("  signature: " + caller.getSignature());
                summarizeFunction(caller);
                w("\n  decompilation:");
                for (String line : decompile(caller).split("\n")) w("    " + line);
            }
        }

        // Bonus pass: search the whole program's symbol table for any
        // "noteworthy" symbols. Useful even if no caller surfaces them
        // — confirms whether AM4-Edit links the API at all.
        w("\n================================================================================");
        w("NOTEWORTHY SYMBOLS in the program (for context)");
        w("================================================================================");
        for (Symbol s : symTab.getAllSymbols(true)) {
            if (isNoteworthy(s.getName()) && s.getSource() != SourceType.DEFAULT) {
                w("  " + s.getAddress() + "  " + s.getName() +
                  "  (" + (s.isExternal() ? "external" : "internal") + ")");
            }
        }

        // Write file
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String line : lines) pw.println(line);
        } catch (Exception e) {
            println("ERROR writing output: " + e.getMessage());
            return;
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
