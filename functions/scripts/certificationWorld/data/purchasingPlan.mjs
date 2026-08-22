// THE PURCHASING PLAN — canonical Purchase Orders that make ON_ORDER derivable.
//
// ============================ WHY THESE POs EXIST ============================
//
// After Pass 1, ON_ORDER was honestly ZERO. Nothing in the world could make a shortage ON_ORDER,
// because an ON_ORDER part is indistinguishable from a REORDER part by inspection of the ledger
// alone -- the difference is INBOUND SUPPLY, and no purchasing state existed.
//
// The pure plan only ever produced ON_ORDER because it was TOLD the answer: deriveCondition was
// handed `hasInboundPo` from the fixture's own intent. That is circular. These orders replace the
// hint with a fact.
//
// ============================ STATUS IS "SENT", AND THAT IS NOT ARBITRARY ============================
//
// Two independent allowlists govern a purchase order and they are not the same list:
//
//   RECEIVABLE      APPROVED, SENT                            (receivingSourceResolver)
//   COUNTS INBOUND  DRAFT, SENT, ORDERED, PARTIALLY_RECEIVED  (partBalanceReadService)
//
// Their intersection is exactly one value. APPROVED is the natural-sounding choice and would
// receive perfectly while NEVER producing ON_ORDER, because nothing counts it as incoming.
//
// SENT also survives the whole lifecycle: a partial receipt deliberately leaves the stored status
// SENT (partial progress is derived from receipts, never persisted), and only a complete receipt
// moves it to RECEIVED. One status carries shortage -> partial -> recovery.
//
// See certificationPurchasingContract.test.mjs, which holds this as a mutation-proven regression.
//
// ============================ NO ID IS INVENTED HERE ============================
//
// createPurchaseOrder assigns its own document id and takes no idempotency key -- unlike the ledger,
// where the key IS the identity. So the plan cannot name a PO id, and the applier makes itself
// idempotent by MATCHING ON CONTENT before creating. The fixture owns the intent; the writer owns
// the identity.
import { CERT_PARTS, reorderPointFor } from "./partsCatalog.mjs";
import { INVENTORY_STATE, stateForIndex } from "./inventory.mjs";

/** The supplier every certification order is placed with. Synthetic. */
export const CERT_SUPPLIER_ID = "cw-sup-001";

/**
 * Buyers, chosen by RESOLVED CAPABILITY -- never by job title.
 *
 * An earlier version of this list named cw-emp-035/036 and called them buyers. They are
 * salespeople who hold no purchasing capability whatsoever. The fixture asserted that the buyers
 * and receivers were disjoint, and they were -- the check compared two arrays of strings and
 * never once asked what authority those people actually had. Both lists were wrong while the
 * assertion stayed green.
 *
 * These two resolve reorder.purchaseOrder.create through active roleAssignments. The applier
 * re-proves that against live authority before it writes anything, rather than trusting this
 * comment to stay true.
 */
export const CERT_BUYERS = Object.freeze(["cw-emp-001", "cw-emp-002"]);

/**
 * Receivers, likewise resolved rather than assumed.
 *
 * The previous choice -- put-away operators -- was the exact conflation the capability exists to
 * prevent. inventory.stock.receive is "a station, not a job title... rather than being available
 * to everyone who works in a warehouse". Moving stock within a warehouse is not accepting it into
 * the company's custody.
 *
 * cw-emp-000 is excluded on purpose: the owner role composes BOTH capabilities, so an owner actor
 * could never demonstrate separation no matter which side of it he stood on.
 */
export const CERT_RECEIVERS = Object.freeze(["cw-emp-044", "cw-emp-045"]);

/** A plausible synthetic unit price. Deterministic; never zero, which the writer rejects. */
export function unitPriceFor(part) {
  return 10 + (part.index % 40) * 2.5;
}

/**
 * The orders the world needs.
 *
 * `intent` is fixture vocabulary and is never persisted -- it explains WHY an order exists so a
 * reader is not left inferring purpose from quantities.
 */
