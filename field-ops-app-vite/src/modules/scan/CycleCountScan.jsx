import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { cycleCountCommandClient } from "../../services/cycleCountCommandClient";
import {
  buildCreateCycleCountRequest,
  buildSubmitCycleCountRequest,
} from "../../domain/cycleCountCommandRequest";
import {
  addCountScan,
  buildCountSession,
  toSubmitDraft,
  COUNT_OBSERVATION,
  COUNT_OBSERVATION_TEXT,
  SUBMIT_BLOCKED,
} from "../../domain/cycleCountScanSession.js";

// CYCLE COUNT BY SCAN.
//
// Pick what you are counting and where, scan every unit you can find, and submit what you saw.
//
// ============================ THE COUNT IS BLIND, AND STAYS BLIND ============================
//
// DECISIONS #111. The server snapshots the expected quantity when the count is CREATED and does not
// return it. The first response that carries it is the SUBMIT response — by which point the counted
// value is already recorded and there is nothing left to anchor.
//
// So this screen renders no expected figure and no running variance while counting. That is the
// control, not a missing feature: a helpful "expected: 12" would tell a counter when to stop looking.
//
// ============================ OBSERVATION IS NOT ADJUSTMENT ============================
//
// Submitting records WHAT WAS SEEN. It moves no stock. The ledger correction happens only when a
// manager RECONCILES — a separate capability (`inventory.cycleCount.reconcile`) and a separate
// screen, and a counter cannot approve their own material variance. There is deliberately no
// reconcile path here.
//
// ============================ NO SECOND COUNT ENGINE ============================
//
// createCycleCount and submitCycleCount are the EXISTING commands, called through the EXISTING
// client with the EXISTING request builders. Variance is derived server-side from the server's own
// snapshot; nothing here subtracts anything.
//
// ============================ INERT TODAY ============================
//
// Every inventory.cycleCount.* capability is registered active:false and granted to no Role, so a
// real call resolves permission-denied. That is rendered as a refusal, never as a failed count.

const BLOCKER_TEXT = Object.freeze({
  [SUBMIT_BLOCKED.NO_SESSION]: "Start a count first.",
  [SUBMIT_BLOCKED.NOT_COUNTING]: "This count is no longer open.",
  [SUBMIT_BLOCKED.UNRESOLVED_SCAN]: "Something scanned is not part of this count. Resolve it before submitting.",
});

const LOCATION_TYPES = [
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "MOBILE", label: "Truck" },
];

