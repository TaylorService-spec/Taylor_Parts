// THE COMPANY AUTHORITY THE INVENTORY DOMAINS DECIDE ON -- ONE resolver, ONE named exception (ISO inventory; OWNER RULING 2026-10-19, OD-ISO-2).
//
// Every inventory read and command in the warehouse domains (cycle counts, transfers, relocation, put-away, Reorder receiving and its correction, the
// on-hand / movement / receipt / location / transfer / truck reads, the part balance) decides company authority HERE, so the rule lives in one place:
//
//   OWN                          the caller's own operating-company authority (#235 / #237, resolveCompanyAuthority): home company, OPERATIONAL company-scoped
//                                Role assignments and explicit company-access grants. Nothing else implies a company.
//   ADMINISTRATOR_ALL_COMPANIES  THE EXCEPTION. A PROTECTED ADMINISTRATOR (standing as the protected-administrator and administration-reach modules already decide it:
//                                the protected `admin` Role held globally, never with the Owner Role, no unusable Employee link) holds company authority over
//                                EVERY governed company of the tenant (an ACTIVE company with an ACTIVE key) -- the Owner's words: "admin should have all
//                                access". It supersedes #235 rule 4 (an Administrator never implies a company) for the inventory domains ONLY. It is not
//                                "any holder of an admin-ish capability": a scoped admin assignment, a disabled principal or a stale one has no standing.
//
// What this does NOT change: the CAPABILITY checks (the Administrator still needs the capability), the WAREHOUSE scope rules (the reads' administration
// reach and the receipt VOID's opt-in are exactly what they were before the isolation change; no command gains a scope bypass), and every other domain's
// use of resolveCompanyAuthority.
import type { PoolClient } from "pg";
import { resolveCompanyAuthority } from "./companyAuthority.js";
import { authorizedCompanyKeys, principalHasProtectedAdministratorStanding } from "./administrationReach.js";

type Db = Pick<PoolClient, "query">;

export type InventoryCompanyAuthorityReason = "OWN" | "ADMINISTRATOR_ALL_COMPANIES";

export interface InventoryCompanyAuthority {
  /** The operating-company KEYS the caller holds authority over for the inventory domains. Empty = none. */
  readonly companyKeys: readonly string[];
  readonly reason: InventoryCompanyAuthorityReason;
}

export async function resolveInventoryCompanyAuthority(db: Db, tenantId: string, principalId: string): Promise<InventoryCompanyAuthority> {
  if (await principalHasProtectedAdministratorStanding(db, tenantId, principalId)) {
    return Object.freeze({ companyKeys: await authorizedCompanyKeys(db, tenantId), reason: "ADMINISTRATOR_ALL_COMPANIES" as const });
  }
  return Object.freeze({ companyKeys: (await resolveCompanyAuthority(db, tenantId, principalId)).companyKeys, reason: "OWN" as const });
}
