# Contributing

Thanks for your interest in contributing.

## License

By submitting a contribution (pull request, patch, issue with a code
suggestion, or any other form), you agree that your contribution is
licensed under the project's license — **Apache License 2.0** — as
described in the [`LICENSE`](./LICENSE) file. You also certify that
you have the right to submit the contribution under that license
(e.g. it is your original work, or you have permission from the
copyright holder).

No separate contributor license agreement (CLA) or developer
certificate of origin (DCO) sign-off is required at this stage.

## Before opening a PR

1. Run the full preflight locally and make sure it's green:
   ```
   npm run preflight
   ```
   This runs `tsc --noEmit` + the golden verifiers (pack, message,
   transpile, enum-lookup, echo, cache-params) + the MCP smoke test.
2. If your change touches the wire protocol, add or update a
   byte-exact golden in `scripts/verify-msg.ts` against a real
   capture. See the "When adding a new pidHigh" note in
   [`CLAUDE.md`](./CLAUDE.md) for the rationale.
3. If your change adds a new MCP tool, add it to the expected-tools
   list in `scripts/smoke-server.ts`.

## Capturing MIDI traffic for protocol RE

The fastest way to capture wire traffic from a Fractal device (or any
MIDI gear) is the passive-capture script:

```
# List available MIDI input ports:
npm run capture-midi

# Capture device → host SysEx to a `.syx` file:
npm run capture-axefx2 -- samples/captured/my-axefx2-capture.syx
npm run capture-am4    -- samples/captured/my-am4-capture.syx

# Generic — any MIDI device by name substring:
npm run capture-midi -- hydra samples/captured/foo.syx
```

Press Ctrl+C to stop. Bytes are appended to disk as they arrive, so
partial captures survive crashes.

**What this captures vs. what it doesn't:**

- ✅ **Device → host** — every SysEx message the device sends back
  (responses to editor queries, broadcasts, state announcements).
  This is the byte-exact wire format the decoder gets tested against.
- ❌ **Host → device** — bytes editor apps SEND to the device. Windows
  MIDI output ports are write-only; we can't passively read them.
  For outgoing captures use `scripts/sniff.ts` (the bridge-based
  sniffer) — but be aware Fractal editors (AxeEdit, AM4-Edit) filter
  out `loopMIDI` / `rtpMIDI` virtual ports; you need `ipMIDI`
  (paid trial limited to 60 min) or `LoopBe1` (free, single port) for
  that direction.

**Why this approach works:** Windows MIDI input ports are
shared-readable. Your script can open `AXE-FX II MIDI In` while
AxeEdit is also reading it; both see the same bytes. No virtual
driver, no bridge, no MIDI-OX UI. Discovered the hard way during
HW-085 (2026-05-10/11) after hours of fighting virtual-port
filtering on Fractal editors.

**Single-action captures are gold.** Start a fresh capture per
specific action (drag one block, turn one knob, switch one preset).
Single-action `.syx` files are far easier to decode than mixed
sessions.

See [`docs/axe-fx-ii-community-re-methodology.md`](./docs/axe-fx-ii-community-re-methodology.md)
for the broader context — Fractal editors are intentionally engineered
to gate third-party traffic sniffing, and passive device-side capture
is the cleanest workaround for the half of the conversation we can
read.

## Questions / security issues

- General questions → open a GitHub issue once the repo is public.
- Security issues → see [`SECURITY.md`](./SECURITY.md).
