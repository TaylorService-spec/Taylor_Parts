// ████████████████████████████ TEMPORARY ████████████████████████████
//
// THE SECURITY ROLE ASSIGNMENT CENSUS -- the read-only, first step of converging Security Role assignment
// authority on PostgreSQL `eos_policy.user_role_assignments` (Owner ruling: census -> reconcile identities ->
// migrate -> verify exact effective access -> switch evaluator -> switch Administration -> retire the legacy
// store). It SUCCEEDS the former `firestorePolicyParityHarness.ts`, which had three defects this module exists
// to not repeat:
//
//   1. It fell back to querying PostgreSQL with a RAW FIREBASE UID when no Principal existed. A uid is never a
//      Principal id. Here a legacy subject is resolved through `(identity_provider='firebase', external_subject)`
//      and an unresolved subject is REPORTED, never queried.
//   2. It compared the legacy `users/{uid}.accessVersion` counter against `principal_access_versions` as though
//      the two counters shared a history. They do not, so "mismatch" was meaningless. Here each assignment is
//      judged under ITS OWN store's qualification rule, and the two verdicts are reported side by side.
//   3. It imported firebase-admin into src/adminPolicy. This module is PURE: both stores arrive through injected
//      readers, so it is proved without Firebase and the legacy read lives in exactly one operator script
//      (functions/scripts/roleAssignmentCensusCli.js, the migration-only exception).
//
// ════════════════════ WHAT IT MUST NEVER BECOME ════════════════════
//
//   NOT a writer, in either store. There is no transaction handle anywhere in this file.
//   NOT a dual read. Nothing in the running system imports it (adminPolicyNoFirebase.test.mjs asserts that).
//   NOT an inference. A Security Role is never derived from `users/{uid}.role`, a Job Role, operationalRoles, a
//     title, ownership or a manager. The legacy `role` string is reported in its OWN section, LEGACY_USERS_ROLE,
//     and never merged into assignments -- Owner ruling 2026-09-18 §3 fixes it as LEGACY ADVISORY EVIDENCE:
//     never sufficient alone to create an assignment, and never silently dropped either.
//   NOT a migration plan. A row carries every BLOCKER that applies to it, under two codes that differ in who
//     clears them: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY (scoped or conditioned -- the PostgreSQL evaluator,
//     effectiveObjectAccess.ts loadPrincipalPolicy, ignores scope and has no Conditions today, so copying such a
//     grant would WIDEN it) and ROLE_NOT_IN_GOVERNED_CATALOG (§4 -- the named Role is not governed vocabulary or
//     has no Role in this tenant, so there is nothing to migrate INTO). A blocked row is never migratable.
//
// ════════════════════ DELETION CONDITION ════════════════════
//
// Delete this file, its CLI and their tests once the legacy `roleAssignments` collection is retired.
import { createHash } from "node:crypto";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { GOVERNED_BUSINESS_ROLES } from "../../access/governedBusinessRoles";
import { FIREBASE_IDENTITY_PROVIDER } from "../principalContext";
import type { PolicyReader } from "../policyRepository";

export const ROLE_ASSIGNMENT_CENSUS_FORMAT = "EOS_ROLE_ASSIGNMENT_CENSUS";
export const ROLE_ASSIGNMENT_CENSUS_VERSION = 2;
export const MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY = "MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY";
/**
 * Owner ruling 2026-09-18 §4. An assignment naming a Role the governed catalog does not contain is a
 * migration BLOCKER, not a note in a list. The two codes differ in WHO clears them:
 * MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY waits on PostgreSQL gaining Conditions and scope; this one
 * waits on an administrator fixing the catalog or the data. The census never creates the missing Role
 * and never normalizes a similar-looking key into it -- either would invent authority.
 */
export const ROLE_NOT_IN_GOVERNED_CATALOG = "ROLE_NOT_IN_GOVERNED_CATALOG";
export const LEGACY_USERS_ROLE = "LEGACY_USERS_ROLE";
/** The legacy privileged-request status that still awaits a decision (trustedWriterCommands.ts PRIVILEGED_REQUEST_STATUS). */
export const LEGACY_PRIVILEGED_PENDING_STATUS = "PENDING_APPROVAL";

