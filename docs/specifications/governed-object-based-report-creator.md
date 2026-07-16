---
artifact_type: specification
gate: Specification
status: Draft
date: 2026-07-16
owner: Claude Code
related_adrs: [docs/architecture/ADR-007-governed-object-based-report-creator.md]
depends_on: [docs/assessments/governed-object-based-report-creator.md, docs/architecture/ADR-007-governed-object-based-report-creator.md, docs/specifications/enterprise-access-and-administration-platform.md, docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 325
target_release: TBD
---

# Specification: Governed Object-Based Report Creator (#325)

**Status: DRAFT (pending Architecture/Security Review).** This Specification implements **ADR-007** (merged). It defines the object / field / relationship catalogs, the field-level read authorization contract, query definition and validation, saved reports, sharing and scheduling, export controls, immutable auditing, execution limits, error/accessibility states, staged activation and rollback boundaries, and a proposed implementation sequence — for a single reusable, trusted, field-projecting report engine spanning **every existing governed business object**.

**This is a documentation-only Specification and authorizes nothing.** It builds no Function, Rule, index, collection, schema, permission-engine change, route, UI, deployment, export, or production query. It does not begin the Implementation Plan. It cites Issue #226 / ADR-005 interfaces **without modifying them** (Inventory owns that engine/security lane) and it does not resolve Issue #140. Each later stage is its own separately-authorized Owner gate. **Issue #325 stays OPEN.**

Repository-path convention: `firestore.rules`, `functions/…`, `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. Scope

Specifies the governed report creator whose architecture ADR-007 selected: a single trusted execution service that reads governed collections with elevated privilege and returns only the fields and rows the *runner* is authorized to see, driven by static repository-owned catalogs and the ADR-005 authorization engine.

**In scope (this document):** the catalogs for all existing objects; the field-level read authorization contract and the predicate-drop rules; query definition/validation; saved-report definitions; sharing and scheduling *design* (activation staged conservatively); CSV export and execution limits; auditing via the Enterprise Access audit writer; error/accessibility states; the six-wave staged activation and rollback boundaries; and a proposed implementation sequence.

**Out of scope / deferred:** any implementation, Function, Rule, index, or UI; the #226 field-level read *engine extension* itself (contract only, here; code is Inventory's lane); Issue #140 tenant model; the Invoice object (deferred until its domain exists); the static Inventory Part catalog as a live source (recorded as deferred/separately-governed, §4.4).

## 2. Definitions

- **Object** — a reportable governed business object, identified by a **stable object identifier** (e.g. `customer`), backed by exactly one Firestore collection.
- **Field** — a reportable attribute of an object, identified by a **stable field identifier** (`<object>.<field>`, e.g. `customer.name`), never a page/component name or a raw arbitrary Firestore path.
- **Report definition** — inert saved metadata: an object, selected field ids, filters, grouping, sort, aggregates, presentation. Carries no data, no results, no author privileges.
- **Run / execution** — a server-side evaluation of a definition for a specific **runner** at a specific time, producing a projected, authorized result.
- **Runner** — the authenticated principal a run executes as; its *live* permissions and Scope are what a run is authorized against.
- **Sensitivity class** — a field-level classification (`standard | commercial | governed | security-text | financial | employee | audit`; see §5 legend) that determines default reportability and which review gate must pass before the field activates.

## 3. Catalog schema (the metadata shape)

Three static, version-controlled, repository-owned catalogs. Never client-editable; never derived from raw live schema.

### 3.1 Object catalog entry
`{ objectId, label, collection, activationWave, objectReadCapability, defaultSensitivity, description }`

### 3.2 Field catalog entry
`{ fieldId, objectId, label, dataType, description, sensitivity, operators, readCapability }`
- `dataType ∈ { string, number, boolean, date, enum, reference, list }`.
- `operators` — the subset of `{ filter, sort, group, aggregate }` the field supports (a free-text `notes` supports none but `filter`/none; an enum supports `filter, group`; a number supports all four; a `reference` supports `filter, group`).
- `readCapability` — the single capability required to **select, filter, sort, group, aggregate, display, share, schedule, or export** the field. A field with no `readCapability` is **not reportable**. (Per ADR-007 §4 open decision 2, an operator-differentiated form — aggregate-only — may later split this; until then it is one capability governing all operators, the conservative default.)

### 3.3 Relationship catalog entry
`{ relationshipId, fromObjectId, toObjectId, cardinality, traversalCapability, hop }`
- `cardinality ∈ { one, many }`; `hop = 1` only at first activation (ADR-007 §2.5).

## 4. Object catalog (all existing objects)

| objectId | label | collection | wave | object read capability | sensitivity posture |
|---|---|---|---|---|---|
| `customer` | Customer | `accounts` | 1 | `report.customer.read` | standard; `paymentTerms`/`taxStatus` governed; `accountOwner` employee (→ wave 4); notes security-text |
| `contact` | Contact | `contacts` | 1 | `report.contact.read` | standard |
| `location` | Location | `locations` | 1 | `report.location.read` | standard |
| `equipment` | Equipment | `equipment` | 1 | `report.equipment.read` | standard |
| `job` | Job | `fieldops_jobs` | 2 | `report.job.read` | standard |
| `workOrder` | Work Order | `fieldops_wos` | 2 | `report.workOrder.read` | standard (technician self-scope in Rules) |
| `technician` | Technician | `fieldops_technicians` | 2 | `report.technician.read` | standard |
| `serviceHistory` | Service History (derived) | derived from `fieldops_wos` | 2 | `report.serviceHistory.read` | standard; derived, read-only |
| `reorderRequest` | Reorder Request | `reorder_requests` | 3 | `report.reorderRequest.read` | standard |
| `purchaseOrder` | Purchase Order | `reorder_purchase_orders` | 3 | `report.purchaseOrder.read` | standard + cost fields (financial) |
| `inventoryAction` | Inventory Action | `inventory_actions` | 3 | `report.inventoryAction.read` | standard |
| `employee` | Employee | `employees` | 4 | `report.employee.read` | employee (sensitive) |

**Deferred / not catalogued as live objects:**
- **Invoice** — no domain model exists (only `INVOICE_DELIVERY_METHOD` on `accounts`). Catalog-deferred until an Invoice domain and collection exist (wave 6).
- **Inventory Part** — `src/data/partsCatalog.ts` is a **static, non-authoritative metadata catalog**, not a governed Firestore collection ("METADATA ONLY … NOT Firestore-backed"). Recorded as a **deferred or separately-governed source**; it is not presented as a live governed object. A future "Part" report object requires a governed Parts collection first.
- **`users`, `counters`, `reorder_purchase_order_voids`** — infrastructure/ledger collections, not user-facing report objects at first; `voids` may later be modelled as a Purchase Order sub-fact.

Financial/cost/margin/audit **and employee** **fields** across the above objects stay **denied by default** and activate only in their sensitive-domain wave after that domain's dedicated security review — **regardless of their host object's earlier wave** (ADR-007 §2.6). This is load-bearing for the one such field that sits in a wave-1 table: `customer.accountOwner` (§5.1) references an Employee and is classified `employee`, so it is **deferred to wave 4**, not activated with the Customer object in wave 1. Financial fields (e.g. Purchase Order cost lines, whose host object activates in wave 3) likewise defer to wave 5.

## 5. Field catalog

Sensitivity legend: `standard` (activatable with its object under Architecture review), `commercial` (informational Commercial-Profile fields — activatable with the object, grouped under one capability), `governed` (Rules-governed admin-only commercial: `paymentTerms`/`taxStatus` only), `security-text` (free-text that may hold physical-security data such as alarm codes or site-entry instructions — activatable with its object **but only after the wave-1 review explicitly confirms it**, never silently `standard`), `financial` (cost/margin — wave 5 + security review), `employee` (wave 4 + review), `audit` (wave 5 + review).

The distinction between `governed` and `commercial` matters and the code draws it: only `paymentTerms` and `taxStatus` are Rules-governed, admin-edit-only (`constants.js`, "the two GOVERNED enum fields"); `defaultCurrency`, `purchaseOrderRequired`, and `invoiceDeliveryMethod` are informational Commercial-Profile fields (`AccountForm.jsx`), not Rules-governed. Classifying them as their own `commercial` class rather than `governed` keeps the Spec honest about which fields the Rules layer actually protects.

### 5.1 `customer` (wave 1) — backing `accounts`
| fieldId | label | type | operators | sensitivity | readCapability |
|---|---|---|---|---|---|
| `customer.name` | Name | string | filter, sort, group | standard | `report.customer.field.name.read` |
| `customer.status` | Status | enum | filter, group | standard | `report.customer.field.status.read` |
| `customer.relationshipTypes` | Relationship types | list | filter, group | standard | `report.customer.field.relationshipTypes.read` |
| `customer.billingAddress.street` | Billing street | string | filter, sort | standard | `report.customer.field.billingAddress.read` |
| `customer.billingAddress.city` | Billing city | string | filter, sort, group | standard | `report.customer.field.billingAddress.read` |
| `customer.billingAddress.state` | Billing state | string | filter, sort, group | standard | `report.customer.field.billingAddress.read` |
| `customer.billingAddress.zip` | Billing ZIP | string | filter, sort, group | standard | `report.customer.field.billingAddress.read` |
| `customer.tags` | Tags | list | filter, group | standard | `report.customer.field.tags.read` |
| `customer.customerNumber` | Customer # | string | filter, sort | standard | `report.customer.field.externalIds.read` |
| `customer.erpId` / `.accountingId` / `.legacyId` | External IDs | string | filter | standard | `report.customer.field.externalIds.read` |
| `customer.notes` | Notes | string | (none) | **security-text** | `report.customer.field.notes.read` |
| `customer.createdAt` | Created | date | filter, sort, group | standard | `report.customer.field.createdAt.read` |
| `customer.paymentTerms` | Payment terms | enum | filter, group | **governed** | `report.customer.field.paymentTerms.read` |
| `customer.taxStatus` | Tax status | enum | filter, group | **governed** | `report.customer.field.taxStatus.read` |
| `customer.defaultCurrency` | Default currency | string | filter, group | commercial | `report.customer.field.commercialProfile.read` |
| `customer.purchaseOrderRequired` | PO required | boolean | filter, group | commercial | `report.customer.field.commercialProfile.read` |
| `customer.invoiceDeliveryMethod` | Invoice delivery | enum | filter, group | commercial | `report.customer.field.commercialProfile.read` |
| `customer.billingContact` | Billing contact | reference→contact | filter | standard | `report.customer.field.billingContact.read` |
| `customer.accountOwner` | Account owner | reference→employee | filter, group | **employee** | `report.customer.field.accountOwner.read` |

### 5.2 `contact` (wave 1) — backing `contacts`
| fieldId | label | type | operators | sensitivity | readCapability |
|---|---|---|---|---|---|
| `contact.name` | Name | string | filter, sort, group | standard | `report.contact.field.name.read` |
| `contact.email` | Email | string | filter, sort | standard | `report.contact.field.email.read` |
| `contact.phone` | Phone | string | filter | standard | `report.contact.field.phone.read` |
| `contact.role` | Role | string | filter, group | standard | `report.contact.field.role.read` |
| `contact.accountId` | Customer | reference→customer | filter, group | standard | `report.contact.field.customer.read` |

### 5.3 `location` (wave 1) — backing `locations`
| fieldId | label | type | operators | sensitivity | readCapability |
|---|---|---|---|---|---|
| `location.name` | Name | string | filter, sort, group | standard | `report.location.field.name.read` |
| `location.address.street` / `.city` / `.state` / `.zip` | Address parts | string | filter, sort, group | standard | `report.location.field.address.read` |
| `location.accessNotes` | Access notes | string | (none) | **security-text** | `report.location.field.accessNotes.read` |
| `location.accountId` | Customer | reference→customer | filter, group | standard | `report.location.field.customer.read` |

### 5.4 `equipment` (wave 1) — backing `equipment`
| fieldId | label | type | operators | sensitivity | readCapability |
|---|---|---|---|---|---|
| `equipment.name` | Name | string | filter, sort, group | standard | `report.equipment.field.name.read` |
| `equipment.status` | Status | enum | filter, group | standard | `report.equipment.field.status.read` |
| `equipment.manufacturer` / `.model` / `.serialNumber` / `.assetTag` | Identity | string | filter, sort, group | standard | `report.equipment.field.identity.read` |
| `equipment.installedDate` / `.warrantyExpiresDate` | Dates | date | filter, sort, group | standard | `report.equipment.field.dates.read` |
| `equipment.notes` | Notes | string | (none) | standard | `report.equipment.field.notes.read` |
| `equipment.accountId` | Customer | reference→customer | filter, group | standard | `report.equipment.field.customer.read` |
| `equipment.locationId` | Location | reference→location | filter, group | standard | `report.equipment.field.location.read` |
| `equipment.createdAt` | Created | date | filter, sort, group | standard | `report.equipment.field.createdAt.read` |

### 5.5 Later-wave field catalogs (structure fixed here; per-field lists completed and verified at each wave's activation review)

The schema of §3.2 applies uniformly. The following are catalogued at object + sensitivity granularity now; their exhaustive field lists are authored and verified as each wave activates (each activation is its own review gate, §14), so that a field's sensitivity classification is fixed by review before it is ever reportable:

- **Wave 2 — `job`, `workOrder`, `technician`, `serviceHistory`:** operational fields (status, priority, type, severity, scheduledDate, dates, customerId/customerName, locationId, equipmentId, assignedTechId, woNumber) — all `standard`; `serviceHistory` is derived read-only from `fieldops_wos`. Technician self-scope in Rules is preserved: a technician runner sees only their own Work Orders, enforced by the same Scope re-evaluation (§6).
- **Wave 3 — `reorderRequest`, `purchaseOrder`, `inventoryAction`:** lifecycle/status/quantity/date fields `standard`; **Purchase Order cost/price/total fields are `financial`** and defer to wave 5.
- **Wave 4 — `employee`:** identity/employmentStatus/operationalRoles/title `employee`-sensitive (whole object gated on the wave-4 review); userId is a reference, not exposed as a raw claim.
- **Wave 5 — all `financial` and `audit` fields** across every object: activated only field-by-field after the dedicated financial/audit security review.
- **Wave 6 — `invoice`:** only once an Invoice domain model and collection exist.

## 6. Field-level read authorization (the enforcement contract)

Every operation on every field is authorized **server-side, at run time**, by the trusted engine calling the ADR-005 decision engine for the field's `readCapability`, in the runner's live Scope, comparing `currentAccessVersion` for freshness. The decision contract is `resolveEffectivePermission(ResolveInput): ResolveResult` (the client-side mirror is `src/access/resolveEffectivePermission.ts`; the **authoritative engine is functions-side and #226-owned**, and the report service calls that server engine, not the client mirror).

- **Object gate first:** a run requires the object's `objectReadCapability`; without it, nothing is read.
- **Per-field gate:** each selected/filtered/sorted/grouped/aggregated field requires its `readCapability`. A field the runner may not read is **absent from the response payload** — never blanked, never returned-then-hidden.
- **Predicate-drop rule (ADR-007 §2.4):** a **filter, group, sort, or aggregate predicate that references a field the runner may not read is dropped (removed), never applied** — so result-set *membership* cannot leak the hidden field (e.g. a shared `salary > X` filter). A dropped predicate **widens** the result and is **surfaced to the runner** exactly like a dropped column. Widening never leaks; it never bypasses object/record-level read (the runner's authorized row set still bounds it), and it stays inside the execution limits of §10 (a widened result past the row cap is shown as **widened and truncated**, not authoritative).
- **Relationship-hop rule (ADR-007 §2.5):** projected columns from a related object are authorized by *that object's* field capabilities for the same runner; a filter/group/sort/aggregate on a related object's unreadable field is dropped identically.
- **No client-direct read path.** The client never reads a report collection directly; the engine is the only reader.
- **No cross-principal result caching (ADR-007 §2.4).** Any execution-result cache is keyed to the runner's resolved access set and `accessVersion`, so a projection computed for a higher-privileged principal is never served to a lower-privileged one — the cache is never a side channel around re-evaluation.

**This Specification defines the capability *contract*, not the engine.** The `report.*` capability ids above are the shape the #226 field-level read extension must provide; the extension's code is Inventory's lane (Issue #226) and is **not modified here**. Enforcement is unavailable-not-unsafe until that extension and the #15 Functions lane ship and are verified.

## 7. Query definition & validation

A report definition is validated **server-side against the catalog** on save and again on every run (the catalog can change between them):

- Object id must exist and be **activated**; every field id must exist, belong to the object (or a catalogued one-hop relationship), and be activated.
- Every operator used on a field must be in that field's `operators` set (no sorting a `notes`, no aggregating a `string`).
- Filters must be well-typed against the field `dataType`; unknown/extra keys are rejected (fail-closed), never ignored.
- Relationship references must be in the relationship catalog and `hop = 1` at first activation; arbitrary paths are rejected.
- **Aggregates** take two shapes. A **field-bound** aggregate (`count`/`sum`/`avg`/`min`/`max`) requires a field that supports the `aggregate` operator (number-only by construction) and its `readCapability`. A **fieldless `countRows`** aggregate counts the rows the run produced: it references no field, so it carries **no `fieldId`** (a stray one is rejected) and needs no field `readCapability` — it is bounded only by the object gate and the runner's authorized row set (§6), so it can only ever count rows the runner may already see, never a channel to probe hidden rows. Combined with grouping it yields authorized **counts per group**.
- **Grouping consistency:** when a definition groups or aggregates, **every projected non-aggregate field must appear in `groupBy`** — a raw column that is neither grouped nor aggregated is ambiguous under aggregation and is **refused on save**. (At run, §6 keeps this consistent: a grouped field dropped as unreadable drops the column it backed with it.)
- A definition that references an unknown/unactivated object or field is **refused on save**; one that becomes partly unreadable *later* is **run with the unreadable parts dropped** (§6), not refused — the difference between "never valid" and "no longer fully authorized."

## 8. Saved reports

- A saved definition is **inert metadata** (object id, field ids, operators, filters, grouping, sort, presentation) — **no data, no results, no author privileges** (ADR-007 §2.4).
- Governed as an object: separate capabilities for **create / read / rename / duplicate / delete** a definition.
- Opening/running a saved definition **re-resolves the runner's live access every time** and applies §6 (drop unreadable columns and predicates). A definition authored by a high-privileged user and opened by a lower-privileged one returns **only what the runner may see** — it is never a privilege-escalation path.
- Definitions **tolerate catalog change:** a field removed/re-classified/de-activated is dropped at run with the omission surfaced; the definition is not invalidated.

## 9. Sharing & scheduling (designed; activation conservative)

- **Private by default.** A definition is visible only to its owner until explicitly shared.
- **Sharing shares the definition, never a result set.** A shared open re-executes under the recipient's permissions and Scope (§6). Cross-tenant sharing is bounded by #140's tenant Scope, **inert today** — so sharing at first activation is same-tenant/global only, never tenant-widening.
- **Scheduling is designed but not activated in wave 1** (Owner: "design support … but stage activation conservatively"). A scheduled run executes as a **defined runner principal** and re-resolves that runner's live access every fire — a schedule never freezes access. Whether scheduling activates in wave 1 is an open decision (ADR-007 §4).
- Share and schedule actions are **auditable** (§11).

## 10. Export controls & execution limits

- **CSV is the only export format at first activation.** Export is a **separately-governed capability** (`report.export`) distinct from viewing; a runner may view but not export. Export re-authorizes at export time under the same §6 projection and predicate-drop.
- **Bounded execution (values are open decision ADR-007 §4; proposed conservative starting bounds):**
  - max result rows per run: **10,000** (proposed);
  - max runtime per run: **30 s** (proposed);
  - max group/aggregate cardinality: **1,000 groups** (proposed);
  - max export rows / file size: **10,000 rows / 10 MB** (proposed).
- A run that would exceed a bound is **truncated with a clear, surfaced notice** (never silently), so a report cannot become an unbounded scan or an exfiltration channel. Widened results (§6) are truncated under the same caps.

## 11. Immutable auditing

Report **creation, sharing, scheduling, execution, and export** each emit an immutable Audit Event through the Enterprise Access audit writer (`functions/src/access/auditEventWriter.ts` — `recordStandaloneAuditEvent` / `stageAuditEvent`), the platform's only audit-*write* path. Each event records the actor, action, definition id, object id, Scope, `accessVersion`, and (for runs/exports) row counts and any dropped-field/dropped-predicate/truncation facts — enough to reconstruct *what was authorized and returned*, never the row data itself. Report auditing shares that path's Issue #15 deployment gate; the domain operational timeline (`domain/eventModel.js`) persists nothing and is not used.

## 12. Error & accessibility states

- Distinct **empty** (no rows), **loading**, **permission-denied** (object not authorized), **partially-authorized** (columns/predicates dropped — surfaced, not silent), **unsupported-field/operator**, **truncated/widened**, and **execution-failure** states.
- Safe copy only: never a raw Firestore code, path, document id, collection name, or the name of a field the runner may not know exists. A permission-denied on the whole object reads as "you don't have access to this report", not a field enumeration.
- **Keyboard-first builder** and **responsive layout**, consistent with the platform's shared UI conventions (the same `Modal`/form/state primitives used elsewhere).

## 13. Staged activation & rollback boundaries

Activation is a **catalog/capability operation over the build-once engine** (ADR-007 §2.9). The six waves (Owner's binding sequence):

1. Customer, Contact, Location, Equipment.
2. Jobs, Work Orders, Technicians, derived Service History.
3. Inventory, Reorders, Purchase Orders, Warehouse activity.
4. Employees and Administration data.
5. Financial, cost, margin, audit, and other highly sensitive **fields** (across all objects).
6. Invoice — only after an Invoice business object exists.

- Each wave is its **own review gate** (Architecture + a **dedicated security review** for any sensitive domain, ADR-007 §2.6); a wave activates catalog entries + capabilities, adds no engine.
- **Rollback boundary:** because activation is catalog/capability data over a fixed engine, a wave is **reversible by de-activating its catalog entries/capabilities** — no schema migration, no data backfill, no engine change to unwind. A field found to leak or be mis-classified is de-activated (denied) without affecting other objects.
- **Tenant Scope stays inert** across all waves until #140 defines it; no wave widens access on `tenant`.

## 14. Proposed implementation sequence (recorded, not an implementation plan)

Recorded per the Owner's request; **this is not the Implementation Plan** and authorizes no code.

1. **Foundation (no user surface):** the metadata catalogs (§3–5) as version-controlled repository data; the trusted execution-service *contract* and the `report.*` capability ids aligned with the #226 lane. Gated on the #226 field-level extension and #15.
2. **Wave 1 read-only engine:** object + field + one-hop relationship reads for Customer/Contact/Location/Equipment, field projection + predicate-drop, tabular preview, execution limits, audit on run. No save/share/schedule/export yet.
3. **Saved definitions:** create/read/rename/duplicate/delete, re-evaluation-at-run, catalog-change tolerance.
4. **CSV export** (separately-governed), with export limits + audit.
5. **Sharing** (private-default, same-tenant), then **scheduling** if the Owner activates it.
6. **Waves 2–6** as catalog/capability activations, each behind its review gate; sensitive fields (wave 5) only after the dedicated financial/audit security review.

Each step is separately Owner-authorized; none is authorized by this document.

## 15. Irreducible decisions for the Owner (could not be safely inferred)

1. **Field-level read capability form** and whether it is **operator-differentiated** (aggregate-only / filter-only vs raw read) — affects the #226 extension shape (ADR-007 §4).
2. **Concrete execution/row/runtime/export limit values** (§10 proposes conservative starts).
3. **Scheduling in wave 1?** — designed here; Owner decides activation timing.
4. **Sharing model** — private-only first, or governed share to named principals/roles at wave 1.
5. **Purchase Order cost fields** — confirm they are wave-5 `financial` (deferred) even though the Purchase Order object activates in wave 3.

## 16. Governance & scope honored

Documentation only. This Specification changes and authorizes nothing: no application code, `functions/`, Firestore Rules, indexes, permission-engine code, claims, deployment manifest, global project-status document, or production data; it deploys nothing and queries no production. It cites Issue #226 / ADR-005 interfaces without modifying Inventory's active work, does not resolve Issue #140, does not weaken field-level protection, and selects no production deployment action. The Implementation Plan, per-wave activations, and each dedicated security review remain separate, later, separately-authorized gates. **Issue #325 stays OPEN.**
