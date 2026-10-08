// TRUCK REGISTRY -- the Administration surface for the governed PostgreSQL truck / MOBILE-location registry (Controller
// TRUCK INVENTORY ACTIVATION, OD-T7, 2026-10-01). Every read and change goes to /admin/policy, where the server gates it on
// inventory.truckRegistry.manage (configuration authority, held by the Operational Configuration Administrator Role) and
// audits each change with its stated reason. This component decides nothing: a refusal is rendered as the server's answer.
//
// FOUR DISTINCT RECORDS (OD-T1). A truck (vehicle), its MOBILE inventory location (the stock key), the location's warehouse
// binding (the section above) and the Employees allowed to work from it (Employee MOBILE scope, maintained on the Employee
// in Workforce administration). This section writes only the first two; who rides a truck is shown, never edited here.
import { useCallback, useEffect, useState } from "react";
import { SectionHeader, StatusIndicator, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";
import { statusLabel } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "The truck registry is not available to you. It needs inventory.truckRegistry.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

const EMPTY_LOCATION = { locationId: "", displayLabel: "", operatingCompanyId: "" };
const EMPTY_TRUCK = { truckId: "", vehicleNumber: "", displayLabel: "", homeWarehouseId: "", mobileLocationId: "" };

const TRUCK_COLUMNS = Object.freeze({
  truck: { value: (t) => t.displayLabel ?? t.truckId },
  vehicle: { value: (t) => t.vehicleNumber },
  location: { value: (t) => t.mobileLocation?.displayLabel ?? null },
  warehouse: { value: (t) => t.boundWarehouseId },
  employees: { value: (t) => (t.scopedEmployeeIds?.length ? t.scopedEmployeeIds.join(", ") : null) },
  status: { value: (t) => statusLabel(t.status) },
});

export default function TruckRegistry({ callApi = callPolicyApi }) {
  const [trucks, setTrucks] = useState(null);
  const [locations, setLocations] = useState([]);
  const [refusal, setRefusal] = useState(null);
  const [locationDraft, setLocationDraft] = useState(EMPTY_LOCATION);
  const [truckDraft, setTruckDraft] = useState(EMPTY_TRUCK);
  const [relink, setRelink] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const { sort, toggle, sorted } = useTableSort({ rows: trucks, columns: TRUCK_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;

  const load = useCallback(async () => {
    const res = await callApi("listTrucks", {});
    if (!res.ok) { setTrucks(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setTrucks(res.data?.trucks ?? []);
    const locs = await callApi("listMobileLocations", {});
    setLocations(locs.ok ? (locs.data?.mobileLocations ?? []) : []);
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  const run = async (operation, input, after) => {
    setBusy(true);
    setNotice(null);
    const res = await callApi(operation, { ...input, reason });
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: refusalText(res) }); return; }
    setNotice({ tone: "positive", text: "Saved." });
    setReason("");
    await after?.();
  };

  const freeLocations = locations.filter((l) => !l.truckId && l.active);
  const createLocation = () => run("createMobileLocation", locationDraft, async () => { setLocationDraft(EMPTY_LOCATION); await load(); });
  const createTruck = () => run("createTruck", {
    truckId: truckDraft.truckId, vehicleNumber: truckDraft.vehicleNumber, displayLabel: truckDraft.displayLabel,
    homeWarehouseId: truckDraft.homeWarehouseId, ...(truckDraft.mobileLocationId ? { mobileLocationId: truckDraft.mobileLocationId } : {}),
  }, async () => { setTruckDraft(EMPTY_TRUCK); await load(); });
  const link = (t) => run(t.mobileLocation ? "relinkTruck" : "linkTruck", { truckId: t.truckId, mobileLocationId: relink[t.truckId] }, load);
  const unlink = (t) => run("unlinkTruck", { truckId: t.truckId }, load);
  const toggleStatus = (t) => run("changeTruckStatus", { truckId: t.truckId, status: t.status === "ACTIVE" ? "IDLE" : "ACTIVE" }, load);

  return (
    <section aria-labelledby="truck-registry-title">
      <SectionHeader id="truck-registry-title" title="Truck Registry" description="Trucks and their mobile stock locations. Each change states a reason and is audited. Who works from a truck is the Employee's MOBILE scope." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {trucks && (
        <>
          <table className="fo-table">
            <thead><tr>
              {header("truck", "Truck")}{header("vehicle", "Vehicle")}{header("location", "Stock Location")}{header("warehouse", "Bound Warehouse")}
              {header("employees", "Employees (Mobile Scope)")}{header("status", "Status")}<th />
            </tr></thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.truckId}>
                  <td>{t.displayLabel} <span className="fo-muted">({t.truckId})</span></td>
                  <td>{t.vehicleNumber}</td>
                  <td>{t.mobileLocation ? `${t.mobileLocation.displayLabel} (${t.mobileLocation.locationId})` : <span className="fo-muted">— not linked</span>}</td>
                  <td>{t.boundWarehouseId ?? <span className="fo-muted">— unbound</span>}</td>
                  <td>{t.scopedEmployeeIds.length ? t.scopedEmployeeIds.join(", ") : <span className="fo-muted">none</span>}</td>
                  <td><StatusIndicator tone={t.status === "ACTIVE" ? "positive" : "neutral"}>{statusLabel(t.status)}</StatusIndicator></td>
                  <td>
                    <select className="fo-input" aria-label={`Stock location for ${t.truckId}`} value={relink[t.truckId] ?? ""} onChange={(e) => setRelink({ ...relink, [t.truckId]: e.target.value })}>
                      <option value="">Choose a Free Location…</option>
                      {freeLocations.map((l) => <option key={l.locationId} value={l.locationId}>{l.displayLabel}</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={busy || !reason.trim() || !relink[t.truckId]} onClick={() => link(t)}>{t.mobileLocation ? "Relink" : "Link"}</Button>
                    {t.mobileLocation && <Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => unlink(t)}>Unlink</Button>}
                    {t.status !== "OUT_OF_SERVICE" && <Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => toggleStatus(t)}>{t.status === "ACTIVE" ? "Mark Idle" : "Mark Active"}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>New Mobile Stock Location</h4>
          <div className="fo-form-row">
            <Field label="Location ID"><input className="fo-input" value={locationDraft.locationId} onChange={(e) => setLocationDraft({ ...locationDraft, locationId: e.target.value })} /></Field>
            <Field label="Label"><input className="fo-input" value={locationDraft.displayLabel} onChange={(e) => setLocationDraft({ ...locationDraft, displayLabel: e.target.value })} /></Field>
            <Field label="Operating Company">
              <select className="fo-input" value={locationDraft.operatingCompanyId} onChange={(e) => setLocationDraft({ ...locationDraft, operatingCompanyId: e.target.value })}>
                <option value="">Choose an Operating Company…</option>
                {OPERATING_COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </Field>
          </div>
          <h4>New Truck</h4>
          <div className="fo-form-row">
            <Field label="Truck ID"><input className="fo-input" value={truckDraft.truckId} onChange={(e) => setTruckDraft({ ...truckDraft, truckId: e.target.value })} /></Field>
            <Field label="Vehicle Number"><input className="fo-input" value={truckDraft.vehicleNumber} onChange={(e) => setTruckDraft({ ...truckDraft, vehicleNumber: e.target.value })} /></Field>
            <Field label="Label"><input className="fo-input" value={truckDraft.displayLabel} onChange={(e) => setTruckDraft({ ...truckDraft, displayLabel: e.target.value })} /></Field>
            <Field label="Home Warehouse ID"><input className="fo-input" value={truckDraft.homeWarehouseId} onChange={(e) => setTruckDraft({ ...truckDraft, homeWarehouseId: e.target.value })} /></Field>
            <Field label="Stock Location (Optional)">
              <select className="fo-input" value={truckDraft.mobileLocationId} onChange={(e) => setTruckDraft({ ...truckDraft, mobileLocationId: e.target.value })}>
                <option value="">Not Linked Yet</option>
                {freeLocations.map((l) => <option key={l.locationId} value={l.locationId}>{l.displayLabel}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Reason (Required for Every Change)"><input className="fo-input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="fo-form-actions">
            <Button disabled={busy || !reason.trim() || !locationDraft.locationId || !locationDraft.displayLabel || !locationDraft.operatingCompanyId} onClick={createLocation}>Create Stock Location</Button>
            <Button disabled={busy || !reason.trim() || !truckDraft.truckId || !truckDraft.vehicleNumber || !truckDraft.displayLabel || !truckDraft.homeWarehouseId} onClick={createTruck}>Create Truck</Button>
          </div>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </>
      )}
    </section>
  );
}
