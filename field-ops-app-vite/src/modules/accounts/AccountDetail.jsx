import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { createLocation } from "../../domain/locations";
import { createContact, primaryContactState } from "../../domain/contacts";
import { formatAddress, addressRows } from "../../domain/address";
import AccountForm from "./AccountForm";
import { Tabs, TabPanel } from "../../shared/tabs/Tabs";
import AddressFields from "../../shared/address/AddressFields";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountDetail;
// rendered UI says "Customer Detail" throughout. Locations and
// Contacts are shown inline here only -- no standalone top-level list
// page for either, per this sprint's scope (no current product need to
// browse locations/contacts independent of their Account).
//
// Customer Record Page sprint, PR 1 (docs/specifications/customer-record-page-structured-address.md).
// Redesigned from a single flat panel into a header + Details/
// Locations/Contacts tab shell, per that Specification's Technical
// design section. Work Orders/Activity/Invoices/Related tabs are
// documented there as named future candidates -- not built as empty
// shells here.
const CUSTOMER_TABS = [
  { id: "details", label: "Details" },
  { id: "locations", label: "Locations" },
  { id: "contacts", label: "Contacts" },
];

// Location's current handleSubmit() always sends address as an object
// of (possibly empty) trimmed strings -- never null, unlike
// AccountForm.jsx's hasAddress check. This sprint does not change that
// existing asymmetry between Account and Location blank-address
// behavior (docs/specifications/customer-record-page-structured-address.md's
// Testing strategy) -- only the four raw inputs are replaced by
// AddressFields.
function LocationForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState({ street: "", city: "", state: "", zip: "" });
  const [accessNotes, setAccessNotes] = useState("");

  function handleAddressChange(field, newValue) {
    setAddress((prev) => ({ ...prev, [field]: newValue }));
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
      <AddressFields value={address} onChange={handleAddressChange} idPrefix="location-add" />
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

// Header rendering per docs/specifications/customer-record-page-structured-address.md's
// primaryContactState() derivation -- three states, never silently
// picks one Contact when multiple are marked primary.
function PrimaryContactSummary({ contacts }) {
  const result = primaryContactState(contacts);

  if (result.state === "NONE") {
    return <p className="fo-muted">No primary contact.</p>;
  }

  if (result.state === "ONE") {
    const { contact } = result;
    return (
      <p className="fo-muted">
        Primary contact: {contact.name}
        {contact.phone && <> &middot; {contact.phone}</>}
        {contact.email && <> &middot; {contact.email}</>}
      </p>
    );
  }

  return (
    <p>
      <span className="fo-badge fo-badge-critical">Multiple primary contacts</span>
    </p>
  );
}

function DetailsTab({ account }) {
  const [showExternalIds, setShowExternalIds] = useState(false);
  const billingRows = addressRows(account.billingAddress);
  const hasExternalIds = account.customerNumber || account.erpId || account.accountingId || account.legacyId;

  return (
    <div className="acct-detail-grid">
      <div className="fo-card">
        <h3>Customer Information</h3>
        <p><strong>Name:</strong> {account.name}</p>
        {account.status && (
          <p>
            <strong>Status:</strong> <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
          </p>
        )}
        {account.customerNumber && <p><strong>Customer #:</strong> {account.customerNumber}</p>}
      </div>

      <div className="fo-card">
        <h3>Billing Address</h3>
        {billingRows.length === 0 ? (
          <p className="fo-muted">No billing address on file.</p>
        ) : (
          billingRows.map((row) => (
            <p key={row.label}>
              <strong>{row.label}:</strong> {row.value}
            </p>
          ))
        )}
      </div>

      <div className="fo-card">
        <h3>External Identifiers</h3>
        <button type="button" onClick={() => setShowExternalIds((v) => !v)} className="fo-link-btn">
          {showExternalIds ? "Hide" : "Show"} external IDs (future integrations)
        </button>
        {showExternalIds && (
          hasExternalIds ? (
            <>
              {account.customerNumber && <p><strong>Customer number:</strong> {account.customerNumber}</p>}
              {account.erpId && <p><strong>ERP ID:</strong> {account.erpId}</p>}
              {account.accountingId && <p><strong>Accounting ID:</strong> {account.accountingId}</p>}
              {account.legacyId && <p><strong>Legacy ID:</strong> {account.legacyId}</p>}
            </>
          ) : (
            <p className="fo-muted">No external identifiers on file.</p>
          )
        )}
      </div>

      <div className="fo-card">
        <h3>Notes and Tags</h3>
        {account.notes && <p><strong>Notes:</strong> {account.notes}</p>}
        {(account.tags ?? []).length > 0 && <p><strong>Tags:</strong> {account.tags.join(", ")}</p>}
        {!account.notes && (account.tags ?? []).length === 0 && <p className="fo-muted">No notes or tags on file.</p>}
      </div>
    </div>
  );
}

function LocationsTab({ locations, showLocationForm, setShowLocationForm, onAddLocation }) {
  return (
    <div className="wo-history">
      <h4>Locations ({locations.length})</h4>
      {locations.length === 0 ? (
        <p className="fo-muted">No locations yet.</p>
      ) : (
        locations.map((loc) => {
          const rows = addressRows(loc.address);
          return (
            <div key={loc.id} className="fo-card">
              <h3>{loc.name}</h3>
              {rows.length === 0 ? (
                <p className="fo-muted">No address on file.</p>
              ) : (
                rows.map((row) => (
                  <p key={row.label}>
                    <strong>{row.label}:</strong> {row.value}
                  </p>
                ))
              )}
              {loc.accessNotes && <p className="fo-muted">{loc.accessNotes}</p>}
            </div>
          );
        })
      )}
      {showLocationForm ? (
        <LocationForm onSubmit={onAddLocation} onCancel={() => setShowLocationForm(false)} />
      ) : (
        <button type="button" onClick={() => setShowLocationForm(true)}>+ Add Location</button>
      )}
    </div>
  );
}

function ContactsTab({ contacts, showContactForm, setShowContactForm, onAddContact }) {
  const primaryState = primaryContactState(contacts);

  return (
    <div className="wo-history">
      <h4>Contacts ({contacts.length})</h4>
      {primaryState.state === "MULTIPLE" && (
        <p><span className="fo-badge fo-badge-critical">Multiple primary contacts</span></p>
      )}
      {contacts.length === 0 ? (
        <p className="fo-muted">No contacts yet.</p>
      ) : (
        contacts.map((contact) => (
          <div key={contact.id} className="fo-card">
            <h3>
              {contact.name}
              {contact.isPrimary && <span className="fo-badge fo-badge-active"> Primary</span>}
            </h3>
            {contact.phone && <p className="fo-muted">{contact.phone}</p>}
            {contact.email && <p className="fo-muted">{contact.email}</p>}
          </div>
        ))
      )}
      {showContactForm ? (
        <ContactForm onSubmit={onAddContact} onCancel={() => setShowContactForm(false)} />
      ) : (
        <button type="button" onClick={() => setShowContactForm(true)}>+ Add Contact</button>
      )}
    </div>
  );
}

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { account, loading } = useAccount(accountId);
  const { data: locations } = useLocationsForAccount(accountId);
  const { data: contacts } = useContactsForAccount(accountId);

  const [isEditing, setIsEditing] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [activeTabId, setActiveTabId] = useState("details");

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

  return (
    <div className="fo-panel">
      <button type="button" onClick={() => navigate("/customers")} className="fo-link-btn">
        &larr; Back to Customers
      </button>

      {isEditing ? (
        <AccountForm initialValues={account} onSubmit={handleEditSubmit} onCancel={() => setIsEditing(false)} submitLabel="Save Changes" />
      ) : (
        <>
          <div className="disp-board-toolbar" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{account.name}</h2>
            <button type="button" onClick={() => setIsEditing(true)}>Edit Customer</button>
          </div>

          {account.status && (
            <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
          )}
          {account.customerNumber && <p className="fo-muted">Customer #{account.customerNumber}</p>}
          {formatAddress(account.billingAddress) && (
            <p className="fo-muted">Billing address: {formatAddress(account.billingAddress)}</p>
          )}
          <PrimaryContactSummary contacts={contacts} />
          {(account.tags ?? []).length > 0 && (
            <p className="fo-muted">Tags: {account.tags.join(", ")}</p>
          )}

          <Tabs tabs={CUSTOMER_TABS} activeTabId={activeTabId} onChange={setActiveTabId}>
            <TabPanel tabId="details">
              <DetailsTab account={account} />
            </TabPanel>
            <TabPanel tabId="locations">
              <LocationsTab
                locations={locations}
                showLocationForm={showLocationForm}
                setShowLocationForm={setShowLocationForm}
                onAddLocation={handleAddLocation}
              />
            </TabPanel>
            <TabPanel tabId="contacts">
              <ContactsTab
                contacts={contacts}
                showContactForm={showContactForm}
                setShowContactForm={setShowContactForm}
                onAddContact={handleAddContact}
              />
            </TabPanel>
          </Tabs>
        </>
      )}
    </div>
  );
}
