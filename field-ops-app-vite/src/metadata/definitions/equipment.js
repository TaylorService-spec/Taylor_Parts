import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { EQUIPMENT_COLLECTION } from "../../domain/constants.js";
import { EQUIPMENT_STATUS_VALUES, EQUIPMENT_STATUS_LABEL } from "../../domain/equipmentStatus.js";

// Equipment (installed-asset register) — S-INV-EQUIPMENT-DEFINITION.
//
// TWO UNRELATED THINGS SHARE THE NAME "EQUIPMENT" IN THIS CODEBASE. This file
// defines (A), the one this comment is about; do not confuse it with (B):
//
//   (A) THE INSTALLED-ASSET REGISTER — collection `equipment` (EQUIPMENT_COLLECTION,
//       domain/constants.js), an Account's serviceable asset installed at one of that
//       Account's Locations (ADR-006, docs/specifications/equipment-and-installed-
//       asset-management.md). THIS is what this definition describes.
//   (B) THE COMPATIBILITY CATALOG — collection `equipment_models` and its siblings
//       (equipment_model_aliases, equipment_part_compatibility, ...). Deny-all in
//       Rules, undeployed, and a wholly different concept (a model/catalog entry, not
//       an owned physical asset). It has no entity definition here and this one must
//       never be read as describing it.
//
// IDENTITY: nameField "name", deliberately NO referenceField. The doc id is
// Firestore-generated and `name` is the human reference (the Rules comment for this
// collection says so explicitly). `serialNumber` and `assetTag` both look like
// business references but are NOT: both are OPTIONAL (Spec §1: string | null) and
// NEITHER is enforced unique by Rules or by normalizeEquipmentInput
// (domain/equipment.js) — real installed assets can and do lack one or both. An
// identity field that is frequently absent is worse than none (the same reasoning
// workOrder.js's identity comment gives): it licenses a surface to fall back to
// something, and the something is always the document id — the exact defect
// DECISIONS #106 forbids reintroducing. So neither is declared as a referenceField.
//
// A RECORDED FINDING, X-EQUIPMENT-PROVENANCE-GAP: `equipment` stores createdAt and
// updatedAt as NUMBERS — epoch milliseconds, exactly what equipmentCreateShapeValid /
// the update guard in firestore.rules assert (`data.createdAt is number`,
// `request.resource.data.updatedAt is number`), never a Firestore Timestamp — and the
// collection has NO createdBy/updatedBy at all; equipmentWritableKeys() in
// firestore.rules lists neither. Both fields are declared below with type NUMBER, not
// TIMESTAMP, because reinterpreting an epoch number as a Timestamp to match the
// "standard" provenance presentation would assert storage semantics this record does
// not have. The two actor fields are left undeclared entirely, for the same reason
// contact.js leaves its provenance undeclared: a definition claiming createdBy/
// updatedBy would assert data that is simply absent from every document in this
// collection, and the remediation is a write-path change, not a metadata claim.
//
// STATUS VOCABULARY: EQUIPMENT_STATUS_VALUES / EQUIPMENT_STATUS_LABEL, from the new
// domain/equipmentStatus.js — created alongside this definition because no canonical
// label map existed. Two surfaces (modules/equipment/EquipmentDetail.jsx and
// modules/equipment/EquipmentRegister.jsx) each carried a byte-identical private
// `STATUS_LABEL` object; equipmentStatus.js is the shared source those two private
// copies agreed with by coincidence, mirroring how workOrderStatus.js already solved
// this one field over. The metadata layer cites it rather than inlining a second copy
// (§7/§8: a definition is data, and an inline label map would BE a third private
// copy). Transitions TO or FROM RETIRED are trusted-writer-only
// (equipmentTransitionAllowed in firestore.rules permits only the plain ACTIVE<->
// INACTIVE pair on an ordinary client edit) — that authority lives in Rules and the
// trusted writer, and nothing about it belongs in this file.
//
// NOT DECLARED: THE INVENTORY-CONTROL LIFECYCLE. Separately from `status`, an
// installed asset also has a CONTROLLED / EXITED / NOT_STARTED / UNKNOWN inventory-
// control read — but that is COMPUTED client-side by
// domain/equipmentInventoryControlAdapter.js from `serializedAssetId` plus a sale-
// close signal this surface does not have (D-5 sale-close criteria is unratified),
// and is not a field stored on the document at all. Declaring it as a FieldDefinition
// would claim a stored value that does not exist. v1 of this contract has no way to
// express a derived, cross-record read as metadata; that is a real gap, stated here
// rather than papered over with a fake field.
//
// RELATIONSHIPS: accountId -> account is declared below as a REFERENCE. locationId
// stays a plain STRING, the same restraint salesOrder.js applies to its own
// locationId — no `location` entity is registered anywhere in this program yet, so
// REFERENCE would point at nothing a runtime could resolve. Rules enforce the
// integrity a relationship would otherwise describe (equipmentLocationBelongsToAccount:
// the referenced Location must exist AND its accountId must equal this Equipment's
// accountId) — that check lives in Rules, not in this file.
//
// THE OWNING SIDE OF account.equipment IS NOT DECLARED HERE. Every other outbound
// edge in this program is declared on the entity that owns it (account.contacts,
// account.opportunities, account.salesOrders all live on account.js, per the rule
// findParentRelationship enforces — a related list's parent relationship must reach
// the listed entity from the OWNING side). This lane's writeScope does not include
// account.js, so an eventual account.equipment relationship (and an Account-scoped
// RELATED equipment section built on it) is left to the integration lane — see the
// REGISTRATION_PENDING note carried in this program's handoff, not edited here.
//
// READ PATH: CLIENT_DIRECT via onSnapshot, gated in Rules by ROLE (admin/dispatcher),
// never by a capability id — the same shape contact.js already describes, for the
// same reason: inventing a `equipment.read` capability nothing checks would be a
// false statement about the system, not a stricter one. readCapability is therefore
// null. OPERATIONAL ROLES ARE NEVER CONSULTED for this collection — firestore.rules
// says so explicitly (no isActiveOperationalRole() call anywhere in this block) —
// which is why nothing here declares one either.
//
// NO firestore.indexes.json ENTRIES EXIST FOR `equipment` TODAY. The index list
// declared below is therefore a net-new demand this definition creates, not a
// description of something already deployed — see REGISTRATION_PENDING.

