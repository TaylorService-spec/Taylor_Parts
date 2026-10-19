// PARTS / PURCHASING / RECEIVING READS -- the EOS PostgreSQL reads that replace the journey's Firebase reads (Controller
// PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01). Thin wrappers over the governed Operations transport
// (services/reorderApiClient.js -> POST /operations/inventory); every authorization -- capability, warehouse scope,
// tenant -- is decided by the server, and a refusal is surfaced as a code, never a partial list.
//
//   fetchSupplierList()                     listSuppliers                 eos_ops.suppliers (was Firestore `suppliers`)
//   fetchPurchaseOrderSupplierOptions(id)   listPurchaseOrderSupplierOptions  what a new PO may name: ACTIVE suppliers + the OTHER operating companies
//   fetchInventoryPosition({partIds})       readInventoryOnHand           on-hand derived from eos_ops.inventory_movements
//   fetchInventoryMovements({partIds})      readInventoryMovements        the scoped movement history behind it
//   fetchReceivingLocationOptions(id)       listReceivingLocationOptions  the Reorder's own destination warehouse + bins
//   fetchReorderAssignmentTargets()         listReorderAssignmentTargets  who the assign command accepts (was Firestore employees)
//   fetchReceipts({reorderRequestId})       listReceipts                  eos_ops.receiving_orders
import { callReorderApi } from "./reorderApiClient.js";

/** Throws an Error carrying the governed failure code (the hooks map it to a FailureState). */
async function call(operation, input, options) {
  const res = await (options?.call ?? callReorderApi)(operation, input, options);
  if (!res || res.ok !== true) {
    throw Object.assign(new Error(res?.message ?? `${operation} failed`), { code: res?.code ?? "INTERNAL", reason: res?.reason ?? null });
  }
  return res.result;
}

/** Supplier rows in the shape the existing Supplier views consume (`id` is the governed supplierId). */
export async function fetchSupplierList(options) {
  const result = await call("listSuppliers", {}, options);
  return (result?.items ?? []).map((s) => Object.freeze({ id: s.supplierId, ...s }));
}

/**
 * The governed supplier SELECTION for one Reorder's new PO (DECISIONS #193): picker rows keyed by `optionId`
 * ("KIND:id"), named for people. The server already excluded the buying company and never offers CONSOLIDATED.
 */
export async function fetchPurchaseOrderSupplierOptions(reorderRequestId, options) {
  const result = await call("listPurchaseOrderSupplierOptions", { reorderRequestId }, options);
  return (result?.items ?? []).map((o) => Object.freeze({
    id: o.optionId, name: o.name, status: "ACTIVE", kind: o.kind,
    vendorNumber: o.kind === "INTERNAL_OPERATING_COMPANY" ? "Operating company" : (o.vendorNumber ?? null),
  }));
}

// ── GOVERNED SUPPLIER ADMINISTRATION (DECISIONS #196) -- the server decides authority (inventory.catalog.manage for create /
// update, inventory.catalog.activate for status) and authors the supplier's name from its CRM organization.
export async function fetchSupplierOrganizationOptions(options) {
  return (await call("listSupplierOrganizationOptions", {}, options))?.items ?? [];
}
export const createSupplierRelationship = (input, options) => call("createSupplier", input, options);
export const updateSupplierFields = (input, options) => call("updateSupplier", input, options);
export const setSupplierRelationshipStatus = (input, options) => call("setSupplierStatus", input, options);

// ── GOVERNED PART-SUPPLIER TERMS (remediation SUP-1) -- one Part's supplier terms, read and maintained through the governed
// command layer (functions/src/eosOps/partSupplierTerms.ts). The server decides authority (inventory.supplierTerms.read /
// .create / .edit / .changeStatus + the COMMERCIAL field-group keys); a refusal throws with its code.
//   fetchPartSupplierItems(partId)      listPartSupplierItems         { partId, stockingUnit, fieldAccess, recordAccess, items, supplierOptions }
export const fetchPartSupplierItems = (partId, options) => call("listPartSupplierItems", { partId }, options);
export const createPartSupplierTerms = (input, options) => call("createPartSupplierItem", input, options);
export const updatePartSupplierTerms = (input, options) => call("updatePartSupplierItem", input, options);
export const setPartSupplierTermsStatus = (input, options) => call("setPartSupplierItemStatus", input, options);
export const setPreferredPartSupplierTerms = (input, options) => call("setPreferredPartSupplierItem", input, options);

/**
 * The Operations Procurement panel's supplier catalog, for exactly the Parts it has a reorder recommendation for (Firebase
 * exit F2: was the whole Firestore `supplier_catalog`). One governed listPartSupplierItems per Part; the server projects
 * every item for the caller, so cost is null when the COMMERCIAL field group is withheld. A Part the Catalog does not hold
 * contributes no item (NOT_FOUND); any other refusal fails the whole catalog, exactly as the old read did.
 * Shaped for domain/procurementDraftEngine.ts's SupplierCatalogItem.
 */
