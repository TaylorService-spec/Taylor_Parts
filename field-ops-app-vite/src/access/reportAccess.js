// Issue #325 / ADR-007 W1 -- the capabilities the Report Builder nav item declares it needs.
//
// These four wave-1 object-read capabilities are the ones D-226 registered active; the governed
// Owner Role holds them (governedBusinessRoles.ts) via a RoleAssignment, resolved server-side by
// the trusted effective-permission engine. The nav item lists them as its `capabilityAccess`
// (navConfig.js) so that WHEN a trusted client feed of the session's effective access exists, the
// item can be shown to a principal who actually holds one.
//
// There is deliberately NO client resolver here. An earlier W1 revision resolved these directly
// from the session's raw `role` string (treating the governed `owner` Role as a compatibility
// role) -- that collapses the governance boundary and is removed. A raw role must never confer a
// governed capability; governed access lives only in RoleAssignments. The client now learns its
// decisions ONLY from the trusted effective-access feed (useReportCapabilities.js ->
// resolveEffectiveAccess callable), which resolves those RoleAssignments server-side and returns
// ALLOW/DENY; the capabilityAccess gate consults that via operationalContext.hasCapability.
//
// Listed here (not derived from permissionCatalog.ts, which is TypeScript this node-tested access
// layer cannot import) and kept in step with Spec §5's wave-1 object rows.
export const REPORT_WAVE1_OBJECT_READ_CAPABILITIES = Object.freeze([
  "report.customer.read",
  "report.contact.read",
  "report.location.read",
  "report.equipment.read",
]);

// Issue #325 W-SAVE -- the five per-action saved-definition capabilities the trusted saved-
// definition service (functions/src/reporting/savedDefinitionCommands.ts) enforces. The Saved
// Reports UI requests these from the same trusted feed and gates each action (create / read+list /
// rename / duplicate / delete) on its decision; the service ALSO re-checks each server-side, so
// the client gate is convenience/UX, never the authority. Mirrors permissionCatalog.ts's
// report.definition.* ids (all active).
export const REPORT_DEFINITION_CAPABILITIES = Object.freeze({
  create: "report.definition.create",
  read: "report.definition.read",
  rename: "report.definition.rename",
  duplicate: "report.definition.duplicate",
  delete: "report.definition.delete",
});

export const REPORT_DEFINITION_CAPABILITY_IDS = Object.freeze(Object.values(REPORT_DEFINITION_CAPABILITIES));
