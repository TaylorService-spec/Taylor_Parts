import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import {
  PART_STATUSES, PART_STATUS_LABEL,
  CONTROL_TYPES, CONTROL_TYPE_LABEL,
  STOCKING_CLASSES, STOCKING_CLASS_LABEL,
  OEM_STATUSES, OEM_STATUS_LABEL,
  UNIT_CODES, UNIT_CODE_LABEL,
} from "../../domain/partVocabulary.js";

// Part — the catalog record INV-1's Part Master owns (functions/src/partMaster). The
// first definition whose document id and business identity are the SAME thing, and the
// first whose provenance invariant actually holds end to end.
//
// THE DOCUMENT ID IS THE IDENTITY, ENFORCED AT READ. `parts/{partId}` — partFromFirestore
// (functions/src/partMaster/partMasterRepository.ts) throws MalformedStoredRecordError if
// `data.partId !== docId`. Declaring partId as its own field (type ID, below) records that
// fact rather than treating it as implicit; it is not a fallback the way a bare document id
// elsewhere in this program has been (the defect #1124 corrected on Sales Orders).
//
// TWO IDENTITY FIELDS, BOTH GENUINE. Every other entity in this program has exactly one:
// Account/Contact have only a name, Work Order/Opportunity/Sales Order have only a
// reference. Part is the first where BOTH are non-optional on the domain type
// (functions/src/partMaster/types.ts Part.name, Part.internalPartNumber are required, not
// `?`) — so both are declared rather than one being invented to satisfy the contract.
// internalPartNumber is the referenceField (the catalog number staff actually use); name
// is the nameField.
//
// THE STORAGE NAME DIVERGES FROM THE DOMAIN NAME, AND IT IS DESCRIBED, NOT RENAMED.
// functions/src/partMaster/types.ts calls the field `manufacturerId` /
// `manufacturerPartNumber`; partToFirestore/partFromFirestore read and write
// `primaryManufacturerId` / `primaryManufacturerPartNumber` on the document. This is
// exactly the gap systemName/storagePath exists for on a later FieldDefinition version —
// v1 has no storagePath, so this definition names the STORED field (what a query actually
// reads) and records the divergence in a comment rather than inventing a v1 field neither
// name here would fully describe.
//
// DELIBERATELY ABSENT, PER THE DOMAIN TYPE'S OWN HEADER (types.ts): onHand, reserved,
// available (ledger authority), supplierCost, purchasePrice, leadTime,
// reorderRecommendation (part_supplier_items / analytics authority), alias arrays,
// supplier arrays. ADR-008 draws this boundary deliberately — Part carries DESCRIPTIVE
// identity only — and a definition that declared any of them would assert an authority
// this collection does not hold.
//
// `flags` IS AN EMBEDDED OBJECT, NOT A FLAT COLUMN. {expiryTracked, consumable,
// returnableCore} has no FIELD_TYPE in the v1 vocabulary that fits a struct — the same gap
// salesOrder.js's `lines` leaves undeclared rather than approximated.
//
// NO CAPABILITY GATES THIS COLLECTION — the same finding contact.js made. firestore.rules
// admits admin/dispatcher OR the active operational roles PARTS_MANAGER / WAREHOUSE_MANAGER
// by ROLE, not by a capability id; there is no `part.read` in the catalog (the write-side
// capabilities on partMasterCommands.ts — catalog.manage, catalog.activate — gate creates,
// updates and status changes, never the read). Declaring one here would be inventing an
// authority nothing enforces, exactly what contact.js's identical note already explains.
//
// primaryManufacturerId STAYS A PLAIN STRING, NOT A REFERENCE FIELD. It is, in principle,
// an edge out of Part to a manufacturer, and the contract says an edge belongs on its
// OWNING (FROM) entity, which here is Part itself. But no `manufacturer` EntityDefinition
// is registered anywhere this field's own writeScope covers — a REFERENCE naming one
// would point at an entity this upgrade did not verify — the same restraint salesOrder.js
// applies to `locationId` for the identical reason. This edge stays described in prose
// instead of asserted as a contract nothing here has validated.
//
// equipmentModelId IS NOW A REAL REFERENCE — "equipmentModel" IS A REGISTERED ENTITY
// (definitions/equipmentModel.js, D4 Part-Equipment Compatibility). Previously a plain
// string because no equipmentModel EntityDefinition existed; that gap is closed. The
// stored value genuinely IS the equipment_models document id, not a model number or an
// alias: validation.ts's isCanonicalEquipmentModelId gate rejects anything that is not the
// canonical `{manufacturerId}--{modelNumber}` form, and assertEquipmentModelExists
// (partMasterCommands.ts) checks the value against a live
// `db.collection(EQUIPMENT_MODELS_COLLECTION).doc(id)` read on every create and update —
// the same document-id identity equipmentModel.js's own equipmentModelId field declares.
// See that field's own comment below for the legality gate (wholeUnit) this upgrade does
// not change.
//
// STATUS/CONTROL TYPE/STOCKING CLASS/OEM STATUS/STOCKING UNIT VOCABULARY COMES FROM
// domain/partVocabulary.js, never a second copy here — see that module's header for why
// oemStatus needed a fresh label map while the other four only needed one added.
//
// PROVENANCE IS DECLARED, UNLIKE CONTACT. Contact's three write paths disagree about
// createdAt/createdBy/updatedAt/updatedBy, so contact.js leaves all four undeclared. Part
// has exactly one write path (partMasterCommands.ts, through the repository above), and
// every stored record carries version/createdAt/createdBy/updatedAt/updatedBy
// (readMeta throws MalformedStoredRecordError if any is missing or malformed) — the
// invariant this program has been recording as absent everywhere else actually holds
// here, so it is declared rather than described as a gap.

