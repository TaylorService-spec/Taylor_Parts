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
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PolicyStoreError } from "./policyRepository";
import type {
  NewAdminBootstrapInput,
  NewPrincipalInput,
  NewRecord,
  NewTenantInput,
  PolicyActor,
  PolicyRepository,
  PolicyTransaction,
} from "./policyRepository";
import type {
  CredOverride,
  CredSet,
  ObjectFieldRecord,
  ObjectRecord,
  PolicyAssignmentStatus,
  PolicyAuditEventRecord,
  PolicyRoleAssignmentRecord,
  PolicyRoleRecord,
  PrincipalAccessVersionRecord,
  PrincipalRecord,
  PrincipalStatus,
  TenantAdminBootstrapRecord,
  TenantMembershipRecord,
  TenantRecord,
  RoleFieldPermissionOverrideRecord,
  RoleObjectPermissionRecord,
  TenantId,
  WorkflowActionRecord,
  WorkflowInstanceEventRecord,
  WorkflowInstanceRecord,
  WorkflowRecord,
  WorkflowRoleBindingRecord,
  WorkflowStepRecord,
  WorkflowVersionRecord,
} from "./types";

/** Anything that can run a query -- the pool for reads, one checked-out client inside a transaction. */
interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const SCHEMA = "eos_policy";

/** Every id this adapter mints. Opaque above the port; a UUID is simply the cheapest opaque thing. */
const newId = (): string => randomUUID();

const nowIso = (): string => new Date().toISOString();

