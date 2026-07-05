// Step 2 -- Service Request.
//
// Work Order Type options are the real 5 values WorkOrderType supports
// (types/workOrder.ts, matches functions/src/types/workOrder.ts) --
// NOT the 6 originally requested ("Emergency" included). Emergency is
// a Priority level (1 = Emergency), not a Type -- adding a 6th Type
// value would require changing the Cloud Function's type contract,
// out of scope for this phase.
const WORK_ORDER_TYPES = [
  { value: "SERVICE_CALL", label: "Service Call" },
  { value: "PM", label: "Preventive Maintenance" },
  { value: "INSTALL", label: "Installation" },
  { value: "INSPECTION", label: "Inspection" },
  { value: "WARRANTY", label: "Warranty" },
];

const PRIORITIES = [
  { value: 1, label: "1 -- Emergency" },
  { value: 2, label: "2 -- High" },
  { value: 3, label: "3 -- Normal" },
  { value: 4, label: "4 -- Low" },
];

export default function ServiceStep({ form, errors, onChange }) {
  return (
    <div className="fo-wizard-step">
      <label>
        Work Order Type *
        <select value={form.type} onChange={(e) => onChange({ type: e.target.value })}>
          <option value="">Select type…</option>
          {WORK_ORDER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {errors.type && <span className="fo-error">{errors.type}</span>}
      </label>

      <label>
        Priority *
        <select
          value={form.priority ?? ""}
          onChange={(e) => onChange({ priority: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Select priority…</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {errors.priority && <span className="fo-error">{errors.priority}</span>}
      </label>

      <label>
        Description *
        <textarea
          value={form.complaint}
          onChange={(e) => onChange({ complaint: e.target.value })}
          placeholder="Requested service / complaint"
          rows={4}
        />
        {errors.complaint && <span className="fo-error">{errors.complaint}</span>}
      </label>
    </div>
  );
}
