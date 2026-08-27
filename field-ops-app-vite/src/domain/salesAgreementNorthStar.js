import {
  SALES_AGREEMENT_VIEW_STATE,
  salesAgreementLabel,
  agreementIsEditable,
  agreementAcceptability,
} from "./salesAgreementView.js";
import { salesAgreementEntity } from "../metadata/definitions/salesAgreement.js";
import { formatMoneyDisplay } from "./moneyDisplay.js";
import { resolveActorDisplayName, UNKNOWN_ACTOR_DISPLAY_NAME } from "./actorDisplayName.js";
import {
  SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY,
  SALES_AGREEMENT_ACCEPT_CAPABILITY,
  SALES_AGREEMENT_DISABLED_REASON,
} from "../access/salesAgreementCapabilityAccess.js";

// THE SALES AGREEMENT RECORD PAGE, DERIVED ONCE — North Star P1v2.
//
// Visual authority: `docs/north-star/sales-agreement/North Star - Sales Agreement P1v2.dc.html`
// and its README. Behavioral authority: this repository. Acceptance: the sandbox + the Owner.
// Owner ruling: DECISIONS #134.
//
// ════════════════════ THIS FILE ADDS NO VOCABULARY AND NO AUTHORITY ════════════════════
//
// State words come from the entity definition's `enumLabels`. Editability comes from
// `agreementIsEditable`. Acceptance eligibility AND its reason come from `agreementAcceptability`.
// Money formatting goes through `formatMoneyDisplay`, the one display path. An actor uid becomes a
// name through `resolveActorDisplayName`, never here.
//
// `SalesAgreementPanel.jsx` keeps a private copy of the three state strings. This file deliberately
// does not add a third: the Account family had to unwind exactly that duplication.
//
// ════════════════════ NO SPINE, AND THAT IS THE DESIGN (SA-D2) ════════════════════
//
// Every other North Star family exports a lifecycle spine. This one exports none, and its absence
// is asserted by test so a later "consistency" pass cannot add one back. DRAFT → ACCEPTED |
// DECLINED is a GATE with terminal outcomes, not a progression — two of the three states are
// terminal and `checkAgreementTransition` refuses every move out of them. Chevrons would
// manufacture a journey the engine does not have.
//
// ════════════════════ WHAT IS DELIBERATELY ABSENT ════════════════════
//
// No decline (ND-14: `DECLINED` is modelled, its transition is legal, and NO callable produces it).
// No revise / supersede / reopen / replace / duplicate / second-agreement (ND-15: a terminal
// agreement cannot be edited AND a second agreement for the same Opportunity is transactionally
// refused, so EOS has no post-acceptance revision path at all). No signature, no send, no present,
// no convert. No risk score, no AI panel, no approval workflow. See the design README's SA-D12.

/** The canonical three words, read from the entity definition rather than re-declared. */
export const SALES_AGREEMENT_STATE_LABEL = Object.freeze({
  ...(salesAgreementEntity.fields.find((f) => f.id === "state")?.enumLabels ?? {}),
});

const FULFILLMENT_LABEL = Object.freeze({
  ...(salesAgreementEntity.fields.find((f) => f.id === "fulfillmentIntent")?.enumLabels ?? {}),
});

const isReady = (view) => view?.kind === SALES_AGREEMENT_VIEW_STATE.READY;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ═════════════════════════════════════════ STATE

/** STATE IN WORDS. The composition never prints `ACCEPTED`. Null on an unplaceable value. */
export function salesAgreementStateWords(view) {
  if (!isReady(view)) return null;
  return SALES_AGREEMENT_STATE_LABEL[view.state] ?? null;
}

/** Tone, so colour and word always agree. Never colour alone. */
export function salesAgreementStateTone(view) {
  if (!isReady(view)) return null;
  if (view.state === "ACCEPTED") return "positive";
  if (view.state === "DECLINED") return "negative";
  if (view.state === "DRAFT") return "info";
  return null;
}

/**
 * Terminal per `checkAgreementTransition`: ACCEPTED and DECLINED can move nowhere, and nothing may
 * return to DRAFT. This is the fact the page uses to make the edit control ABSENT rather than
 * disabled — a state restriction, not a permission one.
 */
