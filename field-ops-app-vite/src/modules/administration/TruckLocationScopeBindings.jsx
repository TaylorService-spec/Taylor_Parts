import { useCallback, useEffect, useState } from "react";
import { SectionHeader, StatusIndicator, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";

// Administration -> Warehouse Racking -> Truck location warehouse scope (Controller ruling DQ-029).
//
// Which warehouse's operational scope governs inventory acts at a truck location (DQ-024). A section of the
// existing Warehouse Racking configuration screen, on the existing /admin/policy transport -- not a new
// subsystem, and not a Firebase feed decision.
//
// ============================ THE HONEST PARTS ============================
//
// THE SERVER DECIDES. Every read and change is one Administration configuration operation, gated on the server
// by inventory.location.scopeBinding.manage. This component holds no capability list and asks no feed: a
// FORBIDDEN answer is rendered as exactly that, NOT_CONFIGURED as exactly that, and neither is an empty list.
//
// NO BINDING IS A FAIL-CLOSED STATE, NOT A BLANK. A truck location with no binding refuses every inventory act
// until one is set; the row says so.
//
// A REASON IS REQUIRED for every change, and the server audits it with the previous and new warehouse. A change
// affects future operations only.

const STATE_COPY = {
  BOUND: { tone: "positive", label: "Bound" },
  NO_BINDING: { tone: "attention", label: "No binding — truck operations refused" },
};

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") {
    return "Truck location warehouse scope is not available to you. It needs inventory.location.scopeBinding.manage, which your account does not currently hold.";
  }
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

export default function TruckLocationScopeBindings({ callApi = callPolicyApi, warehouseOptions = [] }) {
  const [rows, setRows] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [editing, setEditing] = useState(null); // { locationId, mode: "set" | "remove" }
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    const res = await callApi("listMobileLocationScopeBindings", {});
    if (!res.ok) { setRows(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setRows(res.data?.locations ?? []);
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  const begin = (locationId, mode, current) => {
    setEditing({ locationId, mode });
    setWarehouseId(current ?? "");
    setReason("");
    setNotice(null);
  };

  const explain = useCallback(async (locationId) => {
    const res = await callApi("readMobileLocationScopeBinding", { locationId });
    setHistory(res.ok ? res.data : { locationId, error: refusalText(res) });
  }, [callApi]);

  const submit = useCallback(async () => {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = editing.mode === "set"
        ? await callApi("setMobileLocationScopeBinding", { locationId: editing.locationId, warehouseId: warehouseId.trim(), reason: reason.trim() })
        : await callApi("removeMobileLocationScopeBinding", { locationId: editing.locationId, reason: reason.trim() });
      if (!res.ok) { setNotice({ tone: "critical", text: refusalText(res) }); return; }
      const d = res.data ?? {};
      const text = d.outcome === "REMOVED"
        ? `${d.locationId}: binding to ${d.previousWarehouseId} removed. Truck operations are refused until a new binding is set.`
        : d.outcome === "NO_CHANGE"
          ? `${d.locationId} is already bound to ${d.warehouseId}. Nothing changed.`
          : `${d.locationId}: ${d.previousWarehouseId ? `${d.previousWarehouseId} → ` : ""}${d.warehouseId}. Applies to future operations only.`;
      setNotice({ tone: "positive", text });
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }, [callApi, editing, warehouseId, reason, load]);

  return (
    <section aria-label="Truck location warehouse scope">
      <SectionHeader
        title="Truck location warehouse scope"
        description="Which warehouse's operational scope governs inventory acts at each truck location. A truck with no binding refuses those acts. Changes are audited and apply to future operations only."
      />
      {refusal && <StatusIndicator tone="neutral">{refusal}</StatusIndicator>}
      {notice && <StatusIndicator tone={notice.tone}>{notice.text}</StatusIndicator>}
      {rows && rows.length === 0 && <p className="fo-muted">No truck inventory locations are registered in this tenant.</p>}
      {rows && rows.length > 0 && (
        <table className="fo-table">
          <thead>
            <tr>
              <th scope="col">Truck location</th>
              <th scope="col">Scope</th>
              <th scope="col">Warehouse</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const copy = STATE_COPY[r.state] ?? { tone: "critical", label: r.state };
              return (
                <tr key={r.locationId}>
                  <td>{r.displayLabel || r.locationId}{r.active ? null : <span className="fo-muted"> (inactive)</span>}</td>
                  <td><StatusIndicator tone={copy.tone}>{copy.label}</StatusIndicator></td>
                  <td className="fo-tabular-nums">{r.scopeWarehouseId ?? <span className="fo-muted">—</span>}</td>
                  <td>
                    <Button onClick={() => begin(r.locationId, "set", r.scopeWarehouseId)} disabled={busy || !r.active}>
                      {r.scopeWarehouseId ? "Change" : "Bind"}
                    </Button>
                    {r.scopeWarehouseId && (
                      <Button onClick={() => begin(r.locationId, "remove", r.scopeWarehouseId)} disabled={busy}>Remove</Button>
                    )}
                    <Button onClick={() => explain(r.locationId)} disabled={busy}>History</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label="Truck location scope change">
          <p>
            {editing.mode === "set" ? "Bind" : "Remove the binding of"} <strong>{editing.locationId}</strong>
            {editing.mode === "remove" ? ". Truck operations will be refused until a new binding is set." : null}
          </p>
          {editing.mode === "set" && (
            <>
              <Field id="truck-scope-warehouse" label="Warehouse" required
                hint="An ACTIVE warehouse of the truck location's own operating company. The server checks both.">
                <input
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  list="truck-scope-warehouse-options"
                />
              </Field>
              <datalist id="truck-scope-warehouse-options">
                {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.name ?? w.id}</option>)}
              </datalist>
            </>
          )}
          <Field id="truck-scope-reason" label="Reason" required>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {reason.trim() === "" && <FormError>A reason is required.</FormError>}
          <Button type="submit" disabled={busy || reason.trim() === "" || (editing.mode === "set" && warehouseId.trim() === "")}>
            {editing.mode === "set" ? "Save binding" : "Remove binding"}
          </Button>
          <Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
        </form>
      )}

      {history && (
        <div aria-label="Truck location scope history">
          {history.error ? <StatusIndicator tone="critical">{history.error}</StatusIndicator> : (
            <>
              <p>{history.explanation}</p>
              <ul>
                {(history.history ?? []).map((b) => (
                  <li key={b.id}>
                    {b.warehouseId} from {b.effectiveFrom}{b.effectiveTo ? ` to ${b.effectiveTo}` : " (current)"} — {b.reason}
                    {b.endReason ? `; ended: ${b.endReason}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
