// Epic 6 Phase 6.3 -- Field Execution Capture. A deliberately narrow,
// separate callable from transitionWorkOrder() -- never touches
// status, assignedTechId, or any of transitionEngine.ts's lifecycle
// timestamp fields. This is the ONLY write path for qtyUsed/
// executionLog/lastUpdated; firestore.rules denies all direct client
// writes to fieldops_wos unconditionally (see that file's comment --
// "no future path for an admin UI to grow a direct-write shortcut
// around the Cloud Functions"), so this had to be a Cloud Function,
// not a client-side write, exactly like createWorkOrder/
// transitionWorkOrder already are.
//
// Same structural pattern as transitionWorkOrder.ts: onCall + HttpsError
// + getCallerContext + a single runTransaction doing read-verify-write.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getCallerContext } from "./callerContext";
import { auditEventDocRef, stageAuditEventWithId } from "./access/auditEventWriter";
import { executionDataAuditId, mergeQtyUsed, type QtyUsedDelta } from "./workOrderExecutionMath";
import { TERMINAL_STATUSES } from "./transitionEngine";
import { WORK_ORDERS_COLLECTION } from "./constants/collections";
import type { WorkOrder, InventorySnapshotItem } from "./types/workOrder";
import { PHYSICAL_CONSUMPTION_ACTIVE } from "./workOrderConsumption/consumptionActivation";
import { planPhysicalConsumption } from "./workOrderConsumption/planPhysicalConsumption";
import { stageOperationalMovement } from "./inventoryLedger/operationalMovementRepository";
import { INVENTORY_TRANSACTIONS_COLLECTION } from "./constants/collections";
import { createHash } from "node:crypto";

interface UpdateWorkOrderExecutionDataInput {
  workOrderId: string;
  qtyUsedUpdates?: QtyUsedDelta[];
  /**
   * Decision #171 — the governed physical source per part, keyed by sku, for POSITIVE deltas only.
   *
   * Optional in the type and required in behaviour: omitting it when no pick resolves the source is a
   * REFUSAL with wording the technician can act on, not a silent SOURCE UNKNOWN. It is deliberately
   * NOT consulted for a negative delta — a correction reverses against the original lineage, and
   * letting someone name a location there would let a decrement conjure stock somewhere it never was.
   */
  consumptionSources?: Array<{ sku?: unknown; locationId?: unknown }>;
  executionNote?: string;
  // Optional client-supplied idempotency key. When present, a retry / double-tap carrying the SAME key is a
  // no-op replay (see the finance callables' proven pattern): the additive qtyUsed delta and the arrayUnion
  // execution-log append -- both non-idempotent on their own -- are applied exactly once. OPTIONAL, not
  // required, so this is deploy-safe for the live client: an older client that sends no key keeps today's
  // behavior (unprotected) rather than being rejected. Closing the defect in production therefore has a
  // paired dependency: the field client must emit a STABLE key per logical submit (reused across retries).
  idempotencyKey?: string;
}

interface UpdateWorkOrderExecutionDataResult {
  success: true;
  workOrderId: string;
  updatedFields: string[];
  // true only when a prior call with the same idempotencyKey already applied this exact update.
  replayed?: true;
}

function assertValidInput(data: unknown): asserts data is UpdateWorkOrderExecutionDataInput {
  const input = data as Partial<UpdateWorkOrderExecutionDataInput> | null;
  if (!input || typeof input !== "object") {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }
  if (!input.workOrderId) {
    throw new HttpsError("invalid-argument", "workOrderId is required.");
  }

  const hasQtyUpdates = Array.isArray(input.qtyUsedUpdates) && input.qtyUsedUpdates.length > 0;
  const hasNote = typeof input.executionNote === "string" && input.executionNote.trim().length > 0;
  if (!hasQtyUpdates && !hasNote) {
    throw new HttpsError("invalid-argument", "At least one of qtyUsedUpdates or executionNote is required.");
  }

  if (hasQtyUpdates) {
    for (const item of input.qtyUsedUpdates as unknown[]) {
      const entry = item as Partial<QtyUsedDelta>;
      if (!entry || typeof entry.sku !== "string" || typeof entry.delta !== "number") {
        throw new HttpsError("invalid-argument", "Each qtyUsedUpdates entry requires { sku: string, delta: number }.");
      }
      if (!Number.isFinite(entry.delta)) {
        throw new HttpsError("invalid-argument", "Each qtyUsedUpdates entry's delta must be a finite number (NaN/Infinity are rejected).");
      }
    }
  }

  // idempotencyKey is optional (deploy-safe), but when present it must be a usable non-empty string --
  // an empty/whitespace key would collapse every distinct call to the same marker.
  if (input.idempotencyKey !== undefined) {
    if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length === 0) {
      throw new HttpsError("invalid-argument", "idempotencyKey, when provided, must be a non-empty string.");
    }
  }
}

