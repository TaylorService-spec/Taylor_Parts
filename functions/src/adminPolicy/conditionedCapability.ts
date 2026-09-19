// Authorization v2 parity, part A: the CONDITIONED CAPABILITY decision.
//
// Pure: no database, no Firebase, no I/O. It answers one question the flat capability Set cannot:
//
//   the principal HOLDS this capability -- but is it conditioned on the Roles they hold, and is the condition
//   satisfied for THIS governed record?
//
// ════════════════════ WHY THE FLAT SET IS NOT ENOUGH ════════════════════
//
// `capabilityAuthority.resolveOperationalContext` returns capability KEYS held via qualifying Role assignments. It
// carries no conditions, so a capability the catalog conditions is indistinguishable from one it does not. For
// `reorder.purchaseOrder.void` that difference is the whole gate: `firestore.rules` requires
// `isAdminOrDispatcher() AND request.auth.uid == resource.data.assignedToUserId`, so even an Administrator must be
// the request's own recorded assignee. Migrating that grant on the strength of the flat Set alone would hand every
// Administrator and Dispatcher UNCONDITIONAL Void -- the widening the migration-only assignment census refuses.
//
// ════════════════════ ONLY isOwnAssignment IS IMPLEMENTED, DELIBERATELY ════════════════════
//
// The accepted ConditionKind dispositions rule that it is the ONLY Kind requiring PostgreSQL evaluator parity:
//
//   isOwnAssignment         STILL_REQUIRED              implemented here
//   operationalRoleActive   BUSINESS_ELIGIBILITY_SCOPE  answered by Work Eligibility + Operational Scope, never here
//   employmentActive        MOVED                       answered by the governed PostgreSQL employment status
//   statusEquals/statusIn   DEAD                        carried by nothing
//
// So this is NOT a condition language. Every other Kind -- including one added to the union later -- is UNSUPPORTED
// and refuses. Fail-closed is the only safe default: a Kind this evaluator does not understand is a gate it cannot
// prove, and an unprovable gate must never open.
//
// ════════════════════ NOTHING HERE IS CALLER-SUPPLIED ════════════════════
//
// The actor and the target's assignee are both GOVERNED ids the caller resolves server-side from the authoritative
// record. This module accepts no request body, no claims, no uid, no tenant selector and no precomputed condition
// verdict -- there is no input shaped like one. The comparison is EOS Principal id to EOS Principal id: a Firebase
// uid is not a Principal id and can never satisfy the predicate by resembling one.
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles";
import type { Condition, ConditionKind, Role } from "../types/access";

/** The Kinds this evaluator can prove. Exactly one, by accepted ruling. */
export const SUPPORTED_CONDITION_KINDS = Object.freeze(["isOwnAssignment"] as const satisfies readonly ConditionKind[]);

export type ConditionedCapabilityOutcome =
  | "ALLOWED"
  | "CAPABILITY_REQUIRED"
  | "NOT_OWN_ASSIGNMENT"
  | "TARGET_REQUIRED"
  | "UNSUPPORTED_CONDITION";

export interface ConditionedCapabilityDecision {
  readonly outcome: ConditionedCapabilityOutcome;
  readonly allowed: boolean;
  /** The held Role whose grant satisfied every condition. Null unless allowed. */
  readonly viaRoleKey: string | null;
  /** True when at least one held Role grants the capability with a Condition attached. */
  readonly conditioned: boolean;
}

/** The governed target record, resolved server-side. Never a request body. */
export interface GovernedAssignmentTarget {
  /**
   * The EOS Principal id the authoritative record names as assignee, or null when the record names nobody.
   * Null is a real answer and refuses: "no assignee" is not "anyone".
   */
  readonly assignedToPrincipalId: string | null;
}

export interface ConditionedCapabilityInput {
  /** The actor's EOS Principal id, from the resolved principal context. */
  readonly actorPrincipalId: string;
  /** Role KEYS from QUALIFYING assignments, as the principal context computed them. */
  readonly heldRoleKeys: readonly string[];
  /** Capability keys the principal holds, as the capability authority resolved them from PostgreSQL. */
  readonly heldCapabilities: ReadonlySet<string>;
  readonly capabilityKey: string;
  /** The governed record the decision is about, or null when the caller resolved none. */
  readonly target: GovernedAssignmentTarget | null;
}

const catalog = (): Readonly<Record<string, Role>> => ({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES });

const exactId = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v;

