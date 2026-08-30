---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-08-30
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Assessment Report: EOS Ownership Model v1 — reconciliation

**Business Request:** Owner authorization "EOS OWNERSHIP MODEL v1" (2026-08-30). Approved
invariant: *every governed business record has an owner*; ownership is separate from Created By
and Assigned To; ownership never changes implicitly; every change is an explicit auditable
handoff; typed `owner.type` + `owner.id`, never display names.

This document is **reconciliation only**. No code, Rules, Functions or schema were changed.
Per the authorization, backfill and enforcement are both gated behind review of what follows.

## Scope of this assessment

Inspected: every `match` block in `firestore.rules` (55 collections), every metadata entity
definition (`field-ops-app-vite/src/metadata/definitions/`, 34 files), every `functions/src`
module that writes an ownership-like field, the audit authority, the caller/person authority,
and every existing company-identity concept.

Not inspected: live Firestore data. No record counts, no unresolved-record census — that
requires a sandbox/production read, which is separately Owner-gated. **This is the reason
enforcement cannot be turned on from repository evidence alone** (see Gate 4).

## Current repository state — the ownership-like fields that already exist

Six distinct, *already-governed* concepts occupy ownership-adjacent space. None of them is
`owner.type` + `owner.id`. None may be silently replaced.

| # | Existing concept | Where it lives | What it actually means | Verdict |
|---|---|---|---|---|
| 1 | `accountOwner` | `field-ops-app-vite/src/domain/commercialProfile.js:206` (`isCompleteAccountOwner`), declared as `accountOwnerEmployeeId` in `metadata/definitions/account.js:319` | A **7-field Person Assignment map**: `assignedToEmployeeId`, `assignedToUserId`, `assignedToDisplayName`, `assignedByEmployeeId`, `assignedByUserId`, `assignedByDisplayName`, `assignedAt`. All seven or none — a partial record is rejected fail-closed. | **This is already an explicit, provenanced handoff.** It is the closest thing the platform has to the approved model, and it is *richer* than `owner.type`+`owner.id`. Do not delete it. |
| 2 | `ownerEmployeeId` | `opportunity.js:116`, `salesOrder.js:142`, `salesAgreement.js:90`; enforced in `functions/src/opportunity/opportunityCommands.ts:127`, `closeOpportunityAsWon.ts:402`, `createSalesOrderFromOpportunity.ts:295` | A canonical Employee reference. **Required and caller-supplied on create** — never inherited. | Person ownership already exists here, but the *inheritance* half of the approved invariant does not. |
| 3 | `currentOwner` | `firestore.rules` — ~15 enforcement clauses across `reorder_requests` (lines 211–956) | A **role queue**: `INVENTORY` / `PARTS_MANAGER` / `PARTS_ASSOCIATE`. Workflow custody, not record ownership. Paired with `assignedToUserId`. | **Naming collision only.** This is not ownership and must not be folded into it. Renaming it is a Tier-2 change against live-deployed Rules — do not. |
| 4 | `explicitTitleHolder` / `OWNERSHIP` | `field-ops-app-vite/src/domain/inventoryControlLifecycle.js:121`, mirrored `functions/src/fulfillment/inventoryControlLifecycle.ts:76` | `VENTANA` / `TAYLOR` / `CUSTOMER` / `UNKNOWN`. **Legal title** to a serialized asset. Its own axis, explicitly independent of control, custody and installation; absent fact ⇒ `UNKNOWN`, never derived. | An existing governed company-ownership authority. The new model must **resolve to it, never restate it**. |
| 5 | `ACCOUNT_LINE_OF_BUSINESS` | `field-ops-app-vite/src/domain/constants.js:143` | Optional, additive, **multi-valued** Account array (`TAYLOR`, `VENTANA`, or both). Informational, gates no authorization. | Not ownership. Its own comment already declares it "a FOURTH distinct concept". |
| 6 | `createdBy` / `createdByUid` / `actor` | ~30 modules (`receivingRepository.ts:136`, `cycleCountRepository.ts:71`, `opportunityCommands.ts:148`, …) | Actor UID at creation. Consistent, validated (`receivingRepository.ts:272` even cross-checks `createdBy === actor.id`). | Already correctly separate from ownership. The approved separation is *already honoured* here. |

### The finding that changes the plan

`operatingCompanyId` — the field the wireframes call "whose books this transaction lands in,
immutable once stamped" (`docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md:222`)
— **is stored nowhere.** It appears only in design docs and in negative-space comments
("no `operatingCompanyId`" — `salesOrderReadService.ts:16`). There is **no `companies`
collection** in `firestore.rules`.

