import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { LOCATIONS_COLLECTION } from "../../domain/constants.js";

// Location — S-CRM-LOCATION-DEFINITION.
//
// WHY THIS ENTITY EXISTS. Two definitions already in this program were forced to declare
// their `locationId` as a plain STRING rather than a REFERENCE, because no location
// entity was registered anywhere — see the file headers of equipment.js and
// salesOrder.js, both of which say so explicitly and both of which point back here. This
// file is what those references have been unable to point at. It does not edit either of
// those files (out of this lane's writeScope); the integration lane can upgrade
// equipment.locationId / salesOrder.locationId to REFERENCE now that this exists.
//
// STORED SHAPE (domain/locations.js's own header comment, Sprint 2.0.2 Customer
// Foundation, docs/BusinessEntityModel.md): { id, accountId, name, address, accessNotes?,
// createdAt, updatedAt }. A first-class collection related to Account by `accountId`, not
// an array embedded on the Account document. Write paths: domain/locations.js
// createLocation()/updateLocation(), reached only from
// modules/accounts/LocationCreateModal.jsx via AccountDetail.jsx — there is no standalone
// Locations route, the same situation contact.js describes for Contact.
//
// IDENTITY: nameField "name" only. LocationCreateModal's own "Site name" field is
// required client-side (nameError blocks submit on an empty trim), so unlike Equipment's
// serialNumber/assetTag this is a genuine, always-present human reference — but there is
// no separate site code, reference number, or any other business identifier anywhere in
// the stored shape, the create modal, or firestore.rules for this collection. Nothing is
// promoted to a referenceField that the data does not actually carry (DECISIONS #106):
// only nameField is declared.
//
// ADDRESS FIELDS ARE DESCRIBED INDIVIDUALLY, NOT AS A STRUCT. The stored `address` is a
// map of four scalar strings (street, city, state, zip) — see
// shared/address/AddressFields.jsx, the SAME shared component Account's billing address
// uses. FIELD_TYPE v1 (entityDefinition.js) has no composite/struct type, the identical
// gap part.js's `flags` and salesOrder.js's `lines` leave undeclared rather than
// approximate. Field Architecture v2 §9 (docs/specifications/field-architecture-v2.md)
// lists "addresses" among the standard field families still to be investigated — that is
// the seam a future ADDRESS type would close, noted here rather than invented early by
// declaring a STRUCT type this contract does not have.
//
// FIELD IDS ARE PLAIN, NOT DOTTED PATHS. v1 has no `storagePath` concept for a field id
// that diverges from where it lives (part.js's header names this exact gap for
// primaryManufacturerId/primaryManufacturerPartNumber) — a dotted id like "address.street"
// would silently invent one. Each address field is declared with a flat id
// (addressStreet, addressCity, ...) and its description states the real stored location
// (`address.street` on the document) in prose instead.
//
// ACCESS NOTES: `accessNotes` is optional (LocationCreateModal stores `null` when blank —
// `accessNotes.trim() || null`), so it is declared but not required.
//
// THE ACCOUNT RELATIONSHIP, AND WHY IT CANNOT BE COMPLETED HERE. firestore.rules'
// equipmentLocationBelongsToAccount() (the `equipment` match block) proves a Location
// belongs to exactly one Account: it get()s /locations/{locationId} and asserts
// data.accountId equals the referencing Equipment's own accountId. That is real,
// enforced-by-Rules ownership, not a convention. `accountId` is therefore declared below
// as a genuine REFERENCE field, the same way contact.js declares its own accountId REFERENCE
// to account — that much is within this file's writeScope, exactly like contact.js needed
// no edit to account.js to declare its own accountId field.
//
// What this file CANNOT do is declare the OUTBOUND edge (account.locations) on the OWNING
// side. Every other outbound edge in this program lives on the entity that owns it —
// account.contacts and account.opportunities are both declared on account.js, per the
// rule findParentRelationship enforces (a RELATED list's parent relationship must reach
// the target entity from the OWNING side, checked against the PARENT's own declarations).
// account.js NOW declares that edge (`account.locations`, viaField accountId,
// cardinality ONE_TO_MANY) — see account.js's own relationships block — which is what
// unblocks `locationRelatedList` below. The INDEX list above still exists and is still
// correct on its own terms (a general, filterable, cross-Account register); the RELATED
// list is additive, not a replacement.
//
// `locations/{locationId}` ADMITS BY ROLE, NOT CAPABILITY, AND VALIDATES NOTHING ELSE.
// firestore.rules: `allow read: if isAdminOrDispatcher(); allow create, update: if
// isAdminOrDispatcher(); allow delete: if false.` No field-shape guard exists at all for
// this collection (contrast with equipment's equipmentOptionalFieldsValid /
// equipmentCreateShapeValid) — every field below describes what the client-side write
// paths actually send, not something Rules independently enforces. readCapability is
// therefore null, the same finding contact.js and part.js record for the same reason:
// inventing a `location.read` capability nothing checks would be a false statement about
// the system, not a stricter one.
//
// PROVENANCE: createdAt and updatedAt are BOTH `Date.now()` epoch milliseconds
// (domain/locations.js — makeCollectionStore's add() stamps `createdAt: Date.now()`;
// updateLocation() stamps `updatedAt: Date.now()`), never a Firestore Timestamp — declared
// as NUMBER, not TIMESTAMP, the same restraint equipment.js applies for the same reason
// (X-EQUIPMENT-PROVENANCE-GAP). Note createdAt is NEVER refreshed on update — only
// updatedAt is. There is no createdBy or updatedBy anywhere in this collection's write
// path; both are left undeclared entirely rather than asserting data that does not exist.
export const locationEntity = makeEntityDefinition({
  id: "location",
  label: "Location",
  labelPlural: "Locations",
  collection: LOCATIONS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null
  // rather than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description: "A physical site belonging to one Account — a customer's office, plant, or delivery address. Reached only through the Account record today; no standalone route exists.",
  fields: [
    makeFieldDefinition({
      id: "name",
      entityId: "location",
      label: "Site Name",
      type: "STRING",
      sortable: true,
      description: "The human reference for this site. Required at create (LocationCreateModal blocks an empty/whitespace-only submit). Not enforced unique — an Account can have two sites with the same name.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "location",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "The owning Account. Enforced by firestore.rules elsewhere (equipmentLocationBelongsToAccount reads this field on the referenced Location to confirm it matches the referencing Equipment's own accountId) — not by any rule on this collection's own match block, which validates nothing. Set once at create (domain/locations.js createLocation) and never changed by any write path found.",
    }),
    // Individually-described scalars, not a struct — see the file header (v1 has no
    // composite FIELD_TYPE; Field Architecture v2 §9 is the seam that would eventually
    // replace these four with one ADDRESS field).
    makeFieldDefinition({
      id: "addressStreet",
      entityId: "location",
      label: "Street Address",
      type: "STRING",
      description: "Stored at `address.street` on the document (shared/address/AddressFields.jsx), one of four scalar strings under the `address` map. See the file header for why this is a flat id and why it is four fields, not one struct.",
    }),
    makeFieldDefinition({
      id: "addressCity",
      entityId: "location",
      label: "City",
      type: "STRING",
      description: "Stored at `address.city` on the document — see the file header.",
    }),
    makeFieldDefinition({
      id: "addressState",
      entityId: "location",
      label: "State",
      type: "STRING",
      description: "Stored at `address.state` on the document — see the file header.",
    }),
    makeFieldDefinition({
      id: "addressZip",
      entityId: "location",
      label: "ZIP",
      type: "STRING",
      description: "Stored at `address.zip` on the document — see the file header.",
    }),
    makeFieldDefinition({
      id: "accessNotes",
      entityId: "location",
      label: "Access Notes",
      type: "TEXT",
      description: "Optional. LocationCreateModal stores null when the field is left blank (`accessNotes.trim() || null`), never an empty string.",
    }),
    // NUMBER, not TIMESTAMP — see the file header. No createdBy/updatedBy: neither is
    // stored anywhere on this collection.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "location",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (Date.now(), domain/locations.js makeCollectionStore add()), never a Firestore Timestamp. Never refreshed after create. No createdBy is stored.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "location",
      label: "Updated",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (Date.now(), domain/locations.js updateLocation()), never a Firestore Timestamp. No updatedBy is stored.",
    }),
  ],
  // No outbound relationships declared here. account.locations, if and when it exists,
  // points FROM Account and belongs on account.js, per the same rule equipment.js and
  // contact.js already follow — see the file header and REGISTRATION_PENDING.
});

