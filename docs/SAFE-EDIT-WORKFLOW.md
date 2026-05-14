# Safe-Edit Workflow

The cross-device contract this project guarantees for every supported
MIDI device — AM4, Axe-Fx II, Hydrasynth, and any device added later.

**The rule, one sentence:** no tool silently overwrites a preset, no
tool silently loses your in-progress edits, and "save" is something
you ask for — except when you ask for multiple presets at once,
because a setlist without persistence isn't a setlist.

## Why this exists

Audio gear protocols don't natively protect users from this kind of
data loss. The Axe-Fx II's working buffer is just RAM — switching
presets discards whatever you were editing. The AM4 is the same.
AxeEdit's UI mitigates with a warning dialog before you navigate
away from an edited preset; bare MIDI has no such gate.

When an LLM is the one steering the device, the loss surface gets
larger: the agent may not realize the user has been editing, or
may interpret an ambiguous request like "build a tone at slot 700"
as "save to slot 700" when the user just meant "audition there."
We've hit both failure modes during development.

This document codifies the gates. Implementing them consistently
across every device means users can speak to any of our supported
devices the same way and trust the same safety guarantees.

## The contract

### Single preset / patch request

| User state | User language | Tool behavior |
|---|---|---|
| Clean buffer | "build a tone at slot X" / "design a clean preset" | Navigate to X, apply to working buffer, **don't save**. Response tells the user: *"Auditioning at slot X — say 'save it' if you want to persist."* |
| Clean buffer | "save a tone to slot X" / "build and save" / "put it on X" / "keep it at X" | Navigate to X, apply, save. |
| Dirty buffer | ANY request that navigates to a different preset | **Refuse with a structured warning naming the edited preset.** Agent asks the user: save first / discard / cancel? Re-call with the user's choice. |

### Multiple preset / patch request (setlist)

| User state | User language | Tool behavior |
|---|---|---|
| Clean buffer | "build setlist for 700/701/702" / "build 3 tones for A/B/C" | **Multi-preset implies save intent.** Pre-flight scan + warn about overwrites. Then navigate-apply-save each. |
| Dirty buffer | same | Warn about dirty first (same handling as single). User chooses, then the batch runs. |

### What counts as "save language"

Explicit, common verbs the agent should recognize:

- `save` / `save it` / `save this`
- `store` / `store it`
- `keep` / `keep it`
- `put it on slot N` / `put on N`
- `persist`
- `commit it` / `write it to N`
- `make it permanent`

What does NOT count as save authorization:

- `at slot X` (names a target, not an authorization — `"build a tone at 700"` is audition)
- `design a tone for X` (X is a song or style, not a slot)
- `try out a tone` / `play around with` / `experiment with`
- bare slot numbers without an action verb

### What counts as "multi-preset request"

- Two or more named target slots
- A range (`"slots 700-705"`)
- A named setlist (`"Def Leppard setlist for tonight's show"`)
- An enumerated list (`"a clean, a crunch, and a lead"` with slots implied or stated)

A single request that mentions multiple scenes within one preset is
NOT multi-preset — scenes are intra-preset, save discipline is the
same as single-preset (one save authorization needed).

## Device-by-device current state

Devices vary in how much of the contract is enforced at the API
boundary today. The table below tracks both gaps and the
implementation strategy:

| Capability | AM4 | Axe-Fx II | Hydrasynth |
|---|---|---|---|
| Device-sourced dirty signal | ⏸ blocked on HW-107 | ✅ via `0x74` state-broadcast | ❌ not exposed in MIDI |
| `on_active_preset_edited` guard | ⏸ port pending | ✅ Session 68 | n/a (no dirty detection) |
| `save_authorized` guard on apply-at-slot | ⏸ port pending | ✅ Session 68 | ⏸ port pending |
| Multi-preset overwrite scan | ✅ `am4_scan_locations` | ✅ `axefx2_scan_preset_range` | n/a (different patch model) |
| Tool-description guidance for agent | ✅ CLAUDE.md | ✅ in tool descriptions | partial |

Axe-Fx II is the reference implementation (Session 68). AM4 and
Hydrasynth catch up incrementally.

## Implementation pattern

Three pieces, applied consistently:

### 1. Buffer-dirty tracking

Where the device emits a state-broadcast that fires on edits (Axe-Fx
II's `0x74`, AM4's TBD signal from HW-107), we listen passively and
flip an in-memory `dirty[device]` flag. **Device-sourced and
authoritative.** Implemented in `src/server/shared/bufferDirty.ts`.

Where the device doesn't expose a dirty signal in MIDI (Hydrasynth),
we don't try to fake it. The `save_authorized` guard still works,
but `on_active_preset_edited` is omitted as `n/a` — agents know to
ask the user before navigating away.

`markClean` is wired on outbound `switch_preset` and `save_preset`
across all devices (the device transitions to clean when we load
stored bytes or commit working buffer to a slot).

### 2. `on_active_preset_edited` guard

Parameter on every tool that navigates away from the active preset:

```ts
on_active_preset_edited: z.enum(['warn', 'discard', 'save_active_first']).optional()
```

Default `'warn'`. When the buffer is dirty:

- `'warn'` (default) — refuse, return a structured warning naming
  the active preset's slot + name. The agent surfaces this to the
  user, gets a save/discard/cancel decision, retries with the
  appropriate mode.
- `'discard'` — proceed without saving (silent edit loss, but
  user-authorized).
- `'save_active_first'` — read active preset's slot, save the
  working buffer to it, then navigate.

When the buffer is clean, the guard is a no-op and the tool runs
normally.

### 3. `save_authorized` guard on apply-at-slot

Parameter on every tool that applies AND persists in one call
(e.g. `axefx2_apply_preset_at`, `am4_apply_preset_at`,
`hydra_apply_patch` with target slot):

