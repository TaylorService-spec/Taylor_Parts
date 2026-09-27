// EXPLAIN EFFECTIVE ACCESS -- "what may this Principal do, and WHY", answered by the SAME evaluator the
// runtime uses. Administration's effective-access read (Employee page, Permission Preview).
//
// ════════════════════ ONE EVALUATOR, NOT A SECOND ONE ════════════════════
//
//   Principal (by id)      resolvePrincipalContextById      -- shares its whole tail with the runtime's
//                                                             resolvePrincipalContext
//   capabilities           resolveOperationalContextForPrincipal -> resolveOperationalCapabilities (Roles + direct)
//   entitlements           the SAME request-scoped resolver, conditions from postgresGrantConditionProvider
//                          -- the source every live transport composes
//   eligibility / scope    postgresPrincipalDimensionReader -- the reader resolveExperienceContext uses
//   surfaces               grantedSurfaceKeys over that flat set -- resolveExperienceContext's projection
//   employee facts         the linked Employee's CURRENT Functional Roles (eosOps/functionalRoleFacts) -- shown
//                          as FACTS ONLY. They are read AFTER every capability, surface and action decision above
//                          and feed none of them: a Functional Role is never a permission source.
//   per Object x action    authorizeOperationalAction over snapshotContextualReader(dimensions)
//
// Nothing here decides access that the runtime does not decide the same way; the parity test
// (effectiveAccessExplanationPostgres) proves capabilities, Roles, dimensions and surfaces equal
// resolveOperationalContext + resolveExperienceContext for every persona.
//
// RESULT VOCABULARY, per Object action:
//   ALLOWED      an entitlement allows with no record (unconditional, or a condition the snapshot proves)
//   CONDITIONAL  every allowing path needs a RECORD (RECORD_ASSIGNMENT) -- decided per record at runtime
//   SCOPED       held only through a scoped Security Role assignment: admitted only for a record whose business
//                context (operating company, ...) matches; each scope is listed in `scopedSources` with the
//                evaluator's own decision for a record inside it (lane SC)
//   DENIED       with the evaluator's reason code (CAPABILITY_MISSING, WORK_ELIGIBILITY_MISSING, ...)
// A direct Principal grant is shown as DIRECT_EXCEPTION with its reason, actor, creation time, expiry and condition.
// Since lane DX it is ENFORCED on every runtime gate: resolveOperationalCapabilities -- the one resolution behind
// resolveOperationalContext -- counts unexpired direct grants as a capability source with a Role grant's semantics,
// so the decision below already includes it (`enforced: true`). An expired exception is not read and not shown.
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { loadPrincipalPolicy } from "../adminPolicy/effectiveObjectAccess";
import {
  resolveOperationalContextForPrincipal,
  type GrantConditionProvider,
} from "./capabilityAuthority";
import { authorizeOperationalAction, postgresGrantConditionProvider } from "./entitledActionAuthority";
import { entitlementsFor, type GrantCondition } from "./conditionalEntitlement";
import { ASSIGNMENT_SCOPE_DIMENSIONS } from "../adminPolicy/assignmentScopeRuntime";
import {
  postgresPrincipalDimensionReader,
  snapshotContextualReader,
  type PrincipalDimensionReader,
} from "./contextualAuthorization";
import { EXPERIENCE_SURFACES, grantedSurfaceKeys, type PrincipalDimensions } from "./experienceAuthority";
import { listCurrentFunctionalRoles, type CurrentFunctionalRole } from "./functionalRoleFacts";

/**
 * SCOPED (lane SC): not held globally, held ONLY within an assignment scope -- the runtime admits it only for a record
 * whose business context names one of `scopes` (reasonCode SCOPE_CONTEXT_REQUIRED, the evaluator's own outcome).
 */
export type ExplainedResult = "ALLOWED" | "CONDITIONAL" | "SCOPED" | "DENIED";

