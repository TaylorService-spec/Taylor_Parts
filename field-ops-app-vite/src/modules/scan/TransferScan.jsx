import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import ScanInput from "../../shared/ui/ScanInput.jsx";
import { FEEDBACK } from "../../domain/scanInputPolicy.js";
import { transferCommandClient } from "../../services/transferCommandClient.js";
import { useWarehouseSubmit, WAREHOUSE_SUBMIT, PENDING_TEXT, NOT_DURABLE_TEXT } from "../../offline/useWarehouseSubmit.js";
import { captureTransferDispatch, captureTransferReceive } from "../../offline/warehouseIntent.js";
import { useTransferOrders } from "../../hooks/useTransferOrders";
import {
  buildTransferVerification,
  classifyObservation,
  TRANSFER_ACTION,
  NOT_ACTIONABLE,
  OBSERVATION_STATE,
  BLOCKED_REASON,
  OBSERVATION_TEXT,
} from "../../domain/transferScanVerification.js";

// TRANSFERS BY SCAN.
//
// Pick the transfer in front of you, confirm you are at the right end of it, scan what you are
// holding, and commit — or find out why you cannot.
//
// ============================ NO SECOND TRANSFER ENGINE ============================
//
// The commands are the EXISTING dispatchTransferOrder / receiveTransferOrder, called through the
// EXISTING transferCommandClient. They take a transferOrderId and nothing else: they re-read the
// order and re-derive every quantity, serial and location inside their own transaction, and they
// re-verify each serial's current location and state at commit time.
//
// So this screen sends NO payload derived from scans. Scanning verifies that the physical thing
// matches the order before the operator commits; it never authors what moves. All of that reasoning
// is pure, in domain/transferScanVerification.js.
//
// ============================ THE ORDERS COME FROM THE EXISTING READ ============================
//
// useTransferOrders is the same authorized `transfer_orders` read the Operations surface uses. No new
// query, no scanner-only projection.
//
// ============================ INERT TODAY ============================
//
// Every inventory.transfer.* capability is registered active:false and granted to no Role, so a real
// submission resolves permission-denied server-side. This surface does not hide that: it renders the
// refusal as a refusal, never as a fabricated success and never as "nothing to transfer".

const BLOCKER_TEXT = Object.freeze({
  [BLOCKED_REASON.NOT_ACTIONABLE]: "This transfer is not waiting for anything right now.",
  [BLOCKED_REASON.WRONG_LOCATION]: "Confirm you are at the right location first.",
  [BLOCKED_REASON.BLOCKED_OBSERVATION]: "Something scanned does not belong to this transfer. Resolve it before submitting.",
  [BLOCKED_REASON.INCOMPLETE]: "Not everything on this transfer has been scanned yet.",
  [BLOCKED_REASON.NOTHING_SCANNED]: "Scan what you are moving.",
});

const NOT_ACTIONABLE_TEXT = Object.freeze({
  [NOT_ACTIONABLE.COMPLETED]: "This transfer is already complete.",
  [NOT_ACTIONABLE.CANCELLED]: "This transfer was cancelled.",
  [NOT_ACTIONABLE.UNKNOWN_STATUS]: "This transfer is in a state this screen does not recognize, so it offers no action.",
});

/**
 * How an endpoint reads to an operator.
 *
 * A MOBILE endpoint is a TRUCK. Rendering "TRUCK-7" beside "WH-1" as two bare ids makes a handoff to
 * a van look identical to a transfer between two buildings — and they are physically different jobs
 * with different people at the other end. The type is already in the data; saying it costs nothing.
 */
function endpointLabel(location) {
  if (!location?.locationId) return "?";
  return location.type === "MOBILE" ? `truck ${location.locationId}` : location.locationId;
}

const ACTION_LABEL = Object.freeze({
  [TRANSFER_ACTION.DISPATCH]: "Send this transfer",
  [TRANSFER_ACTION.RECEIVE]: "Receive this transfer",
});

