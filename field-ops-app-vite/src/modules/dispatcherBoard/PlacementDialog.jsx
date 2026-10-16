import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../shared/ui/primitives/index.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";
import { SLOT_MS, isSlotSelectable, snapToSlot } from "../../domain/dispatchBoardGeometry.js";
import { browserTimeZone, formatZoned, fromZonedInput, toZonedInput } from "../../domain/zonedTime.js";

// Dispatch North Star P1 · frame 1b — the one gate that serves BOTH interaction paths.
//
// ════════════════════ ONE GATE, TWO PATHS, ONE COMMAND ════════════════════
//
// The artifact is explicit: *"One gate serves drag and picker; the server enforces it regardless."*
// So this dialog is not an "accessibility alternative" with its own code path — a drag opens it when
// the move needs a reason, and the "Schedule…" button opens it always. Both end in the SAME
// `onConfirm`, which reaches the same trusted command. An alternate mutation path for keyboard users
// would be a second scheduler, and a second scheduler is the thing this whole family avoids.
//
// It also carries the accessible PLACEMENT path proper: a technician picker and a time field, so a
// dispatcher who cannot drag can still choose where a job goes. Native HTML5 drag-and-drop does not
// work by keyboard and does not work on touch; without this the board would be unusable for both.
//
// ════════════════════ WHAT THIS DOES NOT DECIDE ════════════════════
//
// Nothing here validates a placement. It does not check overlap, blocked time, past starts or
// eligibility, and it must never start: the certified placement policy runs server-side on both
// placement paths (ND-24), and a client copy would be a second policy that drifts. Confirm is
// disabled only for the two things the CLIENT genuinely owns — a missing required reason, and a
// missing target — and the server refuses everything else in words.
//
// ════════════════════ THE DEFAULT IS ASKED, NOT GUESSED (Owner "FIX JOBS AND DISPATCH", 2026-10-16) ════════════════════
//
// The default start used to be the visible band's first hour — already past for today, so the dialog opened refused.
// When the caller passes `suggestPlacement` and no gesture supplied a time, the dialog asks the governed
// suggestWorkOrderPlacement read for the earliest window the placement check would accept, IN THE COMPANY'S BUSINESS TIME
// ZONE, and the time field is read and written in that zone (not the browser's). When no window exists it says why and
// names the earliest alternative. The submit re-checks the clock, and the server still re-validates everything.

export const PLACEMENT_INTENT = Object.freeze({
  SCHEDULE: "SCHEDULE",
  RESCHEDULE: "RESCHEDULE",
  REASSIGN: "REASSIGN",
  UNSCHEDULE: "UNSCHEDULE",
});

/** Which intents demand a typed reason. Reassign is the Owner's H20 ruling; Unschedule is ND-18. */
const REASON_REQUIRED = new Set([PLACEMENT_INTENT.RESCHEDULE, PLACEMENT_INTENT.REASSIGN, PLACEMENT_INTENT.UNSCHEDULE]);

const COPY = {
  [PLACEMENT_INTENT.SCHEDULE]: {
    title: "Schedule This Work Order",
    confirm: "Schedule",
    reasonPrompt: null,
  },
  [PLACEMENT_INTENT.RESCHEDULE]: {
    title: "Move This Work Order to a New Time",
    confirm: "Confirm new time",
    reasonPrompt: "Why is this job being moved?",
  },
  [PLACEMENT_INTENT.REASSIGN]: {
    title: "Reassign This Work Order",
    confirm: "Confirm reassignment",
    reasonPrompt: "Why is this job being reassigned?",
  },
  [PLACEMENT_INTENT.UNSCHEDULE]: {
    title: "Return This Work Order to the Queue",
    confirm: "Return to queue",
    reasonPrompt: "Why is this job being returned to the queue?",
  },
};

