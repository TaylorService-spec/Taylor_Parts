// Fixture SANITIZER — classify every field KEEP / TRANSFORM / REMOVE, per canonical collection.
//
// Safety posture: ALLOWLIST. Only fields explicitly KEPT (copied verbatim) or TRANSFORMED (structure kept,
// production-specific value replaced with a deterministic sandbox token) survive. EVERYTHING ELSE — every
// unlisted field — is DROPPED. So a new/unexpected production field can never silently leak into the
// sandbox. Transforms are DETERMINISTIC (derived from stable identity), so re-extraction is stable and no
// production value is ever emitted. Pure (no I/O).
import { createHash } from "node:crypto";

export const SANITIZER_VERSION = "1.0.0";

// Deterministic short token from a stable input (no randomness -> repeatable). Used by TRANSFORM policies.
function det(prefix, ...parts) {
  const h = createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 10);
  return `${prefix}-${h}`;
}

// Per-collection policy. keep: field names copied verbatim. transform: { field: (value, record) => newValue }.
// Any field not in keep/transform is REMOVED. Collections absent here are EXCLUDED from v1 (see fixtureSpec
// selection) rather than half-sanitized.
export const POLICY = {
  parts: {
    // Part numbers/identifiers are retained intentionally (Owner: acceptable, materially improves realism).
    keep: ["partId", "internalPartNumber", "name", "status", "controlType", "stockingClass", "stockingUnit", "oemStatus", "flags", "manufacturerId"],
    transform: {},
    // removed (never copied): cost/pricing, notes/free text, createdAt/updatedAt, createdBy/audit actors, external system ids.
  },
  manufacturers: { keep: ["manufacturerId", "name", "status"], transform: {} },
  part_aliases: { keep: ["partId", "aliasType", "aliasValue", "status"], transform: {} },

  warehouses: {
    keep: ["warehouseId", "name", "status", "active"],
    // Street address / free-text location is business-specific -> TRANSFORM to a generic sandbox label.
    transform: { address: (_v, w) => det("SBX-ADDR", w.warehouseId) },
  },
  stock_locations: { keep: ["warehouseId", "partId", "quantity", "binCode"], transform: {} },
  trucks: {
    keep: ["truckId", "locationId", "homeWarehouseId", "status", "active", "vehicleNumber"],
    // Driver is EMPLOYEE identity -> REMOVE (dropped). Display label may embed a person/plate -> TRANSFORM.
    transform: { displayLabel: (_v, t) => det("SBX-TRUCK", t.truckId) },
    // removed: assignedDriverEmployeeId (employee identity).
  },
  mobile_locations: { keep: ["locationId", "type", "status"], transform: {} },

  equipment_models: { keep: ["equipmentModelId", "manufacturerId", "modelNumber", "name", "status"], transform: {} },
  equipment_model_aliases: { keep: ["equipmentModelId", "aliasKey", "aliasValue", "status"], transform: {} },
  equipment_part_compatibility: {
    keep: ["equipmentModelId", "partId", "compatibilityType", "quantityRequired", "applicability", "status"],
    transform: {},
    // removed: verification/evidence actor identities, free-text notes.
  },
  equipment: {
    keep: ["equipmentId", "equipmentModelId", "status"],
    // Serial number: keep FORMAT realism + scannability but replace the real customer value deterministically.
    transform: { serialNumber: (v, e) => det("SBX-SN", e.equipmentId, typeof v === "string" ? v.length : 0) },
    // removed: accountId/customerId/locationId/ownerId (customer-identifying), notes, installedBy/audit, timestamps.
  },
};

export const SANITIZED_COLLECTIONS = Object.keys(POLICY);

// Sanitize one record for a collection. Returns { record, kept[], transformed[], removed[] } — the field
// classification is captured for the manifest evidence. Never mutates the input. Unknown collection -> throw
// (fail closed; we never emit an unsanitized collection).
export function sanitizeRecord(collection, raw) {
  const policy = POLICY[collection];
  if (!policy) throw new Error(`No sanitizer policy for collection "${collection}" — refusing to emit unsanitized data.`);
  const out = {};
  const kept = [];
  const transformed = [];
  const removed = [];
  for (const [field, value] of Object.entries(raw ?? {})) {
    if (policy.keep.includes(field)) { out[field] = value; kept.push(field); }
    else if (policy.transform[field]) { out[field] = policy.transform[field](value, raw); transformed.push(field); }
    else { removed.push(field); }
  }
  return { record: out, kept, transformed, removed };
}

// A field-classification report for the manifest: which fields would be kept/transformed/removed for a
// collection given a sample of records (union across the sample). Pure.
export function classifyFields(collection, records = []) {
  const kept = new Set(), transformed = new Set(), removed = new Set();
  for (const r of records) {
    const c = sanitizeRecord(collection, r);
    c.kept.forEach((f) => kept.add(f));
    c.transformed.forEach((f) => transformed.add(f));
    c.removed.forEach((f) => removed.add(f));
  }
  return { keep: [...kept].sort(), transform: [...transformed].sort(), remove: [...removed].sort() };
}
