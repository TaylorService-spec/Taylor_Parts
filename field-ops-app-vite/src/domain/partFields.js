// PARTS / PART MASTER — the second post-pilot migration, and the highest-volume list in EOS.
//
// ============================ WHAT THE TRACE FOUND ============================
//
// STORED on the canonical Part (functions/src/partMaster/types.ts):
//   partId · internalPartNumber · name · description? · category? · status · stockingUnit ·
//   controlType · stockingClass · flags{expiryTracked, consumable, returnableCore} ·
//   manufacturerId? · manufacturerPartNumber? · oemStatus? · wholeUnit? · equipmentModelId?
//
// ABSENT ENTIRELY — no cost, no price, no reorder point, no business line. Those are not fields the
// Part is missing values for; they are fields the Part does not have. Four of the columns this
// migration was asked to consider therefore cannot exist, and are recorded as gaps rather than
// invented.
//
// PROJECTED to the client (domain/partMasterView.js) is a SMALLER set: it drops manufacturerId,
// manufacturerPartNumber, wholeUnit, equipmentModelId, flags and oemStatus. So several fields are
// stored-but-unavailable, which is a different fact from unsupported and is marked as such.
//
// ============================ THE TWO TRACKING VOCABULARIES ============================
//
// Part Master says `controlType` (STANDARD | SERIALIZED | LOT | SERIALIZED_LOT).
// The ledger says `trackingMode`.
//
// They are NOT the same vocabulary, and `partMaster/controlTypeTrackingMode.ts` is the ONE mapping
// between them — a file that exists because the mapping had already been copied twice and a third
// copy was about to be written. This list exposes the PART's own value and never the ledger's:
// normalising one into the other for display convenience is how two surfaces end up disagreeing about
// whether a part is counted by quantity or by serial.
import {
  FIELD_CATEGORY as C, FIELD_TYPE as T, OPERATOR, UNSUPPORTED_REASON as WHY,
  defineObjectFields,
} from "./fieldMetadata.js";

export const PART_OBJECT = "Part";

/** Part Master's own lifecycle. A real sequence, so status may be ordered. */
export const PART_STATUS_ORDER = Object.freeze(["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"]);

export const PART_STATUS_LABEL = Object.freeze({
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  SUPERSEDED: "Superseded",
  DISCONTINUED: "Discontinued",
});

/** Part Master's tracking vocabulary — NOT the ledger's `trackingMode`. See the header. */
export const CONTROL_TYPE_LABEL = Object.freeze({
  STANDARD: "Quantity",
  SERIALIZED: "Serialized",
  LOT: "Lot",
  SERIALIZED_LOT: "Serialized + Lot",
});

/**
 * Stocking class. A CLASSIFICATION, not a sequence — STOCKED and KIT are different kinds of thing,
 * not different stages of one, so it is filterable and groupable but never sorted.
 */
export const STOCKING_CLASS_LABEL = Object.freeze({
  STOCKED: "Stocked",
  NON_STOCK: "Non-stock",
  SERVICE: "Service",
  KIT: "Kit",
});

/** `wholeUnit` in the words the business uses. NOT a new stored enum — a display of a boolean. */
export const ITEM_TYPE_LABEL = Object.freeze({ true: "Whole Unit", false: "Part" });

/**
 * The gaps. Recorded rather than filled, and each one names what it refused.
 */
