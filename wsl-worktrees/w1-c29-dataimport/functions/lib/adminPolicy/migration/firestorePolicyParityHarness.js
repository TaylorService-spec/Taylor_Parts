"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPolicyParityReport = buildPolicyParityReport;
exports.describeParity = describeParity;
// ████████████████████████████ TEMPORARY ████████████████████████████
//
// THE MIGRATION PARITY HARNESS. It exists to be DELETED.
//
// ════════════════════ WHAT IT IS FOR ════════════════════
//
// Role assignments and access versions live in Firestore today (`roleAssignments/{id}` and
// `users/{uid}.accessVersion`). They are moving to PostgreSQL. Before the old path can be deleted,
// somebody has to be able to say -- with evidence rather than confidence -- that the new store
// holds the same authority the old one did.
//
// This reads both and reports the difference. That is its whole job.
//
// ════════════════════ WHAT IT MUST NEVER BECOME ════════════════════
//
//   NOT a dual read. Nothing in the running system calls this. It is a comparison tool run by a
//   person, and no resolver, command or surface imports it.
//
//   NOT a fallback. It never returns Firestore data AS policy. A resolver that fell back to
//   Firestore when Postgres was empty would make the migration permanently optional, and a
//   migration that is optional never finishes.
//
//   NOT a writer. It opens no write path in either store. It cannot create a Firestore document,
//   and it cannot repair a difference it finds -- reporting is the point, because a tool that
//   silently fixed drift would destroy the evidence that drift existed.
//
// ════════════════════ ITS DELETION CONDITION ════════════════════
//
// Delete this file, its test, and its entry in the no-Firebase guard's transitional allowlist when:
//
//   1. every tenant's assignments have been migrated and this harness reports IN_PARITY, and
//   2. the Firestore `roleAssignments` collection and `users/{uid}.accessVersion` are no longer
//      read by anything, and
//   3. the cutover is done.
//
// Until then it is the ONLY module in this subsystem permitted to touch Firestore, and the guard
// names it explicitly so that permission cannot spread.
const firestore_1 = require("firebase-admin/firestore");
const principalContext_1 = require("../principalContext");
/** A stable identity for one assignment, so two stores' rows can be set-compared. */
const key = (a) => `${a.principalId}|${a.roleKey}|${a.scopeType}|${a.scopeValue ?? ""}|${a.status}`;
/**
 * Compare the two stores for one tenant.
 *
 * READ ONLY, both sides. There is no write path in this function, and the deliberate absence of one
 * is what keeps "prove the migration" from turning into "perform the migration from a report".
 */
