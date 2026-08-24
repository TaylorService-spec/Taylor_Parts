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
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPartMasterPage, PARTS_PAGE_SIZE } from "../../services/partMasterQueries";
import { useSearchParams } from "react-router-dom";
import { AddFilter, ActiveFilters, SortControl, ListEmptyState } from "../../shared/ui/ListControls.jsx";
import {
  PART_FIELDS, PART_STATUS_LABEL, CONTROL_TYPE_LABEL, STOCKING_CLASS_LABEL,
} from "../../domain/partFields.js";
import {
  fromSearchParams, toSearchParams, addFilter, removeFilter, clearFilters, setSort, toQueryPlan,
} from "../../domain/listQueryState.js";
import { rememberListState } from "../../navigation/listStateMemory.js";
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
import { Button } from "../../shared/ui/primitives/index.js";

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

/**
 * The filter value pickers, built from the canonical enums.
 *
 * Human labels for the person, canonical values for the query -- the same split the table cells
 * make. A picker offering raw enum tokens would be teaching people the storage vocabulary.
 */
const PART_FILTER_VALUES = Object.freeze({
  status: Object.entries(PART_STATUS_LABEL).map(([value, label]) => ({ value, label })),
  controlType: Object.entries(CONTROL_TYPE_LABEL).map(([value, label]) => ({ value, label })),
  stockingClass: Object.entries(STOCKING_CLASS_LABEL).map(([value, label]) => ({ value, label })),
});

