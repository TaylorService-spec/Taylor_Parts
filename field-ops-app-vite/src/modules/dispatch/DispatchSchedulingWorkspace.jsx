import { useMemo, useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { FormError } from "../../shared/ui/form";
import { useSchedulingData } from "../../hooks/useSchedulingData";
import { workOrderPriorityLabel } from "../../domain/workOrderPriority";
import { workOrderStatusTone } from "../../domain/coordinatedVisit";
import { technicianStatusTone } from "../../domain/technicianStatusTone";
import { TECH_STATUS } from "../../domain/constants";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";
import { transitionWorkOrder } from "../../services/workOrderService";
import {
  buildDayBoard,
  buildHourTicks,
  buildDropDefaults,
} from "../../domain/dispatchSchedulingBoard";
import { buildScheduleInput } from "../../domain/schedulingWorkspace";
import { WORK_ORDER_STATUS_LABEL } from "../../domain/workOrderStatus";

// Wave 7 completion, PART 1 -- the combined Dispatch / Scheduling operating workspace.
//
// This screen is NOT a new scheduling engine. Every fact it renders and every write it can trigger comes
// from authority that already exists and is already deployed:
//   - board shape / ready queue / overlap+past-due detection : domain/schedulingWorkspace.js
//     (buildWeeklySchedule, via domain/dispatchSchedulingBoard.js's buildDayBoard slice)
//   - the timeline positions + priority grouping             : domain/dispatchSchedulingBoard.js (this
//     Part's own pure additions -- positioning math + a real-field grouping, no lifecycle, no scoring)
//   - the ONE write (placing a Work Order on a technician/time slot) : the already-deployed
//     transitionWorkOrder("Schedule", ...) Cloud Function, called with domain/schedulingWorkspace.js's
//     buildScheduleInput()-validated payload -- never a direct Firestore field write.
//   - status colour                                          : domain/coordinatedVisit.js's
//     workOrderStatusTone (existing status->tone map, reused, not reinvented)
//   - technician current-status colour                       : domain/technicianStatusTone.js (existing)
//   - Suggested Tech                                         : NOT wired here -- dispatchScoring.js scores
//     a job against ALL technicians, but this board's rows are already technician-scoped by drop target, so
//     nothing here needed a per-drop recommendation. See report for why this is an honest omission, not a
//     missed integration.
//
// Layout: TIME is the horizontal axis (left = start of the visible window, right = end), TECHNICIANS are
// rows. "Ready for Work" renders exactly ONCE, below the board (never in a side rail) -- grouped by
// priority, the one real governed field unscheduled work carries (see dispatchSchedulingBoard.js's header
// for why duration grouping has no authority to build on).
//
// Drag/drop -> Schedule: dropping a Ready-for-Work card onto a technician row's time axis NEVER writes
// directly. It opens a small inline confirm step pre-filled from the drop (date + start time from the x
// position, technician from the row, a SUGGESTED +60min end the dispatcher must review) and calls
// transitionWorkOrder("Schedule", ...) only when the dispatcher explicitly confirms. This is deliberate,
// not a shortcut: SCHEDULED work orders cannot be re-timed by this codebase's deployed transitions
// (SCHEDULED -> {DISPATCHED, CANCELLED} only -- see schedulingWorkspace.js's header), so silently writing a
// guessed end time from a drop would be irreversible without cancelling the Work Order. No optimistic
// move ever happens -- the board only ever reflects the live governed read, so a cancelled or denied drop
// leaves the card exactly where it was.

function fmtTime(ms) {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDayHeading(ms) {
  return new Date(ms).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}
function addDaysMillis(ms, n) {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfTodayMillis(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const WO_STATUS_LABEL = WORK_ORDER_STATUS_LABEL;

// One WO status -> the SAME tone workOrderStatusTone (coordinatedVisit.js) already assigns elsewhere,
// so a status never reads as one colour on this board and another colour on the Coordinated Visits rollup.
function StatusChip({ status }) {
  return <StatusPill tone={workOrderStatusTone(status)} label={WO_STATUS_LABEL[status] ?? status ?? "Unknown"} asText />;
}

export default function DispatchSchedulingWorkspace({ nowMillis, initialDayMillis } = {}) {
  const { workOrders, technicians, loading, error } = useSchedulingData();
  const now = nowMillis ?? Date.now();
  const [dayMillis, setDayMillis] = useState(() => initialDayMillis ?? startOfTodayMillis(now));
  const [dragWo, setDragWo] = useState(null); // the Ready-for-Work row currently being dragged
  const [dropTarget, setDropTarget] = useState(null); // { techId, offsetFraction } while dragging over a row
  const [pendingDrop, setPendingDrop] = useState(null); // { wo, techId, defaults } awaiting confirm
  const [scheduleError, setScheduleError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [openJob, setOpenJob] = useState(null);

  const board = useMemo(
    () => buildDayBoard({ workOrders, technicians, dayMillis, nowMillis: now }),
    [workOrders, technicians, dayMillis, now]
  );
  const hourTicks = useMemo(() => buildHourTicks(board.windowStartHour, board.windowEndHour), [board.windowStartHour, board.windowEndHour]);

  const techNameById = useMemo(() => {
    const m = new Map();
    for (const t of technicians) m.set(t.id, t.name ?? t.id);
    return m;
  }, [technicians]);

  if (loading) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Dispatch / Scheduling" />
        <LoadingState>Loading the dispatch board…</LoadingState>
      </div>
    );
  }
  if (error) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Dispatch / Scheduling" />
        <FailureState
          title="Board unavailable"
          message="The dispatch board could not be loaded. You may not have access, or the connection failed. Try again later."
        />
      </div>
    );
  }

  function handleDragStart(wo) {
    setDragWo(wo);
  }
  function handleDragEnd() {
    setDragWo(null);
    setDropTarget(null);
  }
  function handleRowDragOver(e, techId) {
    if (!dragWo) return;
    e.preventDefault(); // required to allow a drop
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetFraction = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    setDropTarget({ techId, offsetFraction: Math.min(Math.max(offsetFraction, 0), 1) });
  }
  function handleRowDrop(e, techId) {
    e.preventDefault();
    if (!dragWo) return;
    const offsetFraction = dropTarget?.techId === techId ? dropTarget.offsetFraction : 0.5;
    const defaults = buildDropDefaults({ dayStartMillis: board.dayMillis, offsetFraction, techId, windowStartHour: board.windowStartHour, windowEndHour: board.windowEndHour });
    setPendingDrop({ wo: dragWo, techId, defaults });
    setScheduleError(null);
    setDragWo(null);
    setDropTarget(null);
  }

  async function confirmDrop(formValues) {
    if (!pendingDrop) return;
    setScheduleError(null);
    const built = buildScheduleInput(formValues);
    if (!built.ok) {
      setScheduleError(SCHEDULE_INPUT_MESSAGE[built.error] ?? "Check the scheduling details and try again.");
      return;
    }
    setSubmitting(true);
    try {
      // The ONE write, unchanged from ScheduleWorkOrderForm's own call -- same action, same payload shape,
      // same server-side re-validation. Nothing about the placement is decided/committed client-side; the
      // board only ever reflects the live read that follows a successful call (no optimistic move above).
      await transitionWorkOrder(pendingDrop.wo.id, "Schedule", built.value);
      setPendingDrop(null); // success -- the live subscription re-renders the board with the real placement
    } catch (err) {
      console.error(err);
      // Denied/invalid: the card was never moved (no optimistic state), so it is already "back" in the
      // Ready-for-Work queue below. The pending confirm step stays open with an honest error so the
      // dispatcher can see why and retry or cancel.
      setScheduleError(workflowActionErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function cancelDrop() {
    setPendingDrop(null);
    setScheduleError(null);
  }

  return (
    <div className="fo-panel fo-dboard">
      <WorkspaceHeader title="Dispatch / Scheduling" />

      <div className="fo-dboard-toolbar">
        <div className="fo-dboard-daynav" role="group" aria-label="Day navigation">
          <button type="button" onClick={() => setDayMillis((d) => addDaysMillis(d, -1))}>‹ Previous day</button>
          <button type="button" onClick={() => setDayMillis(startOfTodayMillis(now))}>Today</button>
          <button type="button" onClick={() => setDayMillis((d) => addDaysMillis(d, 1))}>Next day ›</button>
          <span className="fo-dboard-daylabel">{fmtDayHeading(board.dayMillis)}</span>
        </div>
        <div className="fo-dboard-summary">
          <span className="fo-dboard-stat"><strong>{board.totals.scheduledToday}</strong> scheduled today</span>
          <span className="fo-dboard-stat"><strong>{board.totals.readyToSchedule}</strong> ready for work</span>
          {board.needsAttentionToday.length > 0 && (
            <span className="fo-dboard-stat fo-dboard-stat--warn"><strong>{board.needsAttentionToday.length}</strong> need attention</span>
          )}
        </div>
      </div>

      {/* THE BOARD -- time runs left to right; one row per technician. Manual placement only (drag a
          Ready-for-Work card onto a row, or click "Schedule" on the card below -- both go through the same
          governed confirm step). No auto-assign anywhere on this screen. */}
      <section className="fo-dboard-timeline" aria-label="Technician schedule board, today">
        {board.technicianRows.length === 0 ? (
          <p className="fo-muted">No technicians exist yet. Add technicians in Administration to schedule work.</p>
        ) : (
          <div className="fo-dboard-timelinescroll">
            <div className="fo-dboard-timelinegrid">
              <div className="fo-dboard-timelinegrid__corner" />
              <div className="fo-dboard-timelinegrid__axis">
                {hourTicks.map((t) => (
                  <span key={t.hour} className="fo-dboard-tick" style={{ left: `${t.leftPct}%` }}>{t.label}</span>
                ))}
              </div>
              {board.technicianRows.map((row) => (
                <TechRow
                  key={row.tech.id}
                  row={row}
                  isDropTarget={dropTarget?.techId === row.tech.id}
                  dropOffsetFraction={dropTarget?.techId === row.tech.id ? dropTarget.offsetFraction : null}
                  onDragOver={(e) => handleRowDragOver(e, row.tech.id)}
                  onDrop={(e) => handleRowDrop(e, row.tech.id)}
                  onOpenJob={setOpenJob}
                />
              ))}
            </div>
          </div>
        )}
        {board.unassignedScheduledToday.length > 0 && (
          <div className="fo-dboard-unassigned">
            <h4>Scheduled today, no matching technician</h4>
            <ul>
              {board.unassignedScheduledToday.map((job) => (
                <li key={job.id}>
                  <button type="button" className="fo-linkbtn" onClick={() => setOpenJob(job)}>{job.woNumber}</button>{" "}
                  <span className="fo-muted">{fmtTime(job.startMillis)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* READY FOR WORK -- renders EXACTLY ONCE, below the board (never a side rail; never duplicated). */}
      <section className="fo-dboard-ready" aria-label="Ready for Work">
        <h3 className="fo-dboard-ready__title">Ready for Work{board.readyToSchedule.length > 0 ? ` (${board.readyToSchedule.length})` : ""}</h3>
        {board.readyToSchedule.length === 0 ? (
          <p className="fo-muted">No work is waiting to be scheduled.</p>
        ) : (
          <>
            <p className="fo-muted fo-dboard-ready__hint">
              Drag a card onto a technician's row to place it, or use Schedule below. Grouped by priority --
              there is no estimated-duration field on a Work Order to group by.
            </p>
            {board.readyGroups.map((group) => (
              <div key={group.key} className="fo-dboard-readygroup">
                <h4 className="fo-dboard-readygroup__title">{group.label} <span className="fo-muted">({group.items.length})</span></h4>
                <ul className="fo-dboard-readygroup__list">
                  {group.items.map((wo) => (
                    <li key={wo.id}>
                      <ReadyCard
                        wo={wo}
                        onDragStart={() => handleDragStart(wo)}
                        onDragEnd={handleDragEnd}
                        onSchedule={() => {
                          setPendingDrop({ wo, techId: technicians[0]?.id ?? null, defaults: buildDropDefaults({ dayStartMillis: board.dayMillis, offsetFraction: 0.5, techId: technicians[0]?.id ?? null, windowStartHour: board.windowStartHour, windowEndHour: board.windowEndHour }) });
                          setScheduleError(null);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {pendingDrop && (
        <DropConfirm
          pendingDrop={pendingDrop}
          technicians={technicians}
          submitting={submitting}
          error={scheduleError}
          onConfirm={confirmDrop}
          onCancel={cancelDrop}
        />
      )}

      {openJob && (
        <JobDetail job={openJob} techName={openJob.techId ? techNameById.get(openJob.techId) : null} onClose={() => setOpenJob(null)} />
      )}
    </div>
  );
}

// One technician row: a name/status cell + the time-axis track jobs are absolutely positioned on.
function TechRow({ row, isDropTarget, dropOffsetFraction, onDragOver, onDrop, onOpenJob }) {
  const tech = row.tech;
  return (
    <>
      <div className="fo-dboard-row__tech">
        <span className="fo-dboard-row__techname">{tech.name ?? tech.id}</span>
        {tech.status ? (
          <StatusPill tone={technicianStatusTone(tech.status)} label={tech.status === TECH_STATUS.OFF_SHIFT ? "Off shift" : tech.status === TECH_STATUS.ON_JOB ? "On job" : "Available"} asText />
        ) : null}
      </div>
      <div
        className={["fo-dboard-row__track", isDropTarget ? "is-droptarget" : ""].filter(Boolean).join(" ")}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="group"
        aria-label={`${tech.name ?? tech.id}'s schedule`}
      >
        {row.jobs.map((job) => (
          <button
            type="button"
            key={job.id}
            className={["fo-dboard-chip", row.overlapIds.has(job.id) ? "fo-dboard-chip--overlap" : ""].filter(Boolean).join(" ")}
            style={{ left: `${job.slot?.leftPct ?? 0}%`, width: `${job.slot?.widthPct ?? 4}%` }}
            onClick={() => onOpenJob(job)}
            title={row.overlapIds.has(job.id) ? "Overlaps another job" : undefined}
          >
            <span className="fo-dboard-chip__wo">{job.woNumber}</span>
            <StatusChip status={job.status} />
            <span className="fo-dboard-chip__time">{fmtTime(job.startMillis)}{job.endMillis ? `–${fmtTime(job.endMillis)}` : ""}</span>
            {row.overlapIds.has(job.id) ? <span className="fo-dboard-chip__flag" aria-label="Scheduling overlap">⚠</span> : null}
          </button>
        ))}
        {isDropTarget && dropOffsetFraction != null && (
          <div className="fo-dboard-dropghost" style={{ left: `${dropOffsetFraction * 100}%` }} aria-hidden="true" />
        )}
      </div>
    </>
  );
}

// A single Ready-for-Work card -- draggable, and a "Schedule" fallback button for non-drag input (keyboard/
// touch), both routing to the SAME governed confirm step.
function ReadyCard({ wo, onDragStart, onDragEnd, onSchedule }) {
  return (
    <div
      className="fo-dboard-readycard"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="fo-dboard-readycard__head">
        <span className="fo-dboard-readycard__wo">{wo.woNumber}</span>
        <StatusChip status={wo.status} />
      </div>
      {wo.type ? <div className="fo-muted">{wo.type}</div> : null}
      <button type="button" onClick={onSchedule}>Schedule</button>
    </div>
  );
}

const SCHEDULE_INPUT_MESSAGE = {
  TECH_REQUIRED: "Select a technician.",
  DATE_REQUIRED: "Choose a date.",
  TIME_REQUIRED: "Enter a start and end time.",
  TIME_INVALID: "Enter a valid date and time.",
  END_BEFORE_START: "The end time must be after the start time.",
};

// The governed confirm step: prefilled from the drop (or from the fallback "Schedule" button), but nothing
// is written until the dispatcher explicitly confirms. Uses the SAME buildScheduleInput validator and the
// SAME transitionWorkOrder("Schedule", ...) call the standalone ScheduleWorkOrderForm uses -- this is a
// differently-prefilled shell over the identical governed path, not a second implementation of it.
function DropConfirm({ pendingDrop, technicians, submitting, error, onConfirm, onCancel }) {
  const [date, setDate] = useState(pendingDrop.defaults.date);
  const [start, setStart] = useState(pendingDrop.defaults.start);
  const [end, setEnd] = useState(pendingDrop.defaults.end);
  const [techId, setTechId] = useState(pendingDrop.defaults.techId ?? "");

  const techOptions = [...technicians].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));

  return (
    <div className="fo-dboard-confirm" role="dialog" aria-label={`Schedule ${pendingDrop.wo.woNumber}`}>
      <form
        className="fo-sched-form"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ date, start, end, techId });
        }}
      >
        <p className="fo-sched-form__wo">
          Scheduling <strong>{pendingDrop.wo.woNumber ?? pendingDrop.wo.id}</strong> -- confirm the placement.
        </p>
        <p className="fo-muted">The end time is a suggestion (no estimated-duration field exists on this Work Order) -- review before confirming.</p>
        <div className="fo-sched-form__grid">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
          <label>
            Technician
            <select value={techId} onChange={(e) => setTechId(e.target.value)} required>
              <option value="" disabled>Select technician…</option>
              {techOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? t.id}</option>
              ))}
            </select>
          </label>
        </div>
        <FormError role="alert" className="fo-sched-form__error">{error}</FormError>
        <div className="fo-btn-row">
          <button type="submit" disabled={submitting}>{submitting ? "Scheduling…" : "Confirm & Schedule"}</button>
          <button type="button" className="fo-linkbtn" disabled={submitting} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// Read-only drill-down for an opened job -- honest about what the board knows, no editing here.
function JobDetail({ job, techName, onClose }) {
  return (
    <div className="fo-sched-detail" role="dialog" aria-label={`Work order ${job.woNumber}`}>
      <div className="fo-sched-detail__head">
        <strong>{job.woNumber}</strong>
        <button type="button" className="fo-linkbtn" onClick={onClose}>Close</button>
      </div>
      <dl className="fo-sched-detail__grid">
        <dt>Status</dt><dd><StatusChip status={job.status} /></dd>
        <dt>When</dt><dd>{job.startMillis != null ? new Date(job.startMillis).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}{job.endMillis ? ` – ${fmtTime(job.endMillis)}` : ""}</dd>
        <dt>Technician</dt><dd>{techName ?? job.techId ?? "—"}</dd>
        <dt>Priority</dt><dd>{workOrderPriorityLabel(job.priority) ?? "—"}</dd>
        <dt>Type</dt><dd>{job.type ?? "—"}</dd>
        <dt>Customer</dt><dd>{job.customerId ?? "—"}</dd>
        <dt>Location</dt><dd>{job.locationId ?? "—"}</dd>
      </dl>
    </div>
  );
}
