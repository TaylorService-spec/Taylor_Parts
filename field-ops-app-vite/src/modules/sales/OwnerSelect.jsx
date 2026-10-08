import { useEffect, useState } from "react";
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import { workforceApiClient } from "../../services/workforceApiClient.js";

// OWNER REASSIGNMENT control. Opportunity.ownerEmployeeId is a governed Employee id -- the Commercial reads resolve it
// against eos_workforce.employees (owner_resolved) -- so the honest control is a TYPEAHEAD over the governed Employee roster
// (UI corrections item E, 2026-10-08): EOS API + PostgreSQL, the server applying employee.record.read and operating-company
// reach. It replaces the Firestore employee-directory listener this control used to open.
//
// IT DEGRADES INSTEAD OF BREAKING, and that is the load-bearing part. A salesperson holding a real, valid opportunity.write
// capability may not hold employee.record.read. For them the roster read is refused, and rendering a picker regardless would
// make them unable to keep the owner the Opportunity already has. So a refused roster falls back to the bounded id field,
// preserving the current value and SAYING WHY. Losing the ability to pick is acceptable; silently losing the ability to save
// is not.
//
// The current owner is always shown even when the roster cannot name them (an owner who has since left, a record predating
// the roster): the field keeps the id and says it is not in the directory.
export default function OwnerSelect({ id, value, onChange, describedBy, workforce = workforceApiClient }) {
  // The current owner's name and whether this caller may browse the roster at all: one bounded read.
  const [current, setCurrent] = useState({ status: "loading", owner: null });
  useEffect(() => {
    let alive = true;
    setCurrent({ status: "loading", owner: null });
    workforce.call("listWorkforceRoster", value ? { query: value, limit: 5 } : { limit: 1 }).then((res) => {
      if (!alive) return;
      if (!res.ok) { setCurrent({ status: res.code === "FORBIDDEN" ? "denied" : "failed", owner: null }); return; }
      const owner = value ? res.result.items.find((i) => i.employeeId === value) ?? null : null;
      setCurrent({ status: "ready", owner: owner ?? (value ? { employeeId: value, displayName: `${value} (not in directory)` } : null) });
    });
    return () => { alive = false; };
    // Read once per mount and per owner change made elsewhere; a pick made here does not need a re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workforce]);

  if (current.status === "loading") {
    return (
      <>
        <input id={id} className="fo-input" type="text" value={value ?? ""} readOnly aria-describedby={describedBy} />
        <p className="fo-muted fo-sales-editform__note">Loading the employee directory…</p>
      </>
    );
  }

  if (current.status !== "ready") {
    return (
      <>
        <input id={id} className="fo-input" type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} />
        <p className="fo-muted fo-sales-editform__note">
          {current.status === "denied"
            ? "You are not authorized to browse the employee directory, so the owner is shown as an employee id. The id can still be changed and saved."
            : "The employee directory could not be read, so the owner is shown as an employee id. The id can still be changed and saved."}
        </p>
      </>
    );
  }

  const search = async (query) => {
    const res = await workforce.call("listWorkforceRoster", { query, limit: 8 });
    return res.ok ? { ok: true, items: res.result.items, total: res.result.total } : { ok: false, code: res.code, message: res.message };
  };
  return (
    <Autocomplete
      id={id}
      label="Owner"
      hideLabel
      placeholder="Type an employee's name"
      search={search}
      selected={current.owner}
      getKey={(e) => e.employeeId}
      getLabel={(e) => e.displayName ?? e.employeeId}
      getContext={(e) => [e.jobRole?.label, e.employeeNumber ? `Employee ${e.employeeNumber}` : null].filter(Boolean).join(" · ")}
      onSelect={(e) => { if (e) { setCurrent({ status: "ready", owner: e }); onChange(e.employeeId); } }}
      inputProps={{ "aria-describedby": describedBy }}
    />
  );
}
