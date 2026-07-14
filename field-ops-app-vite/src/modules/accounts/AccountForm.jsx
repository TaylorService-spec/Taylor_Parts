import { useMemo, useRef, useState } from "react";
import { ACCOUNT_STATUS, ACCOUNT_RELATIONSHIP_TYPE, INVOICE_DELIVERY_METHOD, PAYMENT_TERMS, TAX_STATUS } from "../../domain/constants";
import { commercialProfileErrors, isValidInvoiceDeliveryMethod, isValidPaymentTerms, isValidTaxStatus, isContactOnAccount, resolveOwnerIdentity } from "../../domain/commercialProfile";
import { accountSaveErrorMessage } from "../../domain/accountPortfolio";
import { useAuth } from "../../auth/AuthContext";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import AddressFields from "../../shared/address/AddressFields";
import EmployeeAssignmentPicker from "../../shared/assignment/EmployeeAssignmentPicker";
import IdentityLine from "./IdentityLine";
import { Field, FormActions, FormError, FormStatus } from "../../shared/ui/form";
import { describedBy } from "../../shared/ui/form/fieldA11y";

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
//
// Issue #214 PR-1 -- migrated to the shared form primitives (Field / FormActions
// / FormError / FormStatus) built on the System-A `fo-wizard-*` visual tokens:
// labels ABOVE controls with correct label/control association, a text (never
// colour-only) required indicator, consistent hint/error placement, a clear
// saving state announced to assistive tech, and a readable-width cap. Every
// field, option, payload key, validation rule, governed-field, owner
// fail-closed behaviour, permission, and write path is unchanged -- this is a
// presentation-only migration. The `.fo-account-form` class + its two-column
// grid, `.fo-btn-row`, all control ids and label text are preserved.
export default function AccountForm({ initialValues, onSubmit, onCancel, submitLabel, contacts = [], contactsLoading = false, contactsError = null }) {
  const { user, employeeId: sessionEmployeeId, displayName: sessionDisplayName, loading: authLoading } = useAuth();
  const { byUserId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();

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
  // Governed enum fields (PR 2). Held as their RAW stored value (blank when
  // unset) so a malformed stored value surfaces rather than being silently
  // normalized. These two fields are admin-edit-only ENFORCED IN RULES (not
  // by hiding them here); a non-admin who changes them has their write
  // rejected at the Rules layer. taxStatus blank == absent == UNKNOWN.
  const [paymentTerms, setPaymentTerms] = useState(initialValues?.paymentTerms ?? "");
  const [taxStatus, setTaxStatus] = useState(initialValues?.taxStatus ?? "");
  const [billingContactId, setBillingContactId] = useState(initialValues?.billingContact?.contactId ?? "");
  const [accountOwner, setAccountOwner] = useState(initialValues?.accountOwner ?? null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Save-time (post-validation) failure -- e.g. a Rules permission-denied. Shown
  // inside the form so the creation overlay stays open and the user can retry.
  const [saveError, setSaveError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Duplicate-submit guard: a ref, so it blocks a second submit synchronously
  // within the same tick (before React re-renders the disabled button), which a
  // stale `submitting` state read cannot.
  const submittingRef = useRef(false);

  // Live Commercial Profile validation -- errors render beside their fields.
  const cpDraft = useMemo(
    () => ({
      defaultCurrency: defaultCurrency.trim().toUpperCase() || undefined,
      invoiceDeliveryMethod: invoiceDeliveryMethod || undefined,
      purchaseOrderRequired,
      paymentTerms: paymentTerms || undefined,
      taxStatus: taxStatus || undefined,
      billingContactId: billingContactId || null,
      accountOwner,
    }),
    [defaultCurrency, invoiceDeliveryMethod, purchaseOrderRequired, paymentTerms, taxStatus, billingContactId, accountOwner]
  );
  const { valid: cpValid, errors } = useMemo(
    () => commercialProfileErrors(cpDraft, contacts, { contactsResolved: !contactsLoading, contactsError: Boolean(contactsError) }),
    [cpDraft, contacts, contactsLoading, contactsError]
  );

  // Re-resolve the CURRENT owner identity from the stable userId (never the
  // stored snapshot), so the "Current owner" line shows the live authority
  // with proper loading/error/unknown states.
  const currentOwnerIdentity = resolveOwnerIdentity(accountOwner, {
    byUserId,
    loading: directoryLoading,
    error: directoryError,
  });

  // A stored value that is set but not a member of the enum / this Account's
  // contacts: surfaced (as a labeled option + an error) rather than dropped.
  // The foreign-contact case only applies once contacts have resolved without
  // error -- on a lookup error we can't assert membership, so we don't.
  const invoiceMethodInvalid = Boolean(invoiceDeliveryMethod) && !isValidInvoiceDeliveryMethod(invoiceDeliveryMethod);
  const paymentTermsInvalid = Boolean(paymentTerms) && !isValidPaymentTerms(paymentTerms);
  const taxStatusInvalid = Boolean(taxStatus) && !isValidTaxStatus(taxStatus);
  const billingContactForeign =
    Boolean(billingContactId) && !contactsLoading && !contactsError && !isContactOnAccount(billingContactId, contacts);

  // Customer name is required (empty name blocks submit -- unchanged rule);
  // surface it consistently once a submit has been attempted.
  const nameError = submitAttempted && !name.trim() ? "Enter a customer name." : null;

  function handleAddressChange(field, value) {
    setAddress((cur) => ({ ...cur, [field]: value }));
  }

  function toggleRelationshipType(type) {
    setRelationshipTypes((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
  }

  // Builds a COMPLETE Person Assignment. The assignee (employeeId + userId +
  // resolved display name) comes from the picker; the assignor's employee/user
  // IDs AND resolved display-name snapshot come from the authenticated session
  // (never a client-chosen value); the timestamp is stamped now. The assignor
  // display name is the proof-of-resolution: AuthContext leaves it null when
  // the session's employeeId has no matching Employee document, so an
  // unresolved (broken-link) session yields an incomplete record that
  // validation blocks -- a bare employeeId can't pass as a provisioned
  // assignor. Any missing required piece is likewise rejected.
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
      assignedByDisplayName: sessionDisplayName ?? null,
      assignedAt: Date.now(),
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return; // a save is already in flight
    setSubmitAttempted(true);
    setSaveError(null);
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

    const payload = {
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
      // Governed enum fields (PR 2). Sent as null when unset; taxStatus null
      // is the absent==UNKNOWN safe default. Rules enforce admin-only edit of
      // these two -- a dispatcher's write here that CHANGES either is denied
      // at the Rules layer (this form does not hide the fields from them).
      paymentTerms: paymentTerms || null,
      taxStatus: taxStatus || null,
      billingContact: billingContactId ? { contactId: billingContactId } : null,
      accountOwner,
    };

    // Await the save so a post-validation failure (e.g. a Rules permission-
    // denied) is caught HERE and surfaced inside the form -- the creation
    // overlay stays open and nothing is lost. A caller whose onSubmit doesn't
    // return a promise still works (await of a non-thenable resolves).
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      console.error("Account save failed:", err);
      setSaveError(accountSaveErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    // `fo-account-form` is ADDITIVE layout only (keeps `fo-form` for shared
    // control styling/behavior; global `.fo-form` used by other forms is
    // unchanged). See index.css's `.fo-account-form` block.
    <form className="fo-form fo-account-form" onSubmit={handleSubmit}>
      <Field id="account-name" label="Customer name" required error={nameError}>
        <input
          id="account-name"
          className="fo-wizard-control"
          placeholder="Customer name"
          value={name}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy("account-name", { hasError: Boolean(nameError) })}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field id="account-status" label="Status">
        <select id="account-status" className="fo-wizard-control" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(ACCOUNT_STATUS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

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

        <Field id="cp-currency" label="Default currency (ISO 4217)" error={errors.defaultCurrency}>
          <input
            id="cp-currency"
            className="fo-wizard-control"
            placeholder="e.g. USD"
            value={defaultCurrency}
            maxLength={3}
            aria-invalid={errors.defaultCurrency ? true : undefined}
            aria-describedby={describedBy("cp-currency", { hasError: Boolean(errors.defaultCurrency) })}
            onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
          />
        </Field>

        <div className="fo-form-field">
          <label className="fo-checkbox-label">
            <input
              type="checkbox"
              checked={purchaseOrderRequired === true}
              aria-invalid={errors.purchaseOrderRequired ? true : undefined}
              aria-describedby={describedBy("cp-po-required", { hasError: Boolean(errors.purchaseOrderRequired) })}
              onChange={(e) => setPurchaseOrderRequired(e.target.checked)}
            />
            Purchase order required
          </label>
          <FormError id="cp-po-required-error">{errors.purchaseOrderRequired}</FormError>
        </div>

        <Field id="cp-invoice-delivery" label="Invoice delivery method" error={errors.invoiceDeliveryMethod}>
          <select
            id="cp-invoice-delivery"
            className="fo-wizard-control"
            value={invoiceDeliveryMethod}
            aria-invalid={errors.invoiceDeliveryMethod ? true : undefined}
            aria-describedby={describedBy("cp-invoice-delivery", { hasError: Boolean(errors.invoiceDeliveryMethod) })}
            onChange={(e) => setInvoiceDeliveryMethod(e.target.value)}
          >
            <option value="">—</option>
            {Object.values(INVOICE_DELIVERY_METHOD).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {/* Surface a malformed stored value instead of silently blanking it. */}
            {invoiceMethodInvalid && <option value={invoiceDeliveryMethod}>{invoiceDeliveryMethod} (invalid)</option>}
          </select>
        </Field>

        {/* Governed enum fields (PR 2) -- admin-edit-only ENFORCED IN RULES,
            not by hiding them here. Shown to any admin/dispatcher who can
            open this form; a non-admin's write that CHANGES either is
            rejected at the Firestore Rules layer. */}
        <Field id="cp-payment-terms" label="Payment terms" error={errors.paymentTerms}>
          <select
            id="cp-payment-terms"
            className="fo-wizard-control"
            value={paymentTerms}
            aria-invalid={errors.paymentTerms ? true : undefined}
            aria-describedby={describedBy("cp-payment-terms", { hasError: Boolean(errors.paymentTerms) })}
            onChange={(e) => setPaymentTerms(e.target.value)}
          >
            <option value="">—</option>
            {Object.values(PAYMENT_TERMS).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            {/* Surface a malformed stored value instead of silently blanking it. */}
            {paymentTermsInvalid && <option value={paymentTerms}>{paymentTerms} (invalid)</option>}
          </select>
        </Field>

        <Field id="cp-tax-status" label="Tax status" error={errors.taxStatus}>
          <select
            id="cp-tax-status"
            className="fo-wizard-control"
            value={taxStatus}
            aria-invalid={errors.taxStatus ? true : undefined}
            aria-describedby={describedBy("cp-tax-status", { hasError: Boolean(errors.taxStatus) })}
            onChange={(e) => setTaxStatus(e.target.value)}
          >
            {/* Blank == absent == the UNKNOWN safe default (never TAXABLE). */}
            <option value="">— (Unknown)</option>
            {Object.values(TAX_STATUS).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            {taxStatusInvalid && <option value={taxStatus}>{taxStatus} (invalid)</option>}
          </select>
        </Field>

        {/* Billing contact — only a Contact belonging to THIS Account. The
            picker is shown once this Account has contacts; the error is shown
            regardless (so a foreign stored id surfaces even with no contacts). */}
        {contacts.length > 0 ? (
          <Field id="cp-billing-contact" label="Billing contact" error={errors.billingContact}>
            <select
              id="cp-billing-contact"
              className="fo-wizard-control"
              value={billingContactId}
              aria-invalid={errors.billingContact ? true : undefined}
              aria-describedby={describedBy("cp-billing-contact", { hasError: Boolean(errors.billingContact) })}
              onChange={(e) => setBillingContactId(e.target.value)}
            >
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {/* Surface a stored id that isn't one of this Account's contacts
                  -- name-only, never the raw contact ID. */}
              {billingContactForeign && <option value={billingContactId}>Unknown contact (not on this account)</option>}
            </select>
          </Field>
        ) : (
          <FormError>{errors.billingContact}</FormError>
        )}

        {/* Owner picker keeps its own composite structure -- the picker renders
            its own labelled combobox ("Account owner"), so wrapping it in a
            second Field label would double the accessible name. */}
        <div className="fo-form-field fo-account-form-wide">
          {accountOwner && (
            <div className="fo-muted">
              {/* CURRENT owner, re-resolved from userId -- not the stored
                  historical snapshot; loading/error/unknown states preserved. */}
              <IdentityLine label="Current owner" identity={currentOwnerIdentity} />
              <button type="button" className="fo-link-btn" onClick={() => setAccountOwner(null)}>Clear owner</button>
            </div>
          )}
          <EmployeeAssignmentPicker
            onSelect={handleOwnerSelect}
            label="Account owner"
            placeholder="Search owner by name..."
            disabled={authLoading}
          />
          <FormError>{errors.accountOwner}</FormError>
        </div>
      </fieldset>

      <Field id="account-notes" label="Notes" className="fo-form-field-wide">
        <textarea
          id="account-notes"
          className="fo-wizard-control"
          placeholder="Notes (alarm codes, call-ahead requirements, billing reminders, preferences...)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </Field>

      <Field id="account-tags" label="Tags" hint="Comma-separated (e.g. Restaurant, VIP, Chain Store)">
        <input
          id="account-tags"
          className="fo-wizard-control"
          placeholder="Tags, comma-separated (e.g. Restaurant, VIP, Chain Store)"
          value={tagsInput}
          aria-describedby={describedBy("account-tags", { hasHint: true })}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </Field>

      <button type="button" onClick={() => setShowExternalIds((v) => !v)} className="fo-link-btn">
        {showExternalIds ? "Hide" : "Show"} external IDs (future integrations)
      </button>

      {showExternalIds && (
        <>
          <Field id="account-customer-number" label="Customer number">
            <input id="account-customer-number" className="fo-wizard-control" placeholder="Customer number (optional)" value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} />
          </Field>
          <Field id="account-erp-id" label="ERP ID">
            <input id="account-erp-id" className="fo-wizard-control" placeholder="ERP ID (optional)" value={erpId} onChange={(e) => setErpId(e.target.value)} />
          </Field>
          <Field id="account-accounting-id" label="Accounting ID">
            <input id="account-accounting-id" className="fo-wizard-control" placeholder="Accounting ID (optional)" value={accountingId} onChange={(e) => setAccountingId(e.target.value)} />
          </Field>
          <Field id="account-legacy-id" label="Legacy ID">
            <input id="account-legacy-id" className="fo-wizard-control" placeholder="Legacy ID (optional)" value={legacyId} onChange={(e) => setLegacyId(e.target.value)} />
          </Field>
        </>
      )}

      {submitAttempted && !cpValid && (
        <FormError role="alert">Fix the highlighted Commercial Profile fields before saving.</FormError>
      )}

      <FormError role="alert" className="fo-account-save-error">{saveError}</FormError>

      {/* Saving state announced politely to assistive tech (the submit button
          shows it visually and is disabled to prevent a duplicate submit). */}
      <FormStatus>{submitting ? "Saving customer..." : ""}</FormStatus>

      <FormActions>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel ?? "Save"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </FormActions>
    </form>
  );
}
