// EQUIPMENT INSTALLATION — the technician's half of finishing an installation job.
//
// ============================ WHAT IS DELIBERATELY MISSING ============================
//
// There is no customer picker and no location picker. The Work Order already owns both, they are
// shown read-only, and the server derives them itself — it refuses a request that tries to supply
// them. A technician re-entering a fact the platform already holds is an opportunity to get it wrong,
// not a feature.
//
// So the only thing this screen asks for is WHICH MACHINE.
//
// ============================ SCAN IS NOT INSTALL ============================
//
// Scanning a serial resolves it and shows what it is. It writes nothing — no Equipment, no state
// change, no completion. The trusted command runs only when the technician presses the button that
// says what it does.
//
// ============================ THE MIDDLE STATE IS VISIBLE ============================
//
// Install and completion are two calls in that order, so a completed job whose installation failed
// cannot happen. What CAN happen is the reverse: installed, not yet completed. That state is shown
// with its own message and its own resume action, because a technician who cannot tell what happened
// will install again.
import { useEffect, useMemo, useState } from "react";
import {
  CLOSEOUT_STATE,
  COMPLETION_PENDING_MESSAGE,
  deriveCloseoutState,
  deriveCompletionStep,
  deriveCloseoutIntentId,
  deriveResumePlan,
  interpretInstallStep,
} from "../../domain/workOrderInstallCloseout";
import {
  fetchInstallableEquipmentForWorkOrder,
  recordWorkOrderEquipmentInstall,
} from "../../services/workOrderInstallCallableClient";
import { Button } from "../../shared/ui/primitives";

/** One attempt token per mount, so a retry of the same intent replays instead of installing twice. */
function useAttemptToken(workOrderId) {
  return useMemo(() => `${workOrderId}-${Date.now().toString(36)}`, [workOrderId]);
}

