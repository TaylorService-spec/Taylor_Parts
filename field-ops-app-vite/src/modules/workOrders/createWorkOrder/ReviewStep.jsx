// Step 5 -- Review. Pure display of what's about to be sent to
// createWorkOrder() (plus the UI-only contact fields, clearly marked
// as not persisted) -- no new state, no side effects.
export default function ReviewStep({ form, errors }) {
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="fo-wizard-step">
      {hasErrors && (
        <p className="fo-error">Some required fields are missing -- go back and complete them before creating.</p>
      )}

      <dl className="fo-review-list">
        <dt>Customer</dt>
        <dd>{form.customerId || "—"}</dd>

        <dt>Service Location</dt>
        <dd>{form.locationId || "—"}</dd>

        <dt>Work Order Type</dt>
        <dd>{form.type || "—"}</dd>

        <dt>Priority</dt>
        <dd>{form.priority ?? "—"}</dd>

        <dt>Description</dt>
        <dd>{form.complaint || "—"}</dd>

        <dt>Planned Parts</dt>
        <dd>
          {form.inventorySnapshot.length === 0
            ? "None"
            : form.inventorySnapshot.map((item) => `${item.name} × ${item.qtyPlanned}`).join(", ")}
        </dd>
      </dl>

      {(form.primaryContact || form.phone || form.email) && (
        <p className="fo-muted">
          Contact on file for this intake (not saved to the Work Order): {form.primaryContact}{" "}
          {form.phone} {form.email}
        </p>
      )}
    </div>
  );
}
