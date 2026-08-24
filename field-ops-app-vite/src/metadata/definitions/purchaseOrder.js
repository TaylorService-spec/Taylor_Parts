import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeGap, GAP_SEVERITY } from "../gapRegister.js";
import { UNSUPPORTED_REASON as WHY } from "../unsupportedReason.js";
import { makeColumn, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { PURCHASE_ORDERS_COLLECTION, PURCHASE_ORDER_STATUS } from "../../domain/constants.js";

// Purchase Order — S-COM-PURCHASE-ORDER-DEFINITION. Describes the LIVE `reorder_purchase_orders`
// collection (domain/reorderPurchaseOrders.js's recordPurchaseOrder()/voidPurchaseOrder(), the
// collection's only writers), NEVER the dormant Epic-5 `purchase_orders` collection
// (services/operationsQueries.ts's fetchPurchaseOrders/RawPurchaseOrder) — the two are
// unambiguously separate concepts, and domain/purchaseOrdersView.js's own header names the same
// guard: "do not wire that here". PURCHASE_ORDERS_COLLECTION (domain/constants.js) already
// resolves to the string "reorder_purchase_orders"; that constant, not a literal, is what this
// file imports.
//
// EACH DOCUMENT'S ID IS ITS OWN reorderRequestId, NOT AN AUTO-GENERATED ID — the 1:1-with-a-
// Reorder-Request execution record (domain/constants.js's own comment on the collection). This is
// also what makes "no duplicate Purchase Order per Reorder Request" a Firestore-enforced fact
// (firestore.rules' `allow update, delete: if false` turns a second write at the same id into a
// denied update), not just an application check.
//
// IDENTITY IS A nameField ONLY, AND THE GAP IS RECORDED RATHER THAN PAPERED OVER. This program's
// other reference-bearing entities (Work Order WO-YYYY-######, Opportunity OPP-YYYY-######, Sales
// Order SO-YYYY-######) all carry a SERVER-ALLOCATED, immutable numbering sequence
// (allocate*Number, a trusted callable/repository). NO SUCH SEQUENCE EXISTS HERE, and none exists
// on the linked Reorder Request either (grep across functions/src and src/domain finds no
// allocateReorderRequestNumber/allocatePurchaseOrderNumber anywhere) — there is no PO-YYYY-######
// today. Inventing one would be a business decision this lane does not own (the task brief is
// explicit on this point), so referenceField stays null and this paragraph is the recorded gap.
//
// externalPoNumber IS THE nameField, NOT PROMOTED TO referenceField. It is required (Rules:
// `request.resource.data.externalPoNumber is string && ...size() > 0`; recordPurchaseOrder()
// throws "External PO/reference number is required." without it) and it is what a human actually
// types and reads for this record — exactly identity's own contract for nameField ("the human name
// a person types or reads"). But it is the SUPPLIER's own external document number, transcribed by
// a Parts Associate — not server-allocated, not validated for uniqueness by Rules or by
// recordPurchaseOrder(), and not sequential. Declaring it as referenceField would misrepresent an
// ungoverned, vendor-supplied string as this program's own stable business reference, the same
// category error equipment.js's header names for serialNumber/assetTag (both look like references,
// neither is enforced as one) — except equipment.js had a genuine nameField (`name`) to fall back
// to, and could leave BOTH serialNumber/assetTag out of identity entirely. This record has no
// comparable second field, so externalPoNumber carries nameField instead of being left undeclared,
// which would violate the identity contract (a nameField or a referenceField is required) without
// describing anything truer.
//
// NO MONEY IS STORED ON THIS RECORD AT ALL — NOT CURRENCY_MINOR, NOT A FLOAT. Unlike salesOrder.js
// (a free-form currency string with no minor-unit amount beside it) and opportunity.js
// (expectedValue), reorder_purchase_orders has no price/amount/total field of any kind —
// firestore.rules' `hasOnly([...])` on create lists exactly ten keys (reorderRequestId, partId,
// supplierName, externalPoNumber, orderedQuantity, orderedDate, expectedArrivalDate, status,
// createdBy, createdAt) and none of them is a cost. orderedQuantity is a plain unit count
// (`is number && > 0`), not a monetary amount. This is not a gap to name; it is what the record
// actually is — a receipt-tracking stub, not a priced commercial document.
//
// status HAS EXACTLY ONE LEGAL VALUE, AND IT NEVER CHANGES. PURCHASE_ORDER_STATUS (domain/
// constants.js) declares only ORDERED; firestore.rules' create rule requires
// `request.resource.data.status == "ORDERED"` and `allow update, delete: if false` means no write
// path can ever set it to anything else — VOIDED is recorded on the LINKED reorder_requests
// document plus a separate, append-only reorder_purchase_order_voids record (out of this lane's
// writeScope), never on this collection's own status field. Declared as ENUM (a real, stored,
// enumerable field) but NOT filterable: an EQUALS/IN filter over a field that can only ever equal
// one value promises a query that answers nothing, the same restraint employee.js's securityRole
// and part.js's stockingUnit apply to fields a list would render but never usefully narrow by. No
// separate vocabulary module is created for a single-value enum with no other consumer — the label
// is declared inline below.
//
// THE VIEW STATUS (OPEN/RECEIVED/VOIDED/ORPHAN) IS COMPUTED, NOT STORED — NOT DECLARED HERE.
// domain/purchaseOrdersView.js's buildPurchaseOrderRow() derives it by joining THIS collection
// against the linked reorder_requests document's OWN status; it is not a field
// recordPurchaseOrder()/voidPurchaseOrder() ever writes to a reorder_purchase_orders document. The
// same restraint equipment.js's header applies to the inventory-control read (CONTROLLED/EXITED/
// NOT_STARTED/UNKNOWN, computed by domain/equipmentInventoryControlAdapter.js from a different
// cross-record join): v1 of this contract has no way to express a derived, cross-record read as
// metadata, and declaring viewStatus as a FieldDefinition would claim a stored value this
// collection does not have.
//
// LINE ITEMS DO NOT EXIST ON THIS RECORD — THERE IS NO EMBEDDED ARRAY AND NO SUBCOLLECTION.
// Unlike salesOrder.js's `lines` (an embedded array, left undeclared because no v1 FIELD_TYPE fits
// a struct), a reorder Purchase Order is 1:1 with a SINGLE Reorder Request for a SINGLE partId —
// there is no multi-line order shape to describe or omit here at all. partId is the one part this
// record concerns, declared as a REFERENCE field below.
//
// PROVENANCE IS PARTIAL, AND DECLARED AS WHAT IT ACTUALLY IS. createdBy/createdAt exist and are
// enforced at create (`createdBy == request.auth.uid`, `createdAt is number` — epoch milliseconds
// from `Date.now()` in recordPurchaseOrder(), never a Firestore Timestamp, so declared NUMBER, not
// TIMESTAMP, the same reasoning equipment.js and employee.js give for their own epoch-millisecond
// fields). THERE IS NO updatedAt/updatedBy, AND THAT IS NOT A GAP — `allow update, delete: if
// false` means this document is never updated after creation at all, so an updatedAt/updatedBy
// pair would describe a write path that structurally cannot exist, not an omission to remediate.
//
// partId IS A REFERENCE TO THE REGISTERED `part` ENTITY (part.js) — NOT FILTERABLE. Nothing
// server-side queries reorder_purchase_orders by partId today (usePurchaseOrdersByIds.js and
// hooks/useReorderPurchaseOrders.js both read by documentId(), never by a partId equality filter);
// declaring a filter here would promise a query this collection has never needed to serve, the
// same restraint salesOrder.js applies to ownerEmployeeId. supplierName stays a plain STRING, not
// a REFERENCE — it is literally a name string (not a supplierId), and no `supplier` entity is
// registered in this program regardless.
//
// orderedDate / expectedArrivalDate ARE DATE, NOT TIMESTAMP — plain `YYYY-MM-DD` strings from an
// HTML `<input type="date">` (modules/inventory/PartDetail.jsx's Record Purchase Order form),
// exactly the shape equipment.js's installedDate/warrantyExpiresDate already use. expectedArrivalDate
// is optional (Rules: `== null || is string`); orderedDate is required.
//
// READ PATH: CLIENT_DIRECT, gated in Rules by ROLE/RELATIONSHIP, NEVER BY A CAPABILITY. Read is
// admin/dispatcher OR a self-scoped PARTS_ASSOCIATE (the LINKED reorder_requests document's
// assignedToUserId must equal the caller — this collection has no assignedToUserId of its own).
// There is no `purchaseOrder.read` (or similar) in the real capability catalog gating this read —
// domain/reporting/reportCatalog.js's `report.purchaseOrder.read` is a DIFFERENT, wave-3,
// fieldsPopulated:false, still-inert governed-reporting id, not this Firestore read gate, and
// citing it here would conflate two unrelated authorization layers. readCapability is therefore
// null, the same finding contact.js/part.js/employee.js/equipment.js already record for their own
// role-gated collections.
//
// NO INDEX LIST FILTERS ARE DECLARED. The only real cross-collection query this domain area runs
// (services/operationsQueries.ts's fetchProcurementPurchaseOrders / PurchaseOrders.jsx) filters
// the LINKED reorder_requests collection by ITS OWN status, then joins by id — it never filters
// reorder_purchase_orders by a field of its own. status has exactly one legal value (see above), so
// filtering by it would be as empty a promise as filtering employee.securityRole. Declaring a
// partId or supplierName filter would be the same unjustified-filter mistake the Work Order lesson
// warns against (three optional filters demanded seven composites) — here there is not even one
// real query to justify a first one. defaultSort is createdAt DESC (most recent order first,
// matching the activity-order default salesOrder.js's own header explains its lack of a reliable
// timestamp to sort by — this collection DOES have one), with the __name__ tiebreaker. A single
// sort field with zero filters needs no composite index (Firestore's automatic single-field index
// already serves it) — requiredIndexes() confirms this in the test file.
//
// NO STANDALONE ROUTE RENDERS THIS INDEX YET — a definition is not a surface, the same restraint
// employee.js and part.js apply. modules/purchasing/PurchaseOrders.jsx already renders the real
// cross-request Purchasing surface, but through the joined reorder_requests+reorder_purchase_orders
// view-model (domain/purchaseOrdersView.js), not through this metadata contract.
//
// NO RELATED LIST IS DECLARED. The one real parent relationship this record has — its link to the
// Reorder Request that owns it — has no registered `reorderRequest` EntityDefinition anywhere in
// this program to own a `reorderRequest.purchaseOrders`-shaped edge (domain/reporting/
// reportCatalog.js's "reorderRequest" object exists only in the separate, inert governed-reporting
// catalog, not as a metadata EntityDefinition). Declaring a relationship or a RELATED list against
// an unregistered entity would target something this registry cannot validate, the same restraint
// equipment.js applies to its own undeclared account.equipment edge. See REGISTRATION_PENDING in
// this program's handoff.

export const purchaseOrderEntity = makeEntityDefinition({
  id: "purchaseOrder",
  label: "Purchase Order",
  labelPlural: "Purchase Orders",
  collection: PURCHASE_ORDERS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/relationship (admin/dispatcher, or a self-scoped PARTS_ASSOCIATE),
  // not by a capability. Recorded as null rather than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "externalPoNumber" }),
  description:
    "The reorder-request execution record recording a purchase was placed with a supplier — reorder_purchase_orders, " +
    "1:1 with a Reorder Request, doc id == reorderRequestId. Not the dormant Epic-5 purchase_orders collection — see the file header.",
  fields: [
    // Also the document id, and enforced to equal it at create
    // (`request.resource.data.reorderRequestId == requestId`). Declared as its own field, the
    // same shape part.js's partId and employee.js's employeeId take.
    makeFieldDefinition({
      id: "reorderRequestId",
      entityId: "purchaseOrder",
      label: "Reorder Request",
      type: "ID",
      description: "The Firestore document id, also written into the document body. Enforced equal to the doc id by firestore.rules at create.",
    }),
    makeFieldDefinition({
      id: "partId",
      entityId: "purchaseOrder",
      label: "Part",
      type: "REFERENCE",
      referenceTo: "part",
      description: "The single Part this Purchase Order concerns — there is no multi-line order shape on this record. Not filtered — see the file header.",
    }),
    makeFieldDefinition({
      id: "supplierName",
      entityId: "purchaseOrder",
      label: "Supplier",
      type: "STRING",
      sortable: true,
      description: "Required, non-empty (firestore.rules). A plain name string, not a supplierId — no `supplier` entity is registered in this program.",
    }),
    makeFieldDefinition({
      id: "externalPoNumber",
      entityId: "purchaseOrder",
      label: "External PO #",
      type: "STRING",
      sortable: true,
      description:
        "Required, non-empty (firestore.rules). The supplier's own external document number, transcribed by a Parts " +
        "Associate — NOT server-allocated, NOT enforced unique. The nameField half of identity; see the file header for " +
        "why this is not referenceField and why no PO-YYYY-###### exists.",
    }),
    makeFieldDefinition({
      id: "orderedQuantity",
      entityId: "purchaseOrder",
      label: "Ordered Qty",
      type: "NUMBER",
      description: "Required, > 0 (firestore.rules). A unit count, not a monetary amount — no money is stored on this record at all.",
    }),
    makeFieldDefinition({
      id: "orderedDate",
      entityId: "purchaseOrder",
      label: "Ordered Date",
      type: "DATE",
      sortable: true,
      description: "Required, non-empty string. A plain YYYY-MM-DD calendar date (HTML date input), not a Firestore Timestamp.",
    }),
    makeFieldDefinition({
      id: "expectedArrivalDate",
      entityId: "purchaseOrder",
      label: "Expected Arrival",
      type: "DATE",
      description: "Optional — null or a plain YYYY-MM-DD calendar date (firestore.rules: `== null || is string`), never a Firestore Timestamp.",
    }),
    // Rendered, not filtered — see the file header. Inline label (no separate vocabulary
    // module) because this is the collection's only enum and it has exactly one legal value.
    makeFieldDefinition({
      id: "status",
      entityId: "purchaseOrder",
      label: "Status",
      type: "ENUM",
      enumValues: [PURCHASE_ORDER_STATUS.ORDERED],
      enumLabels: { [PURCHASE_ORDER_STATUS.ORDERED]: "Ordered" },
      description:
        "Exactly one legal value, enforced at create and immutable thereafter (`allow update, delete: if false`). " +
        "VOIDED lives on the LINKED reorder_requests document plus a separate reorder_purchase_order_voids record, " +
        "never on this field. The OPEN/RECEIVED/VOIDED/ORPHAN view status is computed, not stored — see the file header.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "purchaseOrder",
      label: "Created By",
      type: "STRING",
      description: "Actor uid, enforced equal to the writer's own uid at create (firestore.rules). Every stored record carries one.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "purchaseOrder",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (`Date.now()` in recordPurchaseOrder()), never a Firestore Timestamp. No updatedAt/updatedBy — this document is never updated after creation.",
    }),
  ],
  // No relationships declared. The one real parent edge (Reorder Request -> Purchase Order) has
  // no registered `reorderRequest` entity to own it — see the file header and REGISTRATION_PENDING.
  // KNOWN LIMITATIONS, AS DATA — see metadata/gapRegister.js. Carried forward from the Purchase
  // Order structured-list migration (#1443), whose findings turned out to describe a DIFFERENT
  // collection from the one this entity models. That is the single most useful thing that trace
  // produced, so it is recorded here rather than lost with the retired contract.
  gaps: [
    makeGap({
      id: "PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION",
      title: "The authoritative purchase total is not on this record",
      entityId: "purchaseOrder",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NO_AUTHORITY,
      finding:
        "Two collections wear the name Purchase Order. This entity models the LIVE " +
        "reorder_purchase_orders, which has no price, amount or total field of any kind. The dormant " +
        "Epic-5 purchase_orders collection is where procurementService.createPurchaseOrder stores " +
        "totalCost = SUM(quantity x unitPrice), validated against empty line sets and negative prices.",
      consequence:
        "A Dollars column on THIS list would have nothing to read. The retired pilot contract declared " +
        "one, having traced the other collection — it was never mounted, so nothing shipped, but the " +
        "two-collections-one-name confusion is real and will catch the next reader too.",
      refused:
        "Pointing a Dollars column at the dormant collection from a list of live reorder records, or " +
        "deriving a total from quantity when this record stores no price at all.",
      resolution:
        "Financial Architecture decides which collection is the Purchase Order. Until then, money " +
        "questions belong to the collection that stores an amount.",
    }),
    makeGap({
      id: "PURCHASE_ORDER_TOTAL_UNIT_CONVENTION",
      title: "totalCost declares no currency and no unit",
      entityId: "purchaseOrder",
      severity: GAP_SEVERITY.MODELLING,
      finding:
        "On the dormant purchase_orders collection, totalCost is a plain number. It declares no " +
        "currency and carries no *Minor suffix, unlike invoiceCommands.ts's totalMinor or money.js's " +
        "explicit minor units. Major units are INFERRED from sumLineItems multiplying without a " +
        "scaling factor, and from procurementService's own validator comment calling an empty order " +
        "\"a $0 PO\".",
      consequence: "A 100x formatting error on a purchasing total is severe, and only an inference stands between.",
      refused: "Treating the inference as a declaration.",
      resolution: "A declared minor-unit migration, settled alongside Invoices, which already store totalMinor.",
    }),
    makeGap({
      id: "PURCHASE_ORDER_BUYER_NOT_AUTHORITATIVE",
      title: "Neither Purchase Order shape stores a buyer",
      entityId: "purchaseOrder",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NO_AUTHORITY,
      finding: "No buyer, requestedBy or orderedBy field exists on either collection.",
      refused:
        "Attributing one from createdBy audit metadata or fixture provenance. That makes a column out " +
        "of something the record cannot prove.",
    }),
    makeGap({
      id: "PURCHASE_ORDER_BUSINESS_LINE_NOT_DERIVABLE",
      title: "A Purchase Order has no single business line",
      entityId: "purchaseOrder",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NO_AUTHORITY,
      finding: "A PO carries no operating company, and its lines are Parts, which carry none either.",
      refused:
        "Assigning one by inference. A multi-line order may legitimately mix Taylor and Ventana parts, " +
        "so there is no single business line to assign even in principle.",
    }),
  ],
});

/**
 * The Purchase Order index. No standalone route renders this yet — a definition is not a
 * surface — but it is defined now so a future route has a real target, the same restraint
 * employee.index and part.index apply.
 *
 * NO FILTERS ARE DECLARED — see the file header for why neither partId nor status is a
 * justified filter here. defaultSort is createdAt DESC (most recent order first); a single
 * sort field with zero filters needs no composite index at all (requiredIndexes() confirms
 * this in the test file), so this list makes NO net-new demand against firestore.indexes.json.
 */
export const purchaseOrderIndexList = makeListViewDefinition({
  id: "purchaseOrder.index",
  entityId: "purchaseOrder",
  label: "Purchase Orders",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "externalPoNumber", sortable: true }),
    makeColumn({ fieldId: "supplierName", sortable: true }),
    makeColumn({ fieldId: "partId" }),
    makeColumn({ fieldId: "orderedQuantity" }),
    makeColumn({ fieldId: "orderedDate", sortable: true }),
    makeColumn({ fieldId: "status" }),
  ],
  filters: [],
  defaultSort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
  ],
});
