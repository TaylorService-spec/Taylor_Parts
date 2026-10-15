"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminReadDeniedError = exports.capabilityForAdminRead = exports.ADMIN_READ_CAPABILITY = exports.isMutation = exports.isAdminOperation = exports.ADMIN_MUTATION_OPERATIONS = exports.ADMIN_READ_OPERATIONS = void 0;
exports.executeAdminOperation = executeAdminOperation;
// The trusted Administration API — the only door into the policy store.
//
// ════════════════════ THE SHAPE OF EVERY REQUEST ════════════════════
//
//   authenticated subject          <- proved by the identity provider, and nothing else
//        |
//        v
//   resolvePrincipalContext        <- EOS principal, tenant, held Role KEYS, from PostgreSQL
//        |
//        v
//   ONE NAMED OPERATION            <- from the closed list below
//        |
//        v
//   AUTHORITY                      <- a READ needs the one capability its surface declares,
//                                     resolved from role_capabilities UNION principal_capabilities;
//                                     a MUTATION is checked by the command, next to its transaction
//        |
//        v
//   command / query                <- validates, transacts, audits
//        |
//        v
//   canonical persisted result     <- re-read from the store, never echoed from the request
//
// ════════════════════ WHY THERE IS NO GENERIC MUTATION ════════════════════
//
// No `runSQL`. No `mutatePolicy(table, id, patch)`. No `patchAnything`. Each of those would be a
// single endpoint that can express every possible policy change, which makes authorization a
// property of the ARGUMENTS rather than of the operation — and an authorization check that has to
// parse its own arguments to know what it is permitting is one that eventually gets it wrong.
//
// The list is closed and every entry names one governed act. An operation that is not on it cannot
// be performed through this API at all, which is a much cheaper guarantee than reviewing what a
// general endpoint might accept.
//
// ════════════════════ WHAT THE BROWSER IS NOT ════════════════════
//
// The browser is not the policy source of truth, and its current grid state is not authority. Every
// mutation below re-resolves the actor's Roles from the database, re-reads the records it is about
// to change, and returns what was PERSISTED rather than what was requested. A UI that optimistically
// showed success would be showing the user their own request back.
const policyCommands_1 = require("./policyCommands");
const roleCapabilityAdministration_1 = require("./roleCapabilityAdministration");
const configurationOperations_1 = require("./configurationOperations");
const contextualAuthorization_1 = require("../eosOps/contextualAuthorization");
const workflowAdminApi_1 = require("./workflowAdminApi");
const workflowAdministration_1 = require("./workflowAdministration");
const administrationAuthority_1 = require("./administrationAuthority");
const administrationCapabilityGate_1 = require("./administrationCapabilityGate");
const administrationSurfaceAuthority_1 = require("./administrationSurfaceAuthority");
const objectSecurityAuthority_1 = require("./objectSecurityAuthority");
const principalContext_1 = require("./principalContext");
const effectiveObjectAccess_1 = require("./effectiveObjectAccess");
// ════════════════════ the closed operation list ════════════════════
exports.ADMIN_READ_OPERATIONS = Object.freeze([
    // ONE READ BEYOND THE OWNER'S NAMED LIST, and the reason is that the list could not be used
    // without it: `listPrincipalRoleAssignments` takes a principal id, and nothing else returns one.
    // A Users screen could show a person's Roles only if somebody already knew their opaque id.
    // Recorded here rather than added quietly.
    "listTenantPrincipals",
    "listObjects",
    "readObjectWithFields",
    "listRoles",
    "readRolePolicy",
    "listPrincipalRoleAssignments",
    // ── canonical Object-owned security reads ──
    // Three projections of ONE authority: Object -> actions -> grantees, Role -> objects -> actions,
    // Principal -> roles + direct grants -> effective access. No separate permission catalog.
    "listObjectsWithActions",
    "getObjectSecurityMatrix",
    "getRoleSecurity",
    "getPrincipalEffectiveAccess",
    "listWorkflows",
    "readWorkflowVersion",
    // ── the workflow control plane (2026-09-26; workflowAdminApi.ts) ──
    // Validation results (every code), the instances pinned to a version, and one workflow's audit
    // history -- all behind workflowDefinition.read. The responsibilities read is an Employee read
    // (admin.principalAccess.read): bindings on held Roles INTERSECTED with effective authority.
    "validateWorkflowVersion",
    "listWorkflowInstances",
    "readWorkflowHistory",
    "listPrincipalWorkflowResponsibilities",
    "readPolicyAuditHistory",
    // ── the Administration control plane (2026-09-26) ──
    // Security Role detail: holders + every Object action with its grant SOURCE and condition.
    "getSecurityRoleDetail",
    // Object x action x grantee, each cell with its source (ADMIN_GRANTED / SYSTEM_DEFAULT /
    // ADMIN_REVOKED / SYSTEM_INVARIANT / DIRECT_EXCEPTION) and its condition.
    "getObjectActionGrantMatrix",
    // The append-only Administration decision history, superseded decisions included.
    "listRoleCapabilityDecisionHistory",
    // Effective access EXPLAINED by the runtime's own evaluator: per Object action ALLOWED / CONDITIONAL /
    // DENIED with the reason, source Roles, conditions, direct exceptions, scope and surfaces. Served only
    // when the server composes the evaluator (AdminApiDeps.explainEffectiveAccess); it needs the pool.
    "explainEffectiveAccess",
    // What a grant condition may be: the evaluator's kinds, their parameters, and the capability x
    // recordKind allow-list. Unsupported kinds are listed with the reason, never silently absent.
    "listSupportedConditionKinds",
    // Lane SC: the Security Role ASSIGNMENT SCOPES the runtime decides -- per scope type its consumers and this
    // tenant's governed values; per Role which scopes it may be assigned at and what each would confer or leave inert.
    "listSupportedAssignmentScopes",
]);
exports.ADMIN_MUTATION_OPERATIONS = Object.freeze([
    // Object DISPLAY metadata. The only Object mutation there is: no key edit, no delete, no generic
    // patch. Added because "Object definition editing is Admin-only" was a contract with no operation
    // behind it, which made the Objects screen's claim to be editable false.
    "updateObjectMetadata",
    "createCustomField",
    "updateCustomFieldMetadata",
    "createRole",
    "updateRole",
    "setObjectPermission",
    "setFieldPermissionOverride",
    "removeFieldPermissionOverride",
    "assignRole",
    "revokeRole",
    // Object-owned grants. The contract is (objectKey, actionKey, grantee) -- never a capability key.
    "grantObjectActionToRole",
    "revokeObjectActionFromRole",
    // Whole-object authority (#210): deterministically expanded into the per-action grants above, each through the same command.
    "applyObjectWideRoleAuthority",
    "grantObjectActionToPrincipal",
    "revokeObjectActionFromPrincipal",
    // Grant conditions. Fail closed: a condition is never lifted while its grant is held.
    "setGrantCondition",
    "retireGrantCondition",
    "createWorkflowDraft",
    "createWorkflowVersion",
    "updateWorkflowDefinition",
    "setWorkflowRoleBinding",
    "publishWorkflowVersion",
    // ── the workflow control plane (2026-09-26) ── capability-gated (workflowDefinition.publish),
    // each ONE audit event: the active-version pointer, retirement, and in-flight instance governance.
    "activateWorkflowVersion",
    "retireWorkflowVersion",
    "startWorkflowInstance",
    "adoptRecordsIntoWorkflowVersion",
    "migrateWorkflowInstances",
    // Lane GA: which Commercial sales channels THIS tenant operates -- the governed value source of the salesChannel
    // assignment scope (admin.securityPolicy.write; deactivation refused while an assignment is scoped to it).
    "setTenantSalesChannelStatus",
]);
const READS = new Set(exports.ADMIN_READ_OPERATIONS);
const MUTATIONS = new Set(exports.ADMIN_MUTATION_OPERATIONS);
// A THIRD, closed table (configurationOperations.ts): operational configuration gated by its own
// capability. Its entries are on neither list above, so every pin of those lists is unchanged.
const isAdminOperation = (name) => typeof name === "string" && (READS.has(name) || MUTATIONS.has(name) || (0, configurationOperations_1.isAdminConfigurationOperation)(name));
exports.isAdminOperation = isAdminOperation;
const isMutation = (name) => MUTATIONS.has(name) || ((0, configurationOperations_1.isAdminConfigurationOperation)(name) && configurationOperations_1.ADMIN_CONFIGURATION_OPERATIONS[name].mutation);
exports.isMutation = isMutation;
const WORKFLOW_OPERATIONS = new Set([...workflowAdminApi_1.WORKFLOW_READ_OPERATIONS, ...workflowAdminApi_1.WORKFLOW_MUTATION_OPERATIONS]);
const isWorkflowOperation = (name) => WORKFLOW_OPERATIONS.has(name);
// ════════════════════ the read authority ════════════════════
//
// ════════════════════ WHAT CHANGED, AND WHY THE OLD POSTURE WAS WRONG ════════════════════
//
// This dispatcher used to say, in its own words, that "reads are open to any principal with a
// context in the tenant... the sensitive act is CHANGING it". That was a defensible reading of a
// world in which nothing else governed Administration. It is no longer true of this one.
//
// The Administration surfaces are now governed by capabilities -- administrationSurfaceAuthority.ts
// names the READ each surface requires, and navigation resolves against it. An API whose reads
// stayed membership-open would mean the capability model governed only what a browser DRAWS, while
// the data behind it stayed available to every authenticated principal in the tenant over one POST.
// A permission that the UI honours and the server does not is not a permission; it is a label.
//
// So the reads are gated here, on the SAME capability the surface that shows them requires. Not a
// parallel one: this table names the SURFACE each read serves and takes the key from
// ADMINISTRATION_SURFACE_READ_CAPABILITY, so "may open Administration > Users" and "may call
// listTenantPrincipals" cannot drift into two answers. There is no second permission catalog here.
//
// CLOSED BY THE TYPE, not by a lookup that returns a default. The record below is
// `Record<AdminReadOperation, AdministrationSurface>`, so a read added to ADMIN_READ_OPERATIONS
// without a surface is a COMPILE ERROR, and `capabilityForAdminRead` returns null -- a refusal --
// for anything it cannot map. An unmapped read is unreachable, never open.
const READ_OPERATION_SURFACE = Object.freeze({
    // The Object -> action -> grantee projection, and the Role -> object -> action projection of the
    // SAME rows. One authority seen from two sides, so one key: `admin.securityPolicy.read`.
    listObjects: "objects",
    readObjectWithFields: "objects",
    listObjectsWithActions: "objects",
    getObjectSecurityMatrix: "objects",
    listRoles: "rolesPermissions",
    readRolePolicy: "rolesPermissions",
    getRoleSecurity: "rolesPermissions",
    // WHO this tenant knows about, what Roles they hold, and what that resolves to.
    // `getPrincipalEffectiveAccess` is the Permission Preview read and is gated identically: the
    // preview surface and the Users surface are the same authority over the same principal rows.
    listTenantPrincipals: "users",
    listPrincipalRoleAssignments: "users",
    getPrincipalEffectiveAccess: "users",
    listWorkflows: "workflows",
    readWorkflowVersion: "workflows",
    validateWorkflowVersion: "workflows",
    listWorkflowInstances: "workflows",
    readWorkflowHistory: "workflows",
    // An Employee's workflow responsibilities: the same authority as explainEffectiveAccess.
    listPrincipalWorkflowResponsibilities: "users",
    readPolicyAuditHistory: "auditLogs",
    getSecurityRoleDetail: "rolesPermissions",
    getObjectActionGrantMatrix: "objects",
    listRoleCapabilityDecisionHistory: "rolesPermissions",
    // The same authority as getPrincipalEffectiveAccess: admin.principalAccess.read.
    explainEffectiveAccess: "users",
    listSupportedConditionKinds: "rolesPermissions",
    // The Employee > Security Roles picker's vocabulary: the same authority as listPrincipalRoleAssignments.
    listSupportedAssignmentScopes: "users",
});
/** The one capability each Administration read requires. Derived, never restated. */
exports.ADMIN_READ_CAPABILITY = Object.freeze(Object.fromEntries(exports.ADMIN_READ_OPERATIONS.map((operation) => [operation, administrationSurfaceAuthority_1.ADMINISTRATION_SURFACE_READ_CAPABILITY[READ_OPERATION_SURFACE[operation]]])));
/**
 * The capability this read requires, or `null` for anything this table cannot answer for.
 *
 * FAILS CLOSED. A null is not "no capability needed" -- it is "this operation has no declared
 * authority", and the gate refuses on it. The only way to make a read callable is to map it.
 */
