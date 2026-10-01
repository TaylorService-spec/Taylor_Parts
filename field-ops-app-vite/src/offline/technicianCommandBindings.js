// WHERE AN INTENT MEETS THE PLATFORM — the five bindings, and nothing else.
//
// ============================ NO NEW AUTHORITY, ANYWHERE ============================
//
// Every command below already exists, is already governed, and is already reachable from the online
// screens. This file adds a second CALLER, never a second COMMAND. An intent that syncs does exactly
// what the technician pressing the button online would have done, under the same capability, checked
// on the server at the moment it runs.
//
// If a technician may not do something online, queueing it offline does not help them.
//
// ============================ PRECHECKS ARE READS, AND ONLY READS ============================
//
// The prechecks re-read authoritative state before submitting: is this job still mine, is this machine
// still installable, has this Work Order already moved. They exist to recognise work the server
// already holds and to avoid requests that are certain to be refused.
//
// They decide nothing. Every one of these commands re-derives authority server-side and may refuse
// after a precheck passed; that race is normal and the command's answer is the one that counts.
import { INTENT_TYPE } from "./technicianIntent.js";
import { workOrderSyncError } from "./workOrderSyncError.js";
import { updateWorkOrderExecutionData, transitionWorkOrder, getWorkOrder } from "../services/workOrderService";
import { recordWorkOrderLabor } from "../services/workOrderLaborCallableClient";
import { fetchInstallableEquipmentForWorkOrder, recordWorkOrderEquipmentInstall } from "../services/workOrderEquipmentInstallClient.js";

/*
 * EQUIPMENT INSTALL (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01): the default transport is the governed EOS
 * Work Order route (services/workOrderEquipmentInstallClient.js) -- never a Firebase callable. A server refusal stays a
 * REFUSAL, never queued work to retry.
 */

/** Work Order statuses at or past completion — the intended end state of a completion intent. */
const COMPLETED_OR_BEYOND = Object.freeze(["COMPLETED", "CLOSED"]);

/** A thrown command error, reduced to the shape the executor classifies (see workOrderSyncError.js). */
const failureFrom = (err) => ({ ok: false, ...workOrderSyncError(err) });

/**
 * Build the five bindings.
 *
 * Every transport is injectable — not for testing convenience, but because this module must not be
 * the place a new ungoverned call path can appear. A binding can only ever reach a callable named
 * here.
 */
