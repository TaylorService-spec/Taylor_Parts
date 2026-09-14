// Creation-time Accountable Person, shared by every governed Commercial create -- wave C2.
//
// #181 creation rule under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1: an EXPLICIT valid eligible person, otherwise
// DERIVED from the record's governed owner, otherwise REFUSE. An invalid or ineligible explicit person refuses and
// never falls back. The value reaches the record ONLY through the #1905 PostgreSQL writer, which accepts nothing
// but a minted establishment and appends the ESTABLISHMENT history row in the caller's transaction.
import type { PoolClient } from "pg";
import { createPostgresEmployeeAuthority } from "../../employeeIdentity/postgresEmployeeAuthority";
import { establishCreationAccountablePerson } from "../../responsibility/accountablePersonEstablishment";
import type { EstablishedAccountablePerson } from "../../responsibility/accountablePersonStorage";
import { stageCommercialAccountablePersonChange } from "../commercialAccountabilityRepository";
import { COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1, fail, type CommercialFamily } from "./commercialCommandKernel";

type Queryable = Pick<PoolClient, "query">;

/**
 * ABSENT means the caller supplied no explicit person: `undefined` or `null`. Anything else that was supplied is an
 * EXPLICIT request -- and a supplied value that is not a non-empty string (a number, an object, a boolean, an array, a
 * blank string) is a MALFORMED explicit person. It refuses exactly as an unresolvable one does; it is never read as
 * "no explicit person", so it can never fall through to derivation from the owner.
 */
function explicitAccountableEmployeeIdOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    fail("EXPLICIT_PERSON_INVALID", "INVALID_INPUT", "the explicit accountable person is not an Employee id; no derivation from the owner is attempted");
  }
  return value as string;
}

/** Resolve (never persist) the creation Accountable Person. Call BEFORE any row is written, so a refusal writes nothing. */
export async function resolveCreationAccountablePerson(
  db: Queryable,
  tenantId: string,
  family: CommercialFamily,
  explicitAccountableEmployeeId: unknown,
  ownerEmployeeId: string,
): Promise<EstablishedAccountablePerson> {
  const explicit = explicitAccountableEmployeeIdOf(explicitAccountableEmployeeId);
  return establishCreationAccountablePerson(
    { employeeAuthority: createPostgresEmployeeAuthority(db) },
    {
      tenantId,
      family,
      explicitAccountableEmployeeId: explicit,
      currentRecordOwnerEmployeeId: ownerEmployeeId,
      eligibilityPolicy: COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1,
    },
  );
}

/** Persist the minted person and its ESTABLISHMENT history on the just-created record, in the same transaction. */
export async function stageCreationAccountablePerson(
  db: Queryable,
  tenantId: string,
  actorId: string,
  family: CommercialFamily,
  recordId: string,
  established: EstablishedAccountablePerson,
): Promise<{ accountableEmployeeId: string; accountablePersonSource: string }> {
  const history = await stageCommercialAccountablePersonChange(db, tenantId, actorId, "ESTABLISHMENT", {
    family,
    recordId,
    accountablePerson: established,
  });
  return { accountableEmployeeId: history.newAccountableEmployeeId, accountablePersonSource: history.source };
}
