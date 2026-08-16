import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ContextBand from "../../shared/ui/ContextBand.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { useOpportunities } from "../../hooks/useOpportunities.js";
import { useOpportunityTransitions } from "../../hooks/useOpportunityTransitions.js";
import { buildOpportunityPipeline, channelLabel, stageProgress } from "../../domain/opportunityLifecycle.js";
import { opportunityDetailModel, OPPORTUNITY_DATA_CLASS, sectionDraft } from "../../domain/opportunityFieldModel.js";
import { opportunityWriteReadiness } from "../../access/opportunityWriteReadiness.js";
import { isoDate, parseLocalDate } from "../../domain/localDateInput.js";
import OpportunityLifecycleControl from "./OpportunityLifecycleControl.jsx";
import StageProgressTrack from "../../shared/ui/StageProgressTrack.jsx";
import NewOpportunityForm from "./NewOpportunityForm.jsx";

// Sales — Opportunity OPERATING Workspace. The commercial pipeline is the entry point to Sales (ratified:
// Opportunity Management, NOT Account→Create Work Order). This surface reads opportunities through the
// injected source seam (hooks/useOpportunities → access/opportunitySource) and renders them on the Wave-0
// composition primitives (WorkspaceShell / ContextBand / StatusPill / ActionRail). It is a PIPELINE built for
// rapid scanning + comparison, not a metric-card CRM dashboard and not a giant-card-per-opportunity page.
//
// EDITING-READY (design requirement): the workspace is intended to become an operating workspace where
// authorized users MAINTAIN Opportunity information once the governed write authority is activated. The detail
// pane is therefore composed for BOTH read/scan AND edit/operate WITHOUT another structural redesign — but it
// is NOT a permanent wall of form controls. It reads cleanly by default; editing is CONTEXTUAL and SECTION-
// LEVEL (one section at a time), which is the interaction that recomposes cleanly from desktop down to phone
// (a section edit is a small stacked form, never a desktop grid squeezed narrow).
//
// WRITE-READINESS: field editing AND lifecycle transitions AND create are all governed writes; all three
// are gated by the SAME write-readiness seam (access/opportunityWriteReadiness), fed by the REAL trusted
// effective-access signal (access/useOpportunityCapabilities → resolveEffectiveAccessCallable), wired at the
// production mount in App.jsx. Any caller that does NOT inject a `readiness` prop (including every existing
// test render here) still gets the seam's own fail-closed default (opportunityWriteReadiness() with no
// deps evaluates to disabled) — this component never assumes writes are live; it only ever reads through
// the injected/defaulted seam. When capabilityGranted flips server-side, the SAME affordances (Edit, the
// lifecycle chevrons/actions, New opportunity) go live with no structural change here.

// isoDate/parseLocalDate live in domain/localDateInput.js (shared with NewOpportunityForm.jsx without a
// circular import); re-exported here so the existing `import { isoDate, parseLocalDate } from
// ".../SalesWorkspace.jsx"` call site (test/salesWorkspaceDate.test.jsx) is unchanged.
export { isoDate, parseLocalDate };

const currency = (v) =>
  typeof v === "number" ? v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";
const shortDate = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

