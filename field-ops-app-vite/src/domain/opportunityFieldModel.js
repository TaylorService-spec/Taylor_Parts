import { UNRESOLVED_REFERENCE_LABEL } from "../metadata/referenceResolution.js";
// Sales Opportunity — FIELD-CLASSIFICATION MODEL (PURE; no I/O, no JSX; unit-tested).
//
// The Opportunity workspace is becoming an OPERATING workspace: once its governed write authority is
// activated, authorized users maintain Opportunity information here. This model is the single place that
// answers "what CAN be maintained, and by what interaction" — independent of "may I write RIGHT NOW"
// (that is the write-readiness seam, access/opportunityWriteReadiness.js). Keeping the two separate is the
// whole point of the requirement: the DATA MODEL says a field is user-maintained; the SEAM says whether the
// affordance is live. Design classifies; governance activates.
//
// Four data classes (never collapse them into "everything is a form field"):
//   USER_MAINTAINED  — business data an authorized user maintains (need, solution lines, value, close date,
//                      next action, channel, owner reassignment, future qualification fields). EDITABLE by
//                      design; the affordance is live only when write-readiness is enabled + governed.
//   SYSTEM_DERIVED   — computed from Opportunity facts (attention reasons, commercial state). NEVER directly
//                      editable — you change the facts, the derivation follows. Rendered read-only.
//   LIFECYCLE_ACTION — Stage / WON / LOST. A GOVERNED TRANSITION, not an unrestricted field edit. Rendered
//                      as explicit lifecycle actions (see LifecycleActions), never as a Stage <select>.
//   READ_ONLY        — identity + audit (opportunityId, createdAt, updatedAt). Immutable in the UI.
//
// This module returns a data description (sections + fields + control TYPES). The component maps control
// types to inputs; the domain holds no React. `now`/formatters are injected so display is deterministic and
// the module stays pure. Nothing here writes, reads Firestore, or imports a callable.

import { channelLabel, SALES_CHANNELS } from "./opportunityLifecycle.js";

export const OPPORTUNITY_DATA_CLASS = Object.freeze({
  USER_MAINTAINED: "USER_MAINTAINED",
  SYSTEM_DERIVED: "SYSTEM_DERIVED",
  LIFECYCLE_ACTION: "LIFECYCLE_ACTION",
  READ_ONLY: "READ_ONLY",
});

const identity = (v) => (v == null ? "—" : String(v));

/**
 * The owner as a READER sees them: a name, or an honest statement that it could not be resolved.
 *
 * Never the employee id. The resolver is INJECTED because the employee directory is a live read the
 * domain layer has no business performing — and it is admin/dispatcher-only, so "cannot resolve" is
 * a normal outcome for a legitimate caller rather than an error.
 */
const ownerDisplay = (employeeId, resolveOwnerName) => {
  if (employeeId == null) return "—";
  return resolveOwnerName?.(employeeId) ?? UNRESOLVED_REFERENCE_LABEL;
};

// Default display formatters (overridable via opts.format so the workspace can share its currency/date
// formatting). Kept trivial + honest: a missing value shows an em dash, never a fabricated 0 or "today".
const defaultFormat = {
  currency: (v) => (typeof v === "number" ? String(v) : "—"),
  date: (v) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : "—"),
  text: identity,
};

// Channel edit options. Today SALES_CHANNELS is the ratified set (RETAIL/NATIONAL_ACCOUNTS); making Channel
// fully configurable reference data + adding STRATEGIC_ACCOUNTS belongs to Commercial Coverage capability #15
// (see project_commercial_coverage_territory) — NOT invented here. The control reads from the const so it
// automatically widens when #15 lands, without a workspace change.
export const channelOptions = () => SALES_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }));

