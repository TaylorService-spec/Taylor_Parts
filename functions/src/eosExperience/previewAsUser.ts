// VIEW AS USER — a READ-ONLY preview of the EOS experience the server resolves for another employee (DECISIONS #210).
//
// NOT impersonation. No session, token or credential is issued for the subject; the administrator stays the authenticated caller.
// The subject's caller is built by the SAME resolver every real request uses (resolveOperationalContextForPrincipal ->
// capabilitiesWithoutUnevaluatedConditions), and readMyWork then runs over it -- so the preview IS the subject's governed persona,
// sections, reach and refusals, not a second calculation. readMyWork is read-only, so a preview can create, execute or reassign
// nothing. Gated by admin.principalAccess.read (the Effective Access read), and every preview is audited.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { capabilitiesWithoutUnevaluatedConditions, resolveOperationalContextForPrincipal } from "../eosOps/capabilityAuthority";
import { postgresGrantConditionProvider } from "../eosOps/entitledActionAuthority";
import { auditExperiencePreview } from "../eosOps/administrationPreviewAudit";
import { MyWorkError, readMyWork } from "./myWork";

export const PREVIEW_CAPABILITY = "admin.principalAccess.read";

export async function previewMyWorkAs(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => !["employeeId", "operatingCompanyId", "reason"].includes(k));
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const actor = caller.actor;
  if (!actor.capabilities.has(PREVIEW_CAPABILITY)) throw new MyWorkError("NOT_AUTHORIZED", "FORBIDDEN", `View as user requires ${PREVIEW_CAPABILITY}`);
  if (!deps.policyReader) throw new MyWorkError("PREVIEW_UNAVAILABLE", "FORBIDDEN", "the governed resolver is not composed on this server");
  const employeeId = typeof input.employeeId === "string" ? input.employeeId.trim() : "";
  if (!employeeId) throw new MyWorkError("EMPLOYEE_REQUIRED", "INVALID_INPUT", "employeeId is required");
  const { rows } = await deps.pool.query(
    `SELECT l.principal_id FROM eos_policy.employee_principal_links l
      WHERE l.tenant_id = $1 AND l.employee_id = $2 AND l.status = 'active' LIMIT 1`, [actor.tenantId, employeeId]);
  const subjectPrincipalId = rows[0]?.principal_id ? String(rows[0].principal_id) : null;
  if (!subjectPrincipalId) throw new MyWorkError("NO_LINKED_PRINCIPAL", "INVALID_INPUT", "this employee has no linked application identity, so EOS resolves no experience for them");

  const conditions = postgresGrantConditionProvider(deps.pool);
  const ctx = await resolveOperationalContextForPrincipal(deps.policyReader, deps.pool, subjectPrincipalId, actor.tenantId, conditions);
  const capabilities = await capabilitiesWithoutUnevaluatedConditions(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
  const subject: WorkOrderCaller = Object.freeze({
    actor: Object.freeze({ tenantId: actor.tenantId, principalId: subjectPrincipalId, capabilities }),
    operational: Object.freeze({ tenantId: actor.tenantId, principalId: subjectPrincipalId, capabilities: ctx.capabilities,
      conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements }),
  }) as WorkOrderCaller;
  const work = await readMyWork(deps, subject, input.operatingCompanyId === undefined ? {} : { operatingCompanyId: input.operatingCompanyId });
  const auditEventId = await auditExperiencePreview(deps.pool, {
    tenantId: actor.tenantId, actorPrincipalId: actor.principalId, subjectPrincipalId, subjectEmployeeId: employeeId,
    shown: { persona: work.persona.key, sections: work.sections.map((s) => `${s.key}:${s.status}`) },
    reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null,
  });
  return Object.freeze({
    preview: true as const,
    readOnly: true as const,
    subject: { employeeId, principalId: subjectPrincipalId, securityRoleKeys: [...ctx.principalContext.heldRoleKeys].sort() },
    capabilities: [...capabilities].sort(),
    scopedHeld: ctx.scopedHeld.map((s) => ({ capabilityKey: s.capabilityKey, scopeType: s.scopeType, scopeValue: s.scopeValue, sourceRole: s.sourceRole })),
    work,
    auditEventId,
  });
}
