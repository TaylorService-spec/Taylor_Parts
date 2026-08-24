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
import { WORK_ORDER_TYPE_LABEL, WORK_ORDER_TYPE_VALUES } from "../../domain/workOrderType.js";

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
    makeFieldDefinition({
      id: "type",
      entityId: "workOrder",
      label: "Type",
      type: "ENUM",
      enumValues: [...WORK_ORDER_TYPE_VALUES],
      enumLabels: WORK_ORDER_TYPE_LABEL,
      // A COLUMN, NOT A FILTER, and the index derivation is the reason. The default sort is
      // createdAt DESC, so a type filter needs (type, createdAt) — which is not declared, and
      // §20 of this package forbids deploying one. Declaring the filter anyway would offer a
      // control that errors at read time in front of a dispatcher.
      sortable: false,
    }),
    makeFieldDefinition({
      id: "scheduledStart",
      entityId: "workOrder",
      label: "Scheduled",
      type: "TIMESTAMP",
      // SORTABLE, BUT SEE THE GAP. `scheduledStart` is OPTIONAL on the record — an unscheduled
      // Work Order simply has no value — and Firestore's orderBy silently EXCLUDES documents
      // missing the ordered field. Sorting by it therefore answers "the scheduled work, in
      // schedule order", which is a legitimate and useful question, but it is NOT "all work
      // orders". WORK_ORDER_SCHEDULED_SORT_HIDES_UNSCHEDULED says so, and the screen says so too.
      sortable: true,
    }),
    makeFieldDefinition({
      id: "locationId",
      entityId: "workOrder",
      label: "Location",
      type: "REFERENCE",
      referenceTo: "location",
      description: "Where the work happens. A reference; the site name lives on the location.",
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
    makeGap({
      id: "WORK_ORDER_SCHEDULED_SORT_HIDES_UNSCHEDULED",
      title: "Sorting by Scheduled shows only work that has been scheduled",
      entityId: "workOrder",
      fieldId: "scheduledStart",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NO_CANONICAL_ORDER,
      finding:
        "scheduledStart is optional — a Work Order that has not been scheduled has no value at all — " +
        "and Firestore's orderBy EXCLUDES every document missing the ordered field. The same mechanic " +
        "removed 101 of 103 customers from the Accounts list while the header still read '103 Total'.",
      consequence:
        "Sorting Work Orders by Scheduled returns the scheduled ones in schedule order and silently " +
        "omits the unscheduled. That is a useful view; it is not the whole list, and a shorter list " +
        "does not look like a filtered one.",
      refused:
        "Offering the sort without saying so. Silent truncation is the worst failure a list can have, " +
        "because nothing about the result announces that most of the work is missing.",
      resolution:
        "Either the sort states its own scope on screen — which is what it does today — or " +
        "scheduledStart becomes required-with-a-sentinel, which is a scheduling decision and not a " +
        "list one.",
    }),
    makeGap({
      id: "WORK_ORDER_TEXT_SEARCH_GAP",
      title: "Work Orders can be searched by number, and by nothing else",
      entityId: "workOrder",
      fieldId: "woNumber",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NO_CANONICAL_ORDER,
      finding:
        "domain/workOrderSearch.js issues a real bounded PREFIX range over `woNumber`, which works " +
        "because the number is machine-generated in one closed format (WO-YYYY-######). Nothing " +
        "equivalent exists for customer name — no operational document carries one, the same wall " +
        "CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS describes — and complaint text needs a text index " +
        "this platform does not have.",
      consequence:
        "Finding a Work Order across the whole collection requires its number. 'the Harbor Grill job' " +
        "is answered by opening the customer and reading their work, not from the Work Orders list.",
      refused:
        "Keeping the old GlobalSearch provider, which filtered an array the screen supplied. Once the " +
        "list is paged, that array is ONE PAGE — so the box would have searched fifty rows and " +
        "reported 'no results' for a Work Order that exists. A search that is silently partial is " +
        "worse than one that is honestly narrow.",
      resolution:
        "Customer-name search needs the same denormalized customer name a customer-name SORT needs — " +
        "one decision covers both. Free-text needs a search index, which is a platform capability " +
        "rather than a list feature.",
    }),
    makeGap({
      id: "WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE",
      title: "A Work Order does not record which equipment it is for",
      entityId: "workOrder",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NOT_PROJECTED,
      finding:
        "types/workOrder.ts declares customerId and locationId and NO equipment reference. The link " +
        "exists in the other direction and only after the fact: an INSTALL close-out writes an " +
        "equipmentId into its outcome (domain/workOrderInstallCloseout.js), and equipment history is " +
        "assembled from those events. Nothing on the Work Order itself names a unit.",
      consequence:
        "There is no Equipment column or filter on the Work Order list. A service call against a " +
        "specific machine cannot be found by that machine from this surface.",
      refused:
        "Rendering an Equipment column populated from close-out outcomes. It would be empty for every " +
        "open Work Order — exactly the rows a dispatcher is looking at — and populated only for work " +
        "already finished, which reads as missing data rather than as a model that has no such field.",
      resolution:
        "Whether a Work Order names the equipment it is for is a service-model decision. It changes " +
        "the write path and the wizard, not the list.",
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
    makeColumn({ fieldId: "type" }),
    makeColumn({ fieldId: "scheduledStart", sortable: true }),
    makeColumn({ fieldId: "assignedTechId" }),
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
