import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";

// MobileLocation — A-ENTITY-TERRITORY-MOBILE-DEFINITIONS. Describes the LIVE `mobile_locations`
// collection (EI Truck Registry, ADR-010 / Decision #60): functions/src/truckRegistry/
// truckRegistryRepository.ts's StoredMobileLocation (mobileLocationToFirestore/
// mobileLocationFromFirestore), the REAL MOBILE Inventory Location — not the truck business
// record. truck.js's own header names exactly this gap before it existed: "locationId IS DECLARED
// AS A PLAIN ID, NOT A REFERENCE — mobile_locations HAS NO REGISTERED EntityDefinition" and lists
// the upgrade as a REGISTRATION_PENDING item, which this file is what would satisfy (out of this
// lane's writeScope to edit truck.js itself; see the handoff).
//
// WHY THIS COLLECTION EXISTS AS A SEPARATE ENTITY FROM Truck. ADR-010 (mirrored verbatim in
// functions/src/truckRegistry/types.ts's file header and domain/truckRegistry.js's own header) is
// explicit that a truck's inventory custody POSITION is a SEPARATE collection from the truck
// business record, linked 1:1 via trucks/{truckId}.locationId, enforced transactionally
// server-side (the location_truck_claims/{locationId} guard doc), never expressible in Firestore
// Rules. This definition describes ONLY the mobile_locations/{locationId} record itself — the
// inventory key referenced by the ledger/serialized-asset system for "what is on this truck" —
// not that custody authority, which lives entirely outside this program's metadata layer.
//
// READ IS CLIENT_DIRECT, ROLE-GATED, NO CAPABILITY — THE SAME SHAPE AS trucks/{truckId}.
// firestore.rules: "match /mobile_locations/{locationId} { allow read: if isAdminOrDispatcher();
// allow create, update, delete: if false; }" (adjacent to, and cross-referenced by, the
// trucks/{truckId} block's own comment: "mobile_locations is the inventory Location record (docId
// IS the locationId); trucks is the business record (docId IS the truckId)"). This is a
// role/relationship check, not a capability id — there is no `mobileLocation.read` (or similar)
// entry in the capability catalog (functions/src/access/permissionCatalog.ts). The ONE registered
// capability that touches this collection, `inventory.location.display.read`
// (permissionCatalog.ts), is a DIFFERENT, narrower thing: a trusted bounded-point-read PROJECTION
// service (functions/src/inventoryLocation/locationDisplayReadService.ts) resolving { locationId,
// type, label } for a caller-supplied set of ids, registered but UNGRANTED (active:false) — it
// does not gate this collection's own Rules-level read, and citing it as this entity's
// readCapability would misattribute a different service's gate to this one. readCapability is
// therefore null, the same finding truck.js and warehouse.js already record for their own
// role-gated collections.
//
// ALL WRITES ARE THE SAME TRUSTED, TRANSACTIONAL COMMAND SERVICE TRUCK.JS ALREADY NAMES AS
// UNDEPLOYED. truckRegistryCommands.ts's eight commands (createTruck et al.) stage every
// mobile_locations write (stageCreateLocation/stageUpdateLocation, truckRegistryRepository.ts) in
// the SAME transaction as the linked trucks/{truckId} write — there is no independent write path
// for a MOBILE Location on its own. Nothing in functions/src/index.ts exports a callable reaching
// these commands, the identical undeployed-not-unknown gap truck.js's own header records at
// length. This definition declares no write contract of its own — that stays a
// PageDefinition/action-exposure concern, out of §7's layering for this file.
//
// IDENTITY IS A nameField ONLY — displayLabel — THE SAME CHOICE AND THE SAME REASONING AS
// truck.js's OWN displayLabel. mobileLocationFromFirestore throws MalformedStoredRecordError if
// displayLabel is missing or blank, so it is a genuine, always-present human reference — mirrored
// from the linked truck's own displayLabel at create time (validateCreateInput,
// functions/src/truckRegistry/validation.ts: "displayLabel is written to BOTH the truck and its
// MOBILE Location"). locationId LOOKS like a business reference (operator-typed at create,
// doc-uniqueness enforced — LocationClaimedError) but is not promoted to referenceField, for
// exactly the reason truck.js's own header gives for truckId: it is the document id, not a
// separately-typed, human-legible business number. Declared below as its own ID field instead,
// the identical "chosen, not minted, but still not identity" treatment.
//
// type IS A SINGLE-VALUE, GOVERNED DISCRIMINANT, NOT A REAL ENUM. mobileLocationFromFirestore
// requires data.type === "MOBILE" and throws otherwise — every stored document in this collection
// carries the identical literal value. Declaring it as an ENUM would imply a filterable dimension
// with more than one real outcome, which this field structurally cannot have (the collection IS
// the MOBILE partition; there is no sibling WAREHOUSE/CUSTOMER document living here). Declared as
// a plain STRING, not filterable, not sortable — a stored, governed fact rather than a variable
// one.
//
// active IS A SEPARATE, GENUINELY-STORED FLAG — THE SAME STRUCTURAL FACT truck.js's OWN `active`
// FIELD RECORDS. mobileLocationToFirestore writes it on every record; deactivateTruck
// (truckRegistryCommands.ts) sets it (alongside the linked truck's own active flag) atomically,
// but domain/truckRegistry.js's header is explicit the two are not redundant by construction.
//
// PROVENANCE: version/createdAt/createdBy/updatedAt/updatedBy ARE ALL STORED — REAL FIRESTORE
// TIMESTAMPS, MUTABLE RECORD (+updatedAt/updatedBy). metaToFirestore/readMeta
// (truckRegistryRepository.ts) require and round-trip all five on this collection exactly as they
// do on trucks — createdAt/updatedAt are Timestamp.fromDate, never epoch milliseconds; version is
// the same optimistic-concurrency counter (VersionConflictError) shared across the linked pair.
//
// NO CLIENT READ-WIRING GAP RECORDED HERE, UNLIKE truck.js's OWN NOTE. truck.js records that its
// client-side pure validator (domain/truckRegistry.js) drops version/active/createdAt/createdBy/
// updatedAt/updatedBy from the value it renders, even though the raw client-direct read carries
// them. No equivalent client-side reader for mobile_locations exists anywhere in this codebase
// today (grepping src/domain and src/services for a mobile_locations parser/validator finds none)
// — there is no narrower gap to record because there is no consumer to have the gap. All five
// fields are declared here as what is genuinely stored and, per the Rules block above,
// client-readable at the raw-document level.
export const mobileLocationEntity = makeEntityDefinition({
  id: "mobileLocation",
  label: "Mobile Location",
  labelPlural: "Mobile Locations",
  // Matches functions/src/truckRegistry/truckRegistryRepository.ts's own
  // MOBILE_LOCATIONS_COLLECTION = "mobile_locations". No client-side collection-name constant
  // exists for this collection anywhere in field-ops-app-vite/src today.
  collection: "mobile_locations",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null rather
  // than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "displayLabel" }),
  description:
    "The MOBILE Inventory Location record (ADR-010 / Decision #60) 1:1-linked to a Truck business record " +
    "(trucks/{truckId}.locationId) — the real inventory-custody-position key, not the truck record itself. " +
    "See the file header before extending this.",
  fields: [
    // The document id, declared rather than left implicit — the same shape truck.js's truckId
    // takes. Not part of identity, not filterable or sortable. See the file header.
    makeFieldDefinition({
      id: "locationId",
      entityId: "mobileLocation",
      label: "Location ID",
      type: "ID",
      description:
        "The Firestore document id, also written into the document body. mobileLocationFromFirestore throws " +
        "if the two disagree. Operator-typed at create (shared with the linked truck's create form), doc-unique, " +
        "but not promoted to referenceField — see the file header for why (the same treatment truck.js applies " +
        "to its own truckId).",
    }),
    makeFieldDefinition({
      id: "type",
      entityId: "mobileLocation",
      label: "Location Type",
      type: "STRING",
      description:
        "Always the literal \"MOBILE\" on every stored document (mobileLocationFromFirestore enforces this and " +
        "throws otherwise). A governed discriminant, not a real multi-value dimension — see the file header for " +
        "why this is not declared as an ENUM.",
    }),
    makeFieldDefinition({
      id: "displayLabel",
      entityId: "mobileLocation",
      label: "Display Label",
      type: "STRING",
      sortable: true,
      description:
        "Required, non-blank on every governed record. Mirrored from the linked truck's own displayLabel at " +
        "create time. The nameField half of identity — see the file header.",
    }),
    makeFieldDefinition({
      id: "active",
      entityId: "mobileLocation",
      label: "Active",
      type: "BOOLEAN",
      filterable: true,
      operators: ["EQUALS"],
      description:
        "A separate write-side flag, set alongside (but not implied by) the linked truck's own active flag. " +
        "See the file header for the structural-fact reasoning, mirrored from truck.js.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "mobileLocation",
      label: "Version",
      type: "NUMBER",
      description: "Optimistic-concurrency counter, starting at 1. Stored on every record, shared metadata shape with the linked truck.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "mobileLocation",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate), never epoch milliseconds. Stored on every record.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "mobileLocation",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Stored on every record.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "mobileLocation",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Stored on every record.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "mobileLocation",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Stored on every record.",
    }),
  ],
  // No relationships declared. The 1:1 link to Truck is owned by trucks/{truckId}.locationId (a
  // plain ID field on truck.js, out of this lane's writeScope to upgrade to REFERENCE — see the
  // file header and the handoff's REGISTRATION_PENDING item) — an outbound edge belongs on the
  // entity that carries the pointing field, not on the entity being pointed at.
});

