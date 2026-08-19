# ADR-012 — Persona, Authority Composition & Scope Architecture

Status: Accepted (Owner-approved architecture direction for Issue #226)
Phase: Enterprise Access & Administration — Architecture (governance chain: Assessment → **ADR** → Specification → Implementation Plan → foundation → Admin portal → domain-by-domain migration → legacy-role retirement)
Depends on:

- [`ADR-005`](ADR-005-enterprise-authorization-migration-strategy.md) — the Hybrid Compatibility Model decision this ADR extends
- [`../assessments/enterprise-access-and-administration-platform.md`](../assessments/enterprise-access-and-administration-platform.md) — the merged #226 Assessment
- [`../assessments/r1-authorization-convergence-readiness.md`](../assessments/r1-authorization-convergence-readiness.md) and [`../assessments/r1-permission-coverage-design.md`](../assessments/r1-permission-coverage-design.md) — R-1, **referenced, not restated or superseded**
- Issue #226 (tracking), Issue #140 (tenant/company model — **authority, not resolved here**), Issue #100 (operational-role linkage — preserved), Issue #175 (governed-field enforcement — preserved)

**Design-stage only. Docs-only. Merging this ADR authorizes NO implementation.** No collection, Rule, Cloud Function, claim, index, route, grant, revoke, deployment or production-data change is authorized. Each later stage is its own separately-authorized Owner gate.

Relationship to prior ADRs: **purely additive**, following ADR-005's own precedent. ADR-005's decisions — Hybrid Compatibility Model, compact claims + `accessVersion`, Rules-and-trusted-Functions enforcement, approval principles, legacy-role retirement criteria, impersonation deferral — remain intact and unmodified. This ADR sharpens the *object model* ADR-005 reserved, and records the Owner's UX direction for the Administration surface.

**R-1 is not re-decided here.** R-1 governs authorization convergence and permission coverage on its own track; this ADR references its conclusions and must not be used to bypass or duplicate them.

---

## 1. Context

ADR-005 chose the migration strategy and reserved a Scope seam without fixing the shape of the objects. Two things have since forced that shape into the open:

1. **Persona work.** The sandbox persona programme produced a persona matrix and a growing family of business personas (Owner, Administrator, Service Manager, Dispatcher, Technician, Parts Room Manager, Warehouse Manager, Purchasing, Sales, Finance…). Without an explicit rule, each persona tends to become a security role — the classic role-explosion failure.
2. **Record-level scope.** `isAssignedToWarehouse()` is the platform's only proven record-level authorization scope ([`../assessments/warehouse-manager-scoped-access.md`](../assessments/warehouse-manager-scoped-access.md)). It works, but it is warehouse-specific. Copying that shape per domain would produce a dozen incompatible scoping mechanisms.

## 2. Decision

### 2.1 The authority chain

The governed authorization model resolves in this order:

```
PRINCIPAL
  → MEMBERSHIP
    → ROLE / AUTHORITY PACKAGE ASSIGNMENT
      → CAPABILITY / PERMISSION
        → SCOPE
          → POLICY / RESOURCE CONTEXT
            → EFFECTIVE ACCESS
```

### 2.2 Concept separations (the core of this ADR)

Each concept answers exactly one question and must not absorb another's:

| Concept | Answers | Is it authorization? |
|---|---|---|
| **Persona** | *how a person works* | **No.** May influence UX, navigation, workflow defaults, sandbox identity and *suggested* authority composition. Never an authorization decision. |
| **Operational Role** | *what work someone is eligible/responsible for* | **No.** Work eligibility only — preserving Issue #100 and the #226 Assessment §2 distinction. |
| **Role / Authority Package** | *a reusable bundle of authority* | Packaging. Additive and composable. |
| **Capability / Permission** | **WHAT** may be done | Yes — the unit of authority. |
| **Scope** | **WHERE / TO WHAT** it applies | Yes — the boundary of that authority. |
| **Policy / Condition** | contextual conditions: status, assignment, workflow state, resource relationship | Yes — evaluated at decision time. |
| **Effective Access** | the derived result | **Derived only.** |
| **Membership** | which Business a Principal belongs to | The future authority boundary for multi-business operation. |
| **Agent** | a bounded Principal/delegate | Bounded. Never a superuser. |

Three rules follow, and they are the ones most likely to be violated under delivery pressure:

- **A persona must never automatically become a security role.** Authority is composed from Capabilities and Scopes; a persona may *suggest* a composition, never *be* one.
- **Effective Access must never become an independently writable source of authority.** It is derived, cacheable and explainable — never an input.
- **Agent authority ≤ Persona authority.** An agent representing a persona never exceeds what that persona holds, and never receives Admin-SDK bypass because it is "the system".

### 2.2a "Active" vocabulary

*Added 2026-08-18, feat/active-vocabulary (Owner ruling on an "Active" naming sweep). Not a rename of any repository concept — a naming-discipline record for a word already in heavy use across `functions/src` and `field-ops-app-vite/src`.*

The word "active" (in identifiers, enum values, comments, and — most importantly — user-facing labels) covers **four distinct, legitimate concepts** in this codebase. A screen or a code comment that says bare "Active" without naming which one it means is ambiguous whenever two senses could plausibly apply on the same surface or to the same entity (e.g. a technician's Work Order count on two different screens).

| # | Concept | Answers | Canonical definition |
|---|---|---|---|
| 1 | **Employee active** | Is this Employee currently eligible for operational assignment? | `EMPLOYMENT_STATUS.ACTIVE` — `field-ops-app-vite/src/domain/constants.js`; mirrored server-side by `employmentStatus === "ACTIVE"` checks (e.g. `functions/src/access/operationalRoleContext.ts`, firestore.rules `isActiveOperationalRole`) |
| 2 | **Role assignment active** | Is this Role→Principal binding currently included in effective-access resolution? | `RoleAssignmentStatus` (`"active" \| "disabled"`) — `functions/src/types/access.ts` |
| 3 | **Capability active** | Is this Permission/capability enabled in this environment? | `Permission.active?: boolean` — `functions/src/types/access.ts`; per-environment overrides in `functions/src/access/environmentCapabilityOverrides.ts` |
| 4 | **Record active** | Is this generic master-data record available for current business use (not deleted or retired)? | the recurring `status: "ACTIVE" \| "INACTIVE"` / `isActive` pattern on Warehouse, Supplier, Equipment, Part, Truck, and similar registries (e.g. `WAREHOUSE_STATUS_META` in `field-ops-app-vite/src/domain/warehousesView.js`) |

**A fifth sense exists and is explicitly NOT one of the four canonical concepts above**: a Work Order being "in progress." This sense is inconsistently scoped across the app today — the Work Orders list's tab (`field-ops-app-vite/src/modules/workOrders/WorkOrdersList.jsx`) counts a 5-status bucket, the Dispatcher Board's Technician Capacity Card (`field-ops-app-vite/src/modules/dispatcherBoard/TechnicianCapacityCard.jsx`) counts a 1-status (`WORK_IN_PROGRESS`-only) bucket, and the Operations Execution Insights panel (`field-ops-app-vite/src/modules/operations/panels/ExecutionInsightsPanel.jsx`) counts an 8-status (all-non-terminal) bucket. **Reconciling which bucket definition is "correct" is a separate, already-reported workstream and out of scope here** — this ADR only records that the labels must say which bucket they mean (e.g. "In Progress," "Dispatched+," "Open Work Orders"), not bare "Active."

**Rule of thumb — when is a bare "Active" label safe?** It is safe only when the surrounding page/section title already pins the record type unambiguously and no second "active" sense could apply to the same rendered number on another screen a user is likely to compare against (e.g. a "Warehouses" list's "Active" filter chip is fine; a technician-scoped count that could be read two different ways on two different screens is not). When in doubt, name the concept: "Active Employees," "In Progress," "Enabled," etc.

**Test coverage.** `field-ops-app-vite/test/activeLabelConformance.test.jsx` enforces this going forward using the same allowlist-burn-down pattern as `compositionConformance.test.jsx`'s `LEGACY_BADGE_ALLOWLIST` — any new bare, unqualified "Active" JSX text/label outside the allowlist fails the build.

### 2.3 Scope is a first-class, generalized concept

Authorization must **not** be hard-coded to a single hierarchy such as Business Unit.

Conceptual form: **`scopeType` + `scopeId`**.

- **Capability** answers *what may be done*.
- **Scope** answers *where / to what*.
- **Resource context** answers *whether the current resource falls within that scope*.

Anticipated scope types (illustrative, not a committed enum): Business · Business Unit · Region · Location · Department · Team · Warehouse · Service Territory · Account Portfolio · Assigned Work Orders · Assigned Truck · a specific governed Resource · future module-specific types.

**Warehouse assignment is the strongest currently proven example** and is the evidence this generalization rests on — but the warehouse-specific implementation must **not** be copied blindly into other domains. The target is one `Scope`/`ScopeBinding` abstraction that warehouse assignment becomes an instance of.

**Tenancy is not implemented here.** ADR-005 §2.2 reserved the seam and left **Issue #140** (or its successor) as the authority for the actual tenant/company model. That is unchanged: Membership is recorded as the future boundary, not activated.

### 2.4 Administration UX direction

Take the best ideas from Salesforce and Microsoft Dynamics; copy neither literally.

- **Salesforce-influenced** — understandable user administration; Permission Set / Permission Set Group style composition; additive reusable authority; easy assignment of packages and additional permissions.
- **Dynamics-influenced** — explicit organizational/record scope; user / team / business-unit style scoped access; strong awareness of *where* authority applies.
- **Enterprise Operations OS differentiation** — modular; configurable; provider-neutral; a **generalized** Scope abstraction rather than one fixed hierarchy; transparent Effective Access; a clear *"why does this user have access?"* explanation; a future **Test Access** experience; strong audit trail.

**Proposed UX vocabulary — deliberately recorded separately from internal/domain naming.** These are candidate user-facing labels only. **No repository concept is renamed by this ADR**, and governed terminology already in use stays authoritative until a Specification says otherwise.

| Proposed UX label | Governed concept it presents | Repository status today |
|---|---|---|
| User / Employee | Principal, `users/{uid}` ↔ `employees/{employeeId}` | exists |
| Persona | persona (non-authoritative) | sandbox persona matrix only |
| Business Membership | Membership | **future** — Issue #140 |
| Authority Packages | Role / Authority Package | Role objects proposed in #226 Assessment §3 |
| Additional Permissions | directly-assigned Capabilities | proposed |
| Operational Roles | `employees.operationalRoles` | exists (Issue #100) |
| Teams | a Scope type | **future** |
| Scope | Scope / ScopeBinding | only `isAssignedToWarehouse()` proven |
| Effective Access | derived resolution | `resolveEffectivePermission` exists |
| Audit History | Audit Event | per-domain today, not unified |

### 2.5 Persona classification

Personas are assessed, not manufactured into permissions. Families under consideration: **Platform/Management** (Owner, Administrator) · **Service** (Service Manager, Dispatcher, Technician, Senior Technician / Field Supervisor) · **Inventory/Parts** (Parts Room Manager, Parts Associate, Warehouse Manager, Catalog Administrator, Purchasing Operator, Purchasing Manager) · **Sales** (Retail Sales, National Sales, VP Sales, Retail Account Manager, National Account Manager) · **Finance** (Finance Manager, Accounting; AR/AP specialties only when justified).

- **Do not manufacture permissions merely because a persona exists.** This restates R-1's governing constraint — *do not create permissions merely to obtain numerical coverage* — at the persona layer.
- **Sales, Finance and Accounting remain honestly FUTURE / MISSING CAPABILITY** wherever the repository does not yet support governed authority. This matches the recorded permission-catalog gap in [`../assessments/r1-permission-coverage-design.md`](../assessments/r1-permission-coverage-design.md) and `governedBusinessRoles.ts`'s own note that accounting-operations ids do not exist.
- Every implemented persona must eventually prove **ALLOW**, **DENY**, and **WRONG-SCOPE DENY**.

### 2.6 Sequencing

**Phase 1 — Native Authority Foundation.** Principal/User · Employee · Persona · Operational Role · Business Membership foundation · Role/Authority Package · Capability/Permission · Scope · Policy/Conditions · Effective Access · Audit · `accessVersion`/revocation · Firestore Rules alignment · trusted-command enforcement · Admin UX · sandbox personas · ALLOW/DENY/scope tests.

**Phase 2 — Native Module Adoption.** The same foundation applied across Service · Field · Dispatch · Inventory · Warehouse · Purchasing · Sales · Finance · Accounting · future modules. A module may contribute capabilities, optional authority packages, personas, governed scope types, workflows, navigation and audit events.

**No module may create its own competing authorization system.**

Phase 3 and beyond (external integration, implementation intelligence) are **explicitly out of scope for #226** — see [`../IntegrationArchitecture.md`](../IntegrationArchitecture.md) §16a and issue #641 recorded there.

## 3. Reasoning

The separations are not bureaucratic. Each collapse has a known failure mode: persona-as-role produces role explosion and unreviewable grants; operational-role-as-authority silently converts work eligibility into security (the exact risk Issue #100 was written to avoid); writable Effective Access creates an authority that no policy governs; a single hard-coded hierarchy forces every future scope to be bolted on; an unbounded agent turns automation into privilege escalation.

Generalizing Scope now — while `isAssignedToWarehouse()` is the *only* record-level scope — is the cheapest moment to do it. Every additional domain-specific scope written first makes the generalization harder.

## 4. Consequences

- The #226 Specification must define Capability, Scope and Policy as distinct objects, with Effective Access derived and non-writable.
- Persona work may proceed on UX, navigation and sandbox identity **without** creating permissions.
- Scope design must be general from the outset; warehouse assignment becomes an instance, not the template.
- Membership is designed-for but not activated; Issue #140 keeps that authority.
- The Admin UX has a recorded direction and a candidate vocabulary that does not bind internal naming.
- R-1 continues on its own track and is not bypassed.

## 5. Governance & scope honored

Docs-only. No collection, Scope engine, Membership tenancy, Rules change, Cloud Function change, claim change, grant/revoke, production-user change, deployment or infrastructure change. No competing authorization migration is created: ADR-005 remains the migration strategy and R-1 remains the convergence authority.
