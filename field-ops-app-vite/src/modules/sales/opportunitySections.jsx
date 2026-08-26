import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { OPPORTUNITY_DATA_CLASS, sectionDraft } from "../../domain/opportunityFieldModel.js";
import { isoDate, parseLocalDate } from "../../domain/localDateInput.js";
import OwnerSelect from "./OwnerSelect.jsx";

// OPPORTUNITY SECTION RENDERING — extracted from SalesWorkspace.jsx, unchanged.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// These components were private to SalesWorkspace.jsx, which was fine while the workspace detail
// pane was the ONLY place an Opportunity could be read or edited. The North Star P1v2 record page
// is a second surface that must offer the SAME deliberate read -> Edit -> Save/Cancel behaviour
// over the SAME version-checked governed command.
//
// Two surfaces, two copies of an editing form, is how a concurrency check comes to be enforced on
// one screen and not the other. So the subtree MOVED here rather than being reimplemented, and
// both surfaces import it. Nothing in it was rewritten during the move: the section model still
// comes from `opportunityDetailModel`, the draft still comes from `sectionDraft`, the save still
// goes through the caller's `onSave` (the governed `useOpportunitySectionSave`), and the
// fail-closed posture -- Edit disabled and honest when readiness is off OR no save is wired -- is
// byte-for-byte what it was.
//
// `salesWorkspace.test.jsx` is the proof the move changed nothing: it exercises this subtree
// through the workspace exactly as before.

// THE OPPORTUNITY'S VALUE IS NOT MONEY, AND MUST NOT BE DRESSED AS IT (P1v2 decision O1).
//
// This formatter used to be `style: "currency", currency: "USD"` — it asserted US dollars on a
// field the document stores as a bare number with no currency beside it. Every Opportunity ever
// shown in the workspace carried a "$" that nothing in the data justified, which is precisely what
// the design's do-not-invent list forbids and what the record page's header annotation exists to
// be honest about.
//
// Grouped for legibility, and nothing more. The "(no currency recorded)" annotation is stated ONCE,
// in the record header, exactly as the artifact places it — the number itself renders identically
// in the header, the rail and the pipeline, which is the "one rendering" the acceptance checklist
// asks for.
const currency = (v) =>
  typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
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
function FieldEdit({ field, value, onChange, directory }) {
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
      // Owner reassignment (governed), now a real picker over the employee directory. OwnerSelect
      // owns the degradation: a caller who cannot read the directory keeps the bounded id field
      // and is told why, rather than being shown an empty dropdown.
      return <OwnerSelect id={id} value={value} onChange={onChange} describedBy={`${id}-note`} directory={directory} />;
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
          <Button type="button" variant="tertiary" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>Remove</Button>
        </div>
      ))}
      <Button type="button" variant="tertiary" onClick={add}>Add line</Button>
    </div>
  );
}

// A section edit FORM (opened when the user enters section-level editing). Binds a draft of the section's
// USER_MAINTAINED fields, offers Save + Cancel. Save is live when BOTH (a) write-readiness is enabled and
// (b) a governed save command is wired (onSave); otherwise it is disabled and says which of the two is
// missing. Cancel always returns to read without side effects.
//
// THE DRAFT SURVIVES A FAILED SAVE. On a version conflict in particular, the form stays open holding what
// the user typed, because the recovery they are being asked to perform is "reapply your edit" — discarding
// it and then asking for it back would be the one unrecoverable response to a recoverable problem.
function SectionEditForm({ section, readiness, onSave, onCancel, saving, outcome, directory }) {
  const [draft, setDraft] = useState(() => sectionDraft(section));
  const set = (key, v) => setDraft((d) => ({ ...d, [key]: v }));
  const editable = section.fields.filter((f) => f.dataClass === OPPORTUNITY_DATA_CLASS.USER_MAINTAINED);
  const saveWired = typeof onSave === "function";
  const canSave = readiness.enabled && saveWired && !saving;
  const saveReason = !readiness.enabled
    ? readiness.reason
    : !saveWired
      ? "The governed save command is not wired in this build."
      : saving
        ? "Saving…"
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
          <FieldEdit field={f} value={draft[f.key]} onChange={(v) => set(f.key, v)} directory={directory} />
          {f.control === "owner" && (
            <p id={`opp-edit-${f.key}-note`} className="fo-muted fo-sales-editform__note">
              Employee directory not connected yet — reassignment records the owner id.
            </p>
          )}
        </div>
      ))}
      <div className="fo-sales-editform__actions">
        <Button
          type="submit"
          variant={canSave ? "primary" : "protected"}
          title={saveReason}
          reason={canSave ? undefined : saveReason}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="tertiary" onClick={onCancel} disabled={saving}>Cancel</Button>
        {!canSave && <span className="fo-muted fo-sales-editform__note">{saveReason}</span>}
      </div>
      {/* The failure the user must act on, stated where they are looking and announced to AT.
          A conflict is not styled as their mistake -- it is a report that someone else saved
          first, and the draft above is still theirs to resubmit. */}
      {outcome && outcome.kind !== "applied" && outcome.kind !== "replayed" && (
        <p
          className={outcome.kind === "noop" ? "fo-muted fo-sales-editform__note" : "fo-sales-editform__error"}
          role={outcome.kind === "noop" ? undefined : "alert"}
        >
          {outcome.message}
        </p>
      )}
    </form>
  );
}

