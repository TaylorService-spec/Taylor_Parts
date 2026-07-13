import { useMemo, useState } from "react";
import { ACCOUNT_STATUS, ACCOUNT_RELATIONSHIP_TYPE, INVOICE_DELIVERY_METHOD } from "../../domain/constants";
import { commercialProfileErrors, isValidInvoiceDeliveryMethod, isContactOnAccount } from "../../domain/commercialProfile";
import { useAuth } from "../../auth/AuthContext";
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
// invoiceDeliveryMethod, billingContact, accountOwner) with explicit,
// LIVE validation -- every field's error renders beside it (surfacing a
// malformed stored value the moment the form opens, never silently coercing
// it). `contacts`/`contactsLoading` (this Account's own contacts) are passed
// in edit mode so the billing-contact picker only offers a contact belonging
// to this Account, and billing validation waits for the list to resolve.
// accountOwner is captured as a COMPLETE Person Assignment: the reciprocally
// linked assignee (employeeId + userId) and resolved name snapshot from the
// picker, plus the assignor's employee/user IDs from the authenticated
// session and a timestamp. NOTE (interim, per the Implementation Plan's
// audit-integrity invariant): these are client-direct edits for now; once the
// audit log + trusted server-side writer ship, mutation moves there and direct
// client writes are denied.
export default function AccountForm({ initialValues, onSubmit, onCancel, submitLabel, contacts = [], contactsLoading = false }) {
  const { user, employeeId: sessionEmployeeId, loading: authLoading } = useAuth();

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

  // Commercial Profile (PR 1). purchaseOrderRequired is held as its RAW stored
  // value (not Boolean()-coerced) so a malformed stored value is validated and
  // surfaced rather than silently normalized; the checkbox reflects only a
  // strict `=== true`.
  const [defaultCurrency, setDefaultCurrency] = useState(initialValues?.defaultCurrency ?? "");
  const [purchaseOrderRequired, setPurchaseOrderRequired] = useState(initialValues?.purchaseOrderRequired);
  const [invoiceDeliveryMethod, setInvoiceDeliveryMethod] = useState(initialValues?.invoiceDeliveryMethod ?? "");
  const [billingContactId, setBillingContactId] = useState(initialValues?.billingContact?.contactId ?? "");
  const [accountOwner, setAccountOwner] = useState(initialValues?.accountOwner ?? null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Live Commercial Profile validation -- errors render beside their fields.
  const cpDraft = useMemo(
    () => ({
      defaultCurrency: defaultCurrency.trim().toUpperCase() || undefined,
      invoiceDeliveryMethod: invoiceDeliveryMethod || undefined,
      purchaseOrderRequired,
      billingContactId: billingContactId || null,
      accountOwner,
    }),
    [defaultCurrency, invoiceDeliveryMethod, purchaseOrderRequired, billingContactId, accountOwner]
  );
  const { valid: cpValid, errors } = useMemo(
    () => commercialProfileErrors(cpDraft, contacts, { contactsResolved: !contactsLoading }),
    [cpDraft, contacts, contactsLoading]
  );

  // A stored value that is set but not a member of the enum / this Account's
  // contacts: surfaced (as a labeled option + an error) rather than dropped.
  const invoiceMethodInvalid = Boolean(invoiceDeliveryMethod) && !isValidInvoiceDeliveryMethod(invoiceDeliveryMethod);
  const billingContactForeign =
    Boolean(billingContactId) && !contactsLoading && !isContactOnAccount(billingContactId, contacts);

  function handleAddressChange(field, value) {
    setAddress((cur) => ({ ...cur, [field]: value }));
  }

  function toggleRelationshipType(type) {
    setRelationshipTypes((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
  }

  // Builds a COMPLETE Person Assignment. The assignee (employeeId + userId +
  // resolved display name) comes from the picker; the assignor's employee/user
  // IDs come from the authenticated session (never a client-chosen value); the
  // timestamp is stamped now. If any required piece is missing (e.g. the
  // signed-in user has no provisioned employeeId), the resulting record is
  // incomplete and validation blocks the save -- an arbitrary/partial owner is
  // never accepted.
  function handleOwnerSelect(sel) {
    if (!sel) {
      setAccountOwner(null);
      return;
    }
    setAccountOwner({
      assignedToEmployeeId: sel.employeeId ?? null,
      assignedToUserId: sel.userId ?? null,
      assignedToDisplayName: sel.displayName ?? null,
      assignedByEmployeeId: sessionEmployeeId ?? null,
      assignedByUserId: user?.uid ?? null,
      assignedAt: Date.now(),
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitAttempted(true);
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (!cpValid) return; // errors are already rendered beside each field

    const trimmedCurrency = defaultCurrency.trim().toUpperCase();

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
      // Commercial Profile (PR 1) -- validation above guarantees these are
      // well-formed by the time we reach here.
      defaultCurrency: trimmedCurrency || null,
      purchaseOrderRequired: purchaseOrderRequired === true,
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
            aria-invalid={errors.defaultCurrency ? true : undefined}
            onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
          />
          {errors.defaultCurrency && <div className="fo-warning">{errors.defaultCurrency}</div>}
        </div>

        <div className="fo-form-field">
          <label className="fo-checkbox-label">
            <input
              type="checkbox"
              checked={purchaseOrderRequired === true}
              onChange={(e) => setPurchaseOrderRequired(e.target.checked)}
            />
            Purchase order required
          </label>
          {errors.purchaseOrderRequired && <div className="fo-warning">{errors.purchaseOrderRequired}</div>}
        </div>

        <div className="fo-form-field">
          <label htmlFor="cp-invoice-delivery">Invoice delivery method</label>
          <select
            id="cp-invoice-delivery"
            value={invoiceDeliveryMethod}
            aria-invalid={errors.invoiceDeliveryMethod ? true : undefined}
            onChange={(e) => setInvoiceDeliveryMethod(e.target.value)}
          >
            <option value="">—</option>
            {Object.values(INVOICE_DELIVERY_METHOD).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {/* Surface a malformed stored value instead of silently blanking it. */}
            {invoiceMethodInvalid && <option value={invoiceDeliveryMethod}>{invoiceDeliveryMethod} (invalid)</option>}
          </select>
          {errors.invoiceDeliveryMethod && <div className="fo-warning">{errors.invoiceDeliveryMethod}</div>}
        </div>

        {/* Billing contact — only a Contact belonging to THIS Account. The
            picker is shown once this Account has contacts; the error is shown
            regardless (so a foreign stored id surfaces even with no contacts). */}
        {contacts.length > 0 ? (
          <div className="fo-form-field">
            <label htmlFor="cp-billing-contact">Billing contact</label>
            <select
              id="cp-billing-contact"
              value={billingContactId}
              aria-invalid={errors.billingContact ? true : undefined}
              onChange={(e) => setBillingContactId(e.target.value)}
            >
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {/* Surface a stored id that isn't one of this Account's contacts. */}
              {billingContactForeign && <option value={billingContactId}>{billingContactId} (not on this account)</option>}
            </select>
            {errors.billingContact && <div className="fo-warning">{errors.billingContact}</div>}
          </div>
        ) : (
          errors.billingContact && <div className="fo-warning">{errors.billingContact}</div>
        )}

        <div className="fo-form-field">
          {accountOwner && (
            <div className="fo-muted">
              Current: {accountOwner.assignedToDisplayName ?? "—"}{" "}
              <button type="button" className="fo-link-btn" onClick={() => setAccountOwner(null)}>Clear</button>
            </div>
          )}
          <EmployeeAssignmentPicker
            onSelect={handleOwnerSelect}
            label="Account owner"
            placeholder="Search owner by name..."
            disabled={authLoading}
          />
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

      {submitAttempted && !cpValid && (
        <div className="fo-warning" role="alert">Fix the highlighted Commercial Profile fields before saving.</div>
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
