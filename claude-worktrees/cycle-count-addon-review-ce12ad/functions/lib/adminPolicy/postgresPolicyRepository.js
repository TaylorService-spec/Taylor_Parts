"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresPolicyRepository = void 0;
// The PostgreSQL PolicyRepository adapter.
//
// ════════════════════ THE ONLY FILE THAT KNOWS WHAT A DATABASE IS ════════════════════
//
//   EOS service -> PolicyRepository / DAL -> THIS ADAPTER -> PostgreSQL
//
// Nothing above the port imports `pg`, sees a row, or knows a column name. The resolver, the
// commands, the seed and every UI module speak the domain contracts in types.ts; SQL stops here.
// That boundary is what lets the deployment posture change later -- shared database, dedicated
// customer database, dedicated environment -- without EOS business code changing.
//
// ════════════════════ STANDARD POSTGRESQL, DELIBERATELY ════════════════════
//
// The production target is Render, and nothing in this file knows that. No Render API, no
// Render-specific extension, no managed-platform assumption: the same adapter runs against a local
// cluster, against CI, and against any managed Postgres. Connection details arrive as injected
// configuration and are never read from a literal here.
//
// ════════════════════ ONE POOL PER PROCESS ════════════════════
//
// A Pool is a long-lived resource holding real sockets. Constructing one per request exhausts the
// server's connection slots under exactly the load that makes it matter, and each new pool starts
// cold. This adapter therefore RECEIVES a pool; `createPolicyDatabasePool` in policyDatabase.ts
// makes the single one a process should own.
//
// ════════════════════ TRANSACTIONS ════════════════════
//
// `transact` takes ONE client out of the pool, runs BEGIN, hands the caller a transaction bound to
// that client, and COMMITs or ROLLBACKs. Every write in a unit of work therefore lands on the same
// connection -- which is what makes "a policy change and its access-version bump and its audit
// event land together or not at all" true rather than hoped for.
const node_crypto_1 = require("node:crypto");
const policyRepository_1 = require("./policyRepository");
const SCHEMA = "eos_policy";
/** Every id this adapter mints. Opaque above the port; a UUID is simply the cheapest opaque thing. */
const newId = () => (0, node_crypto_1.randomUUID)();
const nowIso = () => new Date().toISOString();
/** A timestamptz comes back as a Date. The domain speaks ISO strings, so the seam converts. */
function iso(value) {
    if (value instanceof Date)
        return value.toISOString();
    return typeof value === "string" ? value : "";
}
function isoOrNull(value) {
    if (value === null || value === undefined)
        return null;
    return iso(value);
}
// ════════════════════ row mappers ════════════════════
//
// One direction only. The database's names are snake_case and the domain's are camelCase, and the
// translation lives here so neither side has to know the other's spelling.
const provenance = (r) => ({
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
    updatedBy: String(r.updated_by),
    updatedAt: iso(r.updated_at),
});
const toTenant = (r) => ({
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    status: String(r.status),
    configurationVersion: Number(r.configuration_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
});
const toPrincipal = (r) => ({
    id: String(r.id),
    externalSubject: String(r.external_subject),
    identityProvider: String(r.identity_provider),
    displayName: r.display_name === null || r.display_name === undefined ? null : String(r.display_name),
    status: String(r.status),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
});
const toMembership = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    principalId: String(r.principal_id),
    status: String(r.status),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
});
const toAdminBootstrap = (r) => ({
    tenantId: String(r.tenant_id),
    principalId: String(r.principal_id),
    performedBy: String(r.performed_by),
    reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
    performedAt: iso(r.performed_at),
});
const toObject = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    key: String(r.key),
    label: String(r.label),
    labelPlural: r.label_plural ?? null,
    description: r.description ?? null,
    origin: r.origin,
    lifecycle: r.lifecycle,
    supportsDelete: r.supports_delete === true,
    ...provenance(r),
});
const toField = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    objectId: String(r.object_id),
    key: String(r.key),
    label: String(r.label),
    description: r.description ?? null,
    dataType: r.data_type,
    required: r.required === true,
    allowedValues: Object.freeze([...(r.allowed_values ?? [])]),
    // A default is stored as TEXT because one column cannot be four types. The domain's own value is
    // a string for exactly that reason -- reconstructing a number or boolean here would be guessing
    // at which, and guessing wrong on a boolean default is a silent behaviour change.
    defaultValue: r.default_value ?? null,
    searchable: r.searchable === true,
    sortable: r.sortable === true,
    reportable: r.reportable === true,
    sensitivity: r.sensitivity,
    referenceTo: r.reference_to ?? null,
    origin: r.origin,
    lifecycle: r.lifecycle,
    ...provenance(r),
});
const toRole = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    key: String(r.key),
    name: String(r.name),
    description: r.description ?? null,
    origin: r.origin,
    protected: r.protected === true,
    ...provenance(r),
});
const toObjectPermission = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    roleId: String(r.role_id),
    objectId: String(r.object_id),
    cred: Object.freeze({
        C: r.can_create === true,
        R: r.can_read === true,
        E: r.can_edit === true,
        D: r.can_delete === true,
    }),
    ...provenance(r),
});
/** NULL means INHERIT, so a null column is an ABSENT key rather than a `false`. */
const toFieldOverride = (r) => {
    const override = {};
    if (r.can_create !== null)
        override.C = r.can_create === true;
    if (r.can_read !== null)
        override.R = r.can_read === true;
    if (r.can_edit !== null)
        override.E = r.can_edit === true;
    if (r.can_delete !== null)
        override.D = r.can_delete === true;
    return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        roleId: String(r.role_id),
        fieldId: String(r.field_id),
        override: Object.freeze(override),
        ...provenance(r),
    };
};
const toAssignment = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    principalId: String(r.principal_id),
    roleId: String(r.role_id),
    scopeType: String(r.scope_type),
    scopeValue: r.scope_value ?? null,
    status: r.status,
    grantedBy: String(r.granted_by),
    grantedAt: iso(r.granted_at),
    accessVersionAtGrant: Number(r.access_version_at_grant),
    ...provenance(r),
});
const toWorkflow = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    key: String(r.key),
    name: String(r.name),
    description: r.description ?? null,
    objectKey: r.object_key ?? null,
    origin: r.origin,
    ...provenance(r),
});
const toWorkflowVersion = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    workflowId: String(r.workflow_id),
    version: Number(r.version),
    status: r.status,
    publishedAt: isoOrNull(r.published_at),
    publishedBy: r.published_by ?? null,
    ...provenance(r),
});
const toStep = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    workflowVersionId: String(r.workflow_version_id),
    key: String(r.key),
    label: String(r.label),
    initial: r.is_initial === true,
    terminal: r.is_terminal === true,
    ...provenance(r),
});
const toAction = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    workflowVersionId: String(r.workflow_version_id),
    key: String(r.key),
    label: String(r.label),
    fromStepKey: String(r.from_step_key),
    toStepKey: String(r.to_step_key),
    requiresOwnAssignment: r.requires_own_assignment === true,
    ...provenance(r),
});
const toBinding = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    workflowVersionId: String(r.workflow_version_id),
    actionKey: String(r.action_key),
    roleId: String(r.role_id),
    ...provenance(r),
});
const toInstance = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    workflowVersionId: String(r.workflow_version_id),
    objectKey: String(r.object_key),
    recordId: String(r.record_id),
    currentStepKey: String(r.current_step_key),
    ...provenance(r),
});
const toAudit = (r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    action: String(r.action),
    actorUid: String(r.actor_uid),
    targetKind: String(r.target_kind),
    targetId: String(r.target_id),
    before: r.before ?? null,
    after: r.after ?? null,
    occurredAt: iso(r.occurred_at),
    reason: r.reason ?? null,
});
// ════════════════════ the adapter ════════════════════
class PostgresPolicyRepository {
    pool;
    /**
     * @param pool a SHARED, long-lived pool. See policyDatabase.ts -- one per process, never per
     *             request. This adapter never constructs one, so it cannot accidentally make a second.
     */
    constructor(pool) {
        this.pool = pool;
    }
    async transact(actor, fn) {
        if (!actor?.tenantId)
            throw new policyRepository_1.PolicyStoreError("a tenant is required");
        if (!actor?.uid)
            throw new policyRepository_1.PolicyStoreError("an actor uid is required");
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(makeTransaction(client, actor));
            await client.query("COMMIT");
            return result;
        }
        catch (err) {
            // ROLLBACK is itself allowed to fail (a dead connection), and swallowing that would hide the
            // ORIGINAL error behind a secondary one. The original is what the caller needs.
            try {
                await client.query("ROLLBACK");
            }
            catch {
                /* the original error is rethrown below */
            }
            throw err;
        }
        finally {
            // ALWAYS released. A leaked client is a pool slot gone for the life of the process, and the
            // symptom appears much later as an unexplained hang.
            client.release();
        }
    }
    // ── reads. Every one is tenant-scoped in SQL, not in JavaScript after the fact. ──
    async many(text, values, map) {
        const { rows } = await this.pool.query(text, values);
        return rows.map(map);
    }
    async one(text, values, map) {
        const rows = await this.many(text, values, map);
        return rows[0] ?? null;
    }
    // TENANT AND IDENTITY.
    //
    // `getTenantByKey` is the one read in this adapter with no tenant predicate, and deliberately so:
    // a bootstrap must be able to ask whether a tenant exists before there is a tenant to scope by.
    // It selects ONE tenant by its own natural key and returns nothing owned by it, so it cannot be
    // turned into a cross-tenant read of policy.
    getTenantByKey(key) {
        return this.one(`SELECT * FROM ${SCHEMA}.tenants WHERE key = $1`, [key], toTenant);
    }
    getTenant(tenantId) {
        return this.one(`SELECT * FROM ${SCHEMA}.tenants WHERE id = $1`, [tenantId], toTenant);
    }
    getPrincipalBySubject(identityProvider, externalSubject) {
        return this.one(`SELECT * FROM ${SCHEMA}.principals WHERE identity_provider = $1 AND external_subject = $2`, [identityProvider, externalSubject], toPrincipal);
    }
    getPrincipal(principalId) {
        return this.one(`SELECT * FROM ${SCHEMA}.principals WHERE id = $1`, [principalId], toPrincipal);
    }
    listMembershipsForPrincipal(principalId) {
        return this.many(`SELECT * FROM ${SCHEMA}.tenant_memberships WHERE principal_id = $1 ORDER BY created_at`, [principalId], toMembership);
    }
    getMembership(tenantId, principalId) {
        return this.one(`SELECT * FROM ${SCHEMA}.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2`, [tenantId, principalId], toMembership);
    }
    async listTenantPrincipalIds(tenantId) {
        const { rows } = await this.pool.query(`SELECT principal_id FROM ${SCHEMA}.tenant_memberships WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
        return rows.map((r) => String(r.principal_id));
    }
    getAdminBootstrap(tenantId) {
        return this.one(`SELECT * FROM ${SCHEMA}.tenant_admin_bootstraps WHERE tenant_id = $1`, [tenantId], toAdminBootstrap);
    }
    listObjects(tenantId) {
        return this.many(`SELECT * FROM ${SCHEMA}.objects WHERE tenant_id = $1 ORDER BY key`, [tenantId], toObject);
    }
    getObjectByKey(tenantId, key) {
        return this.one(`SELECT * FROM ${SCHEMA}.objects WHERE tenant_id = $1 AND key = $2`, [tenantId, key], toObject);
    }
    listFields(tenantId, objectId) {
        return this.many(`SELECT * FROM ${SCHEMA}.object_fields WHERE tenant_id = $1 AND object_id = $2 ORDER BY key`, [tenantId, objectId], toField);
    }
    listRoles(tenantId) {
        return this.many(`SELECT * FROM ${SCHEMA}.roles WHERE tenant_id = $1 ORDER BY key`, [tenantId], toRole);
    }
    getRoleByKey(tenantId, key) {
        return this.one(`SELECT * FROM ${SCHEMA}.roles WHERE tenant_id = $1 AND key = $2`, [tenantId, key], toRole);
    }
    listObjectPermissions(tenantId, roleIds) {
        if (roleIds.length === 0)
            return Promise.resolve([]);
        return this.many(`SELECT * FROM ${SCHEMA}.role_object_permissions WHERE tenant_id = $1 AND role_id = ANY($2)`, [tenantId, [...roleIds]], toObjectPermission);
    }
    listFieldOverrides(tenantId, roleIds) {
        if (roleIds.length === 0)
            return Promise.resolve([]);
        return this.many(`SELECT * FROM ${SCHEMA}.role_field_permission_overrides WHERE tenant_id = $1 AND role_id = ANY($2)`, [tenantId, [...roleIds]], toFieldOverride);
    }
    listAssignmentsForPrincipal(tenantId, principalId) {
        return this.many(`SELECT * FROM ${SCHEMA}.user_role_assignments WHERE tenant_id = $1 AND principal_id = $2 ORDER BY granted_at`, [tenantId, principalId], toAssignment);
    }
    getAccessVersion(tenantId, principalId) {
        return this.one(`SELECT * FROM ${SCHEMA}.principal_access_versions WHERE tenant_id = $1 AND principal_id = $2`, [tenantId, principalId], (r) => ({
            id: String(r.id),
            tenantId: String(r.tenant_id),
            principalId: String(r.principal_id),
            accessVersion: Number(r.access_version),
            updatedAt: iso(r.updated_at),
        }));
    }
    listWorkflows(tenantId) {
        return this.many(`SELECT * FROM ${SCHEMA}.workflows WHERE tenant_id = $1 ORDER BY key`, [tenantId], toWorkflow);
    }
    listWorkflowVersions(tenantId, workflowId) {
        return this.many(`SELECT * FROM ${SCHEMA}.workflow_versions WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY version`, [tenantId, workflowId], toWorkflowVersion);
    }
    listWorkflowSteps(tenantId, versionId) {
        return this.many(`SELECT * FROM ${SCHEMA}.workflow_steps WHERE tenant_id = $1 AND workflow_version_id = $2 ORDER BY key`, [tenantId, versionId], toStep);
    }
    listWorkflowActions(tenantId, versionId) {
        return this.many(`SELECT * FROM ${SCHEMA}.workflow_actions WHERE tenant_id = $1 AND workflow_version_id = $2 ORDER BY key`, [tenantId, versionId], toAction);
    }
    listWorkflowRoleBindings(tenantId, versionId) {
        return this.many(`SELECT * FROM ${SCHEMA}.workflow_role_bindings WHERE tenant_id = $1 AND workflow_version_id = $2`, [tenantId, versionId], toBinding);
    }
    getWorkflowInstance(tenantId, objectKey, recordId) {
        return this.one(`SELECT * FROM ${SCHEMA}.workflow_instances WHERE tenant_id = $1 AND object_key = $2 AND record_id = $3`, [tenantId, objectKey, recordId], toInstance);
    }
    listAuditEvents(tenantId, limit) {
        // Ordered ASC and bounded from the END, so "the last N" reads in the order they happened. A
        // DESC page reversed in JavaScript would be the same rows in a different order, and the callers
        // that diff before/after sequences care which.
        return this.many(`SELECT * FROM (
         SELECT * FROM ${SCHEMA}.audit_events WHERE tenant_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2
       ) recent ORDER BY occurred_at ASC, id ASC`, [tenantId, limit], toAudit);
    }
}
exports.PostgresPolicyRepository = PostgresPolicyRepository;
// ════════════════════ the transaction ════════════════════
function makeTransaction(client, actor) {
    const tenantId = actor.tenantId;
    const q = client;
    /** Provenance columns, in insert order, for every stamped table. */
    const stamp = () => {
        const at = nowIso();
        return [actor.uid, at, actor.uid, at];
    };
    /**
     * A tenant-scoped fetch inside the transaction.
     *
     * A row belonging to ANOTHER tenant reports the same "not found" as one that does not exist.
     * Distinguishing them would confirm the other tenant's row exists, which is itself a leak.
     */
    const requireOwned = async (table, id, kind) => {
        const { rows } = await q.query(`SELECT * FROM ${SCHEMA}.${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        if (rows.length === 0)
            throw new policyRepository_1.PolicyStoreError(`${kind} not found`);
        return rows[0];
    };
    const assertDraftVersion = async (versionId) => {
        const row = await requireOwned("workflow_versions", versionId, "workflow version");
        if (row.status !== "DRAFT") {
            throw new policyRepository_1.PolicyStoreError(`workflow version ${row.version} is ${row.status} and cannot be edited`);
        }
        return row;
    };
    /** Postgres raises 23505 on a unique violation; the domain says so in words. */
    const asDuplicate = (err, message) => {
        if (err?.code === "23505")
            throw new policyRepository_1.PolicyStoreError(message);
        throw err;
    };
    return {
        // ════════════════════ tenant and identity ════════════════════
        async createTenant(input) {
            // The tenant's id IS the actor's tenantId. The caller generated it before opening the
            // transaction, so every row written in the same unit of work already references a tenant that
            // exists -- which is what lets "create the tenant and seed it" be one atomic thing.
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.tenants (id, key, name, status, configuration_version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`, [tenantId, input.key, input.name, input.status ?? "active", input.configurationVersion ?? 0]);
                return toTenant(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, `tenant key "${input.key}" already exists`);
            }
        },
        async setTenantConfigurationVersion(id, version) {
            const { rows } = await q.query(`UPDATE ${SCHEMA}.tenants SET configuration_version = $1, updated_at = now()
         WHERE id = $2 AND id = $3 RETURNING *`, [version, id, tenantId]);
            if (rows.length === 0)
                throw new policyRepository_1.PolicyStoreError("tenant not found");
            return toTenant(rows[0]);
        },
        async createPrincipal(input) {
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.principals
             (id, external_subject, identity_provider, display_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`, [newId(), input.externalSubject, input.identityProvider, input.displayName ?? null, input.status ?? "active"]);
                return toPrincipal(rows[0]);
            }
            catch (err) {
                // One subject per provider is one principal. A second would split one human's Roles in half.
                return asDuplicate(err, "principal already exists for that subject");
            }
        },
        async createTenantMembership(principalId, status) {
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.tenant_memberships
             (id, tenant_id, principal_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, now(), now()) RETURNING *`, [newId(), tenantId, principalId, status ?? "active"]);
                return toMembership(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, "membership already exists");
            }
        },
        async setTenantMembershipStatus(membershipId, status) {
            const { rows } = await q.query(`UPDATE ${SCHEMA}.tenant_memberships SET status = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 RETURNING *`, [status, membershipId, tenantId]);
            if (rows.length === 0)
                throw new policyRepository_1.PolicyStoreError("membership not found");
            return toMembership(rows[0]);
        },
        async recordAdminBootstrap(input) {
            // ONE PER TENANT, enforced by the PRIMARY KEY rather than by a read-then-write the caller
            // could race. Two concurrent bootstraps: one commits, the other is refused by the database.
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.tenant_admin_bootstraps
             (tenant_id, principal_id, performed_by, reason, performed_at)
           VALUES ($1, $2, $3, $4, now()) RETURNING *`, [tenantId, input.principalId, input.performedBy, input.reason ?? null]);
                return toAdminBootstrap(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, "this tenant has already been bootstrapped");
            }
        },
        async createObject(input) {
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.objects
             (id, tenant_id, key, label, label_plural, description, origin, lifecycle, supports_delete,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [newId(), tenantId, input.key, input.label, input.labelPlural, input.description,
                    input.origin, input.lifecycle, input.supportsDelete, ...stamp()]);
                return toObject(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, `object key "${input.key}" already exists`);
            }
        },
        async updateObject(objectId, patch) {
            await requireOwned("objects", objectId, "object");
            // COALESCE keeps an omitted field untouched rather than nulling it: a patch that names only
            // the label must not silently erase the description.
            const { rows } = await q.query(`UPDATE ${SCHEMA}.objects
            SET label        = COALESCE($1, label),
                label_plural = CASE WHEN $2::boolean THEN $3 ELSE label_plural END,
                description  = CASE WHEN $4::boolean THEN $5 ELSE description END,
                updated_by = $6, updated_at = $7
          WHERE id = $8 AND tenant_id = $9 RETURNING *`, [
                patch.label ?? null,
                patch.labelPlural !== undefined, patch.labelPlural ?? null,
                patch.description !== undefined, patch.description ?? null,
                actor.uid, nowIso(), objectId, tenantId,
            ]);
            if (rows.length === 0)
                throw new policyRepository_1.PolicyStoreError("object not found");
            return toObject(rows[0]);
        },
        async createField(input) {
            await requireOwned("objects", input.objectId, "object");
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.object_fields
             (id, tenant_id, object_id, key, label, description, data_type, required, allowed_values,
              default_value, searchable, sortable, reportable, sensitivity, reference_to, origin, lifecycle,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, [newId(), tenantId, input.objectId, input.key, input.label, input.description, input.dataType,
                    input.required, [...input.allowedValues],
                    input.defaultValue === null ? null : String(input.defaultValue),
                    input.searchable, input.sortable, input.reportable, input.sensitivity, input.referenceTo,
                    input.origin, input.lifecycle, ...stamp()]);
                return toField(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, `field key "${input.key}" already exists on this object`);
            }
        },
        async updateField(fieldId, patch) {
            await requireOwned("object_fields", fieldId, "field");
            // COLUMN NAMES ARE NOT INTERPOLATED FROM CALLER KEYS. Each is named literally here, so a patch
            // carrying an unexpected property cannot reach the SQL text -- and `key` and `data_type` are
            // simply absent, which is what makes "a field cannot be re-keyed or retyped" structural.
            const sets = [];
            const values = [];
            const set = (column, value) => {
                values.push(value);
                sets.push(`${column} = $${values.length}`);
            };
            if (patch.label !== undefined)
                set("label", patch.label);
            if (patch.description !== undefined)
                set("description", patch.description);
            if (patch.required !== undefined)
                set("required", patch.required);
            if (patch.searchable !== undefined)
                set("searchable", patch.searchable);
            if (patch.sortable !== undefined)
                set("sortable", patch.sortable);
            if (patch.reportable !== undefined)
                set("reportable", patch.reportable);
            if (patch.sensitivity !== undefined)
                set("sensitivity", patch.sensitivity);
            if (patch.lifecycle !== undefined)
                set("lifecycle", patch.lifecycle);
            set("updated_by", actor.uid);
            set("updated_at", nowIso());
            values.push(fieldId, tenantId);
            const { rows } = await q.query(`UPDATE ${SCHEMA}.object_fields SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`, values);
            return toField(rows[0]);
        },
        async createRole(input) {
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.roles (id, tenant_id, key, name, description, origin, protected,
             created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newId(), tenantId, input.key, input.name, input.description, input.origin, input.protected, ...stamp()]);
                return toRole(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, `role key "${input.key}" already exists`);
            }
        },
        async updateRole(roleId, patch) {
            await requireOwned("roles", roleId, "role");
            const sets = [];
            const values = [];
            const set = (column, value) => {
                values.push(value);
                sets.push(`${column} = $${values.length}`);
            };
            if (patch.name !== undefined)
                set("name", patch.name);
            if (patch.description !== undefined)
                set("description", patch.description);
            set("updated_by", actor.uid);
            set("updated_at", nowIso());
            values.push(roleId, tenantId);
            const { rows } = await q.query(`UPDATE ${SCHEMA}.roles SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`, values);
            return toRole(rows[0]);
        },
        async setObjectPermission(roleId, objectId, cred) {
            await requireOwned("roles", roleId, "role");
            await requireOwned("objects", objectId, "object");
            // UPSERT on the natural key, so setting a permission twice is one row rather than a duplicate
            // the resolver would have to union with itself.
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.role_object_permissions
           (id, tenant_id, role_id, object_id, can_create, can_read, can_edit, can_delete,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, role_id, object_id) DO UPDATE
           SET can_create = EXCLUDED.can_create, can_read = EXCLUDED.can_read,
               can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
               updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
         RETURNING *`, [newId(), tenantId, roleId, objectId, cred.C, cred.R, cred.E, cred.D, ...stamp()]);
            return toObjectPermission(rows[0]);
        },
        async setFieldOverride(roleId, fieldId, override) {
            await requireOwned("roles", roleId, "role");
            await requireOwned("object_fields", fieldId, "field");
            // AN EMPTY OVERRIDE IS THE ABSENCE OF A ROW. The table's own CHECK refuses an all-NULL row for
            // the same reason: "no opinion" gets one spelling, not two.
            if (Object.keys(override).length === 0) {
                await q.query(`DELETE FROM ${SCHEMA}.role_field_permission_overrides
           WHERE tenant_id = $1 AND role_id = $2 AND field_id = $3`, [tenantId, roleId, fieldId]);
                return;
            }
            const val = (verb) => (override[verb] === undefined ? null : override[verb]);
            await q.query(`INSERT INTO ${SCHEMA}.role_field_permission_overrides
           (id, tenant_id, role_id, field_id, can_create, can_read, can_edit, can_delete,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, role_id, field_id) DO UPDATE
           SET can_create = EXCLUDED.can_create, can_read = EXCLUDED.can_read,
               can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
               updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`, [newId(), tenantId, roleId, fieldId, val("C"), val("R"), val("E"), val("D"), ...stamp()]);
        },
        async createAssignment(input) {
            await requireOwned("roles", input.roleId, "role");
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.user_role_assignments
             (id, tenant_id, principal_id, role_id, scope_type, scope_value, status, granted_by, granted_at,
              access_version_at_grant, created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [newId(), tenantId, input.principalId, input.roleId, input.scopeType, input.scopeValue,
                    input.status, input.grantedBy, input.grantedAt, input.accessVersionAtGrant, ...stamp()]);
                return toAssignment(rows[0]);
            }
            catch (err) {
                // Two different mistakes, and an administrator should be told which. 23503 is the composite
                // membership foreign key -- a Role granted to somebody who is not in this tenant. 23505 is
                // the one-active-row index -- the same effective assignment, twice.
                if (err?.code === "23503") {
                    throw new policyRepository_1.PolicyStoreError("that principal is not a member of this tenant");
                }
                return asDuplicate(err, "an identical active assignment already exists");
            }
        },
        async setAssignmentStatus(assignmentId, status) {
            await requireOwned("user_role_assignments", assignmentId, "assignment");
            const { rows } = await q.query(`UPDATE ${SCHEMA}.user_role_assignments SET status = $1, updated_by = $2, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 RETURNING *`, [status, actor.uid, nowIso(), assignmentId, tenantId]);
            return toAssignment(rows[0]);
        },
        async bumpAccessVersion(principalId) {
            // ONE STATEMENT, so two concurrent bumps cannot both read the same old value and write the
            // same new one. A read-then-write here would be a lost update, and a lost access-version bump
            // means a revoked grant stays cached as valid.
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.principal_access_versions (id, tenant_id, principal_id, access_version, updated_at)
         VALUES ($1,$2,$3,1,$4)
         ON CONFLICT (tenant_id, principal_id) DO UPDATE
           SET access_version = ${SCHEMA}.principal_access_versions.access_version + 1,
               updated_at = EXCLUDED.updated_at
         RETURNING access_version`, [newId(), tenantId, principalId, nowIso()]);
            return Number(rows[0].access_version);
        },
        async createWorkflow(input) {
            try {
                const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflows (id, tenant_id, key, name, description, object_key, origin,
             created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newId(), tenantId, input.key, input.name, input.description, input.objectKey, input.origin, ...stamp()]);
                return toWorkflow(rows[0]);
            }
            catch (err) {
                return asDuplicate(err, `workflow key "${input.key}" already exists`);
            }
        },
        async createWorkflowVersion(input) {
            await requireOwned("workflows", input.workflowId, "workflow");
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflow_versions (id, tenant_id, workflow_id, version, status,
           published_at, published_by, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newId(), tenantId, input.workflowId, input.version, input.status, input.publishedAt,
                input.publishedBy, ...stamp()]);
            return toWorkflowVersion(rows[0]);
        },
        async createWorkflowStep(input) {
            await assertDraftVersion(input.workflowVersionId);
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflow_steps (id, tenant_id, workflow_version_id, key, label,
           is_initial, is_terminal, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newId(), tenantId, input.workflowVersionId, input.key, input.label, input.initial, input.terminal, ...stamp()]);
            return toStep(rows[0]);
        },
        async createWorkflowAction(input) {
            await assertDraftVersion(input.workflowVersionId);
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflow_actions (id, tenant_id, workflow_version_id, key, label,
           from_step_key, to_step_key, requires_own_assignment, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [newId(), tenantId, input.workflowVersionId, input.key, input.label, input.fromStepKey,
                input.toStepKey, input.requiresOwnAssignment, ...stamp()]);
            return toAction(rows[0]);
        },
        async createWorkflowRoleBinding(input) {
            await assertDraftVersion(input.workflowVersionId);
            await requireOwned("roles", input.roleId, "role");
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflow_role_bindings (id, tenant_id, workflow_version_id, action_key,
           role_id, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [newId(), tenantId, input.workflowVersionId, input.actionKey, input.roleId, ...stamp()]);
            return toBinding(rows[0]);
        },
        async publishWorkflowVersion(versionId) {
            await assertDraftVersion(versionId);
            const at = nowIso();
            const { rows } = await q.query(`UPDATE ${SCHEMA}.workflow_versions
         SET status = 'PUBLISHED', published_at = $1, published_by = $2, updated_by = $2, updated_at = $1
         WHERE id = $3 AND tenant_id = $4 RETURNING *`, [at, actor.uid, versionId, tenantId]);
            return toWorkflowVersion(rows[0]);
        },
        async createWorkflowInstance(input) {
            await requireOwned("workflow_versions", input.workflowVersionId, "workflow version");
            const { rows } = await q.query(`INSERT INTO ${SCHEMA}.workflow_instances (id, tenant_id, workflow_version_id, object_key,
           record_id, current_step_key, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [newId(), tenantId, input.workflowVersionId, input.objectKey, input.recordId, input.currentStepKey, ...stamp()]);
            return toInstance(rows[0]);
        },
        async advanceWorkflowInstance(instanceId, toStepKey) {
            await requireOwned("workflow_instances", instanceId, "workflow instance");
            const { rows } = await q.query(`UPDATE ${SCHEMA}.workflow_instances SET current_step_key = $1, updated_by = $2, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 RETURNING *`, [toStepKey, actor.uid, nowIso(), instanceId, tenantId]);
            return toInstance(rows[0]);
        },
        async appendWorkflowInstanceEvent(input) {
            await q.query(`INSERT INTO ${SCHEMA}.workflow_instance_events (id, tenant_id, instance_id, action_key,
           from_step_key, to_step_key, actor_uid, occurred_at, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [newId(), tenantId, input.instanceId, input.actionKey, input.fromStepKey, input.toStepKey,
                input.actorUid, input.occurredAt, input.reason]);
        },
        async appendAudit(input) {
            await q.query(`INSERT INTO ${SCHEMA}.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id,
           before, after, occurred_at, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [newId(), tenantId, input.action, input.actorUid, input.targetKind, input.targetId,
                input.before === null || input.before === undefined ? null : JSON.stringify(input.before),
                input.after === null || input.after === undefined ? null : JSON.stringify(input.after),
                input.occurredAt, input.reason]);
        },
    };
}
//# sourceMappingURL=postgresPolicyRepository.js.map