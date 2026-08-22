// AUTHORIZATION BEFORE DATA. The release-blocking boundary of the whole assistant.
//
// ============================ THE ONE INVARIANT ============================
//
//   AUTHORIZATION HAPPENS BEFORE PROTECTED DATA IS RETRIEVED,
//   AND THEREFORE BEFORE IT COULD ENTER A MODEL PROMPT.
//
// The failure mode this exists to make impossible is the one that looks reasonable in a design
// review: retrieve broadly, put it all in context, and instruct the model to only mention what the
// user may see. That is not access control. It is a request, to a system with no obligation to
// honour it, about data that has already left the trust boundary. A prompt-injection string, a
// summarisation, a cache, a provider-side log -- any of them defeats it, and none of them leaves a
// trace in EOS.
//
// So the order is fixed and is asserted by tests: resolve the actor's EFFECTIVE authority, decide
// each tool, and only then execute the tools that were allowed. A denied tool performs no read.
// There is no code path in which a denied tool's data exists in memory at all.
//
// ============================ EMPLOYEE-LEVEL, NOT ROLE-LEVEL ============================
//
// Authority is resolved as the UNION of everything the ACTOR carries -- business Roles, functional
// Roles, and the legacy compatibility Role -- intersected with what is ACTIVE in this environment.
//
// This is not a preference. On 2026-08-21 the governance program found both General Manager
// employees holding every `admin.*` capability: the governed Role correctly held none, and the
// legacy compatibility Role on the person handed them all back. A role-level check would have
// authorized the assistant on a model of authority the server does not use.
import type { PermissionId } from "../types/access";

/** What the caller must supply. The client supplies IDENTITY; it never supplies AUTHORITY. */
export interface AssistantActor {
  readonly uid: string;
  readonly companyId: string;
  /** Resolved server-side from the actor's roleAssignments. Never accepted from a client. */
  readonly businessRoleIds: readonly string[];
  readonly functionalRoleIds: readonly string[];
  readonly compatibilityRoleId: string | null;
}

export type ToolAuthorizationDecision = "ALLOW" | "DENY";

export interface ToolAuthorizationResult {
  readonly toolId: string;
  readonly decision: ToolAuthorizationDecision;
  readonly required: readonly PermissionId[];
  readonly missing: readonly PermissionId[];
  /**
   * Business-language reason, safe to show a user.
   *
   * Deliberately does NOT name the missing capability ids. "You need
   * inventory.balance.read" teaches the permission surface to someone who was just refused, and a
   * denied user learning the shape of what they cannot reach is a small disclosure that costs
   * nothing to avoid.
   */
  readonly reason: string;
}

export interface EffectiveAuthority {
  /** Every capability the actor holds AND that is active in this environment. */
  readonly operable: ReadonlySet<PermissionId>;
  /** Held but inactive here. Kept separate so "switched off" never reads as "not permitted". */
  readonly grantedButInactive: ReadonlySet<PermissionId>;
}

export interface RoleResolver {
  permissionsForRole(roleId: string): readonly PermissionId[];
}

/**
 * Resolve one actor's effective authority.
 *
 * `activeCapabilities` is passed in rather than read here, because "active" is an ENVIRONMENT
 * question -- the same capability is live in sandbox and denied in production, and a resolver that
 * decided that for itself would be right in one environment and wrong in the other.
 */
export function resolveEffectiveAuthority(
  actor: AssistantActor,
  roles: RoleResolver,
  activeCapabilities: ReadonlySet<PermissionId>,
): EffectiveAuthority {
  const held = new Set<PermissionId>();
  const roleIds = [
    ...actor.businessRoleIds,
    ...actor.functionalRoleIds,
    ...(actor.compatibilityRoleId ? [actor.compatibilityRoleId] : []),
  ];
  for (const roleId of roleIds) {
    for (const p of roles.permissionsForRole(roleId)) held.add(p);
  }

  const operable = new Set<PermissionId>();
  const grantedButInactive = new Set<PermissionId>();
  for (const p of held) {
    if (activeCapabilities.has(p)) operable.add(p);
    else grantedButInactive.add(p);
  }
  return { operable, grantedButInactive };
}

export interface AuthorizableTool {
  readonly id: string;
  /** ALL of these must be operable. A tool needing two reads is not half-usable. */
  readonly requires: readonly PermissionId[];
  /** Shown to the user when refused. Business language, no capability ids. */
  readonly deniedMessage: string;
}

/**
 * Decide one tool. Pure, synchronous, and performs no retrieval — the separation is the design.
 */
export function authorizeTool(
  tool: AuthorizableTool,
  authority: EffectiveAuthority,
): ToolAuthorizationResult {
  const missing = tool.requires.filter((p) => !authority.operable.has(p));
  if (missing.length === 0) {
    return { toolId: tool.id, decision: "ALLOW", required: tool.requires, missing: [], reason: "" };
  }
  // A capability that is HELD but inactive is refused exactly like one that is not held. The user
  // cannot do the thing either way, and the distinction belongs in the audit record, not the answer.
  return {
    toolId: tool.id,
    decision: "DENY",
    required: tool.requires,
    missing,
    reason: tool.deniedMessage,
  };
}

/**
 * Partition a tool set into allowed and denied WITHOUT executing anything.
 *
 * Returning a plan rather than results is what enforces the ordering: a caller physically cannot
 * retrieve data for a denied tool, because this function hands back no way to do so.
 */
export function planToolExecution<T extends AuthorizableTool>(
  tools: readonly T[],
  authority: EffectiveAuthority,
): { readonly allowed: readonly T[]; readonly decisions: readonly ToolAuthorizationResult[] } {
  const decisions = tools.map((t) => authorizeTool(t, authority));
  const allowedIds = new Set(decisions.filter((d) => d.decision === "ALLOW").map((d) => d.toolId));
  return { allowed: tools.filter((t) => allowedIds.has(t.id)), decisions };
}
