// THE MOVEMENT PLAN — how every balance in the Certification World comes to exist.
//
// ============================ NO BALANCE IS EVER SEEDED ============================
//
// On this schema the LEDGER IS THE BALANCE. `fulfillmentAvailability` counts movements at eligible
// WAREHOUSE locations, and a truck has "NO MOBILE-indexed stock document separate from the ledger"
// -- its parts stock is PROVABLY CO-EXTENSIVE with its ledger events
// (truckRegistry/operationalReferenceProbe.ts).
//
// So this file emits MOVEMENTS, not quantities. Every number a screen shows is the consequence of a
// movement that a governed command validated, fingerprinted and made idempotent. Writing a quantity
// directly would produce a world the product itself could not have created -- a fixture more
// authoritative than the system it exists to test.
//
// ============================ WHY FALSE_COMFORT WORKS WITHOUT A TRICK ============================
//
// Warehouse availability deliberately excludes MOBILE stock: "real inventory, but it is not sellable
// warehouse stock" (fulfillment/fulfillmentAvailability.ts). So a part whose units sit on trucks is
// company-owned and warehouse-unfulfillable AS A CONSEQUENCE of where its movements put it.
//
// FALSE_COMFORT is therefore not a label and not a staged number. It is what the system already
// believes about a part in that position, and the fixture's job is only to put it there.
//
// ============================ IDEMPOTENCY IS DERIVED, NEVER STAMPED ============================
//
// Every key is a pure function of (purpose, part, location, sequence). No clock, no counter, no
// random suffix -- so replaying the plan is a genuine replay the ledger recognises rather than a
// second movement wearing a new key. That is the property `stageOperationalMovement` enforces, and a
// timestamped key would defeat it silently.
import { CERT_PARTS, reorderPointFor } from "./partsCatalog.mjs";
import { CERT_TRUCKS, INVENTORY_STATE, stateForIndex } from "./inventory.mjs";

/** The one eligible warehouse the certification world stocks. */
export const CERT_WAREHOUSE_ID = "wh-main";

/** Pinned business time; mirrors build.mjs's EPOCH so movements never drift. */
const EPOCH = Date.parse("2026-01-05T09:00:00.000Z");
const DAY = 86400000;

/**
 * TRUCK PROFILES — five trucks that behave differently, not five samples of one truck.
 *
 * `carries` decides which part families each truck stocks, and `depth` how many units. Together they
 * make cross-truck availability a real question: a part may be absent from the nearest truck and
 * present on another, which is the scenario a single uniform profile cannot produce.
 *
 * These are FIXTURE INTENT. Nothing is persisted as a "profile" field -- the domain has no such
 * concept, and inventing one to label a scenario would put fixture vocabulary into the schema.
 */
export const TRUCK_PROFILES = Object.freeze([
  { truckId: CERT_TRUCKS[0].id, intent: "GENERAL_SERVICE", carries: ["REFRIG", "SEAL", "CTRL", "CONSUM"], depth: 3 },
  { truckId: CERT_TRUCKS[1].id, intent: "TAYLOR_HEAVY", carries: ["DRIVE", "SEAL", "REFRIG"], depth: 4 },
  { truckId: CERT_TRUCKS[2].id, intent: "VENTANA_HEAVY", carries: ["ICE", "REFRIG", "SEAL"], depth: 4 },
  // Deliberately thin. A fleet where every truck is well stocked cannot show a technician arriving
  // without the part.
  { truckId: CERT_TRUCKS[3].id, intent: "CONSTRAINED", carries: ["CONSUM"], depth: 1 },
  { truckId: CERT_TRUCKS[4].id, intent: "SPECIALTY", carries: ["CTRL", "ICE"], depth: 2 },
]);

/**
 * The warehouse position each condition REQUIRES once the trucks have been stocked.
 *
 * Stated as the END state rather than as a receipt, because the condition is defined by where the
 * warehouse ends up -- not by how much arrived. The receipt is then derived from this plus whatever
 * leaves for the trucks, which is what keeps a transfer from quietly pushing a warehouse below the
 * level its own condition depends on.
 *
 * An earlier version got this backwards: it fixed the receipt and let allocations drain whatever
 * they liked. Three parts went NEGATIVE, seven WATCH parts became FALSE_COMFORT because their stock
 * had left for the trucks, and not one part derived HEALTHY. The plan was internally inconsistent
 * and the derivation check is what said so.
 */