export function salesAgreementIsTerminal(view) {
  return isReady(view) && (view.state === "ACCEPTED" || view.state === "DECLINED");
}

// ═════════════════════════════════════════ IDENTITY (SA-D1)

/**
 * The ranked identity group. Three ranks, not one metadata sentence:
 *   1. the governed number
 *   2. state · account · committed value
 *   3. customer PO · owner · originating opportunity
 *
 * THE TITLE is `salesAgreementNumber`, falling back to the truthful generic "Sales Agreement" via
 * `salesAgreementLabel` — never the document id (DECISIONS #106). `view.id` exists on the view for
 * routing and is deliberately not carried into anything displayable here.
 *
 * @param resolveAccountName optional; the projection carries `accountId`, not a name. Absent by
 *        default, because resolving it is a different read this surface does not own.
 */
export function salesAgreementHeader(view, { resolveAccountName } = {}) {
  if (!isReady(view)) return null;
  const accountName =
    typeof resolveAccountName === "function" ? text(resolveAccountName(view.accountId)) : null;
  return {
    kicker: "Sales Agreement · Negotiated commercial commitment",
    // Null when unnumbered, so a caller can tell "no reference" from "this is the reference".
    reference: view.salesAgreementNumber ?? null,
    title: salesAgreementLabel(view),
    isNumbered: view.salesAgreementNumber != null,
    stateWords: salesAgreementStateWords(view),
    stateTone: salesAgreementStateTone(view),
    isTerminal: salesAgreementIsTerminal(view),
    accountId: view.accountId ?? null,
    accountName,
    locationId: view.locationId ?? null,
    customerPO: text(view.customerPO),
    ownerEmployeeId: view.ownerEmployeeId ?? null,
    sourceOpportunityId: view.sourceOpportunityId ?? null,
    currency: view.currency ?? null,
  };
}

// ═════════════════════════════════════════ AGREED LINES (SA-D4, SA-D5)

/**
 * THE LINE'S IDENTITY IS ITS STORED REFERENCE (SA-G4).
 *
 * A line persists `{ lineId, kind, ref, quantity, unitPriceMinor, extendedMinor, condition,
 * warranty, estimatedArrivalMillis }` and NO display name. `productReferenceSearchService` returns
 * a `displayName` at PICK time; nothing stores it and the agreement read does not return it.
 *
 * So `ref` is the identity, always. `displayName` is decoration that may be absent, and
 * `displayNameResolved` says which happened — a caller can render the honest fallback rather than
 * guessing. **Nothing here persists a name to make the mock come true.**
 *
 * `unitPriceMinor === null` means UNPRICED, never free. `formatted` is null for an unpriced line;
 * a `$0.00` there would say the customer is getting it for nothing.
 *
 * @param resolveDisplayName optional (ref, kind) => string|null. Default resolves nothing.
 */
export function salesAgreementLines(view, { resolveDisplayName } = {}) {
  if (!isReady(view)) return [];
  const currency = view.currency ?? null;
  const resolve = typeof resolveDisplayName === "function" ? resolveDisplayName : () => null;
  return view.lines.map((l) => {
    const displayName = text(resolve(l.ref, l.kind));
    const unitPriceMinor = num(l.unitPriceMinor);
    const extendedMinor = num(l.extendedMinor);
    return {
      lineId: l.lineId ?? null,
      kind: l.kind ?? null,
      // The identity. Never replaced by a resolved name, only accompanied by one.
      ref: l.ref ?? null,
      displayName,
      displayNameResolved: displayName != null,
      quantity: num(l.quantity),
      unitPriceMinor,
      unitPriceFormatted: unitPriceMinor == null ? null : formatMoneyDisplay(unitPriceMinor, currency),
      extendedMinor,
      extendedFormatted: extendedMinor == null ? null : formatMoneyDisplay(extendedMinor, currency),
      priced: unitPriceMinor != null,
      condition: text(l.condition),
      warranty: text(l.warranty),
      estimatedArrivalMillis: num(l.estimatedArrivalMillis),
    };
  });
}

