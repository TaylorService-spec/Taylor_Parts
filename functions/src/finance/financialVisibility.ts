// FIN-004 — FINANCIAL VISIBILITY: the ONE scope authority for financial reads.
//
// ============================ THE INVARIANT THIS ENFORCES ============================
//
// CAN PERFORM WORK != CAN SEE FINANCIAL RESULT. Holding an operational capability never implies
// seeing the money, and navigation/UI hiding is never authority — every financial read is scoped
// SERVER-SIDE through this module. Before FIN-004 the one financial read (`finance.read` →
// listAccountInvoiceAr) was a single global boolean that, once granted, served ANY caller-supplied
// accountId: the only expressible reach was consolidated. That is FIN-GAP-007's trap — the first
// activation event would have handed company-wide AR to every grantee. This module closes it:
// `finance.read` remains the FACT-FAMILY gate (may this principal see AR facts at all) and a
// VISIBILITY SCOPE grant determines REACH. Both are required; either alone reaches nothing.
//
// ============================ THE SCOPE LATTICE (FIN-004) ============================
//
//   SELF               records credited to me (attribution.creditedSalespersonId == my employeeId)
//   TEAM               SELF plus the employees the role hierarchy places under me
//                      (access/hierarchicalVisibility.ts — its first live consumer)
//   BUSINESS_UNIT      records attributable wholly to one governed business unit
//   OPERATING_COMPANY  records of one governed operating company
//   CONSOLIDATED       everything — only when expressly granted; never a default
//
// Reach is the UNION of the principal's granted scopes. A record outside every granted scope is
// invisible — including to the caller who supplied its accountId: a caller-chosen account can
// never expand scope (the filter runs regardless of what was asked for).
//
// FAIL-CLOSED RULES, stated once:
//  - No grants ⇒ nothing.
//  - SELF/TEAM read the invoice's frozen `attribution.creditedSalespersonId`; a record with no
//    credited person is NOT visible under SELF/TEAM (an honest null is not yours).
//  - BUSINESS_UNIT: an invoice is visible only when it has lines and EVERY line belongs to the
//    scoped unit. A cross-unit invoice contains numbers outside the scope, so the whole document
//    stays hidden — visibility follows the number; partial redaction of one immutable financial
//    document is not a thing this model does.
//  - OPERATING_COMPANY: exact match on the invoice's governed companyId (which FIN-002 pinned to
//    the Sales Order's operatingCompanyId — never caller-chosen).
//  - A COMPANY or BUSINESS_UNIT grant without a bound value confers NOTHING (see the blocker
//    note below) — never "all companies", never inferred.
//
// ============================ WHAT IS DELIBERATELY NOT DECIDED HERE ==================
//
// HOW a principal is BOUND to a company or business-unit value is an access-governance decision
// the Owner's R-2x scope workstream owns (R-29 bound warehouses via RoleAssignment.scope
// {type:"location"}; R-32 made scope per-binding). The candidate mechanisms — a new ScopeType,
// the unused "domain" ScopeType, or a governed Employee fact — each change access authority this
// run may not decide (FIN-BLOCK-001 in the run ledger). Until that ruling, the COMPANY/BU
// predicates below are implemented and tested, and `loadFinancialVisibilityAuthority` resolves
// those two grants to BLOCKED (no reach), never to a guess.
//
// Pure: no Firestore, no clock, no identity. The loader beside the callable does the reads.

export const FINANCIAL_VISIBILITY_SCOPES = Object.freeze([
  "SELF",
  "TEAM",
  "BUSINESS_UNIT",
  "OPERATING_COMPANY",
  "CONSOLIDATED",
] as const);
export type FinancialVisibilityScope = (typeof FINANCIAL_VISIBILITY_SCOPES)[number];

/**
 * The capability ids (permissionCatalog.ts, all registered `active:false` — REGISTER != GRANT !=
 * ACTIVATE). Catalog-convention names: domain.resource.action.
 */
export const FINANCIAL_VISIBILITY_CAPABILITIES = Object.freeze({
  SELF: "finance.visibility.self",
  TEAM: "finance.visibility.team",
  BUSINESS_UNIT: "finance.visibility.businessUnit",
  OPERATING_COMPANY: "finance.visibility.company",
  CONSOLIDATED: "finance.visibility.consolidated",
} as const);

/** The fact-family gate for AR facts. Reach requires a scope grant IN ADDITION to this. */
export const FINANCE_READ_FACT_FAMILY_CAPABILITY = "finance.read";

export type FinancialVisibilityErrorCode = "SCOPE_VALUE_REQUIRED" | "SCOPE_INVALID";

export class FinancialVisibilityError extends Error {
  code: FinancialVisibilityErrorCode;
  constructor(code: FinancialVisibilityErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "FinancialVisibilityError";
  }
}

/** One granted scope, with the value(s) that make it decidable. */
export type FinancialVisibilityGrant =
  | { scope: "CONSOLIDATED" }
  | { scope: "SELF"; employeeId: string }
  | { scope: "TEAM"; visibleEmployeeIds: ReadonlySet<string> }
  | { scope: "BUSINESS_UNIT"; businessUnitId: string }
  | { scope: "OPERATING_COMPANY"; operatingCompanyId: string };

