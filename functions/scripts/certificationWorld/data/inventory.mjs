// TRUCKS, PARTS-ROOM STOCK, AND THE SIX INVENTORY STATES.
//
// Built on the EXISTING 200-part catalog (functions/src/data/partsCatalog.ts, TST-1001..TST-1200),
// not a parallel one. Those are the parts this business actually stocks -- hopper agitators, syrup
// pumps, freezer cylinders, auger shafts -- and they already carry the reorderThreshold the reorder
// analytics read. Inventing a second catalog to certify against would certify the invention.
//
// ============================ WHY SIX STATES AND NOT THREE ============================
//
// HEALTHY / WATCH / REORDER / CRITICAL are the obvious ladder. The two that matter more:
//
//   ON_ORDER       below its reorder point WITH a purchase order already covering it. The correct
//                  answer to "what do I need to buy" excludes these, and a system that lists them
//                  anyway sends someone to order stock twice.
//
//   FALSE_COMFORT  the warehouse TOTAL looks adequate, and the parts room is not. The units are real
//                  but they are on trucks or committed to open work orders. This is the fixture that
//                  separates a system reporting POSITION from one reporting AVAILABILITY, and it is
//                  the state most likely to be silently wrong -- which is exactly why it is here.
export const INVENTORY_STATE = Object.freeze({
  HEALTHY: "HEALTHY",
  WATCH: "WATCH",
  REORDER: "REORDER",
  // KNOWN ZERO: governed evidence exists and it establishes zero on the shelf.
  CRITICAL: "CRITICAL",
  // ============================ UNOBSERVED IS NOT ZERO ============================
  //
  // Owner ruling CERT-PURCH-UNKNOWN-07. A part with NO governed ledger observation has not been
  // measured at zero -- it has not been measured. readPartBalance says exactly that: it returns
  // UNKNOWN when `sawAnyPhysical` is false, and a KNOWN 0 only when evidence exists and nets to
  // zero. The fixture used to call these parts CRITICAL, which is a claim about a physical
  // balance, while the product correctly answered "we have never observed this part."
  //
  // The two states must not be collapsed:
  //   UNOBSERVED  no governed physical observation exists      -> readPartBalance UNKNOWN
  //   CRITICAL    governed evidence establishes zero            -> readPartBalance KNOWN 0
  //
  // This is why an UNOBSERVED part emits NO ledger movement. That is not an omission to be
  // repaired with a synthetic COUNTED 0, a zero-variance count, or an ADJUSTED 0 -- all three were
  // considered and all three are prohibited, because manufacturing evidence to satisfy a label is
  // how a fixture starts lying about what it contains.
  UNOBSERVED: "UNOBSERVED",
  ON_ORDER: "ON_ORDER",
  FALSE_COMFORT: "FALSE_COMFORT",
});

// Exactly five, per the approved program. Trucks are MOBILE inventory locations in this model
// (Equipment Custody / ADR-010), never a separate custody concept.
export const CERT_TRUCKS = Object.freeze([
  { id: "cert-trk-01", displayLabel: "Truck 101 - North Valley", homeWarehouseId: "wh-main", active: true },
  { id: "cert-trk-02", displayLabel: "Truck 102 - East Valley", homeWarehouseId: "wh-main", active: true },
  { id: "cert-trk-03", displayLabel: "Truck 103 - West Valley", homeWarehouseId: "wh-main", active: true },
  { id: "cert-trk-04", displayLabel: "Truck 104 - Central Phoenix", homeWarehouseId: "wh-main", active: true },
  { id: "cert-trk-05", displayLabel: "Truck 105 - Southeast Valley", homeWarehouseId: "wh-main", active: true },
]);

/**
 * Assign each catalog part a certification state, deterministically by index.
 *
 * Index-derived so the same version always produces the same world: a diff between two seeds is a
 * real change, never scheduling noise. The proportions are chosen to look like a real parts room --
 * mostly fine, a meaningful minority needing attention -- rather than an even split that would make
 * every queue the same size and hide ordering defects.
 */
export function stateForIndex(i) {
  const m = i % 20;
  // Was CRITICAL. These parts carry no ledger movement at all, so what they actually demonstrate
  // is the UNOBSERVED case -- the honest starting point of the Golden first-stocking scenario.
  if (m === 0) return INVENTORY_STATE.UNOBSERVED;      //  5%
  if (m === 1 || m === 2) return INVENTORY_STATE.REORDER;      // 10%
  if (m === 3) return INVENTORY_STATE.ON_ORDER;        //  5%
  if (m === 4) return INVENTORY_STATE.FALSE_COMFORT;   //  5%
  if (m <= 8) return INVENTORY_STATE.WATCH;            // 20%
  return INVENTORY_STATE.HEALTHY;                      // 55%
}

/**
 * Parts-room quantity for a part in a given state.
 *
 * `reorderPoint` comes from the catalog, so these are positions RELATIVE to the part's own threshold
 * rather than absolute numbers that would mean different things for a gasket and a compressor.
 */
export function partsRoomQtyFor(state, reorderPoint) {
  const rp = Math.max(1, reorderPoint);
  switch (state) {
    case INVENTORY_STATE.CRITICAL: return 0;
    // Nothing on the shelf AND nothing recorded. Same zero, different reason -- see INVENTORY_STATE.
    case INVENTORY_STATE.UNOBSERVED: return 0;
    case INVENTORY_STATE.REORDER: return Math.max(0, rp - 1);
    case INVENTORY_STATE.ON_ORDER: return Math.max(0, rp - 1);
    // Sits just above the line: genuinely fine today, the first thing to tip tomorrow.
    case INVENTORY_STATE.WATCH: return rp + 1;
    // Comfortable ONLY in total. The truck allocation below removes most of it from the parts room,
    // which is what makes the state false rather than merely tight.
    case INVENTORY_STATE.FALSE_COMFORT: return rp * 4;
    default: return rp * 6 + 10;
  }
}

/** Truck allocation for a part, or 0. Deterministic; trucks carry the fast-moving service parts. */
export function truckAllocationFor(state, index, truckIndex) {
  if (state === INVENTORY_STATE.CRITICAL) return 0;
  if (state === INVENTORY_STATE.UNOBSERVED) return 0;
  // FALSE_COMFORT is the point of the fixture: the stock exists, but it is on the trucks.
  if (state === INVENTORY_STATE.FALSE_COMFORT) return 3;
  if (index % 4 === truckIndex % 4) return 2;
  if (index % 7 === 0) return 1;
  return 0;
}

// The parts room must be able to FUND the truck allocations and still show measurable depletion --
// otherwise "stock the trucks" either fails or leaves no trace, and neither certifies anything.
export const PARTS_ROOM_INFLATION_MULTIPLIER = 3;
