// INV-1 Phase 1, PR 1.9 -- pure Part Master read-view mapper (no Firebase
// import; unit-testable in plain Node). Maps raw Firestore document data
// into safe, render-ready view models: malformed records become structured
// { invalid: true } entries -- raw objects are NEVER handed to React.
// READ-ONLY: this module (and the whole PR 1.9 surface) has no write path.

export const PART_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"];
export const CONTROL_TYPES = ["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"];
export const STOCKING_CLASSES = ["STOCKED", "NON_STOCK", "SERVICE", "KIT"];
export const UNIT_CODES = ["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"];

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

/** Map one raw document (id + data) to a view model. Never throws. */
export function toPartView(docId, data) {
  const d = data && typeof data === "object" ? data : {};
  const partId = str(d.partId);
  const internalPartNumber = str(d.internalPartNumber);
  const name = str(d.name);
  const status = PART_STATUSES.includes(d.status) ? d.status : null;
  const stockingUnit = UNIT_CODES.includes(d.stockingUnit) ? d.stockingUnit : null;
  const controlType = CONTROL_TYPES.includes(d.controlType) ? d.controlType : null;
  const stockingClass = STOCKING_CLASSES.includes(d.stockingClass) ? d.stockingClass : null;
  if (partId === null || partId !== docId || internalPartNumber === null || name === null || status === null || stockingUnit === null || controlType === null || stockingClass === null) {
    return { invalid: true, docId, reason: "malformed Part record" };
  }
  return {
    invalid: false,
    partId,
    internalPartNumber,
    name,
    description: str(d.description) ?? "",
    category: str(d.category) ?? "",
    status,
    stockingUnit,
    controlType,
    stockingClass,
    version: Number.isInteger(d.version) ? d.version : 0,
  };
}

/** Deterministic list view: valid parts sorted by internalPartNumber then
 * partId; invalid records surfaced separately (never silently dropped). */
export function toPartListView(docs) {
  const parts = [];
  const invalid = [];
  for (const { id, data } of Array.isArray(docs) ? docs : []) {
    const v = toPartView(id, data);
    if (v.invalid) invalid.push(v);
    else parts.push(v);
  }
  parts.sort((a, b) =>
    a.internalPartNumber === b.internalPartNumber
      ? a.partId.localeCompare(b.partId)
      : a.internalPartNumber.localeCompare(b.internalPartNumber)
  );
  return { parts, invalid };
}
