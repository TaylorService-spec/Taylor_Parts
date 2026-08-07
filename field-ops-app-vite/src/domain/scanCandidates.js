/**
 * F2 — assembling the candidate set a scan may resolve against.
 *
 * `resolveScannedIdentity` is pure and matches only what it is given. This
 * module decides WHAT IT IS GIVEN, and that decision is an authorization
 * decision in disguise — so it is made explicitly here rather than by whichever
 * component happens to hold some data.
 *
 * THE GOVERNING FACT (firestore.rules, verified):
 *   parts            read: admin/dispatcher OR PARTS_MANAGER OR WAREHOUSE_MANAGER
 *   stock_locations  read: admin/dispatcher OR isAssignedToWarehouse(...)
 *   equipment        read: admin/dispatcher only
 *   fieldops_wos     read: admin/dispatcher OR the ASSIGNED technician
 *
 * So a pure technician cannot read the Part Master, the equipment register, or
 * stock locations. They CAN read their own assigned Work Orders — including
 * each Work Order's `inventorySnapshot`, which carries the planned partId/sku.
 *
 * That is not a limitation to work around; it is the correct scope. The field
 * question is "is this the part for the job I am on?", and the answer is
 * derivable entirely from work the technician is already authorised to see.
 * Widening Rules so a scanner could search the whole catalog would be exactly
 * the authority expansion F2 is forbidden to make.
 *
 * HONEST FAILURE. When a technician scans something outside their assigned
 * work, the resolver reports NOT_FOUND — correctly, because it was not in the
 * candidate set. The caller knows the set was SCOPED, so the experience must
 * say "not part of your assigned work" rather than "this does not exist".
 * `scope` is returned for exactly that purpose. A denial is still never
 * rendered as an absence.
 */

/** How the candidate set was bounded — drives honest "not found" copy. */
export const CANDIDATE_SCOPE = Object.freeze({
  ASSIGNED_WORK: "ASSIGNED_WORK", // only the caller's own assigned Work Orders
  CATALOG: "CATALOG",             // the governed Part Master was readable
});

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Planned parts across the caller's own Work Orders, de-duplicated by partId.
 * Reads nothing: `workOrders` are already-authorised documents.
 */
export function plannedPartsFromWorkOrders(workOrders = []) {
  const byId = new Map();
  for (const wo of workOrders) {
    for (const row of wo?.inventorySnapshot ?? []) {
      const partId = isNonEmptyString(row?.partId) ? row.partId : (isNonEmptyString(row?.sku) ? row.sku : null);
      if (!partId || byId.has(partId)) continue;
      byId.set(partId, { partId, sku: isNonEmptyString(row?.sku) ? row.sku : partId });
    }
  }
  return [...byId.values()];
}

/**
 * Build the candidate set for a scan.
 *
 * `catalogParts` is passed ONLY when the caller could actually read the Part
 * Master under its own authority. When it is absent the set narrows to the
 * caller's assigned work — the scanner never reaches for data the caller
 * cannot see, and this module never performs a read itself.
 */
export function buildScanCandidates({ workOrders = [], catalogParts = null } = {}) {
  const hasCatalog = Array.isArray(catalogParts);
  const parts = hasCatalog
    ? catalogParts
        .filter((p) => isNonEmptyString(p?.partId) || isNonEmptyString(p?.sku))
        .map((p) => ({ partId: p.partId ?? p.sku, sku: p.sku ?? p.partId }))
    : plannedPartsFromWorkOrders(workOrders);

  return {
    scope: hasCatalog ? CANDIDATE_SCOPE.CATALOG : CANDIDATE_SCOPE.ASSIGNED_WORK,
    parts,
    // A technician may scan the Work Order they are standing in front of.
    workOrders: workOrders
      .filter((w) => isNonEmptyString(w?.id) || isNonEmptyString(w?.woNumber))
      .map((w) => ({ id: w.id ?? null, woNumber: w.woNumber ?? null })),
    // Deliberately empty unless the caller supplies them from an authorised
    // read: equipment and stock locations are not technician-readable, and a
    // scanner must not imply otherwise.
    serializedAssets: [],
    locations: [],
    equipment: [],
  };
}

/**
 * The honest "we didn't find it" message for a given scope. Never claims the
 * entity does not exist when the search was bounded.
 */
export function notFoundReason(scope) {
  return scope === CANDIDATE_SCOPE.CATALOG
    ? "No governed record matches that code."
    : "That code isn't part of your assigned work.";
}
