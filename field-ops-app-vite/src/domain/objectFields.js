// THE PILOT OBJECTS' FIELD CONTRACTS — Work Orders, Sales Orders, Equipment.
//
// ============================ EVERY DECLARATION IS AGAINST WHAT IS STORED ============================
//
// A field is declared `filterable`/`sortable` only where the query layer can actually do it at scale
// against the CURRENT data model. Where it cannot, the field says so and names the reason, and the UI
// simply does not offer it.
//
// That honesty is the whole point. The alternative — declaring everything filterable and fetching the
// collection to filter in the browser — passes a demo and dies on a real customer's data.
//
// ============================ WHAT THIS PILOT FOUND ============================
//
// Firestore is not relational. Related fields (Customer name, Location city, Technician name,
// Equipment model) are NOT stored on the Work Order, so they cannot be filtered or sorted
// server-side. Each is declared with `NOT_PROJECTED` and the projection that would fix it is written
// down in docs/architecture/structured-object-field-metadata.md rather than faked here.
import {
  FIELD_CATEGORY as C, FIELD_TYPE as T, OPERATOR, UNSUPPORTED_REASON as WHY,
  defineObjectFields,
} from "./fieldMetadata.js";
import { WORK_ORDER_STATUS_VALUES } from "./workOrderStatus.js";

export const OBJECT = Object.freeze({
  WORK_ORDER: "Work Order",
  SALES_ORDER: "Sales Order",
  EQUIPMENT: "Equipment",
});

// =====================================================================================
// WORK ORDERS
// =====================================================================================

export const WORK_ORDER_FIELDS = defineObjectFields(OBJECT.WORK_ORDER, [
  {
    id: "woNumber", category: C.OWNED, type: T.IDENTIFIER, label: "Work Order",
    source: "fieldops_wos.woNumber", displayable: true, defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
    description: "The governed human identity. Never the document id.",
  },
  {
    id: "status", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "fieldops_wos.status", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
    // SORTABLE ONLY BECAUSE A LIFECYCLE ORDER EXISTS. WORK_ORDER_STATUS_VALUES is already declared in
    // lifecycle order, and it is REUSED rather than restated -- a second copy would drift, and then
    // the list and the workflow would disagree about what comes after what.
    statusOrder: WORK_ORDER_STATUS_VALUES,
  },
  {
    id: "type", category: C.OWNED, type: T.ENUM, label: "Type",
    source: "fieldops_wos.type", defaultVisible: true,
    filterable: true, groupable: true,
    // SERVICE_CALL / PM / INSTALL / WARRANTY / INSPECTION are a classification, not a sequence.
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "priority", category: C.OWNED, type: T.ENUM, label: "Priority",
    source: "fieldops_wos.priority", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
    // A genuine business ordering, so it may be sorted.
    statusOrder: ["EMERGENCY", "HIGH", "NORMAL", "LOW"],
  },
  {
    id: "scheduledStart", category: C.OWNED, type: T.DATETIME, label: "Scheduled Date",
    source: "fieldops_wos.scheduledStart", defaultVisible: true,
    filterable: true, sortable: true,
  },
  {
    id: "createdAt", category: C.OWNED, type: T.DATETIME, label: "Created Date",
    source: "fieldops_wos.createdAt", filterable: true, sortable: true,
  },
  {
    id: "complaint", category: C.OWNED, type: T.STRING, label: "Complaint",
    source: "fieldops_wos.complaint", searchable: true,
    filterable: false, unsupportedFilterReason: WHY.NEEDS_INDEX,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },

  // ── RELATED ────────────────────────────────────────────────────────────────────────────────────
  //
  // The Work Order stores customerId / locationId / assignedTechId — IDS, not values. The names a
  // person filters by live on other documents, so none of these can be filtered or sorted
  // server-side today. They are DISPLAYABLE (resolved for rendering) and honestly unqueryable.
  {
    id: "customer.name", category: C.RELATED, relatedObject: "Customer", type: T.OBJECT_REF,
    label: "Customer", source: "accounts/{customerId}.name", defaultVisible: true,
    unresolvedText: "Customer unavailable", searchable: false,
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "customer.businessLine", category: C.RELATED, relatedObject: "Customer", type: T.ENUM,
    label: "Business Line", source: "accounts/{customerId}.operatingCompanyId",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "location.name", category: C.RELATED, relatedObject: "Location", type: T.LOCATION,
    label: "Location", source: "locations/{locationId} via getLocationDisplay",
    unresolvedText: "Location unavailable",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "location.city", category: C.RELATED, relatedObject: "Location", type: T.STRING,
    label: "City", source: "locations/{locationId}.city",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "location.state", category: C.RELATED, relatedObject: "Location", type: T.STRING,
    label: "State", source: "locations/{locationId}.state",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "technician.name", category: C.RELATED, relatedObject: "Technician", type: T.PERSON,
    label: "Technician", source: "fieldops_technicians/{assignedTechId}.name",
    unresolvedText: "Technician unavailable",
    // The ID is stored on the Work Order, so filtering BY TECHNICIAN is genuinely possible -- the
    // picker shows names and the query uses the id behind it. Sorting is not: ordering by a name
    // means ordering by a value this document does not hold.
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "equipment.model", category: C.RELATED, relatedObject: "Equipment", type: T.STRING,
    label: "Equipment Model", source: "equipment/{equipmentId}.modelNumber",
    unresolvedText: "Equipment unavailable",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "equipment.serialNumber", category: C.RELATED, relatedObject: "Equipment", type: T.SERIAL,
    label: "Serial Number", source: "equipment/{equipmentId}.serialNumber",
    unresolvedText: "Equipment unavailable", searchable: true,
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },

  // ── DERIVED ────────────────────────────────────────────────────────────────────────────────────
  {
    id: "partsReadiness", category: C.DERIVED, type: T.ENUM, label: "Parts Readiness",
    source: "workOrderPartsReadiness projection", defaultVisible: true,
    // Computed from the plan and current availability at read time. There is nothing stored to
    // order by, and filtering would mean computing it for every document first.
    filterable: false, unsupportedFilterReason: WHY.DERIVED_AT_READ,
    sortable: false, unsupportedSortReason: WHY.DERIVED_AT_READ,
  },
]);

