// DumpResolverTables.java — Ghidra GhidraScript
//
// Followup to ExtractVariantResolver.java. cont 4's first pass found
// FUN_1402e3da0 as the per-effectType dispatcher (a switch with cases
// loading per-type DAT_14141XXXX tables, with parameterName-prefix
// strings cross-referenced). This script:
//
//   1. Dumps FUN_1402e3da0 in FULL (no line cap) so we see the lookup
//      loop after the switch.
//   2. Identifies every DAT_141xxxx address that FUN_1402e3da0 references
//      (the per-effectType tables) and hex-dumps 1024 bytes of each.
//   3. Lists every caller of FUN_1402e3da0 and decompiles them — one of
//      these is the bridge from the page-processor's vtable[2] indirect
//      call.
//   4. Identifies xrefs into each per-effectType table from the rest of
//      the binary — hints at the table size (number of entries).
//
// Output: samples/captured/decoded/ghidra-resolver-tables.txt
//
// @category AM4

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpResolverTables extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-resolver-tables.txt";

    private static final long ADDR_RESOLVER = 0x1402e3da0L;
    private static final int  TABLE_DUMP_BYTES = 2048;     // hex dump per table
    private static final int  CALLER_DECOMPILE_LIMIT = 15;
    private static final int  CALLER_LINE_LIMIT = 120;

    private final List<String> lines = new ArrayList<>();
    private Program program;
    private Memory memory;
    private FunctionManager funcMgr;
    private Listing listing;
    private ReferenceManager refMgr;
    private DecompInterface decomp;

    private void w(String s) { lines.add(s); println(s); }
    private static String hex(long v) { return "0x" + Long.toHexString(v); }

    private String hexDump(Address at, int len) {
        StringBuilder sb = new StringBuilder();
        long start = at.getOffset();
        byte[] buf = new byte[len];
        try {
            memory.getBytes(at, buf);
        } catch (Exception e) {
            return "  <cannot read: " + e.getMessage() + ">";
        }
        for (int row = 0; row < len; row += 16) {
            sb.append(String.format("  %s:  ", hex(start + row)));
            StringBuilder ascii = new StringBuilder();
            for (int col = 0; col < 16 && row + col < len; col++) {
                int b = buf[row + col] & 0xff;
                sb.append(String.format("%02x ", b));
                ascii.append((b >= 0x20 && b < 0x7f) ? (char) b : '.');
            }
            sb.append(" ").append(ascii).append("\n");
        }
        return sb.toString();
    }

    private long readQword(Address at) {
        try {
            byte[] b = new byte[8];
            memory.getBytes(at, b);
            long v = 0;
            for (int i = 7; i >= 0; i--) v = (v << 8) | (b[i] & 0xffL);
            return v;
        } catch (Exception e) {
            return 0;
        }
    }

    private int readDword(Address at) {
        try {
            byte[] b = new byte[4];
            memory.getBytes(at, b);
            return ((b[3] & 0xff) << 24) | ((b[2] & 0xff) << 16) | ((b[1] & 0xff) << 8) | (b[0] & 0xff);
        } catch (Exception e) {
            return 0;
        }
    }

    /** Read a null-terminated ASCII string at addr. Bounded by maxLen. */
    private String readCString(Address at, int maxLen) {
        StringBuilder sb = new StringBuilder();
        try {
            for (int i = 0; i < maxLen; i++) {
                byte b = memory.getByte(at.add(i));
                if (b == 0) break;
                if (b < 0x20 || b > 0x7e) return null;
                sb.append((char) (b & 0xff));
            }
        } catch (Exception e) {
            return null;
        }
        return sb.length() > 0 ? sb.toString() : null;
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
        memory = program.getMemory();
        funcMgr = program.getFunctionManager();
        listing = program.getListing();
        refMgr = program.getReferenceManager();
        decomp = new DecompInterface();
        decomp.openProgram(program);

        w("================================================================================");
        w("AM4-Edit RE — DumpResolverTables");
        w("  resolver: FUN_1402e3da0");
        w("================================================================================");

        Address resolverAddr = toAddr(ADDR_RESOLVER);
        Function resolver = funcMgr.getFunctionAt(resolverAddr);

        // 1. Full decompilation, no line cap.
        w("\n## Full decompilation: FUN_1402e3da0\n");
        String src = decompile(resolver);
        w(src);

        // 2. Find every data reference inside FUN_1402e3da0 — these are the
        // per-effectType DAT_141xxxx tables. Sweep instructions in the
        // function body.
        w("\n## Per-effectType data tables referenced by FUN_1402e3da0\n");
        Set<Long> tableAddrs = new TreeSet<>();
        if (resolver != null) {
            InstructionIterator it = listing.getInstructions(resolver.getBody(), true);
            while (it.hasNext()) {
                Instruction ins = it.next();
                for (int op = 0; op < ins.getNumOperands(); op++) {
                    for (Object o : ins.getOpObjects(op)) {
                        long v = -1;
                        if (o instanceof Address) v = ((Address) o).getOffset();
                        else if (o instanceof Scalar) v = ((Scalar) o).getUnsignedValue();
                        // .data block for DAT_141xxxx is roughly 0x141000000..0x14148b633.
                        if (v >= 0x141000000L && v <= 0x14148ffffL) {
                            tableAddrs.add(v);
                        }
                    }
                }
            }
        }
        w("  unique table addresses found: " + tableAddrs.size());
        for (long a : tableAddrs) w("    " + hex(a));

        // 3. Hex dump each table.
        w("\n## Hex dump of each table (" + TABLE_DUMP_BYTES + " bytes)\n");
        for (long a : tableAddrs) {
            w("\n--- TABLE " + hex(a) + " ---");
            Address tableAddr = toAddr(a);
            w(hexDump(tableAddr, TABLE_DUMP_BYTES));

            // Try to interpret as an array of {ptr, int} or similar.
            // Read the first 8 entries assuming 16-byte stride (common shape).
            w("  Interpretation guess (16-byte stride, {qword, dword, dword}):");
            for (int i = 0; i < 8; i++) {
                long entryAddr = a + i * 16L;
                long ptr = readQword(toAddr(entryAddr));
                int v1 = readDword(toAddr(entryAddr + 8));
                int v2 = readDword(toAddr(entryAddr + 12));
                String s = readCString(toAddr(ptr), 64);
                w(String.format("    [%d] qword=%-12s  dwords=%5d %5d  string=%s",
                    i, hex(ptr), v1, v2, s == null ? "(not a string)" : "\"" + s + "\""));
            }
            // Also try 12-byte stride (ptr + dword):
            w("  Interpretation guess (12-byte stride, {qword, dword}):");
            for (int i = 0; i < 8; i++) {
                long entryAddr = a + i * 12L;
                long ptr = readQword(toAddr(entryAddr));
                int v1 = readDword(toAddr(entryAddr + 8));
                String s = readCString(toAddr(ptr), 64);
                w(String.format("    [%d] qword=%-12s  dword=%5d  string=%s",
                    i, hex(ptr), v1, s == null ? "(not a string)" : "\"" + s + "\""));
            }
        }

        // 4. Callers of FUN_1402e3da0.
        w("\n## Callers of FUN_1402e3da0 (decompiled, up to "
            + CALLER_DECOMPILE_LIMIT + ")\n");
        Set<Address> callers = new LinkedHashSet<>();
        for (Reference ref : refMgr.getReferencesTo(resolverAddr)) {
            Function f = funcMgr.getFunctionContaining(ref.getFromAddress());
            if (f != null) callers.add(f.getEntryPoint());
        }
        w("  unique callers: " + callers.size());
        int ci = 0;
        for (Address fa : callers) {
            if (ci++ >= CALLER_DECOMPILE_LIMIT) break;
            Function f = funcMgr.getFunctionAt(fa);
            if (f == null) continue;
            w("\n--- caller " + ci + ": " + f.getName() + " @ " + fa + " ---");
            String csrc = decompile(f);
            String[] sl = csrc.split("\n");
            int show = Math.min(sl.length, CALLER_LINE_LIMIT);
            for (int li = 0; li < show; li++) w("  " + sl[li]);
            if (sl.length > show) w("  // ... (" + (sl.length - show) + " more lines)");
        }

        // 5. For each per-effectType table, count xrefs from the rest of the
        // binary. Many xrefs to a single table = many lookups OR many entries.
        w("\n## xref counts per table (referenced from anywhere in the binary)\n");
        for (long a : tableAddrs) {
            int n = 0;
            for (Reference r : refMgr.getReferencesTo(toAddr(a))) n++;
            w("  " + hex(a) + "  " + n + " xrefs");
        }

        dump();
    }

    private void dump() {
        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        } catch (Exception e) {
            println("ERROR writing output: " + e.getMessage());
            return;
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
