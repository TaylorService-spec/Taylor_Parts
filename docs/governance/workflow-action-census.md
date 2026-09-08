# Workflow Action Census

**MEASUREMENT ONLY. This document implements nothing.**

It records business actions encountered during the Firebase-removal workstream, so the later
Administration > Workflows workstream starts from measured behaviour rather than from memory. No
capability, Role, Rule or command is changed by anything written here.

## How an entry is classified

| Class | Meaning |
|---|---|
| **CRUD** | Ordinary creation/update/deletion of data. No lifecycle, no approval, no state machine. |
| **WORKFLOW_CANDIDATE** | A business action: lifecycle transition, approval, assignment, completion, cancellation, void, receipt, reconciliation. |
| **UNCLEAR** | Genuine ambiguity only. |

A write is **not** a workflow merely because it is a write. The test applied here is whether the
action moves a record between named business states, requires a precondition beyond validation, or
produces a governed side effect other than storing what it was given.

**One JavaScript function is not necessarily one business action.** `reviewReorderRequest` was one
function and is two actions — approve and reject — with two capabilities, two outcomes, and two
different rules about whether a reason is required. They are listed separately below because the
code and the catalog both prove they are distinct.

## Status of this census

**Partial and honest about it.** It covers what the Firebase-removal migration has actually
touched. Domains not yet visited — sales, fulfilment, finance, receiving, cycle counts — are NOT
represented, and their absence means "not yet measured", never "no candidates". The
repository-wide sweep happens after Firebase removal closes.

---

## WORKFLOW_CANDIDATE — live

### Reorder — approve a request

| Field | Measured value |
|---|---|
| **Domain** | Reorder / Purchasing |
| **Action** | `approveReorderRequest` |
| **Current implementation** | **MIGRATED.** Trusted callable; pure decision `buildApprove`. |
| **Target object** | `reorder_requests/{id}` |
| **From → To** | `PENDING_REVIEW` → `READY_FOR_PARTS_MANAGER` |
| **Capability** | `reorder.request.approve` |
| **Record scope** | None beyond status |
| **Prerequisites** | Status must be `PENDING_REVIEW`. Notes optional. |
| **Side effects** | `reviewDecision` APPROVED; `reviewedBy`/`reviewedAt` server-derived; `currentOwner` → PARTS_MANAGER; fires the reorder change signal |
| **Audit** | **None.** The client path wrote none and the command adds none — nothing here needs a deterministic replay id. |
| **Live/historical** | LIVE |

### Reorder — reject a request

| Field | Measured value |
|---|---|
| **Action** | `rejectReorderRequest` |
| **Current implementation** | **MIGRATED.** `buildReject`. |
| **From → To** | `PENDING_REVIEW` → `REJECTED` (terminal) |
| **Capability** | `reorder.request.reject` |
| **Record scope** | None beyond status |
| **Prerequisites** | Status `PENDING_REVIEW`, and a **non-empty reason is required** — the one substantive difference from approve besides the outcome |
| **Side effects** | `currentOwner` **unchanged** — a rejected request does not change hands |
| **Audit** | None |
| **Live/historical** | LIVE |

### Reorder — assign a request

