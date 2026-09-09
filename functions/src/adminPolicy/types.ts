// EOS Administration policy — the domain contracts.
//
// ════════════════════ WHAT THIS FILE IS FOR ════════════════════
//
// The target architecture is: the authentication provider supplies IDENTITY; EOS decides
// AUTHORIZATION; and everything a customer configures lives in the EOS database behind the DAL.
// These are the shapes that travel between those layers. They carry no persistence, no Firebase and
// no framework -- deliberately, and still deliberately now that PostgreSQL is chosen (Owner ruling
// D-1). A domain type that knew about a column, a driver or a connection would make the storage
// choice irreversible and would leak the database into every module that names a Role.
//
// ════════════════════ WHAT THIS FILE IS NOT ════════════════════
//
// NOT a second capability model. `functions/src/types/access.ts` already defines Permission, Role,
// RoleAssignment, Scope and Condition, and those remain the capability-level contracts. This file
// adds the layer above them -- Objects, Fields, CRED, and Workflows -- which the existing contracts
// do not express.
//
// NOT a second field-metadata model. The repository already has one: 29 entities and 394 field
// definitions in field-ops-app-vite/src/metadata/definitions, with its own type vocabulary. That
// registry stays the DESIGN-TIME description of shipped fields. `ObjectFieldRecord` below is the
// RUN-TIME governance record: it carries what a tenant owns and what an administrator can change,
// and for a system field it CITES the registry rather than copying it. One field model, two layers.
//
// NOT a compatibility-role layer. Nothing here re-declares `admin`/`dispatcher`/`technician`.

// ════════════════════ TENANCY ════════════════════
//
// Every tenant-owned record carries its owning tenant, and the server derives that value from the
// authenticated principal -- never from the request. The type exists so a record that forgot it
// cannot compile, which is a cheaper guarantee than a runtime check nobody runs.
export type TenantId = string;

/** A tenant-owned policy record. The id is opaque and server-assigned. */
export interface TenantOwned {
  readonly id: string;
  readonly tenantId: TenantId;
}

/** Who last touched a policy record, and when. Server-stamped; a client-supplied value is refused. */
export interface Provenance {
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}


// ════════════════════ TENANT, PRINCIPAL, MEMBERSHIP ════════════════════
//
// Migration 002 added these because non-production activation is the point at which "a tenant" has
// to be something the platform CREATES rather than something a test inserts by hand.
//
// THE IDENTITY MODEL IS PROVIDER-NEUTRAL ON PURPOSE. Authentication is external and temporary:
// Firebase proves who someone is today, and the platform's direction replaces that provider. If
// the authorization model's identity were the Firebase UID, replacing the provider would mean
// rewriting every assignment, every access-version row and every audit event -- which is how a
// temporary provider quietly becomes permanent. So `PrincipalRecord.id` is EOS-native and
// (identityProvider, externalSubject) is the mapping to whatever proved the identity.

export type TenantStatus = "active" | "suspended" | "retired";

/**
 * A tenant.
 *
 * `key` is the stable slug a bootstrap resolves on -- `id` is opaque and generated, and `name` is
 * a display string somebody will edit, so neither is safe to find a tenant by. `configurationVersion`
 * records which seed produced this tenant's configuration.
 */
