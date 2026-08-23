// TIME, IN A FEW TAPS.
//
// ============================ WHY THIS IS SMALL ============================
//
// A technician records time standing next to a machine, often with one hand, often in a plant room
// with no signal. The common entry is "an hour and a half, on site" and it should cost four taps.
// Anything a form asks for that the server already knows is a tap that should not exist -- so there
// is no technician field, no work order field, and no date picker unless the day is not today.
//
// ============================ WHAT IT NEVER SHOWS ============================
//
// No rate, no cost, no billable total. The labor record carries none of them by design, so a screen
// showing a figure would have to invent one.
//
// ============================ FAIL CLOSED, AND SAY SO ============================
//
// Both labor capabilities are registered active:false and activated in no environment, so today this
// surface denies for everybody. That is the correct state and it is rendered honestly -- a disabled
// control with an explanation, never a form that accepts input and then throws it away.
import { useEffect, useMemo, useState } from "react";
import {
  LABOR_TYPE_OPTIONS, LABOR_SUBMIT,
  buildLaborRequest, interpretLaborResult, validateLaborEntry, formatMinutes,
} from "../../domain/technicianLaborEntry";
import {
  fetchWorkOrderLabor, recordWorkOrderLabor,
} from "../../services/workOrderLaborCallableClient";
import { Button } from "../../shared/ui/primitives";

/** One token per mount, so a retry of the same entry replays instead of recording twice. */
function useAttemptToken(workOrderId) {
  return useMemo(() => `${workOrderId}-${Date.now().toString(36)}`, [workOrderId]);
}

/** Today, as the work date. Local, because a technician means the day they are having. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function JobLabor({ workOrderId, deps = {} }) {
  const fetchLabor = deps.fetchLabor ?? fetchWorkOrderLabor;
  const recordLabor = deps.recordLabor ?? recordWorkOrderLabor;

  const [load, setLoad] = useState({ status: "loading", data: null, message: null });
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [laborType, setLaborType] = useState("ONSITE");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const attemptToken = useAttemptToken(workOrderId);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading", data: null, message: null });
    fetchLabor({ workOrderId }).then((res) => {
      if (cancelled) return;
      if (res.error) {
        // A denial and a failure are different facts and are never collapsed into "no time recorded".
        setLoad({ status: "denied", data: null, message: res.error.message ?? "Labor could not be loaded." });
        return;
      }
      setLoad({ status: "ready", data: res.outcome, message: null });
    });
    return () => { cancelled = true; };
  }, [workOrderId, fetchLabor, result]);

  const totals = load.data?.totals ?? null;
  const canRecord = load.data?.canRecord === true;
  const validation = validateLaborEntry({ hours, minutes, laborType });

  async function save() {
    if (busy || !canRecord || !validation.valid) return;
    setBusy(true);
    const request = buildLaborRequest({
      workOrderId, workDate: today(), laborType, hours, minutes, attemptToken,
    });
    if (!request) { setBusy(false); return; }
    const r = interpretLaborResult(await recordLabor(request));
    setResult(r);
    if (r.status === LABOR_SUBMIT.SAVED) { setHours(""); setMinutes(""); }
    setBusy(false);
  }

  if (load.status === "loading") return <p className="fo-muted" role="status">Loading time…</p>;

  return (
    <section className="fo-panel" aria-label="Labor">
      <h3>Time</h3>

      {load.status === "denied" ? (
        <p className="fo-error" role="alert">{load.message}</p>
      ) : (
        <>
          {/* The total, in time a person reads -- never a count of minutes, never a cost. */}
          <p className="fo-muted" role="status">
            {formatMinutes(totals?.totalMinutes ?? 0)} recorded
            {totals && totals.travelMinutes > 0
              ? ` — ${formatMinutes(totals.onsiteMinutes)} on site, ${formatMinutes(totals.travelMinutes)} travel`
              : ""}
            {totals && totals.reversedEntries > 0
              ? ` (${totals.reversedEntries} corrected)` : ""}
          </p>

          <div className="fo-labor__entry">
            <label>
              Hours
              <input type="number" inputMode="numeric" min="0" max="16"
                value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy || !canRecord} />
            </label>
            <label>
              Minutes
              <input type="number" inputMode="numeric" min="0" max="59"
                value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={busy || !canRecord} />
            </label>
            <label>
              Type
              <select value={laborType} onChange={(e) => setLaborType(e.target.value)} disabled={busy || !canRecord}>
                {LABOR_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {result?.message ? (
            <p className={result.status === LABOR_SUBMIT.SAVED ? "fo-muted" : "fo-error"}
               role={result.status === LABOR_SUBMIT.SAVED ? "status" : "alert"}>
              {result.message}
            </p>
          ) : null}

          <div className="fo-form-actions">
            <Button onClick={save} disabled={busy || !canRecord || !validation.valid}>
              {busy ? "Saving…" : "Add time"}
            </Button>
          </div>
          {/* The reason a disabled button is disabled, said out loud -- the thing a technician in a
              plant room least needs is a dead control with no explanation. */}
          {!canRecord ? (
            <p className="fo-muted">You are not authorized to record labor on this work order.</p>
          ) : !validation.valid ? (
            <p className="fo-muted">{validation.reason}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