export default function EquipmentInstallCloseout({ workOrderId, onCompleteWorkOrder, deps = {} }) {
  const fetchUnits = deps.fetchUnits ?? fetchInstallableEquipmentForWorkOrder;
  const recordInstall = deps.recordInstall ?? recordWorkOrderEquipmentInstall;

  const [load, setLoad] = useState({ status: "loading", data: null, message: null });
  const [selected, setSelected] = useState(null);
  const [scan, setScan] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [installStep, setInstallStep] = useState(null);
  const [completion, setCompletion] = useState({ attempted: false, error: null });
  const attemptToken = useAttemptToken(workOrderId);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading", data: null, message: null });
    fetchUnits({ workOrderId }).then((res) => {
      if (cancelled) return;
      if (res.error) {
        // A denial and a failure are different facts and are never collapsed into "nothing here".
        setLoad({ status: "denied", data: null, message: res.error.message ?? "This installation list could not be loaded." });
        return;
      }
      setLoad({ status: "ready", data: res.outcome, message: null });
    });
    return () => { cancelled = true; };
  }, [workOrderId, fetchUnits]);

  const units = load.data?.units ?? [];
  const wo = load.data?.workOrder ?? null;
  const scanned = scan.trim()
    ? units.filter((u) => u.serialNo?.toLowerCase().includes(scan.trim().toLowerCase()))
    : units;

  const state = deriveCloseoutState({
    installStep,
    completionError: completion.error,
    completionAttempted: completion.attempted,
  });
  const resume = deriveResumePlan(state);

  async function installAndComplete() {
    if (busy || !selected) return;
    setBusy(true);
    setCompletion({ attempted: false, error: null });

    // STEP ONE. Nothing about the work order is touched until this succeeds.
    const idempotencyKey = deriveCloseoutIntentId(workOrderId, selected.serializedAssetId, attemptToken);
    const step = interpretInstallStep(await recordInstall({
      workOrderId, serializedAssetId: selected.serializedAssetId,
      idempotencyKey, ...(notes.trim() ? { notes: notes.trim() } : {}),
    }));
    setInstallStep(step);
    if (!step.ok) { setBusy(false); return; }

    // STEP TWO, and only if the server says the job still needs it. transitionWorkOrder is not
    // idempotent, so completing an already-completed job would fail for a reason that is not a
    // problem — better never to ask.
    const plan = deriveCompletionStep(step);
    if (!plan.complete) { setBusy(false); return; }
    try {
      await onCompleteWorkOrder(workOrderId);
      setCompletion({ attempted: true, error: null });
    } catch (err) {
      // The installation is NOT undone. The machine is at the customer; the job simply is not closed.
      setCompletion({ attempted: true, error: err ?? new Error("completion failed") });
    } finally {
      setBusy(false);
    }
  }

  async function completeOnly() {
    if (busy) return;
    setBusy(true);
    try {
      await onCompleteWorkOrder(workOrderId);
      setCompletion({ attempted: true, error: null });
    } catch (err) {
      setCompletion({ attempted: true, error: err ?? new Error("completion failed") });
    } finally {
      setBusy(false);
    }
  }

  if (load.status === "loading") return <p className="fo-muted">Loading installable equipment…</p>;
  if (load.status === "denied") {
    return <p className="fo-error" role="alert">{load.message}</p>;
  }

  return (
    <section className="fo-panel" aria-label="Equipment installation">
      <h3>Equipment Installation</h3>

      {/* READ-ONLY, and there is no control to change either. The work order owns them. */}
      <dl className="fo-detail-list">
        <dt>Work order</dt>
        <dd>{wo?.woNumber ?? workOrderId}</dd>
        <dt>Customer</dt>
        <dd>{wo?.customerId ?? "—"}</dd>
        <dt>Location</dt>
        <dd>{wo?.locationId ?? "—"}</dd>
      </dl>

      {state.state === CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING ? (
        <>
          <p className="fo-error" role="alert">{COMPLETION_PENDING_MESSAGE}</p>
          {/* The resume action says COMPLETE, not install — the machine is already recorded and
              offering "install" again would invite a second one. */}
          <p className="fo-muted">{resume.note}</p>
          <Button onClick={completeOnly} disabled={busy}>{resume.label}</Button>
        </>
      ) : null}

      {state.state === CLOSEOUT_STATE.DONE ? (
        <p className="fo-muted" role="status">{state.message}</p>
      ) : null}

      {state.state === CLOSEOUT_STATE.FAILED ? (
        <p className="fo-error" role="alert">{state.message}</p>
      ) : null}

      {state.state === CLOSEOUT_STATE.DONE || state.state === CLOSEOUT_STATE.INSTALLED_COMPLETION_PENDING ? null : (
        <>
          <label>
            Scan or type a serial
            <input
              type="text" value={scan} onChange={(e) => setScan(e.target.value)}
              placeholder="Serial number" disabled={busy}
            />
          </label>
          {/* Filtering a list is the whole effect of a scan here. */}
          <p className="fo-muted">{scanned.length} of {units.length} eligible units</p>

          <ul className="fo-list" aria-label="Installable units">
            {scanned.map((u) => (
              <li key={u.serializedAssetId}>
                <label>
                  <input
                    type="radio" name="unit" disabled={busy}
                    checked={selected?.serializedAssetId === u.serializedAssetId}
                    onChange={() => setSelected(u)}
                  />
                  <span>{u.productName ?? u.partId}</span>
                  <span className="fo-muted">
                    {" — S/N "}{u.serialNo}
                    {u.inventoryState ? ` · ${u.inventoryState}` : ""}
                    {u.currentLocationId ? ` · ${u.currentLocationId}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {units.length === 0 ? (
            <p className="fo-muted">No units are currently eligible to install on this work order.</p>
          ) : null}

          <label>
            Installation notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} rows={2} />
          </label>

          {selected ? (
            <p className="fo-confirm-consequence fo-confirm-consequence--destructive">
              Install <strong>{selected.productName ?? selected.partId}</strong> (S/N {selected.serialNo}) for this
              customer and complete this work order. This cannot be undone.
            </p>
          ) : null}

          <div className="fo-form-actions">
            <Button onClick={installAndComplete} disabled={busy || !selected}>
              {busy ? "Recording…" : "Install & Complete Work"}
            </Button>
          </div>
          {!selected ? <p className="fo-muted">Choose the unit you installed.</p> : null}
        </>
      )}
    </section>
  );
}
