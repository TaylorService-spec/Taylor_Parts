// THE PROTECTED ADMINISTRATOR'S SYSTEM AUTHORITY (Owner ruling 2026-10-09, DECISIONS #223).
//
// The Administrator is the company's system controller. Its authority is resolved HERE, centrally, from its STANDING --
// an active global assignment of the designated protected Administrator Role -- and not from one capability grant per
// key. A newly registered system-administration capability is therefore covered the moment it is registered, with no
// grant. This replaces the earlier principle "holding admin is not a substitute for the capability" FOR THE SYSTEM
// AUTHORITY BELOW ONLY; every other Role still reaches every key through a grant.
//
// ════════════════════ WHAT STANDING IMPLIES -- AND WHAT IT NEVER DOES ════════════════════
//
//   IMPLIED      every ADMIN_ACTION and every READ capability, and every action on a system-administration Object
//                (Security Roles and permissions, Workflow definitions, Principals, Employees, audit, configuration,
//                data import) -- configure, inspect and govern, company-wide.
//   ALSO         the nine approved management actions (PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES, O1 / G2 / G3, #227).
//   NOT IMPLIED  any other BUSINESS_ACTION / CREATE / EDIT on a business Object: business approval, financial execution and
//                operational execution keep their existing authorization (Owner ruling O1). The Administrator keeps
//                whatever it holds through existing grants (O3), and nothing here removes one.
//   NEVER        Work Eligibility, record assignment, an Operational Scope or an Employee link -- standing is not a job
//                assignment (ADMIN_IMPLIES_NO_WORK_ELIGIBILITY). Worker predicates are decided where they always were.
//
// STANDING requires, in the resolved principal context (which already established an authenticated, ENABLED principal,
// an ACTIVE membership, an active tenant and employment access eligibility): a qualifying GLOBAL assignment of THE
// designated Administrator Role -- key `admin` AND the stored protected flag, never a display name -- and NOT holding
// the protected Owner Role. Owner and Administrator are distinct authority types; a principal holding both gets no
// standing (and assignRole refuses to create that combination).
//
// Pure: no store access here. Each resolver supplies the Roles and the capability catalog it already reads.
import type { ActionKind } from "./types";
import { ADMIN_ROLE_KEY, PROTECTED_OWNER_ROLE_KEY } from "./administrationAuthority";

// Re-exported so a consumer outside src/adminPolicy (the Workforce command kernel) needs this ONE pure module only.
export { ADMIN_ROLE_KEY, PROTECTED_OWNER_ROLE_KEY };

/** The provenance every implied capability and every standing-authorized audit event carries. */
export const PROTECTED_ADMINISTRATOR = "PROTECTED_ADMINISTRATOR" as const;

/** The Owner ruling this authority rests on, named on audit events. */
export const PROTECTED_ADMINISTRATOR_RULING = "Owner 2026-10-09 (DECISIONS #223)";

/** Action kinds that are system authority wherever they appear: administering and inspecting. */
export const IMPLIED_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(["ADMIN_ACTION", "READ"]);

/**
 * Objects that ARE system administration: every action on them is implied, whatever its kind (e.g. creating or editing
 * a Workflow definition, editing an Employee record). A business Object is never listed here.
 */
export const SYSTEM_ADMINISTRATION_OBJECTS: ReadonlySet<string> = new Set([
  "rolesPermissions",
  "workflowDefinition",
  "principal",
  "employee",
  "auditLog",
  "dataImport",
  "systemConfiguration",
  "financeConfiguration",
]);

/**
 * Keys standing never implies, whatever their kind. Changing this list is an Owner decision.
 *   reorder.request.read.queue   SUPERSEDED migration evidence; may never be granted again (migration 1761696000000).
 *   salesAgreement.tradeIn.approve  Owner / General Manager business approval, kept pending explicit review (D4). It is
 *                                a BUSINESS_ACTION and so not implied anyway; listed so the rule cannot drift.
 */
export const PROTECTED_ADMINISTRATOR_EXCLUSIONS: ReadonlySet<string> = new Set([
  "reorder.request.read.queue",
  "salesAgreement.tradeIn.approve",
]);

