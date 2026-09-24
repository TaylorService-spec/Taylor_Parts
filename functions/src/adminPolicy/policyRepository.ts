// The policy DAL boundary.
//
// ════════════════════ THE RULE THIS FILE EXISTS TO ENFORCE ════════════════════
//
//   UI -> EOS trusted API -> authorization -> Admin Policy Service -> DAL -> PostgreSQL
//
// and never:
//
//   browser -> PostgreSQL
//   browser -> fetch all Role policy and decide access itself
//   browser -> Firestore
//
// No Admin UI queries policy storage. Everything above this line asks the service; the service asks
// this port; only an adapter behind this port knows what a database is. That is what lets the
// deployment posture change later -- shared service + shared DB, shared service + dedicated
// customer DB, dedicated environment -- without EOS business code changing.
//
// ════════════════════ WHY A PORT, NOW THAT THE DRIVER IS CHOSEN ════════════════════
//
// Owner ruling D-1 selected PostgreSQL + `pg` + `node-pg-migrate`, and
// `postgresPolicyRepository.ts` implements this interface against it. The port did not become
// redundant when that landed -- it is what keeps the choice reversible and the layers apart:
//
//   nothing above this file imports `pg`, sees a row, or knows a column name;
//   the in-memory adapter still satisfies it, so the resolver's own proofs need no database;
//   a second deployment posture -- dedicated customer database, dedicated environment -- is an
//   adapter question rather than an EOS-business-code question.
//
// Falling back to Firestore was explicitly refused, and no adapter behind this port may reach it.
//
// ════════════════════ TENANCY ════════════════════
//
// Every method takes a TenantId as its first argument, and no method offers a cross-tenant read.
// The tenant is derived server-side from the authenticated principal; a caller cannot widen it
// because there is no parameter that would accept the widening. A query for tenant A that returned
// tenant B's rows is not expressible through this port.
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

/** Raised when a caller asks for something the store cannot honour. Never leaks another tenant's data. */
export class PolicyStoreError extends Error {}

/** Field values a caller may supply on create. The store owns id, tenant and provenance. */
export type NewRecord<T> = Omit<T, "id" | "tenantId" | "createdBy" | "createdAt" | "updatedBy" | "updatedAt">;