// ═════════════════════════════════════════ THE MONEY LADDER (SA-D3, SA-D8)

/**
 * TWO BLOCKS WITH TWO JOBS, and the incompleteness rule that governs both.
 *
 * `computeAgreementTotals` nulls `subtotalMinor`, `totalMinor` and `balanceMinor` unless EVERY line
 * is priced, and defaults the optional charges to 0. So:
 *
 *   COMPLETE   → the sale composition (subtotal, shipping, install, tax, TOTAL) and, subordinate to
 *                it, the credits recorded at commitment (down payment, trade-in, balance).
 *   INCOMPLETE → NO subtotal, NO total, NO balance. Not a partial sum, not `$0.00`. The caller gets
 *                `unpricedRefs` so it can name every line, which is what the draft blocker needs.
 *
 * A charge row is OMITTED when null (unknown) or 0 (nothing to say) — never rendered as `$0.00`,
 * which would assert a fact about money in both cases.
 *
 * `balance` is the agreement's own arithmetic (total − down payment − trade-in). It is NOT an
 * accounts-receivable balance and no payment is tracked on this record; the flag says so, so a
 * composition cannot quietly promote it above the total.
 */
export function salesAgreementMoneyLadder(view) {
  if (!isReady(view)) return null;
  const currency = view.currency ?? null;
  const fmt = (minor) => (num(minor) == null ? null : formatMoneyDisplay(minor, currency));
  // A charge the caller should draw: a real, non-zero amount. Null and 0 both mean "no row".
  const charge = (minor) => {
    const v = num(minor);
    return v == null || v === 0 ? null : { minor: v, formatted: formatMoneyDisplay(v, currency) };
  };

  const unpriced = view.lines.filter((l) => num(l.unitPriceMinor) == null);
  const totalMinor = num(view.totalMinor);
  const complete = unpriced.length === 0 && totalMinor != null;

  return {
    currency,
    complete,
    unpricedCount: unpriced.length,
    // Named, not counted: pricing an agreement should not be a round trip per line.
    unpricedRefs: unpriced.map((l) => l.ref ?? l.lineId).filter((v) => v != null),
    saleComposition: {
      subtotal: complete ? { minor: num(view.subtotalMinor), formatted: fmt(view.subtotalMinor) } : null,
      shipping: complete ? charge(view.shippingMinor) : null,
      installCharge: complete ? charge(view.installChargeMinor) : null,
      tax: complete ? charge(view.taxMinor) : null,
      total: complete ? { minor: totalMinor, formatted: fmt(totalMinor) } : null,
    },
    credits: {
      downPayment: complete ? charge(view.downPaymentMinor) : null,
      tradeIn: complete ? charge(view.tradeInMinor) : null,
      balance: complete ? { minor: num(view.balanceMinor), formatted: fmt(view.balanceMinor) } : null,
      // Load-bearing: the page is a commercial commitment, not an invoice.
      isAccountsReceivable: false,
    },
  };
}

// ═════════════════════════════════════════ ACCEPTANCE EVIDENCE (SA-D7)

/**
 * EXACTLY WHAT EOS PROVES, AND THE SENTENCES IT MAY SAY ABOUT IT.
 *
 * `buildAcceptSalesAgreement` writes three things: `state: "ACCEPTED"`, `acceptedAtMillis` from the
 * server clock, and `acceptedByUid` — the EOS principal who invoked the command. It captures and
 * stores NOTHING about the customer.
 *
 * These strings are exported as data rather than left in JSX so the boundary can be asserted by
 * test instead of by review, which is what the implementation work order requires. A future edit
 * that introduces "binding", "signed", "electronically" or "the customer accepted" fails the suite.
 */
export const SALES_AGREEMENT_ACCEPTANCE_STATEMENTS = Object.freeze({
  recorded: "EOS records the governed acceptance event.",
  noSignatureEvidence: "No customer-signature evidence is stored on this Agreement.",
  readOnly: "Accepted agreements are read-only.",
  notRecorded: "Not recorded. A draft has no acceptance event.",
});

