# Parallel Claude Code sessions on this repo

This doc covers how to run up to ~3 Claude Code sessions at once on this
repo without them stepping on each other. It assumes Claude Code
v2.1.139+ (check with `claude --version`).

The repo is already configured for the workflow below:

- `.gitignore` excludes `.claude/worktrees/`.
- `.claude/settings.local.json` sets `worktree.baseRef: "fresh"`, so new
  worktrees branch from `origin/HEAD` (i.e. `origin/main`) and don't
  inherit unpushed local commits. Switch to `"head"` only if you need a
  session to operate on in-progress work that hasn't been pushed yet.
- `.worktreeinclude` copies `docs/_private/` into each new worktree so
  every session can read `STATE.md` and the `HARDWARE-TASKS-*.md` files
  per the project's session-start protocol.

## The single-terminal pattern: Agent View

Run **`claude agents`** from this repo's root. It opens one screen showing
every background session grouped by state (`Needs input` /
`Working` / `Ready for review` / `Completed`), with PR status dots and
a peek-panel for quick replies.

Core loop:

1. Type three prompts in the dispatch input, pressing `Enter` after each
   — one prompt = one new background session.
2. `Esc` to detach. The sessions keep running with no terminal attached.
3. `claude agents` again later to peek (`Space`), attach (`Enter`),
   or stop+delete (`Ctrl+X` twice).

Each session is automatically moved into its own worktree under
`.claude/worktrees/<name>/` on its first file write. Sessions never share
a working tree — that's the conflict cure.

Keyboard quick reference (full list with `?` in Agent View):

| Key | Action |
| :-- | :-- |
| `↑` / `↓` | Move between rows |
| `Space` | Open peek panel for selected row |
| `Enter` / `→` | Attach to the selected session |
| `←` (empty input) | Detach back to Agent View |
| `Ctrl+X` | Stop the session; press again within 2s to delete |
| `Ctrl+T` | Pin to top |
| `Ctrl+R` | Rename |
| `Esc` | Close panel / clear input / exit |

`Ctrl+X` twice **deletes the worktree along with the session**. Commit
and push before pressing `Ctrl+X Ctrl+X`, or the work goes with it.

## Safe parallelization seams in this repo

Sessions can edit different files concurrently without conflict.
The natural seams here, in rough order of safety:

1. **Per-device.** AM4 / Axe-Fx II / Axe-Fx III / Hydrasynth code and
   docs are physically separated:
   - `packages/am4/`, `packages/axe-fx-ii/`, `packages/hydrasynth-explorer/`
   - `docs/SYSEX-MAP.md` (AM4), `docs/SYSEX-MAP-AXE-FX-II.md`,
     `docs/SYSEX-MAP-AXE-FX-III.md`, `docs/HYDRASYNTH-*.md`
   - `docs/_private/HARDWARE-TASKS-AM4.md` etc.
2. **Per-package in the monorepo.** Even within one device, `core` /
   `am4` / `server-all` rarely overlap.
3. **Decode-vs-tool-surface.** Protocol RE work (`params.ts`, Ghidra
   mining, `verify-msg.ts` goldens, `SYSEX-MAP*.md`) almost never
   touches MCP tool wiring (`src/server/`, `src/protocol/generic/`).
4. **Per-research-artefact.** Two different `*-research.md` files in
   `docs/` are independent by construction.

Concrete example of a clean 3-session split for a single afternoon:

| Session | Task | Files it touches |
| :-- | :-- | :-- |
| A | Decode a new Axe-Fx II param family | `packages/axe-fx-ii/src/params.ts`, `docs/SYSEX-MAP-AXE-FX-II.md`, `verify-msg.ts` golden |
| B | Mine a new AM4 Ghidra coverage gap | `packages/am4/src/params.ts`, `docs/SYSEX-MAP.md` |
| C | Add a tool to the unified surface | `packages/core/src/protocol/generic/tools.ts`, `dispatcher.ts` |

