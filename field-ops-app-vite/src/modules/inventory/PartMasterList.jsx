// INV-1 / ADR-009 G2 -- governed Part Master administration workspace. Evolves the former READ-ONLY
// registry (PR 1.9) into the first-class catalog-admin surface WITHOUT a second Parts read model: it
// still reads via services/partMasterQueries.fetchPartMasterList + domain/partMasterView, and adds
// create / edit / status flows that go ONLY through the trusted Part callables (usePartMasterWrite ->
// partMasterCommandClient -> createPart/updatePart/changePartStatus). There is ONE Part authority and
// ONE trusted command path; NO client Firestore writes, NO parallel validator, NO parallel status
// vocabulary (the selects are client MIRRORS; the command re-validates and is authoritative).
//
// FAIL-CLOSED: the write callables are undeployed/ungranted, so config/partMasterWriteReadiness is false
// and the workspace shows a write-disabled notice + makes zero callable attempts. When a shared sandbox
// injects an explicit readiness + a mocked client (usePartMasterWrite deps), the same flows exercise the
// governed outcomes. Authorization is enforced server-side regardless; the UI never claims a success it
// did not receive.
import { useCallback, useEffect, useState } from "react";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { usePartMasterWrite } from "../../hooks/usePartMasterWrite";
import {
  CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES,
  allowedStatusTransitions, partStatusTone,
} from "../../domain/partMasterWrite";
import Modal from "../../shared/ui/Modal";
import { Field, FormActions, FormStatus } from "../../shared/ui/form";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";

// Governed-outcome banner: maps the domain outcome.kind to a StatusPill tone + keeps the governed
// message verbatim. `applied`/`replayed` are success-shaped; `denied`/`notFound`/`error` are hard
// failures; `invalid`/`conflict` need the user to fix something; `noop`/`unavailable` are neutral.
const OUTCOME_TONE = {
  applied: "positive",
  replayed: "info",
  noop: "muted",
  denied: "critical",
  invalid: "attention",
  conflict: "attention",
  notFound: "critical",
  unavailable: "muted",
  error: "critical",
};
function OutcomeBanner({ outcome }) {
  if (!outcome) return null;
  return (
    <p className={`fo-state fo-tone-${OUTCOME_TONE[outcome.kind] ?? "critical"} fo-state-message`} role="status" aria-live="polite">
      {outcome.message}
    </p>
  );
}

