// DumpMessageSchemas.java — read AxeEdit's message-schema tables.
//
// FUN_005503a0 and FUN_00551f00 are schema-driven SysEx payload builders.
// They walk global tables of 12-byte entries `{ fieldIndex, type, byteCount }`
// to assemble per-message-type payloads. The function byte for each is
// stored in a separate global (passed as the 3rd arg to FUN_0055d7a0).
//
// To find the routing-write schema we need to:
//   1. Read DAT_00f05094 — the function byte for FUN_005503a0's message
//      (likely 0x06 for routing).
//   2. Dump the entries in DAT_00e045b0 (4-field schema) and DAT_00e00770
//      (3-field schema). Each entry is 12 bytes = 3 ints. Walk until the
//      first int of an entry is -1 (terminator).
//   3. Cross-check by also looking for sibling builders (FUN_005503a0
//      pattern) in case there are more than just these two — the binary
//      may have one per message-type-family (set_param, set_grid_cell,
//      etc.).
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-message-schemas.txt
//
// @category AxeFxII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpMessageSchemas extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-message-schemas.txt";

    // Schema tables identified from the matched routing-builder candidates.
    // Each is an array of 12-byte entries { int fieldIndex; int type; int byteCount; }
    // terminated by an entry with fieldIndex == -1.
    private static final long[] TABLE_ADDRS = {
        0x00e045b0L,  // FUN_005503a0's table (4 fields)
        0x00e00770L,  // FUN_00551f00's table (3 fields)
    };

    // Function-byte globals — the 3rd arg passed to FUN_0055d7a0 in each
    // builder. Reading these tells us which Fractal SysEx function each
    // builder produces (0x06 = routing, 0x02 = SET_PARAM, etc.).
    private static final long[] FUNC_BYTE_ADDRS = {
        0x00f05094L,  // FUN_005503a0's fn byte
        // FUN_00551f00's fn byte address — we'll need to find it.
        // For now scan the function's body and report the address it loads from.
    };

    private final List<String> lines = new ArrayList<>();

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private int readIntLE(Memory mem, Address addr) throws Exception {
        // Little-endian 32-bit read.
        byte[] buf = new byte[4];
        mem.getBytes(addr, buf);
        return (buf[0] & 0xff)
            | ((buf[1] & 0xff) << 8)
            | ((buf[2] & 0xff) << 16)
            | ((buf[3] & 0xff) << 24);
    }

    private int readByte(Memory mem, Address addr) throws Exception {
        return mem.getByte(addr) & 0xff;
    }

    @Override
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();

        w("================================================================================");
        w("AxeEdit RE - DumpMessageSchemas.java");
        w("Dumps message-schema tables and function-byte globals.");
        w("================================================================================");

        // ---- Function-byte globals ----
        w("\n## Function-byte globals (3rd arg to FUN_0055d7a0)");
        for (long faddr : FUNC_BYTE_ADDRS) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(faddr);
            try {
                int b = readByte(mem, a);
                int i = readIntLE(mem, a);
                w("  DAT_" + Long.toHexString(faddr) + ":  byte=0x" + String.format("%02x", b)
                  + " (= " + b + ")"
                  + "  int32=0x" + Integer.toHexString(i) + " (= " + i + ")");
                if (b == 0x06) {
                    w("    *** = 0x06 = ROUTING-WRITE function byte. This is the schema we want. ***");
                }
            } catch (Exception e) {
                w("  DAT_" + Long.toHexString(faddr) + ": READ FAILED (" + e.getMessage() + ")");
            }
        }

        // ---- Schema tables ----
        for (long taddr : TABLE_ADDRS) {
            Address base = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(taddr);
            w("\n## Schema table at DAT_" + Long.toHexString(taddr));
            w("   entries are 12 bytes: { int fieldIndex; int type; int byteCount }; "
              + "terminator: fieldIndex == -1");
            w("   idx  fieldIndex   type     byteCount   notes");
            try {
                for (int i = 0; i < 32; i++) {  // safety cap
                    Address entry = base.add(i * 12L);
                    int fieldIndex = readIntLE(mem, entry);
                    if (fieldIndex == -1) {
                        w("   " + String.format("%3d", i) + "  TERMINATOR (-1)");
                        break;
                    }
                    int type = readIntLE(mem, entry.add(4));
                    int byteCount = readIntLE(mem, entry.add(8));
                    StringBuilder note = new StringBuilder();
                    if (byteCount == 1) note.append("1 byte (raw)");
                    else if (byteCount == 2) note.append("2 bytes (14-bit septet pair)");
                    else if (byteCount == 3) note.append("3 bytes (21-bit septet trio / packed value)");
                    else if (byteCount == 4) note.append("4 bytes (28-bit septet quad)");
                    else note.append(byteCount + " bytes");
                    w("   " + String.format("%3d", i)
                      + "  " + String.format("%-10d", fieldIndex)
                      + "  " + String.format("%-7d", type)
                      + "  " + String.format("%-9d", byteCount)
                      + "  " + note.toString());
                }
            } catch (Exception e) {
                w("   READ FAILED at offset " + e.getMessage());
            }
        }

        // ---- Dump small region around DAT_00f05094 to find sibling function-byte globals ----
        w("\n## Memory near DAT_00f05094 (looking for sibling function-byte globals)");
        try {
            Address near = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(0x00f05080L);
            for (int i = 0; i < 16; i++) {
                Address a = near.add(i * 4L);
                int v = readIntLE(mem, a);
                w("   DAT_" + Long.toHexString(a.getOffset()) + ":  int32=0x"
                  + String.format("%08x", v) + "  (low byte = 0x" + String.format("%02x", v & 0xff) + ")");
            }
        } catch (Exception e) {
            w("   READ FAILED: " + e.getMessage());
        }

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
