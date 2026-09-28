import { Timestamp } from "firebase/firestore";
import { GOVERNED_RECORD_READ_READY } from "../config/governedRecordReadReadiness.js";

// The client half of the governed record read (Pass 11 Fix Wave 1).
//
// ONE place the client decides whether a Rules-gated collection is read directly from Firestore or through the
// governed `readGovernedRecords` callable (functions/src/access/governedRecordRead.ts). The server decides WHO may
// read WHAT -- capability, condition, scope, record relationship, all from PostgreSQL Administration. This module
// only translates: collection -> surface, a query -> the callable's bounded request, and the callable's wire rows
// back into the shape a direct Firestore read produced (ids alongside data, Timestamps as Timestamps).
//
// NO FALLBACK. In a governed environment a denied or failed governed read surfaces as that failure, with the same
// `permission-denied` / `unavailable` codes a Firestore read produced. Retrying it as a direct Firestore read would
// put the legacy Rules decision back in charge -- the exact defect this replaces.

/** The collections the server's closed surface registry serves, by the surface name it expects. */
export const GOVERNED_SURFACE_BY_COLLECTION = Object.freeze({
  fieldops_wos: "workOrders",
  accounts: "accounts",
  warehouses: "warehouses",
  transfer_orders: "transferOrders",
  reorder_purchase_orders: "purchaseOrders",
  reorder_requests: "reorderRequests",
  parts: "parts",
  inventory_transactions: "inventoryTransactions",
});

/** The governed surface for a collection, or null when this environment reads it directly (or it is not governed). */
export function governedSurfaceFor(collectionName, ready = GOVERNED_RECORD_READ_READY) {
  if (!ready) return null;
  return Object.prototype.hasOwnProperty.call(GOVERNED_SURFACE_BY_COLLECTION, collectionName)
    ? GOVERNED_SURFACE_BY_COLLECTION[collectionName]
    : null;
}

/** Undo the server's wire encoding: tagged ISO strings become Firestore Timestamps again. */
export function fromWire(value) {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === "object") {
    if (typeof value.__timestamp === "string" && Object.keys(value).length === 1) {
      return Timestamp.fromDate(new Date(value.__timestamp));
    }
    if (typeof value.__ref === "string" && Object.keys(value).length === 1) return value.__ref;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromWire(v);
    return out;
  }
  return value;
}

async function invoke(payload) {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("../firebase/firebase.js"),
  ]);
  try {
    const res = await httpsCallable(functions, "readGovernedRecords")(payload);
    return res?.data ?? {};
  } catch (err) {
    const raw = err && typeof err.code === "string" ? err.code : "";
    const normalized = new Error(err?.message ?? "governed read failed");
    normalized.code = raw.startsWith("functions/") ? raw.slice("functions/".length) : raw || "unavailable";
    throw normalized;
  }
}

/** Server page cap (functions/src/access/governedRecordRead.ts MAX_GOVERNED_READ_LIMIT). */
export const GOVERNED_PAGE_MAX = 500;

/**
 * One bounded page. `rows` are `{ id, ...data }` exactly like a direct read's docs.
 * `filters`/`sort` use the metadata list runtime's descriptor vocabulary (EQUALS, IN, ... / ASC, DESC).
 */
export async function readGovernedPage(surface, { filters = [], sort = [], limit, afterId = null } = {}) {
  const data = await invoke({ surface, filters, sort, limit: Math.min(limit, GOVERNED_PAGE_MAX), afterId });
  // The server keeps the document id and the stored data apart ({ id, data }), as a direct read does. `docs` keeps
  // them apart for a caller that must (the transfer adapter's stored-id check); `rows` composes them exactly the way
  // every direct `{ id: d.id, ...d.data() }` read in this app does.
  const docs = Array.isArray(data.rows)
    ? data.rows.map((r) => ({ id: String(r.id), data: fromWire(r.data ?? {}) }))
    : [];
  return {
    docs,
    rows: docs.map((d) => ({ id: d.id, ...d.data })),
    truncated: data.truncated === true,
    admission: data.admission ?? null,
    withheld: Number.isFinite(data.withheld) ? data.withheld : 0,
  };
}

/**
 * Every authorized row, page by page, up to `cap`. For the surfaces that genuinely read a whole collection today;
 * `truncated` is honest when the cap stops it.
 */
export async function readGovernedAll(surface, { filters = [], sort = [{ fieldId: "__name__", direction: "ASC" }], cap = 5000 } = {}) {
  const docs = [];
  let afterId = null;
  const done = (truncated) => ({ docs, rows: docs.map((d) => ({ id: d.id, ...d.data })), truncated });
  for (;;) {
    const page = await readGovernedPage(surface, { filters, sort, limit: Math.min(GOVERNED_PAGE_MAX, cap - docs.length), afterId });
    docs.push(...page.docs);
    if (!page.truncated || page.docs.length === 0) return done(false);
    if (docs.length >= cap) return done(true);
    afterId = page.docs[page.docs.length - 1].id;
  }
}
