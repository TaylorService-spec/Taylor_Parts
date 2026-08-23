// SEND IT, OR KEEP IT — the one decision every capture surface shares.
//
// ============================ WHY THIS IS NOT PER-SCREEN ============================
//
// Each screen could decide for itself whether to send or queue, and each would decide slightly
// differently: one would trust navigator.onLine, one would queue on any error, one would queue on a
// permission denial and quietly bury a refusal in a queue that retries it forever.
//
// So the rule lives here, once:
//
//   1  a device that KNOWS it is offline does not attempt. It queues.
//   2  otherwise it tries, because navigator.onLine is a hint and the request is the proof.
//   3  a failure that could be connectivity queues.
//   4  A REFUSAL IS NEVER QUEUED. The server said no; putting that in a retry queue would turn a
//      clear answer into an indefinite maybe, and hide it behind a reassuring "Pending sync".
//
// Point 4 is the one worth defending. The temptation is to queue everything and let sync sort it out,
// which reads as robust and is the opposite: a technician told "waiting to sync" about work that was
// refused two hours ago will find out at the worst possible moment.
import { classifyFailure, FAILURE_CLASS } from "./syncFailureClassification.js";
import { connectivityHint } from "./syncExecutor.js";

export const SUBMIT_RESULT = Object.freeze({
  /** The platform accepted it. */
  SENT: "SENT",
  /** Held on the device. Not done, and never described as done. */
  QUEUED: "QUEUED",
  /** The platform refused it. Not queued — the answer is already known. */
  REFUSED: "REFUSED",
  /** Held, but the device could not promise to keep it. The technician must be told. */
  QUEUED_NOT_DURABLE: "QUEUED_NOT_DURABLE",
});

/**
 * @param send      () => Promise<{ ok, error? }>. The direct online path this screen already had.
 * @param buildIntent (offline) => intent result from technicianIntentCapture.
 * @param enqueue   the runtime's enqueue.
 * @param nav       navigator, for the hint.
 */
export async function submitOrQueue({ send, buildIntent, enqueue, nav = null } = {}) {
  const hint = connectivityHint(nav);

  const queue = async () => {
    const built = buildIntent(true);
    if (!built?.valid) return { result: SUBMIT_RESULT.REFUSED, reason: built?.reason ?? "invalid_intent" };
    const stored = await enqueue(built);
    return {
      result: stored.durable ? SUBMIT_RESULT.QUEUED : SUBMIT_RESULT.QUEUED_NOT_DURABLE,
      intentId: stored.intentId,
      reason: stored.reason ?? null,
    };
  };

  // The one case where not trying is right: the device is certain it has no network.
  if (hint.likelyOnline === false) return queue();

  let outcome;
  try {
    outcome = await send();
  } catch (err) {
    outcome = { ok: false, error: { code: err?.code ?? null, details: err?.details ?? null } };
  }
  if (outcome?.ok) return { result: SUBMIT_RESULT.SENT, serverIds: outcome.serverIds ?? null };

  const failure = classifyFailure({ code: outcome?.error?.code, details: outcome?.error?.details });
  // Only a failure that retrying could plausibly fix becomes queued work.
  if (failure === FAILURE_CLASS.RETRYABLE) return queue();

  return {
    result: SUBMIT_RESULT.REFUSED,
    failure,
    error: outcome?.error ?? null,
  };
}
