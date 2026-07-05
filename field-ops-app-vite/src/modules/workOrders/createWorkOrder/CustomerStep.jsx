// Step 1 -- Customer. customerId/locationId are the only fields that
// map to a real WorkOrder field (see types/workOrder.ts). There is no
// customer directory/collection anywhere in this app (customerId is a
// plain string everywhere, including the existing Jobs.jsx) -- so this
// is a free-text field, not a lookup against real data that doesn't
// exist.
//
// primaryContact/phone/email are collected for a complete intake
// experience but are NOT sent to createWorkOrder() -- WorkOrder has no
// backing field for them, and adding one is a Cloud Function change,
// out of scope for this phase. Marked clearly below so a dispatcher
// isn't misled into thinking this data is saved.
export default function CustomerStep({ form, errors, onChange }) {
  return (
    <div className="fo-wizard-step">
      <label>
        Customer *
        <input
          value={form.customerId}
          onChange={(e) => onChange({ customerId: e.target.value })}
          placeholder="Customer name or ID"
        />
        {errors.customerId && <span className="fo-error">{errors.customerId}</span>}
      </label>

      <label>
        Service Location *
        <input
          value={form.locationId}
          onChange={(e) => onChange({ locationId: e.target.value })}
          placeholder="Service location"
        />
        {errors.locationId && <span className="fo-error">{errors.locationId}</span>}
      </label>

      <p className="fo-muted">
        Contact details below are for your reference during intake only -- not yet saved to
        the Work Order (no backend field exists for them in this phase).
      </p>

      <label>
        Primary Contact
        <input value={form.primaryContact} onChange={(e) => onChange({ primaryContact: e.target.value })} />
      </label>

      <label>
        Phone
        <input value={form.phone} onChange={(e) => onChange({ phone: e.target.value })} />
      </label>

      <label>
        Email
        <input value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
      </label>
    </div>
  );
}
