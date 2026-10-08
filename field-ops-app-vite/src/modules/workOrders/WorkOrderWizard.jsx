import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { createWorkOrder, listWorkOrderOperatingCompanies } from "../../services/workOrderService";
import {
  WIZARD_STEPS,
  WIZARD_STEP_COUNT,
  getWizardCreateErrorMessage,
  stepBlockedReason,
  createBlockedReason,
  companyChoice,
  COMPANY_READ,
  createIdempotencyKeyHolder,
} from "../../domain/workOrderWizard";
import WorkOrderAuthorityNotice from "../../shared/ui/WorkOrderAuthorityNotice.jsx";
import CustomerPicker from "./CustomerPicker";
import EquipmentPicker from "./EquipmentPicker";
import { equipmentAllowedAtCreate } from "../../domain/workOrderEquipmentRule.js";
import { WORK_ORDER_PRIORITY_OPTIONS } from "../../domain/workOrderPriority";
import { Button } from "../../shared/ui/primitives";
import { operatingCompanyLabel, statusLabel } from "../../shared/display/displayLabels.js";
import { workOrderTypeLabel } from "../../domain/workOrderType.js";

// Sprint 2.0.3 -- Work Order creation wizard. Four steps, mapped onto the
// GOVERNED EOS createWorkOrder command (services/workOrderService.ts ->
// POST /operations/work-orders) -- never a Firebase callable.
//
// The governed command needs an explicit operating company, a Work Order
// type and a 1-4 priority. The type is required at step 3. The company comes
// ONLY from the governed listWorkOrderOperatingCompanies read: one company is
// preselected and SHOWN as the stated company; several must be chosen; none,
// a refused read, or NOT_ACTIVATED keeps Create refused with a message naming
// the missing company (domain/workOrderWizard.js). Never inferred or hard-coded.
// Every create carries a stable-per-submission idempotency key, so a retry or
// double submit replays the same Work Order instead of minting a duplicate.
//
// Step 1 reuses GlobalSearch's accounts provider via the new
// onResultSelect prop -- selecting a result sets wizard state instead of
// navigating away from the wizard.
//
// Layout & error clarity pass: the step model, the per-step "why can't
// this advance" rule, and the create-error messaging all live in the
// pure, unit-tested domain/workOrderWizard.js -- this component is the
// wiring only. A disabled "Next"/"Create" now always renders the exact
// requirement that gates it (stepBlockedReason), and each control has a
// visible <label>, so nothing depends on placeholder/aria text alone.
// The catch-block create-error rationale (two distinct callable failure
// shapes) is documented alongside getWizardCreateErrorMessage there.

