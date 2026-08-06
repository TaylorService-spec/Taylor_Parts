#!/usr/bin/env node
/**
 * unpublished-work-guard — Stop hook for Taylor_Parts.
 *
 * Fires when the agent finishes a turn. If there are UNTRACKED artifact
 * documents in the working tree (analysis/spec/review/assessment/handoff docs
 * that exist only locally), it reminds the agent to publish them — because the
 * git repo is the ONLY context layer ChatGPT/Codex and other sessions can see.
 * This catches the exact failure where finished work is stranded locally.
 *
 * DEBOUNCE (2026-08-05 fix): the reminder is emitted only ONCE per unique
 * stranded-set. Once emitted for a given set of paths, it stays silent until the
 * set actually changes (a doc is added, published, or removed). This prevents an
 * unbounded re-invocation loop when the agent is idle-waiting for user input with
 * stranded docs present — which wasted turns/tokens before this fix. State is a
 * tiny per-repo signature file under the OS temp dir; if state can't be read or
 * written, the hook fails OPEN (still emits) rather than swallowing the reminder.
 *
 * Scoped to UNTRACKED files under known artifact dirs, so routine edits to
 * already-tracked files don't nag. Contract: never break a turn. Always exit 0.
 * Pure stdlib, no network.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ARTIFACT_DIRS = [
  'docs/reviews/',
  'docs/specifications/',
  'docs/assessments/',
  'docs/implementation-plans/',
  'docs/design/',
];

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch { return ''; }
}

// Porcelain lines like "?? docs/reviews/foo.md" (untracked) — the stranded case.
const untracked = git('status --porcelain --untracked-files=all')
  .split('\n')
  .filter((l) => l.startsWith('??'))
  .map((l) => l.slice(3).trim())
  .filter((p) => ARTIFACT_DIRS.some((d) => p.startsWith(d)) && p.endsWith('.md'))
  .sort();

if (untracked.length === 0) process.exit(0);

// --- Debounce: emit only when the stranded-set signature changes ---
// Namespace the state file per working directory so concurrent worktrees don't
// clobber each other's debounce state.
const repoKey = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 16);
const stateFile = join(tmpdir(), `taylor_unpublished_guard_${repoKey}.txt`);
const signature = createHash('sha1').update(untracked.join('\n')).digest('hex');

let alreadyReminded = false;
try {
  alreadyReminded = readFileSync(stateFile, 'utf-8').trim() === signature;
} catch { /* no prior state — treat as not-yet-reminded (fail open) */ }

if (alreadyReminded) process.exit(0); // same stranded-set already surfaced; stay quiet

try { writeFileSync(stateFile, signature); } catch { /* can't persist — still emit below */ }

const list = untracked.slice(0, 12).map((p) => `  - ${p}`).join('\n');
const more = untracked.length > 12 ? `\n  …and ${untracked.length - 12} more` : '';
const msg =
  `Unpublished artifact doc(s) exist ONLY in the local working copy — ChatGPT/Codex and other ` +
  `sessions cannot see them until they are on a remote branch:\n${list}${more}\n` +
  `If this work is meant to be shared/reviewed, publish it with the \`publish-artifacts\` skill ` +
  `(branch off origin/main, commit only these paths, push, no merge). If it's scratch, ignore this.\n` +
  `(This reminder is debounced — it will not repeat for this same set of files.)`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'Stop', additionalContext: msg },
}));
process.exit(0);