// Shared create/edit fields. `mode` = "create" | "edit". partId + internalPartNumber are identity and
// only editable at create (internalPartNumber IS updatable server-side, but we keep edit focused on the
// descriptive fields the read model exposes; identity edits stay a governed concern).
function PartForm({ mode, form, setForm, disabled }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      {mode === "create" && (
        <>
          <Field id="part-create-id" label="Part ID">
            <input id="part-create-id" className="fo-wizard-control" value={form.partId ?? ""} onChange={set("partId")} disabled={disabled} />
          </Field>
          <Field id="part-create-number" label="Internal part number">
            <input id="part-create-number" className="fo-wizard-control" value={form.internalPartNumber ?? ""} onChange={set("internalPartNumber")} disabled={disabled} />
          </Field>
        </>
      )}
      <Field id="part-form-name" label="Name">
        <input id="part-form-name" className="fo-wizard-control" value={form.name ?? ""} onChange={set("name")} disabled={disabled} />
      </Field>
      <Field id="part-form-description" label="Description">
        <input id="part-form-description" className="fo-wizard-control" value={form.description ?? ""} onChange={set("description")} disabled={disabled} />
      </Field>
      <Field id="part-form-category" label="Category">
        <input id="part-form-category" className="fo-wizard-control" value={form.category ?? ""} onChange={set("category")} disabled={disabled} />
      </Field>
      <Field id="part-form-unit" label="Stocking unit">
        <select id="part-form-unit" className="fo-wizard-control" value={form.stockingUnit ?? "EACH"} onChange={set("stockingUnit")} disabled={disabled}>
          {UNIT_CODES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </Field>
      <Field id="part-form-control" label="Control type">
        <select id="part-form-control" className="fo-wizard-control" value={form.controlType ?? "STANDARD"} onChange={set("controlType")} disabled={disabled}>
          {CONTROL_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field id="part-form-class" label="Stocking class">
        <select id="part-form-class" className="fo-wizard-control" value={form.stockingClass ?? "STOCKED"} onChange={set("stockingClass")} disabled={disabled}>
          {STOCKING_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
    </>
  );
}

export default function PartMasterList(props) {
  const [state, setState] = useState({ phase: "loading" });
  const [panel, setPanel] = useState(null); // {mode:"create"} | {mode:"edit", part} | {mode:"status", part}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const { writeReady, runCreate, runUpdate, runChangeStatus } = usePartMasterWrite(props?.writeDeps);

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetchPartMasterList().then((result) => {
      if (cancelled) return;
      if (!result.ok) setState({ phase: result.code === "permission-denied" ? "denied" : "error" });
      else setState({ phase: "ready", parts: result.parts, invalidCount: result.invalid.length });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);

  const openCreate = () => { setForm({ stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }); setOutcome(null); setPanel({ mode: "create" }); };
  const openEdit = (part) => { setForm({ ...part }); setOutcome(null); setPanel({ mode: "edit", part }); };
  const openStatus = (part) => { setOutcome(null); setPanel({ mode: "status", part }); };
  const close = () => { setPanel(null); setForm({}); };
  // Converting the inline panel to a real Modal overlay adds Escape/backdrop-close for free (the
  // old inline panel had neither) -- guard those the same way AccountsList/EquipmentCreateModal do,
  // so a close while a write is in flight cannot drop it.
  const requestClose = () => { if (!busy) close(); };

  // After a governed applied/replayed change, refresh from the trusted read so the UI reflects real state.
  const afterWrite = useCallback((o) => {
    setOutcome(o);
    if (o.kind === "applied" || o.kind === "replayed") { close(); load(); }
  }, [load]);

  const submitCreate = async () => { setBusy(true); afterWrite(await runCreate(form)); setBusy(false); };
  const submitEdit = async () => { setBusy(true); afterWrite(await runUpdate(panel.part.partId, panel.part.version, form, panel.part)); setBusy(false); };
  const submitStatus = async (newStatus) => { setBusy(true); afterWrite(await runChangeStatus(panel.part.partId, panel.part.version, newStatus)); setBusy(false); };

  if (state.phase === "loading") return <p>Loading Part Master…</p>;
  if (state.phase === "denied") return <p>You do not have access to the Part Master. Contact an administrator if you believe this is an error.</p>;
  if (state.phase === "error") return <p>The Part Master is currently unavailable. Try again later.</p>;

  const parts = state.parts ?? [];
  const actions = (
    <ActionRail
      primary={<button type="button" className="fo-btn-primary" onClick={openCreate} disabled={busy}>New part</button>}
    />
  );

  return (
    <WorkspaceShell title="Part Master" actions={actions}>
      <p className="fo-muted">
        Governed canonical part registry. Create and edit parts here; stock levels live in the inventory ledger.
        Every change goes through the catalog administration service and is authorized server-side.
        {state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
      {!writeReady && (
        <p className="fo-state fo-tone-muted fo-state-message" role="status">
          Editing isn’t enabled in this environment yet. You can review parts; create/edit/status changes are activated
          with the catalog administration service (a governed deployment + grant), not from this screen.
        </p>
      )}
      {!panel && <OutcomeBanner outcome={outcome} />}

      {panel && (
        <Modal
          title={panel.mode === "create" ? "New part" : panel.mode === "edit" ? `Edit ${panel.part.internalPartNumber}` : `Change status — ${panel.part.internalPartNumber}`}
          onClose={requestClose}
        >
          <OutcomeBanner outcome={outcome} />
          {panel.mode === "status" ? (
            <div className="fo-form fo-create-modal-form">
              <p className="fo-muted">
                Current status: <StatusPill tone={partStatusTone(panel.part.status)} label={panel.part.status} />. Choose a governed transition:
              </p>
              <FormActions>
                {allowedStatusTransitions(panel.part.status).length === 0
                  ? <span className="fo-muted">No status changes are available from {panel.part.status}.</span>
                  : allowedStatusTransitions(panel.part.status).map((s) => (
                      <button key={s} type="button" onClick={() => submitStatus(s)} disabled={busy || !writeReady}>→ {s}</button>
                    ))}
                <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
              </FormActions>
            </div>
          ) : (
            <form className="fo-form fo-create-modal-form" onSubmit={(e) => { e.preventDefault(); panel.mode === "create" ? submitCreate() : submitEdit(); }}>
              <PartForm mode={panel.mode} form={form} setForm={setForm} disabled={busy || !writeReady} />
              <FormStatus>{busy ? "Saving…" : ""}</FormStatus>
              <FormActions>
                <button type="submit" disabled={busy || !writeReady}>{busy ? "Saving…" : panel.mode === "create" ? "Create part" : "Save changes"}</button>
                <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
              </FormActions>
            </form>
          )}
        </Modal>
      )}

      {parts.length === 0 ? (
        <p className="fo-muted">No canonical Part records exist yet. Use “New part” to create the first governed part.</p>
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part #</th><th>Name</th><th>Category</th>
                <th>Control</th><th>Class</th><th>Unit</th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.partId}>
                  <td style={{ fontFamily: "monospace" }}>{part.internalPartNumber}</td>
                  <td>{part.name}</td>
                  <td>{part.category || "—"}</td>
                  <td>{part.controlType}</td>
                  <td>{part.stockingClass}</td>
                  <td>{part.stockingUnit}</td>
                  <td><StatusPill tone={partStatusTone(part.status)} label={part.status} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => openEdit(part)} disabled={busy} className="fo-btn-secondary">Edit</button>{" "}
                    <button type="button" onClick={() => openStatus(part)} disabled={busy} className="fo-btn-secondary">Status</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceShell>
  );
}
