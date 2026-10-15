"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_CAPABILITY = void 0;
exports.previewMyWorkAs = previewMyWorkAs;
const capabilityAuthority_1 = require("../eosOps/capabilityAuthority");
const entitledActionAuthority_1 = require("../eosOps/entitledActionAuthority");
const administrationPreviewAudit_1 = require("../eosOps/administrationPreviewAudit");
const myWork_1 = require("./myWork");
exports.PREVIEW_CAPABILITY = "admin.principalAccess.read";
async function previewMyWorkAs(deps, caller, input) {
    const extra = Object.keys(input ?? {}).filter((k) => !["employeeId", "operatingCompanyId", "reason"].includes(k));
    if (extra.length)
        throw new myWork_1.MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const actor = caller.actor;
    if (!actor.capabilities.has(exports.PREVIEW_CAPABILITY))
        throw new myWork_1.MyWorkError("NOT_AUTHORIZED", "FORBIDDEN", `View as user requires ${exports.PREVIEW_CAPABILITY}`);
    if (!deps.policyReader)
        throw new myWork_1.MyWorkError("PREVIEW_UNAVAILABLE", "FORBIDDEN", "the governed resolver is not composed on this server");
    const employeeId = typeof input.employeeId === "string" ? input.employeeId.trim() : "";
    if (!employeeId)
        throw new myWork_1.MyWorkError("EMPLOYEE_REQUIRED", "INVALID_INPUT", "employeeId is required");
    const { rows } = await deps.pool.query(`SELECT l.principal_id FROM eos_policy.employee_principal_links l
      WHERE l.tenant_id = $1 AND l.employee_id = $2 AND l.status = 'active' LIMIT 1`, [actor.tenantId, employeeId]);
    const subjectPrincipalId = rows[0]?.principal_id ? String(rows[0].principal_id) : null;
    if (!subjectPrincipalId)
        throw new myWork_1.MyWorkError("NO_LINKED_PRINCIPAL", "INVALID_INPUT", "this employee has no linked application identity, so EOS resolves no experience for them");
    const conditions = (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool);
    const ctx = await (0, capabilityAuthority_1.resolveOperationalContextForPrincipal)(deps.policyReader, deps.pool, subjectPrincipalId, actor.tenantId, conditions);
    const capabilities = await (0, capabilityAuthority_1.capabilitiesWithoutUnevaluatedConditions)(deps.pool, ctx.principalContext, ctx.capabilities, conditions);
    const subject = Object.freeze({
        actor: Object.freeze({ tenantId: actor.tenantId, principalId: subjectPrincipalId, capabilities }),
        operational: Object.freeze({ tenantId: actor.tenantId, principalId: subjectPrincipalId, capabilities: ctx.capabilities,
            conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements }),
    });
    const work = await (0, myWork_1.readMyWork)(deps, subject, input.operatingCompanyId === undefined ? {} : { operatingCompanyId: input.operatingCompanyId });
    const auditEventId = await (0, administrationPreviewAudit_1.auditExperiencePreview)(deps.pool, {
        tenantId: actor.tenantId, actorPrincipalId: actor.principalId, subjectPrincipalId, subjectEmployeeId: employeeId,
        shown: { persona: work.persona.key, sections: work.sections.map((s) => `${s.key}:${s.status}`) },
        reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null,
    });
    return Object.freeze({
        preview: true,
        readOnly: true,
        subject: { employeeId, principalId: subjectPrincipalId, securityRoleKeys: [...ctx.principalContext.heldRoleKeys].sort() },
        capabilities: [...capabilities].sort(),
        scopedHeld: ctx.scopedHeld.map((s) => ({ capabilityKey: s.capabilityKey, scopeType: s.scopeType, scopeValue: s.scopeValue, sourceRole: s.sourceRole })),
        work,
        auditEventId,
    });
}
//# sourceMappingURL=previewAsUser.js.map