/** Conditions the catalog attaches to this capability on this Role. Empty means the Role grants it unconditioned. */
function conditionsFor(role: Role | undefined, capabilityKey: string): readonly Condition[] {
  if (!role) return [];
  if (!(role.permissions ?? []).includes(capabilityKey)) return [];
  return role.conditionsByPermission?.[capabilityKey] ?? [];
}

/** Does this Role grant the capability at all? A Role that does not grant it can neither allow nor condition it. */
const grants = (role: Role | undefined, capabilityKey: string): boolean =>
  Boolean(role) && (role!.permissions ?? []).includes(capabilityKey);

function satisfies(condition: Condition, input: ConditionedCapabilityInput): boolean {
  // Unsupported by construction: see the header. A Kind this evaluator cannot prove never passes.
  if (condition?.kind !== "isOwnAssignment") return false;
  if (!input.target) return false;
  const assignee = input.target.assignedToPrincipalId;
  // Null assignee refuses: an unassigned record is not everybody's own.
  if (!exactId(assignee) || !exactId(input.actorPrincipalId)) return false;
  return assignee === input.actorPrincipalId;
}

/**
 * Decide a capability that may be conditioned.
 *
 * ORDER MATTERS, and it is capability FIRST: the security capability remains the first boundary, so a principal who
 * does not hold the capability is refused without the target being consulted at all. A condition can only ever
 * narrow a capability the principal already holds; it can never supply one.
 *
 * MULTI-ROLE UNION, matching `resolveEffectivePermission`: a principal holding several Roles is allowed when AT
 * LEAST ONE held Role grants the capability with EVERY condition on that Role's grant satisfied. An unconditioned
 * grant on any held Role therefore allows -- which is correct and is why `reorder.purchaseOrder.void` carries the
 * Condition on every Role that holds it, admin, dispatcher and owner alike.
 */
export function decideConditionedCapability(
  input: ConditionedCapabilityInput, roles: Readonly<Record<string, Role>> = catalog(),
): ConditionedCapabilityDecision {
  const deny = (outcome: ConditionedCapabilityOutcome, conditioned: boolean): ConditionedCapabilityDecision =>
    Object.freeze({ outcome, allowed: false, viaRoleKey: null, conditioned });

  if (!(input?.heldCapabilities instanceof Set) || !input.heldCapabilities.has(input.capabilityKey)) {
    return deny("CAPABILITY_REQUIRED", false);
  }
  const held = (input.heldRoleKeys ?? []).map((key) => [key, roles[key]] as const).filter(([, r]) => grants(r, input.capabilityKey));
  // The capability is held per PostgreSQL but no held CATALOG Role grants it: the two disagree, so nothing is proved.
  if (held.length === 0) return deny("CAPABILITY_REQUIRED", false);

  const conditioned = held.some(([, role]) => conditionsFor(role, input.capabilityKey).length > 0);
  let sawUnsupported = false;
  let sawOwnAssignment = false;

  for (const [roleKey, role] of held) {
    const conditions = conditionsFor(role, input.capabilityKey);
    if (conditions.length === 0) return Object.freeze({ outcome: "ALLOWED" as const, allowed: true, viaRoleKey: roleKey, conditioned });
    for (const c of conditions) {
      if (c?.kind === "isOwnAssignment") sawOwnAssignment = true;
      else sawUnsupported = true;
    }
    if (conditions.every((c) => satisfies(c, input))) {
      return Object.freeze({ outcome: "ALLOWED" as const, allowed: true, viaRoleKey: roleKey, conditioned });
    }
  }
  // Refused: name WHY as specifically as the evidence allows, without leaking the record.
  if (sawUnsupported) return deny("UNSUPPORTED_CONDITION", conditioned);
  if (sawOwnAssignment && !input.target) return deny("TARGET_REQUIRED", conditioned);
  return deny("NOT_OWN_ASSIGNMENT", conditioned);
}

/** Capability keys the catalog conditions on at least one Role -- what a migration must treat as not-yet-portable. */
export function conditionedCapabilityKeys(roles: Readonly<Record<string, Role>> = catalog()): readonly string[] {
  const keys = new Set<string>();
  for (const role of Object.values(roles)) {
    for (const [capabilityKey, conditions] of Object.entries(role.conditionsByPermission ?? {})) {
      if ((conditions ?? []).length > 0) keys.add(capabilityKey);
    }
  }
  return [...keys].sort();
}
