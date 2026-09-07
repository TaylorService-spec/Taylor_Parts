// THE ROLES AN ADMINISTRATOR MAY OFFER on Administration > Users > (person) > Assign a Role.
//
// A USABILITY FILTER, NEVER THE BOUNDARY. The boundary is functions/src/access/
// trustedWriterCommands.ts: `assignApprovedRole` resolves the submitted roleId against its own
// hand-enumerated GOVERNED_ASSIGNABLE_ROLES registry and throws UnknownRoleError for anything
// absent, then throws InvalidStateError for any Role marked `privileged`. Both checks run
// server-side on every call regardless of what this list says. So the failure modes here are
// bounded and neither is a security one: a Role this list omits is merely unofferable from the UI,
// and a Role it names that the server does not allowlist is refused at submit time with an honest
// error. That is why this is derived from the synced catalogs rather than being a second
// hand-maintained copy of the server's registry -- a copy would drift silently, and drift in the
// direction that matters (this list going stale as Roles are added) is exactly what leaves a Role
// "defined, visible in the catalog, and impossible to give anyone."
//
// PRIVILEGED ROLES ARE EXCLUDED, and their absence is not a UI opinion. `owner` and `admin` are
// privileged:true, and assignApprovedRole refuses them outright -- it is the SINGLE-ADMIN path, and
// a privileged grant requires the two-person approval route (grantRole + a distinct approver) that
// Approval Requests on Roles & Permissions exists to serve. Offering them here would render a
// control whose every use fails, which is the defect this whole surface was built to stop
// repeating.
import { COMPATIBILITY_ROLES } from "./compatibilityRoles.ts";
import { GOVERNED_BUSINESS_ROLES } from "./governedBusinessRoles.ts";

/** Compatibility Roles first: they are the ones this business actually runs on today. */
const ORDERED_SOURCES = [COMPATIBILITY_ROLES, GOVERNED_BUSINESS_ROLES];

/**
 * `{ id, name, privileged }` for every Role an administrator may offer, compatibility Roles first
 * and then the governed business Roles, each group in its catalog's declared order.
 */
export const ASSIGNABLE_ROLE_OPTIONS = Object.freeze(
  ORDERED_SOURCES.flatMap((source) =>
    Object.values(source)
      .filter((role) => role && !role.privileged)
      // `name` is the words a person reads; `id` is what the command receives. Falling back to the
      // id keeps a newly declared Role offerable rather than blank, and the fallback is visible
      // (a camelCase id in a list of English names) rather than silently pretty.
      .map((role) => Object.freeze({ id: role.id, name: role.name ?? role.id })),
  ),
);

/** The set of ids this surface may submit -- the same list, for a membership check. */
export const ASSIGNABLE_ROLE_IDS = Object.freeze(ASSIGNABLE_ROLE_OPTIONS.map((r) => r.id));

/** Words for one role id, for a confirmation that names what is about to happen. */
export function assignableRoleName(roleId) {
  return ASSIGNABLE_ROLE_OPTIONS.find((r) => r.id === roleId)?.name ?? roleId ?? "";
}
