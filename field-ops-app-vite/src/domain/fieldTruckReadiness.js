// TW4 -- the technician's OWN truck, folded into the shared Parts Readiness projection.
//
// FieldMode used to hand buildWorkOrderPartsReadiness the Work Order's plan and nothing else, so every part read
// "Truck stock isn't available for this job" even when readTruckStock was returning the truck's stock. This attaches
// the on-truck quantity as the projection's EXISTING `truck` dimension. It adds no readiness vocabulary and no
// arithmetic: deriveItemReadiness still decides READY / UNKNOWN / ATTENTION from what is KNOWN.
//
// HONESTY: stock that was not read (no truck in scope, or the read failed) attaches NOTHING -- the part stays UNKNOWN and
// the projection reports truckInventory as degraded. A part that is simply absent from a stock list that WAS read
// is on the truck zero times, which is a real answer and not a fabricated one.
//
// Pure: no React, no I/O.

/** @param {Array<object>} plannedParts the Work Order's planned rows ({ partId|sku, qtyPlanned, qtyUsed }).
 *  @param {{ known: boolean, onHand: Record<string, number> } | null} stock the technician's truck stock, summed per Part. */
export function withTruckStock(plannedParts, stock) {
  const rows = Array.isArray(plannedParts) ? plannedParts : [];
  if (!stock?.known) return rows;
  return rows.map((p) => {
    const onTruck = Number(stock.onHand?.[p.partId ?? p.sku] ?? 0);
    return { ...p, truck: { status: "KNOWN", onTruck: Number.isFinite(onTruck) && onTruck > 0 ? onTruck : 0 } };
  });
}

/** Sum the quantities of one or more readTruckStock answers into { partId -> onHand }. */
export function sumTruckStock(answers) {
  const onHand = {};
  for (const a of Array.isArray(answers) ? answers : []) {
    for (const q of Array.isArray(a?.quantities) ? a.quantities : []) {
      if (typeof q?.partId !== "string") continue;
      const n = Number(q.onHand);
      if (Number.isFinite(n)) onHand[q.partId] = (onHand[q.partId] ?? 0) + n;
    }
  }
  return onHand;
}
