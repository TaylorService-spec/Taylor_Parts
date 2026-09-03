// The bridge between "a technician recorded usage" and "stock left a governed location".
//
// It performs the READS the resolution needs and returns the movements to STAGE — it never writes.
// That split is deliberate: `updateWorkOrderExecutionData` owns one transaction with a strict
// reads-before-writes discipline, and a helper that wrote directly would either break that ordering
// or hide it. Here the caller keeps both the ordering and the commit.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { InventorySnapshotItem } from "../types/workOrder.js";
import type { QtyUsedDelta } from "../workOrderExecutionMath.js";
import { resolveConsumptionSource, CONSUMPTION_SOURCE_MESSAGE, type GovernedLocation } from "./consumptionSource.js";
import {
  buildConsumptionMovement,
  outstandingConsumptionByLocation,
  planConsumptionCorrection,
  WORK_ORDER_CONSUMPTION_TYPE,
} from "./consumptionMovement.js";
import {
  readActiveWarehouses,
  readAssignedMobileLocation,
  readPlacementsForWorkOrder,
} from "./consumptionSourceService.js";
import { INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";

export interface PlanInput {
  readonly workOrderId: string;
  readonly actorId: string;
  readonly technicianId: string;
  readonly snapshot: readonly InventorySnapshotItem[];
  readonly qtyUsedUpdates: readonly QtyUsedDelta[];
  readonly consumptionSources: ReadonlyArray<{ sku?: unknown; locationId?: unknown }>;
  readonly occurredAt: number;
  readonly commandKey: string;
}

/** Prior physical consumption for this Work Order, used to target corrections at the original source. */
async function readPriorConsumption(tx: Transaction, db: Firestore, workOrderId: string) {
  const snap = await tx.get(
    db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("sourceObject.id", "==", workOrderId),
  );
  return snap.docs.map((d) => d.data() ?? {}).filter((r) => r.type === WORK_ORDER_CONSUMPTION_TYPE);
}

/**
 * Decide every physical movement this execution update implies.
 *
 * POSITIVE delta → resolve a governed source, or REFUSE.
 * NEGATIVE delta → reverse against the original lineage. No source is asked for, and none is accepted.
 */
export async function planPhysicalConsumption(
  tx: Transaction,
  db: Firestore,
  input: PlanInput,
): Promise<Array<{ event: Record<string, unknown>; part: { partId: string; trackingMode: string } }>> {
  const positives = input.qtyUsedUpdates.filter((u) => u.delta > 0);
  const negatives = input.qtyUsedUpdates.filter((u) => u.delta < 0);
  if (positives.length === 0 && negatives.length === 0) return [];

  // ALL READS FIRST — the enclosing transaction has not written yet, and must not while these run.
  const priorRows = await readPriorConsumption(tx, db, input.workOrderId);
  const needsSourceResolution = positives.length > 0;
  const [warehouses, mobileResult, placements] = needsSourceResolution
    ? await Promise.all([
        readActiveWarehouses(db, tx),
        readAssignedMobileLocation(db, input.technicianId, tx),
        readPlacementsForWorkOrder(db, input.workOrderId, tx),
      ])
    : [[], { mobile: null, ambiguous: false }, []];

  // The permitted set, re-derived at SUBMIT. A stale picker option is not authority: a warehouse
  // deactivated between render and submit is refused here, not honoured because it was offered.
  const governedLocations: GovernedLocation[] = [
    ...warehouses.map((w) => ({ type: "WAREHOUSE", locationId: w.warehouseId })),
    ...(mobileResult.mobile === null ? [] : [{ type: "MOBILE", locationId: mobileResult.mobile.locationId }]),
  ];
  const explicitBySku = new Map<string, string>();
  for (const entry of input.consumptionSources ?? []) {
    const sku = typeof entry?.sku === "string" ? entry.sku : null;
    const locationId = typeof entry?.locationId === "string" ? entry.locationId : null;
    if (sku !== null && locationId !== null) explicitBySku.set(sku, locationId);
  }

  // Each movement travels WITH its Part authority: the validator takes trackingMode from the Part,
  // never from the event, so the two must arrive together.
  const movements: Array<{ event: Record<string, unknown>; part: { partId: string; trackingMode: string } }> = [];

  // ---------------------------------------------------------------- POSITIVE: stock leaves
  for (const update of positives) {
    const item = input.snapshot.find((i) => i.sku === update.sku);
    const partId = item?.partId ?? update.sku;
    const trackingMode = "NONE"; // SERIAL usage has no serial identity in this workflow — see below.
    const resolved = resolveConsumptionSource({
      workOrderId: input.workOrderId,
      partId,
      requestedQuantity: update.delta,
      trackingMode,
      explicitSourceLocationId: explicitBySku.get(update.sku),
      governedLocations,
      placements,
    });
    if (!resolved.resolved) {
      // The refusal a technician sees. Concrete, actionable, and never a code.
      throw new HttpsError("failed-precondition", CONSUMPTION_SOURCE_MESSAGE[resolved.reason], {
        code: resolved.reason,
        sku: update.sku,
      });
    }
    movements.push({ part: { partId, trackingMode }, event: buildConsumptionMovement({
        workOrderId: input.workOrderId,
        partId,
        trackingMode,
        quantity: update.delta,
        locationType: resolved.source.locationType,
        locationId: resolved.source.locationId,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        direction: "CONSUME",
        commandKey: input.commandKey,
      }) });
  }

  // ---------------------------------------------------------------- NEGATIVE: a correction
  for (const update of negatives) {
    const item = input.snapshot.find((i) => i.sku === update.sku);
    const partId = item?.partId ?? update.sku;
    const outstanding = outstandingConsumptionByLocation(priorRows, input.workOrderId, partId);
    const totalOutstanding = outstanding.reduce((n, e) => n + e.outstanding, 0);

    // A DECREMENT IS CAPPED AT WHAT WAS PHYSICALLY CONSUMED, NOT REFUSED WHEN IT EXCEEDS IT.
    //
    // The two situations that look identical here are not. `qtyUsed` may have been recorded BEFORE
    // this authority existed, in which case there is no physical consumption to reverse — and
    // refusing the correction would make historical usage uneditable, which is exactly the
    // reinterpretation of pre-authority records the ruling forbids.
    //
    // So: reverse what physically exists, and let the rest be an ordinary qtyUsed correction of a
    // pre-authority record. The invariant that actually matters is preserved either way — NEVER
    // restore more than was physically consumed, so a decrement can never conjure stock.
    const reversible = Math.min(Math.abs(update.delta), totalOutstanding);
    if (reversible <= 0) continue; // nothing physical to reverse; qtyUsed still corrects below
    const plan = planConsumptionCorrection(outstanding, reversible);
    if (!plan.ok) {
      throw new HttpsError(
        "failed-precondition",
        "That is more than has been recorded as used for this part, so it cannot be given back.",
        { code: plan.reason, sku: update.sku },
      );
    }
    for (const target of plan.plan) {
      movements.push({ part: { partId, trackingMode: "NONE" }, event: buildConsumptionMovement({
          workOrderId: input.workOrderId,
          partId,
          trackingMode: "NONE",
          quantity: target.quantity,
          locationType: target.locationType,
          locationId: target.locationId,
          actorId: input.actorId,
          occurredAt: input.occurredAt,
          direction: "CORRECT",
          commandKey: input.commandKey,
        }) });
    }
  }

  return movements;
}
