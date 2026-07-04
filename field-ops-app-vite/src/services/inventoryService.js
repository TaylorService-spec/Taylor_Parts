import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db, auth } from "../firebase/firebase";
import { safeSetDoc } from "../lib/firebaseSafe";
import { isWriteBlocked } from "../config/env";
import { INVENTORY_COLLECTION, JOBS_COLLECTION, LOCATION_TYPE } from "../domain/constants";
import { InsufficientInventoryError } from "../domain/errors";
import { logJobEvent } from "./jobEventService";

// Sprint 4 Epic 1/5: the real, Firestore-backed inventory system and the
// ONLY place that writes to INVENTORY_COLLECTION. This is a new,
// separate system from demo/InventoryContext.jsx (Sprint 3.6's in-memory
// demo layer) -- that file is completely untouched by this sprint and
// keeps working exactly as it did, so the shareable demo has zero
// regression. UI components that want real, persistent inventory (not
// demo-only local state) call the functions here instead of touching
// Firestore directly.
//
// Schema (domain/constants.js's LOCATION_TYPE), one doc per
// (locationType, locationId, partId):
//   { partId, name, locationType, locationId, quantityAvailable, quantityReserved }
//
// quantityAvailable = total physical stock at this location.
// quantityReserved  = how much of that stock is earmarked for jobs but
//                      not yet consumed. "Free to reserve" is always
//                      quantityAvailable - quantityReserved -- never
//                      quantityAvailable alone, which is what prevents
//                      double-allocation (Task 4.2/4.3).
//
// Reservations are tracked per-job on the job document itself
// (job.partsReserved, an additive field -- see services/jobService.js),
// not in a separate ledger, so consumePart() can tell exactly how much
// of *this job's* reservation it's allowed to draw down.

function inventoryDocId(locationType, locationId, partId) {
  return `${locationType}__${locationId}__${partId}`;
}

function inventoryRef(locationType, locationId, partId) {
  return doc(db, INVENTORY_COLLECTION, inventoryDocId(locationType, locationId, partId));
}

