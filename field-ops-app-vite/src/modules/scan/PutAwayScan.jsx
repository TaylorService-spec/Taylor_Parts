import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput, { SCAN_ITEM_LABEL } from "../../shared/ui/ScanInput.jsx";
import { useWarehouseSubmit, WAREHOUSE_SUBMIT, PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";
import { capturePutAway } from "../../offline/warehouseIntent.js";
import { placementClient } from "../../services/placementClient.js";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import {
  addStowScan,
  buildStowSession,
  BIN_RESULT,
  BIN_RESULT_TEXT,
  STOW_STEP,
  STOW_OBSERVATION,
  STOW_OBSERVATION_TEXT,
  STOW_BLOCKED,
} from "../../domain/putAwaySession.js";

// PUT-AWAY BY SCAN.
//
// Scan the bin you are standing at, scan what is going into it, confirm.
//
// ============================ IT MOVES THE STOCK INTO THE BIN, AND RECORDS IT ============================
//
// ON EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): put-away of received stock is the EXISTING
// relocation + placement model -- POST /operations/relocation `relocateStock` from the warehouse's unbinned stock to
// the scanned bin with recordPlacement:true. In ONE server transaction the stock's location changes (a paired
// RELOCATION_OUT / RELOCATION_IN in the ledger; a serial's custody moves with it) and the placement is recorded. The
// warehouse total does not change -- the stock is where it was received, now in a bin. There is no put-away ledger
// of its own and no Firebase call.
//
// ============================ THE BIN IS VALIDATED BY THE SERVER ============================
//
// The scanned code is resolved against the governed locations this person may see (listInventoryLocations): a real,
// ACTIVE bin of THIS warehouse, or the reason it is not. The relocation re-validates everything again (bin of this
// warehouse, ACTIVE, scope, Part, exact-source sufficiency) and its refusal is rendered as a refusal.

const BLOCKER_TEXT = Object.freeze({
  [STOW_BLOCKED.NO_BIN]: "Scan the bin you are putting this into.",
  [STOW_BLOCKED.BIN_UNUSABLE]: "That bin cannot be used.",
  [STOW_BLOCKED.NOTHING_TO_STOW]: "Scan what is going into the bin.",
  [STOW_BLOCKED.UNRESOLVED_SCAN]: "Something scanned does not belong in this stow. Resolve it before confirming.",
});

/** A stable key for one stow attempt, so a retry on a bad connection replays rather than doubles. */
function newStowKey() {
  const random = Math.random().toString(36).slice(2, 10);
  return `stow_${Date.now().toString(36)}_${random}`;
}

// ============================ THE OFFLINE LAYER'S FIRST ADOPTION ============================
//
// A warehouse has dead zones. The steel rack an operator is stowing into is frequently the thing
// between their phone and the access point, so the confirm press that fails is not an edge case here
// — it is the normal case in the back aisles.
//
// PUT-AWAY STAYS SAFE TO QUEUE: it moves stock only WITHIN one warehouse (warehouse -> bin), never changes the
// warehouse's total, and the server replays it by its idempotency key -- a late flush lands once or is refused
// (insufficient stock at the source, a retired bin), and that refusal is shown, never retried elsewhere.
//
// Every other workflow was considered and deliberately NOT adopted:
//
//   * RECEIVING moves custody. A receipt sitting in a queue is stock the company believes it does
//     not have, and a late flush changes real availability. Not first, and possibly not ever.
//   * CYCLE COUNT cannot be queued end-to-end at all: createCycleCount derives its expected quantity
//     from the LIVE ledger, so a count cannot even be started offline. Queueing only the submit half
//     would mean posting an observation against an expectation nobody could compute — which is worse
//     than refusing.
//   * TRANSFER moves stock between two custody authorities. Same objection as receiving, twice.
//   * PICK/STAGE shares put-away's command and could follow, but it is a placement made against a
//     work order, and a queued pick invites the operator to believe a job is staged when the record
//     of it has not left the phone. It waits for evidence from this one.
//   * LOOKUP is a read and has nothing to queue.
//
// ============================ WHAT IS STILL REQUIRED TO BE ONLINE ============================
//
// THE BIN MUST BE RESOLVED BEFORE ANYTHING CAN GO INTO IT, and that is a server read. So a put-away
// cannot be STARTED offline — only finished. That is not a limitation to route around: an
// unvalidated bin is how stock gets recorded into racking that does not exist, and the whole
// destination-first design exists to prevent exactly that.
//
// ============================ AND WHAT IS NOT CLAIMED ============================
//
// No `confirmExists` reader is supplied, because no callable answers "does placement plc_<key>
// exist?". A submission therefore stays UNVERIFIED until a flush actually succeeds, rather than
// being resolved by a guess. UNVERIFIED is the honest state and the screen says so in those words:
// an operator who believes a stow committed and walks away has left the warehouse in a state nobody
// recorded.
export default function PutAwayScan({ deps }) {
  const client = deps?.binClient ?? placementClient;
  const session = deps?.session ?? null;

  const [bin, setBin] = useState(null);
  const [observations, setObservations] = useState(Object.freeze([]));
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const stowKey = useRef(newStowKey());

  const alive = useRef(true);
  // StrictMode note: a phantom cleanup-then-remount at initial mount must restore true here, or
  // this flag lies "dead" for the component's whole real lifetime and silently discards every
  // later async result (a live, reproduced bug -- see the Cycle Count North Star P1 PR history).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const state = buildStowSession({ session, bin, observations });

  const fail = useCallback((err) => {
    const raw = typeof err?.code === "string" ? err.code : "";
    setError({
      code: raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal"),
      detail: typeof err?.details === "string" ? err.details : (typeof err?.details?.code === "string" ? err.details.code : null),
    });
  }, []);

  const scanBin = useCallback(async (raw) => {
    setError(null);
    setBusy(true);
    try {
      const resolved = await client.resolveBin({ warehouseId: session?.warehouseId, code: raw });
      if (!alive.current) return FEEDBACK.NEUTRAL;
      setBin(resolved);
      return resolved?.result === BIN_RESULT.FOUND
        ? FEEDBACK.ACCEPTED
        : { feedback: FEEDBACK.REJECTED, detail: BIN_RESULT_TEXT[resolved?.result] ?? "That bin cannot be used." };
    } catch (err) {
      if (alive.current) fail(err);
      return FEEDBACK.REJECTED;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client, session, fail]);

  const scanContents = useCallback((raw) => {
    let next = null;
    setObservations((prev) => { next = addStowScan(prev, raw, session ?? {}); return next; });
    const observation = next?.[next.length - 1];
    if (!observation || observation.state === STOW_OBSERVATION.ADDED) return FEEDBACK.ACCEPTED;
    if (observation.state === STOW_OBSERVATION.DUPLICATE_SERIAL) return FEEDBACK.NEUTRAL;
    return { feedback: FEEDBACK.REJECTED, detail: STOW_OBSERVATION_TEXT[observation.state] };
  }, [session]);

  // MIGRATED TO THE ONE WAREHOUSE QUEUE (WO-05A).
  //
  // This screen already had the right POLICY -- send, and queue only what retrying could fix -- but
  // against a second queue whose storage key was not scoped to a principal. Two warehouse queues on
  // one device is two writers; an unscoped key is one warehouse worker seeing another's stows. Both
  // are gone: there is now one durable, principal-scoped queue for all warehouse work, and the
  // reconnect trigger and retry belong to it rather than to this screen.
  const warehouse = useWarehouseSubmit({ offline: deps?.offline });

  const confirm = useCallback(async () => {
    if (!state.canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const payload = Object.freeze({
      warehouseId: session.warehouseId,
      partId: session.partId,
      binId: bin.binId,
      ...(state.serialTracked ? { serialNumbers: [...state.serialNumbers] } : { quantity: state.quantity }),
      idempotencyKey: stowKey.current,
    });
    try {
      // ONE POLICY, shared with every other warehouse screen. A refusal the server MEANT is never
      // queued -- that would turn a clear "no" into an indefinite "maybe".
      const outcomeState = await warehouse.submit(
        async () => {
          try {
            const result = await client.putAwayStock(payload);
            return { ok: true, serverIds: { relocationId: result?.relocationId ?? null }, result };
          } catch (err) {
            return { ok: false, error: { code: err?.code ?? null, details: err?.details ?? null }, thrown: err };
          }
        },
        // The capture key is the stow: this part, into this bin, under this stow's own key. The
        // intent id becomes the command's idempotency key, so a retry lands on the same placement.
        (wasOffline) => capturePutAway({
          principalUid: deps?.offline?.principalUid ?? warehouse.principalUid ?? "self",
          partId: session.partId,
          serialNo: payload.serialNo ?? null,
          destinationBinId: bin?.binId ?? bin?.code ?? payload.destinationBinId,
          quantity: payload.quantity ?? null,
          // The replay sends EXACTLY what the online attempt sent, under the same key.
          request: payload,
          captureKey: stowKey.current,
          at: Date.now(),
          offline: wasOffline,
        }),
      );
      if (!alive.current) return;

      if (outcomeState?.result === WAREHOUSE_SUBMIT.SENT) {
        setOutcome(outcomeState.serverIds ? { ...payload, binCode: bin?.code } : payload);
      } else if (outcomeState?.result === WAREHOUSE_SUBMIT.QUEUED) {
        // PENDING, never "put away". The stock has not moved.
        setOutcome({ ...payload, binCode: bin?.code, queued: true, pendingText: PENDING_TEXT.PUT_AWAY });
      } else if (outcomeState?.result === WAREHOUSE_SUBMIT.QUEUED_NOT_DURABLE) {
        // The destination STAYS ON SCREEN: the device would not promise to keep it, so this is the
        // only copy that exists.
        // Shaped like every other error on this screen so PutAwayError renders it. A bare string
        // would fall through to the generic message and the operator would never learn that the
        // phone could not keep their stow.
        setError({ code: "storage", message: NOT_DURABLE_TEXT });
      } else {
        fail(outcomeState?.error ?? new Error("put-away refused"));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [state, busy, client, session, bin, fail, warehouse]);

  const startAnother = useCallback(() => {
    // A NEW key: the next stow is a different event, and reusing the key would make it replay the
    // last one instead of recording anything.
    stowKey.current = newStowKey();
    setBin(null);
    setObservations(Object.freeze([]));
    setOutcome(null);
    setError(null);
  }, []);

  if (!session?.warehouseId || !session?.partId) {
    return (
      <p className="fo-muted">
        Put-away starts from a part you have just received. Open it from the receipt, or from a part
        lookup, so the stow knows what is being put away and where it came in.
      </p>
    );
  }

  if (outcome) {
    return (
      <div className="fo-putaway">
        {outcome.queued ? (
          // NOT a success message wearing a different colour. The operator is told the truth in the
          // words that matter: we have it, we have not been told it landed, do not assume it is done.
          <p className="fo-scan__notice fo-scan__notice--warn" role="status">
            Saved on this phone — {session.partId} into {outcome.binCode}. It has not reached the
            server yet and will send itself when you are back in range. Do not assume it is done —
            until it lands, nothing was changed.
          </p>
        ) : (
          <p className="fo-scan__notice fo-scan__notice--ok" role="status">
            ✓ Put away — {session.partId} is now in {outcome.binCode}.{" "}
            {/* Said plainly: the stock moved inside the warehouse; the warehouse holds the same amount. */}
            The bin's stock went up and the warehouse total is unchanged.
          </p>
        )}
        <Button type="button" variant="primary" onClick={startAnother}>Stow Something Else</Button>
      </div>
    );
  }

  return (
    <div className="fo-putaway">
      {/* Outstanding work is stated wherever the operator is, not only where they finished. */}
      <section className="fo-scan__result" aria-label={`Put away ${session.partId}`}>
        <p className="fo-scan__kind">Put away</p>
        <h3 className="fo-scan__id">{session.partId}</h3>
        <p className="fo-scan__job">at {session.warehouseId}</p>
        {bin?.result === BIN_RESULT.FOUND && (
          <p className="fo-putaway__bin">Into <strong>{bin.code}</strong></p>
        )}
      </section>

      {state.step === STOW_STEP.DESTINATION ? (
        <>
          <p className="fo-muted">Scan the bin you are putting this into.</p>
          <ScanInput
            onScan={scanBin}
            label="Scan bin"
            placeholder="Scan the bin label"
            disabled={busy}
            deps={deps?.scanInputDeps}
          />
          {bin && bin.result !== BIN_RESULT.FOUND && (
            <p className="fo-scan__state fo-scan__state--denied" role="alert">
              {BIN_RESULT_TEXT[bin.result] ?? "That bin cannot be used."}
            </p>
          )}
        </>
      ) : (
        <>
          <ScanInput
            onScan={scanContents}
            label={SCAN_ITEM_LABEL}
            placeholder={state.serialTracked ? "Scan a serial number" : "Scan the part"}
            deps={deps?.scanInputDeps}
          />
          <p className="fo-muted">
            {state.serialTracked ? `${state.quantity} units` : `${state.quantity}`} going into {bin.code}
          </p>

          {observations.length > 0 && (
            <>
              <ul className="fo-list" aria-label="Going in">
                {observations.map((o, i) => (
                  <li key={`${o.token}-${i}`} className={o.state === STOW_OBSERVATION.ADDED ? undefined : "fo-lookup__absent"}>
                    {o.state === STOW_OBSERVATION.ADDED ? "✓ " : "✕ "}
                    {o.token}
                    {o.state !== STOW_OBSERVATION.ADDED && <> — {STOW_OBSERVATION_TEXT[o.state]}</>}
                  </li>
                ))}
              </ul>
              <button type="button" className="fo-link-btn" onClick={() => setObservations((p) => Object.freeze(p.slice(0, -1)))}>
                Undo Last Scan
              </button>
            </>
          )}

          <button type="button" className="fo-link-btn" onClick={() => setBin(null)}>Change Bin</button>
        </>
      )}

      {state.blockers.length > 0 && (
        <ul className="fo-list fo-transfer-scan__blockers" aria-label="Before you can confirm">
          {state.blockers.map((b) => <li key={b} className="fo-muted">{BLOCKER_TEXT[b]}</li>)}
        </ul>
      )}

      <Button type="button" variant="primary" onClick={confirm} disabled={!state.canSubmit || busy}>
        {busy ? "Recording…" : "Confirm Put-Away"}
      </Button>

      {error && <PutAwayError error={error} />}
    </div>
  );
}

function PutAwayError({ error }) {
  // An explicit message wins: the durability failure has wording of its own, and mapping it through
  // a code would lose the one instruction that matters.
  if (error.message) {
    return <p className="fo-scan__state fo-scan__state--denied" role="alert">{error.message}</p>;
  }
  // The bin's own vocabulary survives the transport: three different physical problems, three
  // different sentences, because they send an operator to different places.
  const binReason = BIN_RESULT_TEXT[error.detail];
  const message = binReason
    ? binReason
    : error.detail === "NOT_ACTIVATED"
      ? "Put-away is not switched on in this environment yet. Nothing was changed."
      : error.code === "permission-denied"
      ? "You are not authorized to put stock away here."
      : error.code === "invalid-argument"
        ? "That put-away could not be accepted. Check what was scanned."
        : "That could not be recorded. Nothing was changed.";
  return <p className="fo-scan__state fo-scan__state--denied" role="alert">{message}</p>;
}
