# Project Architecture

Authoritative description of Taylor Parts / Field Ops's system design. If code and this document disagree, treat the disagreement as a bug in one of them and reconcile — don't silently pick one.

## Relationship to Product Governance

This document, and the `architecture/` ADRs, describe **how** the platform is built. They exist to satisfy the product decisions defined in `ProductVision.md`, `PlatformConstitution.md`, and `ProductBlueprint.md` — architecture follows product, not the other way around.

Concretely:

- **`ProductVision.md`** sets the platform's long-term scope and multi-tenant/configurable-platform principle; architecture decisions (data model, write paths, module boundaries) are expected to remain compatible with that scope, even when only a subset of it is built today.
- **`PlatformConstitution.md`** sets platform-wide principles (One Source of Truth, Business Domains, Role-Based Experiences, Configurable Platform, etc.); the system-of-record and single-write-path rules in this document are the architectural implementation of those principles, not a separate or competing set of rules.
- **`ProductBlueprint.md`** sets the approved business-domain navigation and business objects; when this document's module/collection boundaries diverge from that blueprint, treat it the same as any other doc/code disagreement above — reconcile, don't silently pick one.

Implementation must satisfy both sets of documents. Where they conflict, that conflict should be identified and resolved explicitly before writing code — see `CLAUDE_CONTEXT.md`'s "Product Authorities" section.

## Enterprise Platform Classification Model

Every architectural concept in this platform — existing or proposed — falls into exactly one of the five classifications below. This section defines the vocabulary only; it does not reclassify anything already described elsewhere in this document, and it does not duplicate the detailed models owned by `PlatformCapabilityModel.md` or `BusinessEntityModel.md` — it names how those two documents, and this one, relate to each other. Nothing in this section changes those documents' content.

### A. Platform Services

Reusable, horizontal services usable by any capability — owned by no single business domain. Examples: Authentication, Authorization, Notification & Work Routing, Audit, Search, Reporting, AI Decision Support, Integration.