// =====================================================================================
// SALES ORDERS
// =====================================================================================

/**
 * DOLLARS IS ABSENT, AND ITS ABSENCE IS THE FINDING.
 *
 * §25 requires a Dollars column backed by an authoritative Sales Order total, and requires this
 * package to STOP rather than manufacture one. Traced before writing any of it:
 *
 *   - the Sales Order document has NO total, subtotal or amount
 *   - `salesOrderReadService.projectLine` carries lineId, kind, ref and four QUANTITIES — no money
 *   - `unitPrice` exists on a line as an explicitly OPTIONAL, PASSIVE snapshot that the command
 *     comments describe as "NOT computed here", and the read projection strips it entirely
 *   - authoritative money exists for INVOICES (`invoiceCommands.ts`: unitPriceMinor, lineTotalMinor,
 *     totalMinor) — an invoice is not its order, and an unbilled order would show nothing
 *
 * Summing optional unit prices on the client is exactly the "parse UI line items" the brief forbids,
 * and it would put a number on screen that no authority stands behind.
 *
 * Reported as SALES ORDER TOTAL AUTHORITY GAP. The field is declared here as NOT displayable so the
 * requirement stays visible in the contract rather than being quietly dropped.
 */
export const SALES_ORDER_DOLLARS_GAP = Object.freeze({
  field: "dollars",
  object: OBJECT.SALES_ORDER,
  finding: "No authoritative Sales Order total exists in the domain.",
  evidence: Object.freeze([
    "Sales Order document carries no total/subtotal/amount",
    "salesOrderReadService.projectLine projects quantities only — no money",
    "line.unitPrice is optional and documented as a passive snapshot, NOT computed",
    "the read projection strips unitPrice, so the client cannot see it even where present",
    "authoritative money exists for Invoices (totalMinor), which is a different document",
  ]),
  resolution: "A Sales Order pricing authority (or an explicitly derived, stored order total) must exist first.",
});

export const SALES_ORDER_FIELDS = defineObjectFields(OBJECT.SALES_ORDER, [
  {
    id: "salesOrderNumber", category: C.OWNED, type: T.IDENTIFIER, label: "Sales Order",
    source: "sales_orders.salesOrderNumber", defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
  },
  {
    id: "status", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "sales_orders.status", defaultVisible: true,
    filterable: true, groupable: true,
    // No lifecycle order is declared for Sales Order status anywhere in the domain, and inventing
    // one here would be this file deciding a business sequence. Filterable, not sortable.
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "createdAtMillis", category: C.OWNED, type: T.DATETIME, label: "Created Date",
    source: "sales_orders.createdAtMillis", defaultVisible: true,
    filterable: true, sortable: true,
  },
  {
    id: "updatedAtMillis", category: C.OWNED, type: T.DATETIME, label: "Updated Date",
    source: "sales_orders.updatedAtMillis", filterable: true, sortable: true,
  },
  {
    id: "salesChannel", category: C.OWNED, type: T.ENUM, label: "Channel",
    source: "sales_orders.salesChannel", filterable: true, groupable: true,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "ownerEmployeeId", category: C.OWNED, type: T.PERSON, label: "Owner",
    source: "sales_orders.ownerEmployeeId", defaultVisible: true,
    unresolvedText: "Owner unavailable",
    // The id is stored, so filtering by owner works with a name picker over an id query.
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "customer.name", category: C.RELATED, relatedObject: "Customer", type: T.OBJECT_REF,
    label: "Customer", source: "accounts/{accountId}.name", defaultVisible: true,
    unresolvedText: "Customer unavailable",
    // accountId IS stored on the order, so filter-by-customer works; sorting by NAME does not.
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "customer.businessLine", category: C.RELATED, relatedObject: "Customer", type: T.ENUM,
    label: "Business Line", source: "accounts/{accountId}.operatingCompanyId",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "dollars", category: C.FINANCIAL, type: T.CURRENCY, label: "Dollars",
    source: "NONE — see SALES_ORDER_DOLLARS_GAP",
    // NOT DISPLAYABLE. The requirement stays in the contract so it is not forgotten; the column does
    // not render, because there is no authority behind the number.
    displayable: false, reportable: false, exportable: false, align: "right",
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
    description: "Blocked: no authoritative Sales Order total exists. See SALES_ORDER_DOLLARS_GAP.",
  },
]);

