import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
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
// currency IS A FREE-FORM STRING, NOT A CURRENCY TYPE. There is no minor-unit amount stored
// anywhere beside it — the same gap opportunity.js's expectedValue already names — so declaring
// CURRENCY_MINOR would assert storage semantics this record does not have.
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
    // A plain string with NO minor-unit amount stored anywhere. See the file header.
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
    // No `location` entity is registered yet, so this stays a plain reference id rather than a
    // REFERENCE this registry cannot resolve — the same restraint account.js applies to `tags`.
    makeFieldDefinition({
      id: "locationId",
      entityId: "salesOrder",
      label: "Location",
      type: "STRING",
      description: "The delivery/service location id. No location entity is registered in this program yet.",
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
 * reason: the callable this entity reads through is account-scoped, so a filter beyond what
 * listSalesOrdersForAccount actually supports would be a claim the read service cannot keep.
 */
export const salesOrderIndexList = makeListViewDefinition({
  id: "salesOrder.index",
  entityId: "salesOrder",
  label: "Sales Orders",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "salesOrderNumber", sortable: true }),
    makeColumn({ fieldId: "accountId" }),
    makeColumn({ fieldId: "state", sortable: true }),
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
