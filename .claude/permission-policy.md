# `.claude/settings.json` permission policy — two classes

Owner-ratified 2026-08-09. Rationale + full design:
[`docs/orchestration/continuous-workstream-orchestrator.md`](../docs/orchestration/continuous-workstream-orchestrator.md)
§7. **Tool permission is separate from EOS business authority** — pre-authorizing a safe shell verb grants no
capability, no data access, and no product authority.

## VERIFICATION class → `permissions.allow`

Read-only / evidence / test commands that cannot mutate production, credentials, access policy, or the
working tree in a non-recoverable way. Pre-authorized to remove routine approval friction: `git status` /
`log` / `diff` / `show` / `rev-parse` / `branch --show-current` / `worktree list` / `remote -v`,
`npm run build|test|lint|typecheck`, `node --test`, `gh pr view|checks|list|diff`, `gh run view|list`.

## PROTECTED class → `permissions.deny` (hard-denied) or default confirmation

Never pre-authorized. The `deny` block hard-stops the sharp mechanical edges even if a broad allow is ever
introduced: `firebase deploy` / `firestore:delete` / `functions:delete`, `gh secret*`, `rm -rf` / `rm -r`,
`git push --force` / `-f`, `git reset --hard`, `git clean -f`. Semantic protected actions that are not a
single shell pattern — **capability grants, production writes, production migrations, Rules deployment,
access/security widening** — are not matched here; they remain governed by the default confirmation prompt
and Delegation Charter §8.3, and an authorized operator (never this loop) executes them.

## Non-negotiable

There is **no** `Bash(*)` or equivalent unrestricted-shell allow. Adding one would defeat the policy.
Broadening `allow` is itself a governance change (Owner-ratified), not a routine edit.
