import { useId, useState } from "react";
import { buildScheduleInput } from "../../domain/schedulingWorkspace";
import { transitionWorkOrder } from "../../services/workOrderService";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { FormError } from "../ui/form";
import { Button } from "../ui/primitives";

// Governed "Schedule this Work Order" collector -- the ONE reusable surface that moves a
// READY_TO_DISPATCH Work Order to SCHEDULED via the already-deployed transitionWorkOrder("Schedule", ...)
// Cloud Function. Reused by the Scheduling workspace's Ready-to-Schedule queue AND by Control Tower's
// WorkOrderActions (which previously fired "Schedule" with NO payload -> backend invalid-argument).
//
// It NEVER writes fieldops_wos directly and never fabricates a partial payload: buildScheduleInput (pure,
// tested) validates date/start/end/tech and yields exactly the three fields transitionWorkOrder.ts:57
// requires; the server re-validates and remains the authority. Governed technician selection only -- the
// caller passes the governed `technicians` entity list; there is no free-text technician entry.
//
// Technician list policy: scheduling is FUTURE planning, so we offer ALL governed technicians by name
// (not only the currently-AVAILABLE ones the same-instant Dispatch picker filters to) -- a tech busy right
// now can still own a slot next Tuesday. Current availability is a Dispatch-time concern, not a
// scheduling-time one.
const SCHEDULE_INPUT_MESSAGE = {
  TECH_REQUIRED: "Select a technician.",
  DATE_REQUIRED: "Choose a date.",
  TIME_REQUIRED: "Enter a start and end time.",
  TIME_INVALID: "Enter a valid date and time.",
  END_BEFORE_START: "The end time must be after the start time.",
};

export default function ScheduleWorkOrderForm({ workOrder, technicians = [], onScheduled, onCancel }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [techId, setTechId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const baseId = useId();

  const techOptions = [...technicians].sort((a, b) =>
    String(a.name ?? a.id).localeCompare(String(b.name ?? b.id))
  );

  async function handleSchedule(e) {
    e.preventDefault();
    setError(null);
    const built = buildScheduleInput({ date, start, end, techId });
    if (!built.ok) {
      setError(SCHEDULE_INPUT_MESSAGE[built.error] ?? "Check the scheduling details and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await transitionWorkOrder(workOrder.id, "Schedule", built.value);
      onScheduled?.(workOrder); // success -- the live subscription re-renders the week board
    } catch (err) {
      // Categorized, user-safe copy -- never a raw message or alert.
      console.error(err);
      setError(workflowActionErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const dateId = `${baseId}-date`;
  const startId = `${baseId}-start`;
  const endId = `${baseId}-end`;
  const techPickId = `${baseId}-tech`;

  return (
    <form className="fo-sched-form" onSubmit={handleSchedule}>
      <p className="fo-sched-form__wo">
        Scheduling <strong>{workOrder.woNumber ?? workOrder.id}</strong>
      </p>

      <div className="fo-sched-form__grid">
        <label htmlFor={dateId}>
          Date
          <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label htmlFor={startId}>
          Start
          <input id={startId} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label htmlFor={endId}>
          End
          <input id={endId} type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label htmlFor={techPickId}>
          Technician
          <select id={techPickId} value={techId} onChange={(e) => setTechId(e.target.value)} required>
            <option value="" disabled>
              Select technician…
            </option>
            {techOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? t.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FormError role="alert" className="fo-sched-form__error">{error}</FormError>

      <div className="fo-btn-row">
        <Button type="submit" loading={submitting}>
          Schedule
        </Button>
        <Button type="button" variant="tertiary" className="fo-linkbtn" disabled={submitting} onClick={() => onCancel?.()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