export function buildPurchasingPlan() {
  const orders = [];

  // ── The two ON_ORDER parts. This is the whole point of the pass.
  //
  // Quantity is chosen to close the shortfall and no more: an order large enough to make the part
  // HEALTHY on arrival would prove nothing about ON_ORDER, since the interesting state is
  // "still short, but supply is coming".
  const onOrderParts = CERT_PARTS.filter((p) => stateForIndex(p.index) === INVENTORY_STATE.ON_ORDER);
  for (const part of onOrderParts) {
    orders.push({
      intent: "ON_ORDER_RECOVERY",
      supplierId: CERT_SUPPLIER_ID,
      buyerEmployeeId: CERT_BUYERS[part.index % CERT_BUYERS.length],
      items: [{ partId: part.partId, quantity: reorderPointFor(part) * 2, unitPrice: unitPriceFor(part) }],
    });
  }

  // ── The Golden inbound-recovery order: shortage -> PO -> partial -> complete -> fulfillable.
  //
  // Placed against a CRITICAL part, because a recovery that starts from "some stock" cannot show
  // the transition from unfulfillable to fulfillable.
  const critical = CERT_PARTS.filter((p) => stateForIndex(p.index) === INVENTORY_STATE.CRITICAL
    && p.ledgerTrackingMode !== "SERIAL");
  if (critical.length) {
    const part = critical[0];
    orders.push({
      intent: "GOLDEN_INBOUND_RECOVERY",
      supplierId: CERT_SUPPLIER_ID,
      buyerEmployeeId: CERT_BUYERS[0],
      // Deliberately even, so a partial receipt can be exactly half and the arithmetic is legible.
      items: [{ partId: part.partId, quantity: 20, unitPrice: unitPriceFor(part) }],
    });
  }

  // ── An order unrelated to any current shortage.
  //
  // Without one, every inbound quantity in the world would answer some WO's problem, and a report
  // asking "what is on order that nobody is waiting for" would have no case to find.
  const healthy = CERT_PARTS.filter((p) => stateForIndex(p.index) === INVENTORY_STATE.HEALTHY
    && p.ledgerTrackingMode !== "SERIAL");
  if (healthy.length) {
    orders.push({
      intent: "ROUTINE_REPLENISHMENT",
      supplierId: CERT_SUPPLIER_ID,
      buyerEmployeeId: CERT_BUYERS[1],
      items: [{ partId: healthy[0].partId, quantity: 12, unitPrice: unitPriceFor(healthy[0]) }],
    });
  }

  // ── The APPROVED trap, kept as a LIVE fixture rather than only a unit test.
  //
  // An otherwise identical order that stops at APPROVED. It is receivable and contributes NOTHING
  // to inbound, so its part must not read ON_ORDER. A future author who "fixes" the inbound
  // allowlist by adding APPROVED will see this part's classification change, in real data.
  const reorderParts = CERT_PARTS.filter((p) => stateForIndex(p.index) === INVENTORY_STATE.REORDER
    && p.ledgerTrackingMode !== "SERIAL");
  if (reorderParts.length) {
    orders.push({
      intent: "APPROVED_TRAP_NOT_INBOUND",
      stopAtStatus: "APPROVED",
      supplierId: CERT_SUPPLIER_ID,
      buyerEmployeeId: CERT_BUYERS[0],
      items: [{ partId: reorderParts[0].partId, quantity: 15, unitPrice: unitPriceFor(reorderParts[0]) }],
    });
  }

  return orders;
}

/**
 * Content signature used to recognise an order that already exists.
 *
 * createPurchaseOrder takes no idempotency key, so re-running the applier would otherwise create a
 * second identical order and silently double the inbound quantity -- which would change every
 * ON_ORDER figure without changing a single fixture.
 */
export function orderSignature(order) {
  const lines = [...order.items]
    .map((i) => `${i.partId}:${i.quantity}`)
    .sort()
    .join(",");
  return `${order.supplierId}|${lines}`;
}