/** The financial facts of one invoice this authority decides over — raw stored facts, not a projection. */
export interface InvoiceVisibilityFacts {
  companyId?: string | null;
  creditedSalespersonId?: string | null;
  lineBusinessUnitIds?: ReadonlyArray<string | null | undefined>;
}

export interface FinancialVisibilityAuthority {
  /** May this principal see AR facts AT ALL (finance.read)? Reach still requires a scope. */
  factFamilyAllowed: boolean;
  /** The scopes that actually confer reach for this principal. */
  grantedScopes: ReadonlyArray<FinancialVisibilityScope>;
  /** Scope grants held but NOT honored, with the reason (e.g. FIN-BLOCK-001 value binding). */
  blockedScopes: ReadonlyArray<{ scope: FinancialVisibilityScope; reason: string }>;
  /** True when the principal has the fact family AND at least one reach-conferring scope. */
  anyReach: boolean;
  isInvoiceVisible: (facts: InvoiceVisibilityFacts) => boolean;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function validateGrant(g: FinancialVisibilityGrant): void {
  switch (g.scope) {
    case "CONSOLIDATED":
      return;
    case "SELF":
      if (!nonEmpty(g.employeeId)) {
        throw new FinancialVisibilityError("SCOPE_VALUE_REQUIRED", "SELF scope requires the principal's employeeId");
      }
      return;
    case "TEAM":
      if (!(g.visibleEmployeeIds instanceof Set) || g.visibleEmployeeIds.size === 0) {
        throw new FinancialVisibilityError("SCOPE_VALUE_REQUIRED", "TEAM scope requires a non-empty visible-employee set");
      }
      return;
    case "BUSINESS_UNIT":
      if (!nonEmpty(g.businessUnitId)) {
        throw new FinancialVisibilityError("SCOPE_VALUE_REQUIRED",
          "BUSINESS_UNIT scope requires a bound unit — a valueless grant confers nothing (FIN-BLOCK-001)");
      }
      return;
    case "OPERATING_COMPANY":
      if (!nonEmpty(g.operatingCompanyId)) {
        throw new FinancialVisibilityError("SCOPE_VALUE_REQUIRED",
          "OPERATING_COMPANY scope requires a bound company — a valueless grant confers nothing (FIN-BLOCK-001)");
      }
      return;
    default:
      throw new FinancialVisibilityError("SCOPE_INVALID", `Unknown financial visibility scope`);
  }
}

/**
 * Build the pure decision authority from resolved grants. The LOADER (financeReadCallables)
 * resolves capabilities and supplies values; this composes them into one predicate. Reach is the
 * UNION of grants; an empty grant list sees nothing.
 */
export function buildFinancialVisibilityAuthority(input: {
  factFamilyAllowed: boolean;
  grants: ReadonlyArray<FinancialVisibilityGrant>;
  blockedScopes?: ReadonlyArray<{ scope: FinancialVisibilityScope; reason: string }>;
}): FinancialVisibilityAuthority {
  for (const g of input.grants) validateGrant(g);
  const grants = [...input.grants];
  const grantedScopes = Object.freeze(grants.map((g) => g.scope));
  const blockedScopes = Object.freeze([...(input.blockedScopes ?? [])]);
  const anyReach = input.factFamilyAllowed && grants.length > 0;

  const isInvoiceVisible = (facts: InvoiceVisibilityFacts): boolean => {
    if (!anyReach) return false;
    return grants.some((g) => {
      switch (g.scope) {
        case "CONSOLIDATED":
          return true;
        case "OPERATING_COMPANY":
          return nonEmpty(facts.companyId) && facts.companyId === g.operatingCompanyId;
        case "BUSINESS_UNIT": {
          const lines = facts.lineBusinessUnitIds ?? [];
          if (lines.length === 0) return false; // nothing attributable — fail closed
          return lines.every((bu) => nonEmpty(bu) && bu === g.businessUnitId);
        }
        case "TEAM":
          return nonEmpty(facts.creditedSalespersonId) && g.visibleEmployeeIds.has(facts.creditedSalespersonId);
        case "SELF":
          return nonEmpty(facts.creditedSalespersonId) && facts.creditedSalespersonId === g.employeeId;
        default:
          return false;
      }
    });
  };

  return Object.freeze({ factFamilyAllowed: input.factFamilyAllowed, grantedScopes, blockedScopes, anyReach, isInvoiceVisible });
}

/** Extract the visibility facts from a raw stored invoice document. Tolerant of pre-FIN-002 shapes. */
export function invoiceVisibilityFacts(doc: Record<string, unknown>): InvoiceVisibilityFacts {
  const attribution = (doc.attribution ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>) : [];
  return {
    companyId: typeof doc.companyId === "string" ? doc.companyId : null,
    creditedSalespersonId:
      typeof attribution.creditedSalespersonId === "string" ? attribution.creditedSalespersonId : null,
    lineBusinessUnitIds: lines.map((l) => (typeof l.businessUnitId === "string" ? l.businessUnitId : null)),
  };
}