export default function CycleCountScan({ deps }) {
  const client = deps?.cycleCountClient ?? cycleCountCommandClient;

  const [session, setSession] = useState(null);
  const [observations, setObservations] = useState(Object.freeze([]));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const state = buildCountSession({ session, observations });

  // UNCOMMITTED WORK EXISTS NOWHERE ELSE. These counted observations are not on the server, not in the
  // offline queue and not in storage until submit succeeds -- and the "back to all workflows"
  // control sits one thumb-width from the scan field. Unmounting silently destroys the lot.
  //
  // The host is told how much is at stake so it can make leaving a DECISION rather than an
  // accident. Reported as a count, not a boolean: "discard 24 scans" is a different sentence from
  // "discard your work", and the operator deserves the first one.
  const reportPending = deps?.onPendingWorkChange;
  useEffect(() => {
    reportPending?.(observations.length);
    // Leaving reports zero, so a host that outlives this component is never left guarding work
    // that no longer exists.
    return () => reportPending?.(0);
  }, [reportPending, observations.length]);

  const fail = useCallback((err) => {
    const raw = typeof err?.code === "string" ? err.code : "";
    setError(raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal"));
  }, []);

  const start = useCallback(async (draft) => {
    setBusy(true);
    setError(null);
    setResult(null);
    const built = buildCreateCycleCountRequest(draft);
    if (!built.ok) {
      setError("invalid-argument");
      setBusy(false);
      return;
    }
    try {
      const created = await client.createCycleCount(built.value);
      if (!alive.current) return;
      // NOTE what is NOT read from this response: any expected figure. The create response does not
      // carry one, and if a future change added one this screen would still not display it.
      setSession({
        cycleCountId: created?.cycleCountId,
        partId: built.value.partId,
        trackingMode: created?.trackingMode ?? draft.trackingMode ?? "NONE",
        location: built.value.location,
        status: created?.status ?? "COUNTING",
      });
      setObservations(Object.freeze([]));
    } catch (err) {
      if (alive.current) fail(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [client, fail]);

  // The beep reflects the count's own verdict: a wrong part sounds wrong, a re-scan sounds neutral.
  const scan = useCallback((raw) => {
    if (!session) return FEEDBACK.REJECTED;
    let next = null;
    setObservations((prev) => { next = addCountScan(prev, raw, session); return next; });
    const observation = next?.[next.length - 1];
    if (!observation || observation.state === COUNT_OBSERVATION.COUNTED) return FEEDBACK.ACCEPTED;
    if (observation.state === COUNT_OBSERVATION.DUPLICATE_SERIAL) return FEEDBACK.NEUTRAL;
    return { feedback: FEEDBACK.REJECTED, detail: COUNT_OBSERVATION_TEXT[observation.state] };
  }, [session]);

  const submit = useCallback(async () => {
    if (!state.canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const built = buildSubmitCycleCountRequest(session.cycleCountId, session.trackingMode, toSubmitDraft(state));
    if (!built.ok) {
      setError("invalid-argument");
      setBusy(false);
      return;
    }
    try {
      const submitted = await client.submitCycleCount(built.value);
      if (!alive.current) return;
      setResult(submitted);
      setSession((s) => (s ? { ...s, status: submitted?.status ?? "SUBMITTED" } : s));
    } catch (err) {
      if (alive.current) fail(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [state, busy, session, client, fail]);

  if (!session) return <StartCount onStart={start} busy={busy} error={error} />;

  return (
    <div className="fo-count-scan">
      <section className="fo-scan__result" aria-label={`Counting ${session.partId}`}>
        <p className="fo-scan__kind">Counting</p>
        <h3 className="fo-scan__id">{session.partId}</h3>
        <p className="fo-scan__job">at {session.location.locationId}</p>
        {/* The ONLY number on this screen while counting: what has been scanned. */}
        <p className="fo-count-scan__tally">
          {state.serialTracked ? `${state.countedQuantity} units scanned` : `${state.countedQuantity} scanned`}
        </p>
      </section>

      {result ? (
        <CountResult result={result} serialTracked={state.serialTracked} />
      ) : (
        <>
          <p className="fo-muted">
            Count everything you can find, then submit. You will not be shown what was expected until
            after you submit — that is deliberate, so the count reflects the shelf and not the system.
          </p>

          <ScanInput
            onScan={scan}
            label="Scan item"
            placeholder={state.serialTracked ? "Scan a serial number" : "Scan the part"}
            deps={deps?.scanInputDeps}
          />

          {observations.length > 0 && (
            <>
              <ul className="fo-list" aria-label="Scanned">
                {observations.map((o, i) => (
                  <li
                    key={`${o.token}-${i}`}
                    className={o.state === COUNT_OBSERVATION.COUNTED ? undefined : "fo-lookup__absent"}
                  >
                    {o.state === COUNT_OBSERVATION.COUNTED ? "✓ " : "✕ "}
                    {o.token}
                    {o.state !== COUNT_OBSERVATION.COUNTED && <> — {COUNT_OBSERVATION_TEXT[o.state]}</>}
                  </li>
                ))}
              </ul>
              <button type="button" className="fo-link-btn" onClick={() => setObservations((p) => Object.freeze(p.slice(0, -1)))}>
                Undo last scan
              </button>
            </>
          )}

          {state.blockers.length > 0 && (
            <ul className="fo-list fo-transfer-scan__blockers" aria-label="Before you can submit">
              {state.blockers.map((b) => <li key={b} className="fo-muted">{BLOCKER_TEXT[b]}</li>)}
            </ul>
          )}

          <Button type="button" variant="primary" onClick={submit} disabled={!state.canSubmit || busy}>
            {busy ? "Submitting…" : "Submit this count"}
          </Button>

          {error && <CountError code={error} />}
        </>
      )}
    </div>
  );
}

function StartCount({ onStart, busy, error }) {
  const [partId, setPartId] = useState("");
  const [locationType, setLocationType] = useState("WAREHOUSE");
  const [locationId, setLocationId] = useState("");
  const [trackingMode, setTrackingMode] = useState("NONE");

  return (
    <form
      className="fo-count-scan__start"
      onSubmit={(e) => { e.preventDefault(); onStart({ partId, locationType, locationId, trackingMode }); }}
    >
      <label>
        Part
        <input value={partId} onChange={(e) => setPartId(e.target.value)} aria-label="Part to count" />
      </label>
      <label>
        Where
        <select value={locationType} onChange={(e) => setLocationType(e.target.value)} aria-label="Location type">
          {LOCATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label>
        Location
        <input value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location" />
      </label>
      <label>
        Tracking
        <select value={trackingMode} onChange={(e) => setTrackingMode(e.target.value)} aria-label="Tracking mode">
          <option value="NONE">Counted by quantity</option>
          <option value="SERIAL">Counted by serial number</option>
        </select>
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? "Starting…" : "Start counting"}
      </Button>
      {error && <CountError code={error} />}
    </form>
  );
}

/**
 * The result — and the FIRST place an expected figure may appear, because the count is already
 * recorded and there is nothing left to anchor.
 */
function CountResult({ result, serialTracked }) {
  const variance = result?.variance;
  const serialVariance = result?.serialVariance;
  return (
    <section className="fo-scan__notice fo-scan__notice--ok" role="status">
      <p>✓ Count recorded. Nothing has been adjusted — a manager reviews the variance separately.</p>
      {serialTracked && serialVariance ? (
        <ul className="fo-list">
          {/* Missing and unexpected stay SEPARATE. Netting them to one number would hide that two
              different units are involved. */}
          <li>Expected but not found: {serialVariance.missing?.length ? serialVariance.missing.join(", ") : "none"}</li>
          <li>Found but not expected: {serialVariance.unexpected?.length ? serialVariance.unexpected.join(", ") : "none"}</li>
        </ul>
      ) : (
        <p>
          {typeof variance === "number"
            ? (variance === 0 ? "It matched what was expected." : `Variance: ${variance > 0 ? "+" : ""}${variance}.`)
            : "The variance will be shown when review begins."}
        </p>
      )}
    </section>
  );
}

function CountError({ code }) {
  const message = code === "permission-denied"
    ? "You are not authorized to count stock. The cycle count commands are built and governed; they have not been granted or switched on."
    : code === "invalid-argument"
      ? "Check the part and location before starting."
      : code === "failed-precondition"
        ? "This count is no longer in a state that accepts what you submitted."
        : "That could not be completed. Nothing was recorded.";
  return <p className="fo-scan__state fo-scan__state--denied" role="alert">{message}</p>;
}
