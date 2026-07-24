---
artifact_type: assessment
gate: Assessment
unit: C-2
status: Draft
date: 2026-07-24
owner: Claude Code
related_adrs: [ADR-005, ADR-006]
depends_on:
  - docs/architecture/customer-domain-foundation.md
  - docs/BusinessEntityModel.md
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: null
target_release: null
---

# Customer Hierarchy — Assessment & Design (C-2)

**Status: DRAFT — docs-only. Merging this document authorizes NO implementation.**
It assesses the current model and defines the simplest safe parent–child Account
hierarchy for Taylor Parts, resolving the required hierarchy decisions and
proposing the implementation units that later, separately-authorized gates will
build. It creates no collection, field, Firestore Rule, Cloud Function, index,
route, component, migration, or production-data change.

**Runtime status: BLOCKED.** The Customer workstream is docs-only while the
Inventory workstream owns the production deployment lane (I-1). No deployment-lock
transfer occurs here. This unit does **not** start C-3 or any later Customer unit.

Claims are marked **VERIFIED** (checked against the codebase/docs this session),
**PROPOSED** (a new C-2 design decision), or **CARRIED OVER** (from an existing
doc). Verified against `origin/main` @ `c918dc0`. Path convention:
`firestore.rules`, `functions/…`, `docs/…` are repo-root-relative; `src/…` is
relative to `field-ops-app-vite/`.

This unit realizes the C-1 Foundation's §6 hierarchy sketch and its open decision
**D-C1-OPEN-e** (child-under-archived-parent + depth bound, deferred to C-2).

---

## 1. Objective & scope

**Objective:** define the *minimum* parent–child Account hierarchy needed by
current Taylor Parts operations — a customer "family" structure for
grouping/reporting — without making hierarchy a billing, service, ownership, or
authorization mechanism.

**In scope:** current-state assessment; the `parentAccountId` model; single-parent,
cycle, and depth invariants; parent-archive and merge behavior; derived-rollup
vs stored-aggregate decision; read/reporting behavior; migration/backfill; audit;
implementation sequence.

**Out of scope (safeguards):** no runtime/Rules/Functions/frontend/Firebase-config
change; no production access; no schema migration or customer-data change; no
Inventory change; **hierarchy must not become an authorization boundary**; **no
denormalized hierarchy totals**; no speculative multi-tenant mechanics (Issue #140
remains the authority). Prefer the simplest model supporting current operations.

---

## 2. Current-state assessment (VERIFIED)

| Area | Finding | Source |
|---|---|---|
| Account schema | `{ id, name, billingAddress?, status?, notes?, tags?, relationshipTypes?, customerNumber?, erpId?, accountingId?, legacyId?, + Commercial Profile, createdAt, updatedAt }`. **No parent/hierarchy field.** | `domain/accounts.js`, `constants.js` |
| Hierarchy today | **None.** All "hierarchy" strings in the code are UI nav grouping or a CSS priority scale; `commercialProfile.js` marks `parentAccount` "out of scope (later PRs)". Greenfield. | grep `field-ops-app-vite/src`, `firestore.rules` |
| Account access | `accounts` read/create/update = `isAdminOrDispatcher()`; `delete: if false`. Flat, role-based. Two governed Commercial Profile fields are admin-only-to-change; INTERIM client-direct pending the PR-3b trusted writer. | `firestore.rules` `match /accounts` |
| Location / Contact | `locations.accountId`, `contacts.accountId` — first-class, `isAdminOrDispatcher()`, `delete: if false`. | `firestore.rules` |
| Work Order link | `fieldops_wos.customerId → accounts` doc; live Cloud Function contract, never renamed. Work Orders reference the Account **directly**, not through any family. | C-1 §3; `functions/src/createWorkOrder.ts` |
| Equipment | ADR-006 (Accepted, deferred): `equipment.accountId` + `equipment.locationId`, same-Account invariant. Reaches the Account **directly**, not via hierarchy. | ADR-006 |
| Reporting seam | `domain/accountPortfolio.js` — pure read-side summary/filter over the already-loaded accounts array; no per-account query, no stored aggregate. | `domain/accountPortfolio.js` |
| Authorization model | ADR-005 Hybrid: Rules authoritative for client-direct; trusted Functions for sensitive/audited mutations; territory/scope lists explicitly **barred from claims**; tenant scope reserved to Issue #140. | ADR-005 §2.2/§2.3 |

**Operational use cases for customer families (why hierarchy is wanted):**

1. **Reporting roll-up** — view total open Work Orders / activity / (future) spend
   across a corporate parent and its subsidiaries or multi-site brands.
2. **Navigation grouping** — find all related Accounts from one parent record.
3. **Organizational clarity** — record that "Account B is a division of Account A"
   without merging them into one record (they keep distinct billing/identity).

