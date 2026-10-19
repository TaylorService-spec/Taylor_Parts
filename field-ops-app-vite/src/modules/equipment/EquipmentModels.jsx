// Equipment MODEL catalog -- the manufacturer/model reference rows Equipment, Parts and Sales Agreements point at (PERM-UI).
//
// A catalog entry, NOT an installed unit: no owner, location or serial. List, create and edit go through the governed Render
// Catalog API (services/equipmentModelCatalogClient.js -> createEquipmentModel / updateEquipmentModel, equipment.model.manage).
// The screen is offered only to a holder of equipment.model.manage (EQUIPMENT_MODEL_GATE); the server decides on every call and
// a refusal is rendered as its answer. A model's identity (manufacturer + model number) is fixed at create; everything else
// can be corrected under the row's version (optimistic concurrency).
import { useCallback, useEffect, useState } from "react";
import Modal from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/primitives/index.js";
import { Field, FormActions } from "../../shared/ui/form";
import { EQUIPMENT_MODEL_GATE } from "../../access/shellCapabilityGates.js";
import { MODEL_STATUSES } from "../../domain/equipmentModel.js";
import { equipmentModelCommands, listEquipmentModelsForAdmin } from "../../services/equipmentModelCatalogClient.js";

const STATUS_WORDS = Object.freeze({ DRAFT: "Draft", ACTIVE: "Record active", INACTIVE: "Record inactive", RETIRED: "Retired" });
const BLANK = Object.freeze({ manufacturerId: "", manufacturerName: "", modelNumber: "", displayName: "", family: "", subtype: "", revision: "", status: "ACTIVE", sourceAuthority: "MANUFACTURER_CATALOG" });
// The fields a correction may change (identity -- manufacturerId + modelNumber -- is fixed).
const EDITABLE = Object.freeze(["manufacturerName", "displayName", "family", "subtype", "revision", "status", "sourceAuthority"]);
const FIELD_LABELS = Object.freeze({
  manufacturerId: "Manufacturer ID", manufacturerName: "Manufacturer name", modelNumber: "Model number", displayName: "Display name",
  family: "Family", subtype: "Subtype", revision: "Revision", status: "Status", sourceAuthority: "Source authority",
});

export default function EquipmentModels({ hasCapability, client, commands = equipmentModelCommands }) {
  const canManage = hasCapability?.(EQUIPMENT_MODEL_GATE.manage) === true;
  const [state, setState] = useState({ phase: "loading" });
  const [panel, setPanel] = useState(null); // { mode: "create" } | { mode: "edit", model }
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const load = useCallback(() => {
    let live = true;
    setState({ phase: "loading" });
    listEquipmentModelsForAdmin(client ? { client } : undefined).then((r) => {
      if (!live) return;
      setState(r.ok ? { phase: "ready", models: r.models, nextCursor: r.nextCursor } : { phase: r.denied ? "denied" : "error" });
    });
    return () => { live = false; };
  }, [client]);
  // The server pages by keyset cursor (200 per page); every model must be reachable to be edited, so "Load more" appends the next page.
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const loadMore = async () => {
    setLoadingMore(true); setMoreFailed(false);
    const r = await listEquipmentModelsForAdmin({ ...(client ? { client } : {}), cursor: state.nextCursor });
    setLoadingMore(false);
    if (!r.ok) { setMoreFailed(true); return; }
    setState((s) => ({ ...s, models: [...s.models, ...r.models], nextCursor: r.nextCursor }));
  };
  useEffect(() => (canManage ? load() : undefined), [canManage, load]);

  if (!canManage) return <p className="fo-muted" role="status">Equipment models are managed by people with the equipment model capability.</p>;

  const open = (next, nextForm) => { setOutcome(null); setForm(nextForm); setPanel(next); };
  const close = () => { if (!busy) { setPanel(null); setForm(BLANK); } };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    let o;
    if (panel.mode === "create") {
      o = await commands.create(form, client ? { client } : undefined);
    } else {
      const changes = Object.fromEntries(EDITABLE.filter((k) => (form[k] ?? "") !== (panel.model[k] ?? "")).map((k) => [k, form[k]]));
      o = Object.keys(changes).length === 0
        ? { kind: "noop", message: "No changes to save." }
        : await commands.update({ equipmentModelId: panel.model.id, expectedVersion: panel.model.version, changes }, client ? { client } : undefined);
    }
    setBusy(false);
    setOutcome(o);
    if (o.kind === "applied" || o.kind === "replayed") { setPanel(null); setForm(BLANK); load(); }
  };

  const fields = panel?.mode === "create" ? Object.keys(BLANK) : EDITABLE;
  const models = state.phase === "ready" ? state.models : [];

  return (
    <section aria-label="Equipment models">
      <p className="fo-muted">Manufacturer and model reference records that Equipment, Parts and Sales Agreements point at. Every change is authorized server-side.</p>
      <Button variant="primary" disabled={busy} onClick={() => open({ mode: "create" }, BLANK)}>New Equipment Model</Button>
      {!panel && outcome && <p role="status" className="fo-muted">{outcome.message}</p>}

      {state.phase === "loading" && <p className="fo-muted" role="status">Loading equipment models…</p>}
      {state.phase === "denied" && <p className="fo-muted" role="status">You do not have access to read equipment models.</p>}
      {state.phase === "error" && <p className="fo-muted" role="status">Equipment models are currently unavailable. <button type="button" onClick={load}>Retry</button></p>}
      {state.phase === "ready" && models.length === 0 && <p className="fo-muted">No equipment models are recorded yet. Use “New Equipment Model” to add the first.</p>}
      {models.length > 0 && (
        <table className="fo-table" aria-label="Equipment models list">
          <thead><tr><th>Model</th><th>Manufacturer</th><th>Model number</th><th>Revision</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td>{m.displayName}</td><td>{m.manufacturerName}</td><td>{m.modelNumber}</td><td>{m.revision ?? "—"}</td>
                <td>{STATUS_WORDS[m.status] ?? m.status}</td>
                <td><Button size="sm" variant="secondary" disabled={busy} onClick={() => open({ mode: "edit", model: m }, { ...BLANK, ...Object.fromEntries(EDITABLE.map((k) => [k, m[k] ?? ""])) })}>Edit {m.displayName}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {state.phase === "ready" && state.nextCursor && (
        <div>
          <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : "Load more models"}</Button>
          {moreFailed && <p role="alert" className="fo-muted">The next page could not be loaded. Try again.</p>}
        </div>
      )}

      {panel && (
        <Modal title={panel.mode === "create" ? "New Equipment Model" : `Edit ${panel.model.displayName}`} onClose={close}>
          {outcome && <p role="alert" className="fo-muted">{outcome.message}</p>}
          <form className="fo-form fo-create-modal-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {fields.map((k) => (
              <Field key={k} label={FIELD_LABELS[k]}>
                {k === "status" ? (
                  <select className="fo-input" aria-label={FIELD_LABELS[k]} value={form[k]} disabled={busy} onChange={set(k)}>
                    {MODEL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
                  </select>
                ) : (
                  <input className="fo-input" aria-label={FIELD_LABELS[k]} value={form[k] ?? ""} disabled={busy} onChange={set(k)} />
                )}
              </Field>
            ))}
            <FormActions>
              <button type="submit" disabled={busy}>{busy ? "Saving…" : panel.mode === "create" ? "Create Model" : "Save Changes"}</button>
              <button type="button" onClick={close} disabled={busy}>Cancel</button>
            </FormActions>
          </form>
        </Modal>
      )}
    </section>
  );
}
