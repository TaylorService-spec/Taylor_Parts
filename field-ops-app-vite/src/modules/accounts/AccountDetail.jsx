import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAccount } from "../../hooks/useAccount";
import { useLocationsForAccount } from "../../hooks/useLocationsForAccount";
import { useContactsForAccount } from "../../hooks/useContactsForAccount";
import { updateAccount } from "../../domain/accounts";
import { createLocation } from "../../domain/locations";
import { createContact } from "../../domain/contacts";
import AccountForm from "./AccountForm";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountDetail;
// rendered UI says "Customer Detail" throughout. Locations and
// Contacts are shown inline here only -- no standalone top-level list
// page for either, per this sprint's scope (no current product need to
// browse locations/contacts independent of their Account). Future tabs
// (Overview/Locations/Contacts/Timeline/Work Orders/Invoices) are
// documented as a future shape, not built this sprint -- this file is
// a single flat panel, not a tab shell.
function LocationForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [accessNotes, setAccessNotes] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({
      name: trimmedName,
      address: { street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim() },
      accessNotes: accessNotes.trim() || null,
    });
  }

  return (
    <form className="fo-form" onSubmit={handleSubmit}>
      <input placeholder="Site name (e.g. Main Office)" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Street" value={street} onChange={(e) => setStreet(e.target.value)} />
      <input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
      <input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
      <input placeholder="Zip" value={zip} onChange={(e) => setZip(e.target.value)} />
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

export default function AccountDetail() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const { account, loading } = useAccount(accountId);
  const { data: locations } = useLocationsForAccount(accountId);
  const { data: contacts } = useContactsForAccount(accountId);

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
            <button type="button" onClick={() => setIsEditing(true)}>Edit</button>
          </div>

          {account.status && (
            <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
          )}
          {(account.tags ?? []).length > 0 && (
            <div className="fo-muted">Tags: {account.tags.join(", ")}</div>
          )}
          {account.billingAddress && (
            <div className="fo-muted">
              Billing: {[account.billingAddress.street, account.billingAddress.city, account.billingAddress.state, account.billingAddress.zip]
                .filter(Boolean)
                .join(", ")}
            </div>
          )}
          {account.notes && <div className="wo-inventory"><strong>Notes:</strong> {account.notes}</div>}
        </>
      )}

      <div className="wo-history">
        <h4>Locations ({locations.length})</h4>
        {locations.length === 0 ? (
          <p className="fo-muted">No locations yet.</p>
        ) : (
          locations.map((loc) => (
            <div key={loc.id} className="wo-history-row">
              <strong>{loc.name}</strong>
              {loc.address && (
                <span className="fo-muted"> -- {[loc.address.street, loc.address.city, loc.address.state, loc.address.zip].filter(Boolean).join(", ")}</span>
              )}
              {loc.accessNotes && <div className="fo-muted">{loc.accessNotes}</div>}
            </div>
          ))
        )}
        {showLocationForm ? (
          <LocationForm onSubmit={handleAddLocation} onCancel={() => setShowLocationForm(false)} />
        ) : (
          <button type="button" onClick={() => setShowLocationForm(true)}>+ Add Location</button>
        )}
      </div>

      <div className="wo-history">
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
      </div>
    </div>
  );
}
