// Inventory > Transfers -- PURE presentation helpers for the Transfers workspace. It composes the
// CANONICAL view-model output (modules/operations/transferOrdersViewModel.buildTransferOrdersView,
// which owns the transfer_orders -> row mapping, warehouse-name resolution, and fail-closed
// invalid handling) into operator-centric status groups + counts. It does NOT re-map raw docs or
// re-implement the view -- single source of truth stays with buildTransferOrdersView. No Firebase,
// no I/O; Node-importable and unit-tested.
import { TRANSFER_ORDER_STATUSES } from "./inventoryTransferPairing.js";

// Human labels + badge tone per canonical status (REQUESTED / IN_TRANSIT / COMPLETED / CANCELLED).
// "tone" drives styling only; labels avoid implementation casing.
export const TRANSFER_STATUS_META = Object.freeze({
  REQUESTED: { label: "Requested", tone: "pending" },
  IN_TRANSIT: { label: "In transit", tone: "active" },
  COMPLETED: { label: "Completed", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
});

export function transferStatusLabel(status) {
  return TRANSFER_STATUS_META[status]?.label ?? status;
}
export function transferStatusTone(status) {
  return TRANSFER_STATUS_META[status]?.tone ?? "muted";
}

// The operator's mental grouping. "Active" (the in-flight work) leads and is the default; the
// terminal states are separate; "All" is the escape hatch. Ordered as shown in the filter bar.
export const TRANSFER_FILTERS = Object.freeze([
  { key: "active", label: "Active", statuses: ["REQUESTED", "IN_TRANSIT"] },
  { key: "in_transit", label: "In transit", statuses: ["IN_TRANSIT"] },
  { key: "completed", label: "Completed", statuses: ["COMPLETED"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED"] },
  { key: "all", label: "All", statuses: null }, // null = no status filter
]);

export const DEFAULT_TRANSFER_FILTER = "active";

function statusesForFilter(filterKey) {
  const f = TRANSFER_FILTERS.find((x) => x.key === filterKey);
  return f ? f.statuses : null;
}

// Filter canonical rows by a filter key. `null` statuses (All) returns every row. Unknown key
// falls back to All (never throws, never hides everything silently).
export function filterTransfers(rows, filterKey) {
  const list = Array.isArray(rows) ? rows : [];
  const statuses = statusesForFilter(filterKey);
  if (!statuses) return list;
  const set = new Set(statuses);
  return list.filter((r) => set.has(r?.status));
}

// Per-status + roll-up counts for the summary line and filter-bar badges. inFlight = the
// operationally-urgent count (REQUESTED + IN_TRANSIT).
export function summarizeTransfers(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byStatus = {};
  for (const s of TRANSFER_ORDER_STATUSES) byStatus[s] = 0;
  for (const r of list) {
    if (r && Object.prototype.hasOwnProperty.call(byStatus, r.status)) byStatus[r.status] += 1;
  }
  return {
    total: list.length,
    byStatus,
    inFlight: byStatus.REQUESTED + byStatus.IN_TRANSIT,
  };
}

// Count for a given filter key (for the filter-bar counts), derived from the same rows.
export function countForFilter(rows, filterKey) {
  return filterTransfers(rows, filterKey).length;
}