// Build the editable/detail section model for one pipeline row. Returns an ordered list of sections; each
// section declares its data class + whether it is editable-by-design (contains USER_MAINTAINED fields), and
// each field carries { key, label, value, display, dataClass, control, governed }. `editable`/`governed` are
// STATIC design properties — the live affordance gate is the write-readiness seam, applied in the component.
export function opportunityDetailModel(row, opts = {}) {
  const fmt = { ...defaultFormat, ...(opts.format || {}) };
  if (!row) return { classes: OPPORTUNITY_DATA_CLASS, sections: [] };

  const U = OPPORTUNITY_DATA_CLASS.USER_MAINTAINED;
  const S = OPPORTUNITY_DATA_CLASS.SYSTEM_DERIVED;
  const R = OPPORTUNITY_DATA_CLASS.READ_ONLY;

  const field = (f) => ({ governed: false, ...f });

  const sections = [
    {
      id: "commercial",
      title: "Commercial details",
      dataClass: U,
      editable: true,
      fields: [
        // Channel = applicable commercial context. USER_MAINTAINED via a bounded select (not free text).
        field({ key: "channel", label: "Channel", value: row.channel, display: channelLabel(row.channel),
          dataClass: U, control: "select", options: channelOptions() }),
        field({ key: "expectedValue", label: "Estimated value", value: row.expectedValue,
          display: fmt.currency(row.expectedValue), dataClass: U, control: "currency" }),
        field({ key: "expectedCloseAt", label: "Expected close", value: row.expectedCloseAt,
          display: fmt.date(row.expectedCloseAt), dataClass: U, control: "date" }),
        // Owner reassignment is USER_MAINTAINED but GOVERNED (authorized reassignment, not a free rename).
        // Rendered as an owner control; resolving the employee directory is a later authority (accountOwner is
        // free text today, ADR-012 has no team/scope model) — so the control is a bounded reassignment, honest
        // that the directory is not yet connected.
        field({ key: "ownerEmployeeId", label: "Owner", value: row.ownerEmployeeId,
          // AN EMPLOYEE ID IS NOT A PERSON (DECISIONS #106). This rendered the raw id through
          // identity(). The ContextBand above it carried the same defect and was fixed first, which
          // is exactly how this second site survived: the page looked fixed while the dynamic-detail
          // sweep kept reporting RAW_ID on it. `value` still carries the id because the owner PICKER
          // edits by id — only the DISPLAY changes.
          display: ownerDisplay(row.ownerEmployeeId, opts.resolveOwnerName), dataClass: U, control: "owner", governed: true }),
      ],
    },
    {
      id: "need",
      title: "Customer need",
      dataClass: U,
      editable: true,
      fields: [
        field({ key: "need", label: "Customer need / description", value: row.need ?? "",
          display: row.need ?? "—", dataClass: U, control: "textarea" }),
      ],
    },
    {
      id: "solution",
      title: "Solution",
      dataClass: U,
      editable: true,
      // Solution lines reference PRODUCT / MODEL / PART + quantity — never a serialized asset (Opportunity is
      // pre-commitment; serialization happens at fulfillment). The line editor maintains kind/ref/qty rows.
      fields: [
        field({ key: "lines", label: "Solution lines", value: row.lines ?? [],
          display: null, dataClass: U, control: "lines" }),
      ],
    },
    {
      id: "nextAction",
      title: "Next action",
      dataClass: U,
      editable: true,
      fields: [
        field({ key: "nextAction", label: "Next action", value: row.nextAction ?? "",
          display: row.nextAction ? row.nextAction : "—", dataClass: U, control: "text" }),
      ],
    },
    {
      id: "qualification",
      title: "Qualification",
      dataClass: U,
      editable: true,
      // Future qualification fields (budget/authority/need/timeline etc.) are a USER_MAINTAINED extension
      // point. No qualification schema is ratified yet, so the section is a preserved SEAM rendered honestly
      // as "not configured", NOT invented fields. When Product ratifies qualification, fields append here.
      future: true,
      fields: [],
    },
    {
      id: "attention",
      title: "Needs attention",
      dataClass: S,
      editable: false,
      // Derived from Opportunity facts (deriveAttention) — you cannot hand-edit an attention flag; change the
      // underlying fact (add a next action, move the close date) and the derivation follows.
      fields: (row.attention ?? []).map((a) =>
        field({ key: a.kind, label: a.label, value: a.kind, display: a.label, dataClass: S, control: "readonly", tone: a.tone })),
    },
    {
      id: "record",
      title: "Record",
      dataClass: R,
      editable: false,
      // Identity + audit. Immutable in the UI. createdAt/updatedAt may be absent on synthetic fixtures — shown
      // honestly as "not recorded", never fabricated.
      fields: [
        // THE REFERENCE, NOT THE KEY (DECISIONS #106). This rendered `row.id` — a Firestore document
        // id — under the label "Opportunity ID", which is exactly the substitution that decision
        // forbids, made worse by a label asserting the key WAS the record's identity.
        //
        // The third and last site of this defect on one page: the ContextBand fact, the Owner field,
        // and this. Each fix made the page look correct while the dynamic-detail sweep kept
        // reporting RAW_ID on it — which is the whole value of a detector that reads the RENDERED
        // page instead of the source.
        //
        // "Not numbered" rather than an em dash: a record predating OPP numbering is a real, knowable
        // state, and saying so is more useful than a dash the reader has to interpret.
        field({ key: "opportunityNumber", label: "Opportunity", value: row.opportunityNumber ?? null,
          display: row.opportunityNumber ?? "Not numbered", dataClass: R, control: "readonly" }),
        field({ key: "createdAt", label: "Created", value: row.createdAt ?? null,
          display: row.createdAt != null ? fmt.date(row.createdAt) : "not recorded", dataClass: R, control: "readonly" }),
        field({ key: "updatedAt", label: "Updated", value: row.updatedAt ?? null,
          display: row.updatedAt != null ? fmt.date(row.updatedAt) : "not recorded", dataClass: R, control: "readonly" }),
      ],
    },
  ];

  return { classes: OPPORTUNITY_DATA_CLASS, sections };
}

// Convenience: the ids of sections that are editable-by-design (carry USER_MAINTAINED data). Stage/WON/LOST
// are deliberately NOT here — they are LIFECYCLE_ACTION, maintained through governed transitions.
export function editableSectionIds(model) {
  return model.sections.filter((s) => s.editable).map((s) => s.id);
}

// Collect the editable (USER_MAINTAINED) fields of a section into a draft object keyed by field key. This is
// the shape a section edit form binds to and would hand to the governed command on save. Pure — it does not
// save anything.
export function sectionDraft(section) {
  const draft = {};
  for (const f of section.fields) {
    if (f.dataClass === OPPORTUNITY_DATA_CLASS.USER_MAINTAINED) draft[f.key] = f.value;
  }
  return draft;
}
