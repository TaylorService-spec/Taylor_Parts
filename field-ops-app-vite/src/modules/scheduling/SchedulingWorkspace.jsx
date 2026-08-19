import { useMemo, useState } from "react";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingState from "../../shared/ui/LoadingState";
import FailureState from "../../shared/ui/FailureState";
import ScheduleWorkOrderForm from "../../shared/scheduling/ScheduleWorkOrderForm";
import Modal from "../../shared/ui/Modal";
import { useSchedulingData } from "../../hooks/useSchedulingData";
import { workOrderPriorityLabel } from "../../domain/workOrderPriority";
import {
  buildWeeklySchedule,
  startOfWeekMillis,
  addWeeks,
} from "../../domain/schedulingWorkspace";

// Service > Scheduling -- the WEEKLY dispatcher scheduling workspace (Enterprise Operations OS
// platform-first; Taylor Parts flagship). A REAL operational planning surface, not a date/time form: it
// composes the governed Work Order read + the governed technician entity into a technician x weekday board
// so a dispatcher/Service Manager can see, at a glance, what is scheduled this week, who owns it, when,
// how loaded each technician is, where the overlaps are, and what still needs scheduling.
//
// The one write is the governed, already-deployed transitionWorkOrder("Schedule", ...) via
// ScheduleWorkOrderForm -- repo-only, no Rules/Functions deploy, no grant, no direct fieldops_wos write.
// READY_TO_SCHEDULE == status READY_TO_DISPATCH (the only status from which Schedule is valid). Changing an
// already-SCHEDULED time (true "reschedule") is NOT a deployed transition, so this surface offers OPEN
// (drill-down) + the future-augmentation seams the Owner named (drag/drop, auto-assign, skills, routing,
// capacity) but NONE of that optimizer behavior. See docs/architecture/ADR-002 + SYSTEM_AUTHORITIES.md.
//
// Access: the Service > Scheduling nav item is admin/dispatcher (PLACEHOLDER_DEFAULT_ROLES). The write
// re-authorizes server-side (Schedule = admin/dispatcher in transitionEngine.ts). Nav visibility is a
// preview, never the security boundary.
//
// Responsive: WEEK is the primary planning horizon on desktop/large tablet. On narrow screens the 7-day
// board is NOT squeezed -- it scrolls horizontally (min-width day columns) AND a Day drill-down gives a
// per-technician agenda for one day, with week + date navigation always preserved.

// Priority vocabulary lives in domain/workOrderPriority.js -- one definition, so a
// record cannot read "High" here and "Priority 2" on the next screen.

