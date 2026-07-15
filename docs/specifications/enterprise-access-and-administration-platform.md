---
artifact_type: specification
gate: Sprint Specification
status: Specification-Approved
date: 2026-07-15
owner: Claude Code (Customer/Platform)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md, docs/assessments/enterprise-access-and-administration-platform.md]
implements: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 226
target_release: TBD
---

# Specification: Enterprise Access & Administration Platform

**Status: SPECIFICATION-APPROVED.** Derives implementation-ready contracts from the Accepted, Owner-approved **[ADR-005](../architecture/ADR-005-enterprise-authorization-migration-strategy.md)** (Option D — Hybrid Compatibility Model) and the merged **[Assessment](../assessments/enterprise-access-and-administration-platform.md)** (PR #229). Tracking issue: #226.

**This Specification defines contracts; it authorizes NO implementation.** No permission engine, Admin UI, collection, Firestore Rule, Cloud Function, index, schema, route, deployment, or production-data change is built or authorized here. It makes **no** decision beyond ADR-005 — where ADR-005 defers (tenant model #140, full approval matrix, retirement timing), this Specification defers identically. Each build stage (Implementation Plan → foundation → Admin portal → domain-by-domain migration → legacy-role retirement) is a separately-authorized Owner gate. **AI specifies; it never grants, revokes, or approves access.**

Verified against `origin/main` @ `e01771d`. Path convention: `firestore.rules`, `functions/…`, `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. Executive summary

The platform migrates from today's document-based `users/{uid}.role` + `employees/{employeeId}.operationalRoles` model to a governed **Role / Permission / Scope / Condition / Approval Policy / Access Request / Audit Event** model, **hybrid-enforced** (compact high-level claims + `accessVersion` where latency matters; Firestore Rules `get()` where freshness matters; trusted Cloud Functions for sensitive/audited mutations). `admin`/`dispatcher`/`technician` are seeded as **compatibility Roles** so current behaviour is byte-for-byte preserved while Permissions are introduced underneath, domain-by-domain, with raw-role retirement **last**. This document specifies the object contracts, the deterministic resolution algorithm, the claims/`accessVersion` behaviour, the enforcement boundaries, the fail-closed rules, the trusted-writer command contracts, the audit contract, the Admin-portal MVP, and the measurable acceptance/parity/security/rollback/production-verification criteria — all as testable contracts, none as code.

## 2. Scope

Contracts and behaviour for: §5 the seven governed objects; §6 stable permission identifiers; §7 seeded compatibility mappings; §8 effective-permission resolution + precedence; §9 security-authorization vs operational-qualification separation; §10 tenant-ready Scope; §11 claims + `accessVersion`; §12 enforcement boundaries; §13 fail-closed; §14 Audit Events; §15 trusted-writer commands + separation-of-duty; §16 Admin-portal MVP; §17 operator-script interim; §18 compatibility/shadow-mode migration; §19 domain-by-domain rollout; §20 break-glass requirements; §21 acceptance/parity/security/rollback/production-verification criteria.

## 3. Explicitly out of scope / deferred (per ADR-005)

Per ADR-005 and the authorization for this Specification, the following are **named but not designed here** and remain separately-authorized future gates: the **tenant/company model** (Issue #140 is the authority — §10 reserves the seam only); the **full approval matrix** (§15 fixes ADR-005's principles; the complete matrix is Specification-of-record for a later stage); **complex builders** (permission/Role-definition, custom Scope/Condition builders); **direct permission overrides**; the **Access Request workflow/UI** (its record contract is defined in §5.7, the workflow is deferred); **AI administration**; **impersonation**; and **legacy-role retirement** (§7/§21 define the criteria, not the act). **No production deployment or data migration** is specified as executable here.

**Must not be silently introduced (hard prohibitions, verified in review):** client-direct permission administration; `operationalRoles` treated as security permissions; detailed permissions/Scopes/Conditions in custom claims; a tenant/company schema; any Admin UI beyond the ADR-approved MVP; production deployment or data migration.

## 4. Definitions

- **Security authorization** — what a principal may *do* (Permissions via Roles). **Operational qualification** — what work a principal is *eligible* to perform (`operationalRoles` + `employmentStatus` + assignment). These are **distinct object families** (§9) and never coerced into one another.
- **Principal** — an authenticated user (`users/{uid}`). **Actor** — the principal performing an administrative action.
- **Trusted writer** — a deployed, authenticated Cloud Function that performs a sensitive/audited mutation server-side (gated by Issue #15).

## 5. Governed-object contracts

Each contract lists **fields (shape), invariants, and who may write**. Storage collections are **named for the contract** but their creation is an Implementation-Plan concern; no collection is created here.

### 5.1 Permission
- **Shape:** `{ id: PermissionId (string, stable), description: string, resource: string, action: string, deprecated?: boolean }`.
- **Invariants:** `id` is globally unique and **immutable once published** (§6); a Permission is a pure capability declaration — it carries no principal, no Scope, no Condition.
- **Writer:** definition set is repository-declared (seed), not client-editable; changes are trusted-writer + Audit Event only. **No client-direct write, ever.**

### 5.2 Role
- **Shape:** `{ id: RoleId, name: string, description: string, permissions: PermissionId[], compatibility?: boolean, systemSeed?: boolean }`.
- **Invariants:** a Role is a named **bundle of Permission ids**; the three seeded compatibility Roles (§7) are `systemSeed: true, compatibility: true` and their permission sets are **repository-declared and frozen** to reproduce today's matrix exactly; a Role never contains a raw legacy-role string as authority.
- **Writer:** Role *definitions* — trusted-writer only (deferred builder; MVP ships the seed set). Role *assignment to a principal* — §5.3 / §15.

### 5.3 Role assignment (grant of a Role to a principal)
- **Shape:** `{ principalUid, roleId, scope: Scope, grantedBy, grantedAt, approvedBy?: uid, status: "active"|"disabled", accessVersionAtGrant }`.
- **Invariants:** an assignment binds a Role to a principal **within a Scope** (§10); creating/disabling an assignment is a trusted-writer command (§15) that **bumps the principal's `accessVersion`** (§11) and emits an Audit Event (§14); assignment of a **pre-approved, non-privileged** Role may be done by one authorized admin, otherwise approval rules (§15) apply.
- **Writer:** trusted writer only. **No client-direct write.**

### 5.4 Scope
- **Shape:** `{ type: ScopeType, value?: string }` where `ScopeType ∈ { global, tenant, domain, location, ownAssignment }`.
- **Invariants:** Scope bounds where a grant applies; `tenant` is **reserved and inert** until Issue #140 defines it (§10) — a `tenant` Scope resolves as "no tenant boundary configured" and **must never widen** access; `ownAssignment` binds to the principal's own assignment identity (mirrors today's PO-Void assignee-only, reorder own-queue).
- **Writer:** carried on Role assignments (§5.3); no standalone Scope builder in MVP (deferred).

### 5.5 Condition
- **Shape:** a **declarative** predicate `{ kind: ConditionKind, params: object }`, never arbitrary code. Initial `ConditionKind ∈ { statusEquals, statusIn, isOwnAssignment, employmentActive, operationalRoleActive }`.
- **Invariants:** Conditions are evaluated deterministically and side-effect-free; `operationalRoleActive` references **eligibility** (§9), never grants a Permission by itself; unknown/malformed `kind` **fails closed** (§13).
- **Writer:** attached to Permissions-within-Roles by repository declaration; no custom Condition builder in MVP (deferred).

### 5.6 Approval Policy
- **Shape:** `{ changeType, requiresApproval: boolean, approverConstraint: ApproverConstraint }` where `ApproverConstraint` expresses ADR-005 §2.4 (e.g. `distinctFromRequester`, `platformAdmin`, `companyAdmin`).
- **Invariants (fixed by ADR-005, §15):** no self-approval of one's own elevation; platform/company-admin grant/revoke requires a **second distinct authorized approver** (once the in-app workflow exists); overrides + Scope expansion require approval; assignment of a pre-approved non-privileged Role needs one admin. The **full matrix is deferred**; these principles are binding.
- **Writer:** repository-declared; no approval-policy editor in MVP (deferred).

### 5.7 Access Request
- **Shape:** `{ id, requestedBy, requestedChange, requestedScope, status: "pending"|"approved"|"rejected", decidedBy?: uid, decidedAt?, reason?: string }`.
- **Invariants:** the **record contract** is defined so audit/trace exist from day one; the **request→review→decision workflow and UI are deferred** (§3). Until then, access changes are Owner-authorized operator-script actions (§17) that still emit Audit Events.
- **Writer:** trusted writer only (when the workflow exists); never client-direct.

### 5.8 Audit Event
- **Shape:** `{ id, at: serverTimestamp, actorUid, action: AuditAction, targetType, targetId, scope?: Scope, approverUid?: uid, outcome: "applied"|"denied", summary: string, accessVersionAfter?: number }`.
- **Invariants:** append-only and **immutable** (no update/delete by anyone, including admins); written **only** by a trusted writer; **never** contains secrets, tokens, raw credentials, full permission graphs, or PII beyond the minimal `targetId`; every grant/revoke/role-assignment/enable/disable/approval/rejection produces exactly one Audit Event (§14).
- **Writer:** trusted writer only.

## 6. Stable capability-based permission identifiers

- **Format:** `PermissionId = "<domain>.<resource>.<action>"`, lower-camel segments, e.g. `account.governedField.write`, `account.record.read`, `workOrder.cancel`, `reorder.request.approve`, `reorder.purchaseOrder.void`, `admin.userStatus.write`, `admin.roleAssignment.write`, `audit.event.read`.
- **Rules:** ids are **capability-based** (name the capability, not the UI or the role), **stable**, and **immutable once published**; deprecation is additive (`deprecated: true` + a successor id), never a silent rename; the id namespace is repository-declared and reviewed. A published id must never be re-pointed to a different capability.

## 7. Seeded compatibility mappings (admin / dispatcher / technician)

- Each legacy role is seeded as a **compatibility Role** whose Permission set **reproduces today's effective matrix exactly** — including: admin-only governed commercial fields (Issue #175); admin/dispatcher Customer read/create/edit; Work Order lifecycle via the `transitionWorkOrder` authority; the Issue #100 operational-role reorder/PO grants expressed as **eligibility Conditions** (§9), not as security Permissions; the dispatcher in-flight-technician cancel narrowing; the technician forward-transition set.
- The seed mapping is the **parity oracle**: shadow-mode (§18) asserts the new engine yields the **identical** allow/deny decision as the legacy checks for every principal/action/resource, or the migration does not advance.
- These names may later persist as configurable Role definitions; the **raw legacy `users/{uid}.role` field and hard-coded role checks are retired only after §21's criteria pass** (retirement is a separate gate).

## 8. Effective-permission resolution & deterministic precedence

Given a principal, a requested `PermissionId`, a target resource, and its Scope/Condition context, the **effective decision** is computed deterministically:

1. Collect the principal's **active** Role assignments (`status == "active"`) whose `accessVersionAtGrant` is consistent with the current `accessVersion` (§11); a disabled or stale assignment contributes nothing.
2. Union the Permission ids from those Roles' definitions.
3. For each candidate grant of the requested id, evaluate its **Scope** (does the target fall within the assignment's Scope, §10) and its **Conditions** (§5.5); a grant counts only if **Scope matches AND all Conditions pass**.
4. **Decision = ALLOW iff at least one qualifying grant exists; otherwise DENY.**
5. **Precedence:** MVP has **no direct overrides and no deny-permissions** (both deferred), so resolution is a pure positive union — there is no allow/deny conflict to arbitrate. The contract nonetheless fixes a deterministic order for future overrides: an explicit **deny** (when introduced) always outranks any allow; among allows, the **narrowest matching Scope** is the authoritative basis for logging, resolved by a total order `ownAssignment < location < domain < tenant < global`; ties break by lexicographic `PermissionId` then assignment `grantedAt`. Resolution is a **pure function** of (assignments, role definitions, target context, accessVersion) — same inputs always yield the same decision, making it unit-testable without a backend.

## 9. Security authorization vs operational qualification (strict separation)

- **Security authorization** = Permissions via Roles (§5.1–§5.3). **Operational qualification** = `operationalRoles` + `employmentStatus` + assignment identity (Issue #100), surfaced only as **Conditions** (`operationalRoleActive`, `employmentActive`, `isOwnAssignment`).
- **Invariant:** an `operationalRole` **never** becomes a security Permission and never, by itself, authorizes an action. Where Issue #100 grants an operational role a capability today (e.g. PARTS_MANAGER Assign, PARTS_ASSOCIATE purchasing steps), the new model expresses that as a **security Permission whose grant is Conditioned on the operational-role eligibility** — the two objects stay distinct and are auditable separately.
- This preserves Issue #100 behaviour exactly and prevents the "eligibility silently becomes authority" failure the Assessment warns against.

## 10. Tenant-ready Scope (without defining Issue #140)

- `ScopeType` includes `tenant` as a **first-class but inert** value: every Permission check, assignment, and Audit Event carries a Scope that *can* be tenant-bounded, but the tenant model — what a tenant is, how principals map to it, how data partitions — is **Issue #140's to define**.
- **Invariant:** until #140 lands, a `tenant` Scope resolves to "no tenant boundary configured" and is treated as **neutral (never widening, never a bypass)**; the resolution algorithm (§8) and the claims `companyId` (§11) are shaped to accept a real tenant later **without contract change**. This Specification introduces **no tenant/company schema** (hard prohibition, §3).

## 11. Compact claims contract & `accessVersion` behaviour

- **Custom claims are limited to** (ADR-005 §2.3): `companyId` (present only after #140 defines it — reserved/empty until then), `platformAdmin` (boolean), `companyAdmin` (boolean), `accessVersion` (integer). **No** detailed permissions, Scopes, Conditions, approval limits, or territory lists in claims (hard prohibition).
- **`accessVersion` semantics:** the authoritative per-principal `accessVersion` lives in the principal's access record (server-side). Any access change (grant, revoke, role assignment, enable/disable, approval that alters access) is a trusted-writer command (§15) that **increments `accessVersion`** and mints/refreshes the principal's claims.
- **Refresh/revocation:** clients obtain a fresh token (force-refresh) after an access change; every enforcement point compares the **token's `accessVersion`** against the authoritative value. A **mismatch (stale token) fails closed** (§13) — the request is denied until the client refreshes. This bounds revocation latency without putting detail in the token.
- Claims are used only for **coarse gating** (`platformAdmin`/`companyAdmin`/`companyId`) and freshness (`accessVersion`); **all fine-grained decisions come from Rules `get()` lookups or trusted Functions** (§12).

## 12. Enforcement boundaries — Rules lookup vs trusted Function

| Enforcement point | Authority | Mechanism |
|---|---|---|
| Client-direct **reads/writes** (e.g. reorder queue reads, own-assignment updates) | **Firestore Rules** (authoritative) | Rules `get()` on the principal's assignments + Role definitions, evaluate §8; `accessVersion` freshness via claims; fail-closed on missing/stale/malformed |
| **Sensitive/administrative/approval/financial/audited** mutations (grants, revokes, role assignment, enable/disable, approvals, and existing Cloud-Function-owned lifecycle e.g. `transitionWorkOrder`) | **Trusted Cloud Functions** (authoritative) | server-side effective-permission check (§8) + separation-of-duty (§15) + Audit Event (§14); **gated by Issue #15** |
| **Coarse UI/nav gating** | presentation only — **never authoritative** | claims + a client mirror of §8, exactly as `navConfig` mirrors Rules today |

**Invariant:** UI hiding is never a security boundary; Rules and trusted Functions are the only authorities. No enforcement path depends on undeployed Functions being silently assumed live — anything trusted-Function-enforced is explicitly **#15-gated** (§17).

## 13. Fail-closed behaviour

Every enforcement point **denies** when access data is **missing** (no assignment / no access record / no Role definition), **stale** (`accessVersion` token/authoritative mismatch), **malformed** (unparseable assignment, unknown `ConditionKind`, unknown Scope type, non-list where a list is required), or **unavailable** (lookup error/timeout). There is **no default-allow, no fallback role, and no "empty means admin"** branch anywhere — mirroring today's `AuthContext` fail-closed identity resolution. Fail-closed is an **acceptance criterion** (§21), asserted by explicit negative tests.

## 14. Immutable trusted Audit Events

- Every grant, revoke, role assignment, enable/disable, approval, and rejection emits **exactly one** Audit Event (§5.8), written **only** by a trusted writer, **append-only and immutable** (no update/delete by any principal including platform admins), and **secret-free**.
- Audit is **read-only** in the Admin portal MVP (§16). Immutable auditing being **production-verified** is a §21 retirement precondition.

## 15. Trusted-writer commands & separation-of-duty

Each administrative action is a **trusted Cloud Function command** (never client-direct), all **#15-gated** (§17). Command contracts:

- `grantRole(principalUid, roleId, scope)` / `revokeRole(assignmentId)` — create/deactivate an assignment; bump `accessVersion`; Audit Event.
- `assignApprovedRole(principalUid, roleId, scope)` — the MVP single-admin path for a pre-approved, non-privileged Role.
- `setUserStatus(principalUid, "enabled"|"disabled")` — enable/disable a principal; bump `accessVersion`; Audit Event.
- `approveAccessRequest(requestId)` / `rejectAccessRequest(requestId, reason)` — decision on an Access Request (workflow deferred, contract fixed).

**Separation-of-duty (ADR-005 §2.4, binding):** no actor may approve their **own** privilege elevation; platform/company-admin grant/revoke requires a **second, distinct authorized approver** once the workflow exists; **direct permission overrides and Scope expansion require approval**; ordinary assignment of a pre-approved non-privileged Role may be performed by a **single** authorized admin. Each command **verifies the actor's own effective permission** (§8) server-side before acting and records `actorUid` (+ `approverUid` where required) in the Audit Event.

## 16. Admin portal MVP (ADR-005 §2.5)

**In-scope MVP (read/status/assignment only):** view/set **user status** (enable/disable via the trusted command); **assign already-approved Roles** (via the trusted command); **permission preview/explanation** (a read-only render of §8's effective decision for a selected principal — "why can/can't this user do X"); **read-only immutable audit history**.

**Explicitly NOT in the MVP (deferred, §3):** permission/Role-definition builders; custom Scope/Condition builders; direct permission overrides; approval-policy editor; claims administration; break-glass administration; bulk migration; access-request UI; AI administration; impersonation. **No client-direct permission administration** — every mutating action in the portal calls a trusted command.

## 17. Operator-script interim while Issue #15 is unresolved

- Until the required Cloud Functions are **deployed and verified under Issue #15**, all authoritative mutations (grants, revokes, assignments, enable/disable, approvals, claims changes, production enforcement) run **only** through **controlled, Owner-authorized operator Admin-SDK scripts** (the same trust class as `functions/scripts/provisionEmployeeAccess.js`), each emitting the same Audit Event contract (§14).
- **May proceed now (non-authoritative):** Architecture is done (ADR-005); this Specification; the Implementation Plan; pure authorization-logic modules (§8 resolution) with unit tests; and **shadow/parity testing** (§18) that observes-and-compares but **enforces nothing**.
- **Blocked until #15:** trusted-writer activation, Admin-portal mutations, claims changes, access approvals, and production authorization enforcement. This dependency is **explicit**, never hidden (a §21 review check).

## 18. Compatibility / shadow-mode migration

- **Shadow mode:** the new resolution engine (§8) runs **alongside** the existing legacy checks, computing a decision that is **logged and compared** but **not enforced**. Any divergence from the seeded-compatibility oracle (§7) is a **parity defect** that blocks advancement.
- Migration is **additive**: the legacy `users/{uid}.role` checks stay authoritative until a domain's parity is proven, then that domain flips to the Permission engine (§19), then the next — never a flag-day cutover.
- **Rollback:** every migration step is independently revertible; the legacy path remains intact behind the compatibility boundary until §21 retirement criteria pass.

## 19. Domain-by-domain rollout boundaries

- Rollout unit = one **domain** (e.g. Customer/Accounts, then Inventory/Reorder, then Service/Work Orders), each: seed Role/Permission mapping for that domain → shadow-mode parity (§18) → flip enforcement (Rules and/or trusted Function) for that domain only → verify → proceed.
- Cross-domain invariants preserved throughout: Issue #100 operational-role behaviour (§9), Issue #175 governed-field enforcement (§7), the Work Order lifecycle authority (ADR-002), and Issue #182's future truck/invoice surface accommodated later as its own Permission set (not pre-empted).
- No domain flips before its parity tests are green; a failed domain never blocks or silently alters another.

## 20. Break-glass recovery requirements (no break-glass UI)

- The system must define a **break-glass recovery path** so a lockout (e.g. no principal can grant access, or a bad `accessVersion` bump) is recoverable: a **controlled, Owner-authorized operator Admin-SDK procedure** (not a UI, not client-direct) that can restore a platform-admin assignment and reset `accessVersion`, emitting Audit Events.
- **No break-glass UI is added** (hard prohibition); break-glass administration stays operator-script-only (§16 deferred list). Break-glass usage is itself audited (§14).

## 21. Measurable acceptance, parity, security, rollback & production-verification criteria

**Acceptance (unit-testable, no backend):**
- A1. §8 resolution is a pure function: identical inputs → identical decision; covered by exhaustive allow/deny cases per seeded Role.
- A2. Permission ids conform to §6 and are unique/immutable across the seed set.
- A3. Every legacy capability has a seeded-compatibility mapping (§7) — no gap, no extra.

**Parity (shadow-mode, §18):**
- P1. For every (principal, action, resource) in a representative fixture, the new engine's decision **equals** the legacy decision — 100% match required to advance a domain.
- P2. Issue #100 operational-role decisions (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE grants) match exactly, expressed as Conditions (§9).
- P3. Issue #175 governed-field admin-only decisions match exactly.

**Security:**
- S1. Fail-closed (§13) proven by negative tests for missing/stale/malformed/unavailable access data — all DENY.
- S2. No `operationalRole` grants a security Permission by itself (§9).
- S3. Claims contain only the four permitted fields (§11); a test asserts no detailed permission/Scope/Condition ever appears in a claim.
- S4. Separation-of-duty (§15) enforced server-side: self-approval and single-actor privileged grant are rejected.
- S5. Audit Events are append-only/immutable and secret-free (§14).

**Rollback:**
- R1. Each migration step is revertible to the prior enforcement with the legacy path intact; a documented, **tested** rollback runbook exists per domain.

**Production-verification (Issue #15-gated):**
- V1. Before any domain enforces in production, the trusted Functions are **deployed and verified** under #15; the Firestore Rules Regression suite passes; and the authenticated production authorization check passes (the same "merge ≠ deploy ≠ confirmed-live" discipline Inventory recorded for Issue #100).
- V2. Legacy-role retirement (§7) occurs only after **all** ADR-005 §2.7 criteria pass, including V1 and R1.

## 22. Expected file scope

Exactly one new file: `docs/specifications/enterprise-access-and-administration-platform.md`. No application code, Rules, indexes, Functions, schemas, routes, deployment, production data, or roadmap/status-document change. Issue #226 stays OPEN/In Progress.

## 23. Risks

- **Parity gaps** (a legacy capability missed in the seed mapping) → mitigated by §7 oracle + P1/P3 100%-match gates before any flip.
- **Claim bloat / staleness** → mitigated by the §11 four-field cap + `accessVersion` fail-closed (S3, S1).
- **Hidden #15 dependency** → mitigated by §17's explicit gating + the §21/V1 review check.
- **Lockout** → mitigated by §20 break-glass + R1 rollback.
- **Eligibility-becomes-authority drift** → mitigated by §9 separation + S2.

## 24. Open questions (for the Owner, at later gates — not resolved here)

- The **full approval matrix** (§5.6/§15) beyond ADR-005's principles — deferred to a later Specification-of-record.
- The **tenant/company model** (§10) — Issue #140.
- Domain **rollout order** and per-domain parity fixture composition — Implementation Plan.
- Concrete collection names / index shapes / Rules helper structure — Implementation Plan (this Spec fixes contracts, not storage layout).

## 25. Approval

Specification-Approved as the contract layer derived from Owner-approved ADR-005. Merging records the contracts only; it authorizes **no** implementation. The Implementation Plan is the next separately-authorized gate; Issue #226 remains OPEN/In Progress. **AI specifies; it never grants, revokes, or approves access.**
