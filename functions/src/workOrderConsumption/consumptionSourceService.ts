// Consumption source options — the TRUSTED read. Admin SDK, command-scoped, grants nothing.
//
// This is the read that lets a technician answer "where did this part come from" without being given
// any standing ability to look at inventory. It reads `warehouses`, `mobile_locations`, `trucks` and
// `bin_placements` under the Admin SDK, and returns location IDENTITIES for one Work Order, one part,
// one actor. Firestore Rules are unchanged; a test asserts that.
//
// THE ACTOR BOUNDARY IS THE SAME ONE THAT RECORDS USAGE. If a principal may not record execution data
// for this Work Order, they may not enumerate its sources either — otherwise this read would become a
// way to probe locations from outside the workflow it exists to serve.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { WORK_ORDERS_COLLECTION } from "../constants/collections.js";
import { resolveConsumptionSource, type PickedPlacement, type GovernedLocation } from "./consumptionSource.js";
import {
  projectConsumptionSourceOptions,
  type ConsumptionSourceOptions,
  type WarehouseCandidate,
  type MobileCandidate,
} from "./consumptionSourceOptions.js";

export const BIN_PLACEMENTS_COLLECTION = "bin_placements";
export const WAREHOUSES_COLLECTION = "warehouses";
export const TRUCKS_COLLECTION = "trucks";
export const MOBILE_LOCATIONS_COLLECTION = "mobile_locations";
const SERIALIZED_ASSETS_COLLECTION = "serialized_assets";

export interface SourceLookup {
  readonly workOrderId: string;
  readonly partId: string;
  readonly requestedQuantity: number;
  readonly trackingMode: string;
  readonly serialNo?: string | null;
  /** The caller's governed technician id, already resolved by the callable boundary. */
  readonly technicianId: string;
}

/**
 * ACTIVE warehouses, resolved with the SAME predicate the availability authority uses.
 *
 * `status == "ACTIVE"`, exactly as allocateSalesOrder resolves its eligible pool. Deliberately the
 * same rule rather than a similar one: a warehouse that cannot hold sellable stock must not be
 * offerable as a source, and two definitions of "eligible" would eventually disagree.
 */
export async function readActiveWarehouses(db: Firestore, txn?: Transaction): Promise<WarehouseCandidate[]> {
  const query = db.collection(WAREHOUSES_COLLECTION).where("status", "==", "ACTIVE");
  const snap = txn ? await txn.get(query) : await query.get();
  return snap.docs.map((d) => {
    const data = d.data() ?? {};
    return { warehouseId: d.id, name: typeof data.name === "string" ? data.name : null, status: "ACTIVE" };
  });
}

/**
 * The technician's OWN governed truck, or null.
 *
 * `trucks.assignedDriverEmployeeId == technicianId`, which is the existing driver authority — one
 * truck per driver, enforced by the Truck Registry.
 *
 * TWO TRUCKS IS FAIL-CLOSED, NOT "PICK ONE". The registry promises one; if the data says otherwise
 * the promise is broken, and choosing arbitrarily would let a defect become a silent inventory
 * misattribution. No option is offered, and the caller can surface it.
 *
 * This authorizes the truck to APPEAR AS AN OPTION. It never infers that a part came from it —
 * the technician still selects it.
 */
export async function readAssignedMobileLocation(
  db: Firestore,
  technicianId: string,
  txn?: Transaction,
): Promise<{ readonly mobile: MobileCandidate | null; readonly ambiguous: boolean }> {
  const query = db.collection(TRUCKS_COLLECTION).where("assignedDriverEmployeeId", "==", technicianId);
  const snap = txn ? await txn.get(query) : await query.get();
  if (snap.empty) return { mobile: null, ambiguous: false };
  if (snap.docs.length > 1) return { mobile: null, ambiguous: true };
  const data = snap.docs[0].data() ?? {};
  const locationId = typeof data.locationId === "string" && data.locationId.trim().length > 0 ? data.locationId.trim() : null;
  if (locationId === null) return { mobile: null, ambiguous: true };
  // An out-of-service truck is not a place stock may be consumed from.
  if (typeof data.status === "string" && data.status !== "ACTIVE") return { mobile: null, ambiguous: false };
  return {
    mobile: {
      locationId,
      label: typeof data.displayLabel === "string" ? data.displayLabel : (typeof data.vehicleNumber === "string" ? data.vehicleNumber : null),
      truckId: snap.docs[0].id,
    },
    ambiguous: false,
  };
}

