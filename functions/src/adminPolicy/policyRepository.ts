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
  ObjectFieldRecord,
  ObjectRecord,
  PolicyAssignmentStatus,
  PolicyAuditEventRecord,
  PolicyRoleAssignmentRecord,
  PolicyRoleRecord,
  PrincipalAccessVersionRecord,
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
  // ── objects and fields ──
  createObject(input: NewRecord<ObjectRecord>): Promise<ObjectRecord>;
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
  createAssignment(input: NewRecord<PolicyRoleAssignmentRecord>): Promise<PolicyRoleAssignmentRecord>;
  setAssignmentStatus(assignmentId: string, status: PolicyAssignmentStatus): Promise<PolicyRoleAssignmentRecord>;
  /** Returns the NEW version. Called by every mutation that can change what a principal may do. */
  bumpAccessVersion(principalUid: string): Promise<number>;

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
  listObjects(tenantId: TenantId): Promise<readonly ObjectRecord[]>;
  getObjectByKey(tenantId: TenantId, key: string): Promise<ObjectRecord | null>;
  listFields(tenantId: TenantId, objectId: string): Promise<readonly ObjectFieldRecord[]>;

  listRoles(tenantId: TenantId): Promise<readonly PolicyRoleRecord[]>;
  getRoleByKey(tenantId: TenantId, key: string): Promise<PolicyRoleRecord | null>;

  listObjectPermissions(tenantId: TenantId, roleIds: readonly string[]): Promise<readonly RoleObjectPermissionRecord[]>;
  listFieldOverrides(tenantId: TenantId, roleIds: readonly string[]): Promise<readonly RoleFieldPermissionOverrideRecord[]>;

  listAssignmentsForPrincipal(tenantId: TenantId, principalUid: string): Promise<readonly PolicyRoleAssignmentRecord[]>;
  getAccessVersion(tenantId: TenantId, principalUid: string): Promise<PrincipalAccessVersionRecord | null>;

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
