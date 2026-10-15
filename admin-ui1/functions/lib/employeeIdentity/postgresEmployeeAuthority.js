"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPostgresEmployeeAuthority = createPostgresEmployeeAuthority;
exports.resolveConfiguredEmployeeAuthority = resolveConfiguredEmployeeAuthority;
const employeeAuthority_js_1 = require("./employeeAuthority.js");
const SCHEMA = "eos_workforce";
const TABLE = `${SCHEMA}.employees`;
const SELECT_COLUMNS = "id, tenant_id, employment_status, operating_company_id";
/**
 * The Postgres Employee authority.
 *
 * @param db a Pool, or a client inside the caller's transaction. Never constructed here.
 */
function createPostgresEmployeeAuthority(db) {
    return {
        async resolveEmployeeReference(reference) {
            let rows;
            try {
                const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [reference.employeeId, reference.tenantId]);
                rows = result.rows;
            }
            catch (error) {
                // EVERY read failure, without exception and without inspecting the error's shape. A relation
                // that does not exist, a connection that dropped, a statement timeout and a permission denial
                // are all "EOS could not obtain an authoritative answer". Classifying them further here would
                // mean deciding, from a driver error, that some of them are really findings about the person —
                // and none of them is.
                return {
                    outcome: "AUTHORITY_UNAVAILABLE",
                    reference,
                    reason: "AUTHORITY_READ_FAILED",
                    // The message only. A `pg` error can carry the connection parameters it was using, and this
                    // string reaches audit records and logs -- the reason policyDatabase.ts redacts.
                    detail: error instanceof Error ? error.message : String(error),
                };
            }
            if (rows.length === 0) {
                // THE AUTHORITY ANSWERED. This is a finding about the reference, not about the authority, and
                // it is the ONLY branch in this file permitted to say so.
                return { outcome: "NOT_FOUND", reference };
            }
            const row = rows[0];
            if (!(0, employeeAuthority_js_1.isEmploymentStatus)(row.employment_status)) {
                return {
                    outcome: "AUTHORITY_UNAVAILABLE",
                    reference,
                    reason: "AUTHORITY_CONTRACT_VIOLATION",
                    detail: `${TABLE} row ${row.id} carries employment_status ${JSON.stringify(row.employment_status)}, ` +
                        "which is not one of the six governed values. Code and schema disagree; this is not a " +
                        "finding that the Employee is missing, and the status is not coerced to a governed value.",
                };
            }
            return {
                outcome: "RESOLVED",
                reference,
                employee: {
                    employeeId: row.id,
                    tenantId: row.tenant_id,
                    employmentStatus: row.employment_status,
                    operatingCompanyId: row.operating_company_id,
                },
            };
        },
    };
}
/**
 * The process's Employee authority — the PostgreSQL one when a connection is supplied, and the
 * UNAVAILABLE one when none is.
 *
 * ════════════════════ WHY THIS IS NOT A FALLBACK ════════════════════
 *
 * This is the composition seam, and it is the place a fallback would go if this architecture had one.
 * It does not. The two branches are "the authority" and "NO AUTHORITY", not "the authority" and "a
 * second authority" — #185's "One authoritative implementation at a time... No silent fallback from
 * PostgreSQL to Firestore after cutover", and #187 §2's "must not fall back silently to Firestore, to
 * `users`, to `fieldops_technicians`, or to Firebase UID coincidence."
 *
 * So an unconfigured process does not degrade to Firestore, does not return empty data that looks
 * healthy, and does not crash at startup. It returns AUTHORITY_UNAVAILABLE for every reference, and
 * `mustResolveEmployeeReference` turns that into a refusal. That is the fail-closed behaviour #187
 * requires, and — because no database is needed to observe it — it is also the part of this contract
 * that is provable anywhere.
 *
 * It takes the connection as an ARGUMENT rather than reading configuration. Deciding here whether a
 * database exists would make this a second module that reads `DATABASE_URL`, and
 * src/adminPolicy/policyDatabase.ts is deliberately the only one. The caller that owns the pool owns
 * the decision.
 *
 * @param db the caller's Pool or transaction client, or null/undefined when no authority is configured
 */
function resolveConfiguredEmployeeAuthority(db) {
    if (!db) {
        return (0, employeeAuthority_js_1.createUnavailableEmployeeAuthority)("no Employee authority is configured in this process: no PostgreSQL connection was supplied to " +
            "resolveConfiguredEmployeeAuthority. This is NOT a finding that any Employee is missing, and no " +
            "Firestore collection, `users` document, technician record or Firebase UID mapping is consulted " +
            "instead.");
    }
    return createPostgresEmployeeAuthority(db);
}
//# sourceMappingURL=postgresEmployeeAuthority.js.map