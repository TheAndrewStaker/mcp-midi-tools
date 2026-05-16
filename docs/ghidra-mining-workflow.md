# Ghidra mining workflow — Fractal editor binaries

**Read this before opening a new Ghidra project against any Fractal
editor binary** (AM4-Edit, Axe-Edit III, future FM3/FM9/VP4 editors).
The workflow is reusable across the family because every Fractal
editor shares the same per-effect parameter-dictionary architecture.

This document captures what worked, what didn't, and why — distilled
from Session 82's mining of AM4-Edit.exe + Axe-Edit III.exe.

---

## What the editors actually contain

Every Fractal editor binary embeds:

1. **A per-effect parameter-table dispatcher** — a switch statement
   keyed on an internal effect-type index (1..0x3c-ish range). Each
   case returns a pointer to a `-1`-terminated array of 16-byte
   `ParamDescriptor` structs.

2. **The ParamDescriptor struct (16 bytes, identical across editors):**

   ```c
   struct ParamDescriptor {
       int32   paramId;       // wire paramId (-1 terminates the array)
       int32   padding;       // always 0
       const char* nameStr;   // 64-bit pointer to NUL-terminated
                              // symbolic name like "REVERB_TIME"
   };
   ```

3. **Symbolic parameter-name strings** in `.rdata`, prefixed by effect
   family — `REVERB_*`, `DELAY_*`, `DISTORT_*`, `GLOBAL_*`, etc.
   Same naming convention across AM4-Edit and Axe-Edit III, confirms
   shared codebase ancestry.

4. **A `__block_layout.xml`** (and `__block_layout_expert.xml` on
   AM4-Edit) embedded as JUCE BinaryData, listing which paramIds get
   UI widgets per effect page. Useful for filtering the dispatcher
   catalog down to user-facing knobs (vs modifier slots / internal
   calc state).

5. **A generic SysEx message-builder** that takes the function byte
   as a runtime parameter. On Axe-Edit III this is `FUN_1403437d0`
   (v1.14.31). Tracing its callers reveals every function byte the
   editor emits.

The wire mapping is **direct** — no separate lookup function:

| Wire byte | Source |
|---|---|
| AM4 pidLow | block-type identifier (see `packages/am4/src/blockTypes.ts`) |
| AM4 pidHigh ≥ 10 | dispatcher paramId for that block-specific param |
| AM4 pidHigh 0..9 | generic shared param (0=level, 1=mix, 2=balance, 4=bypass_mode) |
| AM4 pidHigh = 2002 | channel-select register (different code path) |
| III effectId | Appendix 1 enum (ID_REVERB1=66, etc.) |
| III paramId | same as AM4 pidHigh — dispatcher paramId |

Verified at 99% match rate against existing hand-decoded
`packages/am4/src/params.ts` (Session 82).

---

## Headless runner pattern

All scripts ship with a `.cmd` runner under `scripts/ghidra/`. The
common invocation:

```bat
%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat ^
    "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "<binary.exe>" ^
    -noanalysis ^
    -readOnly ^
    -scriptPath "%SCRIPT_DIR%" ^
    -postScript <Script>.java
```

- `-noanalysis -readOnly` — never modifies the project. Auto-analysis
  is assumed done once via Ghidra GUI before headless runs.
- **The GUI must be fully closed** before headless can open the
  project (lock contention). If the GUI is open and you need
  headless, File → Exit (not just close the project view).
- Default Ghidra install: `C:\tools\ghidra_12.0.4_PUBLIC`. Override
  via `GHIDRA_INSTALL_DIR` env var.

Project locations (Session 82):
- `C:\Users\Steph\ghidra-am4-edit.gpr` → AM4-Edit.exe
- `C:\Users\Steph\ghidra-axe-edit-3.gpr` → Axe-Edit III.exe
- `C:\Users\Steph\ghidra-axe-edit.gpr` → Axe-Edit (II generation)

---

## Three-tier mining technique (proven)

Built from `scripts/ghidra/FindEncoder.java`'s pattern (the script
that successfully mined AM4-Edit's SET_PARAM encoder in earlier
sessions). All three tiers run in one script for max coverage:

