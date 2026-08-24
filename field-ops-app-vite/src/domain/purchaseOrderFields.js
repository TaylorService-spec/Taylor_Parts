// PURCHASE ORDER — the first post-pilot object migration, and the first list with real money on it.
//
// ============================ DOLLARS IS REAL HERE, AND THAT ASYMMETRY IS EXPLAINABLE ============================
//
// The Sales Order equivalent is blocked (SALES_ORDER_DOLLARS_GAP). The Purchase Order is not, and the
// difference is not an accident of which was built first:
//
//   PURCHASE ORDER   `unitPrice` is REQUIRED on every line. `procurementService.createPurchaseOrder`
//                    computes `totalCost = Σ(quantity × unitPrice)` and STORES it on the
//                    `purchase_orders` document at write time, after validation that rejects an empty
//                    line set, a non-positive quantity, or a negative unitPrice.
//
//   SALES ORDER      `unitPrice` is OPTIONAL and documented in the command as "NOT computed here";
//                    the read projection strips it; no total is stored anywhere.
//
// So a purchasing commitment has an authoritative number behind it and a sales order does not. The
// asymmetry is real, and normalising it by inventing sales money would be the wrong fix.
//
// ============================ WHAT DOLLARS MEANS, EXACTLY ============================
//
//   INCLUDES   the extended cost of every ordered line: Σ(quantity × unitPrice)
//   EXCLUDES   freight, tax, fees, discounts — NONE of which exist as fields on this document, so
//              their absence is a fact about the model rather than a choice made here
//   TIMING     the ORDERED commitment, stored at creation. Receiving does NOT change it; what has
//              arrived is a separate derived question (see `receiptState`)
//   CURRENCY   the document declares NONE. Single-currency, per money.js's USD default.
//
// ============================ THE UNIT, AND THE RESIDUAL RISK ============================
//
// `totalCost` is a plain `number`. The type declares no unit convention — unlike money.js (explicit
// minor units) and unlike `invoiceCommands.ts` (`totalMinor`).
//
// The evidence says MAJOR units: `sumLineItems` multiplies quantity by unitPrice with no scaling, and
// the validator's own comment calls an empty order "a $0 PO". So it is formatted as dollars.
//
// That is an inference from evidence, not a declaration, and it is recorded as
// PO_TOTAL_UNIT_CONVENTION so it is not mistaken for settled. A 100× formatting error on a purchasing
// total is severe, and the fix is a declared minor-unit migration in Financial Architecture — not a
// comment here hoping to be read.
import {
  FIELD_CATEGORY as C, FIELD_TYPE as T, OPERATOR, UNSUPPORTED_REASON as WHY,
  defineObjectFields,
} from "./fieldMetadata.js";

export const PURCHASE_ORDER_OBJECT = "Purchase Order";

/**
 * The stored PO lifecycle. A GENUINE sequence, which is what makes status sortable.
 *
 * `CANCELLED` sits last as a terminal exit rather than being spliced mid-sequence: a cancelled order
 * has left the flow, and placing it between SENT and RECEIVED would imply it is a step on the way.
 */
export const PO_STATUS_ORDER = Object.freeze(["DRAFT", "APPROVED", "SENT", "RECEIVED", "CANCELLED"]);

export const PO_STATUS_LABEL = Object.freeze({
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
});

/**
 * The DERIVED receipt state — a different question from the stored status, and never conflated.
 *
 * `status: SENT` says what the business did with the order. `receiptState: PARTIALLY_RECEIVED` says
 * what has physically arrived against it. Showing one as the other would let a screen claim a
 * persisted state the document never held.
 */
export const PO_RECEIPT_STATE_LABEL = Object.freeze({
  NOT_RECEIVED: "Nothing received",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Fully received",
});

/** The unit inference, recorded rather than buried in a comment. */
export const PO_TOTAL_UNIT_CONVENTION = Object.freeze({
  field: "totalCost",
  assumed: "MAJOR_UNITS",
  declared: false,
  evidence: Object.freeze([
    "sumLineItems multiplies quantity by unitPrice with no scaling factor",
    "procurementService's own validator comment describes an empty order as 'a $0 PO'",
    "no currency field and no *Minor suffix, unlike invoiceCommands.ts totalMinor",
  ]),
  risk: "A 100x formatting error on a purchasing total if the intent was ever minor units.",
  resolution: "Declare the unit explicitly (preferably a minor-unit migration) in Financial Architecture.",
});

/** Fields the PO genuinely cannot support, recorded so they are not silently missing. */
export const PO_FIELD_GAPS = Object.freeze([
  Object.freeze({
    gap: "PO BUYER FIELD NOT AUTHORITATIVE",
    finding: "Neither the canonical PO shape nor the procurement PO shape stores a buyer.",
    detail: "CanonicalPurchaseOrder carries supplierId/supplierName/status/lines/origin; the "
      + "procurement PurchaseOrder carries supplierId/status/items/totalCost/timestamps. No buyer, "
      + "requestedBy or orderedBy field exists on either.",
    refused: "Attributing a buyer from createdBy audit metadata or fixture provenance would make a "
      + "list column out of something the PO cannot prove.",
  }),
  Object.freeze({
    gap: "PO BUSINESS LINE NOT DERIVABLE",
    finding: "A Purchase Order carries no operating company, and its lines are Parts rather than "
      + "business-line-bearing records.",
    detail: "A PO may legitimately mix Taylor and Ventana parts, so there is no single business line "
      + "to assign even by inference.",
    refused: "Assigning one line of business to a mixed order would be inventing a fact the model "
      + "cannot hold.",
  }),
]);

