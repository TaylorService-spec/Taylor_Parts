import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import DictatableNote from "../../shared/ui/DictatableNote.jsx";
import { binCommandClient } from "../../services/binCommandClient.js";
import { useWarehouseSubmit, WAREHOUSE_SUBMIT, PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";
import { capturePickStage } from "../../offline/warehouseIntent.js";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { BIN_RESULT, BIN_RESULT_TEXT } from "../../domain/putAwaySession.js";
import {
  addPickScan,
  buildPickLine,
  demandLinesFrom,
  toStageRequest,
  LINE_STATE,
  PICK_OBSERVATION,
  PICK_OBSERVATION_TEXT,
  STAGE_BLOCKED,
} from "../../domain/pickSession.js";

// PICK AND STAGE.
//
// Pick a line off the job, scan what you gather, stage it where the driver will find it.
//
// ============================ PICKING RESERVES NOTHING ============================
//
// Reservation here is a Work Order LIFECYCLE effect — `DISPATCHED -> reserveParts` — not an operator
// action. There is no reserve command to call, and inventing one would decide a commitment policy
// nobody has: whether picked stock is still promisable to other orders.
//
// So a pick is recorded exactly as a put-away is: a PLACEMENT into a staging bin, changing no
// balance, with one extra fact — the demand it was gathered for.
//
// THE SCREEN SAYS THIS. Picked stock stays available to other orders until the job dispatches, and
// an operator who assumes otherwise will be surprised at exactly the wrong moment.
//
// ============================ THE DEMAND IS THE JOB'S ============================
//
// Lines come from the Work Order's own `inventorySnapshot`. This surface reads them and compares;
// it never edits a plan to match what was found. A shortage is REPORTED, not resolved by quietly
// lowering what the job asked for.

const BLOCKER_TEXT = Object.freeze({
  [STAGE_BLOCKED.NO_DEMAND]: "Pick a line from the job first.",
  [STAGE_BLOCKED.NOTHING_PICKED]: "Scan what you have gathered.",
  [STAGE_BLOCKED.UNRESOLVED_SCAN]: "Something scanned does not belong to this line. Resolve it before staging.",
  [STAGE_BLOCKED.NO_STAGING_BIN]: "Scan the staging location.",
});

const newPickKey = () => `pick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export default function PickScan({ deps }) {
  const client = deps?.binClient ?? binCommandClient;
  // ONE submit policy, shared with every other warehouse screen.
  const warehouse = useWarehouseSubmit({ offline: deps?.offline });
  const workOrder = deps?.workOrder ?? null;
  const warehouseId = deps?.warehouseId ?? null;

  const lines = demandLinesFrom(workOrder);
  const [activePartId, setActivePartId] = useState(null);
  const [observations, setObservations] = useState(Object.freeze([]));
  const [stagingBin, setStagingBin] = useState(null);
  const [note, setNote] = useState("");
  const [staged, setStaged] = useState(Object.freeze({}));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pickKey = useRef(newPickKey());

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const line = lines.find((l) => l.partId === activePartId) ?? null;
  const state = buildPickLine({ line, observations, stagingBin });

  const fail = useCallback((err) => {
    const raw = typeof err?.code === "string" ? err.code : "";
    setError({
      code: raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal"),
      detail: typeof err?.details === "string" ? err.details : null,
    });
  }, []);

  const scanStagingBin = useCallback(async (raw) => {
    setError(null);
    try {
      const resolved = await client.resolveBin({ warehouseId, code: raw });
      if (!alive.current) return FEEDBACK.NEUTRAL;
      setStagingBin(resolved);
      return resolved?.result === BIN_RESULT.FOUND
        ? FEEDBACK.ACCEPTED
        : { feedback: FEEDBACK.REJECTED, detail: BIN_RESULT_TEXT[resolved?.result] ?? "That location cannot be used." };
    } catch (err) {
      if (alive.current) fail(err);
      return FEEDBACK.REJECTED;
    }
  }, [client, warehouseId, fail]);

  const scanItem = useCallback((raw) => {
    let next = null;
    setObservations((prev) => { next = addPickScan(prev, raw, line); return next; });
    const observation = next?.[next.length - 1];
    if (!observation || observation.state === PICK_OBSERVATION.PICKED) return FEEDBACK.ACCEPTED;
    if (observation.state === PICK_OBSERVATION.DUPLICATE_SERIAL) return FEEDBACK.NEUTRAL;
    return { feedback: FEEDBACK.REJECTED, detail: PICK_OBSERVATION_TEXT[observation.state] };
  }, [line]);

  const stage = useCallback(async () => {
    if (!state.canStage || busy) return;
    setBusy(true);
    setError(null);
    const request = {
      ...toStageRequest({
        warehouseId, line, lineState: state, stagingBin,
        workOrderId: workOrder?.id ?? workOrder?.woNumber,
        idempotencyKey: `${pickKey.current}__${line.partId}`,
      }),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const clearLine = () => {
      // The line's outcome is kept so the job list shows what is done and what came up short.
      setStaged((prev) => Object.freeze({
        ...prev,
        [line.partId]: { quantity: state.quantity, shortBy: state.shortBy, state: state.state, pending: undefined },
      }));
      setActivePartId(null);
      setObservations(Object.freeze([]));
      setNote("");
    };

    try {
      const outcome = await warehouse.submit(
        async () => {
          try {
            await client.recordPutAway(request);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: { code: err?.code ?? null, details: err?.details ?? null }, thrown: err };
          }
        },
        // PICKING RESERVES NOTHING, offline or online. This captures what was gathered and where it
        // was staged -- the same placement the online path records -- and never a reservation the
        // product deliberately does not have.
        (wasOffline) => capturePickStage({
          principalUid: deps?.offline?.principalUid ?? "self",
          workOrderId: workOrder?.id ?? workOrder?.woNumber,
          partId: line.partId,
          pickedQuantity: state.quantity,
          stagingBinId: stagingBin?.binId ?? stagingBin?.code ?? request.destinationBinId,
          captureKey: `${pickKey.current}__${line.partId}`,
          at: Date.now(),
          offline: wasOffline,
        }),
      );
      if (!alive.current) return;

      if (outcome?.result === WAREHOUSE_SUBMIT.SENT) {
        clearLine();
      } else if (outcome?.result === WAREHOUSE_SUBMIT.QUEUED) {
        clearLine();
        // PENDING, never staged. Nothing is held for this job either way.
        setStaged((prev) => Object.freeze({
          ...prev,
          [line.partId]: { ...prev[line.partId], pending: PENDING_TEXT.PICK_STAGE },
        }));
      } else if (outcome?.result === WAREHOUSE_SUBMIT.QUEUED_NOT_DURABLE) {
        // The scan STAYS on screen -- this is the only copy that exists.
        setError({ code: "storage", message: NOT_DURABLE_TEXT });
      } else {
        fail(outcome?.error ?? new Error("stage refused"));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [state, busy, client, warehouseId, line, stagingBin, workOrder, note, fail, warehouse, deps]);

  if (!workOrder || !warehouseId) {
    return (
      <p className="fo-muted">
        Picking starts from a job. Open a Work Order that has planned parts, so the pick knows what
        was asked for and where you are picking from.
      </p>
    );
  }

  if (lines.length === 0) {
    return <p className="fo-muted">This job has no planned parts to pick.</p>;
  }

  return (
    <div className="fo-pick">
      <section className="fo-scan__result" aria-label={`Picking ${workOrder.woNumber ?? workOrder.id}`}>
        <p className="fo-scan__kind">Pick</p>
        <h3 className="fo-scan__id">{workOrder.woNumber ?? workOrder.id}</h3>
        {stagingBin?.result === BIN_RESULT.FOUND && (
          <p className="fo-scan__job">Staging to <strong>{stagingBin.code}</strong></p>
        )}
      </section>

      {/* Said plainly. An operator who assumes picking holds stock for the job will be surprised at
          exactly the wrong moment. */}
      <p className="fo-muted">
        Picking records what you gathered and where you staged it. It does not hold the stock — it
        stays available to other jobs until this one is dispatched.
      </p>

      {!stagingBin || stagingBin.result !== BIN_RESULT.FOUND ? (
        <>
          <p className="fo-muted">Scan the staging location you are picking into.</p>
          <ScanInput onScan={scanStagingBin} label="Scan staging location" placeholder="Scan the staging label" deps={deps?.scanInputDeps} />
          {stagingBin && stagingBin.result !== BIN_RESULT.FOUND && (
            <p className="fo-scan__state fo-scan__state--denied" role="alert">
              {BIN_RESULT_TEXT[stagingBin.result] ?? "That location cannot be used."}
            </p>
          )}
        </>
      ) : !line ? (
        <ul className="fo-scan-workflows" aria-label="Lines to pick">
          {lines.map((l) => {
            const done = staged[l.partId];
            return (
              <li key={l.partId}>
                <Button type="button" variant="primary" onClick={() => { setActivePartId(l.partId); setObservations(Object.freeze([])); }}>
                  {l.name ? `${l.name} · ${l.partId}` : l.partId}
                </Button>
                <p className="fo-muted">
                  {done
                    // A SHORT line says so on the list, so the shortfall does not disappear the
                    // moment the picker moves on.
                    ? (done.shortBy > 0
                        ? `Staged ${done.quantity} of ${l.planned} — short by ${done.shortBy}`
                        : `Staged ${done.quantity} of ${l.planned}`)
                    : `${l.planned} planned${l.serialTracked ? " · by serial" : ""}`}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="fo-muted">
            {line.name ? `${line.name} · ` : ""}{line.partId} — {state.quantity} of {line.planned}
            {state.state === LINE_STATE.SHORT && state.quantity > 0 ? ` (short by ${state.shortBy})` : ""}
          </p>

          <ScanInput
            onScan={scanItem}
            label="Scan item"
            placeholder={line.serialTracked ? "Scan a serial number" : "Scan the part"}
            deps={deps?.scanInputDeps}
          />

          {observations.length > 0 && (
            <>
              <ul className="fo-list" aria-label="Picked">
                {observations.map((o, i) => (
                  <li key={`${o.token}-${i}`} className={o.state === PICK_OBSERVATION.PICKED ? undefined : "fo-lookup__absent"}>
                    {o.state === PICK_OBSERVATION.PICKED ? "✓ " : "✕ "}
                    {o.token}
                    {o.state !== PICK_OBSERVATION.PICKED && <> — {PICK_OBSERVATION_TEXT[o.state]}</>}
                  </li>
                ))}
              </ul>
              <button type="button" className="fo-link-btn" onClick={() => setObservations((p) => Object.freeze(p.slice(0, -1)))}>
                Undo last scan
              </button>
            </>
          )}

          {/* Where a shortage gets EXPLAINED. A short line without a reason tells the next person
              a number; a short line with one tells them what to do about it. */}
          <DictatableNote
            value={note}
            onChange={setNote}
            label={state.state === LINE_STATE.SHORT ? "Why is it short? (optional)" : "Note (optional)"}
            placeholder="Anything the next person should know?"
            deps={deps?.noteDeps}
          />

          {state.blockers.length > 0 && (
            <ul className="fo-list fo-transfer-scan__blockers" aria-label="Before you can stage">
              {state.blockers.map((b) => <li key={b} className="fo-muted">{BLOCKER_TEXT[b]}</li>)}
            </ul>
          )}

          <Button type="button" variant="primary" onClick={stage} disabled={!state.canStage || busy}>
            {busy
              ? "Staging…"
              // SHORT is offered explicitly rather than hidden behind the same word, so staging four
              // of five is a deliberate act and not something that happened by accident.
              : (state.state === LINE_STATE.SHORT ? `Stage ${state.quantity} — short by ${state.shortBy}` : "Stage this line")}
          </Button>

          <button type="button" className="fo-link-btn" onClick={() => { setActivePartId(null); setObservations(Object.freeze([])); }}>
            ← Back to the job
          </button>
        </>
      )}

      {error && <PickError error={error} />}
    </div>
  );
}

function PickError({ error }) {
  // An explicit message wins -- see the note in PutAwayScan's error renderer.
  if (error.message) {
    return <p className="fo-scan__state fo-scan__state--denied" role="alert">{error.message}</p>;
  }
  const binReason = BIN_RESULT_TEXT[error.detail];
  const message = binReason
    ? binReason
    : error.code === "permission-denied"
      ? "You are not authorized to stage picked stock. Picking is built and governed; it has not been granted or switched on."
      : error.code === "invalid-argument"
        ? "That pick could not be accepted. Check what was scanned."
        : "That could not be recorded. Nothing was changed.";
  return <p className="fo-scan__state fo-scan__state--denied" role="alert">{message}</p>;
}
