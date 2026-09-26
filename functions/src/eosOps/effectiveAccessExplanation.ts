// EXPLAIN EFFECTIVE ACCESS -- "what may this Principal do, and WHY", answered by the SAME evaluator the
// runtime uses. Administration's effective-access read (Employee page, Permission Preview).
//
// ════════════════════ ONE EVALUATOR, NOT A SECOND ONE ════════════════════
//
//   Principal (by id)      resolvePrincipalContextById      -- shares its whole tail with the runtime's
//                                                             resolvePrincipalContext
//   capabilities           resolveOperationalContextForPrincipal -> capabilitiesForRoleKeys (Roles only)
//   entitlements           the SAME request-scoped resolver, conditions from postgresGrantConditionProvider
//                          -- the source every live transport composes
//   eligibility / scope    postgresPrincipalDimensionReader -- the reader resolveExperienceContext uses
//   surfaces               grantedSurfaceKeys over that flat set -- resolveExperienceContext's projection
//   per Object x action    authorizeOperationalAction over snapshotContextualReader(dimensions)
//
// Nothing here decides access that the runtime does not decide the same way; the parity test
// (effectiveAccessExplanationPostgres) proves capabilities, Roles, dimensions and surfaces equal
// resolveOperationalContext + resolveExperienceContext for every persona.
//
// RESULT VOCABULARY, per Object action:
//   ALLOWED      an entitlement allows with no record (unconditional, or a condition the snapshot proves)
//   CONDITIONAL  every allowing path needs a RECORD (RECORD_ASSIGNMENT) -- decided per record at runtime
//   DENIED       with the evaluator's reason code (CAPABILITY_MISSING, WORK_ELIGIBILITY_MISSING, ...)
// A direct Principal grant is shown as DIRECT_EXCEPTION. The operational runtime resolves capabilities
// from Roles only, so a direct grant is flagged NOT enforced on those paths (it is honoured by the
// Administration read gate and by an explicit resolveDirectEntitlements caller only).
import type { Pool } from "pg";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import { loadPrincipalPolicy } from "../adminPolicy/effectiveObjectAccess";
import {
  principalCapabilityGrants,
  resolveOperationalContextForPrincipal,
  type GrantConditionProvider,
} from "./capabilityAuthority";
import { authorizeOperationalAction, postgresGrantConditionProvider } from "./entitledActionAuthority";
import { entitlementsFor, type GrantCondition } from "./conditionalEntitlement";
import {
  postgresPrincipalDimensionReader,
  snapshotContextualReader,
  type PrincipalDimensionReader,
} from "./contextualAuthorization";
import { EXPERIENCE_SURFACES, grantedSurfaceKeys, type PrincipalDimensions } from "./experienceAuthority";

export type ExplainedResult = "ALLOWED" | "CONDITIONAL" | "DENIED";

export interface ExplainedAction {
  readonly objectKey: string;
  readonly actionKey: string;
  readonly actionKind: string;
  readonly capabilityKey: string;
  readonly result: ExplainedResult;
  /** ALLOWED, RECORD_ASSIGNMENT_REQUIRED, or the evaluator's refusal outcome. */
  readonly reasonCode: string;
  /** Security Roles that grant it, each with the condition on that grant (null = unconditional). */
  readonly sourceRoles: readonly { readonly roleKey: string; readonly condition: GrantCondition | null }[];
  readonly directGrant: {
    readonly label: "DIRECT_EXCEPTION";
    readonly exceptionReason: string | null;
    readonly expiresAt: string | null;
    readonly notEnforcedOnRoleOnlyRuntimePaths: true;
  } | null;
  /** True when every Role path is conditioned: flat-set kernels (Commercial, CRM) withhold it. */
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
    readonly excluded: readonly { readonly assignmentId: string; readonly roleKey: string;
      readonly reason: "STALE" | "INACTIVE" | "SCOPED"; readonly scopeType?: string; readonly scopeValue?: string | null }[];
  };
  readonly employeeId: string | null;
  readonly workEligibility: readonly string[];
  readonly operationalScopes: readonly { readonly scopeType: string; readonly scopeId: string }[];
  /** EXACTLY resolveOperationalContext(...).capabilities, sorted: the UNCONDITIONAL flat set. */
  readonly capabilities: readonly string[];
  /** EXACTLY resolveOperationalContext(...).conditionallyHeld: keys reachable only through conditions. */
  readonly conditionallyHeld: readonly string[];
  /** EXACTLY resolveExperienceContext(...).surfaces. */
  readonly surfaces: readonly string[];
  readonly actions: readonly ExplainedAction[];
}

