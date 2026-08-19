import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { WAREHOUSE_STATUSES, WAREHOUSE_STATUS_META } from "../../domain/warehousesView.js";

// Warehouse — S-INV-WAREHOUSE-SUPPLIER-DEFINITIONS. Describes the LIVE `warehouses` collection
// (Epic 4 Warehouse + Fulfillment System, functions/src/types/warehouse.ts's plain `Warehouse`
// interface: { id, name, location }), read by the Operations Warehouses workspace through
// domain/warehousesView.js (buildWarehousesView) over services/operationsQueries.ts's
// fetchWarehousesPage — a BOUNDED, name-ordered read added by an earlier §9 remediation, not the
// unbounded fetchWarehouses the Operations dashboard's netted totals still depend on.
//
// STATUS EXISTS ON THE DOCUMENT, BUT THE GOVERNED WRITER THAT PRODUCES IT IS NOT LIVE. There is a
// full governed §3A schema (functions/src/types/warehouse.ts GovernedWarehouse: id, name, location,
// status, version, updatedAt, updatedBy, provenance, plus a createdAt/createdBy pair and a
// governanceInitializedAt/governanceInitializedBy pair) validated by
// functions/src/warehouseGovernance/governedWarehouseValidation.ts. But BOTH real producers of that
// shape are explicitly inert by their own file headers: warehouseStatusWriter.ts's createWarehouse/
// setWarehouseStatus is "the INERT, UNEXPORTED trusted warehouse-status writer... NOT exported from
// functions/src/index.ts; no callable; production-inert (no caller)", and
// receivingLocationOptionsService.ts (which DOES call the §3A validator against candidate warehouse
// docs, from inventoryReceiving/receivingCallables.ts) is itself "the INERT, UNEXPORTED trusted
// backend service... NOT exported from functions/src/index.ts; no callable; production-inert (no
// caller)". No code path in this repository writes version/provenance/createdAt/createdBy/
// updatedAt/updatedBy/governanceInitializedAt/governanceInitializedBy to a `warehouses` document
// today. Declaring those seven fields here would assert a governed shape the live collection has
// never actually been written in — the exact category error this program's other definitions
// (part.js's DELIBERATELY ABSENT paragraph, employee.js's assignedWarehouseIds note) already avoid.
// Only `status` is declared, because the CLIENT read type itself (services/operationsQueries.ts's
// RawWarehouse) already carries it as `status?: string`, with its own comment: "present at runtime,
// consumed by the Warehouses workspace" — a stored fact the client genuinely reads, not a governance
// guarantee this file is asserting.
//
// STATUS IS OPTIONAL, AND A MISSING STATUS IS A REAL, NAMED STATE, NOT AN ERROR. domain/
// warehousesView.js's isWarehouseActiveStatus/buildWarehousesView/summarizeWarehouses all treat a
// warehouse with no (or unrecognized) `status` as its own bucket — `ungoverned` in
// summarizeWarehouses, rendered "Unknown"/muted by warehouseStatusLabel/warehouseStatusTone. The
// enum below therefore declares exactly the two governed values (ACTIVE/INACTIVE, WAREHOUSE_STATUSES
// — the same client mirror constant warehousesView.js already exports, imported here rather than
// re-declared) and leaves "missing" undeclared, matching how part.js's oemStatus and
// purchaseOrder.js's expectedArrivalDate leave "absent" as a legal, undeclared state rather than a
// fabricated enum member.
//
// STATUS-LEVEL, NOT RECEIVING-ELIGIBILITY. warehousesView.js's own header is explicit that
// `isWarehouseActiveStatus` "is a STATUS-level signal (status === "ACTIVE"), not a guarantee the
// receiving service will admit the warehouse" — the full §3A governed-shape check is what actually
// decides Receiving eligibility, and (per above) that check has no live caller yet regardless. This
// definition inherits that same restraint: `status` describes what is stored, not what Receiving
// would accept.
//
// NO CAPABILITY GATES THIS COLLECTION. firestore.rules' `warehouses/{warehouseId}` admits
// isAdminOrDispatcher() OR isAssignedToWarehouse(warehouseId) (Issue #226, a WAREHOUSE_MANAGER
// scoped to their own linked Employee's assignedWarehouseIds) — both role/relationship checks, never
// a capability id. There is no `warehouse.read` in the capability catalog. readCapability is
// therefore null, the same finding every role-gated collection in this program already records.
//
// IDENTITY IS A nameField ONLY. `name` is the human name every consumer reads (warehousesView.js
// falls back to the document id only when it is missing/blank, the exact fallback
// entityDefinition.js's own header names as a defect elsewhere in this codebase). There is no
// warehouse code, reference number, or any other business identifier anywhere in the Epic 4 type,
// the §3A governed type, or firestore.rules — nothing is promoted to referenceField that the data
// does not carry (DECISIONS #106).
//
// `location` STAYS A PLAIN STRING, NOT A REFERENCE. Epic 4's Warehouse.location
// (functions/src/types/warehouse.ts) is a free-text description ("123 Main St, Bldg A"), not a
// pointer to the registered `location` entity (location.js, the Customer-site Location — a
// completely different concept sharing only a name). Treating it as a REFERENCE would misidentify
// what it points at; it is declared as descriptive text instead.
//
// NO OUTBOUND RELATIONSHIPS ARE DECLARED. stock_locations, transfer_orders and mobile_locations all
// reference a warehouseId, but every one of those is a collection with no registered EntityDefinition
// in this program — the same restraint purchaseOrder.js applies to its own undeclared
// reorderRequest edge. See REGISTRATION_PENDING.
export const warehouseEntity = makeEntityDefinition({
  id: "warehouse",
  label: "Warehouse",
  labelPlural: "Warehouses",
  // No client-side WAREHOUSES_COLLECTION constant exists in domain/constants.js (only a local
  // const inside services/operationsQueries.ts) — the literal here matches that local const and
  // functions/src/constants/collections.js's own WAREHOUSES_COLLECTION = "warehouses".
  collection: "warehouses",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/relationship (admin/dispatcher, or a WAREHOUSE_MANAGER assigned to
  // this specific warehouse), not by a capability. Recorded as null rather than invented — see
  // the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description:
    "A physical stock-holding location (Epic 4 Warehouse + Fulfillment) — a bin-level inventory registry, " +
    "not the Sprint 2.0.2 Customer-site Location entity of the same shape.",
  fields: [
    // The document id, declared rather than left implicit — the same shape part.js's partId and
    // employee.js's employeeId take. Not part of identity (identity is `name`, the human-typed
    // field) and not filterable or sortable.
    makeFieldDefinition({
      id: "warehouseId",
      entityId: "warehouse",
      label: "Warehouse ID",
      type: "ID",
      description: "The Firestore document id. Nothing in this collection's write paths re-asserts it inside the document body.",
    }),
    makeFieldDefinition({
      id: "name",
      entityId: "warehouse",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "The human reference for this warehouse. The nameField half of identity; no reference number exists anywhere in this schema.",
    }),
    makeFieldDefinition({
      id: "location",
      entityId: "warehouse",
      label: "Location",
      type: "STRING",
      description: "Free-text description (functions/src/types/warehouse.ts Warehouse.location), not a pointer to the registered `location` entity — see the file header.",
    }),
    // Optional — see the file header for why a missing value is a real, undeclared state rather
    // than an enum member, and why the seven other §3A governed fields are not declared at all.
    makeFieldDefinition({
      id: "status",
      entityId: "warehouse",
      label: "Status",
      type: "ENUM",
      enumValues: [...WAREHOUSE_STATUSES],
      enumLabels: Object.fromEntries(WAREHOUSE_STATUSES.map((s) => [s, WAREHOUSE_STATUS_META[s].label])),
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description:
        "Optional; absent on a legacy/ungoverned document (domain/warehousesView.js surfaces this as its own bucket, " +
        "never a fabricated third enum value). A STATUS-level read, not a guarantee of Receiving eligibility — see the file header.",
    }),
  ],
  // No relationships declared — see the file header and REGISTRATION_PENDING.
});

/**
 * The Warehouse registry index. No standalone route renders this yet — a definition is not a
 * surface, the same restraint part.index and employee.index apply — but it is defined now so a
 * future route has a real target.
 *
 * status IS THE ONE DECLARED FILTER, matching WAREHOUSE_FILTERS' own active/inactive split
 * (domain/warehousesView.js) — but that split is applied CLIENT-SIDE today, over the bounded page
 * fetchWarehousesPage already returns (no real backend query filters `warehouses` by status). One
 * optional equality filter on a two-value enum is a single net-new composite (status+name+
 * __name__) — well inside the Work Order lesson's restraint (MAX_DECLARED_FILTERS = 4) — declared
 * so a future INDEX surface can serve the same distinction the workspace already offers, the same
 * forward-looking restraint part.js applies to its own status/stockingClass filters.
 *
 * defaultSort is name ASC, matching fetchWarehousesPage's own orderByField: "name" — the real
 * query shape this surface already runs (see the file header).
 */
export const warehouseIndexList = makeListViewDefinition({
  id: "warehouse.index",
  entityId: "warehouse",
  label: "Warehouses",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "location" }),
    makeColumn({ fieldId: "status", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "name", direction: "ASC" })],
    }),
  ],
});
