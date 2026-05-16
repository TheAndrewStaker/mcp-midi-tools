// Stop-hook guard for Agent View background sessions.
//
// When a session running under `.claude/worktrees/<name>/` is about to
// declare done, refuse the stop if the worktree still has uncommitted
// changes or unpushed commits. Forces the model back into the merge-back
// workflow documented in docs/PARALLEL-WORK.md before the row can leave
// the `Working` group.
//
// Wired in `.claude/settings.local.json` under `hooks.Stop`.
// Sessions running in the main checkout (NOT under .claude/worktrees/)
// are a no-op — the interactive orchestrator owns commit/push there.

import { execSync } from 'node:child_process';

function git(args: string): { ok: boolean; out: string } {
  try {
    const out = execSync(`git ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

const cwd = process.cwd().replace(/\\/g, '/');
if (!cwd.includes('/.claude/worktrees/')) {
  process.exit(0);
}

const status = git('status --porcelain');
const upstream = git('rev-parse --abbrev-ref --symbolic-full-name @{u}');
const branch = git('rev-parse --abbrev-ref HEAD').out || 'worktree-<name>';

const dirty = status.ok && status.out.length > 0;
const hasUpstream = upstream.ok && upstream.out.length > 0;

let ahead = 0;
if (hasUpstream) {
  const count = git('rev-list @{u}..HEAD --count');
  ahead = count.ok ? parseInt(count.out, 10) || 0 : 0;
}

if (!dirty && hasUpstream && ahead === 0) {
  process.exit(0);
}

const issues: string[] = [];
if (dirty) {
  const lines = status.out.split('\n').filter(Boolean).length;
  issues.push(`${lines} uncommitted change(s) in the working tree`);
}
if (!hasUpstream) {
  issues.push(`branch ${branch} has no upstream — it has never been pushed`);
} else if (ahead > 0) {
  issues.push(`${ahead} unpushed commit(s) on ${branch}`);
}

const reason = [
  `Stop blocked by merge-back contract (see docs/PARALLEL-WORK.md): ${issues.join('; ')}.`,
  '',
  `You are running in a worktree under .claude/worktrees/. Before declaring done:`,
  `  1. Run \`npm run preflight\` and fix anything red.`,
  `  2. Commit unstaged work to branch \`${branch}\` with a descriptive message (no Co-Authored-By trailer, no --no-verify).`,
  `  3. Push the branch (never to origin/main).`,
  '',
  `If preflight is red or push fails, surface the blocker in your next reply and stop — do NOT keep retrying. The founder will attach and decide.`,
].join('\n');

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