/** A Role's grant of one canonical capability. `grantedAt` is server-authored, never client-sent. */
export interface NewRoleCapabilityInput {
  readonly roleId: string;
  readonly capabilityId: string;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

/** A Principal's DIRECT grant of one canonical capability. The grantee is never an Employee. */
export interface NewPrincipalCapabilityInput {
  readonly principalId: string;
  readonly capabilityId: string;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

/** A new tenant. The store assigns the id; the caller owns the key. */
export interface NewTenantInput {
  readonly key: string;
  readonly name: string;
  readonly status?: TenantRecord["status"];
  readonly configurationVersion?: number;
}

/** A new principal. The store assigns the id -- the EOS-native, provider-neutral one. */
export interface NewPrincipalInput {
  readonly externalSubject: string;
  readonly identityProvider: string;
  readonly displayName?: string | null;
  readonly status?: PrincipalStatus;
}

/**
 * A Principal's EXTERNAL AUTHENTICATION BINDING, and nothing else.
 *
 * The model is ONE external identity per Principal: `principals` carries `(identity_provider,
 * external_subject)` under a UNIQUE constraint and there is no separate identity-binding table. So
 * changing which token resolves to a Principal is an UPDATE of those two columns -- not an insert,
 * and deliberately not a field of `NewPrincipalInput`, which would let a create silently re-point an
 * existing row.
 *
 * `displayName` is carried here because the display name states what the binding IS -- "cannot sign
 * in" is a lie the moment a real subject is attached -- and leaving it behind would make the row
 * describe itself wrongly.
 */
export interface PrincipalIdentityBindingInput {
  readonly identityProvider: string;
  readonly externalSubject: string;
  readonly displayName?: string | null;
}

export interface NewAdminBootstrapInput {
  readonly principalId: string;
  readonly performedBy: string;
  readonly reason?: string | null;
}

/** Who is making the change, for provenance stamping. Supplied by the service, never by a client. */
export interface PolicyActor {
  readonly tenantId: TenantId;
  readonly uid: string;
}

/**
 * A unit of work.
 *
 * ONE TRANSACTION PER MUTATION, and the reason is the access version: a role grant that lands
 * without its version bump leaves every cached authorization decision valid, which is a security
 * failure rather than a consistency inconvenience. The port therefore has no way to write a grant
 * outside a transaction that can also bump the version and write the audit event.
 */
export interface PolicyTransaction {
  // ── tenant and identity ──
  //
  // These are here, inside the unit of work, for the same reason everything else is: creating a
  // tenant and seeding its policy is ONE thing. A tenant that exists with no Objects, no Roles and
  // no workflows is worse than no tenant, because an administrator opening it sees a configured
  // platform with nothing in it and no way to tell which half failed.
  createTenant(input: NewTenantInput): Promise<TenantRecord>;
  setTenantConfigurationVersion(tenantId: TenantId, version: number): Promise<TenantRecord>;
  createPrincipal(input: NewPrincipalInput): Promise<PrincipalRecord>;
  /**
   * Re-point ONE Principal at a different external authentication binding.
   *
   * IT CHANGES THE LOGIN AND NOTHING ELSE. The Principal id is untouched, and the id is what every
   * assignment, membership, employee link, direct grant and audit row references -- so this cannot
   * move, create or destroy authority. It writes `identity_provider`, `external_subject` and
   * `display_name`; there is no parameter for a status, a Role or a capability, so widening is not
   * expressible here rather than merely refused.
   *
   * TENANT-SCOPED IN THE STORE, like every other write on this port: an adapter must refuse a
   * Principal that is not a member of the transaction's tenant, so a tenant cannot re-point
   * somebody else's Principal at a subject it controls.
   */
  setPrincipalIdentity(principalId: string, input: PrincipalIdentityBindingInput): Promise<PrincipalRecord>;
  createTenantMembership(principalId: string, status?: PrincipalStatus): Promise<TenantMembershipRecord>;
  setTenantMembershipStatus(membershipId: string, status: PrincipalStatus): Promise<TenantMembershipRecord>;
  /**
   * Record that the initial administering state was established.
   *
   * Refuses if one already exists for the tenant -- the store enforces it, not only the command,
   * so a second writer cannot get past it by skipping the command layer.
   */
  recordAdminBootstrap(input: NewAdminBootstrapInput): Promise<TenantAdminBootstrapRecord>;

  // ── objects and fields ──
  createObject(input: NewRecord<ObjectRecord>): Promise<ObjectRecord>;
  /**
   * Change an Object's DISPLAY metadata.
   *
   * The patch type names the writable subset deliberately. `key` is identity and is absent; so are
   * `origin`, `lifecycle` and `supportsDelete`, which are facts about what the platform can
   * enforce rather than things a tenant chooses. What is left is what a tenant legitimately renames:
   * this platform's own canonical Object is "Accounts" while the UI says "Customer", which is
   * exactly the case this exists for.
   */
  updateObject(
    objectId: string,
    patch: { label?: string; labelPlural?: string | null; description?: string | null },
  ): Promise<ObjectRecord>;
  createField(input: NewRecord<ObjectFieldRecord>): Promise<ObjectFieldRecord>;
  updateField(fieldId: string, patch: Partial<NewRecord<ObjectFieldRecord>>): Promise<ObjectFieldRecord>;

  // ── roles ──
  createRole(input: NewRecord<PolicyRoleRecord>): Promise<PolicyRoleRecord>;
  updateRole(roleId: string, patch: Partial<NewRecord<PolicyRoleRecord>>): Promise<PolicyRoleRecord>;

