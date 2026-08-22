// PART BALANCE — the shared governed read for "how much of this part is there, and what is it
// already spoken for?"
//
// ============================ NOT A SCANNER PROJECTION ============================
//
// This is a general inventory-balance read. The scanner is its first consumer, not its owner: it
// takes a partId and answers the same question any surface would ask. It creates no new inventory
// model, no new collection and no new math.
//
// ============================ THE MATH IS ALREADY RATIFIED ============================
//
// Every number here comes from fulfillment/fulfillmentAvailability.ts, whose semantics the Owner
// ratified on 2026-08-07 and amended on 2026-08-17 (ledger supersedes stock_locations):
//
//   sumLedgerEligibleOnHand  physical on-hand at ACTIVE warehouses, from the append-only ledger
//   openWorkOrderReserved    open Work Order commitments (RESERVED − RELEASED − CONSUMED)
//
// Those functions are exported and pure; this service supplies the reads and composes the result. A
// fourth parallel implementation of on-hand would be a competing authority, and this platform has
// already been bitten once by two sources of stock truth diverging in both directions.
//
// ============================ UNKNOWN IS A VALUE ============================
//
// `null` means UNKNOWN and is never coerced to 0 anywhere in this file. The distinction is
// load-bearing: "no physical movement evidence for this part at all" and "evidence exists and nets
// to zero" are different facts. The first is a data gap; the second is a real, empty shelf.
//
// ============================ SERIAL PARTS DO NOT HAVE A QUANTITY ============================
//
// sumLedgerEligibleOnHand deliberately excludes SERIAL/LOT rows from its quantity math: a serialized
// unit is counted by the serialized_assets registry, one row per unit, never by summing ledger
// quantities. Reporting the resulting figure as "on hand" for a SERIAL part would therefore show a
// confident 0 for a shelf full of units. So a SERIAL-tracked part reports NOT_COUNTED_BY_QUANTITY
// and points at the serialized registry, which is its actual authority.

import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  INVENTORY_TRANSACTIONS_COLLECTION,
  WAREHOUSES_COLLECTION,
  PURCHASE_ORDERS_COLLECTION,
} from "../constants/collections.js";
import { sumLedgerEligibleOnHand, openWorkOrderReserved } from "../fulfillment/fulfillmentAvailability.js";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed.js";
import { isSerialTracked } from "../partMaster/controlTypeTrackingMode.js";
import { buildFirestorePartRepository } from "../partMaster/partMasterRepository.js";
import type { PartId } from "../partMaster/types.js";

export const INVENTORY_BALANCE_READ_CAPABILITY = "inventory.balance.read";

/**
 * How a quantity figure should be read.
 *
 * KNOWN carries a number. UNKNOWN means the evidence to answer was missing — never zero.
 * NOT_COUNTED_BY_QUANTITY means the question does not apply to this part: its units are tracked
 * individually in the serialized registry, so a summed quantity would be a category error.
 */
export type BalanceFigureState = "KNOWN" | "UNKNOWN" | "NOT_COUNTED_BY_QUANTITY";

export interface BalanceFigure {
  readonly state: BalanceFigureState;
  readonly value: number | null;
}

/** On-hand at ONE warehouse. Same ratified function, one-warehouse eligible set. */
export interface LocationBalance {
  readonly locationId: string;
  readonly quantity: number;
}

export interface PartBalanceProjection {
  readonly partId: string;
  /** Physical stock at ACTIVE warehouses, from the ledger. Excludes truck/mobile stock by design. */
  readonly onHand: BalanceFigure;
  /** Open Work Order commitments against this part. */
  readonly reserved: BalanceFigure;
  /** onHand − reserved, floored at 0. UNKNOWN if either input is UNKNOWN. */
  readonly available: BalanceFigure;
  /** Outstanding quantity on purchase orders that can still be received. */
  readonly onOrder: BalanceFigure;
  /**
   * Where the on-hand sits, warehouse by warehouse.
   *
   * NOT new math. Each entry is the SAME sumLedgerEligibleOnHand call with a one-warehouse eligible
   * set, so a per-location figure can never disagree with the total it belongs to — they are
   * literally the same function over the same rows. Empty for a SERIAL part, whose units are located
   * individually by the serialized registry rather than by quantity at a place.
   *
   * Warehouses holding no stock are omitted: a location with nothing there is not a fact about this
   * part, and listing every warehouse in the estate would bury the ones that matter.
   */
  readonly byLocation: readonly LocationBalance[];
}

