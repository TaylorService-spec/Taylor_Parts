import { useState } from "react";

// Enterprise Inventory Phase 4 -- the "New Transfer" form. A plain controlled form (no client-side
// stock/part lookup beyond what the Transfers workspace already loaded for the location pickers) --
// the governed createTransferOrder command re-validates everything authoritatively (Part authority,
// origin/destination active-ness, on-hand/SERIAL-availability sufficiency). This form only shapes the
// request; it never decides whether the transfer is actually legal.
export default function TransferOrderForm({ warehouseOptions, truckOptions, submitting, onSubmit, onCancel }) {
  const [draft, setDraft] = useState({
    partId: "",
    quantity: "1",
    originType: "WAREHOUSE",
    originLocationId: "",
    destinationType: "WAREHOUSE",
    destinationLocationId: "",
    serialNumbersText: "",
  });
  const [errors, setErrors] = useState({});

  const locationOptions = (type) => (type === "WAREHOUSE" ? warehouseOptions : truckOptions);

  function set(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const result = await onSubmit(draft);
    if (result && result.ok === false && result.errors) setErrors(result.errors);
    else if (result && result.ok) {
      setDraft({ partId: "", quantity: "1", originType: "WAREHOUSE", originLocationId: "", destinationType: "WAREHOUSE", destinationLocationId: "", serialNumbersText: "" });
      setErrors({});
    }
  }

  return (
    <form className="fo-transfer-form" onSubmit={handleSubmit} aria-label="New transfer">
      <div className="fo-form-row">
        <label htmlFor="transfer-partId">Part ID</label>
        <input id="transfer-partId" value={draft.partId} onChange={(e) => set("partId", e.target.value)} disabled={submitting} required />
        {errors.partId && <span className="fo-form-error" role="alert">{errors.partId}</span>}
      </div>
      <div className="fo-form-row">
        <label htmlFor="transfer-quantity">Quantity</label>
        <input id="transfer-quantity" type="number" min="1" step="1" value={draft.quantity} onChange={(e) => set("quantity", e.target.value)} disabled={submitting} required />
        {errors.quantity && <span className="fo-form-error" role="alert">{errors.quantity}</span>}
      </div>

      <fieldset className="fo-form-fieldset">
        <legend>Origin</legend>
        <div className="fo-form-row">
          <select aria-label="Origin type" value={draft.originType} onChange={(e) => set("originType", e.target.value)} disabled={submitting}>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="MOBILE">Truck</option>
          </select>
          <select aria-label="Origin location" value={draft.originLocationId} onChange={(e) => set("originLocationId", e.target.value)} disabled={submitting} required>
            <option value="">Select…</option>
            {locationOptions(draft.originType).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        {errors.originType && <span className="fo-form-error" role="alert">{errors.originType}</span>}
        {errors.originLocationId && <span className="fo-form-error" role="alert">{errors.originLocationId}</span>}
      </fieldset>

      <fieldset className="fo-form-fieldset">
        <legend>Destination</legend>
        <div className="fo-form-row">
          <select aria-label="Destination type" value={draft.destinationType} onChange={(e) => set("destinationType", e.target.value)} disabled={submitting}>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="MOBILE">Truck</option>
          </select>
          <select aria-label="Destination location" value={draft.destinationLocationId} onChange={(e) => set("destinationLocationId", e.target.value)} disabled={submitting} required>
            <option value="">Select…</option>
            {locationOptions(draft.destinationType).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        {errors.destinationType && <span className="fo-form-error" role="alert">{errors.destinationType}</span>}
        {errors.destinationLocationId && <span className="fo-form-error" role="alert">{errors.destinationLocationId}</span>}
      </fieldset>

      <div className="fo-form-row">
        <label htmlFor="transfer-serials">Serial numbers (SERIAL-tracked parts only — leave blank otherwise)</label>
        <textarea
          id="transfer-serials"
          rows={2}
          placeholder="One per line, or comma-separated"
          value={draft.serialNumbersText}
          onChange={(e) => set("serialNumbersText", e.target.value)}
          disabled={submitting}
        />
        {errors.serialNumbersText && <span className="fo-form-error" role="alert">{errors.serialNumbersText}</span>}
      </div>

      <div className="fo-form-actions">
        <button type="submit" className="fo-btn-primary" disabled={submitting}>{submitting ? "Creating…" : "Create transfer"}</button>
        <button type="button" className="fo-btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}
