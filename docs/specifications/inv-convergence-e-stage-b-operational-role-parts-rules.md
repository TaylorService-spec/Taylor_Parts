---
artifact_type: specification
unit: INV-CONVERGENCE-E Stage B — operational-role canonical `parts` read Rules
gate: Rules design (Tier 2) — no deployment
status: Draft (corrections round 1 applied 2026-07-26) — awaiting Owner and ChatGPT review (docs-only); authorizes no Rules deployment. Permitted set narrowed to PARTS_MANAGER + WAREHOUSE_MANAGER (PARTS_ASSOCIATE DENY); accessVersion narrative corrected; 12-principal matrix.
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
- **This is a narrowly enumerated, collection-specific read grant — not a general permission catalog.** Naming an operational role in the `parts` read predicate authorizes reading `parts` and nothing else; it confers no broader capability, no write authority, and no access to any adjacent collection. Each collection's grant is decided on its own; membership in `operationalRoles` is never a system-wide entitlement.
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
    || isActiveOperationalRole("WAREHOUSE_MANAGER");
  allow create, update, delete: if false;   // UNCHANGED — trusted-writer-only
}
```
- **Reuses `isActiveOperationalRole()`** verbatim (no new helper needed) — same active-employment + reciprocal-link + operationalRoles semantics already trusted for `inventory_transactions`.
- **Adjacent collections unchanged** (`manufacturers`/`part_aliases`/`part_supplier_items` stay fully closed).
- Part identity is **global** (not per-warehouse); unlike `stock_locations`, `parts` read is **not** scoped by `assignedWarehouseIds` — a WAREHOUSE_MANAGER reading a Part's descriptive identity is workspace-wide by design.

### 3.1 Required design questions
- **DQ-B1 (exact permitted role set) — RESOLVED (Owner, 2026-07-26):** the permitted set is exactly **PARTS_MANAGER + WAREHOUSE_MANAGER**, matching the `inventory_transactions` precedent verbatim. **PARTS_ASSOCIATE is DENY** in this predicate and in every ALLOW expectation below — it is deliberately excluded and is not granted canonical `parts` read at Stage B. Any future PARTS_ASSOCIATE grant (e.g., if PartsAssociateHome must surface canonical part names) is a **separate, separately-Owner-authorized** predicate change with its own governed matrix, not part of this design.
- **DQ-B2 (dispatcher compatibility during migration):** dispatcher retains parts read via `isAdminOrDispatcher()` (**role-based**), unchanged. Recommend keeping it role-based through migration (no permission-model dependency introduced); revisit only if the #226 permission model later supersedes it.
- **DQ-B3 (seeded compatibility roles):** the I-1 posture is admin/dispatcher role-based; this design **adds** operational-role branches without removing the seeded admin/dispatcher checks (they retire only after permission-model parity + production verification, per the existing `parts` Rules comment).
- **DQ-B4 (tenant-ready shape):** no tenant/company predicate is added (Issue #140 reserved). The predicate is tenant-inert; a future tenant key can gate `isActiveOperationalRole`/the employee lookup without reshaping this branch.
- **DQ-B5 (accessVersion / revocation):** the `parts` read outcome is determined **independently of `accessVersion`**. `isActiveOperationalRole` does **not** consult `accessVersion`/RoleAssignment at all (that path is the #226 compact-claims model for reporting reads); authorization is evaluated **live against the reciprocally-linked employee document on each read** (`employmentStatus == "ACTIVE"` AND permitted operational role AND live reciprocal link). Consequences, stated explicitly so this is not mistaken for a fail-closed accessVersion check:
  - A principal with a **stale `accessVersion`** but an otherwise-valid live employee record (ACTIVE, permitted operational role, reciprocal link intact) is **ALLOW** — because `accessVersion` is simply never read by this predicate. This is **not** a fail-closed outcome and must not be documented as one; it is the correct, intended behavior of a live-record predicate.
  - Revocation is therefore driven **only** by the live employee document: it is **immediate** on `employmentStatus != "ACTIVE"`, on removing the operational role from `operationalRoles`, or on breaking the reciprocal link — and is **independent** of any `accessVersion` bump. `accessVersion` is neither necessary nor sufficient to grant or revoke `parts` read here.
- **DQ-B6 (custom-claims boundaries):** no custom claim is required or consulted; authorization derives from the reciprocally-linked employee document, not from token claims.
- **DQ-B7 (Rules helper structure):** reuse `isActiveOperationalRole` (no new helper); keep the branch additive and under the Rules subexpression budget (**two** `||` operational branches — PARTS_MANAGER, WAREHOUSE_MANAGER — byte-for-byte matching the two already present for `inventory_transactions`).
- **DQ-B8 (audit implications):** reads are not audited by Firestore Rules; no audit event is added. Part **mutations** remain trusted-writer-only with their existing atomic audit (ADR-008 `partMasterCommands.ts`), unchanged.
- **DQ-B9 (rollback condition):** revert the `parts` read predicate to `if isAdminOrDispatcher()` (the current I-1 posture) and redeploy Rules; no data effect (read-only grant).

## 4. Implementation plan (each step a separate gate; none authorized here)
1. **PR-B1 (Rules edit, repository only):** change the `parts` read predicate to §3 in both `firestore.rules` and the byte-identical Vite mirror; add/extend the strict Rules regression suite (`firestore-rules-regression.yml`) with the §5 matrix; no deploy.
2. **PR-B2 (emulator verification):** run the §5 matrix against the emulator from a clean checkout; capture green results.
3. **Deploy gate (separate authorize→deploy→verify):** the F-RULES-1 D2 precedent — capture pre-deploy live ruleset (SHA-256 rollback artifact), `firebase deploy --only firestore:rules --project taylor-parts`, byte-verify the live ruleset equals the governed blob, run the §5 production verification matrix. **Separately Owner-authorized; not this PR.**

## 5. Emulator / production test matrix
For each principal, test each operation. **Expected default:** only specifically-authorized readers may read `parts`; **all** client writes denied; adjacent canonical collections denied; malformed/stale/suspended/unauthenticated fail closed.

Each operation is a **separate column** so that `parts` list read and single read are asserted independently, and each write verb is asserted independently. Columns: **parts list read · parts single read · parts create · parts update · parts delete · manufacturers r/w · part_aliases r/w · part_supplier_items r/w**. All twelve principals are enumerated separately (no principal is collapsed into an "others" row).

| # | Principal | parts list read | parts single read | parts create | parts update | parts delete | manufacturers r/w | part_aliases r/w | part_supplier_items r/w |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Signed out (unauthenticated) | **DENY** | **DENY** | DENY | DENY | DENY | DENY | DENY | DENY |
| 2 | Authenticated, no application access (no linked employee, no role) | **DENY** | **DENY** | DENY | DENY | DENY | DENY | DENY | DENY |
| 3 | Admin (security role) | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY | DENY | DENY |
| 4 | Dispatcher (security role) | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY | DENY | DENY |
| 5 | Active **PARTS_MANAGER** (ACTIVE, reciprocally linked, operationalRoles∋PARTS_MANAGER) | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY | DENY | DENY |
| 6 | Active **WAREHOUSE_MANAGER** (ACTIVE, reciprocally linked, operationalRoles∋WAREHOUSE_MANAGER) | **ALLOW** | **ALLOW** | DENY | DENY | DENY | DENY | DENY | DENY |
| 7 | Active **PARTS_ASSOCIATE** (ACTIVE, reciprocally linked, operationalRoles∋PARTS_ASSOCIATE) | **DENY** (deliberately excluded, DQ-B1) | **DENY** (deliberately excluded, DQ-B1) | DENY | DENY | DENY | DENY | DENY | DENY |
| 8 | Technician security role, **no** permitted operational role | **DENY** | **DENY** | DENY | DENY | DENY | DENY | DENY | DENY |
| 9 | Suspended employee (employmentStatus ≠ ACTIVE) otherwise holding PARTS_MANAGER | **DENY** (fail closed) | **DENY** (fail closed) | DENY | DENY | DENY | DENY | DENY | DENY |
| 10 | Broken reciprocal link (holds PARTS_MANAGER but employee↔user link not reciprocal) | **DENY** (fail closed) | **DENY** (fail closed) | DENY | DENY | DENY | DENY | DENY | DENY |
| 11 | **Stale `accessVersion`** but otherwise-valid live active PARTS_MANAGER record | **ALLOW** (accessVersion not consulted — DQ-B5; **not** fail-closed) | **ALLOW** (accessVersion not consulted — DQ-B5; **not** fail-closed) | DENY | DENY | DENY | DENY | DENY | DENY |
| 12 | Malformed / missing user or employee document | **DENY** (fail closed) | **DENY** (fail closed) | DENY | DENY | DENY | DENY | DENY | DENY |

**Assertions:** (a) `parts` list read AND single read ALLOW **only** for principals 3, 4, 5, 6, and 11 (admin, dispatcher, active PARTS_MANAGER, active WAREHOUSE_MANAGER, and the stale-`accessVersion`-but-live PARTS_MANAGER); (b) **PARTS_ASSOCIATE (principal 7) is DENY** for both read operations — deliberately excluded per DQ-B1; (c) `parts` create/update/delete DENY for **every** principal; (d) `manufacturers`/`part_aliases`/`part_supplier_items` read+write DENY for **every** principal; (e) principals 1, 2, 8, 9, 10, 12 fail closed on both read operations; (f) principal 11 demonstrates that a stale `accessVersion` does **not** deny a live-valid reader — read is determined independently of `accessVersion` (DQ-B5).

## 6. Production deployment handoff (draft — not authorized)
Follows the F-RULES-1 D2 rules-deployment precedent (`docs/operations/f-rules-1-d2-deployment-handoff.md`): secure the shared-`firestore.rules` release lock; pin the deploy commit; capture the pre-deploy live ruleset + SHA-256 as the rollback artifact (STOP if empty/malformed); `firebase deploy --only firestore:rules --project taylor-parts`; byte-verify the live ruleset SHA-256 equals `git show <commit>:firestore.rules | sha256sum` (mismatch ⇒ STOP → ROLLBACK); run the §5 production verification matrix; package sanitized evidence. **Firestore Rules only — no Functions, no indexes, no data.** Deployment is separately Owner-authorized.

## 7. Rollback plan
- **Repository (PR-B1):** revert the PR — no runtime effect until deployed.
- **Deployed Rules:** re-deploy the captured pre-deploy ruleset (SHA-256-verified) — restores `parts` read to `if isAdminOrDispatcher()`. **No data rollback** is involved (read-only grant; no writes changed).
- **Trigger:** any §5 production-matrix failure, any unintended broadening (e.g., a non-permitted principal reading `parts`, or any client write succeeding), or any adjacent-collection leak.

## 8. Non-authorizations (explicit)
**This PR authorizes no Rules deployment.** No `firestore.rules` change is included here (design only); no Functions/index deployment; no data writes; no application source switch; no PartsList/PartDetail cutover. Writes stay trusted-writer-only; adjacent canonical collections stay closed. Hard prerequisite (with Stage D) for C1; does not authorize C1. Decisions #43–#46 unchanged.
