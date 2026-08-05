#!/usr/bin/env node
/**
 * rules-guard — PostToolUse guard for Taylor_Parts.
 *
 * Fires after Edit/Write/MultiEdit. If the touched file is a `firestore.rules`
 * copy, it emits a reminder (as PostToolUse additionalContext) of the standing
 * rules-change rules this repo has been burned by:
 *   - Tier 2 (docs/DelegationCharter.md) — escalate, unconditionally.
 *   - No CI deploys rules (docs/Deployment.md §3) — merge != live.
 *   - Two copies must stay in parity (root + field-ops-app-vite/).
 *   - Verify with the `verify-rules-deploy` skill before calling it "live."
 *
 * Contract: never break a turn. Always exit 0. Pure stdlib, no network.
 */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  try { for await (const c of process.stdin) chunks.push(c); } catch { /* ignore */ }
  return Buffer.concat(chunks).toString('utf-8');
}

function filePathFrom(event) {
  const ti = (event && event.tool_input) || {};
  // Edit/Write use file_path; MultiEdit uses file_path too (single target).
  return ti.file_path || ti.filePath || ti.path || '';
}

function isRulesFile(p) {
  if (!p) return false;
  const norm = String(p).replace(/\\/g, '/').toLowerCase();
  return norm.endsWith('/firestore.rules') || norm === 'firestore.rules';
}

async function main() {
  let event = {};
  try { event = JSON.parse(await readStdin()); } catch { /* fall through */ }

  const fp = filePathFrom(event);
  if (!isRulesFile(fp)) { process.exit(0); }

  const msg = [
    'firestore.rules changed — standing Taylor_Parts rules (do not skip):',
    '• Tier 2 (docs/DelegationCharter.md §2): a rules permission change is ALWAYS',
    '  escalate/approve before deploy — no carve-out for "follows a pattern".',
    '• NOT auto-deployed: no CI runs `firebase deploy` (docs/Deployment.md §3).',
    '  Merged != live. Someone must run `firebase deploy --only firestore:rules`.',
    '• Parity: keep BOTH copies in sync — `firestore.rules` (deploy source per',
    '  firebase.json) AND `field-ops-app-vite/firestore.rules`.',
    '• Before calling it live, run the `verify-rules-deploy` skill (branch/CWD,',
    '  parity, deploy-confirmed, live-matches-source).',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: msg,
    },
  }));
  process.exit(0);
}

main().catch(() => process.exit(0));
