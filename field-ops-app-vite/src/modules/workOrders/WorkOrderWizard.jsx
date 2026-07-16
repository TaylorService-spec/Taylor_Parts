import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { ACCOUNTS_COLLECTION } from "../../domain/constants";
import { createWorkOrder } from "../../services/workOrderService";
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  getWizardCreateErrorMessage,
  stepBlockedReason,
} from "../../domain/workOrderWizard";
import CustomerPicker from "./CustomerPicker";

// Sprint 2.0.3 -- Work Order creation wizard. Four steps, mapped
// directly to createWorkOrder()'s actual validated input
// (functions/src/createWorkOrder.ts's assertValidInput) -- no backend
// change, this only calls that Cloud Function exactly as it already
// exists, once Sprint 2.0.2's accounts/locations give steps 1-2 real
// data to resolve against.
//
// Step 1 reuses GlobalSearch's accounts provider via the new
// onResultSelect prop (Sprint 2.0.3's minimal extension to that
// component) -- selecting a result sets wizard state instead of
// navigating away from the wizard.
//
// Cloud Functions are NOT deployed live as of Sprint 2.0.3 (verified,
// firebase functions:list --project taylor-parts -> empty, blocked on
// the Blaze plan upgrade, issue #15). createWorkOrder() is still
// wired up and called exactly as it will be once deployed.
//
// Layout & error clarity pass: the step model, the per-step "why can't
// this advance" rule, and the create-error messaging all live in the
// pure, unit-tested domain/workOrderWizard.js -- this component is the
// wiring only. A disabled "Next"/"Create" now always renders the exact
// requirement that gates it (stepBlockedReason), and each control has a
// visible <label>, so nothing depends on placeholder/aria text alone.
// The catch-block create-error rationale (two distinct callable failure
// shapes) is documented alongside getWizardCreateErrorMessage there.

const PRIORITY_OPTIONS = [
  { value: 1, label: "1 - Emergency" },
  { value: 2, label: "2 - High" },
  { value: 3, label: "3 - Normal" },
  { value: 4, label: "4 - Low" },
];

const TYPE_OPTIONS = ["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"];
const SEVERITY_OPTIONS = ["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"];