const KNOWN = (value: number): BalanceFigure => ({ state: "KNOWN", value });
const UNKNOWN: BalanceFigure = { state: "UNKNOWN", value: null };
const NOT_QUANTITY: BalanceFigure = { state: "NOT_COUNTED_BY_QUANTITY", value: null };

/**
 * Compose the projection from already-read inputs. PURE — unit-tested without an emulator.
 *
 * @param serialTracked whether the Part's control type means its units are individually tracked.
 *                      Supplied by the caller from the Part record; this service does not restate
 *                      the Part Master's own vocabulary.
 */
export function composePartBalance(input: {
  readonly partId: string;
  readonly ledgerRows: ReadonlyArray<{ type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string; workOrderId?: string }>;
  readonly eligibleWarehouseIds: ReadonlySet<string>;
  readonly openOrderedQuantity: number | null;
  readonly serialTracked: boolean;
}): PartBalanceProjection {
  const { partId, ledgerRows, eligibleWarehouseIds, openOrderedQuantity, serialTracked } = input;

  const rows = [...ledgerRows];

  // RESERVED / RELEASED / CONSUMED are LOGICAL commitments and are counted only here — never as
  // physical stock. sumLedgerEligibleOnHand already ignores them; this is the other half of that
  // same split, and keeping both halves visible in one place is why they are computed together.
  const reservedValue = openWorkOrderReserved(rows as Array<{ type: string; quantity: number; workOrderId?: string }>);
  const sawAnyCommitment = rows.some((r) => r.type === "RESERVED" || r.type === "RELEASED" || r.type === "CONSUMED");

  if (serialTracked) {
    // A serialized part has no aggregable quantity. Saying so is the honest answer; reporting the
    // ledger sum would show 0 for a shelf that is full.
    return Object.freeze({
      partId,
      onHand: NOT_QUANTITY,
      reserved: NOT_QUANTITY,
      available: NOT_QUANTITY,
      onOrder: openOrderedQuantity === null ? UNKNOWN : KNOWN(openOrderedQuantity),
      byLocation: Object.freeze([]),
    });
  }

  const onHandValue = sumLedgerEligibleOnHand(
    rows as Array<{ type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string }>,
    new Set(eligibleWarehouseIds),
  );

  const onHand = onHandValue === null ? UNKNOWN : KNOWN(onHandValue);

  // No commitment evidence at all is a known zero, not UNKNOWN: the reservation ledger is written on
  // every reservation, so its silence genuinely means "nothing is reserved". This differs from
  // on-hand, where silence means the part was never received anywhere and the shelf state is
  // genuinely unknown.
  const reserved = KNOWN(sawAnyCommitment ? reservedValue : 0);

  // UNKNOWN is INFECTIOUS. Subtracting a known reservation from an unknown on-hand cannot produce a
  // trustworthy available figure, and presenting one would be the exact "missing evidence treated as
  // zero" failure this whole service exists to avoid.
  const available = onHand.state === "KNOWN" && onHand.value !== null
    ? KNOWN(Math.max(0, onHand.value - (reserved.value ?? 0)))
    : UNKNOWN;

  // Per-warehouse, using the SAME function with a singleton eligible set. Deliberately not a
  // separate grouping pass: a second implementation could round, filter or sign differently from the
  // total, and a breakdown that does not add up to its own total is worse than no breakdown.
  const byLocation: LocationBalance[] = [];
  for (const locationId of eligibleWarehouseIds) {
    const at = sumLedgerEligibleOnHand(
      rows as Array<{ type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string }>,
      new Set([locationId]),
    );
    if (at !== null && at > 0) byLocation.push(Object.freeze({ locationId, quantity: at }));
  }
  byLocation.sort((a, b) => (b.quantity - a.quantity) || a.locationId.localeCompare(b.locationId));

  return Object.freeze({
    partId,
    onHand,
    reserved,
    available,
    onOrder: openOrderedQuantity === null ? UNKNOWN : KNOWN(openOrderedQuantity),
    byLocation: Object.freeze(byLocation),
  });
}

