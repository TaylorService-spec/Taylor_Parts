// Parts North Star P1 — the record's derivation layer.
//
// PURE: no Firebase, no network, no React, no clock, no input mutation. It composes governed facts
// that other modules already own and derives no business fact of its own. Every value it returns is
// either a stored value turned into a word by partVocabulary, or a sentence stating why something is
// not there.
//
// ============================ WHAT THIS MODULE MAY NOT DO ============================
//
// ND-25 (Owner, 2026-08-30): TRUTHFUL ABSENCE > FALSE COMFORT.
//
//   * It computes no quantity. Not on hand, not available, not on order, not a total across
//     locations, not a count of stocking locations.
//   * It never presents `warehouseQty` as stock. That value is the static compatibility baseline
//     from src/data/partsCatalog.ts, whose own header reads "METADATA ONLY -- NO STOCK AUTHORITY".
//     It is not carried into the header, and there is deliberately no helper here that formats it.
//   * It does not relabel a client-derived figure as On hand or Available. The ledger-derived stock
//     forecast that the reorder workflow runs on stays where it is, under its own heading, saying
//     what it is derived from -- it is NOT promoted into this record's identity layer.
//
// Quantitative inventory facts reach a Parts surface only through the governed getPartBalance
// authority, once that capability is intentionally activated. Until then this module's answer to
// "how many" is a sentence, not a number.
//
// ND-26 (Owner, 2026-08-30): internalPartNumber is the human-facing Part Number; partId is the
// immutable document and routing key. The record's title is the first. The second never renders as
// a label, and is never substituted when the first is absent.
//
// ND-27 (Owner, 2026-08-30): unitCost stays refused for display, report and export. So does
// sellPrice, blocked by the same clause of the metadata register for the same reason. Neither has a
// formatter here.
import {
  PART_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  STOCKING_CLASS_LABEL,
  UNIT_CODE_LABEL,
  OEM_STATUS_LABEL,
} from "./partVocabulary.js";
import { resolveTrackingModeFromControlType } from "./inventoryLedgerEvent.js";
import { INVENTORY_BALANCE_UNAVAILABLE_REASON } from "../config/inventoryBalanceReadiness.js";

/** A stored value's word, or null when the value is absent or outside its vocabulary. Never the
 * stored token itself: a raw enum reaching a reader is the defect this indirection prevents. */
function word(map, value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : null;
}

/**
 * The kicker above the title: `Part · {control} · {stocking}`.
 *
 * Words only, and absent segments are dropped rather than filled. A part whose controlType did not
 * survive validation says "Part" and nothing more — which is true — instead of "Part · undefined".
 */
export function partRecordKicker(part) {
  const segments = ["Part", word(CONTROL_TYPE_LABEL, part?.controlType), word(STOCKING_CLASS_LABEL, part?.stockingClass)];
  return segments.filter(Boolean).join(" · ");
}

/**
 * Title and subtitle.
 *
 * ND-26: the title is internalPartNumber. When the row carries none — an approved
 * STATIC_ONLY_EXCLUDED sku has no canonical document at all — the title says so rather than falling
 * back to the document key. `titleIsAbsent` lets the composition render that as a state instead of
 * as a name.
 *
 * The subtitle is the description. Where a part has none, the name serves, and `subtitleSource`
 * records which one it is so a test can tell the two apart.
 */
export function partRecordIdentity(part) {
  const number = typeof part?.internalPartNumber === "string" && part.internalPartNumber.length > 0 ? part.internalPartNumber : null;
  const description = typeof part?.description === "string" && part.description.length > 0 ? part.description : null;
  const name = typeof part?.name === "string" && part.name.length > 0 ? part.name : null;
  return {
    title: number ?? "No Part Number recorded",
    titleIsAbsent: number === null,
    subtitle: description ?? name,
    subtitleSource: description !== null ? "description" : name !== null ? "name" : null,
  };
}

/** The facts the HEADER states. The rail may not repeat any of these — see partRecordRailSubset. */
export const PART_RECORD_HEADER_FACT_KEYS = Object.freeze(["status", "manufacturer", "category", "unit", "oem"]);

/**
 * The header's fact line, in order.
 *
 * `manufacturerName` is resolved by the caller through the governed manufacturer catalogue read; a
 * null name with a present id degrades to the id, which is honest, rather than to a fabricated name.
 *
 * There is deliberately NO quantity fact here (ND-25). A reader who wants to know how many we have
 * is answered by the Where-it-is section's sentence, not by a number in the header.
 */
