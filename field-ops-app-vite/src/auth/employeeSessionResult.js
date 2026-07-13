// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// PR 0). PURE shape-builder -- no Firebase import, so it is directly
// unit-testable in Node, same convention as
// domain/commercialProfile.js's pure validation/identity resolvers.
// Deliberately split out of employeeSession.js (which imports
// firebase/firestore for resolveEmployeeSession()'s actual Firestore
// reads) so this function alone can be imported by this project's
// plain-`node` unit test runner without dragging in the Firebase SDK
// or app initialization as a module-level side effect.
//
// Fail-closed behavior for every linkage state (no employeeId, broken
// link, resolved) lives here alone -- employmentStatus (Issue #100)
// is exposed alongside operationalRoles, defaulting to null exactly
// like every other field when the Employee document doesn't resolve.
export function buildEmployeeSessionResult(role, employeeId, employeeData) {
  if (!employeeId || !employeeData) {
    return { role, employeeId: employeeId ?? null, displayName: null, operationalRoles: [], employmentStatus: null };
  }
  return {
    role,
    employeeId,
    displayName: employeeData.displayName ?? null,
    operationalRoles: employeeData.operationalRoles ?? [],
    employmentStatus: employeeData.employmentStatus ?? null,
  };
}