/**
 * The MobileLocation registry index. No standalone route renders this yet — a definition is not
 * a surface, the same restraint truck.js's own truckIndexList applies — but it is defined now so
 * a future route (or the truck.js locationId REFERENCE upgrade named in REGISTRATION_PENDING) has
 * a real target.
 *
 * active IS THE ONE DECLARED FILTER — the one real, client-narrowable boolean this collection
 * stores; a single optional equality filter stays well inside MAX_DECLARED_FILTERS (4).
 * defaultSort is displayLabel ASC, matching truck.js's and warehouse.js's own "sort by the name
 * half of identity" default for exactly the same reason: this list is scanned for a mobile
 * location by its human label, not read top-down like an operational queue.
 */
export const mobileLocationIndexList = makeListViewDefinition({
  id: "mobileLocation.index",
  entityId: "mobileLocation",
  label: "Mobile Locations",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "displayLabel", sortable: true }),
    makeColumn({ fieldId: "active" }),
    makeColumn({ fieldId: "updatedAt", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "active", operators: ["EQUALS"] })],
  defaultSort: [makeSort({ fieldId: "displayLabel", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      filters: [{ fieldId: "active", operator: "EQUALS", value: true }],
      sort: [makeSort({ fieldId: "displayLabel", direction: "ASC" })],
    }),
  ],
});