/**
 * THE APPROVED MANAGEMENT ACTIONS (Owner O1 business-action ruling, 2026-10-09; G2, G3; DECISIONS #227 / PR-4b): business
 * keys standing implies although they are not ADMIN_ACTION / READ. Exactly these nine -- the O1 "ADMIN" class. Each is a
 * management exception, never operational execution, and each keeps every other check its command makes:
 *   equipment.record.manage        the Equipment register
 *   rental.fleet.manage            the Rental fleet
 *   reorder.request.approve / .reject / .cancel / .assign
 *                                  Reorder review and coordination, within the company queues standing reaches (#224)
 *   reorder.purchaseOrder.void     G3: management void -- ORDERED only, a stated reason, a single void, the PO's own
 *                                  company queue, audited (the repository's rules, unchanged)
 *   inventory.receipt.correct      G2: the receipt VOID / reversal only -- reach admits it at the correction call site for
 *                                  VOID alone; CORRECTED re-receives through inventory.stock.receive, never implied, and
 *                                  the cost-evidence supply path does not opt into reach
 *   ownership.handoff.correct      administrative ownership-handoff sources, in addition to the record's edit authority
 * NEVER here: the O1 WORKER keys (eosOps ADMINISTRATOR_EXECUTION_CAPABILITIES -- pinned disjoint by test) and
 * every O1 KEEP key (business approval and financial execution keep their existing grants).
 */
export const PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES: ReadonlySet<string> = new Set([
  "equipment.record.manage",
  "rental.fleet.manage",
  "reorder.request.approve",
  "reorder.request.reject",
  "reorder.request.cancel",
  "reorder.request.assign",
  "reorder.purchaseOrder.void",
  "inventory.receipt.correct",
  "ownership.handoff.correct",
]);

for (const key of PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES) {
  if (PROTECTED_ADMINISTRATOR_EXCLUSIONS.has(key)) throw new Error(`protectedAdministrator: ${key} is both implied and excluded`);
}

export interface CapabilityMetadata {
  readonly key: string;
  readonly objectKey: string | null;
  readonly actionKind: string | null;
}

/** Is this registered capability system authority that standing implies? */
export function isImpliedForProtectedAdministrator(capability: CapabilityMetadata): boolean {
  if (PROTECTED_ADMINISTRATOR_EXCLUSIONS.has(capability.key)) return false;
  if (PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES.has(capability.key)) return true;
  if (capability.objectKey !== null && SYSTEM_ADMINISTRATION_OBJECTS.has(capability.objectKey)) return true;
  return capability.actionKind !== null && IMPLIED_ACTION_KINDS.has(capability.actionKind as ActionKind);
}

export interface RoleFlag {
  readonly key: string;
  readonly protected?: boolean | null;
}

/**
 * Standing from the QUALIFYING GLOBAL Role keys the principal context resolved and the tenant's Role records. Fails
 * closed: an unknown Role, an unprotected `admin` (a tenant cannot create one, but a damaged row must not confer
 * anything) or a protected Owner held alongside means no standing.
 */
export function hasProtectedAdministratorStanding(roles: readonly RoleFlag[], heldRoleKeys: readonly string[]): boolean {
  if (!heldRoleKeys.includes(ADMIN_ROLE_KEY)) return false;
  const admin = roles.find((r) => r.key === ADMIN_ROLE_KEY);
  if (!admin || admin.protected !== true) return false;
  // Holding the Owner key at all means no standing -- even if that Role row were damaged (fail closed, never open).
  if (heldRoleKeys.includes(PROTECTED_OWNER_ROLE_KEY)) return false;
  return true;
}

/** The capability keys standing implies, from the registered catalog. Empty without standing. */
export function protectedAdministratorImpliedKeys(
  roles: readonly RoleFlag[],
  heldRoleKeys: readonly string[],
  catalog: readonly CapabilityMetadata[],
): ReadonlySet<string> {
  if (!hasProtectedAdministratorStanding(roles, heldRoleKeys)) return new Set();
  return new Set(catalog.filter(isImpliedForProtectedAdministrator).map((c) => c.key));
}

/** The audit marker for a write made by an actor with standing. Merged into the event's `after`. */
export const PROTECTED_ADMINISTRATOR_AUTHORITY = Object.freeze({
  standing: PROTECTED_ADMINISTRATOR,
  ruling: PROTECTED_ADMINISTRATOR_RULING,
});

/**
 * The audit-input field naming the actor's authority, for an actor with standing; nothing otherwise. The store merges
 * it into the event's `after` as `authorizedBy` (never overwriting a more specific one, e.g. the R1 staffing record).
 */
export function actorAuthorityOf(actor: { readonly protectedAdministrator?: boolean } | null | undefined):
  { readonly actorAuthority?: typeof PROTECTED_ADMINISTRATOR_AUTHORITY } {
  return actor?.protectedAdministrator === true ? { actorAuthority: PROTECTED_ADMINISTRATOR_AUTHORITY } : {};
}

/** The stored `after`: the payload, with the actor's authority attached when the payload is a record. */
export function afterWithActorAuthority(after: unknown, actorAuthority: unknown): unknown {
  if (!actorAuthority || after === null || typeof after !== "object" || Array.isArray(after)) return after;
  if ("authorizedBy" in (after as Record<string, unknown>)) return after;
  return { ...(after as Record<string, unknown>), authorizedBy: actorAuthority };
}
