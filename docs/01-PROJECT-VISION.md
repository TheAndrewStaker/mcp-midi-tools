# MCP MIDI Tools — Project Vision

## One-Line Pitch
Talk to Claude, get authentic guitar tones instantly loaded onto your Fractal AM4.

## The Problem
Building presets on a hardware amp modeler requires deep technical knowledge of
parameter names, signal chains, and effect types. Even experienced players spend
hours dialing in a tone that could be described in one sentence. Sharing presets
across players is fragmented and format-locked.

## The Solution
A local MCP server that bridges Claude Desktop and the Fractal AM4 over USB/MIDI.
The user describes what they want in plain language. Claude translates that into
precise AM4 SysEx commands and sends them directly to the device — no AM4-Edit
required.

---

## Core User Experience

```
User: "Give me a preset for Amber by 311 — 4 scenes, verse through solo"

Claude: Researches Tim Mahoney's verified gear for that recording era,
        maps each block to AM4 equivalents, builds 4 scenes, confirms
        target slots are safe to write, sends to device.

Device: Preset appears on AM4. User plays it immediately.

User: "The filter is too quacky on the verse"

Claude: Reduces Filter sensitivity, re-sends, asks how it sounds now.
```

---

## Target User
- Guitarists who own a Fractal AM4
- Comfortable with Claude Desktop (free tier acceptable)
- Want authentic tones without deep technical knowledge
- Perform live and need organized preset libraries

## What It Is Not
- Not a visual preset editor (AM4-Edit replacement)
- Not multi-device (AM4 only, v1)
- Not cloud-hosted — runs entirely local
- Not a subscription service

---

## Success Criteria (v1)
1. Can send a complete preset to AM4 without AM4-Edit open
2. Can reliably reverse-engineer preset and scene binary format
3. Claude can describe a famous tone and produce a working preset
4. Iterative refinement loop works ("more gain", "darker reverb")
5. Preset slots are never silently overwritten — always confirmed

---

## Technology Stack
- **Runtime:** Node.js / TypeScript
- **MCP Framework:** @modelcontextprotocol/sdk
- **MIDI/USB:** node-midi (npm)
- **Protocol:** Fractal Audio SysEx over USB-MIDI
- **AI:** Claude Desktop (claude.ai) via MCP connector
- **Future AI:** Claude API (anthropic SDK) for standalone mode

---

## Phased Roadmap

### Phase 0 — Feasibility (current)
Prove we can send/receive SysEx to AM4 without AM4-Edit.

### Phase 1 — Protocol Layer
Reverse-engineer AM4 preset binary format. Build encoder/decoder.

### Phase 2 — MCP Server (MVP)
Wrap protocol layer as MCP tools. Connect to Claude Desktop.
Basic tone-from-description working end to end.

### Phase 3 — Preset Intelligence
AM4 manual + block parameter reference as Claude project knowledge.
Famous tone research. Iterative refinement loop.

### Phase 4 — Library Management
Backup/restore. Setlist organization. Slot safety system.

### Phase 5 — Polish & Expand
Onboarding. Factory preset baseline. Other devices (if feasible).
