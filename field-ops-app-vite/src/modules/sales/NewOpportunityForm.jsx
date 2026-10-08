import { useMemo, useState } from "react";
import Modal from "../../shared/ui/Modal.jsx";
import { useAccountPicker } from "../../hooks/useAccountPicker.js";
import { offeredChannelOptions } from "../../domain/opportunityFieldModel.js";
import { validateOpportunityCreateInput, buildOpportunityCreatePayload } from "../../domain/opportunityCreateForm.js";
import { useOpportunityCreate } from "../../hooks/useOpportunityCreate.js";
import { isoDate, parseLocalDate } from "../../domain/localDateInput.js";
import { Button } from "../../shared/ui/primitives/index.js";

const EMPTY_DRAFT = { accountId: "", ownerEmployeeId: "", salesChannel: "", need: "", expectedValue: null, expectedCloseAt: null };

// New Opportunity — governed CREATE flow. Account selection reuses the SAME generic Firestore-collection
// hook (hooks/useAccountPicker, a BOUNDED read); owner stays a bounded employee-id field
// (the employee directory is not connected — see opportunityFieldModel.js's "owner" control note, honest
// about the same not-yet-connected directory rather than a fake picker). Opportunity has NO contactId field
// (functions/src/opportunity/opportunityCommands.ts's CreateOpportunityInput) — deliberately no contact
// picker here. Solution lines are likewise out of scope for create (added later via the existing Solution
// section edit once general field editing is live).
//
// `deps.useAccounts` / `deps.client` let tests inject fakes without touching firebase (mirrors every other
// governed-write surface's `deps` seam in this codebase).
//
// `authorizedChannels` -- the channels THIS caller may create in (useCommercialCapabilities().channelsFor(
// "opportunity.write"), Controller DQ-4). Only those are offered; none injected offers none (fail closed). One channel
// is preselected. The server remains authoritative: a forged channel is still refused.
export default function NewOpportunityForm({ onClose, onCreated, readiness, authorizedChannels = [], deps = {} }) {
  const offeredChannels = useMemo(() => offeredChannelOptions(authorizedChannels), [authorizedChannels]);
  // BOUNDED (§9): the default read is capped and discloses truncation. The deps seam is
  // untouched, so every injected test fake keeps working -- the swap is the DEFAULT only.
  const useAccounts = deps.useAccounts ?? (() => {
    const picker = useAccountPicker();
    return { data: picker.options, loading: picker.loading, error: picker.error, pickerMessage: picker.message };
  });
  const { data: accounts, loading: accountsLoading, error: accountsError, pickerMessage } = useAccounts();
  const { pending, runCreate, discardIntent } = useOpportunityCreate(deps.client ? { client: deps.client } : undefined);

  const [draft, setDraft] = useState(() => (offeredChannels.length === 1 ? { ...EMPTY_DRAFT, salesChannel: offeredChannels[0].value } : EMPTY_DRAFT));
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);

  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const accountOptions = useMemo(
    () => (accounts ?? []).map((a) => ({ value: a.id, label: a.name || a.id })).sort((a, b) => a.label.localeCompare(b.label)),
    [accounts],
  );

  const writeDisabled = !readiness?.enabled;

  function requestClose() {
    discardIntent();
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (writeDisabled) return;
    const { ok, errors } = validateOpportunityCreateInput(draft);
    setFieldErrors(errors);
    if (!ok) return;
    setSubmitError(null);
    const payload = buildOpportunityCreatePayload(draft);
    try {
      const outcome = await runCreate(payload);
      if (outcome.kind === "applied" || outcome.kind === "replayed") {
        onCreated?.(outcome.opportunityId);
      } else {
        setSubmitError(outcome.message);
      }
    } catch (err) {
      setSubmitError(err?.outcome?.message ?? "The request could not be completed. Try again.");
    }
  }

  return (
    <Modal title="New Opportunity" onClose={requestClose}>
      <form className="fo-sales-createform" onSubmit={handleSubmit}>
        {writeDisabled && (
          <p id="new-opp-readiness" className="fo-sales-lifecycle-note fo-muted" role="status">
            {readiness?.reason}
          </p>
        )}

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-account">Customer Account</label>
          {accountsError ? (
            <p className="fo-sales-createform__error" role="alert">Could not load customer accounts. Try again.</p>
          ) : (
            <select
              id="new-opp-account"
              className="fo-input"
              value={draft.accountId}
              disabled={accountsLoading}
              onChange={(e) => set("accountId", e.target.value)}
            >
              <option value="">{accountsLoading ? "Loading accounts…" : "Select a customer account"}</option>
              {accountOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          {/* Truncation notice sits OUTSIDE the error/select ternary: it is a fact about
              the option set, not part of either branch, and burying it inside the select
              branch would hide it exactly when an error also occurred. */}
          {pickerMessage && <p className="fo-muted">{pickerMessage}</p>}
          {fieldErrors.accountId && <p className="fo-sales-createform__error">{fieldErrors.accountId}</p>}
        </div>

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-owner">Owner (Employee ID)</label>
          <input
            id="new-opp-owner"
            className="fo-input"
            type="text"
            value={draft.ownerEmployeeId}
            aria-describedby="new-opp-owner-note"
            onChange={(e) => set("ownerEmployeeId", e.target.value)}
          />
          <p id="new-opp-owner-note" className="fo-muted fo-sales-editform__note">
            Employee directory not connected yet — enter the owning employee's id.
          </p>
          {fieldErrors.ownerEmployeeId && <p className="fo-sales-createform__error">{fieldErrors.ownerEmployeeId}</p>}
        </div>

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-channel">Channel</label>
          <select id="new-opp-channel" className="fo-input" value={draft.salesChannel} onChange={(e) => set("salesChannel", e.target.value)}>
            <option value="">{offeredChannels.length === 0 ? "No sales channel is available to you" : "Select a channel"}</option>
            {offeredChannels.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {fieldErrors.salesChannel && <p className="fo-sales-createform__error">{fieldErrors.salesChannel}</p>}
        </div>

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-need">Customer Need / Description (Optional)</label>
          <textarea id="new-opp-need" className="fo-input" rows={3} value={draft.need} onChange={(e) => set("need", e.target.value)} />
        </div>

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-value">Estimated Value (Optional)</label>
          <input
            id="new-opp-value"
            className="fo-input"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={draft.expectedValue ?? ""}
            onChange={(e) => set("expectedValue", e.target.value === "" ? null : Number(e.target.value))}
          />
          {fieldErrors.expectedValue && <p className="fo-sales-createform__error">{fieldErrors.expectedValue}</p>}
        </div>

        <div className="fo-sales-editform__field">
          <label htmlFor="new-opp-close">Expected Close (Optional)</label>
          <input
            id="new-opp-close"
            className="fo-input"
            type="date"
            value={isoDate(draft.expectedCloseAt)}
            onChange={(e) => set("expectedCloseAt", e.target.value ? parseLocalDate(e.target.value) : null)}
          />
          {fieldErrors.expectedCloseAt && <p className="fo-sales-createform__error">{fieldErrors.expectedCloseAt}</p>}
        </div>

        {submitError && (
          <p className="fo-sales-createform__error" role="alert">{submitError}</p>
        )}

        <div className="fo-sales-editform__actions">
          <Button
            type="submit"
            variant={writeDisabled ? "protected" : "primary"}
            disabled={pending}
            // The reason is ALREADY on screen as the form's own notice above, so the
            // Button must not render its own copy: passing `reason` here printed the
            // same sentence a second time, and `title` added it a third time as a
            // tooltip. Point the control at the existing notice instead -- one visible
            // explanation, still programmatically tied to the button that is blocked.
            aria-describedby={writeDisabled ? "new-opp-readiness" : undefined}
          >
            {pending ? "Creating…" : "Create Opportunity"}
          </Button>
          <Button type="button" variant="tertiary" onClick={requestClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