// Accessible step progress indicator. aria-current="step" marks the active
// step for assistive tech; the numbered ol conveys order and completion
// visually. Purely presentational -- step state stays owned by the component.
function WizardProgress({ step }) {
  return (
    <ol className="fo-wizard-steps" aria-label={`Step ${step} of ${WIZARD_STEP_COUNT}`}>
      {WIZARD_STEPS.map((s) => {
        const state = s.n === step ? "active" : s.n < step ? "done" : "todo";
        return (
          <li
            key={s.n}
            className={`fo-wizard-step fo-wizard-step-${state}`}
            aria-current={s.n === step ? "step" : undefined}
          >
            <span className="fo-wizard-step-num" aria-hidden="true">{s.n}</span>
            <span className="fo-wizard-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Inline requirement hint -- the single reason the current step can't advance,
// or nothing. role="status" + aria-live so it updates as the user fills fields.
function StepHint({ reason }) {
  if (!reason) return null;
  return (
    <p className="fo-wizard-hint" role="status" aria-live="polite">
      {reason}
    </p>
  );
}

export default function WorkOrderWizard() {
  const navigate = useNavigate();
  const { data: accounts } = useFirestoreCollection(ACCOUNTS_COLLECTION);

  const [step, setStep] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [priority, setPriority] = useState(3);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [complaint, setComplaint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const { data: locations, error: locationsError, retry: retryLocations } =
    useLocationsForAccount(selectedAccount?.id ?? null);

  // Single source of truth for "can this step advance, and if not, why."
  const step2Reason = stepBlockedReason(2, {
    hasLocations: locations.length > 0,
    selectedLocationId,
  });
  const step3Reason = stepBlockedReason(3, { type, complaint });

  // CustomerPicker hands back the chosen account object directly.
  function handleAccountSelect(account) {
    if (!account) return;
    setSelectedAccount(account);
    setSelectedLocationId("");
    setStep(2);
  }

  async function handleCreate() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createWorkOrder({
        customerId: selectedAccount.id,
        locationId: selectedLocationId,
        priority,
        severity: severity || undefined,
        type: type || undefined,
        complaint: complaint.trim() || undefined,
      });
      navigate(`/service/work-orders/${result.id}`);
    } catch (err) {
      console.error("createWorkOrder failed:", err);
      setSubmitError(getWizardCreateErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-panel fo-wizard">
      <h2>New Work Order</h2>
      <WizardProgress step={step} />

      {step === 1 && (
        // Step 1 only -- the Customer search + result panel benefit from more
        // horizontal room, so this step opts into the wide modifier
        // (fo-wizard-panel-wide). Steps 2-4 keep the default 560px panel.
        <div className="fo-wizard-panel fo-wizard-panel-wide">
          <h3 className="fo-wizard-step-title">Step 1: Customer</h3>
          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-customer-search">Customer</label>
            <CustomerPicker inputId="wo-customer-search" accounts={accounts} onSelect={handleAccountSelect} />
          </div>
          <StepHint reason={stepBlockedReason(1, { selectedAccountId: selectedAccount?.id })} />
        </div>
      )}

      {step === 2 && (
        <div className="fo-wizard-panel">
          <h3 className="fo-wizard-step-title">Step 2: Location</h3>
          <p className="fo-muted fo-wizard-context">Customer: {selectedAccount?.name}</p>
          {/* #291: a FAILED locations read is distinct from "this customer has no
              locations". Without this the picker just vanished and Next stayed blocked,
              indistinguishable from a genuinely location-less customer. Fail closed to an
              actionable failure with retry; Next stays blocked (step2Reason has no
              location selected), which is correct -- a WO must not be created against a
              location we could not load. */}
          {locationsError ? (
            <div className="fo-inline-error" role="alert" data-location-error>
              {locationsError}{" "}
              <button type="button" className="fo-link-btn" onClick={retryLocations}>Retry</button>
            </div>
          ) : locations.length > 0 && (
            <div className="fo-wizard-field">
              <label className="fo-wizard-field-label" htmlFor="wo-location">Location</label>
              <select
                id="wo-location"
                className="fo-wizard-control"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
              >
                <option value="" disabled>
                  Select a location...
                </option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Suppress the "no locations yet" hint during a FAILURE: the banner above
              already explains it, and step2Reason falls back to hasLocations:false when
              the read failed (the hook fails closed to []) -- so without this guard the
              user would see the failure AND "this customer has no locations yet" at once,
              the exact false fact #291 exists to remove. Next stays blocked either way. */}
          {!locationsError && <StepHint reason={step2Reason} />}
          <div className="fo-wizard-actions">
            <button type="button" onClick={() => setStep(1)}>Back</button>
            <button type="button" disabled={Boolean(step2Reason)} onClick={() => setStep(3)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="fo-wizard-panel">
          <h3 className="fo-wizard-step-title">Step 3: Service Details</h3>

          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-priority">Priority</label>
            <select id="wo-priority" className="fo-wizard-control" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-type">Type</label>
            <select id="wo-type" className="fo-wizard-control" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">(no type -- complaint required instead)</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-severity">Severity (optional)</label>
            <select id="wo-severity" className="fo-wizard-control" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Severity (optional)</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="fo-wizard-field fo-wizard-field-wide">
            <label className="fo-wizard-field-label" htmlFor="wo-complaint">Complaint (required if no Type selected)</label>
            <textarea
              id="wo-complaint"
              className="fo-wizard-control"
              placeholder="Describe the customer's complaint..."
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              rows={3}
            />
          </div>

          <StepHint reason={step3Reason} />
          <div className="fo-wizard-actions">
            <button type="button" onClick={() => setStep(2)}>Back</button>
            <button type="button" disabled={Boolean(step3Reason)} onClick={() => setStep(4)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="fo-wizard-panel">
          <h3 className="fo-wizard-step-title">Step 4: Review &amp; Create</h3>
          <dl className="fo-wizard-review">
            <dt>Customer</dt>
            <dd>{selectedAccount?.name}</dd>
            <dt>Location</dt>
            <dd>{locations.find((l) => l.id === selectedLocationId)?.name}</dd>
            <dt>Priority</dt>
            <dd>{PRIORITY_OPTIONS.find((p) => p.value === priority)?.label}</dd>
            {type && (
              <>
                <dt>Type</dt>
                <dd>{type}</dd>
              </>
            )}
            {severity && (
              <>
                <dt>Severity</dt>
                <dd>{severity}</dd>
              </>
            )}
            {complaint && (
              <>
                <dt>Complaint</dt>
                <dd>{complaint}</dd>
              </>
            )}
          </dl>

          {submitError && (
            <div className="warning fo-wizard-error" role="alert">
              {submitError}
            </div>
          )}

          <div className="fo-wizard-actions">
            <button type="button" onClick={() => setStep(3)} disabled={submitting}>
              Back
            </button>
            <button type="button" onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Work Order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
