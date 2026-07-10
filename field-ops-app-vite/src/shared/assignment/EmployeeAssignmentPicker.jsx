import { useEffect, useMemo, useState } from "react";
import { useAssignableEmployees } from "../../hooks/useAssignableEmployees";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md, PR 4: EmployeeAssignmentPicker Foundation).
// The reusable Person Assignment Platform Service Standard UI
// primitive (docs/PROJECT_ARCHITECTURE.md) -- every future consumer
// that needs to assign a person to a workflow record uses this
// component, not a manually-entered Firebase UID or a feature-specific
// picker. This component itself has ZERO production consumers as of
// this PR -- the Parts and Purchase Order Assignment Adoption sprint
// (already specified separately) is the first real adopter.
//
// filterEmployeesBySearch() is a pure function -- no React state --
// deliberately separated from the component below so the actual
// filtering logic is directly testable without a React rendering
// environment, same rationale as AuthContext.jsx's
// resolveEmployeeSession() (this repo has no React test
// renderer/jsdom). Case-insensitive substring match against
// displayName only -- the only field this component displays,
// consistent with the Phase 3 schema (no department/job title to
// search against).
export function filterEmployeesBySearch(employees, searchText) {
  const trimmed = searchText.trim().toLowerCase();
  if (!trimmed) return employees;
  return employees.filter((employee) => (employee.displayName ?? "").toLowerCase().includes(trimmed));
}

// Props:
//   requiredOperationalRole -- passed straight through to
//     useAssignableEmployees(); an Employee only appears as selectable
//     when their operationalRoles array-contains this value.
//   requireLinkedUser -- passed straight through; defaults to true
//     (matching the hook's own default) since every real assignment
//     consumer needs a linked users/{uid} to eventually restrict a
//     later write to (see e.g. reorder_requests' assignedToUserId
//     pattern) -- an Employee with no linked User can't be that target.
//   selectedEmployeeId -- controlled selection, by employeeId.
//   onSelect({ employeeId, userId, displayName, operationalRoles }) --
//     exactly this shape, no department/companyId/job-title field,
//     matching the Phase 3 schema this component is built against.
//   disabled, label, placeholder -- standard form-field ergonomics.
export default function EmployeeAssignmentPicker({
  requiredOperationalRole,
  requireLinkedUser = true,
  selectedEmployeeId,
  onSelect,
  disabled = false,
  label,
  placeholder = "Search by name...",
}) {
  const { employees, loading, error } = useAssignableEmployees({ requiredOperationalRole, requireLinkedUser });
  const [searchText, setSearchText] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.employeeId === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );

  // Reflects the current selection's name in the input when not
  // actively searching -- resets to blank if the selection is cleared
  // or resolves to nothing (e.g. still loading, or no longer eligible).
  useEffect(() => {
    if (!isFocused) {
      setSearchText(selectedEmployee?.displayName ?? "");
    }
  }, [selectedEmployee, isFocused]);

  const results = useMemo(() => filterEmployeesBySearch(employees, isFocused ? searchText : ""), [employees, searchText, isFocused]);

  function handleSelect(employee) {
    setSearchText(employee.displayName);
    setIsFocused(false);
    onSelect?.({
      employeeId: employee.employeeId,
      userId: employee.userId,
      displayName: employee.displayName,
      operationalRoles: employee.operationalRoles,
    });
  }

  return (
    <div className="fo-employee-picker">
      {label && <label htmlFor="employee-assignment-picker-input">{label}</label>}
      <input
        id="employee-assignment-picker-input"
        type="text"
        placeholder={placeholder}
        value={searchText}
        disabled={disabled}
        onChange={(e) => setSearchText(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        aria-label={label ?? placeholder}
        autoComplete="off"
      />
      {isFocused && (
        <div className="fo-employee-picker-results">
          {loading ? (
            <div className="fo-muted fo-employee-picker-status">Loading...</div>
          ) : error ? (
            <div className="fo-muted fo-employee-picker-status">Unable to load employees.</div>
          ) : results.length === 0 ? (
            <div className="fo-muted fo-employee-picker-status">
              {employees.length === 0 ? "No eligible employees found." : "No matches."}
            </div>
          ) : (
            results.map((employee) => (
              <button
                type="button"
                key={employee.employeeId}
                className="fo-employee-picker-result"
                onClick={() => handleSelect(employee)}
              >
                <span>{employee.displayName}</span>
                {employee.operationalRoles?.length > 0 && (
                  <span className="fo-muted"> -- {employee.operationalRoles.join(", ")}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