Consequence: the approved invariant's company leg — *"Parts, Equipment, Inventory and other
company-owned records resolve ownership to the appropriate governed company authority,
including Taylor or Ventana"* — **has no authority to resolve to today.** Building one is not
duplicating an existing authority (rule 4 is satisfied), but it is a new governed authority and
therefore a material architecture decision, not an implementation detail. See Decision D-2.

## Ownership matrix

`owner.type` values proposed: `EMPLOYEE` (a person, by canonical Employee id) and `COMPANY`
(a governed operating company id). No third type is proposed — a role queue is custody, not
ownership.

**Legend — Transfer behavior:** *Explicit handoff* = auditable command, never implicit.
*Immutable* = historical; the record keeps the owner it was created with, forever.

### A. Commercial — person-owned

| Record family | Collection | Owner type | Inheritance source (NEW records) | Transfer behavior | Today |
|---|---|---|---|---|---|
| Account | `accounts` | EMPLOYEE | None — assigned at creation or later | Explicit handoff | `accountOwner` map exists |
| Contact | `contacts` | EMPLOYEE | Parent Account owner at creation | Explicit handoff; does **not** follow the Account | **Gap** |
| Location | `locations` | EMPLOYEE | Parent Account owner at creation | Explicit handoff | **Gap** |
| Opportunity | `opportunities` | EMPLOYEE | **Customer (Account) owner** — approved default | Explicit handoff; existing Opportunities do **not** move when Account ownership moves | `ownerEmployeeId` exists, required, **not inherited** |
| Sales Agreement | `sales_agreements` | EMPLOYEE | Opportunity owner | Explicit handoff | `ownerEmployeeId` exists, not inherited |
| Sales Order | `sales_orders` | EMPLOYEE | Opportunity owner | Explicit handoff | `ownerEmployeeId` exists, required, **not inherited** |
| Invoice | `invoices` | EMPLOYEE | Sales Order owner | **Immutable** — an issued invoice is historical | **Gap** |
| Payment / Payment Application / Invoice Adjustment / Refund | `payments`, `payment_applications`, `invoice_adjustments`, `refunds` | EMPLOYEE | Invoice owner | **Immutable** — financial events are historical | **Gap** |

### B. Service / operational

| Record family | Collection | Owner type | Inheritance source | Transfer behavior | Today |
|---|---|---|---|---|---|
| Work Order | `fieldops_jobs`, `fieldops_wos` | EMPLOYEE | Sales Order owner where one exists; otherwise Account owner | Explicit handoff. **Distinct from `assignedTechId`**, which stays assignment | **Gap** — only assignment exists |
| Reorder Request | `reorder_requests` | EMPLOYEE | Requester's Employee | Explicit handoff. **`currentOwner` is untouched** — role queue, separate axis | Partial (custody only) |

### C. Company-owned (resolve to the governed company authority)

| Record family | Collection | Owner type | Inheritance source | Transfer behavior | Today |
|---|---|---|---|---|---|
| Part / Part Alias / Part Supplier Item | `parts`, `part_aliases`, `part_supplier_items` | COMPANY | Company that owns the catalog | Explicit handoff (rare) | **Gap** |
| Manufacturer / Equipment Model / Compatibility | `manufacturers`, `equipment_models`, `equipment_part_compatibility`, `equipment_compatibility_sources` | COMPANY | Shared reference data | Explicit handoff (rare) | **Gap** |
| Supplier / Supplier Catalog | `suppliers`, `supplier_catalog` | COMPANY | Company holding the supplier relationship | Explicit handoff | **Gap** |
| Equipment (serialized asset) | `equipment` | COMPANY | Operating company that carries the record | Explicit handoff. **Record owner ≠ `explicitTitleHolder`** — see D-3 | `explicitTitleHolder` exists (title axis) |
| Warehouse / Stock Location / Mobile Location / Truck | `warehouses`, `stock_locations`, `mobile_locations`, `trucks` | COMPANY | Operating company | Explicit handoff | **Gap** |
| Purchase Order / Reorder PO / Void | `purchase_orders`, `reorder_purchase_orders`, `reorder_purchase_order_voids` | COMPANY | Buying company | **Immutable** once issued | **Gap** |
| Receiving Order / Transfer Order / Cycle Count | `receiving_orders`, `transfer_orders`, `cycle_counts` | COMPANY | Destination/owning warehouse's company | **Immutable** — operational events | **Gap** |
| Inventory Transaction / Inventory Action | `inventory_transactions`, `inventory_actions` | COMPANY | Owning warehouse's company | **Immutable** — ledger | **Gap** |

### D. Explicitly OUT of the ownership model

