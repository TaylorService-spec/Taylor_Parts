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
import { PolicyStoreError } from "./policyRepository";
import type {
  NewRecord,
  PolicyActor,
  PolicyReader,
  PolicyRepository,
  PolicyTransaction,
  AuditEventFilter,
} from "./policyRepository";
import type {
  CredOverride,
  CredSet,
  CapabilityRecord,
  ObjectFieldRecord,
  PrincipalCapabilityRecord,
  RoleCapabilityRecord,
  ObjectRecord,
  PolicyAssignmentStatus,
  PolicyAuditEventRecord,
  GrantConditionRecord,
  RoleCapabilityDecisionRecord,
  PolicyRoleAssignmentRecord,
  PolicyRoleRecord,
  PrincipalAccessVersionRecord,
  PrincipalRecord,
  PrincipalIdentityBindingRecord,
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
  FunctionalRoleRecord,
  WorkflowStepRecord,
  WorkflowVersionRecord,
} from "./types";

interface Tables {
  tenants: TenantRecord[];
  principals: PrincipalRecord[];
  principalIdentities: PrincipalIdentityBindingRecord[];
  memberships: TenantMembershipRecord[];
  adminBootstraps: TenantAdminBootstrapRecord[];
  objects: ObjectRecord[];
  fields: ObjectFieldRecord[];
  roles: PolicyRoleRecord[];
  objectPermissions: RoleObjectPermissionRecord[];
  capabilities: CapabilityRecord[];
  roleCapabilities: RoleCapabilityRecord[];
  principalCapabilities: PrincipalCapabilityRecord[];
  fieldOverrides: RoleFieldPermissionOverrideRecord[];
  assignments: PolicyRoleAssignmentRecord[];
  accessVersions: PrincipalAccessVersionRecord[];
  workflows: WorkflowRecord[];
  workflowVersions: WorkflowVersionRecord[];
  workflowSteps: WorkflowStepRecord[];
  workflowActions: WorkflowActionRecord[];
  workflowRoleBindings: WorkflowRoleBindingRecord[];
  workflowInstances: WorkflowInstanceRecord[];
  workflowInstanceEvents: WorkflowInstanceEventRecord[];
  audit: PolicyAuditEventRecord[];
  decisions: RoleCapabilityDecisionRecord[];
  grantConditions: GrantConditionRecord[];
  functionalRoles: FunctionalRoleRecord[];
}

const emptyTables = (): Tables => ({
  tenants: [],
  principals: [],
  principalIdentities: [],
  memberships: [],
  adminBootstraps: [],
  objects: [],
  fields: [],
  roles: [],
  objectPermissions: [],
  capabilities: [],
  roleCapabilities: [],
  principalCapabilities: [],
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
  decisions: [],
  grantConditions: [],
  functionalRoles: [],
});

export interface InMemoryOptions {
  /** Injected so tests are deterministic. Production adapters use the database's own clock. */
  readonly now?: () => string;
  /** Injected for the same reason. Ids are opaque everywhere above this file. */
  readonly nextId?: () => string;
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private tables: Tables = emptyTables();
  private readonly now: () => string;
  private readonly nextId: () => string;

  constructor(options: InMemoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    let counter = 0;
    this.nextId = options.nextId ?? (() => `p${++counter}`);
  }

  // ════════════════════ transaction ════════════════════

  async transact<T>(actor: PolicyActor, fn: (tx: PolicyTransaction) => Promise<T>): Promise<T> {
    if (!actor?.tenantId) throw new PolicyStoreError("a tenant is required");
    if (!actor?.uid) throw new PolicyStoreError("an actor uid is required");
    // ALL OR NOTHING, by snapshot. A real adapter uses the database's transaction; the property the
    // callers depend on -- a throw leaves no partial policy and no orphan audit event -- is the same.
    const snapshot: Tables = JSON.parse(JSON.stringify(this.tables)) as Tables;
    try {
      return await fn(this.makeTransaction(actor));
    } catch (err) {
      this.tables = snapshot;
      throw err;
    }
  }

  private stamp(actor: PolicyActor) {
    const at = this.now();
    return { createdBy: actor.uid, createdAt: at, updatedBy: actor.uid, updatedAt: at };
  }