function fmtTime(ms) {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDayHeading(ms) {
  return new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric" });
}
function fmtMonthDay(ms) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtWeekRange(weekStartMillis, weekEndMillisExclusive) {
  const lastDay = weekEndMillisExclusive - 24 * 60 * 60 * 1000;
  const year = new Date(weekStartMillis).getFullYear();
  return `${fmtMonthDay(weekStartMillis)} – ${fmtMonthDay(lastDay)}, ${year}`;
}
function fmtWorkload(minutes, jobCount) {
  const jobs = `${jobCount} ${jobCount === 1 ? "job" : "jobs"}`;
  if (!minutes) return jobs;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hrs = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
  return `${jobs} · ${hrs}`;
}

// A single scheduled Work Order chip. Clicking opens its inline detail (the "open a Work Order" affordance).
function JobChip({ job, overlap, onOpen }) {
  const cls = [
    "fo-sched-chip",
    `fo-sched-chip--${job.status?.toLowerCase() ?? "unknown"}`,
    overlap ? "fo-sched-chip--overlap" : "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} onClick={() => onOpen(job)} title={overlap ? "Overlaps another job" : undefined}>
      <span className="fo-sched-chip__wo">{job.woNumber}</span>
      <span className="fo-sched-chip__time">{fmtTime(job.startMillis)}{job.endMillis ? `–${fmtTime(job.endMillis)}` : ""}</span>
      {overlap ? <span className="fo-sched-chip__flag" aria-label="Scheduling overlap">⚠</span> : null}
    </button>
  );
}

// Inline detail for an opened Work Order (the drill-down "open" affordance). Read-only -- editing/dispatch
// stays in the governed Work Order surfaces; this honestly shows what the schedule knows.
//
// Rendered through the shared Modal (src/shared/ui/Modal.jsx) rather than a bare
// role="dialog" div -- a screen-reader/keyboard user who activates a job chip needs
// aria-modal, focus moved into the dialog, a Tab-trap, Escape-to-close, and focus
// restored to the chip on close, which only the shared component actually provides.
function JobDetail({ job, techName, onClose }) {
  return (
    <Modal title={job.woNumber} onClose={onClose} closeLabel="Close">
      <dl className="fo-sched-detail__grid">
        <dt>Status</dt><dd>{job.status}</dd>
        <dt>When</dt><dd>{new Date(job.startMillis).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{job.endMillis ? ` – ${fmtTime(job.endMillis)}` : ""}</dd>
        <dt>Technician</dt><dd>{techName ?? job.techId ?? "—"}</dd>
        <dt>Priority</dt><dd>{workOrderPriorityLabel(job.priority) ?? "—"}</dd>
        <dt>Type</dt><dd>{job.type ?? "—"}</dd>
        <dt>Customer</dt><dd>{job.customerId ?? "—"}</dd>
        <dt>Location</dt><dd>{job.locationId ?? "—"}</dd>
      </dl>
      <p className="fo-muted fo-sched-detail__note">
        Re-timing a scheduled job is a governed follow-on; open the Work Order in Service to dispatch or cancel it.
      </p>
    </Modal>
  );
}

export default function SchedulingWorkspace({ nowMillis, initialWeekStart } = {}) {
  const { workOrders, technicians, loading, error } = useSchedulingData();
  const now = nowMillis ?? Date.now();
  const [weekStart, setWeekStart] = useState(() => initialWeekStart ?? startOfWeekMillis(now));
  const [view, setView] = useState("week"); // "week" | "day"
  const [focusDayIndex, setFocusDayIndex] = useState(null); // for the day drill-down
  const [schedulingWo, setSchedulingWo] = useState(null); // Ready-to-Schedule row being scheduled
  const [openJob, setOpenJob] = useState(null);

  const vm = useMemo(
    () => buildWeeklySchedule({ workOrders, technicians, weekStartMillis: weekStart, nowMillis: now }),
    [workOrders, technicians, weekStart, now]
  );

  const techNameById = useMemo(() => {
    const m = new Map();
    for (const t of technicians) m.set(t.id, t.name ?? t.id);
    return m;
  }, [technicians]);

  // Dedupe ONCE so the "need attention" summary count and the list below it can never disagree (a job
  // flagged both PAST_DUE and OVERLAP is a single attention item, preferring the OVERLAP label).
  const attention = useMemo(() => dedupeAttention(vm.needsAttention), [vm.needsAttention]);

  if (loading) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scheduling" />
        <LoadingState>Loading the weekly schedule…</LoadingState>
      </div>
    );
  }
  if (error) {
    return (
      <div className="fo-panel">
        <WorkspaceHeader title="Scheduling" />
        <FailureState
          title="Schedule unavailable"
          message="The scheduling data could not be loaded. You may not have access, or the connection failed. Try again later."
        />
      </div>
    );
  }

  function openDay(index) {
    setFocusDayIndex(index);
    setView("day");
  }

  const focusDay = focusDayIndex != null ? vm.days[focusDayIndex] : null;

  return (
    <div className="fo-panel fo-sched">
      <WorkspaceHeader title="Scheduling" />

      {/* Week navigation + view toggle -- always available, in every view. */}
      <div className="fo-sched-toolbar">
        <div className="fo-sched-weeknav" role="group" aria-label="Week navigation">
          <button type="button" onClick={() => setWeekStart((w) => addWeeks(w, -1))}>‹ Previous week</button>
          <button type="button" onClick={() => setWeekStart(startOfWeekMillis(now))}>This week</button>
          <button type="button" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>Next week ›</button>
          <span className="fo-sched-weeklabel">{fmtWeekRange(vm.weekStartMillis, vm.weekEndMillis)}</span>
        </div>
        <div className="fo-sched-viewtoggle" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          <button
            type="button"
            aria-pressed={view === "day"}
            onClick={() => openDay(focusDayIndex ?? todayIndexOr(vm.days, 0))}
          >
            Day
          </button>
        </div>
      </div>

      {/* Summary: answers "what's scheduled / what's unscheduled / how many techs / what needs attention". */}
      <div className="fo-sched-summary">
        <span className="fo-sched-stat"><strong>{vm.totals.scheduledThisWeek}</strong> scheduled this week</span>
        <span className="fo-sched-stat"><strong>{vm.totals.readyToSchedule}</strong> ready to schedule</span>
        <span className="fo-sched-stat"><strong>{vm.totals.technicians}</strong> technicians</span>
        {attention.length > 0 && (
          <span className="fo-sched-stat fo-sched-stat--warn"><strong>{attention.length}</strong> need attention</span>
        )}
      </div>

      <div className="fo-sched-body">
        {/* READY TO SCHEDULE queue -- so a dispatcher never leaves Scheduling to find work awaiting a slot. */}
        <aside className="fo-sched-ready" aria-label="Ready to schedule">
          <h3 className="fo-sched-ready__title">Ready to schedule</h3>
          {vm.readyToSchedule.length === 0 ? (
            <p className="fo-muted">No work is waiting to be scheduled.</p>
          ) : (
            <ul className="fo-sched-ready__list">
              {vm.readyToSchedule.map((wo) => (
                <li key={wo.id} className="fo-sched-ready__item">
                  <div>
                    <span className="fo-sched-ready__wo">{wo.woNumber}</span>
                    {wo.priority ? <span className="fo-muted"> · {workOrderPriorityLabel(wo.priority) ?? ""}</span> : null}
                    {wo.type ? <span className="fo-muted"> · {wo.type}</span> : null}
                  </div>
                  <button type="button" onClick={() => setSchedulingWo(wo)}>Schedule</button>
                </li>
              ))}
            </ul>
          )}

          {schedulingWo && (
            <div className="fo-sched-ready__form">
              <ScheduleWorkOrderForm
                workOrder={schedulingWo}
                technicians={technicians}
                onScheduled={() => setSchedulingWo(null)}
                onCancel={() => setSchedulingWo(null)}
              />
            </div>
          )}

          {attention.length > 0 && (
            <div className="fo-sched-attention">
              <h4 className="fo-sched-attention__title">Needs attention</h4>
              <ul>
                {attention.map((n) => (
                  <li key={`${n.kind}:${n.job.id}`}>
                    <button type="button" className="fo-linkbtn" onClick={() => setOpenJob(n.job)}>
                      {n.job.woNumber}
                    </button>{" "}
                    <span className="fo-muted">{n.kind === "OVERLAP" ? "overlaps another job" : "scheduled in the past"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {vm.unassignedScheduled.length > 0 && (
            <div className="fo-sched-attention">
              <h4 className="fo-sched-attention__title">Scheduled, no matching technician</h4>
              <ul>
                {vm.unassignedScheduled.map((job) => (
                  <li key={job.id}>
                    <button type="button" className="fo-linkbtn" onClick={() => setOpenJob(job)}>{job.woNumber}</button>{" "}
                    <span className="fo-muted">{fmtTime(job.startMillis)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* MAIN board: WEEK grid (primary) or DAY agenda (drill-down). */}
        <section className="fo-sched-main" aria-label="Schedule board">
          {vm.technicianRows.length === 0 ? (
            <p className="fo-muted">No technicians exist yet. Add technicians in Administration to schedule work.</p>
          ) : view === "week" ? (
            <WeekGrid vm={vm} onOpenDay={openDay} onOpenJob={setOpenJob} />
          ) : (
            <DayAgenda vm={vm} day={focusDay} onOpenJob={setOpenJob} onBackToWeek={() => setView("week")} />
          )}
        </section>
      </div>

      {openJob && (
        <JobDetail job={openJob} techName={openJob.techId ? techNameById.get(openJob.techId) : null} onClose={() => setOpenJob(null)} />
      )}
    </div>
  );
}

function todayIndexOr(days, fallback) {
  const idx = days.findIndex((d) => d.isToday);
  return idx === -1 ? fallback : idx;
}

// Needs-attention can list a job twice (past-due AND overlap). Collapse to one row per job, preferring the
// OVERLAP label (the more actionable "fix your board now" signal).
function dedupeAttention(items) {
  const byJob = new Map();
  for (const item of items) {
    const existing = byJob.get(item.job.id);
    if (!existing || (item.kind === "OVERLAP" && existing.kind !== "OVERLAP")) byJob.set(item.job.id, item);
  }
  return [...byJob.values()];
}

// The WEEK board: technician rows x 7 day columns. Horizontally scrollable on narrow screens (min-width
// day columns) so it is never squeezed. Day headings are buttons that drill into the Day agenda.
function WeekGrid({ vm, onOpenDay, onOpenJob }) {
  return (
    <div className="fo-sched-gridscroll">
      <div className="fo-sched-grid" style={{ "--fo-sched-days": vm.days.length }}>
        <div className="fo-sched-grid__corner">Technician</div>
        {vm.days.map((day) => (
          <button
            key={day.index}
            type="button"
            className={["fo-sched-grid__dayhead", day.isToday ? "is-today" : "", day.isWeekend ? "is-weekend" : ""].filter(Boolean).join(" ")}
            onClick={() => onOpenDay(day.index)}
          >
            {fmtDayHeading(day.dateMillis)}
          </button>
        ))}

        {vm.technicianRows.map((row) => (
          <FragmentRow key={row.tech.id} row={row} onOpenJob={onOpenJob} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ row, onOpenJob }) {
  return (
    <>
      <div className="fo-sched-grid__tech">
        <span className="fo-sched-grid__techname">{row.tech.name ?? row.tech.id}</span>
        <span className="fo-sched-grid__techload fo-muted">{fmtWorkload(row.weekMinutes, row.weekJobCount)}</span>
      </div>
      {Object.keys(row.jobsByDay).map((dayIdx) => {
        const jobs = row.jobsByDay[dayIdx];
        return (
          <div key={dayIdx} className="fo-sched-grid__cell">
            {jobs.map((job) => (
              <JobChip key={job.id} job={job} overlap={row.overlapIds.has(job.id)} onOpen={onOpenJob} />
            ))}
          </div>
        );
      })}
    </>
  );
}

// The DAY drill-down: one day, every technician's jobs in a vertical agenda -- the phone-friendly view.
function DayAgenda({ vm, day, onOpenJob, onBackToWeek }) {
  if (!day) return <p className="fo-muted">Select a day from the week to see its agenda.</p>;
  const dayIndex = day.index;
  const rowsWithJobs = vm.technicianRows
    .map((row) => ({ tech: row.tech, jobs: row.jobsByDay[dayIndex], overlapIds: row.overlapIds }))
    .filter((r) => r.jobs.length > 0);

  return (
    <div className="fo-sched-day">
      <div className="fo-sched-day__head">
        <strong>{new Date(day.dateMillis).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</strong>
        <button type="button" className="fo-linkbtn" onClick={onBackToWeek}>Back to week</button>
      </div>
      {rowsWithJobs.length === 0 ? (
        <p className="fo-muted">No work scheduled on this day.</p>
      ) : (
        rowsWithJobs.map((r) => (
          <div key={r.tech.id} className="fo-sched-day__tech">
            <h4>{r.tech.name ?? r.tech.id} <span className="fo-muted">· {r.jobs.length} {r.jobs.length === 1 ? "job" : "jobs"}</span></h4>
            <ul className="fo-sched-day__jobs">
              {r.jobs.map((job) => (
                <li key={job.id}>
                  <JobChip job={job} overlap={r.overlapIds.has(job.id)} onOpen={onOpenJob} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
