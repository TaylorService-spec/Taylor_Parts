import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../shared/ui/primitives/index.js";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";
import { SLOT_MS, isSlotSelectable, snapToSlot } from "../../domain/dispatchBoardGeometry.js";

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
    title: "Schedule this work order",
    confirm: "Schedule",
    reasonPrompt: null,
  },
  [PLACEMENT_INTENT.RESCHEDULE]: {
    title: "Move this work order to a new time",
    confirm: "Confirm new time",
    reasonPrompt: "Why is this job being moved?",
  },
  [PLACEMENT_INTENT.REASSIGN]: {
    title: "Reassign this work order",
    confirm: "Confirm reassignment",
    reasonPrompt: "Why is this job being reassigned?",
  },
  [PLACEMENT_INTENT.UNSCHEDULE]: {
    title: "Return this work order to the queue",
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
  const [startLocal, setStartLocal] = useState(() => toLocalInput(defaultStartMillis));
  const [durationMinutes, setDurationMinutes] = useState(defaultDurationMinutes);

  const firstFieldRef = useRef(null);
  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  // Escape closes, matching the board's own keyboard contract (↑↓ selection, Esc clears).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const startMillis = useMemo(() => fromLocalInput(startLocal), [startLocal]);

  const blockedBecause = (() => {
    if (needsReason && reason.trim().length === 0) return "reason";
    if (needsTechnician && !technicianId) return "technician";
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
                min={toLocalInput(earliestSelectableMillis)}
                step={SLOT_MS / 1000}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={submitting}
                aria-describedby="ns-dispatch-dialog-past-note"
              />
              <span id="ns-dispatch-dialog-past-note" className="ns-dispatch-dialog__hint">
                Times already past cannot be chosen.
              </span>
            </label>
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

        {blockedBecause === "past" ? (
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

/** Epoch millis -> the value a datetime-local input wants, in the viewer's own zone. */
function toLocalInput(millis) {
  if (millis == null) return "";
  const d = new Date(millis);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * datetime-local -> epoch millis, interpreted as LOCAL wall-clock.
 *
 * Local on purpose: a dispatcher types "09:00" meaning nine in the morning where the work happens,
 * and the governed availability model stores working hours as local wall-clock strings plus an IANA
 * zone for exactly the same reason. Parsing this as UTC would shift every placement by the viewer's
 * offset and produce out-of-hours warnings nobody could explain.
 */
function fromLocalInput(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const t = parsed.getTime();
  return Number.isFinite(t) ? t : null;
}