function LineSummary({ lines }) {
  if (!lines?.length) return <span className="fo-muted">No solution lines yet</span>;
  return (
    <ul className="fo-sales-detail__lines">
      {lines.map((l, i) => (
        <li key={`${l.kind}-${l.ref}-${i}`}>
          <span className="fo-sales-detail__line-kind">{l.kind}</span> {l.ref}
          {l.qty ? <span className="fo-muted"> ×{l.qty}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// Read view for one field of an editable section — label + formatted value. SYSTEM_DERIVED attention items
// render as tone pills; solution lines render via LineSummary; everything else is a formatted string.
function FieldRead({ field }) {
  if (field.control === "lines") return <LineSummary lines={field.value} />;
  if (field.dataClass === OPPORTUNITY_DATA_CLASS.SYSTEM_DERIVED) {
    return <StatusPill tone={field.tone} label={field.display} asText />;
  }
  return <span className="fo-sales-field__value">{field.display}</span>;
}

// Edit control for one USER_MAINTAINED field, bound to the section draft. These render ONLY inside an active
// section edit form (never as a standing wall of controls). No control performs a write — Save is what would
// hand the draft to the governed command, and Save is itself gated by readiness + a wired command.
function FieldEdit({ field, value, onChange }) {
  const id = `opp-edit-${field.key}`;
  switch (field.control) {
    case "select":
      return (
        <select id={id} className="fo-input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "currency":
      return (
        <input id={id} className="fo-input" type="number" inputMode="numeric" min="0" step="1"
          value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      );
    case "date":
      return (
        <input id={id} className="fo-input" type="date" value={isoDate(value)}
          onChange={(e) => onChange(e.target.value ? parseLocalDate(e.target.value) : null)} />
      );
    case "textarea":
      return <textarea id={id} className="fo-input" rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "owner":
      // Owner reassignment (governed). The employee directory is not connected yet (accountOwner is free text,
      // ADR-012 has no team/scope model), so this is a bounded id field, honest about the not-yet-connected
      // directory rather than a fake picker.
      return (
        <input id={id} className="fo-input" type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-note`} />
      );
    case "lines":
      // Solution-line editing is the richest control; kept honest + minimal here (the responsive composition
      // is the deliverable, not a full line-item builder). Lines are product/model/part refs + qty.
      return <LineEditor lines={value ?? []} onChange={onChange} />;
    default:
      return <input id={id} className="fo-input" type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

// Minimal solution-line editor: edit qty, remove a line, add a line. References product/model/part identities
// (kind + ref) — never a serialized asset. Deliberately compact so it recomposes to phone width as stacked
// rows rather than a wide table.
function LineEditor({ lines, onChange }) {
  const update = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const add = () => onChange([...lines, { kind: "EQUIPMENT_MODEL", ref: "", qty: 1 }]);
  return (
    <div className="fo-sales-lineedit">
      {lines.length === 0 && <p className="fo-muted">No solution lines yet.</p>}
      {lines.map((l, i) => (
        <div className="fo-sales-lineedit__row" key={i}>
          <select className="fo-input" aria-label="Line kind" value={l.kind} onChange={(e) => update(i, { kind: e.target.value })}>
            <option value="EQUIPMENT_MODEL">Model</option>
            <option value="PART">Part</option>
            <option value="SERVICE">Service</option>
          </select>
          <input className="fo-input" aria-label="Line reference" type="text" value={l.ref} placeholder="Product / model / part"
            onChange={(e) => update(i, { ref: e.target.value })} />
          <input className="fo-input fo-sales-lineedit__qty" aria-label="Quantity" type="number" min="1" step="1" value={l.qty ?? 1}
            onChange={(e) => update(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
          <button type="button" className="fo-btn-ghost" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>Remove</button>
        </div>
      ))}
      <button type="button" className="fo-btn-ghost" onClick={add}>Add line</button>
    </div>
  );
}

// A section edit FORM (opened when the user enters section-level editing). Binds a draft of the section's
// USER_MAINTAINED fields, offers Save + Cancel. Save is inert unless BOTH (a) write-readiness is enabled and
// (b) a governed save command is wired (onSave) — today neither, so Save is disabled + honest. Cancel always
// returns to read without side effects.
function SectionEditForm({ section, readiness, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => sectionDraft(section));
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const editable = section.fields.filter((f) => f.dataClass === OPPORTUNITY_DATA_CLASS.USER_MAINTAINED);
  const saveWired = typeof onSave === "function";
  const canSave = readiness.enabled && saveWired;
  const saveReason = !readiness.enabled
    ? readiness.reason
    : !saveWired
      ? "The governed save command is not wired in this build."
      : undefined;
  return (
    <form
      className="fo-sales-editform"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave(section.id, draft);
      }}
    >
      {editable.map((f) => (
        <div className="fo-sales-editform__field" key={f.key}>
          <label htmlFor={`opp-edit-${f.key}`}>
            {f.label}
            {f.governed && <span className="fo-sales-editform__gov" title="Authorized (governed) change"> · governed</span>}
          </label>
          <FieldEdit field={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} />
          {f.control === "owner" && (
            <p id={`opp-edit-${f.key}-note`} className="fo-muted fo-sales-editform__note">
              Employee directory not connected yet — reassignment records the owner id.
            </p>
          )}
        </div>
      ))}
      <div className="fo-sales-editform__actions">
        <button type="submit" className="fo-btn-primary" disabled={!canSave} title={saveReason}>Save</button>
        <button type="button" className="fo-btn-ghost" onClick={onCancel}>Cancel</button>
        {!canSave && <span className="fo-muted fo-sales-editform__note">{saveReason}</span>}
      </div>
    </form>
  );
}

// A detail SECTION. Reads by default. Editable-by-design sections carry a contextual Edit affordance in the
// header (disabled + honest when readiness is off — same fail-closed posture as the lifecycle actions and the
// inert create control). Entering edit swaps the read body for the section form; only one section edits at a
// time (owned by the parent). SYSTEM_DERIVED / READ_ONLY sections never show an edit affordance.
function DetailSection({ section, editing, onEnterEdit, onCancelEdit, readiness, onSave }) {
  const showEdit = section.editable;
  const editDisabled = !readiness.enabled;
  return (
    <section className="fo-sales-detail__block" aria-label={section.title} data-dataclass={section.dataClass}>
      <div className="fo-sales-detail__block-head">
        <h4>{section.title}</h4>
        {showEdit && !editing && (
          <button
            type="button"
            className="fo-btn-ghost fo-sales-detail__edit"
            disabled={editDisabled}
            title={editDisabled ? readiness.reason : undefined}
            aria-label={editDisabled ? `Edit ${section.title} — ${readiness.reason}` : `Edit ${section.title}`}
            onClick={() => onEnterEdit(section.id)}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <SectionEditForm section={section} readiness={readiness} onSave={onSave} onCancel={onCancelEdit} />
      ) : (
        <SectionReadBody section={section} />
      )}
    </section>
  );
}

// Read body for a section: its fields as label/value rows (single-field sections render just the value).
function SectionReadBody({ section }) {
  if (section.future && section.fields.length === 0) {
    return <p className="fo-muted">No qualification fields configured yet.</p>;
  }
  if (section.fields.length === 0) {
    return <p className="fo-muted">None.</p>;
  }
  if (section.fields.length === 1 && section.dataClass !== OPPORTUNITY_DATA_CLASS.READ_ONLY) {
    return <div className="fo-sales-field"><FieldRead field={section.fields[0]} /></div>;
  }
  return (
    <dl className="fo-sales-fieldgrid">
      {section.fields.map((f) => (
        <div className="fo-sales-fieldgrid__row" key={f.key}>
          <dt>{f.label}</dt>
          <dd><FieldRead field={f} /></dd>
        </div>
      ))}
    </dl>
  );
}

// The detail aside. A ContextBand scans the key facts (read), then the editing-ready sections operate on the
// underlying data. Same datum can appear as a scannable fact AND be maintained in a section — scan up top,
// operate below. Lifecycle sits between the derived attention and the read-only record.
function OpportunityDetail({ row, readiness, onSaveSection, onChanged }) {
  const [editingSection, setEditingSection] = useState(null);
  const model = useMemo(
    () => opportunityDetailModel(row, { format: { currency, date: shortDate } }),
    [row]
  );
  // Called unconditionally (rules-of-hooks) — `row?.id ?? null` scopes the transition idempotency cache to
  // whichever Opportunity is selected right now; useOpportunityTransitions resets its cache on an id change.
  const transitions = useOpportunityTransitions(row?.id ?? null);
  if (!row) return <p className="fo-muted">Select an opportunity to see its detail.</p>;

  const facts = [
    { key: "customer", label: "Customer", value: row.customerName },
    { key: "channel", label: "Channel", value: channelLabel(row.channel) },
    { key: "stage", label: "State", value: <StatusPill tone={row.commercial.tone} label={row.commercial.label} /> },
    { key: "value", label: "Est. value", value: currency(row.expectedValue) },
    { key: "close", label: "Expected close", value: shortDate(row.expectedCloseAt) },
    { key: "owner", label: "Owner", value: row.ownerEmployeeId ?? "—" },
    // Sales Order lineage (Owner-ratified 2026-08-15: "Preserve Opportunity -> Sales Order
    // lineage visibly"). WON-with-no-SO-yet is an honest, distinct state from "not applicable" --
    // never hidden just because the row isn't WON (a real link should always be reachable the
    // moment it exists, regardless of stage/outcome).
    {
      key: "salesOrder",
      label: "Sales Order",
      value: row.salesOrderId
        ? <Link to={`/customers/opportunities/sales-order/${row.salesOrderId}`}>{row.salesOrderId}</Link>
        : row.outcome === "WON"
          ? <span className="fo-muted">Not created yet</span>
          : "—",
    },
  ];

  // Render order: commercial / need / solution / next-action / qualification (editable), then a Lifecycle
  // section (governed actions), then attention (derived) + record (read-only) which the model also supplies.
  const bySlot = Object.fromEntries(model.sections.map((s) => [s.id, s]));
  const editableOrder = ["commercial", "need", "solution", "nextAction", "qualification"];

  const renderSection = (id) => {
    const section = bySlot[id];
    if (!section) return null;
    return (
      <DetailSection
        key={id}
        section={section}
        editing={editingSection === id}
        onEnterEdit={setEditingSection}
        onCancelEdit={() => setEditingSection(null)}
        readiness={readiness}
        onSave={
          onSaveSection
            ? (sectionId, draft) => {
                onSaveSection(sectionId, draft);
                setEditingSection(null);
              }
            : undefined
        }
      />
    );
  };

  return (
    <div className="fo-sales-detail">
      <ContextBand items={facts} />
      {editableOrder.map(renderSection)}
      <section className="fo-sales-detail__block" aria-label="Lifecycle" data-dataclass={OPPORTUNITY_DATA_CLASS.LIFECYCLE_ACTION}>
        <div className="fo-sales-detail__block-head"><h4>Lifecycle</h4></div>
        <OpportunityLifecycleControl row={row} readiness={readiness} transitions={transitions} onChanged={onChanged} />
      </section>
      {renderSection("attention")}
      {renderSection("record")}
    </div>
  );
}

// One scannable pipeline row. Attention-bearing rows carry a left marker + an inline pill so the queue reads
// at a glance; the stage pill uses the shared semantic tone so "attention looks like attention" everywhere.
function PipelineRow({ row, selected, onSelect }) {
  const progress = stageProgress(row);
  return (
    <tr
      className={`fo-sales-row ${selected ? "is-selected" : ""} ${row.attentionTone === "attention" ? "is-attention" : ""}`.trim()}
      onClick={() => onSelect(row.id)}
      // Live-pilot SALES-001 finding (ACCESSIBILITY): pipeline rows were mouse-only (no role/tabindex/key
      // handler), so a keyboard/AT user could not select an opportunity to open its detail. Make each row a
      // keyboard-operable option — focusable, Enter/Space selects.
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      aria-selected={selected}
    >
      {/* data-label drives the phone recomposition (thead hidden; each cell labelled). The `secondary`
          columns are the lower-priority ones (Channel, Expected close) — deferred at constrained widths and
          still shown in the detail pane for the selected opportunity, so information is deferred not lost. */}
      <td className="fo-sales-row__customer" data-label="Customer">{row.customerName}</td>
      {/* Stage reads as PROGRESSION, not just a state. The pill alone answered "what state is this in"
          but never "how far along is it", which is the question a pipeline is scanned for -- so the
          same domain projection the detail chevrons use (stageProgress) also drives a compact track
          here. Both surfaces therefore move together; neither has its own idea of the stage order. */}
      <td data-label="Stage">
        <div className="fo-sales-row__stage">
          <StatusPill tone={row.commercial.tone} label={row.commercial.label} />
          <StageProgressTrack steps={progress.stages} terminal={progress.terminal} />
        </div>
      </td>
      <td className="fo-sales-col--secondary" data-label="Channel">{channelLabel(row.channel)}</td>
      <td className="fo-sales-row__value" data-label="Est. value">{currency(row.expectedValue)}</td>
      <td className="fo-sales-col--secondary" data-label="Expected close">{shortDate(row.expectedCloseAt)}</td>
      <td className="fo-sales-row__next" data-label="Attention / next">
        {row.attention.length > 0 ? (
          <StatusPill tone={row.attentionTone} label={row.attention[0].label} asText />
        ) : (
          <span className="fo-muted">{row.nextAction || "—"}</span>
        )}
      </td>
    </tr>
  );
}

// Props are optional injection seams for tests/activation: `readiness` defaults to the fail-closed write-
// readiness seam; `onSaveSection` is the governed save command (unwired today ⇒ Save stays inert). Production
// renders <SalesWorkspace readiness={...} /> from App.jsx's connected wrapper, which computes readiness from
// the REAL trusted capability feed (access/useOpportunityCapabilities); a caller that passes neither (every
// existing test here) still gets the seam's own fail-closed default.
export default function SalesWorkspace({ readiness, onSaveSection, source, createDeps } = {}) {
  const { opportunities, accountNameById, status, refetch } = useOpportunities(source);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  // Write-readiness through the seam. Fail-closed by default (governed write built but inert unless a real
  // `readiness` is injected); every create/edit/lifecycle affordance renders disabled/honest. When capability
  // is granted, the seam flips and the SAME affordances become live — no structural change here.
  const writeReadiness = readiness ?? opportunityWriteReadiness();

  // Fixed "now" for the render pass so attention derivation is stable within a paint; sourced once from the
  // clock rather than per-row (deterministic across the whole projection).
  const pipeline = useMemo(
    () => buildOpportunityPipeline(opportunities, { nowMillis: Date.now(), accountNameById }),
    [opportunities, accountNameById]
  );

  const selectedRow = useMemo(
    () => pipeline.all.find((r) => r.id === selectedId) ?? pipeline.rows[0] ?? null,
    [pipeline, selectedId]
  );

  const contextItems = [
    { key: "open", label: "Open", value: pipeline.counts.open },
    { key: "attention", label: "Needs attention", value: pipeline.counts.needsAttention },
    { key: "won", label: "Won", value: pipeline.counts.won },
    { key: "lost", label: "Lost", value: pipeline.counts.lost },
  ];

  // The disabled-state reason is exposed BOTH as an accessible label (keyboard/AT) and as visible on-page
  // text (below), not tooltip-only — consistent with the disabled lifecycle actions in the detail. When
  // readiness IS enabled, the button opens the governed New Opportunity form (NewOpportunityForm.jsx); a
  // successful create authoritatively refetches (never fabricates the row) and selects the new opportunity.
  const createEnabled = writeReadiness.enabled;
  const actions = (
    <ActionRail
      primary={
        <button
          type="button"
          className="fo-btn-primary"
          disabled={!createEnabled}
          aria-label={createEnabled ? "New opportunity" : `New opportunity — ${writeReadiness.reason}`}
          title={createEnabled ? undefined : writeReadiness.reason}
          onClick={createEnabled ? () => setCreating(true) : undefined}
        >
          New opportunity
        </button>
      }
    />
  );

  const attention =
    pipeline.counts.needsAttention > 0 ? (
      <p className="fo-sales-attention">
        <StatusPill tone="attention" label={`${pipeline.counts.needsAttention} opportunit${pipeline.counts.needsAttention === 1 ? "y" : "ies"} need attention`} />
        <span className="fo-muted"> — sorted to the top of the pipeline.</span>
      </p>
    ) : null;

  const isSynthetic = status === "ready";

  return (
    <WorkspaceShell
      title="Opportunities"
      density="compact"
      actions={actions}
      context={<ContextBand items={contextItems} />}
      attention={attention}
      supporting={
        <OpportunityDetail row={selectedRow} readiness={writeReadiness} onSaveSection={onSaveSection} onChanged={refetch} />
      }
    >
      {creating && (
        <NewOpportunityForm
          readiness={writeReadiness}
          deps={createDeps}
          onClose={() => setCreating(false)}
          onCreated={(opportunityId) => {
            setCreating(false);
            refetch();
            if (opportunityId) setSelectedId(opportunityId);
          }}
        />
      )}
      {isSynthetic && (
        <p className="fo-sales-banner fo-muted">
          Showing synthetic sample opportunities. The live sales pipeline connects in a later cycle.
          {!createEnabled && <>{" "}{writeReadiness.reason}</>}
        </p>
      )}
      {status !== "ready" ? (
        // Distinct from a genuinely-empty pipeline: the source isn't connected/available (an honest
        // "not connected" state, not "you have zero opportunities").
        <p className="fo-muted">The opportunity pipeline source is not connected yet.</p>
      ) : pipeline.rows.length === 0 ? (
        <p className="fo-muted">No open opportunities.</p>
      ) : (
        // Overflow-safe wrapper: the pipeline can NEVER paint over the detail rail (the original intermediate-
        // width defect — the 6-col table overflowed its grid cell and overlapped the detail aside). The wrapper
        // is a guarantee; the real recomposition is the column-priority + phone-block CSS, which keeps the
        // table fitting so the guard scrollbar effectively never appears.
        <div className="fo-sales-pipeline-wrap">
          <table className="fo-sales-pipeline">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Stage</th>
                <th className="fo-sales-col--secondary">Channel</th>
                <th>Est. value</th>
                <th className="fo-sales-col--secondary">Expected close</th>
                <th>Attention / next</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.rows.map((row) => (
                <PipelineRow key={row.id} row={row} selected={selectedRow?.id === row.id} onSelect={setSelectedId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorkspaceShell>
  );
}
