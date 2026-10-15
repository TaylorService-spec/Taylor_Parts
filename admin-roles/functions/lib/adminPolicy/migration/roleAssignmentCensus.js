"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleAssignmentCensusError = exports.LEGACY_PRIVILEGED_PENDING_STATUS = exports.LEGACY_USERS_ROLE = exports.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY = exports.ROLE_ASSIGNMENT_CENSUS_VERSION = exports.ROLE_ASSIGNMENT_CENSUS_FORMAT = void 0;
exports.declaredRoleCatalogFacts = declaredRoleCatalogFacts;
exports.canonicalJson = canonicalJson;
exports.buildRoleAssignmentCensus = buildRoleAssignmentCensus;
exports.describeRoleAssignmentCensus = describeRoleAssignmentCensus;
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
//     and never merged into assignments: whether those values migrate at all is an open Owner question.
//   NOT a migration plan. Scoped and conditioned-role assignments are flagged
//     MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY because the PostgreSQL evaluator (effectiveObjectAccess.ts
//     loadPrincipalPolicy) ignores scope and has no Conditions today; copying such a grant would WIDEN it.
//
// ════════════════════ DELETION CONDITION ════════════════════
//
// Delete this file, its CLI and their tests once the legacy `roleAssignments` collection is retired.
const node_crypto_1 = require("node:crypto");
const compatibilityRoles_1 = require("../../access/compatibilityRoles");
const governedBusinessRoles_1 = require("../../access/governedBusinessRoles");
const principalContext_1 = require("../principalContext");
exports.ROLE_ASSIGNMENT_CENSUS_FORMAT = "EOS_ROLE_ASSIGNMENT_CENSUS";
exports.ROLE_ASSIGNMENT_CENSUS_VERSION = 1;
exports.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY = "MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY";
exports.LEGACY_USERS_ROLE = "LEGACY_USERS_ROLE";
/** The legacy privileged-request status that still awaits a decision (trustedWriterCommands.ts PRIVILEGED_REQUEST_STATUS). */
exports.LEGACY_PRIVILEGED_PENDING_STATUS = "PENDING_APPROVAL";
class RoleAssignmentCensusError extends Error {
}
exports.RoleAssignmentCensusError = RoleAssignmentCensusError;
/** The repository-declared Role catalog, reduced to what the census uses. */
function declaredRoleCatalogFacts() {
    const all = { ...compatibilityRoles_1.COMPATIBILITY_ROLES, ...governedBusinessRoles_1.GOVERNED_BUSINESS_ROLES };
    const roleKeys = Object.keys(all).sort();
    const conditionedRoleKeys = roleKeys.filter((key) => {
        const conditions = all[key].conditionsByPermission;
        return Boolean(conditions) && Object.values(conditions).some((list) => Array.isArray(list) && list.length > 0);
    });
    return { roleKeys, conditionedRoleKeys };
}
// ════════════════════ legacy row parsing ════════════════════
/** Scope types the legacy resolver accepts (resolveEffectivePermission.ts isValidScope). */
const LEGACY_SCOPE_TYPES = Object.freeze(["global", "tenant", "domain", "location", "ownAssignment", "operatingCompany", "businessUnit"]);
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/**
 * The legacy resolver's well-formedness test, reproduced (resolveEffectivePermission.ts isWellFormedAssignment).
 * A malformed row contributes no grant there, so it is reported and never offered for migration.
 */
