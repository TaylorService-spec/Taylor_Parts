// WHERE A WAREHOUSE INTENT MEETS THE PLATFORM — eight bindings, and nothing else.
//
// ============================ NO NEW AUTHORITY, ANYWHERE ============================
//
// Every command below already exists, is already governed, and is already reachable from the online
// screens. This adds a second CALLER, never a second command. If a person may not do something
// online, queueing it offline does not help them.
//
// ============================ EVERY ONE IS SERVER-SIDE REPLAY-SAFE ============================
//
// Checked in the command sources before a line of this was written, because WO-05's hard gate says
// so and because the alternative — client-side "I think I already sent that" — is not safety, it is
// a guess with a warehouse on the other end:
//
//   receiving        per-line sha256 ledger key + receivingOrderDocId(idempotencyKey)
//   put-away / pick  derivePlacementId(idempotencyKey, serial-or-part)
//   transfer create  transferOrderDocId(idempotencyKey) + payload fingerprint
//   dispatch         accepts REQUESTED *or* IN_TRANSIT; the already-dispatched path requires the
//                    ledger effects to have replayed coherently or it throws
//   receive          accepts IN_TRANSIT *or* COMPLETED, same design
//   cycle count      accepts OPEN *or* COUNTED; same quantity replays, a DIFFERENT quantity is an
//                    idempotency conflict rather than an overwrite
//   return intake    deriveReturnId(idempotencyKey)
//
// So a retry lands on the same record or is explicitly refused. Nothing here dedupes on the client.
//
// ============================ PRECHECKS RE-READ; THEY DO NOT DECIDE ============================
//
// Inventory truth moves while a phone is in a dead zone. The prechecks re-read current state so a
// doomed request can be spared and an already-satisfied one recognised. They are never the authority
// — every command re-derives capability and re-reads state inside its own transaction, and a
// precheck that passes followed by a command that refuses is a normal race the command wins.
import { WAREHOUSE_INTENT } from "./warehouseIntent.js";
import { submitCanonicalReceive } from "../services/receivingCallableClient.js";
import { transferCommandClient } from "../services/transferCommandClient.js";
import { cycleCountCommandClient } from "../services/cycleCountCommandClient.js";
import { returnCommandClient } from "../services/returnCommandClient.js";
import { binCommandClient } from "../services/binCommandClient.js";

/** A thrown callable error, reduced to the shape the shared executor classifies. */
const failureFrom = (err) => ({ ok: false, code: err?.code ?? null, details: err?.details ?? null });

/** Transfer states at or past the point a dispatch intended. */
const DISPATCHED_OR_BEYOND = Object.freeze(["IN_TRANSIT", "COMPLETED"]);

