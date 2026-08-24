import {
  makeEntityDefinition,
  makeFieldDefinition,
  makeIdentity,
} from "../entityDefinition.js";
import { makeGap, GAP_SEVERITY } from "../gapRegister.js";
import { UNSUPPORTED_REASON as WHY } from "../unsupportedReason.js";
import {
  makeColumn,
  makeFilter,
  makeListViewDefinition,
  makeSavedView,
  makeSort,
} from "../listViewDefinition.js";
import { WORK_ORDERS_COLLECTION } from "../../domain/constants.js";
import { WORK_ORDER_STATUS_LABEL, WORK_ORDER_STATUS_VALUES } from "../../domain/workOrderStatus.js";
import { WORK_ORDER_PRIORITY_LABEL } from "../../domain/workOrderPriority.js";

// Work Orders — the Gate B non-CRM validation target.
//
// Account proved the contracts describe a CRM list. This one asks a different question:
// does the same model hold for an OPERATIONAL record, where the row is a job moving
// through a lifecycle rather than a party you have a relationship with? Where it does
// not, the gap is worth finding here rather than after nine more surfaces assume it.
//
// IDENTITY IS A REFERENCE NUMBER, unlike Account. A Work Order has woNumber
// (WO-2026-000001), which is how dispatchers and technicians actually refer to a job out
// loud. Declaring it means no surface has an excuse to render a document id — the defect
// corrected on Sales Orders (#1124) — and it is the first definition to exercise the
// referenceField half of the identity contract.
//
// VOCABULARY COMES FROM domain/, NEVER FROM HERE. Status labels come from
// workOrderStatus.js and priority labels from workOrderPriority.js. Both already exist
// because surfaces disagreed about the same record; the metadata layer must not become
// the next surface that disagrees.
//
// §9 — the declared filters are exactly what the declared indexes serve. status and
// priority are equality filters over small closed sets, which index well; customerId is
// the scope every "this account's work" question uses.

export const workOrderEntity = makeEntityDefinition({
  id: "workOrder",
  label: "Work Order",
  labelPlural: "Work Orders",
  collection: WORK_ORDERS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Reference only, deliberately. A Work Order is called by its number, and the nearest
  // thing to a name — the complaint text — is OPTIONAL on the record. An identity field
  // that is frequently absent is worse than none: it licenses a surface to fall back to
  // something, and the something is always the document id.
  identity: makeIdentity({ referenceField: "woNumber" }),
  description: "A unit of field service work, moving through a governed lifecycle.",
  fields: [
    makeFieldDefinition({
      id: "woNumber",
      entityId: "workOrder",
      label: "Work Order",
      type: "STRING",
      sortable: true,
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "workOrder",
      label: "Status",
      type: "ENUM",
      enumValues: [...WORK_ORDER_STATUS_VALUES],
      enumLabels: WORK_ORDER_STATUS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
    }),
    makeFieldDefinition({
      id: "priority",
      entityId: "workOrder",
      label: "Priority",
      type: "ENUM",
      // Stored as a NUMBER (1..4) and labelled with a word. Keeping the machine value
      // numeric is deliberate: "Priority 2" is what five surfaces used to render before
      // the vocabulary existed, and a definition that stored the word would make the
      // number unrecoverable.
      enumValues: Object.keys(WORK_ORDER_PRIORITY_LABEL).map(Number),
      enumLabels: WORK_ORDER_PRIORITY_LABEL,
    }),
    makeFieldDefinition({
      id: "customerId",
      entityId: "workOrder",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "Scope for every 'this account's work' question. A reference, never a label.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "workOrder",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
    }),
    // Rendered, not filtered. A technician assignment is a reference whose display name
    // lives on another entity, and claiming a filter on the raw id would offer a control
    // whose values a user cannot type.
    makeFieldDefinition({
      id: "assignedTechId",
      entityId: "workOrder",
      label: "Technician",
      type: "REFERENCE",
      referenceTo: "employee",
      description: "Display resolution belongs to the employee entity, not to this list.",
    }),
  ],
  // KNOWN LIMITATIONS, AS DATA — see metadata/gapRegister.js. Carried forward from the
  // structured-object pilot (#1442), whose contract was retired by the object-list metadata
  // convergence; the finding was worth keeping.
  gaps: [
    makeGap({
      id: "CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS",
      title: "A Work Order cannot be sorted or filtered by customer name",
      entityId: "workOrder",
      fieldId: "customerId",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NOT_PROJECTED,
      finding:
        "customerId is a reference; the name lives only on the Account. `accounts.nameLower` is a " +
        "maintained denormalized field and makes the ACCOUNT list sortable — but no related " +
        "operational document carries a customer name at all. `useAccountReferenceResolver` resolves " +
        "names for the rows ALREADY FETCHED, which is correct for display and useless for a sort that " +
        "has to happen inside the query choosing which rows to fetch.",
      consequence: "Sorting or filtering Work Orders by customer name is not available at any scale.",
      refused:
        "Fetching an unbounded page and sorting by names resolved afterwards. That sorts the page, not " +
        "the list, and labels the result as though it sorted the list.",
      resolution:
        "A denormalized `customerNameLower` ON the Work Order, maintained by the same writer discipline " +
        "`accounts.nameLower` already proves works — PLUS a rename-propagation authority, which " +
        "nameLower does not need because it derives from the document it lives on. Nothing owns that " +
        "today, and it is a separate architecture decision rather than something to solve incidentally.",
    }),
  ],
});

export const workOrderIndexList = makeListViewDefinition({
  id: "workOrder.index",
  entityId: "workOrder",
  label: "Work Orders",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "woNumber", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "priority" }),
    makeColumn({ fieldId: "customerId" }),
    makeColumn({ fieldId: "createdAt", sortable: true }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    // PRIORITY IS NOT FILTERABLE IN v1, and the derivation is why. Three optional filters
    // demand SEVEN composites; two demand three. Priority is the least load-bearing of
    // the three — a dispatcher filters to a customer or a state and reads priority off
    // the row — so it stays a column until someone asks for it and accepts the cost.
    makeFilter({ fieldId: "customerId", operators: ["EQUALS"] }),
  ],
  // Newest first. An operational queue is read from the top, and ordering by woNumber
  // would make page one a permanent property of when the numbering scheme started.
  defaultSort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "open",
      label: "Open work",
      // The lifecycle's terminal states are CLOSED and CANCELLED, so "open" is everything
      // else. Declared as an IN over the open states rather than a NOT_EQUALS pair,
      // because Firestore serves an IN from the same index an equality uses.
      filters: [
        {
          fieldId: "status",
          operator: "IN",
          value: WORK_ORDER_STATUS_VALUES.filter((s) => s !== "CLOSED" && s !== "CANCELLED"),
        },
      ],
      sort: [makeSort({ fieldId: "createdAt", direction: "DESC" })],
    }),
  ],
  rowNavigationTo: "/work-orders/:id",
});
