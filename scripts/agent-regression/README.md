# Agent-regression harness

Drives each test case through `claude -p` (non-interactive Claude Code)
against the shipped MCP server. Each case is a **fresh agent session**
— no prior context, no privileged hints — so the agent reads tool
descriptions cold the same way Claude Desktop does.

Bills against the **Claude Max subscription** of whoever is logged
into Claude Code (no `ANTHROPIC_API_KEY` required).

## Why this exists

The founder e2e in Claude Desktop (`docs/_private/regression/<device>.md`)
is the human-driven runbook. This harness is the automated tier-2.5
mirror — runs the same prompts unattended, captures the agent's tool
sequence, asserts efficient + correct usage, and catches **silent
no-op regressions** a human reading the chat would miss.

The motivating example: in the H1 hero run, the agent picked
`reverb.type = "Hall, Large Deep"`, wrote `reverb.time = 6`, the
device ACKed the write, and the agent reported "Decay locked in at 6
seconds." It looked like a pass. But Hall algorithms on AM4 are
fixed-decay — the write silently no-op'd, the actual decay never
changed, and the user got a wrong report. A human reviewer would
have missed it. This harness's `should_avoid_dropped_param_warning`
+ `tool_call_validators` catch it.

## Running

```bash
npm run agent-sweep                                 # all cases (auto-skips HW cases when device not connected)
npm run agent-sweep:am4                             # AM4 only
npx tsx scripts/agent-regression/index.ts --tier=no-hardware
npx tsx scripts/agent-regression/index.ts --case=am4-h1-sunday-morning --verbose
```

Drive one case during development:

```bash
npx tsx scripts/agent-regression/runner.ts am4-h1-sunday-morning
```

The `--verbose` flag echoes every stream-json event from `claude -p`
as it arrives — useful when authoring a new case's assertions.

## Where this fits in the test pyramid

| Trigger | Command | Time | $ | What runs |
|---|---|---|---|---|
| Mid-edit | `npm test` | ~30s | $0 | byte-equiv goldens, smoke-server, build |
| Pre-commit | `npm run preflight` | ~60s | $0 | typecheck + `npm test` |
| Pre-release ritual | **`npm run release-gate`** | ~10-15min | ~$1-2 | preflight + launch-verify + agent-sweep |
| At-bench | `npm run launch-verify` | ~30s | $0 | live HW probe + audition |

`release-gate` is the founder-driven gate before tagging a release. It
does NOT run on every push — `git push` triggers nothing, by design.
The cadence matches release tagging, not commit frequency. The
agent-sweep auto-detects connected devices and skips hardware-tier
cases for any unconnected device, so `release-gate` works at the
bench OR away from it (subset coverage when away).

## Retry-on-flake

Sonnet is non-deterministic. A failed case is retried ONCE before
declaring fail. If the retry passes, the case is flagged `⚠ flake`
in the summary table — visible signal, not silent — but doesn't
block the gate. Override with `--max-retries=0` for CI-debug mode.

## Authoring a new case

1. Add an entry to the right `cases-<device>.ts` file. Required fields:
   `id`, `device`, `tier`, `description`, `prompt`, `expectations`.
2. Pick the assertions:
   - `must_call` — bare tool names that MUST appear.
   - `max_tools` — efficiency ceiling.
   - `max_repeats` — per-tool retry ceiling (catches enum / type-mismatch loops).
   - `tool_call_validators` — argument-level predicates over a specific tool call.
   - `should_avoid_dropped_param_warning` — flag for the H1-silent-no-op class.
   - `text_not_contains` — guards against false-confidence narration.
3. Run with `--verbose` once to see the actual tool sequence, tune the
   bounds, and commit.

## Tier-skipping

- `tier: 'no-hardware'` cases run anywhere (descriptor introspection,
  schema validation, etc.).
- `tier: 'hardware'` cases require the device. If the agent can't talk
  to the hardware, the case will time out or surface a transport error
  — surfaces as a fail. The harness does NOT auto-skip; pass
  `--tier=no-hardware` in CI to scope to the safe set.

## Sonnet 4.6 default

Default model: `claude-sonnet-4-6` (matches the Desktop default). Override
with `--model=<id>` (`claude-opus-4-7`, `sonnet`, etc.).

## Cost / rate-limit notes

Each case is ~5-15k tokens (tool definitions + system + agent loop).
A full AM4 sweep (~10-15 cases) runs in 5-10 minutes wall time and
consumes equivalent of a small Claude Desktop session. Subscription
rate limits apply.

## File layout

```
scripts/agent-regression/
├── README.md            # this file
├── mcp-config.json      # MCP server config passed to claude -p
├── types.ts             # AgentRegressionCase / Expectations types
├── runner.ts            # spawn + stream-json parser + assertion engine
├── cases-am4.ts         # AM4 cases (H1/H2/H3 + §2 surface coverage)
├── cases-all.ts         # aggregator
└── index.ts             # CLI entry
```
