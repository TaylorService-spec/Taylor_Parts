// THE SALES AGREEMENT INDEX, DECIDED IN PURE CODE.
//
// Wave 16 / Lane BQ, Owner ruling D. `domain/salesAgreementRead.js` already states this codebase's
// rule for the RECORD reads -- "pure logic lives in domain/", so node can reach the decisions
// without a browser -- and this is the same rule for the LIST.
//
// It performs no read. It says what one answer MEANS, and the one distinction it exists to protect
// is the one a list screen gets wrong by default:
//
//   EMPTY is an ANSWER. The governed read succeeded, the caller holds salesAgreement.read, and this
//   tenant has no Sales Agreements. `eos_commercial.sales_agreements` is genuinely EMPTY in nonprod
//   (the C5 Commercial seed has not been executed and the twelve synthetic records were deleted on
//   2026-09-23), so this is the state the screen will actually be in -- not an edge case.
//
//   REFUSED is a different answer. The caller does not hold salesAgreement.read. Nothing is wrong
//   and nothing will load later.
//
//   UNAVAILABLE is NOT an answer. The service is unconfigured, unreachable, or replied with
//   something this bundle cannot read. Rendering it as "no sales agreements" would report a broken
//   transport as a fact about the business, which is the exact failure the Sales Agreement card
//   already made once in the other direction (it told every reader agreements were "not enabled in
//   this environment" while all four capabilities were live).
//
// An UNPARSEABLE success body is UNAVAILABLE, never EMPTY, for that same reason.
//
// ════════════════════ THE AUTHORITY SPLIT (lane S3) ════════════════════
//
// EMPTY is only an answer about the BUSINESS when the store this list reads is the store Agreements
// are WRITTEN to. Today it is not:
//
//   READ   this index -> POST /commercial/sales { listSalesAgreements } -> PostgreSQL
//          eos_commercial.sales_agreements (functions/src/eosCommercial/reads/salesAgreementReadProjection.ts)
//   WRITE  createSalesAgreement / updateSalesAgreementDraft / acceptSalesAgreement -> Firebase
//          callables (functions/src/salesAgreement/salesAgreementCallables.ts) -> Firestore
//          `sales_agreements`; the record page reads back through getSalesAgreementContext.
//
// Nothing copies one into the other (C5 not run, no dual write by ruling), so an Agreement created
// this morning exists and this list cannot see it. While that holds, an empty PostgreSQL page is
// NOT_CUT_OVER -- a statement about an un-migrated table -- and a non-empty one is shown but marked
// incomplete. Flip SALES_AGREEMENT_WRITE_AUTHORITY_CURRENT to POSTGRES in the same change that moves
// the writer (C6), and EMPTY means "none exist" again with no other edit.

export const SALES_AGREEMENT_AUTHORITY = Object.freeze({
  FIRESTORE: "FIRESTORE",
  POSTGRES: "POSTGRES",
});

/** Where this index reads from. Fixed by the transport it calls. */
export const SALES_AGREEMENT_INDEX_READ_AUTHORITY = SALES_AGREEMENT_AUTHORITY.POSTGRES;

/** Where Agreement commands write TODAY. Firestore until the C6 writer cutover. */
export const SALES_AGREEMENT_WRITE_AUTHORITY_CURRENT = SALES_AGREEMENT_AUTHORITY.FIRESTORE;

/** True only when the list reads the store Agreements are written to. Anything unrecognised is a split. */
export const salesAgreementIndexIsAuthoritative = (writeAuthority = SALES_AGREEMENT_WRITE_AUTHORITY_CURRENT) =>
  writeAuthority === SALES_AGREEMENT_INDEX_READ_AUTHORITY;

export const SALES_AGREEMENT_INDEX_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  EMPTY: "EMPTY",
  REFUSED: "REFUSED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_CUT_OVER: "NOT_CUT_OVER",
});

/** The transport failure codes that mean "you may not", as opposed to "it did not work". */
const REFUSAL_CODES = new Set(["FORBIDDEN", "UNAUTHENTICATED", "NOT_SIGNED_IN"]);

export const SALES_AGREEMENT_INDEX_REFUSED_REASON =
  "Sales Agreements are governed by salesAgreement.read, and this account does not hold it. Nothing is loading and retrying will not change the answer.";

export const SALES_AGREEMENT_INDEX_UNAVAILABLE_REASON =
  "The Sales Agreement list could not be read from the governed source, so nothing is being shown. This is not a permission decision and it does not mean there are none — retry, and report it if it persists.";

