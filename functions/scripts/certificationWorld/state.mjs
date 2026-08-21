// THE DEPLOYMENT RECORD, and the fields deliberately excluded from determinism.
//
// The repository owns the EXPECTED world; Firestore holds an INSTANTIATED COPY. That distinction is
// the whole design, and it only works if the copy can say which expectation it came from. So one
// document records it.
export const STATE_COLLECTION = "certification_world";
export const STATE_DOC_ID = "current";

/**
 * Fields that legitimately differ between two rebuilds of the SAME dataset version.
 *
 * NAMED, not silently skipped. "Ignore anything that does not match" is how a comparison stops
 * detecting anything -- the same failure as a guard that matches nothing, a sweep that measures half
 * its visits, or a wait that samples before render. Every entry here is a field whose variation is
 * EXPECTED and explained; anything not on this list must match byte for byte, and a mismatch is a
 * real finding rather than noise to be tuned away.
 */
export const VOLATILE_FIELDS = Object.freeze([
  Object.freeze({ field: "seededAt", why: "wall-clock instant the rebuild ran; differs by construction" }),
  Object.freeze({ field: "recordedAt", why: "server-assigned ledger stamp, reserved for the trusted writer (movement validation forbids callers setting it)" }),
  Object.freeze({ field: "createdAt", why: "server timestamp on records written through Admin SDK helpers" }),
  Object.freeze({ field: "updatedAt", why: "server timestamp; changes on every write even when the value does not" }),
  Object.freeze({ field: "auditId", why: "audit event identity is derived per write, not per dataset" }),
  Object.freeze({ field: "idempotencyKey", why: "movement keys embed the run so a rebuild is not mistaken for a replay of the previous one" }),
]);

const VOLATILE = new Set(VOLATILE_FIELDS.map((v) => v.field));

/** Strip volatile fields, recursively, so two worlds can be compared on the parts that must match. */
export function stableShape(value) {
  if (Array.isArray(value)) return value.map(stableShape);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (VOLATILE.has(k)) continue;
      out[k] = stableShape(value[k]);
    }
    return out;
  }
  return value;
}

/** A deterministic fingerprint of the whole world, for "are these two rebuilds the same world?". */
export function worldFingerprint(records) {
  const rows = records
    .map((r) => `${r.collection}/${r.id}:${JSON.stringify(stableShape(r.data))}`)
    .sort();
  // FNV-1a. Not cryptographic and does not need to be -- it detects change, it does not resist
  // an adversary, and a dependency-free hash keeps this script importable anywhere.
  let h = 0x811c9dc5;
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      h ^= row.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return { hash: h.toString(16).padStart(8, "0"), rowCount: rows.length };
}
