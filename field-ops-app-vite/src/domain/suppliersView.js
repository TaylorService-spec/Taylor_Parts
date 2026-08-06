// Purchasing > Suppliers -- PURE view helpers for the Supplier registry workspace. No Firebase,
// no I/O; Node-importable and unit-tested. It shapes the raw `suppliers` docs (from the shared
// operationsQueries.fetchSuppliers read) into an operator registry keyed on the GOVERNED status
// (Supplier Master, functions/src/supplierMaster/*). It introduces no write path (suppliers is
// Admin-SDK-write-only; the S2 trusted commands are the only writers).
//
// Honesty note: this collection may still hold legacy Epic-5 demo supplier docs that predate the
// Supplier Master governance (no `status`). Those surface as "ungoverned" here -- truthfully NOT
// governed Supplier records -- exactly as the Warehouses registry treats a missing governed status.
// This is a read of stored governed STATUS, not a re-run of the backend governed validator.

// Client mirror of the governed status authority (functions/src/supplierMaster/supplierMasterTypes.ts
// SUPPLIER_STATUSES). Same house convention as WAREHOUSE_STATUSES / PART_STATUSES: a client-side
// mirror of a backend authority, not a second authority.
export const SUPPLIER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

export const SUPPLIER_STATUS_META = Object.freeze({
  ACTIVE: { label: "Active", tone: "done" },
  INACTIVE: { label: "Inactive", tone: "muted" },
});

// DELIBERATE divergence from warehousesView (which labels a missing status "Unknown"/tone "muted"):
// here a missing governed status reads "Ungoverned"/tone "warn" (amber). This is intentional, not
// drift -- Supplier Master is mid-adoption, so a status-less doc is a legacy record that must be
// noticed and governed (and is non-selectable for purchasing), which warrants visual urgency. The
// older Warehouses "muted/Unknown" convention predates this and has not been backported.
export function supplierStatusLabel(status) {
  return SUPPLIER_STATUS_META[status]?.label ?? (typeof status === "string" && status ? status : "Ungoverned");
}
export function supplierStatusTone(status) {
  return SUPPLIER_STATUS_META[status]?.tone ?? "warn";
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Best-available contact line for the registry (governed optional fields, in preference order).
// Purely presentational; never fabricated.
function contactLine(s) {
  return str(s.email) ?? str(s.phone) ?? str(s.contactName) ?? null;
}

// Build the registry view: rows = { id, name, status, vendorNumber, contact }, sorted by name
// (then id) for a stable, human-scannable list. Malformed entries (no id) are skipped, never
// rendered. `status` is null when the stored doc carries no governed status (legacy/ungoverned).
export function buildSuppliersView(suppliers) {
  const list = Array.isArray(suppliers) ? suppliers : [];
  const rows = [];
  for (const s of list) {
    if (!isPlainObject(s) || typeof s.id !== "string" || s.id.length === 0) continue;
    rows.push({
      id: s.id,
      name: str(s.name) ?? s.id,
      status: str(s.status),
      vendorNumber: str(s.vendorNumber),
      contact: contactLine(s),
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows, summary: summarizeSuppliers(rows) };
}

// `active`/`inactive` = governed status counts. `ungoverned` = neither (missing/unknown status:
// a legacy demo doc or a record predating Supplier Master governance) -- surfaced honestly, not
// silently counted as active.
export function summarizeSuppliers(rows) {
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

// Operator status filters. "All" leads, then the two governed states, then the honest
// "Ungoverned" bucket so legacy docs are findable rather than hidden.
export const SUPPLIER_FILTERS = Object.freeze([
  { key: "all", label: "All", match: null },
  { key: "active", label: "Active", match: (r) => r?.status === "ACTIVE" },
  { key: "inactive", label: "Inactive", match: (r) => r?.status === "INACTIVE" },
  { key: "ungoverned", label: "Ungoverned", match: (r) => r?.status !== "ACTIVE" && r?.status !== "INACTIVE" },
]);

export const DEFAULT_SUPPLIER_FILTER = "all";

export function filterSuppliers(rows, filterKey) {
  const list = Array.isArray(rows) ? rows : [];
  const f = SUPPLIER_FILTERS.find((x) => x.key === filterKey);
  if (!f || !f.match) return list;
  return list.filter((r) => f.match(r));
}

export function countForSupplierFilter(rows, filterKey) {
  return filterSuppliers(rows, filterKey).length;
}