export const partEntity = makeEntityDefinition({
  id: "part",
  label: "Part",
  labelPlural: "Parts",
  collection: "parts",
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher, or the PARTS_MANAGER/WAREHOUSE_MANAGER
  // operational roles), not by a capability. Recorded as null rather than invented — see
  // the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name", referenceField: "internalPartNumber" }),
  description: "A catalog record: descriptive identity only. Stock, cost and supplier data live in other authorities.",
  fields: [
    // The document id itself, declared rather than left implicit — see the header. Not
    // an identity field (identity is name/internalPartNumber, what a human reads), and
    // not filterable or sortable: there is nothing to query it BY that the document id
    // does not already serve.
    makeFieldDefinition({
      id: "partId",
      entityId: "part",
      label: "Part ID",
      type: "ID",
      description: "The Firestore document id. partFromFirestore throws if the stored partId does not match it.",
    }),
    makeFieldDefinition({
      id: "internalPartNumber",
      entityId: "part",
      label: "Part Number",
      type: "STRING",
      sortable: true,
      description: "The catalog number staff use. Required on every Part; the referenceField half of identity.",
    }),
    makeFieldDefinition({
      id: "name",
      entityId: "part",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "Required on every Part; the nameField half of identity.",
    }),
    makeFieldDefinition({
      id: "description",
      entityId: "part",
      label: "Description",
      type: "TEXT",
      description: "Optional.",
    }),
    makeFieldDefinition({
      id: "category",
      entityId: "part",
      label: "Category",
      type: "STRING",
      description: "Optional, free text. No canonical vocabulary exists on the domain type.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "part",
      label: "Status",
      type: "ENUM",
      enumValues: [...PART_STATUSES],
      enumLabels: PART_STATUS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
    }),
    makeFieldDefinition({
      id: "stockingClass",
      entityId: "part",
      label: "Stocking Class",
      type: "ENUM",
      enumValues: [...STOCKING_CLASSES],
      enumLabels: STOCKING_CLASS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "STOCKED / NON_STOCK / SERVICE / KIT — what kind of catalog line this is, not how many are on hand.",
    }),
    // Rendered, not filtered. Eleven values is a lot of index cost for a field a Parts
    // Manager reads off the row rather than narrows by — the same restraint workOrder.js
    // applies to priority, for the same reason: two declared filters already produce
    // three composite indexes, and a third would multiply that further.
    makeFieldDefinition({
      id: "stockingUnit",
      entityId: "part",
      label: "Unit",
      type: "ENUM",
      enumValues: [...UNIT_CODES],
      enumLabels: UNIT_CODE_LABEL,
    }),
    makeFieldDefinition({
      id: "controlType",
      entityId: "part",
      label: "Control Type",
      type: "ENUM",
      enumValues: [...CONTROL_TYPES],
      enumLabels: CONTROL_TYPE_LABEL,
      description: "STANDARD / SERIALIZED / LOT / SERIALIZED_LOT — how units of this Part are tracked, decided elsewhere.",
    }),
    // No manufacturer EntityDefinition is registered — see the header. Stays a plain
    // string id, not a REFERENCE, and the field id names what is actually STORED
    // (primaryManufacturerId), not the domain type's manufacturerId.
    makeFieldDefinition({
      id: "primaryManufacturerId",
      entityId: "part",
      label: "Manufacturer",
      type: "STRING",
      description:
        "Stored as primaryManufacturerId; the domain type (functions/src/partMaster/types.ts) calls the same " +
        "field manufacturerId. No manufacturer entity is registered in this program yet, so this stays a plain " +
        "id rather than a REFERENCE this registry cannot resolve.",
    }),
    makeFieldDefinition({
      id: "primaryManufacturerPartNumber",
      entityId: "part",
      label: "Manufacturer Part #",
      type: "STRING",
      description: "Stored as primaryManufacturerPartNumber; the domain type calls it manufacturerPartNumber. Optional.",
    }),
    makeFieldDefinition({
      id: "oemStatus",
      entityId: "part",
      label: "OEM Status",
      type: "ENUM",
      enumValues: [...OEM_STATUSES],
      enumLabels: OEM_STATUS_LABEL,
      description: "Optional.",
    }),
    // Sparse by construction: partToFirestore writes this key ONLY when true, never
    // `false`. A BOOLEAN FieldDefinition does not distinguish stored-false from
    // absent-and-defaulted-false, which is why the guardrail note stays in prose here
    // rather than as a claim the type system enforces.
    makeFieldDefinition({
      id: "wholeUnit",
      entityId: "part",
      label: "Whole Unit",
      type: "BOOLEAN",
      description: "Written to the document ONLY when true; absent otherwise, never stored as false.",
    }),
    // Upgraded to a REFERENCE — equipmentModel is now a registered entity. See the file
    // header. The legality gate (equipmentModelId only when wholeUnit is true) is enforced
    // at the command layer, not by Firestore and not by this metadata.
    makeFieldDefinition({
      id: "equipmentModelId",
      entityId: "part",
      label: "Equipment Model",
      type: "REFERENCE",
      referenceTo: "equipmentModel",
      description:
        "Legal ONLY when wholeUnit is true (enforced by validatePart at the command layer, not by Rules or this " +
        "metadata). The stored value is the equipment_models document id, verified canonical and checked to " +
        "exist by assertEquipmentModelExists on every write — see the file header.",
    }),
    makeFieldDefinition({
      id: "version",
      entityId: "part",
      label: "Version",
      type: "NUMBER",
      description: "Repository-owned optimistic-concurrency counter, starting at 1. Never caller-supplied.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "part",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
    }),
    makeFieldDefinition({
      id: "createdBy",
      entityId: "part",
      label: "Created By",
      type: "STRING",
      description: "Actor uid. Repository-owned; every stored Part carries one (readMeta rejects a record missing it).",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "part",
      label: "Updated",
      type: "TIMESTAMP",
      sortable: true,
    }),
    makeFieldDefinition({
      id: "updatedBy",
      entityId: "part",
      label: "Updated By",
      type: "STRING",
      description: "Actor uid. Repository-owned; every stored Part carries one.",
    }),
  ],
  // No relationships[] entries. The equipmentModel edge is already expressed as the
  // equipmentModelId REFERENCE field above — a relationships[] entry would duplicate that
  // same edge, not add a new one. The manufacturer edge stays undeclared — see the header.
});

