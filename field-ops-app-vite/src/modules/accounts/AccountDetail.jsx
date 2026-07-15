import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { createLocation } from "../../domain/locations";
import { createContact, primaryContactState } from "../../domain/contacts";
import { formatAddress } from "../../domain/address";
import { ACCOUNT_RELATIONSHIP_TYPE } from "../../domain/constants";
import AccountForm from "./AccountForm";
import ContactImportModal from "./ContactImportModal";
import ContactCreateModal from "./ContactCreateModal";
import LocationCreateModal from "./LocationCreateModal";
import ServiceActivitySection from "./ServiceActivitySection";
import FinancialSummarySection from "./FinancialSummarySection";
import FinancialForecastSection from "./FinancialForecastSection";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveOwnerIdentity, resolveContactIdentity, resolveTaxStatus } from "../../domain/commercialProfile";
import IdentityLine from "./IdentityLine";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountDetail;
// rendered UI says "Customer Detail" throughout.
//
// Customer/Account Business Model -- Customer PR 2 (docs/specifications/
// customer-account-business-model.md). Reworked from a flat panel into the
// approved SIX-SECTION layout (not tabs, per the Owner's direction), in
// reading order: Account Summary -> Financial Summary -> Contacts ->
// Locations -> Service Activity -> Notes/Identifiers. Financial Summary and
// Service Activity are INERT mount points only in this PR -- their live
// behavior (provider states, Work Order counts/timeline) is deliberately
// deferred to PR 3/PR 4. Reuses the ported address/contact domain layer
// (formatAddress, primaryContactState, AddressFields) rather than
// re-implementing it.
const RELATIONSHIP_LABEL = {
  [ACCOUNT_RELATIONSHIP_TYPE.CUSTOMER]: "Customer",
  [ACCOUNT_RELATIONSHIP_TYPE.VENDOR]: "Vendor",
};

// Renders relationship-type badges inline. An Account with no
// relationshipTypes renders nothing (never a silent default to "Customer").
function RelationshipBadges({ relationshipTypes }) {
  const types = relationshipTypes ?? [];
  const ordered = Object.values(ACCOUNT_RELATIONSHIP_TYPE).filter((t) => types.includes(t));
  if (ordered.length === 0) return null;
  return (
    <>
      {ordered.map((t) => (
        <span key={t} className={`fo-badge fo-badge-relationship-${t.toLowerCase()}`}>
          {RELATIONSHIP_LABEL[t] ?? t}
        </span>
      ))}
    </>
  );
}

// Issue #214 PR-2 -- the inline ContactForm / LocationForm that used to render
// below the live lists have been replaced by ContactCreateModal /
// LocationCreateModal (shared Modal + System-A form primitives). See those files.

// Primary-contact summary for the Account Summary section -- reuses
// primaryContactState()'s three states; the MULTIPLE case surfaces the
// same non-silent warning the source derivation was built for.
function PrimaryContactSummary({ contacts }) {
  const primary = primaryContactState(contacts);
  if (primary.state === "ONE") {
    return <div className="fo-muted">Primary contact: {primary.contact.name}</div>;
  }
  if (primary.state === "MULTIPLE") {
    return (
      <div className="fo-warning">
        Warning: {primary.contacts.length} contacts are marked primary — resolve to a single primary contact.
      </div>
    );
  }
  return null; // NONE -> omit, never fabricate a primary
}