### Tier 1 — Symbol-table walk

```java
SymbolIterator it = symTbl.getAllSymbols(true);
while (it.hasNext()) {
    Symbol s = it.next();
    String name = s.getName(true).toLowerCase(); // includes namespace
    for (String pattern : SYMBOL_PATTERNS) {
        if (name.contains(pattern)) { /* matched */ }
    }
}
```

Catches:
- Ghidra's auto-generated `s_<prefix>_<addr>` symbols (created by
  the String Analyzer at .rdata literals; xrefs to these are
  populated automatically and survive even when the data-ref
  analyzer didn't fully run)
- C++ mangled method names like `?SetParam@DebugSetParamDlg@@...`
- Class vftable symbols like `CableComponent::vftable`

### Tier 2 — Byte-pattern search

```java
AddressSetView init = memory.getAllInitializedAddressSet();
Address cur = init.getMinAddress();
while (cur != null) {
    Address hit = memory.findBytes(cur, pattern, null, true, monitor);
    if (hit == null) break;
    // process hit, advance cur
}
```

**Important**: use `getAllInitializedAddressSet()`, not
`program.getMinAddress() .. getMaxAddress()`. The latter spans into
external/uninitialized space (the III binary's max address ends in
the external space at 0xff0000xxxx; scanning there is wasted).

Useful patterns:
- `F0 00 01 74` — Fractal SysEx prefix (model byte loaded dynamically
  on III, so `F0 00 01 74 10` returns 0 hits — model byte 0x10 isn't
  a literal in the code. AM4 hardcodes its model byte 0x15 sometimes
  but more commonly also loads from a struct field.)
- Known parameter-table addresses if you've already found them

### Tier 3 — Instruction-walk fallback

```java
InstructionIterator it = listing.getInstructions(true);
while (it.hasNext()) {
    Instruction ins = it.next();
    for (int op = 0; op < ins.getNumOperands(); op++) {
        for (Object o : ins.getOpObjects(op)) {
            long addr = (o instanceof Address) ? ((Address)o).getOffset()
                     : (o instanceof Scalar) ? ((Scalar)o).getUnsignedValue()
                     : -1;
            if (targetSet.contains(addr)) { /* found xref to target */ }
        }
    }
    // Also try ins.getReferencesFrom() for Ghidra-resolved refs
    for (Reference r : ins.getReferencesFrom()) { /* ... */ }
}
```

Use this when Tier 1's symbol-table walk returns 0 matches for
strings that you KNOW are in the binary. Means Ghidra's data-ref
analyzer didn't link the LEA/MOV instructions to their data targets;
this walks instruction operands manually to find them.

**On a 20MB binary, instruction-walk scans ~1.4M instructions in
~30-60 seconds. Plan accordingly.**

---

## What DIDN'T work (Session 82 failure modes)

These cost a wall-time iteration each; documenting so we don't redo
them.

### 1. `mem.findBytes(needle)` + `refMgr.getReferencesTo(addr)`

The first III mining script (`MineAxeEditIII.java`, v1) used
`findBytes` to locate SYSEX_* strings, then `getReferencesTo` on
each string's address. Result: 0 refs across all 23 SYSEX_*
strings.

Why it failed: `getReferencesTo` returns refs the data-ref analyzer
has already populated. For 64-bit PE binaries (image base
0x140000000+), the data-ref analyzer needs to fully analyze every
LEA/MOV-with-immediate to populate refs to .rdata literals. If
auto-analysis didn't run all analyzers, or if it timed out, the
data refs are missing — even though the strings ARE in memory and
findable.

Fix: use the symbol-table walk (Tier 1) instead, or add the
instruction-walk fallback (Tier 3). Both are independent of the
data-ref analyzer's completeness.

### 2. Null-terminator inclusion in `findBytes` needles

The v1 script built needles as `"SYSEX_DSP_MESSAGE\0".getBytes(...)`.
This works for strings stored as exact literals BUT fails for cases
where the symbol appears as a prefix of a longer string. Example:
`"msg_getBlockString:..."` — searching for `"msg_getBlockString\0"`
returns 0 hits because the colon follows the symbol.