  // ── permissions ──
  setObjectPermission(roleId: string, objectId: string, cred: CredSet): Promise<RoleObjectPermissionRecord>;
  /** An EMPTY override removes the row: "no opinion" has one spelling, not two. */
  setFieldOverride(roleId: string, fieldId: string, override: CredOverride): Promise<void>;

  // ── assignment ──
  // ── canonical Object-owned security grants ──
  //
  // Grant is idempotent by (tenant, grantee, capability): re-granting returns the existing row
  // rather than writing a duplicate, matching assignRole's established no-op convention. Revoke
  // returns the row it removed, or null when there was nothing to remove -- so the command layer
  // can tell "revoked" from "was never granted" and audit only the first.
  grantRoleCapability(input: NewRoleCapabilityInput): Promise<RoleCapabilityRecord>;
  revokeRoleCapability(roleId: string, capabilityId: string): Promise<RoleCapabilityRecord | null>;
  grantPrincipalCapability(input: NewPrincipalCapabilityInput): Promise<PrincipalCapabilityRecord>;
  revokePrincipalCapability(principalId: string, capabilityId: string): Promise<PrincipalCapabilityRecord | null>;

  createAssignment(input: NewRecord<PolicyRoleAssignmentRecord>): Promise<PolicyRoleAssignmentRecord>;
  setAssignmentStatus(assignmentId: string, status: PolicyAssignmentStatus): Promise<PolicyRoleAssignmentRecord>;
  /** Returns the NEW version. Called by every mutation that can change what a principal may do. */
  bumpAccessVersion(principalId: string): Promise<number>;

  // ── workflows ──
  createWorkflow(input: NewRecord<WorkflowRecord>): Promise<WorkflowRecord>;
  createWorkflowVersion(input: NewRecord<WorkflowVersionRecord>): Promise<WorkflowVersionRecord>;
  createWorkflowStep(input: NewRecord<WorkflowStepRecord>): Promise<WorkflowStepRecord>;
  createWorkflowAction(input: NewRecord<WorkflowActionRecord>): Promise<WorkflowActionRecord>;
  createWorkflowRoleBinding(input: NewRecord<WorkflowRoleBindingRecord>): Promise<WorkflowRoleBindingRecord>;
  publishWorkflowVersion(versionId: string): Promise<WorkflowVersionRecord>;
  createWorkflowInstance(input: NewRecord<WorkflowInstanceRecord>): Promise<WorkflowInstanceRecord>;
  advanceWorkflowInstance(instanceId: string, toStepKey: string): Promise<WorkflowInstanceRecord>;
  appendWorkflowInstanceEvent(input: Omit<WorkflowInstanceEventRecord, "id" | "tenantId">): Promise<void>;

  // ── audit ──
  /** Not optional and not configurable. Every mutation in this subsystem writes one. */
  appendAudit(input: Omit<PolicyAuditEventRecord, "id" | "tenantId">): Promise<void>;
}

/**
 * The read side.
 *
 * Reads are separate from the transaction because the resolver only ever reads, and giving it a
 * handle that could write would make "the resolver cannot mutate policy" a convention rather than a
 * type. Every method is tenant-scoped.
 */
export interface PolicyReader {
  // ── tenant and identity ──
  //
  // `getTenantByKey` is NOT tenant-scoped, and it is the one deliberate exception in this port: a
  // bootstrap has to be able to ask "does this tenant exist yet" before a tenant exists to scope
  // by. It returns one tenant found by its own natural key and nothing owned by it, so it cannot
  // be used to read across tenants.
  getTenantByKey(key: string): Promise<TenantRecord | null>;
  getTenant(tenantId: TenantId): Promise<TenantRecord | null>;
  /**
   * Resolve an authenticated subject to an EOS principal.
   *
   * Provider-scoped: the same subject string from two providers is two principals, because it is
   * two different claims about who somebody is.
   */
  getPrincipalBySubject(identityProvider: string, externalSubject: string): Promise<PrincipalRecord | null>;
  getPrincipal(principalId: string): Promise<PrincipalRecord | null>;
  /** Every membership this principal holds, across tenants. The caller decides which one applies. */
  listMembershipsForPrincipal(principalId: string): Promise<readonly TenantMembershipRecord[]>;
  getMembership(tenantId: TenantId, principalId: string): Promise<TenantMembershipRecord | null>;
  /**
   * Every principal this tenant knows about, by id.
   *
   * Exists because "who could hold a Role here" previously had to be inferred from the shapes of
   * audit events, which is true only for assignments whose audit payload happened to name a
   * principal -- so an assignment written by the bootstrap was invisible to the last-administrator
   * guard. Membership is the actual answer.
   */
  listTenantPrincipalIds(tenantId: TenantId): Promise<readonly string[]>;
  getAdminBootstrap(tenantId: TenantId): Promise<TenantAdminBootstrapRecord | null>;