export const PURCHASE_ORDER_FIELDS = defineObjectFields(PURCHASE_ORDER_OBJECT, [
  {
    id: "purchaseOrderNumber", category: C.OWNED, type: T.IDENTIFIER, label: "Purchase Order",
    source: "purchase_orders.purchaseOrderNumber (governed identity, never the document id)",
    defaultVisible: true, filterable: true, sortable: true, searchable: true,
  },
  {
    id: "status", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "purchase_orders.status", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
    // A GENUINE lifecycle, so it may be ordered. Contrast Sales Order status, which has none declared
    // anywhere in the domain and is therefore filterable but not sortable.
    statusOrder: PO_STATUS_ORDER,
  },
  {
    id: "createdAt", category: C.OWNED, type: T.DATETIME, label: "Created Date",
    source: "purchase_orders.createdAt",
    defaultVisible: true, filterable: true, sortable: true,
    // NOT labelled "Order Date". The document stores a creation timestamp and no separate ordered,
    // sent or approved date, and calling it "Order Date" would assert a business meaning the field
    // does not carry. When a real order date exists it becomes its own field.
    description: "When the PO record was created. The document holds no separate order/sent/approved date.",
  },
  {
    id: "vendor.name", category: C.RELATED, relatedObject: "Vendor", type: T.STRING,
    label: "Vendor", source: "purchase_orders.supplierName (denormalised on the canonical shape)",
    defaultVisible: true, unresolvedText: "Vendor unavailable", searchable: true,
    // TYPE IS STRING, NOT OBJECT_REF, and the validator is what made that clear: it refused
    // `CONTAINS` on an OBJECT_REF, correctly, because a reference is matched by identity rather than
    // by substring. What is STORED here is the supplier's NAME, denormalised onto the PO — so the
    // field genuinely is a string, and "contains" is a legitimate way to search it.
    //
    // That denormalisation is also why this list needs no per-row supplier lookup: FILTERABLE and
    // SORTABLE server-side, and no N+1 to avoid. It is the projection the Work Order's customer name
    // is missing, which is exactly why that one cannot be sorted.
    filterable: true, sortable: true,
    operators: [OPERATOR.IS, OPERATOR.CONTAINS, OPERATOR.STARTS_WITH],
  },
  {
    id: "dollars", category: C.FINANCIAL, type: T.CURRENCY, label: "Dollars",
    source: "purchase_orders.totalCost — stored at write as Σ(quantity × unitPrice)",
    defaultVisible: true, align: "right",
    // Sorting is UNIT-INVARIANT: ordering by the raw number is correct whichever unit it is in.
    filterable: true, sortable: true, reportable: true, exportable: true,
    operators: [OPERATOR.IS, OPERATOR.GREATER_THAN, OPERATOR.LESS_THAN, OPERATOR.BETWEEN],
    unresolvedText: "Unavailable",
    description: "Ordered commitment. Excludes freight, tax, fees and discounts — none of which exist "
      + "on this document. Unaffected by receiving.",
  },
  {
    id: "buyer.name", category: C.RELATED, relatedObject: "Buyer", type: T.PERSON,
    label: "Buyer", source: "NONE — see PO_FIELD_GAPS",
    // NOT DISPLAYABLE. The requirement stays in the contract; the column does not render, because
    // the PO cannot prove who bought.
    displayable: false, reportable: false, exportable: false,
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
    description: "Blocked: PO BUYER FIELD NOT AUTHORITATIVE.",
  },
  {
    id: "businessLine", category: C.RELATED, relatedObject: "Vendor", type: T.ENUM,
    label: "Business Line", source: "NONE — see PO_FIELD_GAPS",
    displayable: false, reportable: false, exportable: false,
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
    description: "Blocked: a PO may mix business lines, so there is no single value to assign.",
  },

  // ── DERIVED receipt progress ───────────────────────────────────────────────────────────────────
  //
  // Four fields, not one sentence. "18 ordered · 5 received · 13 remaining" reads fine and exposes
  // nothing: no column can be sorted by what is outstanding, and no filter can find part-received
  // orders.
  {
    id: "orderedQuantity", category: C.DERIVED, type: T.QUANTITY, label: "Ordered",
    source: "sum of CanonicalPoLine.quantity", align: "right", defaultVisible: true,
  },
  {
    id: "receivedQuantity", category: C.DERIVED, type: T.QUANTITY, label: "Received",
    source: "deriveReceiptState — sum of committed receipt lines", align: "right", defaultVisible: true,
  },
  {
    id: "remainingQuantity", category: C.DERIVED, type: T.QUANTITY, label: "Remaining",
    source: "deriveReceiptState — ordered minus received", align: "right", defaultVisible: true,
  },
  {
    id: "receiptState", category: C.DERIVED, type: T.ENUM, label: "Receipt State",
    source: "deriveReceiptState (NOT_RECEIVED | PARTIALLY_RECEIVED | RECEIVED)", defaultVisible: true,
    // DERIVED AT READ from committed receipts, so there is nothing stored to filter or order by --
    // and it is deliberately a SEPARATE field from `status`, which is what the business did with the
    // order rather than what has physically arrived.
  },
]);

/** The list's default order, and why it is not simply newest-first. */
export const PO_DEFAULT_SORT = Object.freeze({
  fieldId: "createdAt",
  direction: "desc",
  why: "Newest first matches the existing operational reading of the purchasing queue: the orders most "
    + "likely to need attention are the ones just raised. A user-selected sort overrides it explicitly.",
});
