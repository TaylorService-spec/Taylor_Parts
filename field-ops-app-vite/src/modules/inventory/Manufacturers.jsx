// Manufacturer administration workspace (catalog reference object). Closes the referential gap Part
// write created (parts.manufacturerId -> a manageable/readable Manufacturer).
//
// EOS CORE (Firebase exit F5, 2026-10-17). READ via services/manufacturerQueries.fetchManufacturerList ->
// services/manufacturerCatalogClient.js -> the Catalog API's listManufacturers (eos_ops.manufacturers;
// inventory.catalog.read AND inventory.manufacturer.read). WRITES -- New Manufacturer, Rename, Status -- go through
// the same client to createManufacturer / updateManufacturer / changeManufacturerStatus (postgresManufacturerWriter.ts:
// inventory.catalog.manage, and inventory.catalog.activate for status). The server decides who may; a refusal is
// shown as the server's answer, the Supplier administration pattern (DECISIONS #196). The concurrency token is the
// row's `updatedAt`, which the list hands out.
//
// History (Firebase era). READ was the trusted `getManufacturerCatalog`
// callable (capability `inventory.catalog.read`). Part 11 reconciliation (2026-08-15): this surface
// used to read the `manufacturers` collection DIRECTLY over the client SDK -- always permission-denied,
// since that collection is Rules-closed (`allow read, write: if false`) for every principal. Revalidated
// rather than repeating that stale blocker: the governed read that already serves the Parts picker
// surfaces now also carries the `version` field this workspace's write actions need for optimistic
// concurrency, so it is reused here as-is -- no new capability, no Rules change, no parallel read path.
//
// PR-B (2026-10-15) removed the flag-dead Firebase write affordances; F5 restores them on EOS Core.
// See docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md.
//
// S-INV-MANUFACTURERS -- the list itself now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity, definitions/manufacturer.js), the same
// column/state/cell contract every other migrated INDEX surface uses
// (AccountsList.jsx/MetadataListGrid.jsx), rather than a hand-rolled <table>.
//
// NOT THROUGH useMetadataList/buildQueryDescriptor. getManufacturerCatalog is a single
// UNBOUNDED read of the whole catalog with no `limit`/`cursor` parameters and an envelope
// shape ({status, manufacturers, excludedCount}) callableListSource.js's CALLABLE_SOURCES
// registry does not (and, being outside this lane's writeScope -- src/metadata/** -- could
// not) declare. Routing this surface's fetch through useMetadataList would either silently
// ignore the descriptor's bound/cursor (dishonest) or throw at every load ("no known
// response mapping for readCallable"). So the EXISTING fetchManufacturerList() read is kept
// exactly as-is (ONE read, unchanged), and its result is reshaped in memory into the same
// `{rows, hasMore}` page shape buildListPresentation expects -- the identical "inject a
// listRenderer over data already flowing instead of issuing a second read" pattern
// definitions/accountPageComponents.js's buildAccountRelatedListPresentation established
// for Contacts/Locations. See buildManufacturersPresentation below, and the handoff notes
// for the exact registration gap this leaves in callableListSource.js (out of writeScope,
// reported rather than worked around).
//
// DECISIONS #106 FIX (X-MANUFACTURER-ID-AS-COLUMN class defect, live in this file until
// now): the table used to render `m.manufacturerId` (the Firestore document id) as its own
// visible "ID" column, and both the Rename and Change Status dialog headers echoed it back
// as `${panel.m.manufacturerId}`. manufacturerEntity declares `identity.nameField: "name"`
// and `referenceField: null` -- there is no business reference, and a missing one is not
// permission to show a record id instead (manufacturer.js's own header makes the same call
// for manufacturerIndexList's columns). All three instances are fixed here: the ID column is
// dropped entirely (manufacturerIndexList declares none), and both dialog headers now read
// the manufacturer's `name`. manufacturerId is still used -- as the row's routing/keying
// value -- but never as displayed content.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { manufacturerCommands } from "../../services/manufacturerCatalogClient.js";
import { Button } from "../../shared/ui/primitives/index.js";
import { manufacturerEntity, manufacturerIndexList } from "../../metadata/definitions/manufacturer.js";
import { buildListPresentation } from "../../metadata/listPresentation.js";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import { sortRows } from "../../shared/ui/sorting/useTableSort.js";
import { statusLabel } from "../../shared/display/displayLabels.js";