export function partRecordFacts(part, manufacturerName = null) {
  const facts = [];
  const status = word(PART_STATUS_LABEL, part?.status);
  if (status) facts.push({ key: "status", label: "Status", value: status, isStatus: true });

  if (part?.manufacturerId) {
    facts.push({ key: "manufacturer", label: "Manufacturer", value: manufacturerName ?? part.manufacturerId, resolved: manufacturerName !== null });
  }
  if (part?.category) facts.push({ key: "category", label: "Category", value: part.category });

  const unit = word(UNIT_CODE_LABEL, part?.unit);
  if (unit) facts.push({ key: "unit", label: "Unit", value: unit });

  const oem = word(OEM_STATUS_LABEL, part?.oemStatus);
  if (oem) facts.push({ key: "oem", label: "OEM", value: oem });

  return facts;
}

/**
 * The rail's Classification block, with the header's facts removed.
 *
 * A record that states its status in the header and again in a rail table has said one thing twice
 * and taught the reader to skim both. The subset is computed, not hand-maintained, so a fact added
 * to the header cannot reappear below it.
 */
/**
 * THE PART INFORMATION BAND — the structured master-data summary, Frame 1b's own five rows.
 *
 * WHY THIS EXISTS BESIDE partRecordRailSubset(), which deliberately does the opposite.
 *
 * The rail subset withholds every fact the header already states, on the rule that a record should
 * not say the same thing twice. That rule was right for a RAIL — a narrow column of leftovers beside
 * the main content. It is wrong for this band, and the deployed page proved it: with the header
 * stating status, category, unit and OEM, the subset returned nothing at all and "Part information"
 * rendered as a two-column band with an empty left half.
 *
 * The Owner ruled the repetition intentional (2026-08-31): "identity gives fast recognition; Part
 * Information gives the structured master-data summary". They are two different readings of the same
 * part, and the frame draws both.
 *
 * FIVE ROWS, EXACTLY AS DESIGN ASSIGNS THEM — Status, Control, Stocking, Unit, Manufacturer. Not
 * Category and not OEM: those stay in the identity line, where the frame puts them and nowhere else.
 *
 * ABSENCE IS STATED, NEVER SKIPPED. A row whose value is missing keeps its label and says so, because
 * a master-data summary that silently omits a field tells the reader the field does not exist rather
 * than that it is unrecorded. That is the same distinction this family draws everywhere else.
 *
 * @param {object} part canonical part view
 * @param {string|null} manufacturerName resolved NAME, never an id — a raw id is not a fact a reader
 *   can use, and substituting one is the failure ND-26 named on the workspace.
 */
export function partInformationRows(part, manufacturerName = null) {
  const absent = "Not recorded";
  const manufacturer = part?.manufacturerId ? manufacturerName : null;
  return [
    { key: "status", label: "Status", value: word(PART_STATUS_LABEL, part?.status), absence: absent },
    { key: "control", label: "Control", value: word(CONTROL_TYPE_LABEL, part?.controlType), absence: absent },
    { key: "stocking", label: "Stocking", value: word(STOCKING_CLASS_LABEL, part?.stockingClass), absence: absent },
    { key: "unit", label: "Unit", value: word(UNIT_CODE_LABEL, part?.unit), absence: absent },
    // An UNRESOLVED manufacturer id is an absence here, not a value. Rendering the id would put a
    // key in front of a reader in the one band whose job is to be readable.
    { key: "manufacturer", label: "Manufacturer", value: manufacturer, absence: absent },
  ];
}

export function partRecordRailSubset(part) {
  const rows = [
    { key: "status", label: "Status", value: word(PART_STATUS_LABEL, part?.status) },
    { key: "control", label: "Control", value: word(CONTROL_TYPE_LABEL, part?.controlType) },
    { key: "stocking", label: "Stocking", value: word(STOCKING_CLASS_LABEL, part?.stockingClass) },
    { key: "unit", label: "Unit", value: word(UNIT_CODE_LABEL, part?.unit) },
    { key: "oem", label: "OEM", value: word(OEM_STATUS_LABEL, part?.oemStatus) },
    { key: "manufacturerPartNumber", label: "Manufacturer part number", value: part?.manufacturerPartNumber ?? null },
  ];
  // control and stocking are in the KICKER rather than the fact line, so they belong to the header
  // too and are dropped here for the same reason.
  const stated = new Set([...PART_RECORD_HEADER_FACT_KEYS, "control", "stocking"]);
  return rows.filter((r) => r.value !== null && !stated.has(r.key));
}