// =====================================================================================
// EQUIPMENT
// =====================================================================================

/**
 * INSTALLED EQUIPMENT AND UNINSTALLED SERIALIZED UNITS ARE DIFFERENT THINGS.
 *
 * An Equipment record is a machine installed at a customer: it has an account and a site. A
 * serialized asset in a warehouse is stock: it has an inventory state and an internal location, and
 * no customer at all.
 *
 * They share a serial and a model and nothing else that matters, so they get separate field sets.
 * Merging them would produce a list where "Customer" is empty for half the rows and nobody can tell
 * whether that means unassigned or uninstalled.
 */
export const EQUIPMENT_FIELDS = defineObjectFields(OBJECT.EQUIPMENT, [
  {
    id: "productName", category: C.OWNED, type: T.STRING, label: "Equipment",
    source: "equipment.productName / model", defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
  },
  {
    id: "serialNumber", category: C.OWNED, type: T.SERIAL, label: "Serial Number",
    source: "equipment.serialNumber", defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
  },
  {
    id: "manufacturer", category: C.OWNED, type: T.STRING, label: "Manufacturer",
    source: "equipment.manufacturer", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
  },
  {
    id: "modelNumber", category: C.OWNED, type: T.STRING, label: "Model",
    source: "equipment.modelNumber", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
  },
  {
    id: "status", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "equipment.status", defaultVisible: true,
    filterable: true, groupable: true,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "installDate", category: C.OWNED, type: T.DATE, label: "Install Date",
    source: "equipment.installDate", filterable: true, sortable: true,
  },
  {
    id: "description", category: C.OWNED, type: T.STRING, label: "Description",
    source: "equipment.description",
    filterable: false, unsupportedFilterReason: WHY.NEEDS_INDEX,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "customer.name", category: C.RELATED, relatedObject: "Customer", type: T.OBJECT_REF,
    label: "Customer", source: "accounts/{accountId}.name", defaultVisible: true,
    unresolvedText: "Customer unavailable",
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IS_NOT, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "location.name", category: C.RELATED, relatedObject: "Location", type: T.LOCATION,
    label: "Location", source: "getLocationDisplay projection", defaultVisible: true,
    unresolvedText: "Location unavailable",
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "businessLine", category: C.RELATED, relatedObject: "Customer", type: T.ENUM,
    label: "Business Line", source: "accounts/{accountId}.operatingCompanyId",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
]);

/** Uninstalled serialized stock. Its own set, for the reason in the note above. */
export const AVAILABLE_UNIT_FIELDS = defineObjectFields("Available Unit", [
  {
    id: "productName", category: C.OWNED, type: T.STRING, label: "Equipment",
    source: "parts.name via serialized asset partId", defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
  },
  {
    id: "serialNo", category: C.OWNED, type: T.SERIAL, label: "Serial Number",
    source: "serialized_assets.serialNo", defaultVisible: true,
    filterable: true, sortable: true, searchable: true,
  },
  {
    id: "quantity", category: C.DERIVED, type: T.QUANTITY, label: "Quantity",
    source: "always 1 — a serialized unit is one physical thing", defaultVisible: true, align: "right",
  },
  {
    id: "inventoryState", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "serialized_assets.inventoryState", defaultVisible: true,
    filterable: true, groupable: true,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "currentLocation", category: C.RELATED, relatedObject: "Location", type: T.LOCATION,
    label: "Location", source: "getLocationDisplay(currentLocationId)", defaultVisible: true,
    unresolvedText: "Location unavailable",
    filterable: true, operators: [OPERATOR.IS, OPERATOR.IN],
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "description", category: C.OWNED, type: T.STRING, label: "Description",
    source: "parts.description", defaultVisible: true,
    filterable: false, unsupportedFilterReason: WHY.NEEDS_INDEX,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
]);

export const PILOT_OBJECTS = Object.freeze({
  [OBJECT.WORK_ORDER]: WORK_ORDER_FIELDS,
  [OBJECT.SALES_ORDER]: SALES_ORDER_FIELDS,
  [OBJECT.EQUIPMENT]: EQUIPMENT_FIELDS,
});