export function createWarehouseBindings(deps = {}) {
  // Resolved AT CALL TIME so building the bindings touches no service export — a screen that never
  // syncs pays nothing, and a caller substituting one command is not forced to supply the rest.
  const receive = (...a) => (deps.submitCanonicalReceive ?? submitCanonicalReceive)(...a);
  const putAway = (...a) => (deps.recordPutAway ?? binCommandClient.recordPutAway)(...a);
  const transfer = deps.transferCommandClient ?? transferCommandClient;
  const cycleCount = deps.cycleCountCommandClient ?? cycleCountCommandClient;
  const returns = deps.returnCommandClient ?? returnCommandClient;
  /** Reads of current server truth, injected: this module opens no channel of its own. */
  const readTransfer = deps.readTransfer ?? (async () => null);
  const readCycleCount = deps.readCycleCount ?? (async () => null);
  const readBin = deps.readBin ?? (async () => null);

  const commands = {
    /**
     * A receipt.
     *
     * The quantity that was valid when this was captured may be invalid now — somebody else may have
     * received the rest of the line while this phone was in a dead zone. The command derives the
     * remaining quantity from CURRENT committed receipts and refuses an over-receipt. That refusal is
     * the correct outcome and is surfaced, not smoothed over.
     */
    async [WAREHOUSE_INTENT.INVENTORY_RECEIVE](intent) {
      try {
        const result = await receive(intent.payload);
        if (result?.status === "APPLIED" || result?.status === "REPLAYED") {
          return {
            ok: true,
            replayed: result.status === "REPLAYED",
            serverIds: { receiptId: result.receipt?.receivingOrderId ?? null },
          };
        }
        // A transport that is not ready is not a refusal by anybody, and must stay retryable.
        return result?.status === "UNAVAILABLE"
          ? { ok: false, code: "unavailable", details: null, offline: true }
          : { ok: false, code: "failed-precondition", details: result?.status ?? "RECEIVE_FAILED" };
      } catch (err) { return failureFrom(err); }
    },

    /** A placement. Records WHERE stock goes; creates none. */
    async [WAREHOUSE_INTENT.PUT_AWAY](intent) {
      try {
        const data = await putAway(intent.payload);
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { placementId: data?.placementId ?? null } };
      } catch (err) { return failureFrom(err); }
    },

    /**
     * A pick, staged.
     *
     * The SAME placement command as put-away, into a staging bin, carrying the demand it was
     * gathered for. PICKING RESERVES NOTHING — there is no reserve command, reservation is a Work
     * Order lifecycle effect, and inventing one here would decide a commitment policy nobody has.
     */
    async [WAREHOUSE_INTENT.PICK_STAGE](intent) {
      try {
        const data = await putAway(intent.payload);
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { placementId: data?.placementId ?? null } };
      } catch (err) { return failureFrom(err); }
    },

    async [WAREHOUSE_INTENT.TRANSFER_DISPATCH](intent) {
      try {
        const data = await transfer.dispatchTransferOrder({ transferOrderId: intent.payload.transferOrderId });
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { transferOrderId: intent.payload.transferOrderId, status: data?.status ?? null } };
      } catch (err) { return failureFrom(err); }
    },

    async [WAREHOUSE_INTENT.TRANSFER_RECEIVE](intent) {
      try {
        const data = await transfer.receiveTransferOrder({ transferOrderId: intent.payload.transferOrderId });
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { transferOrderId: intent.payload.transferOrderId, status: data?.status ?? null } };
      } catch (err) { return failureFrom(err); }
    },

    /** A truck handoff IS a transfer. One lifecycle, two words for it. */
    async [WAREHOUSE_INTENT.TRUCK_HANDOFF](intent) {
      const { transferOrderId, action } = intent.payload;
      try {
        const data = action === "receive"
          ? await transfer.receiveTransferOrder({ transferOrderId })
          : await transfer.dispatchTransferOrder({ transferOrderId });
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { transferOrderId, status: data?.status ?? null } };
      } catch (err) { return failureFrom(err); }
    },

    /**
     * A count.
     *
     * The server derives variance and materiality. The same count replays; a DIFFERENT count under
     * the same key is an idempotency conflict rather than an overwrite, which is exactly right — two
     * different numbers for one count is a question for a person, not a last-write-wins.
     */
    async [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT](intent) {
      try {
        const data = await cycleCount.submitCycleCount(intent.payload);
        return {
          ok: true,
          replayed: data?.outcome === "replayed",
          serverIds: { cycleCountId: intent.payload.cycleCountId, status: data?.status ?? null },
        };
      } catch (err) { return failureFrom(err); }
    },

    /** Intake. It does NOT restock, and nothing here implies it does. */
    async [WAREHOUSE_INTENT.RETURN_INTAKE](intent) {
      try {
        const data = await returns.recordReturnIntake(intent.payload);
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { returnId: data?.returnId ?? null } };
      } catch (err) { return failureFrom(err); }
    },
  };

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
      const c = await readCycleCount(intent.payload.cycleCountId);
      if (!c) return { proceed: true };
      if (c.status === "CANCELLED") {
        return { proceed: false, code: "failed-precondition", details: "CYCLE_COUNT_CANCELLED" };
      }
      // Already reconciled means the decision has been made on numbers this observation is not part
      // of. Submitting into it would be arguing with a closed book.
      if (c.status === "RECONCILED" || c.status === "CLOSED") {
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

  return { commands, prechecks };
}
