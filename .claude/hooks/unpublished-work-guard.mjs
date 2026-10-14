#!/usr/bin/env node
/**
 * unpublished-work-guard — Stop hook for Taylor_Parts.
 *
 * Fires when the agent finishes a turn. If artifact documents exist in the
 * working tree that are NOT on the current verified origin/main, it reports
 * them — because the git repo is the ONLY context layer ChatGPT/Codex and other
 * sessions can see. This catches the failure where finished work is stranded
 * locally.
 *
 * FALSE-POSITIVE FIX (2026-08-06). The hook previously equated "untracked in
 * this checkout" with "not published anywhere". That is wrong on a stale
 * checkout: a branch that is many commits behind main shows files as untracked
 * that are already published — and acting on the reminder would have pushed
 * STALE DRAFTS over newer authoritative versions. Observed live: 4 of 6 flagged
 * files were already on main (including an older copy of the finalized build
 * Blueprint). The comparison authority is now the fetched origin/main, never the
 * local branch tip, and each file is classified rather than lumped together:
 *
 *   A. ALREADY PUBLISHED / LOCAL STALE COPY  — same path+content on origin/main.
 *      Reported only as a count; never actionable, never a publish candidate.
 *   B. LOCAL DIVERGENCE — REVIEW REQUIRED    — path on origin/main, content differs.
 *      Could be newer work OR an older draft. Needs a diff, never blind publish.
 *   C. UNIQUE LOCAL ARTIFACT — REVIEW REQUIRED — path absent from origin/main.
 *      The only genuinely-stranded class.
 *
 * D. Blind publication is never recommended from a materially stale checkout;
 *    when the checkout is behind origin/main the message says so and asks for
 *    provenance review instead of a publish.
 * E. Dirty-tree safety: this hook only ever READS. It runs no reset, clean,
 *    checkout, delete, or overwrite, and never fetches (a Stop hook must not
 *    mutate repo state or block on the network).
 *
 * DEBOUNCE: the reminder is emitted only ONCE per unique classified set, so an
 * idle agent doesn't loop. State is a tiny per-worktree signature file under the
 * OS temp dir; if state can't be read or written, the hook fails OPEN.
 *
 * Contract: never break a turn. Always exit 0. Pure stdlib, no network.
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

// Untracked artifact docs — the candidate set, NOT yet the answer.
const candidates = git('status --porcelain --untracked-files=all')
  .split('\n')
  .filter((l) => l.startsWith('??'))
  .map((l) => l.slice(3).trim())
  .filter((p) => ARTIFACT_DIRS.some((d) => p.startsWith(d)) && p.endsWith('.md'))
  .sort();

if (candidates.length === 0) process.exit(0);

// Comparison authority: the last-fetched origin/main. Deliberately NOT fetched
// here — a Stop hook must not touch the network or mutate repo state. If the ref
// is missing entirely we cannot classify, so stay silent rather than guess and
// risk recommending a bad publish.
const mainRef = git('rev-parse --verify --quiet origin/main').trim();
if (!mainRef) process.exit(0);

// Is this checkout materially behind main? Drives the "never recommend blind
// publication from a stale checkout" rule (D).
const behind = Number.parseInt(
  (git(`rev-list --count HEAD..${mainRef}`).trim() || '0'), 10,
) || 0;

const alreadyPublished = []; // A
const diverged = [];         // B
const unique = [];           // C

for (const path of candidates) {
  const onMain = git(`cat-file -e ${mainRef}:"${path}"`) !== '' ||
    git(`rev-parse --verify --quiet ${mainRef}:"${path}"`).trim() !== '';
  if (!onMain) { unique.push(path); continue; }
  const localHash = git(`hash-object "${path}"`).trim();
  const mainHash = git(`rev-parse ${mainRef}:"${path}"`).trim();
  if (localHash && mainHash && localHash === mainHash) alreadyPublished.push(path);
  else diverged.push(path);
}

// Nothing needs a human decision — every candidate is already published verbatim.
if (unique.length === 0 && diverged.length === 0) process.exit(0);

// --- Debounce on the CLASSIFIED set, so a reclassification re-surfaces ---
const repoKey = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 16);
const stateFile = join(tmpdir(), `taylor_unpublished_guard_${repoKey}.txt`);
const signature = createHash('sha1')
  .update(`C:${unique.join(',')}|B:${diverged.join(',')}|A:${alreadyPublished.length}`)
  .digest('hex');

let alreadyReminded = false;
try {
  alreadyReminded = readFileSync(stateFile, 'utf-8').trim() === signature;
} catch { /* no prior state — fail open */ }
if (alreadyReminded) process.exit(0);
try { writeFileSync(stateFile, signature); } catch { /* still emit below */ }

const fmt = (arr) => arr.slice(0, 10).map((p) => `  - ${p}`).join('\n') +
  (arr.length > 10 ? `\n  …and ${arr.length - 10} more` : '');

const parts = [`Local artifact docs classified against origin/main (${mainRef.slice(0, 7)}):`];

if (unique.length) {
  parts.push(`\nUNIQUE LOCAL ARTIFACT — REVIEW REQUIRED (not on origin/main):\n${fmt(unique)}`);
}
if (diverged.length) {
  parts.push(`\nLOCAL DIVERGENCE — REVIEW REQUIRED (path exists on origin/main, content differs; ` +
    `could be newer work OR an older draft — diff before acting):\n${fmt(diverged)}`);
}
if (alreadyPublished.length) {
  parts.push(`\nALREADY PUBLISHED / LOCAL STALE COPY: ${alreadyPublished.length} file(s) are ` +
    `byte-identical to origin/main. No action — do not re-publish.`);
}

if (behind > 0) {
  parts.push(`\n⚠ This checkout is ${behind} commit(s) BEHIND origin/main. Do NOT publish from it — ` +
    `local copies are likely stale drafts, and publishing could overwrite newer authoritative ` +
    `versions. Establish provenance first; recover content into its canonical destination from a ` +
    `fresh worktree at verified origin/main.`);
} else {
  parts.push(`\nIf this work is meant to be shared/reviewed, publish it with the \`publish-artifacts\` ` +
    `skill (branch off origin/main, commit only these paths, push, no merge). If it's scratch, ignore.`);
}

parts.push(`\n(Read-only check. Debounced — will not repeat for this same classified set.)`);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'Stop', additionalContext: parts.join('\n') },
}));
process.exit(0);
