// Sales Agreement CREATE/UPDATE-DRAFT/ACCEPT/READ capabilities -- PURE glue (no firebase;
// node-testable) over the trusted effective-access feed, reusing the SAME generic primitives
// access/reportCapabilityAccess.js already built. Only the REQUEST list is Agreement-specific.
// Mirrors access/salesOrderCapabilityAccess.js exactly.
//
// FOUR CAPABILITIES, NOT ONE, and the surface must honour the distinction: a principal may draft
// terms without being able to bind the business to them. Rendering an enabled ACCEPT button to
// somebody holding only salesAgreement.create is the defect SalesOrderActions already had once --
// live buttons that only revealed the denial after the user confirmed.
export {
  VERSION_STATUS,
  FEED_STATUS,
  SIGNED_OUT_VERSION,
  IDLE_FEED,
  isValidObservedVersion,
  interpretAccessResult,
  buildHasCapability,
} from "./reportCapabilityAccess.js";

export const SALES_AGREEMENT_CREATE_CAPABILITY = "salesAgreement.create";
export const SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY = "salesAgreement.updateDraft";
export const SALES_AGREEMENT_ACCEPT_CAPABILITY = "salesAgreement.accept";
export const SALES_AGREEMENT_READ_CAPABILITY = "salesAgreement.read";

// Decided in ONE request, so all four resolve against the same accessVersion -- a screen that asked
// twice could render an ACCEPT button authorized under a version the edit was already denied under.
export const SALES_AGREEMENT_CAPABILITY_REQUEST = Object.freeze([
  SALES_AGREEMENT_CREATE_CAPABILITY,
  SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY,
  SALES_AGREEMENT_ACCEPT_CAPABILITY,
  SALES_AGREEMENT_READ_CAPABILITY,
]);

// Shown next to a protected (disabled) control -- honest, and never a raw backend error string.
export const SALES_AGREEMENT_DISABLED_REASON = Object.freeze({
  create: "You do not have permission to create Sales Agreements.",
  updateDraft: "You do not have permission to edit Sales Agreement drafts.",
  accept: "You do not have permission to accept Sales Agreements.",
});
