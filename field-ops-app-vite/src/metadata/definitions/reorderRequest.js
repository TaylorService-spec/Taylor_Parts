import { makeEntityDefinition, makeFieldDefinition, makeIdentity, makeRelationshipDefinition } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { REORDER_REQUESTS_COLLECTION, REORDER_REQUEST_STATUS, REORDER_REQUEST_OWNER, QUANTITY_SOURCE } from "../../domain/constants.js";

// Reorder Request — A-ENTITY-PROCUREMENT-DEFINITIONS. Describes the LIVE `reorder_requests`
// collection (Sprint 2.1.3 Reorder Request & Notification Foundation, docs/BusinessEntityModel.md's
// Reorder Request entry; domain/inventoryReorderRequests.js's createReorderRequest() — the collection's
// SOLE creator; every subsequent transition is one of the eight self-contained `allow update` branches
// in firestore.rules' `match /reorder_requests/{requestId}` block, each written by its own dedicated
// domain function: reviewReorderRequest(), assignReorderRequest(), startPurchasing(),
// updatePurchasingProgress(), domain/reorderPurchaseOrders.js's recordPurchaseOrder()/voidPurchaseOrder(),
// receiveReorderRequest(), cancelReorderRequest()).
//
// THIS RECORD IS THE AUTHORITATIVE STATUS FOR THE ENTIRE PROCUREMENT LIFECYCLE, NOT THE LINKED
// reorder_purchase_orders DOCUMENT. purchaseOrder.js's own header records that a Purchase Order
// document's own `status` field has exactly one legal value ("ORDERED") and is immutable forever
// (`allow update, delete: if false`) — VOIDED and RECEIVED are NEVER written there. `status` on THIS
// entity is the one field that actually carries ORDERED -> RECEIVED / ORDERED -> VOIDED (and every
// earlier transition: PENDING_REVIEW -> READY_FOR_PARTS_MANAGER/REJECTED -> ASSIGNED_TO_PARTS_ASSOCIATE
// -> PURCHASING_IN_PROGRESS -> ORDERED -> RECEIVED|VOIDED, plus the CANCELLED terminal branch from any
// pre-ORDERED active status). domain/purchaseOrdersView.js's own header states this explicitly: "the
// authoritative 'these are the open POs' set is the ORDERED reorder_requests; VOIDED/RECEIVED requests
// are terminal history" — this is not a convenience read, it is where the fact of record actually lives.
// Any surface (or future metadata list) that wants to know whether a purchase is open, received, or
// voided must read THIS entity's `status`, never the linked Purchase Order's.
//
// status HAS 9 REAL LEGAL VALUES, NOT THE 10 NAMES IN REORDER_REQUEST_STATUS. Every value that
// `request.resource.data.status` is ever compared against or set to in firestore.rules — PENDING_REVIEW,
// REJECTED, READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS, ORDERED,
// RECEIVED, CANCELLED, VOIDED — was grepped and confirmed (9 distinct strings, firestore.rules lines
// ~665-996). REORDER_REQUEST_STATUS.APPROVED (domain/constants.js) is a real, exported constant, but a
// full-file grep for the literal `"APPROVED"` in firestore.rules finds exactly ONE occurrence, on
// `reviewDecision`, never on `status` — an Approve transition sets `status` to READY_FOR_PARTS_MANAGER
// and `reviewDecision` to APPROVED, two different fields. Declaring APPROVED as a legal `status` enum
// value would assert a stored state this field never actually takes. `reviewDecision` (declared
// separately below) is the field APPROVED actually belongs to, alongside REJECTED — its own two-value
// enum.
//
// PROVENANCE IS PER-TRANSITION, NOT A GENERIC createdAt/createdBy + updatedAt/updatedBy PAIR. This
// document is written far more than once (up to eight further updates across its lifecycle), yet there
// is no `updatedAt`/`updatedBy` anywhere in the canonical 36-key shape
// (hasCanonicalReorderRequestKeys(), firestore.rules) — instead EVERY transition stamps its OWN
// dedicated actor+timestamp pair, pinned unchanged by every later branch's affectedKeys(): `createdAt`
// (create, no actor field of its own — `requestedBy` serves that role at creation, enforced ==
// request.auth.uid), `reviewedBy`/`reviewedAt` (Approve/Reject), `assignedBy`/`assignedAt` (Assign),
// `purchasingStartedBy`/`purchasingStartedAt` (Start Purchasing), `lastPurchasingUpdateBy`/
// `lastPurchasingUpdateAt` (Post Purchasing Update — the one branch that is not itself a status
// transition), `orderedBy`/`orderedAt` (Record PO), `receivedBy`/`receivedAt` (Mark Received),
// `cancelledBy`/`cancelledAt` (Cancel), `voidedBy`/`voidedAt` (Void). This is a genuinely different,
// more granular provenance shape than the createdAt/createdBy(+updatedAt/updatedBy) pattern most other
// entities in this program use — recorded as what it actually is, not normalized into a shape it does
// not have. Every one of the ten actor fields is a plain Firebase Auth uid string (`request.auth.uid`),
// not an `employeeId` — functions/scripts/provisionEmployeeAccess.js links `employees/{employeeId}` to
// `users/{uid}` via a SEPARATE `userId`/`employeeId` cross-reference, they are not the same id space —
// so none of these ten fields is declared REFERENCE to the registered `employee` entity, the same
// STRING-not-REFERENCE reasoning purchaseOrder.js gives for its own `createdBy`.
//
// IDENTITY: BUSINESS_REFERENCE, PER THE OWNER'S RULING (A-IDENTITY-MODES,
// X-PROCUREMENT-ENTITIES-NO-IDENTITY). This definition previously held identity empty. Every
// candidate was checked against the real 36-key canonical shape and none was viable at the time:
//   - No server-allocated business reference existed. purchaseOrder.js's own header already established
//     this for the LINKED Purchase Order ("no such sequence exists ... on the linked Reorder Request
//     either" — grep across functions/src and src/domain confirms it again here: no
//     allocateReorderRequestNumber anywhere); there was no REQ-YYYY-###### family member the way
//     WO-/OPP-/SO- exist.
//   - No human-typed name field exists either. Unlike purchaseOrder.js's externalPoNumber (the
//     supplier's own transcribed document number — a real, if ungoverned, human-facing string), nothing
//     on this record is ever typed or read as this record's own name. `partId` is a REFERENCE to
//     another entity, not a name of this one. The live UI confirms the same conclusion from the
//     rendering side: modules/inventoryRole/PartsManagerHome.jsx's Relevant History table renders
//     `resolveName(request.partId)` — the linked PART's name, joined in, never a field of this record —
//     and modules/purchasing/PurchaseOrders.jsx (reading the SAME collection via
//     domain/purchaseOrdersView.js's join) falls back to printing the raw `reorderRequestId` in a
//     `<code>` element when no externalPoNumber exists on the linked PO, the exact document-id-as-label
//     pattern DECISIONS #106 forbids promoting into metadata identity.
//   - No category/status field was nominated as a stand-in either. This program's own orchestration
//     ledger (docs/orchestration/metadata-program/LEDGER.md, X-INVENTORY-TRANSACTION-NO-IDENTITY) names
//     "nominating a category field" as the exact anti-pattern that held a prior definition back.
//
// The Owner has now ruled: Reorder Request gets identityMode BUSINESS_REFERENCE, referenceField
// `reorderRequestNumber` (RR-YYYY-######). `identity: makeIdentity({ referenceField:
// "reorderRequestNumber" })` records the ruling. See the reorderRequestNumber field below: it is
// server-allocated by a numbering lane that does not yet exist, and it is absent on every
// existing document — declaring the field is not a claim that numbering is live, and no fallback
// to the document id is added while it is absent. Numbering + backfill tooling remain a separate
// lane's work — REGISTRATION_PENDING.
//
// readVia IS CLIENT_DIRECT, READ CAPABILITY IS null. firestore.rules' `allow read` on
// `reorder_requests/{requestId}` is five OR'd role/relationship branches (admin/dispatcher
// unconditionally; PARTS_MANAGER scoped to specific statuses or to requests this Parts Manager
// personally reviewed/assigned; PARTS_ASSOCIATE scoped to `assignedToUserId == request.auth.uid`) —
// there is no capability id evaluated anywhere on this read path, the identical finding purchaseOrder.js
// records for its own role-gated collection. Every real client query (hooks/useReorderRequests.js) is a
// plain `where()`-filtered `onSnapshot`/`getDocs` against this collection directly — never a callable.
//
// purchaseOrderId IS A REFERENCE TO THE REGISTERED `purchaseOrder` ENTITY (purchaseOrder.js), CLOSING
// PURCHASE ORDER'S OWN REGISTRATION_PENDING GAP. purchaseOrder.js's header explicitly deferred its
// Reorder-Request-to-Purchase-Order parent relationship because "no registered `reorderRequest` entity
// [existed] to own it". It now exists (this file); the ONE_TO_ONE relationship is declared below, viaField
// `reorderRequestId` (a real field on purchaseOrder.js, enforced equal to this document's own id by
// firestore.rules at create). This is the exact join domain/purchaseOrdersView.js performs by hand.
//
// workOrderId IS A REFERENCE TO THE REGISTERED `workOrder` ENTITY, OPTIONAL/NULLABLE, NO RELATIONSHIP
// DECLARED. WO Parts Planning Phase 3's back-link (firestore.rules' own comment: "Back-link/provenance
// only -- confers no Work Order lifecycle authority here and no procurement authority on the Work
// Order"). No relationship is declared for it because there is no reciprocal field on `workOrder.js`
// pointing back at a Reorder Request (workOrder.js was not read as part of this leaf lane's writeScope
// to add one) — declaring a relationship needs a real viaField on the TO entity, not just an id on this
// side. See REGISTRATION_PENDING.
//
// NO OTHER RELATIONSHIP IS DECLARED. There is no registered `receivingOrder` read path a runtime could
// ever traverse into (see receivingOrder.js's own header — readVia is UNKNOWN, not CALLABLE), so no
// reorder_requests -> receiving_orders edge is declared even though receiveInventoryStockCommand's
// governed input carries this document's id as its `source.reorderRequestId` provenance link.
//
// THE PURCHASING SURFACE THIS RECORD ULTIMATELY DRIVES (modules/purchasing/PurchaseOrders.jsx) IS NOT
// BACKED BY THE reorderRequestIndexList DECLARED BELOW. That surface's own header records an explicit
// "ATTEMPTED and DECLINED for cause" — the join against reorder_purchase_orders (for the
// VOIDED/RECEIVED/OPEN/ORPHAN ladder) is not expressible by the v1 ListViewDefinition contract, the same
// class of decline purchaseOrder.js's own index list already carries. reorderRequestIndexList below is a
// registry-only description of the ONE real composite query this collection actually serves
// (hooks/useReorderRequests.js's useReorderRequestsByStatuses(), backing that same surface's underlying
// read) — not a claim that a metadata-driven list renders the Purchasing page.
export const reorderRequestEntity = makeEntityDefinition({
  id: "reorderRequest",
  label: "Reorder Request",
  labelPlural: "Reorder Requests",
  collection: REORDER_REQUESTS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/relationship (admin/dispatcher, or a scoped PARTS_MANAGER/
  // PARTS_ASSOCIATE), not by a capability. Recorded as null rather than invented — see the header.
  readCapability: null,
  // BUSINESS_REFERENCE, per the Owner's ruling. See the file header.
  identity: makeIdentity({ referenceField: "reorderRequestNumber" }),
  description:
    "The procurement lifecycle record — reorder_requests. THE authoritative status for the whole " +
    "Inventory -> Parts Manager -> Parts Associate -> Purchase -> Receive chain; the linked " +
    "reorder_purchase_orders document's own `status` never changes after creation. Identity is " +
    "reorderRequestNumber (RR-YYYY-######), server-allocated by a numbering lane not yet built and " +
    "absent on every existing document — see the file header.",
  fields: [
    // THE identity.referenceField, PER THE OWNER'S RULING — see the file header.
    makeFieldDefinition({
      id: "reorderRequestNumber",
      entityId: "reorderRequest",
      label: "Reorder Request",
      type: "STRING",
      sortable: true,
      description:
        "RR-YYYY-######, the identity.referenceField per the Owner's identity-modes ruling (A-IDENTITY-MODES, " +
        "X-PROCUREMENT-ENTITIES-NO-IDENTITY). Server-allocated at creation by a numbering lane that does not " +
        "yet exist — no allocateReorderRequestNumber (or equivalent) is implemented anywhere in this " +
        "repository. ABSENT ON EVERY EXISTING (LEGACY) reorder_requests document. A renderer must not fall " +
        "back to the Firestore document id when this field is missing; an honest empty/placeholder state is " +
        "required instead, per the Owner's ruling that documentId must never be exposed while legacy " +
        "references are absent.",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "reorderRequest",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The Part this request concerns. Required, non-empty (firestore.rules).",
    }),
    makeFieldDefinition({
      id: "recommendationStatus",
      entityId: "reorderRequest",
      label: "Recommendation",
      type: "ENUM",
      enumValues: ["READY", "NEEDS_PLANNING"],
      enumLabels: { READY: "Analytics-ready", NEEDS_PLANNING: "Needs planning" },
      description:
        "Immutable audit fact set at create (docs/specifications/inventory-zero-history-reorder-behavior.md). " +
        "READY means requestedQty came from the analytics engine; NEEDS_PLANNING means no usage history existed " +
        "and a manager entered the quantity by hand.",
    }),
    makeFieldDefinition({
      id: "urgency",
      entityId: "reorderRequest",
      label: "Urgency",
      type: "ENUM",
      enumValues: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      enumLabels: { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" },
      description:
        "Required and one of these four for a READY request; null for a NEEDS_PLANNING request " +
        "(firestore.rules' branch-scoped create rule) — nullable, not always present.",
    }),
    makeFieldDefinition({
      id: "quantitySource",
      entityId: "reorderRequest",
      label: "Quantity Source",
      type: "ENUM",
      enumValues: [QUANTITY_SOURCE.ANALYTICS, QUANTITY_SOURCE.MANUAL_ZERO_HISTORY],
      enumLabels: { [QUANTITY_SOURCE.ANALYTICS]: "Analytics-computed", [QUANTITY_SOURCE.MANUAL_ZERO_HISTORY]: "Manually entered" },
      description: "Required. Distinguishes an analytics-computed requestedQty from a manually entered one when no usage history existed.",
    }),
    makeFieldDefinition({
      id: "recommendedQty",
      entityId: "reorderRequest",
      label: "Recommended Qty (historical snapshot)",
      type: "NUMBER",
      description: "The analytics engine's snapshot at request time. null for a NEEDS_PLANNING request — a unit count, never money.",
    }),
    makeFieldDefinition({
      id: "requestedQty",
      entityId: "reorderRequest",
      label: "Requested Qty",
      type: "NUMBER",
      description: "The actionable quantity. A whole number; >= 0 for READY, > 0 for NEEDS_PLANNING (firestore.rules). A unit count, never money.",
    }),
    // 9 real legal values, not the 10 names in REORDER_REQUEST_STATUS — see the file header for why
    // APPROVED is excluded (it is a real reviewDecision value, never a real status value).
    makeFieldDefinition({
      id: "status",
      entityId: "reorderRequest",
      label: "Status",
      type: "ENUM",
      filterable: true,
      operators: ["IN"],
      enumValues: [
        REORDER_REQUEST_STATUS.PENDING_REVIEW,
        REORDER_REQUEST_STATUS.REJECTED,
        REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER,
        REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
        REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
        REORDER_REQUEST_STATUS.ORDERED,
        REORDER_REQUEST_STATUS.RECEIVED,
        REORDER_REQUEST_STATUS.CANCELLED,
        REORDER_REQUEST_STATUS.VOIDED,
      ],
      enumLabels: {
        [REORDER_REQUEST_STATUS.PENDING_REVIEW]: "Pending review",
        [REORDER_REQUEST_STATUS.REJECTED]: "Rejected",
        [REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER]: "Ready for Parts Manager",
        [REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE]: "Assigned",
        [REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS]: "Purchasing in progress",
        [REORDER_REQUEST_STATUS.ORDERED]: "Ordered",
        [REORDER_REQUEST_STATUS.RECEIVED]: "Received",
        [REORDER_REQUEST_STATUS.CANCELLED]: "Cancelled",
        [REORDER_REQUEST_STATUS.VOIDED]: "Voided",
      },
      description:
        "THE authoritative procurement lifecycle status — see the file header. Filterable by IN only " +
        "(hooks/useReorderRequests.js's useReorderRequestsByStatuses() is the one real composite-index-backed " +
        "query; firestore.indexes.json declares status ASC + createdAt DESC for exactly this).",
    }),
    makeFieldDefinition({
      id: "currentOwner",
      entityId: "reorderRequest",
      label: "Current Owner",
      type: "ENUM",
      enumValues: [REORDER_REQUEST_OWNER.INVENTORY, REORDER_REQUEST_OWNER.PARTS_MANAGER, REORDER_REQUEST_OWNER.PARTS_ASSOCIATE],
      enumLabels: {
        [REORDER_REQUEST_OWNER.INVENTORY]: "Inventory",
        [REORDER_REQUEST_OWNER.PARTS_MANAGER]: "Parts Manager",
        [REORDER_REQUEST_OWNER.PARTS_ASSOCIATE]: "Parts Associate",
      },
      description: "A coarse, role-level ownership marker — not the same as assignedToUserId, which carries the per-user identity once assigned.",
    }),
    makeFieldDefinition({
      id: "requestedBy",
      entityId: "reorderRequest",
      label: "Requested By",
      type: "STRING",
      description: "Actor uid, enforced equal to the writer's own uid at create (firestore.rules). Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "reorderRequest",
      label: "Requested",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (Date.now(), firebase/collectionStore.js's add()), never a Firestore Timestamp. The Reorder Requested event timestamp; never rewritten.",
    }),
    makeFieldDefinition({
      id: "reviewedBy",
      entityId: "reorderRequest",
      label: "Reviewed By",
      type: "STRING",
      description: "Actor uid set on Approve/Reject; null until then. Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "reviewedAt",
      entityId: "reorderRequest",
      label: "Reviewed",
      type: "NUMBER",
      description: "Epoch milliseconds, set on Approve/Reject; null until then.",
    }),
    makeFieldDefinition({
      id: "reviewDecision",
      entityId: "reorderRequest",
      label: "Review Decision",
      type: "ENUM",
      enumValues: [REORDER_REQUEST_STATUS.APPROVED, REORDER_REQUEST_STATUS.REJECTED],
      enumLabels: { [REORDER_REQUEST_STATUS.APPROVED]: "Approved", [REORDER_REQUEST_STATUS.REJECTED]: "Rejected" },
      description:
        "The APPROVED/REJECTED decision fact — a SEPARATE field from status (see the file header: APPROVED " +
        "is never a legal `status` value). null until reviewed.",
    }),
    makeFieldDefinition({
      id: "reviewNotes",
      entityId: "reorderRequest",
      label: "Review Notes",
      type: "TEXT",
      description: "Required non-empty on Reject (firestore.rules); null on Approve or before review. Multi-line free text (ConfirmDialog's textarea).",
    }),
    makeFieldDefinition({
      id: "assignedToUserId",
      entityId: "reorderRequest",
      label: "Assigned To",
      type: "STRING",
      description:
        "The manually-entered target uid a Parts Manager assigns this request to; null until assigned. Not a " +
        "REFERENCE — no client-side user list validates it (firestore.rules' own comment), and it is a Firebase " +
        "Auth uid, not an employeeId. Also the field per-user-scoped PARTS_ASSOCIATE reads and writes key off.",
    }),
    makeFieldDefinition({
      id: "assignedBy",
      entityId: "reorderRequest",
      label: "Assigned By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid on Assign; null until then. Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "assignedAt",
      entityId: "reorderRequest",
      label: "Assigned",
      type: "NUMBER",
      description: "Epoch milliseconds, set on Assign; null until then.",
    }),
    makeFieldDefinition({
      id: "purchasingStartedAt",
      entityId: "reorderRequest",
      label: "Purchasing Started",
      type: "NUMBER",
      description: "Epoch milliseconds, set on Start Purchasing (assignee-only); null until then.",
    }),
    makeFieldDefinition({
      id: "purchasingStartedBy",
      entityId: "reorderRequest",
      label: "Purchasing Started By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid == assignedToUserId on Start Purchasing; null until then. Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "purchasingNotes",
      entityId: "reorderRequest",
      label: "Purchasing Notes",
      type: "TEXT",
      description: "Informal free-text progress notes (domain/inventoryReorderRequests.js's updatePurchasingProgress()); null until the first post.",
    }),
    makeFieldDefinition({
      id: "vendorContacted",
      entityId: "reorderRequest",
      label: "Vendor Contacted",
      type: "BOOLEAN",
      description: "Set by updatePurchasingProgress() (a plain boolean checkbox); null until the first purchasing-progress post.",
    }),
    makeFieldDefinition({
      id: "expectedAvailabilityDate",
      entityId: "reorderRequest",
      label: "Expected Availability",
      type: "DATE",
      description: "Plain YYYY-MM-DD string (PartDetail.jsx's HTML date input), never a Firestore Timestamp. null until set.",
    }),
    makeFieldDefinition({
      id: "lastPurchasingUpdateAt",
      entityId: "reorderRequest",
      label: "Last Purchasing Update",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds of the most recent Post Purchasing Update; null until the first post.",
    }),
    makeFieldDefinition({
      id: "lastPurchasingUpdateBy",
      entityId: "reorderRequest",
      label: "Last Purchasing Update By",
      type: "STRING",
      description: "Actor uid of the most recent Post Purchasing Update; null until then. Not a REFERENCE — see the file header.",
    }),
    // Closes purchaseOrder.js's own REGISTRATION_PENDING gap — see the file header. Enforced equal to
    // this document's own id at the ORDERED transition (firestore.rules: `purchaseOrderId == requestId`).
    makeFieldDefinition({
      id: "purchaseOrderId",
      entityId: "reorderRequest",
      label: "Purchase Order",
      type: "REFERENCE",
      referenceTo: "purchaseOrder",
      description: "The linked reorder_purchase_orders document — 1:1, same id as this document. null until the ORDERED transition (Record PO).",
    }),
    makeFieldDefinition({
      id: "orderedBy",
      entityId: "reorderRequest",
      label: "Ordered By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid == assignedToUserId on Record PO; null until then. Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "orderedAt",
      entityId: "reorderRequest",
      label: "Ordered",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds, set on Record PO; null until then.",
    }),
    makeFieldDefinition({
      id: "receivedBy",
      entityId: "reorderRequest",
      label: "Received By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid == assignedToUserId on Mark Received; null until then. Not a REFERENCE — see the file header.",
    }),
    makeFieldDefinition({
      id: "receivedAt",
      entityId: "reorderRequest",
      label: "Received",
      type: "NUMBER",
      description:
        "Epoch milliseconds, set on Mark Received (Sprint 2.1.11 closeout note only — does NOT write " +
        "inventory_transactions, ADR-003); null until then.",
    }),
    makeFieldDefinition({
      id: "cancelledBy",
      entityId: "reorderRequest",
      label: "Cancelled By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid on Cancel (admin/dispatcher only, not assignee-restricted); null until then. Not a REFERENCE.",
    }),
    makeFieldDefinition({
      id: "cancelledAt",
      entityId: "reorderRequest",
      label: "Cancelled",
      type: "NUMBER",
      description: "Epoch milliseconds, set on Cancel; null until then.",
    }),
    makeFieldDefinition({
      id: "cancellationReason",
      entityId: "reorderRequest",
      label: "Cancellation Reason",
      type: "TEXT",
      description: "Required non-blank on Cancel (firestore.rules' .matches('.*\\\\S.*')); null until then. Multi-line free text (ConfirmDialog's textarea).",
    }),
    makeFieldDefinition({
      id: "voidedBy",
      entityId: "reorderRequest",
      label: "Voided By",
      type: "STRING",
      description: "Actor uid, enforced == request.auth.uid == assignedToUserId AND admin/dispatcher on Void; null until then. Not a REFERENCE.",
    }),
    makeFieldDefinition({
      id: "voidedAt",
      entityId: "reorderRequest",
      label: "Voided",
      type: "NUMBER",
      description: "Epoch milliseconds, set on Void; null until then.",
    }),
    makeFieldDefinition({
      id: "voidReason",
      entityId: "reorderRequest",
      label: "Void Reason",
      type: "TEXT",
      description: "Required non-blank on Void, bound to the linked reorder_purchase_order_voids record's own reason; null until then. Multi-line free text.",
    }),
    // WO Parts Planning Phase 3 — optional provenance back-link, permitted but not required. See the
    // file header for why no relationship (not just a field) is declared for it.
    makeFieldDefinition({
      id: "workOrderId",
      entityId: "reorderRequest",
      label: "Work Order",
      type: "REFERENCE",
      referenceTo: "workOrder",
      description: "Optional Work Order provenance back-link (which demand caused this request). Confers no lifecycle authority in either direction.",
    }),
  ],
  relationships: [
    makeRelationshipDefinition({
      id: "purchaseOrder",
      label: "Purchase Order",
      fromEntityId: "reorderRequest",
      toEntityId: "purchaseOrder",
      viaField: "reorderRequestId",
      cardinality: "ONE_TO_ONE",
      // Rules gate the read the same role/relationship way as reorderRequest's own read — no capability
      // evaluates this traversal.
      traversalCapability: null,
    }),
  ],
});

/**
 * The Reorder Request index. No standalone route renders this yet — a definition is not a surface,
 * the same restraint purchaseOrder.index/employee.index/part.index apply. It is a registry-only
 * description of the ONE real composite-index-backed query this collection serves
 * (useReorderRequestsByStatuses()) — NOT a claim that it backs modules/purchasing/PurchaseOrders.jsx,
 * which is declined for cause (see the file header).
 *
 * status IS THE ONE DECLARED FILTER, REQUIRED (every real caller of this exact query always supplies
 * it — PurchaseOrders.jsx's PO_REQUEST_STATUSES is a fixed [ORDERED, RECEIVED, VOIDED] constant, never
 * called unfiltered). defaultSort is createdAt DESC (most recent request first), matching
 * firestore.indexes.json's already-declared composite (status ASC, createdAt DESC) exactly —
 * requiredIndexes() confirms this makes NO net-new demand in the test file.
 */
export const reorderRequestIndexList = makeListViewDefinition({
  id: "reorderRequest.index",
  entityId: "reorderRequest",
  label: "Reorder Requests",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "partId" }),
    makeColumn({ fieldId: "status" }),
    makeColumn({ fieldId: "urgency" }),
    makeColumn({ fieldId: "requestedQty" }),
    makeColumn({ fieldId: "createdAt", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "status", operators: ["IN"], required: true })],
  defaultSort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
  ],
});