Fix: drop the NUL terminator from needles; verify matches by reading
the string at the hit address and checking it starts with the prefix.

### 3. Assuming the SysEx envelope is a byte literal

The III binary writes the SysEx envelope via runtime byte
construction:

```c
local_48 = 0x740100f0;    // F0 00 01 74 (little-endian)
local_44 = device_handle[0x30];  // model byte from struct field
local_43 = fn_byte;       // function byte
```

The model byte (`0x10` for III, `0x15` for AM4, `0x11` for FM3,
etc.) is loaded from a device-handle struct field at runtime. Byte-
pattern searches for `F0 00 01 74 10` return 0 hits on the III
binary; `F0 00 01 74` returns 7 hits (the actual emitters).

Fix: search for the shorter `F0 00 01 74` envelope. Each hit is a
SysEx-emitter function; the model byte and function byte are loaded
into adjacent local-variable bytes immediately afterward.

### 4. Assuming the param-table is a flat int array

The dispatcher's per-effect param tables are NOT `-1`-terminated
int arrays of paramIds — they're arrays of 16-byte structs (see
ParamDescriptor above). The first iteration of
`DumpAxeEditIIIParamTables.java` read every 4 bytes and broke on
-1, producing garbage (4 values per real entry, of which only the
first is paramId).

Fix: stride by 16 bytes per entry, read paramId at offset 0, name
pointer at offset 8 (64-bit LE).

---

## Dispatcher discovery recipe

To find the per-effect dispatcher on a new Fractal editor:

1. **Run `Mine<Editor>ParamResolver.java`** — byte-pattern scan for
   the parameter-symbol prefixes (REVERB_, DELAY_, EFFECT_, GLOBAL_,
   ID_, etc.); collect xrefs per symbol; rank functions by # of
   distinct symbols referenced.

2. **The top function with 20+ symbol references is the dispatcher.**
   On AM4-Edit it's `FUN_1402e3da0` (32 symbols). On Axe-Edit III
   it's `FUN_140397a40` (30 symbols). Single-digit reference counts
   mean Ghidra's data-ref analysis didn't fully run — fall back to
   the instruction-walk technique.

3. **Decompile the dispatcher.** The body is a switch statement
   with each case returning a pointer to a `DAT_xxxxxxxx` per-effect
   table. Effect-type internal enum values are 1..0x3b-ish; some
   cases share tables (`case 0x29-0x2d: piVar3 = &DAT_xxx;` — INPUT
   1-5 share params; `case 0x2e-0x31:` OUTPUT 1-4 share params).

4. **Extract the `DAT_xxxxxxxx` addresses.** Hardcode them as a
   `CASE_TO_DAT` table in a new `Dump<Editor>ParamNames.java` script.

5. **Read 16-byte ParamDescriptor structs at each DAT_xxx.**
   Dereference each `nameStr` pointer to get the parameter's
   symbolic name. Output: `(paramId, name)` pairs per effect family,
   per case index.

6. **Identify effect families by the prefix of the first param's
   name.** `REVERB_TYPE` → REVERB family, `DELAY_MODEL` → DELAY,
   etc. Effect-type internal-enum case index doesn't map directly
   to v1.4 Appendix 1 effect IDs — it's a separate internal
   ordering Fractal uses in editor code.

---

## Files produced by Session 82

