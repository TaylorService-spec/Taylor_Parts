# Local work recovery ledger: 2026-10-14

Issued: 2026-10-14 14:55:55 -07:00 (America/Phoenix)

- origin/main at audit start: `abe35d38`; at backup time: `fc8baf26` (classification is against `fc8baf26`).
- Scope: every local branch, stash, dirty working tree and worktree registration for `D:/Taylor_Parts`. Preservation only: nothing was deleted, pruned, checked out, reset or merged.
- Backups live on origin under `backup/2026-10-14/*` (56 branches). Not for merge.

## Counts

| Item | SUPERSEDED | ABANDONED | KEEP | UNCERTAIN | Backed up |
|---|---|---|---|---|---|
| Local branches with commits on no remote (859 of 1,688) | 803 | 7 | 33 | 16 | 49 |
| Local branches fully on a remote (829) | 829 (recorded on GitHub) | | | | 0 |
| Stashes (4) | 3 | | | 1 | 4 |
| Windows working trees / folders (15 incl. main checkout, eos, admin x9, charts, saas, .codex x2) | 13 | | 2 | | 2 |
| WSL worktrees (148 registrations) | 146 | 1 | 1 | | 1 |

## Method

Branch rules, applied in order to each branch with commits on no remote:

1. `git merge-tree --write-tree origin/main <b>` equals main's tree: **SUPERSEDED** (merging adds nothing).
2. Every file version the branch changed (merge-base..tip, excluding deletions) exists somewhere in `origin/main` history: **SUPERSEDED** (squash-merged or later re-landed).
3. Tip equals the head of a merged PR: **SUPERSEDED**. Tip equals the head of a closed-unmerged PR: **ABANDONED** (GitHub keeps `refs/pull/N/head`).
4. A same-named PR exists but the tip differs. If the tip is an ancestor of the PR head, or `git cherry` matches every patch: **SUPERSEDED**. Otherwise **UNCERTAIN**, or **KEEP** when the tip is ahead of the PR head with content not on main.
5. No PR: **KEEP** when fewer than half of the changed file versions are in main history, otherwise **UNCERTAIN**. KEEP is downgraded to UNCERTAIN for scratch-style names (`tmp/`, `scratch/`, `t/`, `verify/`, `merge/`, `worktree-agent-*`).

Known limits: rule 2 ignores branch-only deletions. It can also call a branch SUPERSEDED when the branch reverted a file to an older main version. Dirty snapshots were built with a temporary index (`GIT_INDEX_FILE`) plus `write-tree`/`commit-tree`, so no working tree or real index was touched.

## Excluded from every backup

- `sample-company-v2.credentials.local.enc` and `sample-company-v2.credentials.local.json` (main checkout)
- `inventory-effects-production-detection-20260722T204858Z*` tarballs, `.sha256` files and terminal log (main checkout)
- `firestore-debug.log` in the main checkout and the eos folder, plus a committed copy in `integrate/fleet-catalog`. That branch was backed up as rewritten commits with the log removed; each commit message names its original
- `Users/` (40 KB) and `Taylor-Migration-Evidence/` (132 KB) in the main checkout
- Office files: `Do not ask me to inspect Firestore.docx`, `Hierarchy.xlsx`, `Sandbox_CRM_and_Role_Audit_2026-08-19.pptx.inspect.ndjson`, plus the `Sandbox_CRM_and_Role_Audit_2026-08-19/` slide renders and `tmp/sandbox-audit-deck/`
- `.claude/skills/admin-check/keypath.local.txt` from stash@{3} (holds the path to a Firebase Admin SDK key file), plus that stash's `dist-firebase/` build output and `.session-markers/`
- `.codex/worktrees/` (clean production deploy/rollback checkouts, 275 MB)
- Gitignored content in `D:/Taylor_Parts-eos`: `functions/lib`, `field-ops-app-vite/dist`, `.certification/` (47 files), `.operator-access-intents/` and `functions/.operator-access-intents/` (24 files), `sweep-output/`, `*.log`, `.mcp.json`, `.firebase/`, `.claude/settings.local.json`

A content scan ran over every blob in every pushed commit not already on a remote. It looked for private keys, `"private_key"`, AWS/GitHub/OpenAI/Slack/Google key shapes, quoted password/secret/token assignments and credentialed Postgres URLs. Every hit was reviewed and none is a secret: test fixtures in `ai/secure-private-keystone-ingress` (`cf-access-client-secret-test...`) and `claude/bin-p6-multiscan` (`bin_dest0001`), the scan-pattern list in the `int/a-correctness-register` docs, and the public Firebase web `apiKey` (already on main) in `pr189-live-verify.mjs`.

A later full-history scan of the stash ancestry also matched `functions/authpr4/production-authorization.json` (`executionModeToken: "emt-…"`). That value has been in `origin/main` since PR #460 (70c398955, 2026-07-27), so these backups add no new exposure. A case-insensitive `akIA…` match in root `index.html` is also already on main and is not an AWS key.

## Owner decisions needed

1. **The 148 "stale/prunable" worktree registrations are live WSL worktrees** in `~/.local/share/eos-worktrees` (Ubuntu-24.04). Git on Windows marks them prunable only because it can't resolve `/home/...` paths. **Running `git worktree prune` (or a `git gc` that prunes worktrees) from Windows would detach all of them.** Decide whether to keep them (then run maintenance only from WSL) or retire them.
2. The gitdir for `D:/Taylor_Parts-eos` (`.git/worktrees/Taylor_Parts-eos`, which held only `info/`) disappeared during this session's first `git fetch`. That fetch triggered `gc --auto`, which prunes worktrees. Nothing of value was lost: the folder's content is backed up and its base commit identified. All later commands ran with `gc.auto=0`.
3. The KEEP and UNCERTAIN branches below are backed up. For each one, decide whether to open a PR, keep it as an archive, or delete it locally. The largest groups: `customer1/*` lane outputs (2026-09-04), `ext/*` and `int/a-correctness-register` (2026-09-13), `claude/bin-p6-*` (2026-09-10), `crm/client-cutover-postgres` (2026-09-16), `atlas/employee-v41-input`.
4. The excluded artifacts exist only on this disk: credentials files, production detection tarballs, `Taylor-Migration-Evidence/`, `Users/`, `.certification/` and `.operator-access-intents/`. Decide where they will be kept outside git before any cleanup.
5. `Claude Design Docs/` (16 MB of design-handoff zips and frames) is included in the main-checkout backup. Decide whether it belongs in the repo or in external storage.

## Stashes, working trees and folders

