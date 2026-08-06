---
artifact_type: operations
gate: Preservation and reconciliation of the stale local checkout + registered worktree audit
status: Inventory and classification COMPLETE — recovery decisions pending. Nothing deleted or overwritten.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: c002b5ee0834998207f7966be40bbd718cbd0e28
scope: Non-destructive. NO reset, clean, deletion, overwrite, or merge of unattributed material.
---

# Local Checkout & Worktree Reconciliation

Owner direction 2026-08-06: **preserve.** The stale primary checkout at `D:/Taylor_Parts` contains material not present on `main`, which makes destructive cleanup unacceptable. This is preservation and reconciliation work — **not permission to resurrect obsolete architecture.**

State: primary checkout on `docs/issue-100-inventory-role-access-specification` @ `a652f61`, **0 commits ahead / 1085 behind** `origin/main`, 37 working-tree entries. Because it is zero commits ahead, **every committed change on that branch is already contained in `main`** — all risk is in uncommitted and untracked material only.

---

## 1. Classification of the 37 entries

### A · SUPERSEDED — already on `main`, byte-identical (6 entries)

`.claude/agents/` (2 files) · `.claude/hooks/` (3) · `.claude/skills/codex-review-request/` · `.claude/skills/publish-artifacts/` · `.claude/skills/scaffold-workstream-doc/` · `.claude/skills/verify-rules-deploy/` · `skills/` (17) · `field-ops-app-vite/src/demo/inventoryData.js`

Untracked only because the branch predates the commits that added them. **No unique content. Safe to disregard.**

### B · REQUIRES-DIFF-REVIEW — exists on `main` but local copy differs (11 entries)

`AGENTS.md` · `docs/reviews/design-code-legibility-and-docs-review.md` · `docs/reviews/tooling-skill-marketplace-scan.md` · `docs/reviews/what-would-perfect-look-like.md` · `docs/specifications/rough-complete-build-blueprint.md` · `field-ops-app-vite/src/modules/mobile/PartsScanner.jsx` · `field-ops-app-vite/src/modules/administration/` (2 local files vs 6 on main) · `docs/user-guide/*` (7 dirs; main has strictly more files in 3 of them) · `field-ops-app-vite/package.json` · `package-lock.json` · `src/App.jsx` · `src/index.css` · `src/demo/InventoryContext.jsx`

**Working hypothesis (NOT established):** these are pre-merge drafts, superseded by the newer versions on `main` — `main` has equal or more content in every case checked, and the branch is 1085 commits behind. **Do not act on the hypothesis.** Each needs a real diff before disposal. Highest-value to review first: `index.css` (+121 lines local) and `InventoryContext.jsx` (+39/−2), which are the largest uncommitted divergences and touch the demo inventory surface.

### C · VALUABLE UNIQUE WORK — not on `main` (3 entries) ⚠️

| Path | Size | Note |
|---|---|---|
| `docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md` | **164 KB** | The largest unique artifact in the tree. A design/wireframe doc for inventory sales templates and lines of business. Relates to the Taylor/Ventana lines-of-business concern. **No equivalent exists on `main`.** |
| `docs/reviews/project-integrity-review.md` | 8 KB | A review artifact with no counterpart on `main`. Program 0's inputs cited three reviews; this is a fourth. |
| `field-ops-app-vite/pr189-live-verify.mjs` | 8 KB | A live-verification harness for PR #189. Possibly single-use tooling; possibly a reusable verification pattern. |

**These are the reason destructive cleanup was refused.** Each needs an Owner decision on whether it has ongoing value and, if so, a governed publication path (the `publish-artifacts` skill exists for exactly this).

### D · GENERATED EVIDENCE — verify against the governed audit set (4 entries)

`inventory-effects-production-detection-20260722T204858Z.tar.gz.sha256` · `…tar.gz(1).sha256` · `…tar(1).gz` · `…-terminal.log`

Loose production-evidence artifacts at the repository root. A governed, hashed copy of this run appears to already exist at `docs/audits/inventory-effects/2026-07-22/`. **Action: compare these checksums against `docs/audits/inventory-effects/2026-07-22/checksums.sha256`.** If they match, these are redundant local copies of already-imported evidence. If they do **not** match, that is a finding in its own right and must be escalated, not resolved locally. Either way they must never be edited — `audit-artifact-standard.md` applies.

### E · LOCAL TOOLING — not repository content (2 entries)