/**
 * The Part catalog index. No standalone route renders this yet — a definition is not a
 * surface — but it is defined now so a future route has a real target rather than a
 * dangling id, the same restraint contact.index applies.
 *
 * status and stockingClass are the two declared filters, mirroring workOrder.index's
 * restraint: two optional equality filters demand three composites (neither / either /
 * both), and a third optional filter would push that considerably higher — see
 * MAX_DECLARED_FILTERS and requiredIndexes() in listViewDefinition.js. No index for
 * `parts` exists in firestore.indexes.json today, so ALL THREE are new demands.
 */
export const partIndexList = makeListViewDefinition({
  id: "part.index",
  entityId: "part",
  label: "Parts",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "internalPartNumber", sortable: true }),
    makeColumn({ fieldId: "name" }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "stockingClass" }),
    makeColumn({ fieldId: "stockingUnit" }),
    makeColumn({ fieldId: "controlType" }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "stockingClass", operators: ["EQUALS", "IN"] }),
  ],
  // Catalog order, not activity order: a Parts Manager scans for a part number, not for
  // what changed most recently.
  defaultSort: [makeSort({ fieldId: "internalPartNumber", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active parts",
      filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "internalPartNumber", direction: "ASC" })],
    }),
  ],
  rowNavigationTo: "/parts/:id",
});