/** The labels for the three evidence facts. "Action executed by" — not "accepted by". */
export const SALES_AGREEMENT_ACCEPTANCE_LABEL = Object.freeze({
  state: "Agreement state",
  recordedAt: "Recorded",
  actor: "Action executed by",
});

/**
 * @param byUserId the employee directory map from `useEmployeeDirectory`. Absent or unresolvable
 *        yields `UNKNOWN_ACTOR_DISPLAY_NAME` — never the raw uid (F-UID-1).
 * @param formatWhen injected formatter, so this file holds no locale or timezone knowledge.
 */
export function salesAgreementAcceptance(view, { byUserId, formatWhen } = {}) {
  if (!isReady(view)) return null;
  const accepted = view.state === "ACCEPTED";
  const atMillis = num(view.acceptedAtMillis);
  const uid = view.acceptedByUid ?? null;

  // resolveActorDisplayName returns a falsy uid unchanged; only a PRESENT uid resolves to a name or
  // to the neutral constant. Absence of an actor and an unresolved actor stay different facts.
  const actorName = uid ? resolveActorDisplayName(uid, byUserId) : null;

  return {
    accepted,
    stateWords: salesAgreementStateWords(view),
    recordedAtMillis: atMillis,
    recordedAtText: atMillis != null && typeof formatWhen === "function" ? formatWhen(atMillis) : null,
    actorName,
    actorResolved: actorName != null && actorName !== UNKNOWN_ACTOR_DISPLAY_NAME,
    // What EOS holds about the customer: nothing. Stated positively so no caller has to infer it.
    holdsCustomerSignatureEvidence: false,
    statements: accepted
      ? [
          SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.recorded,
          SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.noSignatureEvidence,
          SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.readOnly,
        ]
      : [SALES_AGREEMENT_ACCEPTANCE_STATEMENTS.notRecorded],
  };
}

// ═════════════════════════════════════════ PROVENANCE (SA-D9) AND DOWNSTREAM (SA-D10)

/** Account → Opportunity → **this** → Sales Order. Ids only; names are other reads' to supply. */
export function salesAgreementProvenance(view) {
  if (!isReady(view)) return null;
  return {
    accountId: view.accountId ?? null,
    sourceOpportunityId: view.sourceOpportunityId ?? null,
    salesAgreementNumber: view.salesAgreementNumber ?? null,
    salesOrderId: view.salesOrderId ?? null,
  };
}

/**
 * WHAT THIS AGREEMENT BECAME — and the exact governed trigger, which P1v1 got backwards.
 *
 * The Sales Order is created by the OPPORTUNITY's `closeOpportunityAsWon` (or by
 * `createSalesOrderFromOpportunity` once the outcome is already WON). `assertAgreementConvertible`
 * checks, in refusal order: the agreement exists → its `sourceOpportunityId` matches → its
 * `accountId` matches the Opportunity's → its state is ACCEPTED → it has lines.
 *
 * So acceptance is a PRECONDITION and the close is the TRIGGER, and the close can still refuse.
 * `noOrderSentence` says exactly that and promises no inevitability. There is deliberately no
 * create action here: the order does not come from this record.
 */
export const SALES_AGREEMENT_NO_ORDER_SENTENCE =
  "No Sales Order. One is created when the Opportunity is closed as won, which requires this agreement to be accepted first.";

export function salesAgreementDownstream(view, { salesOrderNumber } = {}) {
  if (!isReady(view)) return null;
  const salesOrderId = view.salesOrderId ?? null;
  return {
    hasOrder: salesOrderId != null,
    salesOrderId,
    salesOrderNumber: text(salesOrderNumber),
    // Not a failure state, and never an invented Create button.
    noOrderSentence: salesOrderId == null ? SALES_AGREEMENT_NO_ORDER_SENTENCE : null,
    acceptanceIsPrecondition: true,
    triggeredByOpportunityClose: true,
  };
}

// ═════════════════════════════════════════ COMMERCIAL TERMS (SA-D6)