export async function getInventory(locationType, locationId, partId) {
  const snap = await getDoc(inventoryRef(locationType, locationId, partId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Idempotent upsert: creates the inventory doc if it doesn't exist yet,
// leaves it untouched if it does (never resets an existing doc's
// quantities -- safe to call repeatedly, e.g. from an operational debug
// "seed sample inventory" action).
export async function ensureInventoryDoc(locationType, locationId, partId, name, initialQuantityAvailable) {
  const ref = inventoryRef(locationType, locationId, partId);
  const existing = await getDoc(ref);
  if (existing.exists()) return { id: existing.id, ...existing.data() };

  await safeSetDoc(ref, {
    partId,
    name,
    locationType,
    locationId,
    quantityAvailable: initialQuantityAvailable,
    quantityReserved: 0,
  });

  return { id: ref.id, partId, name, locationType, locationId, quantityAvailable: initialQuantityAvailable, quantityReserved: 0 };
}

// Reserves `quantity` of `partId` against the technician's truck for
// `job`, at assignment time (Task 4.2). Transactional across the
// inventory doc and the job doc: validates quantityAvailable -
// quantityReserved >= quantity before writing either, so two
// simultaneous reservations against the same truck can't both succeed
// past what's actually there (Task 4.3's "prevent negative inventory").
// Logs a RESERVED job event as part of the same transaction.
export async function reservePart(job, technicianId, partId, quantity) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (reservePart)", job.id, partId, quantity);
    return { blocked: true };
  }

  const invRef = inventoryRef(LOCATION_TYPE.TRUCK, technicianId, partId);
  const jobRef = doc(db, JOBS_COLLECTION, job.id);

  return runTransaction(db, async (tx) => {
    const invSnap = await tx.get(invRef);
    const jobSnap = await tx.get(jobRef);

    if (!invSnap.exists()) {
      throw new InsufficientInventoryError(`No inventory record for ${partId} on truck ${technicianId}`);
    }
    if (!jobSnap.exists()) {
      throw new Error("Job not found");
    }

    const inv = invSnap.data();
    const freeToReserve = inv.quantityAvailable - inv.quantityReserved;
    if (freeToReserve < quantity) {
      throw new InsufficientInventoryError(
        `Cannot reserve ${quantity}x ${partId}: only ${freeToReserve} free on truck ${technicianId}`
      );
    }

    const jobData = jobSnap.data();
    const currentReserved = jobData.partsReserved?.[partId] ?? 0;

    tx.update(invRef, { quantityReserved: inv.quantityReserved + quantity });
    tx.update(jobRef, {
      partsReserved: { ...jobData.partsReserved, [partId]: currentReserved + quantity },
    });

    logJobEvent(tx, job.id, "PART_RESERVED", { partId, quantity, technicianId });
  });
}

// Consumes `quantity` of `partId` against `job`'s existing reservation,
// during execution (Task 4.2/4.9). Can only draw down what this job
// itself reserved -- a job can never consume another job's reservation,
// which is what "prevent double allocation" means in practice, not just
// a global quantity check. Decrements both quantityAvailable (the part
// physically left the truck) and quantityReserved (the reservation is
// fulfilled) together, and logs a PART_CONSUMED job event, all in one
// transaction.
export async function consumePart(job, technicianId, partId, quantity) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (consumePart)", job.id, partId, quantity);
    return { blocked: true };
  }

  const invRef = inventoryRef(LOCATION_TYPE.TRUCK, technicianId, partId);
  const jobRef = doc(db, JOBS_COLLECTION, job.id);

  return runTransaction(db, async (tx) => {
    const invSnap = await tx.get(invRef);
    const jobSnap = await tx.get(jobRef);

    if (!invSnap.exists()) {
      throw new InsufficientInventoryError(`No inventory record for ${partId} on truck ${technicianId}`);
    }
    if (!jobSnap.exists()) {
      throw new Error("Job not found");
    }

    const inv = invSnap.data();
    const jobData = jobSnap.data();
    const reservedForJob = jobData.partsReserved?.[partId] ?? 0;

    if (reservedForJob < quantity) {
      throw new InsufficientInventoryError(
        `Job ${job.id} only has ${reservedForJob} of ${partId} reserved, cannot consume ${quantity}`
      );
    }

    tx.update(invRef, {
      quantityAvailable: inv.quantityAvailable - quantity,
      quantityReserved: inv.quantityReserved - quantity,
    });
    tx.update(jobRef, {
      partsReserved: { ...jobData.partsReserved, [partId]: reservedForJob - quantity },
    });

    logJobEvent(tx, job.id, "PART_CONSUMED", { partId, quantity, technicianId });
  });
}

// Warehouse -> Truck (or any location -> location) transfer. Validates
// the *from* location the same way reservePart() does -- can't transfer
// away stock that's already reserved for a job.
export async function transferInventory(fromLocation, toLocation, partId, quantity) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (transferInventory)", partId, quantity);
    return { blocked: true };
  }

  const fromRef = inventoryRef(fromLocation.locationType, fromLocation.locationId, partId);
  const toRef = inventoryRef(toLocation.locationType, toLocation.locationId, partId);

  return runTransaction(db, async (tx) => {
    const fromSnap = await tx.get(fromRef);
    const toSnap = await tx.get(toRef);

    if (!fromSnap.exists()) {
      throw new InsufficientInventoryError(`No inventory record for ${partId} at source location`);
    }

    const fromData = fromSnap.data();
    const freeToMove = fromData.quantityAvailable - fromData.quantityReserved;
    if (freeToMove < quantity) {
      throw new InsufficientInventoryError(
        `Cannot transfer ${quantity}x ${partId}: only ${freeToMove} unreserved at source`
      );
    }

    tx.update(fromRef, { quantityAvailable: fromData.quantityAvailable - quantity });

    if (toSnap.exists()) {
      tx.update(toRef, { quantityAvailable: toSnap.data().quantityAvailable + quantity });
    } else {
      tx.set(toRef, {
        partId,
        name: fromData.name,
        locationType: toLocation.locationType,
        locationId: toLocation.locationId,
        quantityAvailable: quantity,
        quantityReserved: 0,
      });
    }
  });
}
