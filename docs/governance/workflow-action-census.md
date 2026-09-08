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
| **UNCLEAR** | Needs review before it can be called either. |

A write is **not** a workflow merely because it is a write. The test applied here is whether the
action moves a record between named business states, requires a precondition beyond validation, or
produces a governed side effect other than storing what it was given.

## Status of this census

**Partial and honest about it.** It covers what the migration has actually touched so far. Domains
not yet visited (work orders beyond `jobActions`, sales, fulfilment, finance, receiving, cycle
counts) are NOT represented — their absence here means "not yet measured", never "no candidates".

---

## WORKFLOW_CANDIDATE

### Reorder — cancel a request

| Field | Measured value |
|---|---|
| **Domain** | Reorder / Purchasing |
| **Action** | `cancelReorderRequest` |
| **Current implementation** | **MIGRATED.** Trusted callable `cancelReorderRequest` (`functions/src/reorderRequest/reorderCallables.ts`), pure decision in `buildCancelReorderRequest`. The client-direct `runTransaction` is deleted, not disabled. |
| **Target object** | `reorder_requests/{id}` |
| **From state** | Any status for which `isCancellableReorderRequestStatus()` is true (`domain/reorderRequestCancelGuard.js`) |
| **To state** | `CANCELLED` |
| **Current capability** | `reorder.request.cancel`, now actually resolved fail-closed by the callable. The client-direct path never resolved it — it ran under the old Rules grant |
| **Current role/scope** | Capability-level. No record or self scope. |
| **Prerequisites** | Request must exist; status must be cancellable; a non-empty reason is required |
| **Side effects** | Writes `cancelledBy`, `cancelledAt`, `cancellationReason`; fires the reorder change signal so other components refresh |
| **Current audit action** | `cancelReorderRequest`. **This is a real behavior change, not a like-for-like migration**: the client path wrote none. It exists because the idempotency mechanism IS the audit document (a deterministic id whose prior existence is the already-applied check) — there is no version of this command in this shape without one. |
| **Notes** | The state guard is already a pure, tested module, which is what makes this a transition rather than an update. |

### Purchasing — void a purchase order

| Field | Measured value |
|---|---|
| **Domain** | Purchasing |
| **Action** | `voidPurchaseOrder` |
| **Current implementation** | **MIGRATED.** Trusted callable `voidPurchaseOrder`, pure decision in `buildVoidPurchaseOrder`. The client-direct `runTransaction` is deleted. `domain/reorderPurchaseOrders.js` now imports no Firestore at all. |
| **Target object** | `reorder_purchase_orders/{reorderRequestId}` + an append-only record in `reorder_purchase_order_voids/{reorderRequestId}` |
| **From state** | A recorded purchase order that has not been voided |
| **To state** | `VOIDED`, with a separate void record |
| **Current capability** | `reorder.purchaseOrder.void`, resolved fail-closed by the callable |
| **Current role/scope** | Capability **AND a record scope**: the actor must be the request's own `assignedToUserId`. Both survived the migration — the scope is now resolved server-side from the request document, against `request.auth.uid`, so the browser cannot assert it. |
| **Prerequisites** | Purchase order must exist; must not already be voided |
| **Side effects** | Writes the void record AND updates the linked reorder request — two documents, atomically |
| **Current audit action** | `voidPurchaseOrder`. Same note as Cancel above: new, and structural to the command pattern rather than added because it seemed desirable. |
| **Notes** | The append-only void record beside the mutated order is the tell: this is a reversal event, not an edit. Its multi-document atomicity is the reason it needs a real command rather than two calls. |

### Work Orders — lifecycle transitions

| Field | Measured value |
|---|---|
| **Domain** | Service / Work Orders |
| **Action** | Transitions inside `jobActions.runTransaction` |
| **Current implementation** | Client-direct Firestore `runTransaction` (`domain/jobActions.js`). **Class D — BLOCKED.** |
| **Target object** | `fieldops_wos` / `fieldops_jobs` |
| **From/To state** | Not yet enumerated — deliberately not measured in detail, because reading it invites designing it |
| **Current capability** | `workOrder.transition`, `workOrder.cancel` exist; a separate trusted `transitionWorkOrder` Cloud Function also exists |
| **Current role/scope** | **Includes assigned-technician/self scope** — this is why it is blocked |
| **Prerequisites** | Transition legality per the engine (ADR-002) |
| **Side effects** | Status change plus execution data |
| **Current audit action** | Not measured |
| **Notes** | There are already TWO write paths here — a deployed `transitionWorkOrder` callable and this client transaction. Reconciling them is its own decision, not a migration step. |

---

## CRUD

| Domain | Action | Why not a workflow |
|---|---|---|
| CRM | `contactImport` (`domain/contactImport.js`) | A bulk creation of contact records. No lifecycle, no state machine, no approval, no precondition beyond row validation, no governed side effect. It is creation of many rows in one round trip. **MIGRATED** to the trusted `importContacts` command (Owner ruling 2026-09-07, `crm.contact.create`) and **still CRUD** — moving the write to the server changed the authority, not the nature of the action. Writes **no audit event**, and that is measured rather than omitted: unlike the reorder commands, whose idempotency mechanism IS an audit document, a batch create needs no deterministic replay id, so adding one would be adding it merely because it seemed desirable. |
| Reorder | `reviewReorderRequest`, `assignReorderRequest`, `startPurchasing`, `updatePurchasingProgress` | **Provisionally CRUD — see UNCLEAR.** |

