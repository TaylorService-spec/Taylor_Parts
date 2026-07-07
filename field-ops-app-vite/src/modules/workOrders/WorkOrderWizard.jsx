import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { ACCOUNTS_COLLECTION } from "../../domain/constants";
import { createWorkOrder } from "../../services/workOrderService";
import GlobalSearch from "../../shared/search/GlobalSearch";

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
// Cloud Functions are NOT deployed live as of this sprint (verified,
// firebase functions:list --project taylor-parts -> empty, blocked on
// the Blaze plan upgrade, issue #15). createWorkOrder() is still
// wired up and called exactly as it will be once deployed -- the
// catch block below is what surfaces that gap to the user as a clear
// message, not a raw stack trace, rather than the UI silently hanging
// or crashing.
const PRIORITY_OPTIONS = [
  { value: 1, label: "1 - Emergency" },
  { value: 2, label: "2 - High" },
  { value: 3, label: "3 - Normal" },
  { value: 4, label: "4 - Low" },
];

const TYPE_OPTIONS = ["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"];
const SEVERITY_OPTIONS = ["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"];

const CREATE_UNAVAILABLE_MESSAGE = "Work Order creation service is not currently available in this environment.";

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

  const { data: locations } = useLocationsForAccount(selectedAccount?.id ?? null);

  function handleAccountSelect(result) {
    const account = accounts.find((a) => a.id === result.id);
    setSelectedAccount(account ?? { id: result.id, name: result.primaryText });
    setSelectedLocationId("");
    setStep(2);
  }

  function canProceedFromStep3() {
    return Boolean(type || complaint.trim());
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
      setSubmitError(CREATE_UNAVAILABLE_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-panel">
      <h2>New Work Order</h2>
      <div className="fo-muted">Step {step} of 4</div>

      {step === 1 && (
        <div className="fo-form">
          <h3>Step 1: Customer</h3>
          <GlobalSearch
            providerKeys={["accounts"]}
            context={{ accounts }}
            placeholder="Search customers..."
            onResultSelect={handleAccountSelect}
          />
        </div>
      )}

      {step === 2 && (
        <div className="fo-form">
          <h3>Step 2: Location</h3>
          <p className="fo-muted">Customer: {selectedAccount?.name}</p>
          {locations.length === 0 ? (
            <p className="fo-muted">This customer has no locations yet. Add one from the Customer Detail page first.</p>
          ) : (
            <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)}>
              <option value="" disabled>
                Select a location...
              </option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
          <div className="fo-btn-row">
            <button type="button" onClick={() => setStep(1)}>Back</button>
            <button type="button" disabled={!selectedLocationId} onClick={() => setStep(3)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="fo-form">
          <h3>Step 3: Service Details</h3>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} aria-label="Priority">
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">(no type -- complaint required instead)</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity (optional)">
            <option value="">Severity (optional)</option>
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <textarea
            placeholder="Complaint (required if no Type selected)"
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={3}
          />

          <div className="fo-btn-row">
            <button type="button" onClick={() => setStep(2)}>Back</button>
            <button type="button" disabled={!canProceedFromStep3()} onClick={() => setStep(4)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="fo-form">
          <h3>Step 4: Review &amp; Create</h3>
          <div>Customer: {selectedAccount?.name}</div>
          <div>Location: {locations.find((l) => l.id === selectedLocationId)?.name}</div>
          <div>Priority: {PRIORITY_OPTIONS.find((p) => p.value === priority)?.label}</div>
          {type && <div>Type: {type}</div>}
          {severity && <div>Severity: {severity}</div>}
          {complaint && <div>Complaint: {complaint}</div>}

          {submitError && (
            <div className="warning" role="alert">
              {submitError}
            </div>
          )}

          <div className="fo-btn-row">
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
