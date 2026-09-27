// WHERE TO CHANGE A WORKFLOW RESPONSIBILITY -- pure navigation, never authority.
//
// listPrincipalWorkflowResponsibilities names, per entry, the governed rows that produced it (`adminLocations`):
//
//   SECURITY_ROLE_ASSIGNMENT     the Employee's Security Role assignment (global or scoped)  -> Employee > Security Roles,
//                                                                                              Security Role detail
//   FUNCTIONAL_ROLE_ASSIGNMENT   the Employee's Functional Role (held, or required and missing) -> Employee > Functional
//                                                                                              Roles, the catalog
//   WORKFLOW_BINDING             the binding in the ACTIVE version                            -> Workflows (new draft
//                                                                                              version, publish, activate)
//   ROLE_CAPABILITY_GRANT        the Role x capability grant (+ condition)                   -> Object Security, Security
//                                                                                              Role detail
//
// There is NO per-Employee workflow grant, so no link here ever points at one. Every href is an Administration screen
// that already governs the fact; the deep-link query (?role=, ?object=, ?workflow=&version=, ?functionalRole=) only
// pre-selects what that screen shows.

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === "string" && v !== "")).toString();
  return s ? `?${s}` : "";
};

export const ADMIN_LOCATION_KIND_WORDS = Object.freeze({
  SECURITY_ROLE_ASSIGNMENT: "Security Role assignment",
  FUNCTIONAL_ROLE_ASSIGNMENT: "Functional Role assignment",
  WORKFLOW_BINDING: "Workflow binding",
  ROLE_CAPABILITY_GRANT: "Role capability grant",
});

/** The links for ONE admin location: [{ label, href }]. Unknown kinds yield nothing (never a guessed destination). */
export function adminLocationLinks(location, { employeeId = null } = {}) {
  if (!location || typeof location !== "object") return [];
  const employeePage = employeeId ? `/administration/users/${encodeURIComponent(employeeId)}` : null;
  switch (location.kind) {
    case "SECURITY_ROLE_ASSIGNMENT": {
      const scope = location.scopeType && location.scopeType !== "global" ? ` @ ${location.scopeType}:${location.scopeValue ?? "?"}` : "";
      return [
        ...(employeePage ? [{ label: `Employee › Security Roles (${location.roleKey}${scope})`, href: `${employeePage}#security-roles` }] : []),
        { label: `Security Role ${location.roleKey}`, href: `/administration/roles-permissions${q({ role: location.roleKey })}` },
      ];
    }
    case "FUNCTIONAL_ROLE_ASSIGNMENT":
      return [
        ...(employeePage ? [{ label: `Employee › Functional Roles (${location.held ? "holds" : "assign"} ${location.functionalRoleKey})`,
          href: `${employeePage}#functional-roles` }] : []),
        { label: `Functional Role ${location.functionalRoleKey}`, href: `/administration/users/functional-roles${q({ functionalRole: location.functionalRoleKey })}` },
      ];
    case "WORKFLOW_BINDING":
      return [{
        label: `Workflow ${location.workflowKey} v${location.version} · ${location.actionKey} → ${location.boundKey} (new draft version to change)`,
        href: `/administration/workflows${q({ workflow: location.workflowKey, version: location.versionId })}`,
      }];
    case "ROLE_CAPABILITY_GRANT":
      return [
        { label: `Object Security ${location.objectKey ?? ""} · ${location.capabilityKey}${location.conditioned ? " (conditioned)" : ""}`.replace("  ", " "),
          href: `/administration/objects${q({ object: location.objectKey ?? "" })}` },
        { label: `Security Role ${location.roleKey} grants`, href: `/administration/roles-permissions${q({ role: location.roleKey })}` },
      ];
    default:
      return [];
  }
}

/** Read one deep-link query parameter from the current URL, or null. Never throws (tests, SSR). */
export function readAdminQueryParam(name) {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get(name);
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  } catch {
    return null;
  }
}
