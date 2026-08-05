#!/usr/bin/env node
/**
 * session-context — SessionStart hook for Taylor_Parts.
 *
 * Emits a short reminder of the governance docs to read this session and the
 * standing operating rules, plus the current branch/working-tree state. This
 * turns the "read these every session" rules (DelegationCharter tier model,
 * verify-before-recommending) into an automatic nudge instead of a memory the
 * agent might miss.
 *
 * Contract: never break session start. Always exit 0. Pure stdlib, no network.
 * Keep the output short — it is injected into context every session.
 */
import { execSync } from 'node:child_process';

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return ''; }
}

const branch = git('rev-parse --abbrev-ref HEAD');
const dirty = git('status --porcelain');
const treeState = dirty ? 'dirty (uncommitted changes present)' : 'clean';

const lines = [
  'Taylor_Parts — session start. Governance is the point of this project; read before acting:',
  '• docs/DelegationCharter.md — Tier 1/2/3 authority. firestore.rules changes are ALWAYS Tier 2.',
  '• docs/CLAUDE_CONTEXT.md — current state + non-negotiable rules; check this first.',
  '• docs/SPRINT_STATUS.md — where the active sprint actually stands.',
  '• docs/architecture/SYSTEM_AUTHORITIES.md — canonical ownership; update it in the SAME PR when ownership changes.',
  '',
  'Standing rules:',
  '• Verify real PR/branch state (gh pr view / git log origin/main) before recommending merge order.',
  '• firestore.rules is not auto-deployed (no CI) — merged != live; use the verify-rules-deploy skill.',
  '• ChatGPT reviews architecture/scope before merge; do not treat own analysis as final sign-off.',
  '',
  `Working copy: branch \`${branch || 'unknown'}\`, tree ${treeState}.`,
];

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
}));
process.exit(0);
