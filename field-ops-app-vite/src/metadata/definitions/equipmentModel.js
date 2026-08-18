import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { MODEL_STATUSES } from "../../domain/equipmentModel.js";

// EquipmentModel — A-ENTITY-FLEET-CATALOG-DEFINITIONS. Describes the `equipment_models`
// collection (D4 Part-Equipment Compatibility, the D1 identity authority mirrored in
// functions/src/equipmentCompatibility/domain/equipmentModel.ts and
// field-ops-app-vite/src/domain/equipmentModel.js — parity enforced by
// functions/test/equipmentCompatibilityDomainParity.test.mjs). Storage adapter:
// functions/src/equipmentCompatibility/equipmentModelRepository.ts's modelToFirestore/
// modelFromFirestore.
//
// A CATALOG MODEL ENTRY, NOT THE INSTALLED-ASSET REGISTER. equipment.js's own header already
// names this collection and warns against confusing the two: equipment.js is (A), an Account's
// physically installed, owned asset; `equipment_models` is (B), a manufacturer/model CATALOG
// reference row a Part's compatibility can point at — no owner, no location, no serial, no
// lifecycle of a physical unit. This definition describes (B) only. equipment_model_aliases
// (alternate manufacturer/historical/source spellings that resolve TO one equipmentModelId) and
// equipment_part_compatibility (the Part<->Model compatibility edge) are separate collections
// with their own identity/edge contracts — the task's own framing is explicit that those concerns
// do not belong absorbed into this file, and neither has a registered EntityDefinition here (see
// REGISTRATION_PENDING).
//
// DENY-ALL IN RULES; A READ SERVICE EXISTS BUT IS UNDEPLOYED — THE SAME UNDEPLOYED-CALLABLE
// HONESTY THE TRUCK REGISTRY LANE OF THIS PROGRAM ALREADY ESTABLISHES. firestore.rules'
// `equipment_models/{equipmentModelId}` is `allow read, write: if false` for every principal,
// admin included ("Rules cannot invoke the server-side Issue #226 effective-permission resolver,
// so D4 does not attempt a governed client read at all"). The one real read path is
// functions/src/equipmentCompatibility/readService.ts (readModelSummary /
// readCompatibilityForModel / readCompatibilityForPart), wired to an actual onCall adapter,
// `equipmentCompatibilityReadCallable` (equipmentCompatibilityReadCallable.ts) — but that
// adapter's own header states it is "DELIBERATELY NOT exported from functions/src/index.ts, so
// it is not deployed and no client can invoke it until a separate, later Owner production
// authorization." readVia is CALLABLE with that real (if currently unreachable) name, not
// UNKNOWN — the same "undeployed is still the honest read path" restraint this lane's truck.js
// records for the Truck Registry commands.
//
// THE CAPABILITY IS REGISTERED AND INACTIVE. `equipment.compatibility.view`
// (functions/src/access/permissionCatalog.ts) gates the whole read service
// (readService.ts's READ_CAPABILITY) but is registered `active: false` — "D5 activates nothing"
// per readService.ts's own header. Declared here anyway, the same "register is not grant"
// restraint manufacturer.js already records for its own capability.
//
// IDENTITY IS A nameField ONLY — "displayName". validateEquipmentModel rejects an empty
// displayName (`display_name_invalid`) on every governed record. There is no independently
// unique business reference in this schema: modelNumber is REQUIRED and normalized
// (normalizeModelNumber) but is only a manufacturer's own catalog number — it is NOT globally
// unique BY ITSELF (two different manufacturers can legitimately share a modelNumber; a Windex
// "100" and a Rheem "100" are different equipment). What IS globally unique is the composite
// equipmentModelId (`{manufacturerId}--{modelNumber}`, buildEquipmentModelId /
// isCanonicalEquipmentModelId) — but that composite is the DOCUMENT ID, the same doc-id-not-
// identity treatment part.js's partId and manufacturer.js's manufacturerId already take, not a
// human-typed reference a person reads to identify one record among a manufacturer's whole
// catalog. modelNumber is declared below as a plain field (filterable/sortable — it is exactly
// what a technician or catalog admin actually searches by within a manufacturer), not promoted
// to referenceField.
//
// equipmentModelId IS THE DOCUMENT ID, DECLARED AND ENFORCED. modelFromFirestore throws
// MalformedStoredRecordError if `data.equipmentModelId !== docId`, AND separately if the doc id
// itself is not canonical (`isCanonicalEquipmentModelId(docId)`) — a stronger guarantee than
// manufacturer.js's manufacturerId (which only checks the two AGREE, not that either is
// independently well-formed against a derivation rule). Not part of identity; not filterable or
// sortable.
//
// manufacturerId IS A REAL REFERENCE — "manufacturer" IS ALREADY A REGISTERED ENTITY
// (definitions/manufacturer.js). Required, normalized (normalizeManufacturerId), and is HALF of
// the equipmentModelId derivation (buildEquipmentModelId(manufacturerId, modelNumber)) — the
// same "component of the doc id, but still a genuine FK worth declaring" shape this program has
// not needed to describe before now. Declared REFERENCE, filterable.
//
// manufacturerName IS DENORMALIZED, NOT DERIVED FROM THE REFERENCE AT READ TIME. Every governed
// record stores its own manufacturerName string (normalizeEquipmentModel), independent of
// whatever the referenced manufacturer's OWN `name` field currently says — and
// readModelForDisplay/readModelSummary (readService.ts) return THIS denormalized string, never
// resolving manufacturerId through the manufacturer entity at read time. Declared as a plain
// STRING for that reason, not treated as redundant with the manufacturerId REFERENCE above.
//
// family/subtype/revision ARE ALL OPTIONAL (string | null in the D1 contract — normalizeEquipmentModel
// maps a blank input to null on all three, never an empty string). None is filterable/sortable —
// nothing in readService.ts or the D1 contract queries or scans by any of the three.
//
// status IS THE GOVERNED CATALOG-LIFECYCLE ENUM (DRAFT/ACTIVE/INACTIVE/RETIRED,
// domain/equipmentModel.js's MODEL_STATUSES). NO client-facing label map module exists for it
// anywhere in this repository (unlike warehouse.js's WAREHOUSE_STATUS_META or manufacturer.js's
// MANUFACTURER_STATUS_META) — labels are declared inline below, the same idiom
// account.js/purchaseOrder.js already use for their own enums with no dedicated vocabulary
// module. NOT returned by the read projection today — see the read-projection-gap paragraph
// below — so filterable/sortable here is forward-looking, the same restraint warehouse.js/
// manufacturer.js apply to their own status field despite an identical gap.
//
// sourceAuthority IS REQUIRED AND STORED, DECLARED AS A PLAIN STRING. validateEquipmentModel
// rejects an empty value (`source_authority_invalid`) but the D1 contract does not constrain it
// to a closed vocabulary (no enum, no registry found anywhere in equipmentModel.ts or its client
// mirror) — declaring it ENUM would assert a closed set that does not exist. Not filterable or
// sortable; nothing scans by it.
//
// version IS DECLARED, THE SAME OPTIMISTIC-CONCURRENCY SHAPE manufacturer.js's version TAKES.
// Required integer >= 1 (validateEquipmentModel's version_invalid check). Not filterable/sortable.
//
// PROVENANCE: createdAt/createdBy/updatedAt/updatedBy ARE ALL STORED — REAL FIRESTORE
// TIMESTAMPS, MUTABLE RECORD (+updatedAt/updatedBy). repository.ts's metaToFirestore/readMeta
// require and round-trip all four on every write, and additionally refuse to persist a record
// updated before it was created — the strongest provenance guarantee any collection in this
// program enforces so far. Never epoch milliseconds.
//
// A STATED READ-PROJECTION GAP, THE SAME SHAPE manufacturer.js's own gap TAKES.
// EquipmentModelSummary — the ONLY shape either read mode (readModelForDisplay / readModelSummary)
// ever returns — is EXACTLY `{ manufacturerName, modelNumber, displayName, family, subtype }`.
// Every other declared field below (equipmentModelId, manufacturerId, revision, status,
// sourceAuthority, version, and all four provenance fields) is genuinely STORED on every governed
// record but is NOT returned by the current (undeployed) read service in either mode. Declared
// here as what the collection stores, not as a claim about what today's read wiring already
// surfaces end to end.
//
// NO CAPABILITY GATES ANY INDIVIDUAL FIELD. equipment.compatibility.view gates the WHOLE read
// service (entity-level, above); nothing in readService.ts authorizes per field.
export const equipmentModelEntity = makeEntityDefinition({
  id: "equipmentModel",
  label: "Equipment Model",
  labelPlural: "Equipment Models",
  collection: "equipment_models",
  readVia: "CALLABLE",
  readCallable: "equipmentCompatibilityReadCallable",
  readCapability: "equipment.compatibility.view",
  identity: makeIdentity({ nameField: "displayName" }),
  description:
    "A manufacturer/model catalog reference row (D4 Part-Equipment Compatibility) — deny-all in Rules, " +
    "read only through an undeployed governed callable. Not the equipment.js installed-asset register.",
  fields: [
    makeFieldDefinition({
      id: "equipmentModelId",
      entityId: "equipmentModel",
      label: "Equipment Model ID",
      type: "ID",
      description: "The Firestore document id (`{manufacturerId}--{modelNumber}`), also written into the document body and independently validated as canonical. See the file header.",
    }),
    makeFieldDefinition({
      id: "displayName",
      entityId: "equipmentModel",
      label: "Display Name",
      type: "STRING",
      sortable: true,
      description: "Required, non-blank on every governed record. The nameField half of identity; no independently-unique business reference exists — see the file header.",
    }),
    makeFieldDefinition({
      id: "manufacturerId",
      entityId: "equipmentModel",
      label: "Manufacturer",
      type: "REFERENCE",
      referenceTo: "manufacturer",
      filterable: true,
      operators: ["EQUALS"],
      description: "Required. Also half of the equipmentModelId derivation. Display resolution belongs to the manufacturer entity, not to this field — see manufacturerName below for what the read projection actually returns instead.",
    }),
    makeFieldDefinition({
      id: "manufacturerName",
      entityId: "equipmentModel",
      label: "Manufacturer Name",
      type: "STRING",
      description: "Denormalized at write time, independent of the referenced manufacturer's current `name`. This, not the manufacturerId reference, is what the read projection actually returns — see the file header.",
    }),
    makeFieldDefinition({
      id: "modelNumber",
      entityId: "equipmentModel",
      label: "Model Number",
      type: "STRING",
      filterable: true,
      sortable: true,
      operators: ["EQUALS"],
      description: "Required, normalized. A manufacturer's own catalog number — unique only in combination with manufacturerId, not by itself. Not promoted to referenceField; see the file header.",
    }),
    makeFieldDefinition({
      id: "family",
      entityId: "equipmentModel",
      label: "Family",
      type: "STRING",
      description: "Optional (null when blank at write time). Not filterable or sortable — nothing queries by it.",
    }),
    makeFieldDefinition({
      id: "subtype",
      entityId: "equipmentModel",
      label: "Subtype",
      type: "STRING",
      description: "Optional (null when blank at write time). Not filterable or sortable — nothing queries by it.",
    }),
    makeFieldDefinition({
      id: "revision",
      entityId: "equipmentModel",
      label: "Revision",
      type: "STRING",
      description: "Optional (null when blank at write time). Not filterable or sortable — nothing queries by it. Not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "equipmentModel",
      label: "Status",
      type: "ENUM",
      enumValues: [...MODEL_STATUSES],
      enumLabels: {
        DRAFT: "Draft",
        ACTIVE: "Active",
        INACTIVE: "Inactive",
        RETIRED: "Retired",
      },
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "DRAFT/ACTIVE/INACTIVE/RETIRED. No dedicated vocabulary module exists for this enum — labels declared inline; see the file header. Not returned by the current read projection.",
    }),
    makeFieldDefinition({
      id: "sourceAuthority",
      entityId: "equipmentModel",
      label: "Source Authority",
      type: "STRING",
      description: "Required, non-blank. Not a closed vocabulary in the D1 contract, so not declared ENUM. Not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "equipmentModel",
      label: "Version",
      type: "NUMBER",
      description: "Optimistic-concurrency counter, starting at 1. Not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "equipmentModel",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "equipmentModel",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "equipmentModel",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
      description: "A real Firestore server Timestamp, never epoch milliseconds. Stored on every record; not returned by the current read projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "equipmentModel",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Stored on every record; not returned by the current read projection — see the file header.",
    }),
  ],
  // No relationships declared. equipment_model_aliases and equipment_part_compatibility both
  // reference an equipmentModelId, but neither has a registered EntityDefinition in this program
  // — see the file header and REGISTRATION_PENDING. part.js's own equipmentModelId field (a
  // plain string today, per that file's header) is the one real inbound edge and belongs on Part
  // once it is upgraded to a REFERENCE — also out of this lane's writeScope.
});