function parseLegacyAssignment(doc) {
    const d = doc.data;
    if (typeof d.principalUid !== "string" || d.principalUid.length === 0)
        return { documentId: doc.id, reason: "PRINCIPAL_UID_MISSING" };
    if (typeof d.roleId !== "string" || d.roleId.length === 0)
        return { documentId: doc.id, reason: "ROLE_ID_MISSING" };
    if (!isPlainObject(d.scope) || typeof d.scope.type !== "string" || !LEGACY_SCOPE_TYPES.includes(d.scope.type)) {
        return { documentId: doc.id, reason: "SCOPE_INVALID" };
    }
    if (d.status !== "active" && d.status !== "disabled")
        return { documentId: doc.id, reason: "STATUS_INVALID" };
    if (typeof d.accessVersionAtGrant !== "number")
        return { documentId: doc.id, reason: "ACCESS_VERSION_AT_GRANT_MISSING" };
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
function legacyCurrentAccessVersion(profile) {
    if (!profile)
        return 0;
    const v = profile.data.accessVersion;
    if (v === undefined || v === null)
        return 0;
    return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : "MALFORMED";
}
function legacyQualification(a, current) {
    if (a.status !== "active")
        return { qualifies: false, reason: "NOT_ACTIVE" };
    if (current === "MALFORMED")
        return { qualifies: false, reason: "CURRENT_ACCESS_VERSION_MALFORMED" };
    if (a.accessVersionAtGrant > current)
        return { qualifies: false, reason: "GRANTED_AFTER_CURRENT_ACCESS_VERSION" };
    return { qualifies: true, reason: "QUALIFIES" };
}
/** effectiveObjectAccess.ts loadPrincipalPolicy's rule: active, and granted at or before the current version (absent = 0). */
function postgresQualification(status, accessVersionAtGrant, current) {
    if (status !== "active")
        return { qualifies: false, reason: "NOT_ACTIVE" };
    if (typeof accessVersionAtGrant !== "number")
        return { qualifies: false, reason: "ACCESS_VERSION_AT_GRANT_MISSING" };
    if (accessVersionAtGrant > current)
        return { qualifies: false, reason: "GRANTED_AFTER_CURRENT_ACCESS_VERSION" };
    return { qualifies: true, reason: "QUALIFIES" };
}
// ════════════════════ deterministic output ════════════════════
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Canonical JSON: object keys sorted at every depth, so the digest depends on content alone. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function countBy(rows, keyOf, statusOf) {
    const counts = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        const entry = counts.get(key) ?? { active: 0, disabled: 0 };
        if (statusOf(row) === "active")
            entry.active += 1;
        else
            entry.disabled += 1;
        counts.set(key, entry);
    }
    return [...counts.keys()].sort(byText).map((key) => ({ key, ...counts.get(key) }));
}
/** The comparison identity of a grant in either store: principal + Role key + scope. Status is compared, not keyed. */
const grantKey = (principalRef, roleKey, scopeType, scopeValue) => `${principalRef}|${roleKey}|${scopeType}|${scopeValue ?? ""}`;
/**
 * Census ONE tenant's Security Role assignments across both stores.
 *
 * READ ONLY. The tenant is resolved by key and never created. The legacy store is single-tenant per Firebase
 * project; the operator names the PostgreSQL tenant that project's assignments would converge into.
 */
