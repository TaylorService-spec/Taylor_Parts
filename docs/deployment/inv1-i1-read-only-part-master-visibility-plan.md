# INV-1 I-1 — Read-only Part Master Visibility — Deployment Plan

**Status:** PLANNING ONLY. This document authorizes **no** deployment and **no** runtime change. It is the governed architecture/plan for a future, separately-authorized I-1 deployment gate. Baseline: `origin/main` = `a6daf63`.

**Unit:** make the 190 now-live governed Parts visible **read-only** to `admin`/`dispatcher` through the merged PR 1.9 surface, by deploying (a) the governed `firestore.rules` (which carries the `parts` read grant) and (b) the frontend bundle (which carries the read-only Part Master route). Nothing else.

---

## 1. Current-state assessment (`origin/main` a6daf63)

**Rules (repository, UNDEPLOYED):** both `firestore.rules` (root) and `field-ops-app-vite/firestore.rules` (client mirror) are **byte-identical** — governed git-blob SHA-256 **`fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7`** (re-derive at deploy time: `git show HEAD:firestore.rules | sha256sum`). The `parts` block:
```
match /parts/{partId} {
  allow read: if isAdminOrDispatcher();
  allow create, update, delete: if false;
}
```
`manufacturers`, `part_aliases`, `part_supplier_items` remain `allow read, write: if false` (fully closed). Production currently runs a **pre-PR-1.9 ruleset** (the F-RULES-1 D2 baseline) under which `parts` is **fully client-closed** — so the read grant is repository-only and NOT yet live.

**Frontend (repository, deployment state TBD at gate):** `modules/inventory/PartMasterList.jsx` (read-only list at route `inventory/part-master`), `services/partMasterQueries.js` (one-shot `getDocs`, zero write imports), `domain/partMasterView.js` (pure mapper), `types/partMaster.ts` (read-only mirror). Source-scan-tested: no write controls, no `setDoc/addDoc/updateDoc/deleteDoc`, no `onClick`/`<button>`/`<form>`. Whether the currently-deployed bundle already contains this route must be confirmed at the gate.

**Feature flag:** `PART_MASTER_REFERENCE` defaults **OFF** (`partReferenceCompatibility.ts`: `process.env.PART_MASTER_REFERENCE === "enabled"`); nothing enables it. It is the PR 1.6 ledger resolver (D-M6) — **out of I-1 scope** and stays OFF.

