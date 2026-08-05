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
 * Scoped to UNTRACKED files under known artifact dirs, so routine edits to
 * already-tracked files don't nag. Contract: never break a turn. Always exit 0.
 * Pure stdlib, no network.
 */
import { execSync } from 'node:child_process';

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
  .filter((p) => ARTIFACT_DIRS.some((d) => p.startsWith(d)) && p.endsWith('.md'));

if (untracked.length === 0) process.exit(0);

const list = untracked.slice(0, 12).map((p) => `  - ${p}`).join('\n');
const more = untracked.length > 12 ? `\n  …and ${untracked.length - 12} more` : '';
const msg =
  `Unpublished artifact doc(s) exist ONLY in the local working copy — ChatGPT/Codex and other ` +
  `sessions cannot see them until they are on a remote branch:\n${list}${more}\n` +
  `If this work is meant to be shared/reviewed, publish it with the \`publish-artifacts\` skill ` +
  `(branch off origin/main, commit only these paths, push, no merge). If it's scratch, ignore this.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'Stop', additionalContext: msg },
}));
process.exit(0);
