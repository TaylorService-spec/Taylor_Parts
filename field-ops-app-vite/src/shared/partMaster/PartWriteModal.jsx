// Wave 6 Parts UX -- shared master-data write surface, reused by BOTH PartsList.jsx
// ("New Part") and PartDetail.jsx ("Edit Part Details" / "Change Status"), so an
// authorized user never has to leave the Parts experience to perform normal Part
// master-data work. Uses the SAME governed hook PartMasterList.jsx's own dedicated
// admin screen uses (usePartMasterWrite -> partMasterCommandClient -> the trusted
// createPart/updatePart/changePartStatus callables) -- ONE trusted command path,
// no second write authority, no client Firestore write. PartMasterList.jsx itself is
// UNCHANGED by this file; this is a new, independent presentation over the same
// authority, not a refactor of the already-tested admin screen.
import { useState } from "react";
import { usePartMasterWrite } from "../../hooks/usePartMasterWrite";
import { useManufacturerCatalog } from "../../hooks/useManufacturerCatalog";
import {
  MANUFACTURER_CATALOG_VIEW_STATE,
  manufacturerCatalogViewState,
  manufacturerPickerOptions,
} from "../../domain/manufacturerCatalogView";
import {
  CONTROL_TYPES, STOCKING_CLASSES, UNIT_CODES,
  allowedStatusTransitions, partStatusTone,
} from "../../domain/partMasterWrite";
import Modal from "../ui/Modal";
import { Field, FormActions, FormStatus } from "../ui/form";
import StatusPill from "../ui/StatusPill.jsx";

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