/**
 * Outstanding ordered quantity for a part across purchase orders that can still be received. PURE.
 *
 * Returns null (UNKNOWN) when no purchase order mentions the part at all — the same distinction the
 * on-hand rule draws. A part that appears on orders which are all fully received is a known 0.
 *
 * Reads the CANONICAL multi-line shape (Phase C) and the legacy single-line shape, because both
 * exist in stored data; neither is normalized into the other here beyond reading the two field
 * layouts, and quantities are never invented for a line that does not state one.
 */
export function sumOpenOrderedQuantity(
  purchaseOrders: ReadonlyArray<Record<string, unknown>>,
  partId: string,
): number | null {
  let saw = false;
  let outstanding = 0;

  for (const po of purchaseOrders) {
    // THREE SHAPES, ONE SOURCE EACH -- never unioned, or a purchase order carrying two of them
    // would be counted twice and silently double its outstanding quantity.
    //
    //   lines  the NORMALIZED in-memory shape (normalizeCanonicalPurchaseOrder's output). First,
    //          because a caller that already normalized has stated which lines it means.
    //   items  the CANONICAL STORED shape, written by procurementService.createPurchaseOrder.
    //   po     the legacy single-line shape, where the order itself carries partId/quantity.
    //
    // `items` was missing, and its absence was invisible. readPartBalance passes RAW stored
    // documents here, and a stored canonical purchase order has `items`; `lines` exists only
    // after normalization. So every canonical order returned null -- UNKNOWN -- and `onOrder`
    // could not see one of them. A part with 18 units inbound read exactly like a part nobody
    // had ordered, because null legitimately means "no purchase order mentions this part".
    //
    // The existing tests stayed green throughout: each hand-built `{ lines: [...] }`, a shape
    // that never occurs in storage. The arithmetic was always right; the field was never found.
    const rawLines = Array.isArray(po.lines) ? po.lines
      : Array.isArray(po.items) ? po.items
        : null;
    const lines: Array<Record<string, unknown>> = rawLines
      ? (rawLines as Array<Record<string, unknown>>)
      // Legacy single-line shape: the order itself carries partId/quantity.
      : (typeof po.partId === "string" ? [po as Record<string, unknown>] : []);

    for (const line of lines) {
      if (line.partId !== partId) continue;
      saw = true;
      const ordered = typeof line.quantity === "number" && Number.isFinite(line.quantity)
        ? line.quantity
        : (typeof line.orderedQuantity === "number" && Number.isFinite(line.orderedQuantity) ? line.orderedQuantity : null);
      if (ordered === null) continue;      // a line with no stated quantity adds nothing, never a guess
      const received = typeof line.receivedQuantity === "number" && Number.isFinite(line.receivedQuantity)
        ? line.receivedQuantity
        : 0;
      outstanding += Math.max(0, ordered - received);
    }
  }

  return saw ? outstanding : null;
}

/** Purchase order statuses whose outstanding quantity is still genuinely incoming. */
export const OPEN_PURCHASE_ORDER_STATUSES = Object.freeze(["DRAFT", "SENT", "ORDERED", "PARTIALLY_RECEIVED"]);

/**
 * Read and compose the balance for one part.
 *
 * NOT transactional: this is a read, and a balance is a point-in-time answer by nature. The
 * commands that MOVE stock re-derive their own numbers inside their own transactions and remain the
 * authority — nothing may be committed on the strength of this projection.
 */