Committed in commit `3262ea1` ("research: Ghidra-mine AM4-Edit +
Axe-Edit III parameter dictionaries").

### Per-Fractal-editor

| File | Purpose |
|---|---|
| `Mine<Editor>.java` / `Mine<Editor>v2.java` | Broad protocol-string xref walk; envelope byte-pattern hits; param-symbol rank |
| `Mine<Editor>ParamResolver.java` | Focused: rank functions by # of param-symbols referenced; decompile top resolver(s) |
| `Dump<Editor>ParamNames.java` | Extract per-effect `(paramId, name)` pairs from the dispatcher |
| `Dump<Editor>ParamTables[V2].java` | Earlier iterations; superseded by ParamNames |
| `Trace<Editor>MessageBuilders.java` | Walk callers of generic SysEx builder; enumerate fn bytes |
| `run-*.cmd` | Headless invocation wrappers |

### Analysis tooling (TS, runs locally)

| File | Purpose |
|---|---|
| `survey-axeedit3-anchors.ts` | Bucket strings JSON by prefix family (SYSEX_, msg_, CSV headers, etc.) — picks anchors for the Ghidra script |
| `analyze-param-symbol-tables.ts` | Find contiguous runs in the offset-sorted string list — detects const char* arrays |
| `mine-axeedit3-sysex-table.ts` | Extract+sort SYSEX_* strings; cross-anchor against v1.4 docs |
| `find-axeedit3-sysex-fnbyte-array.ts` | Scan binary for parallel u8/u16/u32 fn-byte arrays — negative result on III |
| `parse-ghidra-axeedit3-mine.ts` | Post-Ghidra structured extraction (switch-case bodies, decompile blocks) |
| `compare-am4-params-coverage.ts` / `v2.ts` | Audit `packages/am4/src/params.ts` against the Ghidra catalog |
| `generate-am4-params-from-catalog.ts` | Emit proposed `params.ts` entries from the catalog (uses verified pidLow/pidHigh mapping) |

---

## Cross-block addressing — when one family covers multiple blocks

Some Fractal devices route a single param family's catalog through
multiple wire-level block IDs. Verified Session 83 on AM4:

- **AMP + DRIVE both use the DISTORT family** (catalog case 0xa, 143
  params). Addressed via different pidLow values:
  - `amp` block: `pidLow = 0x003a`
  - `drive` block: `pidLow = 0x0076`

The anchor for finding these patterns is AM4-Edit's
`__block_layout.xml` `<EditorControls name="X" parameters="FAMILY_*">`
attribute. The "Amp" EditorControls entry explicitly references
`DISTORT_*` symbols, confirming the cross-pidLow mapping.

When validating against the catalog (see
`scripts/_research/validate-params-against-catalog.ts`), use the
reverse `pidLow → block` map to look up the actual family the wire
bytes target, rather than just the user-facing block tag in
`params.ts`.

## Non-placeable but wire-addressable blocks

`packages/am4/src/blockTypes.ts` lists only the slot-placeable
blocks (17 on AM4). The wire format addresses additional system
"blocks" via dedicated pidLows that aren't in that map. Confirmed
to date:

- `pidLow = 0x0025` — Input Noise Gate (params.ts `ingate.*`).
  Catalog family = INPUT (case 0x29). Validated: `ingate.threshold`
  pidHigh=10 matches `INPUT_THRESH` paramId 10.
- `pidLow = 0x003e` — Cabinet block (§6k). Catalog family = CABINET
  (case 0xb). 16 `amp.cab_*` entries in params.ts use this pidLow
  (the AM4 amp's integrated cab Expert page).
- PATCH family (case 0x3c, 85 params) — pidLow TBD. AM4-specific
  scene/routing/4CM/scene-MIDI params not in any current device file.
- GLOBAL family (case 0x1, 99 params) — pidLow TBD. System-wide
  settings (tuner mode, USB level, output config, etc.).

Future devices likely have analogous "system" pidLows. When mining
a new editor binary, look for catalog families that have no
corresponding entry in the device's blockTypes — those are
candidates for non-placeable system-block discovery via capture.

## Tips for the next session

- **Always close Ghidra GUI fully (File → Exit) before any headless
  run.** Closing just the project view leaves `javaw.exe` running
  and holds the project lock.
- **The strings JSON (`samples/captured/decoded/*-strings.json`)
  is gitignored but cheap to regenerate** via `extract-exe-strings.ts`.
  Re-run when the editor binary updates (e.g. new Axe-Edit III release).
- **JSON outputs are gitignored**; the Java scripts that produce
  them ARE committed. Re-running the `.cmd` files reproduces every
  artifact in ~1-5 minutes per script.
- **When adding a new Fractal device:** copy the existing
  `Mine<Editor>ParamResolver.java` + `Dump<Editor>ParamNames.java`,
  point them at the new project, change the `OUTPUT_PATH`. Most of
  the work is just running the scripts and copying the resulting
  CASE_TO_DAT table into the param-names dumper.
