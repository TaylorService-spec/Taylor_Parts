import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeGap, GAP_SEVERITY } from "../gapRegister.js";
import { UNSUPPORTED_REASON as WHY } from "../unsupportedReason.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { SALES_ORDER_STATE_VALUES, SALES_ORDER_STATE_LABEL } from "../../domain/salesOrderStatus.js";
import { SALES_CHANNELS, CHANNEL_LABEL } from "../../domain/opportunityLifecycle.js";

// Sales Order — the committed commercial order that follows a WON Opportunity. The second
// CALLABLE-read entity in the program, and the first whose identity field is not yet returned
// by its own read projection (see the salesOrderNumber note below).
//
// READ IS A TRUSTED CALLABLE, NOT A CLIENT QUERY. `sales_orders` is deny-all in Firestore
// Rules; getSalesOrderContext (one order, by id) and listSalesOrdersForAccount (account-scoped)
// are the only ways in (functions/src/salesOrder/salesOrderReadService.ts). Declared readVia
// CALLABLE for the same reason Opportunity is: the server owns the query, and readCallable
// names listSalesOrdersForAccount rather than the single-record read, matching the entity-level
// choice opportunity.js already made (the account-scoped list is what a related section and an
// index surface actually page through).
//
// THE CAPABILITY IS REGISTERED AND INACTIVE. salesOrder.read exists in the catalog with
// active:false (Owner-ratified 2026-08-15), so it currently denies everyone. Declaring it here
// is still correct — see opportunity.js's identical note: register is not grant.
//
// IDENTITY IS THE REFERENCE, WITH NO nameField. A Sales Order has no human-entered name field
// at all — declaring one to satisfy the identity contract would be inventing data, not
// describing it. salesOrderNumber (SO-YYYY-######) is server-allocated at creation
// (allocateSalesOrderNumber, functions/src/salesOrder/salesOrderNumbering.ts) and immutable, so
// it is the correct referenceField.
//
// A KNOWN GAP, STATED RATHER THAN PAPERED OVER: SalesOrderProjection (the shape
// getSalesOrderContext/listSalesOrdersForAccount actually return) does not yet include
// salesOrderNumber, even though every Sales Order created after the numbering rollout stores
// one. That is a read-wiring gap, not a reason to fall back to a document id — the exact defect
// #1124 corrected on Sales Orders once already, which is why SalesOrderDetail's header is a
// separate tracked item (X-SALES-ORDER-HEADER) closing the same gap on the surface that renders
// it. Declaring the identity here describes what the record IS; it does not claim the current
// projection already carries it end to end.
//
// unitPrice IS NOT DECLARED. PR #991 deliberately excluded it from the read projection — no
// pricing policy exists on this surface — and `lines` itself is an embedded array on the
// document, not a flat column any list here could render; both are left undeclared rather than
// approximated.
//
// THE ORDER CARRIES THE SALE'S MONEY, AND THIS FILE USED TO SAY IT DID NOT.
//
// The previous version of this comment stated there was "no minor-unit amount stored anywhere
// beside" currency. That was wrong, and it was wrong in the direction that removed a column
// nobody could then ask for. Every Sales Order LINE stores `unitPrice` in integer minor units,
// and it is already authoritative: functions/src/finance/invoiceCommands.ts snapshots it as
// `unitPriceMinor`, REFUSES to bill a line that has none (UNPRICED), and REFUSES any invoice
// price that disagrees with it (PRICE_MISMATCH). Billing is derived from this number; the order
// is its source.
//
// `totalMinor` below is that money, summed over the order's lines and projected server-side by
// salesOrderReadService.ts. It travels beside `currency`, which is the sibling the
// CURRENCY_MINOR renderer reads from the row — so an amount never borrows a currency symbol its
// own record does not carry.
//
// STATE LABELS COME FROM domain/salesOrderStatus.js, never a second copy here — the same rule
// workOrder.js's status field follows, for the workOrderStatus.js/#1093 reason it names.