export async function readPartBalance(
  db: Firestore,
  partId: string,
  serialTracked: boolean,
): Promise<PartBalanceProjection> {
  const [ledgerSnap, warehouseSnap, poSnap] = await Promise.all([
    db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId).get(),
    db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE").get(),
    db.collection(PURCHASE_ORDERS_COLLECTION).get(),
  ]);

  const ledgerRows = ledgerSnap.docs.map((d) => d.data() as {
    type: string; quantity: number; location?: { type?: string; locationId?: string }; trackingMode?: string; workOrderId?: string;
  });
  const eligibleWarehouseIds = new Set(warehouseSnap.docs.map((d) => d.id));

  const openOrders = poSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((po) => typeof po.status === "string" && OPEN_PURCHASE_ORDER_STATUSES.includes(po.status));

  return composePartBalance({
    partId,
    ledgerRows,
    eligibleWarehouseIds,
    openOrderedQuantity: sumOpenOrderedQuantity(openOrders, partId),
    serialTracked,
  });
}

/**
 * The trusted callable.
 *
 * Gated on `inventory.balance.read` — a NEW, narrow capability rather than a reused one.
 * `warehouse.stockLocation.read` names the stock_locations collection, which the Owner's 2026-08-17
 * ruling superseded as a stock authority; reusing it for a ledger-derived read would make it a
 * synonym for something it no longer means, and it is granted only to admin/dispatcher/owner, which
 * is the wrong audience for a warehouse balance question. `inventory.analytics.read` is a dashboard
 * projection, not a per-part answer.
 *
 * Registered `active: false` and granted to no Role: this denies for every principal until
 * activation and grant are separately authorized.
 */
export const getPartBalanceCallable = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be signed in.");

  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: request.auth.uid,
      permissionIds: [INVENTORY_BALANCE_READ_CAPABILITY],
    });
    allowed = decisions[INVENTORY_BALANCE_READ_CAPABILITY] === true;
  } catch (err) {
    // A THROWING resolver is a denial, never an allow.
    console.error(`[getPartBalance] capability resolution failed for ${INVENTORY_BALANCE_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read inventory balances.");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const partId = typeof data.partId === "string" ? data.partId.trim() : "";
  if (partId === "") throw new HttpsError("invalid-argument", "A partId is required.");

  // WHETHER A PART IS SERIAL-TRACKED IS A FACT THE SERVER OWNS, NOT A CLAIM THE CALLER MAKES.
  //
  // This previously read `data.serialTracked`, which let the CALLER decide the shape of the answer.
  // Found in sandbox validation, and it is the exact failure this whole service exists to prevent:
  //
  //   PRT-2001, which has two serialized units on the shelf at wh-main, answered
  //   { state: "KNOWN", value: 0 } when asked with serialTracked:false.
  //
  // A confident zero for a shelf that is not empty. The mirror-image error was equally reachable:
  // asking about a quantity-tracked part with serialTracked:true hid a real number behind
  // NOT_COUNTED_BY_QUANTITY.
  //
  // The Part Master's `controlType` is the authority, mapped through the SAME vocabulary receiving
  // and transfer already use (controlTypeToTrackingMode) rather than a second mapping free to
  // disagree with them.
  //
  // FAIL CLOSED ON AN UNKNOWN PART. A part nobody can resolve is not assumed quantity-tracked --
  // assuming would reintroduce the confident zero by a different route.
  try {
    const db = getFirestore();
    const stored = await buildFirestorePartRepository(db).getById(null, partId as PartId);
    if (stored === null) {
      throw new HttpsError("not-found", "That part could not be found.");
    }
    const serialTracked = isSerialTracked(stored.part.controlType);
    return await readPartBalance(db, partId, serialTracked);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[getPartBalance] read failed", err);
    throw new HttpsError("internal", "The request could not be completed.");
  }
});