// The status column's sort value. The cell itself renders through cellValue's ENUM branch, using
// manufacturerEntity's declared enumLabels, same as every other migrated list's status column.
const STATUS_WORDS = manufacturerEntity.fields.find((f) => f.id === "status")?.enumLabels ?? {};

// The governed two-state lifecycle, offered as the OTHER state; the server re-checks (INVALID_STATUS_TRANSITION).
const OTHER_STATUS = Object.freeze({ ACTIVE: "INACTIVE", INACTIVE: "ACTIVE" });

function StatusBadge({ status }) {
  return <span className={`fo-mfr__badge fo-mfr__badge--${status === "ACTIVE" ? "active" : "inactive"}`}>{statusLabel(status, STATUS_WORDS)}</span>;
}

const OUTCOME_CLASS = { notFound: "not-found" };
function OutcomeBanner({ outcome }) {
  if (!outcome) return null;
  return <div role="status" className={`fo-mfr__outcome fo-mfr__outcome--${OUTCOME_CLASS[outcome.kind] ?? outcome.kind}`}>{outcome.message}</div>;
}

// UI corrections item C: header sorting. getManufacturerCatalog returns the WHOLE catalog, so ordering the rows in
// memory orders the complete result (no page boundary to misrepresent). Values are what the person reads.
const MANUFACTURER_SORT_COLUMNS = Object.freeze({
  name: { value: (row) => row.name ?? null },
  status: { value: (row) => (row.status ? statusLabel(row.status, STATUS_WORDS) : null) },
});

// Preserves this workspace's own, more specific copy over buildListPresentation's generic
// per-state defaults (emptyMessageFor, listPresentation.js) -- overriding is the same
// explicitly-supported "own copy" choice buildAccountRelatedListPresentation exercises.
const EMPTY_MESSAGE = "No manufacturers are recorded yet. Use “New Manufacturer” to create the first governed record.";
const DENIED_MESSAGE = "You do not have access to Manufacturers. Contact an administrator if you believe this is an error.";
const UNAVAILABLE_MESSAGE = "Manufacturers are currently unavailable. Try again later.";

/**
 * Reshape this workspace's own load state into a metadata list presentation, without a
 * second read. `state.manufacturers` (when phase === "ready") is the SAME
 * fetchManufacturerList() result the workspace already holds -- reused, not re-fetched.
 */
export function buildManufacturersPresentation(state, sort = null) {
  const loading = state.phase === "loading";
  const errorStatus = state.phase === "denied" ? "denied" : state.phase === "error" ? "unavailable" : null;
  const manufacturers = state.phase === "ready" ? state.manufacturers ?? [] : [];
  // `id` is the routing/keying field ONLY -- it is never among the declared columns
  // (manufacturerIndexList: name, status), so cellValue never has a chance to render it.
  const rows = sortRows(
    manufacturers.map((m) => ({ id: m.manufacturerId, name: m.name, status: m.status })),
    sort,
    MANUFACTURER_SORT_COLUMNS,
  );
  // listManufacturers is bounded server-side. There is no cursor, so a truncated list is disclosed in the header
  // (see Manufacturers below) rather than as a Load more the server cannot answer; hasMore stays false.
  const presentation = buildListPresentation({
    def: manufacturerIndexList,
    entity: manufacturerEntity,
    page: { rows, hasMore: false },
    loading,
    errorStatus,
    filtersActive: false,
  });
  const emptyMessage =
    presentation.state === "EMPTY" ? EMPTY_MESSAGE :
    presentation.state === "DENIED" ? DENIED_MESSAGE :
    presentation.state === "UNAVAILABLE" ? UNAVAILABLE_MESSAGE :
    presentation.emptyMessage;
  return { ...presentation, emptyMessage };
}

