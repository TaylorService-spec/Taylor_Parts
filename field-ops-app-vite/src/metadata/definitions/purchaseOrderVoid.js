import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { REORDER_PURCHASE_ORDER_VOIDS_COLLECTION } from "../../domain/constants.js";

// Purchase Order Void — A-ENTITY-INVENTORY-ACTION-DEFINITIONS, the final DEFINE item of the
// entity-coverage reconciliation (docs/orchestration/metadata-program/
// entity-coverage-reconciliation.md §1.20). Describes the LIVE `reorder_purchase_order_voids`
// collection: an append-only, one-per-Purchase-Order record of WHY a Purchase Order was voided.
// Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
// reorder-request-cancellation.md). domain/reorderPurchaseOrders.js's voidPurchaseOrder() is the
// ONLY writer — its own comment states it directly.
//
// CORRECTS AN ASSUMPTION IN purchaseOrder.js'S OWN HEADER. That file's header (this lane's own
// writeScope does NOT include it, so it is not edited here — see REGISTRATION_PENDING) calls this
// collection "out of this lane's writeScope" in a way that could be misread as "unreadable" — it
// is not. This definition is exactly the fix: reorder_purchase_order_voids has a real, live,
// role-gated, cross-document-validated CLIENT_DIRECT read, confirmed directly against
// firestore.rules `match /reorder_purchase_order_voids/{reorderPurchaseOrderId}`. The
// reconciliation's own finding, verified again here rather than taken on faith.
//
// THE WRITE SHARES A GLOBAL KILL SWITCH WITH TWO ALREADY-MERGED SIBLINGS, NOT A
// COLLECTION-SPECIFIC BLOCK. voidPurchaseOrder() opens with `if (isWriteBlocked()) { ... return
// Promise.resolve({ blocked: true }); }` — but config/env.js's isWriteBlocked is `() => IS_DEMO ||
// window.__PANIC_MODE__`, the SAME demo-mode/panic gate reorderRequest.js's and purchaseOrder.js's
// own writers (createReorderRequest(), recordPurchaseOrder(), and every other domain write
// function in this app) already check. It is not evidence this collection is any less live or any
// less governed than those two already-merged siblings.
//
// EACH DOCUMENT'S ID IS THE SHARED reorderRequestId/reorderPurchaseOrderId — 1:1 with the Reorder
// Request AND with the linked reorder_purchase_orders record (purchaseOrder.js), the identical
// deterministic-id pattern purchaseOrder.js already documents for its own collection
// (`doc(db, REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, reorderRequestId)`,
// domain/reorderPurchaseOrders.js's voidPurchaseOrder()). firestore.rules turns a second void
// attempt at the same id into a denied update (`allow update, delete: if false`) — Firestore
// itself enforces "at most one void per Purchase Order", not just the transaction's own
// pre-existence check.
//
// A CROSS-DOCUMENT-VALIDATED, ATOMIC CREATE — the strongest field-level Rules contract either
// entity in this lane has. firestore.rules' `allow create` on this collection requires, in the
// SAME write: the caller to be admin/dispatcher AND the linked reorder_requests document's own
// assignedToUserId; that linked document's status to currently be "ORDERED"; a matching
// reorder_purchase_orders record to exist with status "ORDERED"; `request.resource.data` to
// `hasOnly` exactly the six keys below; `partId` to equal the linked Purchase Order's own partId;
// `voidedBy` to equal `request.auth.uid`; `reason` to be a non-blank string; `createdAt` to be a
// number; AND — an `existsAfter`/`getAfter` postcondition on the SAME transaction — the linked
// reorder_requests document to have transitioned to `status == "VOIDED"` with matching
// `voidedBy`/`voidedAt`/`voidReason` (`voidedAt == request.resource.data.createdAt`,
// `voidReason == request.resource.data.reason`). voidPurchaseOrder()'s own comment names this the
// same atomicity pattern recordPurchaseOrder() established for the ORDERED transition.
//
// voidedBy IS SERVER-VALIDATED, UNLIKE inventoryAction.js's createdBy — a real provenance
// distinction this lane surfaces deliberately. `request.resource.data.voidedBy == request.auth.uid`
// is enforced by firestore.rules itself, not merely assumed from the writer's own client code (the
// same server-authoritative posture purchaseOrder.js's own createdBy already documents). Recorded
// as STRING below, matching that precedent's "actor uid, not an employeeId, not a REFERENCE"
// reasoning — the same uid-space caveat reorderRequest.js's own header gives for its ten actor
// fields.
//
// createdAt IS CLIENT-CLOCK-STAMPED, NOT A SERVER TIMESTAMP — but its VALUE is cross-document
// pinned, not merely type-checked. voidPurchaseOrder() stamps a single local `now = Date.now()`
// and writes that SAME value as both this record's own createdAt AND the linked reorder_requests
// document's voidedAt (its own comment: "Stamps Date.now() into a local `now` variable exactly
// once ... never two separate Date.now() calls for one void event"). firestore.rules' own
// postcondition (`voidedAt == request.resource.data.createdAt`) enforces that agreement at write
// time. Still a plain client-clock epoch-millisecond NUMBER, never a Firestore Timestamp — the
// same NUMBER-not-TIMESTAMP treatment purchaseOrder.js's own createdAt already documents.
//
// IDENTITY: SYSTEM_ONLY, EXPLICITLY DECLARED. No human-typed name exists on this record — `reason`
// is a required free-text justification, not identity, the exact "reason is not a name" reasoning
// reorderRequest.js's own voidReason/cancellationReason fields already carry as plain TEXT rather
// than any identity role. No server-allocated business reference exists either — this collection
// has no *-YYYY-###### numbering sequence of its own, and reorderRequestId is an echo of the
// PARENT Reorder Request's own identity (BUSINESS_REFERENCE, reorderRequestNumber — a field this
// void record does not itself carry), not a reference this record originates. `identity:
// makeIdentity({ mode: "SYSTEM_ONLY" })` records the decision explicitly — SYSTEM_ONLY is never
// derived (resolveIdentityMode, entityDefinition.js).
//
// A SURFACE THAT NEEDS TO DESCRIBE ONE OF THESE ROWS TO A HUMAN MUST COMPOSE A DESCRIPTION FROM
// SEVERAL FIELDS: `reorderRequestId` (which Reorder Request/Purchase Order this voids — the
// related business reference this record's own event concerns), `partId` (which Part), `reason`
// (why), `voidedBy` (who), and `createdAt` (when). There is no single identity field to read
// instead.
//
// readVia IS CLIENT_DIRECT, READ CAPABILITY IS null. The real capability catalog
// (functions/src/access/permissionCatalog.ts) declares `reorder.purchaseOrder.void` — a WRITE-side
// id ("Void a reorder Purchase Order -- admin/dispatcher, or the recorded assignee only") — and no
// matching `reorder.purchaseOrder.void.read` or similar READ id exists anywhere in the catalog.
// Nothing evaluates a capability on this read path at all; Rules alone gate it (the same
// admin/dispatcher-or-self-scoped-PARTS_ASSOCIATE shape reorderRequest.js and purchaseOrder.js
// already record for their own collections). readCapability stays null.
//
// partId IS A REFERENCE TO THE REGISTERED `part` ENTITY (part.js) — echoed from the linked
// Purchase Order at create time (Rules enforces equality), never independently supplied.
// reorderRequestId IS A REFERENCE TO THE REGISTERED `reorderRequest` ENTITY (reorderRequest.js) —
// the same document this record's own id (reorderPurchaseOrderId) already names by value, declared
// separately because it is a distinct stored field the create rule independently validates
// (`request.resource.data.reorderRequestId == reorderPurchaseOrderId`).
//
// NO INDEX LIST VIEW IS DECLARED. No client code in this repository queries
// reorder_purchase_order_voids as a cross-request list — every real read is a single-document
// lookup by the shared id (the same reorderRequestId/reorderPurchaseOrderId a Purchase Order or
// Reorder Request page already has in hand). Declaring an INDEX list here would describe a query
// capability nothing serves. A RELATED list is not declared either: it would need a
// reorderRequestId-scoped relationship owned by the registered `reorderRequest` entity, which does
// not declare one to this collection today (reorderRequest.js declares a relationship to
// `purchaseOrder`, not to this void record) — adding it here would target an edge this registry
// cannot validate from the parent's own side. See REGISTRATION_PENDING.
//
// A KNOWN GAP, ALREADY REPORTED, NOT A BLOCKER TO DEFINING THIS ENTITY: the reconciliation found
// no consuming UI anywhere in field-ops-app-vite that calls voidPurchaseOrder() — the write path
// exists and is reachable in principle (same posture as its two merged siblings) but nothing in
// the shipped app currently exercises it. That is a UI-wiring gap, separate from whether this
// collection's shape can be honestly described, which is all this file does.
export const purchaseOrderVoidEntity = makeEntityDefinition({
  id: "purchaseOrderVoid",
  label: "Purchase Order Void",
  labelPlural: "Purchase Order Voids",
  collection: REORDER_PURCHASE_ORDER_VOIDS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // No matching read capability exists in the catalog — see the file header.
  readCapability: null,
  // SYSTEM_ONLY, explicitly declared. See the file header.
  identity: makeIdentity({ mode: "SYSTEM_ONLY" }),
  description:
    "An append-only, one-per-Purchase-Order record of why a reorder Purchase Order was voided — atomically " +
    "created alongside the linked Reorder Request's ORDERED -> VOIDED transition. See the file header.",
  fields: [
    // The Firestore document id, also written into the document body and enforced equal to it
    // at create (`request.resource.data.reorderPurchaseOrderId == reorderPurchaseOrderId`). Same
    // shape purchaseOrder.js's own reorderRequestId field takes for its own doc id.
    makeFieldDefinition({
      id: "reorderPurchaseOrderId",
      entityId: "purchaseOrderVoid",
      label: "Purchase Order",
      type: "ID",
      description: "The Firestore document id, also written into the document body. Enforced equal to the doc id by firestore.rules at create.",
    }),
    // A distinct stored field carrying the same value as the doc id, independently validated
    // by firestore.rules — see the file header. A real REFERENCE, not a redundant echo to ignore.
    makeFieldDefinition({
      id: "reorderRequestId",
      entityId: "purchaseOrderVoid",
      label: "Reorder Request",
      type: "REFERENCE",
      referenceTo: "reorderRequest",
      description: "The linked Reorder Request — enforced equal to this document's own id (== reorderPurchaseOrderId) by firestore.rules at create.",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "purchaseOrderVoid",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The Part the voided Purchase Order concerned — echoed from the linked Purchase Order at create; firestore.rules enforces equality.",
    }),
    // Server-validated, unlike inventoryAction.js's createdBy — see the file header.
    makeFieldDefinition({
      id: "voidedBy",
      entityId: "purchaseOrderVoid",
      label: "Voided By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid by firestore.rules at create. Not an employeeId; not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "reason",
      entityId: "purchaseOrderVoid",
      label: "Reason",
      type: "TEXT",
      description:
        "Required, non-blank (firestore.rules: `reason is string && reason.matches('.*\\\\S.*')`). Multi-line free " +
        "text, mirrored onto the linked reorder_requests document's own voidReason field in the same write.",
    }),
    // Client-clock-stamped but cross-document pinned — see the file header.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "purchaseOrderVoid",
      label: "Voided",
      type: "NUMBER",
      sortable: true,
      description:
        "Epoch milliseconds (`Date.now()` in voidPurchaseOrder()), never a Firestore Timestamp. firestore.rules " +
        "enforces this value equals the linked reorder_requests document's own voidedAt in the same write. No " +
        "updatedAt/updatedBy — this document is never updated after creation (allow update, delete: if false).",
    }),
  ],
  // No relationships declared. The one real parent edge (Reorder Request -> Purchase Order Void)
  // has no owning relationship declared on the registered `reorderRequest` entity today — see the
  // file header and REGISTRATION_PENDING.
});