| Source | Type | Date | Classification | Evidence | Backup branch |
|---|---|---|---|---|---|
| stash@{0} (feat/certworld-installed-base) | Stash | 2026-08-22 | SUPERSEDED | 1 file (functions/scripts/certificationWorld.mjs, +2 lines); that exact file version later appeared on main (2b40812f6) | `backup/2026-10-14/stash/0-feat-certworld-installed-base` |
| stash@{1} (feat/eos-result-consolidation) | Stash | 2026-08-13 | SUPERSEDED | Untracked parent only: 10 EOS-ISSUE-852 work.json files, identical to main | `backup/2026-10-14/stash/1-feat-eos-result-consolidation` |
| stash@{2} (epic8-operations-intelligence-unification) | Stash | 2026-07-05 | SUPERSEDED | CLAUDE_CONTEXT.md +1, executionAnalyticsService.ts +10; both file versions later appeared on main | `backup/2026-10-14/stash/2-epic8-operations-intelligence-unification` |
| stash@{3} (epic3-inventory-analytics-engine) | Stash | 2026-07-05 | UNCERTAIN | CLAUDE_CONTEXT.md rewrite (+58/-20) never on main; that doc has changed a lot since. The untracked parent held keypath.local.txt (path to a service-account key), which was excluded | `backup/2026-10-14/stash/3-epic3-inventory-analytics-engine-sanitized (tracked changes only)` |
| D:/Taylor_Parts (on docs/issue-100-inventory-role-access-specification @ a652f618) | Dirty checkout | 2026-10-14 | KEEP | 8 modified + 210 new files, none in any git history: user guides, reviews, design/spec docs, admin module, ScheduleBoard.jsx, PartsScanner.jsx, AGENTS.md, .claude agents/hooks/skills, skills/, tools/eos-watchdog, Claude Design Docs/ (16 MB incl. zips) | `backup/2026-10-14/worktree/Taylor_Parts-main-checkout` |
| D:/Taylor_Parts-eos (gitdir gone) | Broken worktree | 2026-10-12 | KEEP (5 files) / SUPERSEDED (rest) | Matches docs/cycle-counts-closure-training @ add03de3 (PR #1857, on origin) exactly, except for 5 untracked files. The ~1,000 modified / 1,210 missing files only reflect how stale it is against today's main | `backup/2026-10-14/worktree/Taylor_Parts-eos` |
| ~/.local/share/eos-worktrees/auth-role-census (auth/census-failclosed-catalog @ 6060298c) | WSL worktree dirty state | 2026-09-18 | KEEP | Uncommitted roleAssignmentCensus.ts change (+95/-26); no PR; file unchanged on main since | `backup/2026-10-14/worktree/wsl-auth-role-census` |
| ~/.local/share/eos-worktrees/firebase-exit-1fdef0b7-20260911T202025Z | WSL worktree dirty state | 2026-09-11 | ABANDONED | 5 untracked zero-byte files (EOS, Firebase, PostgreSQL, Render, Vercel): shell-redirect accident | - |
| ~/.local/share/eos-worktrees/p26-ledger-fix | Separate repo | 2026-09-15 | SUPERSEDED | Not this repo: a clone of project-keystone, clean, 0 unpushed commits. Out of scope | - |
| D:/Taylor_Parts-admin-{ia,objects,p4,perms,review,roles,ui1,ui2,ui3} | Worktree | 2026-10-08 | SUPERSEDED | Only change is " D functions/node_modules" (expected after PR #2072); branches pushed or merge adds nothing | - |
| D:/Taylor_Parts-charts, D:/Taylor_Parts-saas | Worktree | - | SUPERSEDED | Clean, 0 unpushed commits | - |
| D:/Taylor_Parts/.codex/worktrees/prod-deploy-d5f2172, prod-rollback-e1d936e | Worktree (broken link) | - | SUPERSEDED | Clean checkouts of d5f2172 / e1d936e (both on origin); gitdir metadata missing. 275 MB on disk | - |

## Local branches with commits on no remote (859)

Sorted by classification, then name. "Commits" counts commits that are on no remote ref.

| Source | Type | Date | Commits | Classification | Evidence | Backup branch |
|---|---|---|---|---|---|---|
| `atlas/employee-v41-input` @ 40c5440d87 | branch | 2026-09-13 | 2 | KEEP | no PR; 52/52 changed file versions not in main history | `backup/2026-10-14/atlas/employee-v41-input` |
| `atlas/guard-admin-firestore` @ 4d2ec94b91 | branch | 2026-09-12 | 1 | KEEP | no PR; 2/2 changed file versions not in main history | `backup/2026-10-14/atlas/guard-admin-firestore` |
| `automation/customer1-execution-20260904` @ a0cf26a5e2 | branch | 2026-09-04 | 6 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/automation/customer1-execution-20260904` |
| `claude/bin-p6-authority` @ 31b1ccc1c1 | branch | 2026-09-10 | 2 | KEEP | no PR; 43/43 changed file versions not in main history | `backup/2026-10-14/claude/bin-p6-authority` |
| `claude/bin-p6-multiscan` @ e858759ff7 | branch | 2026-09-10 | 3 | KEEP | no PR; 51/51 changed file versions not in main history | `backup/2026-10-14/claude/bin-p6-multiscan` |
| `claude/cert-authority-genesis-v2` @ 9fdf7bf8a3 | branch | 2026-08-30 | 1 | KEEP | no PR; 8/8 changed file versions not in main history | `backup/2026-10-14/claude/cert-authority-genesis-v2` |
| `claude/opportunity-workspace-p1` @ ab00ef2017 | branch | 2026-08-27 | 1 | KEEP | no PR; 2/2 changed file versions not in main history | `backup/2026-10-14/claude/opportunity-workspace-p1` |
| `claude/receiving-p1-reconciliation` @ 3e895df952 | branch | 2026-08-31 | 2 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/claude/receiving-p1-reconciliation` |
| `claude/wizardly-lewin-747ad7` @ f564af2874 | branch | 2026-08-26 | 1 | KEEP | no PR; 1/1 changed file versions not in main history | `backup/2026-10-14/claude/wizardly-lewin-747ad7` |
| `crm/client-cutover-postgres` @ 66848d7867 | branch | 2026-09-16 | 7 | KEEP | no PR; 51/51 changed file versions not in main history | `backup/2026-10-14/crm/client-cutover-postgres` |
| `customer1/a-20260904-013034` @ 66cfc3cc8b | branch | 2026-09-04 | 1 | KEEP | no PR; 4/4 changed file versions not in main history | `backup/2026-10-14/customer1/a-20260904-013034` |
| `customer1/a-20260904-065957` @ 9234e56619 | branch | 2026-09-04 | 1 | KEEP | no PR; 4/4 changed file versions not in main history | `backup/2026-10-14/customer1/a-20260904-065957` |
| `customer1/a-work` @ 2f343f2c69 | branch | 2026-09-04 | 7 | KEEP | no PR; 5/5 changed file versions not in main history | `backup/2026-10-14/customer1/a-work` |
| `customer1/b-work` @ dd86a86e64 | branch | 2026-09-04 | 9 | KEEP | no PR; 29/29 changed file versions not in main history | `backup/2026-10-14/customer1/b-work` |
| `customer1/c-work` @ e9921614f1 | branch | 2026-09-04 | 5 | KEEP | no PR; 8/8 changed file versions not in main history | `backup/2026-10-14/customer1/c-work` |
| `customer1/d-work` @ 1866430c32 | branch | 2026-09-04 | 6 | KEEP | no PR; 7/7 changed file versions not in main history | `backup/2026-10-14/customer1/d-work` |
| `customer1/e-work` @ 56c19405ca | branch | 2026-09-04 | 4 | KEEP | no PR; 5/5 changed file versions not in main history | `backup/2026-10-14/customer1/e-work` |
| `customer1/f-work` @ 4616202ccc | branch | 2026-09-04 | 4 | KEEP | no PR; 4/4 changed file versions not in main history | `backup/2026-10-14/customer1/f-work` |
| `customer1/g-work` @ 5a99184cb1 | branch | 2026-09-04 | 4 | KEEP | no PR; 6/6 changed file versions not in main history | `backup/2026-10-14/customer1/g-work` |
| `ext/census-acceptance` @ 8ee6b31d1b | branch | 2026-09-13 | 3 | KEEP | no PR; 5/5 changed file versions not in main history | `backup/2026-10-14/ext/census-acceptance` |
| `ext/own-decision-packet` @ 7279d3f75e | branch | 2026-09-13 | 1 | KEEP | no PR; 2/2 changed file versions not in main history | `backup/2026-10-14/ext/own-decision-packet` |
| `ext/own-engineering-gap` @ 1811be2113 | branch | 2026-09-13 | 2 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/ext/own-engineering-gap` |
| `ext/reporting-reconcile` @ 6f7e828257 | branch | 2026-09-13 | 1 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/ext/reporting-reconcile` |
| `feat/employee-definition-work` @ e3993f3b47 | branch | 2026-08-17 | 1 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/feat/employee-definition-work` |
| `feat/overnight-ws2-ws3` @ 59034dbff6 | branch | 2026-08-20 | 2 | KEEP | merged PR #1342; tip differs from PR head; local tip is ahead of PR head by 1 commits,4 new file versions not in main history | `backup/2026-10-14/feat/overnight-ws2-ws3` |
| `fix/e2e-harness-gitignore` @ 0d9a17dd83 | branch | 2026-08-18 | 3 | KEEP | no PR; 9/9 changed file versions not in main history | `backup/2026-10-14/fix/e2e-harness-gitignore` |
| `fix/partdetail-timestamps` @ 00cf0c2516 | branch | 2026-08-08 | 4 | KEEP | no PR; 7/7 changed file versions not in main history | `backup/2026-10-14/fix/partdetail-timestamps` |
| `int/a-correctness-register` @ 57516627bb | branch | 2026-09-13 | 18 | KEEP | no PR; 6/6 changed file versions not in main history | `backup/2026-10-14/int/a-correctness-register` |
| `integrate/fleet-catalog` @ f5e22bf26c | branch | 2026-08-17 | 3 | KEEP | no PR; 13/13 changed file versions not in main history | `backup/2026-10-14/integrate/fleet-catalog (sanitized: firestore-debug.log removed, commits rewritten)` |
| `night/p2h-report-scope-bound` @ d1491997eb | branch | 2026-09-12 | 1 | KEEP | no PR; 5/5 changed file versions not in main history | `backup/2026-10-14/night/p2h-report-scope-bound` |
| `pr317-review` @ e3703225b8 | branch | 2026-07-16 | 1 | KEEP | no PR; 4/4 changed file versions not in main history | `backup/2026-10-14/pr317-review` |
| `rescue/sales-order-identity-ruling-a8e44ed9` @ a8e44ed9d1 | branch | 2026-08-17 | 1 | KEEP | no PR; 3/3 changed file versions not in main history | `backup/2026-10-14/rescue/sales-order-identity-ruling-a8e44ed9` |
| `sync/access-contracts` @ fc6d02db18 | branch | 2026-08-18 | 2 | KEEP | no PR; 16/16 changed file versions not in main history | `backup/2026-10-14/sync/access-contracts` |
| `ai/secure-private-keystone-ingress` @ 20b5a4a101 | branch | 2026-08-27 | 4 | UNCERTAIN | merged PR #1553; tip differs from PR head; PR head object not available locally to compare | `backup/2026-10-14/ai/secure-private-keystone-ingress` |
| `feat/cycle-count-authority` @ 01a799da79 | branch | 2026-08-15 | 1 | UNCERTAIN | merged PR #1037; tip differs from PR head; diverged from PR head with 1 patch not matched by git cherry (likely pre-rebase version) | `backup/2026-10-14/feat/cycle-count-authority` |
| `feat/inventory-transfer-authority` @ 112fe03a0a | branch | 2026-08-15 | 1 | UNCERTAIN | merged PR #1032; tip differs from PR head; diverged from PR head with 1 patch not matched by git cherry (likely pre-rebase version) | `backup/2026-10-14/feat/inventory-transfer-authority` |
| `feature/issue-319-equipment-edit-save-error` @ 9e9732af57 | branch | 2026-08-10 | 1 | UNCERTAIN | merged PR #775; tip differs from PR head; PR head object not available locally to compare | `backup/2026-10-14/feature/issue-319-equipment-edit-save-error` |
| `fix/admin-manufacturer-coordinated-reconciliation` @ 60720c4239 | branch | 2026-08-15 | 1 | UNCERTAIN | merged PR #1036; tip differs from PR head; diverged from PR head with 1 patch not matched by git cherry (likely pre-rebase version) | `backup/2026-10-14/fix/admin-manufacturer-coordinated-reconciliation` |
| `fix/ci-coverage-holes` @ 7138fcf075 | branch | 2026-08-18 | 1 | UNCERTAIN | merged PR #1303; tip differs from PR head; PR head object not available locally to compare | `backup/2026-10-14/fix/ci-coverage-holes` |
| `fix/loading-empty-state-failure` @ 0cf6367315 | branch | 2026-08-18 | 1 | UNCERTAIN | merged PR #1297; tip differs from PR head; PR head object not available locally to compare | `backup/2026-10-14/fix/loading-empty-state-failure` |
| `fix/work-order-status-labels` @ ce46849801 | branch | 2026-08-18 | 1 | UNCERTAIN | merged PR #1296; tip differs from PR head; PR head object not available locally to compare | `backup/2026-10-14/fix/work-order-status-labels` |
| `merge/e2e-harness` @ 7ce387e210 | branch | 2026-08-18 | 2 | UNCERTAIN | no PR; 8/8 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/merge/e2e-harness` |
| `scratch/p1b-integration-dryrun` @ 68f1bde9c3 | branch | 2026-09-11 | 5 | UNCERTAIN | no PR; 13/13 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/scratch/p1b-integration-dryrun` |
| `t/1309` @ c84be853e9 | branch | 2026-08-18 | 1 | UNCERTAIN | no PR; 10/10 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/t/1309` |
| `t/1310` @ 0a590adbd2 | branch | 2026-08-18 | 2 | UNCERTAIN | no PR; 17/17 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/t/1310` |
| `tmp/j-rebuild` @ 2a421244a2 | branch | 2026-08-20 | 2 | UNCERTAIN | no PR; 16/16 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/tmp/j-rebuild` |
| `tmp/p-rebuild` @ f897a5a51c | branch | 2026-08-20 | 2 | UNCERTAIN | no PR; 11/11 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/tmp/p-rebuild` |
| `verify/phantom-repair` @ db10d8f9c6 | branch | 2026-08-18 | 2 | UNCERTAIN | no PR; 11/11 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/verify/phantom-repair` |
| `worktree-agent-a9f17bb0bd020b39e` @ 8e1677bfb2 | branch | 2026-08-13 | 1 | UNCERTAIN | no PR; 3/3 changed file versions not in main history; scratch/test-style branch name | `backup/2026-10-14/worktree-agent-a9f17bb0bd020b39e` |
| `account-north-star-p1` @ 06229c09a2 | branch | 2026-08-26 | 4 | ABANDONED | tip = head of closed-unmerged PR #1517 (kept on GitHub as refs/pull/1517/head) | - |
| `ci/bisect-no-workflow` @ c8764b3667 | branch | 2026-08-26 | 1 | ABANDONED | tip = head of closed-unmerged PR #1519 (kept on GitHub as refs/pull/1519/head) | - |
| `ci/trigger-probe` @ b0a55f7de3 | branch | 2026-08-26 | 1 | ABANDONED | tip = head of closed-unmerged PR #1518 (kept on GitHub as refs/pull/1518/head) | - |
| `claude/account-north-star-p1-b4df37` @ b96982d1a2 | branch | 2026-08-26 | 3 | ABANDONED | tip = head of closed-unmerged PR #1515 (kept on GitHub as refs/pull/1515/head) | - |
| `eos/acceptance-7274809200` @ 1385dc391e | branch | 2026-08-16 | 3 | ABANDONED | tip = head of closed-unmerged PR #1049 (kept on GitHub as refs/pull/1049/head) | - |
| `eos/acceptance-7441132000` @ 57235fc603 | branch | 2026-08-16 | 3 | ABANDONED | tip = head of closed-unmerged PR #1050 (kept on GitHub as refs/pull/1050/head) | - |
| `eos/acceptance-work-item` @ 440e8a6fcb | branch | 2026-08-16 | 1 | ABANDONED | tip = head of closed-unmerged PR #1055 (kept on GitHub as refs/pull/1055/head) | - |
| `aap-integrate` @ 968d694a57 | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1017 | - |
| `ai/certification-environment-registration` @ 0314244586 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1595 | - |
| `amc-integrate` @ 284e4274b3 | branch | 2026-08-16 | 2 | SUPERSEDED | tip = head of merged PR #1036 | - |
| `asc-integrate` @ 614ce94638 | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1024 | - |
| `audit/session-completeness` @ 9a68903bc5 | branch | 2026-09-03 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `authority/customer1-consumption-source-selection` @ 1587c0ecdd | branch | 2026-09-03 | 7 | SUPERSEDED | tip = head of merged PR #1775 | - |
| `authority/customer1-physical-consumption-source` @ 1236f36f89 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1772 | - |
| `authority/fin-block-003-cost-reconciliation` @ b488e09a55 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1755 | - |
| `authority/fin-block-003a-acquisition-cost` @ 043fab9b84 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1760 | - |
| `authority/inventory-commitment-reconciliation` @ 84057d2f75 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1746 | - |
| `authority/inventory-commitment-unification` @ 028e65c771 | branch | 2026-09-02 | 3 | SUPERSEDED | tip = head of merged PR #1749 | - |
| `c1/physical-consumption` @ 1ac5c870c3 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1765 | - |
| `cc-integrate` @ aa766f6ace | branch | 2026-08-16 | 3 | SUPERSEDED | tip = head of merged PR #1037 | - |
| `cert/auth-principals` @ e7cedf2e9c | branch | 2026-08-21 | 2 | SUPERSEDED | tip = head of merged PR #1403 | - |
| `cert/final` @ b606829e2d | branch | 2026-08-21 | 6 | SUPERSEDED | tip = head of merged PR #1398 | - |
| `cert/post-g` @ 00dc8793c5 | branch | 2026-08-21 | 2 | SUPERSEDED | tip = head of merged PR #1397 | - |
| `cert/role-grants` @ 2a2880df29 | branch | 2026-08-21 | 1 | SUPERSEDED | tip = head of merged PR #1404 | - |
| `cert/wave-b-css` @ 92b6d2d1a7 | branch | 2026-08-21 | 2 | SUPERSEDED | tip = head of merged PR #1391 | - |
| `cert/wave-c-findings` @ 1d86519a63 | branch | 2026-08-21 | 2 | SUPERSEDED | tip = head of merged PR #1392 | - |
| `cert/wave-d` @ f36e3e9369 | branch | 2026-08-21 | 1 | SUPERSEDED | tip = head of merged PR #1393 | - |
| `cert/wave-e` @ fffff5291a | branch | 2026-08-21 | 3 | SUPERSEDED | tip = head of merged PR #1394 | - |
| `cert/wave-f` @ 1622f8562c | branch | 2026-08-21 | 4 | SUPERSEDED | tip = head of merged PR #1395 | - |
| `cert/wave-g` @ 6d1523a8fc | branch | 2026-08-21 | 4 | SUPERSEDED | tip = head of merged PR #1396 | - |
| `certworld/live-execution-gate-v2` @ 5088fc181d | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1418 | - |
| `chore/ci-allowlist-shrink` @ a9ba487c38 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1375 | - |
| `chore/close-mass-definition` @ ebb90d4596 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1268 | - |
| `chore/correct-lane-durability` @ d36cd85ba6 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1178 | - |
| `chore/customer1-orchestrator-framework` @ ab22197666 | branch | 2026-09-04 | 3 | SUPERSEDED | tip = head of merged PR #1797 | - |
| `chore/dead-warehouse-path` @ dc86464c4c | branch | 2026-08-17 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `chore/deny-list-release-path-hardening` @ 293ce5c478 | branch | 2026-08-26 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `chore/functions-node-runtime` @ c435e8c0bc | branch | 2026-08-15 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `chore/ignore-operator-intents` @ fad019f610 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1057 | - |
| `chore/leaf-integration-ownership` @ 348167e0cb | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1164 | - |
| `chore/ledger-account-fields` @ 61d014322d | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1186 | - |
| `chore/ledger-backfill-actioncopy` @ 152cbdf595 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1172 | - |
| `chore/ledger-baseline` @ 2eeb016e6b | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1228 | - |
| `chore/ledger-capability-parts` @ 81cf139050 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1210 | - |
| `chore/ledger-contacts-locations` @ 73fed68e45 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1218 | - |
| `chore/ledger-continuation` @ 247f3d3399 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1173 | - |
| `chore/ledger-crm-definitions` @ 8a534333c4 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1155 | - |
| `chore/ledger-declines` @ 5cec56342d | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1240 | - |
| `chore/ledger-equipment-blocked` @ d394feeb61 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1174 | - |
| `chore/ledger-field-fixes` @ b4372717d6 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1220 | - |
| `chore/ledger-fieldgroup` @ 5270bb28b0 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1214 | - |
| `chore/ledger-gate-b` @ 30b705896b | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1142 | - |
| `chore/ledger-index-callable` @ 2f9b39b16c | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1230 | - |
| `chore/ledger-list-gaps` @ 126b9a9799 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1203 | - |
| `chore/ledger-manufacturer` @ 48ac22037b | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1197 | - |
| `chore/ledger-page-sections` @ fd3bd6dea7 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1188 | - |
| `chore/ledger-part-equipment` @ b0966dc8c4 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1169 | - |
| `chore/ledger-provenance` @ 2b242178a2 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1150 | - |
| `chore/ledger-query-model` @ 53ef7f2280 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1152 | - |
| `chore/ledger-record-page-dependency` @ 98e9fb5321 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1145 | - |
| `chore/ledger-record-page-unblocked` @ 269f39d656 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1180 | - |
| `chore/ledger-ref-upgrade` @ 9b8876577d | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1184 | - |
| `chore/ledger-reference` @ 5a5b6edc69 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1222 | - |
| `chore/ledger-renderer-lane` @ fa9a155e2c | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1193 | - |
| `chore/ledger-renderer-merged` @ e36d687c9a | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1195 | - |
| `chore/ledger-resume` @ 477e8a9316 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1175 | - |
| `chore/ledger-roles` @ 39e086de8c | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1244 | - |
| `chore/ledger-search-employee` @ 0c5721f430 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1179 | - |
| `chore/ledger-so-numbering` @ 964f80ae7a | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1159 | - |
| `chore/ledger-surfaces` @ 401d62a4a7 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1234 | - |
| `chore/ledger-three-leaves` @ 5a40299350 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1182 | - |
| `chore/ledger-validator` @ 0d2c5614ca | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1216 | - |
| `chore/ledger-warehouse-supplier` @ 8c4bfa473e | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1190 | - |
| `chore/ledger-wave4` @ 0856f97cff | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1227 | - |
| `chore/ledger-wave5-reconcile` @ 002fa2da40 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1262 | - |
| `chore/ledger-wiring` @ a93fd8cd1c | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1192 | - |
| `chore/ledger-wiring-findings` @ 5ab2710110 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1199 | - |
| `chore/ledger-wo-surface` @ 972e1ecaeb | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1144 | - |
| `chore/merge-test-safety` @ 850d34f6b4 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1238 | - |
| `chore/mikael-persona-key` @ 0395cab28e | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1333 | - |
| `chore/owner-decision-package` @ c4e731efad | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1255 | - |
| `chore/preflight-evidence` @ e4d672d00f | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1269 | - |
| `chore/promotion-2r-plan` @ 6bc98209dc | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1274 | - |
| `chore/scanner-closeout` @ 2280d82971 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1373 | - |
| `chore/shared-serialization-rule` @ 5630be1703 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1163 | - |
| `chore/site-work-backlog` @ d8e4e135ef | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #884 | - |
| `chore/site-work-round1-fixed` @ 163aca985d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #883 | - |
| `chore/site-work-round2-state` @ e0fcbcbc24 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #891 | - |
| `chore/so-identity-ruling-docs` @ f48d0cf6d6 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1158 | - |
| `chore/tier2-bounded-permission-policy` @ 7a4f0691d5 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #712 | - |
| `chore/tranche1-evidence` @ 1875f9aa01 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1270 | - |
| `chore/tranche2-evidence` @ 98fc58047f | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1271 | - |
| `chore/tranche2r-evidence` @ cba50e0b87 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1275 | - |
| `chore/untrack-impeccable-cache` @ 01687a38fd | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1338 | - |
| `chore/wave7-manifest-reconcile` @ c253fabdfd | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1005 | - |
| `chore/wave7-manifest-slice-b` @ a31e3933d4 | branch | 2026-08-15 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/2c-closeout-rules-correction` @ ee05e9fce9 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1673 | - |
| `claude/2c3-r32-binding-scope` @ 595622bed3 | branch | 2026-09-01 | 6 | SUPERSEDED | tip = head of merged PR #1668 | - |
| `claude/2c4-callable-gate` @ 45dce9d639 | branch | 2026-09-01 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/2c5-census` @ 4d3bb193df | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/2c6c-reporting-boundary` @ ff06bed108 | branch | 2026-09-02 | 10 | SUPERSEDED | tip = head of merged PR #1768 | - |
| `claude/2c6f-prod-activation` @ 573be67949 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1779 | - |
| `claude/agreement-visual-harness` @ 795a98c912 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1587 | - |
| `claude/api-connection-home-b61d42` @ d75733b0bf | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1445 | - |
| `claude/attributed-review-fixtures` @ cef47c6620 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1714 | - |
| `claude/bin-conversion-p7-docs` @ 679f013f7d | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1837 | - |
| `claude/bin-location-authority` @ 2351e62eb2 | branch | 2026-09-02 | 4 | SUPERSEDED | tip = head of merged PR #1747 | - |
| `claude/bin-p1-implementation` @ f81b17e3d9 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1756 | - |
| `claude/bin-p1-stable-location-identity` @ a81886a55c | branch | 2026-09-02 | 7 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/bin-p2-retire-legacy-inventory` @ b3459f9a43 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1759 | - |
| `claude/bin-p2r-client-rules-retirement` @ 7d1c9eae35 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1763 | - |
| `claude/bin-p3-racking-generator` @ 38325c4094 | branch | 2026-09-02 | 4 | SUPERSEDED | tip = head of merged PR #1771 | - |
| `claude/bin-p3-racking-generator-spec` @ b5f6e3b868 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1766 | - |
| `claude/bin-p4-relocation-roles` @ 5b6d25ba80 | branch | 2026-09-10 | 2 | SUPERSEDED | tip = head of merged PR #1838 | - |
| `claude/bin-p6-multiscan-main` @ 07d3ff00f9 | branch | 2026-09-10 | 2 | SUPERSEDED | tip = head of merged PR #1836 | - |
| `claude/bin-p6-relocation` @ ce9cfdd32e | branch | 2026-09-10 | 2 | SUPERSEDED | tip = head of merged PR #1835 | - |
| `claude/bin-p6-spec` @ 29e740425d | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1833 | - |
| `claude/bin-p7-cycle-count-eligibility` @ 07a0e56f64 | branch | 2026-09-10 | 2 | SUPERSEDED | tip = head of merged PR #1840 | - |
| `claude/bin-release-record-v2` @ dd9e1141ee | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1851 | - |
| `claude/bin-release-repin-308efd8a` @ bee59ee842 | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1853 | - |
| `claude/bin-sandbox-release-kit` @ 787dc03283 | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1842 | - |
| `claude/cert-closeout` @ b11eca30f3 | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cert-cycle-activate` @ 909c7aab27 | branch | 2026-09-02 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cert-cycle-applier` @ 75c501f5ea | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1753 | - |
| `claude/cert-cycle-ci` @ 9e1ee60286 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1758 | - |
| `claude/cert-cycle-recover` @ 69caa1ce8b | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cert-fin-before` @ fcffc8319f | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1748 | - |
| `claude/cert-genesis-completion` @ 3fd0a61538 | branch | 2026-08-31 | 2 | SUPERSEDED | tip = head of merged PR #1634 | - |
| `claude/cert-genesis-runtime-identity-fix` @ bb7d1556a5 | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cert-unobserved` @ 86af62573a | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1674 | - |
| `claude/cert-web-apikey-drift-fix` @ 8ca8fa635d | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cert-world-execution-authority` @ fa675a5dc0 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1604 | - |
| `claude/cert-world-v17` @ 4a97442b18 | branch | 2026-08-30 | 3 | SUPERSEDED | tip = head of merged PR #1620 | - |
| `claude/ci-assurance-contract` @ 049c6f41ba | branch | 2026-08-29 | 2 | SUPERSEDED | tip = head of merged PR #1570 | - |
| `claude/ci-suite-absence-amendment` @ 6882eae5c0 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1528 | - |
| `claude/ci-v2-1-batch1` @ fc19551229 | branch | 2026-08-29 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/ci-v2-1-batch2` @ 4565787cab | branch | 2026-08-29 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/ci-v2-1-final` @ 89b3d329f3 | branch | 2026-08-29 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/ci-v2-p0` @ 5c28212bda | branch | 2026-08-29 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cycle-count-a1-reconciliation` @ 0b62765dba | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1841 | - |
| `claude/cycle-count-a1-sheets` @ eacffe1327 | branch | 2026-09-10 | 3 | SUPERSEDED | tip = head of merged PR #1848 | - |
| `claude/cycle-count-m1-closeout` @ e4bdd75b3d | branch | 2026-09-10 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/cycle-count-p8-client` @ 5839b4869d | branch | 2026-09-10 | 7 | SUPERSEDED | tip = head of merged PR #1849 | - |
| `claude/decisions-139-correction` @ 81e370542d | branch | 2026-08-29 | 1 | SUPERSEDED | tip = head of merged PR #1573 | - |
| `claude/dispatch-acceptance-harness` @ 043e17c6a5 | branch | 2026-08-29 | 1 | SUPERSEDED | tip = head of merged PR #1581 | - |
| `claude/dispatch-nav-consolidation` @ bbf271412f | branch | 2026-08-30 | 3 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/dispatch-north-star-p1` @ 4a5a8054d4 | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1558 | - |
| `claude/dispatch-ns-accept` @ ee92136bb1 | branch | 2026-08-27 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/dispatch-ns-final` @ 26d502a3ce | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1561 | - |
| `claude/dispatch-ns-gate` @ 1d7d3a16a7 | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1560 | - |
| `claude/dispatch-ns-verify` @ 863020c64f | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1559 | - |
| `claude/dispatch-scheduler-design-9629cd` @ 822028f640 | branch | 2026-08-27 | 6 | SUPERSEDED | tip = head of merged PR #1549 | - |
| `claude/dispatch-scheduler-north-star-4d04d5` @ 771137b52c | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1555 | - |
| `claude/dispatch-tech-picker` @ e9ab30f629 | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1563 | - |
| `claude/dispatch-visual-corrections` @ 8ff01f0b51 | branch | 2026-08-29 | 1 | SUPERSEDED | tip = head of merged PR #1580 | - |
| `claude/docs-2b-activated` @ 1d627ea67f | branch | 2026-08-31 | 2 | SUPERSEDED | tip = head of merged PR #1653 | - |
| `claude/eos-dashboard-authority-census-07581d` @ 94a48f60da | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1740 | - |
| `claude/eos-dashboard-personalization-d77a66` @ 5bf32e7f9c | branch | 2026-09-02 | 15 | SUPERSEDED | tip = head of merged PR #1745 | - |
| `claude/eos-data-import-p1` @ b533757a51 | branch | 2026-09-04 | 14 | SUPERSEDED | tip = head of merged PR #1804 | - |
| `claude/eos-lists-north-star-prep-37e3e0` @ ce6c9eb376 | branch | 2026-08-27 | 13 | SUPERSEDED | tip = head of merged PR #1547 | - |
| `claude/eos-ownership-model-4b9ef8` @ c781882618 | branch | 2026-08-30 | 9 | SUPERSEDED | tip = head of merged PR #1602 | - |
| `claude/eos-sandbox-test-prompt-eb1c7a` @ a14755c457 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1611 | - |
| `claude/equipment-add-tab-composition` @ 49e80dc822 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1626 | - |
| `claude/equipment-family8-accepted` @ a74eaa7d06 | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/equipment-family8-gate-result` @ a29d8f8e12 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1627 | - |
| `claude/equipment-filters-palette` @ 1d6c9f4914 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1635 | - |
| `claude/equipment-north-star-impl-37f4d1` @ 7f13c581c4 | branch | 2026-08-30 | 2 | SUPERSEDED | tip = head of merged PR #1613 | - |
| `claude/equipment-north-star-quick-gate` @ 48aa144bf2 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1618 | - |
| `claude/equipment-quick-gate-false-positives` @ 55b87d1909 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1621 | - |
| `claude/equipment-secondary-rail-alignment` @ a8e6382617 | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/equipment-workspace-composition` @ 6dc7f83eac | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1624 | - |
| `claude/fin-aging-fallback` @ 9817af8780 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1730 | - |
| `claude/fin-ar-aging` @ ed7e073fc9 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1729 | - |
| `claude/fin-customer-nav` @ 65d5dfb4d9 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1728 | - |
| `claude/fin-extref-resilience` @ 4de464e541 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1734 | - |
| `claude/fin-facts-table` @ 3584c90873 | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/fin-hover-consistency` @ 2d6afbb104 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1738 | - |
| `claude/fin-invoice-detail` @ 33bd4ce00f | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1727 | - |
| `claude/fin-payments-identity` @ c09d4a0c1c | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1732 | - |
| `claude/fin-scorecard-formatting` @ af4516fa46 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1736 | - |
| `claude/fin001a-authority-closeout` @ 73ebe5b2fc | branch | 2026-08-30 | 3 | SUPERSEDED | tip = head of merged PR #1633 | - |
| `claude/fin004-reach-reconciliation` @ 57f7f49b3d | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1743 | - |
| `claude/fin004-role-reconciliation` @ 6aa313fe81 | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1744 | - |
| `claude/financials-activation-readiness` @ be802ba5b6 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1687 | - |
| `claude/financials-blocker-decision-packages` @ cfe42ccf17 | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1691 | - |
| `claude/financials-corrections-followup` @ 64710688a1 | branch | 2026-09-01 | 2 | SUPERSEDED | tip = head of merged PR #1703 | - |
| `claude/financials-corrections-r2-followup` @ 8642e62ff7 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1705 | - |
| `claude/financials-e2e-cert-readiness` @ d5a0c635ac | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1688 | - |
| `claude/financials-fin-block-001-scope-binding` @ d7e45f2d58 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1690 | - |
| `claude/financials-fin-block-005-reclassification` @ b4febdcf50 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1692 | - |
| `claude/financials-fin002-reporting-attribution` @ cfd5bb1c8a | branch | 2026-09-01 | 6 | SUPERSEDED | tip = head of merged PR #1671 | - |
| `claude/financials-fin003-plan-vs-actual` @ c5c55812ef | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1679 | - |
| `claude/financials-fin005-forecasting` @ 85cd4c97e3 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1680 | - |
| `claude/financials-fin007-approvals` @ 96dd3e8d38 | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1681 | - |
| `claude/financials-fin008-periods` @ 921579d46b | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1682 | - |
| `claude/financials-fin009-allocation-intercompany` @ 385e7ca3b5 | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1683 | - |
| `claude/financials-fin010-reconciliation` @ dcca36b495 | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1684 | - |
| `claude/financials-fixtures-companyid` @ 5f757278ee | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1708 | - |
| `claude/financials-gate-locator-fix` @ bd89ffb014 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1706 | - |
| `claude/financials-governed-reporting-read` @ 56de635e3b | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1709 | - |
| `claude/financials-navigation-structure-980906` @ 38a393e8ee | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1616 | - |
| `claude/financials-period-filter` @ 3c6a4f6c37 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1717 | - |
| `claude/financials-reporting-matrix` @ c95d3a0da9 | branch | 2026-09-01 | 2 | SUPERSEDED | tip = head of merged PR #1686 | - |
| `claude/financials-review-fixtures` @ a590394140 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1707 | - |
| `claude/financials-run-closeout` @ 7784edd56e | branch | 2026-09-01 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/financials-sandbox-gate-ledger` @ d27ca08909 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1701 | - |
| `claude/financials-surface-bindings` @ bc0bcb353e | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1710 | - |
| `claude/financials-surface-readiness` @ 80c051b42a | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1685 | - |
| `claude/financials-ux-375-grid-fix` @ c2958d8674 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1700 | - |
| `claude/financials-ux-billing-corrections` @ fd2a84069b | branch | 2026-09-01 | 2 | SUPERSEDED | tip = head of merged PR #1695 | - |
| `claude/financials-ux-design-install` @ 308307ea45 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1693 | - |
| `claude/financials-ux-governance` @ ffeb1c2492 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1698 | - |
| `claude/financials-ux-lifecycle` @ 42954fc61c | branch | 2026-09-01 | 3 | SUPERSEDED | tip = head of merged PR #1694 | - |
| `claude/financials-ux-performance` @ 5233e310a0 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1697 | - |
| `claude/financials-ux-plan-forecast` @ e43980c66a | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1696 | - |
| `claude/financials-visual-acceptance-corrections` @ 648927d715 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1702 | - |
| `claude/fix-filtered-empty` @ 2584493831 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1718 | - |
| `claude/fix-payments-empty-state` @ d53213de41 | branch | 2026-09-01 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/fixture-seed-warehouse-canonical-id` @ 01666e9277 | branch | 2026-08-31 | 1 | SUPERSEDED | tip = head of merged PR #1651 | - |
| `claude/g2-ceremony` @ 8603c5ddf5 | branch | 2026-08-31 | 1 | SUPERSEDED | tip = head of merged PR #1666 | - |
| `claude/golden-scenario-expectation` @ b3e59b4efc | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1608 | - |
| `claude/hosting-only-sandbox-release` @ 0a96dd0915 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1591 | - |
| `claude/hover-pair-mirror` @ bab6a40eaf | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1741 | - |
| `claude/hover-sweep-reach` @ afd682866e | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/impeccable-design-artifact-ignore` @ c48e6ccbfc | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1699 | - |
| `claude/ledger-period` @ 8cc95791da | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1719 | - |
| `claude/ledger-populated-gate` @ 279f5aa388 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1713 | - |
| `claude/ledger-salesperson` @ 09952ba89d | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1715 | - |
| `claude/ledger-semantics` @ a592eaef56 | branch | 2026-09-01 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/lists-p2-visual-correction` @ cc4805b118 | branch | 2026-08-27 | 2 | SUPERSEDED | tip = head of merged PR #1548 | - |
| `claude/nd24-gate-result` @ b89fac3b36 | branch | 2026-08-27 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/nd24-scheduling-symmetry` @ c39bbba441 | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1556 | - |
| `claude/nd33-acquire-endpoint` @ d4f6f6b1c3 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1631 | - |
| `claude/nd33-targeted-deploy-isolation` @ cd056e24e8 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1638 | - |
| `claude/ns-table-wrap-containment` @ 77852ad578 | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/o4-declined` @ f9c2156d1b | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1588 | - |
| `claude/opportunity-list-p1v4` @ d327f6b589 | branch | 2026-08-27 | 4 | SUPERSEDED | tip = head of merged PR #1545 | - |
| `claude/opportunity-north-star-code-69ba26` @ 014f8bd5e7 | branch | 2026-08-26 | 6 | SUPERSEDED | tip = head of merged PR #1514 | - |
| `claude/opportunity-owner-fact-fix` @ b34cdbf816 | branch | 2026-08-26 | 3 | SUPERSEDED | tip = head of merged PR #1529 | - |
| `claude/opportunity-row-navigation-certification` @ dce129334a | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1527 | - |
| `claude/orchestration-trigger-repair` @ 023ced4cc6 | branch | 2026-08-29 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/overview-lifecycle` @ cde333e186 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1716 | - |
| `claude/ownership-2a1b-physical-root-company-authority` @ 317fbc5885 | branch | 2026-08-31 | 3 | SUPERSEDED | tip = head of merged PR #1649 | - |
| `claude/ownership-field-strict-readers` @ d151b844cd | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1844 | - |
| `claude/ownership-r12-correction` @ af3ece6b8e | branch | 2026-08-30 | 9 | SUPERSEDED | tip = head of merged PR #1619 | - |
| `claude/ownership-r27-warehouse-canonical-id-repair` @ d73b42ba00 | branch | 2026-08-31 | 2 | SUPERSEDED | tip = head of merged PR #1652 | - |
| `claude/p1v2-solution-and-conversion` @ b79816893a | branch | 2026-08-30 | 3 | SUPERSEDED | tip = head of merged PR #1585 | - |
| `claude/p1v4-gate-selector` @ 765f7c022a | branch | 2026-08-27 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/parts-1a-leads-the-page` @ 366f2d2e21 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1615 | - |
| `claude/parts-assign-in-card` @ 5e26d05ff9 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1731 | - |
| `claude/parts-gate-3b-visible-title` @ f6d7fe378a | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1622 | - |
| `claude/parts-gate-frame1a-selector` @ 078826ca32 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1612 | - |
| `claude/parts-north-star-design-4d751e` @ 68019dc8e8 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1590 | - |
| `claude/parts-p1-acceptance-boundary` @ e26311712b | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1623 | - |
| `claude/parts-p1-frame1a` @ 6265d9defd | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1609 | - |
| `claude/parts-p1-gate` @ ef90220b60 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1599 | - |
| `claude/parts-p1-gate-fix` @ 81b0614efc | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1603 | - |
| `claude/parts-reorder-point-semantics` @ 82518f520b | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1605 | - |
| `claude/parts-retire-inventory-action-writes` @ c077d572ef | branch | 2026-08-30 | 2 | SUPERSEDED | tip = head of merged PR #1625 | - |
| `claude/pilot-merge-ar-copy` @ 2dafb5ee6e | branch | 2026-09-02 | 2 | SUPERSEDED | tip = head of merged PR #1725 | - |
| `claude/post-1-8-0-verify` @ a450ab7951 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1669 | - |
| `claude/post-cert-world-1-8-0` @ d682bfe1fd | branch | 2026-08-31 | 1 | SUPERSEDED | tip = head of merged PR #1667 | - |
| `claude/principal-provisioning-authority` @ 53f340caaf | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1606 | - |
| `claude/prod-release-identity-gap` @ f3b7a1b164 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1531 | - |
| `claude/r33-record` @ 7de17091f6 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1670 | - |
| `claude/rcv-g4-metadata-numbering-authority` @ 64eec780d8 | branch | 2026-08-31 | 1 | SUPERSEDED | merged PR #1648; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `claude/receiving-acquire-ux` @ 0f8d8289a7 | branch | 2026-08-30 | 2 | SUPERSEDED | tip = head of merged PR #1639 | - |
| `claude/receiving-ux-north-star-c44130` @ 7bb8f2939d | branch | 2026-08-31 | 28 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/release-identity-bounded-retry` @ ee17f8ce3b | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1530 | - |
| `claude/release-tooling-ci-coverage-gap` @ 8fffbfcdde | branch | 2026-08-26 | 3 | SUPERSEDED | tip = head of merged PR #1532 | - |
| `claude/release-tooling-lane` @ 7c09b1cd75 | branch | 2026-08-29 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/reporting-semantics` @ 900321eb2f | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1720 | - |
| `claude/roles-permissions-environment-activation` @ 0063c8467e | branch | 2026-09-04 | 6 | SUPERSEDED | tip = head of merged PR #1805 | - |
| `claude/sa-g7-agreement-line-pricing` @ e344e1b9c0 | branch | 2026-08-27 | 1 | SUPERSEDED | tip = head of merged PR #1544 | - |
| `claude/sales-agreement-p1v2-corrections-8d4546` @ 5ff156555a | branch | 2026-08-26 | 2 | SUPERSEDED | tip = head of merged PR #1533 | - |
| `claude/sandbox-consolidated-visibility` @ 16888027db | branch | 2026-09-01 | 2 | SUPERSEDED | tip = head of merged PR #1711 | - |
| `claude/sandbox-index-reconciliation` @ a220120a77 | branch | 2026-08-29 | 1 | SUPERSEDED | tip = head of merged PR #1575 | - |
| `claude/scanner-governed-part-read` @ a54a50d261 | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1845 | - |
| `claude/scanner-runner-bin-contract` @ fdd022d294 | branch | 2026-09-10 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/scanner-runner-v2-counts` @ 960971b07a | branch | 2026-09-10 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `claude/scope-r29` @ 617043665b | branch | 2026-08-31 | 3 | SUPERSEDED | tip = head of merged PR #1665 | - |
| `claude/service-operations-north-star-p1` @ 621ef23a54 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1589 | - |
| `claude/service-ops-live-defects` @ e7e56feb74 | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1592 | - |
| `claude/service-ops-p1-closeout` @ 966684f09e | branch | 2026-08-30 | 1 | SUPERSEDED | tip = head of merged PR #1597 | - |
| `claude/so-acceptance-record` @ d0c46b222d | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1516 | - |
| `claude/summary-fallback` @ 7fded11a46 | branch | 2026-09-01 | 1 | SUPERSEDED | tip = head of merged PR #1721 | - |
| `claude/technician-transfer-governed-read` @ fd9e0a947d | branch | 2026-09-10 | 1 | SUPERSEDED | tip = head of merged PR #1852 | - |
| `claude/workstream2-reorder-warehouse` @ a38fc5c91e | branch | 2026-08-31 | 15 | SUPERSEDED | tip = head of merged PR #1646 | - |
| `claude/workstream2a1-warehouse-company-measurement` @ 6c66760f2f | branch | 2026-08-31 | 2 | SUPERSEDED | tip = head of merged PR #1647 | - |
| `codex/backlog-admin-reset-reason` @ cb8318cb52 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #897 | - |
| `codex/backlog-ar-currency` @ f2bdc10cdb | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #901 | - |
| `codex/backlog-assigned-wo-bound` @ 037be851da | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #904 | - |
| `codex/backlog-auth-context-error` @ 238dac6a50 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #909 | - |
| `codex/backlog-compatibility-parallel` @ 6301346f8e | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `codex/backlog-coverage-callable-tests` @ 336f34a134 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #913 | - |
| `codex/backlog-coverage-truncation` @ d4a1bde3e3 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `codex/backlog-dispatch-concurrency` @ 9f0c2e242c | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #902 | - |
| `codex/backlog-dispatch-error` @ 429eb40633 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #903 | - |
| `codex/backlog-execution-analytics-tests` @ f62dcc392a | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #911 | - |
| `codex/backlog-inventory-effect-callable` @ 594c413150 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #916 | - |
| `codex/backlog-inventory-reservation` @ 18758bfde7 | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #914 | - |
| `codex/backlog-opportunity-date` @ 2fb681c150 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #900 | - |
| `codex/backlog-permission-parity` @ 11d011a8ae | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `codex/backlog-receiving-runtime` @ c5a12add71 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #898 | - |
| `codex/backlog-receiving-stale-guard` @ df452e8fc5 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #899 | - |
| `codex/backlog-reconciliation-scope` @ 31c5bed43d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #917 | - |
| `codex/backlog-server-analytics-callable` @ ea1b3b400d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #918 | - |
| `codex/backlog-warehouse-transfer-bins` @ b4b240705a | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #915 | - |
| `codex/register-reconcile-round2` @ 51eaf83650 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `codex/site-work-backlog-dedup` @ 2c4819f18b | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `codex/site-work-r2-c1` @ 82bdcf5518 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #893 | - |
| `codex/site-work-r2-c2` @ b15317f315 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #894 | - |
| `codex/site-work-r2-c3` @ e93f0e3a0e | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #895 | - |
| `codex/site-work-r2-c4` @ 2e0e5ab0cf | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #896 | - |
| `codex/site-work-register-reconcile` @ c5c5364658 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `converge2` @ c06157c173 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1053 | - |
| `cor-integrate` @ a5ec9eddd9 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1030 | - |
| `crm-integrate` @ de580aa8c1 | branch | 2026-08-15 | 4 | SUPERSEDED | tip = head of merged PR #1019 | - |
| `dashboard/duration-corrective` @ 87a23349de | branch | 2026-09-04 | 3 | SUPERSEDED | tip = head of merged PR #1796 | - |
| `dashboard/live-status-labels` @ c79e8a1c4d | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1795 | - |
| `dashboard/persona-sweep` @ 09322286b7 | branch | 2026-09-03 | 2 | SUPERSEDED | tip = head of merged PR #1793 | - |
| `dashboard/sweep-acceptance` @ d5c26ffe95 | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1794 | - |
| `dda-integrate` @ f9c32c259d | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1029 | - |
| `deploy/gap-closeout` @ 556944ed58 | branch | 2026-08-21 | 1 | SUPERSEDED | tip = head of merged PR #1405 | - |
| `deploy/sandbox-scanner` @ eb496e5b8d | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1381 | - |
| `deploy/scanner-promotion` @ ac507c18d3 | branch | 2026-08-20 | 2 | SUPERSEDED | tip = head of merged PR #1382 | - |
| `deploy4` @ 61bbfb1175 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1068 | - |
| `docs/admin-data-console` @ c25bb1045c | branch | 2026-08-19 | 3 | SUPERSEDED | tip = head of merged PR #1327 | - |
| `docs/analytics-investigation` @ 31a5287a6c | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1284 | - |
| `docs/analytics-repair-deployed` @ 045a0b84ce | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1285 | - |
| `docs/assign-runtime-closure` @ 5abfa63885 | branch | 2026-09-02 | 1 | SUPERSEDED | tip = head of merged PR #1735 | - |
| `docs/backfill-executed` @ 51452f9174 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1280 | - |
| `docs/backfill-package` @ ae8993291b | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1276 | - |
| `docs/backfill-package-reissue` @ bcead18583 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1279 | - |
| `docs/backlog-data-currency` @ fb29df146f | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #740 | - |
| `docs/backlog-reconcile-post-driver` @ be35d36aea | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #713 | - |
| `docs/close-dashboard-families` @ efc3ada5ad | branch | 2026-09-04 | 1 | SUPERSEDED | tip = head of merged PR #1800 | - |
| `docs/codex-backlog-blitz` @ c411de5c37 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/codex-handoff-site-work` @ e29516b5f3 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #885 | - |
| `docs/control-center-hosting-design` @ cb46ec3fd9 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #738 | - |
| `docs/crm-activity-admin-authority-proposal` @ 059eda176e | branch | 2026-08-19 | 3 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/customer1-lane-b-seeded-evidence` @ d52dab2acf | branch | 2026-09-04 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/duplicate-detection-spec` @ 44bfb51ce3 | branch | 2026-08-19 | 5 | SUPERSEDED | tip = head of merged PR #1326 | - |
| `docs/e2e-results` @ 35842453a2 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1065 | - |
| `docs/e2e-round2` @ c2b3c8077d | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/email-family-12-accepted` @ 60f3b07bec | branch | 2026-09-06 | 1 | SUPERSEDED | tip = head of merged PR #1817 | - |
| `docs/email-sandbox-deployment` @ 8872f246a0 | branch | 2026-09-06 | 1 | SUPERSEDED | tip = head of merged PR #1815 | - |
| `docs/enterprise-business-metrics-framework` @ 6c59152002 | branch | 2026-07-12 | 5 | SUPERSEDED | tip = head of merged PR #163 | - |
| `docs/f1-lifecycle-spec` @ b96a8c7e66 | branch | 2026-08-14 | 3 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/field-architecture-v2` @ cca3fb92ac | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1143 | - |
| `docs/functions-invoker-gap` @ 4b84c51711 | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/functions-promotion-closeout` @ e9dc031048 | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/functions-promotion-recovery` @ 16ef70f4c2 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1090 | - |
| `docs/gap-scan-wave3` @ 905db3502f | branch | 2026-08-18 | 3 | SUPERSEDED | tip = head of merged PR #1288 | - |
| `docs/gate-a-review-package` @ bad4c0b062 | branch | 2026-08-17 | 4 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/gpt-wake-seam` @ 36080ccc59 | branch | 2026-08-09 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/handheld-ux-state` @ c7e0c96fe3 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1388 | - |
| `docs/issue-226-row20-issue15-reconciliation` @ 067c5052d2 | branch | 2026-07-16 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/location-registry-finding` @ 8da8c09fbf | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1360 | - |
| `docs/loop-continuation-driver` @ 20a6a50977 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #710 | - |
| `docs/manager-role-grant-manifest` @ ade07c7982 | branch | 2026-08-19 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/metadata-architecture-ip-boundary` @ 91174a4822 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1092 | - |
| `docs/metadata-architecture-specification` @ a458d881c9 | branch | 2026-08-17 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/multi-line-po-phase-b` @ c72a6f9e4c | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1353 | - |
| `docs/opportunity-acceptance-reconciliation` @ b31a5289f2 | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/opportunity-management-assessment` @ bd949a425e | branch | 2026-08-07 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/overnight-roadmap-reconcile` @ eb1f1115b4 | branch | 2026-08-20 | 3 | SUPERSEDED | tip = head of merged PR #1343 | - |
| `docs/overnight-ws456-register` @ cdec40b439 | branch | 2026-08-20 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/owner-rulings-2026-08-19` @ ff8f3881d1 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1304 | - |
| `docs/pages-governance-decision` @ 0229b2c6d7 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1028 | - |
| `docs/parts-assign-training` @ 30d2f3777b | branch | 2026-09-02 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/prod-release-runbook` @ 9a16feb8c7 | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1337 | - |
| `docs/promotion-closeout` @ ac03aeeee8 | branch | 2026-08-18 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/record-ownership` @ 78d434ca1a | branch | 2026-08-19 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/roadmap-model-self-close` @ f1bd695b1d | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #718 | - |
| `docs/sales-agreement-family-closeout` @ a5cd0cab86 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1541 | - |
| `docs/sales-agreement-owner-acceptance` @ 8e0adcc975 | branch | 2026-08-26 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/sandbox-gap-scan` @ 8ecf801f1b | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1287 | - |
| `docs/sandbox-promotion-cd442727` @ e175124fb7 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1089 | - |
| `docs/scanner-program-reconciliation` @ 64452876d7 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1351 | - |
| `docs/scanner-reconciliation` @ 6a6514be03 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1379 | - |
| `docs/scanner-validation-record` @ 6700bca3e0 | branch | 2026-08-20 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/system-authorities-finance-coverage` @ 5105f1717a | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #706 | - |
| `docs/system-authorities-sales-spine` @ bf4f8b063f | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #707 | - |
| `docs/timestamp-consumer-gate` @ d1a1827212 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1281 | - |
| `docs/training-email-inbound-work` @ 412017cfa3 | branch | 2026-09-06 | 1 | SUPERSEDED | tip = head of merged PR #1818 | - |
| `docs/tranche3-hosting` @ fe868b1851 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1282 | - |
| `docs/user-guide-refresh-clean` @ e7261c79e2 | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1320 | - |
| `docs/wave7-crm-manifest` @ 1221fe9431 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1018 | - |
| `docs/wave7-deployment-corrections` @ fe16055d5c | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1022 | - |
| `docs/wave7-deployment-runbook` @ 09ba2cd01d | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1021 | - |
| `docs/wave7-extension-classifications` @ c85f37f25c | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1010 | - |
| `docs/wave7-final-reconciliation` @ 74c261b2a3 | branch | 2026-08-15 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `docs/wave7-manifest-1012-1014` @ ba57b13fcc | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1015 | - |
| `docs/wo-engine-depth` @ 7426eebe59 | branch | 2026-08-18 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `dsw-integrate` @ 60092d468c | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1025 | - |
| `eos-852-children` @ 55e520b2d9 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `eos/authorize-mcp-setup` @ fa2f5f4d56 | branch | 2026-08-11 | 3 | SUPERSEDED | tip = head of merged PR #800 | - |
| `eos/c7-cold-start-context` @ 0fd18816b8 | branch | 2026-08-10 | 1 | SUPERSEDED | tip = head of merged PR #761 | - |
| `eos/fix-mcp-setup` @ b0d08ba12d | branch | 2026-08-11 | 1 | SUPERSEDED | tip = head of merged PR #801 | - |
| `eos/pilot-gpt-outcome-observability` @ faa8d5746a | branch | 2026-08-10 | 1 | SUPERSEDED | tip = head of merged PR #778 | - |
| `feat/access-contract-generator` @ dab0d17de7 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1110 | - |
| `feat/account-attention-projection` @ 40dc80aaa9 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1017; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/account-page-sections` @ 492f79eedf | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1187 | - |
| `feat/account-portfolio-summary` @ 7e2197bdfa | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1138 | - |
| `feat/account-scoped-commercial-reads` @ 1a28c0cbfc | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1024; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/account-wiring-complete` @ 8a0fac6057 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1198 | - |
| `feat/account-workspace-redesign` @ eaafcb7429 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1016 | - |
| `feat/activate-missing-sandbox-personas` @ 8e600a4fcc | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1315 | - |
| `feat/active-vocabulary` @ fe7f06e5ba | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1307 | - |
| `feat/admin-duplicate-rules` @ a82d7701ac | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1331 | - |
| `feat/agent-ops-roadmap-and-exercise` @ 7c6e3a4138 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #720 | - |
| `feat/ai-exchange-ledger` @ 0647a3f4c4 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #748 | - |
| `feat/assignable-operational-roles` @ f085d5993f | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1054 | - |
| `feat/autonomy-batch` @ a03cba9817 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #756 | - |
| `feat/barcode-alias-lookup` @ c22704f2b1 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1358 | - |
| `feat/blind-cycle-count` @ 3ab97350dd | branch | 2026-08-18 | 1 | SUPERSEDED | merged PR #1310; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `feat/bounded-account-picker` @ 451e27cb3d | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1132 | - |
| `feat/c7-ai-review` @ cef7cfa0ec | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #750 | - |
| `feat/c7-context-registry-slice1` @ 55e1a6ddc5 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #753 | - |
| `feat/c7-exchange-resolved` @ 6ad7fff764 | branch | 2026-08-09 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `feat/c7-slice2-package-tool` @ f60dd34ad5 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #754 | - |
| `feat/c7-standard-dispatch` @ e50c2e6c2d | branch | 2026-08-10 | 2 | SUPERSEDED | tip = head of merged PR #758 | - |
| `feat/capability-graph` @ efd51e55a3 | branch | 2026-08-16 | 5 | SUPERSEDED | tip = head of merged PR #1075 | - |
| `feat/catalog-admin-read` @ 6e45db0fe9 | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `feat/catalog-manage-admin-ops` @ d9f957a030 | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1325 | - |
| `feat/certworld-pass2a-demand` @ bbc3708703 | branch | 2026-08-22 | 2 | SUPERSEDED | tip = head of merged PR #1415 | - |
| `feat/cockpit-projection` @ bb228160e2 | branch | 2026-08-09 | 2 | SUPERSEDED | tip = head of merged PR #744 | - |
| `feat/collaboration-decision-contracts` @ a0fd43b59d | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #742 | - |
| `feat/contact-opportunity-definitions` @ 487a834b2b | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1154 | - |
| `feat/contact-provenance-clean` @ 2e62389ebe | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1157 | - |
| `feat/control-center-projection-completion` @ db2f4e581e | branch | 2026-08-09 | 2 | SUPERSEDED | tip = head of merged PR #732 | - |
| `feat/control-plane-review-and-result-consumption` @ 7f9a88e1e7 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #741 | - |
| `feat/control-plane-seams` @ c5a16273ab | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #743 | - |
| `feat/crm-activity-authority` @ c310e2a63b | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1019; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/customers-metadata` @ ca7b8ac415 | branch | 2026-08-17 | 5 | SUPERSEDED | tip = head of merged PR #1137 | - |
| `feat/cycle-count-by-scan` @ fbade919e4 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1363 | - |
| `feat/dashboard-current-work-previews` @ aed4f28d41 | branch | 2026-09-03 | 3 | SUPERSEDED | tip = head of merged PR #1787 | - |
| `feat/dashboard-final` @ 90454f125d | branch | 2026-09-03 | 3 | SUPERSEDED | tip = head of merged PR #1788 | - |
| `feat/dashboard-reconciliation` @ 9f3f04d714 | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1786 | - |
| `feat/descriptive-bin-registry` @ e15135ee45 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1365 | - |
| `feat/design-system-foundation` @ 324ae3cd0b | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1312 | - |
| `feat/dispatch-reassignment-reason` @ 164379f672 | branch | 2026-08-18 | 3 | SUPERSEDED | merged PR #1309; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `feat/dispatch-scheduling-workspace` @ 1baf4b53e2 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1025; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/domain-researcher-agent` @ d991c4ead7 | branch | 2026-08-16 | 2 | SUPERSEDED | tip = head of merged PR #1043 | - |
| `feat/durable-outcome-triage` @ 87de65e5dc | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #745 | - |
| `feat/emulator-e2e-harness` @ de7c32de93 | branch | 2026-08-18 | 4 | SUPERSEDED | tip = head of merged PR #1302 | - |
| `feat/entity-list-metadata-v1` @ bd7872117d | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1115 | - |
| `feat/eos-authority-inheritance` @ d22a5387f8 | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #854 | - |
| `feat/eos-findings-extract` @ da96684515 | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #863 | - |
| `feat/eos-findings-register` @ ce9e184b3a | branch | 2026-08-13 | 3 | SUPERSEDED | tip = head of merged PR #860 | - |
| `feat/eos-finish-line` @ 2cf656dbc6 | branch | 2026-08-16 | 3 | SUPERSEDED | tip = head of merged PR #1048 | - |
| `feat/eos-governed-orchestration` @ 1a1efd60da | branch | 2026-08-13 | 3 | SUPERSEDED | merge into origin/main adds nothing | - |
| `feat/eos-result-consolidation` @ 6171775013 | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #855 | - |
| `feat/eos-review-ready-signal` @ d470be16c1 | branch | 2026-08-11 | 1 | SUPERSEDED | tip = head of merged PR #809 | - |
| `feat/eos-smarter-manager` @ a7a9a35e95 | branch | 2026-08-12 | 3 | SUPERSEDED | tip = head of merged PR #850 | - |
| `feat/equipment-install-authority` @ b2582f3305 | branch | 2026-08-23 | 2 | SUPERSEDED | tip = head of merged PR #1419 | - |
| `feat/field-architecture-v2` @ bf1732fed0 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1147 | - |
| `feat/grantable-governed-roles` @ cf4c838930 | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1308 | - |
| `feat/hide-cycle-counts-back-orders-nav` @ 1124223856 | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #993 | - |
| `feat/hierarchical-visibility` @ 873e6c0003 | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1334 | - |
| `feat/index-ci-bridge` @ 787b3e214f | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1129 | - |
| `feat/index-filter-combinations` @ 1b0da1a429 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1139 | - |
| `feat/inventory-analytics-capability` @ 888ca6fcbe | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1111 | - |
| `feat/inventory-catalog-read-manufacturer` @ 2ea687340c | branch | 2026-08-14 | 2 | SUPERSEDED | tip = head of merged PR #996 | - |
| `feat/inventory-transfer-cyclecount-roles` @ cb92c26608 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1052 | - |
| `feat/list-runtime` @ 1121e888ad | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1126 | - |
| `feat/location-reference-upgrade` @ 73c35af2ee | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1183 | - |
| `feat/lookup-balances-and-context` @ 0907c779d4 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1359 | - |
| `feat/lookup-only-scanning` @ c142d9a68e | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1357 | - |
| `feat/metadata-entity-contracts` @ 283387382e | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1106 | - |
| `feat/metadata-program-ledger` @ e4f53dd548 | branch | 2026-08-17 | 62 | SUPERSEDED | tip = head of merged PR #1131 | - |
| `feat/metadata-registries` @ ead08eeb17 | branch | 2026-08-17 | 4 | SUPERSEDED | tip = head of merged PR #1116 | - |
| `feat/model-routing` @ 8f4ad3f6ef | branch | 2026-08-10 | 1 | SUPERSEDED | tip = head of merged PR #759 | - |
| `feat/multi-line-receiving-phase-c` @ c405a5c5c5 | branch | 2026-08-20 | 3 | SUPERSEDED | tip = head of merged PR #1354 | - |
| `feat/multi-scan-receiving-ux` @ 0f5a20c92d | branch | 2026-08-20 | 2 | SUPERSEDED | tip = head of merged PR #1355 | - |
| `feat/nav-capability-convergence` @ 306a052ce2 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1066 | - |
| `feat/network-health-adapter` @ 3a3cf2eb5f | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #721 | - |
| `feat/north-star-wo-workspace` @ 24c7c36c2d | branch | 2026-08-25 | 3 | SUPERSEDED | tip = head of merged PR #1490 | - |
| `feat/north-star-work-order-pilot` @ aadd9cf862 | branch | 2026-08-25 | 1 | SUPERSEDED | tip = head of merged PR #1488 | - |
| `feat/occ-delivery-launcher` @ a2a56be5e8 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #739 | - |
| `feat/offline-reliability` @ 5ceefafec0 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1372 | - |
| `feat/operational-role-condition-resolver` @ d5321ca768 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1011; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/opportunity-create-and-chevrons` @ f98663af85 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1012 | - |
| `feat/opportunity-identity` @ e6526d8563 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1120 | - |
| `feat/opportunity-identity-wiring` @ 58f269e262 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1123 | - |
| `feat/option-b-autonomy-contract` @ 31a2fe0b7e | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #724 | - |
| `feat/option-b-limited-pilot` @ 2a38669bcb | branch | 2026-08-09 | 3 | SUPERSEDED | tip = head of merged PR #729 | - |
| `feat/option-b-readiness` @ 6de6cb0aec | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #725 | - |
| `feat/owner-roadmap-projection` @ 4bfe12513e | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #715 | - |
| `feat/p1-3-won-create-sales-order` @ acf99e27cd | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #947 | - |
| `feat/page-definition-contract` @ 656023c802 | branch | 2026-08-17 | 6 | SUPERSEDED | tip = head of merged PR #1118 | - |
| `feat/page-renderer` @ 54dc7a4710 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1128 | - |
| `feat/part-identifier-administration` @ 55cdda4b48 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1352 | - |
| `feat/part-master-manufacturers-advanced-nav` @ 1b4e86b7d0 | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #995 | - |
| `feat/part-master-write-sandbox-activation` @ 3c295de0b9 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1000 | - |
| `feat/part-work-order-demand` @ 1bbf044d8b | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1003; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/parts-attention-projection-bell` @ aae892e854 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #998 | - |
| `feat/parts-master-data-in-parts` @ 427834c880 | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #994 | - |
| `feat/parts-queue-consolidation` @ 06cc3223fb | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #997 | - |
| `feat/parts-ux-work-parts-flow-grouping` @ 9644c139e0 | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #992 | - |
| `feat/per-env-capability-activation` @ ae0392ca5a | branch | 2026-08-14 | 2 | SUPERSEDED | tip = head of merged PR #970 | - |
| `feat/permission-catalog-generation` @ 22f48184d1 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1117 | - |
| `feat/phantom-salesorder-repair-package` @ daba37b760 | branch | 2026-08-18 | 4 | SUPERSEDED | tip = head of merged PR #1306 | - |
| `feat/phase4-realload-proof` @ ce6ddc6981 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #722 | - |
| `feat/phase5-pilot-ux2` @ 75fd676e45 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #727 | - |
| `feat/pick-and-stage` @ 80029d86be | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1367 | - |
| `feat/pipeline-stage-track` @ 0058090b7c | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1058 | - |
| `feat/provisioning-manifests` @ e31f0e56ed | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1305 | - |
| `feat/putaway-offline` @ 2dce5fd147 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1378 | - |
| `feat/receiving-serial-capture-ui` @ 6c72fd8433 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1013; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/record-page-renderer-gaps` @ 91a2e8c8ba | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1194 | - |
| `feat/record-provenance` @ 60323ec68f | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1149 | - |
| `feat/returns-intake` @ 90db56212d | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1371 | - |
| `feat/review-provenance-and-decisions` @ 8e07c6a697 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #747 | - |
| `feat/review-render-and-friction` @ 5c0add46ab | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #749 | - |
| `feat/sales-agreement-by-id-read-seam` @ 6f4edf417f | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1537 | - |
| `feat/sales-agreement-command-wiring` @ d63e7c3e0b | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1539 | - |
| `feat/sales-agreement-lineage` @ 868da30a58 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1540 | - |
| `feat/sales-agreement-north-star-derivation` @ 8a6e297f93 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1536 | - |
| `feat/sales-agreement-north-star-page` @ 7028bc2a98 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1538 | - |
| `feat/sales-order-action-copy` @ 082d295321 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1170 | - |
| `feat/sales-order-definition` @ 7c007f10f8 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1161 | - |
| `feat/sales-order-header` @ 05b3fd149a | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1162 | - |
| `feat/sales-order-numbering-fixed` @ 81d33442c9 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1156 | - |
| `feat/sales-order-operational-actions` @ f0042f98cc | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1002; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/sales-order-opportunity-identity` @ ce82701588 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1124 | - |
| `feat/sales-order-read-capability` @ 87c6e1163b | branch | 2026-08-14 | 2 | SUPERSEDED | tip = head of merged PR #990 | - |
| `feat/salesperson-opportunity-authority` @ c7c05ac5fa | branch | 2026-08-19 | 2 | SUPERSEDED | tip = head of merged PR #1332 | - |
| `feat/sandbox-activation-promotion` @ 5c4d1c7811 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1040 | - |
| `feat/sandbox-manifest-wave7` @ 57a1840a62 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #999 | - |
| `feat/sandbox-persona-grants` @ 76a9c4ef55 | branch | 2026-08-20 | 2 | SUPERSEDED | tip = head of merged PR #1384 | - |
| `feat/scanner-sandbox-promotion` @ 016056d9b1 | branch | 2026-08-20 | 3 | SUPERSEDED | tip = head of merged PR #1380 | - |
| `feat/serial-receiving-intake` @ c1e9287022 | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1006 | - |
| `feat/serialized-asset-registry-contract` @ 8d011a7827 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1004; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/shared-agent-manager` @ 8ea10bea72 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #719 | - |
| `feat/shared-resource-locks` @ b5215a8b66 | branch | 2026-08-17 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `feat/shared-scan-workspace` @ b23d01837e | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1356 | - |
| `feat/telemetry-supervisor` @ d4e74f5b00 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #723 | - |
| `feat/truck-inventory-projection` @ 20c485413c | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1035; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `feat/unified-query-model` @ 800553f849 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1151 | - |
| `feat/v2-compatibility` @ 5f09d3e025 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1148 | - |
| `feat/ventana-ice-machine-inventory-control-lifecycle` @ c6242a5f22 | branch | 2026-08-11 | 5 | SUPERSEDED | tip = head of merged PR #803 | - |
| `feat/wake-execute` @ a3990be969 | branch | 2026-08-10 | 1 | SUPERSEDED | tip = head of merged PR #760 | - |
| `feat/wake-supervisor-core` @ ebd7d627b5 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #755 | - |
| `feat/wave7-grantable-roles` @ ca41d139ab | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1023 | - |
| `feat/wave7-sandbox-activation` @ 79d17c3d11 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1020 | - |
| `feat/wire-callable-lists` @ 3ed1829e20 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1202 | - |
| `feat/wo-dispatch-attention-projection` @ df43378c50 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1014 | - |
| `feat/wo-parts-planning-ui` @ a7bd507499 | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1001 | - |
| `feat/work-lifecycle` @ a237e7bfe6 | branch | 2026-08-09 | 1 | SUPERSEDED | tip = head of merged PR #746 | - |
| `feat/work-orders-metadata` @ 1850078777 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1141 | - |
| `feat/writer-lane-isolation` @ 0039347310 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1160 | - |
| `feature/admin-users-consolidation` @ 3ddd94f71f | branch | 2026-09-05 | 5 | SUPERSEDED | tip = head of merged PR #1806 | - |
| `feature/email-north-star-pass` @ b43790feb7 | branch | 2026-09-05 | 3 | SUPERSEDED | tip = head of merged PR #1814 | - |
| `feature/email-provider-delivery-onmain` @ 60ff8d1b79 | branch | 2026-09-05 | 4 | SUPERSEDED | tip = head of merged PR #1813 | - |
| `feature/eos-admin-editing-completion` @ 31501bfc70 | branch | 2026-09-08 | 2 | SUPERSEDED | tip = head of merged PR #1827 | - |
| `feature/eos-admin-policy-workflows` @ 99b3503a29 | branch | 2026-09-08 | 14 | SUPERSEDED | tip = head of merged PR #1822 | - |
| `feature/eos-policy-nonprod-activation` @ 1aed282310 | branch | 2026-09-08 | 4 | SUPERSEDED | tip = head of merged PR #1823 | - |
| `feature/issue-15-emulator-tests` @ d24b67c738 | branch | 2026-07-16 | 2 | SUPERSEDED | tip = head of merged PR #320 | - |
| `feature/issue-15-production-readiness` @ 877c4fade0 | branch | 2026-07-16 | 2 | SUPERSEDED | tip = head of merged PR #317 | - |
| `feature/issue-226-production-verification` @ 1d3bd60ec0 | branch | 2026-07-16 | 1 | SUPERSEDED | tip = head of merged PR #315 | - |
| `feature/wave5-composition-burndown` @ 795cc1f040 | branch | 2026-08-14 | 3 | SUPERSEDED | tip = head of merged PR #986 | - |
| `feature/wave5-post-execution` @ 46bd634d15 | branch | 2026-08-14 | 3 | SUPERSEDED | tip = head of merged PR #989 | - |
| `fix-sales-order-money` @ d0d5c56b78 | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1462 | - |
| `fix/access-catalog-role-resync-r3-j` @ d92d54269d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #930 | - |
| `fix/account-ar-view-state-contract` @ 7b87a025ab | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1102 | - |
| `fix/account-related-list-labels` @ 27648fc4a5 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1293 | - |
| `fix/account-status-canonical-values` @ f41045b8dc | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1103 | - |
| `fix/account-workspace-workflow-yaml` @ f7f0c1f158 | branch | 2026-08-19 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/activation-overrides-transfer-cyclecount` @ 602a63579b | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1072 | - |
| `fix/admin-crm-activity-authority` @ 28d44a8312 | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1324 | - |
| `fix/admin-full-capability-grant` @ de006187c2 | branch | 2026-08-19 | 10 | SUPERSEDED | tip = head of merged PR #1340 | - |
| `fix/allocate-so-duplicate-ref-lines` @ 5794a32a88 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #949 | - |
| `fix/app-title-verenward-eos` @ 5da194dfbb | branch | 2026-08-30 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/appheader-reorder-error-r2-4` @ ab01333e40 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #886 | - |
| `fix/backfill-plan-hash-label` @ b69b517a83 | branch | 2026-08-18 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/bounded-callable-reads` @ fb5f933ac8 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1107 | - |
| `fix/build-base-verifier` @ a6043fb239 | branch | 2026-09-03 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/certworld-dispatch-fixtures` @ 4effe025ab | branch | 2026-08-29 | 6 | SUPERSEDED | tip = head of merged PR #1574 | - |
| `fix/certworld-technician-canonical-shape` @ 9efc1aaa7a | branch | 2026-08-29 | 1 | SUPERSEDED | tip = head of merged PR #1571 | - |
| `fix/coordinated-operations-real-source` @ e7fbd00e59 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1030; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `fix/crash-id-entropy` @ 633f5749fd | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1526 | - |
| `fix/create-sales-order-source-opportunity-p1-4-6` @ 99dfebff6f | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #950 | - |
| `fix/credential-audit-e2e-classification` @ 4c436c2f5f | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/customer1-host-and-reconcile` @ 75807c6319 | branch | 2026-09-04 | 2 | SUPERSEDED | tip = head of merged PR #1801 | - |
| `fix/customer1-unexplained-dirty-lane` @ bb25e8626d | branch | 2026-09-04 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/d4-index-boundary` @ c9194a3e63 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1273 | - |
| `fix/dashboard-design-conformance` @ c1f8ca415b | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1789 | - |
| `fix/dashboard-kpi-tier` @ 6414aa3151 | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1790 | - |
| `fix/dashboard-live-acceptance` @ b1609f75eb | branch | 2026-09-03 | 2 | SUPERSEDED | tip = head of merged PR #1791 | - |
| `fix/deploy-environment-stamp` @ dba3895b3e | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1335 | - |
| `fix/dispatch-demo-and-available-equipment` @ 05ba337853 | branch | 2026-08-15 | 1 | SUPERSEDED | merged PR #1029; tip differs from PR head; rebased copy — git cherry finds every patch in the PR head | - |
| `fix/dispatch-work-order-preview-customer-identity` @ 5aa351d358 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #923 | - |
| `fix/email-mailbox-empty-connection-state` @ 581e072260 | branch | 2026-09-06 | 1 | SUPERSEDED | tip = head of merged PR #1816 | - |
| `fix/eos-802-repo-retrieval-path` @ 22a9316ded | branch | 2026-08-11 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-c7-taylor-site-audit-context` @ f4a09597f5 | branch | 2026-08-11 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-createwo-idempotency-rebased` @ 4a724b8e55 | branch | 2026-08-12 | 1 | SUPERSEDED | tip = head of merged PR #848 | - |
| `fix/eos-execute-timeout` @ a46d4fa4c2 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #857 | - |
| `fix/eos-execute-workflow-run-trigger` @ c5c16f9bcc | branch | 2026-08-12 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-intake-lease-dead-holder-immediate` @ 8af92e1864 | branch | 2026-08-11 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-intake-lease-stale-reclaim` @ 4917cb1f6b | branch | 2026-08-11 | 1 | SUPERSEDED | tip = head of merged PR #806 | - |
| `fix/eos-intake-trigger-handoff` @ 1730b12eab | branch | 2026-08-12 | 1 | SUPERSEDED | tip = head of merged PR #843 | - |
| `fix/eos-intake-windows-path-and-push` @ e5b223304d | branch | 2026-08-11 | 1 | SUPERSEDED | tip = head of merged PR #804 | - |
| `fix/eos-issue-task-classification` @ a0825fed4a | branch | 2026-08-12 | 1 | SUPERSEDED | tip = head of merged PR #841 | - |
| `fix/eos-no-redispatch-deterministic-block` @ 53932543e1 | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-runtime-recovery` @ 9d5a7c3c32 | branch | 2026-08-12 | 2 | SUPERSEDED | tip = head of merged PR #839 | - |
| `fix/eos-test-hygiene` @ d3630c3208 | branch | 2026-08-12 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/eos-writeback-isolated` @ 5d34ff2548 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #858 | - |
| `fix/equipment-first-page-name-resolution` @ 7a8ed577d8 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #922 | - |
| `fix/execution-capture-overplan-guard` @ 32a5e2764e | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #887 | - |
| `fix/field-ops-raw-error-leak` @ fed75b861d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #876 | - |
| `fix/finance-ar-truncation-honesty` @ 935c30fea9 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #928 | - |
| `fix/financials-responsive-scorecard` @ d1c8af9581 | branch | 2026-09-10 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/fulfillment-allocation-gate-lineid-writeback` @ 153c0a7c94 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #968 | - |
| `fix/fulfillment-kind-scope-sumothersocommitments` @ 7858126839 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #963 | - |
| `fix/gcloud-windows-verify` @ 6a02ec3449 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1383 | - |
| `fix/hook-error-channels` @ 9a2eb9ef42 | branch | 2026-08-18 | 1 | SUPERSEDED | merged PR #1299; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `fix/inherited-read-callable-validation` @ 8e14afeccf | branch | 2026-08-18 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/inventory-analytics-wire-encoding` @ b32ece4145 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1283 | - |
| `fix/inventory-atomic-processed-claim-r3n` @ 04a814e3c7 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/ledger-serial-adjusted` @ 2e10d5af36 | branch | 2026-08-18 | 1 | SUPERSEDED | merged PR #1298; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `fix/list-view-chip-hover-contrast` @ 415af08a1e | branch | 2026-08-30 | 3 | SUPERSEDED | tip = head of merged PR #1584 | - |
| `fix/main-router-context` @ 7e707d8aee | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1205 | - |
| `fix/money-negative-remainder-site-work-r4-j` @ d6bca65a2a | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/nav-drawer-scroll-activegroup-d` @ 3d3c52c407 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #937 | - |
| `fix/nav-placeholder-honesty` @ 7e8eff53dd | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1033 | - |
| `fix/onhand-governed-ledger` @ a542438d3b | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1085 | - |
| `fix/operations-live-po-panel-r4a` @ f162101f6a | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #938 | - |
| `fix/operator-script-targeting` @ 0474d85cb4 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1294 | - |
| `fix/opportunity-integer-line-qty` @ bb6e436e4c | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/opportunity-won-routing` @ 75bb2226d4 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1345 | - |
| `fix/partmaster-persist-wholeunit-h` @ 52839070e2 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #936 | - |
| `fix/parts-catalog-canonical-authority` @ cf7eacfaeb | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1084 | - |
| `fix/procurement-po-line-item-validation` @ 5cffa8f979 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #935 | - |
| `fix/r23-windowless-fixture` @ 53dd0400b7 | branch | 2026-08-29 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/receiving-source-fixture` @ 6088c11bde | branch | 2026-08-16 | 2 | SUPERSEDED | tip = head of merged PR #1080 | - |
| `fix/reconciliation-honesty` @ 8327927e85 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1295 | - |
| `fix/registry-coverage-drift` @ 29a5c85539 | branch | 2026-08-18 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/report-date-eq-ne-timestamp` @ e7ab93e06b | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/reporting-array-contains-truncation` @ d6a28d21d5 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #939 | - |
| `fix/resolver-catch-logging` @ aec87926fd | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1290 | - |
| `fix/rules-verifier-line-endings` @ 09ef52507e | branch | 2026-08-27 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/sales-agreement-activation-eligibility` @ 238990e45f | branch | 2026-08-25 | 4 | SUPERSEDED | tip = head of merged PR #1485 | - |
| `fix/sales-order-read-no-unitprice` @ c9c9dccfea | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #991 | - |
| `fix/sales-order-writeback-visibility` @ 9f6d925698 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1292 | - |
| `fix/sales-orders-dispatch` @ e06c2719b6 | branch | 2026-08-20 | 12 | SUPERSEDED | tip = head of merged PR #1341 | - |
| `fix/sandbox-bootstrap-provenance` @ 4057beceb1 | branch | 2026-08-14 | 1 | SUPERSEDED | tip = head of merged PR #973 | - |
| `fix/sandbox-deploy-base-mangling` @ fcd41a4e1a | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1318 | - |
| `fix/sandbox-part-version` @ d56980720e | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1079 | - |
| `fix/sandbox-refresh-secret-exclusion` @ e73af2ef69 | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1784 | - |
| `fix/scan-mobile-regression` @ 838608bff8 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1377 | - |
| `fix/scrub-vendor-references` @ 0d3309f35a | branch | 2026-08-19 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/second-sandbox-technician` @ d07188c1d3 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1087 | - |
| `fix/serial-receiving-callable-and-ui` @ e5d1bd06f0 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1009 | - |
| `fix/serialized-receiving-fixture` @ 33d54ccd45 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1083 | - |
| `fix/site-work-r3-g-transition-idempotency` @ 6b77afd67b | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #926 | - |
| `fix/site-work-r3-item-e-qtyused-guard` @ f99e68ab51 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #925 | - |
| `fix/site-work-r3-tech-concurrency-guard` @ de4495300d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #933 | - |
| `fix/site-work-r4-e-reporting-array-filter` @ eeeba2d40e | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #944 | - |
| `fix/site-work-r4-item-k-evidence-bound` @ 6a8d762826 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #941 | - |
| `fix/so-allocation-ledger-authority` @ b43ecf6a35 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1088 | - |
| `fix/stale-mobile-locations-rules-comments` @ 8201711004 | branch | 2026-08-17 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/stale-state-comments` @ e778969191 | branch | 2026-08-18 | 1 | SUPERSEDED | merged PR #1291; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `fix/synthetic-banner-honesty` @ 42bf14ff97 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1063 | - |
| `fix/technician-fail-closed-no-snapshot-error-handler` @ d30a4241a0 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #888 | - |
| `fix/technician-performance-snapshot-error-leak` @ de947b93c5 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #889 | - |
| `fix/timeline-wo-rows-timestamp` @ f90163cee6 | branch | 2026-08-09 | 2 | SUPERSEDED | tip = head of merged PR #734 | - |
| `fix/truck-gate-deactivate-delete-readiness` @ 0e399e1311 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #942 | - |
| `fix/truck-production-readiness-fail-closed` @ b7d8d2e87a | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1109 | - |
| `fix/vercel-spa-deep-links` @ ade2fd959f | branch | 2026-09-10 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/verify-rebuild-clobbers-artifact` @ c1318ed78c | branch | 2026-08-19 | 1 | SUPERSEDED | tip = head of merged PR #1336 | - |
| `fix/warehouse-governance-init-cleanup` @ 3baf1fd087 | branch | 2026-08-16 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `fix/warehouse-reject-self-transfer-r3-K` @ 1fa890421c | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #927 | - |
| `fix/wo-availability-governed-ledger` @ e6f34fd378 | branch | 2026-08-16 | 1 | SUPERSEDED | tip = head of merged PR #1086 | - |
| `fix/wo-timeline-timestamp` @ 318b691680 | branch | 2026-08-25 | 1 | SUPERSEDED | tip = head of merged PR #1491 | - |
| `fix/work-order-transition-audit` @ a99fbc8a36 | branch | 2026-08-18 | 1 | SUPERSEDED | merged PR #1300; tip differs from PR head; tip is an ancestor of the merged PR head | - |
| `gov/activation-planning` @ 97de3373ed | branch | 2026-08-21 | 2 | SUPERSEDED | tip = head of merged PR #1400 | - |
| `gov/execution-plan` @ 7c7e278f9b | branch | 2026-08-21 | 3 | SUPERSEDED | tip = head of merged PR #1401 | - |
| `gov/sandbox-execution` @ e96407b107 | branch | 2026-08-21 | 3 | SUPERSEDED | tip = head of merged PR #1402 | - |
| `harden/eos-landing-seam` @ 69108826a5 | branch | 2026-08-13 | 4 | SUPERSEDED | tip = head of merged PR #859 | - |
| `harness-assert-signed-in` @ f37e82c3e1 | branch | 2026-08-25 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `integrate/account-fields` @ c0a73c9e56 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1185 | - |
| `integrate/account-page-wiring` @ 999509551b | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1191 | - |
| `integrate/account-search` @ ebda321400 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1177 | - |
| `integrate/adm-employees` @ 6a5107ea06 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1239 | - |
| `integrate/adm-roles` @ 1e32724333 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1243 | - |
| `integrate/backfill-registration` @ 0ab63ff59a | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1171 | - |
| `integrate/bounded-reads` @ 8ef1e1df83 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1248 | - |
| `integrate/callable-source` @ a626ec317d | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1200 | - |
| `integrate/catalog-definitions` @ b121c9092f | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1263 | - |
| `integrate/com-purchase-orders` @ b8da5e264f | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1241 | - |
| `integrate/crm-opportunities` @ 259bf6e6a2 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1226 | - |
| `integrate/employee-registration` @ 53f49de1ad | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1176 | - |
| `integrate/entity-definitions` @ 65406299f1 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1206 | - |
| `integrate/equipment-tab` @ 3e94311d25 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1246 | - |
| `integrate/held-definitions` @ ab4a2bf9b0 | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1258 | - |
| `integrate/identity-modes` @ 55e127e20c | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1256 | - |
| `integrate/index-callable` @ 7d71c39e1c | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1229 | - |
| `integrate/inv-manufacturers` @ 77303decfe | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1233 | - |
| `integrate/inventory-action-defs` @ cab2a4d90f | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1267 | - |
| `integrate/inventory-movement` @ 3b47bb97e7 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1223 | - |
| `integrate/list-timestamp-navigation` @ ce5320ffd2 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1204 | - |
| `integrate/manufacturer` @ 254da7b544 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1196 | - |
| `integrate/operational-numbering` @ bfef1d7051 | branch | 2026-08-18 | 1 | SUPERSEDED | tip = head of merged PR #1259 | - |
| `integrate/part-equipment-registration` @ 5c64bdbc40 | branch | 2026-08-17 | 3 | SUPERSEDED | tip = head of merged PR #1168 | - |
| `integrate/purchase-order-registration` @ 86ca538857 | branch | 2026-08-17 | 4 | SUPERSEDED | tip = head of merged PR #1181 | - |
| `integrate/reclassification` @ f9fcd1ebc9 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1245 | - |
| `integrate/registry-validator` @ d25fd24e81 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1215 | - |
| `integrate/related-list-actions` @ 2bf0359621 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1211 | - |
| `integrate/renderer-suppliers` @ 1cb0abcea1 | branch | 2026-08-17 | 4 | SUPERSEDED | tip = head of merged PR #1236 | - |
| `integrate/sales-order-index` @ 2fd4371d3f | branch | 2026-08-18 | 2 | SUPERSEDED | tip = head of merged PR #1264 | - |
| `integrate/sales-order-index-fix` @ 33376fad08 | branch | 2026-08-18 | 3 | SUPERSEDED | tip = head of merged PR #1272 | - |
| `integrate/territory-mobile` @ 848f8eae07 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1251 | - |
| `integrate/text-semantics` @ a845bb618f | branch | 2026-08-18 | 3 | SUPERSEDED | tip = head of merged PR #1257 | - |
| `integrate/warehouse-supplier` @ 295b1305c5 | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1189 | - |
| `integrate/wire-callable-lists` @ 6b4a3e7993 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1207 | - |
| `integrate/wire-contacts-locations` @ 6572ebf90a | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1217 | - |
| `integrated/cost-activation` @ 3eeee1f2e6 | branch | 2026-09-02 | 3 | SUPERSEDED | tip = head of merged PR #1762 | - |
| `integration/button-primitive` @ 56f4f40a1a | branch | 2026-08-19 | 10 | SUPERSEDED | tip = head of merged PR #1321 | - |
| `integration/style-elimination` @ 46079f5a90 | branch | 2026-08-19 | 8 | SUPERSEDED | tip = head of merged PR #1323 | - |
| `ns/account-p1` @ 850c82ba4d | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1520 | - |
| `ns/account-p1-composition-defects` @ 81447694e3 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1525 | - |
| `ns/account-p1-gate` @ ff58cee414 | branch | 2026-08-26 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `ns/account-p1-touch-targets` @ 9596c3c453 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1524 | - |
| `ns/ledger-family-4-blocked` @ b64a4808b0 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1512 | - |
| `ns/ledger-quick-gate-1c8095d3` @ f19313478d | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1513 | - |
| `ops/eos-real-nonprod-activation` @ 4ff76191a9 | branch | 2026-09-08 | 5 | SUPERSEDED | tip = head of merged PR #1825 | - |
| `ops/release-script-bash-path` @ 8f94f0e3f6 | branch | 2026-08-26 | 1 | SUPERSEDED | tip = head of merged PR #1523 | - |
| `orr-integrate` @ 8949e39f9c | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1011 | - |
| `p1-fix-cx1-governed` @ 8bcc4d78b8 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #961 | - |
| `p1-fix-cx2` @ ce9a14cb79 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #954 | - |
| `p1-fix-cx2-line-identity` @ 786cd664b6 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #960 | - |
| `p1-fix-cx3` @ 7628e25544 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #955 | - |
| `p1-fix-cx4` @ 941d037f5d | branch | 2026-08-13 | 2 | SUPERSEDED | tip = head of merged PR #956 | - |
| `p1-fix-cx5` @ f973091349 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #957 | - |
| `p1-fix-cx6` @ 6cddff2c7e | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `p1-fix-cx7` @ 903aa96605 | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `p1-fixes` @ e0a5ad3a3f | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #953 | - |
| `platform/accounts-structured-list` @ 0d01e30528 | branch | 2026-08-24 | 2 | SUPERSEDED | tip = head of merged PR #1448 | - |
| `platform/parts-structured-list` @ c1c52f2888 | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1444 | - |
| `platform/parts-structured-list-followup` @ 01ad7c8e38 | branch | 2026-08-24 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `platform/partslist-inventory-health` @ 91ebcfc314 | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1450 | - |
| `platform/po-structured-list` @ eb3650b9c2 | branch | 2026-08-23 | 2 | SUPERSEDED | tip = head of merged PR #1443 | - |
| `platform/structured-object-pilot` @ 9677aff982 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1442 | - |
| `pwod-integrate` @ 6dd709cac4 | branch | 2026-08-15 | 3 | SUPERSEDED | tip = head of merged PR #1003 | - |
| `reconcile-1823` @ 1aed282310 | branch | 2026-09-08 | 4 | SUPERSEDED | tip = head of merged PR #1823 | - |
| `reconcile-1825` @ 4ff76191a9 | branch | 2026-09-08 | 5 | SUPERSEDED | tip = head of merged PR #1825 | - |
| `refactor/account-ar-single-read` @ 7bb1b007a4 | branch | 2026-08-17 | 2 | SUPERSEDED | tip = head of merged PR #1114 | - |
| `release/prep-audit` @ a74ee1a7aa | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1782 | - |
| `release/rc-identity` @ 1c791d96af | branch | 2026-09-03 | 1 | SUPERSEDED | tip = head of merged PR #1783 | - |
| `rsc-integrate` @ e23fd30138 | branch | 2026-08-15 | 2 | SUPERSEDED | tip = head of merged PR #1013 | - |
| `run/eos-demo` @ 615952025d | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `sales-order-dollars-list-chrome` @ fd32e50112 | branch | 2026-08-24 | 3 | SUPERSEDED | tip = head of merged PR #1459 | - |
| `sar-integrate` @ eddd977b83 | branch | 2026-08-15 | 3 | SUPERSEDED | tip = head of merged PR #1004 | - |
| `shell-script-crlf-fix` @ 638bb6c6c2 | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1456 | - |
| `shell/remove-duplicate-account-controls` @ d06ffc89d5 | branch | 2026-09-04 | 3 | SUPERSEDED | tip = head of merged PR #1799 | - |
| `site-work/r3-L-safe-copy-sweep` @ 7d13ed596e | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #931 | - |
| `slice2-workorder-equipment` @ 301c74921f | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1465 | - |
| `slice4-sales-agreement` @ 3cfb2c396c | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1467 | - |
| `so-actions-integrate` @ 660a113fcc | branch | 2026-08-15 | 3 | SUPERSEDED | tip = head of merged PR #1002 | - |
| `technician/wo03-offline-runtime` @ bcd057b220 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1437 | - |
| `technician/wo03a-integration` @ 9442f53184 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1438 | - |
| `test/admin-persona-review` @ fa24326a06 | branch | 2026-10-08 | 2 | SUPERSEDED | merge into origin/main adds nothing | - |
| `test/ci-wire-ungated-emulator-tests` @ ffcddd2286 | branch | 2026-08-13 | 3 | SUPERSEDED | tip = head of merged PR #965 | - |
| `test/inventory-ledger-behavioral-coverage` @ 3a6b5ae95b | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #881 | - |
| `test/site-work-r3-h-finance-write-callable-tests` @ c39740ebe7 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #929 | - |
| `tip-integrate` @ f6bb62a754 | branch | 2026-08-15 | 1 | SUPERSEDED | tip = head of merged PR #1035 | - |
| `tmp/ci2` @ a9ba487c38 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1375 | - |
| `tmp/j2-rebuild` @ fbade919e4 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1363 | - |
| `tmp/k-rebuild` @ e15135ee45 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1365 | - |
| `tmp/m-rebuild` @ 80029d86be | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1367 | - |
| `tmp/n-rebuild` @ e28bd739fb | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1369 | - |
| `tmp/o-rebuild` @ 1d63277128 | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1368 | - |
| `tmp/q-rebuild` @ 90db56212d | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1371 | - |
| `tmp/wh-rebuild` @ 8701cbfc4a | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1387 | - |
| `ux-record-page-account` @ 20ec0e16db | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1460 | - |
| `ux-record-pages-three` @ a08d09191f | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1461 | - |
| `ux-release-correction` @ 1a34725a2a | branch | 2026-08-24 | 1 | SUPERSEDED | tip = head of merged PR #1453 | - |
| `ux/handheld-browser-evidence` @ f157156ba7 | branch | 2026-08-20 | 2 | SUPERSEDED | tip = head of merged PR #1390 | - |
| `ux/mobile-primary-nav` @ 213081418a | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1389 | - |
| `ux/warehouse-handheld` @ 8701cbfc4a | branch | 2026-08-20 | 1 | SUPERSEDED | tip = head of merged PR #1387 | - |
| `verify/location-upgrade` @ 73c35af2ee | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1183 | - |
| `verify/page-sections` @ 492f79eedf | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1187 | - |
| `verify/renderer-gaps` @ 91a2e8c8ba | branch | 2026-08-17 | 1 | SUPERSEDED | tip = head of merged PR #1194 | - |
| `warehouse/wo04-handheld` @ 1a688a2255 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1439 | - |
| `warehouse/wo05-offline` @ ff4f3292c1 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1440 | - |
| `warehouse/wo05a-ui-integration` @ 774ab4c614 | branch | 2026-08-23 | 1 | SUPERSEDED | tip = head of merged PR #1441 | - |
| `wire/eos-audit-reconcile` @ f3414055e9 | branch | 2026-08-13 | 4 | SUPERSEDED | tip = head of merged PR #861 | - |
| `worktree-agent-a0ffe49abe9a5425c` @ 7858126839 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #963 | - |
| `worktree-agent-a1bf6403a2d0597e3` @ dd1bbff781 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #964 | - |
| `worktree-agent-a248c6e5c44db3a2f` @ 9b2dfb4a39 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #946 | - |
| `worktree-agent-a2ca331cb8c86ef4c` @ e863758646 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #880 | - |
| `worktree-agent-a3776855d93b0c4c7` @ a4892e3212 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #943 | - |
| `worktree-agent-a4b827fb5fda9575d` @ 8d1ba56e77 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #951 | - |
| `worktree-agent-a5021b70ff05127be` @ a12ec6fb2f | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `worktree-agent-a51ad8419cac1bfc8` @ 4b7bbab823 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #967 | - |
| `worktree-agent-a63cb5fec962579b5` @ 5d44d948c6 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #962 | - |
| `worktree-agent-a8bf2c0a15f040c99` @ f943ea2a08 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #874 | - |
| `worktree-agent-a9243275d548a3601` @ 9f063dbb1e | branch | 2026-08-13 | 1 | SUPERSEDED | merge into origin/main adds nothing | - |
| `worktree-agent-a9b87dcd28614748d` @ 7269ee6b31 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #924 | - |
| `worktree-agent-a9fa59347cc6bc60e` @ 301d32812e | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #878 | - |
| `worktree-agent-ac45bf2a3d9a879a7` @ 18b29c412b | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #890 | - |
| `worktree-agent-acc3175a98612267c` @ e76ac6022a | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #921 | - |
| `worktree-agent-ae43739886bf1f388` @ 5ae450accf | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #940 | - |
| `worktree-agent-ae96b3d3cdc5af3d5` @ 6f79b3d2d7 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #952 | - |
| `worktree-agent-af1097694e8e95028` @ e8ef525371 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #875 | - |
| `worktree-agent-af8986df52d3f1b1e` @ 5365b69d49 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #920 | - |
| `worktree-agent-af9be27e74ca366f6` @ fed75b861d | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #876 | - |
| `worktree-agent-afb0f499bcf713a15` @ 2730ff4e93 | branch | 2026-08-13 | 1 | SUPERSEDED | tip = head of merged PR #879 | - |

## WSL worktree registrations (148, plus p26-ledger-fix, a separate repo)

Git on Windows lists these as prunable. All of them live in `/home/rudy2/.local/share/eos-worktrees/`, and their gitdirs resolve from WSL. The unpushed commits belong to local branches classified in the table above.

| Worktree | Gitdir | Dirty files (excl. node_modules) | Unpushed commits | Classification |
|---|---|---|---|---|
| -audit | ok | 0 | 0 | SUPERSEDED (clean) |
| admin-users-directory | ok | 0 | 0 | SUPERSEDED (clean) |
| arch-classify | ok | 0 | 0 | SUPERSEDED (clean) |
| atlas-emp | ok | 0 | 2 | SUPERSEDED (clean) |
| atlas-eng-rpt | ok | 0 | 0 | SUPERSEDED (clean) |
| auth-role-census | ok | 1 | 0 | KEEP (backed up) |
| c1-commercial | ok | 0 | 0 | SUPERSEDED (clean) |
| c2-commands | ok | 0 | 0 | SUPERSEDED (clean) |
| c3-reads | ok | 0 | 0 | SUPERSEDED (clean) |
| c4-transport | ok | 0 | 0 | SUPERSEDED (clean) |
| c5-migration | ok | 0 | 0 | SUPERSEDED (clean) |
| catalog-authority | ok | 0 | 0 | SUPERSEDED (clean) |
| catalog-cutover | ok | 0 | 0 | SUPERSEDED (clean) |
| census-acc | ok | 0 | 3 | SUPERSEDED (clean) |
| controller-main | ok | 0 | 0 | SUPERSEDED (clean) |
| crm-client | ok | 0 | 7 | SUPERSEDED (clean) |
| crm-cutover | ok | 0 | 0 | SUPERSEDED (clean) |
| crm-fallout | ok | 0 | 0 | SUPERSEDED (clean) |
| crm-owner-precond | ok | 0 | 0 | SUPERSEDED (clean) |
| crm-server-gaps | ok | 0 | 0 | SUPERSEDED (clean) |
| crm-transport | ok | 0 | 0 | SUPERSEDED (clean) |
| d1a-crm | ok | 0 | 0 | SUPERSEDED (clean) |
| dil-verify | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-acct | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-capgate | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-exp | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-history | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-info | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-perf | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-role | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-rt08 | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-rt08-ui | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-synth | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-w1a | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-w1b | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-w1c | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-w2 | ok | 0 | 0 | SUPERSEDED (clean) |
| emp-work | ok | 0 | 0 | SUPERSEDED (clean) |
| employee-runtime | ok | 0 | 0 | SUPERSEDED (clean) |
| employee-v41 | ok | 0 | 0 | SUPERSEDED (clean) |
| eng-a-audit-read | ok | 0 | 0 | SUPERSEDED (clean) |
| eng-b-guard | ok | 0 | 0 | SUPERSEDED (clean) |
| eng-c-parity | ok | 0 | 0 | SUPERSEDED (clean) |
| eng-d-envfence | ok | 0 | 0 | SUPERSEDED (clean) |
| eng-e-report-scope | ok | 0 | 0 | SUPERSEDED (clean) |
| firebase-exit-1fdef0b7-20260911T202025Z | ok | 5 | 0 | ABANDONED (empty files) |
| flake-fix | ok | 0 | 0 | SUPERSEDED (clean) |
| guard-gap | ok | 0 | 1 | SUPERSEDED (clean) |
| id-verify | ok | 0 | 0 | SUPERSEDED (clean) |
| int-a | ok | 0 | 18 | SUPERSEDED (clean) |
| int-wave1 | ok | 0 | 0 | SUPERSEDED (clean) |
| nonprod-measure | ok | 0 | 0 | SUPERSEDED (clean) |
| own-decision | ok | 0 | 1 | SUPERSEDED (clean) |
| own-design | ok | 0 | 0 | SUPERSEDED (clean) |
| own-e2e | ok | 0 | 0 | SUPERSEDED (clean) |
| own-enggap | ok | 0 | 2 | SUPERSEDED (clean) |
| p1b-a-part-tracking | ok | 0 | 0 | SUPERSEDED (clean) |
| p1b-b-company-custody | ok | 0 | 0 | SUPERSEDED (clean) |
| p1b-c-import-mapping | ok | 0 | 0 | SUPERSEDED (clean) |
| p1b-census-20260912T013336Z | ok | 0 | 0 | SUPERSEDED (clean) |
| p1b-d-employee-truck | ok | 0 | 0 | SUPERSEDED (clean) |
| p1b-dryrun | ok | 0 | 5 | SUPERSEDED (clean) |
| p26-ledger-fix | broken | ? | ? | other repo (project-keystone) |
| p2b1-runtime-census | ok | 0 | 0 | SUPERSEDED (clean) |
| p2b2-rules-browser | ok | 0 | 0 | SUPERSEDED (clean) |
| p2b3-functions-transport | ok | 0 | 0 | SUPERSEDED (clean) |
| p2c1-parity | ok | 0 | 0 | SUPERSEDED (clean) |
| p2c2-adc-failclosed | ok | 0 | 0 | SUPERSEDED (clean) |
| p2c3-nonprod-readiness | ok | 0 | 0 | SUPERSEDED (clean) |
| p2d-decision-ledger | ok | 0 | 0 | SUPERSEDED (clean) |
| p2e-sched-union | ok | 0 | 0 | SUPERSEDED (clean) |
| p2f-nonprod-blockers | ok | 0 | 0 | SUPERSEDED (clean) |
| p2g-cap-request | ok | 0 | 0 | SUPERSEDED (clean) |
| p2h-report-scope | ok | 0 | 1 | SUPERSEDED (clean) |
| p2i-stale-claims | ok | 0 | 0 | SUPERSEDED (clean) |
| p2j-onhand | ok | 0 | 0 | SUPERSEDED (clean) |
| p2k-finance-detectors | ok | 0 | 0 | SUPERSEDED (clean) |
| p2l-test-registration | ok | 0 | 0 | SUPERSEDED (clean) |
| p2m-sandbox-resolution | ok | 0 | 0 | SUPERSEDED (clean) |
| p2n-role-resolution | ok | 0 | 0 | SUPERSEDED (clean) |
| p3-evidence | ok | 0 | 0 | SUPERSEDED (clean) |
| p30-identity | ok | 0 | 0 | SUPERSEDED (clean) |
| p30b-biznum | ok | 0 | 0 | SUPERSEDED (clean) |
| p3a1-arch-service | ok | 0 | 0 | SUPERSEDED (clean) |
| p3a2-arch-inventory | ok | 0 | 0 | SUPERSEDED (clean) |
| p3a3-arch-sales | ok | 0 | 0 | SUPERSEDED (clean) |
| p3b1-act-service | ok | 0 | 0 | SUPERSEDED (clean) |
| p3b2-act-inventory | ok | 0 | 0 | SUPERSEDED (clean) |
| p3b3-act-sales | ok | 0 | 0 | SUPERSEDED (clean) |
| p3c-design-brief | ok | 0 | 0 | SUPERSEDED (clean) |
| p3d-workflow-registry | ok | 0 | 0 | SUPERSEDED (clean) |
| p3fb-census | ok | 0 | 0 | SUPERSEDED (clean) |
| p3mig-reality | ok | 0 | 0 | SUPERSEDED (clean) |
| p3wf-registry | ok | 0 | 0 | SUPERSEDED (clean) |
| postmerge-proof-db379f84 | ok | 0 | 0 | SUPERSEDED (clean) |
| ratchet-fix | ok | 0 | 0 | SUPERSEDED (clean) |
| recover-design | ok | 0 | 0 | SUPERSEDED (clean) |
| roadmap-1922 | ok | 0 | 0 | SUPERSEDED (clean) |
| roadmap-status | ok | 0 | 0 | SUPERSEDED (clean) |
| rpt-client | ok | 0 | 0 | SUPERSEDED (clean) |
| rpt-fix | ok | 0 | 0 | SUPERSEDED (clean) |
| rpt-p0 | ok | 0 | 0 | SUPERSEDED (clean) |
| rpt-recon | ok | 0 | 1 | SUPERSEDED (clean) |
| sample-company-v2 | ok | 0 | 0 | SUPERSEDED (clean) |
| synthetic-seed | ok | 0 | 0 | SUPERSEDED (clean) |
| tier2-pkt | ok | 0 | 0 | SUPERSEDED (clean) |
| ux-absence | ok | 0 | 0 | SUPERSEDED (clean) |
| ux-kpi | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c1-inventory-commitment | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c10-commercial | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c11-invoice | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c12-payment | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c13-inventory-action | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c14-part-ci | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c15-inventory-cutover | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c16-reporting | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c17-financial | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c18-admin-config | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c19-workorder | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c2-part-admin-objects | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c20-serialized-asset | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c21-firebase-retirement | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c22-integrations | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c23-scanner | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c24-list-ns | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c25-cyclecount | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c26-financial-surfaces | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c27-scheduling | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c28-guard-coverage | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c29-dataimport | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c3-warehouse-bin | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c30-ai-assistant | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c31-ownership | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c32-fulfillment | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c33-returns-repair | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c34-seed-authority | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c4-truck-mobile | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c5-employee-principal | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c6-supplier-manufacturer | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c7-equipment | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c8-purchasing | ok | 0 | 0 | SUPERSEDED (clean) |
| w1-c9-account-contact-location | ok | 0 | 0 | SUPERSEDED (clean) |
| w2-activation-readiness | ok | 0 | 0 | SUPERSEDED (clean) |
| w2-integration-rehearsal | ok | 0 | 0 | SUPERSEDED (clean) |
| w2-retirement-census | ok | 0 | 0 | SUPERSEDED (clean) |
| wave2a | ok | 0 | 0 | SUPERSEDED (clean) |
| wave2b | ok | 0 | 0 | SUPERSEDED (clean) |
| wave2c | ok | 0 | 0 | SUPERSEDED (clean) |
| wo-assignment-census | ok | 0 | 0 | SUPERSEDED (clean) |