export async function fetchSupplierCatalogForParts(partIds, options) {
  const ids = [...new Set(partIds)];
  const answers = [];
  // ponytail: 4 per-part reads at a time; a batch listPartSupplierItems if recommendation lists grow large.
  for (let i = 0; i < ids.length; i += 4) {
    answers.push(...await Promise.all(ids.slice(i, i + 4).map((partId) =>
      fetchPartSupplierItems(partId, options).catch((error) => {
        // The transport carries the category; listPartSupplierItems' only NOT_FOUND is PART_NOT_FOUND.
        if (error?.code === "NOT_FOUND") return { items: [] };
        throw error;
      }))));
  }
  return answers.flatMap((answer) => (answer?.items ?? []).map((item) => Object.freeze({
    id: item.itemId,
    supplierId: item.supplierId,
    partId: item.partId,
    unitPrice: typeof item.cost === "string" && item.cost !== "" && Number.isFinite(Number(item.cost)) ? Number(item.cost) : null,
    currency: item.currency ?? null,
    available: item.status === "ACTIVE" && item.availability === "AVAILABLE",
    preferred: item.preferred === true,
  })));
}

export const fetchInventoryPosition = ({ partIds = null, warehouseId = null } = {}, options) =>
  call("readInventoryOnHand", { ...(partIds ? { partIds } : {}), ...(warehouseId ? { warehouseId } : {}) }, options);

export const fetchInventoryMovements = ({ partIds = null, limit } = {}, options) =>
  call("readInventoryMovements", { ...(partIds ? { partIds } : {}), ...(limit ? { limit } : {}) }, options);

/** One Part's on-hand / reserved / available / on-order (readPartBalance): each figure { state: KNOWN|UNKNOWN|NOT_COUNTED_BY_QUANTITY, value }. */
export const fetchPartBalance = (partId, options) => call("readPartBalance", { partId }, options);

/**
 * The balance in the shape the Part lookup consumes (`projection.byLocation[].locationId`). Pure; the server's figures pass through
 * untouched (UNKNOWN is never turned into 0 here), only the warehouse key is renamed to the lookup's location key.
 */
export const balanceProjection = (result) => ({
  onHand: result?.onHand, reserved: result?.reserved, available: result?.available, onOrder: result?.onOrder,
  byLocation: (Array.isArray(result?.byLocation) ? result.byLocation : []).map((l) => ({ locationId: l.warehouseId, quantity: l.quantity })),
});

/** The scan lookup's balance envelope: `{ result }` or `{ errorStatus }` (a refusal is `permission-denied`, never an empty balance). */
export async function fetchBalanceForScan({ partId }, options) {
  try {
    return { result: balanceProjection(await fetchPartBalance(partId, options)) };
  } catch (err) {
    return { errorStatus: err?.code === "FORBIDDEN" ? "permission-denied" : "internal", errorDetail: err?.message ?? null };
  }
}

export const fetchReceivingLocationOptions = (reorderRequestId, options) =>
  call("listReceivingLocationOptions", { reorderRequestId }, options);

export async function fetchReorderAssignmentTargets(options) {
  return (await call("listReorderAssignmentTargets", {}, options))?.items ?? [];
}

export const fetchReceipts = ({ reorderRequestId = null, limit } = {}, options) =>
  call("listReceipts", { ...(reorderRequestId ? { reorderRequestId } : {}), ...(limit ? { limit } : {}) }, options);

const OUTCOME_BY_CODE = Object.freeze({ FORBIDDEN: "denied", UNAUTHENTICATED: "unauthenticated", NOT_SIGNED_IN: "unauthenticated",
  NOT_FOUND: "not_found", INVALID_INPUT: "invalid", PRECONDITION_FAILED: "conflict", CONFLICT: "conflict" });

/**
 * The Receive dialog's destination choices for ONE Reorder purchase order, in its `{ status, options: [{ value, label }] }`
 * contract: the Reorder's own governed destination warehouse (DQ-C), from PostgreSQL -- replacing the Firebase
 * listReceivingLocationOptions callable. The dialog receives into a WAREHOUSE location, so only that option is offered;
 * the receipt command re-decides destination and scope regardless.
 */
export async function fetchReorderReceivingLocationOptions(reorderRequestId, options) {
  try {
    const result = await fetchReceivingLocationOptions(reorderRequestId, options);
    const choices = (result?.options ?? []).filter((o) => o.type === "WAREHOUSE").map((o) => Object.freeze({ value: o.locationId, label: o.label }));
    return { status: "ready", options: choices };
  } catch (err) {
    // B3-x: a GOVERNED refusal's own sentence travels with the bounded status ("no receivable Reorder Request in your warehouse scope"),
    // so a screen can say WHY rather than a generic "not found". A failure the platform did not govern keeps the bounded word only.
    const status = OUTCOME_BY_CODE[err?.code] ?? "unavailable";
    const governed = ["denied", "not_found", "invalid", "conflict"].includes(status);
    return governed && typeof err?.message === "string" && err.message !== "" ? { status, options: [], message: err.message } : { status, options: [] };
  }
}