const capabilityForAdminRead = (operation) => {
    const required = exports.ADMIN_READ_CAPABILITY[operation];
    return typeof required === "string" && required.length > 0 ? required : null;
};
exports.capabilityForAdminRead = capabilityForAdminRead;
/**
 * Refusal of a READ. Separate from AdministrationDeniedError, which names an engine-invariant
 * MUTATION action and has a fixed vocabulary of four; this one names the capability that was
 * missing, because "you need admin.principalAccess.read" is the answerable form of the question an
 * administrator will actually be asked.
 */
class AdminReadDeniedError extends Error {
    operation;
    requiredCapability;
    constructor(operation, requiredCapability) {
        super(requiredCapability
            ? `not authorized to read: "${requiredCapability}" is required`
            : `not authorized to read: "${operation}" declares no read authority`);
        this.operation = operation;
        this.requiredCapability = requiredCapability;
    }
}
exports.AdminReadDeniedError = AdminReadDeniedError;
/**
 * Run one named operation as one authenticated caller.
 *
 * Never throws for an expected refusal. A thrown error would make "denied" and "the database is
 * down" the same event at the transport, and they need different responses and different alerts.
 */
async function executeAdminOperation(deps, request) {
    const { repo } = deps;
    const operation = request.operation;
    if (!(0, exports.isAdminOperation)(operation)) {
        return fail(operation, "UNKNOWN_OPERATION", `"${String(operation)}" is not an Administration operation`);
    }
    let context;
    try {
        context = await (0, principalContext_1.resolvePrincipalContext)(repo, {
            externalSubject: request.caller?.externalSubject ?? "",
            identityProvider: request.caller?.identityProvider,
            requestedTenantId: request.caller?.requestedTenantId ?? null,
        });
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError) {
            // EVERY principal-resolution refusal is FORBIDDEN (403), UNKNOWN_PRINCIPAL included -- the token WAS verified;
            // "this subject is not provisioned in EOS" is an authority fact, not an authentication failure. Aligned with the
            // Operations, Commercial, CRM and Workforce transports (L5 XLF-L5-01 / Controller XLF-003, 2026-09-28).
            return fail(operation, "FORBIDDEN", refusalMessage(err.refusal));
        }
        // An unreadable policy store is a server fault, answered HERE as a governed INTERNAL -- never thrown past the pure
        // handler, where the node adapter's last-resort 500 carries no CORS header and a browser reads it as a network
        // failure. Same posture as the sibling transports (L5 XLF-L5-02 / Controller XLF-004, 2026-09-28).
        // eslint-disable-next-line no-console -- same posture as the sibling transports' unhandled-error log
        console.error("[adminPolicyApi] principal resolution failed", err);
        return fail(operation, "INTERNAL", "the request could not be completed");
    }
    const actor = {
        tenantId: context.tenantId,
        uid: context.uid,
        heldRoleKeys: context.heldRoleKeys,
    };
    const input = (request.input ?? {});
    const reason = withRequestId(input.reason, request.requestId);
    try {
        // ════════════════════ THE READ GATE ════════════════════
        //
        // HERE, and not inside the switch: one site that every read passes through, evaluated BEFORE
        // the operation runs, so a refused read executes no query and reveals nothing by its timing or
        // its error. Per-case checks would be thirteen places to forget one.
        //
        // MUTATIONS ARE UNTOUCHED. Each still re-checks its own authority next to its transaction --
        // the engine invariant, the privileged-role approval and the anti-lockout guard all stay where
        // they are, because a mutation gated only here would be unguarded for any future caller that
        // reached the command directly.
        // ════════════════════ OPERATIONAL CONFIGURATION ════════════════════
        // Gated on the operation's OWN capability, resolved by the same effective-access resolver as every
        // other gate -- never a Role name, never the security-administration invariant, never a surface read.
        if ((0, configurationOperations_1.isAdminConfigurationOperation)(operation)) {
            const required = configurationOperations_1.ADMIN_CONFIGURATION_OPERATIONS[operation].capability;
            const access = await resolvePrincipalEffectiveAccess(repo, actor.tenantId, actor.uid);
            if (!access.effective.some((c) => c.capabilityKey === required))
                throw new configurationOperations_1.ConfigurationDeniedError(operation, required);
            if (typeof deps.configuration !== "function")
                throw new Error(`${operation} is not composed on this server`);
            const data = await deps.configuration(operation, { tenantId: actor.tenantId, principalId: actor.uid }, input, 
            // A stated reason, never the request id alone (as assignRole): requiredReason refuses a missing one.
            optionalString(input.reason) ? reason : null);
            return { ok: true, operation, tenantId: context.tenantId, data: data };
        }
        if (!(0, exports.isMutation)(operation))
            await requireAdminReadAuthority(repo, actor, operation);
        const data = operation === "explainEffectiveAccess"
            ? await explain(deps, actor, input)
            : isWorkflowOperation(operation)
                ? await (0, workflowAdminApi_1.dispatchWorkflowOperation)(deps, actor, operation, input, reason)
                : await dispatch(repo, actor, operation, input, reason);
        return { ok: true, operation, tenantId: context.tenantId, data: data };
    }
    catch (err) {
        return fail(operation, classify(err), messageFor(err));
    }
}
/**
 * What this principal's access actually resolves to, from PostgreSQL and nothing else.
 *
 * Identity -> Principal -> the tenant membership that already resolved -> ACTIVE Role assignments
 * -> `role_capabilities`, UNIONED WITH `principal_capabilities`. This is the same resolution the
 * `getPrincipalEffectiveAccess` read answers with, and it is this ONE function because a gate that
 * computed effective access its own way would eventually disagree with the screen that displays it.
 *
 * ════════════════════ WHY NOT `heldRoleKeys` ════════════════════
 *
 * `AdminActor.heldRoleKeys` carries ROLE KEYS. Gating on them would compile, would pass a test
 * written with a Role-granted persona, and would SILENTLY IGNORE every direct Principal grant in
 * `principal_capabilities` -- a grant an administrator made through the governed
 * `grantObjectActionToPrincipal` command would simply not count. Role keys answer "who is this";
 * only the union answers "what may they do".
 */
