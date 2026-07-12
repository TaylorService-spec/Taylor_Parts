import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { buildAssignableEmployeesQuery } from "../domain/employees";
import { OPERATIONAL_ROLE, ROLES } from "../domain/constants";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md). onSnapshot()-based, not a one-shot read --
// required by this project's established standard (see
// hooks/useFirestoreCollection.js's header comment: a one-shot read
// caused a real, already-fixed bug in the Reorder Request notification
// system, PRs #73/#74).
//
// No companyId parameter -- per architecture review, a tenancy/
// security-relevant filter must be fully implemented and enforced by
// queries and firestore.rules, or be entirely absent. companyId stays
// off every Phase 3 signature (query service, this hook,
// EmployeeAssignmentPicker, provisionEmployeeAccess.js) until Company
// exists as an implemented, rules-enforced entity.
//
// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md) -- securityRole eligibility filter, scoped
// specifically to PARTS_ASSOCIATE eligibility (a technician-role
// employee should never be selectable as a Parts Associate; this is a
// PARTS_ASSOCIATE-specific business rule, not a picker-wide one -- a
// future consumer requesting a different requiredOperationalRole is
// unaffected). Client-side only, post-backfill (the backfill's zero-
// drift verification is this filter's own precondition, per that
// Specification -- durable evidence (initial read-only audit,
// authorized repair, post-repair zero-drift verification) is currently
// recorded as a comment on PR #164, not yet in docs/DECISIONS.md;
// see that PR's comment thread): excludes any candidate whose employees.securityRole is
// ROLES.TECHNICIAN, AND separately excludes -- as a distinct,
// admin-surfaced data-quality gap, never silently folded into "not
// eligible" -- any candidate whose securityRole is missing, null, or
// not one of the valid ROLES enum values. Never claims to detect a
// valid-but-drifted mirror; that's exclusively
// functions/scripts/auditSecurityRoleMirror.js's job.
const VALID_SECURITY_ROLES = new Set(Object.values(ROLES));

// Pure -- no React state, directly testable without a rendering
// environment (same rationale as EmployeeAssignmentPicker.jsx's
// filterEmployeesBySearch(), this repo's established pattern for logic
// that would otherwise only be exercisable via a full browser
// verification pass). Returns the eligible subset plus a count of
// candidates excluded specifically for missing/null/invalid-enum
// securityRole (the data-quality warning case, distinct from an
// ordinary, correctly-recorded technician exclusion).
export function applyPartsAssociateSecurityRoleEligibility(employees) {
  let securityRoleWarningCount = 0;
  const eligible = employees.filter((employee) => {
    const role = employee.securityRole;
    if (role == null || !VALID_SECURITY_ROLES.has(role)) {
      securityRoleWarningCount += 1;
      return false;
    }
    return role !== ROLES.TECHNICIAN;
  });
  return { employees: eligible, securityRoleWarningCount };
}

export function useAssignableEmployees({ requiredOperationalRole, requireLinkedUser = true, enabled = true } = {}) {
  const [state, setState] = useState({ employees: [], loading: enabled, error: null, securityRoleWarningCount: 0 });

  useEffect(() => {
    if (!enabled) {
      setState({ employees: [], loading: false, error: null, securityRoleWarningCount: 0 });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    const q = buildAssignableEmployeesQuery({ requiredOperationalRole, requireLinkedUser });
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (requiredOperationalRole !== OPERATIONAL_ROLE.PARTS_ASSOCIATE) {
          setState({ employees: all, loading: false, error: null, securityRoleWarningCount: 0 });
          return;
        }

        const { employees, securityRoleWarningCount } = applyPartsAssociateSecurityRoleEligibility(all);
        setState({ employees, loading: false, error: null, securityRoleWarningCount });
      },
      (error) => setState({ employees: [], loading: false, error, securityRoleWarningCount: 0 })
    );

    return unsubscribe;
  }, [requiredOperationalRole, requireLinkedUser, enabled]);

  return {
    employees: state.employees,
    loading: state.loading,
    error: state.error ?? null,
    securityRoleWarningCount: state.securityRoleWarningCount ?? 0,
  };
}