export default function Manufacturers({ commands = manufacturerCommands } = {}) {
  const [state, setState] = useState({ phase: "loading" });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    fetchManufacturerList().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ phase: r.code === "permission-denied" ? "denied" : "error" });
      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalidCount, truncated: r.truncated === true });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);

  // ---- writes: one open panel at a time; the outcome is the server's answer, never assumed ----
  const [panel, setPanel] = useState(null); // {mode:"create"} | {mode:"rename", m} | {mode:"status", m}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const idFieldId = useId();
  const nameFieldId = useId();
  const byId = useMemo(() => new Map((state.manufacturers ?? []).map((m) => [m.manufacturerId, m])), [state.manufacturers]);
  const open = (next, nextForm = {}) => { setForm(nextForm); setOutcome(null); setPanel(next); };
  const close = () => { setPanel(null); setForm({}); };
  const run = async (write) => {
    setBusy(true);
    const o = await write();
    setBusy(false);
    setOutcome(o);
    if (o.kind === "applied" || o.kind === "replayed") { close(); load(); }
  };
  const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
  const submitCreate = () => run(() => commands.create({ manufacturerId: trimmed(form.manufacturerId), name: trimmed(form.name) }));
  const submitRename = () => {
    const name = trimmed(form.name);
    if (!name || name === panel.m.name) { setOutcome({ kind: "noop", message: "No changes to save." }); return; }
    run(() => commands.rename({ manufacturerId: panel.m.manufacturerId, expectedUpdatedAt: panel.m.updatedAt, name }));
  };
  const submitStatus = (newStatus) =>
    run(() => commands.changeStatus({ manufacturerId: panel.m.manufacturerId, expectedUpdatedAt: panel.m.updatedAt, newStatus }));

  // MetadataListGrid hands a row action the row KEY only; the record is looked back up for the panel.
  const rowActions = [
    { id: "rename", label: "Rename", denied: busy, onActivate: (key) => { const m = byId.get(key); if (m) open({ mode: "rename", m }, { name: m.name }); } },
    { id: "status", label: "Status", denied: busy, onActivate: (key) => { const m = byId.get(key); if (m) open({ mode: "status", m }); } },
  ];

  // Header sort state ({ key, direction } | null = the catalog's default order), in the grid's criteria shape.
  const [headerSort, setHeaderSort] = useState(null);
  const presentation = useMemo(() => buildManufacturersPresentation(state, headerSort), [state, headerSort]);
  const sorting = useMemo(() => ({
    entity: manufacturerEntity,
    criteria: { sort: headerSort ? [{ fieldId: headerSort.key, direction: headerSort.direction === "desc" ? "DESC" : "ASC" }] : [] },
    onSort: (fieldId, direction) => setHeaderSort(fieldId ? { key: fieldId, direction: direction === "DESC" ? "desc" : "asc" } : null),
  }), [headerSort]);

  // THE COUNT IS EXACT ONLY WHEN THE READ IS COMPLETE. listManufacturers returns every row up to its bound and says
  // `truncated` past it, so an untruncated list IS the collection count; a truncated one prints no count at all.
  //
  // Null on any unsettled read. A "0 manufacturers" printed over a denial states that the business
  // has no manufacturers when the truth is that this reader may not see them.
  const total = state.phase === "ready" && !state.truncated ? (state.manufacturers?.length ?? null) : null;

  return (
    <WorkspaceIdentity
      crumb="Inventory → Manufacturers"
      title="Manufacturers"
      count={total}
      countLabel={total === 1 ? "manufacturer" : "manufacturers"}
      // The malformed-record count is the one operational fact this page can state truthfully, and
      // it belongs here rather than buried in the paragraph below: it is the reason somebody would
      // act. Omitted entirely when there are none — never "0 excluded", which would read as a
      // reassurance the page has not earned on a denied or failed read.
      summaryItems={[
        ...(state.phase === "ready" && state.invalidCount > 0
          ? [{ key: "invalid", label: `${state.invalidCount} malformed record${state.invalidCount === 1 ? "" : "s"} excluded`, tone: "attention" }]
          : []),
        ...(state.phase === "ready" && state.truncated
          ? [{ key: "truncated", label: "More manufacturers exist than this list shows", tone: "attention" }]
          : []),
      ]}
      action={<Button variant="primary" onClick={() => open({ mode: "create" })} disabled={busy}>New Manufacturer</Button>}
    >
      <p className="fo-mfr__hint">
        Governed manufacturer reference records that Parts link to. Create, rename, and activate or deactivate them
        here; every change is authorized server-side.
        {state.phase === "ready" && state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>

      {!panel && <OutcomeBanner outcome={outcome} />}
      {panel && (
        <div className="fo-mfr__panel">
          <div className="fo-mfr__panel-header">
            <h3 className="fo-mfr__panel-title">
              {panel.mode === "create" ? "New Manufacturer" : panel.mode === "rename" ? `Rename ${panel.m.name}` : `Change Status — ${panel.m.name}`}
            </h3>
            <Button variant="tertiary" className="fo-mfr__close-btn" onClick={close} disabled={busy} aria-label="Close">×</Button>
          </div>
          <OutcomeBanner outcome={outcome} />
          {panel.mode === "status" ? (
            <div>
              <p className="fo-mfr__status-desc">Current status: <StatusBadge status={panel.m.status} />.</p>
              <div className="fo-mfr__status-actions">
                {OTHER_STATUS[panel.m.status] && (
                  <Button variant="secondary" onClick={() => submitStatus(OTHER_STATUS[panel.m.status])} loading={busy}>
                    Make {statusLabel(OTHER_STATUS[panel.m.status], STATUS_WORDS)}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="fo-mfr__form">
              {panel.mode === "create" && (
                <div className="fo-mfr__field">
                  <label className="fo-mfr__label" htmlFor={idFieldId}>Manufacturer ID</label>
                  <input id={idFieldId} className="fo-mfr__input" value={form.manufacturerId ?? ""} disabled={busy}
                    onChange={(e) => setForm((f) => ({ ...f, manufacturerId: e.target.value }))} />
                </div>
              )}
              <div className="fo-mfr__field">
                <label className="fo-mfr__label" htmlFor={nameFieldId}>Name</label>
                <input id={nameFieldId} className="fo-mfr__input" value={form.name ?? ""} disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="fo-mfr__form-actions">
                <Button variant="primary" onClick={panel.mode === "create" ? submitCreate : submitRename} loading={busy}>
                  {panel.mode === "create" ? "Create Manufacturer" : "Save Name"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NO onLoadMore, AND NO FOOTER — Owner ruling, Lists P2 tranche 1.
          listManufacturers is one bounded call with no cursor, no page boundary and no total-pages,
          so any control implying one would be a boundary invented by the interface (a truncated
          list is disclosed in the header instead). `buildManufacturersPresentation` already pins
          `hasMore: false`, and the grid renders Load more only when hasMore AND onLoadMore are
          both present — so this is guarded in two places rather than by this line alone.
          NO ROW NAVIGATION either: there is no Manufacturer record route, and one is not invented
          to make rows clickable. The rows carry governed row ACTIONS (Rename, Status) instead. */}
      <MetadataListGrid presentation={presentation} sorting={sorting} rowActions={rowActions} caption="Manufacturers" onRetry={load} />
    </WorkspaceIdentity>
  );
}