/** The real fields only. An absent field is OMITTED — never a dashed placeholder. */
export function salesAgreementTerms(view) {
  if (!isReady(view)) return null;
  const rows = [];
  if (text(view.customerPO)) rows.push({ id: "customerPO", label: "Customer PO", value: text(view.customerPO) });
  rows.push({ id: "isLease", label: "Lease", value: view.isLease === true ? "Lease" : "No — purchase" });
  if (view.fulfillmentIntent) {
    rows.push({
      id: "fulfillmentIntent",
      label: "Fulfillment",
      // The definition's own words. An unrecognised value is dropped rather than leaked as an enum.
      value: FULFILLMENT_LABEL[view.fulfillmentIntent] ?? null,
    });
  }
  if (text(view.shipVia)) rows.push({ id: "shipVia", label: "Ship via", value: text(view.shipVia) });
  if (view.currency) rows.push({ id: "currency", label: "Currency", value: view.currency });
  return {
    rows: rows.filter((r) => r.value != null),
    shippingInstructions: text(view.shippingInstructions),
    specialInstructions: text(view.specialInstructions),
  };
}

// ═════════════════════════════════════════ ACTIONS (SA-D11)

/**
 * TWO COMMANDS, AND THE DISTINCTION THIS FAMILY EXISTS TO PROTECT.
 *
 * The governed commands reachable from this record are exactly `updateSalesAgreementDraft` and
 * `acceptSalesAgreement`. `createSalesAgreement` lives on the Opportunity surface. Nothing else
 * exists — see the deliberately-absent list at the top of this file.
 *
 * STATE and PERMISSION are different restrictions with different consequences, and they never
 * collapse into one message:
 *
 *   present:false, restriction:"state"       the engine forbids it — the control is ABSENT.
 *                                            An accepted agreement offers no edit at all, because a
 *                                            disabled one sends somebody hunting for a permission
 *                                            problem that does not exist.
 *   present:true, available:false,
 *     restriction:"state"                    offerable here, blocked by a condition the user can
 *                                            fix — the unpriced-line case. Carries
 *                                            `agreementAcceptability`'s OWN reason, naming lines.
 *   present:true, available:false,
 *     restriction:"permission"               protected + disabled, with the capability's own
 *                                            sentence from SALES_AGREEMENT_DISABLED_REASON.
 *
 * @param hasCapability fail-closed by default: a caller that injects nothing gets no live control.
 */
export function salesAgreementActions(view, { hasCapability } = {}) {
  if (!isReady(view)) return { edit: null, accept: null };
  const can = (id) => (typeof hasCapability === "function" ? hasCapability(id) === true : false);

  const editable = agreementIsEditable(view);
  const mayEdit = can(SALES_AGREEMENT_UPDATE_DRAFT_CAPABILITY);
  const edit = editable
    ? {
        id: "updateSalesAgreementDraft",
        label: "Edit draft",
        present: true,
        available: mayEdit,
        restriction: mayEdit ? null : "permission",
        reason: mayEdit ? null : SALES_AGREEMENT_DISABLED_REASON.updateDraft,
      }
    : // Terminal: absent, not disabled. The engine forbids editing, and that is a state fact.
      { id: "updateSalesAgreementDraft", label: "Edit draft", present: false, available: false, restriction: "state", reason: null };

  const { canAccept, reason } = agreementAcceptability(view);
  const mayAccept = can(SALES_AGREEMENT_ACCEPT_CAPABILITY);
  const accept = salesAgreementIsTerminal(view)
    ? { id: "acceptSalesAgreement", label: "Record acceptance", present: false, available: false, restriction: "state", reason }
    : {
        id: "acceptSalesAgreement",
        label: "Record acceptance",
        present: true,
        available: canAccept && mayAccept,
        // Permission is named first only when the state itself permits the action: telling somebody
        // they lack permission for something the record could not do anyway is the wrong answer.
        restriction: !canAccept ? "state" : mayAccept ? null : "permission",
        reason: !canAccept ? reason : mayAccept ? null : SALES_AGREEMENT_DISABLED_REASON.accept,
      };

  return { edit, accept };
}