// ============================ THE THREE INACTIVE CAPABILITIES ============================
//
// Balances, serialized-asset detail and location display are each built, each governed, and each
// registered active:false and granted to no role. A section whose read is switched off renders its
// heading and this sentence — never nothing, which reads as "this part has none", and never a
// placeholder, which reads as a fact.

export const PART_SECTION_STATE = Object.freeze({
  READY: "READY",
  CAPABILITY_INACTIVE: "CAPABILITY_INACTIVE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  BLOCKED_UNSUPPORTED: "BLOCKED_UNSUPPORTED",
});

/**
 * Where it is.
 *
 * The location table cannot populate: inventory.location.display.read is inactive, and
 * truckInventoryView carries a STRICT NON-COMPUTATION boundary that means it never supplies a
 * quantity even when it is connected. So the section states what a location IS — and, separately,
 * what it is not — rather than drawing an empty table that implies rows are coming.
 */
export function partLocationSection() {
  return {
    state: PART_SECTION_STATE.CAPABILITY_INACTIVE,
    heading: "Where it is",
    // Location describes where units sit. It is not custody, and it is not availability. Both
    // confusions are cheap to make and expensive to act on.
    note: "Location describes where units sit — it never implies custody or availability.",
    reason: INVENTORY_BALANCE_UNAVAILABLE_REASON,
    // THE VISIBLE SENTENCE, at Frame 1b's length (Owner ruling B §6). It carries the whole contract:
    // locations CANNOT BE LISTED — which is a different statement from "there are none" — the read
    // is BUILT AND GOVERNED, and it is SWITCHED OFF IN THIS ENVIRONMENT. None of that is softened.
    // What left the visible line is the restatement of WHICH two reads are involved, which is
    // implementation detail rather than contract, and which a reader can now ask for.
    detail:
      "Locations can’t be listed yet: the per-location read is built and governed, switched off in " +
      "this environment.",
    // ...and the long form, verbatim, for the disclosure. Kept as its own field rather than deleted:
    // the balance-versus-location distinction is real, and it stays stated somewhere reachable.
    detailLong:
      "Per-location quantities come from the governed balance and location reads. Both are built and " +
      "governed, and neither is switched on in this environment, so this part's locations cannot be " +
      "listed here yet.",
  };
}

/**
 * Serialized or lot units.
 *
 * Gated on the Part's own tracking mode, resolved through the governed boundary translator rather
 * than by reading controlType directly — so SERIALIZED_LOT fails closed as the domain requires,
 * instead of being collapsed into SERIAL and quietly minting a serialized treatment.
 *
 * An untracked part gets NOT_APPLICABLE: no section, no empty table. It has no unit identity, and
 * an empty "Serialized units" heading on a bulk part is a question the part cannot be asked.
 */
export function partUnitSection(part) {
  const { mode, reason } = resolveTrackingModeFromControlType(part?.controlType);
  if (reason === "dual_tracking_unsupported") {
    return {
      state: PART_SECTION_STATE.BLOCKED_UNSUPPORTED,
      heading: "Tracked units",
      detail:
        "This part is recorded as both serialized and lot tracked. That combination is not supported, " +
        "so no unit detail is shown rather than a partial one.",
    };
  }
  if (mode === "SERIAL") {
    return {
      state: PART_SECTION_STATE.CAPABILITY_INACTIVE,
      heading: "Serialized units",
      note: "This part is serial-tracked — each unit is its own governed asset, never loose quantity.",
      detail:
        "Serialized-asset detail comes from the governed registry read, which is built and not " +
        "switched on in this environment.",
    };
  }
  if (mode === "LOT") {
    return {
      state: PART_SECTION_STATE.CAPABILITY_INACTIVE,
      heading: "Lots",
      note: "This part is lot-tracked — units are grouped by lot, never individually identified.",
      detail:
        "Lot detail comes from the governed registry read, which is built and not switched on in this " +
        "environment.",
    };
  }
  return { state: PART_SECTION_STATE.NOT_APPLICABLE, heading: null };
}

