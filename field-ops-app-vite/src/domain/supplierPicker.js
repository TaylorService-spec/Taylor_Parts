// Governed Supplier selection at PO-creation time -- PURE helpers (no Firebase/I/O; unit-tested). Reuses
// the SINGLE governed Supplier read model (domain/suppliersView) -- NOT a second read model. Only ACTIVE
// governed suppliers are selectable for a new PO (INACTIVE are retained but never selectable). The picker
// selects a Supplier ENTITY (id + name + status); the caller decides what to persist -- today only the
// name (existing production-compatible supplierName schema), later supplierId + supplierNameSnapshot
// without redesigning the interaction.
import { buildSuppliersView } from "./suppliersView.js";

// The ACTIVE, selectable supplier rows for a new PO, from the governed read. Rows: { id, name, status,
// vendorNumber, contact }. INACTIVE / ungoverned rows are excluded (not selectable). Name-sorted (from
// buildSuppliersView). A malformed/undefined input yields [] (never throws).
export function selectableActiveSuppliers(rawSuppliers) {
  return buildSuppliersView(rawSuppliers).rows.filter((r) => r.status === "ACTIVE");
}

// Filter selectable suppliers by a name/vendor query (case-insensitive substring), bounded to `limit`.
// Empty query returns the first `limit`. Order is preserved (name-sorted).
export function rankSupplierMatches(rows, query, limit = 8) {
  const list = Array.isArray(rows) ? rows : [];
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matched = q === ""
    ? list
    : list.filter((r) => (r.name ?? "").toLowerCase().includes(q) || (r.vendorNumber ?? "").toLowerCase().includes(q));
  return { results: matched.slice(0, limit), total: matched.length };
}

// Is a supplier ENTITY currently selectable for a new PO? (ACTIVE + has a name). Used to guard submit so a
// stale/INACTIVE selection can never be written. Never trusts a bare string.
export function isSelectableSupplier(entity) {
  return !!entity && entity.status === "ACTIVE" && typeof entity.name === "string" && entity.name.length > 0;
}
