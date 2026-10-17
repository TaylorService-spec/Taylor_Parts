import { useCallback, useEffect, useState } from "react";

import RuledSection from "../../shared/ui/RuledSection.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { workOrderApiClient } from "../../services/workOrderApiClient.js";
import { useMyWorkOrderCapabilities } from "../../hooks/useMyWorkOrderCapabilities.js";
import { resolveScheduleEditReady } from "../../config/employeeScheduleReadiness.js";
import { blockedKindChipLabel } from "../../domain/schedulingRefusal.js";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";
import {
  WEEKDAYS,
  copyDay,
  currentSchedules,
  describeDay,
  formFromWeeklyHours,
  isTimeZone,
  weeklyHoursFromForm,
} from "../../domain/employeeWorkSchedule.js";

// Administration → Employees → Employee record → Work Schedule (Scheduling PR-2).
//
// ONE AUTHORITY, SHOWN WHERE PEOPLE ARE MANAGED. The schedule lives in EOS Core (eos_workforce.technician_* tables,
// workOrderAvailability.ts); this tab is a window onto it, not a second store. It reads through readEmployeeWorkSchedule,
// whose gate is SCH-D2 as amended and decided on the SERVER: scheduling capability AND employee.record.read AND company
// authority over this Employee. A refusal renders as a refusal — never as an empty or partial schedule.
//
// EDITING IS BUILT AND HELD. The edit controls call the governed commands (company-isolated by G-9) but render only when
// BOTH the fail-closed readiness seam (config/employeeScheduleReadiness.js) is on AND the caller holds
// workOrder.lifecycle.schedule. While the seam is off the tab makes no capability call and no command call.
//
// NO DEFAULT HOURS, ANYWHERE. "No working schedule recorded" is a fact and is said as one; the editor starts empty.

const SCHEDULE_CAPABILITY = "workOrder.lifecycle.schedule";
const KINDS = ["PTO", "LUNCH", "TRAINING", "MEETING", "TRUCK_SERVICE", "UNAVAILABLE", "COMPANY_CLOSURE"];

/** Server refusal codes in words. Unknown codes fall through to a sentence that names no code. */
const REFUSAL_WORDS = Object.freeze({
  EFFECTIVE_FROM_IN_PAST: "A new schedule cannot start in the past. Choose today or a later date.",
  EFFECTIVE_FROM_INVALID: "Choose the date the new schedule starts.",
  TIME_ZONE_INVALID: "Enter a valid time zone, for example America/Phoenix.",
  WEEKLY_HOURS_INVALID: "One of the working intervals is not valid.",
  WEEKLY_HOURS_EMPTY: "A schedule needs at least one working interval.",
  WORKING_INTERVAL_INVALID: "An interval must end after it starts.",
  WORKING_INTERVALS_OVERLAP: "Two intervals on the same day overlap.",
  REASON_REQUIRED: "Say why.",
  REASON_INVALID: "The reason must be at most 500 characters.",
  UNAVAILABILITY_END_NOT_AFTER_START: "The exception must end after it starts.",
  UNAVAILABILITY_TOO_LONG: "An exception can be at most 90 days.",
  UNAVAILABILITY_ALREADY_ENDED: "That exception was already ended.",
  UNAVAILABILITY_ALREADY_OVER: "That exception is already over.",
  CAPABILITY_MISSING: "You do not have permission to change work schedules.",
  COMPANY_AUTHORITY_REQUIRED: "You do not have access to this Employee's operating company.",
  EMPLOYEE_NOT_FOUND: "This Employee is not available to you.",
  OPERATING_COMPANY_NOT_GOVERNED: "That operating company is not available to you.",
});
const refusalWords = (res) => REFUSAL_WORDS[res?.reason] ?? "The change was refused and nothing was saved.";

const dateTime = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const appliesTo = (companyId) => (companyId ? operatingCompanyLabel(companyId, { short: false }) : "All companies");