| Collection(s) | Why excluded |
|---|---|
| `users`, `employees`, `fieldops_technicians` | Person/identity authority — subjects of ownership, not objects |
| `permissions`, `roles`, `roleAssignments`, `accessRequests` | Access authority (Issue #226 platform), governed separately |
| `auditEvents` | Immutable audit authority; client-deny-all |
| `reportDefinitions` | Already has its own "private by owner" model (`firestore.rules:1583`) — a *platform* record, not a governed business record. Do not disturb |
| `sales_territories`, `commercial_coverage_assignments` | **Coverage is not ownership, credit, commission or security.** Folding coverage into ownership would collapse a distinction the register deliberately preserves |
| `counters`, `inventory_sync_status`, `location_truck_claims`, `equipment_compatibility_operations`, `technician_working_availability`, `technician_blocked_time` | Infrastructure, idempotency keys, or person-scoped scheduling — not business records |

## Decisions required before any code mutation

These are the points where two readings produce materially different systems. None can be
settled by this assessment.

**D-1 — Does `accountOwner` become `owner`, or project into it?**
`accountOwner` is a richer, already-fail-closed, already-provenanced structure. Two options:
(a) keep it as the Account's storage and expose a *derived* typed `owner` view; (b) migrate to
typed `owner` and demote the assignment provenance to the handoff audit event.
**Recommendation: (a).** It is non-destructive, honours rule 5, and the seven fields already
encode exactly the "explicit auditable handoff" the invariant asks for.

**D-2 — What is the governed company authority?**
None exists. `operatingCompanyId` is design-only; there is no `companies` collection;
`ACCOUNT_LINE_OF_BUSINESS` is informational and multi-valued, so it cannot serve. A governed
company registry must be created before *any* company-owned family in section C can be
populated. This is new architecture, not a field addition.

**D-3 — For `equipment`, is the record owner the operating company or the title holder?**
`explicitTitleHolder` can be `CUSTOMER`; a customer is not an operating company and cannot own
an internal record. **Recommendation: record owner = operating company; title stays its own
independent axis, unchanged.** Stating this explicitly is what stops a future reader from
"reconciling" the two into one field and destroying the D-1/D-2 Ventana title rulings.

**D-4 — Relaxing the required `ownerEmployeeId` inputs.**
`createOpportunity`, `closeOpportunityAsWon` and `createSalesOrderFromOpportunity` all *require*
`ownerEmployeeId` and reject an empty one. Implementing "Customer owner is the default owner for
NEW Opportunities" means making that input optional-with-inheritance — a contract change to
deployed callables. Confirm the callers may be relaxed rather than a new default being layered
above them.

**D-5 — Audit action vocabulary.**
The single audit authority is `functions/src/access/auditEventWriter.ts`, whose `AuditAction`
exists twice: the erased TS union (`functions/src/types/access.ts:192`) **and** the runtime array
(`auditEventWriter.ts:69`). A handoff action must be added to **both** — adding to only one
compiles cleanly and fails at runtime, a mistake this repo has already made once and documented.
Note `ScopeType` has no per-record value (`global`, `tenant`, `domain`, `location`,
`ownAssignment`); the existing `objectId` field added for reports is the right carrier, not a
new ScopeType.

## Risks

- **Rules surface.** Every enforcement clause is Tier 2 and `firestore.rules` is not
  auto-deployed — merged is not live. Enforcement must land behind the `verify-rules-deploy`
  checklist, and the dual-copy parity requirement applies.
- **Silent conflation.** Three separate collapses would each destroy governed distinctions:
  `currentOwner` into `owner`, coverage into ownership, `explicitTitleHolder` into `owner`.
  The matrix names all three so a later reader cannot "tidy" them together.
- **Backfill without a company authority.** Section C cannot be backfilled at all until D-2 is
  settled; attempting it would mint an ungoverned company id namespace.
- **Immutability vs. correction.** Eight families are marked immutable. A mis-owned historical
  invoice then has no legal path to correction. If the Owner wants one, it must be a named,
  audited exception rather than an implicit edit.

## Sequencing — the four gates the authorization requires

1. **Reconciliation** (this document) — Owner review. *No code.*
2. **Decisions D-1 through D-5** ratified, `SYSTEM_AUTHORITIES.md` row drafted in the same change.
3. **Typed owner shape + inheritance defaults + handoff command + audit action**, written but
   **inert** — no Rules enforcement, no backfill. Then a **dry-run mapping** producing an
   unresolved-record census per family.
4. **Enforcement** only after the census reads zero unresolved records — which needs a live data
   read this session cannot perform.

## Estimated PR count

Six to eight, one per architectural concern: company authority (D-2); typed owner shape +
validators; inheritance defaults in the commercial creation path; handoff command + audit
action; dry-run mapping script; per-family Rules enforcement, split by risk.

## Open questions for Architecture Review

D-1 through D-5 above. D-2 is blocking — section C of the matrix cannot proceed without it.
