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
import { COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1, type CommercialFamily } from "./commercialCommandKernel";

type Queryable = Pick<PoolClient, "query">;

/** Resolve (never persist) the creation Accountable Person. Call BEFORE any row is written, so a refusal writes nothing. */
export function resolveCreationAccountablePerson(
  db: Queryable,
  tenantId: string,
  family: CommercialFamily,
  explicitAccountableEmployeeId: unknown,
  ownerEmployeeId: string,
): Promise<EstablishedAccountablePerson> {
  return establishCreationAccountablePerson(
    { employeeAuthority: createPostgresEmployeeAuthority(db) },
    {
      tenantId,
      family,
      explicitAccountableEmployeeId: typeof explicitAccountableEmployeeId === "string" ? explicitAccountableEmployeeId : null,
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
