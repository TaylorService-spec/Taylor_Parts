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
//   put-away         srl_<sha256(idempotencyKey)> -- the EOS relocation (+ its placement) replays by intent
//   pick             derivePlacementId(idempotencyKey, serial-or-part)
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
import { RECEIVING_OUTCOME } from "../domain/receivingTransport.js";
import { transferCommandClient } from "../services/transferCommandClient.js";
import { cycleCountCommandClient } from "../services/cycleCountCommandClient.js";
import { returnCommandClient } from "../services/returnCommandClient.js";
import { placementClient } from "../services/placementClient.js";
import { buildWarehousePrechecks } from "./warehousePrechecks.js";
import { createWarehousePrecheckReads } from "./warehousePrecheckReads.js";

/** A thrown callable error, reduced to the shape the shared executor classifies. */
const failureFrom = (err) => ({ ok: false, code: err?.code ?? null, details: err?.details ?? null });

export function createWarehouseBindings(deps = {}) {
  // Resolved AT CALL TIME so building the bindings touches no service export — a screen that never
  // syncs pays nothing, and a caller substituting one command is not forced to supply the rest.
  const receive = (...a) => (deps.submitCanonicalReceive ?? submitCanonicalReceive)(...a);
  // EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): a put-away is the relocation that records
  // the placement (POST /operations/relocation); a staged pick is the placement event (POST /operations/placement).
  const putAway = (...a) => (deps.putAwayStock ?? deps.recordPutAway ?? placementClient.putAwayStock)(...a);
  const pickStage = (...a) => (deps.recordPutAway ?? placementClient.recordPutAway)(...a);
  const transfer = deps.transferCommandClient ?? transferCommandClient;
  const cycleCount = deps.cycleCountCommandClient ?? cycleCountCommandClient;
  const returns = deps.returnCommandClient ?? returnCommandClient;
  /** Reads of current server truth, injected: this module opens no channel of its own. */
  // B3-x: these were `async () => null` and no caller injected a real one, so the stale-state avoidance never ran in the app. The defaults are now the
  // real reads (offline/warehousePrecheckReads.js): scoped, read-only, lazily loaded, and null when they cannot answer.
  const defaultReads = createWarehousePrecheckReads();
  const readTransfer = deps.readTransfer ?? defaultReads.readTransfer;
  const readCycleCount = deps.readCycleCount ?? defaultReads.readCycleCount;
  const readBin = deps.readBin ?? defaultReads.readBin;

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
        // The receiving client reports the frozen, LOWER-CASE RECEIVING_OUTCOME vocabulary and a
        // receipt carrying `receivingId`. Comparing against upper-case literals (as this once did)
        // matched nothing, so every replayed receipt -- success and not-ready alike -- was burned as
        // a conflict.
        if (result?.status === RECEIVING_OUTCOME.APPLIED || result?.status === RECEIVING_OUTCOME.REPLAYED) {
          return {
            ok: true,
            replayed: result.status === RECEIVING_OUTCOME.REPLAYED,
            serverIds: { receiptId: result.receipt?.receivingId ?? null },
          };
        }
        // A transport that is not ready is not a refusal by anybody, and must stay retryable.
        return result?.status === RECEIVING_OUTCOME.UNAVAILABLE
          ? { ok: false, code: "unavailable", details: null, offline: true }
          : { ok: false, code: "failed-precondition", details: result?.status ?? "RECEIVE_FAILED" };
      } catch (err) { return failureFrom(err); }
    },

    /** A put-away: the stock moves from the warehouse into the bin (same warehouse; total unchanged), and is placed. */
    async [WAREHOUSE_INTENT.PUT_AWAY](intent) {
      try {
        const data = await putAway(intent.payload);
        return { ok: true, replayed: data?.outcome === "replayed", serverIds: { relocationId: data?.relocationId ?? null } };
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
        const data = await pickStage(intent.payload);
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
        const data = await cycleCount.submitCycleCountLine(intent.payload);
        return {
          ok: true,
          replayed: data?.outcome === "replayed",
          serverIds: { sheetId: intent.payload.sheetId, partId: intent.payload.partId, status: data?.status ?? null },
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

  // The decisions are pure (offline/warehousePrechecks.js); the three reads are the real, scoped EOS reads unless a caller substitutes one.
  const prechecks = buildWarehousePrechecks({ readTransfer, readCycleCount, readBin });

  return { commands, prechecks };
}