```ts
save_authorized: z.boolean().optional()
```

Default `false`. When `false`:

- Tool refuses with a structured message explaining: the user must
  have used save language, and pointing the agent at the
  working-buffer-only alternative (`*_apply_preset` without slot)
  for audition.

When `true`:

- Tool proceeds with the full apply-and-save flow (after passing
  the `on_active_preset_edited` guard if applicable).

`*_apply_setlist` tools (multi-preset) do NOT have this guard —
multi-preset intent is the authorization. They still pre-flight
scan and warn about overwrites.

## Agent-facing tool-description rules

Every tool that navigates or persists carries the contract in its
description so the LLM knows what to surface to the user. Pattern
from Axe-Fx II's Session 68 (`axefx2_apply_preset_at`):

> SAVE AUTHORIZATION REQUIRED — DESTRUCTIVE: this tool calls
> STORE_PRESET at the end, which overwrites the target slot. The
> tool refuses by default; you MUST pass `save_authorized: true`
> AND that should only happen when the user used save-intent
> language (save/store/keep/put-on/persist). For "build a tone" /
> "design a preset" without save language, use
> `axefx2_apply_preset` (working-buffer-only) instead, let the
> user audition, then ASK before calling this tool with
> `save_authorized: true`.

Mirror that paragraph in every per-device equivalent. Keep the
wording close so an agent that's only ever seen one device's tools
recognizes the pattern in another.

## Test scenarios — what every device must pass

These are the user-facing behaviors that prove the contract is
implemented. Use them as a regression check whenever the safe-edit
code changes.

**Automated suite:** `npm run mcp-test-safe-edit` (refusal scenarios
only, hardware-free) and `npm run mcp-test-safe-edit -- --write`
(full suite, requires connected hardware). Spawns the shipped MCP
server via `StdioClientTransport` and asserts each scenario against
the actual tool surface — same code path Claude Desktop hits.
Source: `scripts/mcp-test-safe-edit-scenarios.ts`.

| Scenario | Expected | Suite assertion |
|---|---|---|
| 1. User on clean preset says "build a tone at slot X" | Agent calls `*_apply_preset` (working buffer), tool succeeds without `save_authorized`. | S1 — working-buffer apply succeeds. |
| 2. User on clean preset says "save a tone as Glassy at slot X" | Agent calls `*_apply_preset_at` with `save_authorized=true`, tool persists. | S2 — clean + apply-at-slot with auth succeeds. |
| 3. User on dirty preset Y says "build a tone at slot X" | Tool refuses (save-auth gate fires first; if auth granted, dirty gate fires next). | S3a (refusal, no auth) + S3b (refusal, auth but dirty). |
| 4. User on clean preset says "build setlist for 700/701/702" | Tool pre-flight scans (warns about overwrites), navigates-applies-saves each. | Covered by founder-driven setlist tests, outside the regression suite. |
| 5. User on dirty preset says "build setlist for 700/701/702" | Refuses dirty first; agent must save/discard before retrying. | S5 — dirty + setlist refuses. |
| 6. User on clean preset says "switch to slot 47" (no apply) | Tool navigates, no save concern. | S6 — clean + switch_preset succeeds with default mode. |
| 7. User on dirty preset says "switch to slot 47" (no apply) | Tool refuses, asks save/discard. | S7 — dirty + switch_preset refuses. |

## Failure modes documented

- **Front-panel edits we can't see.** Devices without a decoded
  dirty-broadcast (Hydrasynth and AM4 both fall in this bucket as
  of Session 74 HW-107) won't trigger the dirty flag for edits the
  user made on the device itself. **AM4 specifically:** an HW-107
  capture with AM4-Edit closed produced ZERO inbound MIDI bytes
  during front-panel knob turns, bypass toggles, and scene switches
  over 58 seconds. The device does not broadcast on edits — AM4-Edit
  detects them by continuously polling state, which would compete
  with the MCP server's real work and is not implemented. The
  `save_authorized` guard still catches save-intent ambiguity. The
  `on_active_preset_edited` guard catches AGENT-made edits (every
  set_param / apply_preset / set_block on AM4 marks the buffer
  dirty), but cannot catch a knob the user just turned on the
  hardware. Honest scope: if the user has been editing on the front
  panel and tells the agent "load A1", they should save on the
  device first OR pass `on_active_preset_edited: "discard"`. Agents
  know via the AM4 `agent_guidance.relative_change` block and
  describe_device.

- **Device save we can't see.** If the user presses SAVE on the
  device's own front panel (not via the agent), the working buffer
  becomes clean on the device but our flag stays dirty. Result is
  a false-positive warning on the next navigation — agent asks
  the user, who confirms "no, I saved it" and chooses `'discard'`.
  Fail-safe (extra confirmation) rather than fail-dangerous
  (silent edit loss).

- **Server restart.** Dirty flag is in-memory, resets to clean on
  server restart. Next write or device-broadcast will set it
  correctly.

## References

- `src/server/shared/bufferDirty.ts` — shared dirty-flag tracker
- `src/fractal/axe-fx-ii/tools/shared.ts:guardActiveBufferOrSave`
  — reference implementation of the warn/discard/save-first guard
- `src/fractal/axe-fx-ii/midi.ts` — device-sourced dirty
  classification (state-broadcast listener)
- `docs/_private/HARDWARE-TASKS-AM4.md` HW-107 — closed Session 74:
  AM4 doesn't broadcast on front-panel edits, full stop. The
  code-side classifier on outbound writes is the only viable signal;
  front-panel edits are documented as out-of-scope above.
- `docs/_private/STATE.md` Session 68 — full history of the
  Axe-Fx II implementation
