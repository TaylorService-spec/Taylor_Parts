import { useState } from "react";
import { ACCOUNT_STATUS } from "../../domain/constants";

// Sprint 2.0.2 -- Customer Foundation. Shared create/edit form,
// internal name AccountForm per the naming convention (rendered UI
// text says "Customer" throughout). Deliberately a single inline form,
// not a routed multi-step wizard -- a 3-4 field form doesn't need the
// treatment the multi-step Work Order creation flow (Sprint 2.0.3)
// gets. External-identifier fields are collapsed by default since
// they're future-integration-only and not relevant day-to-day.
export default function AccountForm({ initialValues, onSubmit, onCancel, submitLabel }) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [street, setStreet] = useState(initialValues?.billingAddress?.street ?? "");
  const [city, setCity] = useState(initialValues?.billingAddress?.city ?? "");
  const [state, setState] = useState(initialValues?.billingAddress?.state ?? "");
  const [zip, setZip] = useState(initialValues?.billingAddress?.zip ?? "");
  const [status, setStatus] = useState(initialValues?.status ?? ACCOUNT_STATUS.PROSPECT);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [tagsInput, setTagsInput] = useState((initialValues?.tags ?? []).join(", "));
  const [showExternalIds, setShowExternalIds] = useState(false);
  const [customerNumber, setCustomerNumber] = useState(initialValues?.customerNumber ?? "");
  const [erpId, setErpId] = useState(initialValues?.erpId ?? "");
  const [accountingId, setAccountingId] = useState(initialValues?.accountingId ?? "");
  const [legacyId, setLegacyId] = useState(initialValues?.legacyId ?? "");

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const trimmedStreet = street.trim();
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const trimmedZip = zip.trim();
    const hasAddress = trimmedStreet || trimmedCity || trimmedState || trimmedZip;

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    onSubmit({
      name: trimmedName,
      billingAddress: hasAddress ? { street: trimmedStreet, city: trimmedCity, state: trimmedState, zip: trimmedZip } : null,
      status,
      notes: notes.trim() || null,
      tags,
      customerNumber: customerNumber.trim() || null,
      erpId: erpId.trim() || null,
      accountingId: accountingId.trim() || null,
      legacyId: legacyId.trim() || null,
    });
  }

  return (
    <form className="fo-form" onSubmit={handleSubmit}>
      <input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />

      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        {Object.values(ACCOUNT_STATUS).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <input placeholder="Billing street (optional)" value={street} onChange={(e) => setStreet(e.target.value)} />
      <input placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
      <input placeholder="State (optional)" value={state} onChange={(e) => setState(e.target.value)} />
      <input placeholder="Zip (optional)" value={zip} onChange={(e) => setZip(e.target.value)} />

      <textarea
        placeholder="Notes (alarm codes, call-ahead requirements, billing reminders, preferences...)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
      />

      <input
        placeholder="Tags, comma-separated (e.g. Restaurant, VIP, Chain Store)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
      />

      <button type="button" onClick={() => setShowExternalIds((v) => !v)} className="fo-link-btn">
        {showExternalIds ? "Hide" : "Show"} external IDs (future integrations)
      </button>

      {showExternalIds && (
        <>
          <input placeholder="Customer number (optional)" value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} />
          <input placeholder="ERP ID (optional)" value={erpId} onChange={(e) => setErpId(e.target.value)} />
          <input placeholder="Accounting ID (optional)" value={accountingId} onChange={(e) => setAccountingId(e.target.value)} />
          <input placeholder="Legacy ID (optional)" value={legacyId} onChange={(e) => setLegacyId(e.target.value)} />
        </>
      )}

      <div className="fo-btn-row">
        <button type="submit">{submitLabel ?? "Save"}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