async function resolvePrincipalEffectiveAccess(repo, tenantId, principalId) {
    const [capabilities, roles, policy, directGrants] = await Promise.all([
        repo.listCapabilities(), repo.listRoles(tenantId),
        (0, effectiveObjectAccess_1.loadPrincipalPolicy)(repo, tenantId, principalId),
        repo.listPrincipalCapabilities(tenantId, principalId),
    ]);
    // GLOBAL, ACTIVE, NON-STALE assignments only (Pass 9 S1) -- the rule the runtime and the mutation gate use
    // (loadPrincipalPolicy.qualifyingRoleIds). A SCOPED assignment is decided only against a record's business
    // context; no Administration read has one, so it contributes NOTHING here. Counting it would turn a company-scoped
    // holder of audit.event.read or workflowDefinition.read into a tenant-wide Administration reader.
    const activeRoleIds = [...policy.qualifyingRoleIds];
    const [allRoleGrants, conditions] = await Promise.all([
        activeRoleIds.length > 0 ? repo.listRoleCapabilities(tenantId, activeRoleIds) : Promise.resolve([]),
        repo.listGrantConditions(tenantId),
    ]);
    // FAIL CLOSED (Pass 8 D1): a Role grant narrowed by an ACTIVE condition is NOT effective here -- this
    // flat read gate cannot evaluate a condition, so it must not treat a conditioned grant as unconditional.
    const roleKeyOf = new Map(roles.map((r) => [r.id, r.key]));
    const capabilityKeyOf = new Map(capabilities.map((c) => [c.id, c.key]));
    const conditioned = new Set(conditions.filter((c) => c.grantScope === "ROLE").map((c) => `${c.grantorKey}|${c.capabilityKey}`));
    const roleGrants = allRoleGrants.filter((g) => !conditioned.has(`${roleKeyOf.get(g.roleId)}|${capabilityKeyOf.get(g.capabilityId)}`));
    // The SAME rule for a direct exception (lane DX): a direct grant narrowed by an ACTIVE PRINCIPAL-cell condition is
    // not flat here either -- the runtime resolution places it in conditionallyHeld, and this gate must agree.
    const conditionedDirect = new Set(conditions.filter((c) => c.grantScope === "PRINCIPAL").map((c) => `${c.grantorKey}|${c.capabilityKey}`));
    const flatDirect = directGrants.filter((g) => !conditionedDirect.has(`${g.principalId}|${capabilityKeyOf.get(g.capabilityId)}`));
    const effective = (0, objectSecurityAuthority_1.effectiveCapabilities)({
        tenantId, principalId,
        roleDerivedCapabilityIds: roleGrants.map((g) => g.capabilityId),
        directCapabilityIds: flatDirect.map((g) => g.capabilityId),
        capabilities,
    });
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    return {
        principalId,
        roles: activeRoleIds.map((id) => roleKeyById.get(id) ?? id).sort(),
        directGrants: directGrants.map((g) => g.capabilityId),
        effective,
        objects: (0, objectSecurityAuthority_1.objectActionsForPrincipal)(effective),
    };
}
/**
 * Refuse this read unless the caller holds the capability it declares.
 *
 * FAILS CLOSED, with no second chance. There is no fallback to membership, no "well, they hold the
 * admin Role", no Firebase claim, no `users/{uid}.role`, no frontend authority and no default. A
 * principal who holds nothing is refused; an operation that maps to nothing is refused; an empty
 * capability catalog refuses everything. Every one of those is the safe direction.
 */
