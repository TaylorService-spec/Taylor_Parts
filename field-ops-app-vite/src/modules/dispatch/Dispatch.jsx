import { useState } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { transitionWorkOrder } from "../../services/workOrderService";
import { TECHNICIANS_COLLECTION, TECH_STATUS } from "../../domain/constants";
import { FIELD_PHASE, fieldPhase } from "../../domain/fieldWorkOrder";
import { getAllowedActions } from "../../domain/workOrderWorkflow";
import { computeJobRisk } from "../../domain/jobRiskScoring";
import { SEVERITY } from "../../domain/controlTower/types";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { Button } from "../../shared/ui/primitives/index.js";

// F0 -- this IS now the canonical Work Order dispatch surface. It reads
// fieldops_wos and assigns by invoking the governed `Dispatch` transition
// (transitionWorkOrder), which sets assignedTechId and writes the lifecycle
// timestamp server-side. The legacy assignJob() client transaction against
// fieldops_jobs is no longer used here.
//
// Assigns pending jobs to available technicians. Writes back to both the
// job (technicianId, status) and the technician (status) so Jobs,
// Technicians, and Control Tower all stay in sync via their own
// realtime listeners. The write goes through the governed Dispatch
// transition, which re-checks permission and lifecycle server-side so two
// dispatchers can't both win the same technician.
//
// Sprint 3.6.4: visual-only upgrade. Shows every job (not just
// unassigned ones) with a status/priority chip, so the board reads as a
// full dispatch view rather than just a to-do queue. The chip for
// OPEN/ASSIGNED jobs reuses the existing risk severity engine
// (domain/jobRiskScoring.js -- already-derived, no new logic here) to
// label them Emergency (HIGH/CRITICAL) vs Scheduled (MEDIUM/LOW). No new
// backend logic, no schema change -- assign() below is byte-for-byte the
// same governed Dispatch transition this screen already invoked.
//
// Sandbox-fidelity fix (Part 2): this screen previously imported
// demo/heroConfig.js and used it to pin a hardcoded "hero" job (matched by
// customer name "Beacon Manufacturing") to the top of the queue, badge it
// "Active Demo Job", and pre-select a hardcoded "hero" technician (matched
// by name "Alex Rivera") in the assign dropdown. That is demo-only
// presentation bleeding into production-shaped runtime: a job or
// technician with a matching name in a REAL environment would silently get
// special treatment it never asked for and no governed field explains.
// heroConfig.js is now used ONLY by demo/test fixtures (see
// demo/inventoryData.js and test/*), never imported by this screen. This
// remains the canonical Work Order Dispatch transition surface (see the
// F0 note above) -- the combined Dispatch/Scheduling workspace
// (DispatchSchedulingWorkspace.jsx) only performs the Schedule transition
// (unscheduled -> SCHEDULED with a suggested tech/time); it does not
// perform the Dispatch transition (SCHEDULED -> DISPATCHED, the actual
// "send this job to this technician now" governed write), so this screen
// keeps a unique, still-necessary operational responsibility.

// Chips read the governed operational phase, so all eleven statuses are
// covered without this surface enumerating them.
const PHASE_CHIP = {
  [FIELD_PHASE.ON_SITE]: { label: "In Progress", tone: "in-progress" },
  [FIELD_PHASE.FINISHED]: { label: "Completed", tone: "completed" },
};

function priorityChip(job) {
  // This chip reads computeJobRisk(), which is DERIVED from how long a job has been
  // sitting and what state it is in -- age and status factors. It is not a customer-
  // declared priority, and this platform has no such field.
  //
  // It used to render that score as "Emergency". A dispatcher persona reported
  // routine PM work badged red and read the queue as full of emergencies. "At risk"
  // is what the number actually supports: this job needs attention because it is
  // aging or stuck, which is a claim the data can carry.
  const risk = computeJobRisk(job);
  const atRisk = risk && (risk.severity === SEVERITY.HIGH || risk.severity === SEVERITY.CRITICAL);
  return atRisk ? { label: "At risk", tone: "emergency" } : { label: "Scheduled", tone: "scheduled" };
}

