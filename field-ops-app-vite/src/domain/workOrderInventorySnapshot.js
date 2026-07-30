// OD-3 -- Work Order inventorySnapshot display resolution for the snapshot-authority cohort
// (WorkOrderDetail, PartsOverviewPanel, ExecutionCapture, TechnicianWorkOrderCard).
//
// The Work Order `inventorySnapshot` is the AUTHORITATIVE HISTORICAL source: each item's
// `name` (and `category`/`unit`) is the value RECORDED AT WORK-ORDER CREATION and must never
// be overwritten by current canonical or static-catalog data (that would rewrite history).
// These pure helpers resolve the DISPLAY value from the snapshot item alone -- NO catalog
// lookup (canonical or static) occurs. A missing, empty, or malformed snapshot value degrades
// to the raw SKU (for the name) or a bounded neutral fallback (category "—", unit "unit(s)").

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;

/** Display name for a snapshot item: the recorded snapshot name, else the raw SKU (never a
 * catalog name). Malformed/missing/empty name -> SKU; malformed/missing SKU -> "". */
export function snapshotPartName(item) {
  if (item && isNonEmptyString(item.name)) return item.name;
  if (item && isNonEmptyString(item.sku)) return item.sku;
  return "";
}

/** Recorded snapshot SKU (string), else "". */
export function snapshotPartSku(item) {
  return item && isNonEmptyString(item.sku) ? item.sku : "";
}

/** Recorded snapshot category, else the bounded neutral value "—". */
export function snapshotPartCategory(item) {
  return item && isNonEmptyString(item.category) ? item.category : "—";
}

/** Recorded snapshot unit, else the existing neutral value "unit(s)". */
export function snapshotPartUnit(item) {
  return item && isNonEmptyString(item.unit) ? item.unit : "unit(s)";
}