export const salesOrderEntity = makeEntityDefinition({
  id: "salesOrder",
  label: "Sales Order",
  labelPlural: "Sales Orders",
  collection: "sales_orders",
  readVia: "CALLABLE",
  readCallable: "listSalesOrdersForAccount",
  readCapability: "salesOrder.read",
  identity: makeIdentity({ referenceField: "salesOrderNumber" }),
  description: "The committed commercial order following a WON Opportunity. Deny-all in Rules; read only through governed callables.",
  fields: [
    makeFieldDefinition({
      id: "salesOrderNumber",
      entityId: "salesOrder",
      label: "Sales Order",
      type: "STRING",
      sortable: true,
      description: "SO-YYYY-######, server-allocated at creation and immutable. Not yet returned by the read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "state",
      entityId: "salesOrder",
      label: "State",
      type: "ENUM",
      enumValues: [...SALES_ORDER_STATE_VALUES],
      enumLabels: SALES_ORDER_STATE_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
    }),
    makeFieldDefinition({
      id: "salesChannel",
      entityId: "salesOrder",
      label: "Channel",
      type: "ENUM",
      // The same channel set Opportunity uses, sourced from the same module rather than a
      // second copy — salesOrderLifecycle.ts keeps its own server-side SALES_CHANNELS in sync
      // with opportunityLifecycle.ts for exactly this reason.
      enumValues: [...SALES_CHANNELS],
      enumLabels: CHANNEL_LABEL,
    }),
    // WHAT THE SALE IS WORTH. Integer minor units, in this order's own `currency`.
    //
    // NULL IS NOT ZERO, and the projection guarantees the difference: a line's `unitPrice` is
    // OPTIONAL, so an order can be partly priced, and a sum over the priced lines would be a
    // real number that is not the sale's total. The server populates this ONLY when every line
    // carries a committed price, and reports `pricingState` / `unpricedLineCount` otherwise —
    // so this column renders an amount or it renders nothing. It never renders 0.00 for
    // "we don't know".
    //
    // Sorting uses the stored integer, never the formatted string.
    makeFieldDefinition({
      id: "totalMinor",
      entityId: "salesOrder",
      label: "Dollars",
      type: "CURRENCY_MINOR",
      sortable: false,
      description:
        "Sum of every line's ordered extended price (orderedQty x committed unitPrice), integer " +
        "minor units. Null unless every line is priced — see pricingState.",
    }),
    // The sibling the CURRENCY_MINOR renderer reads. See the file header.
    makeFieldDefinition({
      id: "currency",
      entityId: "salesOrder",
      label: "Currency",
      type: "STRING",
      description: "Free-form string (e.g. \"USD\"); no amount is stored in minor units anywhere on this record.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "salesOrder",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "The scope listSalesOrdersForAccount actually queries by.",
    }),
    makeFieldDefinition({
      id: "ownerEmployeeId",
      entityId: "salesOrder",
      label: "Owner",
      type: "REFERENCE",
      referenceTo: "employee",
      description: "Display resolution belongs to the employee entity, not to this list.",
    }),
    // REFERENCE to location, now that `location` is a registered entity
    // (definitions/location.js). Unlike equipment.locationId, this one has no Rules-level
    // accountId cross-check on this collection (sales_orders is deny-all/callable-read) —
    // the reference just names what the id points at.
    makeFieldDefinition({
      id: "locationId",
      entityId: "salesOrder",
      label: "Location",
      type: "REFERENCE",
      referenceTo: "location",
      // salesOrderCommands.ts stores `locationId: string | null` (nonEmpty(input.locationId)
      // ? trim() : null) and createServiceForSalesOrder.ts throws failed-precondition when
      // it is absent for that one write path — but on the Sales Order record itself a
      // location is optional, not guaranteed present on every order.
      description: "The delivery/service Location. Optional in storage — string | null (salesOrderCommands.ts) — not every Sales Order has one set.",
    }),
    makeFieldDefinition({
      id: "sourceOpportunityId",
      entityId: "salesOrder",
      label: "Source Opportunity",
      type: "REFERENCE",
      referenceTo: "opportunity",
      description: "Written only by createSalesOrderFromOpportunity. Preserves the Opportunity -> Sales Order lineage.",
    }),
    makeFieldDefinition({
      id: "sourceOpportunityNumber",
      entityId: "salesOrder",
      label: "Source Opportunity #",
      type: "STRING",
      description: "Denormalized at creation so the lineage link can render a reference, not a document id. Null for Sales Orders predating Opportunity identity.",
    }),
    makeFieldDefinition({
      id: "customerPO",
      entityId: "salesOrder",
      label: "Customer PO",
      type: "STRING",
    }),
    makeFieldDefinition({
      id: "notes",
      entityId: "salesOrder",
      label: "Notes",
      type: "TEXT",
    }),
  ],
  // account.salesOrders points FROM Account and is declared there. Traversal carries the
  // TARGET's authority: reading an account does not entitle a viewer to its orders.
  //
  // KNOWN LIMITATIONS, AS DATA — see metadata/gapRegister.js.
  //
  // RESTORED, not newly discovered. The structured-object pilot (#1442) traced these and recorded
  // them on its own contract; the metadata convergence (#1447) retired that contract and folded gaps
  // onto part, purchaseOrder, workOrder and equipment — and MISSED this object. ADR-013 states pilot
  // knowledge was preserved; for Sales Orders it was not, and the trace had to be recovered.
  gaps: [
    // ═══ CLOSED, AND WRONG WHILE IT WAS OPEN — SALES_ORDER_TOTAL_AUTHORITY_GAP ═══
    //
    // It said: "A Sales Order carries no authoritative money", and refused a Dollars column on the
    // grounds that "INVOICE MONEY IS NOT SALES ORDER MONEY".
    //
    // It had the direction backwards. functions/src/finance/invoiceCommands.ts snapshots each
    // line's `unitPrice` as `unitPriceMinor` (integer minor units), REFUSES to bill a line that
    // has none (UNPRICED), and REFUSES any invoice price that disagrees with it (PRICE_MISMATCH).
    // The invoice is DERIVED from the order's committed price and forbidden from contradicting it.
    // The order is the source of the sale's money, not a document that happens not to have any.
    //
    // The gap was written from the pilot trace and never checked against the billing engine. It
    // then removed the column, which meant nobody could see the number and ask why it was missing —
    // the failure a gap register is supposed to prevent, produced by the register itself.
    //
    // Owner ruling, 2026-08-24: "a sales order is the entry point of a sale. it needs to have the
    // dollars of that sale." `totalMinor` is projected server-side and declared as a field above.
    //
    // WHAT SURVIVES the closure, because it was the one real hazard: `unitPrice` is OPTIONAL per
    // line, so an order can be PARTLY priced, and summing what happens to be priced yields a real
    // number that is not the sale's total. The projection populates `totalMinor` only when every
    // line is priced, and reports `pricingState` / `unpricedLineCount` otherwise. NULL IS NOT ZERO.
    //
    // Kept as a record rather than deleted: a closed gap is the record of a decision, and this one
    // is also the record of a wrong call worth not repeating.
    makeGap({
      id: "SALES_ORDER_CUSTOMER_NAME_NOT_SORTABLE",
      title: "A Sales Order cannot be sorted by customer name",
      entityId: "salesOrder",
      fieldId: "accountId",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NOT_PROJECTED,
      finding:
        "accountId is a reference; the name lives on the Account. The batched resolver supplies names " +
        "for the rows ALREADY FETCHED — right for display, useless for a sort that must happen inside " +
        "the query choosing the rows.",
      consequence: "Sorting this list by customer name is unavailable at any scale.",
      refused:
        "Paging by number, resolving names, then ordering the page and labelling it \"Customer A-Z\". " +
        "That sorts the page, not the list.",
      resolution:
        "The same denormalized customerNameLower plus rename-propagation authority that " +
        "CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS names on the Work Order. One decision covers both.",
    }),
    makeGap({
      id: "SALES_ORDER_HAS_NO_USABLE_TIMESTAMP",
      title: "No reliably-populated timestamp exists to order or filter by",
      entityId: "salesOrder",
      severity: GAP_SEVERITY.DEFECT,
      reason: WHY.NOT_PROJECTED,
      finding:
        "The write path stores createdAt/updatedAt as Firestore Timestamps; the read projection reads " +
        "createdAtMillis/updatedAtMillis — field names nothing writes. Both project as null on every " +
        "row today.",
      consequence:
        "No Created or Updated column, no date filter, no date sort. salesOrderNumber is monotonic " +
        "within a year, so it is the honest best-available order and is the declared default.",
      refused:
        "Declaring a Created Date column that renders an absence on every row, which would read as " +
        "missing data rather than as a projection defect.",
      resolution:
        "Align the projection field names with what the write path stores. A read-path fix, not a " +
        "domain decision — and the cheapest of these three to close.",
    }),
  ],
});