/** One legacy document, exactly as read: its id and its data. */
export interface LegacyDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * The legacy store, READ ONLY. The operator CLI implements it over Firestore; tests implement it over arrays.
 * Nothing here names a collection -- that knowledge stays in the migration-only script.
 */
export interface LegacyRoleAuthorityReader {
  /** Every legacy Security Role assignment document. */
  listRoleAssignmentDocuments(): Promise<readonly LegacyDocument[]>;
  /** Every legacy user profile document. Only `role` and `accessVersion` are consulted. */
  listUserProfileDocuments(): Promise<readonly LegacyDocument[]>;
  /** Every legacy privileged-role request document. Only `status` is consulted. */
  listPrivilegedRoleRequestDocuments(): Promise<readonly LegacyDocument[]>;
}

/** The Role catalog facts the census needs. Defaults to the repository-declared catalog. */
export interface RoleCatalogFacts {
  readonly roleKeys: readonly string[];
  /** Roles with at least one Condition. The PostgreSQL evaluator cannot express any of them yet. */
  readonly conditionedRoleKeys: readonly string[];
}

export class RoleAssignmentCensusError extends Error {}

/** The repository-declared Role catalog, reduced to what the census uses. */
export function declaredRoleCatalogFacts(): RoleCatalogFacts {
  const all = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES } as Record<string, { conditionsByPermission?: Record<string, readonly unknown[]> }>;
  const roleKeys = Object.keys(all).sort();
  const conditionedRoleKeys = roleKeys.filter((key) => {
    const conditions = all[key].conditionsByPermission;
    return Boolean(conditions) && Object.values(conditions as Record<string, readonly unknown[]>).some((list) => Array.isArray(list) && list.length > 0);
  });
  return { roleKeys, conditionedRoleKeys };
}

// ════════════════════ legacy row parsing ════════════════════

/** Scope types the legacy resolver accepts (resolveEffectivePermission.ts isValidScope). */
const LEGACY_SCOPE_TYPES = Object.freeze(["global", "tenant", "domain", "location", "ownAssignment", "operatingCompany", "businessUnit"]);

type Qualification = { readonly qualifies: boolean; readonly reason: string };

