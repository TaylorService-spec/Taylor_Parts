import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory.js";

// OWNER REASSIGNMENT control. Opportunity.ownerEmployeeId is an Employee DOCUMENT id, so the
// honest control is a picker over the employee directory — not a text box the user has to type
// an opaque id into, which is what this was before (its own note: "the employee directory is not
// connected yet"). It is connected now: useEmployeeDirectory already exposes byEmployeeId,
// added for exactly this class of lookup.
//
// IT DEGRADES INSTEAD OF BREAKING, and that is the load-bearing part. The employees collection
// is readable by admin/dispatcher only (domain/employees.js's buildEmployeeDirectoryQuery). A
// salesperson holding a real, valid opportunity.write capability CANNOT read it — their listener
// errors. If this rendered a picker regardless, that user would see an empty dropdown and
// conclude there are no employees, or worse, be unable to keep the owner the Opportunity already
// has. So an unreadable directory falls back to the bounded id field, preserving the current
// value and SAYING WHY. Losing the ability to pick is acceptable; silently losing the ability to
// save is not.
//
// The current owner is always offered even when the directory does not list them (an owner who
// has since left the directory, or a record predating it). A picker that cannot represent the
// value it was given would force an unrelated change just to save the section.
export default function OwnerSelect({ id, value, onChange, describedBy, directory }) {
  // `directory` is a test seam; production uses the real hook. Called unconditionally either way
  // (rules of hooks) — `enabled: false` makes it inert when a double is supplied.
  const live = useEmployeeDirectory({ enabled: !directory });
  const { byEmployeeId, loading, error } = directory ?? live;

  const options = [];
  const seen = new Set();
  for (const [employeeId, employee] of byEmployeeId ?? new Map()) {
    const name = employee?.displayName || employee?.name || employeeId;
    options.push({ value: employeeId, label: employee?.securityRole ? `${name} — ${employee.securityRole}` : name });
    seen.add(employeeId);
  }
  options.sort((a, b) => a.label.localeCompare(b.label));

  // WHETHER THERE IS A DIRECTORY is decided BEFORE the current owner is added to the list.
  // Otherwise an empty directory plus an existing owner produced a dropdown whose only entry was
  // that owner -- a picker offering exactly one choice, the one already selected. It looks like a
  // functioning control and can do nothing, which is worse than the honest id field.
  const directoryEmpty = seen.size === 0;
  if (value && !seen.has(value)) {
    options.unshift({ value, label: `${value} (not in directory)` });
  }

  if (loading) {
    return (
      <>
        <input id={id} className="fo-input" type="text" value={value ?? ""} readOnly aria-describedby={describedBy} />
        <p className="fo-muted fo-sales-editform__note">Loading the employee directory…</p>
      </>
    );
  }

  if (error || directoryEmpty) {
    return (
      <>
        <input
          id={id}
          className="fo-input"
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
        />
        <p className="fo-muted fo-sales-editform__note">
          {error
            ? "You are not authorized to browse the employee directory, so the owner is shown as an employee id. The id can still be changed and saved."
            : "The employee directory returned no records, so the owner is shown as an employee id."}
        </p>
      </>
    );
  }

  return (
    <select
      id={id}
      className="fo-input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={describedBy}
    >
      {!value && <option value="">Select an owner…</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