export interface ExplainOptions {
  /** Server composition. Defaults to the live transports' source; never a request field. */
  readonly conditions?: GrantConditionProvider;
  readonly dimensionReader?: PrincipalDimensionReader;
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

  const [catalog, roles, policy, directRows, directRecords] = await Promise.all([
    reader.listCapabilities(), reader.listRoles(tenantId), loadPrincipalPolicy(reader, tenantId, principalId),
    principalCapabilityGrants(pool, tenantId, principalId), reader.listPrincipalCapabilities(tenantId, principalId),
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
        if (!heldRoleIds.has(binding.roleId)) continue;
        const list = workflowByObject.get(workflow.objectKey) ?? [];
        list.push({ workflowKey: workflow.key, version: version.version, actionKey: binding.actionKey,
          roleKey: roleKeyById.get(binding.roleId) ?? binding.roleId });
        workflowByObject.set(workflow.objectKey, list);
      }
    }
  }

  const snapshot = snapshotContextualReader(dimensions);
  const actor = { ...actorBase, conditionallyHeld: ctx.conditionallyHeld, entitlements: ctx.entitlements };
  const actions: ExplainedAction[] = [];
  for (const capability of [...catalog].sort((a, b) =>
    a.objectKey === b.objectKey ? a.actionKey.localeCompare(b.actionKey) : a.objectKey.localeCompare(b.objectKey))) {
    const reaching = entitlementsFor(entitlements, capability.key);
    const sourceRoles = reaching
      .filter((e) => e.grantor.kind === "ROLE")
      .map((e) => ({ roleKey: (e.grantor as { roleKey: string }).roleKey, condition: e.condition }));
    const direct = directByKey.get(capability.key);
    const directRecord = directRecordByCapabilityId.get(capabilityIdByKey.get(capability.key) ?? "");

    const decision = await authorizeOperationalAction(snapshot, actor, { capabilityKey: capability.key });
    let result: ExplainedResult;
    let reasonCode: string;
    if (decision.allowed) {
      result = "ALLOWED"; reasonCode = "ALLOWED";
    } else if (decision.denials.some((d) => d.detail === "no record supplied")) {
      result = "CONDITIONAL"; reasonCode = "RECORD_ASSIGNMENT_REQUIRED";
    } else {
      result = "DENIED"; reasonCode = decision.outcome;
    }
    actions.push(Object.freeze({
      objectKey: capability.objectKey, actionKey: capability.actionKey, actionKind: capability.actionKind,
      capabilityKey: capability.key, result, reasonCode,
      sourceRoles: Object.freeze(sourceRoles),
      directGrant: direct ? Object.freeze({
        label: "DIRECT_EXCEPTION" as const,
        exceptionReason: directRecord?.exceptionReason ?? null,
        expiresAt: directRecord?.expiresAt ?? null,
        notEnforcedOnRoleOnlyRuntimePaths: true as const,
      }) : null,
      withheldFromFlatSetKernels: sourceRoles.length > 0 && sourceRoles.every((r) => r.condition !== null),
      surfaces: Object.freeze(EXPERIENCE_SURFACES
        .filter((s) => surfaceSet.has(s.key) && s.grants.some((g) => g.capabilityKey === capability.key))
        .map((s) => s.key)),
      workflowSource: workflowByObject.get(capability.objectKey) ?? null,
    }));
  }

  return Object.freeze({
    tenantId,
    principalId,
    securityRoleKeys: Object.freeze([...heldRoleKeys]),
    accessVersion: ctx.principalContext.accessVersion,
    assignments: Object.freeze({
      excluded: Object.freeze((policy.excludedAssignments ?? []).map((a) => Object.freeze({
        ...a, roleKey: roleKeyById.get(a.roleId) ?? a.roleId,
      }))),
    }),
    employeeId,
    workEligibility: Object.freeze([...workEligibility]),
    operationalScopes: Object.freeze(operationalScopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId }))),
    capabilities: Object.freeze([...ctx.capabilities].sort()),
    conditionallyHeld: Object.freeze([...ctx.conditionallyHeld].sort()),
    surfaces,
    actions: Object.freeze(actions),
  });
}