export default function TransferScan({ deps }) {
  const [selectedId, setSelectedId] = useState(null);

  const live = useTransferOrders(deps?.accessVersion ?? null, 0);
  const orders = deps?.orders ?? live.transferOrderDocs;
  const loading = deps?.orders ? false : live.loading;
  const error = deps?.orders ? null : live.error;

  const order = useMemo(
    () => (orders ?? []).find((o) => (o.transferOrderId ?? o.id) === selectedId) ?? null,
    [orders, selectedId],
  );

  if (!selectedId || !order) {
    return <TransferPicker orders={orders} loading={loading} error={error} onPick={setSelectedId} />;
  }
  return <TransferVerify order={order} deps={deps} onBack={() => setSelectedId(null)} />;
}

/** Which transfer are you standing in front of? */
function TransferPicker({ orders, loading, error, onPick }) {
  if (loading) return <p className="fo-muted" role="status">Loading transfers…</p>;
  if (error) {
    // A read failure is not an empty warehouse. Saying "no transfers" here would send an operator
    // away from work that exists.
    return (
      <p className="fo-scan__state fo-scan__state--denied" role="alert">
        {error === "permission-denied"
          ? "You are not authorized to see transfer orders."
          : "Transfer orders could not be loaded, so none can be scanned right now."}
      </p>
    );
  }
  const open = (orders ?? []).filter((o) => o.status === "REQUESTED" || o.status === "IN_TRANSIT");
  if (open.length === 0) {
    return <p className="fo-muted">No transfers are waiting to be sent or received.</p>;
  }
  return (
    <ul className="fo-scan-workflows">
      {open.map((o) => {
        const id = o.transferOrderId ?? o.id;
        return (
          <li key={id}>
            <Button type="button" variant="primary" onClick={() => onPick(id)}>{id}</Button>
            <p className="fo-muted">
              {o.partId} · {endpointLabel(o.origin)} → {endpointLabel(o.destination)} ·{" "}
              {o.status === "REQUESTED" ? "waiting to be sent" : "in transit"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function TransferVerify({ order, deps, onBack }) {
  const submitCommand = deps?.transferClient ?? transferCommandClient;
  // ONE submit policy. Truck handoff comes through this same screen and the same transfer
  // lifecycle -- there is no second command and no second movement model.
  const warehouse = useWarehouseSubmit({ offline: deps?.offline });

  const [observations, setObservations] = useState([]);
  const [confirmedLocation, setConfirmedLocation] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const state = buildTransferVerification({ order, observations, confirmedLocation });

  // UNCOMMITTED WORK EXISTS NOWHERE ELSE. These verified scans are not on the server, not in the
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

  // The shared input asks what the WORKFLOW made of the scan, so the beep and the buzz reflect the
  // verdict rather than merely "a code arrived". A refused scan sounds refused.
  const scan = useCallback((raw) => {
    let observation = null;
    setObservations((prev) => {
      const verified = prev.filter((o) => o.state === OBSERVATION_STATE.VERIFIED);
      observation = classifyObservation(raw, order, verified);
      return [...prev, observation];
    });
    if (!observation) return FEEDBACK.ACCEPTED;
    if (observation.state === OBSERVATION_STATE.VERIFIED) return FEEDBACK.ACCEPTED;
    if (observation.state === OBSERVATION_STATE.DUPLICATE) return FEEDBACK.NEUTRAL;
    return { feedback: FEEDBACK.REJECTED, detail: OBSERVATION_TEXT[observation.state] };
  }, [order]);

  const submit = useCallback(async () => {
    if (!state.canSubmit || submitting) return;
    setSubmitting(true);
    setOutcome(null);
    const transferOrderId = order.transferOrderId ?? order.id;
    const dispatching = state.action === TRANSFER_ACTION.DISPATCH;
    try {
      const submitted = await warehouse.submit(
        async () => {
          try {
            // The command takes an ID. Everything else it re-derives and re-verifies itself.
            const result = dispatching
              ? await submitCommand.dispatchTransferOrder({ transferOrderId })
              : await submitCommand.receiveTransferOrder({ transferOrderId });
            // Carried as serverIds: that is the field the shared policy reconciles and passes back.
            return { ok: true, serverIds: { status: result?.status ?? null } };
          } catch (err) {
            const raw = typeof err?.code === "string" ? err.code : "";
            const code = raw.startsWith("functions/") ? raw.slice("functions/".length) : (raw || "internal");
            return { ok: false, error: { code, details: err?.details ?? null } };
          }
        },
        (wasOffline) => (dispatching
          ? captureTransferDispatch({
              principalUid: deps?.offline?.principalUid ?? "self",
              transferOrderId,
              sourceId: order.origin?.locationId ?? null,
              destinationId: order.destination?.locationId ?? null,
              captureKey: `dispatch:${transferOrderId}`, at: Date.now(), offline: wasOffline,
            })
          : captureTransferReceive({
              principalUid: deps?.offline?.principalUid ?? "self",
              transferOrderId,
              destinationId: order.destination?.locationId ?? null,
              captureKey: `receive:${transferOrderId}`, at: Date.now(), offline: wasOffline,
            })),
      );
      if (!alive.current) return;

      if (submitted?.result === WAREHOUSE_SUBMIT.SENT) {
        setOutcome({ ok: true, status: submitted.serverIds?.status ?? null });
      } else if (submitted?.result === WAREHOUSE_SUBMIT.QUEUED) {
        // THE TRANSFER HAS NOT MOVED. Its own status is untouched and stays visible beside the sync
        // status -- "Requested" and "Pending" are two different facts about two different things.
        setOutcome({
          ok: false, queued: true,
          pendingText: dispatching ? PENDING_TEXT.TRANSFER_DISPATCH : PENDING_TEXT.TRANSFER_RECEIVE,
        });
      } else if (submitted?.result === WAREHOUSE_SUBMIT.QUEUED_NOT_DURABLE) {
        setOutcome({ ok: false, notDurable: true, pendingText: NOT_DURABLE_TEXT });
      } else {
        setOutcome({ ok: false, code: submitted?.error?.code ?? "internal" });
      }
    } finally {
      if (alive.current) setSubmitting(false);
    }
  }, [state.canSubmit, state.action, submitting, order, submitCommand, warehouse, deps]);

  const transferOrderId = order.transferOrderId ?? order.id;

  return (
    <div className="fo-transfer-scan">
      <button type="button" className="fo-link-btn" onClick={onBack}>← All transfers</button>

      <section className="fo-scan__result" aria-label={`Transfer ${transferOrderId}`}>
        <p className="fo-scan__kind">{state.action === TRANSFER_ACTION.RECEIVE ? "Receive" : "Send"}</p>
        <h3 className="fo-scan__id">{transferOrderId}</h3>
        <p className="fo-scan__job">
          {order.partId} · {endpointLabel(order.origin)} → {endpointLabel(order.destination)}
        </p>
        <p className="fo-muted">
          {state.serialTracked
            ? `${state.verifiedCount} of ${state.required} units verified`
            : `${state.verifiedCount} of ${state.required} verified`}
        </p>
      </section>

      {state.action === TRANSFER_ACTION.NONE ? (
        <p className="fo-scan__state" role="status">{NOT_ACTIONABLE_TEXT[state.notActionable]}</p>
      ) : (
        <>
          {/* WHERE YOU ARE is a precondition, not a detail: dispatching from the wrong end of a
              transfer moves stock that is not there. */}
          <LocationConfirm
            expected={state.expectedLocation}
            confirmed={state.locationConfirmed}
            onConfirm={() => setConfirmedLocation(state.expectedLocation)}
            onClear={() => setConfirmedLocation(null)}
          />

          <ScanInput
            onScan={scan}
            label="Scan item"
            placeholder={state.serialTracked ? "Scan a serial number" : "Scan the part"}
            deps={deps?.scanInputDeps}
          />

          {state.outstandingSerials.length > 0 && (
            // Naming what is missing beats "3 of 5": the operator has to go and find specific boxes.
            <p className="fo-muted">Still to scan: {state.outstandingSerials.join(", ")}</p>
          )}

          <ObservationList observations={observations} onUndo={() => setObservations((p) => p.slice(0, -1))} />

          <Blockers blockers={state.blockers} />

          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={!state.canSubmit || submitting}
          >
            {submitting ? "Submitting…" : ACTION_LABEL[state.action]}
          </Button>

          {outcome && <Outcome outcome={outcome} />}
        </>
      )}
    </div>
  );
}

function LocationConfirm({ expected, confirmed, onConfirm, onClear }) {
  if (!expected) return null;
  return (
    <p className="fo-transfer-scan__where">
      {confirmed ? (
        <>
          <span className="fo-transfer-scan__ok">✓ At {endpointLabel(expected)}</span>{" "}
          <button type="button" className="fo-link-btn" onClick={onClear}>Not here</button>
        </>
      ) : (
        <>
          <span>Are you at <strong>{endpointLabel(expected)}</strong>?</span>{" "}
          <Button type="button" variant="secondary" onClick={onConfirm}>Yes, I am here</Button>
        </>
      )}
    </p>
  );
}

function ObservationList({ observations, onUndo }) {
  if (observations.length === 0) return null;
  return (
    <>
      <ul className="fo-list" aria-label="Scanned">
        {observations.map((o, i) => (
          <li key={`${o.token}-${i}`} className={o.state === OBSERVATION_STATE.VERIFIED ? undefined : "fo-lookup__absent"}>
            {o.state === OBSERVATION_STATE.VERIFIED ? "✓ " : "✕ "}
            {o.token}
            {o.state !== OBSERVATION_STATE.VERIFIED && <> — {OBSERVATION_TEXT[o.state]}</>}
          </li>
        ))}
      </ul>
      <button type="button" className="fo-link-btn" onClick={onUndo}>Undo last scan</button>
    </>
  );
}

/** Every reason submission is blocked, together, so the operator sees the whole list at once. */
function Blockers({ blockers }) {
  if (blockers.length === 0) return null;
  return (
    <ul className="fo-list fo-transfer-scan__blockers" aria-label="Before you can submit">
      {blockers.map((b) => <li key={b} className="fo-muted">{BLOCKER_TEXT[b]}</li>)}
    </ul>
  );
}

function Outcome({ outcome }) {
  if (outcome.ok) {
    return (
      <p className="fo-scan__notice fo-scan__notice--ok" role="status">
        ✓ Done{outcome.status ? ` — the transfer is now ${outcome.status}.` : "."}
      </p>
    );
  }
  // QUEUED IS NOT DONE AND NOT REFUSED. The transfer's own status is unchanged; only this device's
  // attempt is outstanding. Rendered as neutral status rather than as an error, because nothing went
  // wrong -- and never as "In Transit", which only the platform may say.
  if (outcome.queued) {
    return <p className="fo-scan__notice fo-scan__notice--pending" role="status">{outcome.pendingText}</p>;
  }
  if (outcome.notDurable) {
    return <p className="fo-scan__notice fo-scan__notice--warn" role="alert">{outcome.pendingText}</p>;
  }
  // A refusal is rendered as a refusal. Every inventory.transfer.* capability is inert today, so
  // permission-denied is the expected answer and it must not look like a failure of the scan.
  const message = outcome.code === "permission-denied"
    ? "You are not authorized to move this transfer. The transfer commands are built and governed; they have not been granted or switched on."
    : outcome.code === "failed-precondition"
      ? "This transfer changed while you were scanning. Reload it and check before trying again."
      : "That could not be completed. Nothing was moved.";
  return <p className="fo-scan__state fo-scan__state--denied" role="alert">{message}</p>;
}