**Production data:** 190 governed Parts live (CREATE execution closed, #408/a6daf63); `part_aliases`=0, `part_supplier_items`=0. Reconciled (post-write analyzer 190 NO_CHANGE).

## 2. Dependency map

| I-1 depends on | Status |
|---|---|
| Governed Parts exist in production | ✅ 190 live, reconciled (#408) |
| Decision #42 D-M7 (deploy read Rules only after migration + reconciliation) | ✅ satisfied — migration + reconciliation closed |
| Both `firestore.rules` byte-identical | ✅ verified (`fda24239…`) |
| Read UI merged, write-free | ✅ PR 1.9 |
| Rollback baseline capture procedure | ✅ precedent = F-RULES-1 D2 handoff |
| Customer-session release-lock on the shared `firestore.rules` | ⚠ must be secured at the gate (§7) |
| Trusted-writer posture unchanged | ✅ all `parts` writes denied (§9) |

I-1 does **not** depend on and does **not** touch: PART_MASTER_REFERENCE, the PR 1.6 resolver, PR 1.7 snapshots, aliases, supplier items, quantities, UPDATE processing, or any Customer runtime.

## 3. Exact deployment sequence (documented, NOT executed)

Operator/Cloud Shell, from a clean checkout of the authorized commit (mirrors the D2 rules-deployment handoff precedent). **Rules first, then frontend**, each independently verified:

**A. Rules deploy**
1. Secure the Customer-session release-lock (§7); confirm `origin/main` has no unmerged `firestore.rules` change in flight.
2. Capture the **pre-deploy production ruleset** as the rollback artifact (Firebase Rules REST API → `rollback/firestore.rules`), record its SHA-256. If empty/malformed → **STOP, do not deploy**.
3. `firebase deploy --only firestore:rules --project taylor-parts`.
4. **Byte-verify:** fetch the live ruleset content, `sha256sum` → must equal the governed blob `fda242399…` (re-derived from the deployed commit). If not → **STOP → ROLLBACK**.
5. Run the §4 Rules verification matrix in production.

**B. Frontend deploy**
6. Build the frontend at the authorized commit; deploy the hosting bundle.
7. Confirm the `inventory/part-master` route renders the read-only list for admin/dispatcher and the 190 Parts are visible; run the §4 UI rows.
8. Package evidence (deploy outputs, live-ruleset hash, verification results, screenshots/attestations) for a later import PR.

Rules and frontend are **separable**: a Rules-only deploy exposes read at the data layer (the UI already gates by role); a frontend-only deploy without the Rules grant shows the read UI its `permission-denied` state. Deploy Rules **before** frontend so the UI has data to read on first render.

## 4. Production verification matrix

| Actor | `parts` read | `parts` write | manufacturers / part_aliases / part_supplier_items |
|---|---:|---:|---|
| unauthenticated | **deny** | deny | deny |
| technician | **deny** | deny | deny |
| dispatcher | **ALLOW** (sees 190) | deny | deny |
| admin | **ALLOW** (sees 190) | deny | deny |

Plus: live-ruleset SHA-256 == governed blob; `manufacturers`/`part_aliases`/`part_supplier_items` read+write denied for all; a `parts` create/update/delete attempt by admin **denied**; the `inventory/part-master` UI renders read-only (no write controls) and lists the 190 Parts for admin/dispatcher, shows the access-denied state for technician. Mirror the D2 "seed → run → cleanup" evidence pattern with disposable fixtures only.

## 5. Rollback plan

- **Rules:** redeploy the §3.A.2 preserved pre-deploy baseline (`firebase deploy --only firestore:rules`), then re-fetch and confirm the live hash equals the baseline hash. `parts` returns to fully client-closed; the trusted-writer path is unaffected (writes were always denied); no data change. Bounded and immediate.
- **Frontend:** redeploy the prior hosting release (or a build without the route). The read UI degrades to its access-denied/empty state under the reverted Rules — no data risk.
- Rollback triggers: live-ruleset hash ≠ governed blob · any verification-matrix row fails · unexpected write allowed · UI exposes any write affordance · Customer-content drift detected in the deployed file.

## 6. Branch / worktree strategy

- This planning PR: branch `docs/inv1-i1-read-visibility-plan`, worktree `D:/Taylor_Parts-worktrees/inv1-i1-plan`, docs-only, off `origin/main`.
- The future deployment gate: its own branch/worktree off the then-current `origin/main`; a Cloud Shell **handoff** doc (D2 pattern) rather than a code change, since deploying Rules/frontend ships the current governed files verbatim. Evidence import lands via a separate governed PR (docs/audits or docs/deployment), never mixed with the deploy.

## 7. Release-lock handling with the Customer session

`firestore.rules` (both files) is **shared** with the Customer workstream; a deploy ships the **entire current file** (Inventory's `parts` read grant + all Customer-owned blocks). Therefore:
- **Combined-content acknowledgement** is required (D2 precedent): the deploy authorization records exactly which commit's full ruleset is shipping.
- **Release-lock:** before capturing the baseline and deploying, coordinate with the Customer session to freeze `firestore.rules` merges — no rules PR merges to `main` between baseline capture (§3.A.2) and the post-deploy byte-verify (§3.A.4). Pin the exact deploy commit; re-derive the governed blob from it.
- If a Customer rules change is mid-flight, either (a) wait for it to merge and re-pin/re-verify, or (b) defer — never deploy a file whose Customer content you didn't intend to ship.

## 8. Decision points & unresolved risks

**Decisions required (Owner) before the deployment gate:**
- **D-I1-1 — read-authorization posture.** Ship the seeded **admin/dispatcher compatibility** read grant as-is (the PR 1.9 posture, Owner-approved as compatibility-only), or first move `parts` read to the **Issue #100 governed permission matrix**? The PR 1.9 record explicitly flags that operational-role read expansion belongs to Issue #100 and that raw role checks retire only after permission-model parity + production verification. I-1 as scoped ships the compatibility posture; a matrix-first alternative is a larger, separate change.
- **D-I1-2 — deploy scope pairing.** Rules-only now (data-layer read) vs Rules + frontend together (visible UI). Recommend **together**, Rules first.
- **D-I1-3 — timing vs the Customer release-lock.** When to take the shared-rules freeze window.

**Risks:**
- Shared-rules combined-content drift (mitigated by §7 lock + byte-verify).
- Deployed-bundle uncertainty (confirm whether the live frontend already carries the route).
- Exposure of a partially-understood dataset — mitigated: the 190 Parts are reconciled and descriptive-only (no cost/quantity fields; stock stays the ledger).
- Compatibility-posture debt (D-I1-1) — deploying admin/dispatcher raw-role reads adds to the raw-role-retirement backlog tracked under Issue #100.

## 9. Explicit proof: all client writes remain denied

I-1 changes **no** write posture. On `origin/main` and in the shipped file, every Part Master collection denies client writes: `parts` → `allow create, update, delete: if false`; `manufacturers`/`part_aliases`/`part_supplier_items` → `allow read, write: if false`. The only delta I-1 deploys is `parts` **read** = admin/dispatcher. All mutation stays trusted-writer-only (`partMasterCommands.ts`, Admin SDK) per ADR-009. The verification matrix (§4) asserts an admin `parts` write is **denied** post-deploy.

## 10. Scope guardrails (this gate and the deployment gate)

- **This gate:** docs-only; no deployment, no runtime change, no Rules/frontend/flag change.
- **PART_MASTER_REFERENCE** remains **OFF** unless separately authorized (D-M6).
- **Out of scope:** alias migration (D-M2), supplier-item migration (D-M4), quantity migration, UPDATE processing (D-M1), and any Customer runtime work. None are touched or planned here.

## 11. Next gate

**INV-1 I-1 Deployment Authorization** — resolves D-I1-1/2/3, secures the Customer release-lock, and authorizes the operator handoff (Rules deploy + byte-verify + verification matrix, then frontend deploy + verification), followed by an evidence-import PR. No deployment occurs until that gate.