export const salesOrderRelatedList = makeListViewDefinition({
  id: "account.salesOrders",
  entityId: "salesOrder",
  label: "Sales Orders",
  surface: "RELATED",
  parentRelationshipId: "account.salesOrders",
  viewAllListId: "salesOrder.index",
  columns: [
    makeColumn({ fieldId: "salesOrderNumber", sortable: true }),
    makeColumn({ fieldId: "state", sortable: true }),
    // NOT sortable: sorting by total needs a stored order-level field for Firestore to order by,
    // and the total is derived from the lines at read time. Sorting the PAGE and calling it
    // "by value" would sort fifty rows and label it as the list.
    makeColumn({ fieldId: "totalMinor" }),
    makeColumn({ fieldId: "salesChannel" }),
    makeColumn({ fieldId: "customerPO" }),
    makeColumn({ fieldId: "sourceOpportunityNumber" }),
  ],
  filters: [],
  // No reliably-populated timestamp exists to sort by: the write path stores createdAt/updatedAt
  // as Firestore Timestamps, but the read projection reads createdAtMillis/updatedAtMillis —
  // field names nothing writes — so those two always project as null today. salesOrderNumber is
  // monotonic within a year (allocateSalesOrderNumber), so it is the honest best-available order.
  defaultSort: [makeSort({ fieldId: "salesOrderNumber", direction: "DESC" })],
  pageSize: 25,
  capabilityRequirement: "salesOrder.read",
  rowNavigationTo: "/customers/opportunities/sales-order/:salesOrderId",
});