/** Placements picked FOR THIS WORK ORDER. Single-field equality, so no composite index is needed. */
export async function readPlacementsForWorkOrder(
  db: Firestore,
  workOrderId: string,
  txn?: Transaction,
): Promise<PickedPlacement[]> {
  const query = db.collection(BIN_PLACEMENTS_COLLECTION).where("pickedForWorkOrderId", "==", workOrderId);
  const snap = txn ? await txn.get(query) : await query.get();
  return snap.docs
    .map((d) => d.data() ?? {})
    .filter((p) => typeof p.warehouseId === "string" && typeof p.partId === "string")
    .map((p) => ({
      warehouseId: p.warehouseId as string,
      partId: p.partId as string,
      quantity: typeof p.quantity === "number" ? p.quantity : 0,
      pickedForWorkOrderId: workOrderId,
    }));
}

/** A serialized unit's governed custody. Null when unknown — which #168 fails closed on. */
export async function readSerializedCustody(
  db: Firestore,
  partId: string,
  serialNo: string,
  txn?: Transaction,
): Promise<GovernedLocation | null> {
  const snap = txn
    ? await txn.get(db.collection(SERIALIZED_ASSETS_COLLECTION).where("partId", "==", partId).where("serialNo", "==", serialNo))
    : await db.collection(SERIALIZED_ASSETS_COLLECTION).where("partId", "==", partId).where("serialNo", "==", serialNo).get();
  if (snap.empty || snap.docs.length > 1) return null;
  const data = snap.docs[0].data() ?? {};
  const locationId = typeof data.currentLocationId === "string" && data.currentLocationId.trim().length > 0 ? data.currentLocationId.trim() : null;
  if (locationId === null) return null;
  const type = typeof data.currentLocationType === "string" && data.currentLocationType.trim().length > 0 ? data.currentLocationType.trim() : "WAREHOUSE";
  return { type, locationId };
}

/**
 * Resolve the option set for one (work order, part, actor).
 *
 * Composes #168's resolver for the pick decision rather than re-deciding it here — ambiguity and
 * insufficiency are its rules, and a second implementation in a read path would eventually disagree
 * with the write path that actually refuses.
 */
export async function resolveConsumptionSourceOptions(
  db: Firestore,
  lookup: SourceLookup,
  txn?: Transaction,
): Promise<ConsumptionSourceOptions & { readonly mobileAmbiguous: boolean }> {
  const [warehouses, mobileResult, placements] = await Promise.all([
    readActiveWarehouses(db, txn),
    readAssignedMobileLocation(db, lookup.technicianId, txn),
    readPlacementsForWorkOrder(db, lookup.workOrderId, txn),
  ]);

  const governedLocations: GovernedLocation[] = [
    ...warehouses.map((w) => ({ type: "WAREHOUSE", locationId: w.warehouseId })),
    ...(mobileResult.mobile === null ? [] : [{ type: "MOBILE", locationId: mobileResult.mobile.locationId }]),
  ];

  const serializedCurrentLocation =
    lookup.trackingMode === "SERIAL" && typeof lookup.serialNo === "string" && lookup.serialNo.trim().length > 0
      ? await readSerializedCustody(db, lookup.partId, lookup.serialNo.trim(), txn)
      : null;

  // The pick decision, made ONCE, by the authority that owns it.
  const picked = resolveConsumptionSource({
    workOrderId: lookup.workOrderId,
    partId: lookup.partId,
    requestedQuantity: lookup.requestedQuantity,
    trackingMode: lookup.trackingMode,
    serializedCurrentLocation,
    governedLocations,
    placements,
  });

  const projected = projectConsumptionSourceOptions({
    trackingMode: lookup.trackingMode,
    pickedSource: picked.resolved && picked.source.basis === "PICKED_PLACEMENT"
      ? { locationId: picked.source.locationId, locationType: picked.source.locationType }
      : null,
    pickUnavailableReason: picked.resolved ? null : picked.reason,
    serializedCurrentLocation: serializedCurrentLocation === null
      ? null
      : { locationId: serializedCurrentLocation.locationId, locationType: serializedCurrentLocation.type },
    warehouses,
    mobile: mobileResult.mobile,
  });

  return Object.freeze({ ...projected, mobileAmbiguous: mobileResult.ambiguous });
}

/** The Work Order's own record, for the ownership check the callable performs. */
export async function readWorkOrderForSourceLookup(db: Firestore, workOrderId: string): Promise<{ assignedTechId?: string; status?: string; inventorySnapshot?: unknown[] } | null> {
  const snap = await db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId).get();
  return snap.exists ? (snap.data() as { assignedTechId?: string; status?: string; inventorySnapshot?: unknown[] }) : null;
}
