// WAREHOUSE AND BIN MASTERS -- the Administration surface for the governed PostgreSQL Warehouse and Bin master data
// (Controller DQ-E, 2026-10-01: "Administration UI/API -> governed server command -> PostgreSQL"). Every read and change
// goes to /admin/policy, where the server gates it on warehouse.record.manage (configuration authority, never implied by
// working in a warehouse) and audits each change with its stated reason. This component decides nothing: a refusal is
// rendered as the server's answer.
//
// A warehouse is its operating company's root: the company is chosen once, as a governed operating company id (the
// server resolves its ACTIVE key and refuses an unbound company), and never changes. Fixture identities are refused by
// the server as identities for a real master.
import { useCallback, useEffect, useState } from "react";
import { SectionHeader, StatusIndicator, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";
import { operatingCompanyLabel, statusLabel } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "Warehouse and bin masters are not available to you. They need warehouse.record.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

const EMPTY_WAREHOUSE = { warehouseId: "", name: "", siteLabel: "", operatingCompanyId: "" };
const EMPTY_BIN = { area: "", aisle: "", bay: "", position: "", name: "" };

const WAREHOUSE_COLUMNS = Object.freeze({
  warehouse: { value: (w) => w.warehouseId },
  name: { value: (w) => w.name },
  site: { value: (w) => w.siteLabel },
  company: { value: (w) => operatingCompanyLabel(w.operatingCompanyId) },
  bins: { value: (w) => (typeof w.binCount === "number" ? w.binCount : null) },
  status: { value: (w) => statusLabel(w.status) },
});
const BIN_COLUMNS = Object.freeze({
  code: { value: (b) => b.code },
  name: { value: (b) => b.name },
  status: { value: (b) => statusLabel(b.status) },
});
const NO_BINS = Object.freeze([]);

export default function WarehouseMasters({ callApi = callPolicyApi }) {
  const [warehouses, setWarehouses] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [draft, setDraft] = useState(EMPTY_WAREHOUSE);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState(null);
  const [bins, setBins] = useState(null);
  const [binDraft, setBinDraft] = useState(EMPTY_BIN);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const warehouseSort = useTableSort({ rows: warehouses, columns: WAREHOUSE_COLUMNS });
  const binSort = useTableSort({ rows: bins ?? NO_BINS, columns: BIN_COLUMNS });
  const whHeader = (key, label) => <SortableHeader columnKey={key} label={label} sort={warehouseSort.sort} onSort={warehouseSort.toggle} />;
  const binHeader = (key, label) => <SortableHeader columnKey={key} label={label} sort={binSort.sort} onSort={binSort.toggle} />;

  const load = useCallback(async () => {
    const res = await callApi("listWarehouses", {});
    if (!res.ok) { setWarehouses(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setWarehouses(res.data?.items ?? []);
  }, [callApi]);

  const loadBins = useCallback(async (warehouseId) => {
    const res = await callApi("listWarehouseBins", { warehouseId });
    setBins(res.ok ? (res.data?.items ?? []) : []);
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

  const createWarehouse = () => run("createWarehouse", draft, async () => { setDraft(EMPTY_WAREHOUSE); await load(); });
  const toggleWarehouse = (w) => run("setWarehouseStatus", { warehouseId: w.warehouseId, status: w.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, load);
  const createBin = () => run("createBin", {
    warehouseId: selected.warehouseId, area: binDraft.area.trim().toUpperCase(), aisle: binDraft.aisle.trim().toUpperCase(),
    bay: Number(binDraft.bay), position: Number(binDraft.position), name: binDraft.name || null,
    idempotencyKey: `bin-${selected.warehouseId}-${binDraft.area}-${binDraft.aisle}-${binDraft.bay}-${binDraft.position}`,
  }, async () => { setBinDraft(EMPTY_BIN); await loadBins(selected.warehouseId); await load(); });
  const toggleBin = (b) => run("setBinStatus", { binId: b.binId, status: b.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, () => loadBins(selected.warehouseId));

  return (
    <section aria-labelledby="warehouse-masters-title">
      <SectionHeader id="warehouse-masters-title" title="Warehouse and Bin Masters" description="Governed PostgreSQL master data. Each change states a reason and is audited." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {warehouses && (
        <>
          <table className="fo-table">
            <thead><tr>
              {whHeader("warehouse", "Warehouse")}{whHeader("name", "Name")}{whHeader("site", "Site")}{whHeader("company", "Operating Company")}
              {whHeader("bins", "Bins")}{whHeader("status", "Status")}<th />
            </tr></thead>
            <tbody>
              {warehouseSort.sorted.map((w) => (
                <tr key={w.warehouseId}>
                  <td><Button size="sm" variant="secondary" onClick={() => { setSelected(w); loadBins(w.warehouseId); }}>{w.warehouseId}</Button></td>
                  <td>{w.name}</td>
                  <td>{w.siteLabel}</td>
                  <td>{w.operatingCompanyId ? operatingCompanyLabel(w.operatingCompanyId) : "— (no governed company)"}</td>
                  <td>{w.binCount}</td>
                  <td><StatusIndicator tone={w.status === "ACTIVE" ? "positive" : "neutral"}>{statusLabel(w.status)}</StatusIndicator></td>
                  <td><Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => toggleWarehouse(w)}>{w.status === "ACTIVE" ? "Deactivate" : "Activate"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>New Warehouse</h4>
          <div className="fo-form-row">
            <Field label="Warehouse ID"><input className="fo-input" value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })} /></Field>
            <Field label="Name"><input className="fo-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Site"><input className="fo-input" value={draft.siteLabel} onChange={(e) => setDraft({ ...draft, siteLabel: e.target.value })} /></Field>
            <Field label="Operating Company">
              <select className="fo-input" value={draft.operatingCompanyId} onChange={(e) => setDraft({ ...draft, operatingCompanyId: e.target.value })}>
                <option value="">Choose an Operating Company…</option>
                {OPERATING_COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </Field>
          </div>
          {selected && (
            <>
              <h4>Bins in {selected.warehouseId}</h4>
              <table className="fo-table">
                <thead><tr>{binHeader("code", "Code")}{binHeader("name", "Name")}{binHeader("status", "Status")}<th /></tr></thead>
                <tbody>
                  {binSort.sorted.map((b) => (
                    <tr key={b.binId}>
                      <td>{b.code}</td><td>{b.name ?? ""}</td>
                      <td><StatusIndicator tone={b.status === "ACTIVE" ? "positive" : "neutral"}>{statusLabel(b.status)}</StatusIndicator></td>
                      <td><Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => toggleBin(b)}>{b.status === "ACTIVE" ? "Deactivate" : "Activate"}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="fo-form-row">
                <Field label="Area"><input className="fo-input" value={binDraft.area} onChange={(e) => setBinDraft({ ...binDraft, area: e.target.value })} /></Field>
                <Field label="Aisle (Letters)"><input className="fo-input" value={binDraft.aisle} onChange={(e) => setBinDraft({ ...binDraft, aisle: e.target.value })} /></Field>
                <Field label="Bay"><input className="fo-input" inputMode="numeric" value={binDraft.bay} onChange={(e) => setBinDraft({ ...binDraft, bay: e.target.value })} /></Field>
                <Field label="Position"><input className="fo-input" inputMode="numeric" value={binDraft.position} onChange={(e) => setBinDraft({ ...binDraft, position: e.target.value })} /></Field>
                <Field label="Name (Optional)"><input className="fo-input" value={binDraft.name} onChange={(e) => setBinDraft({ ...binDraft, name: e.target.value })} /></Field>
              </div>
            </>
          )}
          <Field label="Reason (Required for Every Change)"><input className="fo-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="fo-form-actions">
            <Button disabled={busy || !reason.trim() || !draft.warehouseId || !draft.name || !draft.siteLabel || !draft.operatingCompanyId} onClick={createWarehouse}>Create Warehouse</Button>
            {selected && <Button disabled={busy || !reason.trim() || !binDraft.area || !binDraft.aisle || binDraft.bay === "" || binDraft.position === ""} onClick={createBin}>Add Bin</Button>}
          </div>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </>
      )}
    </section>
  );
}
