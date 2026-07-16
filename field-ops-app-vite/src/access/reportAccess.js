// Issue #325 / ADR-007 W1 -- the client-side, presentation-only gate for the report builder.
//
// PURE, dependency-free (the previewer is injected, exactly like navPermissionPreview.js) so it
// stays node-testable. NEVER authoritative: nav visibility is a convenience preview, never a
// security boundary. The real gate is the trusted Function (D-FN), which re-resolves the runner's
// live access server-side (Spec §6/§12) -- this only decides whether to SHOW the Reports nav.
//
// The four wave-1 object-read capabilities are the ones D-226 registered active and W1 granted to
// the Owner Role only (governedBusinessRoles.ts). A principal who holds ANY of them can open the
// builder; today that is Owner alone (admin/dispatcher/technician hold none). Listed here (not
// derived from permissionCatalog.ts, which is TypeScript this node-tested module cannot import)
// and kept in step with Spec §5's wave-1 object rows; a drift is caught by the resolver denying an
// id that isn't actually granted.
export const REPORT_WAVE1_OBJECT_READ_CAPABILITIES = Object.freeze([
  "report.customer.read",
  "report.contact.read",
  "report.location.read",
  "report.equipment.read",
]);

// Given a bound previewer (previewHasPermission(permissionId, role) -> boolean, from
// createPermissionPreviewer with a role map that INCLUDES the governed business Roles so `owner`
// resolves), returns true iff `role` effectively holds at least one wave-1 report object-read
// capability. Fail-closed: a non-function previewer or an unknown role yields false.
export function previewHasReportAccess(previewHasPermission, role) {
  if (typeof previewHasPermission !== "function") return false;
  return REPORT_WAVE1_OBJECT_READ_CAPABILITIES.some((cap) => previewHasPermission(cap, role) === true);
}
