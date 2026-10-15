"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainEffectiveAccess = explainEffectiveAccess;
exports.provenanceOf = provenanceOf;
const effectiveObjectAccess_1 = require("../adminPolicy/effectiveObjectAccess");
const capabilityAuthority_1 = require("./capabilityAuthority");
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const conditionalEntitlement_1 = require("./conditionalEntitlement");
const assignmentScopeRuntime_1 = require("../adminPolicy/assignmentScopeRuntime");
const contextualAuthorization_1 = require("./contextualAuthorization");
const experienceAuthority_1 = require("./experienceAuthority");
const functionalRoleFacts_1 = require("./functionalRoleFacts");
async function explainEffectiveAccess(reader, pool, input, options = {}) {
    const conditions = options.conditions ?? (0, entitledActionAuthority_1.postgresGrantConditionProvider)(pool);
    const ctx = await (0, capabilityAuthority_1.resolveOperationalContextForPrincipal)(reader, pool, input.principalId, input.tenantId, conditions);
    const { tenantId, uid: principalId, heldRoleKeys } = ctx.principalContext;
    const entitlements = await ctx.entitlements();
    const dimensionReader = options.dimensionReader ?? (0, contextualAuthorization_1.postgresPrincipalDimensionReader)(pool);
    const employeeId = await dimensionReader.linkedEmployeeId(tenantId, principalId);
    const workEligibility = employeeId ? await dimensionReader.listWorkEligibility(tenantId, employeeId) : [];
    const operationalScopes = employeeId ? await dimensionReader.listOperationalScopes(tenantId, employeeId) : [];
    const dimensions = { employeeId, workEligibility, operationalScopes };
    const actorBase = { tenantId, principalId, capabilities: ctx.capabilities };
    const surfaces = await (0, experienceAuthority_1.grantedSurfaceKeys)(actorBase, dimensions);
    const surfaceSet = new Set(surfaces);
    // The direct rows are the SAME rows the runtime resolution read (ctx.directGrants); the records add provenance.
    const directRows = ctx.directGrants;
    const [catalog, roles, policy, directRecords] = await Promise.all([
        reader.listCapabilities(), reader.listRoles(tenantId), (0, effectiveObjectAccess_1.loadPrincipalPolicy)(reader, tenantId, principalId),
        reader.listPrincipalCapabilities(tenantId, principalId),
    ]);
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    const heldRoleIds = new Set(roles.filter((r) => heldRoleKeys.includes(r.key)).map((r) => r.id));
    const directByKey = new Map(directRows.map((d) => [d.capabilityKey, d]));
    const capabilityIdByKey = new Map(catalog.map((c) => [c.key, c.id]));
    const directRecordByCapabilityId = new Map(directRecords.map((r) => [r.capabilityId, r]));
    // PUBLISHED workflow bindings to the Principal's Roles, by Object.
    const workflowByObject = new Map();
    for (const workflow of await reader.listWorkflows(tenantId)) {
        if (!workflow.objectKey)
            continue;
        for (const version of await reader.listWorkflowVersions(tenantId, workflow.id)) {
            if (version.status !== "PUBLISHED")
                continue;
            for (const binding of await reader.listWorkflowRoleBindings(tenantId, version.id)) {
                // Security Role bindings only: a FUNCTIONAL_ROLE binding names no Role and is not a source of anything.
                if (binding.roleId === null || !heldRoleIds.has(binding.roleId))
                    continue;
                const list = workflowByObject.get(workflow.objectKey) ?? [];
                list.push({ workflowKey: workflow.key, version: version.version, actionKey: binding.actionKey,
                    roleKey: roleKeyById.get(binding.roleId) ?? binding.roleId });
                workflowByObject.set(workflow.objectKey, list);
            }
        }
    }
    const snapshot = (0, contextualAuthorization_1.snapshotContextualReader)(dimensions);
    const actor = { ...actorBase, conditionallyHeld: ctx.conditionallyHeld, scopedHeld: ctx.scopedHeld, entitlements: ctx.entitlements };
    const resultOf = (decision) => {
        if (decision.allowed)
            return ["ALLOWED", "ALLOWED"];
        if (decision.denials.some((d) => d.detail === "no record supplied"))
            return ["CONDITIONAL", "RECORD_ASSIGNMENT_REQUIRED"];
        if (decision.outcome === "SCOPE_CONTEXT_REQUIRED")
            return ["SCOPED", "SCOPE_CONTEXT_REQUIRED"];
        return ["DENIED", decision.outcome];
    };
    const actions = [];
    for (const capability of [...catalog].sort((a, b) => a.objectKey === b.objectKey ? a.actionKey.localeCompare(b.actionKey) : a.objectKey.localeCompare(b.objectKey))) {
        const reaching = (0, conditionalEntitlement_1.entitlementsFor)(entitlements, capability.key);
        const sourceRoles = reaching
            .filter((e) => e.grantor.kind === "ROLE")
            .map((e) => ({ roleKey: e.grantor.roleKey, condition: e.condition }));
        const direct = directByKey.get(capability.key);
        const directRecord = directRecordByCapabilityId.get(capabilityIdByKey.get(capability.key) ?? "");
        const directEntitlement = reaching.find((e) => e.grantor.kind === "PRINCIPAL") ?? null;
        const decision = await (0, entitledActionAuthority_1.authorizeOperationalAction)(snapshot, actor, { capabilityKey: capability.key });
        const [result, reasonCode] = resultOf(decision);
        // Each scoped source, decided by the SAME evaluator for a record inside its own scope.
        const scopedSources = [];
        for (const h of ctx.scopedHeld.filter((x) => x.capabilityKey === capability.key)) {
            const inScope = await (0, entitledActionAuthority_1.authorizeOperationalAction)(snapshot, actor, { capabilityKey: capability.key,
                businessContext: { [assignmentScopeRuntime_1.ASSIGNMENT_SCOPE_DIMENSIONS[h.scopeType].contextKey]: h.scopeValue } });
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
                label: "DIRECT_EXCEPTION",
                source: "DIRECT_EXCEPTION",
                exceptionReason: directRecord?.exceptionReason ?? null,
                expiresAt: directRecord?.expiresAt ?? null,
                grantedBy: directRecord?.grantedBy ?? null,
                grantedAt: directRecord?.grantedAt ?? null,
                condition: directEntitlement?.condition ?? null,
                enforced: true,
            }) : null,
            provenance: provenanceOf(sourceRoles.length + scopedSources.length > 0, Boolean(direct)),
            withheldFromFlatSetKernels: reaching.length > 0 && reaching.every((e) => e.condition !== null),
            surfaces: Object.freeze(experienceAuthority_1.EXPERIENCE_SURFACES
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
        assignmentId: a.assignmentId, roleKey: a.roleKey, scopeType: a.scopeType, scopeValue: a.scopeValue,
        capabilities: Object.freeze(ctx.scopedHeld.filter((h) => h.sourceRole === a.roleKey && h.scopeType === a.scopeType
            && h.scopeValue === a.scopeValue).map((h) => h.capabilityKey)),
        inertCapabilities: Object.freeze(ctx.inertScoped.filter((i) => i.sourceRole === a.roleKey && i.scopeType === a.scopeType
            && i.scopeValue === a.scopeValue).map((i) => i.capabilityKey)),
    }));
    const scopedAssignmentIds = new Set(supportedScoped.map((a) => a.assignmentId).filter((id) => !!id));
    // EMPLOYEE FACTS, read LAST: every decision above is already made and nothing below can change it.
    const functionalRoles = employeeId
        ? await (options.functionalRoleReader ?? ((t, e) => (0, functionalRoleFacts_1.listCurrentFunctionalRoles)(pool, t, e)))(tenantId, employeeId)
        : [];
    const employeeRow = employeeId ? (await pool.query(`SELECT e.display_name, e.operating_company_id, e.employment_status::text AS employment_status,
            a.job_role_id, r.display_name AS job_role_label, a.effective_from
       FROM eos_workforce.employees e
       LEFT JOIN eos_workforce.employee_job_role_assignments a ON a.tenant_id = e.tenant_id AND a.employee_id = e.id AND a.effective_to IS NULL
       LEFT JOIN eos_workforce.job_roles r ON r.tenant_id = a.tenant_id AND r.id = a.job_role_id
      WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, employeeId])).rows[0] ?? null : null;
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
                ...a, reason: a.reason === "SCOPED" ? "SCOPE_UNSUPPORTED" : a.reason,
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
            jobRole: employeeRow?.job_role_id ? Object.freeze({ id: String(employeeRow.job_role_id), label: String(employeeRow.job_role_label ?? employeeRow.job_role_id),
                since: employeeRow.effective_from instanceof Date ? employeeRow.effective_from.toISOString() : String(employeeRow.effective_from) }) : null,
            employee: employeeRow ? Object.freeze({ displayName: employeeRow.display_name ?? null, operatingCompanyId: employeeRow.operating_company_id ?? null,
                employmentStatus: employeeRow.employment_status ?? null }) : null,
            grantsCapabilities: false,
        }),
    });
}
/** The ROLE / DIRECT / ROLE_AND_DIRECT vocabulary of objectSecurityAuthority's source, over the explanation's own sources. */
function provenanceOf(viaRole, viaDirect) {
    if (viaRole && viaDirect)
        return "ROLE_AND_DIRECT";
    if (viaDirect)
        return "DIRECT";
    if (viaRole)
        return "ROLE";
    return "NONE";
}
//# sourceMappingURL=effectiveAccessExplanation.js.map