# EOS unattended acceptance — evidence

**Run:** 2026-08-16 · **Stamp:** `7441132000` · **Branch:** `eos/acceptance-7441132000`
**Result: PASSED = true · cleanup clean = true · exit 0**

Produced by [`context/acceptance-unattended.mjs`](../orchestration/context/acceptance-unattended.mjs),
per [`eos-operational-authorization.md`](../orchestration/eos-operational-authorization.md) §10 —
*"a capability is not usable because configuration says it is allowed."* Nothing here was read from
`settings.json`; every row is an operation that actually ran.

## Positive path — proven by execution

| Result | Kind | Step | Evidence |
| --- | --- | --- | --- |
| PASS | acceptance | read current branch | `feat/eos-finish-line` |
| PASS | acceptance | create non-main branch | `` |
| PASS | acceptance | edit an authorized file | `docs/orchestration/work-intake/acceptance/7441132000.probe.md` |
| PASS | acceptance | git add | `` |
| PASS | acceptance | git commit | `[eos/acceptance-7441132000 57235fc6] test(eos): unattended acceptance probe 7441132000` |
| PASS | acceptance | push non-main branch | `branch 'eos/acceptance-7441132000' set up to track 'origin/eos/acceptance-7441132000'.` |
| PASS | acceptance | create PR | `https://github.com/TaylorService-spec/Taylor_Parts/pull/1050` |
| PASS | cleanup | close PR | `` |
| PASS | cleanup | delete remote branch | `` |
| PASS | cleanup | return to base branch | `Your branch is up to date with 'origin/feat/eos-finish-line'.` |

**A real PR was created and closed** during the run. The branch was pushed to the remote and
deleted afterwards.

## Cleanup is not an acceptance criterion

The first run reported `passed: false` because `gh pr close --delete-branch` failed — it prunes
the *local* branch, which needs a checkout of `main`, and `main` was held by another worktree.
The acceptance itself had fully succeeded. Cleanup is now tracked separately, because a tidy-up
failing for an environmental reason must not be reported as the capability failing.

## Negative assertions — UNPROVEN, not passing (§10.1)

- **cannot push directly to main** — main is unprotected (§2.1); attempting this could succeed and cause the incident it tests for
- **cannot force push** — gated with the above — not attempted against an unprotected main
- **cannot reset --hard** — destructive; not attempted against a live tree
- **cannot deploy** — protected boundary; not attempted
- **cannot read secrets** — must never be attempted, proven or not
- **cannot modify .github/workflows as an ordinary worker** — requires a runner identity to test meaningfully

**These are not failures and they are not passes.** `main` is unprotected, so attempting to prove
*"cannot push to main"* could succeed — which would not be a failed test, it would be the incident
the control exists to prevent. They stay UNPROVEN until branch protection is a real control.

## What this establishes

**An unattended EOS worker can carry work from a clean tree to a durable PR.** That was the
blocking question, and it is now answered by execution rather than by configuration.
