// EOS Ownership Model v1 — the COMMERCIAL OPERATING-COMPANY axis (Owner rulings R-14 / R-15,
// 2026-08-30).
//
// The company enters the commercial chain at the OPPORTUNITY and is COPIED downstream at creation:
//
//     Opportunity.operatingCompanyId
//       -> Sales Agreement -> Sales Order -> Invoice -> Payment / Adjustment / Refund
//
// TWO INDEPENDENT AXES ON ONE RECORD. `ownerEmployeeId` answers *who owns the sale*;
// `operatingCompanyId` answers *which operating company is conducting it*. A Sales Order owned by
// Rudy and booked to Taylor is one record with two true facts, and neither displaces the other.
// This module never touches ownership, and the ownership resolver never touches this.
//
// IT IS EXPLICIT OR INHERITED. NEVER INFERRED. Ruling R-14 forbids deriving it from the Account
// owner, the salesperson, the creator, `lineOfBusiness`, an equipment model, or a display name --
// because one salesperson and one customer may legitimately transact with EITHER company. Ruling
// R-15 is the sharp end of that: a Customer must NOT carry a single operating company just to make
// this chain resolve. The customer relationship and the transacting company are different
// questions, and collapsing them would silently decide the second by answering the first.
//
// COPIED, NOT FOLLOWED. A downstream record takes the company at creation and keeps it. It does not
// resolve upstream forever -- so correcting an Opportunity cannot silently rewrite the company on
// invoices that were already issued against it. Historical company responsibility stays historical,
// exactly as ownership does.
//
// INERT AND BACKWARD-COMPATIBLE. `operatingCompanyId` is OPTIONAL everywhere. An existing caller
// that supplies nothing gets `null` and behaves exactly as before -- there is no enforcement, and
// none may be added until the census gate passes. What is NOT permitted, even now, is a bad value:
// an ungoverned company id is a caller error, not a reason to fall back to null.
//
// NO PRODUCTION DEFAULT. Ruling R-14: "Do not silently default production Opportunities to Taylor."
// There is no default in this module at all. A synthetic fixture may declare one, and that
// declaration lives in visible fixture configuration, never here.

import { resolveOperatingCompany } from "./operatingCompanyAuthority";

export class CommercialCompanyScopeError extends Error {
  readonly code = "OPERATING_COMPANY_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "CommercialCompanyScopeError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Resolve the operating company for a NEW commercial record.
 *
 * @param explicit what the caller supplied, if anything.
 * @param inherited the upstream record's stored company, if any -- read by the caller from the
 *        document it already has in hand, so this stays pure.
 * @returns the governed company id, or `null` when neither is present.
 *
 * Returning null rather than throwing on absence is what makes this inert: the model is not yet
 * enforced anywhere, and a create that refused for a missing company would be enforcement smuggled
 * in through a validator. When enforcement is authorized, the refusal belongs at that gate.
 */
export function resolveCommercialCompanyScope(explicit: unknown, inherited?: unknown): string | null {
  const candidate = nonEmpty(explicit) ? explicit.trim() : nonEmpty(inherited) ? inherited.trim() : null;
  if (candidate === null) return null;

  const { state } = resolveOperatingCompany(candidate);
  if (state === "RESOLVED" || state === "INACTIVE") {
    // INACTIVE passes: a record booked to a company that has since been deactivated still landed on
    // that company's books, and rejecting it would rewrite history to tidy a registry.
    return candidate;
  }
  throw new CommercialCompanyScopeError(
    `operatingCompanyId "${candidate}" is not a governed operating company. ` +
      "It is never inferred from the account owner, the salesperson, lineOfBusiness, or a display name.",
  );
}