/**
 * The general Location index — a cross-Account, filterable register.
 *
 * INDEX, not RELATED, and that is a constraint, not a preference: a RELATED section
 * requires parentRelationshipId to resolve against a relationship declared on the OWNING
 * entity (findParentRelationship, listViewDefinition.js), and account.js — out of this
 * lane's writeScope — declares no account.locations edge yet. Declaring a RELATED list
 * here would not validate, so this definition states only what this lane can actually
 * deliver: a filterable index scoped by accountId, mirroring the query
 * hooks/useLocationsForAccount.js already runs ("a single-field equality query needs no
 * composite index" — that hook's own comment). See REGISTRATION_PENDING for the
 * account.js edit that would unlock account.locations and an Account-scoped RELATED
 * section built on it.
 */
export const locationIndexList = makeListViewDefinition({
  id: "location.index",
  entityId: "location",
  label: "Locations",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "accountId" }),
    makeColumn({ fieldId: "addressCity" }),
    makeColumn({ fieldId: "addressState" }),
    makeColumn({ fieldId: "accessNotes" }),
  ],
  // accountId only. Every real read of this collection today is account-scoped
  // (useLocationsForAccount.js, useLocation.js); nothing else about a Location is
  // indexed or has a vocabulary to filter by, so no other filter is declared —
  // the Work Order lesson that three optional filters demand seven composites.
  filters: [makeFilter({ fieldId: "accountId", operators: ["EQUALS"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  // Alphabetical by name — the human reference, and a Locations list is scanned for a
  // site the way contact.index is, not read top-down like an operational queue.
  pageSize: 50,
  savedViews: [makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true })],
});

