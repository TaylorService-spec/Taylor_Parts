import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";
import Icon from "./Icon.jsx";
import { Button } from "./primitives";
import { Field, FormActions, FormError, FormStatus } from "./form";
import { describedBy } from "./form/fieldA11y";
import { canConfirm } from "../../domain/workflowActionOrder";

// Issue #214 PR-3 -- thin shared confirmation dialog for destructive/consequential
// workflow actions (Work Order Cancel, Reorder Cancel, Purchase Order Void,
// Reorder Reject), built on the shared Modal + System-A form primitives.
//
// It is presentation ONLY: it does not authorize, decide which actions are
// allowed, or write anything. The caller's `onConfirm` performs the actual write
// (a Cloud Function call or a client-direct Rules-gated write) and THROWS on
// failure; this dialog stays open and shows safe categorized copy via `mapError`.
// Firestore Rules / Cloud Functions remain the sole authorities -- confirming here
// grants no authority. Not a schema-driven framework.
//
// Contract: visible title, clear consequence text, optional required reason/notes,
// an explicit destructive confirm label + a secondary Back, FormError + FormStatus,
// a submitting state, duplicate-submit + close-during-submit protection, focus trap
// + Escape/backdrop/close (when not submitting) + focus restoration to the trigger
// (all from Modal), and 375px full-screen (Modal). Never renders a raw error/id.
export default function ConfirmDialog({
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Back",
  // Structural severity signal (icon + accent + button colour together, never
  // colour alone) -- see Icon.jsx's "no colour-alone" convention. Defaults to
  // true: every existing caller of this dialog (Cancel Work Order, Void PO,
  // Delete truck, Cancel Sales Order, Reject Reorder, Advance/Allocate/Create
  // Service) already rendered with the destructive-only `fo-btn-destructive`
  // class before this migration, so `true` is the behavior-preserving
  // default. Passing `destructive={false}` is available for a genuinely
  // routine confirmation once a caller opts in -- see this PR's report for
  // the caller-side follow-up (those files are outside this migration's
  // scope).
  destructive = true,
  requireReason = false,
  reasonLabel = "Reason",
  reasonHint,
  reasonRequiredMessage = "Enter a reason to continue.",
  extraNote,
  onConfirm,
  onClose,
  mapError,
}) {
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const submittingRef = useRef(false);
  const trimmed = reason.trim();
  const reasonError = requireReason && attempted && !trimmed ? reasonRequiredMessage : null;

  // Every close path routes here; ignored while a write is in flight.
  function requestClose() {
    if (submittingRef.current) return;
    onClose();
  }

  async function handleConfirm() {
    if (submittingRef.current) return; // duplicate-submit guard
    setAttempted(true);
    if (!canConfirm({ requireReason, reason })) return; // required reason -- do not write
    setSaveError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm(requireReason ? trimmed : undefined);
      // On success the caller closes this dialog and refreshes; nothing else here.
    } catch (err) {
      // Keep the dialog open with SAFE copy only -- never a raw provider detail.
      console.error("Confirm action failed:", err);
      setSaveError(mapError ? mapError(err) : "The action could not be completed. Nothing was changed.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={requestClose} closeLabel="Close">
      <div className="fo-confirm-dialog fo-create-modal-form">
        {destructive && (
          <p className="fo-warning fo-confirm-severity" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
            <Icon icon={AlertTriangle} size="dense" />
            <span>Destructive action</span>
          </p>
        )}

        {consequence && (
          <p
            className="fo-confirm-consequence"
            style={{
              borderLeft: `3px solid ${destructive ? "var(--color-danger)" : "var(--color-info)"}`,
              paddingLeft: "10px",
              margin: 0,
            }}
          >
            {consequence}
          </p>
        )}

        {requireReason && (
          <Field id="confirm-reason" label={reasonLabel} required error={reasonError} hint={reasonHint}>
            <textarea
              id="confirm-reason"
              className="fo-wizard-control"
              value={reason}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={describedBy("confirm-reason", { hasHint: Boolean(reasonHint), hasError: Boolean(reasonError) })}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}

        {extraNote && <p className="fo-muted fo-confirm-note">{extraNote}</p>}

        <FormError role="alert" className="fo-confirm-error">{saveError}</FormError>
        <FormStatus>{submitting ? "Working…" : ""}</FormStatus>

        <FormActions className="fo-confirm-actions">
          <Button
            type="button"
            variant={destructive ? "destructive" : "primary"}
            onClick={handleConfirm}
            loading={submitting}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={requestClose} disabled={submitting}>
            {cancelLabel}
          </Button>
        </FormActions>
      </div>
    </Modal>
  );
}
