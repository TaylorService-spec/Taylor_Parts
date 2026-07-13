import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { createLocation } from "../../domain/locations";
import { createContact, primaryContactState } from "../../domain/contacts";
import { formatAddress } from "../../domain/address";
import { ACCOUNT_RELATIONSHIP_TYPE } from "../../domain/constants";
import AddressFields from "../../shared/address/AddressFields";
import AccountForm from "./AccountForm";
import ServiceActivitySection from "./ServiceActivitySection";
import FinancialSummarySection from "./FinancialSummarySection";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { resolveOwnerIdentity, resolveContactIdentity } from "../../domain/commercialProfile";

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

function LocationForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState({ street: "", city: "", state: "", zip: "" });
  const [accessNotes, setAccessNotes] = useState("");

  function handleAddressChange(field, value) {
    setAddress((cur) => ({ ...cur, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({
      name: trimmedName,
      address: {
        street: address.street.trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        zip: address.zip.trim(),
      },
      accessNotes: accessNotes.trim() || null,
    });
  }

  return (
    <form className="fo-form" onSubmit={handleSubmit}>
      <input placeholder="Site name (e.g. Main Office)" value={name} onChange={(e) => setName(e.target.value)} />
      <AddressFields value={address} onChange={handleAddressChange} idPrefix="location-address" />
      <input placeholder="Access notes (optional)" value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
      <div className="fo-btn-row">
        <button type="submit">Add Location</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ContactForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({ name: trimmedName, phone: phone.trim() || null, email: email.trim() || null, isPrimary });
  }

  return (
    <form className="fo-form" onSubmit={handleSubmit}>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="fo-checkbox-label">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        Primary Contact
      </label>
      <div className="fo-btn-row">
        <button type="submit">Add Contact</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

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

// Renders one resolved identity line, preserving its resolution state: a
// distinct "resolving…" while the lookup source is still loading, an explicit
// unavailable line on a listener error, the CURRENT resolved name when found,
// and "Unknown …" only after a completed unresolved lookup. Renders nothing
// when the reference is unset.
function IdentityLine({ label, identity }) {
  if (identity.state === "unset") return null;
  if (identity.state === "loading") {
    return <div>{label}: <span className="fo-muted">resolving…</span></div>;
  }
  if (identity.state === "error") {
    return <div>{label}: <span className="fo-warning">{identity.name}</span></div>;
  }
  return <div>{label}: {identity.name}</div>;
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
    ownerIdentity.state !== "unset" ||
    billingIdentity.state !== "unset";

  return (
    <section className="wo-history">
      <h4>Commercial Profile</h4>
      {hasAny ? (
        <div className="fo-muted">
          <IdentityLine label="Owner" identity={ownerIdentity} />
          {currency && <div>Default currency: {currency}</div>}
          {hasPo && <div>Purchase order required: {account.purchaseOrderRequired ? "Yes" : "No"}</div>}
          {invoiceMethod && <div>Invoice delivery: {invoiceMethod}</div>}
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
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);

  if (loading) return <div className="fo-panel"><p className="fo-muted">Loading customer...</p></div>;

  if (!account) {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Customer not found.</p>
        <button type="button" onClick={() => navigate("/customers")}>Back to Customers</button>
      </div>
    );
  }

  async function handleEditSubmit(values) {
    await updateAccount(account.id, values);
    setIsEditing(false);
  }

  async function handleAddLocation(values) {
    await createLocation(account.id, values);
    setShowLocationForm(false);
  }

  async function handleAddContact(values) {
    await createContact(account.id, values);
    setShowContactForm(false);
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
        <AccountForm initialValues={account} onSubmit={handleEditSubmit} onCancel={() => setIsEditing(false)} submitLabel="Save Changes" contacts={contacts} contactsLoading={contactsLoading} />
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

          {/* 3. Contacts */}
          <section className="wo-history">
            <h4>Contacts ({contacts.length})</h4>
            {contacts.length === 0 ? (
              <p className="fo-muted">No contacts yet.</p>
            ) : (
              contacts.map((contact) => (
                <div key={contact.id} className="wo-history-row">
                  <strong>{contact.name}</strong>
                  {contact.isPrimary && <span className="fo-badge fo-badge-active"> Primary</span>}
                  {contact.phone && <span className="fo-muted"> -- {contact.phone}</span>}
                  {contact.email && <span className="fo-muted"> -- {contact.email}</span>}
                </div>
              ))
            )}
            {showContactForm ? (
              <ContactForm onSubmit={handleAddContact} onCancel={() => setShowContactForm(false)} />
            ) : (
              <button type="button" onClick={() => setShowContactForm(true)}>+ Add Contact</button>
            )}
          </section>

          {/* 4. Locations -- add-only (no Location edit action exists) */}
          <section className="wo-history">
            <h4>Locations ({locations.length})</h4>
            {locations.length === 0 ? (
              <p className="fo-muted">No locations yet.</p>
            ) : (
              locations.map((loc) => {
                const locLine = formatAddress(loc.address);
                return (
                  <div key={loc.id} className="wo-history-row">
                    <strong>{loc.name}</strong>
                    {locLine && <span className="fo-muted"> -- {locLine}</span>}
                    {loc.accessNotes && <div className="fo-muted">{loc.accessNotes}</div>}
                  </div>
                );
              })
            )}
            {showLocationForm ? (
              <LocationForm onSubmit={handleAddLocation} onCancel={() => setShowLocationForm(false)} />
            ) : (
              <button type="button" onClick={() => setShowLocationForm(true)}>+ Add Location</button>
            )}
          </section>

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