// PHASE_BY_STATUS (domain/fieldWorkOrder.js) deliberately folds COMPLETED, CLOSED, and
// CANCELLED into the single FIELD_PHASE.FINISHED bucket -- phase only answers "is there
// still field work to do", not "what happened to this job". Reading the chip off phase
// alone therefore renders a cancelled job with the identical green "Completed" chip as a
// job that actually finished, with no way for a dispatcher to tell them apart. Cancelled
// is checked against the real governed status here, ahead of the phase projection, so it
// gets its own label and a tone (danger, not success) instead of borrowing "Completed"'s.
function statusChipFor(job) {
  if (job?.status === "CANCELLED") return { label: "Cancelled", tone: "emergency" };
  return PHASE_CHIP[fieldPhase(job)] ?? priorityChip(job);
}

export default function Dispatch() {
  const { data: jobs, loading, error } = useWorkOrders();
  // The technicians read can fail independently of the work-order read. Unchecked, the assignment
  // dropdown rendered with zero options and no explanation -- silently non-functional, and
  // indistinguishable from "there are no technicians".
  const { data: technicians, error: techniciansError } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [dispatchError, setDispatchError] = useState(null);
  // H20 fix: reassigning a job away from the technician it was Scheduled for is a distinct, audited,
  // reason-required action (Owner ruling) -- never a silent side effect of picking someone else from this
  // select. `pendingReassignment` holds the {job, technicianId} pair awaiting a typed reason; nothing is
  // dispatched until the dispatcher confirms with a reason.
  const [pendingReassignment, setPendingReassignment] = useState(null);
  const [reassignReasonInput, setReassignReasonInput] = useState("");

  // Shared resolver -- see domain/actorDisplayName.js. Returned undefined before, leaving each
  // call site to fall back to the raw id on its own.
  const technicianName = (id) =>
    resolveTechnicianIdentity(id, { technicians, error: techniciansError }).name;

  // Governed dispatch: the server sets assignedTechId, enforces the
  // CREATED/READY_TO_DISPATCH/SCHEDULED -> DISPATCHED transition and the
  // admin/dispatcher permission, and writes the timestamp. Nothing about the
  // assignment is decided client-side.
  async function assign(job, technicianId, reassignReason) {
    if (!technicianId) return;
    setDispatchError(null);
    const technician = technicians.find((t) => t.id === technicianId);
    if (!technician) return;
    try {
      await transitionWorkOrder(job.id, "Dispatch", {
        assignedTechId: technicianId,
        ...(reassignReason ? { reassignReason } : {}),
      });
    } catch (err) {
      console.error(err);
      setDispatchError(workflowActionErrorMessage(err));
    }
  }

  // H20 fix: the server is the only authority on whether this is actually a reassignment (it compares
  // against wo.scheduledTechId at the moment Dispatch runs) -- this client-side check only decides whether
  // to show the reason prompt before calling assign(); the server still enforces the requirement itself
  // regardless of what this UI does.
  function handleSelectTechnician(job, technicianId) {
    if (!technicianId) return;
    if (job.scheduledTechId && job.scheduledTechId !== technicianId) {
      setPendingReassignment({ job, technicianId });
      setReassignReasonInput("");
      return;
    }
    assign(job, technicianId);
  }

  function confirmReassignment() {
    if (!pendingReassignment || !reassignReasonInput.trim()) return;
    assign(pendingReassignment.job, pendingReassignment.technicianId, reassignReasonInput.trim());
    setPendingReassignment(null);
    setReassignReasonInput("");
  }

  function cancelReassignment() {
    setPendingReassignment(null);
    setReassignReasonInput("");
  }

  return (
    <div className="fo-panel">
      <h2>Dispatch</h2>
      {dispatchError && <p className="fo-error" role="alert">{dispatchError}</p>}
      {/* Announced rather than left to look like "no technicians exist". Work orders are still worth
          showing when only the technician read failed, but the assignment control cannot work and
          the screen must say why instead of offering an empty dropdown. */}
      {techniciansError && (
        <p className="fo-scan__notice fo-scan__notice--warn" role="alert">
          Technicians could not be loaded, so assignment is unavailable.
          {" "}{loadErrorMessage(techniciansError, { entity: "technicians" })}
        </p>
      )}

      {loading ? (
        <p className="fo-muted">Loading work orders…</p>
      ) : error ? (
        // Fail VISIBLY. A denied/unavailable read used to fall through to
        // "No work orders yet" -- a false empty board a dispatcher could read
        // as nothing to do, missing real jobs with no indication of failure.
        <p className="fo-muted" role="alert">
          {loadErrorMessage(error, { entity: "work orders" })}
        </p>
      ) : jobs.length === 0 ? (
        <p className="fo-muted">No work orders yet.</p>
      ) : (
        jobs.map((job) => {
          const chip = statusChipFor(job);
          return (
            <div
              key={job.id}
              className={`fo-card fo-card--dispatch fo-card--dispatch-${chip.tone}`}
            >
              <div className="fo-dispatch__card-head">
                <h3>{job.woNumber ?? job.id}</h3>
                <span className={`fo-chip fo-chip-${chip.tone}`}>{chip.label}</span>
              </div>
              <p>{job.description}</p>

              {/* The governed engine allows Dispatch only from SCHEDULED
                  (CREATED -> READY_TO_DISPATCH -> SCHEDULED -> DISPATCHED).
                  Asking the engine rather than assuming means this control is
                  never offered where the transition would be rejected -- and
                  scheduling is NOT fabricated here, because Schedule requires a
                  real scheduledStart/End/TechId decision this board does not
                  make. */}
              {!getAllowedActions(job.status, "dispatcher", false).includes("Dispatch") ? (
                <div className="fo-muted">
                  {job.assignedTechId
                    ? `Assigned to ${technicianName(job.assignedTechId)}`
                    : job.status === "CANCELLED"
                    ? "This work order was cancelled before it was dispatched — no further action is needed."
                    : "Not ready to dispatch — this work order must be scheduled first."}
                </div>
              ) : !job.assignedTechId ? (
                <>
                  {/* H20 fix: make who this job was Scheduled for a visible fact on the dispatch surface
                      itself, not something only discoverable by cross-referencing the Scheduling board.
                      Picking anyone else in the select below is then a visible choice, not an accident. */}
                  {job.scheduledTechId && (
                    <div className="fo-muted">
                      Scheduled for: {technicianName(job.scheduledTechId)}
                    </div>
                  )}
                  <select
                    value={pendingReassignment?.job.id === job.id ? pendingReassignment.technicianId : ""}
                    onChange={(e) => handleSelectTechnician(job, e.target.value)}
                  >
                    <option value="" disabled>
                      Select technician…
                    </option>
                    {technicians
                      .filter((t) => t.status === TECH_STATUS.AVAILABLE || t.id === job.scheduledTechId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  {/* H20 fix: dispatching to anyone OTHER than job.scheduledTechId is a reassignment --
                      the Owner ruling requires a reason before it can be confirmed. Same-technician
                      dispatch never reaches this prompt (handleSelectTechnician dispatches it immediately). */}
                  {pendingReassignment?.job.id === job.id && (
                    <div className="fo-form" role="group" aria-label="Reassignment reason required">
                      <p className="fo-muted">
                        Reassigning from {technicianName(job.scheduledTechId) ?? job.scheduledTechId} to{" "}
                        {technicianName(pendingReassignment.technicianId)} —
                        a reason is required.
                      </p>
                      <textarea
                        value={reassignReasonInput}
                        onChange={(e) => setReassignReasonInput(e.target.value)}
                        placeholder="Why is this job being reassigned?"
                        aria-label="Reassignment reason"
                        rows={2}
                      />
                      <div className="fo-dispatch__reassign-actions">
                        <Button variant="primary" onClick={confirmReassignment} disabled={!reassignReasonInput.trim()}>
                          Confirm reassignment
                        </Button>
                        <Button variant="secondary" onClick={cancelReassignment}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="fo-muted">Assigned to {technicianName(job.assignedTechId)}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
