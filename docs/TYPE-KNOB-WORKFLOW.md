# Type-Knob Compatibility Workflow

The cross-device contract that prevents silent-no-op writes when a
block's `type` enum value doesn't expose every knob the agent is
about to set. Companion to [SAFE-EDIT-WORKFLOW.md](./SAFE-EDIT-WORKFLOW.md);
same shape, same intent.

**The rule, one sentence:** when a block has a `type` enum, picking
the wrong type for the knobs you want to write fails LOUDLY at the
dispatcher boundary — not silently on the device. The wire never
sees an incompatible combination.

## Why this exists

Real-circuit amp and reverb models have real-circuit constraints:

- Hall / Room / Chamber / Cloud reverb algorithms on AM4 are
  **fixed-decay** — there is no `time` knob. Writing `reverb.time = 6`
  to a Hall preset acks on the wire and silently does nothing on the
  device.
- Vox AC30 amp lineages have no `master` knob — the real-circuit AC30
  doesn't have one. Writing `amp.master = 5` to an AC30 model on AM4
  / Axe-Fx II / III acks on the wire and silently does nothing.
- Non-master Marshall lineages (Plexi 100W, 1959SLP, 1987X) — same.
- Tweed and blackface Fenders often lack `presence`, `depth`,
  `negative_feedback`, `bias_x`. Same silent-no-op.

The H1 Sunday Morning trace (2026-05-15) hit this end-to-end: the
agent set `reverb.type = "Hall, Large Deep"` + `reverb.time = 6`,
the device ack'd both writes, the agent told the user "decay locked
in at 6 seconds." The actual decay didn't change. A human reading
the chat would have missed it; the agent regression sweep caught it
via `should_avoid_dropped_param_warning` + a Hall-variant validator.

When an LLM steers the device, "the device acked" isn't equivalent
to "the value applied." This document codifies the gates so the
agent can't write a silently-incompatible combination.

## The contract

### Server side — three primitives

Every device descriptor that has type-gated parameters MUST implement
these:

1. **`ParamSchema.applies_only_when`** — free-form prose on each
   param surfacing the type-gating rule (e.g. `"applies only when
   REVERB_TYPE = [Plate, Small / Plate, Medium / ...]"`). Always
   surfaced via `list_params(port, block, name)`. Already shipped on
   AM4; see `packages/am4/src/descriptor/schema.ts:139`.

2. **`DeviceDescriptor.findCompatibleTypes(block, params[])`** —
   structured query returning the subset of `block.type` enum values
   that expose every listed param. AND-semantics across `params`.
   When the device has no applicability data for a block, returns the
   full enum with `applicability_known: false` so the caller knows
   the answer is "unknown — try and see," not "all of them are
   compatible." Backed by the `find_compatible_types` MCP tool. AM4
   implements this via `TYPE_APPLICABILITY` (extracted from AM4-Edit
   binary XML, Session 46-cont-5). Axe-Fx II / III / Hydra return
   the full list with `applicability_known: false` today; they get
   the protection automatically when applicability data lands.

3. **`apply_preset` precheck (dispatcher)** — when a slot specifies
   both a `type` enum value AND additional knobs, the dispatcher
   calls `findCompatibleTypes(block, [other_knobs])`. If the
   picked type is NOT in the compatible subset AND
   `applicability_known === true`, the dispatcher throws
   `DispatchError(value_out_of_range)` with `details.valid_options`
   carrying the compatible subset (capped at 16 entries with a
   pointer to the full list). The wire never opens. Lives in
   `packages/core/src/protocol-generic/dispatcher/preset.ts`
   (function `precheckTypeKnobCompatibility`).

### Agent side — the four-step workflow

When the agent's request involves picking a `type` enum AND any other
knobs in the same block, follow this sequence:

1. **Infer** the user's intent. "Long hall reverb" → user wants a
   reverb with a controllable decay; "Vox AC30 with master at 5" →
   user wants an AC30 lineage with a particular master volume.
2. **Look up types** that expose the relevant knobs:
   - Preferred: `find_compatible_types({port, block, params:[...]})` —
     single round-trip, structured result.
   - Fallback: `list_params({port, block, name: "knob"})` and read
     the `applies_only_when` field on the response.
3. **Pick params** from the compatible-types subset. Pick a type
   verbatim from `compatible_types[]`. If the user named a specific
   model that isn't in the subset (e.g. "Vox AC30" specifically),
   choose the closest lineage variant in the subset OR tell the user
   the requested model doesn't expose the requested knob (e.g. AC30
   has no master — use `amp.level` for output trim).
4. **Single tool call.** Issue one `apply_preset` with the picked
   type and the validated knob set. No "try, fail, fix, retry" loop
   needed — the precheck pre-validates so the first call either
   succeeds or refuses fast with a structured `valid_options` list.

### What the agent must NOT do

- Pick a `type` from the user's vocabulary alone when the user also
  names a knob. *"Long hall reverb"* → don't pick *"Hall, Large"*
  without checking what Hall exposes.
- Add knobs the user didn't ask for "to be helpful." User says
  *"AC30 with gain rolled back"* → set ONLY gain. Don't add master /
  bass / mid / treble / level / presence as a courtesy — those
  belong to the user.
- Trust an `acked: true` response as proof the value applied. The
  wire acks every write whether or not it landed. The precheck is
  the only signal that compatibility is good.
- Report success when the response carries a `"Dropped X param"`
  warning — that's the device-side silent-no-op signal. Name the
  dropped params in your summary.

