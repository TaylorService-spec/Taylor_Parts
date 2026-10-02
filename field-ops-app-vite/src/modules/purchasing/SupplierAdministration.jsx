import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/primitives";
import {
  createSupplierRelationship, fetchSupplierList, fetchSupplierOrganizationOptions, setSupplierRelationshipStatus,
} from "../../services/partsOperationsReads.js";

// SUPPLIER ADMINISTRATION (DECISIONS #196) -- the bounded management panel on Purchasing > Suppliers.
//
// A supplier is the purchasing RELATIONSHIP of an existing CRM organization governed as a VENDOR: the administrator picks the
// organization BY NAME (never an id to type), states a short supplier id and the supplier-specific operational fields, and the
// server authors the supplier's name from the organization. Status is ACTIVE / INACTIVE -- never a delete. Authority is the
// server's (inventory.catalog.manage / inventory.catalog.activate, managed in Administration); a refusal is shown as the
// server states it, never hidden or second-guessed here.
export function supplierIdIsValid(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export default function SupplierAdministration({ onChanged }) {
  const [orgs, setOrgs] = useState({ loading: true, error: null, items: [] });
  const [suppliers, setSuppliers] = useState([]);
  const [generation, setGeneration] = useState(0);
  const [crmAccountId, setCrmAccountId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [vendorNumber, setVendorNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSupplierOrganizationOptions()
      .then((items) => { if (!cancelled) setOrgs({ loading: false, error: null, items }); })
      .catch((err) => { if (!cancelled) setOrgs({ loading: false, error: err?.code ?? "unknown", items: [] }); });
    fetchSupplierList().then((items) => { if (!cancelled) setSuppliers(items); }).catch(() => { if (!cancelled) setSuppliers([]); });
    return () => { cancelled = true; };
  }, [generation]);

  if (orgs.error === "FORBIDDEN") return null; // this person does not administer suppliers; the list above stays read-only

  async function run(fn, done) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "fo-muted", text: done });
      setGeneration((g) => g + 1);
      onChanged?.();
    } catch (err) {
      setMessage({ tone: "fo-warning", text: err?.message ?? "The supplier change was refused." });
    } finally {
      setBusy(false);
    }
  }

  const optional = (v) => (v.trim() === "" ? {} : undefined);
  async function handleCreate(e) {
    e.preventDefault();
    if (!crmAccountId) { setMessage({ tone: "fo-warning", text: "Select the vendor organization." }); return; }
    if (!supplierIdIsValid(supplierId)) { setMessage({ tone: "fo-warning", text: "Supplier id: 1-64 letters, digits, '-' or '_'." }); return; }
    await run(() => createSupplierRelationship({ supplierId, crmAccountId,
      ...(optional(vendorNumber) ?? { vendorNumber: vendorNumber.trim() }), ...(optional(contactName) ?? { contactName: contactName.trim() }),
      ...(optional(email) ?? { email: email.trim() }) }), "Supplier relationship created.");
  }

  return (
    <section className="fo-card" aria-label="Supplier administration">
      <h3>Supplier administration</h3>
      {message && <p className={message.tone} role="status">{message.text}</p>}
      <form className="fo-form" onSubmit={handleCreate}>
        <label htmlFor="sup-org">Vendor organization</label>
        {orgs.loading ? <p className="fo-muted" role="status">Loading vendor organizations…</p> : (
          <select id="sup-org" value={crmAccountId} onChange={(e) => setCrmAccountId(e.target.value)}>
            <option value="">{orgs.items.length === 0 ? "No vendor organization without a supplier" : "Select…"}</option>
            {orgs.items.map((o) => <option key={o.crmAccountId} value={o.crmAccountId}>{o.name}</option>)}
          </select>
        )}
        <label htmlFor="sup-id">Supplier id</label>
        <input id="sup-id" type="text" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required />
        <label htmlFor="sup-vendor-number">Vendor number (optional)</label>
        <input id="sup-vendor-number" type="text" value={vendorNumber} onChange={(e) => setVendorNumber(e.target.value)} />
        <label htmlFor="sup-contact">Purchasing contact (optional)</label>
        <input id="sup-contact" type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <label htmlFor="sup-email">Order email (optional)</label>
        <input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="disp-board-toolbar"><Button type="submit" loading={busy}>Create supplier</Button></div>
      </form>
      {suppliers.length > 0 && (
        <table className="fo-table" aria-label="Supplier status">
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.supplierId ?? s.id}>
                <td>{s.name}</td>
                <td>{s.status === "ACTIVE" ? "Supplier active" : s.status === "INACTIVE" ? "Supplier inactive" : "Ungoverned"}</td>
                <td>
                  {(s.status === "ACTIVE" || s.status === "INACTIVE") && (
                    <Button variant="tertiary" disabled={busy} onClick={() => run(() => setSupplierRelationshipStatus({
                      supplierId: s.supplierId ?? s.id, status: s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE", expectedVersion: s.version,
                      reason: s.status === "ACTIVE" ? "deactivated in Supplier administration" : "reactivated in Supplier administration" }),
                    s.status === "ACTIVE" ? "Supplier deactivated." : "Supplier reactivated.")}>
                      {s.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
