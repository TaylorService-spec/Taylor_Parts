import { useState } from "react";
import { useCrmActivities } from "../../hooks/useCrmActivities.js";
import { useCrmActivityActions } from "../../hooks/useCrmActivityActions.js";
import { useEmployeeDirectory, resolveActorDisplayName } from "../../hooks/useEmployeeDirectory.js";
import { crmActivityView, CRM_ACTIVITY_VIEW_STATE } from "../../domain/crmActivityView.js";
import { CRM_ACTIVITY_TYPES, crmActivityTypeLabel } from "../../domain/crmActivityTypes.js";
import Modal from "../../shared/ui/Modal.jsx";
import FailureState from "../../shared/ui/FailureState";

// CRM Activity / Notes (Taylor EOS Wave 7 extension, PART 1.4) -- the governed replacement path for the
// single free-text `account.notes` blob. Reads via the trusted getCrmActivities callable, writes via the
// trusted createCrmActivity callable (both capabilities registered active:false today -- a persona
// without a live grant + per-environment activation gets an honest DENIED state here, never a fabricated
// empty/zero, exactly like AccountArSection's own finance.read posture).
//
// SELF-CONTAINED BY DESIGN: this component takes only `accountId` as a prop and owns its own data
// fetching/mutation/state. It does not import or depend on AccountDetail.jsx (that orchestrator is being
// redesigned concurrently) -- another agent can mount <ActivityAndNotesSection accountId={...} /> into the
// new workspace without editing this file.
//
// PART 1.5 SEAM: this UI intentionally has NO assignee field, NO due-date field, NO status/complete
// control -- a dated follow-up/next-action is a separate, not-yet-authorized roadmap capability. The
// permanent interface is a short, structured Add-Note form + timeline, never a giant editable notes
// field (account.notes stays exactly as it is; this is additive, not a replacement of that field).
export default function ActivityAndNotesSection({ accountId }) {
  const { loading, errorStatus, result, refetch } = useCrmActivities(accountId);
  const { byUserId } = useEmployeeDirectory();
  const resolveActorName = (uid) => resolveActorDisplayName(uid, byUserId);
  const view = crmActivityView({ loading, errorStatus, result, resolveActorName });

  const [formOpen, setFormOpen] = useState(false);

  return (
    <section className="wo-history fo-crm-activity-section">
      <div className="fo-crm-activity-header">
        <h4>Activity &amp; Notes</h4>
        <button type="button" className="fo-btn-secondary" onClick={() => setFormOpen(true)}>
          + Add Note
        </button>
      </div>

      {view.kind === CRM_ACTIVITY_VIEW_STATE.LOADING && <p className="fo-muted">Loading activity…</p>}

      {view.kind === CRM_ACTIVITY_VIEW_STATE.DENIED && (
        <FailureState
          title="Activity &amp; Notes unavailable"
          message="You are not authorized to view CRM activity for this account."
        />
      )}

      {view.kind === CRM_ACTIVITY_VIEW_STATE.UNAVAILABLE && (
        <p className="fo-muted">Activity &amp; Notes is currently unavailable. Try again later.</p>
      )}

      {view.kind === CRM_ACTIVITY_VIEW_STATE.EMPTY && (
        <p className="fo-muted">No activity logged yet for this account.</p>
      )}

      {view.kind === CRM_ACTIVITY_VIEW_STATE.READY && (
        <ul className="fo-activity-list fo-crm-activity-list">
          {view.rows.map((row) => (
            <li key={row.key} className="fo-crm-activity-row">
              <div className="fo-crm-activity-row-meta">
                <span className="fo-crm-activity-type">{row.typeLabel}</span>
                <span className="fo-muted">{row.actorName}</span>
                <span className="fo-muted">{row.occurredAtText}</span>
                {row.backdated && <span className="fo-muted fo-crm-activity-backdated">(logged later)</span>}
              </div>
              <p className="fo-crm-activity-body">{row.body}</p>
              {row.hasLinkedContext && (
                <p className="fo-muted fo-crm-activity-links">
                  {row.contactId && <span>Contact {row.contactId}</span>}
                  {row.opportunityId && <span>Opportunity {row.opportunityId}</span>}
                  {row.salesOrderId && <span>Sales Order {row.salesOrderId}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <AddNoteForm
          accountId={accountId}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false);
            refetch();
          }}
        />
      )}
    </section>
  );
}

function AddNoteForm({ accountId, onClose, onCreated }) {
  const { pending, runCreate, discardCreateIntent } = useCrmActivityActions(accountId);
  const [type, setType] = useState("SALES_NOTE");
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);

  const handleClose = () => {
    discardCreateIntent();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await runCreate({ type, body });
      onCreated();
    } catch (err) {
      setError(err?.errorStatus === "invalid-argument" ? "Please check the note and try again." : "Could not save the note. Try again.");
    }
  };

  return (
    <Modal title="Add Note" onClose={handleClose}>
      <form onSubmit={handleSubmit} className="fo-form">
        <label className="fo-field">
          <span className="fo-field-label">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={pending}>
            {CRM_ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>{crmActivityTypeLabel(t)}</option>
            ))}
          </select>
        </label>
        <label className="fo-field">
          <span className="fo-field-label">Note</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={4000}
            required
            disabled={pending}
            placeholder="What happened?"
          />
        </label>
        {error && <p className="fo-warning" role="alert">{error}</p>}
        <div className="fo-form-actions">
          <button type="button" className="fo-btn-secondary" onClick={handleClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="fo-btn-primary" disabled={pending || body.trim().length === 0}>
            {pending ? "Saving…" : "Save Note"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
