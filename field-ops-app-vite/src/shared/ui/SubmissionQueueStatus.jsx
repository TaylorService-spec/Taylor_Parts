import { Button } from "./primitives/index.js";
import { SUBMISSION_STATE, SUBMISSION_STATE_TEXT } from "../../domain/offlineSubmissionQueue.js";

// OFFLINE / RETRY — what the operator is told about work that has not landed.
//
// ============================ UNVERIFIED IS NOT A SPINNER ============================
//
// The temptation is a small "syncing…" indicator that disappears on its own. That would be a lie of
// omission: an operator who sees a spinner assumes it will resolve, walks away, and never learns it
// did not.
//
// So unverified work is stated in words, stays visible until it settles, and the words say what to
// do about it. Nothing here auto-dismisses.
//
// ============================ A REFUSAL IS NOT A RETRY ============================
//
// Rejected submissions are shown SEPARATELY from ones still trying, because they need a person
// rather than patience — and because a refusal counted alongside successes is a refusal nobody sees.

export default function SubmissionQueueStatus({ summary, queue = [], onRetry, onDismissConfirmed }) {
  if (!summary || (!summary.outstanding && summary.rejected === 0 && summary.confirmed === 0)) return null;

  const rejected = queue.filter((s) => s.state === SUBMISSION_STATE.REJECTED);

  return (
    <section className="fo-queue" aria-label="Work not yet confirmed" role="status" aria-live="polite">
      {summary.unverified > 0 && (
        <p className="fo-queue__line fo-queue__line--unverified">
          <strong>{summary.unverified}</strong>{" "}
          {summary.unverified === 1 ? "submission has" : "submissions have"} been sent but not
          confirmed. {SUBMISSION_STATE_TEXT[SUBMISSION_STATE.UNVERIFIED]}
        </p>
      )}

      {summary.pending > 0 && (
        <p className="fo-queue__line">
          <strong>{summary.pending}</strong> waiting to send.
        </p>
      )}

      {rejected.length > 0 && (
        // Separate, and named. These do not resolve themselves.
        <div className="fo-queue__rejected">
          <p className="fo-queue__line fo-queue__line--rejected">
            <strong>{rejected.length}</strong> refused — {SUBMISSION_STATE_TEXT[SUBMISSION_STATE.REJECTED]}
          </p>
          <ul className="fo-list">
            {rejected.map((s) => (
              <li key={s.idempotencyKey} className="fo-muted">
                {s.describe} — {s.lastError}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="fo-queue__controls">
        {(summary.pending > 0 || summary.unverified > 0) && onRetry && (
          <Button type="button" variant="secondary" onClick={onRetry}>Try again now</Button>
        )}
        {summary.confirmed > 0 && onDismissConfirmed && (
          <Button type="button" variant="secondary" onClick={onDismissConfirmed}>
            Clear {summary.confirmed} confirmed
          </Button>
        )}
      </div>
    </section>
  );
}
