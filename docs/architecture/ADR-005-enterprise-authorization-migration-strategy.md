# ADR-005 — Enterprise Authorization Migration Strategy

Status: Accepted (Owner-approved decision for Issue #226)
Phase: Enterprise Access & Administration — Architecture (governance chain: Assessment → **ADR** → Specification → Implementation Plan → foundation → Admin portal → domain-by-domain migration → legacy-role retirement)
Depends on:

- `docs/assessments/enterprise-access-and-administration-platform.md` (the merged #226 Assessment — current-state inventory + option matrix this ADR decides)
- Issue #226 (tracking), Issue #140 (tenant/company model — **authority, not resolved here**), Issue #15 (production Cloud Functions deployment — gating), Issue #100 (operational-role linkage/behavior — preserved), Issue #175 (governed-field enforcement — preserved)

**Design-stage only. Docs-only. Merging this ADR authorizes NO implementation.** It records an Owner-approved architecture *decision*; it does not build a permission engine, Admin UI, collection, Rule, Function, index, schema, route, deployment, or production-data change. Each later stage (Specification → Implementation Plan → foundation → Admin portal → domain-by-domain migration → legacy-role retirement) is its own separately-authorized Owner gate. Issue #226 stays OPEN. **AI may recommend and explain but never grants, revokes, or approves access.**

Relationship to prior ADRs (Q10): **purely additive.** ADR-005 does not supersede or modify ADR-001, ADR-002, ADR-003, or ADR-004; it may reference them where their domains later consume authorization, but their decisions remain intact.

Verified against `origin/main` @ `0e71dcf`. Repository-path convention: `firestore.rules`, `functions/…`, and `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. Context

The #226 Assessment (merged in PR #229; Architecture Review passed) inventoried the current authorization model and presented four architecture options **without choosing one**, recording the choice and eight supporting items as explicit Owner decisions. Today authorization is entirely document-based (`users/{uid}.role` + the linked `employees/{employeeId}.operationalRoles`/`employmentStatus`), with **no** token custom-claims / `accessVersion` and Rules re-`get()`-ing on each evaluation; the Administration surface renders a `PlaceholderPage` and access changes are performed out-of-app by Admin-SDK operator scripts; audit is per-domain, not unified. Inventory's audit confirmed the Issue #100 operational-role Rules grants (merged + 178/178 locally, production verification UNRUN).

This ADR records the Owner's decision on **how** the platform's authorization evolves from that state toward the governed Role / Permission / Scope / Condition / Approval Policy / Access Request / Audit Event capability model — while keeping current `admin`/`dispatcher`/`technician` behaviour byte-for-byte compatible throughout.

## 2. Decision

Adopt **Option D — the Hybrid Compatibility Model** (Assessment §12). The following sub-decisions are the recorded Owner decisions and are binding on the Specification and all later stages.

### 2.1 Architecture — Hybrid Compatibility Model (Q1)

- Preserve `admin`, `dispatcher`, and `technician` as **seeded compatibility Roles** during migration.
- Migrate authorization **domain-by-domain** to Permissions.
- Remove hard-coded / raw role authority **only after all §2.7 exit criteria pass** (retirement is last).

### 2.2 Tenant / company Scope (Q2)

- The authorization model **must accept tenant/company Scope without redesign**.
- **Issue #140 remains the authority** for defining the actual tenant/company model. **ADR-005 does not resolve or absorb Issue #140** — it only reserves the seam.

### 2.3 Enforcement & freshness — hybrid (Q3)

- **Hybrid**: custom **claims where revocation latency matters**, **Firestore Rules `get()` lookups where freshness matters**.
- **Claims stay compact and high-level only** — permitted claims are limited to:
  - `companyId` (only after Issue #140 defines it),
  - `platformAdmin`,
  - `companyAdmin`,
  - `accessVersion`.
- **Never** place detailed permissions, approval limits, warehouse/location Scopes, territory lists, or Condition graphs in claims.
- **Firestore Rules remain authoritative for allowed client-direct access.** **Trusted Cloud Functions remain authoritative for sensitive, administrative, approval, financial, and audited mutations.**

### 2.4 Approval Policy — mandatory principles (Q4)

The complete approval matrix is deferred to the Specification, but ADR-005 establishes these binding principles:

- No user may approve their **own** privilege elevation.
- Platform-admin / company-admin **grants or revocations require a second, distinct authorized approver** once the in-app approval workflow exists.
- Direct permission **overrides** and **Scope expansion** require approval.
- Ordinary assignment of a **pre-approved, non-privileged Role** may be performed by a single authorized administrator.
- Every request, approval, rejection, grant, and revoke produces an **immutable Audit Event**.
- Until the trusted workflow exists, access changes remain **separately Owner-authorized operator-script actions**.

### 2.5 Initial Admin portal scope (Q5)

**MVP is limited to:** user/account status; assignment of already-approved Roles; effective-permission preview/explanation; read-only immutable audit history.

**Operator-script-only or deferred:** permission/Role-definition builders; custom Scope and Condition builders; direct permission overrides; approval-policy editor; claims administration; break-glass administration; bulk migration; access requests; AI administration; impersonation.

**No client-direct permission administration is permitted.**

### 2.6 Issue #15 sequencing (Q6)

- **May proceed before #15 resolves:** Architecture, Specification, Implementation Planning, pure authorization-logic resolution, and **non-authoritative shadow/parity testing**.
- **Blocked until the required Cloud Functions are deployed and verified under #15:** trusted-writer activation, Admin portal mutations, claims changes, access approvals, and **production authorization enforcement**.
- **Continue controlled operator scripts until then.**

### 2.7 Legacy-role retirement criteria (Q7)

Retirement remains **last** and is prohibited until **all** are true:

1. no direct `admin`/`dispatcher`/`technician` authorization checks remain outside the compatibility boundary;
2. every protected domain uses the Permission engine;
3. applicable Firestore Rules use the approved model;
4. applicable Cloud Functions use the approved model;
5. the approved Admin portal is active;
6. immutable auditing is production-verified;
7. compatibility and parity tests pass;
8. Issue #100 operational-role behaviour is preserved;
9. Issue #175 governed-field enforcement is preserved;
10. production verification passes;
11. rollback is tested and documented;
12. no authorization regression remains.

The names `admin`/`dispatcher`/`technician` **may persist as configurable Role definitions**, but the **raw legacy role field and hard-coded role authority may be removed only after these criteria pass**.

### 2.8 Impersonation (Q8)

**Out of scope.** Impersonation ("act as user") may be reconsidered only through a **separate future ADR** covering audit, consent, time limits, restricted actions, and emergency termination.

## 3. Reasoning

- **Compatibility first.** Seeding today's three roles as compatibility Roles keeps `admin`/`dispatcher`/`technician` behaviour identical while Permissions are introduced underneath — no flag-day cutover, additive domain-by-domain migration, retirement last.
- **Defence in depth preserved.** Rules stay authoritative for client-direct writes and trusted Functions for sensitive/audited mutations — the model layers Permissions *onto* the existing authorities rather than replacing them, so it can never weaken an existing Rule (e.g. Issue #175 governed fields, Issue #100 operational-role grants).
- **Compact claims avoid the staleness trap.** Detailed, frequently-changing authorization (permissions, Scopes, Conditions) lives in Firestore where it is always fresh via Rules `get()`; only stable, high-level facts (`companyId`, `platformAdmin`, `companyAdmin`, `accessVersion`) ride in claims, with `accessVersion` giving a revocation-latency lever — this bounds token-staleness risk and read-cost simultaneously.
- **Approval + audit are non-negotiable trust properties**, not features — separation-of-duty on privilege elevation and immutable Audit Events are established at the ADR level so no later stage can quietly omit them.
- **#15 realism.** Nothing authoritative (trusted writes, claims changes, production enforcement) can ship before Functions are deployed and verified; design/spec/shadow work can, so the chain makes progress without pretending the production boundary is closed.

## 4. Consequences

- The Specification must define: the Permission taxonomy + resource/action model; the domain-by-domain migration order and per-domain parity tests; the Role→Permission seed mapping that reproduces today's matrix exactly (incl. Issue #100 operational-role grants and Issue #175 admin-only governed fields); the trusted-writer + Audit Event schema; the `accessVersion`/claims lifecycle; and the full approval matrix consistent with §2.4.
- The tenant Scope seam is reserved but empty until Issue #140 lands (§2.2).
- Until #15, authorization changes remain operator-script actions (§2.6); the Admin portal MVP (§2.5) is read/status/assignment-only with no client-direct permission administration.
- Retirement of the raw role field is gated on the twelve §2.7 criteria; parity/compatibility and rollback testing are prerequisites, not afterthoughts.
- Impersonation stays out until its own ADR (§2.8).

## 5. Governance & scope honored

Two-file docs-only change (this ADR + a metadata-only note on the Assessment recording that PR #229 merged, Architecture Review passed, Option D was Owner-approved, and ADR-005 governs the decision — the Assessment's findings and option matrix are not rewritten). No application code, Rules, indexes, Functions, schemas, routes, deployment, production-data, or roadmap/status-document change. Issue #226 stays OPEN/In Progress for the Specification and later separately-authorized gates. This ADR records an Owner decision; **AI never grants, revokes, or approves access.**