interface LegacyAssignment {
  readonly documentId: string;
  readonly subject: string;
  readonly roleKey: string;
  readonly scopeType: string;
  readonly scopeValue: string | null;
  readonly status: "active" | "disabled";
  readonly accessVersionAtGrant: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The legacy resolver's well-formedness test, reproduced (resolveEffectivePermission.ts isWellFormedAssignment).
 * A malformed row contributes no grant there, so it is reported and never offered for migration.
 */
function parseLegacyAssignment(doc: LegacyDocument): LegacyAssignment | { readonly documentId: string; readonly reason: string } {
  const d = doc.data;
  if (typeof d.principalUid !== "string" || d.principalUid.length === 0) return { documentId: doc.id, reason: "PRINCIPAL_UID_MISSING" };
  if (typeof d.roleId !== "string" || d.roleId.length === 0) return { documentId: doc.id, reason: "ROLE_ID_MISSING" };
  if (!isPlainObject(d.scope) || typeof d.scope.type !== "string" || !LEGACY_SCOPE_TYPES.includes(d.scope.type)) {
    return { documentId: doc.id, reason: "SCOPE_INVALID" };
  }
  if (d.status !== "active" && d.status !== "disabled") return { documentId: doc.id, reason: "STATUS_INVALID" };
  if (typeof d.accessVersionAtGrant !== "number") return { documentId: doc.id, reason: "ACCESS_VERSION_AT_GRANT_MISSING" };
  const scopeType = d.scope.type;
  return {
    documentId: doc.id,
    subject: d.principalUid,
    roleKey: d.roleId,
    scopeType,
    // A global grant carries no value in either store; any stray value on one is not part of its identity.
    scopeValue: scopeType === "global" ? null : typeof d.scope.value === "string" ? d.scope.value : null,
    status: d.status,
    accessVersionAtGrant: d.accessVersionAtGrant,
  };
}

/** `users/{uid}.accessVersion` under the legacy feed's rule: absent reads 0, present-but-malformed is malformed. */
function legacyCurrentAccessVersion(profile: LegacyDocument | undefined): number | "MALFORMED" {
  if (!profile) return 0;
  const v = profile.data.accessVersion;
  if (v === undefined || v === null) return 0;
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : "MALFORMED";
}

function legacyQualification(a: LegacyAssignment, current: number | "MALFORMED"): Qualification {
  if (a.status !== "active") return { qualifies: false, reason: "NOT_ACTIVE" };
  if (current === "MALFORMED") return { qualifies: false, reason: "CURRENT_ACCESS_VERSION_MALFORMED" };
  if (a.accessVersionAtGrant > current) return { qualifies: false, reason: "GRANTED_AFTER_CURRENT_ACCESS_VERSION" };
  return { qualifies: true, reason: "QUALIFIES" };
}

/** effectiveObjectAccess.ts loadPrincipalPolicy's rule: active, and granted at or before the current version (absent = 0). */
function postgresQualification(status: string, accessVersionAtGrant: number, current: number): Qualification {
  if (status !== "active") return { qualifies: false, reason: "NOT_ACTIVE" };
  if (typeof accessVersionAtGrant !== "number") return { qualifies: false, reason: "ACCESS_VERSION_AT_GRANT_MISSING" };
  if (accessVersionAtGrant > current) return { qualifies: false, reason: "GRANTED_AFTER_CURRENT_ACCESS_VERSION" };
  return { qualifies: true, reason: "QUALIFIES" };
}

// ════════════════════ deterministic output ════════════════════

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Canonical JSON: object keys sorted at every depth, so the digest depends on content alone. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function countBy<T>(rows: readonly T[], keyOf: (row: T) => string, statusOf: (row: T) => string) {
  const counts = new Map<string, { active: number; disabled: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = counts.get(key) ?? { active: 0, disabled: 0 };
    if (statusOf(row) === "active") entry.active += 1; else entry.disabled += 1;
    counts.set(key, entry);
  }
  return [...counts.keys()].sort(byText).map((key) => ({ key, ...(counts.get(key) as { active: number; disabled: number }) }));
}

/** The comparison identity of a grant in either store: principal + Role key + scope. Status is compared, not keyed. */
const grantKey = (principalRef: string, roleKey: string, scopeType: string, scopeValue: string | null) =>
  `${principalRef}|${roleKey}|${scopeType}|${scopeValue ?? ""}`;

// ════════════════════ the census ════════════════════

export interface RoleAssignmentCensusInput {
  readonly legacy: LegacyRoleAuthorityReader;
  readonly policy: PolicyReader;
  readonly tenantKey: string;
  readonly catalog?: RoleCatalogFacts;
}

/**
 * Census ONE tenant's Security Role assignments across both stores.
 *
 * READ ONLY. The tenant is resolved by key and never created. The legacy store is single-tenant per Firebase
 * project; the operator names the PostgreSQL tenant that project's assignments would converge into.
 */
export async function buildRoleAssignmentCensus(input: RoleAssignmentCensusInput) {
  const tenantKey = input.tenantKey;
  if (typeof tenantKey !== "string" || tenantKey.length === 0) throw new RoleAssignmentCensusError("a tenant key is required");
  const tenant = await input.policy.getTenantByKey(tenantKey);
  if (!tenant) throw new RoleAssignmentCensusError(`no tenant with key ${tenantKey}; the census never creates one`);
  const tenantId = tenant.id;
  const catalog = input.catalog ?? declaredRoleCatalogFacts();
  const catalogKeys = new Set(catalog.roleKeys);
  const conditioned = new Set(catalog.conditionedRoleKeys);

  const [assignmentDocs, profileDocs, requestDocs] = await Promise.all([
    input.legacy.listRoleAssignmentDocuments(),
    input.legacy.listUserProfileDocuments(),
    input.legacy.listPrivilegedRoleRequestDocuments(),
  ]);
  const profilesById = new Map(profileDocs.map((d) => [d.id, d]));

  // ── the PostgreSQL side: roles, members, principals, assignments ──
  const tenantRoles = await input.policy.listRoles(tenantId);
  const roleKeyById = new Map(tenantRoles.map((r) => [r.id, r.key]));
  const tenantRoleKeys = new Set(tenantRoles.map((r) => r.key));

  // ── legacy rows ──
  const legacyRows: LegacyAssignment[] = [];
  const malformed: { documentId: string; reason: string }[] = [];
  for (const doc of assignmentDocs) {
    const parsed = parseLegacyAssignment(doc);
    if ("subject" in parsed) legacyRows.push(parsed); else malformed.push(parsed);
  }

  // ── identity: legacy subject -> Principal, by (provider, subject) and never by raw uid ──
  const legacyProfileRoleUids = profileDocs.filter((d) => d.data.role !== undefined && d.data.role !== null).map((d) => d.id);
  const subjects = [...new Set([...legacyRows.map((r) => r.subject), ...legacyProfileRoleUids])].sort(byText);
  const resolution = new Map<string, { principalId: string; principalStatus: string; membershipStatus: string | null } | null>();
  for (const subject of subjects) {
    const principal = await input.policy.getPrincipalBySubject(FIREBASE_IDENTITY_PROVIDER, subject);
    if (!principal) { resolution.set(subject, null); continue; }
    const membership = await input.policy.getMembership(tenantId, principal.id);
    resolution.set(subject, { principalId: principal.id, principalStatus: principal.status, membershipStatus: membership?.status ?? null });
  }

  const legacyAssignmentRows = legacyRows
    .map((a) => {
      const resolved = resolution.get(a.subject) ?? null;
      // Every blocker that applies, each with the code naming who clears it. Both checks below run
      // independently and both may fire: a key outside the declared catalog is ungoverned vocabulary,
      // and a key with no Role in THIS tenant has no target to migrate into. Fail-closed either way.
      const migrationBlockers: { code: string; reason: string }[] = [];
      if (a.scopeType !== "global") migrationBlockers.push({ code: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, reason: "SCOPED" });
      if (conditioned.has(a.roleKey)) migrationBlockers.push({ code: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, reason: "CONDITIONED_ROLE" });
      if (!catalogKeys.has(a.roleKey)) migrationBlockers.push({ code: ROLE_NOT_IN_GOVERNED_CATALOG, reason: "UNKNOWN_ROLE_ID" });
      if (!tenantRoleKeys.has(a.roleKey)) migrationBlockers.push({ code: ROLE_NOT_IN_GOVERNED_CATALOG, reason: "NOT_IN_TENANT_CATALOG" });
      return {
        documentId: a.documentId,
        subject: a.subject,
        principalId: resolved?.principalId ?? null,
        roleKey: a.roleKey,
        scopeType: a.scopeType,
        scopeValue: a.scopeValue,
        status: a.status,
        accessVersionAtGrant: a.accessVersionAtGrant,
        legacyQualification: legacyQualification(a, legacyCurrentAccessVersion(profilesById.get(a.subject))),
        roleKeyInCatalog: catalogKeys.has(a.roleKey),
        roleKeyInTenant: tenantRoleKeys.has(a.roleKey),
        migrationBlockers,
        migratable: migrationBlockers.length === 0,
      };
    })
    .sort((x, y) => byText(x.documentId, y.documentId));

  // ── PostgreSQL assignments, every member of the tenant ──
  const memberIds = [...new Set(await input.policy.listTenantPrincipalIds(tenantId))].sort(byText);
  const postgresAssignmentRows = [];
  const principalsById = new Map<string, { subject: string | null; identityProvider: string | null }>();
  for (const principalId of memberIds) {
    const principal = await input.policy.getPrincipal(principalId);
    principalsById.set(principalId, { subject: principal?.externalSubject ?? null, identityProvider: principal?.identityProvider ?? null });
    const versionRow = await input.policy.getAccessVersion(tenantId, principalId);
    const current = typeof versionRow?.accessVersion === "number" ? versionRow.accessVersion : 0;
    for (const a of await input.policy.listAssignmentsForPrincipal(tenantId, principalId)) {
      postgresAssignmentRows.push({
        assignmentId: a.id,
        principalId,
        identityProvider: principal?.identityProvider ?? null,
        subject: principal?.externalSubject ?? null,
        roleId: a.roleId,
        roleKey: roleKeyById.get(a.roleId) ?? null,
        scopeType: a.scopeType,
        scopeValue: a.scopeType === "global" ? null : a.scopeValue,
        status: a.status,
        accessVersionAtGrant: a.accessVersionAtGrant,
        postgresQualification: postgresQualification(a.status, a.accessVersionAtGrant, current),
        // The evaluator ignores scope today, so a non-global grant here is ALREADY evaluated as global.
        evaluatorIgnoresScope: a.scopeType !== "global",
      });
    }
  }
  postgresAssignmentRows.sort((x, y) => byText(x.assignmentId, y.assignmentId));

  // ── identity findings ──
  const assignmentSubjects = [...new Set(legacyRows.map((r) => r.subject))].sort(byText);
  const subjectsWithoutPrincipal = assignmentSubjects.filter((s) => resolution.get(s) === null);
  const principalsWithoutActiveMembership = assignmentSubjects
    .map((s) => ({ subject: s, resolved: resolution.get(s) }))
    .filter((x) => x.resolved && x.resolved.membershipStatus !== "active")
    .map((x) => ({
      subject: x.subject,
      principalId: (x.resolved as { principalId: string }).principalId,
      principalStatus: (x.resolved as { principalStatus: string }).principalStatus,
      membershipStatus: (x.resolved as { membershipStatus: string | null }).membershipStatus,
    }));

  // ── role key findings ──
  const legacyRoleKeys = [...new Set(legacyRows.map((r) => r.roleKey))].sort(byText);
  const legacyRoleIdsMissingInTenant = legacyRoleKeys.filter((k) => !tenantRoleKeys.has(k));
  const legacyRoleIdsNotInCatalog = legacyRoleKeys.filter((k) => !catalogKeys.has(k));
  const catalogRoleKeysMissingInTenant = [...catalogKeys].filter((k) => !tenantRoleKeys.has(k)).sort(byText);
  const postgresAssignmentsWithUnknownRole = postgresAssignmentRows.filter((r) => r.roleKey === null).map((r) => r.assignmentId);

  // ── the diff, both directions, by principal + Role key + scope ──
  type Side = { active: boolean; ids: string[] };
  const legacySide = new Map<string, Side & { subject: string; principalId: string | null; roleKey: string; scopeType: string; scopeValue: string | null }>();
  for (const r of legacyAssignmentRows) {
    const ref = r.principalId ?? `unresolved:${FIREBASE_IDENTITY_PROVIDER}:${r.subject}`;
    const key = grantKey(ref, r.roleKey, r.scopeType, r.scopeValue);
    const entry = legacySide.get(key) ?? { active: false, ids: [], subject: r.subject, principalId: r.principalId, roleKey: r.roleKey, scopeType: r.scopeType, scopeValue: r.scopeValue };
    entry.active = entry.active || r.status === "active";
    entry.ids.push(r.documentId);
    legacySide.set(key, entry);
  }
  const postgresSide = new Map<string, Side & { subject: string | null; principalId: string; roleKey: string; scopeType: string; scopeValue: string | null }>();
  for (const r of postgresAssignmentRows) {
    const key = grantKey(r.principalId, r.roleKey ?? `unknown-role:${r.roleId}`, r.scopeType, r.scopeValue);
    const entry = postgresSide.get(key) ?? { active: false, ids: [], subject: r.subject, principalId: r.principalId, roleKey: r.roleKey ?? `unknown-role:${r.roleId}`, scopeType: r.scopeType, scopeValue: r.scopeValue };
    entry.active = entry.active || r.status === "active";
    entry.ids.push(r.assignmentId);
    postgresSide.set(key, entry);
  }
  const describe = (key: string, side: { subject: string | null; principalId: string | null; roleKey: string; scopeType: string; scopeValue: string | null; active: boolean; ids: string[] }) => ({
    grantKey: key, subject: side.subject, principalId: side.principalId, roleKey: side.roleKey, scopeType: side.scopeType, scopeValue: side.scopeValue,
    active: side.active, ids: [...side.ids].sort(byText),
  });
  const matched = [];
  const activeStatusMismatch = [];
  const onlyInFirestore = [];
  const onlyInPostgres = [];
  for (const key of [...legacySide.keys()].sort(byText)) {
    const l = legacySide.get(key)!;
    const p = postgresSide.get(key);
    if (!p) { onlyInFirestore.push(describe(key, l)); continue; }
    if (l.active === p.active) matched.push({ grantKey: key, active: l.active });
    else activeStatusMismatch.push({ grantKey: key, firestoreActive: l.active, postgresActive: p.active, firestoreIds: [...l.ids].sort(byText), postgresIds: [...p.ids].sort(byText) });
  }
  for (const key of [...postgresSide.keys()].sort(byText)) {
    if (!legacySide.has(key)) onlyInPostgres.push(describe(key, postgresSide.get(key)!));
  }

  // ── LEGACY_USERS_ROLE: reported SEPARATELY, never merged into assignments ──
  //
  // Owner ruling 2026-09-18 §3: LEGACY ADVISORY EVIDENCE. Reported, never sufficient on its own to
  // create a Security Role assignment, and never silently dropped. Each row carries what an
  // administrator needs to decide: the value, whether a Role of that key even exists (in the declared
  // catalog and in THIS tenant), what governed authority the Principal actually holds today, and --
  // when a Principal has a legacy string and NO governed current assignment source -- an explicit
  // reconciliation flag. Matching a key is a LOOKUP, not an inference: `matchingCatalogRoleKey` says a
  // Role of that name exists, never that this Principal should hold it.
  const legacyUsersRoleRows = profileDocs
    .filter((d) => d.data.role !== undefined && d.data.role !== null)
    .map((d) => {
      const role = typeof d.data.role === "string" ? d.data.role : null;
      const principalId = resolution.get(d.id)?.principalId ?? null;
      const legacyAssignments = legacyAssignmentRows.filter((r) => r.subject === d.id);
      const postgresAssignments = principalId === null ? [] : postgresAssignmentRows.filter((r) => r.principalId === principalId);
      const governedSources = {
        legacyAssignments: legacyAssignments.length,
        legacyQualifying: legacyAssignments.filter((r) => r.legacyQualification.qualifies).length,
        postgresAssignments: postgresAssignments.length,
        postgresQualifying: postgresAssignments.filter((r) => r.postgresQualification.qualifies).length,
      };
      const hasGovernedSource = governedSources.legacyQualifying > 0 || governedSources.postgresQualifying > 0;
      return {
        uid: d.id,
        role,
        malformed: role === null,
        principalId,
        principalStatus: resolution.get(d.id)?.principalStatus ?? null,
        membershipStatus: resolution.get(d.id)?.membershipStatus ?? null,
        matchingCatalogRoleKey: role !== null && catalogKeys.has(role) ? role : null,
        matchingTenantRoleKey: role !== null && tenantRoleKeys.has(role) ? role : null,
        governedSources,
        effectiveAccessEvidence: {
          legacyRoleKeys: [...new Set(legacyAssignments.filter((r) => r.legacyQualification.qualifies).map((r) => r.roleKey))].sort(byText),
          postgresRoleKeys: [...new Set(postgresAssignments.filter((r) => r.postgresQualification.qualifies).map((r) => r.roleKey ?? `unknown-role:${r.roleId}`))].sort(byText),
        },
        requiresExplicitReconciliation: !hasGovernedSource,
        remediation: hasGovernedSource
          ? "None required from this value. The Principal's access is already governed by the assignments listed above; the legacy string is advisory only and migrates nothing."
          : "An administrator must decide this Principal's Security Role explicitly. No assignment is created from the legacy value, and the Principal is not dropped: they hold no qualifying governed assignment in either store today.",
      };
    })
    .sort((x, y) => byText(x.uid, y.uid));
  const legacyUsersRoleByValue = countBy(legacyUsersRoleRows, (r) => (r.role === null ? "(malformed)" : r.role), () => "active")
    .map((e) => ({ role: e.key, count: e.active }));

  // ── privileged role requests ──
  const requestStatus = new Map<string, number>();
  for (const d of requestDocs) {
    const s = typeof d.data.status === "string" ? d.data.status : "(missing)";
    requestStatus.set(s, (requestStatus.get(s) ?? 0) + 1);
  }
  const requestsByStatus = [...requestStatus.keys()].sort(byText).map((status) => ({ status, count: requestStatus.get(status) as number }));

  const blocked = legacyAssignmentRows.filter((r) => r.migrationBlockers.length > 0);
  const blockedFor = (reason: string) => blocked.filter((r) => r.migrationBlockers.some((b) => b.reason === reason));
  const blockedByCode = (code: string) => blocked.filter((r) => r.migrationBlockers.some((b) => b.code === code));

  const report = {
    format: ROLE_ASSIGNMENT_CENSUS_FORMAT,
    version: ROLE_ASSIGNMENT_CENSUS_VERSION,
    tenant: { key: tenant.key, id: tenantId },
    catalog: {
      roleKeys: catalog.roleKeys.length,
      conditionedRoleKeys: [...catalog.conditionedRoleKeys].sort(byText),
    },
    firestore: {
      assignments: {
        total: legacyRows.length,
        active: legacyRows.filter((r) => r.status === "active").length,
        disabled: legacyRows.filter((r) => r.status === "disabled").length,
        byRoleId: countBy(legacyRows, (r) => r.roleKey, (r) => r.status).map((e) => ({ roleId: e.key, active: e.active, disabled: e.disabled })),
        byScopeType: countBy(legacyRows, (r) => r.scopeType, (r) => r.status).map((e) => ({ scopeType: e.key, active: e.active, disabled: e.disabled })),
        qualifyingUnderLegacyRule: legacyAssignmentRows.filter((r) => r.legacyQualification.qualifies).length,
      },
      malformedAssignments: [...malformed].sort((x, y) => byText(x.documentId, y.documentId)),
      rows: legacyAssignmentRows,
    },
    postgres: {
      tenantRoleKeys: tenantRoleKeys.size,
      members: memberIds.length,
      assignments: {
        total: postgresAssignmentRows.length,
        active: postgresAssignmentRows.filter((r) => r.status === "active").length,
        disabled: postgresAssignmentRows.filter((r) => r.status !== "active").length,
        byRoleKey: countBy(postgresAssignmentRows, (r) => r.roleKey ?? `unknown-role:${r.roleId}`, (r) => r.status).map((e) => ({ roleKey: e.key, active: e.active, disabled: e.disabled })),
        byScopeType: countBy(postgresAssignmentRows, (r) => r.scopeType, (r) => r.status).map((e) => ({ scopeType: e.key, active: e.active, disabled: e.disabled })),
        qualifyingUnderPostgresRule: postgresAssignmentRows.filter((r) => r.postgresQualification.qualifies).length,
        evaluatorIgnoresScope: postgresAssignmentRows.filter((r) => r.evaluatorIgnoresScope).map((r) => r.assignmentId),
        unknownRoleId: postgresAssignmentsWithUnknownRole,
      },
      rows: postgresAssignmentRows,
    },
    identity: {
      identityProvider: FIREBASE_IDENTITY_PROVIDER,
      legacySubjects: assignmentSubjects.length,
      subjectsWithoutPrincipal,
      principalsWithoutActiveMembership,
    },
    roleKeys: {
      legacyRoleIdsMissingInTenant,
      legacyRoleIdsNotInCatalog,
      catalogRoleKeysMissingInTenant,
    },
    migrationBlockers: {
      count: blocked.length,
      migratable: legacyAssignmentRows.length - blocked.length,
      byCode: [
        { code: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, count: blockedByCode(MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY).length, clearedBy: "PostgreSQL gaining Condition and scope evaluation" },
        { code: ROLE_NOT_IN_GOVERNED_CATALOG, count: blockedByCode(ROLE_NOT_IN_GOVERNED_CATALOG).length, clearedBy: "an administrator completing the governed Role catalog, or correcting the assignment" },
      ],
      byReason: {
        scoped: blockedFor("SCOPED").length,
        conditionedRole: blockedFor("CONDITIONED_ROLE").length,
        unknownRoleId: blockedFor("UNKNOWN_ROLE_ID").length,
        notInTenantCatalog: blockedFor("NOT_IN_TENANT_CATALOG").length,
      },
      documentIds: blocked.map((r) => r.documentId),
    },
    diff: { matched, activeStatusMismatch, onlyInFirestore, onlyInPostgres },
    legacyUsersRole: {
      classification: LEGACY_USERS_ROLE,
      tenant: { key: tenant.key, id: tenantId },
      mergedIntoAssignments: false,
      note: "LEGACY ADVISORY EVIDENCE (Owner ruling 2026-09-18 §3). Reported, never merged, never dropped. A Security Role is never inferred from this value alone: a Principal with no governed current assignment source is flagged requiresExplicitReconciliation for an administrator to decide.",
      requiresExplicitReconciliation: legacyUsersRoleRows.filter((r) => r.requiresExplicitReconciliation).length,
      byValue: legacyUsersRoleByValue,
      rows: legacyUsersRoleRows,
    },
    privilegedRoleRequests: {
      total: requestDocs.length,
      pendingApproval: requestStatus.get(LEGACY_PRIVILEGED_PENDING_STATUS) ?? 0,
      byStatus: requestsByStatus,
    },
    summary: {
      legacyAssignments: legacyRows.length,
      legacyMalformedAssignments: malformed.length,
      subjectsWithoutPrincipal: subjectsWithoutPrincipal.length,
      principalsWithoutActiveMembership: principalsWithoutActiveMembership.length,
      legacyRoleIdsMissingInTenant: legacyRoleIdsMissingInTenant.length,
      migrationBlocked: blocked.length,
      migrationBlockedByEvaluatorParity: blockedByCode(MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY).length,
      migrationBlockedByCatalog: blockedByCode(ROLE_NOT_IN_GOVERNED_CATALOG).length,
      migratable: legacyAssignmentRows.length - blocked.length,
      matched: matched.length,
      activeStatusMismatch: activeStatusMismatch.length,
      onlyInFirestore: onlyInFirestore.length,
      onlyInPostgres: onlyInPostgres.length,
      postgresEvaluatorIgnoresScope: postgresAssignmentRows.filter((r) => r.evaluatorIgnoresScope).length,
      legacyUsersRole: legacyUsersRoleRows.length,
      legacyUsersRoleRequiringReconciliation: legacyUsersRoleRows.filter((r) => r.requiresExplicitReconciliation).length,
      privilegedRoleRequestsPendingApproval: requestStatus.get(LEGACY_PRIVILEGED_PENDING_STATUS) ?? 0,
    },
  };
  // Content-only digest: no clock, no path, no environment, so an unchanged pair of stores digests identically.
  const reportSha256 = createHash("sha256").update(canonicalJson(report)).digest("hex");
  return { ...report, reportSha256 };
}

export type RoleAssignmentCensus = Awaited<ReturnType<typeof buildRoleAssignmentCensus>>;

/** A short human summary for the operator's terminal. The evidence file carries everything. */
export function describeRoleAssignmentCensus(census: RoleAssignmentCensus): string {
  const s = census.summary;
  return [
    `tenant ${census.tenant.key} (${census.tenant.id}) census sha256 ${census.reportSha256}`,
    `  legacy assignments                     ${s.legacyAssignments} (malformed ${s.legacyMalformedAssignments})`,
    `  subjects with no Principal             ${s.subjectsWithoutPrincipal}`,
    `  Principals with no active membership   ${s.principalsWithoutActiveMembership}`,
    `  legacy roleIds with no tenant Role key ${s.legacyRoleIdsMissingInTenant}`,
    `  migration BLOCKED / migratable         ${s.migrationBlocked} / ${s.migratable}`,
    `    ${MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY} ${s.migrationBlockedByEvaluatorParity}`,
    `    ${ROLE_NOT_IN_GOVERNED_CATALOG}         ${s.migrationBlockedByCatalog}`,
    `  matched / status mismatch              ${s.matched} / ${s.activeStatusMismatch}`,
    `  only in Firestore / only in PostgreSQL ${s.onlyInFirestore} / ${s.onlyInPostgres}`,
    `  PostgreSQL scoped (evaluator ignores)  ${s.postgresEvaluatorIgnoresScope}`,
    `  ${LEGACY_USERS_ROLE} (separate)          ${s.legacyUsersRole} (needing reconciliation ${s.legacyUsersRoleRequiringReconciliation})`,
    `  privileged requests pending approval   ${s.privilegedRoleRequestsPendingApproval}`,
  ].join("\n");
}