  listObjects(tenantId: TenantId): Promise<readonly ObjectRecord[]>;
  getObjectByKey(tenantId: TenantId, key: string): Promise<ObjectRecord | null>;
  listFields(tenantId: TenantId, objectId: string): Promise<readonly ObjectFieldRecord[]>;

  listRoles(tenantId: TenantId): Promise<readonly PolicyRoleRecord[]>;
  getRoleByKey(tenantId: TenantId, key: string): Promise<PolicyRoleRecord | null>;

  listObjectPermissions(tenantId: TenantId, roleIds: readonly string[]): Promise<readonly RoleObjectPermissionRecord[]>;
  listFieldOverrides(tenantId: TenantId, roleIds: readonly string[]): Promise<readonly RoleFieldPermissionOverrideRecord[]>;

  // ── canonical Object-owned security ──
  //
  // The capability catalog is GLOBAL (a capability means the same thing in every tenant); the two
  // grant tables are tenant-scoped, because a grant is a fact about one tenant's Role or Principal.
  listCapabilities(): Promise<readonly CapabilityRecord[]>;
  /** Role -> capability grants. An empty roleIds list means EVERY Role in the tenant. */
  listRoleCapabilities(tenantId: TenantId, roleIds?: readonly string[]): Promise<readonly RoleCapabilityRecord[]>;
  /** Direct Principal grants. An absent principalId means EVERY principal in the tenant. */
  listPrincipalCapabilities(tenantId: TenantId, principalId?: string): Promise<readonly PrincipalCapabilityRecord[]>;

  listAssignmentsForPrincipal(tenantId: TenantId, principalId: string): Promise<readonly PolicyRoleAssignmentRecord[]>;
  getAccessVersion(tenantId: TenantId, principalId: string): Promise<PrincipalAccessVersionRecord | null>;

  listWorkflows(tenantId: TenantId): Promise<readonly WorkflowRecord[]>;
  listWorkflowVersions(tenantId: TenantId, workflowId: string): Promise<readonly WorkflowVersionRecord[]>;
  listWorkflowSteps(tenantId: TenantId, versionId: string): Promise<readonly WorkflowStepRecord[]>;
  listWorkflowActions(tenantId: TenantId, versionId: string): Promise<readonly WorkflowActionRecord[]>;
  listWorkflowRoleBindings(tenantId: TenantId, versionId: string): Promise<readonly WorkflowRoleBindingRecord[]>;
  getWorkflowInstance(tenantId: TenantId, objectKey: string, recordId: string): Promise<WorkflowInstanceRecord | null>;
  listAuditEvents(tenantId: TenantId, limit: number): Promise<readonly PolicyAuditEventRecord[]>;
}

/** The whole port. An adapter implements this and nothing above it knows which one is installed. */
export interface PolicyRepository extends PolicyReader {
  /** Runs `fn` atomically. A throw rolls everything back -- including the audit event. */
  transact<T>(actor: PolicyActor, fn: (tx: PolicyTransaction) => Promise<T>): Promise<T>;
}