## Single-writer files — pick one session per turn

These files are touched by almost every session. Two sessions writing to
the same one will conflict at merge time. Designate **one** session per
turn to update them, or leave them for a post-merge consolidation pass:

- `docs/_private/STATE.md` — session orientation; whichever session
  closes the bigger finding writes the update.
- `docs/_private/SESSIONS.md` — chronological log; same rule.
- `docs/DECISIONS.md` — non-obvious choices; the session that made the
  choice owns the entry.
- `MEMORY.md` / `~/.claude/projects/.../memory/` — auto-memory is
  per-machine, not per-worktree, so concurrent writes race.
- `CLAUDE.md` — meta-doc; rare edits, never split across sessions.
- `package.json`, `package-lock.json` — dependency churn collides
  ugly; do dep changes solo.
- `.claude/settings.local.json` — same story.

If a session needs to write one of these and another session is also
running, surface it in the peek panel and have the other session skip
that file.

## Merge-back workflow (per session)

The "Background-session role" section in `CLAUDE.md` is the contract:
when a session's cwd is under `.claude/worktrees/`, it MUST commit
and push the auto-created `worktree-<name>` branch before declaring
its task done. The orchestrator's "don't commit without instruction"
rule does NOT apply to background sessions.

Order inside the worktree, before the row leaves the `Working` group:

1. **Run `npm run preflight`** — typecheck + `verify-pack` +
   `verify-msg` + `verify-transpile`. The project's commit contract.
2. **If TypeScript under `src/` changed** and the next user step is
   testing in Claude Desktop, run **`npm run build`** in the worktree
   too. The dist is what Claude Desktop loads.
3. **Commit unstaged work** to the worktree's `worktree-<name>` branch
   with a descriptive message. No `Co-Authored-By: Claude` trailer.
   No `--no-verify` / `--no-gpg-sign`.
4. **Push** the feature branch. Never `origin/main`. The PR status
   dot on the Agent View row turns green when checks pass.
5. **Only then** post the completion summary. If preflight is red or
   push failed, the session stays open with the blocker named — the
   founder attaches and decides.

The founder merges on GitHub, then `Ctrl+X Ctrl+X` on the row in
Agent View removes the worktree and its branch.

Worktree directory the session is using is visible in the peek panel
or by attaching and running `pwd`.

## Cleanup when things go sideways

If a worktree got orphaned (crash, force-quit, etc.):

```bash
git worktree list                    # see all worktrees
git worktree remove <path>           # remove one
```

Old subagent worktrees with no uncommitted state are swept at Claude
Code startup based on `cleanupPeriodDays` in settings. Worktrees created
explicitly with `--worktree` (not Agent View auto-isolation) are never
swept — remove those manually.

## Practical limits

- **Sweet spot is 4–8 concurrent sessions per developer** per published
  field reports; we aim for ~3 here so review stays manageable.
- Background sessions consume subscription quota independently. Three
  parallel sessions burn quota ~3× as fast as one — fine on Max/Team,
  watch on Pro.
- Background sessions are local — they stop on machine sleep/shutdown.
  Restart all with `claude respawn --all`.

## When NOT to parallelize

Don't dispatch parallel sessions for any of the following:

- Anything that primarily edits one of the single-writer files above.
- A refactor that crosses package boundaries (touches `packages/core/`
  + `packages/am4/` + `packages/axe-fx-ii/` together).
- A `package.json` dependency change.
- Hardware-capture-driven work where the founder is actively at the
  device — serialize so each capture is unambiguous (one capture per
  hypothesis, per the RE workflow rules in `CLAUDE.md`).

## See also

- `code.claude.com/docs/en/agent-view` — official Agent View reference.
- `code.claude.com/docs/en/worktrees` — `--worktree` flag, `.worktreeinclude`,
  cleanup, non-git VCS hooks.
- `CLAUDE.md` — project git discipline, preflight contract,
  living-documentation rules that every session must follow.
<!-- agent-view smoke test -->