| Field | Measured value |
|---|---|
| **Action** | `assignReorderRequest` |
| **Current implementation** | **MIGRATED.** `buildAssign`. |
| **From → To** | `READY_FOR_PARTS_MANAGER` → `ASSIGNED_TO_PARTS_ASSOCIATE` |
| **Capability** | `reorder.request.assign` (holders include `partsManager` — the retired rule's `isActiveOperationalRole("PARTS_MANAGER")` branch) |
| **Record scope** | None; `assignedBy` is pinned to the authenticated actor |
| **Prerequisites** | Status, and a non-empty assignee id |
| **Side effects** | `currentOwner` → PARTS_ASSOCIATE; `assignedBy`/`assignedAt` server-derived |
| **Audit** | None |
| **Live/historical** | LIVE |

### Reorder — start purchasing

| Field | Measured value |
|---|---|
| **Action** | `startReorderPurchasing` |
| **Current implementation** | **MIGRATED.** `buildStartPurchasing`. |
| **From → To** | `ASSIGNED_TO_PARTS_ASSOCIATE` → `PURCHASING_IN_PROGRESS` |
| **Capability** | `reorder.request.startPurchasing` |
| **Record scope** | **ASSIGNEE.** `actor == assignedToUserId` — and in Rules this clause sat OUTSIDE the role disjunction, so it bound an administrator too. |
| **Side effects** | `purchasingStartedBy`/`purchasingStartedAt` server-derived |
| **Audit** | None |
| **Live/historical** | LIVE |

### Reorder — post purchasing progress

| Field | Measured value |
|---|---|
| **Action** | `postReorderPurchasingUpdate` |
| **Current implementation** | **MIGRATED.** `buildPurchasingProgress`. |
| **From → To** | `PURCHASING_IN_PROGRESS` → `PURCHASING_IN_PROGRESS` (status unchanged) |
| **Capability** | `reorder.request.postPurchasingUpdate` |
| **Record scope** | **ASSIGNEE** |
| **Prerequisites** | Status already `PURCHASING_IN_PROGRESS` |
| **Side effects** | A **closed** set of five fields; `lastPurchasingUpdateBy`/`At` server-derived |
| **Audit** | None |
| **Live/historical** | LIVE |
| **Notes** | Status-preserving, so arguably CRUD. Classified WORKFLOW_CANDIDATE because it is gated on a lifecycle state AND a record scope, and its field set is fixed by the transition rather than by the record's shape. |

### Reorder — mark received

| Field | Measured value |
|---|---|
| **Action** | `markReorderRequestReceived` |
| **Current implementation** | **MIGRATED.** `buildMarkReceived`. |
| **From → To** | `ORDERED` → `RECEIVED` (terminal) |
| **Capability** | `reorder.request.markReceived` |
| **Record scope** | **ASSIGNEE** |
| **Prerequisites** | Status `ORDERED` — **this carries the linked-PO semantics.** A request becomes ORDERED only when a purchase order is recorded against it, so this check is what stops something never ordered from being received. |
| **Side effects** | `receivedBy`/`receivedAt` server-derived |
| **Audit** | None |
| **Live/historical** | LIVE |

### Reorder — cancel a request

| Field | Measured value |
|---|---|
| **Action** | `cancelReorderRequest` |
| **Current implementation** | **MIGRATED.** `buildCancelReorderRequest`. |
| **From → To** | Any pre-ORDERED active status → `CANCELLED` (terminal) |
| **Capability** | `reorder.request.cancel` |
| **Record scope** | None |
| **Prerequisites** | Fail-closed status allowlist; non-empty reason |
| **Audit** | `cancelReorderRequest`. **New** — the client path wrote none. Structural rather than desirable: the idempotency mechanism IS the audit document. |
| **Live/historical** | LIVE |

### Purchasing — void a purchase order

| Field | Measured value |
|---|---|
| **Action** | `voidPurchaseOrder` |
| **Current implementation** | **MIGRATED.** `buildVoidPurchaseOrder`. |
| **Target object** | `reorder_purchase_orders/{id}` + append-only `reorder_purchase_order_voids/{id}` |
| **From → To** | `ORDERED` → `VOIDED`, plus a separate void record |
| **Capability** | `reorder.purchaseOrder.void` |
| **Record scope** | **ASSIGNEE** — actor must be the request's own `assignedToUserId` |
| **Side effects** | Two documents, one commit, one server clock — the cross-document `voidedAt == createdAt` invariant |
| **Audit** | `voidPurchaseOrder`. New, structural, as above. |
| **Live/historical** | LIVE |
| **Notes** | The append-only void record beside the unmutated order is the tell: a reversal event, not an edit. |

### Work Orders — lifecycle transitions

| Field | Measured value |
|---|---|
| **Action** | Transitions through the deployed `transitionWorkOrder` callable |
| **Current implementation** | Already a trusted command (ADR-002). Untouched by this workstream. |
| **Capability** | `workOrder.transition`, `workOrder.cancel` |
| **Record scope** | Not re-measured here |
| **Audit** | Not measured |
| **Live/historical** | LIVE |
| **Notes** | The competing client-direct path is gone: `Dispatch.jsx` assigns through this transition, and the legacy `assignJob` transaction it replaced is deleted. |

---

## WORKFLOW_CANDIDATE — historical (code deleted)

Recorded so the Workflows workstream starts from what the code **did**, not from memory of a module
that no longer exists. Deleted 2026-09-07 as dead code — three of `domain/jobActions.js`'s four
exports had no importer anywhere in `src/` or `test/`.

### Legacy jobs — assign a job

| Field | Measured value |
|---|---|
| **Action** | `assignJob` (DELETED) |
| **Target object** | `fieldops_jobs` + `fieldops_technicians`, one transaction |
| **From → To** | job `open` → `assigned`; technician → `on_job` |
| **Prerequisites** | Technician must be `available` — an **assignment-conflict** guard, thrown as `AssignmentConflictError` |
| **Retired authority** | `isAdminOrDispatcher()` |
| **Audit** | None |
| **Live/historical** | **HISTORICAL.** `Dispatch.jsx` moved to `transitionWorkOrder` against `fieldops_wos`. |

### Legacy jobs — update job status

| Field | Measured value |
|---|---|
| **Action** | `updateJobStatus` (DELETED) |
| **From → To** | Validated by the pure `canTransitionJob()`; on completion the technician returns to `available` |
| **Retired authority** | `isAdminOrDispatcher()` for lifecycle/assignment; a technician could perform a **status-only** `assigned → in_progress` on their **own** job (`technicianId == callerTechnicianId()` plus a `hasOnly(['status'])` allowlist). A `complete` job was terminal for every client, and completion itself was Function-only (`completeAssignedJob`). |
| **Audit** | None |
| **Live/historical** | **HISTORICAL** |

**Open and deliberately unresolved:** whether `fieldops_jobs` should exist at all beside
`fieldops_wos`. Both were live once; the dispatch surface moved to work orders and the job surface
was left behind. That is a product decision, not a migration step.

---

## CRUD

| Domain | Action | Status | Why not a workflow |
|---|---|---|---|
| CRM | `contactImport` | **MIGRATED** — `crm.contact.create` | A bulk creation. No lifecycle, no approval, no precondition beyond row validation. Writes **no audit event**, measured rather than omitted: a batch create needs no deterministic replay id. |
| CRM | `createAccount` / `updateAccount` | **MIGRATED** — `customer.record.create` / `.update`, plus `customer.governedField.write` for paymentTerms/taxStatus | Record storage. The governed-field split is an authority boundary, not a lifecycle. |
| CRM | `createContact` / `updateContact` | **MIGRATED** — `crm.contact.create` / `crm.contact.update` | Record storage. |
| CRM | `createLocation` / `updateLocation` | **MIGRATED** — `crm.location.create` / `crm.location.update` | Record storage. |
| Service | `createTechnician` | **MIGRATED** — `service.technician.create` | Record creation. The `status == 'available'` constraint was an authority the rule carried; the server now chooses the value rather than validating a supplied one. |
| Legacy jobs | `createJob` | **DELETED** (dead) | Record creation. |

---

## UNCLEAR

| Domain | Action | Why unresolved |
|---|---|---|
| Inventory | `recordInventoryAction` | **Retired** (Owner ruling 2026-08-30) — throws unconditionally, no writer remains. Listed only so a future reader does not rediscover it and assume it is live. |

The four reorder transitions previously listed here are **resolved**. The ambiguity was that their
*implementation* was CRUD-shaped — client store updates with no capability check — while their
*behaviour* was transition-shaped. Migrating them settled it: each now resolves a named business
capability and validates a named state transition, which is what a workflow candidate is.

---

## BLOCKED — measured, not migrated

| Surface | Why |
|---|---|
| `createEquipment` / `updateEquipment` (`domain/equipmentRepository.js`) | **Not exact parity with a plain `isAdminOrDispatcher()` rule**, so the conditional authorization does not reach it. `create` requires a cross-document check that the location belongs to the account; `update` carries an editable-key allowlist AND a status **transition guard** (`equipmentTransitionAllowed`), plus name/optional-field validation over the whole resulting document. No `service.equipment.create` / `.update` capability exists. Both are LIVE (`EquipmentDetail.jsx`). |

---

## Counts

Derived from the entries above, and laid out per entry so a stale number is visible rather than
plausible.

| Class | Count | Entries |
|---|---|---|
| WORKFLOW_CANDIDATE — live | **9** | approve, reject, assign, startPurchasing, postPurchasingUpdate, markReceived, cancelReorderRequest, voidPurchaseOrder, work-order transitions |
| WORKFLOW_CANDIDATE — historical | **2** | assignJob, updateJobStatus |
| CRUD | **6** | contactImport, account, contact, location, createTechnician, createJob |
| UNCLEAR | **1** | recordInventoryAction (retired) |
| BLOCKED | **1** | equipment create/update |

Counts are of *actions measured so far*, not of the system.

## Related

- `firebase-removal-closure-ledger.md` — every remaining client Firebase use, classified.
- `capability-parity-proposals.md` — how a capability blocker is brought to a ruling.
- `metadata-governed-read-migration.md` — the read side.