  private makeTransaction(actor: PolicyActor): PolicyTransaction {
    const t = this.tables;
    const tenantId = actor.tenantId;
    const own = <T extends { id: string; tenantId: TenantId }>(row: T) => row.tenantId === tenantId;

    const requireOwned = <T extends { id: string; tenantId: TenantId }>(rows: T[], id: string, kind: string): T => {
      const found = rows.find((r) => r.id === id && own(r));
      // A row belonging to ANOTHER tenant reports the same "not found" as one that does not exist.
      // Distinguishing them would confirm the other tenant's row exists, which is itself a leak.
      if (!found) throw new PolicyStoreError(`${kind} not found`);
      return found;
    };

    const replace = <T extends { id: string }>(rows: T[], updated: T) => {
      rows[rows.findIndex((r) => r.id === updated.id)] = updated;
      return updated;
    };

    return {
      // ── tenant and identity ──
      createTenant: async (input) => {
        if (t.tenants.some((x) => x.key === input.key)) {
          throw new PolicyStoreError(`tenant key "${input.key}" already exists`);
        }
        const at = this.now();
        const row: TenantRecord = {
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
        if (!found) throw new PolicyStoreError("tenant not found");
        const updated: TenantRecord = { ...found, configurationVersion: version, updatedAt: this.now() };
        t.tenants[t.tenants.indexOf(found)] = updated;
        return updated;
      },

      createPrincipal: async (input) => {
        const existing = t.principals.find(
          (x) => x.identityProvider === input.identityProvider && x.externalSubject === input.externalSubject,
        );
        // One subject per provider is one principal. Minting a second would split one human's Roles.
        if (existing) throw new PolicyStoreError("principal already exists for that subject");
        const at = this.now();
        const row: PrincipalRecord = {
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

      setPrincipalIdentity: async (principalId, input) => {
        // TENANT-SCOPED, stated here in the same place the real adapter states it, so the two
        // adapters refuse the same call rather than one of them being the only real fence.
        const member = t.memberships.some((m) => m.tenantId === tenantId && m.principalId === principalId);
        const found = t.principals.find((x) => x.id === principalId);
        if (!found || !member) throw new PolicyStoreError("principal not found in this tenant");
        const clash = t.principals.find(
          (x) => x.id !== principalId
            && x.identityProvider === input.identityProvider
            && x.externalSubject === input.externalSubject,
        );
        if (clash) throw new PolicyStoreError("another principal already holds that identity");
        const updated: PrincipalRecord = {
          ...found,
          identityProvider: input.identityProvider,
          externalSubject: input.externalSubject,
          displayName: input.displayName ?? null,
          updatedAt: this.now(),
        };
        t.principals[t.principals.indexOf(found)] = updated;
        return updated;
      },

      createPrincipalIdentityBinding: async (input) => {
        // Same refusals as the PostgreSQL adapter (its CHECK, UNIQUE, partial UNIQUE and trigger), so
        // the two adapters refuse the same call.
        const member = t.memberships.some((m) => m.tenantId === tenantId && m.principalId === input.principalId);
        if (!t.principals.some((x) => x.id === input.principalId) || !member) {
          throw new PolicyStoreError("principal not found in this tenant");
        }
        if (input.identityProvider !== "eos") throw new PolicyStoreError("only 'eos' identities are bound here");
        const dup = t.principalIdentities.some((x) => x.identityProvider === input.identityProvider && x.externalSubject === input.externalSubject)
          || t.principals.some((x) => x.identityProvider === input.identityProvider && x.externalSubject === input.externalSubject)
          || t.principalIdentities.some((x) => x.principalId === input.principalId && x.identityProvider === input.identityProvider && x.status === "active");
        if (dup) throw new PolicyStoreError("that identity is already bound, or the principal already has an active binding");
        const row: PrincipalIdentityBindingRecord = {
          id: this.nextId(), principalId: input.principalId, identityProvider: input.identityProvider,
          externalSubject: input.externalSubject, status: "active", createdBy: input.createdBy, createdAt: this.now(),
          reason: input.reason, revokedBy: null, revokedAt: null, revokeReason: null,
        };
        t.principalIdentities.push(row);
        return row;
      },

      revokePrincipalIdentityBinding: async (principalId, identityProvider, revokedBy, reason) => {
        const member = t.memberships.some((m) => m.tenantId === tenantId && m.principalId === principalId);
        const found = t.principalIdentities.find((x) => x.principalId === principalId && x.identityProvider === identityProvider && x.status === "active");
        if (!found || !member) throw new PolicyStoreError("no active binding for that principal in this tenant");
        const updated: PrincipalIdentityBindingRecord = { ...found, status: "revoked", revokedBy, revokedAt: this.now(), revokeReason: reason };
        return replace(t.principalIdentities, updated);
      },

      createTenantMembership: async (principalId, status) => {
        if (t.memberships.some((m) => m.tenantId === tenantId && m.principalId === principalId)) {
          throw new PolicyStoreError("membership already exists");
        }
        const at = this.now();
        const row: TenantMembershipRecord = {
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
        if (!found) throw new PolicyStoreError("membership not found");
        const updated: TenantMembershipRecord = { ...found, status, updatedAt: this.now() };
        t.memberships[t.memberships.indexOf(found)] = updated;
        return updated;
      },

      recordAdminBootstrap: async (input) => {
        // ONE PER TENANT. The real adapter gets this from a primary key; here it is the same rule
        // stated in the same place, so the two adapters refuse the same second call.
        if (t.adminBootstraps.some((b) => b.tenantId === tenantId)) {
          throw new PolicyStoreError("this tenant has already been bootstrapped");
        }
        const row: TenantAdminBootstrapRecord = {
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
          throw new PolicyStoreError(`object key "${input.key}" already exists`);
        }
        const row: ObjectRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.objects.push(row);
        return row;
      },

      updateObject: async (objectId, patch) => {
        const found = requireOwned(t.objects, objectId, "object");
        const updated: ObjectRecord = {
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
          throw new PolicyStoreError(`field key "${input.key}" already exists on this object`);
        }
        const row: ObjectFieldRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.fields.push(row);
        return row;
      },

      updateField: async (fieldId, patch) => {
        const current = requireOwned(t.fields, fieldId, "field");
        return replace(t.fields, { ...current, ...patch, updatedBy: actor.uid, updatedAt: this.now() });
      },

      createRole: async (input) => {
        if (t.roles.some((r) => r.tenantId === tenantId && r.key === input.key)) {
          throw new PolicyStoreError(`role key "${input.key}" already exists`);
        }
        const row: PolicyRoleRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
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
        const existing = t.objectPermissions.find(
          (p) => p.tenantId === tenantId && p.roleId === roleId && p.objectId === objectId,
        );
        if (existing) return replace(t.objectPermissions, { ...existing, cred, updatedBy: actor.uid, updatedAt: this.now() });
        const row: RoleObjectPermissionRecord = {
          id: this.nextId(), tenantId, roleId, objectId, cred, ...this.stamp(actor),
        };
        t.objectPermissions.push(row);
        return row;
      },

      setFieldOverride: async (roleId, fieldId, override) => {
        requireOwned(t.roles, roleId, "role");
        requireOwned(t.fields, fieldId, "field");
        const at = (p: RoleFieldPermissionOverrideRecord) =>
          p.tenantId === tenantId && p.roleId === roleId && p.fieldId === fieldId;
        const index = t.fieldOverrides.findIndex(at);
        // AN EMPTY OVERRIDE IS THE ABSENCE OF A ROW. Storing "{}" as well as "no row" would give
        // "this role has no opinion about this field" two spellings, and two spellings drift.
        if (Object.keys(override).length === 0) {
          if (index >= 0) t.fieldOverrides.splice(index, 1);
          return;
        }
        if (index >= 0) {
          t.fieldOverrides[index] = { ...t.fieldOverrides[index], override, updatedBy: actor.uid, updatedAt: this.now() };
          return;
        }
        t.fieldOverrides.push({ id: this.nextId(), tenantId, roleId, fieldId, override, ...this.stamp(actor) });
      },

      // ── canonical Object-owned security grants ──
      // Idempotent by (tenant, grantee, capability), mirroring the postgres ON CONFLICT DO NOTHING
      // so the two adapters cannot disagree about what a re-grant means.
      grantRoleCapability: async (input) => {
        const found = t.roleCapabilities.find(
          (g) => g.tenantId === tenantId && g.roleId === input.roleId && g.capabilityId === input.capabilityId);
        if (found) return found;
        const row = {
          id: this.nextId(), tenantId, roleId: input.roleId, capabilityId: input.capabilityId,
          grantedBy: input.grantedBy, grantedAt: input.grantedAt, ...this.stamp(actor),
        };
        t.roleCapabilities.push(row);
        return row;
      },
      revokeRoleCapability: async (roleId, capabilityId) => {
        const i = t.roleCapabilities.findIndex(
          (g) => g.tenantId === tenantId && g.roleId === roleId && g.capabilityId === capabilityId);
        return i === -1 ? null : t.roleCapabilities.splice(i, 1)[0];
      },
      grantPrincipalCapability: async (input) => {
        const foundAt = t.principalCapabilities.findIndex(
          (g) => g.tenantId === tenantId && g.principalId === input.principalId && g.capabilityId === input.capabilityId);
        const found = foundAt >= 0 ? t.principalCapabilities[foundAt] : undefined;
        if (found && found.expiresAt && found.expiresAt <= this.now() && (input.exceptionReason != null || input.expiresAt != null)) {
          // Refresh an EXPIRED exception, as the PostgreSQL adapter does.
          t.principalCapabilities[foundAt] = { ...found, exceptionReason: input.exceptionReason ?? null, expiresAt: input.expiresAt ?? null,
            grantedBy: input.grantedBy, grantedAt: input.grantedAt, updatedBy: actor.uid, updatedAt: this.now() };
          return t.principalCapabilities[foundAt];
        }
        if (found) return found;
        const row = {
          id: this.nextId(), tenantId, principalId: input.principalId, capabilityId: input.capabilityId,
          grantedBy: input.grantedBy, grantedAt: input.grantedAt,
          exceptionReason: input.exceptionReason ?? null, expiresAt: input.expiresAt ?? null, ...this.stamp(actor),
        };
        t.principalCapabilities.push(row);
        return row;
      },
      revokePrincipalCapability: async (principalId, capabilityId) => {
        const i = t.principalCapabilities.findIndex(
          (g) => g.tenantId === tenantId && g.principalId === principalId && g.capabilityId === capabilityId);
        return i === -1 ? null : t.principalCapabilities.splice(i, 1)[0];
      },

      createAssignment: async (input) => {
        // THE TWO STORE-LEVEL RULES MIGRATION 003 ADDS, mirrored so the adapters cannot disagree
        // about what is representable. The commands refuse both first; these are the backstop for a
        // writer that skipped them.
        //
        //   1. the principal must be a MEMBER of this tenant (composite foreign key)
        //   2. one ACTIVE row per (principal, role, normalized scope) (partial unique index)
        if (!t.memberships.some((m) => m.tenantId === tenantId && m.principalId === input.principalId)) {
          throw new PolicyStoreError("that principal is not a member of this tenant");
        }
        if (
          input.status === "active" &&
          t.assignments.some(
            (a) =>
              a.tenantId === tenantId &&
              a.principalId === input.principalId &&
              a.roleId === input.roleId &&
              a.status === "active" &&
              a.scopeType === input.scopeType &&
              (a.scopeValue ?? "") === (input.scopeValue ?? ""),
          )
        ) {
          throw new PolicyStoreError("an identical active assignment already exists");
        }
        requireOwned(t.roles, input.roleId, "role");
        const row: PolicyRoleAssignmentRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.assignments.push(row);
        return row;
      },

      setAssignmentStatus: async (assignmentId, status: PolicyAssignmentStatus) => {
        const current = requireOwned(t.assignments, assignmentId, "assignment");
        return replace(t.assignments, { ...current, status, updatedBy: actor.uid, updatedAt: this.now() });
      },

      bumpAccessVersion: async (principalId) => {
        const index = t.accessVersions.findIndex((v) => v.tenantId === tenantId && v.principalId === principalId);
        const next = index >= 0 ? t.accessVersions[index].accessVersion + 1 : 1;
        const row: PrincipalAccessVersionRecord = { id: index >= 0 ? t.accessVersions[index].id : this.nextId(), tenantId, principalId, accessVersion: next, updatedAt: this.now() };
        if (index >= 0) t.accessVersions[index] = row;
        else t.accessVersions.push(row);
        return next;
      },

      createWorkflow: async (input) => {
        if (t.workflows.some((w) => w.tenantId === tenantId && w.key === input.key)) {
          throw new PolicyStoreError(`workflow key "${input.key}" already exists`);
        }
        const row: WorkflowRecord = { ...input, activeVersionId: null, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.workflows.push(row);
        return row;
      },

      createWorkflowVersion: async (input) => {
        requireOwned(t.workflows, input.workflowId, "workflow");
        const row: WorkflowVersionRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.workflowVersions.push(row);
        return row;
      },

      createWorkflowStep: async (input) => {
        assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
        const row: WorkflowStepRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
        t.workflowSteps.push(row);
        return row;
      },

      createWorkflowAction: async (input) => {
        assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
        // Mirrors migration 1762732800000: the legacy flag and the guard are one fact.
        const guardKind = input.guardKind ?? (input.requiresOwnAssignment ? "RECORD_ASSIGNMENT" : null);
        if (guardKind !== null && guardKind !== "RECORD_ASSIGNMENT") {
          throw new PolicyStoreError(`unknown workflow guard "${String(guardKind)}"`);
        }
        const row: WorkflowActionRecord = {
          ...input, capabilityKey: input.capabilityKey ?? null, guardKind,
          requiresOwnAssignment: guardKind === "RECORD_ASSIGNMENT",
          id: this.nextId(), tenantId, ...this.stamp(actor),
        };
        t.workflowActions.push(row);
        return row;
      },

      createWorkflowRoleBinding: async (input) => {
        assertDraft(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
        const bindingKind = input.bindingKind ?? "SECURITY_ROLE";
        // Mirrors workflow_role_bindings_target_matches_kind: exactly one target, the one the kind names.
        if (bindingKind === "SECURITY_ROLE") {
          if (!input.roleId || input.functionalRoleId) throw new PolicyStoreError("a SECURITY_ROLE binding names a Security Role only");
          requireOwned(t.roles, input.roleId, "role");
        } else if (bindingKind === "FUNCTIONAL_ROLE") {
          if (input.roleId || !input.functionalRoleId) throw new PolicyStoreError("a FUNCTIONAL_ROLE binding names a Functional Role only");
          requireOwned(t.functionalRoles, input.functionalRoleId, "functional role");
        } else {
          throw new PolicyStoreError(`unknown binding kind "${String(bindingKind)}"`);
        }
        const row: WorkflowRoleBindingRecord = {
          ...input, roleId: input.roleId ?? null, functionalRoleId: input.functionalRoleId ?? null,
          bindingKind, id: this.nextId(), tenantId, ...this.stamp(actor),
        };
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
        assertPublished(requireOwned(t.workflowVersions, input.workflowVersionId, "workflow version"));
        if (t.workflowInstances.some((i) => i.tenantId === tenantId && i.objectKey === input.objectKey && i.recordId === input.recordId)) {
          throw new PolicyStoreError(`duplicate key: record "${input.recordId}" already has a workflow instance`);
        }
        const row: WorkflowInstanceRecord = { ...input, id: this.nextId(), tenantId, ...this.stamp(actor) };
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
        const eventKind = input.eventKind ?? "TRANSITION";
        if ((eventKind === "ADOPT" || eventKind === "MIGRATE") && !input.auditEventId) {
          throw new PolicyStoreError("an administrative instance event must name its audit event");
        }
        t.workflowInstanceEvents.push({ ...input, eventKind, id: this.nextId(), tenantId });
      },

      setWorkflowActiveVersion: async (workflowId, versionId) => {
        const workflow = requireOwned(t.workflows, workflowId, "workflow");
        if (versionId !== null) {
          const version = requireOwned(t.workflowVersions, versionId, "workflow version");
          if (version.workflowId !== workflowId) throw new PolicyStoreError("the active version must belong to this workflow");
          if (version.status !== "PUBLISHED") {
            throw new PolicyStoreError(`WORKFLOW_ACTIVE_VERSION_NOT_PUBLISHED: the active version must be PUBLISHED (it is ${version.status})`);
          }
        }
        return replace(t.workflows, { ...workflow, activeVersionId: versionId, updatedBy: actor.uid, updatedAt: this.now() });
      },

      retireWorkflowVersion: async (versionId) => {
        const current = requireOwned(t.workflowVersions, versionId, "workflow version");
        if (current.status === "RETIRED") {
          throw new PolicyStoreError("WORKFLOW_INVALID_LIFECYCLE: RETIRED -> RETIRED is not a workflow version transition");
        }
        if (t.workflows.some((w) => w.tenantId === tenantId && w.activeVersionId === versionId)) {
          throw new PolicyStoreError("WORKFLOW_VERSION_ACTIVE: the active version cannot be retired");
        }
        const pinned = t.workflowInstances.filter((i) => i.tenantId === tenantId && i.workflowVersionId === versionId).length;
        if (pinned > 0) throw new PolicyStoreError(`WORKFLOW_VERSION_PINNED: ${pinned} live instance(s) are pinned to this version`);
        return replace(t.workflowVersions, { ...current, status: "RETIRED" as const, updatedBy: actor.uid, updatedAt: this.now() });
      },

      repinWorkflowInstance: async (instanceId, versionId, stepKey) => {
        const current = requireOwned(t.workflowInstances, instanceId, "workflow instance");
        assertPublished(requireOwned(t.workflowVersions, versionId, "workflow version"));
        return replace(t.workflowInstances, {
          ...current, workflowVersionId: versionId, currentStepKey: stepKey, updatedBy: actor.uid, updatedAt: this.now(),
        });
      },

      // ── Administration decisions and grant conditions ──
      // Mirrors migration 1762646400000: one CURRENT decision per cell, history superseded not
      // deleted; a condition is never retired while the grant it narrows is held.
      recordRoleCapabilityDecision: async (input) => {
        requireOwned(t.roles, t.roles.find((r) => r.tenantId === tenantId && r.key === input.roleKey)?.id ?? "", "role");
        if (!input.reason || input.reason.trim() === "") throw new PolicyStoreError("a decision requires a reason");
        if (input.decision === "ADMIN_REVOKED" && input.requiresCondition) {
          throw new PolicyStoreError("a revocation cannot require a condition");
        }
        if (!t.audit.some((a) => a.id === input.auditEventId && a.tenantId === tenantId)) {
          throw new PolicyStoreError("a decision must name its audit event");
        }
        const at = this.now();
        const id = this.nextId();
        const current = t.decisions.findIndex((d) => d.tenantId === tenantId && d.roleKey === input.roleKey
          && d.capabilityKey === input.capabilityKey && d.supersededAt === null);
        if (current >= 0) t.decisions[current] = { ...t.decisions[current], supersededAt: at, supersededBy: id };
        const row: RoleCapabilityDecisionRecord = {
          id, tenantId, roleKey: input.roleKey, capabilityKey: input.capabilityKey, decision: input.decision,
          requiresCondition: input.requiresCondition, reason: input.reason, actorPrincipalId: input.actorPrincipalId,
          auditEventId: input.auditEventId, decidedAt: at, supersededAt: null, supersededBy: null,
        };
        t.decisions.push(row);
        return row;
      },
      upsertGrantCondition: async (input) => {
        const at = this.now();
        const i = t.grantConditions.findIndex((c) => c.tenantId === tenantId && c.grantScope === input.grantScope
          && c.grantorKey === input.grantorKey && c.capabilityKey === input.capabilityKey);
        const condition = JSON.parse(JSON.stringify(input.condition)) as unknown;
        if (i >= 0) {
          t.grantConditions[i] = { ...t.grantConditions[i], condition, status: "ACTIVE", updatedBy: actor.uid, updatedAt: at };
          return t.grantConditions[i];
        }
        const row: GrantConditionRecord = {
          id: this.nextId(), tenantId, grantScope: input.grantScope, grantorKey: input.grantorKey,
          capabilityKey: input.capabilityKey, condition, status: "ACTIVE",
          establishedBy: actor.uid, establishedAt: at, updatedBy: actor.uid, updatedAt: at,
        };
        t.grantConditions.push(row);
        return row;
      },
      retireGrantCondition: async (grantScope, grantorKey, capabilityKey) => {
        const i = t.grantConditions.findIndex((c) => c.tenantId === tenantId && c.grantScope === grantScope
          && c.grantorKey === grantorKey && c.capabilityKey === capabilityKey && c.status === "ACTIVE");
        if (i < 0) return null;
        const capabilityId = t.capabilities.find((c) => c.key === capabilityKey)?.id;
        const held = grantScope === "ROLE"
          ? t.roleCapabilities.some((g) => g.tenantId === tenantId && g.capabilityId === capabilityId
            && t.roles.some((r) => r.id === g.roleId && r.key === grantorKey))
          : t.principalCapabilities.some((g) => g.tenantId === tenantId && g.capabilityId === capabilityId
            && g.principalId === grantorKey);
        if (held) {
          throw new PolicyStoreError(`CONDITION_RETIREMENT_WOULD_WIDEN: ${grantScope} ${grantorKey}/${capabilityKey} is still granted`);
        }
        t.grantConditions[i] = { ...t.grantConditions[i], status: "RETIRED", updatedBy: actor.uid, updatedAt: this.now() };
        return t.grantConditions[i];
      },

      // In memory, a transaction is already exclusive (one JS turn per await chain in tests); the locks
      // are no-ops and the reads are the same rules the PostgreSQL adapter expresses in SQL.
      beginAdministrationCommand: async () => undefined,
      lockGrantCell: async () => undefined,
      readPrincipalGrantCell: async (principalId, capabilityKey) => {
        const cap = t.capabilities.find((c) => c.key === capabilityKey);
        const grant = t.principalCapabilities.find((g) => g.tenantId === tenantId && g.principalId === principalId
          && g.capabilityId === cap?.id) ?? null;
        return {
          grant,
          expired: Boolean(grant?.expiresAt && grant.expiresAt <= this.now()),
          condition: t.grantConditions.find((c) => c.tenantId === tenantId && c.grantScope === "PRINCIPAL" && c.grantorKey === principalId
            && c.capabilityKey === capabilityKey && c.status === "ACTIVE") ?? null,
        };
      },
      readGrantCell: async (roleKey, capabilityKey) => {
        const role = t.roles.find((r) => r.tenantId === tenantId && r.key === roleKey);
        const cap = t.capabilities.find((c) => c.key === capabilityKey);
        return {
          grant: t.roleCapabilities.find((g) => g.tenantId === tenantId && g.roleId === role?.id && g.capabilityId === cap?.id) ?? null,
          decision: t.decisions.find((d) => d.tenantId === tenantId && d.roleKey === roleKey && d.capabilityKey === capabilityKey && d.supersededAt === null) ?? null,
          condition: t.grantConditions.find((c) => c.tenantId === tenantId && c.grantScope === "ROLE" && c.grantorKey === roleKey
            && c.capabilityKey === capabilityKey && c.status === "ACTIVE") ?? null,
        };
      },
      readAssignment: async (assignmentId) =>
        t.assignments.find((a) => a.tenantId === tenantId && a.id === assignmentId) ?? null,
      administrationHolderCount: async (capabilityKey, exclude) => {
        const cap = t.capabilities.find((c) => c.key === capabilityKey);
        if (!cap) return 0;
        const conditioned = new Set(t.grantConditions.filter((c) => c.tenantId === tenantId && c.grantScope === "ROLE"
          && c.capabilityKey === capabilityKey && c.status === "ACTIVE").map((c) => c.grantorKey));
        const holderRoles = new Set(t.roleCapabilities.filter((g) => g.tenantId === tenantId && g.capabilityId === cap.id
          && g.roleId !== exclude.roleId
          && !conditioned.has(t.roles.find((r) => r.id === g.roleId)?.key ?? "")).map((g) => g.roleId));
        const holders = new Set<string>();
        for (const a of t.assignments) {
          if (a.tenantId !== tenantId || a.status !== "active" || a.id === exclude.assignmentId) continue;
          if ((a.scopeType ?? "global") !== "global" || !holderRoles.has(a.roleId)) continue;
          const version = t.accessVersions.find((v) => v.tenantId === tenantId && v.principalId === a.principalId)?.accessVersion ?? 0;
          if (a.accessVersionAtGrant > version) continue;
          holders.add(a.principalId);
        }
        const conditionedDirect = new Set(t.grantConditions.filter((c) => c.tenantId === tenantId && c.grantScope === "PRINCIPAL"
          && c.capabilityKey === capabilityKey && c.status === "ACTIVE").map((c) => c.grantorKey));
        for (const g of t.principalCapabilities) {
          if (g.tenantId === tenantId && g.capabilityId === cap.id && g.principalId !== exclude.principalId && !g.expiresAt
            && !conditionedDirect.has(g.principalId)) holders.add(g.principalId);
        }
        return [...holders].filter((id) => {
          const p = t.principals.find((x) => x.id === id);
          const m = t.memberships.find((x) => x.tenantId === tenantId && x.principalId === id);
          // A principal row may be absent in resolver fixtures that assign by id alone; membership decides.
          return (!p || p.status === "active") && m?.status === "active";
        }).length;
      },
      // GLOBAL only (lane SC): a scoped assignment of a protected Role administers nothing, so it keeps nobody in.
      protectedRoleAssignmentCount: async (excludeAssignmentId) => t.assignments.filter((a) => a.tenantId === tenantId
        && a.status === "active" && (a.scopeType ?? "global") === "global" && a.id !== excludeAssignmentId
        && t.roles.some((r) => r.id === a.roleId && r.protected)).length,
      activeGlobalAssignmentCountForRole: async (roleId, excludeAssignmentId) => t.assignments.filter((a) => a.tenantId === tenantId
        && a.status === "active" && (a.scopeType ?? "global") === "global" && a.roleId === roleId && a.id !== excludeAssignmentId).length,

      appendAudit: async (input) => {
        const id = this.nextId();
        t.audit.push({ ...input, id, tenantId });
        return id;
      },
    };
  }

  // ════════════════════ reads ════════════════════
  //
  // Every one filters by tenant first. There is no method that could return another tenant's row,
  // which is the property the tenancy proofs assert rather than a convention they trust.

  private mine<T extends { tenantId: TenantId }>(rows: readonly T[], tenantId: TenantId): T[] {
    return rows.filter((r) => r.tenantId === tenantId);
  }

  // Tenant and identity reads. `getTenantByKey` is the one deliberately unscoped read in the port:
  // a bootstrap has to ask whether a tenant exists before there is a tenant to scope by. It returns
  // one tenant found by its own key and nothing owned by it.
  async getTenantByKey(key: string) { return this.tables.tenants.find((x) => x.key === key) ?? null; }
  async getTenant(tenantId: TenantId) { return this.tables.tenants.find((x) => x.id === tenantId) ?? null; }
  async getPrincipalBySubject(identityProvider: string, externalSubject: string) {
    return this.tables.principals.find(
      (x) => x.identityProvider === identityProvider && x.externalSubject === externalSubject,
    ) ?? null;
  }
  async getPrincipal(principalId: string) {
    return this.tables.principals.find((x) => x.id === principalId) ?? null;
  }
  async getPrincipalByIdentityBinding(identityProvider: string, externalSubject: string) {
    const binding = (this.tables.principalIdentities ?? []).find(
      (x) => x.identityProvider === identityProvider && x.externalSubject === externalSubject && x.status === "active",
    );
    return binding ? (this.tables.principals.find((x) => x.id === binding.principalId) ?? null) : null;
  }
  async getActiveIdentityBinding(principalId: string, identityProvider: string) {
    return (this.tables.principalIdentities ?? []).find(
      (x) => x.principalId === principalId && x.identityProvider === identityProvider && x.status === "active",
    ) ?? null;
  }
  async listMembershipsForPrincipal(principalId: string) {
    return this.tables.memberships.filter((m) => m.principalId === principalId);
  }
  async getMembership(tenantId: TenantId, principalId: string) {
    return this.mine(this.tables.memberships, tenantId).find((m) => m.principalId === principalId) ?? null;
  }
  async listTenantPrincipalIds(tenantId: TenantId) {
    return this.mine(this.tables.memberships, tenantId).map((m) => m.principalId);
  }
  async getAdminBootstrap(tenantId: TenantId) {
    return this.tables.adminBootstraps.find((b) => b.tenantId === tenantId) ?? null;
  }

  async listObjects(tenantId: TenantId) { return this.mine(this.tables.objects, tenantId); }
  async getObjectByKey(tenantId: TenantId, key: string) {
    return this.mine(this.tables.objects, tenantId).find((o) => o.key === key) ?? null;
  }
  async listFields(tenantId: TenantId, objectId: string) {
    return this.mine(this.tables.fields, tenantId).filter((f) => f.objectId === objectId);
  }
  async listRoles(tenantId: TenantId) { return this.mine(this.tables.roles, tenantId); }
  async getRoleByKey(tenantId: TenantId, key: string) {
    return this.mine(this.tables.roles, tenantId).find((r) => r.key === key) ?? null;
  }
  // The capability catalog is GLOBAL -- not tenant-filtered -- exactly as in the postgres adapter,
  // so a test that passes here cannot pass for a reason the real store would not reproduce.
  async listCapabilities() { return [...this.tables.capabilities]; }

  /**
   * Put catalog rows in front of the code, as a MIGRATION would.
   *
   * THE CATALOG IS BORN IN A MIGRATION. That is why no `PolicyTransaction` method writes it and why
   * the postgres adapter has no equivalent of this: `capabilities` is platform vocabulary, not
   * tenant configuration, and nothing in the running system may mint a key. This seam exists so a
   * fixture can stand up the same rows the migration chain writes; it is the ONLY way to put a
   * capability into this repository, and it grants nothing -- a row here confers no access to
   * anybody until a Role or a Principal is granted it.
   */
  registerCapabilities(rows: readonly Omit<CapabilityRecord, "id">[]): readonly CapabilityRecord[] {
    const made: CapabilityRecord[] = [];
    for (const row of rows) {
      const existing = this.tables.capabilities.find((c) => c.key === row.key);
      if (existing) { made.push(existing); continue; }
      const record: CapabilityRecord = { id: this.nextId(), ...row };
      this.tables.capabilities.push(record);
      made.push(record);
    }
    return made;
  }
  async listRoleCapabilities(tenantId: TenantId, roleIds?: readonly string[]) {
    const mine = this.mine(this.tables.roleCapabilities, tenantId);
    return roleIds ? mine.filter((g) => roleIds.includes(g.roleId)) : mine;
  }
  async listPrincipalCapabilities(tenantId: TenantId, principalId?: string) {
    const now = this.now();
    const mine = this.mine(this.tables.principalCapabilities, tenantId).filter((g) => !g.expiresAt || g.expiresAt > now);
    return principalId ? mine.filter((g) => g.principalId === principalId) : mine;
  }
  async listObjectPermissions(tenantId: TenantId, roleIds: readonly string[]) {
    return this.mine(this.tables.objectPermissions, tenantId).filter((p) => roleIds.includes(p.roleId));
  }
  async listFieldOverrides(tenantId: TenantId, roleIds: readonly string[]) {
    return this.mine(this.tables.fieldOverrides, tenantId).filter((p) => roleIds.includes(p.roleId));
  }
  async listAssignmentsForPrincipal(tenantId: TenantId, principalId: string) {
    return this.mine(this.tables.assignments, tenantId).filter((a) => a.principalId === principalId);
  }
  /**
   * Employee links live in PostgreSQL (eos_policy.employee_principal_links + eos_workforce.employees); the in-memory
   * repository models none unless a test SEEDS one through `seedEmployeeLink`, so every Principal here is unlinked.
   */
  private readonly employeeLinks = new Map<string, { employeeId: string; employmentStatus: string | null }>();
  seedEmployeeLink(tenantId: TenantId, principalId: string, employeeId: string, employmentStatus: string | null): void {
    this.employeeLinks.set(`${tenantId}|${principalId}`, { employeeId, employmentStatus });
  }
  async getLinkedEmployeeAccessFact(tenantId: TenantId, principalId: string) {
    return this.employeeLinks.get(`${tenantId}|${principalId}`) ?? null;
  }
  async getAccessVersion(tenantId: TenantId, principalId: string) {
    return this.mine(this.tables.accessVersions, tenantId).find((v) => v.principalId === principalId) ?? null;
  }
  async listWorkflows(tenantId: TenantId) { return this.mine(this.tables.workflows, tenantId); }
  async listWorkflowVersions(tenantId: TenantId, workflowId: string) {
    return this.mine(this.tables.workflowVersions, tenantId).filter((v) => v.workflowId === workflowId);
  }
  async listWorkflowSteps(tenantId: TenantId, versionId: string) {
    return this.mine(this.tables.workflowSteps, tenantId).filter((s) => s.workflowVersionId === versionId);
  }
  async listWorkflowActions(tenantId: TenantId, versionId: string) {
    return this.mine(this.tables.workflowActions, tenantId).filter((a) => a.workflowVersionId === versionId);
  }
  async listWorkflowRoleBindings(tenantId: TenantId, versionId: string) {
    return this.mine(this.tables.workflowRoleBindings, tenantId).filter((b) => b.workflowVersionId === versionId);
  }
  async listFunctionalRoles(tenantId: TenantId) { return this.mine(this.tables.functionalRoles, tenantId); }

  /**
   * Put a Functional Role catalog row in place, as the governed Workforce command would.
   *
   * The catalog is written by eosWorkforce/commands/employeeFunctionalRoleCommands.ts against PostgreSQL; the policy
   * port only READS it. This seam lets an offline fixture stand up the same rows. It grants nothing.
   */
  putFunctionalRole(row: Omit<FunctionalRoleRecord, "id"> & { readonly id?: string }): FunctionalRoleRecord {
    const existing = this.tables.functionalRoles.find((r) => r.tenantId === row.tenantId && (r.key === row.key || r.id === row.id));
    const record: FunctionalRoleRecord = { ...row, id: row.id ?? existing?.id ?? this.nextId() };
    if (existing) this.tables.functionalRoles[this.tables.functionalRoles.indexOf(existing)] = record;
    else this.tables.functionalRoles.push(record);
    return record;
  }
  async getWorkflowInstance(tenantId: TenantId, objectKey: string, recordId: string) {
    return this.mine(this.tables.workflowInstances, tenantId)
      .find((i) => i.objectKey === objectKey && i.recordId === recordId) ?? null;
  }
  async getWorkflowInstanceById(tenantId: TenantId, instanceId: string) {
    return this.mine(this.tables.workflowInstances, tenantId).find((i) => i.id === instanceId) ?? null;
  }
  async listWorkflowInstances(tenantId: TenantId, versionId: string) {
    return this.mine(this.tables.workflowInstances, tenantId).filter((i) => i.workflowVersionId === versionId);
  }
  async listWorkflowInstanceEvents(tenantId: TenantId, instanceId: string) {
    return this.mine(this.tables.workflowInstanceEvents, tenantId).filter((e) => e.instanceId === instanceId);
  }
  async listAuditEvents(tenantId: TenantId, limit: number) {
    return this.mine(this.tables.audit, tenantId).slice(-limit);
  }
  async queryAuditEvents(tenantId: TenantId, filter: AuditEventFilter) {
    const field = (e: PolicyAuditEventRecord, key: string, value: string) =>
      [e.after, e.before].some((p) => p !== null && typeof p === "object" && (p as Record<string, unknown>)[key] === value);
    const rows = this.mine(this.tables.audit, tenantId).filter((e) => {
      const f = filter;
      if (f.principalId && !(e.actorUid === f.principalId || e.targetId === f.principalId
        || field(e, "principalId", f.principalId) || field(e, "granteeKey", f.principalId))) return false;
      if (f.employeeId && !(e.targetId === f.employeeId || field(e, "employeeId", f.employeeId))) return false;
      if (f.roleKey && !(field(e, "granteeKey", f.roleKey) || field(e, "roleKey", f.roleKey)
        || (f.roleId ? field(e, "roleId", f.roleId) : false))) return false;
      if (f.objectKey && !field(e, "objectKey", f.objectKey)) return false;
      if (f.capabilityKey && !field(e, "capabilityKey", f.capabilityKey)) return false;
      if (f.actionKey && !field(e, "actionKey", f.actionKey)) return false;
      if (f.workflowKey && !(field(e, "workflowKey", f.workflowKey) || (e.targetKind.startsWith("workflow") && field(e, "key", f.workflowKey)))) return false;
      if (f.from && e.occurredAt < f.from) return false;
      if (f.to && e.occurredAt >= f.to) return false;
      return true;
    });
    return rows.slice(-filter.limit);
  }

  async listRoleCapabilityDecisions(tenantId: TenantId, options: { readonly currentOnly?: boolean } = {}) {
    const mine = this.mine(this.tables.decisions, tenantId);
    return options.currentOnly === false ? mine : mine.filter((d) => d.supersededAt === null);
  }
  async listGrantConditions(tenantId: TenantId, options: { readonly activeOnly?: boolean } = {}) {
    const mine = this.mine(this.tables.grantConditions, tenantId);
    return options.activeOnly === false ? mine : mine.filter((c) => c.status === "ACTIVE");
  }

  // Lane SC: governed assignment-scope values. In memory there is no operating-company or warehouse relation, so a
  // test states them; an unstated type has no governed source (null) and a scoped assignment of it is refused.
  private readonly scopeValues = new Map<string, readonly { value: string; label: string }[]>();
  setAssignmentScopeValues(tenantId: TenantId, scopeType: string, values: readonly { value: string; label: string }[]): void {
    this.scopeValues.set(`${tenantId}|${scopeType}`, Object.freeze(values.map((v) => Object.freeze({ ...v }))));
  }
  async listAssignmentScopeValues(tenantId: TenantId, scopeType: string) {
    return this.scopeValues.get(`${tenantId}|${scopeType}`) ?? null;
  }
}

/**
 * A PUBLISHED version is immutable.
 *
 * Enforced in the store rather than only in the service, because "editing v2 must not retroactively
 * reinterpret an in-flight v1 instance" is a property of the data, and a second writer that skipped
 * the service would otherwise break it silently.
 */
function assertPublished(version: WorkflowVersionRecord): void {
  if (version.status !== "PUBLISHED") {
    throw new PolicyStoreError(`WORKFLOW_INSTANCE_VERSION_NOT_PUBLISHED: an instance may only pin a PUBLISHED version (it is ${version.status})`);
  }
}

function assertDraft(version: WorkflowVersionRecord): void {
  if (version.status !== "DRAFT") {
    throw new PolicyStoreError(`workflow version ${version.version} is ${version.status} and cannot be edited`);
  }
}

/** Convenience for tests and seeds. Nothing in production constructs a repository inline. */
export const createInMemoryPolicyRepository = (options?: InMemoryOptions): PolicyRepository =>
  new InMemoryPolicyRepository(options);

export type { PolicyReader };
export type { CredOverride, CredSet };