/**
 * The rail's Purchasing context.
 *
 * ND-27: no cost row, and no price row — the metadata register blocks both from display, report and
 * export together, so that the field cannot reach the same person by a longer route. On-order is a
 * governed fact behind an inactive capability, which is a different sentence from a missing one.
 */
export function partPurchasingSection() {
  return {
    heading: "Purchasing context",
    rows: [
      {
        key: "onOrder",
        label: "On order",
        value: null,
        absence: "Not available in this environment",
      },
    ],
    detail:
      "Outstanding inbound quantity is a governed fact from the balance read, which is not switched " +
      "on here. Unit cost and sell price are refused on this record: the Part carries no cost or " +
      "price authority, and the refusal covers display, reporting and export alike.",
  };
}

// ============================ FRAME 1a — THE PARTS COLLECTION ============================
//
// ND-30 (Owner, 2026-08-30): Frame 1a is composed INSIDE /inventory, as the Parts Catalog panel of
// the existing role home. The Work and Flow groups and the governed reorder queues stay exactly
// where they are — the collection grammar arrives in the panel, it does not replace the page.
//
// Everything below is presentation over facts the workspace ALREADY holds:
//   rows       buildPartsCatalogRows over the governed canonical read (widened by #1593)
//   attention  partsAttentionItems over the reorder_requests the page already subscribes to
//
// NO QUANTITY. ND-25 remains controlling and there is deliberately no On hand column, no total,
// and no helper here that could produce one.
// NO INVENTED SEMANTICS. No risk score, no prioritisation, no status authority, no new state.
// A view chip is a filter over facts already loaded — never a state machine.

/**
 * partId -> the one attention fact to show on its row.
 *
 * The projection can yield several items for a part; the row shows the one that most demands
 * action, because a cell has space for one and picking arbitrarily would misreport the rest.
 * ACTION_ITEM outranks NOTIFICATION, and within a rank the projection's own order is preserved.
 * Its words are the projection's `sectionLabel` — this module invents no vocabulary of its own.
 */
export function partsAttentionByPartId(items) {
  const byPart = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.partId !== "string") continue;
    const actionRequired = item.attentionType === "ACTION_ITEM";
    const existing = byPart.get(item.partId);
    if (existing && (existing.actionRequired || !actionRequired)) continue;
    byPart.set(item.partId, {
      label: typeof item.sectionLabel === "string" ? item.sectionLabel : null,
      actionRequired,
      deepLink: typeof item.deepLink === "string" ? item.deepLink : null,
    });
  }
  return byPart;
}

/**
 * The counts under the title.
 *
 * LABELLED FOR WHAT THEY ACTUALLY COUNT. `total` is the composed catalogue this page has loaded —
 * a whole-collection read, so it is the catalogue, and the label says "in the catalogue" rather
 * than implying a company-wide inventory universe nobody measured.
 *
 * `active` counts rows whose status is KNOWN to be ACTIVE. A row carrying no status (an approved
 * static-only sku has no canonical document) is counted neither active nor inactive, because
 * neither is known. That is why this is not `total - inactive`.
 */
export function partsCollectionSummary(rows, attentionByPartId) {
  const list = Array.isArray(rows) ? rows : [];
  const attention = attentionByPartId instanceof Map ? attentionByPartId : new Map();
  return {
    total: list.length,
    totalLabel: list.length === 1 ? "part in the catalogue" : "parts in the catalogue",
    active: list.filter((r) => r && r.status === "ACTIVE").length,
    statusUnknown: list.filter((r) => !r || typeof r.status !== "string").length,
    needsAttention: list.filter((r) => r && attention.has(r.sku)).length,
  };
}

/**
 * The view chips.
 *
 * A chip appears only where its membership is decidable from the loaded rows. `Serialized` reads
 * the governed controlType; `Needs attention` reads the governed reorder-request projection;
 * `Active` reads the governed status. Each is a filter over what is already on the page — nothing
 * here queries, and nothing here defines a state.
 *
 * Counts ride on the chips because a chip without one asks the reader to click to find out whether
 * it was worth clicking.
 */
export const PARTS_COLLECTION_VIEW = Object.freeze({
  ALL: "ALL",
  ACTIVE: "ACTIVE",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
  SERIALIZED: "SERIALIZED",
});

