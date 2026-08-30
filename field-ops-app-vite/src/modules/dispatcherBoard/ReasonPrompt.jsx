import { useEffect, useRef, useState } from "react";

import { Button } from "../../shared/ui/primitives/index.js";

// Dispatch North Star P1v1 · Owner visual correction VC-1.
//
// ════════════════════ WHY THIS IS NOT PlacementDialog ════════════════════
//
// The Owner's finding: dropping a chip onto a lane already states the technician, the start and the
// duration, and then a form opened and asked for all three again. A drag that ends in a form
// re-entering what the drag just said is not a confirmation, it is a re-entry.
//
// So the placement fields are gone. What remains is the ONE thing the gesture genuinely cannot
// supply and the server genuinely requires: the reason.
//
// ════════════════════ WHY A REASON IS STILL ASKED ════════════════════
//
// `rescheduleWorkOrder` and `reassignScheduledWorkOrder` both do
// `unwrap(parseReason(data.reason), "reason")` — a non-empty reason is REQUIRED SERVER-SIDE, not a
// client convention. Three ways to make a drag frictionless were available and two were rejected by
// the Owner: auto-generating the text, and making the argument optional. Auto-filling "Moved from
// 09:00 to 11:15" would restate facts the audit event already carries and would make every
// reschedule reason identical and worthless; making it optional would change certified Scheduling
// semantics. So the prompt stays, and it asks for the only thing worth collecting: WHY.
//
// Initial Schedule takes no reason server-side and therefore gets NO prompt at all — a queue-to-lane
// drag commits directly.
//
// ════════════════════ THE READ-ONLY LINE ════════════════════
//
// `context` restates the placement as a SENTENCE, never as fields. It is there so a dispatcher can
// see what they are about to commit without the dialog pretending those values are still in play.
// Nothing in it is editable; editing happens by dragging again, or by cancelling.
export default function ReasonPrompt({
  title,
  context = null,
  confirmLabel = "Save",
  submitting = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState("");
  const inputRef = useRef(null);

  // Focus lands on the only field there is. A prompt that opens focus-less makes a keyboard user
  // hunt for the input the gesture just summoned on their behalf (VC-3 leans on this).
  useEffect(() => { inputRef.current?.focus(); }, []);

  const canConfirm = reason.trim().length > 0 && !submitting;

  return (
    <div className="ns-dispatch-reason__scrim" role="presentation" onMouseDown={submitting ? undefined : onCancel}>
      <div
        className="ns-dispatch-reason"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !submitting) { e.stopPropagation(); onCancel?.(); }
        }}
      >
        <h2 className="ns-dispatch-reason__title">{title}</h2>
        {context ? <p className="ns-dispatch-reason__context">{context}</p> : null}

        <label className="ns-dispatch-reason__label" htmlFor="ns-dispatch-reason-input">
          Reason for schedule change
        </label>
        <input
          id="ns-dispatch-reason-input"
          ref={inputRef}
          className="ns-dispatch-reason__input"
          type="text"
          value={reason}
          disabled={submitting}
          placeholder="Customer requested later arrival"
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits. The gesture is already made; requiring a mouse trip to a button would
            // reintroduce the friction this correction removes.
            if (e.key === "Enter" && canConfirm) { e.preventDefault(); onConfirm?.(reason.trim()); }
          }}
        />

        {errorMessage ? (
          <p className="ns-dispatch-reason__error" role="alert">{errorMessage}</p>
        ) : null}

        <div className="ns-dispatch-reason__actions">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button onClick={() => onConfirm?.(reason.trim())} disabled={!canConfirm}>
            {submitting ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
