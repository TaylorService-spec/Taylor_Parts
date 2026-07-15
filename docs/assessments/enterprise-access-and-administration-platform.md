---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-15
owner: Claude Code (Customer/Platform)
related_adrs: []
depends_on: [docs/PROJECT_ARCHITECTURE.md, docs/PlatformOperatingModel.md, docs/DelegationCharter.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 226
target_release: TBD
---

# Assessment: Enterprise Access & Administration Platform

**Status: DRAFT (pending Architecture Review).** Assesses **Issue #226** only — the current-state authorization model across every enforcement layer and a proposed governed **Enterprise Access & Administration** capability. It inventories what exists (with citations), draws the authentication/authorization/eligibility/organization/approval distinctions, proposes a capability + enforcement model, weighs architecture options, and recommends a governance chain.

**Merging this Assessment authorizes NOTHING.** No permission engine, Admin UI, new collection, Firestore Rule, Cloud Function, index, deployment, or production-data action is authorized. Each later stage (Architecture ADRs → Specification → Implementation Plan → foundation → Admin portal → domain-by-domain migration → legacy-role retirement) is its own separately-authorized gate under `docs/ai/workflow.md`. **The referenced ChatGPT design is input, not repository authority** — the audited current state below and the Owner's decisions are authoritative. **AI may recommend and explain, but never grants, revokes, or approves access.**

Verified against `origin/main` @ `23e5577`.

---

## 1. Current-state authorization matrix

Authorization today is assembled from **three Firestore-document inputs** resolved at sign-in by `AuthContext` (`src/auth/AuthContext.jsx`) via `resolveEmployeeSession(uid)` (`src/auth/employeeSession.js`):

| Input | Source | Meaning |
|---|---|---|
| **security role** | `users/{uid}.role` ∈ `{admin, dispatcher, technician}` (`ROLES`, `src/domain/constants.js`) | the coarse authorization tier |
| **operationalRoles** | `employees/{employeeId}.operationalRoles` (e.g. `PARTS_MANAGER`, `WAREHOUSE_MANAGER`, `PARTS_ASSOCIATE`) | **work eligibility**, resolved via the reciprocal `users/{uid}.employeeId ↔ employees/{employeeId}` link (Issue #100) |
| **employmentStatus** | `employees/{employeeId}.employmentStatus` | active/inactive gate on eligibility |

There is **no token custom-claim / `accessVersion` mechanism anywhere** in the app, Functions, or Rules (verified: zero `setCustomUserClaims`/`customClaims`/`accessVersion` references). Authorization is entirely **document-based**, re-resolved on each session and re-read by Rules via `get()` on every relevant evaluation.

**Effective current matrix (by security role):**

| Capability | admin | dispatcher | technician | Enforced where |
|---|---|---|---|---|
| Reach Customers / Service (dispatcher) nav + routes | ✅ | ✅ | ❌ | `navConfig` `ROLE_NAV_ACCESS` + `App.jsx` route gates |
| Reach Inventory nav | ✅ | ✅ | ❌ (even with a PARTS_MANAGER operationalRole) | `ROLE_NAV_ACCESS` (security-role only) |
| Customer read / create / edit | ✅ | ✅ | ❌ | `accounts` Rules `allow read, create, update: if isAdminOrDispatcher()` |
| Governed commercial fields (`paymentTerms`/`taxStatus`) edit | ✅ (admin) | ❌ (Rules-denied) | ❌ | `firestore.rules` accounts governed helpers (Issue #175) |
| Work Order lifecycle actions | via `getAllowedActions(status, role, …)` → `transitionWorkOrder` **Cloud Function** | (technician actions only) | `functions/src/transitionEngine.ts` (canonical authority) |
| Reorder request review / cancel; PO void | admin/dispatcher; PO Void **assignee-only** | operational-role-gated (Issue #100) | client-direct writes + `firestore.rules` |
| Administration / Roles & Permissions | ❌ built (renders `PlaceholderPage`) | — | — | `navConfig` `administration` domain (unbuilt) |

Two special narrowings layered in the UI (documented, not competing authorities): the dispatcher **cannot cancel an in-flight technician** through `WorkOrderActions` (`READ_ONLY_STATUSES`), and a **pure technician has zero Inventory nav** even with an eligible `operationalRole` (a known product gap, `ROLE_NAV_ACCESS`).

## 2. Authentication ≠ Authorization ≠ Eligibility ≠ Organization ≠ Approval

These are five **distinct** concerns the current model already keeps separate and the future model must keep separate:

- **Authentication** — *who you are*. Firebase Auth; `AuthContext.user`. Being signed in grants **no** authorization; on a failed identity read, `AuthContext` keeps `user` but clears `role`/`operationalRoles` to empty defaults (fail-closed).
- **Authorization** — *what you may do*. Today: `users/{uid}.role` (the security tier). **`operationalRoles` express work ELIGIBILITY and must never silently become security roles.**
- **Eligibility** — *what work you're qualified/assigned to do*. `operationalRoles` + `employmentStatus` + assignee identity (e.g. PO Void assignee-only). Independent of the security tier.
- **Organization** — *which company/tenant you belong to*. **Unresolved** — see §7 and Issue #140. No tenant boundary exists today.
- **Approval** — *a governed request→decision workflow before access changes*. Does **not** exist today; access changes are performed out-of-app by Admin-SDK scripts (§9).

**UI hiding is not a security boundary** — nav/route/component gating is convenience; Firestore Rules and Cloud Functions are the enforcement authorities.

## 3. Desired capability model (governed objects)

A first-class, governed model — proposed, not authorized:

| Object | Purpose |
|---|---|
| **Role** | a named bundle of Permissions (must remain compatible with today's admin/dispatcher/technician as seed roles). |
| **Permission** | a fine-grained `action` on a `resource` (e.g. `account.governedField.write`, `workOrder.cancel`). |
| **Scope** | the data boundary a grant applies to (tenant/company, domain, own-assignment, location). |
| **Condition** | a runtime predicate (status, ownership, employmentStatus, operationalRole eligibility). |
| **Approval Policy** | who must approve which access change, and how. |
| **Access Request** | a request→review→decision record (the governed workflow that today's scripts bypass). |
| **Audit Event** | an append-only, trusted-writer record of every grant/revoke/approval and every governed mutation. |

## 4. Enforcement-layer matrix (defence in depth)

Every capability must be enforceable at each layer that applies; **the lower layers are the authorities, the upper layers are UX**:

| Layer | Today | Target |
|---|---|---|
| **Navigation** | `ROLE_NAV_ACCESS` + `operationalRoleAccess` items (`navConfig`) | derive from Permissions; presentation-only |
| **Component** | ad-hoc role checks (e.g. `isAssignee`, `WorkOrderActions`) | derive from Permissions; presentation-only |
| **Client service** | domain functions (`domain/accounts.js`, `services/workOrderService.ts`) | carry the intended action; never the authority |
| **Cloud Function** | `transitionWorkOrder`/`createWorkOrder` (authoritative for Work Orders) | authoritative for all trusted/audited writes |
| **Firestore Rules** | `isAdmin`/`isAdminOrDispatcher`/`isActiveOperationalRole` + governed-field + assignee checks | authoritative for client-direct writes; must express Permissions/Scope/Condition |
| **Audit** | per-domain only (`inventory_actions`, PO void records); **no unified audit log** | trusted-writer append-only Audit Events for all access + governed mutations |

## 5. Compatibility & migration requirements

- **Current admin/dispatcher/technician behavior must remain byte-for-byte compatible** throughout any migration — seed the three as first-class Roles whose Permission sets reproduce today's matrix exactly.
- **Issue #100 linkage & role behavior preserved:** the `users/{uid}.employeeId ↔ employees/{employeeId}` reciprocal link, `operationalRoles` eligibility (PARTS_MANAGER/WAREHOUSE_MANAGER/PARTS_ASSOCIATE), and `isActiveOperationalRole` Rules semantics must survive unchanged.
- **Issue #175 governed-field enforcement remains authoritative:** admin-only `paymentTerms`/`taxStatus` (Rules-enforced, not UI hiding) is a Permission that must map cleanly, never weaken.
- **`operationalRoles` must never silently become security roles** — eligibility and authorization stay distinct objects.
- Migration is **domain-by-domain, additive**; legacy-role retirement is **last**, only after every domain is proven on the new model.

## 6. Lockout & rollback risks

- A new authorization layer can **lock out admins** (no one can grant access). Mitigations: a break-glass bootstrap admin path; the new checks run in **shadow/allow-alongside** mode before becoming authoritative; never flip Rules to deny-by-default without a verified allow path.
- **Rollback boundary:** every migration PR must be independently revertible; Rules changes are Tier-2 with their own deploy + `[READY]` verification and a tested rollback ruleset.
- A denied/failed access change must leave the target **byte-for-byte unchanged** (the discipline already proven for governed fields and destructive actions).

## 7. Tenant / company dependency

No tenant/company boundary exists today (single implicit org). A real Permission **Scope** needs an organization model, which is **unresolved under Issue #140** (`docs/assessments/customer-operability-data-ownership-and-analytical-export.md`). The Enterprise Access model must be **designed to accept** a tenant Scope later without rework, but **must not invent** the tenant model here — that is a separate Owner decision.

## 8. Caching, accessVersion, token-refresh, and Rules-lookup constraints

- Today Rules re-`get()` `users/{uid}` (and `employees/{employeeId}`) on **every** governed evaluation — correct but read-heavy and latency-sensitive; a configurable-permission model multiplies these lookups.
- There is **no `accessVersion` and no token custom claims** today, so an access change is reflected on the next document read with **no forced token refresh** and **no revocation-latency control**.
- A configurable model should evaluate: **custom claims** (fast, but stale until token refresh — needs an `accessVersion`/force-refresh story) vs **Rules `get()` lookups** (always fresh, but per-eval read cost and Rules cannot walk arbitrary graphs). This is an ADR-level trade-off, flagged here, decided later.

## 9. Administrative-write & audit requirements

- Access changes today happen **out-of-app** via Admin-SDK scripts (`functions/scripts/provisionEmployeeAccess.js`, `assignTechnicianToUser.js`, `onboardEmployeePreflight/Verify.js`, `auditSecurityRoleMirror.js`) — powerful, unaudited-in-app, and **not a governed workflow**.
- **Detailed configurable permissions cannot be trusted solely to client-editable documents** — an admin editing a permission doc from the client is itself a governed, audited, server-side/trusted-write operation. Every grant/revoke/approval must produce an append-only **Audit Event** via a trusted writer (the same trust class as `createWorkOrder` and `provisionEmployeeAccess.js`).
- **Production Cloud Functions dependency #15 remains material:** trusted/audited writers require deployed Functions (Blaze-plan blocker); until then, governed access changes run only through the separately-authorized Admin-SDK operator path, never a client write.

## 10. Impersonation risk assessment — **explicitly deferred**

Support/impersonation ("act as user") is a high-risk capability (privilege escalation, audit-trail confusion). It is **explicitly out of scope** for this Assessment and any near-term stage; if ever pursued it needs its own ADR with mandatory audit, consent, scoping, and time-boxing. Noted here only so it is not silently introduced.

## 11. AI boundary

AI (Claude/ChatGPT/Codex) may **recommend, explain, audit, and draft** authorization design; AI **never grants, revokes, or approves access**, and never writes Rules/claims/permission documents as an authority. Every access-affecting change is an Owner-authorized, human-accountable, audited action.

## 12. Architecture option matrix

| Option | Summary | Pros | Cons |
|---|---|---|---|
| **A. Expanded fixed roles** | add more named security roles in `users/{uid}.role` + `ROLE_NAV_ACCESS` | smallest change; familiar; Rules stay simple | not fine-grained; role explosion; no Scope/Condition; no Approval |
| **B. Firestore-configured RBAC** | Role/Permission docs read by Rules `get()` | configurable without deploys; fully fresh | read-cost multiplication; Rules can't walk complex graphs; client-editable config is a trust risk (needs trusted-writer + audit) |
| **C. Trusted centralized authorization service** | a Cloud Function / server authority mints claims/decisions; Rules trust routing | fast, fine-grained, auditable, revocation control (`accessVersion`) | requires deployed Functions (#15); token-refresh/staleness story; more infra |
| **D. Hybrid compatibility model** *(lean)* | keep the three roles as **seed Roles**; introduce Permissions incrementally; trusted writer + audit for config; claims+`accessVersion` where latency matters, Rules `get()` where freshness matters | preserves current behavior; domain-by-domain; defence-in-depth; matches existing trusted-writer pattern | most design work up front; spans several ADRs |

**Preliminary lean:** **Option D (hybrid)** best satisfies the compatibility, defence-in-depth, audit, and #15/#140/#100/#175 constraints — but the choice is an **Owner + Architecture-Review decision**, not made here.

## 13. Recommended governance chain

`Assessment` (this doc) → **Architecture ADRs** (authorization model, claims-vs-lookup, tenant-readiness, audit writer) → **Specification** → **Implementation Plan** → **foundation** (Role/Permission/Audit primitives + trusted writer, shadow mode) → **Admin portal** (the built Administration surface replacing the scripts) → **domain-by-domain migration** (Customer, Inventory, Service, each additive + compatible) → **legacy-role retirement last**. Each arrow is a separate Owner gate; merging one never authorizes the next.

## 14. Proposed Customer / Inventory / Platform work allocation

- **Platform** — owns the authorization foundation (Role/Permission/Scope/Condition/Approval/Audit primitives, trusted writer, Rules helpers, ADRs), the Admin portal shell, and the claims/lookup/accessVersion decision.
- **Customer** — migrates Customer/Account authorization (view/create/edit/archive, governed commercial fields per #175, financial visibility) onto Permissions; preserves #175.
- **Inventory** — migrates Inventory/Reorder/PO/receiving authorization and the `operationalRoles` eligibility (#100) onto Permissions; contributes the domain audit that grounds §4/§5 for its surfaces (see the Inventory-input section below).

## 15. Explicit Owner decisions still required

1. **Architecture option** (A/B/C/D) — the authorization model.
2. **Tenant/company model** (#140) — whether/when Scope gains a tenant boundary.
3. **Claims vs Rules-lookup** enforcement + `accessVersion`/revocation-latency policy.
4. **Approval Policy** — which access changes need approval, and by whom.
5. **Admin portal scope** — what the built Administration surface may configure vs what stays operator-script-only.
6. **#15 sequencing** — trusted-writer work vs the Functions-deploy blocker.
7. **Legacy-role retirement criteria** — the bar for removing admin/dispatcher/technician as raw roles.
8. **Impersonation** — whether it is ever in scope (default: no).

---

## Inventory domain audit (verified facts — to be incorporated from Issue #226)

> **Pending.** Per the input gate, this Assessment is not finalized until **Inventory** posts its evidence-backed domain audit to Issue #226. Inventory's verified facts (Inventory/Reorder/PO/receiving authorization surfaces, `operationalRoles` eligibility enforcement points, client-direct-vs-Function writes, and audit collections) will be incorporated here **as stated**, without rewriting them into unsupported architectural conclusions.

## Scope honored

Single file: `docs/assessments/enterprise-access-and-administration-platform.md`. No `ROADMAP.md`/`SPRINT_STATUS.md`/`CLAUDE_CONTEXT.md`, capability/entity model, ADR, Specification, application code, Rules, index, or Function touched. **Draft — pending Inventory input, then Architecture Review.**
