// THE WAREHOUSE OFFLINE PRECHECKS -- pure decisions over current server state (Firebase exit B3-x).
//
// ============================ PRECHECKS RE-READ; THEY DO NOT DECIDE ============================
//
// Inventory truth moves while a phone is in a dead zone. A precheck re-reads current state so a doomed request can be spared and an
// already-satisfied one recognised. It is never the authority -- every command re-derives capability and re-reads state inside its own
// transaction, and a precheck that passes followed by a command that refuses is a normal race the command wins.
//
// THIS MODULE IS PURE (no service import, no Firebase seam): the three reads are injected, so the decisions here can be exercised against the
// real server's answers in plain node (functions/test/offlinePrecheckReadsPostgres.test.mjs). It was extracted unchanged from
// warehouseCommandBindings.js, whose app wiring injected NONE of the reads (they defaulted to "cannot read") -- see warehousePrecheckReads.js.
import { WAREHOUSE_INTENT } from "./warehouseIntent.js";

/** Transfer states at or past the point a dispatch intended. */
const DISPATCHED_OR_BEYOND = Object.freeze(["IN_TRANSIT", "COMPLETED"]);

/**
 * @param {{ readTransfer: (id: string) => Promise<{id?: string, status: string}|null>,
 *           readCycleCount: (payload: object) => Promise<{status: string}|null>,
 *           readBin: (id: string) => Promise<{id?: string, status?: string}|null> }} reads
 *   A read returns null when it cannot answer; the precheck then lets the command answer on its own authority.
 */
export function buildWarehousePrechecks({ readTransfer, readCycleCount, readBin }) {
  const prechecks = {
    /**
     * A dispatch against a transfer the world may have moved.
     *
     * `alreadySatisfied` when the transfer is already IN_TRANSIT or COMPLETED: the intended result
     * holds. It is reported as RECONCILED rather than as caused — somebody else may have dispatched
     * it, and claiming this intent did would put a name on an act that was not theirs.
     */
    async [WAREHOUSE_INTENT.TRANSFER_DISPATCH](intent) {
      const t = await readTransfer(intent.payload.transferOrderId);
      if (!t) return { proceed: true }; // cannot read: let the command answer on its own authority
      if (t.status === "CANCELLED") {
        return { proceed: false, code: "failed-precondition", details: "TRANSFER_CANCELLED" };
      }
      if (DISPATCHED_OR_BEYOND.includes(t.status)) {
        return { alreadySatisfied: true, serverIds: { transferOrderId: t.id ?? intent.payload.transferOrderId, status: t.status }, reconciled: true };
      }
      return { proceed: true };
    },

    /**
     * A receipt at the far end.
     *
     * A transfer still REQUESTED has not been dispatched — receiving it is not a race to lose, it is
     * an ordering problem, and it stays pending rather than being burned as a refusal. That is the
     * reverse-order case §40 asks for: the destination reconnects first and simply waits.
     */
    async [WAREHOUSE_INTENT.TRANSFER_RECEIVE](intent) {
      const t = await readTransfer(intent.payload.transferOrderId);
      if (!t) return { proceed: true };
      if (t.status === "CANCELLED") {
        return { proceed: false, code: "failed-precondition", details: "TRANSFER_CANCELLED" };
      }
      if (t.status === "REQUESTED") {
        return { proceed: false, code: "unavailable", details: "AWAITING_DISPATCH", retryable: true };
      }
      if (t.status === "COMPLETED") {
        return { alreadySatisfied: true, serverIds: { transferOrderId: intent.payload.transferOrderId, status: "COMPLETED" }, reconciled: true };
      }
      return { proceed: true };
    },

    /** A count that somebody else already submitted, or that has moved past counting. */
    async [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT](intent) {
      // The LINE's current server state (warehousePrecheckReads.js: getCycleCountSheet).
      const c = await readCycleCount(intent.payload);
      if (!c) return { proceed: true };
      if (c.status === "CANCELLED") {
        return { proceed: false, code: "failed-precondition", details: "CYCLE_COUNT_CANCELLED" };
      }
      // Already reconciled means the decision has been made on numbers this observation is not part
      // of. Submitting into it would be arguing with a closed book.
      if (c.status === "RECONCILED" || c.status === "REJECTED" || c.status === "CLOSED") {
        return { proceed: false, code: "failed-precondition", details: "CYCLE_COUNT_ALREADY_RECONCILED" };
      }
      return { proceed: true };
    },

    /**
     * A placement into a bin that may have been retired.
     *
     * NOTHING IS SUBSTITUTED. A bin that is gone or inactive is a conflict a person resolves, because
     * the alternative — quietly choosing another bin — puts stock somewhere nobody was told about.
     */
    async [WAREHOUSE_INTENT.PUT_AWAY](intent) {
      const bin = await readBin(intent.payload.destinationBinId);
      if (!bin) return { proceed: true };
      if (bin.status && bin.status !== "ACTIVE") {
        return { proceed: false, code: "failed-precondition", details: "BIN_NOT_ACTIVE" };
      }
      return { proceed: true };
    },
  };

  // A staged pick lands in a bin like anything else, so it inherits the same bin check.
  prechecks[WAREHOUSE_INTENT.PICK_STAGE] = prechecks[WAREHOUSE_INTENT.PUT_AWAY];
  // A truck handoff is a transfer, so it inherits the transfer precheck for the end it is acting on.
  prechecks[WAREHOUSE_INTENT.TRUCK_HANDOFF] = async (intent, ctx) => (
    intent.payload.action === "receive"
      ? prechecks[WAREHOUSE_INTENT.TRANSFER_RECEIVE](intent, ctx)
      : prechecks[WAREHOUSE_INTENT.TRANSFER_DISPATCH](intent, ctx)
  );
  return prechecks;
}