None of these require hierarchy to change *who can access* a record or *who is
billed* — they are grouping and read-side aggregation only.

**Does hierarchy affect billing / service / ownership / access? (PROPOSED answers)**

| Dimension | Effect of hierarchy | Rationale |
|---|---|---|
| **Billing** | **No.** Each node bills independently; a parent does not centralize child billing. | C-1 D-C1-OPEN-b (one billing party per Account) is ADOPTED; centralizing would need a separate bill-to decision. |
| **Service** | **No.** Work Orders attach to Account/Location directly; family is not in the WO path. | `customerId` contract unchanged. |
| **Ownership** | **Independent.** A child may carry a different `accountOwner` than its parent. | `accountOwner` is per-Account; hierarchy does not override it. |
| **Access** | **No — hard rule.** Hierarchy never grants or scopes access; `firestore.rules` stays flat `isAdminOrDispatcher()`. | ADR-005; the C-2 safeguard. |

---

## 3. Proposed hierarchy model (PROPOSED — simplest safe)

A single nullable self-reference on the Account, adjacency-list style:

```
accounts/{id}.parentAccountId : string | null
    null            -> a root / standalone customer
    <accountId>     -> this Account is a child of that Account (same collection)
```

- **Additive and nullable.** Every existing Account is a root (`null`) with no
  backfill. The field rides through the generic account store untouched.
- **Adjacency list, not a materialized path or nested set** — the simplest model;
  the family tree is reconstructed read-side by following `parentAccountId`.
- **A child remains a full, independent Account** — its own identity, status,
  Commercial Profile, owner, Locations, Contacts, and Work Orders. The parent link
  adds structure; it merges nothing and centralizes nothing.
- **Same-collection, same-tenant only.** `parentAccountId` may reference only
  another `accounts` document (a future `companyId`/tenant boundary, Issue #140,
  would additionally require parent and child to share it — reserved, not built).

---

## 4. Required decisions (PROPOSED, with recommendations)