export interface ExplainedAction {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly actionKind: string;
  readonly capabilityKey: string;
  readonly result: ExplainedResult;
  /** ALLOWED, RECORD_ASSIGNMENT_REQUIRED, or the evaluator's refusal outcome. */
  readonly reasonCode: string;
  /** Security Roles that grant it GLOBALLY, each with the condition on that grant (null = unconditional). */
  readonly sourceRoles: readonly { readonly roleKey: string; readonly condition: GrantCondition | null }[];
  /**
   * Scope-qualified sources (lane SC): each scoped assignment that confers this capability, with its scope, its
   * condition, and the evaluator's decision FOR A RECORD IN THAT SCOPE (authorizeOperationalAction with the scope
   * value as business context). Empty for every globally-assigned principal.
   */
  readonly scopedSources: readonly {
    readonly roleKey: string; readonly scopeType: string; readonly scopeValue: string;
    readonly condition: GrantCondition | null; readonly result: ExplainedResult; readonly reasonCode: string;
  }[];
  /**
   * The Principal's unexpired DIRECT EXCEPTION for this capability, or null. `enforced` is true: every runtime gate
   * resolves it through the same capability resolution as a Role grant (lane DX). `condition` is its ACTIVE
   * PRINCIPAL-cell condition (null = unconditioned); a conditioned direct grant is never in the flat set.
   */
  readonly directGrant: {
    readonly label: "DIRECT_EXCEPTION";
    readonly source: "DIRECT_EXCEPTION";
    readonly exceptionReason: string | null;
    readonly expiresAt: string | null;
    readonly grantedBy: string | null;
    readonly grantedAt: string | null;
    readonly condition: GrantCondition | null;
    readonly enforced: true;
  } | null;
  /** True when every path (Role and direct) is conditioned: flat-set kernels (Commercial, CRM) withhold it. */
  readonly withheldFromFlatSetKernels: boolean;
  /** Experience surfaces this capability earns for this Principal. */
  readonly surfaces: readonly string[];
  /** PUBLISHED workflow actions on this Object bound to a Role the Principal holds; null if none. */
  readonly workflowSource: readonly { readonly workflowKey: string; readonly version: number;
    readonly actionKey: string; readonly roleKey: string }[] | null;
}

export interface EffectiveAccessExplanation {
  readonly tenantId: string;
  readonly principalId: string;
  readonly securityRoleKeys: readonly string[];
  readonly accessVersion: number;
  readonly assignments: {
    /**
     * Assignments that confer nothing: STALE, INACTIVE, or SCOPE_UNSUPPORTED (a non-global scope the runtime cannot
     * decide -- an unconsumed type or no value). A SUPPORTED scoped assignment is NOT here: it is in `scoped`.
     */
    readonly excluded: readonly { readonly assignmentId: string; readonly roleKey: string;
      readonly reason: "STALE" | "INACTIVE" | "SCOPE_UNSUPPORTED"; readonly scopeType?: string; readonly scopeValue?: string | null }[];
    /** Supported scoped assignments: what each confers WITHIN its scope, and what stays inert at that scope. */
    readonly scoped: readonly { readonly assignmentId: string | null; readonly roleKey: string; readonly scopeType: string;
      readonly scopeValue: string; readonly capabilities: readonly string[]; readonly inertCapabilities: readonly string[] }[];
  };
  readonly employeeId: string | null;
  readonly workEligibility: readonly string[];
  readonly operationalScopes: readonly { readonly scopeType: string; readonly scopeId: string }[];
  /** EXACTLY resolveOperationalContext(...).capabilities, sorted: the UNCONDITIONAL flat set. */
  readonly capabilities: readonly string[];
  /** EXACTLY resolveOperationalContext(...).conditionallyHeld: keys reachable only through conditions. */
  readonly conditionallyHeld: readonly string[];
  /** EXACTLY resolveOperationalContext(...).scopedHeld, without conditions: capability @ scope via Role. */
  readonly scopedHeld: readonly { readonly capabilityKey: string; readonly scopeType: string; readonly scopeValue: string;
    readonly sourceRole: string; readonly conditioned: boolean }[];
  /** EXACTLY resolveExperienceContext(...).surfaces. */
  readonly surfaces: readonly string[];
  readonly actions: readonly ExplainedAction[];
  /**
   * EMPLOYEE FACTS -- business facts about the linked Employee that are NOT permission sources. Today: the CURRENT
   * Functional Roles. `grantsCapabilities` is the constant false, stated so no reader mistakes the list for access:
   * no capability, surface or action above derives from anything here (a Functional Role only narrows a workflow
   * action -- see listPrincipalWorkflowResponsibilities).
   */
  readonly employeeFacts: {
    readonly functionalRoles: readonly CurrentFunctionalRole[];
    readonly grantsCapabilities: false;
  };
}