## Device-by-device current state

| Device | applies_only_when | findCompatibleTypes | apply_preset precheck | Notes |
|---|---|---|---|---|
| AM4 | ✅ | ✅ (TYPE_APPLICABILITY table) | ✅ (generic dispatcher) | 13 blocks have primary-type enums; covers amp/drive/reverb/delay/chorus/flanger/phaser/wah/compressor/geq/filter/tremolo/gate |
| Axe-Fx II XL+ | ⚠ partial | ❌ (returns full enum, `applicability_known: false`) | ⚠ skipped (no structured data) | Wiki + lineage docs catalog deep amp params but applicability per type isn't decoded; needs HW capture pass |
| Axe-Fx III | ❌ | ❌ | ⚠ skipped | Whole device is community-beta; param ID space not decoded |
| Hydrasynth Explorer | ❌ | ❌ (no type-gated knobs) | n/a | Synth modules don't have an enum-typed `type` selector that gates knob exposure; the contract doesn't apply |

✅ = full enforcement.  ⚠ = degraded behavior (dropped-param warning
still fires post-write).  ❌ = no enforcement; agent guidance must
compensate.

## Anti-patterns (the traps this contract closes)

### 1. Hall reverb with `time` (AM4)

```
✗ Wrong:  reverb.type = "Hall, Large", reverb.time = 6
          → wire acks both, time silently doesn't apply

✓ Right:  find_compatible_types({block: "reverb", params: ["time"]})
          → ["Plate, Small", "Plate, Medium", ..., "Spring, Tube", ...]
          reverb.type = "Plate, Large", reverb.time = 6
          → both write and apply
```

Specifically, **no Hall variant on AM4 exposes `reverb.time`** —
not "Hall, Small," not "Hall, Large," not "Hall, Large Deep,"
not "Hall, Marble," not "Hall, Nashville Church." All Hall
algorithms have fixed decay. For long decay, use **Plate**,
**Spring**, **Echo**, or **SFX** variants (31 of 79 reverb types).

### 2. AC30 with `master` (AM4 / Axe-Fx II / III)

```
✗ Wrong:  amp.type = "Class-A 30W TB", amp.master = 5
          → wire acks both, master silently doesn't apply
          (real AC30s have no master)

✓ Right:  amp.type = "Class-A 30W TB", amp.gain = 3, amp.level = -2
          → use post-amp level for output trim instead of master
```

### 3. Non-master Marshall with `master`

```
✗ Wrong:  amp.type = "Plexi 100W High", amp.master = 5
          → silent no-op

✓ Right:  Either pick a master-Marshall lineage (JCM800, JCM900),
          or use amp.gain alone (Plexi gain drives the power amp
          directly — that's the iconic sound).
```

### 4. Tweed Fender with `presence`

```
✗ Wrong:  amp.type = "5F1 Tweed Champlifier", amp.presence = 6
          → 5F1 has no presence control; silent no-op

✓ Right:  Check find_compatible_types first; pick a Fender lineage
          that exposes presence (most blackface and silverface
          models do), or drop the presence write.
```

## Implementation references

- **AM4 applicability data**:
  `packages/am4/src/typeApplicability.ts` (generated from AM4-Edit's
  `__block_layout(.expert).xml`).
- **AM4 `findCompatibleTypes` implementation**:
  `packages/am4/src/applicability.ts:findCompatibleTypes`.
- **AM4 descriptor wiring**:
  `packages/am4/src/descriptor.ts:findCompatibleTypes`.
- **Generic dispatcher precheck**:
  `packages/core/src/protocol-generic/dispatcher/preset.ts:precheckTypeKnobCompatibility`.
- **MCP tool registration**:
  `packages/core/src/protocol-generic/tools/discovery.ts:find_compatible_types`.
- **Agent-facing tool description**:
  `packages/core/src/protocol-generic/tools/preset.ts:apply_preset`
  (TYPE-VS-KNOB COMPATIBILITY section).
- **Per-device agent guidance**:
  `packages/am4/src/descriptor/agentGuidance.ts:reverb_decay_pitfall`,
  `:amp_voicing_pitfall`.
- **Regression coverage**:
  `scripts/verify-dispatcher.ts` (apply_preset type-knob precheck
  section); `scripts/agent-regression/cases-am4.ts` (H1 +
  `should_avoid_dropped_param_warning`).

## When to add a new device

Porting this contract to a new device, in order:

1. **Decode applicability data** for the device's blocks. For Fractal
   devices, the editor app's binary XML is the source (AM4-Edit
   ships an `__block_layout.expert.xml` with `<Page>` and
   `<EditorControl>` per-type filter attributes). For other vendors,
   the device manual + a wire-trace pass against the manufacturer's
   editor is the path.
2. **Generate `TYPE_APPLICABILITY` table** mapping `{block}.{knob}`
   → `{ always: bool, gates: [{typeEnum, values}] }`. Mirror the
   AM4 shape (`packages/am4/src/typeApplicability.ts`).
3. **Implement `findCompatibleTypes` on the device's descriptor**.
   Mirror `packages/am4/src/applicability.ts:findCompatibleTypes`.
4. **Wire the descriptor field** in the device's descriptor literal.
5. **Verify the precheck fires** with the new device's H1-style
   case (write a fixed-decay type + decay knob, confirm precheck
   refuses with `valid_options`).

The dispatcher precheck is generic — once `findCompatibleTypes` is
on the descriptor, no other changes needed.
