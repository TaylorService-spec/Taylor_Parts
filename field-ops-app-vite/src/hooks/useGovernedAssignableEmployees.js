// Assignable owners from the GOVERNED EOS Employee directory (UI corrections integration gate, 2026-10-08) -- the
// replacement for the Firestore `useAssignableEmployees` source behind the Account owner picker. Same result shape
// ({ employees, loading, error, securityRoleWarningCount }) so EmployeeAssignmentPicker renders it unchanged.
//
// Offered: Employees the server lets the caller read (employee.record.read + operating-company reach, EMP-RT-01 listEmployees)
// whose employment status may own an Account -- ACTIVE or CONTRACTOR (DQ-007). The OFFER only: the CRM command re-validates the
// chosen Employee as an eligible owner of this tenant and refuses anything else.
import { useMemo } from "react";
import { useGovernedEmployeeDirectory } from "./useGovernedEmployeeDirectory.js";

export const ACCOUNT_OWNER_ELIGIBLE_STATUSES = Object.freeze(["ACTIVE", "CONTRACTOR"]);

export function useGovernedAssignableEmployees(options = {}) {
  const directory = useGovernedEmployeeDirectory(options);
  const employees = useMemo(() => [...(directory.byEmployeeId ?? new Map()).values()]
    .filter((e) => ACCOUNT_OWNER_ELIGIBLE_STATUSES.includes(e.employmentStatus))
    .map((e) => Object.freeze({ employeeId: e.employeeId, displayName: e.displayName ?? e.employeeId, userId: null, operationalRoles: [] }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [directory.byEmployeeId]);
  return { employees, loading: directory.loading, error: directory.error ? (directory.error.code ?? "unavailable") : null, securityRoleWarningCount: 0 };
}