async function buildPolicyParityReport(reader, tenantId, deps = {}) {
    const db = deps.db ?? (0, firestore_1.getFirestore)();
    // ── the OLD store, read only ──
    const legacySnapshot = await db.collection("roleAssignments").get();
    const legacy = [];
    const principals = new Set();
    for (const doc of legacySnapshot.docs) {
        const data = doc.data();
        // TWO VOCABULARIES MEET HERE, and they are not the same thing.
        //
        // The legacy Firestore document's field is `principalUid` and holds a FIREBASE UID. The EOS
        // model's identity is `principals.id`, and `(identity_provider, external_subject)` maps one to
        // the other. Reading this key as though it were an EOS principal id would compare an empty
        // legacy set against the new model and report parity -- which is the exact failure this harness
        // exists to catch.
        const legacySubject = typeof data.principalUid === "string" ? data.principalUid : null;
        const roleId = typeof data.roleId === "string" ? data.roleId : null;
        // A malformed legacy row is REPORTED BY ABSENCE rather than guessed at. Inventing a shape for
        // it would manufacture parity that does not exist.
        if (!legacySubject || !roleId)
            continue;
        const scope = (data.scope ?? {});
        legacy.push({
            principalId: legacySubject,
            // The legacy `roleId` IS the role key -- compatibility Roles are named `admin`, `dispatcher`,
            // `technician`, and the governed ones by their own keys. The new store's key is the same
            // string, which is what makes the two comparable at all.
            roleKey: roleId,
            scopeType: typeof scope.type === "string" ? scope.type : "global",
            scopeValue: typeof scope.value === "string" ? scope.value : null,
            status: data.status === "disabled" ? "disabled" : "active",
        });
        principals.add(legacySubject);
    }
    // ── the NEW store, read only ──
    const roles = await reader.listRoles(tenantId);
    const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
    const results = [];
    let matched = 0;
    let onlyLegacy = 0;
    let onlyNew = 0;
    let versionMismatches = 0;
    for (const subject of [...principals].sort()) {
        // RESOLVED, not assumed. Before migration 002 a Firebase UID and the policy model's principal
        // identifier were the same string, and this harness compared them directly. They are now
        // different values, so the subject is mapped through the identity model first; a subject EOS
        // has never seen has no principal, and its legacy assignments are reported as unmatched rather
        // than quietly compared against nothing.
        const principal = await reader.getPrincipalBySubject(principalContext_1.FIREBASE_IDENTITY_PROVIDER, subject);
        const principalId = principal?.id ?? subject;
        const mine = legacy.filter((a) => a.principalId === subject);
        const theirs = (await reader.listAssignmentsForPrincipal(tenantId, principalId)).map((a) => ({
            principalId: subject,
            roleKey: roleKeyById.get(a.roleId) ?? `(unknown role ${a.roleId})`,
            scopeType: a.scopeType,
            scopeValue: a.scopeValue,
            status: a.status,
        }));
        const mineKeys = new Map(mine.map((a) => [key(a), a]));
        const theirKeys = new Map(theirs.map((a) => [key(a), a]));
        const inBoth = [...mineKeys.values()].filter((a) => theirKeys.has(key(a)));
        const onlyInFirestore = [...mineKeys.values()].filter((a) => !theirKeys.has(key(a)));
        const onlyInPostgres = [...theirKeys.values()].filter((a) => !mineKeys.has(key(a)));
        const userDoc = await db.collection("users").doc(subject).get();
        const userData = userDoc.exists ? userDoc.data() : undefined;
        const firestoreAccessVersion = typeof userData?.accessVersion === "number" ? userData.accessVersion : null;
        const versionRow = await reader.getAccessVersion(tenantId, principalId);
        const postgresAccessVersion = versionRow ? versionRow.accessVersion : null;
        if (onlyInFirestore.length === 0 && onlyInPostgres.length === 0)
            matched += 1;
        onlyLegacy += onlyInFirestore.length;
        onlyNew += onlyInPostgres.length;
        if (firestoreAccessVersion !== postgresAccessVersion)
            versionMismatches += 1;
        results.push({
            principalId, inBoth, onlyInFirestore, onlyInPostgres,
            firestoreAccessVersion, postgresAccessVersion,
        });
    }
    return {
        tenantId,
        generatedAt: new Date().toISOString(),
        principals: results,
        summary: {
            principalsCompared: results.length,
            matched,
            onlyInFirestore: onlyLegacy,
            onlyInPostgres: onlyNew,
            accessVersionMismatches: versionMismatches,
        },
        // EVERY axis. A report that called itself in-parity while access versions disagreed would be
        // signing off a cutover that silently re-validates stale grants.
        inParity: onlyLegacy === 0 && onlyNew === 0 && versionMismatches === 0,
    };
}
/** A short human summary, for an operator running this by hand. */
function describeParity(report) {
    const s = report.summary;
    return [
        `tenant ${report.tenantId} @ ${report.generatedAt}`,
        `  principals compared     ${s.principalsCompared}`,
        `  fully matched           ${s.matched}`,
        `  only in Firestore       ${s.onlyInFirestore}`,
        `  only in PostgreSQL      ${s.onlyInPostgres}`,
        `  access version mismatch ${s.accessVersionMismatches}`,
        `  => ${report.inParity ? "IN PARITY -- the old path may be cut over and deleted" : "NOT IN PARITY -- do not cut over"}`,
    ].join("\n");
}
//# sourceMappingURL=firestorePolicyParityHarness.js.map