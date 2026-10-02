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

export const fetchInventoryPosition = ({ partIds = null, warehouseId = null } = {}, options) =>
  call("readInventoryOnHand", { ...(partIds ? { partIds } : {}), ...(warehouseId ? { warehouseId } : {}) }, options);

export const fetchInventoryMovements = ({ partIds = null, limit } = {}, options) =>
  call("readInventoryMovements", { ...(partIds ? { partIds } : {}), ...(limit ? { limit } : {}) }, options);

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
    return { status: OUTCOME_BY_CODE[err?.code] ?? "unavailable", options: [] };
  }
}
