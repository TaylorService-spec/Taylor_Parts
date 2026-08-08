// A technician mission on the C713x5 coordinated install completed an INSTALL
// Work Order with its one planned part still at 0 of 1 used. The app accepted
// it silently: status flipped to Completed, and the parts count froze at 0/1
// with no way to correct it afterwards. The whole purpose of that Work Order
// was installing that part.
//
// This module answers one question -- "which planned parts are still unused?"
// -- so the completion surface can say so before the technician commits.
//
// DELIBERATELY A WARNING, NOT A GATE. The server is the completion authority
// (transitionEngine.ts); it does not require parts parity, and inventing a
// client-side block would be a workflow policy change this layer has no
// standing to make. There are real jobs that legitimately complete without
// consuming every planned part -- the part was not needed, or a substitute was
// used. The defect is not that completion is allowed; it is that it happens
// SILENTLY. So: make it visible, make it deliberate, let the technician decide.
//
// Reads the same inventorySnapshot shape the Work Order already carries
// (see workOrderInventorySnapshot). Anything unparseable is simply not
// reported -- an unknown quantity must never be rendered as a confident
// shortfall, which would be its own dishonest state.

function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Planned parts whose recorded usage falls short of the plan.
 * @returns {Array<{name: string, qtyPlanned: number, qtyUsed: number, shortfall: number}>}
 */
export function unusedPlannedParts(workOrder) {
  const snapshot = workOrder && workOrder.inventorySnapshot;
  if (!Array.isArray(snapshot)) return [];

  const short = [];
  for (const line of snapshot) {
    if (!line || typeof line !== "object") continue;
    const planned = toCount(line.qtyPlanned);
    const used = toCount(line.qtyUsed);
    // No plan, or no trustworthy usage figure -> nothing honest to claim.
    if (planned === null || planned === 0 || used === null) continue;
    if (used >= planned) continue;
    short.push({
      name: line.name || line.sku || line.partId || "Unnamed part",
      qtyPlanned: planned,
      qtyUsed: used,
      shortfall: planned - used,
    });
  }
  return short;
}

/** One line of plain copy for the confirmation, or null when nothing is short. */
export function unusedPlannedPartsMessage(workOrder) {
  const short = unusedPlannedParts(workOrder);
  if (short.length === 0) return null;
  const parts = short.map((p) => `${p.name} (${p.qtyUsed} of ${p.qtyPlanned} used)`).join(", ");
  return short.length === 1
    ? `A planned part has not been recorded as used: ${parts}. Complete anyway?`
    : `${short.length} planned parts have not been fully recorded as used: ${parts}. Complete anyway?`;
}