**Platform Services and Business Capabilities are complementary architectural layers, not competing concepts.** Platform Services provide reusable technical functionality; Business Capabilities consume Platform Services to deliver business outcomes. The two can share a name without conflicting — e.g. Search is already both a shared technical component (`GlobalSearch.jsx`, per `GuidingPrinciples.md`'s "Search is a platform capability, not a per-domain feature") and, from the business side, a facet of several capabilities' workflows. Same relationship applies to Reporting (`PlatformCapabilityModel.md`'s Reporting & Analytics capability consumes a future shared reporting engine), AI Decision Support (that document's AI Platform capability, e.g. the Technician Recommendation Engine, consumes a future generalized AI service layer), and Integration (`IntegrationArchitecture.md`'s Integration Platform capability consumes the concrete export/import mechanism it defines). This section does not rename or modify any capability in `PlatformCapabilityModel.md` — it only names the service layer those capabilities draw on.

Naming a Platform Service here does not imply it is built; today, Authentication (Firebase Auth) and Authorization (role-based, `ROLE_NAV_ACCESS` + `firestore.rules`) and Search (`GlobalSearch.jsx`) are real; Notification & Work Routing, Audit, and a generalized Reporting/AI/Integration service layer are not.

#### Person Assignment Platform Service Standard

**Approved architecture, not yet implemented.** Assignment — the act of putting a person's identity on a workflow record (a Reorder Request's Parts Associate, a Work Order's technician, a future receiving/approval/task assignee) — is a reusable Platform Service pattern, not a domain-specific concern. Every present and future workflow requiring a person assignment must consume this one standard; no domain may introduce its own assignment identity pattern or feature-specific user-directory logic.

**Three-tier identity authority, kept structurally separate:**
- **Employee** (`employees/{employeeId}`) is the authoritative workforce/business identity — a person the business recognizes as personnel, whether or not they have application access. An Employee may exist without a linked User.
- **User** (`users/{uid}`) is the application-access identity — who can sign in and what they're authorized to do inside the app. Linked to an Employee where applicable via `employeeId`, but remains its own record; disabling a User's access must never delete the linked Employee or that Employee's historical assignment records.
- **Firebase Authentication** is the credential authority — it owns the authenticated UID and the sign-in mechanism only. It is a credential/session concern, not a business identity, and this platform's Employee model must not assume Firebase Authentication is a permanent choice: the Employee business identity must not carry vendor-specific authentication fields beyond a neutral access-link reference, so a future identity provider (Microsoft Entra ID, Okta, Google Workspace, SAML, or another OAuth provider) can be adopted without redesigning what an Employee *is*.

These three must never be merged into one entity. `firestore.rules` remains the security enforcement authority over all three — Employee/User authority separation is a data-modeling boundary, not a rules change in itself.

**Required assignment fields**, persisted on any workflow record that supports a person assignment:
`assignedToEmployeeId` (workforce identity), `assignedToUserId` (authenticated identity used by security-rule enforcement), `assignedToDisplayName` (immutable historical display snapshot, not an identity key), `assignedByEmployeeId` (workforce identity of the assigner), `assignedByUserId` (authenticated identity of the assigner), `assignedAt` (assignment timestamp).

**Eligibility vs. permissions:** operational roles (e.g. `PARTS_ASSOCIATE`, `TECHNICIAN`, `WAREHOUSE_ASSOCIATE`) determine who is *eligible* to be assigned to a given workflow; security roles (`admin`/`dispatcher`/`technician`, the existing model) continue to determine application permissions — navigation, reads, writes, Firestore authorization. These two role concepts are never merged, and an Employee's operational roles must never be treated as a replacement for the existing security role.

**No Firebase UID entry in user-facing workflows.** An end user must never be required to enter, remember, or paste a Firebase UID to make an assignment. Assignment interfaces select a person by recognizable identity (name, operational role, department/job title, relevant context) — the underlying `employeeId`/`userId` pair is resolved behind that selection, never typed in directly.

**Historical snapshot, not identity key.** `assignedToDisplayName` exists for audit/readability only — it is captured at assignment time and never used to re-resolve or re-validate identity later; `assignedToEmployeeId`/`assignedToUserId` remain the authoritative keys.

**Legacy compatibility.** Records written before this standard existed may carry only `assignedToUserId`/`assignedBy`/`assignedAt` (or an equivalent minimal shape). These remain valid and are not rewritten retroactively; display logic falls back through `assignedToDisplayName` → a resolved Employee `displayName` → the legacy `assignedToUserId` as a final technical fallback. A raw Firebase UID must never be the normal end-user assignment experience — it may surface only as that last-resort fallback for data that predates this standard.

**AI-assisted assignment compatibility (reserved, not in scope now).** This standard is designed so a future AI-assisted assignment capability can evaluate Employee attributes (operational roles, skills, certifications, availability, location, department, company, workload, eligibility) to *recommend* an assignee — humans remain the ones who approve and commit an assignment. No such scoring, recommendation, or attribute beyond `operationalRoles` is implemented today; this paragraph reserves the architectural shape, it does not schedule the feature.

### B. Business Capabilities

What the business can do, independent of screen or entity. Capability hierarchy, ownership, and maturity are owned entirely by `PlatformCapabilityModel.md` — not restated here. This document's role is only to say that "Business Capability" is one of the five classifications a new concept must be checked against, and that a capability delivers business outcomes by consuming Platform Services (Section A) rather than reimplementing them.

### C. Business Objects

Persistent enterprise records — Account, Contact, Location, Work Order, Part, Warehouse, Supplier, Purchase Order, etc. The entity model, relationships, and core-vs-future status are owned entirely by `BusinessEntityModel.md` — not restated here. Every concrete Business Object already described elsewhere in this document (Job, Technician, the Customer model's Account/Contact/Location) is an instance of this classification.

### D. Operational Workflow Objects

A Business Object (above) that a single capability owns as a record is not always the same thing as the *workflow* that record participates in. An Operational Workflow Object is one whose lifecycle spans multiple capabilities' boundaries over time.

> **Core Architecture Principle:** Workflow objects move through capabilities. Capability ownership does not move.

The Work Order (`fieldops_wos`) is this platform's clearest existing instance: Dispatch Management assigns and dispatches it, Technician Operations executes it, Inventory Management consumes Parts against it — the object travels through all three, but `functions/src/transitionEngine.ts` remains the sole lifecycle authority throughout, and no capability acquires ownership of another's slice of that lifecycle just because the object is currently in its queue. The same principle already governs the platform's existing "single write path" rules (System of record, below) — this section names the general principle those specific rules are instances of.

### E. Platform Events

Immutable business events representing facts that occurred within the platform — not the current state of a Business Object, and not the object itself, but a permanent record that something happened. Once recorded, a Platform Event is never edited or deleted; correcting a mistaken event means recording a new, later event, not altering history. Representative examples: Reorder Requested, Work Order Assigned, Shipment Received, Part Consumed, Equipment Installed. (Some of these name entities or capabilities that are Future/unbuilt today — e.g. Equipment — the same "named for model coherence, not scoped yet" convention `BusinessEntityModel.md` already uses; naming the event type here doesn't imply it's implemented.)

A Platform Event may trigger notifications, workflow transitions, audit records, reporting, integrations, or future AI capabilities — but it remains distinct from a Business Object. `inventory_transactions`' RESERVED/RELEASED/CONSUMED entries are this platform's clearest existing instance of Platform Events already in production: each is an immutable, append-only fact ("this quantity of this Part was consumed by this Work Order at this time"), never updated after being written, and Part's *current* stock position (a Business Object concern) is always derived by replaying them rather than stored directly — see `docs/architecture/ADR-003-inventory-trigger-system.md`. The Work Order Engine's execution timestamps (`dispatchedAt`, `acceptedAt`, etc.) are a related but distinct case: they capture the same kind of fact-in-time, but today as fields on the mutable Work Order record rather than as separate immutable event records — a future event-store design (see `IntegrationArchitecture.md`'s "Event-Driven Architecture Considerations" section) could formalize this further, but that is not proposed or required by this section.

### F. Enterprise Classification Gate

Before introducing any new module, service, entity, or governance concept, answer these six questions in order. This is a permanent architectural checklist, not a one-time exercise — it applies to every future addition, the same way `DEVELOPMENT_STANDARDS.md`'s Feature Lifecycle and `PlatformOperatingModel.md`'s Change Management section already gate new work through Product/Architecture Review.

1. **Is this a Platform Service?** — If yes, it must be usable by more than one capability; a "shared service" built for and consumed by only one capability is not actually one yet.
2. **Is this a Business Capability?** — If yes, it belongs in `PlatformCapabilityModel.md`'s hierarchy, with a stated maturity level — not introduced informally elsewhere.
3. **Is this a Business Object?** — If yes, it belongs in `BusinessEntityModel.md`'s entity model before any collection or schema is created for it.
4. **Is this an Operational Workflow Object?** — If yes, identify every capability its lifecycle will cross and confirm no single capability's write path is being asked to own another's slice of that lifecycle.
5. **Is this a Platform Event?** — If yes, confirm it will be recorded as an immutable fact, never edited or deleted after the fact, and kept distinct from whatever Business Object's current state it may inform.
6. **Is this extending an existing concept?** — If yes, extend the existing Platform Service, Capability, Business Object, or Event type rather than creating a parallel one; this is the same standing rule Rule 6 (`CLAUDE_CONTEXT.md`) already applies to write paths, generalized to all five classifications.

## System of record

- **Main (`field-ops-app-vite`) is the system of record.** Auth-gated (Firebase Auth required). Firestore is the source of truth for all operational data across every model described below.
- **As of Release 2.0, three distinct operational data models coexist on `main`, each with its own write path** — this section names them; `docs/architecture/SYSTEM_AUTHORITIES.md` is the authoritative per-concern ownership map and is not restated here:
  1. **Job / Technician (legacy, still real and in active use)** — `fieldops_jobs`/`fieldops_technicians`, client-direct-write via `domain/jobActions.js`, rules-enforced. Described in full below.
  2. **Work Order Engine** — `fieldops_wos`, Cloud-Function-only writes, its own 11-status lifecycle. See "Work Order Engine" below and `docs/architecture/ADR-002-work-order-engine.md`.
  3. **Customer model** — `accounts`/`contacts`/`locations` (Sprint 2.0.2), client-direct-write via `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`, rules-enforced, admin/dispatcher only. See "Customer model" below and `BusinessEntityModel.md`.

  Inventory (`inventory_transactions`, append-only ledger), Warehouse, and Procurement follow the same Cloud-Function-write pattern as the Work Order Engine — see `docs/architecture/ADR-003-inventory-trigger-system.md` and `SYSTEM_AUTHORITIES.md` for their specific write paths; not restated here.
- **`JOB_STATUS` is the canonical status enum for the Job/Technician model**: `OPEN → ASSIGNED → IN_PROGRESS → COMPLETE`. Defined once, in `field-ops-app-vite/src/domain/constants.js`. No duplicate or parallel status enum is permitted for this model anywhere in the repo. (The Work Order Engine has its own, separate 11-status `WorkOrderStatus` — a deliberate, scoped exception for a genuinely distinct entity, not a violation of this rule; see ADR-002's "Reasoning" section for why the two are not the same kind of duplication ADR-001 rejected.)
- **All Job state transitions go through the domain layer** (`field-ops-app-vite/src/domain/jobActions.js`):
  - `assignJob(job, technician)` — the only place `OPEN → ASSIGNED` happens. Transactional (`runTransaction`): re-checks technician availability inside the transaction so two dispatchers can't both win the same technician.
  - `updateJobStatus(job, nextStatus)` — handles `ASSIGNED → IN_PROGRESS` and `IN_PROGRESS → COMPLETE`. Also transactional as of Sprint 3.1: re-reads the job and re-validates `canTransitionJob()` inside the transaction, and commits the job + technician writes atomically (fixes a prior partial-write bug where a job could end up `COMPLETE` while its technician stayed stuck at `ON_JOB`).
  - No UI component writes Job/Technician state to Firestore directly. Every write path goes through one of the two functions above.

## Control Tower: read-only intelligence layer

- Control Tower (`field-ops-app-vite/src/modules/controlTower/`) computes **derived-only** operational signals. It **never** mutates Firestore, job state, technician state, or Work Order state.
- Two distinct data sources feed different parts of Control Tower — don't conflate them: the Signal-scoring panels (`AtRiskPanel`/`DispatchQueuePanel`/`OverloadedTechPanel`) still derive their signals by aggregating Jobs by `workOrderId` (the legacy Job/Technician model above); `WorkOrderDetail.jsx`, separately, reads a real `fieldops_wos` document (the Work Order Engine below). Both are real and in use; neither replaces the other yet.
- As of Sprint 3.3, every scoring module (`domain/workOrderScoring.js`, `domain/dispatchScoring.js`, `domain/jobRiskScoring.js`) returns a canonical **Signal** shape, defined in `domain/controlTower/types.js`:
  ```
  { id, score, severity, label, metadata }
  ```
  `severity` is one of `LOW | MEDIUM | HIGH | CRITICAL`. This is the one schema every panel renders against — panels never recompute score/severity themselves.
- Control Tower's UI is **panelized** (Sprint 3.3.4): `ControlTower.jsx` is the composition root (owns the Firestore listeners), and `modules/controlTower/panels/{AtRiskPanel,DispatchQueuePanel,OverloadedTechPanel}.jsx` are pure renderers. Enforced invariants (`domain/controlTower/types.js`'s `assertPanelProps`/`assertValidSignal`, dev-only):
  1. Every panel receives exactly `{ jobs, technicians, workOrders }` — no other prop shape.
  2. No panel calls `useFirestoreCollection` or imports `firebase/*` directly.
  3. No panel inlines scoring/derivation logic — panels call `domain/*.js` and render the result.
  4. Every signal a panel renders conforms to the canonical Signal shape.

## Work Order Engine

- **`fieldops_wos` is a real, persisted Firestore collection** — the Work Order Engine (Epic 1, merged to `main`) replaced the earlier derived/aggregate model entirely for new consumers. Full design and reasoning: `docs/architecture/ADR-002-work-order-engine.md`; per-concern write/read ownership: `SYSTEM_AUTHORITIES.md` (not restated here).
- Its own 11-value `WorkOrderStatus` lifecycle (`CREATED → READY_TO_DISPATCH → SCHEDULED → DISPATCHED → ACCEPTED → EN_ROUTE → ARRIVED → WORK_IN_PROGRESS → COMPLETED → CLOSED`, plus `CANCELLED`) is defined canonically in `functions/src/transitionEngine.ts`, mirrored client-side in `domain/workOrderWorkflow.js`.
- **All `fieldops_wos`/`counters` writes go through exactly two Cloud Functions**: `createWorkOrder()` and `transitionWorkOrder()`. `firestore.rules` denies all direct client writes to both collections unconditionally — no admin/dispatcher exception of any kind.
- **Job↔Work Order relationship is soft-coupled**: `job.workOrderId` is an optional, unenforced reference to a `fieldops_wos` doc ID. No referential integrity, no cascade. `domain/jobActions.js`, `JOB_STATUS`, `Dispatch.jsx`, and `FieldMode.jsx` are untouched by the Work Order Engine.
- `domain/workOrderLifecycle.js` (the pre-Epic-1 Job-grouping aggregate described in earlier revisions of this document) is **deprecated, not deleted** — frozen, with exactly one remaining consumer (`domain/timelineBuilder.js`). No new consumer may call it; new consumers read real `fieldops_wos` docs instead.

## Customer model (Account / Contact / Location)

- **`accounts`/`contacts`/`locations` are real, persisted Firestore collections** (Sprint 2.0.2, merged to `main`) — client-direct-write via `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`, rules-enforced, admin/dispatcher only (no technician read access). Full entity model, relationships, and the internal-`accounts`/UI-"Customers" naming convention: `BusinessEntityModel.md` (not restated here).
- `WorkOrder.customerId` (on `fieldops_wos`) may point to an `accounts` document's ID — the field is not renamed to `accountId`; this is a deliberate, permanent naming mismatch (see `BusinessEntityModel.md`'s "Naming recommendation" section).

## Known schema limitation: no lifecycle timestamps (Job/Technician model only)

The **legacy Job/Technician schema** only writes `createdAt` (once, at document creation, via `collectionStore.add()`). There is **no `assignedAt`/`startedAt`** per status transition. Every age/recency/risk signal derived in `dispatchScoring.js` and `jobRiskScoring.js` is therefore an **approximation** based on time-since-creation, not precise operational timing. This is documented inline in both files and flagged in the UI (`(approx.)` labels). Fixing this properly requires a schema change to `assignJob()`/`updateJobStatus()`, deliberately deferred — see `FUTURE_ARCHITECTURE_BACKLOG.md`.

**This limitation does not apply to the Work Order Engine**, which persists real execution timestamps (`dispatchedAt`, `acceptedAt`, `enRouteAt`, `arrivedAt`, `workStartedAt`, `completedAt`, `closedAt`) as a deliberate design choice made specifically because Job never tracked this information — see ADR-002's "Reasoning" section.

## Legacy app (removed)

An earlier, non-Vite `field-ops-app/` existed in parallel with `field-ops-app-vite/` due to a mis-scoped Sprint 2 pass that touched both apps. It was confirmed unreferenced by any deploy workflow, build script, or doc, and removed in commit `43fcf3e` (PR #3). Do not recreate a parallel app structure.

## Forbidden patterns (non-negotiable)

- No duplicate `JOB_STATUS` (or equivalent) enum for the Job/Technician model.
- No direct Firestore writes from UI components, for any of the three models above — Job/Technician writes go only through `domain/jobActions.js`; Work Order writes go only through `createWorkOrder()`/`transitionWorkOrder()`; Customer-model writes go only through `domain/accounts.js`/`domain/locations.js`/`domain/contacts.js`.
- No dispatch/assignment logic outside `assignJob()`/`updateJobStatus()`.
- No second Work Order lifecycle competing with `functions/src/transitionEngine.ts`, and no new consumer of the deprecated `domain/workOrderLifecycle.js`.
- No second Control Tower implementation.
- No inline scoring logic in Control Tower panels.
