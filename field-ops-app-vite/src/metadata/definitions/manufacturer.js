import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { MANUFACTURER_STATUSES, MANUFACTURER_STATUS_META } from "../../domain/manufacturerVocabulary.js";

// Manufacturer — S-INV-TRANSFER-MANUFACTURER-DEFINITIONS. Describes the canonical `manufacturers`
// collection (ADR-008 Accepted / Decision #40, functions/src/partMaster/partMasterRepository.ts's
// MANUFACTURERS_COLLECTION, buildFirestoreManufacturerRepository, manufacturerToFirestore/
// manufacturerFromFirestore). The catalog reference object part.js's own header names as missing
// ("no manufacturer EntityDefinition is registered anywhere in this program yet, so this stays a
// plain id") — part.js's primaryManufacturerId is NOT upgraded to a REFERENCE here; that upgrade
// is a separate lane's write (part.js is out of this lane's writeScope) and is recorded in
// REGISTRATION_PENDING.
//
// READ IS A TRUSTED CALLABLE, NOT A CLIENT QUERY — AND A NARROWER PROJECTION THAN WHAT IS STORED.
// `manufacturers` is deny-all in firestore.rules ("allow read, write: if false", unchanged by
// Wave 6) — the same governed-callable posture opportunity.js/salesOrder.js already describe.
// getManufacturerCatalog (functions/src/partMaster/manufacturerReadService.ts) is the ONLY read
// path: an onCall that resolves the caller's `inventory.catalog.read` capability through
// resolveEffectiveAccess, then Admin-SDK-reads the WHOLE collection unbounded/unfiltered/unsorted
// (`db.collection(MANUFACTURERS_COLLECTION).get()`) and projects each doc through
// projectManufacturer() to EXACTLY { manufacturerId, name, status, version } — never the full
// stored document. readCallable therefore names getManufacturerCatalog, matching the entity-level
// choice salesOrder.js/opportunity.js already made for their own single governed list callable.
//
// THE CAPABILITY IS REGISTERED AND INACTIVE. `inventory.catalog.read` exists in
// functions/src/access/permissionCatalog.ts with `active: false` (Wave 6 Owner Decision,
// 2026-08-15) — declaring it here is still correct, the same "register is not grant" note
// opportunity.js/salesOrder.js already record for their own capabilities.
//
// IDENTITY IS A nameField ONLY. `name` is required and non-blank on every governed record
// (manufacturerFromFirestore throws MalformedStoredRecordError otherwise; createManufacturer/
// updateManufacturer both reject an empty/whitespace name before it reaches the repository).
// There is no manufacturer code or reference number anywhere in the domain type
// (functions/src/partMaster/types.ts Manufacturer: { manufacturerId, name, status }) or in
// firestore.rules — nothing is promoted to referenceField the data does not carry (DECISIONS
// #106), the same restraint warehouse.js/supplier.js apply to their own single nameField.
//
// manufacturerId IS THE DOCUMENT ID, DECLARED AND ENFORCED, THE SAME SHAPE part.js's partId
// TAKES. manufacturerFromFirestore throws if `data.manufacturerId !== docId` — the two-identity-
// fields precedent (document id vs. business identity being the SAME fact) part.js's own header
// names, extended here rather than repeated as prose. Not part of identity (identity is `name`,
// the human-typed field); not filterable or sortable.
//
// normalizedName IS DECLARED, RENDERED, AND — UNLIKE SUPPLIER'S normalizedKey — HAS NO CONSUMER
// AT ALL TODAY. manufacturerToFirestore derives it at every write
// (`m.name.trim().replace(/\s+/g, " ").toUpperCase()`), but a full-repository search
// (functions/src, field-ops-app-vite/src) finds no reader anywhere: no dedup-detection lookup
// (unlike supplierMasterCommands.ts's findActiveByNormalizedKey, which supplier.js's own header
// documents as normalizedKey's real, if narrow, purpose), no query, no UI render. It is declared
// because it IS genuinely stored — omitting a real field would be its own kind of dishonesty —
// but the description says what it actually is: a derived write-time artifact with zero present
// consumers, not a dedup key in active use and never a display value (a normalized key is not a
// display value — it is upper-cased and whitespace-collapsed precisely so it is NOT what a human
// reads).
//
// STATUS VOCABULARY COMES FROM domain/manufacturerVocabulary.js, never a second copy here — that
// module's own header explains why it exists (neither manufacturersView.js nor Manufacturers.jsx
// carries a label distinct from the stored token itself).
//
// version IS DECLARED AND IS THE ONE PROVENANCE-ADJACENT FIELD THE READ PROJECTION ACTUALLY
// RETURNS. manufacturerReadService.ts's own comment on ManufacturerProjection.version explains
// why: added in the Part 11 reconciliation specifically so this SAME governed read could serve
// the write-capable Manufacturer admin workspace (modules/inventory/Manufacturers.jsx), which
// needs it as `expectedVersion` for createManufacturer/updateManufacturer/
// changeManufacturerStatus's optimistic-concurrency check (partMasterCommands.ts). Not filterable
// or sortable — nothing scans or queries by it, the same restraint supplier.js's own version
// field takes.
//
// createdAt/createdBy/updatedAt/updatedBy ARE DECLARED AS WHAT IS STORED, NOT AS WHAT THE
// CALLABLE RETURNS — A STATED READ-WIRING GAP, THE SAME SHAPE salesOrder.js's salesOrderNumber
// GAP TAKES. Every governed record carries all four (readMeta in partMasterRepository.ts throws
// MalformedStoredRecordError if version/createdAt/createdBy/updatedAt/updatedBy is missing or
// malformed; createdAt/updatedAt are real Firestore server Timestamps via Timestamp.fromDate,
// never epoch milliseconds). But ManufacturerProjection — the ONLY shape getManufacturerCatalog
// actually returns — carries none of the four; no UI can render them today. Declaring them
// describes what the record IS (this collection's one write path, unlike Contact's three
// disagreeing ones, is unambiguous about what it stores), not a claim that the current read
// wiring already surfaces them end to end — the identical distinction salesOrder.js's header
// draws between "what the collection stores" and "what today's projection returns."
//
// NO CAPABILITY GATES ANY INDIVIDUAL FIELD. inventory.catalog.read gates the WHOLE projection
// (entity-level, above); there is no finer-grained per-field authorization anywhere in
// manufacturerReadService.ts, so no field below declares its own readCapability.
//
// status IS THE ONE DECLARED FILTER, AND IT IS FORWARD-LOOKING, MATCHING WAREHOUSE/SUPPLIER'S
// OWN RESTRAINT. getManufacturerCatalog's own query is unbounded and unfiltered today (`.get()`
// over the whole collection, no `.where()`); the client narrows client-side
// (manufacturerCatalogView.js's manufacturerPickerOptions filters status === "ACTIVE" in memory,
// never as a query). warehouse.js/supplier.js both declare their own single status filter despite
// an identical gap ("applied CLIENT-SIDE today... no real backend query filters by status") on
// the reasoning that a future INDEX surface wants the same distinction the workspace already
// offers, and Firestore's composite-index requirement is identical whether the eventual query
// runs client-side or (as here) inside a future getManufacturerCatalog enhancement over the Admin
// SDK — the same composite would be demanded either way. One optional equality filter on a
// two-value enum is a single net-new composite, well inside MAX_DECLARED_FILTERS.
export const manufacturerEntity = makeEntityDefinition({
  id: "manufacturer",
  label: "Manufacturer",
  labelPlural: "Manufacturers",
  collection: "manufacturers",
  readVia: "CALLABLE",
  readCallable: "getManufacturerCatalog",
  readCapability: "inventory.catalog.read",
  identity: makeIdentity({ nameField: "name" }),
  description:
    "The catalog reference object for a Part's manufacturer (ADR-008 / Decision #40) — deny-all in Rules, " +
    "read only through the trusted getManufacturerCatalog callable.",
  fields: [
    makeFieldDefinition({
      id: "manufacturerId",
      entityId: "manufacturer",
      label: "Manufacturer ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body. manufacturerFromFirestore throws if the two disagree.",
    }),
    makeFieldDefinition({
      id: "name",
      entityId: "manufacturer",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "Required, non-blank on every governed record. The nameField half of identity; no reference number exists anywhere in this schema.",
    }),
    // Rendered, not filtered — and, unlike supplier.js's normalizedKey, has no consumer of any
    // kind today. See the file header.
    makeFieldDefinition({
      id: "normalizedName",
      entityId: "manufacturer",
      label: "Normalized Name",
      type: "STRING",
      description:
        "Deterministic write-time normalization of `name` (trim + collapse whitespace + upper-case), stored on " +
        "every record but read by NOTHING in this repository today — not a dedup key in active use, and never a " +
        "display value. See the file header.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "manufacturer",
      label: "Status",
      type: "ENUM",
      enumValues: [...MANUFACTURER_STATUSES],
      enumLabels: Object.fromEntries(MANUFACTURER_STATUSES.map((s) => [s, MANUFACTURER_STATUS_META[s].label])),
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description:
        "ACTIVE/INACTIVE. Returned by the read projection (projectManufacturer reports null for an unrecognized " +
        "status rather than guessing). Filterable/sortable as a forward-looking declaration — see the file header " +
        "for why no query filters by it today.",
    }),
    // The one provenance-adjacent field the projection actually returns — see the file header.
    makeFieldDefinition({
      id: "version",
      entityId: "manufacturer",
      label: "Version",
      type: "NUMBER",
      description: "Optimistic-concurrency counter, starting at 1. Returned by getManufacturerCatalog for the write-capable admin workspace's `expectedVersion`.",
    }),
    // Stored, and enforced at every write, but NOT returned by getManufacturerCatalog today —
    // see the file header.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "manufacturer",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp (Timestamp.fromDate), never epoch milliseconds. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "manufacturer",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "manufacturer",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "manufacturer",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Stored on every record; not returned by the current read projection — see the file header.",
    }),
  ],
  // No relationships declared. The one real inbound edge (Part -> Manufacturer, via
  // part.primaryManufacturerId) belongs on Part as an outbound REFERENCE once that field is
  // upgraded — part.js is out of this lane's writeScope. See REGISTRATION_PENDING.
});

