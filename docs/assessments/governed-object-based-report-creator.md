---
artifact_type: assessment
gate: Repository Assessment
status: Accepted (merged; superseded by the governing ADR-007 + Specification)
date: 2026-07-16
updated: "2026-07-16 (metadata: recorded review/merge state and the governing ADR/Specification)"
owner: Claude Code
related_adrs: [docs/architecture/ADR-007-governed-object-based-report-creator.md]
depends_on: [docs/PROJECT_ARCHITECTURE.md, docs/architecture/SYSTEM_AUTHORITIES.md, docs/specifications/enterprise-access-and-administration-platform.md, docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
related_specs: [docs/specifications/governed-object-based-report-creator.md]
implements: []
supersedes: []
superseded_by: []
related_pr: [330, 331, 333]
related_issue: 325
target_release: TBD
---

# Assessment: Governed Object-Based Report Creator (#325)

> **Governance status (metadata update, 2026-07-16).** This Assessment was reviewed and merged (PR #330). Its downstream stages are now merged and are the authoritative design going forward:
> - **Architecture:** `docs/architecture/ADR-007-governed-object-based-report-creator.md` (PR #331, Architecture/Security-reviewed) — selects the trusted field-projecting report architecture this Assessment's field-level finding pointed to.
> - **Specification:** `docs/specifications/governed-object-based-report-creator.md` (PR #333, Architecture/Security-reviewed) — the object/field/relationship catalogs, field-level read authorization contract, query/validation, saved reports, sharing/scheduling, export, audit, limits, states, and staged activation.
>
> This Assessment's body below is preserved as the current-state record it was at merge; where it and the ADR/Specification differ on design, **the ADR and Specification govern.** Issue #325 remains OPEN for the Implementation Plan and per-wave activation stages.

**Status: Merged (current-state record; superseded on design by ADR-007 + the Specification).** This is the **current-state / data-availability Assessment** and stage 1 of Issue #325's own governance sequence. It inventories what "Reporting" is today, which governed business objects and fields exist and how they are authorized, and defines the authorization, sharing, export, audit, and saved-report **boundaries** a future report creator must satisfy. It names the gaps between what #325 requires and what the platform provides today.

**This is a documentation-only Assessment and authorizes nothing.** It changes no application code, no Firestore Rules, no indexes, no Functions; it deploys nothing; it accesses no production data; it edits no global/status document. It does not begin architecture (stage 3), specification, or implementation. Issue #325 stays open. Every design decision named here is deferred to the Owner and to the later ADR/Specification stages that #325 itself sequences.

Salesforce's object-based report builder is cited by #325 as a **product-design reference, not an architecture or implementation authority**; this Assessment treats it the same way.

---

## 1. Current-state audit (evidence)

**There is no report creator, and no report-building surface of any kind, today.**

- The `Reporting` navigation area exists as a labelled section with eight sub-areas — Executive, Service, Inventory, Purchasing, Warehouse, Employees, Customers, Financial (`src/navigation/navConfig.js`, the `reporting` entry). **Every one of them renders `PlaceholderPage`.** None of the eight sub-nav items carries a `legacyKey` or a special-case branch in `renderSubnavItem` (`src/App.jsx`), so each falls through to that function's generic final `return <PlaceholderPage title={item.label} />`. (This is a *different* mechanism from the `future: true` domains — only `salesCrm` and `financials` are `future` and routed to PlaceholderPage by that filter; `reporting` is not marked `future` and reaches the same placeholder by having no wired component.) No sub-area reads data, builds a query, or renders a report.
- The closest existing analytical surfaces are the **Operations dashboard** (`src/modules/operations/Operations.jsx` + its four panels) and its supporting services (`src/analytics/operationsIntelligenceService.ts`, `executionAnalyticsService.ts`, `src/services/operationsQueries.ts`). These are **fixed, hand-built panels** over specific queries — not a user-driven, object-first, field-selecting report builder. They are prior art for *how the app aggregates data*, not for #325's capability.
- **There is no CSV (or any) export/download capability anywhere in the app.** `contactCsvImport` is import-only. A repository-wide search for `createObjectURL` / download / blob / `toCsv` finds no export path. #325's "export reports as CSV" is a net-new capability with no precedent to extend.

**Conclusion:** #325 is a greenfield capability. Nothing about the current Reporting nav constrains it, and nothing existing can be incrementally grown into it without the authorization foundation described below.

## 2. The governed business objects that exist today

#325's named object set maps to these Firestore collections (`src/domain/constants.js`):

| #325 object | Collection | Notes |
|---|---|---|
| Customer / Account | `accounts` | Has governed commercial fields (paymentTerms, taxStatus) |
| Contact | `contacts` | |
| Location | `locations` | |
| Equipment | `equipment` | Governed: accountId, locationId, createdAt |
| Work Order | `fieldops_wos` | Technician self-scope in Rules |
| Reorder Request | `reorder_requests` | Inventory lifecycle |
| Purchase Order | `reorder_purchase_orders` | + `reorder_purchase_order_voids` |
| Employee | `employees` | Sensitive; distinct from `users` |

Two named objects are **not** plain Firestore collections and need an explicit Owner decision before inclusion:

- **Inventory Part** is a **static catalog** (`src/data/partsCatalog.ts`), not a governed Firestore collection. A report "object" over it means something different from a report over a live collection.
- **Invoice does not exist.** Only `INVOICE_DELIVERY_METHOD` (a field on `accounts`) is present. #325 itself lists Invoice as a "future object". A report creator cannot include it until the object exists.

There is **no machine-readable field catalog** for any object today. Fields are implicit in the domain modules and the Rules; a report creator's per-object "field catalog with labels, data types, descriptions, and supported operations" (#325) does not exist and would have to be authored as new governed metadata with stable business-object/field identifiers (#325's own boundary: "stable business-object and field identifiers rather than page/component names").

## 3. The authorization model that exists today (#226 / ADR-005), and the field-level gap

The Enterprise Access & Administration platform (Issue #226) provides the authorization primitives (`src/access/`, `src/types/access.ts`):

- **Permissions are `resource + action`** — e.g. `account.record.read`, `account.record.update` (`src/access/permissionCatalog.ts`; id format `"<domain>.<resource>.<action>"`). The granularity is the **record**, not the field.
- **Scope types** are `global | tenant | domain | location | ownAssignment` (`src/types/access.ts`). `tenant` is explicitly **"reserved and inert until Issue #140 defines it; it must never widen access."**
- **Conditions** are declarative predicates (`statusEquals`, `isOwnAssignment`, `employmentActive`, …) — never arbitrary code, fail-closed on unknown kinds.
- **Trusted-writer commands and an audit writer** exist server-side (`functions/src/access/trustedWriterCommands.ts`, `auditEventWriter.ts`), but are **not deployed** — activation is gated on Issue #15 (Functions deployment) and a separate Owner production authorization.

> **The single most important finding of this Assessment: there is no field-level authorization anywhere in the platform today.**
>
> - The #226 permission model has no field-level **read** concept. `account.record.read` grants the whole record. The nearest existing field-scoped capability is `account.governedField.write` (`src/access/permissionCatalog.ts`) — a field-*group* **write** capability over an Account's governed commercial fields (paymentTerms/taxStatus) — which is precisely the point: the one field-scoped permission the model has is about *writing*, and there is no read analogue for any object.
> - The per-object `GOVERNED_*_FIELDS` lists (e.g. `GOVERNED_EQUIPMENT_FIELDS`, `src/domain/equipment.js`) are likewise **write** governance — which fields an *ordinary edit may change* — enforced by Firestore Rules on `update`. They say nothing about which fields a caller may **read**.
> - **Firestore Rules are per-document all-or-nothing on read.** A Rule can allow or deny reading a document; it cannot return a document with some fields removed. So the client-direct read path *structurally cannot* satisfy #325's core requirement: *"A field absent from the user's effective permission set must never be returned by the backend, not merely hidden in the UI."*

This is not a UI problem. Meeting #325's field-level guarantee **requires a trusted backend** (a Cloud Function / server projection) that reads the document with Admin privileges and returns only the fields the caller's effective **field-level** permission set authorizes — because neither Rules nor client SDK reads can project fields per-caller. That backend, and the field-level permission model it needs, **do not exist yet** and are the foundation the later stages must design. It also means #325 depends on the Issue #15 Functions lane that Inventory currently owns.

## 4. Boundaries the report creator must satisfy (the Owner asked these be defined)

These are **requirements/constraints**, not designs. The designs belong to the ADR/Spec stages.

### 4.1 Authorization
- **Field-level read authorization is mandatory and backend-enforced.** Every field a report can select, filter, group, or aggregate on must be gated by an explicit capability in the caller's effective permission set, evaluated **server-side**, so an unauthorized field is never returned (not hidden). Governed/financial/cost/margin/employee/audit fields each require their own explicit capability, never a blanket "read the object".
- **Every execution re-evaluates current permissions and Scope.** A report is a *definition*, not a cached result set; running it resolves the runner's live permissions and Scope at execution time. An access-version change must invalidate any stale authorization — the #226 model already carries accessVersion semantics (`accessVersionAtGrant` on a RoleAssignment, `accessVersionAfter` in audit records, `src/types/access.ts`), which the execution path can compare against at run time.
- **Relationship traversal only through explicitly governed relationships** (Account→Location→Equipment, Work Order→Equipment, etc.) — never an arbitrary collection join, and never a path that widens field visibility beyond what the traversed object's own permissions allow.
- **No client-direct path around Rules or the trusted boundary.** The report execution path is server-mediated for the same reason field projection is.

### 4.2 Saved report definitions (the privilege-escalation boundary)
- A saved definition **must not become a privilege-escalation path**. A report authored by a high-privileged user, then opened / shared / scheduled / exported by a lower-privileged user, must return **only what the *runner* is authorized to see at run time** — the definition never carries its author's privileges.
- A saved definition is itself a governed object: who may create, read, rename, duplicate, share, schedule, and delete one are **separate capabilities**, and the definition must store **stable object/field identifiers**, not resolved data and not component names.

### 4.3 Sharing
- Sharing a report shares the **definition**, never a result set with embedded privileged data. A shared report re-executes under the recipient's permissions and Scope. Cross-tenant sharing is bounded by #140's tenant Scope, which is inert today (§3).

### 4.4 Export
- Export (CSV first) is a **separately governed capability**, distinct from viewing a report — a user may be allowed to see a report on screen but not to export it. Export re-evaluates permissions at export time and is subject to the same field-level projection and row limits. There is no export code today to reuse (§1), so this is net-new and must be built on the trusted path, not a client-side blob of a client-read result.

### 4.5 Audit
- Report **creation, sharing, scheduling, and export are auditable**, with immutable evidence. Note the current state precisely: there is exactly **one audit-write path**, the Enterprise Access audit writer (`functions/src/access/auditEventWriter.ts`), and it is **undeployed** (Issue #15 gate). The domain "event" model (`src/domain/eventModel.js` / `eventTypes.js`) is **not** an audit log — it is a read-time *operational timeline* synthesized on read (`domain/timelineBuilder.js`, Sprint 3.5), and it persists nothing. So report-action auditing has no immediately-available surface: it must be built on the Enterprise Access audit path once #15 ships, not on the operational timeline. **Confirming that this is the audit home for report actions is an Owner decision** (§6).

### 4.6 States, accessibility, responsiveness
- Distinct empty / loading / permission-denied / unsupported-field states, with safe copy that never leaks a raw Firestore code, path, id, or a field the caller may not know exists.
- Keyboard-first builder and responsive layout, consistent with the platform's existing shared UI conventions.

## 5. Dependencies and sequencing

- **Issue #226 / ADR-005 (Enterprise Access)** is the authorization foundation — but it needs a **field-level extension** that does not exist today (§3). This is the largest prerequisite.
- **Issue #15 (Functions deployment)** — the field-projecting execution/export backend is a trusted Function; it cannot be activated until #15's Functions lane is deployed and verified. That lane is currently Inventory-owned; #325 must not fork it.
- **Issue #140 (tenant Scope)** — cross-tenant report isolation and sharing depend on a defined `tenant` Scope, which is reserved-inert today.
- **Invoice object** — does not exist; blocks any Invoice report until built.

## 6. Explicit Owner decisions required (for stages 2–4)

1. **Supported object set for the first release** — #325's acceptance direction says "a deliberately small approved object set". Which objects? (Recommend starting from already-well-governed read surfaces: Customer, Contact, Location, Equipment.)
2. **Inventory Part** — is a report "object" over the static `partsCatalog` in scope, or deferred until Parts are a governed collection?
3. **Relationship depth** — which governed traversals are allowed, and to what depth.
4. **Sensitive-field policy** — the explicit capability list for governed/financial/cost/margin/employee/audit fields, and whether any object is excluded from reporting entirely at first.
5. **Field-level authorization model** — how #226 is extended to fields for **read** (a per-field capability? a field-set on the read permission?). The nearest existing precedent to build from is `account.governedField.write` (§3) — a field-group *write* capability; a read analogue is what's missing. Foundational; blocks everything.
6. **Audit home for report actions** — confirm the Enterprise Access audit-write path (the only one that persists audit records) is where report create/share/schedule/export events land, and accept that this makes report-action auditing dependent on the Issue #15 deployment gate (the operational timeline in `domain/eventModel.js` is not an audit log and cannot serve this).
7. **Sharing / scheduling / export policy** — capabilities, formats (CSV first), row/execution limits, and tenant-Scope interaction (#140).
8. **Saved-definition governance** — create/read/rename/duplicate/share/schedule/delete capabilities and the re-evaluation-at-run contract.

## 7. Risks

- **Field leakage is the dominant risk.** Any design that reads whole documents client-side and hides fields in the UI violates #325's core requirement and is a data-exposure defect, not a cosmetic one. The Assessment's position is that field-level enforcement is **backend-only** by construction (Firestore Rules cannot project fields).
- **Saved-definition privilege escalation** — a definition that runs with author privileges, or caches privileged results, is an escalation path. Re-evaluation-at-run is mandatory.
- **Generic query-engine scope creep** — #325 explicitly forbids "a generic query engine that exposes raw Firestore schema or arbitrary fields". The governed object/field catalog is the guardrail; without it, the feature drifts into an unsafe raw-query tool.
- **Cross-lane collision** — the execution/export backend lives in the Functions lane (#15) Inventory owns. Building it must be sequenced with that lane, not forked.

## Scope honored

Documentation only. This Assessment authorizes and changes nothing: no application code, Firestore Rules, indexes, Functions, deployment, production query, export, or production-data access. It does not edit any global/status document. It records the current state and the boundaries #325 must satisfy; the Owner-decision list above, the Architecture ADR, the Specification, the Implementation Plan, and the independent security/privacy/performance review remain the separate, later stages that Issue #325 sequences. **#325 stays open.**
