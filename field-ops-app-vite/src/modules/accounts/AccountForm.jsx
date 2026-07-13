import { useState } from "react";
import { ACCOUNT_STATUS, ACCOUNT_RELATIONSHIP_TYPE, INVOICE_DELIVERY_METHOD } from "../../domain/constants";
import { commercialProfileErrors } from "../../domain/commercialProfile";
import AddressFields from "../../shared/address/AddressFields";
import EmployeeAssignmentPicker from "../../shared/assignment/EmployeeAssignmentPicker";

// Sprint 2.0.2 -- Customer Foundation. Shared create/edit form,
// internal name AccountForm per the naming convention (rendered UI
// text says "Customer" throughout).
//
// Customer/Account Business Model -- Customer PR 2. Adds relationshipTypes
// editing and reuses AddressFields for the billing address.
//
// Account Commercial Profile -- PR 1. Adds the informational Commercial
// Profile fields (defaultCurrency, purchaseOrderRequired,
// invoiceDeliveryMethod, billingContact, accountOwner) with explicit
// validation. `contacts` (this Account's own contacts) is passed in edit mode
// so the billing-contact picker can only choose a contact belonging to this
// Account. NOTE (interim, per the Implementation Plan's audit-integrity
// invariant): these are client-direct edits for now; once the audit log +
// trusted server-side writer ship, mutation moves there and direct client
// writes are denied.
export default function AccountForm({ initialValues, onSubmit, onCancel, submitLabel, contacts = [] }) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [address, setAddress] = useState({
    street: initialValues?.billingAddress?.street ?? "",
    city: initialValues?.billingAddress?.city ?? "",
    state: initialValues?.billingAddress?.state ?? "",
    zip: initialValues?.billingAddress?.zip ?? "",
  });
  const [status, setStatus] = useState(initialValues?.status ?? ACCOUNT_STATUS.PROSPECT);
  const [relationshipTypes, setRelationshipTypes] = useState(initialValues?.relationshipTypes ?? []);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [tagsInput, setTagsInput] = useState((initialValues?.tags ?? []).join(", "));
  const [showExternalIds, setShowExternalIds] = useState(false);
  const [customerNumber, setCustomerNumber] = useState(initialValues?.customerNumber ?? "");
  const [erpId, setErpId] = useState(initialValues?.erpId ?? "");
  const [accountingId, setAccountingId] = useState(initialValues?.accountingId ?? "");
  const [legacyId, setLegacyId] = useState(initialValues?.legacyId ?? "");

  // Commercial Profile (PR 1)
  const [defaultCurrency, setDefaultCurrency] = useState(initialValues?.defaultCurrency ?? "");
  const [purchaseOrderRequired, setPurchaseOrderRequired] = useState(Boolean(initialValues?.purchaseOrderRequired));
  const [invoiceDeliveryMethod, setInvoiceDeliveryMethod] = useState(initialValues?.invoiceDeliveryMethod ?? "");
  const [billingContactId, setBillingContactId] = useState(initialValues?.billingContact?.contactId ?? "");
  const [accountOwner, setAccountOwner] = useState(initialValues?.accountOwner ?? null);
  const [errors, setErrors] = useState({});

  function handleAddressChange(field, value) {
    setAddress((cur) => ({ ...cur, [field]: value }));
  }

  function toggleRelationshipType(type) {
    setRelationshipTypes((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
  }

  function handleOwnerSelect(sel) {
    // Person Assignment snapshot (assignedBy is added by the trusted writer in
    // a later PR, which has server-side actor context). Display re-resolves the
    // CURRENT name from assignedToUserId, so the snapshot name is historical.
    if (!sel) {
      setAccountOwner(null);
      return;
    }
    setAccountOwner({
      assignedToEmployeeId: sel.employeeId ?? null,
      assignedToUserId: sel.userId ?? null,
      assignedToDisplayName: sel.displayName ?? null,
      assignedAt: Date.now(),
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const trimmedCurrency = defaultCurrency.trim().toUpperCase();
    const draft = {
      defaultCurrency: trimmedCurrency || undefined,
      invoiceDeliveryMethod: invoiceDeliveryMethod || undefined,
      purchaseOrderRequired,
      billingContactId: billingContactId || null,
      accountOwner,
    };
    const { valid, errors: cpErrors } = commercialProfileErrors(draft, contacts);
    if (!valid) {
      setErrors(cpErrors);
      return;
    }
    setErrors({});

    const trimmedStreet = address.street.trim();
    const trimmedCity = address.city.trim();
    const trimmedState = address.state.trim();
    const trimmedZip = address.zip.trim();
    const hasAddress = trimmedStreet || trimmedCity || trimmedState || trimmedZip;

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const orderedRelationshipTypes = Object.values(ACCOUNT_RELATIONSHIP_TYPE).filter((t) =>
      relationshipTypes.includes(t)
    );

    onSubmit({
      name: trimmedName,
      billingAddress: hasAddress ? { street: trimmedStreet, city: trimmedCity, state: trimmedState, zip: trimmedZip } : null,
      status,
      relationshipTypes: orderedRelationshipTypes,
      notes: notes.trim() || null,
      tags,
      customerNumber: customerNumber.trim() || null,
      erpId: erpId.trim() || null,
      accountingId: accountingId.trim() || null,
      legacyId: legacyId.trim() || null,
      // Commercial Profile (PR 1)
      defaultCurrency: trimmedCurrency || null,
      purchaseOrderRequired,
      invoiceDeliveryMethod: invoiceDeliveryMethod || null,
      billingContact: billingContactId ? { contactId: billingContactId } : null,
      accountOwner,
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

      <fieldset className="fo-fieldset">
        <legend>Relationship</legend>
        <label className="fo-checkbox-label">
          <input
            type="checkbox"
            checked={relationshipTypes.includes(ACCOUNT_RELATIONSHIP_TYPE.CUSTOMER)}
            onChange={() => toggleRelationshipType(ACCOUNT_RELATIONSHIP_TYPE.CUSTOMER)}
          />
          Customer
        </label>
        <label className="fo-checkbox-label">
          <input
            type="checkbox"
            checked={relationshipTypes.includes(ACCOUNT_RELATIONSHIP_TYPE.VENDOR)}
            onChange={() => toggleRelationshipType(ACCOUNT_RELATIONSHIP_TYPE.VENDOR)}
          />
          Vendor
        </label>
      </fieldset>

      <AddressFields value={address} onChange={handleAddressChange} idPrefix="account-billing" />

      {/* Commercial Profile (PR 1) -- informational fields only */}
      <fieldset className="fo-fieldset">
        <legend>Commercial Profile</legend>

        <div className="fo-form-field">
          <label htmlFor="cp-currency">Default currency (ISO 4217)</label>
          <input
            id="cp-currency"
            placeholder="e.g. USD"
            value={defaultCurrency}
            maxLength={3}
            onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
          />
          {errors.defaultCurrency && <div className="fo-warning">{errors.defaultCurrency}</div>}
        </div>

        <label className="fo-checkbox-label">
          <input type="checkbox" checked={purchaseOrderRequired} onChange={(e) => setPurchaseOrderRequired(e.target.checked)} />
          Purchase order required
        </label>

        <div className="fo-form-field">
          <label htmlFor="cp-invoice-delivery">Invoice delivery method</label>
          <select id="cp-invoice-delivery" value={invoiceDeliveryMethod} onChange={(e) => setInvoiceDeliveryMethod(e.target.value)}>
            <option value="">—</option>
            {Object.values(INVOICE_DELIVERY_METHOD).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Billing contact — only a Contact belonging to THIS Account (edit mode
            supplies `contacts`; create mode has none yet, so it is hidden). */}
        {contacts.length > 0 && (
          <div className="fo-form-field">
            <label htmlFor="cp-billing-contact">Billing contact</label>
            <select id="cp-billing-contact" value={billingContactId} onChange={(e) => setBillingContactId(e.target.value)}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="fo-form-field">
          {accountOwner && (
            <div className="fo-muted">
              Current: {accountOwner.assignedToDisplayName ?? "—"}{" "}
              <button type="button" className="fo-link-btn" onClick={() => setAccountOwner(null)}>Clear</button>
            </div>
          )}
          <EmployeeAssignmentPicker onSelect={handleOwnerSelect} label="Account owner" placeholder="Search owner by name..." />
          {errors.accountOwner && <div className="fo-warning">{errors.accountOwner}</div>}
        </div>
      </fieldset>

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
