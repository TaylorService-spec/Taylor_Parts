// Manufacturer — the human-readable label vocabulary for its one closed enum (status).
//
// S-INV-TRANSFER-MANUFACTURER-DEFINITIONS. domain/manufacturersView.js already carries the
// canonical MACHINE VALUES (MANUFACTURER_STATUSES, a client mirror of functions/src/partMaster/
// types.ts's MANUFACTURER_STATUSES) — it needs them to validate a raw getManufacturerCatalog
// projection before handing a view to React (toManufacturerListView). Neither it nor
// modules/inventory/Manufacturers.jsx carries a WORD for either value: the workspace's own
// StatusBadge renders the stored token itself ("ACTIVE"/"INACTIVE") as its own label — its
// STATUS_TONE map keys color, not text. This module is the missing label layer, sourced from
// the SAME values rather than a second copy of them — the #1093 lesson entityDefinition.js's own
// header names (a label map that drifts from the values it labels is how "0 Active" ends up
// beside a table of ACTIVE rows), applied here the same way domain/warehousesView.js's
// WAREHOUSE_STATUS_META and domain/suppliersView.js's SUPPLIER_STATUS_META already apply it for
// their own entities.
//
// A metadata FieldDefinition (definitions/manufacturer.js) imports its enumValues and enumLabels
// from here. It must never carry a second label map of its own.
import { MANUFACTURER_STATUSES } from "./manufacturersView.js";

export { MANUFACTURER_STATUSES };

/** Stored value -> { label, tone }. Mirrors WAREHOUSE_STATUS_META / SUPPLIER_STATUS_META's shape. */
export const MANUFACTURER_STATUS_META = Object.freeze({
  ACTIVE: { label: "Active", tone: "done" },
  INACTIVE: { label: "Inactive", tone: "muted" },
});

export function manufacturerStatusLabel(status) {
  return MANUFACTURER_STATUS_META[status]?.label ?? (typeof status === "string" && status ? status : "Unknown");
}
export function manufacturerStatusTone(status) {
  return MANUFACTURER_STATUS_META[status]?.tone ?? "muted";
}
