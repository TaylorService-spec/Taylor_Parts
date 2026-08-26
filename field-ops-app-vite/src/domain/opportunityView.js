// Opportunity — PURE view-model for the trusted `getOpportunityContext` read
// (functions/src/opportunity/opportunityReadService.ts). No Firebase import, unit-testable in Node.
//
// Distinct honest states: loading / denied / unavailable / not-found / ready. The distinctions are
// the point (North Star pattern 7): a DENIED read must never render as EMPTY, and a NOT-FOUND -- a
// real answer about a real address -- must never render as UNAVAILABLE, which is a read failure.
// "Fail-closed became fail-blank" is the systemic defect the grammar names, and it is made here or
// not at all: a component cannot re-derive a distinction the view model has already collapsed.
//
// SHAPED FOR THE RECORD PAGE, NOT THE PIPELINE. domain/opportunityLifecycle.js's buildPipelineRow
// is the LIST projection and stays exactly as it is; this is its per-record sibling. Both read the
// same governed projection and neither re-derives stage, outcome or attention -- those live once,
// in opportunityLifecycle.js, and are consumed by both.

export const OPPORTUNITY_VIEW_STATE = Object.freeze({
  LOADING: "loading",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  NOT_FOUND: "not-found",
  READY: "ready",
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * Build the render-ready view from the callable's raw envelope
 * ({status, opportunity, accountName, salesOrderNumber}) or a transport-level error status.
 * `result` is null while still loading.
 */
export function opportunityView({ loading = false, errorStatus = null, result = null } = {}) {
  if (loading) return { kind: OPPORTUNITY_VIEW_STATE.LOADING };
  if (errorStatus) return { kind: errorStatus };
  if (!result) return { kind: OPPORTUNITY_VIEW_STATE.UNAVAILABLE };
  if (result.status === "not-found") return { kind: OPPORTUNITY_VIEW_STATE.NOT_FOUND };
  if (result.status !== "ready" || !result.opportunity) return { kind: OPPORTUNITY_VIEW_STATE.UNAVAILABLE };

  const o = result.opportunity;
  return {
    kind: OPPORTUNITY_VIEW_STATE.READY,
    // `id` is for ROUTING and for the governed commands' payloads. It is never displayed
    // (DECISIONS #106) and the composition has no branch that can print it.
    id: o.id,
    // The governed business reference (OPP-YYYY-######), allocated transactionally at creation.
    // Honestly null on an Opportunity that predates numbering -- never backfilled from `id`.
    opportunityNumber: str(o.opportunityNumber),
    // Read but never written by any path in this repository (the metadata definition records the
    // same fact and deliberately does not declare it). Carried through because the projection
    // returns it and a view model that drops a field is a field the screen can never show; the
    // composition treats it as a supplementary label, never as identity.
    name: str(o.name),
    accountId: str(o.accountId),
    // Resolved SERVER-SIDE, under the server's authority -- see the callable. Null means
    // unresolved, which the page states in words; it never falls back to the accountId.
    accountName: str(result.accountName),
    ownerEmployeeId: str(o.ownerEmployeeId),
    salesChannel: str(o.salesChannel),
    stage: str(o.stage),
    outcome: str(o.outcome),
    need: str(o.need),
    nextAction: str(o.nextAction),
    expectedValue: num(o.expectedValue),
    expectedCloseAt: num(o.expectedCloseAt),
    lines: Array.isArray(o.lines) ? o.lines.map(lineView) : [],
    salesOrderId: str(o.salesOrderId),
    // The linked order's REFERENCE, resolved server-side so the lineage row can name it rather
    // than print its routing key. Null when there is no order OR when the reference could not be
    // resolved -- `salesOrderId` is what tells those two apart.
    salesOrderNumber: str(result.salesOrderNumber),
    salesAgreementId: str(o.salesAgreementId),
    createdAtMillis: num(o.createdAtMillis),
    updatedAtMillis: num(o.updatedAtMillis),
    closedAtMillis: num(o.closedAtMillis),
  };
}

/**
 * One solution line.
 *
 * A line references a PRODUCT / MODEL / PART and NEVER a serialized asset -- Opportunity is
 * pre-commitment, and the pure command builder rejects a serialized-asset line outright. `qty` is
 * nullable because opportunities written before qty became required at line-creation time exist,
 * and that absence is load-bearing: it is what blocks WON (LINE_QTY_REQUIRED_FOR_WON), so it must
 * survive to the page rather than being softened to 0 here.
 */
function lineView(line, index) {
  return {
    // Lines are a stored ARRAY with no per-line id, so the key is positional. That is honest about
    // the data model rather than a fabricated identifier -- and whole-array replacement is how the
    // governed edit command writes them, so a position is exactly as stable as a line is.
    key: `line-${index}`,
    kind: typeof line?.kind === "string" ? line.kind : null,
    ref: typeof line?.ref === "string" ? line.ref : null,
    qty: num(line?.qty),
  };
}
