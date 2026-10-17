// WHAT AN operatingCompany-SCOPED ASSIGNMENT OF A ROLE CONTRIBUTES TO GENERAL COMPANY AUTHORITY -- a governed per-Role
// classification (Owner ruling "FINANCE COMPANY ACCESS AND ATTRIBUTION", item 1, 2026-10-17; DECISIONS #248).
//
//   OPERATIONAL   (the default; every Role that exists today) an ACTIVE operatingCompany-scoped assignment of this Role to
//                 company C names C in the holder's general operational company authority (eosOps/companyAuthority.ts,
//                 #235 rule 3). Mixed Roles -- operational AND Finance capabilities -- are OPERATIONAL.
//   FINANCE_ONLY  the same assignment supplies FINANCE REACH ONLY (eosFinance/financeCompanyAccess.ts and financialPolicy.ts
//                 decide it from the Role's capabilities, untouched) and contributes NOTHING to general company authority.
//
// This is DATA on the Role, written only through Administration (updateRole, admin.securityPolicy.write, one audit event),
// never inferred from a Role's name or key. The one thing derived is a GUARD at the write: a Role may be classified
// FINANCE_ONLY only while it holds at least one capability and every capability it holds is a `finance.*` key, and a
// non-finance capability may not be granted to a FINANCE_ONLY Role (grantObjectActionToRole) -- reclassify it first. The
// runtime does not re-derive: a classification that drifted anyway (a direct SQL grant) FAILS CLOSED, narrower.
export const ROLE_COMPANY_AUTHORITY_EFFECTS = Object.freeze(["OPERATIONAL", "FINANCE_ONLY"] as const);
export type RoleCompanyAuthorityEffect = (typeof ROLE_COMPANY_AUTHORITY_EFFECTS)[number];
export const DEFAULT_ROLE_COMPANY_AUTHORITY_EFFECT: RoleCompanyAuthorityEffect = "OPERATIONAL";

export const isRoleCompanyAuthorityEffect = (v: unknown): v is RoleCompanyAuthorityEffect =>
  typeof v === "string" && (ROLE_COMPANY_AUTHORITY_EFFECTS as readonly string[]).includes(v);

/** The Finance capability family: every `finance.*` key in the catalog. */
export const isFinanceCapabilityKey = (key: string): boolean => typeof key === "string" && key.startsWith("finance.");

/**
 * Why a Role holding exactly these capabilities may NOT be classified FINANCE_ONLY, or null when it may. A Role with no
 * capability is refused too: there is nothing Finance about it, and classifying ahead of the grants would let the first
 * grant decide what the classification means.
 */
export function financeOnlyClassificationRefusal(carriedCapabilityKeys: Iterable<string>): string | null {
  const keys = [...carriedCapabilityKeys].sort();
  if (keys.length === 0) return "the Role holds no capability; FINANCE_ONLY describes a Role whose every capability is a finance.* key";
  const other = keys.filter((k) => !isFinanceCapabilityKey(k));
  return other.length === 0 ? null : `the Role also holds non-finance capabilities (${other.join(", ")}); a Role that carries operational authority is OPERATIONAL`;
}