async function requireAdminReadAuthority(repo, actor, operation) {
    const required = (0, exports.capabilityForAdminRead)(operation);
    if (!required)
        throw new AdminReadDeniedError(operation, null);
    const access = await resolvePrincipalEffectiveAccess(repo, actor.tenantId, actor.uid);
    if (!access.effective.some((c) => c.capabilityKey === required)) {
        throw new AdminReadDeniedError(operation, required);
    }
}
/** Explain one Principal's effective access in the caller's tenant, through the injected runtime evaluator. */
async function explain(deps, actor, input) {
    const principalId = requireString(input.principalId, "principalId");
    const membership = await deps.repo.getMembership(actor.tenantId, principalId);
    if (!membership)
        throw new NotFound("principal not found in this tenant");
    if (typeof deps.explainEffectiveAccess !== "function") {
        throw new Error("explainEffectiveAccess is not composed on this server");
    }
    try {
        return await deps.explainEffectiveAccess(actor.tenantId, principalId);
    }
    catch (err) {
        // A Principal that cannot be resolved (disabled, no ACTIVE membership) has NO effective access; it is
        // reported as not found rather than as a server fault.
        if (err instanceof principalContext_1.PrincipalContextError)
            throw new NotFound(`principal has no effective access: ${err.refusal}`);
        throw err;
    }
}
/** The grantee of a condition command: a Role key OR a direct-exception Principal, never both, never neither. */
function conditionGrantee(input) {
    const roleKey = optionalString(input.roleKey);
    const principalId = optionalString(input.principalId);
    if ((roleKey === null) === (principalId === null)) {
        throw new policyCommands_1.PolicyValidationError("name exactly one grantee: roleKey (a Role grant) or principalId (a direct exception)");
    }
    return roleKey !== null ? { roleKey } : { principalId: principalId };
}
async function dispatch(repo, actor, operation, input, reason) {
    switch (operation) {
        // ──────────── reads ────────────
        //
        // EVERY CASE BELOW HAS ALREADY BEEN AUTHORIZED. `requireAdminReadAuthority` ran in
        // executeAdminOperation and refused unless the caller holds the one capability
        // READ_OPERATION_SURFACE declares for this operation -- resolved from `role_capabilities` UNION
        // `principal_capabilities`, never from a Role key and never from a membership.
        //
        // A context in the tenant is NO LONGER ENOUGH. What a read returns is the tenant's policy
        // configuration, and "an administrator's grid has to be readable by the people whose access it
        // describes" is answered by GRANTING them `admin.securityPolicy.read`, which is a decision an
        // administrator makes and can withdraw -- not by leaving the door open to everyone who can log
        // in. Mutations are gated as they always were, in the commands.
        case "listObjects":
            return repo.listObjects(actor.tenantId);
        case "readObjectWithFields": {
            const key = requireString(input.objectKey, "objectKey");
            const object = await repo.getObjectByKey(actor.tenantId, key);
            if (!object)
                throw new NotFound(`no object "${key}"`);
            return { object, fields: await repo.listFields(actor.tenantId, object.id) };
        }
        case "listRoles":
            return repo.listRoles(actor.tenantId);
        // ════════ the three projections of one authority ════════
        case "listObjectsWithActions": {
            const [objects, capabilities] = await Promise.all([
                repo.listObjects(actor.tenantId), repo.listCapabilities(),
            ]);
            // Only Objects THIS TENANT registered, each with the actions the canonical metadata says it
            // governs. An Object with no capability still appears, with an empty action list: "nothing
            // governs this yet" is a fact an administrator needs, not a row to hide.
            return objects.map((o) => ({
                key: o.key, label: o.label, supportsDelete: o.supportsDelete,
                actions: (0, objectSecurityAuthority_1.actionsForObject)(capabilities, o.key).map((c) => ({
                    actionKey: c.actionKey, actionKind: c.actionKind, displayLabel: c.displayLabel, capabilityKey: c.key,
                })),
            }));
        }
        case "getObjectSecurityMatrix": {
            const objectKey = requireString(input.objectKey, "objectKey");
            const object = await repo.getObjectByKey(actor.tenantId, objectKey);
            if (!object)
                throw new NotFound("object not found");
            const [capabilities, roles, roleGrants, principalGrants] = await Promise.all([
                repo.listCapabilities(), repo.listRoles(actor.tenantId),
                repo.listRoleCapabilities(actor.tenantId), repo.listPrincipalCapabilities(actor.tenantId),
            ]);
            const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
            return {
                objectKey: object.key, label: object.label, supportsDelete: object.supportsDelete,
                actions: (0, objectSecurityAuthority_1.objectSecurityMatrix)(capabilities, object.key, roleGrants.map((g) => ({ capabilityId: g.capabilityId, roleKey: roleKeyById.get(g.roleId) ?? g.roleId })), principalGrants.map((g) => ({ capabilityId: g.capabilityId, principalId: g.principalId }))),
            };
        }
        case "getRoleSecurity": {
            const roleKey = requireString(input.roleKey, "roleKey");
            const role = await repo.getRoleByKey(actor.tenantId, roleKey);
            if (!role)
                throw new NotFound("role not found");
            const [capabilities, grants] = await Promise.all([
                repo.listCapabilities(), repo.listRoleCapabilities(actor.tenantId, [role.id]),
            ]);
            return {
                roleKey: role.key, name: role.name,
                objects: (0, objectSecurityAuthority_1.roleSecurityView)(capabilities, grants.map((g) => g.capabilityId)),
            };
        }
        case "getPrincipalEffectiveAccess": {
            const principalId = requireString(input.principalId, "principalId");
            const membership = await repo.getMembership(actor.tenantId, principalId);
            if (!membership)
                throw new NotFound("principal not found in this tenant");
            // THE SAME RESOLVER THE READ GATE USES, deliberately. If this screen and the gate could
            // disagree about what a principal's effective access is, one of them would be wrong and
            // nobody would be able to tell which.
            //
            // Work Eligibility, Operational Scope, the linked Employee and record-level authority are
            // DELIBERATELY ABSENT from this payload. They are subordinate constraints on a capability the
            // principal already holds, answered by eos_workforce and the domain kernels, and folding them
            // in here would let a business fact read as a security grant.
            return resolvePrincipalEffectiveAccess(repo, actor.tenantId, principalId);
        }
        case "readRolePolicy": {
            const roleId = requireString(input.roleId, "roleId");
            const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
            if (!role)
                throw new NotFound("role not found");
            const [objectPermissions, fieldOverrides] = await Promise.all([
                repo.listObjectPermissions(actor.tenantId, [roleId]),
                repo.listFieldOverrides(actor.tenantId, [roleId]),
            ]);
            return { role, objectPermissions, fieldOverrides };
        }
        case "listTenantPrincipals": {
            // Membership is the population: who this tenant knows about. It returns identity, never
            // authority -- no Roles, no permissions -- so a member can see who else is in the tenant
            // without learning what any of them may do.
            const ids = await repo.listTenantPrincipalIds(actor.tenantId);
            const principals = [];
            for (const id of ids) {
                const principal = await repo.getPrincipal(id);
                if (!principal)
                    continue;
                principals.push({
                    id: principal.id,
                    displayName: principal.displayName,
                    externalSubject: principal.externalSubject,
                    identityProvider: principal.identityProvider,
                    status: principal.status,
                });
            }
            return principals;
        }
        case "listPrincipalRoleAssignments": {
            const principalId = requireString(input.principalId, "principalId");
            const assignments = await repo.listAssignmentsForPrincipal(actor.tenantId, principalId);
            const roles = await repo.listRoles(actor.tenantId);
            const keyById = new Map(roles.map((r) => [r.id, r.key]));
            const version = await repo.getAccessVersion(actor.tenantId, principalId);
            return {
                principalId,
                accessVersion: version?.accessVersion ?? 0,
                assignments: assignments.map((a) => ({
                    ...a,
                    roleKey: keyById.get(a.roleId) ?? null,
                })),
            };
        }
        case "readPolicyAuditHistory": {
            const limit = clampLimit(input.limit);
            const filter = auditFilterFrom(input);
            if (!filter)
                return repo.listAuditEvents(actor.tenantId, limit);
            // A Role filter also matches assignment events, which name the Role by id.
            const roleId = filter.roleKey ? (await repo.getRoleByKey(actor.tenantId, filter.roleKey))?.id ?? null : null;
            return repo.queryAuditEvents(actor.tenantId, { ...filter, roleId, limit });
        }
        case "listSupportedConditionKinds":
            return supportedConditionKinds(await repo.listCapabilities());
        case "listSupportedAssignmentScopes":
            return (0, policyCommands_1.listSupportedAssignmentScopes)(repo, actor.tenantId, { roleKey: optionalString(input.roleKey) });
        case "getSecurityRoleDetail":
            return describeSecurityRole(repo, actor.tenantId, requireString(input.roleKey, "roleKey"));
        case "getObjectActionGrantMatrix":
            return objectActionGrantMatrix(repo, actor.tenantId, requireString(input.objectKey, "objectKey"));
        case "explainEffectiveAccess":
            // Routed through `explain` in executeAdminOperation (it needs the injected evaluator).
            throw new Error("explainEffectiveAccess is not a repository read");
        case "listRoleCapabilityDecisionHistory": {
            const roleKey = optionalString(input.roleKey);
            const capabilityKey = optionalString(input.capabilityKey);
            const all = await repo.listRoleCapabilityDecisions(actor.tenantId, { currentOnly: false });
            return all.filter((d) => (!roleKey || d.roleKey === roleKey) && (!capabilityKey || d.capabilityKey === capabilityKey))
                .slice(-clampLimit(input.limit));
        }
        // ──────────── mutations ────────────
        //
        // Each delegates to the governed command, which re-checks authority itself. The check is not
        // done here INSTEAD -- it is done there, next to the transaction, so a future caller that
        // bypasses this dispatcher is still refused.
        case "updateObjectMetadata":
            return (0, policyCommands_1.updateObjectMetadata)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                label: input.label === undefined ? undefined : requireString(input.label, "label"),
                labelPlural: input.labelPlural === undefined ? undefined : optionalString(input.labelPlural),
                description: input.description === undefined ? undefined : optionalString(input.description),
                reason,
            });
        case "createCustomField":
            // EVERY metadata value the command supports, not the three the first UI happened to send.
            // A create surface that silently drops `sensitivity` or `referenceTo` produces a field the
            // administrator has to go and fix immediately, which is worse than refusing it.
            return (0, policyCommands_1.createCustomField)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                key: requireString(input.key, "key"),
                label: requireString(input.label, "label"),
                description: optionalString(input.description),
                dataType: requireString(input.dataType, "dataType"),
                required: input.required === true,
                allowedValues: Array.isArray(input.allowedValues) ? input.allowedValues : undefined,
                defaultValue: (input.defaultValue ?? null),
                searchable: input.searchable === true,
                sortable: input.sortable === true,
                reportable: input.reportable === true,
                sensitivity: input.sensitivity === undefined ? undefined : requireString(input.sensitivity, "sensitivity"),
                referenceTo: optionalString(input.referenceTo),
                reason,
            });
        case "updateCustomFieldMetadata":
            // Every value `UpdateFieldInput` accepts. `key` and `dataType` are absent because they are
            // not in that input at all -- changing either is a data migration wearing an edit's clothes,
            // and the command has no way to express it.
            return (0, policyCommands_1.updateFieldDefinition)(repo, actor, {
                fieldId: requireString(input.fieldId, "fieldId"),
                label: input.label === undefined ? undefined : requireString(input.label, "label"),
                description: input.description === undefined ? undefined : optionalString(input.description),
                required: typeof input.required === "boolean" ? input.required : undefined,
                searchable: typeof input.searchable === "boolean" ? input.searchable : undefined,
                sortable: typeof input.sortable === "boolean" ? input.sortable : undefined,
                reportable: typeof input.reportable === "boolean" ? input.reportable : undefined,
                sensitivity: input.sensitivity === undefined ? undefined : requireString(input.sensitivity, "sensitivity"),
                lifecycle: input.lifecycle === undefined ? undefined : requireString(input.lifecycle, "lifecycle"),
                reason,
            });
        case "createRole":
            return (0, policyCommands_1.createRole)(repo, actor, {
                key: requireString(input.key, "key"),
                name: requireString(input.name, "name"),
                description: optionalString(input.description),
                reason,
            });
        case "updateRole": {
            // Renaming and re-describing a Role is the whole of "update" today. Its PERMISSIONS change
            // through setObjectPermission, and its KEY never changes -- a key is identity, and an
            // identity that can be edited is one that every stored reference has to be rewritten for.
            const roleId = requireString(input.roleId, "roleId");
            const role = (await repo.listRoles(actor.tenantId)).find((r) => r.id === roleId);
            if (!role)
                throw new NotFound("role not found");
            return updateRoleMetadata(repo, actor, role, input, reason);
        }
        case "setObjectPermission":
            return (0, policyCommands_1.setObjectPermission)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                objectKey: requireString(input.objectKey, "objectKey"),
                cred: input.cred,
                reason,
            });
        case "setFieldPermissionOverride":
            return (0, policyCommands_1.setFieldPermissionOverride)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                fieldId: requireString(input.fieldId, "fieldId"),
                override: input.override,
                reason,
            });
        case "removeFieldPermissionOverride":
            // An EMPTY override removes the row. "No opinion" has one spelling, not two, and giving
            // removal its own named operation is what keeps the UI from having to know that.
            return (0, policyCommands_1.setFieldPermissionOverride)(repo, actor, {
                roleId: requireString(input.roleId, "roleId"),
                fieldId: requireString(input.fieldId, "fieldId"),
                override: {},
                reason,
            });
        case "grantObjectActionToRole":
            // The reason must be STATED by the administrator; the request id alone is not a reason.
            return (0, policyCommands_1.grantObjectActionToRole)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                roleKey: requireString(input.roleKey, "roleKey"),
                reason: optionalString(input.reason) ? reason : null,
                condition: input.condition ?? undefined,
                requiresCondition: input.requiresCondition === true,
            });
        case "revokeObjectActionFromRole":
            return (0, policyCommands_1.revokeObjectActionFromRole)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                roleKey: requireString(input.roleKey, "roleKey"),
                reason: optionalString(input.reason) ? reason : null,
            });
        case "applyObjectWideRoleAuthority": {
            const mode = input.mode;
            if (mode !== "GRANT" && mode !== "REVOKE")
                throw new policyCommands_1.PolicyValidationError("mode must be GRANT or REVOKE");
            const kinds = input.actionKinds;
            if (kinds !== undefined && kinds !== null && (!Array.isArray(kinds) || !kinds.every((k) => typeof k === "string"))) {
                throw new policyCommands_1.PolicyValidationError("actionKinds must be a list of action kinds");
            }
            return (0, policyCommands_1.applyObjectWideRoleAuthority)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                roleKey: requireString(input.roleKey, "roleKey"),
                mode, actionKinds: kinds ?? null,
                reason: optionalString(input.reason) ? reason : null,
            });
        }
        case "setGrantCondition":
            // A condition cell is (Role, capability) OR (direct exception, capability): exactly one grantee is named.
            return (0, policyCommands_1.setGrantCondition)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                ...conditionGrantee(input),
                condition: input.condition,
                reason: optionalString(input.reason) ? reason : null,
            });
        case "retireGrantCondition":
            return (0, policyCommands_1.retireGrantCondition)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                ...conditionGrantee(input),
                reason: optionalString(input.reason) ? reason : null,
            });
        case "grantObjectActionToPrincipal":
            return (0, policyCommands_1.grantObjectActionToPrincipal)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                principalId: requireString(input.principalId, "principalId"),
                reason: optionalString(input.reason) ? reason : null,
                expiresAt: optionalString(input.expiresAt),
                condition: input.condition ?? undefined,
                // Passed through so the COMMAND refuses it by name: a direct exception has no scope model.
                scopeType: input.scopeType ?? undefined,
                scopeValue: input.scopeValue ?? undefined,
            });
        case "revokeObjectActionFromPrincipal":
            return (0, policyCommands_1.revokeObjectActionFromPrincipal)(repo, actor, {
                objectKey: requireString(input.objectKey, "objectKey"),
                actionKey: requireString(input.actionKey, "actionKey"),
                principalId: requireString(input.principalId, "principalId"),
                reason: optionalString(input.reason) ? reason : null,
            });
        case "setTenantSalesChannelStatus":
            return (0, policyCommands_1.setTenantSalesChannelStatus)(repo, actor, {
                salesChannel: requireString(input.salesChannel, "salesChannel"),
                status: requireString(input.status, "status"),
                reason: optionalString(input.reason) ? reason : null,
            });
        case "assignRole":
            // MEMBERSHIP, and IDEMPOTENCE, are enforced in the COMMAND -- next to the transaction, so a
            // caller that bypasses this dispatcher gets the same answer. They were briefly checked here
            // as well; two spellings of one rule is how the two eventually disagree. Migration 003 makes
            // the membership half unrepresentable at the database as well.
            // HUMAN ADMINISTRATION (Pass 10 ruling): the reason must be STATED by the administrator; the request id alone
            // is not a reason (it stays provenance, appended to a stated one). Decided by the command after its gate.
            return (0, policyCommands_1.assignRole)(repo, actor, {
                principalId: requireString(input.principalId, "principalId"),
                roleId: requireString(input.roleId, "roleId"),
                scopeType: optionalString(input.scopeType) ?? undefined,
                scopeValue: optionalString(input.scopeValue),
                reason: optionalString(input.reason) ? reason : null,
                requireStatedReason: true,
            });
        case "revokeRole":
            // HUMAN ADMINISTRATION (Pass 10 ruling): as assignRole -- a stated reason, never the request id alone.
            return (0, policyCommands_1.revokeRole)(repo, actor, {
                assignmentId: requireString(input.assignmentId, "assignmentId"),
                reason: optionalString(input.reason) ? reason : null,
                requireStatedReason: true,
            });
        // Workflow operations are dispatched by workflowAdminApi before this switch is reached.
        case "listWorkflows":
        case "readWorkflowVersion":
        case "validateWorkflowVersion":
        case "listWorkflowInstances":
        case "readWorkflowHistory":
        case "listPrincipalWorkflowResponsibilities":
        case "createWorkflowDraft":
        case "createWorkflowVersion":
        case "updateWorkflowDefinition":
        case "setWorkflowRoleBinding":
        case "publishWorkflowVersion":
        case "activateWorkflowVersion":
        case "retireWorkflowVersion":
        case "startWorkflowInstance":
        case "adoptRecordsIntoWorkflowVersion":
        case "migrateWorkflowInstances":
            throw new Error(`${operation} is a workflow operation`);
        // Operational configuration is served above, on its own capability, before this dispatcher.
        case "listMobileLocationScopeBindings":
        case "readMobileLocationScopeBinding":
        case "setMobileLocationScopeBinding":
        case "removeMobileLocationScopeBinding":
        case "listWarehouses":
        case "listWarehouseBins":
        case "createWarehouse":
        case "updateWarehouse":
        case "setWarehouseStatus":
        case "createBin":
        case "relabelBin":
        case "setBinStatus":
        case "listTrucks":
        case "readTruck":
        case "listMobileLocations":
        case "createMobileLocation":
        case "createTruck":
        case "linkTruck":
        case "relinkTruck":
        case "unlinkTruck":
        case "changeTruckStatus":
        case "listAccountingDestinations":
        case "configureAccountingDestination":
        case "setAccountingDestinationStatus":
        case "listCounterpartyPaymentTerms":
        case "setCounterpartyPaymentTerms":
        case "listSystemConfiguration":
        case "setSystemConfigurationSetting":
        case "listSalesDiscountAuthorities":
        case "setSalesDiscountAuthority":
            throw new Error(`${operation} is a configuration operation`);
        default: {
            // Exhaustiveness: adding an operation to the list without handling it fails to compile,
            // rather than becoming a runtime "unknown operation" nobody notices until a user hits it.
            const never = operation;
            throw new Error(`unhandled operation ${String(never)}`);
        }
    }
}
/** Rename or re-describe a Role. Its key and its permissions are not touched here. */
async function updateRoleMetadata(repo, actor, role, input, reason) {
    await (0, administrationCapabilityGate_1.requireSecurityAdministrationCapability)(repo, actor, "editSecurityPolicy");
    const name = optionalString(input.name);
    const description = input.description === undefined ? undefined : optionalString(input.description);
    if (name === null && description === undefined) {
        throw new policyCommands_1.PolicyValidationError("nothing to update");
    }
    // An identical rename is not a mutation: no write, no audit event. See policyCommands.ts,
    // "A CHANGE THAT CHANGES NOTHING IS NOT A MUTATION".
    if ((name ?? role.name) === role.name && (description === undefined ? role.description : description) === role.description) {
        return role;
    }
    return repo.transact({ tenantId: actor.tenantId, uid: actor.uid }, async (tx) => {
        const updated = await tx.updateRole(role.id, {
            ...(name ? { name } : {}),
            ...(description === undefined ? {} : { description }),
        });
        await tx.appendAudit({
            action: "updateRole",
            actorUid: actor.uid,
            targetKind: "role",
            targetId: role.id,
            before: { name: role.name, description: role.description },
            after: { name: updated.name, description: updated.description },
            occurredAt: new Date().toISOString(),
            reason,
        });
        return updated;
    });
}
function cellSource(held, decision, forbidden) {
    if (forbidden)
        return "SYSTEM_INVARIANT";
    if (decision === "ADMIN_GRANTED" && held)
        return "ADMIN_GRANTED";
    if (decision === "ADMIN_REVOKED" && !held)
        return "ADMIN_REVOKED";
    return held ? "SYSTEM_DEFAULT" : null;
}
async function describeSecurityRole(repo, tenantId, roleKey) {
    const role = await repo.getRoleByKey(tenantId, roleKey);
    if (!role)
        throw new NotFound("role not found");
    const [capabilities, grants, decisions, conditions, principalIds] = await Promise.all([
        repo.listCapabilities(), repo.listRoleCapabilities(tenantId, [role.id]),
        repo.listRoleCapabilityDecisions(tenantId), repo.listGrantConditions(tenantId),
        repo.listTenantPrincipalIds(tenantId),
    ]);
    const holders = [];
    for (const principalId of principalIds) {
        for (const a of await repo.listAssignmentsForPrincipal(tenantId, principalId)) {
            if (a.roleId !== role.id || a.status !== "active")
                continue;
            const principal = await repo.getPrincipal(principalId);
            // #210: the holder's linked Employee (the governed active link), so the role page links to the person -- a fact, not authority.
            const linked = await repo.getLinkedEmployeeAccessFact(tenantId, principalId);
            holders.push({
                principalId, displayName: principal?.displayName ?? null, assignmentId: a.id,
                scopeType: a.scopeType, scopeValue: a.scopeValue, grantedAt: a.grantedAt,
                employeeId: linked && !linked.ambiguous ? linked.employeeId : null,
            });
        }
    }
    const grantByCapability = new Map(grants.map((g) => [g.capabilityId, g]));
    const actions = capabilities
        .map((c) => {
        const grant = grantByCapability.get(c.id) ?? null;
        const decision = decisions.find((d) => d.roleKey === role.key && d.capabilityKey === c.key) ?? null;
        const condition = conditions.find((x) => x.grantScope === "ROLE" && x.grantorKey === role.key && x.capabilityKey === c.key) ?? null;
        const forbidden = (0, roleCapabilityAdministration_1.forbiddenPair)(role.key, c.key);
        return {
            objectKey: c.objectKey, actionKey: c.actionKey, actionKind: c.actionKind, displayLabel: c.displayLabel,
            capabilityKey: c.key, held: Boolean(grant), grantedBy: grant?.grantedBy ?? null,
            source: cellSource(Boolean(grant), decision?.decision ?? null, Boolean(forbidden)),
            forbiddenBy: forbidden?.ruling ?? null,
            decision: decision ? { decision: decision.decision, reason: decision.reason, actorPrincipalId: decision.actorPrincipalId,
                decidedAt: decision.decidedAt, requiresCondition: decision.requiresCondition, auditEventId: decision.auditEventId } : null,
            condition: condition ? { condition: condition.condition, status: condition.status, updatedAt: condition.updatedAt } : null,
        };
    })
        .sort((a, b) => a.objectKey === b.objectKey ? a.actionKey.localeCompare(b.actionKey) : a.objectKey.localeCompare(b.objectKey));
    return { roleKey: role.key, roleId: role.id, name: role.name, description: role.description, protected: role.protected, holders, actions };
}
async function objectActionGrantMatrix(repo, tenantId, objectKey) {
    const object = await repo.getObjectByKey(tenantId, objectKey);
    if (!object)
        throw new NotFound("object not found");
    const [capabilities, roles, roleGrants, principalGrants, decisions, conditions] = await Promise.all([
        repo.listCapabilities(), repo.listRoles(tenantId), repo.listRoleCapabilities(tenantId),
        repo.listPrincipalCapabilities(tenantId), repo.listRoleCapabilityDecisions(tenantId), repo.listGrantConditions(tenantId),
    ]);
    const actions = (0, objectSecurityAuthority_1.actionsForObject)(capabilities, object.key).map((c) => ({
        actionKey: c.actionKey, actionKind: c.actionKind, displayLabel: c.displayLabel, capabilityKey: c.key,
        roles: roles.map((r) => {
            const grant = roleGrants.find((g) => g.roleId === r.id && g.capabilityId === c.id) ?? null;
            const decision = decisions.find((d) => d.roleKey === r.key && d.capabilityKey === c.key) ?? null;
            const condition = conditions.find((x) => x.grantScope === "ROLE" && x.grantorKey === r.key && x.capabilityKey === c.key) ?? null;
            const forbidden = (0, roleCapabilityAdministration_1.forbiddenPair)(r.key, c.key);
            return {
                roleKey: r.key, held: Boolean(grant),
                source: cellSource(Boolean(grant), decision?.decision ?? null, Boolean(forbidden)),
                condition: condition?.condition ?? null,
            };
        }).filter((cell) => cell.held || cell.source !== null || cell.condition !== null)
            .sort((a, b) => a.roleKey.localeCompare(b.roleKey)),
        // A direct Principal grant is a governed EXCEPTION and is labelled so. Since lane DX every runtime gate
        // honours it through the one capability resolution (resolveOperationalCapabilities), narrowed by its
        // PRINCIPAL-cell condition when one is ACTIVE. Expired exceptions are not listed: they confer nothing.
        principals: principalGrants.filter((g) => g.capabilityId === c.id)
            .map((g) => {
            const condition = conditions.find((x) => x.grantScope === "PRINCIPAL" && x.grantorKey === g.principalId
                && x.capabilityKey === c.key && x.status === "ACTIVE") ?? null;
            return {
                principalId: g.principalId, source: "DIRECT_EXCEPTION", grantedBy: g.grantedBy,
                grantedAt: g.grantedAt, exceptionReason: g.exceptionReason ?? null, expiresAt: g.expiresAt ?? null,
                condition: condition?.condition ?? null, enforced: true,
            };
        })
            .sort((a, b) => a.principalId.localeCompare(b.principalId)),
    }));
    return { objectKey: object.key, label: object.label, actions };
}
// ════════════════════ audit filters and condition kinds ════════════════════
const AUDIT_FILTER_KEYS = ["principalId", "employeeId", "roleKey", "objectKey", "capabilityKey", "actionKey", "workflowKey"];
/** The audit filter a request names, or null for the unfiltered read. Dates must parse. */
function auditFilterFrom(input) {
    const out = {};
    let any = false;
    for (const key of AUDIT_FILTER_KEYS) {
        const v = optionalString(input[key]);
        out[key] = v;
        if (v)
            any = true;
    }
    for (const key of ["from", "to"]) {
        const v = optionalString(input[key]);
        if (v !== null) {
            const at = Date.parse(v);
            if (!Number.isFinite(at))
                throw new policyCommands_1.PolicyValidationError(`${key} must be an ISO timestamp`);
            out[key] = new Date(at).toISOString();
            any = true;
        }
        else
            out[key] = null;
    }
    return any ? out : null;
}
/**
 * The condition vocabulary, as the server enforces it. Shape agreed with the client lane:
 * `{ kinds: [{ kind, supported, reason, parameters, recordKinds, capabilities }] }`.
 */