// A detail SECTION. Reads by default. Editable-by-design sections carry a contextual Edit affordance in the
// header (disabled + honest when EITHER readiness is off OR no governed save command is wired — same
// fail-closed posture as the lifecycle actions and the inert create control; today's production mount passes
// no onSaveSection, so Edit stays disabled+honest there even for a real write-capable caller, rather than
// opening a form whose Save can never succeed). Entering edit swaps the read body for the section form; only
// one section edits at a time (owned by the parent). SYSTEM_DERIVED / READ_ONLY sections never show an edit
// affordance.
function DetailSection({ section, editing, onEnterEdit, onCancelEdit, readiness, onSave, editable = true, saving, outcome, directory }) {
  const showEdit = section.editable;
  const saveWired = typeof onSave === "function";
  // `editable` is the RECORD-level rule (a closed Opportunity is a historical record; the command
  // refuses it with CLOSED). Mirrored here so the surface never offers an edit that is certain to
  // be rejected -- the server still enforces it, this only stops the invitation.
  const editDisabled = !readiness.enabled || !saveWired || !editable;
  const editReason = !editable
    ? "This Opportunity is closed. Its details are a historical record and can no longer be edited."
    : !readiness.enabled
      ? readiness.reason
      : !saveWired
        ? "The governed save command is not wired in this build."
        : undefined;
  return (
    <section className="fo-sales-detail__block" aria-label={section.title} data-dataclass={section.dataClass}>
      <div className="fo-sales-detail__block-head">
        <h4>{section.title}</h4>
        {showEdit && !editing && (
          <Button
            type="button"
            variant={editDisabled ? "protected" : "tertiary"}
            className="fo-sales-detail__edit"
            title={editDisabled ? editReason : undefined}
            reason={editDisabled ? editReason : undefined}
            aria-label={editDisabled ? `Edit ${section.title} — ${editReason}` : `Edit ${section.title}`}
            onClick={editDisabled ? undefined : () => onEnterEdit(section.id)}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <SectionEditForm
          section={section}
          readiness={readiness}
          onSave={onSave}
          onCancel={onCancelEdit}
          saving={saving}
          outcome={outcome}
          directory={directory}
        />
      ) : (
        <SectionReadBody section={section} />
      )}
    </section>
  );
}

// Read body for a section: its fields as label/value rows (single-field sections render just the value).
function SectionReadBody({ section }) {
  if (section.future && section.fields.length === 0) {
    // P1v2's wording for the ratified seam. Says the same true thing the previous sentence said
    // and adds WHY the slot is empty and what would fill it -- Design owns this copy.
    return (
      <p className="fo-muted">
        Not configured — no qualification schema is ratified yet. This slot fills when Product
        ratifies one; nothing is invented meanwhile.
      </p>
    );
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
/** The owner's display name, or null when the directory cannot name them. Never the id. */
function ownerName(employeeId, directory) {
  const employee = directory?.byEmployeeId?.get?.(employeeId);
  return employee?.displayName || employee?.name || null;
}

export { DetailSection, SectionEditForm, SectionReadBody, FieldRead, FieldEdit, LineEditor, LineSummary, ownerName, currency, shortDate };