export function partsCollectionViews(rows, attentionByPartId) {
  const list = Array.isArray(rows) ? rows : [];
  const attention = attentionByPartId instanceof Map ? attentionByPartId : new Map();
  return [
    { key: PARTS_COLLECTION_VIEW.ALL, label: "All", count: list.length },
    // QUALIFIED, not bare. ADR-012 s2.2a: "Active" names four different concepts in this codebase,
    // and this page shows reorder-request statuses beside the catalogue -- so a lone "Active" chip
    // sits within reading distance of a second sense. Frame 1a draws the chip as "Active"; the
    // vocabulary ruling is the stronger authority and the word costs nothing to disambiguate.
    { key: PARTS_COLLECTION_VIEW.ACTIVE, label: "Active parts", count: list.filter((r) => r && r.status === "ACTIVE").length },
    {
      key: PARTS_COLLECTION_VIEW.NEEDS_ATTENTION,
      label: "Needs attention",
      count: list.filter((r) => r && attention.has(r.sku)).length,
      isAttention: true,
    },
    { key: PARTS_COLLECTION_VIEW.SERIALIZED, label: "Serialized", count: list.filter((r) => r && r.controlType === "SERIALIZED").length },
  ];
}

/** Apply a view. Pure filter, no sorting, no side effects. */
export function applyPartsCollectionView(rows, viewKey, attentionByPartId) {
  const list = Array.isArray(rows) ? rows : [];
  const attention = attentionByPartId instanceof Map ? attentionByPartId : new Map();
  if (viewKey === PARTS_COLLECTION_VIEW.ACTIVE) return list.filter((r) => r && r.status === "ACTIVE");
  if (viewKey === PARTS_COLLECTION_VIEW.SERIALIZED) return list.filter((r) => r && r.controlType === "SERIALIZED");
  if (viewKey === PARTS_COLLECTION_VIEW.NEEDS_ATTENTION) return list.filter((r) => r && attention.has(r.sku));
  return list;
}

/** The sorts a client-side list can honestly offer over rows it has fully loaded. */
export const PARTS_COLLECTION_SORT = Object.freeze({
  PART_NUMBER: "PART_NUMBER",
  NAME: "NAME",
  CATEGORY: "CATEGORY",
});

export const PARTS_COLLECTION_SORT_LABEL = Object.freeze({
  PART_NUMBER: "Part number",
  NAME: "Description",
  CATEGORY: "Category",
});

/**
 * Sort, without mutating the caller's array.
 *
 * A row with no Part Number sorts LAST rather than first: an absent identifier is not a small one,
 * and floating the least-identified rows to the top of a list people scan is the opposite of useful.
 */
export function sortPartsCollectionRows(rows, sortKey) {
  const list = [...(Array.isArray(rows) ? rows : [])];
  const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);
  const pick = (r) => {
    if (sortKey === PARTS_COLLECTION_SORT.NAME) return text(r?.name);
    if (sortKey === PARTS_COLLECTION_SORT.CATEGORY) return text(r?.category);
    return text(r?.internalPartNumber);
  };
  return list.sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av.localeCompare(bv);
  });
}

/**
 * One rendered row of Frame 1a's table: Part · Manufacturer · Category · Control · Status · Attention.
 *
 * DELIBERATELY NO QUANTITY (ND-25). The row model has no field that could carry one.
 *
 * `manufacturerNames` resolves the governed manufacturer id to its name. A part carrying no
 * manufacturer returns null and the caller renders the absence — it never borrows the part number,
 * the category, or anything else to fill the cell.
 */
export function partsCollectionRow(row, { manufacturerNames = new Map(), attentionByPartId = new Map() } = {}) {
  const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
  const manufacturerId = str(row?.manufacturerId);
  const attention = attentionByPartId instanceof Map ? attentionByPartId.get(row?.sku) ?? null : null;
  return {
    sku: row?.sku ?? null,
    // ND-26: the human-facing Part Number. Null stays null — never the document key.
    partNumber: str(row?.internalPartNumber),
    name: str(row?.name),
    manufacturer: manufacturerId ? manufacturerNames.get(manufacturerId) ?? manufacturerId : null,
    manufacturerResolved: manufacturerId ? manufacturerNames.has(manufacturerId) : false,
    category: str(row?.category),
    control: word(CONTROL_TYPE_LABEL, row?.controlType),
    status: word(PART_STATUS_LABEL, row?.status),
    attention,
  };
}