/**
 * NO INDEX LIST VIEW — DELIBERATE, AND A GOVERNANCE BOUNDARY RATHER THAN AN OVERSIGHT.
 *
 * `equipment_models` is a D4-GOVERNED collection (functions/src/equipmentCompatibility/
 * repository.ts declares it as EQUIPMENT_MODELS_COLLECTION alongside the alias, part-compatibility,
 * source and operation collections). D4's own contract defers compound query shapes to D5, and
 * functions/test/equipmentCompatibilityRegistry.test.mjs asserts it: "D4 declares no compound
 * index for the governed collections."
 *
 * An earlier revision of this file declared an INDEX list view whose filters derived three
 * `equipment_models` composite indexes. That breached D4's boundary. It went undetected because
 * the equipment-compatibility workflow's path filter did not include `firestore.indexes.json`,
 * so the guard never ran on the PR that introduced it — the indexes were declared, deployed to
 * sandbox, and only surfaced when an unrelated change happened to trigger that workflow.
 *
 * The correction is this absence, not a weakened assertion: defining an entity does NOT confer
 * indexing authority over a collection another program governs. If a catalog INDEX surface is
 * ever wanted here, it arrives through an explicit D5 supersession that moves the boundary,
 * not through a metadata definition that quietly crosses it.
 *
 * Nothing consumed the removed list view: no UI referenced it, and this entity's readVia is
 * CALLABLE against a capability registered `active: false`. Removing it costs no behaviour.
 */