export const PART_FIELD_GAPS = Object.freeze([
  Object.freeze({
    gap: "PART CATALOGUE WHOLE-COLLECTION READ",
    severity: "SCALE DEFECT — partly corrected, partly still present",
    finding: "`fetchPartMasterList` reads the WHOLE `parts` collection with no limit, cursor or "
      + "criteria, and SEVEN surfaces depend on getting all of it — name resolution, scanner lookup, "
      + "two part pickers, the warehouse manager catalogue, the Parts catalog list and Part detail.",
    corrected: "The structured Part list no longer participates. `fetchPartMasterPage` is ordered, "
      + "limited and cursored at Firestore, and applies the filters the metadata declares "
      + "server-executable as query constraints rather than as a pass over everything that came back.",
    consequence: "The remaining seven reads are what Parts costs at scale. On a real catalogue they "
      + "are slow; none of them is WRONG, which is exactly why they were left alone.",
    refused: "Making the shared reader bounded so the list inherited paging for free. That was the "
      + "first attempt, and it silently truncated all seven: a scanner that cannot find part 51 "
      + "reports the part does not exist, and a name resolver missing a page renders a raw id. Those "
      + "are wrong ANSWERS dressed as a performance win, and nothing on screen would have said so.",
    resolution: "A targeted read per consumer — lookup by part number, a searched picker, a "
      + "single-document detail read — not a page size imposed on questions that need the catalogue. "
      + "Tracked in services/partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ so the count can "
      + "only go down deliberately.",
  }),
  Object.freeze({
    gap: "PART LIST BALANCE N+1 GAP",
    finding: "`getPartBalance` is a SINGLE-PART callable. There is no batch or list-scoped balance read.",
    consequence: "A 'Warehouse Available' or 'On Order' COLUMN would issue one callable per row — N "
      + "callables per page, on the largest list in the platform.",
    resolution: "A list-scoped balance projection, or an explicitly bounded batch read. Until one "
      + "exists these figures stay on the Part DETAIL and on scanner lookup, where they are one part "
      + "at a time and genuinely cheap.",
    refused: "Rendering the columns anyway and hiding the cost behind a spinner.",
  }),
  Object.freeze({
    gap: "PART INVENTORY VALUATION AUTHORITY GAP",
    finding: "The canonical Part carries NO cost and NO price of any kind — not unit, standard, "
      + "average or latest cost, and no sell or list price.",
    consequence: "There is no inventory value to display, and no basis on which one could be computed.",
    refused: "Multiplying a quantity by whichever cost happened to exist elsewhere (a supplier item's "
      + "unitPrice, say) and calling the result inventory value. That would invent a valuation policy "
      + "in a list component.",
    resolution: "Financial Architecture. A valuation basis is a policy decision, not a column.",
  }),
  Object.freeze({
    gap: "PART BUSINESS LINE NOT AUTHORITATIVE",
    finding: "The Part carries no operating company or business line.",
    refused: "Inferring Taylor vs Ventana from the manufacturer or from description text. The domain "
      + "defines no such relationship, and a guess rendered as a filterable column becomes a fact "
      + "somebody reports on.",
  }),
  Object.freeze({
    gap: "PART DESCRIPTION SEARCH INDEX GAP",
    finding: "Firestore has no substring search. A description search that is actually useful needs a "
      + "search index or a dedicated projection, neither of which exists.",
    resolution: "Identifier-first search now (part number and alias, both exact-resolvable); a search "
      + "projection later.",
    refused: "Fetching every Part and running `.includes()` over descriptions in the browser.",
  }),
  Object.freeze({
    gap: "PART REORDER POINT IS DERIVED, NOT STORED",
    finding: "`reorderPoint` is CALCULATED by inventoryAnalyticsService.calculateReorderPoint(usage, "
      + "leadTimeDays, 1.5). It is not a field on the Part.",
    consequence: "It may be displayed where the analytics read has already run, but it cannot be "
      + "filtered or sorted server-side — there is nothing stored to order by.",
  }),
  Object.freeze({
    gap: "PART SUPPLIER IS MANY-TO-MANY",
    finding: "`PartSupplierItem{partId, supplierId, …, preferred}` is a separate collection. There is "
      + "no `preferredSupplierId` field ON the Part.",
    refused: "Inventing a single Vendor column on the Part. The preferred supplier is a row in another "
      + "collection, and collapsing a many-to-many into one column would hide every other supplier.",
  }),
]);

/**
 * Fields the Part STORES but the client projection does not carry.
 *
 * Stored-but-unprojected is a different fact from unsupported: the value exists and the fix is a
 * projection change, not a domain decision. Recorded so the distinction survives.
 */
export const PART_STORED_NOT_PROJECTED = Object.freeze([
  "manufacturerId", "manufacturerPartNumber", "wholeUnit", "equipmentModelId", "flags", "oemStatus",
]);