export default function PlacementDialog({
  intent,
  workOrder,
  technicians,
  defaultTechnicianId = null,
  defaultStartMillis = null,
  defaultDurationMinutes = 120,
  suggestPlacement = null,
  submitting = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}) {
  const copy = COPY[intent] ?? COPY[PLACEMENT_INTENT.SCHEDULE];
  const needsReason = REASON_REQUIRED.has(intent);
  const needsTechnician = intent === PLACEMENT_INTENT.SCHEDULE || intent === PLACEMENT_INTENT.REASSIGN;
  const needsTime = intent === PLACEMENT_INTENT.SCHEDULE || intent === PLACEMENT_INTENT.RESCHEDULE;

  // VC-4. The earliest start this dialog may offer, snapped UP to the next whole slot. Computed on
  // open rather than continuously: a floor that advanced while someone typed would move the field
  // under them. The server re-checks on submit, so a stale floor costs a refusal, never a bad write.
  const [earliestSelectableMillis] = useState(() => snapToSlot(Date.now() + SLOT_MS));
  const [reason, setReason] = useState("");
  const [technicianId, setTechnicianId] = useState(defaultTechnicianId ?? "");
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);
  // The governed business time zone, once the suggestion names it; the browser's until then (and if the read fails).
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [startLocal, setStartLocal] = useState(() => toZonedInput(defaultStartMillis, browserTimeZone()));
  // A time the dispatcher typed, or one a gesture supplied, is never overwritten by a later suggestion.
  const [timeTouched, setTimeTouched] = useState(defaultStartMillis != null);
  const [suggestion, setSuggestion] = useState({ status: needsTime && suggestPlacement ? "loading" : "idle", result: null });
  const [requestCount, setRequestCount] = useState(0);
  const [staleOnSubmit, setStaleOnSubmit] = useState(false);

  useEffect(() => {
    if (!needsTime || !suggestPlacement) return undefined;
    let alive = true;
    setSuggestion((prev) => ({ status: "loading", result: prev.result }));
    Promise.resolve()
      .then(() => suggestPlacement({ workOrderId: workOrder.id, employeeId: technicianId || null, durationMinutes }))
      .then((res) => {
        if (!alive) return;
        const zone = res?.timeZone || browserTimeZone();
        setTimeZone(zone);
        setSuggestion({ status: "ready", result: res ?? null });
        if (!timeTouched && res?.suggestion) {
          setStartLocal(toZonedInput(Date.parse(res.suggestion.start), zone));
          if (!technicianId && needsTechnician) setTechnicianId(res.suggestion.employeeId);
        } else if (timeTouched && defaultStartMillis != null && startLocal === toZonedInput(defaultStartMillis, browserTimeZone())) {
          // A gesture's instant is kept; only its display moves into the governed zone.
          setStartLocal(toZonedInput(defaultStartMillis, zone));
        }
      }, () => { if (alive) setSuggestion({ status: "failed", result: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-asked when the technician or length changes, or on a stale submit
  }, [technicianId, durationMinutes, requestCount]);

  const firstFieldRef = useRef(null);
  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  // Escape closes, matching the board's own keyboard contract (↑↓ selection, Esc clears).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const startMillis = useMemo(() => fromZonedInput(startLocal, timeZone), [startLocal, timeZone]);

  const blockedBecause = (() => {
    if (needsReason && reason.trim().length === 0) return "reason";
    if (needsTechnician && !technicianId) return "technician";
    if (needsTime && suggestion.status === "loading" && !timeTouched && startMillis == null) return "suggesting";
    if (needsTime && startMillis == null) return "time";
    // VC-4. `min` on a datetime-local is advisory in several browsers and absent in jsdom, so the
    // floor is enforced here as well. This is the one placement question the CLIENT may answer —
    // the clock is not a policy — and the server still re-checks START_IN_PAST regardless.
    if (needsTime && startMillis != null && !isSlotSelectable(startMillis, Date.now())) return "past";
    if (needsTime && !(durationMinutes > 0)) return "duration";
    return null;
  })();

  const submit = () => {
    if (blockedBecause || submitting) return;
    // Re-validated at the moment of submit: a dialog left open can outlive its own default. Never moved forward silently —
    // the dispatcher is told, and a fresh earliest time is asked for.
    if (needsTime && !isSlotSelectable(startMillis, Date.now())) {
      setStaleOnSubmit(true);
      setTimeTouched(false);
      setRequestCount((n) => n + 1);
      return;
    }
    setStaleOnSubmit(false);
    onConfirm?.({
      intent,
      workOrderId: workOrder.id,
      reason: reason.trim(),
      technicianId: technicianId || null,
      startMillis: needsTime ? startMillis : null,
      endMillis: needsTime && startMillis != null ? startMillis + durationMinutes * 60_000 : null,
    });
  };

  return (
    <div className="ns-dispatch-dialog-scrim" role="presentation">
      <div className="ns-dispatch-dialog" role="dialog" aria-modal="true" aria-labelledby="ns-placement-title">
        <h2 className="ns-dispatch-dialog__title" id="ns-placement-title">{copy.title}</h2>
        <p className="ns-dispatch-dialog__subject">
          <strong>{workOrder.woNumber}</strong>
          {workOrderTypeLabel(workOrder.type) ? ` · ${workOrderTypeLabel(workOrder.type)}` : ""}
        </p>

        {needsTechnician ? (
          <label className="ns-dispatch-dialog__field">
            <span>Technician</span>
            <select
              ref={needsTechnician ? firstFieldRef : null}
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              disabled={submitting}
            >
              <option value="">Choose a technician…</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {resolveTechnicianIdentity(t.id, { technicians }).name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {needsTime ? (
          <>
            <label className="ns-dispatch-dialog__field">
              <span>Starts</span>
              <input
                ref={!needsTechnician ? firstFieldRef : null}
                type="datetime-local"
                value={startLocal}
                // VC-4 — the accessible path gets the SAME past-slot prevention as the pointer path.
                // A correction that only fixed dragging would have left the keyboard route offering
                // exactly the placement the server refuses, which is the worse half of the defect.
                min={toZonedInput(earliestSelectableMillis, timeZone)}
                step={SLOT_MS / 1000}
                onChange={(e) => { setTimeTouched(true); setStaleOnSubmit(false); setStartLocal(e.target.value); }}
                disabled={submitting}
                aria-describedby="ns-dispatch-dialog-past-note"
              />
              <span id="ns-dispatch-dialog-past-note" className="ns-dispatch-dialog__hint">
                Times are in {timeZone}{suggestion.status === "failed" ? " (your browser's zone — the company's could not be read)" : ""}.
                Times already past cannot be chosen.
              </span>
            </label>
            <SuggestionNote
              suggestion={suggestion}
              timeZone={timeZone}
              technicians={technicians}
              requestedTechnicianId={technicianId}
              onUseAlternative={(alt) => {
                setTechnicianId(alt.employeeId);
                setTimeTouched(true);
                setStartLocal(toZonedInput(Date.parse(alt.start), timeZone));
              }}
            />
            <label className="ns-dispatch-dialog__field">
              <span>Length</span>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                disabled={submitting}
              >
                {[30, 60, 90, 120, 180, 240, 360, 480].map((m) => (
                  <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60}h`}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {needsReason ? (
          <label className="ns-dispatch-dialog__field">
            <span>{copy.reasonPrompt}</span>
            <textarea
              ref={!needsTechnician && !needsTime ? firstFieldRef : null}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={submitting}
            />
          </label>
        ) : null}

        {/* A refusal that arrived from the server. Rendered as the sentence the domain layer produced,
            never a raw code, and the dialog STAYS OPEN so the dispatcher can correct and retry
            without rebuilding their intent from scratch. */}
        {errorMessage ? (
          <p className="ns-dispatch-dialog__error" role="alert">{errorMessage}</p>
        ) : null}

        <div className="ns-dispatch-dialog__actions">
          <Button onClick={submit} disabled={Boolean(blockedBecause) || submitting} loading={submitting}>
            {copy.confirm}
          </Button>
          <Button variant="tertiary" onClick={onCancel} disabled={submitting}>Cancel</Button>
        </div>

        {staleOnSubmit ? (
          <p className="ns-dispatch-dialog__hint" role="alert">
            That start time passed while this dialog was open. A new earliest time is being looked up — check it, then submit again.
          </p>
        ) : null}
        {blockedBecause === "past" && !staleOnSubmit ? (
          <p className="ns-dispatch-dialog__hint" role="alert">
            That start time has already passed. Choose a later time — it will not be moved forward
            for you.
          </p>
        ) : null}
        {blockedBecause === "reason" ? (
          <p className="ns-dispatch-dialog__hint">Confirm stays disabled until a reason is typed.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Why the default is what it is — or why there is none — in words, with the earliest real alternative. */
function SuggestionNote({ suggestion, timeZone, technicians, requestedTechnicianId, onUseAlternative }) {
  if (suggestion.status === "loading") return <p className="ns-dispatch-dialog__hint" aria-live="polite">Finding the earliest open time…</p>;
  if (suggestion.status === "failed") {
    return <p className="ns-dispatch-dialog__hint" role="status">The earliest open time could not be looked up. Enter a time; it is checked when you submit.</p>;
  }
  const res = suggestion.result;
  if (suggestion.status !== "ready" || !res || res.outcome === "SLOT_FOUND") return null;
  const days = Math.max(1, Math.round((Date.parse(res.searchedTo) - Date.parse(res.searchedFrom)) / 86_400_000));
  const length = res.durationMinutes < 60 ? `${res.durationMinutes}-minute` : `${res.durationMinutes / 60}-hour`;
  const who = requestedTechnicianId ? resolveTechnicianIdentity(requestedTechnicianId, { technicians }).name : null;
  const why = !who
    ? `No technician has an open ${length} window in the next ${days} days.`
    : res.outcome === "NOT_CONFIGURED"
      ? `${who} has no working hours recorded in the next ${days} days.`
      : res.outcome === "NOT_SCHEDULABLE"
        ? `${who} can't be scheduled for this work order.`
        : `${who} has no open ${length} window in the next ${days} days.`;
  const alt = res.alternative;
  return (
    <div className="ns-dispatch-dialog__hint" role="status">
      <p>{why}</p>
      {alt ? (
        <p>
          Earliest open: {resolveTechnicianIdentity(alt.employeeId, { technicians }).name || alt.displayName}, {formatZoned(Date.parse(alt.start), timeZone)}.{" "}
          <Button variant="tertiary" onClick={() => onUseAlternative(alt)}>Use this time</Button>
        </p>
      ) : (
        <p>Enter a time to try anyway — it is checked when you submit.</p>
      )}
    </div>
  );
}