| # | Decision | Recommendation |
|---|---|---|
| **D-C2-1** | `parentAccountId` model | **ADOPT** nullable self-reference (adjacency list) on `accounts`, §3. |
| **D-C2-2** | Single-parent rule | **ADOPT.** An Account has **at most one** `parentAccountId`. No multi-parent / DAG. |
| **D-C2-3** | Cycle prevention | **ADOPT.** Reject self-parent and any link that would close a cycle (a node may not be its own ancestor). *Enforcement note in §5 — this is why re-parent is a trusted-writer action.* |
| **D-C2-4** | Maximum depth | **ADOPT a bounded depth (recommend 5 levels).** A create/re-parent that would exceed the bound is rejected. Keeps read-side traversal cheap and trees sane; the exact number is a single named constant. |
| **D-C2-5** | May an ACTIVE child exist under an ARCHIVED parent? | **NO.** An `ARCHIVED` root implies a retired family; a live billable child must not be buried under it (default lists/reports exclude archived roots). |
| **D-C2-6** | Behavior when a parent is archived | **No silent cascade.** Archiving a parent does **not** auto-archive or delete children. If the parent still has non-`ARCHIVED` children, the archive is **blocked** until they are explicitly detached (`parentAccountId → null`) or archived first — an explicit, audited choice. Children are never hard-deleted (`delete: if false` stands). |
| **D-C2-7** | Behavior during customer merge (C-1 D-C1-7) | Hierarchy links are **live references**: on merge, a `parentAccountId` pointing at the merged-away Account, and the merged-away Account's own parent/children links, **re-point to the survivor** via the trusted writer; **acyclicity is re-validated post-merge**; **closed historical records are untouched** (C-1 §8). A self-loop created by re-pointing (e.g. survivor would become its own parent) resolves to `null`. |
| **D-C2-8** | Derived rollups vs stored aggregates | **DERIVED ONLY.** Family totals (open WOs, activity, future spend) are computed **read-side**; **no** denormalized aggregate is ever stored on the parent. (C-1 §6; the C-2 safeguard; matches `accountPortfolio.js`.) |
| **D-C2-9** | Read & reporting behavior | Children resolve by querying `accounts where parentAccountId == <root>` (bounded by depth); rollups aggregate those read-side. Archived-then-merged nodes resolve to the survivor via the C-1 `mergedIntoAccountId` tombstone. Reports may show family totals, always labeled as derived. Requires a single-field index on `parentAccountId` (**specified here, created/deployed under a later gate**). |
| **D-C2-10** | Migration & backfill | **NONE.** Additive nullable field; all existing Accounts default to `null` (roots). No data migration, no backfill, no customer-data change. |
| **D-C2-11** | Audit requirements | Setting/changing/clearing `parentAccountId` (link, re-parent, detach) is an **audit-class** mutation (C-1 §11): it must route through the trusted writer and emit an audit event once that seam exists (Issue #15/#226). It records the affected Account, prior parent, new parent, and actor. |

**Minor open items (recommend deferring within C-2 detailed spec):**

- **D-C2-OPEN-a** — exact depth constant (5 vs other). Recommend 5; finalize in the
  C-2 Specification.
- **D-C2-OPEN-b** — whether "detach" on parent-archive should be operator-manual
  only or offered as an explicit bulk action. Recommend manual/explicit first.

---

## 5. Enforcement analysis — why re-parent is a trusted-writer action (VERIFIED constraint)

`accounts` writes today are **client-direct, `isAdminOrDispatcher()`-gated**
(`firestore.rules`). Two invariants C-2 requires **cannot be safely enforced by
Firestore Rules alone**:

- **Cycle prevention (D-C2-3)** needs to walk the ancestor chain of the proposed
  parent — a multi-document traversal Rules cannot perform within its `get()`
  budget for arbitrary depth.
- **Depth bound (D-C2-4)** likewise needs ancestor/descendant traversal.

Therefore:

- **Read-side family resolution and derived rollups are safe now** (read-only over
  existing `isAdminOrDispatcher()` reads) and do not need the trusted writer.
- **The re-parent / link / detach WRITE must be a trusted-writer (Cloud Function)
  action**, gated on Functions deployment (Issue #15) — consistent with C-1 §11 and
  ADR-005's "trusted Functions for sensitive/audited mutations." C-2 must **not**
  ship an unguarded client-direct `parentAccountId` write that could create a cycle
  or unbounded depth. Until the writer exists, hierarchy is **read/display of a
  field that is only ever set by that writer** — the field may be reserved, but no
  interim client-direct re-parent surface is added (C-1 §11 anti-retrofit rule).

**Hierarchy never touches authorization.** `firestore.rules` for `accounts`/
`locations`/`contacts`/`fieldops_wos` stays exactly as today; no rule reads
`parentAccountId`. (C-2 safeguard; ADR-005.)

---

## 6. Proposed implementation units (docs-first; runtime BLOCKED)

Sequenced so each depends only on prior ones. All later-gate, separately
authorized; the WRITE unit is additionally gated on Issue #15 and the
deployment-lock transfer.

| Unit | Deliverable | Depends on | Gate |
|---|---|---|---|
| **C-2 (this)** | Hierarchy Assessment & Design — model + decisions | C-1 | Assessment (docs) |
| **C-2.S** | Hierarchy Specification + Implementation Plan — field contract, invariants, index, trusted-writer interface, audit event shape, test matrix | C-2 | Spec → Impl Plan (docs; Rules/index touched here = Tier 2 at build) |
| **C-2.1** | Read-side family resolution + **derived** rollups (read-only; reuses `accountPortfolio.js` pattern; `parentAccountId` index) | C-2.S | Build (read-only; index deploy separately authorized) |
| **C-2.2** | Trusted-writer link / re-parent / detach with cycle + depth + archive-block invariants + audit event | C-2.S, Issue #15, deployment-lock transfer | Build (Tier 2; blocked) |

The detailed Firestore Rules/index and Cloud Function contracts are **named here,
authorized nowhere** — each is its own gate.

---

## 7. Risks & dependencies

**Risks:**

- **Cycle / unbounded depth via client-direct write.** Mitigation: re-parent is
  trusted-writer-only (§5); no interim unguarded client write.
- **Rollup cost.** Mitigation: bounded depth (D-C2-4) + read-side derivation +
  `parentAccountId` index; never a stored aggregate.
- **Denormalized-total drift.** Mitigation: D-C2-8 forbids stored family totals.
- **Orphaned active child under archived parent.** Mitigation: D-C2-5 + D-C2-6
  (block archive while non-archived children exist; no silent cascade).
- **Hierarchy scope-creep into access/billing.** Mitigation: §2 table + §5 hard
  rule; hierarchy stays organizational/read-only.
- **Merge interaction.** Mitigation: D-C2-7 (live links re-point via trusted
  writer, acyclicity re-validated, closed history preserved).
- **Deployment collision.** Mitigation: runtime BLOCKED; Inventory owns I-1.

**Dependencies:** C-1 Foundation (merged, `main`); ADR-005 (authorization — the
"hierarchy ≠ access" and trusted-writer constraints); ADR-006 (Equipment reaches
Account directly — unaffected); Issue #15 (Functions — gates C-2.2 write + audit);
Issue #140 (tenant/company — the future same-tenant parent constraint, not resolved
here); Customer/Inventory deployment-lock transfer.

---

## 8. Approval

**Gate:** Assessment (C-2). **Status: DRAFT.** Awaits ChatGPT Domain/Governance
review and separate Owner authorization. Authorizes no implementation and no
production-data action. Customer runtime remains **BLOCKED** until Inventory I-1
closes and the deployment lock is explicitly transferred. **STOP before merge —
Owner review required.**
