---
artifact_type: specification
unit: INV-CONVERGENCE-E Stage B — operational-role canonical `parts` read Rules
gate: Rules design (Tier 2) — no deployment
status: Draft — awaiting Owner and ChatGPT review (docs-only); authorizes no Rules deployment
date: 2026-07-26
owner: Claude Code (Inventory)
baseline: db5fc5bf85cd2c6b562fea50741b7eddc5255821 (origin/main)
related_decisions: "DECISIONS.md #40 (ADR-008), #43, #44, #46; Issue #100; Issue #226"
authorizes: nothing — no Rules/Functions/index deployment, no data writes, no source switch, no PartsList/PartDetail change
---

# INV-CONVERGENCE-E Stage B — operational-role canonical `parts` read Rules (design)

Design for broadening **read** access to the canonical `parts` collection from admin/dispatcher-only to explicitly-named, active operational roles — **without changing write authority** — so the operational Parts surfaces can source canonical identity after C1. **This document authorizes no Rules deployment** (Rules edit, emulator verification, and production deploy are each separate, reviewed gates). Hard prerequisite (with Stage D) for C1.

## 1. Current posture (baseline `db5fc5b`)
`firestore.rules`:
- `match /parts/{partId}` → `allow read: if isAdminOrDispatcher(); allow create, update, delete: if false;`
- `manufacturers` / `part_aliases` / `part_supplier_items` → `allow read, write: if false;` (fully closed; trusted-writer-only per ADR-008 PR 1.3/1.4).
- **Precedent for operational-role reads:** `inventory_transactions` → `allow read: if isAdminOrDispatcher() || isActiveOperationalRole("PARTS_MANAGER") || isActiveOperationalRole("WAREHOUSE_MANAGER"); allow create, update, delete: if false;`
- Helper `isActiveOperationalRole(role)` (firestore.rules ~112): reciprocally-linked employee **AND** `employmentStatus == "ACTIVE"` **AND** `operationalRoles is list` **AND** `operationalRoles.hasAny([role])`.
- Invariant (firestore.rules ~1296): **operationalRoles express work eligibility, not general security authority**; security role and operationalRoles are distinct.

## 2. Authorization model (invariants preserved)
- **Security permissions remain distinct from `operationalRoles`.** `operationalRoles` is work-eligibility, not security authority; this grant is read-only work-visibility, mirroring the `inventory_transactions` precedent.
- **admin/dispatcher compatibility behavior preserved** — `isAdminOrDispatcher()` remains the first read branch (the current I-1 posture is unchanged for them).
- **Writes remain trusted-writer-only** — `create, update, delete: if false` for `parts` (Admin-SDK `createPart`/`updatePart`/`changePartStatus` only, per ADR-008/-009). **No client-direct Parts mutation.**
- **Adjacent canonical collections stay denied** — `manufacturers`, `part_aliases`, `part_supplier_items` remain `read, write: if false` unless separately authorized.
- **Technician access does not broaden accidentally** — a bare `technician` security role grants nothing here; only an **active, reciprocally-linked** employee whose `operationalRoles` contains a permitted value is granted, exactly like `inventory_transactions`.
- **Unauthenticated access remains denied** — no `isSignedIn()`/`isAdminOrDispatcher()`/active-operational-role ⇒ deny (fail closed).

## 3. Proposed access predicate
```
match /parts/{partId} {
  allow read: if isAdminOrDispatcher()
    || isActiveOperationalRole("PARTS_MANAGER")
    || isActiveOperationalRole("WAREHOUSE_MANAGER")
    || isActiveOperationalRole("PARTS_ASSOCIATE");
  allow create, update, delete: if false;   // UNCHANGED — trusted-writer-only
}
```
- **Reuses `isActiveOperationalRole()`** verbatim (no new helper needed) — same active-employment + reciprocal-link + operationalRoles semantics already trusted for `inventory_transactions`.
- **Adjacent collections unchanged** (`manufacturers`/`part_aliases`/`part_supplier_items` stay fully closed).
- Part identity is **global** (not per-warehouse); unlike `stock_locations`, `parts` read is **not** scoped by `assignedWarehouseIds` — a WAREHOUSE_MANAGER reading a Part's descriptive identity is workspace-wide by design.