export function intendedWarehouseAfterFor(part) {
  const rp = reorderPointFor(part);
  switch (stateForIndex(part.index)) {
    case INVENTORY_STATE.HEALTHY: return rp * 3;              // comfortably above threshold
    case INVENTORY_STATE.WATCH: return rp + 1;                // just above: attention, not action
    case INVENTORY_STATE.REORDER: return Math.max(1, rp - 1); // below: replenishment due
    case INVENTORY_STATE.ON_ORDER: return Math.max(1, rp - 1); // same shortfall; a PO is the difference
    case INVENTORY_STATE.CRITICAL: return 0;                  // nothing on the shelf
    // Deliberately BELOW the threshold while the company total stays high. The warehouse cannot
    // fulfil, and the abundance elsewhere is exactly what makes that deceptive.
    case INVENTORY_STATE.FALSE_COMFORT: return Math.max(0, rp - 2);
    default: return rp * 3;
  }
}

/**
 * How many units of a part move out to a given truck.
 *
 * Independent of the receipt: allocation is decided first, then the receipt is sized to cover it.
 * Only conditions that can SPARE stock allocate -- deepening a genuine shortage to fill a truck
 * would make REORDER and CRITICAL indistinguishable from FALSE_COMFORT.
 */
export function truckAllocationFor(part, profile) {
  if (!profile.carries.includes(part.family)) return 0;
  // SERIAL-tracked parts are excluded from quantity allocation: a SERIAL unit is exactly one item
  // tracked individually, never aggregable quantity math (fulfillmentAvailability's H7 fix).
  if (part.trackingMode === "SERIAL") return 0;

  const state = stateForIndex(part.index);
  const rp = reorderPointFor(part);
  // A real shortage stays a real shortage. Nothing to spare.
  if (state === INVENTORY_STATE.CRITICAL) return 0;
  if (state === INVENTORY_STATE.REORDER) return 0;
  if (state === INVENTORY_STATE.ON_ORDER) return 0;
  // The whole point: enough units sit on trucks that the company looks well supplied.
  if (state === INVENTORY_STATE.FALSE_COMFORT) return rp + 2;
  return Math.min(profile.depth, 1 + (part.index % Math.max(1, profile.depth)));
}

/**
 * What the warehouse must RECEIVE: the position its condition requires, plus everything that
 * subsequently leaves for the trucks.
 *
 * Derived rather than declared, so a warehouse can never be asked to ship stock it never received.
 */
export function warehouseReceiptFor(part) {
  const allocated = carriersOf(part).reduce((sum, profile) => sum + truckAllocationFor(part, profile), 0);
  return intendedWarehouseAfterFor(part) + allocated;
}

/** Trucks whose profile carries this part's family. */
export function carriersOf(part) {
  return TRUCK_PROFILES.filter((p) => p.carries.includes(part.family));
}