// Options come from domain/workOrderPriority.js so what a user PICKS here is what
// every other surface says back to them.
const PRIORITY_OPTIONS = WORK_ORDER_PRIORITY_OPTIONS;

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
  // BOUNDED (§9). This previously read the ENTIRE accounts collection to populate a
  // customer picker. The picker read is capped and discloses truncation; see
  // hooks/useAccountPicker.js for why bounding without disclosing would have been worse
  // than the original defect.
  const accountPicker = useAccountPicker();
  const accounts = accountPicker.options;

  const [step, setStep] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [priority, setPriority] = useState(3);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [complaint, setComplaint] = useState("");
  // WHICH MACHINE. Null is a real answer -- a service call can be raised before anyone knows the
  // unit, and the server treats the reference as optional.
  const [equipmentId, setEquipmentId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // THE OPERATING COMPANY -- from the governed read only (domain/workOrderWizard.js companyChoice).
  const [companyRead, setCompanyRead] = useState({ status: COMPANY_READ.LOADING, companies: [] });
  const [chosenCompanyId, setChosenCompanyId] = useState("");
  useEffect(() => {
    let active = true;
    listWorkOrderOperatingCompanies()
      .then((companies) => { if (active) setCompanyRead({ status: COMPANY_READ.READY, companies }); })
      // Refused, NOT_ACTIVATED or unreachable: no governed choice exists, so Create stays refused.
      .catch(() => { if (active) setCompanyRead({ status: COMPANY_READ.FAILED, companies: [] }); });
    return () => { active = false; };
  }, []);
  const companies = companyChoice(companyRead);
  // A list of one is preselected -- an explicit governed choice from a list of one, shown as such.
  const operatingCompanyId = chosenCompanyId || companies.preselectedId || null;
  const createReason = companyRead.status === COMPANY_READ.LOADING
    ? "Loading the operating companies this Work Order can belong to…"
    : createBlockedReason({ operatingCompanyId, options: companies.options });

  // site-work #2 -- ONE key holder per wizard mount, so every create from this session (a retry after a
  // failed attempt, a network-level double submit) carries the SAME idempotencyKey and the server replays
  // the same Work Order. Reset only after the server reports IDEMPOTENCY_KEY_REUSED, so the user's NEXT
  // explicit Create is a genuinely new submission.
  const idempotencyKeyHolderRef = useRef(null);
  if (!idempotencyKeyHolderRef.current) {
    idempotencyKeyHolderRef.current = createIdempotencyKeyHolder();
  }
  // Also guards a double click locally while a create is in flight.
  const inFlightRef = useRef(false);

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
    if (createReason) {
      setSubmitError(createReason);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createWorkOrder({
        operatingCompanyId,
        customerId: selectedAccount.id,
        locationId: selectedLocationId,
        priority,
        severity: severity || undefined,
        type: type || undefined,
        complaint: complaint.trim() || undefined,
        // Never sent on an INSTALL: the unit does not exist yet, and the server refuses it. Cleared
        // rather than hidden, so switching type to INSTALL cannot smuggle a stale selection through.
        equipmentId: (equipmentAllowedAtCreate(type) && equipmentId) || undefined,
        idempotencyKey: idempotencyKeyHolderRef.current.getKey(),
      });
      navigate(`/service/work-orders/${result.id}`);
    } catch (err) {
      console.error("createWorkOrder failed:", err);
      if (err?.reason === "IDEMPOTENCY_KEY_REUSED") idempotencyKeyHolderRef.current.reset();
      setSubmitError(getWizardCreateErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="fo-panel fo-wizard">
      <h2>New Work Order</h2>
      <WorkOrderAuthorityNotice />
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
            {accountPicker.message && <p className="fo-muted">{accountPicker.message}</p>}
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
              <Button variant="tertiary" className="fo-link-btn" onClick={retryLocations}>Retry</Button>
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
            <Button variant="tertiary" onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" disabled={Boolean(step2Reason)} onClick={() => setStep(3)}>
              Next
            </Button>
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
            <select id="wo-type" className="fo-wizard-control" value={type} onChange={(e) => {
                const next = e.target.value;
                setType(next);
                // Switching to INSTALL clears any unit already chosen, so a stale selection cannot
                // survive into a submit the server would refuse.
                if (!equipmentAllowedAtCreate(next)) setEquipmentId(null);
              }}>
              <option value="">Select a type…</option>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {workOrderTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>

          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-equipment">Equipment</label>
            {/* Chosen by what the machine IS -- name, manufacturer, model, serial -- never by a
                document id. Scoped to the customer and, where one is chosen, the site; that scope is
                a convenience for the person choosing, and the server re-reads the record and
                validates the relationship regardless of what this list offered. */}
            <EquipmentPicker
              accountId={selectedAccount?.id ?? null}
              locationId={selectedLocationId || null}
              type={type}
              value={equipmentId}
              onChange={setEquipmentId}
            />
          </div>

          <div className="fo-wizard-field">
            <label className="fo-wizard-field-label" htmlFor="wo-severity">Severity (Optional)</label>
            <select id="wo-severity" className="fo-wizard-control" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Severity (Optional)</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="fo-wizard-field fo-wizard-field-wide">
            <label className="fo-wizard-field-label" htmlFor="wo-complaint">Complaint (Optional)</label>
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
            <Button variant="tertiary" onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" disabled={Boolean(step3Reason)} onClick={() => setStep(4)}>
              Next
            </Button>
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
                <dd>{workOrderTypeLabel(type)}</dd>
              </>
            )}
            {severity && (
              <>
                <dt>Severity</dt>
                <dd>{statusLabel(severity)}</dd>
              </>
            )}
            {complaint && (
              <>
                <dt>Complaint</dt>
                <dd>{complaint}</dd>
              </>
            )}
          </dl>

          {companies.mustChoose ? (
            <div className="fo-wizard-field">
              <label className="fo-wizard-field-label" htmlFor="wo-operating-company">Operating Company</label>
              <select
                id="wo-operating-company"
                className="fo-wizard-control"
                value={chosenCompanyId}
                onChange={(e) => setChosenCompanyId(e.target.value)}
              >
                <option value="" disabled>Select the operating company…</option>
                {companies.options.map((c) => (
                  <option key={c.operatingCompanyId} value={c.operatingCompanyId}>
                    {operatingCompanyLabel(c.operatingCompanyId, { short: false })}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <dl className="fo-wizard-review">
              <dt>Operating Company</dt>
              {companies.preselectedId ? (
                // The only governed company -- STATED, not inferred.
                <dd data-operating-company={companies.preselectedId}>
                  {operatingCompanyLabel(companies.preselectedId, { short: false })}
                  {" "}<span className="fo-muted">(the only operating company available to you)</span>
                </dd>
              ) : (
                <dd data-operating-company="missing">
                  {companyRead.status === COMPANY_READ.LOADING ? "Loading…" : "Not chosen — none is available to choose, and none is inferred."}
                </dd>
              )}
            </dl>
          )}
          {createReason && companyRead.status !== COMPANY_READ.LOADING && (
            <div className="warning fo-wizard-error" role="alert" data-create-blocked="OPERATING_COMPANY_REQUIRED">
              {createReason}
            </div>
          )}

          {submitError && submitError !== createReason && (
            <div className="warning fo-wizard-error" role="alert">
              {submitError}
            </div>
          )}

          <div className="fo-wizard-actions">
            <Button variant="tertiary" onClick={() => setStep(3)} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" onClick={handleCreate} loading={submitting} disabled={Boolean(createReason)}>
              Create Work Order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