function supportedConditionKinds(catalog) {
    const capabilitiesFor = (kind) => roleCapabilityAdministration_1.CONDITIONABLE_GRANTS
        .filter((g) => g.kinds.includes(kind))
        .map((g) => {
        const c = catalog.find((x) => x.key === g.capabilityKey);
        return { capabilityKey: g.capabilityKey, objectKey: c?.objectKey ?? null, actionKey: c?.actionKey ?? null,
            recordKinds: kind === "RECORD_ASSIGNMENT" ? [...g.recordKinds] : [] };
    });
    const recordKinds = [...new Set(roleCapabilityAdministration_1.CONDITIONABLE_GRANTS.flatMap((g) => g.recordKinds))].sort();
    const unsupported = (kind, reason) => ({ kind, supported: false, reason, parameters: {}, recordKinds: [], capabilities: [] });
    return {
        kinds: [
            { kind: "RECORD_ASSIGNMENT", supported: true, reason: null,
                parameters: { relation: ["ASSIGNED_EMPLOYEE"] }, recordKinds, capabilities: capabilitiesFor("RECORD_ASSIGNMENT") },
            { kind: "WORK_ELIGIBILITY", supported: true, reason: null,
                parameters: { qualificationCode: [...contextualAuthorization_1.GOVERNED_QUALIFICATION_CODES].sort() }, recordKinds: [],
                capabilities: capabilitiesFor("WORK_ELIGIBILITY") },
            { kind: "OPERATIONAL_SCOPE", supported: true, reason: null,
                parameters: { scopeType: [...roleCapabilityAdministration_1.CONDITION_OPERATIONAL_SCOPE_TYPES], scopeId: "optional: one target of that type" }, recordKinds: [],
                capabilities: capabilitiesFor("OPERATIONAL_SCOPE") },
            unsupported("SELF", "no evaluator: record ownership by the actor is not a governed relation"),
            unsupported("TEAM", "no evaluator: there is no team / reportsTo edge to evaluate"),
            unsupported("BUSINESS_UNIT", "no evaluator: business units are not a governed scope"),
            unsupported("COMPANY", "no evaluator: operating-company scope is not a grant condition"),
            unsupported("ALL", "not a condition: an unconditioned grant is expressed by having no condition"),
        ],
    };
}
// ════════════════════ input handling ════════════════════
class NotFound extends Error {
}
function requireString(value, what) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new policyCommands_1.PolicyValidationError(`${what} is required`);
    }
    return value.trim();
}
function optionalString(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string")
        throw new policyCommands_1.PolicyValidationError("expected a string");
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}
/** Bounded, so a caller cannot ask for the whole audit table in one request. */
function clampLimit(value) {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 100;
    return Math.min(Math.max(n, 1), 500);
}
/**
 * Carry the request id into the audit event's reason.
 *
 * Correlating an audit event with the request that caused it is what makes a support question
 * answerable months later; the audit schema has no correlation column, so it rides in the reason
 * rather than requiring a migration for a string.
 */