`.codex/` (**27,301 files** — Codex agent worktrees and cache) · `.claude/settings.json` (+50/−1, local machine settings, not on `main`)

Machine-local. Not candidates for the repository. `.codex/` should be confirmed present in `.gitignore`; its size is why the working tree looks alarming.

### F · UNKNOWN (1 entry)

`Taylor-Migration-Evidence/` (12 files, none on `main`). Name suggests migration evidence; provenance and whether it duplicates `docs/audits/` content are unestablished.

## 2. Recovery decisions required

1. **C-1 wireframe (164 KB)** — publish to `docs/design/` under a governed PR, or archive outside the repo? Its subject (lines of business) is live architecture, so this is the highest-value call.
2. **C-2 project-integrity-review** — publish to `docs/reviews/`, or supersede by the reviews already on `main`?
3. **C-3 `pr189-live-verify.mjs`** — reusable verification tooling, or single-use scaffolding?
4. **D** — run the checksum comparison; escalate on mismatch.
5. **F** — establish provenance of `Taylor-Migration-Evidence/`.

Until each is answered, **the checkout stays exactly as it is.**

## 3. Prohibited until attribution is established

No `git reset`, `git clean`, `git checkout --`, force-checkout, branch deletion, stash-drop, file deletion, or overwrite against `D:/Taylor_Parts`. No merge of class-B or class-C material into `main` without a diff review and a governed PR. Per `AI_ENGINEERING_OPERATING_MODEL.md` §8a, the correct posture toward an ambiguous checkout is to **leave it untouched and work elsewhere** — which is what every EAO program has done (all work runs in isolated scratchpad worktrees).

## 4. Registered worktree audit

Audited at `c002b5e`. Classification: merged-vs-`origin/main`, clean-vs-dirty, and ownership.

| Class | Count | Disposition |
|---|---|---|
| **ACTIVE** | 4 | `eao-wt`, `main-ro` (EAO, this program); `codex/equipment-visible-ui` (another agent, **dirty=4**); `tx2-wt` (another session, `feat/inventory-transfers-workspace`). Not touched. |
| **SAFE-TO-REMOVE** | **18** | Merged into `main`, clean tree, no protected role. **Removed.** |
| **UNKNOWN-REQUIRES-REVIEW** | 6 | Merged but carrying uncommitted changes: `customer-demo-seed` (1), `customer-pr2-governed-fields` (2), `customer-pr4-financial-surfaces` (1), `wizardly-lewin-747ad7` (3), `f-rules-1-pr1` (1), `f-rules-1-pr2` (1). **Retained** — uncommitted work is unattributed. |
| **UNMERGED-REQUIRES-REVIEW / PROTECTED** | 1 | `auth-pr4-reauth` @ `5271e98`, **1 commit ahead of `main`** — the PR #468 re-authorization work, explicitly recorded as *"CLOSED/UNMERGED, retained for recoverability — do not reopen/merge/revise/delete."* **Retained untouched.** |
| **HISTORICAL (deployment/rollback pins)** | 8 | `deploy-3b68f8a`, `prod-deploy-d5f2172`, `prod-rollback-e1d936e`, `gate-e2-candidate`, `gate-e2-rollback`, `gate-e3b-candidate`, `option-c-hosting-364a8b4`, `option-c-rollback-081df750`. All merged and clean, so their commits stay permanently reachable via `main` and removal would lose no data — but each exists as a deliberate rollback/deploy pin. **Retained pending an Owner call**; removal is convenience, not cleanup. |
| **STALE REGISTRATION** | 1 | `rws-wt` — directory already gone from disk; registration pruned. |

Removed (18): `customer-record-page`, `inventory-issue100-implementation-plan`, `inventory-issue100-prod-verify-gates4-7-10`, `inventory-issue152-assessment`, `inventory-pr1a-rules`, `inventory-pr2a-rules`, `inventory-pr3a-gate-final`, `inventory-pr3a-gate-v2`, `inventory-pr3a-rules`, `fix-access-version-verification`, `auth-target`, `docs-f-rules-1-governing-artifacts`, `docs-roadmap-reconciliation`, `f-rules-1-field-mode-read-scoping`, `functions-live-state-evidence`, `functions-live-state-verification`, `governance-execution-and-audit-standards`, `inv-e-stageb-handoff`.

Count: 35 → 20. **No branch was deleted; no unmerged or dirty worktree was touched.** Removing a worktree whose commit is an ancestor of `main` discards no history.