/** Deterministic idempotency key. Pure function of intent -- never of the clock. */
export function movementKey({ purpose, partId, locationId, seq = 0 }) {
  return `cw_${purpose}_${partId}_${locationId}_${seq}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

const actor = Object.freeze({ kind: "SYSTEM", id: "certification-world" });

/**
 * The full movement plan: every event needed to bring the world's inventory into being.
 *
 * PURE. Returns descriptors; writes nothing. The applier feeds these to stageOperationalMovement,
 * which is what validates and records them -- this function has no authority of its own and must
 * not acquire any.
 */
export function buildInventoryPlan() {
  const movements = [];

  for (const part of CERT_PARTS) {
    const receipt = warehouseReceiptFor(part);
    if (receipt > 0) {
      movements.push({
        purpose: "seed_receipt",
        type: "RECEIVED",
        direction: "IN",
        partId: part.partId,
        trackingMode: part.trackingMode,
        location: { type: "WAREHOUSE", locationId: CERT_WAREHOUSE_ID },
        quantity: receipt,
        sourceObject: { type: "RECEIVING_ORDER", id: `cw-seed-${part.partId}` },
        idempotencyKey: movementKey({ purpose: "seed", partId: part.partId, locationId: CERT_WAREHOUSE_ID }),
        actor,
        occurredAt: EPOCH - 30 * DAY,
      });
    }

    // Then the outbound legs to the trucks. TRANSFER_OUT at the warehouse and TRANSFER_IN at the
    // truck are SEPARATE movements at separate locations -- the same way the Transfer command emits
    // them -- because that is what makes warehouse and mobile balances independently derivable.
    for (const profile of carriersOf(part)) {
      const qty = truckAllocationFor(part, profile);
      if (qty <= 0) continue;
      const seq = TRUCK_PROFILES.indexOf(profile);
      movements.push({
        purpose: "stock_truck_out",
        type: "TRANSFER_OUT", direction: "OUT",
        partId: part.partId, trackingMode: part.trackingMode,
        location: { type: "WAREHOUSE", locationId: CERT_WAREHOUSE_ID },
        counterpartyLocation: { type: "MOBILE", locationId: profile.truckId },
        quantity: qty,
        sourceObject: { type: "TRANSFER_ORDER", id: `cw-xfer-${part.partId}-${profile.truckId}` },
        idempotencyKey: movementKey({ purpose: "xout", partId: part.partId, locationId: profile.truckId, seq }),
        actor,
        occurredAt: EPOCH - 20 * DAY,
      });
      movements.push({
        purpose: "stock_truck_in",
        type: "TRANSFER_IN", direction: "IN",
        partId: part.partId, trackingMode: part.trackingMode,
        location: { type: "MOBILE", locationId: profile.truckId },
        counterpartyLocation: { type: "WAREHOUSE", locationId: CERT_WAREHOUSE_ID },
        quantity: qty,
        sourceObject: { type: "TRANSFER_ORDER", id: `cw-xfer-${part.partId}-${profile.truckId}` },
        idempotencyKey: movementKey({ purpose: "xin", partId: part.partId, locationId: profile.truckId, seq }),
        actor,
        occurredAt: EPOCH - 20 * DAY,
      });
    }
  }

  return movements;
}

/**
 * Balances implied by a plan, computed the way the domain computes them.
 *
 * WAREHOUSE availability counts only WAREHOUSE-located movements; MOBILE is excluded, exactly as
 * fulfillmentAvailability does. Company total counts everything. The gap between the two is what
 * FALSE_COMFORT names.
 */
export function projectBalances(movements) {
  const warehouse = new Map();
  const truck = new Map();
  const company = new Map();
  const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);

  for (const mv of movements) {
    const signed = mv.direction === "IN" ? mv.quantity : -mv.quantity;
    bump(company, mv.partId, signed);
    if (mv.location.type === "WAREHOUSE") bump(warehouse, mv.partId, signed);
    if (mv.location.type === "MOBILE") {
      bump(truck, mv.partId, signed);
      bump(truck, `${mv.partId}@${mv.location.locationId}`, signed);
    }
  }
  return { warehouse, truck, company };
}

/**
 * The condition the DOMAIN FACTS produce for a part.
 *
 * Derived from the projected balances rather than read from a fixture field, so a disagreement
 * between the intended condition and the computed one is a real finding. A fixture that persisted
 * its own answer could never disagree with itself, and would prove nothing.
 */
export function deriveCondition(part, balances, { hasInboundPo = false } = {}) {
  const rp = reorderPointFor(part);
  const wh = balances.warehouse.get(part.partId) ?? 0;
  const total = balances.company.get(part.partId) ?? 0;

  // FALSE_COMFORT first: it is the only condition defined by a RELATIONSHIP between two figures
  // rather than by one figure against a threshold. Checking it after the others would let a part
  // with plenty of company stock and an empty warehouse be reported as merely CRITICAL, which is
  // the exact misreading the condition exists to prevent.
  if (total > rp && wh < rp) return INVENTORY_STATE.FALSE_COMFORT;
  if (wh === 0) return INVENTORY_STATE.CRITICAL;
  if (wh < rp) return hasInboundPo ? INVENTORY_STATE.ON_ORDER : INVENTORY_STATE.REORDER;
  if (wh <= rp + 2) return INVENTORY_STATE.WATCH;
  return INVENTORY_STATE.HEALTHY;
}