export const PART_FIELDS = defineObjectFields(PART_OBJECT, [
  // ── IDENTITY ───────────────────────────────────────────────────────────────────────────────────
  {
    id: "internalPartNumber", category: C.OWNED, type: T.IDENTIFIER, label: "Part Number",
    source: "parts.internalPartNumber — the governed business identity, never the document id",
    defaultVisible: true, filterable: true, sortable: true, searchable: true,
    unresolvedText: "Part number unavailable",
    description: "Primary business identity. A Part whose number cannot be read is malformed and is "
      + "surfaced as such rather than falling back to its document id.",
  },
  {
    id: "name", category: C.OWNED, type: T.STRING, label: "Description",
    source: "parts.name", defaultVisible: true, sortable: true,
    // Filtering by description needs substring search, which Firestore does not have.
    filterable: false, unsupportedFilterReason: WHY.NEEDS_INDEX,
    searchable: true,
  },
  {
    id: "description", category: C.OWNED, type: T.STRING, label: "Detail",
    source: "parts.description (optional, distinct from `name`)",
    filterable: false, unsupportedFilterReason: WHY.NEEDS_INDEX,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },

  // ── CLASSIFICATION ─────────────────────────────────────────────────────────────────────────────
  {
    id: "status", category: C.OWNED, type: T.ENUM, label: "Status",
    source: "parts.status", defaultVisible: true,
    filterable: true, sortable: true, groupable: true,
    statusOrder: PART_STATUS_ORDER,
  },
  {
    id: "controlType", category: C.OWNED, type: T.ENUM, label: "Tracking",
    source: "parts.controlType — PART MASTER's vocabulary, not the ledger's trackingMode",
    defaultVisible: true, filterable: true, groupable: true,
    // A classification of how units are identified, not a progression through states.
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "stockingClass", category: C.OWNED, type: T.ENUM, label: "Stocking Class",
    source: "parts.stockingClass", defaultVisible: true,
    filterable: true, groupable: true,
    // STOCKED and KIT are different kinds of thing, not different stages of one.
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "stockingUnit", category: C.OWNED, type: T.ENUM, label: "Unit",
    source: "parts.stockingUnit", filterable: true, groupable: true,
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },
  {
    id: "category", category: C.OWNED, type: T.STRING, label: "Category",
    source: "parts.category (optional, free-form)", filterable: true, groupable: true,
    operators: [OPERATOR.IS, OPERATOR.STARTS_WITH],
    sortable: false, unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
  },

  // ── WHOLE UNIT AND ITS MODEL ───────────────────────────────────────────────────────────────────
  {
    id: "wholeUnit", category: C.OWNED, type: T.BOOLEAN, label: "Item Type",
    source: "parts.wholeUnit — STORED but not carried by the client projection",
    // Displayed as "Whole Unit" / "Part": a rendering of the boolean, NOT a new stored enum.
    // Unqueryable today because the projection drops it, which is a projection fix rather than a
    // domain decision -- see PART_STORED_NOT_PROJECTED.
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
    description: "Whole-unit Parts are the machine identities serialized assets are created against.",
  },
  {
    id: "equipmentModel.name", category: C.RELATED, relatedObject: "Equipment Model", type: T.OBJECT_REF,
    label: "Equipment Model", source: "equipment_models/{equipmentModelId} — id stored, name elsewhere",
    unresolvedText: "Equipment model unavailable",
    // The model NAME lives on another document, and resolving it per row would be a join across the
    // whole model registry. Displayed where a bounded resolver has already run; never queried here.
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "manufacturer.name", category: C.RELATED, relatedObject: "Manufacturer", type: T.OBJECT_REF,
    label: "Manufacturer", source: "manufacturers/{manufacturerId}.name — id stored, name elsewhere",
    unresolvedText: "Manufacturer unavailable",
    // The SAME rule as the Work Order's customer name: filter by a human picker over an id query is
    // possible once the id is projected; SORTING by a name this document does not hold is not.
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "manufacturerPartNumber", category: C.OWNED, type: T.IDENTIFIER, label: "Manufacturer Part Number",
    source: "parts.manufacturerPartNumber — STORED but not carried by the client projection",
    searchable: true,
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },

  // ── INVENTORY, EACH SCOPE NAMED ────────────────────────────────────────────────────────────────
  //
  // NOT "Stock". `onHand` is warehouse-only by design and excludes truck stock, so a single ambiguous
  // heading would be the FALSE_COMFORT failure again: a picker reading "Stock: 8" would not know
  // whether the vans are in that number.
  {
    id: "warehouseAvailable", category: C.DERIVED, type: T.QUANTITY, label: "Warehouse Available",
    source: "getPartBalance → available (onHand − reserved, ACTIVE warehouses only, EXCLUDES truck stock)",
    align: "right",
    // NOT a default list column -- see PART LIST BALANCE N+1 GAP. One callable per part.
    defaultVisible: false,
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
  {
    id: "onOrder", category: C.DERIVED, type: T.QUANTITY, label: "On Order",
    source: "getPartBalance → onOrder (outstanding on POs that can still be received)",
    align: "right", defaultVisible: false,
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
    description: "Canonical outstanding inbound. This list consumes the projection and re-implements "
      + "none of its SENT-counts / APPROVED-does-not rules.",
  },
  {
    id: "reorderPoint", category: C.DERIVED, type: T.QUANTITY, label: "Reorder Point",
    source: "inventoryAnalyticsService.calculateReorderPoint — computed from usage, NOT stored",
    align: "right", defaultVisible: false,
    filterable: false, unsupportedFilterReason: WHY.DERIVED_AT_READ,
    sortable: false, unsupportedSortReason: WHY.DERIVED_AT_READ,
  },
  {
    id: "mobileQuantity", category: C.DERIVED, type: T.QUANTITY, label: "Truck Stock",
    source: "NONE — the balance projection has no mobile figure",
    displayable: false, reportable: false, exportable: false, align: "right",
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
    description: "Blocked: onHand is warehouse-only by design and no mobile figure is projected. "
      + "Showing warehouse stock under a company-wide label is the FALSE_COMFORT failure.",
  },
  {
    id: "companyOwned", category: C.DERIVED, type: T.QUANTITY, label: "Company Owned",
    source: "NONE — warehouse availability is not company-owned inventory",
    displayable: false, reportable: false, exportable: false, align: "right",
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
  },

  // ── BLOCKED: MONEY AND BUSINESS LINE ──────────────────────────────────────────────────────────
  {
    id: "unitCost", category: C.FINANCIAL, type: T.CURRENCY, label: "Unit Cost",
    source: "NONE — the canonical Part carries no cost of any kind",
    displayable: false, reportable: false, exportable: false, align: "right",
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
    description: "Blocked: PART INVENTORY VALUATION AUTHORITY GAP.",
  },
  {
    id: "sellPrice", category: C.FINANCIAL, type: T.CURRENCY, label: "Sell Price",
    source: "NONE — no sell or list price exists on the Part",
    displayable: false, reportable: false, exportable: false, align: "right",
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
  },
  {
    id: "businessLine", category: C.OWNED, type: T.ENUM, label: "Business Line",
    source: "NONE — see PART_FIELD_GAPS",
    displayable: false, reportable: false, exportable: false,
    filterable: false, unsupportedFilterReason: WHY.NO_AUTHORITY,
    sortable: false, unsupportedSortReason: WHY.NO_AUTHORITY,
  },
  {
    id: "preferredSupplier.name", category: C.RELATED, relatedObject: "Supplier", type: T.OBJECT_REF,
    label: "Preferred Supplier", source: "NONE on the Part — PartSupplierItem is many-to-many",
    displayable: false, reportable: false, exportable: false,
    unresolvedText: "Supplier unavailable",
    filterable: false, unsupportedFilterReason: WHY.NOT_PROJECTED,
    sortable: false, unsupportedSortReason: WHY.NOT_PROJECTED,
  },
]);

/**
 * The default order — PRESERVED, not chosen.
 *
 * `toPartListView` already sorts by internalPartNumber then partId, and that is the ordering people
 * currently work with. Replacing it with a generic newest-first because sorting now exists would
 * change an established operational reading for no reason.
 *
 * The tie-break on partId matters: without it, two parts sharing a number would swap places between
 * reads, and a list that reorders itself is a list nobody trusts.
 */
export const PART_DEFAULT_SORT = Object.freeze({
  fieldId: "internalPartNumber",
  direction: "asc",
  tieBreak: "partId",
  why: "The existing operational order. A user-selected sort overrides it explicitly.",
});
