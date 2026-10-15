"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInMemoryPolicyRepository = exports.InMemoryPolicyRepository = void 0;
// The reference PolicyRepository adapter — in memory.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// It is the EXECUTABLE SPECIFICATION OF THE PORT: the shortest complete statement of what an
// adapter must do. `postgresPolicyRepository.ts` is measured against it rather than only against
// the interface -- the same suites run over both, so "the resolver behaves identically over
// Postgres" is a claim with evidence.
//
// It is also what lets the resolver's own proofs run without a database. Those properties -- the
// doorway invariant, additive union, fail-closed on malformed policy -- are decisions the resolver
// makes, and none of them needs a real database to be wrong.
//
// ════════════════════ WHAT IT IS NOT ════════════════════
//
// NOT a production store, and it does not pretend otherwise: state is a Map, it disappears with the
// process, and `transact` gives all-or-nothing by snapshotting rather than by anything a database
// would recognise. That is honest for tests and useless for durability, which is the correct pair
// of properties for a reference adapter.
//
// It contains NO Firebase and NO Firestore. Neither will any other adapter behind this port.
const policyRepository_1 = require("./policyRepository");
const emptyTables = () => ({
    tenants: [],
    principals: [],
    memberships: [],
    adminBootstraps: [],
    objects: [],
    fields: [],
    roles: [],
    objectPermissions: [],
    fieldOverrides: [],
    assignments: [],
    accessVersions: [],
    workflows: [],
    workflowVersions: [],
    workflowSteps: [],
    workflowActions: [],
    workflowRoleBindings: [],
    workflowInstances: [],
    workflowInstanceEvents: [],
    audit: [],
});
class InMemoryPolicyRepository {
    tables = emptyTables();
    now;
    nextId;
    constructor(options = {}) {
        this.now = options.now ?? (() => new Date().toISOString());
        let counter = 0;
        this.nextId = options.nextId ?? (() => `p${++counter}`);
    }
    // ════════════════════ transaction ════════════════════
    async transact(actor, fn) {
        if (!actor?.tenantId)
            throw new policyRepository_1.PolicyStoreError("a tenant is required");
        if (!actor?.uid)
            throw new policyRepository_1.PolicyStoreError("an actor uid is required");
        // ALL OR NOTHING, by snapshot. A real adapter uses the database's transaction; the property the
        // callers depend on -- a throw leaves no partial policy and no orphan audit event -- is the same.
        const snapshot = JSON.parse(JSON.stringify(this.tables));
        try {
            return await fn(this.makeTransaction(actor));
        }
        catch (err) {
            this.tables = snapshot;
            throw err;
        }
    }
    stamp(actor) {
        const at = this.now();
        return { createdBy: actor.uid, createdAt: at, updatedBy: actor.uid, updatedAt: at };
    }
    makeTransaction(actor) {
        const t = this.tables;
        const tenantId = actor.tenantId;
        const own = (row) => row.tenantId === tenantId;
        const requireOwned = (rows, id, kind) => {
            const found = rows.find((r) => r.id === id && own(r));
            // A row belonging to ANOTHER tenant reports the same "not found" as one that does not exist.
            // Distinguishing them would confirm the other tenant's row exists, which is itself a leak.
            if (!found)
                throw new policyRepository_1.PolicyStoreError(`${kind} not found`);
            return found;
        };
        const replace = (rows, updated) => {
            rows[rows.findIndex((r) => r.id === updated.id)] = updated;
            return updated;
        };
        return {
            // ── tenant and identity ──
            createTenant: async (input) => {
                if (t.tenants.some((x) => x.key === input.key)) {
                    throw new policyRepository_1.PolicyStoreError(`tenant key "${input.key}" already exists`);
                }
                const at = this.now();
                const row = {
                    id: tenantId,
                    key: input.key,
                    name: input.name,
                    status: input.status ?? "active",
                    configurationVersion: input.configurationVersion ?? 0,
                    createdAt: at,
                    updatedAt: at,
                };
                t.tenants.push(row);
                return row;
            },
            setTenantConfigurationVersion: async (id, version) => {
                const found = t.tenants.find((x) => x.id === id && x.id === tenantId);
                if (!found)
                    throw new policyRepository_1.PolicyStoreError("tenant not found");
                const updated = { ...found, configurationVersion: version, updatedAt: this.now() };
                t.tenants[t.tenants.indexOf(found)] = updated;
                return updated;
            },
            createPrincipal: async (input) => {
                const existing = t.principals.find((x) => x.identityProvider === input.identityProvider && x.externalSubject === input.externalSubject);
                // One subject per provider is one principal. Minting a second would split one human's Roles.
                if (existing)
                    throw new policyRepository_1.PolicyStoreError("principal already exists for that subject");
                const at = this.now();
                const row = {
                    id: this.nextId(),
                    externalSubject: input.externalSubject,
                    identityProvider: input.identityProvider,
                    displayName: input.displayName ?? null,
                    status: input.status ?? "active",
                    createdAt: at,
                    updatedAt: at,
                };
                t.principals.push(row);
                return row;
            },
            createTenantMembership: async (principalId, status) => {
                if (t.memberships.some((m) => m.tenantId === tenantId && m.principalId === principalId)) {
                    throw new policyRepository_1.PolicyStoreError("membership already exists");
                }
                const at = this.now();
                const row = {
                    id: this.nextId(),
                    tenantId,
                    principalId,
                    status: status ?? "active",
                    createdAt: at,
                    updatedAt: at,
                };
                t.memberships.push(row);
                return row;
            },
            setTenantMembershipStatus: async (membershipId, status) => {
                const found = t.memberships.find((m) => m.id === membershipId && m.tenantId === tenantId);
                if (!found)
                    throw new policyRepository_1.PolicyStoreError("membership not found");
                const updated = { ...found, status, updatedAt: this.now() };
                t.memberships[t.memberships.indexOf(found)] = updated;
                return updated;
            },
            recordAdminBootstrap: async (input) => {
                // ONE PER TENANT. The real adapter gets this from a primary key; here it is the same rule
                // stated in the same place, so the two adapters refuse the same second call.
                if (t.adminBootstraps.some((b) => b.tenantId === tenantId)) {
                    throw new policyRepository_1.PolicyStoreError("this tenant has already been bootstrapped");
                }
                const row = {
                    tenantId,
                    principalId: input.principalId,
                    performedBy: input.performedBy,
                    reason: input.reason ?? null,
                    performedAt: this.now(),
                };
                t.adminBootstraps.push(row);
                return row;
            },
            createObject: async (input) => {
                if (t.objects.some((o) => o.tenantId === tenantId && o.key === input.key)) {
                    throw new policyRepository_1.PolicyStoreError(`object key "${input.key}" already exists`);
                }
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.objects.push(row);
                return row;
            },
            updateObject: async (objectId, patch) => {
                const found = requireOwned(t.objects, objectId, "object");
                const updated = {
                    ...found,
                    ...(patch.label === undefined ? {} : { label: patch.label }),
                    ...(patch.labelPlural === undefined ? {} : { labelPlural: patch.labelPlural }),
                    ...(patch.description === undefined ? {} : { description: patch.description }),
                    updatedBy: actor.uid,
                    updatedAt: this.now(),
                };
                return replace(t.objects, updated);
            },
            createField: async (input) => {
                requireOwned(t.objects, input.objectId, "object");
                if (t.fields.some((f) => f.tenantId === tenantId && f.objectId === input.objectId && f.key === input.key)) {
                    throw new policyRepository_1.PolicyStoreError(`field key "${input.key}" already exists on this object`);
                }
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.fields.push(row);
                return row;
            },
            updateField: async (fieldId, patch) => {
                const current = requireOwned(t.fields, fieldId, "field");
                return replace(t.fields, { ...current, ...patch, updatedBy: actor.uid, updatedAt: this.now() });
            },
            createRole: async (input) => {
                if (t.roles.some((r) => r.tenantId === tenantId && r.key === input.key)) {
                    throw new policyRepository_1.PolicyStoreError(`role key "${input.key}" already exists`);
                }
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.roles.push(row);
                return row;
            },
            updateRole: async (roleId, patch) => {
                const current = requireOwned(t.roles, roleId, "role");
                return replace(t.roles, { ...current, ...patch, updatedBy: actor.uid, updatedAt: this.now() });
            },
            setObjectPermission: async (roleId, objectId, cred) => {
                requireOwned(t.roles, roleId, "role");
                requireOwned(t.objects, objectId, "object");
                const existing = t.objectPermissions.find((p) => p.tenantId === tenantId && p.roleId === roleId && p.objectId === objectId);
                if (existing)
                    return replace(t.objectPermissions, { ...existing, cred, updatedBy: actor.uid, updatedAt: this.now() });
                const row = {
                    id: this.nextId(), tenantId, roleId, objectId, cred, ...this.stamp(actor),
                };
                t.objectPermissions.push(row);
                return row;
            },
            setFieldOverride: async (roleId, fieldId, override) => {
                requireOwned(t.roles, roleId, "role");
                requireOwned(t.fields, fieldId, "field");
                const at = (p) => p.tenantId === tenantId && p.roleId === roleId && p.fieldId === fieldId;
                const index = t.fieldOverrides.findIndex(at);
                // AN EMPTY OVERRIDE IS THE ABSENCE OF A ROW. Storing "{}" as well as "no row" would give
                // "this role has no opinion about this field" two spellings, and two spellings drift.
                if (Object.keys(override).length === 0) {
                    if (index >= 0)
                        t.fieldOverrides.splice(index, 1);
                    return;
                }
                if (index >= 0) {
                    t.fieldOverrides[index] = { ...t.fieldOverrides[index], override, updatedBy: actor.uid, updatedAt: this.now() };
                    return;
                }
                t.fieldOverrides.push({ id: this.nextId(), tenantId, roleId, fieldId, override, ...this.stamp(actor) });
            },
            createAssignment: async (input) => {
                // THE TWO STORE-LEVEL RULES MIGRATION 003 ADDS, mirrored so the adapters cannot disagree
                // about what is representable. The commands refuse both first; these are the backstop for a
                // writer that skipped them.
                //
                //   1. the principal must be a MEMBER of this tenant (composite foreign key)
                //   2. one ACTIVE row per (principal, role, normalized scope) (partial unique index)
                if (!t.memberships.some((m) => m.tenantId === tenantId && m.principalId === input.principalId)) {
                    throw new policyRepository_1.PolicyStoreError("that principal is not a member of this tenant");
                }
                if (input.status === "active" &&
                    t.assignments.some((a) => a.tenantId === tenantId &&
                        a.principalId === input.principalId &&
                        a.roleId === input.roleId &&
                        a.status === "active" &&
                        a.scopeType === input.scopeType &&
                        (a.scopeValue ?? "") === (input.scopeValue ?? ""))) {
                    throw new policyRepository_1.PolicyStoreError("an identical active assignment already exists");
                }
                requireOwned(t.roles, input.roleId, "role");
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.assignments.push(row);
                return row;
            },
            setAssignmentStatus: async (assignmentId, status) => {
                const current = requireOwned(t.assignments, assignmentId, "assignment");
                return replace(t.assignments, { ...current, status, updatedBy: actor.uid, updatedAt: this.now() });
            },
            bumpAccessVersion: async (principalId) => {
                const index = t.accessVersions.findIndex((v) => v.tenantId === tenantId && v.principalId === principalId);
                const next = index >= 0 ? t.accessVersions[index].accessVersion + 1 : 1;
                const row = { id: index >= 0 ? t.accessVersions[index].id : this.nextId(), tenantId, principalId, accessVersion: next, updatedAt: this.now() };
                if (index >= 0)
                    t.accessVersions[index] = row;
                else
                    t.accessVersions.push(row);
                return next;
            },
            createWorkflow: async (input) => {
                if (t.workflows.some((w) => w.tenantId === tenantId && w.key === input.key)) {
                    throw new policyRepository_1.PolicyStoreError(`workflow key "${input.key}" already exists`);
                }
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflows.push(row);
                return row;
            },
            createWorkflowVersion: async (input) => {
                requireOwned(t.workflows, input.workflowId, "workflow");
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflowVersions.push(row);
                return row;
            },
            createWorkflowStep: async (input) => {
                assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflowSteps.push(row);
                return row;
            },
            createWorkflowAction: async (input) => {
                assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflowActions.push(row);
                return row;
            },
            createWorkflowRoleBinding: async (input) => {
                assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
                requireOwned(t.roles, input.roleId, "role");
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflowRoleBindings.push(row);
                return row;
            },
            publishWorkflowVersion: async (versionId) => {
                const current = requireOwned(t.workflowVersions, versionId, "workflow version");
                assertDraft(current);
                const at = this.now();
                return replace(t.workflowVersions, {
                    ...current, status: "PUBLISHED", publishedAt: at, publishedBy: actor.uid, updatedBy: actor.uid, updatedAt: at,
                });
            },
            createWorkflowInstance: async (input) => {
                requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version");
                const row = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
                t.workflowInstances.push(row);
                return row;
            },
            advanceWorkflowInstance: async (instanceId, toStepKey) => {
                const current = requireOwned(t.workflowInstances, instanceId, "workflow instance");
                return replace(t.workflowInstances, {
                    ...current, currentStepKey: toStepKey, updatedBy: actor.uid, updatedAt: this.now(),
                });
            },
            appendWorkflowInstanceEvent: async (input) => {
                t.workflowInstanceEvents.push({ ...input, id: this.nextId(), tenantId });
            },
            appendAudit: async (input) => {
                t.audit.push({ ...input, id: this.nextId(), tenantId });
            },
        };
    }
    // ════════════════════ reads ════════════════════
    //
    // Every one filters by tenant first. There is no method that could return another tenant's row,
    // which is the property the tenancy proofs assert rather than a convention they trust.
    mine(rows, tenantId) {
        return rows.filter((r) => r.tenantId === tenantId);
    }
    // Tenant and identity reads. `getTenantByKey` is the one deliberately unscoped read in the port:
    // a bootstrap has to ask whether a tenant exists before there is a tenant to scope by. It returns
    // one tenant found by its own key and nothing owned by it.
    async getTenantByKey(key) { return this.tables.tenants.find((x) => x.key === key) ?? null; }
    async getTenant(tenantId) { return this.tables.tenants.find((x) => x.id === tenantId) ?? null; }
    async getPrincipalBySubject(identityProvider, externalSubject) {
        return this.tables.principals.find((x) => x.identityProvider === identityProvider && x.externalSubject === externalSubject) ?? null;
    }
    async getPrincipal(principalId) {
        return this.tables.principals.find((x) => x.id === principalId) ?? null;
    }
    async listMembershipsForPrincipal(principalId) {
        return this.tables.memberships.filter((m) => m.principalId === principalId);
    }
    async getMembership(tenantId, principalId) {
        return this.mine(this.tables.memberships, tenantId).find((m) => m.principalId === principalId) ?? null;
    }
    async listTenantPrincipalIds(tenantId) {
        return this.mine(this.tables.memberships, tenantId).map((m) => m.principalId);
    }
    async getAdminBootstrap(tenantId) {
        return this.tables.adminBootstraps.find((b) => b.tenantId === tenantId) ?? null;
    }
    async listObjects(tenantId) { return this.mine(this.tables.objects, tenantId); }
    async getObjectByKey(tenantId, key) {
        return this.mine(this.tables.objects, tenantId).find((o) => o.key === key) ?? null;
    }
    async listFields(tenantId, objectId) {
        return this.mine(this.tables.fields, tenantId).filter((f) => f.objectId === objectId);
    }
    async listRoles(tenantId) { return this.mine(this.tables.roles, tenantId); }
    async getRoleByKey(tenantId, key) {
        return this.mine(this.tables.roles, tenantId).find((r) => r.key === key) ?? null;
    }
    async listObjectPermissions(tenantId, roleIds) {
        return this.mine(this.tables.objectPermissions, tenantId).filter((p) => roleIds.includes(p.roleId));
    }
    async listFieldOverrides(tenantId, roleIds) {
        return this.mine(this.tables.fieldOverrides, tenantId).filter((p) => roleIds.includes(p.roleId));
    }
    async listAssignmentsForPrincipal(tenantId, principalId) {
        return this.mine(this.tables.assignments, tenantId).filter((a) => a.principalId === principalId);
    }
    async getAccessVersion(tenantId, principalId) {
        return this.mine(this.tables.accessVersions, tenantId).find((v) => v.principalId === principalId) ?? null;
    }
    async listWorkflows(tenantId) { return this.mine(this.tables.workflows, tenantId); }
    async listWorkflowVersions(tenantId, workflowId) {
        return this.mine(this.tables.workflowVersions, tenantId).filter((v) => v.workflowId === workflowId);
    }
    async listWorkflowSteps(tenantId, versionId) {
        return this.mine(this.tables.workflowSteps, tenantId).filter((s) => s.workflowVersionId === versionId);
    }
    async listWorkflowActions(tenantId, versionId) {
        return this.mine(this.tables.workflowActions, tenantId).filter((a) => a.workflowVersionId === versionId);
    }
    async listWorkflowRoleBindings(tenantId, versionId) {
        return this.mine(this.tables.workflowRoleBindings, tenantId).filter((b) => b.workflowVersionId === versionId);
    }
    async getWorkflowInstance(tenantId, objectKey, recordId) {
        return this.mine(this.tables.workflowInstances, tenantId)
            .find((i) => i.objectKey === objectKey && i.recordId === recordId) ?? null;
    }
    async listAuditEvents(tenantId, limit) {
        return this.mine(this.tables.audit, tenantId).slice(-limit);
    }
}
exports.InMemoryPolicyRepository = InMemoryPolicyRepository;
/**
 * A PUBLISHED version is immutable.
 *
 * Enforced in the store rather than only in the service, because "editing v2 must not retroactively
 * reinterpret an in-flight v1 instance" is a property of the data, and a second writer that skipped
 * the service would otherwise break it silently.
 */
function assertDraft(version) {
    if (version.status !== "DRAFT") {
        throw new policyRepository_1.PolicyStoreError(`workflow version ${version.version} is ${version.status} and cannot be edited`);
    }
}
/** Convenience for tests and seeds. Nothing in production constructs a repository inline. */
const createInMemoryPolicyRepository = (options) => new InMemoryPolicyRepository(options);
exports.createInMemoryPolicyRepository = createInMemoryPolicyRepository;
//# sourceMappingURL=inMemoryPolicyRepository.js.map