/**
 * The movement's idempotency lineage when the client supplies no key.
 *
 * A physical decrement needs a stable identity or a double-tap decrements twice — and unlike the
 * qtyUsed delta, that one silently destroys stock. Derived from the actor, the Work Order and the
 * exact deltas, so the SAME submit reproduces the key while a genuinely different one does not.
 *
 * This does NOT make the whole command idempotent — an explicit `idempotencyKey` still does that, and
 * the client should send one. It makes the STOCK MOVEMENT safe in the meantime, which is the half
 * that cannot be undone by hand.
 */
function movementCommandKey(
  actorUid: string,
  workOrderId: string,
  updates: readonly { sku: string; delta: number }[],
): string {
  const material = [actorUid, workOrderId, ...updates.map((u) => u.sku + ":" + String(u.delta))].join("/");
  return "wox_" + createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export const updateWorkOrderExecutionData = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  assertValidInput(request.data);
  const { workOrderId, qtyUsedUpdates, executionNote, idempotencyKey } = request.data;
  const actorUid = request.auth.uid;
  const aid = idempotencyKey ? executionDataAuditId(actorUid, workOrderId, idempotencyKey) : null;

  // Rule 2: role must be exactly "technician" -- admin/dispatcher are
  // rejected too, not just anonymous/unauthenticated callers. Rule 3:
  // technicianId must be resolvable (PT-001's mapping).
  const caller = await getCallerContext(request.auth.uid);
  if (caller.role !== "technician") {
    throw new HttpsError("permission-denied", "Only technicians may record execution data.");
  }
  if (!caller.technicianId) {
    throw new HttpsError(
      "failed-precondition",
      "This account has no technicianId mapping yet (see PT-001's assignTechnicianToUser.js)."
    );
  }

  const db = getFirestore();
  const woRef = db.collection(WORK_ORDERS_COLLECTION).doc(workOrderId);

  const outcome = await db.runTransaction(async (tx) => {
    let stagedMovements: Array<{ event: Record<string, unknown>; part: { partId: string; trackingMode: string } }> = [];
    // Firestore requires all reads before any write. Read the WO and (when an idempotency key was supplied)
    // the deterministic Audit Event marker up front.
    const snap = await tx.get(woRef);
    // Idempotency / replay: a prior Audit Event at this id means this exact update already applied. Return a
    // no-op replay -- never re-apply the additive qtyUsed delta or re-append the execution-log entry.
    if (aid) {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) {
        return { replayed: true as const, fields: [] as string[] };
      }
    }
    if (!snap.exists) {
      throw new HttpsError("not-found", `No Work Order with id ${workOrderId}`);
    }
    const wo = snap.data() as WorkOrder;

    // Rule 4: ownership -- assignedTechId must match the caller's own
    // technicianId. Never assignedTechId itself; only ever compared,
    // never written by this function.
    if (wo.assignedTechId !== caller.technicianId) {
      throw new HttpsError("permission-denied", "This Work Order is not assigned to you.");
    }
    // Completed, closed, and cancelled records are final. The assignment remains on the document after a
    // transition, so ownership alone must not keep this mutable execution-write path open indefinitely.
    if (TERMINAL_STATUSES.has(wo.status)) {
      throw new HttpsError("failed-precondition", "Execution data cannot be changed on a terminal Work Order.");
    }

    const fields: string[] = [];
    const payload: Record<string, unknown> = { lastUpdated: FieldValue.serverTimestamp() };
    fields.push("lastUpdated");

    // qtyUsed lives per-item inside inventorySnapshot[], not as a
    // top-level scalar field -- Firestore has no "update array element
    // matching a key" primitive, so this reads the whole array,
    // replaces only the matching sku's qtyUsed (additive delta, floored
    // at 0), and writes the whole array back -- still only touching
    // the inventorySnapshot field, nothing else on the document. Doing
    // this inside the same transaction as the ownership check above
    // is what makes it concurrency-safe (Step 6): a second concurrent
    // call re-reads the post-first-write array, never clobbers it.
    if (qtyUsedUpdates && qtyUsedUpdates.length > 0) {
      const base: InventorySnapshotItem[] = wo.inventorySnapshot ? wo.inventorySnapshot : [];
      const merged = mergeQtyUsed(base, qtyUsedUpdates);
      if (!merged.ok) {
        throw new HttpsError("invalid-argument", `No planned part with sku "${merged.unknownSku}" on this Work Order.`);
      }
      payload.inventorySnapshot = merged.snapshot;
      fields.push("inventorySnapshot");

      // ============================ PHYSICAL CONSUMPTION (Decision #168 / #169) ============================
      //
      // The qtyUsed change and its physical stock movement are staged in THIS transaction, so they
      // cannot diverge: a recorded usage whose decrement failed would leave inventory overstated
      // exactly as before, which is the defect this whole chain exists to close.
      //
      // Gated, so the previous behaviour is one constant away for as long as the gate says so.
      if (PHYSICAL_CONSUMPTION_ACTIVE) {
        const movements = await planPhysicalConsumption(tx, db, {
          workOrderId,
          actorId: caller.technicianId as string,
          technicianId: caller.technicianId as string,
          snapshot: base,
          qtyUsedUpdates,
          consumptionSources: request.data.consumptionSources ?? [],
          occurredAt: Date.now(),
          commandKey: idempotencyKey ?? movementCommandKey(actorUid, workOrderId, qtyUsedUpdates),
        });
        stagedMovements = movements;
        if (movements.length > 0) fields.push("physicalConsumption");
      }
    }

    // executionLog is append-only via arrayUnion -- chosen over a
    // single overwritable executionNotes string specifically because
    // it's safe for concurrent edits (Step 6) with no read-modify-write
    // needed at all (arrayUnion is its own atomic merge). `at` uses
    // Timestamp.now(), not FieldValue.serverTimestamp() -- Firestore
    // does not support serverTimestamp() sentinels nested inside
    // arrayUnion() elements. Still server-computed (Admin SDK), not
    // client-supplied.
    if (executionNote && executionNote.trim().length > 0) {
      payload.executionLog = FieldValue.arrayUnion({
        note: executionNote.trim(),
        at: Timestamp.now(),
        byTechnicianId: caller.technicianId,
      });
      fields.push("executionLog");
    }

    // ---- PHYSICAL MOVEMENTS, staged in THIS transaction, before the document write ----
    //
    // Everything above was a read or a decision; this is where stock actually moves. Staged through
    // the SAME `stageOperationalMovement` every other physical movement uses — no second ledger, no
    // second idempotency scheme — so a retry replays instead of decrementing twice.
    //
    // If any of these throws, the qtyUsed update below never happens: usage and the stock it moved
    // commit together or not at all.
    for (const staged of stagedMovements) {
      const store = {
        async read(docId: string) {
          const s = await tx.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
          return s.exists ? (s.data() ?? {}) : null;
        },
        create(docId: string, data: Record<string, unknown>) {
          tx.create(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data);
        },
      };
      // The Part authority travels WITH the event: the validator reads trackingMode from the Part,
      // never from the event, so a movement carrying its own would be a second forgeable answer.
      await stageOperationalMovement(store, staged.event, staged.part, { now: new Date() });
    }

    tx.update(woRef, payload);

    // Stage the deterministic Audit Event marker IN THE SAME transaction so the update and its idempotency
    // record commit atomically -- the marker's existence is what makes a later retry a no-op replay. Only when
    // a key was supplied (deploy-safe: keyless legacy calls still apply, just without replay protection).
    if (aid) {
      stageAuditEventWithId(tx, aid, {
        actorUid,
        action: "updateWorkOrderExecutionData",
        targetType: "workOrder",
        targetId: workOrderId,
        outcome: "applied",
        summary: `execution-data update applied (${fields.join(", ")})`,
      });
    }
    return { replayed: false as const, fields };
  });

  const result: UpdateWorkOrderExecutionDataResult = {
    success: true,
    workOrderId,
    updatedFields: outcome.fields,
    ...(outcome.replayed ? { replayed: true as const } : {}),
  };
  return result;
});
