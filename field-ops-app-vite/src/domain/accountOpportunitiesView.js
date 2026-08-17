// Account-scoped Opportunities — PURE view-model for the trusted `listOpportunitiesForAccount` read
// (functions/src/opportunity/opportunityReadService.ts). No Firebase import, unit-testable in Node.
// Wave 7 completion PART 2.
//
// Distinct honest states: loading / denied / unavailable / empty / ready. EMPTY renders ONLY when the
// read genuinely succeeded (status "ready") and returned zero rows -- a denied or unavailable read is
// NEVER collapsed into "no opportunities" (that would tell the user the account has none when the
// truth is "the read failed" or "you can't see them"). `truncated` rides the ready payload so the UI
// can honestly disclose a bounded page ("showing first N") instead of silently dropping rows.

export const ACCOUNT_OPPORTUNITIES_STATE = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  EMPTY: "empty",
  READY: "ready",
});

// Build the render-ready view from the callable's raw result ({status, opportunities, skipped,
// truncated}) or a transport-level error status. `result` is null while still loading or on failure.
export function accountOpportunitiesView({ loading = false, errorStatus = null, result = null } = {}) {
  if (loading) return { kind: ACCOUNT_OPPORTUNITIES_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result || result.status !== "ready") return { kind: ACCOUNT_OPPORTUNITIES_STATE.UNAVAILABLE };

  const opportunities = Array.isArray(result.opportunities) ? result.opportunities : [];
  const truncated = result.truncated === true;
  const skipped = typeof result.skipped === "number" ? result.skipped : 0;

  if (opportunities.length === 0) {
    // A real, genuinely-succeeded empty read -- distinct from denied/unavailable above.
    return { kind: ACCOUNT_OPPORTUNITIES_STATE.EMPTY };
  }

  return {
    kind: ACCOUNT_OPPORTUNITIES_STATE.READY,
    truncated,
    skipped,
    rows: opportunities.map((o) => ({
      key: o.id,
      id: o.id,
      // HUMAN IDENTITY, in preference order. The document id is deliberately NOT in this
      // chain any more: it used to be the final fallback, which is how `95kFz8WWgiSn2nU2O3Ml`
      // ended up as a row label in front of users. A database key is not a name.
      //
      // When a record genuinely has no identity -- Opportunities created before the name and
      // reference existed -- "Unnamed opportunity" is the honest answer. It tells the reader
      // something true (this record has no name) instead of showing them a key they cannot
      // read, search for, or repeat on a phone call. The reference below still identifies it
      // precisely where one exists.
      label: o.name || o.need || o.opportunityNumber || "Unnamed opportunity",
      // The immutable system reference, carried separately from the label so a row can show
      // both a human name and the identifier used in lineage links elsewhere.
      reference: o.opportunityNumber ?? null,
      stage: o.stage,
      outcome: o.outcome,
      expectedValue: o.expectedValue,
      expectedCloseAt: o.expectedCloseAt,
      ownerEmployeeId: o.ownerEmployeeId,
      salesOrderId: o.salesOrderId,
    })),
  };
}