/**
 * The Manufacturer registry index. modules/inventory/Manufacturers.jsx already renders the real
 * admin workspace, but through the raw getManufacturerCatalog result directly, not through this
 * metadata contract — a definition is not a surface, the same restraint every other *.index in
 * this program applies.
 *
 * status IS THE ONE DECLARED FILTER — see the file header for why this is forward-looking rather
 * than a description of a real query getManufacturerCatalog runs today. defaultSort is name ASC,
 * matching toManufacturerListView's own in-memory sort (domain/manufacturersView.js) — the real
 * order the admin workspace already presents. One optional equality filter plus one sort field is
 * a single net-new composite (status+name+__name__), confirmed in the test file.
 *
 * NO DOCUMENT ID COLUMN (DECISIONS #106). manufacturerId (the Firestore document id) used to be
 * declared as a visible column here even though identity already names `name` as the real
 * human-meaningful field (makeIdentity({ nameField: "name" }), above) -- a missing BUSINESS
 * REFERENCE is not permission to show a record id instead. name is what a person actually reads
 * on every governed record (required, non-blank, enforced by manufacturerFromFirestore); the id
 * column added nothing a reader could use and is dropped rather than kept out of caution.
 */
export const manufacturerIndexList = makeListViewDefinition({
  id: "manufacturer.index",
  entityId: "manufacturer",
  label: "Manufacturers",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 50,
  capabilityRequirement: "inventory.catalog.read",
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
