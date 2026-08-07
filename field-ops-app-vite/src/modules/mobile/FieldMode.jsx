import { useCallback, useState } from "react";
import { useCurrentTechnician } from "../../hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../../hooks/useAssignedWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import {
  activeFieldWorkOrders,
  nextFieldAction,
  fieldProgressStep,
  FIELD_ACTIONS,
} from "../../domain/fieldWorkOrder";
import PartsScanner from "./PartsScanner";

// F0 -- Field Job Authority convergence.
//
// Field Mode now runs entirely on the GOVERNED Work Order Engine
// (`fieldops_wos` via transitionWorkOrder), not the legacy `fieldops_jobs`
// model. Three things changed materially:
//
// 1. "Start Travel" and "Arrived" used to be React local state
//    (travelStageByJob) that was NEVER written anywhere. They are now real
//    governed transitions (Travel -> EN_ROUTE, Arrive -> ARRIVED) with real
//    server timestamps (enRouteAt/arrivedAt), so a dispatcher can finally see
//    that a technician is on the way.
// 2. Acceptance exists at all. The legacy model had no ACCEPTED state, so
//    "the technician has seen this job" was unrepresentable.
// 3. Completion goes through the same governed transition as every other
//    step, rather than a separate legacy completion cascade.
//
// Read-scoping is preserved: useAssignedWorkOrders(technicianId) is a
// technician-scoped query, never a full-collection read, and an unmapped user
// gets nothing plus a clear prompt (fail closed).
//
// What this screen still does NOT do, deliberately, because it belongs to a
// later gate: typed notes and picklists (F3), scanning that resolves governed
// entities (F2), photos/attachments (F4). PartsScanner remains a lookup tool
// and still carries its own demo banner.

export default function FieldMode() {
  const { technicianId, loading: technicianLoading } = useCurrentTechnician();
  const { data: workOrders, loading: workOrdersLoading, error } = useAssignedWorkOrders(technicianId);
  const loading = technicianLoading || workOrdersLoading;
  const unmapped = !technicianLoading && !technicianId;

  // One in-flight transition at a time, tracked by Work Order id so a stale
  // response can never clear a newer attempt's state.
  const [pending, setPending] = useState({ id: null, action: null });
  const [failure, setFailure] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const active = activeFieldWorkOrders(workOrders);
  const [current, ...upNext] = active;

  const advance = useCallback(async (workOrder, action) => {
    if (pending.id) return; // duplicate-tap guard
    setPending({ id: workOrder.id, action });
    setFailure(null);
    try {
      await transitionWorkOrder(workOrder.id, action);
      // No local state to update: the authoritative onSnapshot listener moves
      // the Work Order to its new status. Nothing is fabricated client-side.
    } catch (err) {
      setFailure({
        id: workOrder.id,
        message: err?.message || "That step could not be recorded. Try again.",
      });
    } finally {
      setPending({ id: null, action: null });
    }
  }, [pending.id]);

  return (
    <div className="fo-panel">
      <h2>Field Mode</h2>

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : unmapped ? (
        <p className="fo-muted">
          Your account isn’t linked to a technician profile yet. Ask a
          dispatcher to link your account before using Field Mode.
        </p>
      ) : error ? (
        <p className="fo-muted" role="alert">
          Your work orders could not be loaded. {error.message}
        </p>
      ) : active.length === 0 ? (
        <p className="fo-muted">No assigned work orders</p>
      ) : (
        <>
          <div className="fo-card fo-card--field fo-card--field-active">
            <div className="fo-muted">Current Job</div>
            <h3>{current.woNumber ?? current.id}</h3>
            {current.description && <p>{current.description}</p>}
            <FieldProgress status={current.status} />
            <FieldStepAction
              workOrder={current}
              technicianId={technicianId}
              pending={pending.id === current.id ? pending.action : null}
              failure={failure?.id === current.id ? failure : null}
              onAdvance={advance}
            />
          </div>

          {upNext.length > 0 && (
            <div className="fo-card">
              <h3>Up Next</h3>
              {upNext.map((workOrder) => (
                <div key={workOrder.id} className="fo-upnext-row">
                  {workOrder.woNumber ?? workOrder.id}
                  {workOrder.description ? ` — ${workOrder.description}` : ""}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && (
        <div className="fo-card fo-fieldmode-tool">
          <button
            type="button"
            className="fo-fieldmode-tool-toggle"
            onClick={() => setScannerOpen((open) => !open)}
            aria-expanded={scannerOpen}
          >
            Parts Scanner <span aria-hidden="true">{scannerOpen ? "▲" : "▼"}</span>
          </button>
          <p className="fo-muted">Scan or look up a part. Demo — actions are not saved.</p>
          {scannerOpen && <PartsScanner technicianId={technicianId} />}
        </div>
      )}
    </div>
  );
}

/**
 * Where this job stands in the governed lifecycle. Presentation only -- it
 * reads status, it never decides anything.
 */
function FieldProgress({ status }) {
  const reached = fieldProgressStep(status);
  return (
    <ol className="fo-field-progress" aria-label="Job progress">
      {FIELD_ACTIONS.map((step, index) => {
        const done = index < reached;
        const currentStep = index === reached;
        return (
          <li
            key={step.action}
            className={`fo-field-progress__step${done ? " is-done" : ""}${currentStep ? " is-current" : ""}`}
            aria-current={currentStep ? "step" : undefined}
          >
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The one next governed step, derived from the permission matrix rather than
 * from status directly -- so the button can never offer something the server
 * would reject.
 */
function FieldStepAction({ workOrder, technicianId, pending, failure, onAdvance }) {
  const next = nextFieldAction(workOrder, technicianId);

  if (!next) {
    return (
      <p className="fo-muted">
        No action is available to you on this work order right now.
      </p>
    );
  }

  const busy = pending === next.action;
  return (
    <div>
      <button
        className="fo-btn-large"
        onClick={() => onAdvance(workOrder, next.action)}
        disabled={!!pending}
        aria-busy={busy}
      >
        {busy ? "Recording…" : next.label}
      </button>
      {failure && (
        <div role="alert" className="fo-muted" style={{ marginTop: 8 }}>
          {failure.message}
        </div>
      )}
    </div>
  );
}
