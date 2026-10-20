// THE EXEMPTION FROM SECONDARY APPROVAL -- the PURE core (Owner policy override 2026-10-20, DECISIONS #SAE).
//
// ONE rule, stated once, consumed everywhere a workflow would otherwise refuse "the person who asked is the person who decides":
//
//     RULE 1  The authenticated, governed PROTECTED OWNER never needs a second Employee for a business action they are otherwise authorized to perform.
//     RULE 2  (delegated; PR-2) a Principal holding an approval.selfApproval.exempt* capability for the workflow scope of the site, granted by the protected Owner.
//
// It removes ONLY the second-person requirement. It never supplies a capability, a company, a state transition, a reason, an amount, an audit row or any integrity
// rule: every caller still decides all of those first, exactly as before. Non-Owners (Administrator, General Manager, Finance Manager, Parts Manager ...) keep every
// existing refusal because they never resolve to `exempt: true`.
//
// WHO (Rule 1): an ENABLED Principal with an ACTIVE tenant membership, holding an ACTIVE, GLOBAL, non-stale assignment of THE protected Owner Role (key `owner` AND the
// stored protected flag -- never a display name, never a role string supplied by a client), AND exactly one ACTIVE link to an access-eligible Employee. Anything else,
// or anything that cannot be resolved, is NOT exempt (fail closed). The SQL twin is eos_policy.protected_owner_employee (migration: protected-owner secondary-approval
// exemption); a test proves the two agree.
//
// A resolution is an object this module ISSUED: callers pass it on (for example to buildApprovalRecord) and the receiver re-verifies it with isIssuedExemption --
// a boolean or a hand-built object is not accepted.
//
// THE SCOPE MAP. Every two-person site declares its workflow scope HERE, once. A site that is not in the map is never resolved (programmer error: it throws, so a
// new two-person rule cannot silently skip the seam); a site mapped to null is never delegable (only the protected Owner is exempt there).
import { PROTECTED_OWNER_ROLE_KEY } from "../adminPolicy/administrationAuthority";
import { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES } from "../adminPolicy/employmentAccessEligibility";

/** Why a same-person decision was admitted. Recorded as approval_basis on the decision (the domain record) and on its audit row. */
export const APPROVAL_BASES = Object.freeze(["PROTECTED_OWNER", "DELEGATED_EXEMPTION"] as const);
export type ApprovalBasis = (typeof APPROVAL_BASES)[number];
/** Provenance of a PROTECTED_OWNER exemption: the standing itself, not a grant. */
export const PROTECTED_OWNER_GRANT_SOURCE = "PROTECTED_OWNER_MEMBERSHIP" as const;

/** The workflow scopes a delegated exemption can name (Rule 2 capability family approval.selfApproval.exempt*). */
export const SELF_APPROVAL_SCOPES = Object.freeze(["FINANCIALS", "PURCHASING", "SALES", "INVENTORY", "SERVICE", "GOALS"] as const);
export type SelfApprovalScope = (typeof SELF_APPROVAL_SCOPES)[number];

/** THE ONE SCOPE MAP: site -> workflow scope (null = not delegable). Adding a two-person site means adding it here. */
export const SELF_APPROVAL_SITES = Object.freeze({
  "finance.invoiceCorrection": "FINANCIALS", // F-1b credit, write-off, debit, refund record, void
  "finance.policy": "FINANCIALS", // Financial Policy approve / reject / activate / cancel separation of duties
  "goals.performanceGoal": "GOALS", // G-1 author is not approver
  "purchasing.supplierPurchaseOrder": "PURCHASING", // P-1 raiser is not approver
  "inventory.cycleCount": "INVENTORY", // material variance: counter is not reconciler
  "admin.selfAdministration": null, // SELF_ADMINISTRATION / PRIVILEGE_ESCALATION: the protected Owner only, never delegated
} as const satisfies Readonly<Record<string, SelfApprovalScope | null>>);
export type SelfApprovalSite = keyof typeof SELF_APPROVAL_SITES;

export interface SecondaryApprovalExemption {
  readonly exempt: true;
  readonly basis: ApprovalBasis;
  readonly tenantId: string;
  readonly principalId: string;
  /** The Principal's own active, access-eligible Employee. */
  readonly employeeId: string;
  readonly site: SelfApprovalSite;
  /** The workflow scope the site declared (null for a non-delegable site). */
  readonly scopeKey: SelfApprovalScope | null;
  /** Where the exemption comes from: PROTECTED_OWNER_MEMBERSHIP, or (Rule 2) the grant's source (role key / direct grant). */
  readonly grantSource: string;
}
export type SecondaryApprovalResolution = SecondaryApprovalExemption | { readonly exempt: false };

