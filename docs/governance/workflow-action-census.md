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
| **Current implementation** | Client-direct Firestore `runTransaction` (`domain/inventoryReorderRequests.js`). Class C in the write census — awaiting its trusted command. |
| **Target object** | `reorder_requests/{id}` |
| **From state** | Any status for which `isCancellableReorderRequestStatus()` is true (`domain/reorderRequestCancelGuard.js`) |
| **To state** | `CANCELLED` |
| **Current capability** | `reorder.request.cancel` exists in the catalog; the client-direct path does not resolve it — it ran under the old Rules grant |
| **Current role/scope** | Role-level (admin/dispatcher under the retired Rule). No record or self scope. |
| **Prerequisites** | Request must exist; status must be cancellable; a non-empty reason is required |
| **Side effects** | Writes `cancelledBy`, `cancelledAt`, `cancellationReason`; fires the reorder change signal so other components refresh |
| **Current audit action** | **None** — the client transaction writes no audit event. A trusted command would add one. |
| **Notes** | The state guard is already a pure, tested module, which is what makes this a transition rather than an update. |

### Purchasing — void a purchase order

| Field | Measured value |
|---|---|
| **Domain** | Purchasing |
| **Action** | `voidPurchaseOrder` |
| **Current implementation** | Client-direct Firestore `runTransaction` (`domain/reorderPurchaseOrders.js`). Class C. |
| **Target object** | `reorder_purchase_orders/{reorderRequestId}` + an append-only record in `reorder_purchase_order_voids/{reorderRequestId}` |
| **From state** | A recorded purchase order that has not been voided |
| **To state** | `VOIDED`, with a separate void record |
| **Current capability** | `reorder.purchaseOrder.void` exists in the catalog |
| **Current role/scope** | Role-level. No record or self scope. |
| **Prerequisites** | Purchase order must exist; must not already be voided |
| **Side effects** | Writes the void record AND updates the linked reorder request — two documents, atomically |
| **Current audit action** | **None** from the client path |
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
| CRM | `contactImport` (`domain/contactImport.js`) | A bulk `writeBatch` of contact records. No lifecycle, no state machine, no approval, no precondition beyond row validation, no governed side effect. It is creation of many rows in one round trip. Class C only because it is a direct client write, **not** because it is a business action. |
| Reorder | `reviewReorderRequest`, `assignReorderRequest`, `startPurchasing`, `updatePurchasingProgress` | **Provisionally CRUD — see UNCLEAR.** |

---

## UNCLEAR

| Domain | Action | Why unresolved |
|---|---|---|
| Reorder | `reviewReorderRequest` (APPROVED/REJECTED), `assignReorderRequest`, `startPurchasing` | Each moves the record between named statuses and changes `currentOwner`, which looks like a workflow. But they still run as client-direct store updates with no audit event and no capability check, so their *current implementation* is CRUD-shaped while their *behaviour* is transition-shaped. Classifying them either way now would prejudge whether the Workflows workstream adopts them. Recorded as-is. |
| Inventory | `recordInventoryAction` | **Retired** (Owner ruling 2026-08-30) — throws unconditionally, no writer remains. Listed only so a future reader does not rediscover it and assume it is live. |

---

## Counts

- **WORKFLOW_CANDIDATE: 3** (cancelReorderRequest, voidPurchaseOrder, work-order transitions)
- **CRUD: 1 confirmed** (contactImport)
- **UNCLEAR: 4** (three reorder transitions, one retired action)

Counts are of *actions measured so far*, not of the system.
