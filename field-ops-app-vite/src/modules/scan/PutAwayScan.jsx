import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import { binCommandClient } from "../../services/binCommandClient.js";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import {
  addStowScan,
  buildStowSession,
  toPutAwayRequest,
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
// ============================ IT RECORDS WHERE, NOT WHAT ============================
//
// DECISIONS #116. The warehouse still owns the stock; the bin says where inside it the stock sits.
// The command writes a placement record and no ledger event, so a stow can never remove anything
// from warehouse on-hand, transfer sufficiency or cycle-count expected quantity.
//
// The screen says this out loud rather than leaving an operator to assume a stow "moved" something.
//
// ============================ THE BIN IS VALIDATED BY THE SERVER ============================
//
// `resolveBin` is the authority on whether a scanned code is a real, active bin at THIS warehouse.
// This surface renders its answer and never second-guesses it — in particular WRONG_WAREHOUSE keeps
// its own words, because it means the operator is in the wrong building, which is a different
// problem from a code nobody registered.
//
// ============================ INERT TODAY ============================
//
// `inventory.placement.record` and `inventory.location.bin.read` are both registered active:false
// and granted to no Role, so both calls resolve permission-denied. Rendered as refusals.

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

export default function PutAwayScan({ deps }) {
  const client = deps?.binClient ?? binCommandClient;
  const session = deps?.session ?? null;

  const [bin, setBin] = useState(null);
  const [observations, setObservations] = useState(Object.freeze([]));
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const stowKey = useRef(newStowKey());

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const state = buildStowSession({ session, bin, observations });

  const fail = useCallback((err) => {
    const raw = typeof err?.code === "string" ? err.code : "";
    setError({
      code: raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal"),
      detail: typeof err?.details === "string" ? err.details : null,
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

  const confirm = useCallback(async () => {
    if (!state.canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.recordPutAway(
        toPutAwayRequest({ session, bin, state, idempotencyKey: stowKey.current }),
      );
      if (!alive.current) return;
      setOutcome(result);
    } catch (err) {
      if (alive.current) fail(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [state, busy, client, session, bin, fail]);

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
        <p className="fo-scan__notice fo-scan__notice--ok" role="status">
          ✓ Recorded — {session.partId} is in {outcome.binCode}.{" "}
          {/* Said plainly, because an operator could reasonably assume a stow moved something. */}
          Stock counts are unchanged: putting it away records where it is, not what there is.
        </p>
        <Button type="button" variant="primary" onClick={startAnother}>Stow something else</Button>
      </div>
    );
  }

  return (
    <div className="fo-putaway">
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
            label="Scan item"
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
                Undo last scan
              </button>
            </>
          )}

          <button type="button" className="fo-link-btn" onClick={() => setBin(null)}>Change bin</button>
        </>
      )}

      {state.blockers.length > 0 && (
        <ul className="fo-list fo-transfer-scan__blockers" aria-label="Before you can confirm">
          {state.blockers.map((b) => <li key={b} className="fo-muted">{BLOCKER_TEXT[b]}</li>)}
        </ul>
      )}

      <Button type="button" variant="primary" onClick={confirm} disabled={!state.canSubmit || busy}>
        {busy ? "Recording…" : "Confirm put-away"}
      </Button>

      {error && <PutAwayError error={error} />}
    </div>
  );
}

function PutAwayError({ error }) {
  // The bin's own vocabulary survives the transport: three different physical problems, three
  // different sentences, because they send an operator to different places.
  const binReason = BIN_RESULT_TEXT[error.detail];
  const message = binReason
    ? binReason
    : error.code === "permission-denied"
      ? "You are not authorized to put stock away. Put-away is built and governed; it has not been granted or switched on."
      : error.code === "invalid-argument"
        ? "That put-away could not be accepted. Check what was scanned."
        : "That could not be recorded. Nothing was changed.";
  return <p className="fo-scan__state fo-scan__state--denied" role="alert">{message}</p>;
}
