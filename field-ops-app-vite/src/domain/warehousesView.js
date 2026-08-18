// Inventory > Warehouses -- PURE view helpers for the Warehouses (inventory-location) registry
// workspace. No Firebase, no I/O; Node-importable and unit-tested. It shapes the raw `warehouses`
// docs (from the shared operationsQueries.fetchWarehouses read) into an operator registry keyed on
// the GOVERNED status. It does NOT re-render bin-level stock or reconciliation (those stay in the
// Operations WarehousePanel), and introduces no write path (warehouses is Admin-SDK-write-only).

// Client mirror of the governed status authority (functions/src/types/warehouse.ts
// WAREHOUSE_STATUSES). Same house convention as TRUCK_STATUSES / PART_STATUSES: a client-side
// mirror of a backend authority, not a second authority.
export const WAREHOUSE_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

export const WAREHOUSE_STATUS_META = Object.freeze({
  ACTIVE: { label: "Active", tone: "done" },
  INACTIVE: { label: "Inactive", tone: "muted" },
});

export function warehouseStatusLabel(status) {
  return WAREHOUSE_STATUS_META[status]?.label ?? (typeof status === "string" && status ? status : "Unknown");
}
export function warehouseStatusTone(status) {
  return WAREHOUSE_STATUS_META[status]?.tone ?? "muted";
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// RECEIVING-ELIGIBILITY AUTHORITY (read this before reasoning about "eligible"): the governed
// receiving service is authoritative. It admits a warehouse ONLY when its FULL §3A governed record
// validates (functions/src/warehouseGovernance/governedWarehouseValidation.ts -- status present and
// === "ACTIVE", integer version >= 1, valid updatedAt/updatedBy, coherent provenance, and NO legacy
// `active` key) AND status === "ACTIVE" (functions/src/warehouseGovernance/
// receivingLocationOptionsService.ts; spec receiving-location-authority-i-la-c2-warehouse-status.md
// §6 -- explicitly NOT the existence-primary Truck-Registry heuristic).
//
// This CLIENT registry does NOT (and cannot faithfully) re-run that governed-shape validation from
// the raw doc. It reports the stored governed STATUS only: `isWarehouseActiveStatus` is a
// STATUS-level signal (status === "ACTIVE"), not a guarantee the receiving service will admit the
// warehouse. The UI states this plainly and defers the final check to the receiving service. Do not
// relabel this as "exactly what Receiving accepts."
export function isWarehouseActiveStatus(w) {
  return isPlainObject(w) && w.status === "ACTIVE";
}

// Build the registry view: rows = { id, name, status }, sorted by name (then id) for a stable,
// human-scannable list. Malformed entries (no id) are skipped, never rendered.
export function buildWarehousesView(warehouses) {
  const list = Array.isArray(warehouses) ? warehouses : [];
  const rows = [];
  for (const w of list) {
    if (!isPlainObject(w) || typeof w.id !== "string" || w.id.length === 0) continue;
    rows.push({
      id: w.id,
      // A record id is NOT a name. This used to fall back to `w.id`, putting a Firestore
      // document id in front of a user whenever a warehouse had no name -- DECISIONS #106,
      // which has no "unless nothing else is available" clause. The em dash makes the missing
      // name visible instead of disguising it as data. Sorting still uses `id` as the
      // tiebreaker below, so unnamed rows stay stably ordered.
      name: typeof w.name === "string" && w.name ? w.name : "—",
      status: typeof w.status === "string" && w.status ? w.status : null,
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows, summary: summarizeWarehouses(rows) };
}

// `active` = status-level ACTIVE count (the client receiving-active signal). `inactive` = status
// INACTIVE. `ungoverned` = neither (missing/unknown status -> Receiving rejects; surfaced honestly).
export function summarizeWarehouses(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter((r) => r?.status === "ACTIVE").length;
  const inactive = list.filter((r) => r?.status === "INACTIVE").length;
  return {
    total: list.length,
    active,
    inactive,
    ungoverned: list.length - active - inactive,
  };
}

// Operator status filters (by governed status). "All" leads (a small warehouse count is usually
// shown whole), then the two governed states.
export const WAREHOUSE_FILTERS = Object.freeze([
  { key: "all", label: "All", statuses: null },
  { key: "active", label: "Active", statuses: ["ACTIVE"] },
  { key: "inactive", label: "Inactive", statuses: ["INACTIVE"] },
]);

export const DEFAULT_WAREHOUSE_FILTER = "all";

export function filterWarehouses(rows, filterKey) {
  const list = Array.isArray(rows) ? rows : [];
  const f = WAREHOUSE_FILTERS.find((x) => x.key === filterKey);
  if (!f || !f.statuses) return list;
  const set = new Set(f.statuses);
  return list.filter((r) => set.has(r?.status));
}

export function countForWarehouseFilter(rows, filterKey) {
  return filterWarehouses(rows, filterKey).length;
}