/** The governed facts the decision reads. The adapters (SQL, repository) fetch them; nothing here does I/O. */
export interface ProtectedOwnerFacts {
  readonly principalEnabled: boolean;
  readonly membershipActive: boolean;
  /** The Roles of the Principal's ACTIVE, GLOBAL, non-stale assignments. */
  readonly heldRoles: readonly { readonly key: string; readonly protected?: boolean | null }[];
  /** The Principal's ACTIVE Employee links (more than one is corrupted state and fails closed). */
  readonly employeeLinks: readonly { readonly employeeId: string; readonly employmentStatus: string | null }[];
  /** Rule 2 (PR-2): the delegated exemption grants in force for this Principal -- scope keys with their source. Absent in Rule 1. */
  readonly delegated?: readonly { readonly scopeKey: SelfApprovalScope | "ALL"; readonly source: string }[];
}

/** THE protected Owner Role: key AND the stored protected flag (the same rule as administrationAuthority.isProtectedOwnerRole). */
const isProtectedOwner = (r: { readonly key: string; readonly protected?: boolean | null }): boolean => r.protected === true && r.key === PROTECTED_OWNER_ROLE_KEY;

const ISSUED = Symbol("secondaryApprovalExemption.issued");
export const NOT_EXEMPT: SecondaryApprovalResolution = Object.freeze({ exempt: false as const });

/** The scope a site declared. An undeclared site is a programming error and throws -- it is never silently exempt or silently skipped. */
export function scopeOfSite(site: string): SelfApprovalScope | null {
  if (!Object.prototype.hasOwnProperty.call(SELF_APPROVAL_SITES, site)) throw new Error(`secondary approval: "${site}" declares no workflow scope (add it to SELF_APPROVAL_SITES)`);
  return SELF_APPROVAL_SITES[site as SelfApprovalSite];
}

/**
 * Decide from governed facts. Evaluation order (Rule 2 brief): the caller has already authenticated, decided company authority, the business capability and the
 * workflow validations; HERE: (5) the protected Owner? (6) otherwise an effective delegated exemption for this site's scope. Every gap is "not exempt".
 */
export function decideSecondaryApprovalExemption(tenantId: string, principalId: string, site: SelfApprovalSite, facts: ProtectedOwnerFacts | null | undefined): SecondaryApprovalResolution {
  const scopeKey = scopeOfSite(site);
  if (typeof tenantId !== "string" || tenantId === "" || typeof principalId !== "string" || principalId === "" || !facts) return NOT_EXEMPT;
  if (facts.principalEnabled !== true || facts.membershipActive !== true) return NOT_EXEMPT;
  if (!Array.isArray(facts.employeeLinks) || facts.employeeLinks.length !== 1) return NOT_EXEMPT;
  const link = facts.employeeLinks[0];
  if (typeof link.employeeId !== "string" || link.employeeId === "" || !link.employmentStatus || !ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES.includes(link.employmentStatus)) return NOT_EXEMPT;
  const make = (basis: ApprovalBasis, grantSource: string): SecondaryApprovalResolution => {
    // The brand is a NON-ENUMERABLE own symbol property: a copy ({...r}, JSON, structuredClone) does not carry it, and the symbol is private to this module.
    const r = { exempt: true as const, basis, tenantId, principalId, employeeId: link.employeeId, site, scopeKey, grantSource };
    Object.defineProperty(r, ISSUED, { value: true, enumerable: false });
    return Object.freeze(r) as SecondaryApprovalExemption;
  };
  if (Array.isArray(facts.heldRoles) && facts.heldRoles.some(isProtectedOwner)) return make("PROTECTED_OWNER", PROTECTED_OWNER_GRANT_SOURCE);
  // Rule 2: a site with no declared scope is never delegable.
  if (scopeKey !== null && Array.isArray(facts.delegated)) {
    const grant = facts.delegated.find((g) => g.scopeKey === scopeKey) ?? facts.delegated.find((g) => g.scopeKey === "ALL");
    if (grant) return make("DELEGATED_EXEMPTION", grant.source);
  }
  return NOT_EXEMPT;
}

/** A receiver's re-check: an object this module issued, for THIS Principal (and tenant when given). Anything else -- a boolean, a copy, a client field -- is false. */
export function isIssuedExemption(x: unknown, principalId: string, tenantId?: string): x is SecondaryApprovalExemption {
  if (typeof x !== "object" || x === null || !Object.prototype.hasOwnProperty.call(x, ISSUED) || (x as Record<symbol, unknown>)[ISSUED] !== true) return false;
  const e = x as SecondaryApprovalExemption;
  return e.exempt === true && (APPROVAL_BASES as readonly string[]).includes(e.basis) && e.principalId === principalId && (tenantId === undefined || e.tenantId === tenantId);
}

/** What a decision records when the exemption admitted a same-person decision (approval_basis + provenance), or null when no verified exemption applies. */
export interface ApprovalExemptionRecord { readonly approvalBasis: ApprovalBasis; readonly scopeKey: SelfApprovalScope | null; readonly grantSource: string; readonly site: SelfApprovalSite }
export function exemptionRecord(x: unknown, principalId: string, tenantId?: string, site?: SelfApprovalSite): ApprovalExemptionRecord | null {
  if (!isIssuedExemption(x, principalId, tenantId)) return null;
  if (site !== undefined && x.site !== site) return null; // an exemption resolved for one site never admits another
  return Object.freeze({ approvalBasis: x.basis, scopeKey: x.scopeKey, grantSource: x.grantSource, site: x.site });
}