### 3.1 Required design questions
- **DQ-B1 (exact permitted role set):** the predicate names PARTS_MANAGER, WAREHOUSE_MANAGER, PARTS_ASSOCIATE — the three operational roles whose surfaces (PartsManagerHome / WarehouseManagerHome / PartsAssociateHome, and eventually PartsList/PartDetail) render Part identity. **Owner decision:** confirm this set, or narrow it to exactly what C1 needs first. (The `inventory_transactions` precedent grants only PARTS_MANAGER + WAREHOUSE_MANAGER; PARTS_ASSOCIATE is added here because PartsAssociateHome surfaces part names.)
- **DQ-B2 (dispatcher compatibility during migration):** dispatcher retains parts read via `isAdminOrDispatcher()` (**role-based**), unchanged. Recommend keeping it role-based through migration (no permission-model dependency introduced); revisit only if the #226 permission model later supersedes it.
- **DQ-B3 (seeded compatibility roles):** the I-1 posture is admin/dispatcher role-based; this design **adds** operational-role branches without removing the seeded admin/dispatcher checks (they retire only after permission-model parity + production verification, per the existing `parts` Rules comment).
- **DQ-B4 (tenant-ready shape):** no tenant/company predicate is added (Issue #140 reserved). The predicate is tenant-inert; a future tenant key can gate `isActiveOperationalRole`/the employee lookup without reshaping this branch.
- **DQ-B5 (accessVersion / revocation):** `isActiveOperationalRole` does **not** consult `accessVersion`/RoleAssignment (that path is the #226 compact-claims model for reporting reads). This `parts` read is evaluated **live against the employee document each read**; revocation is **immediate** on `employmentStatus != ACTIVE`, on removing the operational role, or on breaking the reciprocal link. There is therefore **no stale-accessVersion surface** for this predicate.
- **DQ-B6 (custom-claims boundaries):** no custom claim is required or consulted; authorization derives from the reciprocally-linked employee document, not from token claims.
- **DQ-B7 (Rules helper structure):** reuse `isActiveOperationalRole` (no new helper); keep the branch additive and under the Rules subexpression budget (three `||` operational branches, matching the two already present for `inventory_transactions`).
- **DQ-B8 (audit implications):** reads are not audited by Firestore Rules; no audit event is added. Part **mutations** remain trusted-writer-only with their existing atomic audit (ADR-008 `partMasterCommands.ts`), unchanged.
- **DQ-B9 (rollback condition):** revert the `parts` read predicate to `if isAdminOrDispatcher()` (the current I-1 posture) and redeploy Rules; no data effect (read-only grant).

## 4. Implementation plan (each step a separate gate; none authorized here)
1. **PR-B1 (Rules edit, repository only):** change the `parts` read predicate to §3 in both `firestore.rules` and the byte-identical Vite mirror; add/extend the strict Rules regression suite (`firestore-rules-regression.yml`) with the §5 matrix; no deploy.
2. **PR-B2 (emulator verification):** run the §5 matrix against the emulator from a clean checkout; capture green results.
3. **Deploy gate (separate authorize→deploy→verify):** the F-RULES-1 D2 precedent — capture pre-deploy live ruleset (SHA-256 rollback artifact), `firebase deploy --only firestore:rules --project taylor-parts`, byte-verify the live ruleset equals the governed blob, run the §5 production verification matrix. **Separately Owner-authorized; not this PR.**

## 5. Emulator / production test matrix
For each principal, test each operation. **Expected default:** only specifically-authorized readers may read `parts`; **all** client writes denied; adjacent canonical collections denied; malformed/stale/suspended/unauthenticated fail closed.

Operations: `parts` list read · `parts` single read · `parts` create · `parts` update · `parts` delete · `manufacturers` read/write · `part_aliases` read/write · `part_supplier_items` read/write.

| Principal | parts read (list & single) | parts create/update/delete | manufacturers r/w | part_aliases r/w | part_supplier_items r/w |
|---|---|---|---|---|---|
| Signed out | **DENY** | DENY | DENY | DENY | DENY |
| Authenticated, no application access (no linked employee / no role) | **DENY** | DENY | DENY | DENY | DENY |
| Admin | **ALLOW** | DENY | DENY | DENY | DENY |
| Dispatcher | **ALLOW** | DENY | DENY | DENY | DENY |
| Technician **without** permitted operational role | **DENY** | DENY | DENY | DENY | DENY |
| Technician **with** permitted operational role (ACTIVE, reciprocally linked, operationalRoles∋PARTS_MANAGER\|WAREHOUSE_MANAGER\|PARTS_ASSOCIATE) | **ALLOW** | DENY | DENY | DENY | DENY |
| Suspended user (employmentStatus ≠ ACTIVE) | **DENY** (fail closed) | DENY | DENY | DENY | DENY |
| Stale access version (where applicable) | **N/A** — predicate does not consult accessVersion (DQ-B5); revocation is live via the employee doc | DENY | DENY | DENY | DENY |
| Malformed / missing user document | **DENY** (fail closed) | DENY | DENY | DENY | DENY |

**Assertions:** (a) parts read ALLOW only for admin, dispatcher, and the active permitted-operational-role principal; (b) parts create/update/delete DENY for every principal; (c) manufacturers/part_aliases/part_supplier_items read+write DENY for every principal; (d) unauthenticated, suspended, malformed, and no-app-access all fail closed.

## 6. Production deployment handoff (draft — not authorized)
Follows the F-RULES-1 D2 rules-deployment precedent (`docs/operations/f-rules-1-d2-deployment-handoff.md`): secure the shared-`firestore.rules` release lock; pin the deploy commit; capture the pre-deploy live ruleset + SHA-256 as the rollback artifact (STOP if empty/malformed); `firebase deploy --only firestore:rules --project taylor-parts`; byte-verify the live ruleset SHA-256 equals `git show <commit>:firestore.rules | sha256sum` (mismatch ⇒ STOP → ROLLBACK); run the §5 production verification matrix; package sanitized evidence. **Firestore Rules only — no Functions, no indexes, no data.** Deployment is separately Owner-authorized.

## 7. Rollback plan
- **Repository (PR-B1):** revert the PR — no runtime effect until deployed.
- **Deployed Rules:** re-deploy the captured pre-deploy ruleset (SHA-256-verified) — restores `parts` read to `if isAdminOrDispatcher()`. **No data rollback** is involved (read-only grant; no writes changed).
- **Trigger:** any §5 production-matrix failure, any unintended broadening (e.g., a non-permitted principal reading `parts`, or any client write succeeding), or any adjacent-collection leak.

## 8. Non-authorizations (explicit)
**This PR authorizes no Rules deployment.** No `firestore.rules` change is included here (design only); no Functions/index deployment; no data writes; no application source switch; no PartsList/PartDetail cutover. Writes stay trusted-writer-only; adjacent canonical collections stay closed. Hard prerequisite (with Stage D) for C1; does not authorize C1. Decisions #43–#46 unchanged.