export function createTechnicianBindings(deps = {}) {
  // Each transport is resolved AT CALL TIME, not here. Building the bindings therefore touches no
  // service export at all, which matters twice over: constructing this on a screen that never syncs
  // costs nothing, and a caller that has substituted only the commands it uses is not forced to
  // supply the rest. An eager resolution made merely MOUNTING a screen depend on every export of
  // workOrderService, which is a coupling nothing here needs.
  const executionData = (...a) => (deps.updateWorkOrderExecutionData ?? updateWorkOrderExecutionData)(...a);
  const labor = (...a) => (deps.recordWorkOrderLabor ?? recordWorkOrderLabor)(...a);
  const transition = (...a) => (deps.transitionWorkOrder ?? transitionWorkOrder)(...a);
  const readWorkOrder = (...a) => (deps.getWorkOrder ?? getWorkOrder)(...a);
  const listInstallable = (...a) => (deps.fetchInstallableEquipmentForWorkOrder ?? fetchInstallableEquipmentForWorkOrder)(...a);
  const recordInstall = (...a) => (deps.recordWorkOrderEquipmentInstall ?? recordWorkOrderEquipmentInstall)(...a);

  const commands = {
    /**
     * A note. `executionNote` on the existing governed command, which already verifies the Work Order
     * is assigned to this technician.
     *
     * NOT idempotent at the server — notes append. The queue's derived id is what prevents a duplicate:
     * the same act is one entry, sent once, and a retry of a request that already succeeded is
     * prevented by the intent being SYNCED rather than by the server de-duplicating.
     */
    async [INTENT_TYPE.NOTE_ADD](intent) {
      try {
        // The intent id is the governed command's idempotency key: a lost response that is re-sent
        // REPLAYS on the server instead of appending the note twice.
        const result = await executionData(intent.workOrderId, {
          executionNote: intent.payload.executionNote, idempotencyKey: intent.intentId,
        });
        return { ok: true, serverIds: { workOrderId: result?.workOrderId ?? intent.workOrderId } };
      } catch (err) { return failureFrom(err); }
    },

    /** Time. The idempotency key is the intent id, so a replay lands on the same entry. */
    async [INTENT_TYPE.LABOR_RECORD](intent) {
      const { outcome, error } = await labor(intent.payload);
      if (error) return { ok: false, code: error.code, details: error.details };
      return {
        ok: true,
        // `replayed` is the server telling us this exact request already landed. Reported as success,
        // because it IS success — just not this attempt's.
        replayed: outcome?.outcome === "replayed",
        serverIds: { laborEntryId: outcome?.laborEntryId ?? null },
      };
    },

    /**
     * Parts used.
     *
     * The delta is applied once because the intent is sent once. `updateWorkOrderExecutionData` takes
     * a DELTA, not an absolute, so a duplicate send would genuinely double the usage — which is
     * exactly why nothing in this runtime re-sends a SYNCED intent, and why a lost response leaves the
     * intent PENDING for a person rather than being retried blind.
     */
    async [INTENT_TYPE.PARTS_USAGE](intent) {
      try {
        const result = await executionData(intent.workOrderId, {
          qtyUsedUpdates: intent.payload.qtyUsedUpdates, idempotencyKey: intent.intentId,
          ...(intent.payload.consumeFrom ? { consumeFrom: intent.payload.consumeFrom } : {}),
        });
        return { ok: true, serverIds: { workOrderId: result?.workOrderId ?? intent.workOrderId } };
      } catch (err) { return failureFrom(err); }
    },

    /**
     * The installation. Step 8 of §15 — everything before it happened in the precheck.
     *
     * `serializedAssetId` must be present by now: an intent still carrying only a raw scanned serial
     * has not been resolved, and installing an unresolved string is the one thing this must never do.
     */
    async [INTENT_TYPE.EQUIPMENT_INSTALL](intent) {
      const assetId = intent.payload.serializedAssetId;
      if (!assetId) return { ok: false, code: "failed-precondition", details: "ASSET_NOT_RESOLVED" };
      const { outcome, error } = await recordInstall({
        workOrderId: intent.workOrderId,
        serializedAssetId: assetId,
        idempotencyKey: intent.payload.idempotencyKey ?? intent.intentId,
        ...(intent.payload.notes ? { notes: intent.payload.notes } : {}),
      });
      if (error) return { ok: false, code: error.code, details: error.details };
      return {
        ok: true,
        serverIds: {
          equipmentId: outcome?.equipmentId ?? null,
          serializedAssetId: assetId,
        },
      };
    },

    /** Completion. The server's state machine, unchanged and un-second-guessed. */
    async [INTENT_TYPE.WORK_ORDER_COMPLETE](intent) {
      try {
        const result = await transition(intent.workOrderId, "Complete");
        return { ok: true, serverIds: { workOrderId: intent.workOrderId, status: result?.status ?? null } };
      } catch (err) { return failureFrom(err); }
    },
  };

  const prechecks = {
    /**
     * §15 steps 3–7, and §16's conflicts.
     *
     * The scoped read is the only way this surface can see a machine at all: it verifies the Work
     * Order is assigned to this technician, derives customer and location from the Work Order, and
     * returns only what may actually be installed on it. So "is it in this list" answers assignment,
     * installability and asset existence in one authoritative read.
     *
     * A raw scanned serial is resolved HERE, against that same list. If it resolves to nothing, the
     * intent conflicts and stops. NOTHING IS SUBSTITUTED — an available unit that happens to be on the
     * list is not the unit the technician had in their hands, and quietly installing it would put the
     * wrong serial at a customer site.
     */
    async [INTENT_TYPE.EQUIPMENT_INSTALL](intent) {
      const { outcome, error } = await listInstallable({
        workOrderId: intent.workOrderId,
        ...(intent.payload.rawScannedSerial ? { serialNo: intent.payload.rawScannedSerial } : {}),
      });
      if (error) return { proceed: false, code: error.code, details: error.details };

      // `units` is the callable's own field name. Read from the contract rather than guessed: a
      // fallback chain over invented aliases would silently produce an empty candidate list and
      // report every installation as not-installable.
      const candidates = Array.isArray(outcome?.units) ? outcome.units : [];
      const wanted = intent.payload.serializedAssetId;

      if (wanted) {
        const match = candidates.find((a) => a?.serializedAssetId === wanted);
        return match
          ? { proceed: true }
          : { proceed: false, code: "failed-precondition", details: "ASSET_NOT_INSTALLABLE" };
      }

      // Resolving a scan. Exactly one match is required: zero means it cannot be installed on this
      // job, and more than one is an ambiguity a device must not resolve by picking.
      if (candidates.length !== 1) {
        return {
          proceed: false,
          code: "failed-precondition",
          details: candidates.length === 0 ? "ASSET_NOT_INSTALLABLE" : "SCAN_AMBIGUOUS",
        };
      }
      const resolvedId = candidates[0].serializedAssetId;
      // Resolution is returned as a MUTATION OF THE INTENT rather than applied here, so the payload
      // and its fingerprint change in one place under the queue's own rules.
      return { proceed: true, resolve: { serializedAssetId: resolvedId } };
    },

    /**
     * §17 and §10 — the two ways a completion intent meets a world that moved.
     *
     * A Work Order already COMPLETED is reconciled as done, not transitioned again: `transitionWorkOrder`
     * is action-based and NOT idempotent, so a second Complete against a completed job is an invalid
     * transition, and treating a lost response as a failure would show a technician an error about
     * work that succeeded.
     *
     * A Work Order assigned to somebody else is a conflict, full stop. The technician's cached copy
     * said it was theirs; the server says otherwise, and the server is right.
     */
    async [INTENT_TYPE.WORK_ORDER_COMPLETE](intent) {
      let wo;
      try {
        wo = await readWorkOrder(intent.workOrderId);
      } catch (err) {
        // The governed detail read is itself the per-record decision: a Work Order no longer this
        // technician's is REFUSED by the server here, and that refusal is the answer.
        const f = failureFrom(err);
        return { proceed: false, code: f.code, details: f.details };
      }
      if (!wo) return { proceed: false, code: "not-found", details: "WORK_ORDER_NOT_FOUND" };

      if (COMPLETED_OR_BEYOND.includes(wo.status)) {
        return { alreadySatisfied: true, serverIds: { workOrderId: wo.id, status: wo.status } };
      }
      // NO BROWSER IDENTITY COMPARISON. The governed assignee is an EOS Employee, and whose work this
      // is was decided by the server when it let this read through; completeWorkOrder re-checks it
      // (NOT_ASSIGNED) at the moment it runs.
      return { proceed: true };
    },
  };

  return { commands, prechecks };
}
