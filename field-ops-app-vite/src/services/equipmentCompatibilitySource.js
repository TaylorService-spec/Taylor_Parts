// D6 — the EquipmentCompatibilitySource seam (package §5, OD-F).
//
// An EquipmentCompatibilitySource resolves the D5 read CONTRACT for a Part, or a discriminated error
// mirroring services/partMasterQueries.js:
//   readForPart({ partId, cursor, limit }) =>
//     Promise<{ ok: true, response: CompatibilityReadResponse } | { ok: false, code: "permission-denied" | "unavailable" }>
//
// D6 ships ONLY the INERT PLACEHOLDER binding below. The D5 read callable
// (functions/src/equipmentCompatibility/equipmentCompatibilityReadCallable.ts) is UNEXPORTED and
// undeployed (repository-only), so there is NO backend for the client to call; and because
// equipment.compatibility.view is active:false, the section is hidden and never reaches this source in
// the running app. This placeholder therefore performs NO network/Firebase call and always resolves a
// safe "unavailable" (never "none"/EMPTY). The real onCall-backed binding is a D10 deliverable, wired
// only after the callable is exported and deployed.
export const inertEquipmentCompatibilitySource = Object.freeze({
  async readForPart() {
    // No backend exists in D6. Fail closed to a transient-unavailable; never fabricate data or an EMPTY.
    return { ok: false, code: "unavailable" };
  },
});