/**
 * The Account record's Locations section.
 *
 * RELATED, not INDEX — now that account.js declares the owning-side edge
 * (`account.locations`, viaField accountId, cardinality ONE_TO_MANY), this list can
 * validate the way contactRelatedList does: parentRelationshipId names that edge, and
 * findParentRelationship (listViewDefinition.js) resolves it against the OWNING entity's
 * (Account's) own relationship declarations, not this file's.
 *
 * NO parent-scope FILTER is declared, same as contactRelatedList — the runtime applies
 * the parent scope from the relationship's viaField, and declaring accountId as a filter
 * here as well would double-state the same scoping two different ways.
 *
 * NO capabilityRequirement on the section this list backs, and none is declared here
 * either: locationEntity.readCapability is null (Rules gate `locations/{locationId}` by
 * ROLE — isAdminOrDispatcher() — with no capability check at all, per this file's own
 * header). account.contacts is the precedent this follows exactly — contact.js declares
 * no capability on contactRelatedList for the identical reason.
 */
export const locationRelatedList = makeListViewDefinition({
  emptyGuidance:
    "A location is a physical site where service happens for this customer. Raising a work order needs one, so add the customer’s first location here before scheduling work for them.",
  id: "account.locations",
  entityId: "location",
  label: "Locations",
  surface: "RELATED",
  parentRelationshipId: "account.locations",
  viewAllListId: "location.index",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "addressCity" }),
    makeColumn({ fieldId: "addressState" }),
    makeColumn({ fieldId: "accessNotes" }),
  ],
  // No declared filters — the parent scope comes from the relationship, not a filter
  // clause. Same as contactRelatedList.
  filters: [],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  // Alphabetical, matching location.index — a Locations section is scanned for a site
  // name, not read top-down like a queue.
  pageSize: 25,
});
