// EI Truck Registry -- the REAL driver pick-list source for the management UI. A thin
// wrapper over useAssignableEmployees (a single bounded onSnapshot query of ACTIVE
// employees -- NO N+1, no per-row read), mapped to { value, label } options. Drivers need
// only be ACTIVE employees (requireLinkedUser: false); a driver assignment references
// assignedDriverEmployeeId and NEVER changes inventory custody. `enabled` gates the query
// so nothing is read until management is authorized AND write-ready (never in the current
// fail-closed production posture). Firebase lives here, not in the presentational select,
// so the modal/drawer stay firebase-free and testable via injection.
import { useAssignableEmployees } from "./useAssignableEmployees";

export function useDriverOptions(enabled = false) {
  const { employees, loading, error } = useAssignableEmployees({ requireLinkedUser: false, enabled });
  const options = employees
    .map((e) => ({ value: e.id, label: typeof e.displayName === "string" && e.displayName.trim() !== "" ? e.displayName : e.id }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return { options, loading: Boolean(loading), error: Boolean(error) };
}