// Wave 6 Owner Decision (2026-08-15): a REAL governed Manufacturer selector where the trusted
// inventory.catalog.read projection is available -- never a free-text field silently masquerading
// as a verified relationship. Falls back to the pre-existing free-text id ONLY when the catalog
// read genuinely cannot resolve (loading/denied/unavailable), with honest copy explaining why --
// still writes the same `manufacturerId` field either way, no new write authority.
function ManufacturerField({ form, setForm, disabled }) {
  const catalog = useManufacturerCatalog();
  const state = manufacturerCatalogViewState(catalog);
  const set = (e) => setForm((f) => ({ ...f, manufacturerId: e.target.value }));

  if (state === MANUFACTURER_CATALOG_VIEW_STATE.READY) {
    const options = manufacturerPickerOptions(catalog.result.manufacturers);
    const currentValue = form.manufacturerId ?? "";
    // Preserve an existing value even if it's no longer ACTIVE (or unknown) -- never silently drop it.
    const hasCurrentOption = currentValue === "" || options.some((o) => o.value === currentValue);
    return (
      <Field id="parts-write-manufacturer" label="Manufacturer">
        <select id="parts-write-manufacturer" className="fo-wizard-control" value={currentValue} onChange={set} disabled={disabled}>
          <option value="">— None —</option>
          {!hasCurrentOption && <option value={currentValue}>{currentValue} (not currently active)</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    );
  }

  return (
    <Field id="parts-write-manufacturer" label="Manufacturer ID">
      <input id="parts-write-manufacturer" className="fo-wizard-control" value={form.manufacturerId ?? ""} onChange={set} disabled={disabled} />
      <p className="fo-muted">
        {state === MANUFACTURER_CATALOG_VIEW_STATE.DENIED
          ? "You do not have access to the Manufacturer catalog, so this is an unverified id."
          : state === MANUFACTURER_CATALOG_VIEW_STATE.UNAVAILABLE
            ? "The Manufacturer catalog is currently unavailable, so this is an unverified id."
            : "Loading the Manufacturer catalog…"}
      </p>
    </Field>
  );
}

function PartForm({ mode, form, setForm, disabled }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      {mode === "create" && (
        <>
          <Field id="parts-write-id" label="Part ID">
            <input id="parts-write-id" className="fo-wizard-control" value={form.partId ?? ""} onChange={set("partId")} disabled={disabled} />
          </Field>
          <Field id="parts-write-number" label="Internal part number">
            <input id="parts-write-number" className="fo-wizard-control" value={form.internalPartNumber ?? ""} onChange={set("internalPartNumber")} disabled={disabled} />
          </Field>
        </>
      )}
      <Field id="parts-write-name" label="Name">
        <input id="parts-write-name" className="fo-wizard-control" value={form.name ?? ""} onChange={set("name")} disabled={disabled} />
      </Field>
      <Field id="parts-write-description" label="Description">
        <input id="parts-write-description" className="fo-wizard-control" value={form.description ?? ""} onChange={set("description")} disabled={disabled} />
      </Field>
      <Field id="parts-write-category" label="Category">
        <input id="parts-write-category" className="fo-wizard-control" value={form.category ?? ""} onChange={set("category")} disabled={disabled} />
      </Field>
      <ManufacturerField form={form} setForm={setForm} disabled={disabled} />
      <Field id="parts-write-unit" label="Stocking unit">
        <select id="parts-write-unit" className="fo-wizard-control" value={form.stockingUnit ?? "EACH"} onChange={set("stockingUnit")} disabled={disabled}>
          {UNIT_CODES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </Field>
      <Field id="parts-write-control" label="Control type">
        <select id="parts-write-control" className="fo-wizard-control" value={form.controlType ?? "STANDARD"} onChange={set("controlType")} disabled={disabled}>
          {CONTROL_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field id="parts-write-class" label="Stocking class">
        <select id="parts-write-class" className="fo-wizard-control" value={form.stockingClass ?? "STOCKED"} onChange={set("stockingClass")} disabled={disabled}>
          {STOCKING_CLASSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
    </>
  );
}

// `mode`: "create" | "edit" | "status". `part`: the raw canonical Part record (with
// `version`/`status`) -- required for "edit"/"status", ignored for "create". `onClose`
// closes the modal without necessarily having saved. `onSaved(outcome)` fires after an
// applied/replayed write so the caller can refresh its own read (this component never
// re-fetches on its own -- it has no opinion on which read the caller uses).
export default function PartWriteModal({ mode, part, onClose, onSaved, writeDeps }) {
  const { writeReady, runCreate, runUpdate, runChangeStatus } = usePartMasterWrite(writeDeps);
  const [form, setForm] = useState(() => (mode === "edit" ? { ...part } : { stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const requestClose = () => { if (!busy) onClose(); };

  async function finish(promise) {
    setBusy(true);
    const result = await promise;
    setBusy(false);
    setOutcome(result);
    if (result.kind === "applied" || result.kind === "replayed") onSaved(result);
  }

  const submitCreate = () => finish(runCreate(form));
  const submitEdit = () => finish(runUpdate(part.partId, part.version, form, part));
  const submitStatus = (newStatus) => finish(runChangeStatus(part.partId, part.version, newStatus));

  const title =
    mode === "create" ? "New part" : mode === "edit" ? `Edit ${part.internalPartNumber}` : `Change status — ${part.internalPartNumber}`;

  return (
    <Modal title={title} onClose={requestClose}>
      <OutcomeBanner outcome={outcome} />
      {!writeReady && (
        <p className="fo-state fo-tone-muted fo-state-message" role="status">
          Editing isn't enabled in this environment yet. This action is activated with the catalog
          administration service (a governed deployment + grant), not from this screen.
        </p>
      )}
      {mode === "status" ? (
        <div className="fo-form fo-create-modal-form">
          <p className="fo-muted">
            Current status: <StatusPill tone={partStatusTone(part.status)} label={part.status} />. Choose a governed transition:
          </p>
          <FormActions>
            {allowedStatusTransitions(part.status).length === 0
              ? <span className="fo-muted">No status changes are available from {part.status}.</span>
              : allowedStatusTransitions(part.status).map((s) => (
                  <button key={s} type="button" onClick={() => submitStatus(s)} disabled={busy || !writeReady}>→ {s}</button>
                ))}
            <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
          </FormActions>
        </div>
      ) : (
        <form className="fo-form fo-create-modal-form" onSubmit={(e) => { e.preventDefault(); mode === "create" ? submitCreate() : submitEdit(); }}>
          <PartForm mode={mode} form={form} setForm={setForm} disabled={busy || !writeReady} />
          <FormStatus>{busy ? "Saving…" : ""}</FormStatus>
          <FormActions>
            <button type="submit" disabled={busy || !writeReady}>{busy ? "Saving…" : mode === "create" ? "Create part" : "Save changes"}</button>
            <button type="button" onClick={requestClose} disabled={busy}>Cancel</button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}