/**
 * The general Sales Order index.
 *
 * State is the one declared filter, mirroring opportunity.index's stage filter for the same
 * reason: this list only ever accepts a filter its own read callable can honestly serve.
 *
 * READS THROUGH ITS OWN readCallable, NOT THE ENTITY'S (X-ENTITY-SINGLE-READCALLABLE),
 * mirroring opportunity.index exactly. `salesOrderEntity.readCallable` above is the
 * account-scoped `listSalesOrdersForAccount` — correct for the RELATED section under an
 * Account, wrong here: an unscoped INDEX surface has no account to scope by.
 * `listSalesOrderIndex` (functions/src/salesOrder/salesOrderReadService.ts,
 * X-SALES-ORDER-NO-UNSCOPED-READ) is the governed Sales Order read built for exactly this
 * gap — unscoped, bounded, cursor-paginated, ordered by salesOrderNumber DESC (this list's
 * own declared defaultSort). It is the caller's WHOLE authorized scope, capped and paged,
 * not a per-Account query; the `state` filter below is the one it can honestly serve
 * (EQUALS/IN), matching what the read service accepts. Registering `listSalesOrderIndex` in
 * callableListSource.js's CALLABLE_SOURCES map (as `scoped: false`) is a separate step this
 * lane's write scope does not include — see X-SALES-ORDER-NO-UNSCOPED-READ's handoff for the
 * exact entry needed. Until that registration lands, this declaration is REGISTER != WIRE:
 * the read exists and is named here, but useMetadataList.js/MetadataRecordPage.jsx cannot
 * dispatch to it yet.
 */
export const salesOrderIndexList = makeListViewDefinition({
  id: "salesOrder.index",
  entityId: "salesOrder",
  label: "Sales Orders",
  surface: "INDEX",
  readCallable: "listSalesOrderIndex",
  columns: [
    makeColumn({ fieldId: "salesOrderNumber", sortable: true }),
    makeColumn({ fieldId: "accountId" }),
    makeColumn({ fieldId: "state", sortable: true }),
    // WHAT THE SALE IS WORTH. Not sortable: the total is derived from the lines at read time,
    // so there is no stored order-level field for Firestore to order by, and sorting the PAGE
    // would sort fifty rows while labelling it as the list.
    makeColumn({ fieldId: "totalMinor" }),
    makeColumn({ fieldId: "salesChannel" }),
    makeColumn({ fieldId: "customerPO" }),
  ],
  filters: [makeFilter({ fieldId: "state", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "salesOrderNumber", direction: "DESC" })],
  pageSize: 50,
  capabilityRequirement: "salesOrder.read",
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "open",
      label: "Open orders",
      // Open means "not yet CLOSED or CANCELLED" — the same terminal-state framing
      // workOrder.index's "Open work" saved view uses.
      filters: [{
        fieldId: "state",
        operator: "IN",
        value: SALES_ORDER_STATE_VALUES.filter((s) => s !== "CLOSED" && s !== "CANCELLED"),
      }],
      sort: [makeSort({ fieldId: "salesOrderNumber", direction: "DESC" })],
    }),
  ],
  rowNavigationTo: "/customers/opportunities/sales-order/:salesOrderId",
});
