# Axe-Fx III — Community Capture Workflow

> **For community contributors with Axe-Fx III hardware.** This is the
> working backlog of capture sessions the project needs to elevate
> Axe-Fx III support from 🟡 scaffolded to 🟢 hardware-verified. Each
> task is a single ~30-minute USBPcap session producing a `.pcapng`
> capture + a short report.
>
> **Maintainers don't own an Axe-Fx III.** The protocol layer was
> scaffolded from Fractal's published "Axe-Fx III MIDI for Third-Party
> Devices" v1.4 PDF + AxeEdit III editor assets (block roster). What's
> shipped works under the spec; what's missing is everything Fractal
> deliberately left out of the public spec — primarily per-block
> parameter-ID space.

---

## Current support matrix (post v1.4 spec alignment — 2026-05-15)

| Tool / operation | Status | Wire reference |
|---|---|---|
| `list_midi_ports` (detect III) | 🟢 functional | Port-name regex |
| `describe_device(port: 'axe-fx-iii')` | 🟢 functional | Block roster + capabilities |
| `axefx3_list_blocks` | 🟢 functional | Pure data |
| `axefx3_switch_scene` / `get_active_scene` | 🟡 shipped | Function 0x0C |
| `axefx3_get_preset_name` | 🟡 shipped | Function 0x0D (returns preset # + name) |
| `axefx3_get_scene_name` | 🟡 shipped | Function 0x0E |
| `axefx3_set_bypass` / `get_bypass` | 🟡 shipped | Function 0x0A + Appendix 1 effect IDs |
| `axefx3_set_channel` / `get_channel` | 🟡 shipped | Function 0x0B |
| `axefx3_tempo_tap` | 🟡 shipped | Function 0x10 |
| `axefx3_set_tempo` / `get_tempo` | 🟡 shipped | Function 0x14 |
| `axefx3_set_tuner` | 🟡 shipped | Function 0x11 |
| `axefx3_set_looper` / `get_looper_state` | 🟡 shipped | Function 0x0F |
| `axefx3_status_dump` | 🟡 shipped | Function 0x13 |
| `axefx3_probe_sysex` | 🟢 functional | Raw send + inbound capture |
| `set_param` | 🔴 refused | Not in v1.4 — needs AxeEdit III sniffing |
| `save_preset` / `apply_preset` | 🔴 refused | Multi-frame envelope + Huffman-packed body |
| `switch_preset` (SysEx) | 🔴 refused | Use MIDI Program Change instead |
| AMP / NAM / Dynamic Distortion bypass | 🔴 effect ID unknown | STATUS_DUMP-against-preset will decode |

**🟡 status legend:** spec-correct per v1.4 PDF, not yet hardware-
verified. Project maintainer doesn't own an Axe-Fx III. The easiest
sanity check is `axefx3_get_preset_name` — load any preset on the
III's front panel, run the tool, and confirm the name + slot it
reports matches what's on the display. If it disagrees, the wire
shape we built from the spec differs from real-firmware behavior;
please open an issue with raw bytes (use `axefx3_probe_sysex` with
hex `F0 00 01 74 10 0D 7F 7F 18 F7`).

---

## How to contribute

### 1. Setup (~10 minutes, one-time)

You need:

- A working Axe-Fx III on its current firmware
- A Windows / macOS / Linux machine with the III connected via USB
- AxeEdit III installed (free from fractalaudio.com)
- A SysEx capture tool: USBPcap + Wireshark on Windows (free), Snoize MIDI Monitor on macOS (free)

Verify your capture pipeline can see SysEx flowing both directions:

1. Start the capture tool (filter to SysEx if possible)
2. Open AxeEdit III, click any preset
3. Confirm you see both outbound (AxeEdit → III) and inbound (III → AxeEdit) SysEx frames

If you see traffic both ways, you're good. If only one direction, your capture tool is sniffing one MIDI port; on Windows make sure USBPcap is sniffing the III's USB device, not a virtual MIDI port.

### 2. Pick a task below

The tasks are ordered roughly by impact — each one unlocks the next layer of support. Start at the top.

### 3. Capture + report

For each task:

1. **Start fresh** — close AxeEdit III, reopen it. Switch to a scratch preset (a preset you don't mind any changes landing on).
2. **Start capture.**
3. **Perform the exact action listed in the task.** Do ONLY that action. Background polling traffic is fine (the III auto-emits status updates) but additional knob turns / clicks beyond what the task says muddies the analysis.
4. **Stop capture.**
5. **Save the `.pcapng`** as `axefx3-hw-NNN-<task-slug>.pcapng` (e.g. `axefx3-hw-001-set-amp-gain.pcapng`).
6. **Write a one-paragraph report** describing: firmware version, what you did, what AxeEdit's UI showed, and any device-side display feedback (front panel readout changes).
7. **Share both files.** Open a GitHub issue at the project repo with the task ID + report; attach the `.pcapng`. Or DM the maintainer if the issue tracker has a different workflow at submission time.

---

## Task queue (priority order)

### HW-AXEFX3-001 — Effect-index discovery (STATUS_DUMP)

**Goal:** decode the effect-index → block-type mapping for one preset.

**Steps:**
1. Load a stock preset on the III that has at least: Compressor, Amp, Cab, Delay, Reverb (most factory presets do).
2. Start capture.
3. In AxeEdit III, simply click the preset to load it (this triggers a status broadcast).
4. Stop capture.

**What we'll learn:** the III emits function `0x13 STATUS_DUMP` triples (`id id dd`) for every block in the active preset. `id id` is a 2-byte effect-index; `dd` packs bypass + channel + channel-count. Decoding this gives us the effect-index space — which is the prerequisite for every write tool.

Pair with a screenshot or text list of WHICH blocks the preset has and at which grid positions, so we can correlate effect-index values to block types.

### HW-AXEFX3-002 — Single-param write (SET_PARAMETER_VALUE)

**Goal:** decode the per-block param-ID for ONE knob.

**Steps:**
1. Load the same preset as task 001.
2. Start capture.
3. In AxeEdit III, turn the **Amp 1 Drive** knob a single notch (e.g. 5.0 → 5.5).
4. Stop capture.

**What we'll learn:** the wire byte sequence for function `0x02 SET_PARAMETER_VALUE` applied to Amp.Drive. Combined with task 001's effect-index decode, we get one (block, param) pair confirmed. Repeating for a half-dozen amp params decodes the amp block; repeating for each block type populates the catalog.

### HW-AXEFX3-003 — Preset save envelope (STORE_PRESET)

**Goal:** decode the III's preset-save command shape.

**Steps:**
1. Load any scratch preset.
2. Start capture.
3. In AxeEdit III, click **Save** → confirm.
4. Stop capture.

**What we'll learn:** the function byte + payload structure for SAVE/STORE on the III. Fractal's public spec is silent on this (same gap Axe-Fx II had pre-Session-71); decoding it unblocks `save_preset` end-to-end.

### HW-AXEFX3-004 — Grid layout writes (block placement)

**Goal:** decode the III's grid placement + cable wire format.

**Steps:**
1. Start fresh on a scratch preset.
2. Start capture.
3. In AxeEdit III, drag a Delay block from the palette onto an empty grid cell.
4. Cable the new Delay into the chain (drag from the cell's input port to a sibling cell's output port).
5. Stop capture.

**What we'll learn:** III's analog to Axe-Fx II's `0x05 SET_GRID_CELL` + `0x06 SET_CELL_ROUTING`. Unblocks `apply_preset` topology authoring.

### HW-AXEFX3-005 — Dirty-state signal (front panel edit auto-push)

**Goal:** verify the III's `0x21 FRONT_PANEL_CHANGE` auto-push is the device-sourced dirty signal.

**Steps:**
1. Load any preset. Quit AxeEdit III (so it's not polling).
2. Start passive capture (no host tools sending).
3. Idle 30 seconds. Confirm 0 `0x21` frames.
4. On the device's front panel, turn any knob one notch.
5. Confirm `≥1` `0x21` frame fires.
6. Press the preset-switch button.
7. Confirm `0` `0x21` frames immediately after the switch (clean state).

**What we'll learn:** confirms (or refutes) that `0x21` is the dirty signal. If it fires on knob turns AND clears on switch_preset, we wire it into the safe-edit gate per the AM4 / Axe-Fx II contract. If it doesn't, we investigate `0x13 STATUS_DUMP` auto-emission as the fallback signal.

---

## Reference

- **Fractal published spec:** ["Axe-Fx III MIDI for Third-Party Devices" v1.4](https://www.fractalaudio.com/downloads/misc/Axe-Fx%20III%20MIDI%20for%203rd%20Party%20Devices.pdf)
- **Existing OSS prior art:**
  - [tysonlt/AxeFxControl](https://github.com/tysonlt/AxeFxControl) (GPL-3.0, Arduino, dormant 2023) — implements scene + preset + bypass + channel get/set. Useful as cross-reference.
  - [bspaulding/axe-fx-midi](https://github.com/bspaulding/axe-fx-midi) (MIT, Rust, dormant 2023) — parser/generator only, partial III coverage. Useful as reference.
- **Capture methodology:** [`scripts/capture-midi-passive.ts`](../../scripts/capture-midi-passive.ts) — the passive shared-read approach used to decode Axe-Fx II. Same approach applies to III.

---

## After landing each task

Maintainer workflow once a `.pcapng` + report arrive:

1. Decode the new wire bytes; update `packages/axe-fx-iii/src/setParam.ts` to remove the `pendingCapture()` throw for the relevant function.
2. Update `packages/axe-fx-iii/src/descriptor.ts` to remove the `betaRefusal()` for the relevant op.
3. If the decode revealed effect-index or param-ID values, populate `packages/axe-fx-iii/src/blockTypes.ts` / a new `params.ts`.
4. Add a byte-exact verifier in `scripts/verify-axe-fx-iii-*.ts` against the captured wire bytes (same pattern as `verify-msg.ts` for AM4).
5. Flip the support matrix at the top of this file from 🟡 / 🔴 to 🟢.
6. Update README to reflect the new tier of III support.

Each task unlocks 1–3 maintainer hours of integration work. The first capture session lifts the III from "tool stub" to "useful read surface"; ~5 sessions get us to feature parity with Axe-Fx II.