export interface TenantRecord {
  readonly id: TenantId;
  readonly key: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly configurationVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PrincipalStatus = "active" | "disabled";

/** A human (or service identity) EOS knows about, independent of who authenticated them. */
export interface PrincipalRecord {
  readonly id: string;
  readonly externalSubject: string;
  readonly identityProvider: string;
  readonly displayName: string | null;
  readonly status: PrincipalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Which tenant a principal belongs to.
 *
 * NOT a request parameter. A client that sends a tenantId is stating a preference the server checks
 * against these rows; a principal with no ACTIVE membership resolves to no tenant at all rather
 * than to a default one.
 */
export interface TenantMembershipRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly principalId: string;
  readonly status: PrincipalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The record that the initial administering state was established, once, for one tenant.
 *
 * Its existence is the "one-time" guarantee -- the table's primary key is the tenant, so a second
 * bootstrap is refused by the database rather than by a check the caller could race.
 */
export interface TenantAdminBootstrapRecord {
  readonly tenantId: TenantId;
  readonly principalId: string;
  readonly performedBy: string;
  readonly reason: string | null;
  readonly performedAt: string;
}

// ════════════════════ CRED ════════════════════
//
// The Owner's four business verbs. CRED == CRUD; "Edit" and "Update" are the same verb and the
// business says Edit. This vocabulary is shared by Object permissions and Field permissions, which
// is the whole point -- an administrator learns one grid and reads it twice.
export const CRED_VERBS = ["C", "R", "E", "D"] as const;
export type CredVerb = (typeof CRED_VERBS)[number];

export const CRED_VERB_LABEL: Readonly<Record<CredVerb, string>> = Object.freeze({
  C: "Create",
  R: "Read",
  E: "Edit",
  D: "Delete",
});

/** A complete CRED decision. Every verb answered. */
export type CredSet = Readonly<Record<CredVerb, boolean>>;

/**
 * A PARTIAL CRED statement: the verbs this record actually speaks to.
 *
 * A verb that is absent means INHERIT, and that distinction is the reason this type exists instead
 * of a `CredSet` with defaults. Persisting a full set per field would store hundreds of copied
 * values, and the copy is what drifts: change the Object's Read and the field that merely happened
 * to agree with it silently stops agreeing.
 */
export type CredOverride = Readonly<Partial<Record<CredVerb, boolean>>>;

export const EMPTY_CRED: CredSet = Object.freeze({ C: false, R: false, E: false, D: false });

// ════════════════════ OBJECTS AND FIELDS ════════════════════

/**
 * SYSTEM vs CUSTOM, which is a governance distinction rather than a technical one.
 *
 *   SYSTEM  shipped with the platform. Its PERMISSIONS are configurable; its DEFINITION is
 *           protected -- it may not be casually deleted, retyped or re-keyed, because application
 *           code reads it by key and a rename is a silent breakage.
 *   CUSTOM  created by an administrator. Fully governed lifecycle, and destructive schema behaviour
 *           must fail safely rather than drop data.
 */
export type DefinitionOrigin = "SYSTEM" | "CUSTOM";

/**
 * A field definition's lifecycle.
 *
 * RETIRED rather than deleted is the default terminal state: records that already carry values for
 * a field do not stop having them because an administrator stopped wanting the field, and a
 * definition that vanishes turns stored data into an orphan nobody can explain.
 */
export type DefinitionLifecycle = "DRAFT" | "ACTIVE" | "RETIRED";

/**
 * The data types a field may take.
 *
 * DELIBERATELY THE REPOSITORY'S EXISTING VOCABULARY, copied here as a frozen list rather than
 * imported: the source is `field-ops-app-vite/src/metadata/entityDefinition.js`'s FIELD_TYPE, which
 * is client-side ESM that functions/ cannot import (no shared/monorepo tooling exists in this repo
 * -- the same reason types/access.ts is mirrored by hand). A drift test pins the two together, so
 * this is a mirror with a guard rather than a second vocabulary.
 */
export const FIELD_DATA_TYPES = [
  "STRING",
  "TEXT",
  "NUMBER",
  "CURRENCY_MINOR",
  "BOOLEAN",
  "DATE",
  "TIMESTAMP",
  "ENUM",
  "ENUM_SET",
  "ADDRESS",
  "REFERENCE",
  "ID",
] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

/**
 * How sensitive a field's contents are.
 *
 * Distinct from permissions: a permission says who may read it, this says what it IS. The two are
 * different questions and conflating them is how "who can see salaries" becomes unanswerable.
 * NORMAL is the default so a field is never accidentally classified by omission.
 */
export const FIELD_SENSITIVITIES = ["NORMAL", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type FieldSensitivity = (typeof FIELD_SENSITIVITIES)[number];

/** A canonical EOS business object -- Customer, Equipment, Work Order, Part, Purchase Order. */
export interface ObjectRecord extends TenantOwned, Provenance {
  /** Stable machine key. For a SYSTEM object this is the metadata registry's entity id. */
  readonly key: string;
  readonly label: string;
  readonly labelPlural: string | null;
  readonly description: string | null;
  readonly origin: DefinitionOrigin;
  readonly lifecycle: DefinitionLifecycle;
  /** True when the object supports deletion at all. A D grant on an object that does not is refused. */
  readonly supportsDelete: boolean;
}

/** A field belonging to an Object. */
export interface ObjectFieldRecord extends TenantOwned, Provenance {
  readonly objectId: string;
  /** Stable STORAGE key. Separate from the display id because a label may change and a key may not. */
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: FieldDataType;
  readonly required: boolean;
  /** Allowed values for ENUM / ENUM_SET. Empty for every other type. */
  readonly allowedValues: readonly string[];
  /** A legitimate default, or null. Never a computed value -- those belong in code. */
  readonly defaultValue: string | number | boolean | null;
  readonly searchable: boolean;
  readonly sortable: boolean;
  readonly reportable: boolean;
  readonly sensitivity: FieldSensitivity;
  /** For REFERENCE fields: the object key this points at. Null otherwise. */
  readonly referenceTo: string | null;
  readonly origin: DefinitionOrigin;
  readonly lifecycle: DefinitionLifecycle;
}

// ════════════════════ ROLES AND PERMISSIONS ════════════════════

/**
 * A Role, as policy data rather than a TypeScript constant.
 *
 * `protected` is the recovery guarantee, not a UI hint: a protected Role cannot be deleted and
 * cannot have its administering permissions removed, so ordinary Admin configuration cannot leave
 * the platform with nobody able to administer it. See the reconciliation document section 6 for the
 * bootstrap mechanisms that already exist -- this adds no new backdoor.
 */
export interface PolicyRoleRecord extends TenantOwned, Provenance {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly origin: DefinitionOrigin;
  readonly protected: boolean;
}

/** One Role's CRED over one Object. Complete: every verb answered, no inheritance at this level. */
export interface RoleObjectPermissionRecord extends TenantOwned, Provenance {
  readonly roleId: string;
  readonly objectId: string;
  readonly cred: CredSet;
}

/**
 * One Role's DEPARTURE from the inherited Object CRED, for one field.
 *
 * Only the verbs that differ are stored. A row whose override is empty is meaningless and the
 * repository refuses it -- an empty override is the absence of a row, and storing both spellings of
 * "no opinion" is how two sources of truth start.
 */
export interface RoleFieldPermissionOverrideRecord extends TenantOwned, Provenance {
  readonly roleId: string;
  readonly fieldId: string;
  readonly override: CredOverride;
}

// ════════════════════ ASSIGNMENT ════════════════════

export type PolicyAssignmentStatus = "active" | "disabled";

/**
 * A Role held by a principal.
 *
 * Deliberately the same shape as the existing Firestore-backed `RoleAssignment`
 * (functions/src/types/access.ts) so the migration is a change of STORE and not of meaning --
 * except that the timestamps are ISO strings rather than Firestore Timestamps, because this record
 * must not depend on a Firestore type to exist.
 */
export interface PolicyRoleAssignmentRecord extends TenantOwned, Provenance {
  readonly principalUid: string;
  readonly roleId: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
  readonly status: PolicyAssignmentStatus;
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly accessVersionAtGrant: number;
}

/**
 * A principal's current access version.
 *
 * THE AUTHORITATIVE SOURCE IS THIS RECORD, not `users/{uid}.accessVersion`. A role change must
 * invalidate stale authorization state, and the invalidation counter belongs with the policy it
 * invalidates rather than on a document in a different system.
 */
export interface PrincipalAccessVersionRecord extends TenantOwned {
  readonly principalUid: string;
  readonly accessVersion: number;
  readonly updatedAt: string;
}

// ════════════════════ WORKFLOWS ════════════════════
//
// A Workflow answers "what business ACTION may I perform", which is a different question from "what
// DATA may I access". Neither implies the other, and the engine keeps them apart:
//
//   holding `Start Purchasing` does NOT grant reading every Purchase Order field
//   holding `PurchaseOrder.Read` does NOT permit `Void Purchase Order`

export type WorkflowVersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface WorkflowRecord extends TenantOwned, Provenance {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  /** The Object key this workflow governs, when it governs one. */
  readonly objectKey: string | null;
  readonly origin: DefinitionOrigin;
}

/**
 * One version of a workflow definition.
 *
 * VERSIONS ARE IMMUTABLE ONCE PUBLISHED, and running instances stay pinned to the version they
 * began under. Editing v2 must not retroactively reinterpret an in-flight v1 instance: the
 * instance's history was produced under rules that said something specific, and rewriting those
 * rules afterwards makes the history unreadable.
 */
export interface WorkflowVersionRecord extends TenantOwned, Provenance {
  readonly workflowId: string;
  readonly version: number;
  readonly status: WorkflowVersionStatus;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
}

/** A state a record can be in. `initial` marks where instances start; `terminal` accepts no action. */
export interface WorkflowStepRecord extends TenantOwned, Provenance {
  readonly workflowVersionId: string;
  readonly key: string;
  readonly label: string;
  readonly initial: boolean;
  readonly terminal: boolean;
}

/** A transition: one named action moving a record from one step to another. */
export interface WorkflowActionRecord extends TenantOwned, Provenance {
  readonly workflowVersionId: string;
  readonly key: string;
  readonly label: string;
  readonly fromStepKey: string;
  readonly toStepKey: string;
  /**
   * Requires the actor to be the record's own assignee.
   *
   * Measured from the existing Work Order table, whose ACTION_PERMISSIONS carries exactly this flag.
   * Kept as a first-class field rather than a generic condition because it is the one condition
   * every measured lifecycle actually uses, and a general rules language nobody needs yet is the
   * abstraction this design is trying not to build.
   */
  readonly requiresOwnAssignment: boolean;
}

/** Which Role may perform which action. THE workflow authority, and it grants no data access. */
export interface WorkflowRoleBindingRecord extends TenantOwned, Provenance {
  readonly workflowVersionId: string;
  readonly actionKey: string;
  readonly roleId: string;
}

/** A running instance of a workflow over one business record, pinned to its version. */
export interface WorkflowInstanceRecord extends TenantOwned, Provenance {
  readonly workflowVersionId: string;
  readonly objectKey: string;
  readonly recordId: string;
  readonly currentStepKey: string;
}

/** One thing that happened to an instance. Append-only. */
export interface WorkflowInstanceEventRecord extends TenantOwned {
  readonly id: string;
  readonly instanceId: string;
  readonly actionKey: string;
  readonly fromStepKey: string;
  readonly toStepKey: string;
  readonly actorUid: string;
  readonly occurredAt: string;
  readonly reason: string | null;
}

// ════════════════════ AUDIT ════════════════════

/**
 * A policy mutation, recorded.
 *
 * Every mutation in this subsystem writes one. It is an engine invariant rather than a
 * configuration option: an administrator cannot turn it off, because the record of who changed the
 * rules is the one record whose absence cannot be reconstructed afterwards.
 */
export interface PolicyAuditEventRecord extends TenantOwned {
  readonly id: string;
  readonly action: string;
  readonly actorUid: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly occurredAt: string;
  readonly reason: string | null;
}
