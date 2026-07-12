// Customer Record Page sprint, PR 1 (docs/specifications/customer-record-page-structured-address.md,
// Component 3). Shared editing component for BOTH Account billing
// address and Location address -- the binding requirement that both
// use the same component, not parallel implementations.
//
// Controlled component: the caller owns the four field values (same
// pattern AccountForm.jsx/the inline LocationForm already use with
// individual useState calls) -- AddressFields does not own state
// itself, it only renders the four labeled inputs and calls onChange
// per field.
//
// idPrefix keeps input ids unique if more than one AddressFields
// instance ever renders on one page at once (defensive -- today's
// approved scope has at most one mounted at a time).
export default function AddressFields({ value, onChange, disabled, idPrefix }) {
  const { street = "", city = "", state = "", zip = "" } = value ?? {};

  function fieldId(field) {
    return `${idPrefix}-${field}`;
  }

  return (
    <>
      <div className="fo-form-field">
        <label htmlFor={fieldId("street")}>Street address</label>
        <input
          id={fieldId("street")}
          value={street}
          disabled={disabled}
          onChange={(e) => onChange("street", e.target.value)}
        />
      </div>
      <div className="fo-form-field">
        <label htmlFor={fieldId("city")}>City</label>
        <input
          id={fieldId("city")}
          value={city}
          disabled={disabled}
          onChange={(e) => onChange("city", e.target.value)}
        />
      </div>
      <div className="fo-form-field">
        <label htmlFor={fieldId("state")}>State</label>
        <input
          id={fieldId("state")}
          value={state}
          disabled={disabled}
          onChange={(e) => onChange("state", e.target.value)}
        />
      </div>
      <div className="fo-form-field">
        <label htmlFor={fieldId("zip")}>ZIP code</label>
        <input
          id={fieldId("zip")}
          value={zip}
          disabled={disabled}
          onChange={(e) => onChange("zip", e.target.value)}
        />
      </div>
    </>
  );
}
