from ed import edit
p = "src/modules/inventory/Manufacturers.jsx"
edit(p, [
("""// READ via services/manufacturerQueries.fetchManufacturerList -> the trusted `getManufacturerCatalog`
// callable (capability `inventory.catalog.read`). Part 11 reconciliation (2026-08-15): this surface""",
"""// EOS CORE (Firebase exit F5, 2026-10-17). READ via services/manufacturerQueries.fetchManufacturerList ->
// services/manufacturerCatalogClient.js -> the Catalog API's listManufacturers (eos_ops.manufacturers;
// inventory.catalog.read AND inventory.manufacturer.read). WRITES -- New Manufacturer, Rename, Status -- go through
// the same client to createManufacturer / updateManufacturer / changeManufacturerStatus (postgresManufacturerWriter.ts:
// inventory.catalog.manage, and inventory.catalog.activate for status). The server decides who may; a refusal is
// shown as the server's answer, the Supplier administration pattern (DECISIONS #196). The concurrency token is the
// row's `updatedAt`, which the list hands out.
//
// History (Firebase era). READ was the trusted `getManufacturerCatalog`
// callable (capability `inventory.catalog.read`). Part 11 reconciliation (2026-08-15): this surface"""),
("""// READ-ONLY (Firebase exit PR-B, 2026-10-15). The create / rename / status affordances, their write hook
// (useManufacturerWrite), the createManufacturer / updateManufacturer / changeManufacturerStatus callable
// client and the MANUFACTURER_WRITE_READY flag were removed: the flag was false in every environment, so no
// write was ever attempted from here. Manufacturer administration returns on EOS Core (the PostgreSQL writer,
// functions/src/catalogMaster/postgresManufacturerWriter.ts, once it is routed), never on these callables.
// See docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md.""",
"""// PR-B (2026-10-15) removed the flag-dead Firebase write affordances; F5 restores them on EOS Core.
// See docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md."""),
("""import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";""",
"""import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { fetchManufacturerList } from "../../services/manufacturerQueries";
import { manufacturerCommands } from "../../services/manufacturerCatalogClient.js";
import { Button } from "../../shared/ui/primitives/index.js";"""),
("""const STATUS_WORDS = manufacturerEntity.fields.find((f) => f.id === "status")?.enumLabels ?? {};
""", """const STATUS_WORDS = manufacturerEntity.fields.find((f) => f.id === "status")?.enumLabels ?? {};

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
"""),
("""const EMPTY_MESSAGE = "No manufacturers are recorded yet.";""",
"""const EMPTY_MESSAGE = "No manufacturers are recorded yet. Use “New Manufacturer” to create the first governed record.";"""),
("""  // getManufacturerCatalog returns the WHOLE catalog, unbounded -- there is no truncation
  // to disclose here (unlike a capped RELATED section), so hasMore is always false.""",
"""  // listManufacturers is bounded server-side. There is no cursor, so a truncated list is disclosed in the header
  // (see Manufacturers below) rather than as a Load more the server cannot answer; hasMore stays false."""),
("""export default function Manufacturers() {
  const [state, setState] = useState({ phase: "loading" });
""", """export default function Manufacturers({ commands = manufacturerCommands } = {}) {
  const [state, setState] = useState({ phase: "loading" });
"""),
("""      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalidCount });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => load(), [load]);
""", """      else setState({ phase: "ready", manufacturers: r.manufacturers, invalidCount: r.invalidCount, truncated: r.truncated === true });
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
"""),
("""  // THE COUNT IS EXACT HERE, AND ONLY BECAUSE THE READ IS COMPLETE.
  //
  // getManufacturerCatalog returns the WHOLE collection in one call — no `limit`, no cursor, no
  // `truncated` flag. That is a scale problem recorded elsewhere (R7), and on this one question it
  // is a licence: a count over every row IS the collection count, so it is a governed total rather
  // than a page tally dressed up as one. Every other list on this grammar must earn its header
  // count from a server-side aggregate for exactly the reason this one does not need to.
  //""",
"""  // THE COUNT IS EXACT ONLY WHEN THE READ IS COMPLETE. listManufacturers returns every row up to its bound and says
  // `truncated` past it, so an untruncated list IS the collection count; a truncated one prints no count at all.
  //"""),
("""  const total = state.phase === "ready" ? (state.manufacturers?.length ?? null) : null;""",
"""  const total = state.phase === "ready" && !state.truncated ? (state.manufacturers?.length ?? null) : null;"""),
("""      summaryItems={
        state.phase === "ready" && state.invalidCount > 0
          ? [{ key: "invalid", label: `${state.invalidCount} malformed record${state.invalidCount === 1 ? "" : "s"} excluded`, tone: "attention" }]
          : []
      }
    >
      <p className="fo-mfr__hint">
        Governed manufacturer reference records that Parts link to. This page is read-only.
        {state.phase === "ready" && state.invalidCount > 0 ? ` ${state.invalidCount} malformed record(s) were excluded and need review.` : ""}
      </p>
""", """      summaryItems={[
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
"""),
("""          getManufacturerCatalog reads the whole collection in one unbounded call. There is no
          cursor, no page boundary and no total-pages, so any control implying one would be a
          boundary invented by the interface.""",
"""          listManufacturers is one bounded call with no cursor, no page boundary and no total-pages,
          so any control implying one would be a boundary invented by the interface (a truncated
          list is disclosed in the header instead)."""),
("""          to make rows clickable. */}
      <MetadataListGrid presentation={presentation} sorting={sorting} caption="Manufacturers" onRetry={load} />""",
"""          to make rows clickable. The rows carry governed row ACTIONS (Rename, Status) instead. */}
      <MetadataListGrid presentation={presentation} sorting={sorting} rowActions={rowActions} caption="Manufacturers" onRetry={load} />"""),
])