export default function PartMasterList(props) {
  const [state, setState] = useState({ phase: "loading" });
  const [panel, setPanel] = useState(null); // {mode:"create"} | {mode:"edit", part} | {mode:"status", part}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const { writeReady, runCreate, runUpdate, runChangeStatus } = usePartMasterWrite(props?.writeDeps);

  // LIST STATE LIVES IN THE URL, so filters and sort survive opening a part and coming back --
  // and so a narrowed list can be shared or bookmarked rather than described over the phone.
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(
    () => fromSearchParams(searchParams.toString(), PART_FIELDS),
    [searchParams],
  );

  // THE PLAN IS WHAT THE READ EXECUTES. Anything the metadata declares unqueryable arrives here in
  // `unsupported` and is said out loud -- never quietly turned into a pass over the whole catalogue.
  const plan = useMemo(
    () => toQueryPlan(listState, PART_FIELDS, { pageSize: PARTS_PAGE_SIZE }),
    [listState],
  );

  // Paging is TIED TO THE PLAN it was produced under. Page 2 of an old query is not page 2 of a new
  // one, so a cursor taken under different criteria is discarded rather than replayed -- including
  // when the criteria change by browser Back rather than by the controls.
  const [page, setPage] = useState({ plan: null, cursor: null, append: false, token: 0 });
  const activePage = useMemo(
    () => (page.plan === plan ? page : { plan, cursor: null, append: false, token: 0 }),
    [page, plan],
  );

  const applyState = useCallback((next) => {
    const params = toSearchParams(next, searchParams.toString());
    setSearchParams(params, { replace: false });
    rememberListState("parts", params.toString());
  }, [searchParams, setSearchParams]);

  // What was asked for and is NOT in effect, from both failure points. Named once so the banner and
  // any future readout cannot drift apart.
  const unapplied = useMemo(() => [
    ...(listState.dropped ?? []).map((d) => d.label),
    ...plan.unsupported.map((u) => u.field?.label ?? "an unknown field"),
  ], [listState, plan]);

  const load = useCallback(() => {
    let cancelled = false;
    const { append, cursor } = activePage;
    if (!append) setState({ phase: "loading" });
    else setState((prev) => ({ ...prev, loadingMore: true }));
    fetchPartMasterPage({ plan: activePage.plan ?? plan, cursor }).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setState({ phase: result.code === "permission-denied" ? "denied" : "error" }); return; }
      setState((prev) => ({
        phase: "ready",
        // Appending rather than replacing: the page already on screen stays on screen.
        parts: append && prev.parts ? [...prev.parts, ...result.parts] : result.parts,
        invalidCount: result.invalid.length,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        loadingMore: false,
      }));
    });
    return () => { cancelled = true; };
  }, [activePage, plan]);
  useEffect(() => load(), [load]);

  // A refresh is an explicit new token, so re-reading the first page after a write is never mistaken
  // for the same request and skipped.
  const reload = useCallback(() => {
    setPage((prev) => ({ plan, cursor: null, append: false, token: prev.token + 1 }));
  }, [plan]);
  const loadMore = useCallback((cursor) => {
    setPage((prev) => ({ plan, cursor, append: true, token: prev.token + 1 }));
  }, [plan]);

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
    if (o.kind === "applied" || o.kind === "replayed") { close(); reload(); }
  }, [reload]);

  const submitCreate = async () => { setBusy(true); afterWrite(await runCreate(form)); setBusy(false); };
  const submitEdit = async () => { setBusy(true); afterWrite(await runUpdate(panel.part.partId, panel.part.version, form, panel.part)); setBusy(false); };
  const submitStatus = async (newStatus) => { setBusy(true); afterWrite(await runChangeStatus(panel.part.partId, panel.part.version, newStatus)); setBusy(false); };

  if (state.phase === "loading") return <p>Loading Part Master…</p>;
  if (state.phase === "denied") return <p>You do not have access to the Part Master. Contact an administrator if you believe this is an error.</p>;
  if (state.phase === "error") return <p>The Part Master is currently unavailable. Try again later.</p>;

  const parts = state.parts ?? [];
  const actions = (
    <ActionRail
      primary={<Button variant="primary" onClick={openCreate} disabled={busy}>New part</Button>}
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

      {/* THE SHARED CONTROLS, reading the Part metadata. No Parts-specific filter registry: the
          fields, their operators and their sort vocabulary all come from the contract, so a newly
          declared field becomes filterable without anybody editing this screen. */}
      <div className="fo-listctl">
        <AddFilter
          fields={PART_FIELDS}
          objectLabel="Part"
          valueOptions={PART_FILTER_VALUES}
          onAdd={(f) => applyState(addFilter(listState, f))}
        />
        <SortControl
          fields={PART_FIELDS}
          state={listState}
          onSort={(fieldId, direction) => applyState(setSort(listState, fieldId, direction))}
        />
      </div>
      <ActiveFilters
        state={listState}
        fields={PART_FIELDS}
        valueOptions={PART_FILTER_VALUES}
        onRemove={(fieldId, operator) => applyState(removeFilter(listState, fieldId, operator))}
        onClear={() => applyState(clearFilters(listState))}
      />

      {/* A criterion this list cannot execute is STATED, not silently dropped -- a filter that looks
          applied but is not is how somebody concludes the catalogue is smaller than it is.

          TWO sources, because a criterion can fail at two points: one this build cannot parse from
          the URL at all (a link from an older build, a hand-edited address), and one it parses but
          cannot execute. Both end with an unnarrowed list, so both have to say so. */}
      {unapplied.length > 0 && (
        <p className="fo-state fo-tone-muted fo-state-message" role="status">
          Some criteria can’t be applied to this list: {unapplied.join(", ")}. Everything else is
          applied, so this list is wider than the link asked for.
        </p>
      )}

      {parts.length === 0 ? (
        // A list filtered to nothing and an empty catalogue are different statements.
        <ListEmptyState
          state={listState}
          onClear={() => applyState(clearFilters(listState))}
          emptyLabel="No canonical Part records exist yet. Use “New part” to create the first governed part."
        />
      ) : (
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part Number</th><th>Description</th><th>Category</th>
                <th>Tracking</th><th>Stocking Class</th><th>Unit</th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.partId}>
                  <td className="fo-pml__part-number">{part.internalPartNumber}</td>
                  <td>{part.name}</td>
                  <td>{part.category || "—"}</td>
                  {/* BUSINESS-READABLE wording, with the canonical value kept on the element so a
                      filter, a sort or a test reaches the enum rather than the phrasing.
                      `controlType` is PART MASTER's vocabulary and is never swapped for the
                      inventory ledger's trackingMode -- they are two vocabularies, not one. */}
                  <td data-raw={part.controlType}>{CONTROL_TYPE_LABEL[part.controlType] ?? part.controlType}</td>
                  <td data-raw={part.stockingClass}>{STOCKING_CLASS_LABEL[part.stockingClass] ?? part.stockingClass}</td>
                  <td>{part.stockingUnit}</td>
                  <td data-raw={part.status}>
                    <StatusPill tone={partStatusTone(part.status)} label={PART_STATUS_LABEL[part.status] ?? part.status} />
                  </td>
                  <td className="fo-pml__actions">
                    <button type="button" onClick={() => openEdit(part)} disabled={busy} className="fo-btn-secondary">Edit</button>{" "}
                    <button type="button" onClick={() => openStatus(part)} disabled={busy} className="fo-btn-secondary">Status</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PAGED, not truncated. The read asks for one document more than it shows, so “there is more”
          is something the query answered rather than something this screen guessed. */}
      {state.hasMore && (
        <div className="fo-pml__pager">
          <Button
            variant="secondary"
            onClick={() => loadMore(state.nextCursor)}
            disabled={busy || state.loadingMore}
          >
            {state.loadingMore ? "Loading…" : "Load more parts"}
          </Button>
        </div>
      )}
    </WorkspaceShell>
  );
}
