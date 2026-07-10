import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);

  // Stable, instance-unique IDs -- required for correct combobox ARIA
  // wiring (aria-controls/aria-activedescendant/label association) if
  // more than one EmployeeAssignmentPicker is ever rendered on the
  // same page (a real possibility once a workflow adopts this
  // component -- e.g. an assignor picker next to an assignee picker).
  // A single hard-coded id would collide across instances.
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (employeeId) => `${baseId}-option-${employeeId}`;

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.employeeId === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId]
  );

  // Reflects the current selection's name in the input when the
  // dropdown is closed -- resets to blank if the selection is cleared
  // or resolves to nothing (e.g. still loading, or no longer eligible).
  useEffect(() => {
    if (!isOpen) {
      setSearchText(selectedEmployee?.displayName ?? "");
    }
  }, [selectedEmployee, isOpen]);

  const results = useMemo(() => filterEmployeesBySearch(employees, isOpen ? searchText : ""), [employees, searchText, isOpen]);

  // Keeps the keyboard-highlighted index in bounds whenever the result
  // set itself changes shape (typing narrows/widens it) -- without
  // this, an index valid against the previous, longer list could point
  // past the end of a newly-shortened one.
  useEffect(() => {
    setHighlightedIndex((i) => (i >= results.length ? results.length - 1 : i));
  }, [results.length]);

  function closeAndResetSearch() {
    setIsOpen(false);
    setHighlightedIndex(-1);
    setSearchText(selectedEmployee?.displayName ?? "");
  }

  function handleSelect(employee) {
    setSearchText(employee.displayName);
    setIsOpen(false);
    setHighlightedIndex(-1);
    onSelect?.({
      employeeId: employee.employeeId,
      userId: employee.userId,
      displayName: employee.displayName,
      operationalRoles: employee.operationalRoles,
    });
  }

  function handleSearchChange(e) {
    setSearchText(e.target.value);
    setHighlightedIndex(-1);
    if (!isOpen) setIsOpen(true);
  }

  // No setTimeout-based blur handling -- deterministic instead.
  // Clicking a result never actually blurs the input in the first
  // place: each option's onMouseDown calls preventDefault(), which
  // stops the browser's default "move focus to the button" behavior,
  // so the input stays focused and this handler never fires for that
  // interaction; the option's onClick still fires normally afterward
  // and calls handleSelect(), which closes the dropdown explicitly. A
  // genuine blur (tabbing away, clicking something outside the
  // picker entirely) is distinguished from a click that lands
  // elsewhere WITHIN the picker (there is currently no such target,
  // but the check is here for correctness/future-proofing) via
  // relatedTarget -- if the newly-focused element is still inside
  // this component's container, the dropdown stays open.
  function handleBlur(e) {
    if (containerRef.current && e.relatedTarget && containerRef.current.contains(e.relatedTarget)) {
      return;
    }
    closeAndResetSearch();
  }

  function handleKeyDown(e) {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
      if (results.length === 0) {
        setHighlightedIndex(-1);
        return;
      }
      // No current highlight (picker was just opened, or nothing was
      // highlighted yet) -> land on the first result. Otherwise
      // advance by one, clamped at the last result.
      setHighlightedIndex((i) => (i === -1 ? 0 : Math.min(i + 1, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
      if (results.length === 0) {
        setHighlightedIndex(-1);
        return;
      }
      // No current highlight -> land on the LAST result (standard
      // combobox convention: ArrowUp from nothing wraps to the end of
      // the list, symmetric with ArrowDown landing on the first).
      // Otherwise move back by one, clamped at the first result.
      setHighlightedIndex((i) => (i === -1 ? results.length - 1 : Math.max(i - 1, 0)));
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
        e.preventDefault();
        handleSelect(results[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        closeAndResetSearch();
      }
    }
  }

  const activeDescendant = isOpen && highlightedIndex >= 0 && results[highlightedIndex] ? optionId(results[highlightedIndex].employeeId) : undefined;

  return (
    <div className="fo-employee-picker" ref={containerRef}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        placeholder={placeholder}
        value={searchText}
        disabled={disabled}
        onChange={handleSearchChange}
        onFocus={() => setIsOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        aria-label={label ?? placeholder}
        autoComplete="off"
      />
      {isOpen && (
        <div id={listboxId} role="listbox" className="fo-employee-picker-results">
          {loading ? (
            <div className="fo-muted fo-employee-picker-status" role="status">
              Loading...
            </div>
          ) : error ? (
            <div className="fo-muted fo-employee-picker-status" role="status">
              Unable to load employees.
            </div>
          ) : results.length === 0 ? (
            <div className="fo-muted fo-employee-picker-status" role="status">
              {employees.length === 0 ? "No eligible employees found." : "No matches."}
            </div>
          ) : (
            results.map((employee, index) => (
              <button
                type="button"
                key={employee.employeeId}
                id={optionId(employee.employeeId)}
                role="option"
                aria-selected={employee.employeeId === selectedEmployeeId}
                className={`fo-employee-picker-result${index === highlightedIndex ? " fo-employee-picker-result-highlighted" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
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