function withRequestId(reason, requestId) {
    const text = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
    if (!requestId)
        return text;
    return text ? `${text} [request ${requestId}]` : `[request ${requestId}]`;
}
function classify(err) {
    if (err instanceof administrationAuthority_1.AdministrationDeniedError)
        return "FORBIDDEN";
    // A missing READ capability is a refusal about authority, exactly like a missing write authority
    // -- never a 404 and never a 500, so a caller cannot tell "you may not" from "it is not there".
    if (err instanceof AdminReadDeniedError)
        return "FORBIDDEN";
    if (err instanceof configurationOperations_1.ConfigurationDeniedError)
        return "FORBIDDEN";
    if (err instanceof configurationOperations_1.ConfigurationRefusal)
        return err.category;
    if (err instanceof NotFound)
        return "NOT_FOUND";
    // A governed workflow refusal names its own category (workflowAdministration.ts).
    if (err instanceof workflowAdministration_1.WorkflowRefusal)
        return err.category;
    // A governed refusal about the STATE the change would produce -- a system invariant, a condition
    // that would widen, the last administration path -- is a CONFLICT with what is there, not a
    // malformed request. A missing reason or an unloadable condition stays INVALID_INPUT.
    if (err instanceof policyCommands_1.AdministrationRefusal) {
        if (err.code === "SELF_ADMINISTRATION" || err.code === "PRIVILEGE_ESCALATION" || err.code === "PROTECTED_OWNER_MEMBERSHIP")
            return "FORBIDDEN";
        return err.code === "REASON_REQUIRED" || err.code === "CONDITION_INVALID" || err.code === "CONDITION_REQUIRED"
            || err.code === "CONDITION_NOT_SUPPORTED" || err.code.startsWith("SCOPE_") || err.code === "SALES_CHANNEL_INVALID"
            || err.code === "DIRECT_GRANT_SCOPE_UNSUPPORTED"
            ? "INVALID_INPUT" : "CONFLICT";
    }
    if (err instanceof policyCommands_1.PolicyValidationError)
        return "INVALID_INPUT";
    const name = err?.constructor?.name;
    // A store refusal is a conflict with what is already there -- a duplicate key, an immutable
    // published version -- rather than a malformed request.
    if (name === "PolicyStoreError")
        return "CONFLICT";
    return "INTERNAL";
}
/**
 * The message a caller sees.
 *
 * An INTERNAL failure is deliberately opaque. A database error's text can carry a table name, a
 * constraint name, a column value, or a fragment of another tenant's row, and none of that belongs
 * in a response -- the detail belongs in the server's own log.
 */
function messageFor(err) {
    if (classify(err) === "INTERNAL")
        return "the request could not be completed";
    return err instanceof Error ? err.message : "the request could not be completed";
}
function refusalMessage(refusal) {
    switch (refusal) {
        case "UNKNOWN_PRINCIPAL": return "this identity is not known to EOS";
        case "PRINCIPAL_DISABLED": return "this principal is disabled";
        case "NO_TENANT_MEMBERSHIP": return "this principal belongs to no tenant";
        case "TENANT_NOT_A_MEMBERSHIP": return "this principal is not a member of the requested tenant";
        case "AMBIGUOUS_TENANT": return "this principal belongs to several tenants; state which one";
        case "TENANT_NOT_ACTIVE": return "this tenant is not active";
        case "EMPLOYEE_NOT_ACCESS_ELIGIBLE": return "this principal's Employee is not eligible for access";
        default: return "not authorized";
    }
}
const fail = (operation, code, message) => Object.freeze({ ok: false, operation, code, message });
//# sourceMappingURL=adminPolicyApi.js.map