// Account Commercial Profile -- PR 1. Renders the informational fields. Every
// ID-bearing field shows its CURRENT resolved identity via IdentityLine (never
// the stored snapshot), so loading/resolved/unknown/error stay distinct.
// PO-required only renders when a real boolean is stored (a malformed stored
// value is surfaced in the edit form, not silently shown as Yes/No here).
function CommercialProfileSection({ account, contacts, contactsLoading, contactsError, byUserId, directoryLoading, directoryError }) {
  const currency = account.defaultCurrency || null;
  const invoiceMethod = account.invoiceDeliveryMethod || null;
  const hasPo = account.purchaseOrderRequired === true || account.purchaseOrderRequired === false;

  // Governed enum fields (PR 2). paymentTerms is shown only when set; tax
  // status is ALWAYS resolved (absent => UNKNOWN safe default, never silently
  // TAXABLE) and shown whenever the profile section renders. `hasTaxStatus`
  // (an explicitly stored value) is one of the signals that the section has
  // content, so a stored UNKNOWN still surfaces the section.
  const paymentTerms = account.paymentTerms || null;
  const hasTaxStatus = typeof account.taxStatus === "string" && account.taxStatus !== "";
  const taxStatus = resolveTaxStatus(account.taxStatus);

  const ownerIdentity = resolveOwnerIdentity(account.accountOwner, {
    byUserId,
    loading: directoryLoading,
    error: directoryError,
  });
  const billingIdentity = resolveContactIdentity(account.billingContact?.contactId, {
    contacts,
    loading: contactsLoading,
    error: contactsError,
  });

  const hasAny =
    currency ||
    invoiceMethod ||
    hasPo ||
    paymentTerms ||
    hasTaxStatus ||
    ownerIdentity.state !== "unset" ||
    billingIdentity.state !== "unset";

  return (
    <section className="wo-history">
      <h4>Commercial Profile</h4>
      {hasAny ? (
        <div className="fo-muted">
          <IdentityLine label="Owner" identity={ownerIdentity} />
          {currency && <div>Default currency: {currency}</div>}
          {paymentTerms && <div>Payment terms: {paymentTerms}</div>}
          {hasPo && <div>Purchase order required: {account.purchaseOrderRequired ? "Yes" : "No"}</div>}
          {invoiceMethod && <div>Invoice delivery: {invoiceMethod}</div>}
          {/* Safe default made visible: an Account with a profile always shows
              a tax status, resolving an absent value to UNKNOWN. */}
          <div>Tax status: {taxStatus}</div>
          <IdentityLine label="Billing contact" identity={billingIdentity} />
        </div>
      ) : (
        <p className="fo-muted">No commercial profile set yet.</p>
      )}
    </section>
  );
}

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { account, loading } = useAccount(accountId);
  const { data: locations } = useLocationsForAccount(accountId);
  const { data: contacts, loading: contactsLoading, error: contactsError } = useContactsForAccount(accountId);
  const { byUserId, loading: directoryLoading, error: directoryError } = useEmployeeDirectory();

  const [isEditing, setIsEditing] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // One polite live region per section; written by both the import and the
  // single-add create flow (they never run at once).
  const [contactAnnouncement, setContactAnnouncement] = useState("");
  const [locationAnnouncement, setLocationAnnouncement] = useState("");
  // The contact/location id to move focus to once the live subscription renders
  // its row (matched by id internally; the id is never rendered/announced).
  const [pendingContactFocus, setPendingContactFocus] = useState(null);
  const [pendingLocationFocus, setPendingLocationFocus] = useState(null);
  const contactRowRef = useRef(null);
  const locationRowRef = useRef(null);

  // After a successful import OR single add, focus the target Contact's row once
  // the live useContactsForAccount subscription has delivered it.
  useEffect(() => {
    if (pendingContactFocus && contactRowRef.current) {
      contactRowRef.current.focus();
      setPendingContactFocus(null);
    }
  }, [pendingContactFocus, contacts]);

  // Same for a newly added Location once useLocationsForAccount delivers it.
  useEffect(() => {
    if (pendingLocationFocus && locationRowRef.current) {
      locationRowRef.current.focus();
      setPendingLocationFocus(null);
    }
  }, [pendingLocationFocus, locations]);

  if (loading) return <div className="fo-panel"><LoadingState>Loading customer…</LoadingState></div>;

  if (!account) {
    return (
      <div className="fo-panel">
        <FailureState
          message="This customer could not be found."
          action={<button type="button" onClick={() => navigate("/customers")}>Back to Customers</button>}
        />
      </div>
    );
  }

  async function handleEditSubmit(values) {
    await updateAccount(account.id, values);
    setIsEditing(false);
  }

  // Called by LocationCreateModal. On a blocked/denied write this THROWS so the
  // modal stays open with safe copy and nothing is persisted. On success: close
  // once, announce the resolved name, queue focus onto the new row (the live
  // subscription inserts it) -- the raw id is only an internal match key.
  async function handleAddLocation(values) {
    const created = await createLocation(account.id, values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowLocationModal(false);
    setPendingLocationFocus(created.id);
    setLocationAnnouncement(`Location ${created.name} added.`);
  }

  // Called by ContactCreateModal -- same contract as handleAddLocation.
  async function handleAddContact(values) {
    const created = await createContact(account.id, values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    setShowContactModal(false);
    setPendingContactFocus(created.id);
    setContactAnnouncement(`Contact ${created.name} added.`);
  }

  // Called by ContactImportModal on a successful atomic import. Close the modal,
  // announce the totals, and queue focus onto the first imported Contact; the live
  // subscription renders the new rows itself (no manual insert/refetch).
  function handleImported({ importedIds, importedCount, skippedDuplicates, rejected, firstName }) {
    setShowImport(false);
    setPendingContactFocus(importedIds?.[0] ?? null);
    const skipPart = skippedDuplicates ? `, ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"} skipped` : "";
    const rejPart = rejected ? `, ${rejected} rejected` : "";
    setContactAnnouncement(
      `Imported ${importedCount} contact${importedCount === 1 ? "" : "s"}${skipPart}${rejPart}${firstName ? ` — first: ${firstName}` : ""}.`
    );
  }

  const billingLine = formatAddress(account.billingAddress);
  const hasIdentifiers =
    account.customerNumber || account.erpId || account.accountingId || account.legacyId;

  return (
    <div className="fo-panel">
      <button type="button" onClick={() => navigate("/customers")} className="fo-link-btn">
        &larr; Back to Customers
      </button>

      {isEditing ? (
        <AccountForm
          initialValues={account}
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditing(false)}
          submitLabel="Save Changes"
          contacts={contacts}
          contactsLoading={contactsLoading}
          contactsError={contactsError}
        />
      ) : (
        <>
          {/* 1. Account Summary -- always visible, never collapsed */}
          <section className="fo-account-summary">
            <div className="disp-board-toolbar" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{account.name}</h2>
              <button type="button" onClick={() => setIsEditing(true)}>Edit</button>
            </div>

            <div className="fo-badge-row">
              {account.status && (
                <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
              )}
              <RelationshipBadges relationshipTypes={account.relationshipTypes} />
            </div>

            {account.customerNumber && (
              <div className="fo-muted">Customer #: {account.customerNumber}</div>
            )}
            {billingLine && <div className="fo-muted">Billing: {billingLine}</div>}
            <PrimaryContactSummary contacts={contacts} />
            {(account.tags ?? []).length > 0 && (
              <div className="fo-muted">Tags: {account.tags.join(", ")}</div>
            )}
          </section>

          {/* Commercial Profile -- informational fields + current-name identity (PR 1) */}
          <CommercialProfileSection
            account={account}
            contacts={contacts}
            contactsLoading={contactsLoading}
            contactsError={contactsError}
            byUserId={byUserId}
            directoryLoading={directoryLoading}
            directoryError={directoryError}
          />

          {/* 2. Financial Summary -- provider-neutral surface; unconfigured only (PR 4) */}
          <FinancialSummarySection />

          {/* Credit (unavailable) + Financial Forecast Horizons -- provider-neutral
              surfaces; unconfigured only, definitions-only (Commercial Profile PR 4) */}
          <FinancialForecastSection />

          {/* 3. Contacts */}
          <section className="wo-history">
            <h4>Contacts ({contacts.length})</h4>
            <p className="fo-sr-only" role="status" aria-live="polite">{contactAnnouncement}</p>
            {contacts.length === 0 ? (
              <EmptyState variant="database" message="No contacts yet." />
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="wo-history-row"
                  ref={contact.id === pendingContactFocus ? contactRowRef : undefined}
                  tabIndex={contact.id === pendingContactFocus ? -1 : undefined}
                >
                  <strong>{contact.name}</strong>
                  {contact.isPrimary && <span className="fo-badge fo-badge-active"> Primary</span>}
                  {contact.phone && <span className="fo-muted"> -- {contact.phone}</span>}
                  {contact.email && <span className="fo-muted"> -- {contact.email}</span>}
                </div>
              ))
            )}
            {/* Add Contact opens the shared-Modal creation flow; Import Contacts
                keeps its own separate CSV modal. No inline form below the list. */}
            <div className="fo-btn-row">
              <button type="button" onClick={() => setShowContactModal(true)}>+ Add Contact</button>
              <button type="button" onClick={() => setShowImport(true)}>Import Contacts</button>
            </div>
          </section>

          {showContactModal && (
            <ContactCreateModal
              accountName={account.name}
              onCreate={handleAddContact}
              onClose={() => setShowContactModal(false)}
            />
          )}

          {showImport && (
            <ContactImportModal
              accountId={account.id}
              accountName={account.name}
              existingContacts={contacts}
              onClose={() => setShowImport(false)}
              onImported={handleImported}
            />
          )}

          {/* 4. Locations -- add-only (no Location edit action exists) */}
          <section className="wo-history">
            <h4>Locations ({locations.length})</h4>
            <p className="fo-sr-only" role="status" aria-live="polite">{locationAnnouncement}</p>
            {locations.length === 0 ? (
              <EmptyState variant="database" message="No locations yet." />
            ) : (
              locations.map((loc) => {
                const locLine = formatAddress(loc.address);
                return (
                  <div
                    key={loc.id}
                    className="wo-history-row"
                    ref={loc.id === pendingLocationFocus ? locationRowRef : undefined}
                    tabIndex={loc.id === pendingLocationFocus ? -1 : undefined}
                  >
                    <strong>{loc.name}</strong>
                    {locLine && <span className="fo-muted"> -- {locLine}</span>}
                    {loc.accessNotes && <div className="fo-muted">{loc.accessNotes}</div>}
                  </div>
                );
              })
            )}
            {/* Add Location opens the shared-Modal creation flow; no inline form. */}
            <button type="button" onClick={() => setShowLocationModal(true)}>+ Add Location</button>
          </section>

          {showLocationModal && (
            <LocationCreateModal
              accountName={account.name}
              onCreate={handleAddLocation}
              onClose={() => setShowLocationModal(false)}
            />
          )}

          {/* 5. Service Activity -- live summary counts + Account Activity timeline (PR 3) */}
          <ServiceActivitySection accountId={account.id} />

          {/* 6. Notes / Identifiers -- collapsed by default */}
          <details className="fo-account-collapsible">
            <summary>Notes &amp; Identifiers</summary>
            {account.notes ? (
              <div className="wo-inventory"><strong>Notes:</strong> {account.notes}</div>
            ) : (
              <p className="fo-muted">No notes.</p>
            )}
            {hasIdentifiers ? (
              <div className="fo-muted">
                {account.customerNumber && <div>Customer #: {account.customerNumber}</div>}
                {account.erpId && <div>ERP ID: {account.erpId}</div>}
                {account.accountingId && <div>Accounting ID: {account.accountingId}</div>}
                {account.legacyId && <div>Legacy ID: {account.legacyId}</div>}
              </div>
            ) : (
              <p className="fo-muted">No external identifiers.</p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