// ============================ THE REORDER POINT ============================
//
// Owner ruling, 2026-08-30: a reorder point must not be presented as an operationally meaningful
// number when the same card says "Insufficient usage history". A CALCULATED zero and a governed
// reorder point that genuinely IS zero are not the same business fact, and only one of them is a
// reason to do nothing.
//
// The ruling permits a zero where EOS can establish that zero is the actual governed value. It
// cannot, and the arithmetic is what proves it:
//
//   calculateReorderPoint(usage, leadTimeDays, safetyFactor)
//     = avgDailyUsage * leadTimeDays + avgDailyUsage * safetyFactor
//     = avgDailyUsage * (leadTimeDays + safetyFactor)
//
//   avgDailyUsage          = totalConsumed / windowDays
//   hasUsageHistory(usage) = totalConsumed > 0
//
// So reorderPoint === 0  <=>  avgDailyUsage === 0  <=>  totalConsumed === 0  <=>  no usage
// history. The conditions are IDENTICAL, not merely correlated. A zero here is always the
// consequence of an absent input and never a decision anybody made.
//
// The metadata register says the same thing from the other direction --
// PART_REORDER_POINT_IS_DERIVED: "calculated from usage, NOT stored on the Part". There is no
// stored reorder point anywhere for a governed zero to come FROM.
//
// NO CALCULATION IS INVENTED HERE. This chooses a SENTENCE or the existing derived number. It
// does not compute a reorder point, adjust one, or supply a default.

/**
 * How the Stock forecast should present the reorder point.
 *
 * @returns {{ established: boolean, value: number|null, absence: string|null }}
 *   established:true  -> render `value` (the existing derivation, unchanged)
 *   established:false -> render `absence`, never a number
 */
export function partReorderPointDisplay(health) {
  const usage = health && health.usage;
  const raw = health && health.recommendation ? health.recommendation.reorderPoint : undefined;
  const totalConsumed = usage && typeof usage.totalConsumed === "number" ? usage.totalConsumed : 0;

  // The same predicate the sibling rows already use, and -- per the proof above -- exactly the
  // condition under which the number would be zero-by-absence.
  if (totalConsumed <= 0 || typeof raw !== "number" || !Number.isFinite(raw)) {
    return { established: false, value: null, absence: "Not established" };
  }
  return { established: true, value: Math.ceil(raw), absence: null };
}

// ============================ ACTIVITY ============================
//
// The ledger that EXISTS is inventory_transactions — the Work-Order reservation vocabulary plus the
// governed movements Receiving, Transfer and Cycle Count actually write. The seven-type operational
// movement contract in inventoryLedgerEvent.js is a pure SHAPE contract with no persistence at all,
// so it cannot be read from and is not named here as though it could. The section says which ledger
// it is showing.

/** Stored type -> the words a reader gets. A raw enum in a table cell is a leak, and this table has
 * been leaking one. */
export const LEDGER_TYPE_LABEL = Object.freeze({
  RESERVED: "Reserved",
  RELEASED: "Released",
  CONSUMED: "Consumed",
  RECEIVED: "Received",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTED: "Adjusted",
});

/**
 * Rows for the Activity section.
 *
 * Presentation only: the order and the slice are selectPartLedger's, the quantities are the stored
 * ones, and nothing is summed. An unrecognised type renders as "Movement" rather than as its token —
 * unknown is not a reason to show a reader a database value.
 */
export function partActivityRows(transactions) {
  return (Array.isArray(transactions) ? transactions : []).map((t) => ({
    id: t?.id ?? null,
    type: word(LEDGER_TYPE_LABEL, t?.type) ?? "Movement",
    typeIsKnown: word(LEDGER_TYPE_LABEL, t?.type) !== null,
    quantity: typeof t?.quantity === "number" ? t.quantity : null,
    workOrderId: typeof t?.workOrderId === "string" && t.workOrderId.length > 0 ? t.workOrderId : null,
    timestamp: typeof t?.timestamp === "number" ? t.timestamp : null,
  }));
}

/** What the Activity heading may honestly claim about its own scope. */
export const PART_ACTIVITY_SCOPE_NOTE =
  "Movements recorded against this part in the work-order and receiving ledger — the most recent first.";
