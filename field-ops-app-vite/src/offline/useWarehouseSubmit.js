import { useCallback, useState } from "react";
import { submitOrQueue, SUBMIT_RESULT } from "./submitOrQueue.js";
import { useProvidedOfflineRuntime } from "./OfflineRuntimeContext.jsx";

// ONE SUBMIT POLICY, FOR EVERY WAREHOUSE SCREEN.
//
// ============================ WHY A HOOK AND NOT SIX COPIES ============================
//
// Six screens submit warehouse work. Each could decide for itself whether to send or queue, and each
// would decide slightly differently — one would trust navigator.onLine, one would queue on any
// error, one would quietly bury a permission denial in a retry queue that never gives up.
//
// The rule lives in submitOrQueue.js and this is the single React binding to it, so a new warehouse
// screen inherits the policy rather than reinventing it. The part worth defending:
//
//     A CLEAR SERVER "NO" IS NEVER QUEUED.
//
// Queueing a refusal reads as robust and is the opposite: somebody is told "Pending sync" about work
// that was refused two hours ago, and finds out at the worst possible moment.
//
// ============================ IT CLAIMS NOTHING ============================
//
// The returned state is deliberately small and deliberately negative-leaning: SENT, QUEUED, REFUSED,
// or QUEUED_NOT_DURABLE. There is no "success" that covers the first two, because a screen that
// treats them the same is a screen that will eventually say "Received" about a receipt sitting on a
// phone.

export const WAREHOUSE_SUBMIT = SUBMIT_RESULT;

/**
 * @param deps.offline  a runtime override. Normally the shell provides one through context.
 * @returns { submit, state, reset }
 *
 *   submit(sendFn, buildIntentFn)   sendFn: () => Promise<{ ok, error?, serverIds? }>
 *                                   buildIntentFn: (wasOffline) => capture*() result
 *   state                           { result, intentId, error, reason } | null
 */
export function useWarehouseSubmit(deps = {}) {
  const provided = useProvidedOfflineRuntime();
  const offline = deps.offline ?? provided;
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (sendFn, buildIntentFn) => {
    if (busy) return null;
    setBusy(true);
    setState(null);
    try {
      // NO RUNTIME -> the screen's original online-only path, unchanged. Warehouse screens are also
      // reachable from the desktop Scan workspace, where there is no warehouse queue and the online
      // path is the right one.
      if (!offline?.enqueue) {
        const outcome = await sendFn();
        const next = outcome?.ok
          ? { result: SUBMIT_RESULT.SENT, serverIds: outcome.serverIds ?? null }
          : { result: SUBMIT_RESULT.REFUSED, error: outcome?.error ?? null };
        setState(next);
        return next;
      }

      const outcome = await submitOrQueue({
        send: sendFn,
        buildIntent: buildIntentFn,
        enqueue: offline.enqueue,
        nav: typeof navigator === "undefined" ? null : navigator,
      });
      setState(outcome);
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [busy, offline]);

  return {
    submit,
    busy,
    state,
    /** True only when the platform actually accepted it. Never true for queued work. */
    accepted: state?.result === SUBMIT_RESULT.SENT,
    queued: state?.result === SUBMIT_RESULT.QUEUED,
    /** The device would not keep it, so the screen must keep the values and say so. */
    notDurable: state?.result === SUBMIT_RESULT.QUEUED_NOT_DURABLE,
    refused: state?.result === SUBMIT_RESULT.REFUSED,
    reset: useCallback(() => setState(null), []),
    hasRuntime: !!offline?.enqueue,
  };
}

/**
 * The one sentence a warehouse screen shows after a queued submit.
 *
 * Per workflow, because "Receipt pending sync" and "Count pending sync" are what a person is
 * actually waiting on — and because a generic "Pending sync" gives them nothing to check against
 * when they open the queue later.
 */
export const PENDING_TEXT = Object.freeze({
  INVENTORY_RECEIVE: "Receipt pending sync — nothing has been received yet.",
  PUT_AWAY: "Put-away pending sync — the stock has not been moved yet.",
  PICK_STAGE: "Pick/stage pending sync — nothing is held for this job.",
  TRANSFER_DISPATCH: "Transfer dispatch pending sync — the transfer has not moved yet.",
  TRANSFER_RECEIVE: "Transfer receipt pending sync — the transfer is not complete yet.",
  TRUCK_HANDOFF: "Truck handoff pending sync — the transfer has not moved yet.",
  CYCLE_COUNT_SUBMIT: "Count pending sync — nothing has been counted on the platform yet.",
  // Deliberately avoids the word a false claim would use, so a scan for "restocked" stays a
  // meaningful check that no screen ever claims one.
  RETURN_INTAKE: "Return intake pending sync — nothing has gone back into stock.",
});

/** What to say when the phone could not keep the work. Never "pending". */
export const NOT_DURABLE_TEXT =
  "This phone could not save that offline. Keep this screen open until you have signal.";