/** A timestamptz comes back as a Date. The domain speaks ISO strings, so the seam converts. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

// ════════════════════ row mappers ════════════════════
//
// One direction only. The database's names are snake_case and the domain's are camelCase, and the
// translation lives here so neither side has to know the other's spelling.

const provenance = (r: Record<string, unknown>) => ({
  createdBy: String(r.created_by),
  createdAt: iso(r.created_at),
  updatedBy: String(r.updated_by),
  updatedAt: iso(r.updated_at),
});

const toTenant = (r: Record<string, unknown>): TenantRecord => ({
  id: String(r.id),
  key: String(r.key),
  name: String(r.name),
  status: String(r.status) as TenantRecord["status"],
  configurationVersion: Number(r.configuration_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toPrincipal = (r: Record<string, unknown>): PrincipalRecord => ({
  id: String(r.id),
  externalSubject: String(r.external_subject),
  identityProvider: String(r.identity_provider),
  displayName: r.display_name === null || r.display_name === undefined ? null : String(r.display_name),
  status: String(r.status) as PrincipalStatus,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toMembership = (r: Record<string, unknown>): TenantMembershipRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  principalId: String(r.principal_id),
  status: String(r.status) as PrincipalStatus,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toAdminBootstrap = (r: Record<string, unknown>): TenantAdminBootstrapRecord => ({
  tenantId: String(r.tenant_id),
  principalId: String(r.principal_id),
  performedBy: String(r.performed_by),
  reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
  performedAt: iso(r.performed_at),
});

const toObject = (r: Record<string, unknown>): ObjectRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  key: String(r.key),
  label: String(r.label),
  labelPlural: (r.label_plural as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  origin: r.origin as ObjectRecord["origin"],
  lifecycle: r.lifecycle as ObjectRecord["lifecycle"],
  supportsDelete: r.supports_delete === true,
  ...provenance(r),
});

const toField = (r: Record<string, unknown>): ObjectFieldRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  objectId: String(r.object_id),
  key: String(r.key),
  label: String(r.label),
  description: (r.description as string | null) ?? null,
  dataType: r.data_type as ObjectFieldRecord["dataType"],
  required: r.required === true,
  allowedValues: Object.freeze([...((r.allowed_values as string[] | null) ?? [])]),
  // A default is stored as TEXT because one column cannot be four types. The domain's own value is
  // a string for exactly that reason -- reconstructing a number or boolean here would be guessing
  // at which, and guessing wrong on a boolean default is a silent behaviour change.
  defaultValue: (r.default_value as string | null) ?? null,
  searchable: r.searchable === true,
  sortable: r.sortable === true,
  reportable: r.reportable === true,
  sensitivity: r.sensitivity as ObjectFieldRecord["sensitivity"],
  referenceTo: (r.reference_to as string | null) ?? null,
  origin: r.origin as ObjectFieldRecord["origin"],
  lifecycle: r.lifecycle as ObjectFieldRecord["lifecycle"],
  ...provenance(r),
});

const toRole = (r: Record<string, unknown>): PolicyRoleRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  key: String(r.key),
  name: String(r.name),
  description: (r.description as string | null) ?? null,
  origin: r.origin as PolicyRoleRecord["origin"],
  protected: r.protected === true,
  ...provenance(r),
});

const toObjectPermission = (r: Record<string, unknown>): RoleObjectPermissionRecord => ({
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
const toFieldOverride = (r: Record<string, unknown>): RoleFieldPermissionOverrideRecord => {
  const override: Record<string, boolean> = {};
  if (r.can_create !== null) override.C = r.can_create === true;
  if (r.can_read !== null) override.R = r.can_read === true;
  if (r.can_edit !== null) override.E = r.can_edit === true;
  if (r.can_delete !== null) override.D = r.can_delete === true;
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    roleId: String(r.role_id),
    fieldId: String(r.field_id),
    override: Object.freeze(override) as CredOverride,
    ...provenance(r),
  };
};

const toAssignment = (r: Record<string, unknown>): PolicyRoleAssignmentRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  principalUid: String(r.principal_uid),
  roleId: String(r.role_id),
  scopeType: String(r.scope_type),
  scopeValue: (r.scope_value as string | null) ?? null,
  status: r.status as PolicyAssignmentStatus,
  grantedBy: String(r.granted_by),
  grantedAt: iso(r.granted_at),
  accessVersionAtGrant: Number(r.access_version_at_grant),
  ...provenance(r),
});

const toWorkflow = (r: Record<string, unknown>): WorkflowRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  key: String(r.key),
  name: String(r.name),
  description: (r.description as string | null) ?? null,
  objectKey: (r.object_key as string | null) ?? null,
  origin: r.origin as WorkflowRecord["origin"],
  ...provenance(r),
});

const toWorkflowVersion = (r: Record<string, unknown>): WorkflowVersionRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  workflowId: String(r.workflow_id),
  version: Number(r.version),
  status: r.status as WorkflowVersionRecord["status"],
  publishedAt: isoOrNull(r.published_at),
  publishedBy: (r.published_by as string | null) ?? null,
  ...provenance(r),
});

const toStep = (r: Record<string, unknown>): WorkflowStepRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  workflowVersionId: String(r.workflow_version_id),
  key: String(r.key),
  label: String(r.label),
  initial: r.is_initial === true,
  terminal: r.is_terminal === true,
  ...provenance(r),
});

const toAction = (r: Record<string, unknown>): WorkflowActionRecord => ({
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

const toBinding = (r: Record<string, unknown>): WorkflowRoleBindingRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  workflowVersionId: String(r.workflow_version_id),
  actionKey: String(r.action_key),
  roleId: String(r.role_id),
  ...provenance(r),
});

const toInstance = (r: Record<string, unknown>): WorkflowInstanceRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  workflowVersionId: String(r.workflow_version_id),
  objectKey: String(r.object_key),
  recordId: String(r.record_id),
  currentStepKey: String(r.current_step_key),
  ...provenance(r),
});

const toAudit = (r: Record<string, unknown>): PolicyAuditEventRecord => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  action: String(r.action),
  actorUid: String(r.actor_uid),
  targetKind: String(r.target_kind),
  targetId: String(r.target_id),
  before: r.before ?? null,
  after: r.after ?? null,
  occurredAt: iso(r.occurred_at),
  reason: (r.reason as string | null) ?? null,
});

// ════════════════════ the adapter ════════════════════

export class PostgresPolicyRepository implements PolicyRepository {
  /**
   * @param pool a SHARED, long-lived pool. See policyDatabase.ts -- one per process, never per
   *             request. This adapter never constructs one, so it cannot accidentally make a second.
   */
  constructor(private readonly pool: Pool) {}

  async transact<T>(actor: PolicyActor, fn: (tx: PolicyTransaction) => Promise<T>): Promise<T> {
    if (!actor?.tenantId) throw new PolicyStoreError("a tenant is required");
    if (!actor?.uid) throw new PolicyStoreError("an actor uid is required");

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(makeTransaction(client, actor));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // ROLLBACK is itself allowed to fail (a dead connection), and swallowing that would hide the
      // ORIGINAL error behind a secondary one. The original is what the caller needs.
      try {
        await client.query("ROLLBACK");
      } catch {
        /* the original error is rethrown below */
      }
      throw err;
    } finally {
      // ALWAYS released. A leaked client is a pool slot gone for the life of the process, and the
      // symptom appears much later as an unexplained hang.
      client.release();
    }
  }

  // ── reads. Every one is tenant-scoped in SQL, not in JavaScript after the fact. ──

  private async many<T>(text: string, values: readonly unknown[], map: (r: Record<string, unknown>) => T): Promise<T[]> {
    const { rows } = await (this.pool as unknown as Queryable).query(text, values);
    return rows.map(map);
  }

  private async one<T>(text: string, values: readonly unknown[], map: (r: Record<string, unknown>) => T): Promise<T | null> {
    const rows = await this.many(text, values, map);
    return rows[0] ?? null;
  }

  // TENANT AND IDENTITY.
  //
  // `getTenantByKey` is the one read in this adapter with no tenant predicate, and deliberately so:
  // a bootstrap must be able to ask whether a tenant exists before there is a tenant to scope by.
  // It selects ONE tenant by its own natural key and returns nothing owned by it, so it cannot be
  // turned into a cross-tenant read of policy.
  getTenantByKey(key: string) {
    return this.one(`SELECT * FROM ${SCHEMA}.tenants WHERE key = $1`, [key], toTenant);
  }

  getTenant(tenantId: TenantId) {
    return this.one(`SELECT * FROM ${SCHEMA}.tenants WHERE id = $1`, [tenantId], toTenant);
  }

  getPrincipalBySubject(identityProvider: string, externalSubject: string) {
    return this.one(
      `SELECT * FROM ${SCHEMA}.principals WHERE identity_provider = $1 AND external_subject = $2`,
      [identityProvider, externalSubject],
      toPrincipal,
    );
  }

  getPrincipal(principalId: string) {
    return this.one(`SELECT * FROM ${SCHEMA}.principals WHERE id = $1`, [principalId], toPrincipal);
  }

  listMembershipsForPrincipal(principalId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.tenant_memberships WHERE principal_id = $1 ORDER BY created_at`,
      [principalId],
      toMembership,
    );
  }

  getMembership(tenantId: TenantId, principalId: string) {
    return this.one(
      `SELECT * FROM ${SCHEMA}.tenant_memberships WHERE tenant_id = $1 AND principal_id = $2`,
      [tenantId, principalId],
      toMembership,
    );
  }

  async listTenantPrincipalIds(tenantId: TenantId) {
    const { rows } = await (this.pool as unknown as Queryable).query(
      `SELECT principal_id FROM ${SCHEMA}.tenant_memberships WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return rows.map((r) => String(r.principal_id));
  }

  getAdminBootstrap(tenantId: TenantId) {
    return this.one(
      `SELECT * FROM ${SCHEMA}.tenant_admin_bootstraps WHERE tenant_id = $1`,
      [tenantId],
      toAdminBootstrap,
    );
  }

  listObjects(tenantId: TenantId) {
    return this.many(`SELECT * FROM ${SCHEMA}.objects WHERE tenant_id = $1 ORDER BY key`, [tenantId], toObject);
  }

  getObjectByKey(tenantId: TenantId, key: string) {
    return this.one(`SELECT * FROM ${SCHEMA}.objects WHERE tenant_id = $1 AND key = $2`, [tenantId, key], toObject);
  }

  listFields(tenantId: TenantId, objectId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.object_fields WHERE tenant_id = $1 AND object_id = $2 ORDER BY key`,
      [tenantId, objectId],
      toField,
    );
  }

  listRoles(tenantId: TenantId) {
    return this.many(`SELECT * FROM ${SCHEMA}.roles WHERE tenant_id = $1 ORDER BY key`, [tenantId], toRole);
  }

  getRoleByKey(tenantId: TenantId, key: string) {
    return this.one(`SELECT * FROM ${SCHEMA}.roles WHERE tenant_id = $1 AND key = $2`, [tenantId, key], toRole);
  }

  listObjectPermissions(tenantId: TenantId, roleIds: readonly string[]) {
    if (roleIds.length === 0) return Promise.resolve([]);
    return this.many(
      `SELECT * FROM ${SCHEMA}.role_object_permissions WHERE tenant_id = $1 AND role_id = ANY($2)`,
      [tenantId, [...roleIds]],
      toObjectPermission,
    );
  }

  listFieldOverrides(tenantId: TenantId, roleIds: readonly string[]) {
    if (roleIds.length === 0) return Promise.resolve([]);
    return this.many(
      `SELECT * FROM ${SCHEMA}.role_field_permission_overrides WHERE tenant_id = $1 AND role_id = ANY($2)`,
      [tenantId, [...roleIds]],
      toFieldOverride,
    );
  }

  listAssignmentsForPrincipal(tenantId: TenantId, principalUid: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.user_role_assignments WHERE tenant_id = $1 AND principal_uid = $2 ORDER BY granted_at`,
      [tenantId, principalUid],
      toAssignment,
    );
  }

  getAccessVersion(tenantId: TenantId, principalUid: string) {
    return this.one(
      `SELECT * FROM ${SCHEMA}.principal_access_versions WHERE tenant_id = $1 AND principal_uid = $2`,
      [tenantId, principalUid],
      (r): PrincipalAccessVersionRecord => ({
        id: String(r.id),
        tenantId: String(r.tenant_id),
        principalUid: String(r.principal_uid),
        accessVersion: Number(r.access_version),
        updatedAt: iso(r.updated_at),
      }),
    );
  }

  listWorkflows(tenantId: TenantId) {
    return this.many(`SELECT * FROM ${SCHEMA}.workflows WHERE tenant_id = $1 ORDER BY key`, [tenantId], toWorkflow);
  }

  listWorkflowVersions(tenantId: TenantId, workflowId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.workflow_versions WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY version`,
      [tenantId, workflowId],
      toWorkflowVersion,
    );
  }

  listWorkflowSteps(tenantId: TenantId, versionId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.workflow_steps WHERE tenant_id = $1 AND workflow_version_id = $2 ORDER BY key`,
      [tenantId, versionId],
      toStep,
    );
  }

  listWorkflowActions(tenantId: TenantId, versionId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.workflow_actions WHERE tenant_id = $1 AND workflow_version_id = $2 ORDER BY key`,
      [tenantId, versionId],
      toAction,
    );
  }

  listWorkflowRoleBindings(tenantId: TenantId, versionId: string) {
    return this.many(
      `SELECT * FROM ${SCHEMA}.workflow_role_bindings WHERE tenant_id = $1 AND workflow_version_id = $2`,
      [tenantId, versionId],
      toBinding,
    );
  }

  getWorkflowInstance(tenantId: TenantId, objectKey: string, recordId: string) {
    return this.one(
      `SELECT * FROM ${SCHEMA}.workflow_instances WHERE tenant_id = $1 AND object_key = $2 AND record_id = $3`,
      [tenantId, objectKey, recordId],
      toInstance,
    );
  }

  listAuditEvents(tenantId: TenantId, limit: number) {
    // Ordered ASC and bounded from the END, so "the last N" reads in the order they happened. A
    // DESC page reversed in JavaScript would be the same rows in a different order, and the callers
    // that diff before/after sequences care which.
    return this.many(
      `SELECT * FROM (
         SELECT * FROM ${SCHEMA}.audit_events WHERE tenant_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2
       ) recent ORDER BY occurred_at ASC, id ASC`,
      [tenantId, limit],
      toAudit,
    );
  }
}

// ════════════════════ the transaction ════════════════════

function makeTransaction(client: PoolClient, actor: PolicyActor): PolicyTransaction {
  const tenantId = actor.tenantId;
  const q = client as unknown as Queryable;

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
  const requireOwned = async (table: string, id: string, kind: string): Promise<Record<string, unknown>> => {
    const { rows } = await q.query(`SELECT * FROM ${SCHEMA}.${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (rows.length === 0) throw new PolicyStoreError(`${kind} not found`);
    return rows[0];
  };

  const assertDraftVersion = async (versionId: string) => {
    const row = await requireOwned("workflow_versions", versionId, "workflow version");
    if (row.status !== "DRAFT") {
      throw new PolicyStoreError(`workflow version ${row.version} is ${row.status} and cannot be edited`);
    }
    return row;
  };

  /** Postgres raises 23505 on a unique violation; the domain says so in words. */
  const asDuplicate = (err: unknown, message: string): never => {
    if ((err as { code?: string })?.code === "23505") throw new PolicyStoreError(message);
    throw err;
  };

  return {
    // ════════════════════ tenant and identity ════════════════════

    async createTenant(input: NewTenantInput) {
      // The tenant's id IS the actor's tenantId. The caller generated it before opening the
      // transaction, so every row written in the same unit of work already references a tenant that
      // exists -- which is what lets "create the tenant and seed it" be one atomic thing.
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.tenants (id, key, name, status, configuration_version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`,
          [tenantId, input.key, input.name, input.status ?? "active", input.configurationVersion ?? 0],
        );
        return toTenant(rows[0]);
      } catch (err) {
        return asDuplicate(err, `tenant key "${input.key}" already exists`);
      }
    },

    async setTenantConfigurationVersion(id: TenantId, version: number) {
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.tenants SET configuration_version = $1, updated_at = now()
         WHERE id = $2 AND id = $3 RETURNING *`,
        [version, id, tenantId],
      );
      if (rows.length === 0) throw new PolicyStoreError("tenant not found");
      return toTenant(rows[0]);
    },

    async createPrincipal(input: NewPrincipalInput) {
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.principals
             (id, external_subject, identity_provider, display_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING *`,
          [newId(), input.externalSubject, input.identityProvider, input.displayName ?? null, input.status ?? "active"],
        );
        return toPrincipal(rows[0]);
      } catch (err) {
        // One subject per provider is one principal. A second would split one human's Roles in half.
        return asDuplicate(err, "principal already exists for that subject");
      }
    },

    async createTenantMembership(principalId: string, status?: PrincipalStatus) {
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.tenant_memberships
             (id, tenant_id, principal_id, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, now(), now()) RETURNING *`,
          [newId(), tenantId, principalId, status ?? "active"],
        );
        return toMembership(rows[0]);
      } catch (err) {
        return asDuplicate(err, "membership already exists");
      }
    },

    async setTenantMembershipStatus(membershipId: string, status: PrincipalStatus) {
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.tenant_memberships SET status = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [status, membershipId, tenantId],
      );
      if (rows.length === 0) throw new PolicyStoreError("membership not found");
      return toMembership(rows[0]);
    },

    async recordAdminBootstrap(input: NewAdminBootstrapInput) {
      // ONE PER TENANT, enforced by the PRIMARY KEY rather than by a read-then-write the caller
      // could race. Two concurrent bootstraps: one commits, the other is refused by the database.
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.tenant_admin_bootstraps
             (tenant_id, principal_id, performed_by, reason, performed_at)
           VALUES ($1, $2, $3, $4, now()) RETURNING *`,
          [tenantId, input.principalId, input.performedBy, input.reason ?? null],
        );
        return toAdminBootstrap(rows[0]);
      } catch (err) {
        return asDuplicate(err, "this tenant has already been bootstrapped");
      }
    },

    async createObject(input: NewRecord<ObjectRecord>) {
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.objects
             (id, tenant_id, key, label, label_plural, description, origin, lifecycle, supports_delete,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [newId(), tenantId, input.key, input.label, input.labelPlural, input.description,
            input.origin, input.lifecycle, input.supportsDelete, ...stamp()],
        );
        return toObject(rows[0]);
      } catch (err) {
        return asDuplicate(err, `object key "${input.key}" already exists`);
      }
    },

    async createField(input: NewRecord<ObjectFieldRecord>) {
      await requireOwned("objects", input.objectId, "object");
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.object_fields
             (id, tenant_id, object_id, key, label, description, data_type, required, allowed_values,
              default_value, searchable, sortable, reportable, sensitivity, reference_to, origin, lifecycle,
              created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
          [newId(), tenantId, input.objectId, input.key, input.label, input.description, input.dataType,
            input.required, [...input.allowedValues],
            input.defaultValue === null ? null : String(input.defaultValue),
            input.searchable, input.sortable, input.reportable, input.sensitivity, input.referenceTo,
            input.origin, input.lifecycle, ...stamp()],
        );
        return toField(rows[0]);
      } catch (err) {
        return asDuplicate(err, `field key "${input.key}" already exists on this object`);
      }
    },

    async updateField(fieldId: string, patch: Partial<NewRecord<ObjectFieldRecord>>) {
      await requireOwned("object_fields", fieldId, "field");
      // COLUMN NAMES ARE NOT INTERPOLATED FROM CALLER KEYS. Each is named literally here, so a patch
      // carrying an unexpected property cannot reach the SQL text -- and `key` and `data_type` are
      // simply absent, which is what makes "a field cannot be re-keyed or retyped" structural.
      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (patch.label !== undefined) set("label", patch.label);
      if (patch.description !== undefined) set("description", patch.description);
      if (patch.required !== undefined) set("required", patch.required);
      if (patch.searchable !== undefined) set("searchable", patch.searchable);
      if (patch.sortable !== undefined) set("sortable", patch.sortable);
      if (patch.reportable !== undefined) set("reportable", patch.reportable);
      if (patch.sensitivity !== undefined) set("sensitivity", patch.sensitivity);
      if (patch.lifecycle !== undefined) set("lifecycle", patch.lifecycle);
      set("updated_by", actor.uid);
      set("updated_at", nowIso());
      values.push(fieldId, tenantId);
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.object_fields SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
        values,
      );
      return toField(rows[0]);
    },

    async createRole(input: NewRecord<PolicyRoleRecord>) {
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.roles (id, tenant_id, key, name, description, origin, protected,
             created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [newId(), tenantId, input.key, input.name, input.description, input.origin, input.protected, ...stamp()],
        );
        return toRole(rows[0]);
      } catch (err) {
        return asDuplicate(err, `role key "${input.key}" already exists`);
      }
    },

    async updateRole(roleId: string, patch: Partial<NewRecord<PolicyRoleRecord>>) {
      await requireOwned("roles", roleId, "role");
      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (patch.name !== undefined) set("name", patch.name);
      if (patch.description !== undefined) set("description", patch.description);
      set("updated_by", actor.uid);
      set("updated_at", nowIso());
      values.push(roleId, tenantId);
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.roles SET ${sets.join(", ")}
         WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
        values,
      );
      return toRole(rows[0]);
    },

    async setObjectPermission(roleId: string, objectId: string, cred: CredSet) {
      await requireOwned("roles", roleId, "role");
      await requireOwned("objects", objectId, "object");
      // UPSERT on the natural key, so setting a permission twice is one row rather than a duplicate
      // the resolver would have to union with itself.
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.role_object_permissions
           (id, tenant_id, role_id, object_id, can_create, can_read, can_edit, can_delete,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, role_id, object_id) DO UPDATE
           SET can_create = EXCLUDED.can_create, can_read = EXCLUDED.can_read,
               can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
               updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [newId(), tenantId, roleId, objectId, cred.C, cred.R, cred.E, cred.D, ...stamp()],
      );
      return toObjectPermission(rows[0]);
    },

    async setFieldOverride(roleId: string, fieldId: string, override: CredOverride) {
      await requireOwned("roles", roleId, "role");
      await requireOwned("object_fields", fieldId, "field");
      // AN EMPTY OVERRIDE IS THE ABSENCE OF A ROW. The table's own CHECK refuses an all-NULL row for
      // the same reason: "no opinion" gets one spelling, not two.
      if (Object.keys(override).length === 0) {
        await q.query(
          `DELETE FROM ${SCHEMA}.role_field_permission_overrides
           WHERE tenant_id = $1 AND role_id = $2 AND field_id = $3`,
          [tenantId, roleId, fieldId],
        );
        return;
      }
      const val = (verb: keyof CredOverride) => (override[verb] === undefined ? null : override[verb]);
      await q.query(
        `INSERT INTO ${SCHEMA}.role_field_permission_overrides
           (id, tenant_id, role_id, field_id, can_create, can_read, can_edit, can_delete,
            created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, role_id, field_id) DO UPDATE
           SET can_create = EXCLUDED.can_create, can_read = EXCLUDED.can_read,
               can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
               updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [newId(), tenantId, roleId, fieldId, val("C"), val("R"), val("E"), val("D"), ...stamp()],
      );
    },

    async createAssignment(input: NewRecord<PolicyRoleAssignmentRecord>) {
      await requireOwned("roles", input.roleId, "role");
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.user_role_assignments
           (id, tenant_id, principal_uid, role_id, scope_type, scope_value, status, granted_by, granted_at,
            access_version_at_grant, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [newId(), tenantId, input.principalUid, input.roleId, input.scopeType, input.scopeValue,
          input.status, input.grantedBy, input.grantedAt, input.accessVersionAtGrant, ...stamp()],
      );
      return toAssignment(rows[0]);
    },

    async setAssignmentStatus(assignmentId: string, status: PolicyAssignmentStatus) {
      await requireOwned("user_role_assignments", assignmentId, "assignment");
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.user_role_assignments SET status = $1, updated_by = $2, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 RETURNING *`,
        [status, actor.uid, nowIso(), assignmentId, tenantId],
      );
      return toAssignment(rows[0]);
    },

    async bumpAccessVersion(principalUid: string) {
      // ONE STATEMENT, so two concurrent bumps cannot both read the same old value and write the
      // same new one. A read-then-write here would be a lost update, and a lost access-version bump
      // means a revoked grant stays cached as valid.
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.principal_access_versions (id, tenant_id, principal_uid, access_version, updated_at)
         VALUES ($1,$2,$3,1,$4)
         ON CONFLICT (tenant_id, principal_uid) DO UPDATE
           SET access_version = ${SCHEMA}.principal_access_versions.access_version + 1,
               updated_at = EXCLUDED.updated_at
         RETURNING access_version`,
        [newId(), tenantId, principalUid, nowIso()],
      );
      return Number(rows[0].access_version);
    },

    async createWorkflow(input: NewRecord<WorkflowRecord>) {
      try {
        const { rows } = await q.query(
          `INSERT INTO ${SCHEMA}.workflows (id, tenant_id, key, name, description, object_key, origin,
             created_by, created_at, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [newId(), tenantId, input.key, input.name, input.description, input.objectKey, input.origin, ...stamp()],
        );
        return toWorkflow(rows[0]);
      } catch (err) {
        return asDuplicate(err, `workflow key "${input.key}" already exists`);
      }
    },

    async createWorkflowVersion(input: NewRecord<WorkflowVersionRecord>) {
      await requireOwned("workflows", input.workflowId, "workflow");
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.workflow_versions (id, tenant_id, workflow_id, version, status,
           published_at, published_by, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [newId(), tenantId, input.workflowId, input.version, input.status, input.publishedAt,
          input.publishedBy, ...stamp()],
      );
      return toWorkflowVersion(rows[0]);
    },

    async createWorkflowStep(input: NewRecord<WorkflowStepRecord>) {
      await assertDraftVersion(input.workflowVersionId);
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.workflow_steps (id, tenant_id, workflow_version_id, key, label,
           is_initial, is_terminal, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [newId(), tenantId, input.workflowVersionId, input.key, input.label, input.initial, input.terminal, ...stamp()],
      );
      return toStep(rows[0]);
    },

    async createWorkflowAction(input: NewRecord<WorkflowActionRecord>) {
      await assertDraftVersion(input.workflowVersionId);
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.workflow_actions (id, tenant_id, workflow_version_id, key, label,
           from_step_key, to_step_key, requires_own_assignment, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [newId(), tenantId, input.workflowVersionId, input.key, input.label, input.fromStepKey,
          input.toStepKey, input.requiresOwnAssignment, ...stamp()],
      );
      return toAction(rows[0]);
    },

    async createWorkflowRoleBinding(input: NewRecord<WorkflowRoleBindingRecord>) {
      await assertDraftVersion(input.workflowVersionId);
      await requireOwned("roles", input.roleId, "role");
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.workflow_role_bindings (id, tenant_id, workflow_version_id, action_key,
           role_id, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [newId(), tenantId, input.workflowVersionId, input.actionKey, input.roleId, ...stamp()],
      );
      return toBinding(rows[0]);
    },

    async publishWorkflowVersion(versionId: string) {
      await assertDraftVersion(versionId);
      const at = nowIso();
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.workflow_versions
         SET status = 'PUBLISHED', published_at = $1, published_by = $2, updated_by = $2, updated_at = $1
         WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [at, actor.uid, versionId, tenantId],
      );
      return toWorkflowVersion(rows[0]);
    },

    async createWorkflowInstance(input: NewRecord<WorkflowInstanceRecord>) {
      await requireOwned("workflow_versions", input.workflowVersionId, "workflow version");
      const { rows } = await q.query(
        `INSERT INTO ${SCHEMA}.workflow_instances (id, tenant_id, workflow_version_id, object_key,
           record_id, current_step_key, created_by, created_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [newId(), tenantId, input.workflowVersionId, input.objectKey, input.recordId, input.currentStepKey, ...stamp()],
      );
      return toInstance(rows[0]);
    },

    async advanceWorkflowInstance(instanceId: string, toStepKey: string) {
      await requireOwned("workflow_instances", instanceId, "workflow instance");
      const { rows } = await q.query(
        `UPDATE ${SCHEMA}.workflow_instances SET current_step_key = $1, updated_by = $2, updated_at = $3
         WHERE id = $4 AND tenant_id = $5 RETURNING *`,
        [toStepKey, actor.uid, nowIso(), instanceId, tenantId],
      );
      return toInstance(rows[0]);
    },

    async appendWorkflowInstanceEvent(input: Omit<WorkflowInstanceEventRecord, "id" | "tenantId">) {
      await q.query(
        `INSERT INTO ${SCHEMA}.workflow_instance_events (id, tenant_id, instance_id, action_key,
           from_step_key, to_step_key, actor_uid, occurred_at, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(), tenantId, input.instanceId, input.actionKey, input.fromStepKey, input.toStepKey,
          input.actorUid, input.occurredAt, input.reason],
      );
    },

    async appendAudit(input: Omit<PolicyAuditEventRecord, "id" | "tenantId">) {
      await q.query(
        `INSERT INTO ${SCHEMA}.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id,
           before, after, occurred_at, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newId(), tenantId, input.action, input.actorUid, input.targetKind, input.targetId,
          input.before === null || input.before === undefined ? null : JSON.stringify(input.before),
          input.after === null || input.after === undefined ? null : JSON.stringify(input.after),
          input.occurredAt, input.reason],
      );
    },
  };
}
