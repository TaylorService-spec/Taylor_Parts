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
  'EOS orchestration cold-start (do NOT reconstruct state by archaeology):',
  '• For orchestration/roadmap/selector/cockpit/agent-routing work, your deterministic bootstrap is `node docs/orchestration/context/cold-start.mjs --scope <domain>` — it returns L0 contract + current-state pointer + C-7 package (refs) + authority-first gate + cold-start cost. Start there instead of reading CLAUDE_CONTEXT.md/DECISIONS/git history in full. Card: docs/orchestration/context/EOS-BOOTSTRAP.md.',
  '',
  'Standing rules:',
  '• OPERATING MODE = DEFAULT AUTONOMY (DelegationCharter §8 / AGENTS.md). Reversible repo-only work in an APPROVED architecture with checks passing: implement, fix review findings, verify, doc, open+review+MERGE Tier-1 PRs (exact-head guard), clean up, continue to the next directed section — WITHOUT asking. Do not stop for routine merge/doc/exact-head/review-routing/cleanup approvals. Return at MILESTONES, not every PR.',
  '• STOP only for genuine boundaries: material architecture/product decisions; security/authorization or firestore.rules/protected-policy changes; capability grants/role changes; production deploy/Hosting/Functions/live-verify; migration/destructive/production-write/rollback; spending; irreversible actions; parallel-owned surfaces; unresolvable test failures; uncertain evidence; conflicting authorities; or scope broadening beyond approved direction.',
  '• Verify real PR/branch state (gh pr view / git log origin/main) before recommending merge order.',
  '• firestore.rules is not auto-deployed (no CI) — merged != live; use the verify-rules-deploy skill.',
  '• ChatGPT/Owner review MATERIAL architecture/scope + protected boundaries before merge — NOT routine repo-only Tier-1 work (that is autonomous); never treat own analysis as final sign-off on a material call.',
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
