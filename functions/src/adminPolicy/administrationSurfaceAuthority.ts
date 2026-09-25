// MAY THIS PRINCIPAL *READ* THIS ADMINISTRATION SURFACE?
//
// ════════════════════ THE QUESTION NOTHING COULD ANSWER ════════════════════
//
// Administration had writes and no reads. `eos_policy.capabilities` carried
// `admin.roleAssignment.write`, `admin.accessRequest.decide`, `admin.userStatus.write` and six more
// ADMIN_ACTIONs, and NOTHING that meant "may look at the policy model". So a navigation cutover
// asking "may this person open Roles & Permissions?" had only bad answers available:
//
//     users/{uid}.role === "admin" || "dispatcher"   the legacy default, which is the Firebase-era
//                                                    identity this platform is moving off, and which
//                                                    is what PLACEHOLDER_DEFAULT_ROLES still does
//     hasCapability("admin.roleAssignment.write")    a WRITE used as a READ gate, which makes a
//                                                    reader and a writer the same principal
//     hasCapability("administration.read")           a blanket super-capability naming no Object
//
// This module is the third option's opposite: every surface names the OBJECT it exposes, and the
// answer is the Object's own READ capability. Nothing here reads `users/{uid}.role`, nothing here
// reads Firestore, and nothing here treats a Role KEY as authority.
//
// ════════════════════ WHAT THIS IS NOT ════════════════════
//
// NOT THE ENFORCEMENT POINT, because it is a PURE FUNCTION OVER A CAPABILITY SET: it reads no
// database, resolves no principal and refuses no request. It is the CANONICAL MAP -- surface to the
// Object READ that governs it -- and two callers now resolve against it:
//
//     PRESENTATION   navigation and routing, from the capability set the client already holds
//     THE SERVER     adminPolicyApi.ts's read gate, which maps each of the thirteen Administration
//                    read operations to the SURFACE it serves and takes the key from the table
//                    below, then resolves the caller's effective capabilities from PostgreSQL
//                    (role_capabilities UNION principal_capabilities) and refuses without it
//
// THAT SECOND CALLER IS NEW, and it overturns what this header used to record. The dispatcher's old
// posture -- "reads are open to any principal with a context in the tenant... the sensitive act is
// CHANGING it" -- was a decision taken when nothing governed Administration at all. Once navigation
// became capability-governed it stopped being a posture and became a hole: the capability model
// decided what a browser DREW while every authenticated principal in the tenant could still fetch
// the same policy configuration over one POST. It is closed. A principal who legitimately reads the
// policy store does so because an administrator GRANTED them the read, which is a decision that can
// be seen and withdrawn -- not because they managed to log in.
//
// ONE MODEL, ONE TABLE. A surface and the operations behind it can no longer answer differently,
// because they are the same row.
//
// NOT A GRANT. Every key below is registered in eos_policy.capabilities by migration. This file
// maps surfaces to keys; it creates no capability and confers nothing.
import { WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION } from "./administrationAuthority";

/**
 * The Administration destinations, keyed exactly as field-ops-app-vite/src/navigation/navConfig.js
 * keys them, so a nav item and its authority can never drift into two spellings of one name.
 *
 * The list is the GOVERNED-CONFIGURATION half of the Administration domain -- the surfaces that
 * expose the access model itself. Administration also carries operational configuration
 * destinations (Warehouse Racking, Financial Policy, Data Import, Email & Communications, Duplicate
 * Rules, Integrations) which are governed by their OWN Objects and are not this module's subject:
 * three of them already declare `capabilityAccess` of their own, and inventing a second authority
 * for them here would be exactly the duplication this subsystem exists to end.
 */
export const ADMINISTRATION_SURFACES = Object.freeze([
  "overview",
  "objects",
  "rolesPermissions",
  "users",
  "workflows",
  "permissionPreview",
  "auditLogs",
] as const);

export type AdministrationSurface = (typeof ADMINISTRATION_SURFACES)[number];

/**
 * The canonical READ capability each surface requires, or `null` for a surface that reads nothing.
 *
 * ════════════════════ HOW EACH ROW WAS DECIDED ════════════════════
 *
 *   objects            listObjects / readObjectWithFields / listObjectsWithActions /
 *                      getObjectSecurityMatrix  ->  the Object -> action -> grantee projection
 *   rolesPermissions   listRoles / readRolePolicy / getRoleSecurity
 *                      ->  the Role -> object -> action projection of the SAME rows
 *
 * ONE KEY FOR BOTH, because they are one authority seen from two sides -- see
 * objectSecurityAuthority.ts's own header, and the Administration catalog, which projects exactly
 * one Object (`rolesPermissions`) for the security model. A second key would be two names for one
 * thing.
 *
 *   users              listTenantPrincipals / listPrincipalRoleAssignments /
 *                      getPrincipalEffectiveAccess  ->  the `principal` Object's own read, which
 *                      already existed and is granted to exactly admin and owner
 *   permissionPreview  the same effective-access read. The SURFACE is unbuilt (it renders
 *                      AdministrationUnavailable), and this line switches no data source: it records
 *                      which authority the built surface will need, so that when it is built it is
 *                      not gated on a write.
 *   workflows          listWorkflows / readWorkflowVersion  ->  `workflowDefinition.read`, which
 *                      already existed. It was held by NO Role for four migrations, by standing
 *                      decision -- the Workflow Definition decisions are the Owner's -- and this
 *                      surface was correctly gated and readable by nobody, a fail-closed state that
 *                      was REPORTED rather than papered over by pointing it at a key somebody
 *                      happened to hold. The Owner then took that one decision and migration
 *                      1762128000000 granted the READ to admin and owner, and only the read: the
 *                      five workflowDefinition MUTATIONS remain at zero holders.
 *   auditLogs          readPolicyAuditHistory  ->  `audit.event.read`, which already existed.
 *   overview           NOTHING. AdministrationOverview.jsx renders four static links and the
 *                      deployment manifest; it reads no governed data. See mayReadAdministration-
 *                      Surface for how it is answered instead.
 */