export interface ExplainOptions {
  /** Server composition. Defaults to the live transports' source; never a request field. */
  readonly conditions?: GrantConditionProvider;
  readonly dimensionReader?: PrincipalDimensionReader;
  /** The Functional Role fact reader. Defaults to PostgreSQL. Read-only; never consulted for a decision. */
  readonly functionalRoleReader?: (tenantId: string, employeeId: string) => Promise<readonly CurrentFunctionalRole[]>;
}

export async function explainEffectiveAccess(
  reader: PolicyReader,
  pool: Pool,
  input: { readonly tenantId: string; readonly principalId: string },
  options: ExplainOptions = {},
): Promise<EffectiveAccessExplanation> {
  const conditions = options.conditions ?? postgresGrantConditionProvider(pool);
  const ctx = await resolveOperationalContextForPrincipal(reader, pool, input.principalId, input.tenantId, conditions);
  const { tenantId, uid: principalId, heldRoleKeys } = ctx.principalContext;
  const entitlements = await ctx.entitlements();

  const dimensionReader = options.dimensionReader ?? postgresPrincipalDimensionReader(pool);
  const employeeId = await dimensionReader.linkedEmployeeId(tenantId, principalId);
  const workEligibility = employeeId ? await dimensionReader.listWorkEligibility(tenantId, employeeId) : [];
  const operationalScopes = employeeId ? await dimensionReader.listOperationalScopes(tenantId, employeeId) : [];
  const dimensions: PrincipalDimensions = { employeeId, workEligibility, operationalScopes };
  const actorBase = { tenantId, principalId, capabilities: ctx.capabilities };
  const surfaces = await grantedSurfaceKeys(actorBase, dimensions);
  const surfaceSet = new Set(surfaces);

  // The direct rows are the SAME rows the runtime resolution read (ctx.directGrants); the records add provenance.
  const directRows = ctx.directGrants;
  const [catalog, roles, policy, directRecords] = await Promise.all([
    reader.listCapabilities(), reader.listRoles(tenantId), loadPrincipalPolicy(reader, tenantId, principalId),
    reader.listPrincipalCapabilities(tenantId, principalId),
  ]);
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleIds = new Set(roles.filter((r) => heldRoleKeys.includes(r.key)).map((r) => r.id));
  const directByKey = new Map(directRows.map((d) => [d.capabilityKey, d]));
  const capabilityIdByKey = new Map(catalog.map((c) => [c.key, c.id]));
  const directRecordByCapabilityId = new Map(directRecords.map((r) => [r.capabilityId, r]));

  // PUBLISHED workflow bindings to the Principal's Roles, by Object.
  const workflowByObject = new Map<string, { workflowKey: string; version: number; actionKey: string; roleKey: string }[]>();
  for (const workflow of await reader.listWorkflows(tenantId)) {
    if (!workflow.objectKey) continue;
    for (const version of await reader.listWorkflowVersions(tenantId, workflow.id)) {
      if (version.status !== "PUBLISHED") continue;
      for (const binding of await reader.listWorkflowRoleBindings(tenantId, version.id)) {
        // Security Role bindings only: a FUNCTIONAL_ROLE binding names no Role and is not a source of anything.
        if (binding.roleId === null || !heldRoleIds.has(binding.roleId)) continue;
        const list = workflowByObject.get(workflow.objectKey) ?? [];
        list.push({ workflowKey: workflow.key, version: version.version, actionKey: binding.actionKey,
          roleKey: roleKeyById.get(binding.roleId) ?? binding.roleId });
        workflowByObject.set(workflow.objectKey, list);
      }
    }
  }

  const snapshot = snapshotContextualReader(dimensions);
  const actor = { ...actorBase, conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
  const resultOf = (decision: { allowed: boolean; outcome: string; denials: readonly { detail?: string }[] }): [ExplainedResult, string] => {
    if (decision.allowed) return ["ALLOWED", "ALLOWED"];
    if (decision.denials.some((d) => d.detail === "no record supplied")) return ["CONDITIONAL", "RECORD_ASSIGNMENT_REQUIRED"];
    if (decision.outcome === "SCOPE_CONTEXT_REQUIRED") return ["SCOPED", "SCOPE_CONTEXT_REQUIRED"];
    return ["DENIED", decision.outcome];
  };
  const actions: ExplainedAction[] = [];
  for (const capability of [...catalog].sort((a, b) =>
    a.objectKey === b.objectKey ? a.actionKey.localeCompare(b.actionKey) : a.objectKey.localeCompare(b.objectKey))) {
    const reaching = entitlementsFor(entitlements, capability.key);
    const sourceRoles = reaching
      .filter((e) => e.grantor.kind === "ROLE")
      .map((e) => ({ roleKey: (e.grantor as { roleKey: string }).roleKey, condition: e.condition }));
    const direct = directByKey.get(capability.key);
    const directRecord = directRecordByCapabilityId.get(capabilityIdByKey.get(capability.key) ?? "");
    const directEntitlement = reaching.find((e) => e.grantor.kind === "PRINCIPAL") ?? null;

    const decision = await authorizeOperationalAction(snapshot, actor, { capabilityKey: capability.key });
    const [result, reasonCode] = resultOf(decision);
    // Each scoped source, decided by the SAME evaluator for a record inside its own scope.
    const scopedSources = [];
    for (const h of ctx.scopedHeld.filter((x) => x.capabilityKey === capability.key)) {
      const inScope = await authorizeOperationalAction(snapshot, actor, { capabilityKey: capability.key,
        businessContext: { [ASSIGNMENT_SCOPE_DIMENSIONS[h.scopeType].contextKey]: h.scopeValue } });
      const [r, code] = resultOf(inScope);
      scopedSources.push(Object.freeze({ roleKey: h.sourceRole, scopeType: h.scopeType, scopeValue: h.scopeValue,
        condition: h.condition, result: r, reasonCode: code }));
    }
    actions.push(Object.freeze({
      objectKey: capability.objectKey, actionKey: capability.actionKey, actionKind: capability.actionKind,
      capabilityKey: capability.key, result, reasonCode,
      sourceRoles: Object.freeze(sourceRoles),
      scopedSources: Object.freeze(scopedSources),
      directGrant: direct ? Object.freeze({
        label: "DIRECT_EXCEPTION" as const,
        source: "DIRECT_EXCEPTION" as const,
        exceptionReason: directRecord?.exceptionReason ?? null,
        expiresAt: directRecord?.expiresAt ?? null,
        grantedBy: directRecord?.grantedBy ?? null,
        grantedAt: directRecord?.grantedAt ?? null,
        condition: directEntitlement?.condition ?? null,
        enforced: true as const,
      }) : null,
      withheldFromFlatSetKernels: reaching.length > 0 && reaching.every((e) => e.condition !== null),
      surfaces: Object.freeze(EXPERIENCE_SURFACES
        .filter((s) => surfaceSet.has(s.key) && s.grants.some((g) => g.capabilityKey === capability.key))
        .map((s) => s.key)),
      workflowSource: workflowByObject.get(capability.objectKey) ?? null,
    }));
  }

  // Supported scoped assignments: those that produced at least one holding OR only inert capabilities at a
  // supported scope. An assignment of an unconsumed scope type stays in `excluded` as SCOPE_UNSUPPORTED.
  const supportedScoped = (ctx.principalContext.scopedAssignments ?? [])
    .filter((a) => typeof a.scopeValue === "string" && a.scopeValue !== ""
      && !ctx.inertScoped.some((i) => i.sourceRole === a.roleKey && i.scopeType === a.scopeType
        && i.scopeValue === a.scopeValue && i.reason === "SCOPE_TYPE_UNSUPPORTED")
      && (ctx.scopedHeld.some((h) => h.sourceRole === a.roleKey && h.scopeType === a.scopeType && h.scopeValue === a.scopeValue)
        || ctx.inertScoped.some((i) => i.sourceRole === a.roleKey && i.scopeType === a.scopeType && i.scopeValue === a.scopeValue)))
    .map((a) => Object.freeze({
      assignmentId: a.assignmentId, roleKey: a.roleKey, scopeType: a.scopeType, scopeValue: a.scopeValue as string,
      capabilities: Object.freeze(ctx.scopedHeld.filter((h) => h.sourceRole === a.roleKey && h.scopeType === a.scopeType
        && h.scopeValue === a.scopeValue).map((h) => h.capabilityKey)),
      inertCapabilities: Object.freeze(ctx.inertScoped.filter((i) => i.sourceRole === a.roleKey && i.scopeType === a.scopeType
        && i.scopeValue === a.scopeValue).map((i) => i.capabilityKey)),
    }));
  const scopedAssignmentIds = new Set(supportedScoped.map((a) => a.assignmentId).filter((id): id is string => !!id));
  // EMPLOYEE FACTS, read LAST: every decision above is already made and nothing below can change it.
  const functionalRoles = employeeId
    ? await (options.functionalRoleReader ?? ((t: string, e: string) => listCurrentFunctionalRoles(pool, t, e)))(tenantId, employeeId)
    : [];

  return Object.freeze({
    tenantId,
    principalId,
    securityRoleKeys: Object.freeze([...heldRoleKeys]),
    accessVersion: ctx.principalContext.accessVersion,
    assignments: Object.freeze({
      // A SCOPED exclusion is reported only when the runtime could not turn it into holdings.
      excluded: Object.freeze((policy.excludedAssignments ?? [])
        .filter((a) => a.reason !== "SCOPED" || !scopedAssignmentIds.has(a.assignmentId))
        .map((a) => Object.freeze({
          ...a, reason: a.reason === "SCOPED" ? "SCOPE_UNSUPPORTED" as const : a.reason,
          roleKey: roleKeyById.get(a.roleId) ?? a.roleId,
        }))),
      scoped: Object.freeze(supportedScoped),
    }),
    employeeId,
    workEligibility: Object.freeze([...workEligibility]),
    operationalScopes: Object.freeze(operationalScopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId }))),
    capabilities: Object.freeze([...ctx.capabilities].sort()),
    conditionallyHeld: Object.freeze([...ctx.conditionallyHeld].sort()),
    scopedHeld: Object.freeze(ctx.scopedHeld.map((h) => Object.freeze({ capabilityKey: h.capabilityKey, scopeType: h.scopeType,
      scopeValue: h.scopeValue, sourceRole: h.sourceRole, conditioned: h.condition !== null }))),
    surfaces,
    actions: Object.freeze(actions),
    employeeFacts: Object.freeze({
      functionalRoles: Object.freeze([...functionalRoles]),
      grantsCapabilities: false as const,
    }),
  });
}
