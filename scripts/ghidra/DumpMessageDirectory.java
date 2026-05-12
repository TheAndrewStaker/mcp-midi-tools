// DumpMessageDirectory.java — find ALL message types AxeEdit can build.
//
// The previous DumpMessageSchemas pass found a directory table starting
// around DAT_00f0509c containing (index, ptr) pairs. Each ptr targets a
// message-type struct in the 0x711900-0x711a00 region. By walking the
// directory and dereferencing each pointer, we should find the entry for
// function byte 0x06 (routing-write) AND the schema table that defines
// its payload byte layout.
//
// Strategy:
//   1. Walk DAT_00f0509c forward as (index, ptr) pairs until terminator.
//   2. For each pointer target (~0x711900 region), dump the first ~24
//      bytes as ints — looking for the structure
//      `{ int functionByte, int someFlag, int *schemaTable, ... }`.
//   3. For each candidate schemaTable pointer, dump the schema entries
//      `{ fieldIndex, type, byteCount }` until terminator.
//   4. Tag the entry whose functionByte matches 0x06 as the ROUTING-WRITE.
//
// Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-message-directory.txt
//
// @category AxeFxII

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.mem.Memory;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

public class DumpMessageDirectory extends GhidraScript {

    private static final String OUTPUT_PATH =
        "C:\\dev\\mcp-midi-tools\\samples\\captured\\decoded\\ghidra-message-directory.txt";

    // Walk this region as the message-type directory.
    private static final long DIRECTORY_START = 0x00f05080L;
    private static final long DIRECTORY_END   = 0x00f05300L;

    // When dereferencing pointers, only follow into these memory regions
    // (rough .data / .rdata bounds — adjust if dumps are nonsense).
    private static final long FOLLOW_MIN = 0x00700000L;
    private static final long FOLLOW_MAX = 0x00f00000L;

    private final List<String> lines = new ArrayList<>();

    private void w(String s) {
        lines.add(s);
        println(s);
    }

    private int readIntLE(Memory mem, Address addr) throws Exception {
        byte[] buf = new byte[4];
        mem.getBytes(addr, buf);
        return (buf[0] & 0xff)
            | ((buf[1] & 0xff) << 8)
            | ((buf[2] & 0xff) << 16)
            | ((buf[3] & 0xff) << 24);
    }

    private boolean inFollowRange(long ptr) {
        return ptr >= FOLLOW_MIN && ptr < FOLLOW_MAX;
    }

    private void dumpStructAtPtr(Memory mem, AddressSpace as, long ptr, String label) {
        if (!inFollowRange(ptr)) {
            w("    " + label + ": ptr=0x" + Long.toHexString(ptr) + " (out of follow range)");
            return;
        }
        Address a = as.getAddress(ptr);
        StringBuilder sb = new StringBuilder("    " + label + " (struct at 0x" + Long.toHexString(ptr) + "):");
        try {
            for (int i = 0; i < 8; i++) {
                int v = readIntLE(mem, a.add(i * 4L));
                sb.append(" [").append(i).append("]=0x").append(Integer.toHexString(v));
            }
            w(sb.toString());

            // First int often is functionByte (low byte). Flag if it's 0x06.
            int firstInt = readIntLE(mem, a);
            int firstByte = firstInt & 0xff;
            if (firstByte == 0x06) {
                w("      *** firstByte = 0x06 = ROUTING-WRITE function byte! ***");
            }
            // Third int often is a schema-table pointer.
            int thirdInt = readIntLE(mem, a.add(8));
            if (inFollowRange(thirdInt & 0xffffffffL)) {
                w("      possible schema-table ptr at [2]=0x" + Integer.toHexString(thirdInt));
                dumpSchemaTable(mem, as, thirdInt & 0xffffffffL, "          ");
            }
            // Fourth int similar check.
            int fourthInt = readIntLE(mem, a.add(12));
            if (fourthInt != thirdInt && inFollowRange(fourthInt & 0xffffffffL)) {
                w("      possible schema-table ptr at [3]=0x" + Integer.toHexString(fourthInt));
                dumpSchemaTable(mem, as, fourthInt & 0xffffffffL, "          ");
            }
        } catch (Exception e) {
            w(sb.toString() + " <read failed: " + e.getMessage() + ">");
        }
    }

    private void dumpSchemaTable(Memory mem, AddressSpace as, long ptr, String indent) {
        Address a = as.getAddress(ptr);
        try {
            for (int i = 0; i < 16; i++) {
                Address entry = a.add(i * 12L);
                int fieldIndex = readIntLE(mem, entry);
                if (fieldIndex == -1) {
                    w(indent + "[" + i + "] TERMINATOR (-1)");
                    return;
                }
                if (fieldIndex < -1 || fieldIndex > 1000) {
                    // Looks like not actually a schema table.
                    w(indent + "[" + i + "] non-schema (fieldIndex=" + fieldIndex + ") — likely not a schema table");
                    return;
                }
                int type = readIntLE(mem, entry.add(4));
                int byteCount = readIntLE(mem, entry.add(8));
                w(indent + "[" + i + "] field=" + fieldIndex + " type=" + type + " byteCount=" + byteCount);
            }
        } catch (Exception e) {
            w(indent + "(read failed: " + e.getMessage() + ")");
        }
    }

    @Override
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        AddressSpace as = currentProgram.getAddressFactory().getDefaultAddressSpace();

        w("================================================================================");
        w("AxeEdit RE - DumpMessageDirectory.java");
        w("Walks DAT_00f05080+ looking for the message-type registry.");
        w("================================================================================");

        // Walk the directory region as 4-byte ints, looking for the
        // (index, ptr) pair pattern. We don't know the exact layout yet,
        // so dump everything and let the human eye spot the structure.
        w("\n## Raw walk of 0x" + Long.toHexString(DIRECTORY_START) + "-0x" + Long.toHexString(DIRECTORY_END));
        long pairCount = 0;
        for (long off = DIRECTORY_START; off < DIRECTORY_END; off += 8) {
            Address a = as.getAddress(off);
            int v1 = readIntLE(mem, a);
            int v2 = readIntLE(mem, a.add(4));
            long ptrCandidate = v2 & 0xffffffffL;
            w("  +0x" + String.format("%04x", off - DIRECTORY_START)
              + "  [0x" + Long.toHexString(off) + "]"
              + "  v1=0x" + String.format("%08x", v1)
              + "  v2=0x" + String.format("%08x", v2)
              + (inFollowRange(ptrCandidate) ? "  ← v2 looks like a pointer" : ""));

            // If v1 looks like a small index AND v2 is a pointer into the
            // data region, treat this as an (index, ptr) entry and follow.
            if (v1 >= 0 && v1 < 256 && inFollowRange(ptrCandidate)) {
                pairCount++;
                dumpStructAtPtr(mem, as, ptrCandidate, "    pointee for index " + v1);
            }
        }
        w("\n  (followed " + pairCount + " (index, ptr) pairs)");

        try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_PATH))) {
            for (String s : lines) pw.println(s);
        }
        println("\nWrote " + lines.size() + " lines to " + OUTPUT_PATH);
    }
}
