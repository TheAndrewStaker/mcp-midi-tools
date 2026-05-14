## Summary

<!-- One or two sentences. What changes, why? -->

## Type of change

- [ ] Bug fix (a tool / wire path that wasn't doing what it claimed)
- [ ] New feature (new tool, new device, new capability on an existing device)
- [ ] Refactor / cleanup (no behavior change)
- [ ] Documentation
- [ ] Reverse-engineering / protocol decode (touches `docs/SYSEX-MAP*.md` or `src/<vendor>/<device>/`)

## Wire-layer changes

<!-- Only fill this if you touched src/fractal/**, src/asm/**, or anything that changes MIDI bytes sent or parsed. Otherwise delete the section. -->

- [ ] Added byte-exact goldens against a captured `.syx` or documented test (`scripts/verify-*.ts`)
- [ ] If a new pidHigh / function / NRPN was added, the matching case is in `scripts/verify-msg.ts`
- [ ] `npm run preflight` passes locally (typecheck + 20 goldens + smoke)
- [ ] Hardware-tested on the device (or — note that it's wire-only and the founder will hardware-test on merge)

## Test plan

<!-- What did you run? What did you verify? -->

- [ ] `npm run preflight`
- [ ] `npm run launch-verify` (if the change touches the dispatcher, unified surface, or any device's writer / reader)
- [ ] Specific hardware action(s): ...

## Screenshots / output

<!-- Optional. If the change affects tool descriptions or response shapes, paste a before/after. -->

## Related issues / docs

<!-- e.g. closes #N, references docs/SAFE-EDIT-WORKFLOW.md, etc. -->