export const SALES_AGREEMENT_INDEX_EMPTY_REASON =
  "No Sales Agreements exist for this company yet. An Agreement is created from an Opportunity, on the Opportunity's own record page — this list shows them once they are.";

export const SALES_AGREEMENT_INDEX_NOT_CUT_OVER_REASON =
  "Sales Agreements are not yet listed here. Agreements are still created and kept on each Opportunity — open the Opportunity to see its Agreement. This list reads the new Commercial store, which does not receive Agreements until the Commercial cutover; an empty list here does not mean none exist.";

export const SALES_AGREEMENT_INDEX_INCOMPLETE_NOTICE =
  "This is not the complete list. Agreements are still created and kept on each Opportunity, and ones created there do not appear here until the Commercial cutover.";

const isRow = (row) =>
  !!row && typeof row === "object"
  && typeof row.id === "string" && row.id.length > 0
  && typeof row.salesAgreementNumber === "string" && row.salesAgreementNumber.length > 0;

/**
 * Turn one `listSalesAgreements` envelope into what the screen renders.
 *
 * `result` is the value `services/commercialApiClient.js` returns, or null while nothing has been
 * asked yet. Returns `{ state, rows, truncated, reason, complete }`; `rows` is always an array, so no
 * caller can accidentally render a refusal as a list. `complete` is false whenever the list does not
 * read the store Agreements are written to (see THE AUTHORITY SPLIT above).
 *
 * @param {object|null} result
 * @param {{writeAuthority?: string}} [options] where Agreement commands write; defaults to today's
 */
export function salesAgreementIndexView(result, { writeAuthority = SALES_AGREEMENT_WRITE_AUTHORITY_CURRENT } = {}) {
  const authoritative = salesAgreementIndexIsAuthoritative(writeAuthority);
  const empty = Object.freeze([]);
  if (result === null || result === undefined) {
    return Object.freeze({ state: SALES_AGREEMENT_INDEX_STATE.LOADING, rows: empty, truncated: false, reason: null, complete: false });
  }
  if (result.ok !== true) {
    const refused = REFUSAL_CODES.has(result.code);
    return Object.freeze({
      state: refused ? SALES_AGREEMENT_INDEX_STATE.REFUSED : SALES_AGREEMENT_INDEX_STATE.UNAVAILABLE,
      rows: empty,
      truncated: false,
      reason: refused ? SALES_AGREEMENT_INDEX_REFUSED_REASON : SALES_AGREEMENT_INDEX_UNAVAILABLE_REASON,
      complete: false,
    });
  }
  const page = result.result;
  // MALFORMED IS UNAVAILABLE, NEVER EMPTY -- the same rule access/experienceContext.js states about
  // the experience payload. A body this bundle cannot read is a transport fault; calling it "none"
  // would be a claim about the business drawn from a parse failure.
  if (!page || typeof page !== "object" || !Array.isArray(page.items)) {
    return Object.freeze({
      state: SALES_AGREEMENT_INDEX_STATE.UNAVAILABLE,
      rows: empty,
      truncated: false,
      reason: SALES_AGREEMENT_INDEX_UNAVAILABLE_REASON,
      complete: false,
    });
  }
  // A row this bundle cannot identify is DROPPED rather than rendered half-blank: without an id and
  // a number there is nothing to route to and nothing to name it by. A page of nothing but such rows
  // is still EMPTY rather than an error -- the read succeeded, and the honest statement is that this
  // build has nothing it can show.
  const rows = Object.freeze(page.items.filter(isRow).map((row) => Object.freeze({ ...row })));
  if (rows.length === 0) {
    // An empty page from a store Agreements are not written to says nothing about the business.
    return Object.freeze({
      state: authoritative ? SALES_AGREEMENT_INDEX_STATE.EMPTY : SALES_AGREEMENT_INDEX_STATE.NOT_CUT_OVER,
      rows,
      truncated: page.truncated === true,
      reason: authoritative ? SALES_AGREEMENT_INDEX_EMPTY_REASON : SALES_AGREEMENT_INDEX_NOT_CUT_OVER_REASON,
      complete: false,
    });
  }
  return Object.freeze({
    state: SALES_AGREEMENT_INDEX_STATE.READY,
    rows,
    truncated: page.truncated === true,
    reason: authoritative ? null : SALES_AGREEMENT_INDEX_INCOMPLETE_NOTICE,
    complete: authoritative && page.truncated !== true,
  });
}

/** The record page a row opens. Derived from the route App.jsx mounts, never typed twice. */
export const salesAgreementHref = (salesAgreementId) =>
  `/customers/opportunities/sales-agreement/${encodeURIComponent(salesAgreementId)}`;