export const equipmentEntity = makeEntityDefinition({
  id: "equipment",
  label: "Equipment",
  labelPlural: "Equipment",
  collection: EQUIPMENT_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null
  // rather than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description: "An installed, customer-serviceable asset at one Account Location, moving through a governed ACTIVE/INACTIVE/RETIRED lifecycle. Not the equipment_models compatibility catalog — see the file header.",
  fields: [
    makeFieldDefinition({
      id: "name",
      entityId: "equipment",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "The human reference for this asset (firestore.rules' own comment names it so). Not enforced unique — duplicate names within an Account are real-world and allowed.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "equipment",
      label: "Status",
      type: "ENUM",
      enumValues: [...EQUIPMENT_STATUS_VALUES],
      enumLabels: EQUIPMENT_STATUS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "ACTIVE / INACTIVE / RETIRED. An ordinary client edit may only move ACTIVE<->INACTIVE; reaching or leaving RETIRED is trusted-writer-only (firestore.rules equipmentTransitionAllowed).",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "equipment",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "The owning Account. Immutable after create (not in equipmentEditableKeys) — reassignment is not an ordinary edit.",
    }),
    // No `location` entity is registered yet, so this stays a plain reference id
    // rather than a REFERENCE this registry cannot resolve — see the file header.
    makeFieldDefinition({
      id: "locationId",
      entityId: "equipment",
      label: "Location",
      type: "STRING",
      description: "The installed Location id, within the same Account. No location entity is registered in this program yet. Immutable on this path — a Location change is the audited MOVE action, not an ordinary edit.",
    }),
    makeFieldDefinition({
      id: "manufacturer",
      entityId: "equipment",
      label: "Manufacturer",
      type: "STRING",
      description: "Optional, string | null (Spec §1).",
    }),
    makeFieldDefinition({
      id: "model",
      entityId: "equipment",
      label: "Model",
      type: "STRING",
      description: "Optional, string | null (Spec §1).",
    }),
    makeFieldDefinition({
      id: "serialNumber",
      entityId: "equipment",
      label: "Serial Number",
      type: "STRING",
      description: "Optional, string | null, and NOT enforced unique — looks like a business reference but is not one. See the identity note in the file header.",
    }),
    makeFieldDefinition({
      id: "assetTag",
      entityId: "equipment",
      label: "Asset Tag",
      type: "STRING",
      description: "Optional, string | null, and NOT enforced unique — see the identity note in the file header.",
    }),
    makeFieldDefinition({
      id: "installedDate",
      entityId: "equipment",
      label: "Installed",
      type: "DATE",
      description: "Optional, string | null — a plain YYYY-MM-DD calendar date (HTML date input), not a Firestore Timestamp.",
    }),
    makeFieldDefinition({
      id: "warrantyExpiresDate",
      entityId: "equipment",
      label: "Warranty Expires",
      type: "DATE",
      description: "Optional, string | null — a plain YYYY-MM-DD calendar date, not a Firestore Timestamp.",
    }),
    makeFieldDefinition({
      id: "notes",
      entityId: "equipment",
      label: "Notes",
      type: "TEXT",
      description: "Optional, string | null (Spec §1).",
    }),
    // NUMBER, not TIMESTAMP — see X-EQUIPMENT-PROVENANCE-GAP in the file header.
    // No createdBy/updatedBy: neither is stored anywhere on this collection.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "equipment",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (firestore.rules asserts `is number`), never a Firestore Timestamp. No createdBy is stored — see X-EQUIPMENT-PROVENANCE-GAP.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "equipment",
      label: "Updated",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds, never a Firestore Timestamp. No updatedBy is stored — see X-EQUIPMENT-PROVENANCE-GAP.",
    }),
  ],
  // No outbound relationships declared. account.equipment, if and when it exists,
  // points FROM Account and belongs on account.js — see the file header.
});

/**
 * The general Equipment index — a cross-Account, filterable register.
 *
 * Mirrors what modules/equipment/CustomerEquipment.jsx already renders (a cross-
 * customer list scoped optionally by Account and Location), but declares accountId
 * and status as REAL, backend-served filters rather than the LOADED-ONLY, client-
 * side filters that surface currently applies over its documentId()-ordered page —
 * see hooks/useInstalledEquipmentPage.js. That is INTENDED behavior this definition
 * states plainly, not a description of the live query today: no
 * firestore.indexes.json entries exist for `equipment` yet, so every index this list
 * demands is net-new. See REGISTRATION_PENDING in this program's handoff.
 */
export const equipmentIndexList = makeListViewDefinition({
  id: "equipment.index",
  entityId: "equipment",
  label: "Equipment",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "accountId" }),
    makeColumn({ fieldId: "locationId" }),
    makeColumn({ fieldId: "manufacturer" }),
    makeColumn({ fieldId: "model" }),
  ],
  filters: [
    makeFilter({ fieldId: "accountId", operators: ["EQUALS"] }),
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
  ],
  // Alphabetical by name — the human reference, and the register is scanned for a
  // name the way contact.index is, not read top-down like an operational queue.
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
  rowNavigationTo: "/equipment/:equipmentId",
});
