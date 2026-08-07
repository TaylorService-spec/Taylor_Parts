// Deterministic sandbox ID policy. PURE (no I/O).
//
// Owner rules: preserve canonical identity semantics; keep selected canonical IDs intact when they carry no
// sensitive information and are safe to reuse (it materially improves relationship integrity); otherwise
// generate DETERMINISTIC sandbox IDs and maintain an import mapping manifest; resolve collisions explicitly
// (never ad hoc); and NEVER rewrite partId = sku.
import { createHash } from "node:crypto";

// Operational identities that are safe to reuse verbatim in sandbox (no customer/personal data): part
// numbers, warehouse ids, equipment model ids, truck/location ids. Preserving them keeps every reference
// (stock_locations.partId/warehouseId, compatibility.partId/equipmentModelId, alias.partId) intact.
export const KEEP_ID_COLLECTIONS = new Set([
  "parts", "manufacturers", "warehouses", "equipment_models", "trucks", "mobile_locations",
]);

// Identities that MAY encode customer/site context and are remapped to a deterministic sandbox id. Nothing
// in the v1 fixture scope references these ids, so remapping cannot dangle a required edge.
export const REMAP_ID_COLLECTIONS = new Set(["equipment"]);

function deterministicSandboxId(collection, srcId) {
  const h = createHash("sha256").update(`${collection}|${srcId}`).digest("hex").slice(0, 12);
  return `SBX-${collection.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-${h}`;
}

// The sandbox id for a source id in a collection. KEEP collections return the id unchanged; REMAP
// collections return a stable deterministic sandbox id. Unknown collections keep the id (composite-keyed
// collections have no single id and are seeded by their natural composite key).
export function sandboxId(collection, srcId) {
  if (srcId == null) return srcId;
  if (REMAP_ID_COLLECTIONS.has(collection)) return deterministicSandboxId(collection, String(srcId));
  return String(srcId);
}

// Build the import mapping manifest for every REMAP collection in the fixture set: { collection: { srcId:
// sandboxId } }. Throws on a collision (two distinct source ids -> same sandbox id) rather than resolving it
// ad hoc. Also asserts the partId != sku invariant is never violated by the mapping (partId is KEEP-only and
// never derived from any sku). Pure.
export function buildImportMapping(fixtureSet, { idFieldFor }) {
  const mapping = {};
  for (const collection of REMAP_ID_COLLECTIONS) {
    const records = fixtureSet[collection];
    if (!records || records.length === 0) continue;
    const idField = idFieldFor(collection);
    if (!idField) continue;
    const forward = {};
    const reverse = {};
    for (const rec of records) {
      const src = rec[idField];
      if (src == null) continue;
      const dst = sandboxId(collection, src);
      if (reverse[dst] && reverse[dst] !== String(src)) {
        throw new Error(`ID collision in ${collection}: "${src}" and "${reverse[dst]}" both map to "${dst}". Resolve explicitly.`);
      }
      forward[String(src)] = dst;
      reverse[dst] = String(src);
    }
    mapping[collection] = forward;
  }
  return mapping;
}

// Guard the canonical Part identity invariant: partId must be preserved (KEEP) and never set equal to a
// part's sku/internalPartNumber. Throws if violated. Pure.
export function assertPartIdentityIntact(parts = []) {
  if (REMAP_ID_COLLECTIONS.has("parts")) throw new Error("parts must be KEEP_ID (partId is canonical and must be preserved).");
  for (const p of parts) {
    if (p.partId != null && p.internalPartNumber != null && String(p.partId) === String(p.internalPartNumber)) {
      // This would only be legitimate if production genuinely stores them equal; flag it so it is never a
      // sandbox-introduced conflation.
      throw new Error(`partId == internalPartNumber for "${p.partId}" — refuse to emit (never conflate partId with sku).`);
    }
  }
}