export const ADMINISTRATION_SURFACE_READ_CAPABILITY:
  Readonly<Record<AdministrationSurface, string | null>> = Object.freeze({
    overview: null,
    objects: "admin.securityPolicy.read",
    rolesPermissions: "admin.securityPolicy.read",
    users: "admin.principalAccess.read",
    workflows: WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.read,
    permissionPreview: "admin.principalAccess.read",
    auditLogs: "audit.event.read",
  });

/** Every distinct READ key this module can require. Sorted, so a diff of it reads as a diff. */
export const ADMINISTRATION_READ_CAPABILITY_KEYS: readonly string[] = Object.freeze(
  [...new Set(Object.values(ADMINISTRATION_SURFACE_READ_CAPABILITY).filter(
    (k): k is string => typeof k === "string",
  ))].sort(),
);

/**
 * The Administration WRITE authorities, listed so the separation can be PROVEN rather than asserted.
 *
 * No entry here may ever appear in ADMINISTRATION_READ_CAPABILITY_KEYS, and holding a read must
 * never produce one. That is not a property of this array -- it is a property of
 * `role_capabilities`, which stores flat keys with no implication between them -- but naming the
 * writes makes the property testable in one place instead of nowhere.
 */
export const ADMINISTRATION_WRITE_CAPABILITY_KEYS: readonly string[] = Object.freeze([
  "admin.accessRequest.decide",
  "admin.credentialReset.initiate",
  "admin.dataImport.execute",
  "admin.employeeJobRole.write",
  "admin.employeeOperationalScope.write",
  "admin.employeeProfile.write",
  "admin.employeeWorkEligibility.write",
  "admin.roleAssignment.write",
  "admin.userStatus.write",
  WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.bindRole,
  WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.create,
  WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.edit,
  WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.publish,
  WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.version,
]);

export const isAdministrationSurface = (value: unknown): value is AdministrationSurface =>
  typeof value === "string" && (ADMINISTRATION_SURFACES as readonly string[]).includes(value);

const heldSet = (capabilities: ReadonlySet<string> | readonly string[] | null | undefined)
  : ReadonlySet<string> => {
  if (capabilities instanceof Set) return capabilities;
  if (Array.isArray(capabilities)) return new Set(capabilities);
  return new Set<string>();
};

/**
 * May a principal holding exactly these effective capabilities READ this Administration surface?
 *
 * `capabilities` is the EFFECTIVE key set -- resolved through Principal -> membership -> active Role
 * assignments -> role_capabilities (+ direct Principal grants), by capabilitiesForRoleKeys or
 * effectiveCapabilities. Never Role keys, never a claim from a caller.
 *
 * FAILS CLOSED in every uncertain case: an unknown surface, a null capability set, an empty set. An
 * unknown surface is `false` rather than a throw because the caller asking about it is a routing
 * layer, and a router that crashes on an unrecognised path is worse than one that refuses it.
 *
 * THE OVERVIEW IS A DISJUNCTION, NOT A GRANT. It reads nothing, so there is nothing to protect on it
 * and nothing to name a capability after; what it does is list the other surfaces. A principal who
 * may read at least ONE of them may see the page that links to them, and a principal who may read
 * none of them has no reason to be on it. Deriving it means the Overview can never be held by
 * somebody who can open nothing -- which is precisely what a blanket `administration.read` would
 * have made possible.
 */
export function mayReadAdministrationSurface(
  capabilities: ReadonlySet<string> | readonly string[] | null | undefined,
  surface: string,
): boolean {
  if (!isAdministrationSurface(surface)) return false;
  const held = heldSet(capabilities);
  if (held.size === 0) return false;
  if (surface === "overview") {
    return ADMINISTRATION_SURFACES.some(
      (s) => s !== "overview" && mayReadAdministrationSurface(held, s),
    );
  }
  const required = ADMINISTRATION_SURFACE_READ_CAPABILITY[surface];
  return typeof required === "string" && held.has(required);
}

/** Every Administration surface this capability set may read, in declared order. */
export function administrationSurfacesReadableBy(
  capabilities: ReadonlySet<string> | readonly string[] | null | undefined,
): readonly AdministrationSurface[] {
  const held = heldSet(capabilities);
  return Object.freeze(ADMINISTRATION_SURFACES.filter((s) => mayReadAdministrationSurface(held, s)));
}

/**
 * Whether the Administration DOMAIN itself is reachable -- the same disjunction the Overview uses.
 *
 * Separate function, same rule, because the two questions are asked by different callers: a nav rail
 * asks about the domain, a route asks about the surface, and collapsing them would make one of the
 * two answer the wrong question the day they diverge.
 */
export const mayReachAdministration = (
  capabilities: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean => mayReadAdministrationSurface(capabilities, "overview");
