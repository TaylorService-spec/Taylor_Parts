import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { TRUCK_STATUS_OPTIONS, truckStatusLabel } from "../../domain/truckManagement.js";

// Truck — A-ENTITY-FLEET-CATALOG-DEFINITIONS. Describes the `trucks` collection (EI-P1d-2-2b
// Truck Registry, ADR-010 / Decision #60): functions/src/truckRegistry/truckRegistryRepository.ts's
// StoredTruck (truckToFirestore/truckFromFirestore), read client-direct through
// services/truckRegistryQueries.js's fetchTruckDocs by the Truck Inventory workspace
// (modules/inventory/TruckInventory.jsx, modules/inventory/truckManagement/*).
//
// TRUCKS ARE A BUSINESS RECORD, NOT A CUSTODY AUTHORITY — READ THIS BEFORE EXTENDING THIS FILE.
// ADR-010 (mirrored verbatim in functions/src/truckRegistry/types.ts's file header and
// domain/truckRegistry.js's own header) is explicit that a truck's inventory custody POSITION is
// a SEPARATE collection, `mobile_locations` (a MOBILE Inventory Location; inventory key =
// locationId), linked 1:1 to this business record (business key = truckId) via
// trucks/{truckId}.locationId — one truck, exactly one MOBILE location, enforced transactionally
// server-side (the location_truck_claims/{locationId} guard doc), NOT expressible in Firestore
// Rules and NOT expressible here. This definition describes ONLY the trucks/{truckId} business
// record: no stock, quantity, custody, or "what is on this truck" fact belongs on it — that
// authority is the ledger + serialized-asset system, reached through mobile_locations, which has
// NO registered EntityDefinition in this program (out of this lane's writeScope; see
// REGISTRATION_PENDING). Declaring a `location` relationship or field pointing INTO the custody
// system from here would misstate what this record is, so none is declared.
//
// READ IS CLIENT_DIRECT, ROLE-GATED, NO CAPABILITY. firestore.rules' `trucks/{truckId}` block
// (EI-P1d-2-2b) grants `allow read: if isAdminOrDispatcher()` and unconditionally denies
// create/update/delete to every principal, admin/dispatcher included — "the cross-document 1:1
// Truck<->MOBILE-Location invariant CANNOT be enforced in Rules, so there is no client-write path
// here." This is a role/relationship check, not a capability id — there is no `truck.read` (or
// any `trucks.*`) entry in the capability catalog (functions/src/access/permissionCatalog.ts).
// readCapability is therefore null, the same finding warehouse.js already records for its own
// role-gated collection. A narrower future truck-scoped (assigned driver) read is tracked
// separately by Issue #100 and is NOT granted by this Rules block — this definition describes
// only the admin/dispatcher directory read that exists today.
//
// ALL WRITES ARE A TRUSTED, TRANSACTIONAL COMMAND SERVICE — AND IT IS UNDEPLOYED.
// functions/src/truckRegistry/truckRegistryCommands.ts is "INTERNAL trusted service only:
// nothing here is exported from functions/src/index.ts, there is no callable/HTTP surface" — the
// eight commands (createTruck, assignTruckDriver, unassignTruckDriver, changeTruckStatus,
// changeTruckHomeWarehouse, deactivateTruck, reactivateTruck, deleteTruckCreatedInError) exist,
// are fully tested (functions/test/truckRegistryCommands.test.mjs), and the Truck Management UI
// (modules/inventory/truckManagement/) is already built against them through
// services/truckRegistryCommandClient.js — but nothing in functions/src/index.ts exports a
// callable that reaches them, so no client request can invoke one today. Undeployed is still the
// honest description of this collection's write path, not UNKNOWN: the code, the tests and the UI
// all agree on exactly what the (currently unreachable) write contract is. This EntityDefinition
// describes the READ side only (readVia/readCapability above); it declares no write contract —
// that is a PageDefinition/action-exposure concern, out of §7's layering for this file.
//
// IDENTITY IS A nameField ONLY — "displayLabel" — DELIBERATELY NOT vehicleNumber, EVEN THOUGH
// vehicleNumber LOOKS LIKE A BUSINESS REFERENCE. Both displayLabel and vehicleNumber are
// REQUIRED, operator-TYPED free text at create (CreateTruckModal.jsx's plain <input> fields for
// both; validation.ts's isRequiredLabel enforces non-empty on both, nothing more). Neither is
// server-allocated. Critically, UNLIKE truckId (whose docId uniqueness IS enforced —
// TruckAlreadyExistsError in truckRegistryCommands.ts's createTruck transaction) or locationId
// (LocationClaimedError), vehicleNumber has NO uniqueness check anywhere in
// truckRegistryCommands.ts, truckRegistryRepository.ts, or validation.ts — two trucks CAN carry
// the same vehicleNumber and nothing in this system prevents or detects it. A referenceField is
// "the stable business reference" (DECISIONS #106); a human-meaningful string an operator can
// freely duplicate does not meet that bar, the exact restraint equipment.js's own header already
// applies to serialNumber/assetTag ("both look like business references but are NOT... NEITHER is
// enforced unique"). So vehicleNumber is declared below as a plain STRING field, not promoted to
// referenceField — a recorded gap (no true business reference exists for a truck's unit/asset
// number today), not a numbering scheme invented to fill it. displayLabel is chosen as the single
// nameField over vehicleNumber only because ManageTruckDrawer.jsx's read-only identity block and
// the 1:1 MOBILE Location record (whose OWN displayLabel is written from the SAME value at create)
// both already treat it as the record's name; nothing about this choice depends on vehicleNumber's
// reference-field gap above.
//
// truckId IS THE DOCUMENT ID, DECLARED AND ENFORCED, THE SAME SHAPE part.js's partId /
// manufacturer.js's manufacturerId TAKE. truckFromFirestore throws MalformedStoredRecordError if
// `data.truckId !== docId`. Not part of identity (identity is displayLabel, the human-typed
// field); not filterable or sortable. Operator-typed at create (CreateTruckModal's "Truck ID"
// field), not server-generated — the same "chosen, not minted" shape as locationId and
// homeWarehouseId on this same create form, which changes nothing about the ID-not-identity
// treatment already established by the two precedents above.
//
// locationId IS DECLARED AS A PLAIN ID, NOT A REFERENCE — mobile_locations HAS NO REGISTERED
// EntityDefinition (see the file header above and REGISTRATION_PENDING), the same restraint
// part.js already applies to its own equipmentModelId pending a future entity. locationId is
// IMMUTABLE after create ("truck.locationId is IMMUTABLE (no relink op)" per
// truckRegistryCommands.ts's own file header) but that is a write-contract fact, out of this
// read-only definition's scope to assert.
//
// homeWarehouseId IS A REAL REFERENCE — "warehouse" IS ALREADY A REGISTERED ENTITY
// (definitions/warehouse.js). Required on create (parseWarehouseId), checked against a live
// ACTIVE-or-existing Employee/Warehouse in the create/changeTruckHomeWarehouse transactions
// (WarehouseInvalidError). Declared REFERENCE, filterable — the real scope-by-warehouse query
// the Truck Inventory workspace's own warehouse picker already narrows by client-side.
//
// assignedDriverEmployeeId IS A REAL, NULLABLE REFERENCE — "employee" IS ALSO ALREADY
// REGISTERED (definitions/employee.js). Nullable in storage (`string | null`, assignTruckDriver /
// unassignTruckDriver) and validated against a live employee at write time
// (EmployeeInvalidError) — the same nullable-REFERENCE shape salesOrder.js's own `location`
// field takes. "assignedDriverEmployeeId links an Employee and NEVER changes inventory custody"
// (domain/truckRegistry.js) — this is a driver assignment, never a custody signal.
//
// status IS THE GOVERNED FLEET-STATUS ENUM, LABELS SOURCED FROM domain/truckManagement.js's
// truckStatusLabel — never re-declared here as a second copy (the same discipline
// warehouse.js/manufacturer.js apply to their own vocabulary modules). OUT_OF_SERVICE is
// reachable ONLY through the governed, inventory-guarded deactivateTruck path per
// validation.ts's isChangeableStatus comment — a write-contract fact this read-only field
// declaration does not need to (and does not) encode.
//
// `active` IS DECLARED SEPARATELY FROM `status` — A STRUCTURAL FACT, NOT A DUPLICATE. Both are
// genuinely stored (truckToFirestore writes both) and domain/truckRegistry.js's own header names
// them as two distinct signals: "`active` is additionally a truck write-side flag (the read
// model derives the inactive marking from the LOCATION's active, but the truck record carries
// its own)." deactivateTruck sets both atomically (status -> OUT_OF_SERVICE, active -> false),
// but they are not redundant — a record could in principle carry active=false with a different
// status, and nothing here asserts otherwise.
//
// PROVENANCE: version/createdAt/createdBy/updatedAt/updatedBy ARE ALL STORED — REAL FIRESTORE
// TIMESTAMPS, MUTABLE RECORD (+updatedAt/updatedBy, per the contract's own rule). Every write
// path (truckRegistryRepository.ts's metaToFirestore/readMeta) requires and round-trips all
// five; createdAt/updatedAt are Timestamp.fromDate, never epoch milliseconds; version is the
// optimistic-concurrency counter every command CAS-checks (VersionConflictError).
//
// A STATED CLIENT READ-WIRING GAP: THE RAW DOCUMENT CARRIES version/active/createdAt/createdBy/
// updatedAt/updatedBy, BUT THE CLIENT'S OWN PURE VALIDATOR DROPS THEM. Unlike manufacturer.js's
// server-side projection (which truly never sends these fields past the trust boundary),
// services/truckRegistryQueries.js's fetchTruckDocs is a raw client-direct getDocs() read — the
// five fields ARE present in the snapshot data a client receives. But domain/truckRegistry.js's
// own header documents that its TRUCK_FIELDS allow-list "TOLERATES" all five ("never surfaced in
// the validated value") and validateTruckRecord's returned value below (see the function body)
// omits every one of them — the governed value the UI actually renders never carries them. All
// five are declared here as what is genuinely STORED and CLIENT-READABLE at the raw-document
// level, with this narrower (client-parses-them-out, not server-strips-them) gap named rather
// than conflated with manufacturer.js's stronger one.
//
// NO CAPABILITY GATES ANY INDIVIDUAL FIELD — the entity-level role/relationship check above is
// the only gate; nothing in truckRegistryRepository.ts or the Rules block authorizes per-field.
export const truckEntity = makeEntityDefinition({
  id: "truck",
  label: "Truck",
  labelPlural: "Trucks",
  // A client TRUCKS_COLLECTION constant does exist (services/truckRegistryQueries.js), but this
  // program's metadata layer does not import from the services layer (no other *.js definition
  // in this directory does) — the literal here matches that constant and
  // functions/src/truckRegistry/truckRegistryRepository.ts's own TRUCKS_COLLECTION = "trucks".
  collection: "trucks",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null rather
  // than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "displayLabel" }),
  description:
    "The Truck Registry business record (ADR-010 / Decision #60) — links 1:1 to a MOBILE inventory " +
    "location but is NOT itself custody authority. See the file header before extending this.",
  fields: [
    // The document id, declared rather than left implicit — the same shape warehouse.js's
    // warehouseId and manufacturer.js's manufacturerId take. Not part of identity, not
    // filterable or sortable. See the file header.
    makeFieldDefinition({
      id: "truckId",
      entityId: "truck",
      label: "Truck ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body. truckFromFirestore throws if the two disagree.",
    }),
    makeFieldDefinition({
      id: "displayLabel",
      entityId: "truck",
      label: "Display Label",
      type: "STRING",
      sortable: true,
      description: "Required, non-blank on every governed record. The nameField half of identity — see the file header for why vehicleNumber is not.",
    }),
    // Looks like a business reference; is not one. See the file header.
    makeFieldDefinition({
      id: "vehicleNumber",
      entityId: "truck",
      label: "Vehicle Number",
      type: "STRING",
      description:
        "Required, non-blank, operator-typed free text. NOT enforced unique anywhere in this system — two trucks " +
        "may carry the same value. Not promoted to referenceField; see the file header for why.",
    }),
    // Declared as a plain ID, not a REFERENCE — mobile_locations has no registered
    // EntityDefinition. See the file header and REGISTRATION_PENDING.
    makeFieldDefinition({
      id: "locationId",
      entityId: "truck",
      label: "Mobile Location ID",
      type: "ID",
      description: "The 1:1-linked mobile_locations document id. Immutable after create (no relink op). No `mobileLocation` entity is registered in this program yet, so this stays a plain id.",
    }),
    makeFieldDefinition({
      id: "homeWarehouseId",
      entityId: "truck",
      label: "Home Warehouse",
      type: "REFERENCE",
      referenceTo: "warehouse",
      filterable: true,
      operators: ["EQUALS"],
      description: "Required on create; validated against a live Warehouse at every write. Display resolution belongs to the warehouse entity, not to this field.",
    }),
    makeFieldDefinition({
      id: "assignedDriverEmployeeId",
      entityId: "truck",
      label: "Assigned Driver",
      type: "REFERENCE",
      referenceTo: "employee",
      description: "Nullable (string | null) — not every truck has a driver assigned. Links an Employee and never changes inventory custody. Display resolution belongs to the employee entity, not to this field.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "truck",
      label: "Status",
      type: "ENUM",
      enumValues: [...TRUCK_STATUS_OPTIONS],
      enumLabels: Object.fromEntries(TRUCK_STATUS_OPTIONS.map((s) => [s, truckStatusLabel(s)])),
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "ACTIVE/IDLE/OUT_OF_SERVICE. Labels sourced from domain/truckManagement.js's truckStatusLabel — see the file header.",
    }),
    // A structural fact, not a duplicate of status — see the file header.
    makeFieldDefinition({
      id: "active",
      entityId: "truck",
      label: "Active",
      type: "BOOLEAN",
      description: "A separate write-side flag from `status` (deactivateTruck sets both together, but neither implies the other). See the file header for the client read-wiring gap on this field.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "truck",
      label: "Version",
      type: "NUMBER",
      description: "Optimistic-concurrency counter, starting at 1. Stored on every record; see the file header for the client read-wiring gap on this field.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "truck",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate), never epoch milliseconds. Stored on every record; see the file header for the client read-wiring gap on this field.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "truck",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Stored on every record; see the file header for the client read-wiring gap on this field.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "truck",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Stored on every record; see the file header for the client read-wiring gap on this field.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "truck",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Stored on every record; see the file header for the client read-wiring gap on this field.",
    }),
  ],
  // No relationships declared. mobile_locations (the real 1:1 custody-position link) has no
  // registered EntityDefinition — see the file header and REGISTRATION_PENDING.
});

/**
 * The Truck registry index. modules/inventory/TruckInventory.jsx already renders the real
 * workspace, but through the raw fetchTruckDocs()/domain composition directly, not through this
 * metadata contract — a definition is not a surface, the same restraint every other *.index in
 * this program applies.
 *
 * status and homeWarehouseId are the two declared filters — both real, client-narrowable facts
 * (the Truck Inventory workspace's own warehouse picker already scopes by homeWarehouseId; the
 * governed status enum is the fleet-state split every truck-management surface in this program
 * already renders). Two optional equality filters is within MAX_DECLARED_FILTERS (4) and well
 * short of it. defaultSort is displayLabel ASC — the identity field, matching the same "sort by
 * the name half of identity" default warehouse.js/manufacturer.js both apply to their own index.
 */
export const truckIndexList = makeListViewDefinition({
  id: "truck.index",
  entityId: "truck",
  label: "Trucks",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "displayLabel", sortable: true }),
    makeColumn({ fieldId: "vehicleNumber" }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "homeWarehouseId" }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "homeWarehouseId", operators: ["EQUALS"] }),
  ],
  defaultSort: [makeSort({ fieldId: "displayLabel", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "displayLabel", direction: "ASC" })],
    }),
  ],
});
