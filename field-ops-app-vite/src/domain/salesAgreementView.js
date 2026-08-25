// The Sales Agreement view model — the projection turned into what a screen can render.
//
// ════════════════════ WHY THIS FILE EXISTS AT ALL ════════════════════
//
// The Sales Order's `totalMinor` was returned faithfully by the server for weeks and never reached
// a screen, because the view model in between simply did not carry it. Every test passed: they
// asserted the screen referenced the field, and a reference is not an arrival.
//
// So this file carries EVERY field the projection declares, and its tests feed values in and assert
// values out. A field that is not listed here is a field the UI can never show, however faithfully
// the server returns it.

export const SALES_AGREEMENT_VIEW_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  /** No agreement exists for this Opportunity yet. NOT an error — it is the answer that decides
   *  between offering CREATE and offering VIEW. */
  NONE: "NONE",
  READY: "READY",
});

const lineView = (l) => ({
  lineId: l?.lineId ?? null,
  kind: l?.kind ?? null,
  ref: l?.ref ?? null,
  quantity: typeof l?.quantity === "number" ? l.quantity : null,
  // NULL, never 0: an unpriced draft line has no price, and zero would say it is free.
  unitPriceMinor: typeof l?.unitPriceMinor === "number" ? l.unitPriceMinor : null,
  extendedMinor: typeof l?.extendedMinor === "number" ? l.extendedMinor : null,
  condition: l?.condition ?? null,
  warranty: l?.warranty ?? null,
  estimatedArrivalMillis: typeof l?.estimatedArrivalMillis === "number" ? l.estimatedArrivalMillis : null,
});

/**
 * @param {{ result: object|null, loading: boolean, errorStatus: string|null }} input
 */
export function salesAgreementView({ result, loading, errorStatus }) {
  if (loading) return { kind: SALES_AGREEMENT_VIEW_STATE.LOADING };
  // Denied and unavailable are DIFFERENT facts and must stay apart: one says "you may not see
  // this", the other says "we could not ask". Collapsing them would tell a permitted user they
  // lack permission whenever the network is down.
  if (errorStatus === "permission-denied") return { kind: SALES_AGREEMENT_VIEW_STATE.DENIED };
  if (errorStatus) return { kind: SALES_AGREEMENT_VIEW_STATE.UNAVAILABLE };
  if (!result || result.status === "not-found" || !result.salesAgreement) {
    return { kind: SALES_AGREEMENT_VIEW_STATE.NONE };
  }

  const a = result.salesAgreement;
  return {
    kind: SALES_AGREEMENT_VIEW_STATE.READY,
    // Routing only. Never the displayed identity (DECISIONS #106).
    id: a.id,
    // The governed business reference. Honestly null if a record somehow lacks one — the renderer
    // shows a truthful generic label rather than falling back to the document id.
    salesAgreementNumber: a.salesAgreementNumber ?? null,
    state: a.state ?? null,
    accountId: a.accountId ?? null,
    ownerEmployeeId: a.ownerEmployeeId ?? null,
    locationId: a.locationId ?? null,
    currency: a.currency ?? null,
    customerPO: a.customerPO ?? null,
    isLease: a.isLease === true,
    fulfillmentIntent: a.fulfillmentIntent ?? null,
    shippingInstructions: a.shippingInstructions ?? null,
    shipVia: a.shipVia ?? null,
    specialInstructions: a.specialInstructions ?? null,
    lines: Array.isArray(a.lines) ? a.lines.map(lineView) : [],
    // Every amount stays integer minor units all the way to the renderer. Formatting is a display
    // concern; a number divided by 100 here would be a float nobody can add up again.
    subtotalMinor: a.subtotalMinor ?? null,
    shippingMinor: a.shippingMinor ?? null,
    installChargeMinor: a.installChargeMinor ?? null,
    taxMinor: a.taxMinor ?? null,
    totalMinor: a.totalMinor ?? null,
    downPaymentMinor: a.downPaymentMinor ?? null,
    tradeInMinor: a.tradeInMinor ?? null,
    balanceMinor: a.balanceMinor ?? null,
    sourceOpportunityId: a.sourceOpportunityId ?? null,
    salesOrderId: a.salesOrderId ?? null,
    acceptedAtMillis: a.acceptedAtMillis ?? null,
    acceptedByUid: a.acceptedByUid ?? null,
  };
}

/**
 * The displayed identity, and the rule about what may stand in for it.
 *
 * DECISIONS #106: a missing business reference is not permission to display a record id. When the
 * number is absent the label is the truthful generic "Sales Agreement" — which tells the reader
 * what they are looking at without pretending a routing key is a name.
 */
export function salesAgreementLabel(view) {
  return view?.salesAgreementNumber ?? "Sales Agreement";
}

/** DRAFT is the only editable state. ACCEPTED and DECLINED are terminal. */
export function agreementIsEditable(view) {
  return view?.kind === SALES_AGREEMENT_VIEW_STATE.READY && view.state === "DRAFT";
}

/**
 * Whether ACCEPT may be offered, and if not, why.
 *
 * Returns the REASON rather than a boolean, because a disabled button with no explanation sends
 * somebody to look for a permission problem when the real answer is that a line has no price.
 */
export function agreementAcceptability(view) {
  if (view?.kind !== SALES_AGREEMENT_VIEW_STATE.READY) return { canAccept: false, reason: null };
  if (view.state === "ACCEPTED") return { canAccept: false, reason: "This agreement has already been accepted." };
  if (view.state === "DECLINED") return { canAccept: false, reason: "This agreement was declined." };
  if (!view.lines.length) return { canAccept: false, reason: "Add at least one line before accepting." };
  // The SAME rule the server enforces at acceptance, stated here so the screen can explain itself
  // before the round trip — never INSTEAD of the server's, which remains the control.
  const unpriced = view.lines.filter((l) => l.unitPriceMinor === null);
  if (unpriced.length) {
    return {
      canAccept: false,
      // Names every one: pricing an agreement should not be a round trip per line.
      reason: `Every line needs a price before this can be accepted. Missing: ${unpriced.map((l) => l.ref ?? l.lineId).join(", ")}`,
    };
  }
  return { canAccept: true, reason: null };
}
