import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { UNSUPPORTED_REASON as WHY } from "../unsupportedReason.js";
import { ABSENCE } from "../absence.js";
import { makeGap, GAP_SEVERITY } from "../gapRegister.js";
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
      defaultVisible: true,
      label: "Part Number",
      type: "STRING",
      sortable: true,
      description: "The catalog number staff use. Required on every Part; the referenceField half of identity.",
    }),
    makeFieldDefinition({
      id: "name",
      entityId: "part",
      defaultVisible: true,
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
      // Firestore has no substring search, so a description filter that is actually useful needs an
      // index or a projection. Neither exists -- see PART_DESCRIPTION_SEARCH_INDEX_GAP.
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
      absence: ABSENCE.NOT_RECORDED,
      description: "Optional.",
    }),
    makeFieldDefinition({
      id: "category",
      entityId: "part",
      label: "Category",
      type: "STRING",
      // Free text with no canonical vocabulary: filtering it would need an index this list has not
      // declared, and ordering it would order strings somebody typed rather than a real sequence.
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
      absence: ABSENCE.NOT_RECORDED,
      description: "Optional, free text. No canonical vocabulary exists on the domain type.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "part",
      defaultVisible: true,
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
      defaultVisible: true,
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
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      // A unit of measure is a classification, not a progression. Ordering EACH before FOOT would be
      // alphabetical coincidence presented as meaning.
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
    }),
    makeFieldDefinition({
      id: "controlType",
      entityId: "part",
      defaultVisible: true,
      label: "Control Type",
      type: "ENUM",
      enumValues: [...CONTROL_TYPES],
      enumLabels: CONTROL_TYPE_LABEL,
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      // SERIALIZED and LOT are different KINDS of tracking, not stages of one.
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
      description:
        "PART MASTER's own tracking vocabulary — STANDARD / SERIALIZED / LOT / SERIALIZED_LOT. NOT the " +
        "inventory ledger's `trackingMode`: partMaster/controlTypeTrackingMode.ts is the one mapping between " +
        "them, and it exists because the mapping had already been copied twice. A surface showing one under the " +
        "other's name is how two screens come to disagree about whether a part is counted by quantity or by serial.",
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
      label: "Manufacturer Part Number",
      type: "STRING",
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
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
      label: "Item Type",
      type: "BOOLEAN",
      // Reads as "Whole Unit" / "Part" — a rendering of the boolean, never a new stored enum. Not
      // carried by the client projection (domain/partMasterView.js), which is a projection fix
      // rather than a domain decision, and NOT_PROJECTED says exactly that.
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
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
      // The model's NAME lives on another document. Resolving it per row is what the batched
      // reference resolver is for; ORDERING by a name this document does not hold is not possible
      // at all, and neither is filtering until the id is projected.
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
      absence: ABSENCE.UNRESOLVED,
      description:
        "Legal ONLY when wholeUnit is true (enforced by validatePart at the command layer, not by Rules or this " +
        "metadata). The stored value is the equipment_models document id, verified canonical and checked to " +
        "exist by assertEquipmentModelExists on every write — see the file header.",
    }),
    // ── INVENTORY, EACH SCOPE NAMED ─────────────────────────────────────────────────────────
    //
    // NOT "Stock". `onHand` is warehouse-only by design and EXCLUDES truck stock, so a single
    // ambiguous heading would be the FALSE_COMFORT failure: a picker reading "Stock: 8" cannot tell
    // whether the vans are in that number.
    //
    // Declared, and deliberately NOT default columns. `getPartBalance` is a SINGLE-PART callable, so
    // a balance COLUMN would issue one callable per row on the largest list in the platform —
    // PART_LIST_BALANCE_N1_GAP. These belong on Part detail and scanner lookup, where they are one
    // part at a time and genuinely cheap.
    makeFieldDefinition({
      id: "warehouseAvailable",
      entityId: "part",
      label: "Warehouse Available",
      type: "NUMBER",
      defaultVisible: false,
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
      // UNKNOWN IS NOT ZERO. "0 available" sends somebody to an empty shelf certain; "not known"
      // sends them to look. A falsy check turns the second into the first.
      absence: ABSENCE.UNKNOWN,
      description:
        "getPartBalance → available (onHand − reserved, ACTIVE warehouses only, EXCLUDES truck stock). " +
        "Not stored on the Part; resolved per part where a balance read has already run.",
    }),
    makeFieldDefinition({
      id: "onOrder",
      entityId: "part",
      label: "On Order",
      type: "NUMBER",
      defaultVisible: false,
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
      absence: ABSENCE.UNKNOWN,
      description:
        "getPartBalance → onOrder, the canonical outstanding inbound. This metadata consumes that " +
        "projection and re-implements none of its SENT-counts / APPROVED-does-not rules.",
    }),
    makeFieldDefinition({
      id: "reorderPoint",
      entityId: "part",
      label: "Reorder Point",
      type: "NUMBER",
      defaultVisible: false,
      // Computed by inventoryAnalyticsService.calculateReorderPoint(usage, leadTimeDays, 1.5). There
      // is nothing stored to order by, which is a different fact from "not projected".
      unsupportedFilterReason: WHY.DERIVED_AT_READ,
      unsupportedSortReason: WHY.DERIVED_AT_READ,
      absence: ABSENCE.UNKNOWN,
      description: "Calculated from usage, NOT stored on the Part.",
    }),

    // ── BLOCKED. Declared so the refusal and its reason are recorded, never displayed ────────
    //
    // `displayable: false` AND non-reportable AND non-exportable. Blocking a column and leaving the
    // CSV open is the same field reaching the same person by a longer route.
    makeFieldDefinition({
      id: "unitCost",
      entityId: "part",
      label: "Unit Cost",
      type: "CURRENCY_MINOR",
      displayable: false,
      reportable: false,
      exportable: false,
      unsupportedFilterReason: WHY.NO_AUTHORITY,
      unsupportedSortReason: WHY.NO_AUTHORITY,
      description: "BLOCKED — the canonical Part carries no cost of any kind. See PART_INVENTORY_VALUATION_AUTHORITY_GAP.",
    }),
    makeFieldDefinition({
      id: "sellPrice",
      entityId: "part",
      label: "Sell Price",
      type: "CURRENCY_MINOR",
      displayable: false,
      reportable: false,
      exportable: false,
      unsupportedFilterReason: WHY.NO_AUTHORITY,
      unsupportedSortReason: WHY.NO_AUTHORITY,
      description: "BLOCKED — no sell or list price exists on the Part.",
    }),
    makeFieldDefinition({
      id: "businessLine",
      entityId: "part",
      label: "Business Line",
      type: "STRING",
      displayable: false,
      reportable: false,
      exportable: false,
      unsupportedFilterReason: WHY.NO_AUTHORITY,
      unsupportedSortReason: WHY.NO_AUTHORITY,
      description: "BLOCKED — the Part carries no operating company. See PART_BUSINESS_LINE_NOT_AUTHORITATIVE.",
    }),
    makeFieldDefinition({
      id: "mobileQuantity",
      entityId: "part",
      label: "Truck Stock",
      type: "NUMBER",
      displayable: false,
      reportable: false,
      exportable: false,
      unsupportedFilterReason: WHY.NO_AUTHORITY,
      unsupportedSortReason: WHY.NO_AUTHORITY,
      description:
        "BLOCKED — onHand is warehouse-only by design and no mobile figure is projected. Showing warehouse " +
        "stock under a company-wide label is the FALSE_COMFORT failure.",
    }),
    makeFieldDefinition({
      id: "preferredSupplierId",
      entityId: "part",
      label: "Preferred Supplier",
      // STRING, not REFERENCE — the same restraint primaryManufacturerId applies: this program has not
      // registered supplier alongside part, and declaring a REFERENCE this registry cannot resolve
      // would claim a lookup capability that does not exist. It is blocked anyway; see the gap.
      type: "STRING",
      displayable: false,
      reportable: false,
      exportable: false,
      unsupportedFilterReason: WHY.NOT_PROJECTED,
      unsupportedSortReason: WHY.NOT_PROJECTED,
      description:
        "BLOCKED — there is no preferredSupplierId ON the Part. PartSupplierItem{partId, supplierId, preferred} " +
        "is a separate collection, and collapsing a many-to-many into one column would hide every other supplier.",
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
  // KNOWN LIMITATIONS, AS DATA — see metadata/gapRegister.js. Carried forward from the Parts
  // structured-list migration (#1444), where each was traced rather than assumed.
  gaps: [
    makeGap({
      id: "PART_CATALOGUE_WHOLE_COLLECTION_READ",
      title: "Seven surfaces still read the whole parts collection",
      entityId: "part",
      severity: GAP_SEVERITY.SCALE,
      finding:
        "fetchPartMasterList reads all of `parts` with no limit, cursor or criteria, and seven surfaces " +
        "depend on getting all of it — name resolution, scanner lookup, two part pickers, the warehouse " +
        "manager catalogue, the Parts catalog list and Part detail.",
      consequence: "On a real catalogue these are slow. None of them is WRONG, which is why they were left alone.",
      refused:
        "Making the shared reader bounded so the list inherited paging for free. That was tried, and it " +
        "silently truncated all seven: a scanner that cannot find part 51 reports the part does not exist.",
      resolution:
        "A targeted read per consumer — lookup by part number, a searched picker, a single-document detail " +
        "read. Tracked in services/partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ.",
    }),
    makeGap({
      id: "PART_LIST_BALANCE_N1_GAP",
      title: "Balance figures require one callable per part",
      entityId: "part",
      fieldId: "warehouseAvailable",
      severity: GAP_SEVERITY.SCALE,
      reason: WHY.NOT_PROJECTED,
      finding: "getPartBalance is a SINGLE-PART callable. There is no batch or list-scoped balance read.",
      consequence: "A Warehouse Available or On Order column would issue N callables per page.",
      refused: "Rendering the columns anyway and hiding the cost behind a spinner.",
      resolution: "A list-scoped balance projection, or an explicitly bounded batch read.",
    }),
    makeGap({
      id: "PART_INVENTORY_VALUATION_AUTHORITY_GAP",
      title: "The Part carries no cost or price, so there is no inventory value",
      entityId: "part",
      fieldId: "unitCost",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NO_AUTHORITY,
      finding:
        "The canonical Part carries no cost of any kind — not unit, standard, average or latest — and no sell " +
        "or list price.",
      consequence: "There is no inventory value to display and no basis on which one could be computed.",
      refused:
        "Multiplying a quantity by whichever cost happened to exist elsewhere (a supplier item's unitPrice) " +
        "and calling the result inventory value. That would invent a valuation policy in a list.",
      resolution: "Financial Architecture. A valuation basis is a policy decision, not a column.",
    }),
    makeGap({
      id: "PART_BUSINESS_LINE_NOT_AUTHORITATIVE",
      title: "A Part has no operating company or business line",
      entityId: "part",
      fieldId: "businessLine",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NO_AUTHORITY,
      finding: "The Part carries no operating company and no line-of-business field.",
      refused:
        "Inferring Taylor vs Ventana from the manufacturer or from description text. The domain defines no " +
        "such relationship, and a guess rendered as a filterable column becomes a fact somebody reports on.",
    }),
    makeGap({
      id: "PART_DESCRIPTION_SEARCH_INDEX_GAP",
      title: "Description cannot be searched by substring",
      entityId: "part",
      fieldId: "description",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NEEDS_INDEX,
      finding: "Firestore has no substring search, and no search index or projection exists for Part text.",
      refused: "Fetching every Part and running .includes() over descriptions in the browser.",
      resolution: "Identifier-first search now (part number, manufacturer part number); a search projection later.",
    }),
    makeGap({
      id: "PART_REORDER_POINT_IS_DERIVED",
      title: "Reorder point is calculated, not stored",
      entityId: "part",
      fieldId: "reorderPoint",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.DERIVED_AT_READ,
      finding: "inventoryAnalyticsService.calculateReorderPoint(usage, leadTimeDays, 1.5) computes it at read.",
      consequence: "It can be displayed where the analytics read has run, but never filtered or sorted server-side.",
      resolution: "A stored or projected reorder point, if a cross-Part query for it is ever really needed.",
    }),
    makeGap({
      id: "PART_SUPPLIER_IS_MANY_TO_MANY",
      title: "There is no single preferred supplier on a Part",
      entityId: "part",
      fieldId: "preferredSupplierId",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NOT_PROJECTED,
      finding: "PartSupplierItem{partId, supplierId, …, preferred} is a separate collection.",
      refused: "Inventing a single Vendor column on the Part, which would hide every other supplier.",
    }),
    makeGap({
      id: "PART_LIST_FILTER_INDEX_GAP",
      title: "Only status and stocking class are index-backed filters",
      entityId: "part",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NEEDS_INDEX,
      finding:
        "The Part list offers filters on status and stockingClass. The retired pilot list also offered part " +
        "number, tracking, unit and category — none of which had a declared composite index, so each would " +
        "have failed at read time with an index-required error while CI stayed green.",
      consequence: "Narrowing by tracking type or unit is not available on the list today.",
      refused: "Keeping the four unverified filters. An offered filter that errors is worse than an absent one.",
      resolution:
        "Declare the composite indexes each additional filter combination needs — noting that optional filters " +
        "multiply: two already demand three composites, and each further one grows that set.",
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