async function buildRoleAssignmentCensus(input) {
    const tenantKey = input.tenantKey;
    if (typeof tenantKey !== "string" || tenantKey.length === 0)
        throw new RoleAssignmentCensusError("a tenant key is required");
    const tenant = await input.policy.getTenantByKey(tenantKey);
    if (!tenant)
        throw new RoleAssignmentCensusError(`no tenant with key ${tenantKey}; the census never creates one`);
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
    const legacyRows = [];
    const malformed = [];
    for (const doc of assignmentDocs) {
        const parsed = parseLegacyAssignment(doc);
        if ("subject" in parsed)
            legacyRows.push(parsed);
        else
            malformed.push(parsed);
    }
    // ── identity: legacy subject -> Principal, by (provider, subject) and never by raw uid ──
    const legacyProfileRoleUids = profileDocs.filter((d) => d.data.role !== undefined && d.data.role !== null).map((d) => d.id);
    const subjects = [...new Set([...legacyRows.map((r) => r.subject), ...legacyProfileRoleUids])].sort(byText);
    const resolution = new Map();
    for (const subject of subjects) {
        const principal = await input.policy.getPrincipalBySubject(principalContext_1.FIREBASE_IDENTITY_PROVIDER, subject);
        if (!principal) {
            resolution.set(subject, null);
            continue;
        }
        const membership = await input.policy.getMembership(tenantId, principal.id);
        resolution.set(subject, { principalId: principal.id, principalStatus: principal.status, membershipStatus: membership?.status ?? null });
    }
    const legacyAssignmentRows = legacyRows
        .map((a) => {
        const resolved = resolution.get(a.subject) ?? null;
        const refusalReasons = [];
        if (a.scopeType !== "global")
            refusalReasons.push("SCOPED");
        if (conditioned.has(a.roleKey))
            refusalReasons.push("CONDITIONED_ROLE");
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
            migrationRefusal: refusalReasons.length > 0 ? { code: exports.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, reasons: refusalReasons } : null,
        };
    })
        .sort((x, y) => byText(x.documentId, y.documentId));
    // ── PostgreSQL assignments, every member of the tenant ──
    const memberIds = [...new Set(await input.policy.listTenantPrincipalIds(tenantId))].sort(byText);
    const postgresAssignmentRows = [];
    const principalsById = new Map();
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
        principalId: x.resolved.principalId,
        principalStatus: x.resolved.principalStatus,
        membershipStatus: x.resolved.membershipStatus,
    }));
    // ── role key findings ──
    const legacyRoleKeys = [...new Set(legacyRows.map((r) => r.roleKey))].sort(byText);
    const legacyRoleIdsMissingInTenant = legacyRoleKeys.filter((k) => !tenantRoleKeys.has(k));
    const legacyRoleIdsNotInCatalog = legacyRoleKeys.filter((k) => !catalogKeys.has(k));
    const catalogRoleKeysMissingInTenant = [...catalogKeys].filter((k) => !tenantRoleKeys.has(k)).sort(byText);
    const postgresAssignmentsWithUnknownRole = postgresAssignmentRows.filter((r) => r.roleKey === null).map((r) => r.assignmentId);
    const legacySide = new Map();
    for (const r of legacyAssignmentRows) {
        const ref = r.principalId ?? `unresolved:${principalContext_1.FIREBASE_IDENTITY_PROVIDER}:${r.subject}`;
        const key = grantKey(ref, r.roleKey, r.scopeType, r.scopeValue);
        const entry = legacySide.get(key) ?? { active: false, ids: [], subject: r.subject, principalId: r.principalId, roleKey: r.roleKey, scopeType: r.scopeType, scopeValue: r.scopeValue };
        entry.active = entry.active || r.status === "active";
        entry.ids.push(r.documentId);
        legacySide.set(key, entry);
    }
    const postgresSide = new Map();
    for (const r of postgresAssignmentRows) {
        const key = grantKey(r.principalId, r.roleKey ?? `unknown-role:${r.roleId}`, r.scopeType, r.scopeValue);
        const entry = postgresSide.get(key) ?? { active: false, ids: [], subject: r.subject, principalId: r.principalId, roleKey: r.roleKey ?? `unknown-role:${r.roleId}`, scopeType: r.scopeType, scopeValue: r.scopeValue };
        entry.active = entry.active || r.status === "active";
        entry.ids.push(r.assignmentId);
        postgresSide.set(key, entry);
    }
    const describe = (key, side) => ({
        grantKey: key, subject: side.subject, principalId: side.principalId, roleKey: side.roleKey, scopeType: side.scopeType, scopeValue: side.scopeValue,
        active: side.active, ids: [...side.ids].sort(byText),
    });
    const matched = [];
    const activeStatusMismatch = [];
    const onlyInFirestore = [];
    const onlyInPostgres = [];
    for (const key of [...legacySide.keys()].sort(byText)) {
        const l = legacySide.get(key);
        const p = postgresSide.get(key);
        if (!p) {
            onlyInFirestore.push(describe(key, l));
            continue;
        }
        if (l.active === p.active)
            matched.push({ grantKey: key, active: l.active });
        else
            activeStatusMismatch.push({ grantKey: key, firestoreActive: l.active, postgresActive: p.active, firestoreIds: [...l.ids].sort(byText), postgresIds: [...p.ids].sort(byText) });
    }
    for (const key of [...postgresSide.keys()].sort(byText)) {
        if (!legacySide.has(key))
            onlyInPostgres.push(describe(key, postgresSide.get(key)));
    }
    // ── LEGACY_USERS_ROLE: reported SEPARATELY, never merged into assignments ──
    const legacyUsersRoleRows = profileDocs
        .filter((d) => d.data.role !== undefined && d.data.role !== null)
        .map((d) => ({
        uid: d.id,
        role: typeof d.data.role === "string" ? d.data.role : null,
        malformed: typeof d.data.role !== "string",
        principalId: resolution.get(d.id)?.principalId ?? null,
    }))
        .sort((x, y) => byText(x.uid, y.uid));
    const legacyUsersRoleByValue = countBy(legacyUsersRoleRows, (r) => (r.role === null ? "(malformed)" : r.role), () => "active")
        .map((e) => ({ role: e.key, count: e.active }));
    // ── privileged role requests ──
    const requestStatus = new Map();
    for (const d of requestDocs) {
        const s = typeof d.data.status === "string" ? d.data.status : "(missing)";
        requestStatus.set(s, (requestStatus.get(s) ?? 0) + 1);
    }
    const requestsByStatus = [...requestStatus.keys()].sort(byText).map((status) => ({ status, count: requestStatus.get(status) }));
    const refusals = legacyAssignmentRows.filter((r) => r.migrationRefusal !== null);
    const report = {
        format: exports.ROLE_ASSIGNMENT_CENSUS_FORMAT,
        version: exports.ROLE_ASSIGNMENT_CENSUS_VERSION,
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
            identityProvider: principalContext_1.FIREBASE_IDENTITY_PROVIDER,
            legacySubjects: assignmentSubjects.length,
            subjectsWithoutPrincipal,
            principalsWithoutActiveMembership,
        },
        roleKeys: {
            legacyRoleIdsMissingInTenant,
            legacyRoleIdsNotInCatalog,
            catalogRoleKeysMissingInTenant,
        },
        migrationRefusals: {
            code: exports.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY,
            count: refusals.length,
            scoped: refusals.filter((r) => r.migrationRefusal.reasons.includes("SCOPED")).length,
            conditionedRole: refusals.filter((r) => r.migrationRefusal.reasons.includes("CONDITIONED_ROLE")).length,
            documentIds: refusals.map((r) => r.documentId),
        },
        diff: { matched, activeStatusMismatch, onlyInFirestore, onlyInPostgres },
        legacyUsersRole: {
            classification: exports.LEGACY_USERS_ROLE,
            mergedIntoAssignments: false,
            note: "The legacy user-profile role string is reported separately. Whether these values migrate is an open Owner question; no Security Role is inferred from them.",
            byValue: legacyUsersRoleByValue,
            rows: legacyUsersRoleRows,
        },
        privilegedRoleRequests: {
            total: requestDocs.length,
            pendingApproval: requestStatus.get(exports.LEGACY_PRIVILEGED_PENDING_STATUS) ?? 0,
            byStatus: requestsByStatus,
        },
        summary: {
            legacyAssignments: legacyRows.length,
            legacyMalformedAssignments: malformed.length,
            subjectsWithoutPrincipal: subjectsWithoutPrincipal.length,
            principalsWithoutActiveMembership: principalsWithoutActiveMembership.length,
            legacyRoleIdsMissingInTenant: legacyRoleIdsMissingInTenant.length,
            migrationRefused: refusals.length,
            matched: matched.length,
            activeStatusMismatch: activeStatusMismatch.length,
            onlyInFirestore: onlyInFirestore.length,
            onlyInPostgres: onlyInPostgres.length,
            postgresEvaluatorIgnoresScope: postgresAssignmentRows.filter((r) => r.evaluatorIgnoresScope).length,
            legacyUsersRole: legacyUsersRoleRows.length,
            privilegedRoleRequestsPendingApproval: requestStatus.get(exports.LEGACY_PRIVILEGED_PENDING_STATUS) ?? 0,
        },
    };
    // Content-only digest: no clock, no path, no environment, so an unchanged pair of stores digests identically.
    const reportSha256 = (0, node_crypto_1.createHash)("sha256").update(canonicalJson(report)).digest("hex");
    return { ...report, reportSha256 };
}
/** A short human summary for the operator's terminal. The evidence file carries everything. */
function describeRoleAssignmentCensus(census) {
    const s = census.summary;
    return [
        `tenant ${census.tenant.key} (${census.tenant.id}) census sha256 ${census.reportSha256}`,
        `  legacy assignments                     ${s.legacyAssignments} (malformed ${s.legacyMalformedAssignments})`,
        `  subjects with no Principal             ${s.subjectsWithoutPrincipal}`,
        `  Principals with no active membership   ${s.principalsWithoutActiveMembership}`,
        `  legacy roleIds with no tenant Role key ${s.legacyRoleIdsMissingInTenant}`,
        `  ${exports.MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY} ${s.migrationRefused}`,
        `  matched / status mismatch              ${s.matched} / ${s.activeStatusMismatch}`,
        `  only in Firestore / only in PostgreSQL ${s.onlyInFirestore} / ${s.onlyInPostgres}`,
        `  PostgreSQL scoped (evaluator ignores)  ${s.postgresEvaluatorIgnoresScope}`,
        `  ${exports.LEGACY_USERS_ROLE} (separate)          ${s.legacyUsersRole}`,
        `  privileged requests pending approval   ${s.privilegedRoleRequestsPendingApproval}`,
    ].join("\n");
}
//# sourceMappingURL=roleAssignmentCensus.js.map