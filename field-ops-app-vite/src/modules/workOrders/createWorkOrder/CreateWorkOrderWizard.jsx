import { useMemo, useState } from "react";
import { createWorkOrder } from "../../../services/workOrderService";
import CustomerStep from "./CustomerStep";
import ServiceStep from "./ServiceStep";
import EquipmentStep from "./EquipmentStep";
import PartsStep from "./PartsStep";
import ReviewStep from "./ReviewStep";
import WizardNavigation from "./WizardNavigation";

// Epic 2 Phase 1 (docs/epics/EPIC-2.md) -- the standard way dispatchers
// create every Work Order. Calls services/workOrderService.ts's
// createWorkOrder() directly (the ONLY file that imports httpsCallable
// for Work Orders) -- per docs/architecture/UI_ACTION_PIPELINES.md's
// Pipeline 2, no page component here ever touches Cloud Functions
// itself. WorkOrderActions.jsx (Phase 2) is a separate concern: it
// gates *transitions* on an already-existing WO by status/role/
// ownership, which doesn't apply here -- there is no WO yet to gate
// against, only a create-permission check the Cloud Function itself
// already enforces (admin/dispatcher only).
//
// STEPS is the single source of truth for wizard order/labels --
// WizardNavigation renders from this, nothing hardcodes step count
// elsewhere.
const STEPS = [
  { key: "customer", label: "Customer" },
  { key: "service", label: "Service Request" },
  { key: "equipment", label: "Equipment" },
  { key: "parts", label: "Planned Parts" },
  { key: "review", label: "Review" },
];

const INITIAL_FORM = {
  // Sent to createWorkOrder():
  customerId: "",
  locationId: "",
  priority: null,
  type: "",
  severity: "",
  complaint: "",
  inventorySnapshot: [],

  // UI-only -- WorkOrder has no backing field for these yet (no
  // Cloud Function change in this phase). Kept in state so the
  // Review step can still show what the dispatcher entered.
  primaryContact: "",
  phone: "",
  email: "",
};

// Client-side validation, per this phase's explicit rule: "Do not
// rely on backend validation alone." Mirrors (deliberately a subset
// of) createWorkOrder.ts's own checks -- customerId/locationId/
// priority/type required, so an invalid submission is caught before
// the network round-trip, not just after a rejected call.
function validate(form) {
  const errors = {};
  if (!form.customerId.trim()) errors.customerId = "Customer is required.";
  if (!form.locationId.trim()) errors.locationId = "Location is required.";
  if (!form.type) errors.type = "Work Order Type is required.";
  if (!form.priority) errors.priority = "Priority is required.";
  if (!form.complaint.trim()) errors.complaint = "Description is required.";
  return errors;
}

export default function CreateWorkOrderWizard({ onCreated }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  const errors = useMemo(() => validate(form), [form]);
  const isValid = Object.keys(errors).length === 0;

  function updateForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function handleCreate() {
    if (!isValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createWorkOrder({
        customerId: form.customerId.trim(),
        locationId: form.locationId.trim(),
        priority: form.priority,
        type: form.type,
        ...(form.severity ? { severity: form.severity } : {}),
        complaint: form.complaint.trim(),
      });
      setResult(created);
      onCreated?.(created);
    } catch (err) {
      setSubmitError(err.message || "Failed to create Work Order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="fo-panel">
        <h3>Work Order Created</h3>
        <p>
          <strong>{result.woNumber}</strong> was created successfully.
        </p>
        <button
          type="button"
          className="fo-btn-large"
          onClick={() => {
            setResult(null);
            setForm(INITIAL_FORM);
            setStepIndex(0);
          }}
        >
          Create Another
        </button>
      </div>
    );
  }

  const step = STEPS[stepIndex];

  return (
    <div className="fo-panel">
      <h2>Create Work Order</h2>
      <WizardNavigation steps={STEPS} currentIndex={stepIndex} />

      {step.key === "customer" && <CustomerStep form={form} errors={errors} onChange={updateForm} />}
      {step.key === "service" && <ServiceStep form={form} errors={errors} onChange={updateForm} />}
      {step.key === "equipment" && <EquipmentStep />}
      {step.key === "parts" && <PartsStep form={form} onChange={updateForm} />}
      {step.key === "review" && <ReviewStep form={form} errors={errors} />}

      {submitError && <p className="fo-error">{submitError}</p>}

      <div className="fo-wizard-actions">
        <button type="button" onClick={goBack} disabled={stepIndex === 0 || submitting}>
          Back
        </button>
        {step.key === "review" ? (
          <button type="button" className="fo-btn-large" onClick={handleCreate} disabled={!isValid || submitting}>
            {submitting ? "Creating…" : "Create Work Order"}
          </button>
        ) : (
          <button type="button" className="fo-btn-large" onClick={goNext}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