export default function EmployeeWorkSchedule({ employeeId, client = workOrderApiClient, editReady = undefined }) {
  const ready = resolveScheduleEditReady(editReady);
  // Asked ONLY when editing is ready: a held seam makes no capability call at all.
  const capabilities = useMyWorkOrderCapabilities({ client, enabled: ready });
  const canEdit = ready && capabilities.has(SCHEDULE_CAPABILITY);

  const [read, setRead] = useState({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setRead({ status: "loading" });
    Promise.resolve(client.call("readEmployeeWorkSchedule", { employeeId })).then((res) => {
      if (!alive) return;
      setRead(res?.ok ? { status: "ready", data: res.result } : { status: "failed", failure: res });
    });
    return () => { alive = false; };
  }, [client, employeeId, reloadKey]);

  if (read.status === "loading") return <p className="ns-section__meta" role="status">Loading the work schedule…</p>;
  if (read.status === "failed") {
    const refused = ["FORBIDDEN", "NOT_FOUND"].includes(read.failure?.code);
    return (
      <div className="fo-work-schedule" data-state={refused ? "refused" : "failed"}>
        <p role={refused ? undefined : "alert"}>
          {refused
            ? "The work schedule is visible to scheduling roles that can see this Employee's record and operating company."
            : "The work schedule could not be read just now. Nothing about it is assumed."}
        </p>
        {refused ? null : <Button variant="secondary" onClick={reload}>Retry</Button>}
      </div>
    );
  }

  const { schedules = [], schedulesHasMore, exceptions = [], operatingCompanyId } = read.data;
  const current = currentSchedules(schedules);
  const others = schedules.filter((s) => s.status !== "CURRENT");

  return (
    <div className="fo-work-schedule">
      <RuledSection title="Current Schedule" meta="Governed in EOS Core · used by the Dispatch board and placement checks">
        {current.length === 0 ? (
          <p className="fo-work-schedule__none">
            No working schedule recorded. The Dispatch board shows this person as <b>No schedule</b>, and placements
            are refused until one is recorded. EOS never assumes default hours.
          </p>
        ) : current.map((s) => <ScheduleTable key={s.scheduleId} schedule={s} />)}
      </RuledSection>

      {canEdit ? (
        <ScheduleEditor client={client} employeeId={employeeId} operatingCompanyId={operatingCompanyId}
          basis={current[0] ?? null} onSaved={reload} />
      ) : null}

      <RuledSection title="Upcoming and History" meta="Schedules are replaced, never edited">
        {others.length === 0 ? <p className="ns-section__meta">No other schedules recorded.</p> : (
          <ul className="fo-work-schedule__history">
            {others.map((s) => (
              <li key={s.scheduleId}>
                <b>{s.status === "UPCOMING" ? "Starts" : "Ran"} {s.effectiveFrom}{s.effectiveTo ? ` to ${s.effectiveTo}` : ""}</b>
                {" · "}{appliesTo(s.operatingCompanyId)} · {s.timeZone}
                <div className="ns-section__meta">{WEEKDAYS.map(({ key, label }) => `${label} ${describeDay(s.weeklyHours?.[key])}`).join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
        {schedulesHasMore ? <p className="ns-section__meta">Older schedules exist and are not listed here.</p> : null}
      </RuledSection>

      <RuledSection title="Exceptions" meta="PTO and other unavailability · last 30 days and next 90">
        {exceptions.length === 0 ? <p className="ns-section__meta">No exceptions in this window.</p> : (
          <ul className="fo-work-schedule__exceptions">
            {exceptions.map((x) => (
              <ExceptionRow key={x.unavailabilityId} exception={x} canEdit={canEdit} client={client} onSaved={reload} />
            ))}
          </ul>
        )}
        {canEdit ? <ExceptionForm client={client} employeeId={employeeId} onSaved={reload} /> : null}
      </RuledSection>
    </div>
  );
}

function ScheduleTable({ schedule }) {
  return (
    <div className="fo-work-schedule__current">
      <p className="ns-section__meta">
        Since {schedule.effectiveFrom}{schedule.effectiveTo ? ` until ${schedule.effectiveTo}` : ""} · {schedule.timeZone} · applies to {appliesTo(schedule.operatingCompanyId)}
      </p>
      <table className="fo-table fo-work-schedule__week">
        <caption className="sr-only">Weekly working hours</caption>
        <tbody>
          {WEEKDAYS.map(({ key, label }) => (
            <tr key={key}><th scope="row">{label}</th><td>{describeDay(schedule.weeklyHours?.[key])}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExceptionRow({ exception: x, canEdit, client, onSaved }) {
  const [ending, setEnding] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState(null);
  const active = !x.ended && x.endMillis > Date.now();
  const submit = async () => {
    const res = await client.call("endTechnicianUnavailability", { unavailabilityId: x.unavailabilityId, reason: reason.trim() });
    if (res?.ok) { setEnding(false); onSaved(); } else setMessage(refusalWords(res));
  };
  return (
    <li>
      <b>{blockedKindChipLabel(x.kind)}</b> · {dateTime(x.startMillis)} – {dateTime(x.endMillis)}
      {x.ended ? " · ended early" : ""}{x.reason ? ` · ${x.reason}` : ""}
      {canEdit && active && !ending ? <> {" "}<Button variant="tertiary" onClick={() => setEnding(true)}>End early</Button></> : null}
      {ending ? (
        <span className="fo-work-schedule__inline">
          <label>Why <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
          <Button variant="secondary" disabled={!reason.trim()} onClick={submit}>End exception</Button>
          <Button variant="tertiary" onClick={() => setEnding(false)}>Cancel</Button>
        </span>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </li>
  );
}

function ExceptionForm({ client, employeeId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("PTO");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState(null);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Add exception</Button>;
  const submit = async (e) => {
    e.preventDefault();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) { setMessage("Choose a start and an end."); return; }
    const res = await client.call("recordTechnicianUnavailability",
      { employeeId, kind, start: startMs, end: endMs, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    if (res?.ok) { setOpen(false); onSaved(); } else setMessage(refusalWords(res));
  };
  return (
    <form className="fo-work-schedule__form" onSubmit={submit} aria-label="Add exception">
      <label>Kind <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map((k) => <option key={k} value={k}>{blockedKindChipLabel(k)}</option>)}
      </select></label>
      <label>Starts <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
      <label>Ends <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
      <label>Reason <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <Button type="submit">Record exception</Button>
      <Button variant="tertiary" onClick={() => setOpen(false)}>Cancel</Button>
      {message ? <p role="alert">{message}</p> : null}
    </form>
  );
}

function ScheduleEditor({ client, employeeId, operatingCompanyId, basis, onSaved }) {
  const [open, setOpen] = useState(false);
  // Starts from the CURRENT governed schedule when there is one; otherwise EMPTY. Never a default shift.
  const [form, setForm] = useState(() => formFromWeeklyHours(basis?.weeklyHours));
  const [timeZone, setTimeZone] = useState(basis?.timeZone ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey());
  const [companyScoped, setCompanyScoped] = useState(Boolean(basis?.operatingCompanyId));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState([]);

  if (!open) {
    return (
      <div className="fo-work-schedule__actions">
        <Button onClick={() => setOpen(true)}>{basis ? "Record a new schedule" : "Record schedule"}</Button>
      </div>
    );
  }
  const setRow = (day, idx, patch) => setForm((f) => ({ ...f, [day]: f[day].map((iv, i) => (i === idx ? { ...iv, ...patch } : iv)) }));
  const submit = async (e) => {
    e.preventDefault();
    const built = weeklyHoursFromForm(form);
    const problems = built.ok ? [] : built.errors.map((x) => x.message);
    if (!isTimeZone(timeZone)) problems.push("Enter a valid time zone, for example America/Phoenix.");
    if (problems.length) { setErrors(problems); return; }
    const res = await client.call("setTechnicianWorkingHours", {
      employeeId, timeZone: timeZone.trim(), weeklyHours: built.weeklyHours, effectiveFrom,
      operatingCompanyId: companyScoped ? operatingCompanyId : null,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (res?.ok) { setOpen(false); onSaved(); } else setErrors([refusalWords(res)]);
  };
  return (
    <RuledSection title="Record a New Schedule" meta="Replaces the current schedule from the date you choose; history is kept">
      <form className="fo-work-schedule__form" onSubmit={submit} aria-label="Record a new schedule">
        <label>Starts <input type="date" value={effectiveFrom} min={todayKey()} onChange={(e) => setEffectiveFrom(e.target.value)} required /></label>
        <label>Time zone <input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="e.g. America/Phoenix" required /></label>
        <label><input type="checkbox" checked={companyScoped} onChange={(e) => setCompanyScoped(e.target.checked)} />
          {" "}Only for {appliesTo(operatingCompanyId)} work</label>
        <table className="fo-table fo-work-schedule__week">
          <caption className="sr-only">Working intervals by weekday</caption>
          <tbody>
            {WEEKDAYS.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>
                  {form[key].length === 0 ? <span className="ns-section__meta">Off </span> : null}
                  {form[key].map((iv, idx) => (
                    <span key={idx} className="fo-work-schedule__interval">
                      <input type="time" aria-label={`${label} interval ${idx + 1} start`} value={iv.start} onChange={(e) => setRow(key, idx, { start: e.target.value })} />
                      –
                      <input type="time" aria-label={`${label} interval ${idx + 1} end`} value={iv.end} onChange={(e) => setRow(key, idx, { end: e.target.value })} />
                      <Button variant="tertiary" aria-label={`Remove ${label} interval ${idx + 1}`}
                        onClick={() => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }))}>Remove</Button>
                    </span>
                  ))}
                  <Button variant="tertiary" aria-label={`Add ${label} interval`}
                    onClick={() => setForm((f) => ({ ...f, [key]: [...f[key], { start: "", end: "" }] }))}>Add interval</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="tertiary" onClick={() => setForm((f) => copyDay(f, "1", ["2", "3", "4", "5"]))}>Copy Mon to Tue–Fri</Button>
        <label>Reason <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
        {errors.length ? <ul role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul> : null}
        <Button type="submit">Save new schedule</Button>
        <Button variant="tertiary" onClick={() => setOpen(false)}>Cancel</Button>
      </form>
    </RuledSection>
  );
}
