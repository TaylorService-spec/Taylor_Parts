// EMPLOYEE AUTHORITY — the POSTGRES adapter. The ONE authoritative implementation.
//
// ════════════════════ WHAT THIS IS ════════════════════
//
// The other half of employeeAuthority.ts: the contract is there, and this is the single implementation
// of it that reads the canonical relation migration 019 created
// (functions/migrations/1759104000000_employee-business-authority.sql). #185 (`MI-ι`) made that relation
// the canonical Employee authority, and this module is the only thing in EOS that reads it as such.
//
// It follows the house repository idiom exactly — the one
// src/eosCommercial/commercialOwnershipRepository.ts:3-6 states and
// src/employeeIdentity/employeePrincipalLinkRepository.ts:34-46 already holds beside this file: it takes
// a `pg` Pool (or a client already inside the caller's transaction) and NOTHING ELSE. No Firebase, no
// Firestore, no environment, no credentials, no `new Pool`. The connection is the caller's; the rules
// are this module's. Reading `process.env.DATABASE_URL` here would make this a second place that decides
// what database EOS talks to, and src/adminPolicy/policyDatabase.ts is deliberately the only one.
//
// ════════════════════ ONE AUTHORITATIVE IMPLEMENTATION. NO FALLBACK. ════════════════════
//
// #185: "One authoritative implementation at a time. No long-lived dual authority. No silent fallback
// from PostgreSQL to Firestore after cutover."
//
// There is no Firestore adapter in this wave and this file has no path to one. It imports no Firebase
// module, so it could not consult `employees`, `users`, `fieldops_technicians` or a Firebase UID mapping
// even if a future edit wanted to — the import is not there to call.
// functions/test/employeeAuthorityPort.test.mjs proves the absence statically over both files, and
// separately proves at RUNTIME that a failing authority consults no substitute reader.
//
// ════════════════════ EVERY FAILURE IS AUTHORITY_UNAVAILABLE, NEVER NOT_FOUND ════════════════════
//
// This is the whole reason the adapter is larger than its one query. #187 §2:
//
//     INVALID / MISSING    the authoritative Employee system SUCCESSFULLY ANSWERED and the reference
//                          does not validly resolve
//     AUTHORITY_UNAVAILABLE  EOS could not obtain an authoritative answer
//
// A `pg` failure is the second, ALWAYS. Zero rows is the first, ALWAYS. The two are one `try` apart here
// and they must never merge, because the naive adapter — `catch { return NOT_FOUND }` — reports a
// database outage as "that person does not exist", which is exactly the misreading the ruling forbids
// and the one that would let a governed command proceed past an absent answer.
//
// The dangerous direction is worth naming: an outage reported as NOT_FOUND is FAIL-OPEN for any caller
// whose rule is "refuse if the Employee is missing, otherwise carry on" — it looks like a decision. An
// outage reported as AUTHORITY_UNAVAILABLE is FAIL-CLOSED, because `mustResolveEmployeeReference`
// throws on it.
//
// A THIRD failure is also AUTHORITY_UNAVAILABLE and is easy to miss: the row is present but its
// `employment_status` is not one of the governed six. Migration 019 makes that unreachable through the
// enum, but this adapter does not get to assume the database it was pointed at is the one the migration
// built. Code and schema disagreeing is not a verdict about the person, so it is
// AUTHORITY_CONTRACT_VIOLATION — not a silent coercion to ACTIVE, and not NOT_FOUND.
//
// ════════════════════ WHY THE QUERY IS TENANT-SCOPED ════════════════════
//
// `WHERE id = $1 AND tenant_id = $2`, leading with the key and constraining the tenant, and the
// resolution is NOT_FOUND when the Employee exists under a different tenant. Migration 003's Ruling B
// shape, which migration 008 reuses (`:133-135`) and migration 019 provisioned the UNIQUE for: proving
// the Employee EXISTS is not the same as proving this tenant may reference them, and the difference is a
// cross-tenant identity leak rather than a dangling row.
//
// The row's own `tenant_id` is returned in the facts rather than the caller's, so the facts describe
// what the authority holds instead of echoing the question back.
import type { Pool, PoolClient } from "pg";
import {
  createUnavailableEmployeeAuthority,
  isEmploymentStatus,
  type EmployeeAuthority,
  type EmployeeReference,
  type EmployeeReferenceResolution,
  type EmploymentStatus,
} from "./employeeAuthority.js";

const SCHEMA = "eos_workforce";
const TABLE = `${SCHEMA}.employees`;

/** A `pg` Pool or a PoolClient already inside the caller's transaction — the same type
 *  employeePrincipalLinkRepository.ts accepts, and for the same reason: a larger governed command must
 *  be able to resolve a person in the SAME transaction that does everything else, rather than reading
 *  the authority outside the transaction whose decision depends on it. */
export type EmployeeAuthorityQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

interface EmployeeRow {
  id: string;
  tenant_id: string;
  employment_status: string;
  operating_company_id: string;
}

const SELECT_COLUMNS = "id, tenant_id, employment_status, operating_company_id";

/**
 * The Postgres Employee authority.
 *
 * @param db a Pool, or a client inside the caller's transaction. Never constructed here.
 */
export function createPostgresEmployeeAuthority(db: EmployeeAuthorityQueryable): EmployeeAuthority {
  return {
    async resolveEmployeeReference(reference: EmployeeReference): Promise<EmployeeReferenceResolution> {
      let rows: readonly EmployeeRow[];
      try {
        const result = await db.query<EmployeeRow>(
          `SELECT ${SELECT_COLUMNS} FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`,
          [reference.employeeId, reference.tenantId],
        );
        rows = result.rows;
      } catch (error) {
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
      if (!isEmploymentStatus(row.employment_status)) {
        return {
          outcome: "AUTHORITY_UNAVAILABLE",
          reference,
          reason: "AUTHORITY_CONTRACT_VIOLATION",
          detail:
            `${TABLE} row ${row.id} carries employment_status ${JSON.stringify(row.employment_status)}, ` +
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
          employmentStatus: row.employment_status satisfies EmploymentStatus,
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
export function resolveConfiguredEmployeeAuthority(
  db: EmployeeAuthorityQueryable | null | undefined,
): EmployeeAuthority {
  if (!db) {
    return createUnavailableEmployeeAuthority(
      "no Employee authority is configured in this process: no PostgreSQL connection was supplied to " +
        "resolveConfiguredEmployeeAuthority. This is NOT a finding that any Employee is missing, and no " +
        "Firestore collection, `users` document, technician record or Firebase UID mapping is consulted " +
        "instead.",
    );
  }
  return createPostgresEmployeeAuthority(db);
}