---

## UNCLEAR

| Domain | Action | Why unresolved |
|---|---|---|
| Reorder | `reviewReorderRequest` (APPROVED/REJECTED), `assignReorderRequest`, `startPurchasing` | Each moves the record between named statuses and changes `currentOwner`, which looks like a workflow. But they still run as client-direct store updates with no audit event and no capability check, so their *current implementation* is CRUD-shaped while their *behaviour* is transition-shaped. Classifying them either way now would prejudge whether the Workflows workstream adopts them. Recorded as-is. |
| Inventory | `recordInventoryAction` | **Retired** (Owner ruling 2026-08-30) — throws unconditionally, no writer remains. Listed only so a future reader does not rediscover it and assume it is live. |

---

## RESOLVED — the three capability blockers (Owner ruling 2026-09-07)

All three are authorized and minted. Dispatcher holds each explicitly through
`SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS`; administrator and owner acquire them through the
existing EOS composition, with **no duplicate grant rows added to restate that derivation**, and no
other Role receives them.

| Surface | Capability | Measured holders |
|---|---|---|
| `contactImport` (write) | `crm.contact.create` | admin, dispatcher, owner |
| `supplier` list (read) | `supplier.record.read` | admin, dispatcher, owner |
| `supplierCatalogItem` list (read) | `supplier.catalog.read` | admin, dispatcher, owner |

Identical to `crm.contact.read`, which migrated from the same `isAdminOrDispatcher()` predicate.
The owner difference is **accepted** by the ruling. `OWNER_PERMISSIONS` is unchanged and no
supplier-specific owner exception exists.

The reasoning behind each is preserved in `capability-parity-proposals.md`.

A measured parity proposal for each — exact Rules predicate, proposed capability id and meaning,
exact grants, proof that the proposed Role population matches the admitted one, scope, and why no
existing capability can be reused — is in **`capability-parity-proposals.md`**. Proposal only; it
mints nothing.

Deliberately NOT resolved here by minting the capabilities and granting them to the compatibility
roles, even though that would preserve exactly the current population. Granting capabilities is the
one thing this migration is not authorized to decide for itself, and doing it quietly — inside a
change whose entire purpose is to move authority somewhere it can be seen — would be the wrong
place to make an exception.

Consequence, stated plainly: `contactImport` still writes `contacts` directly from the browser, and
`field-ops-app-vite/src/metadata/firestoreListSource.js` still has live callers and cannot be
deleted. Both are one Owner decision away.

---

## Counts

- **WORKFLOW_CANDIDATE: 3** (cancelReorderRequest, voidPurchaseOrder, work-order transitions)
- **CRUD: 1 confirmed** (contactImport)
- **UNCLEAR: 4** (three reorder transitions, one retired action)

Counts are of *actions measured so far*, not of the system.

---

## The legacy `fieldops_jobs` surface — MEASURED, and mostly dead

Measured 2026-09-07 while migrating the last direct writes. Recorded here as measurement so the
later Workflows workstream starts from what this code actually did, rather than from memory of a
module that no longer exists.

**Three of `domain/jobActions.js`'s four exports had NO importer anywhere in `src/` or `test/`.**
They carried the last two client-direct Firestore `runTransaction` calls in the application, and
were **deleted** rather than migrated: minting permanent trusted-command authority, and the
capability grants that go with it, for a surface nothing calls would create authority for dead
product.

| Action | Class | What it did | Why it was dead |
|---|---|---|---|
| `assignJob` | **WORKFLOW_CANDIDATE** | Transaction over `fieldops_jobs` + `fieldops_technicians`: refused unless the technician was `available` (an **assignment-conflict** guard, thrown as `AssignmentConflictError`), then set the job to `ASSIGNED` with its `technicianId` AND the technician to `ON_JOB`. Two documents, one commit. | `Dispatch.jsx` is the canonical dispatch surface and assigns through the governed `transitionWorkOrder` transition against `fieldops_wos`. Its own header records that "the legacy assignJob() client transaction against fieldops_jobs is no longer used here." |
| `updateJobStatus` | **WORKFLOW_CANDIDATE** | Transaction: validated the transition through the pure `canTransitionJob()`, wrote the new job status, and on completion set the technician back to `AVAILABLE`. | No importer. `completionFlow.test.mjs` already asserts no legacy job write path remains in the completion flow. |
| `createJob` | CRUD | `jobsStore.add` — open, unassigned, no workOrderId. | No importer. |

**Authority these ran under** (retired Rules, `fieldops_jobs`): create and lifecycle/assignment
updates were `isAdminOrDispatcher()`; a technician could perform a **status-only** `assigned ->
in_progress` on their **own** job (`resource.data.technicianId == callerTechnicianId()` plus a
`hasOnly(['status'])` allowlist); a `complete` job was terminal for every client, and completion
itself was Function-only (`completeAssignedJob`).

**Audit behaviour:** none. Neither transaction wrote an audit event.

**Not resolved here, deliberately:** whether the `fieldops_jobs` object should exist at all
alongside `fieldops_wos`. Both were live once; the dispatch surface moved to work orders and the
job surface was left behind. That is a product decision, not a migration step.

### The one surviving direct write

| Action | Class | Status |
|---|---|---|
| `createTechnician` | CRUD | **STILL CLIENT-DIRECT.** One live caller (`modules/technicians/Technicians.jsx`), writing `fieldops_technicians` through `techniciansStore`. Blocked on a capability that does not exist — see `capability-parity-proposals.md`. |

