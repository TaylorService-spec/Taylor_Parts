import {
  OPPORTUNITY_STAGES,
  STAGE_LABEL,
  OUTCOME_LABEL,
  CHANNEL_LABEL,
  stageProgress,
  allowedActions,
  deriveAttention,
} from "./opportunityLifecycle.js";

// THE OPPORTUNITY RECORD PAGE, DERIVED ONCE — North Star P1v2.
//
// Visual authority: `North Star - Opportunity P1v2.dc.html` (design_handoff_opportunity).
// Behavioral authority: this repository. Acceptance: the running sandbox + the Owner.
//
// ════════════════════ THIS FILE ADDS NO VOCABULARY ════════════════════
//
// Stage words, channel words, outcome words, transition legality and attention reasons ALL come
// from `opportunityLifecycle.js`, which the pipeline already consumes. Nothing here re-derives any
// of them. That is the entire point: if the record page computed "which stage is current" itself,
// it and the pipeline row would be free to disagree about one deal.
//
// What this file DOES own is the P1v2 presentation of those facts — the header fact row, the
// attention strip's wording, days-open/days-to-close, and the honest rendering of a value that has
// no currency. Presentation only. No read, no write, no clock (`nowMillis` is injected).
//
// ════════════════════ WHAT IS DELIBERATELY ABSENT ════════════════════
//
// NO PROBABILITY, NO WEIGHTED VALUE, NO FORECAST, NO QUOTE. `expectedValue` is a plain number the
// salesperson typed, with no currency field beside it and no stage-probability anywhere in the
// engine. "Quoting" is a STAGE of this lifecycle, not a document — EOS has no quote object, so the
// page shows no quote list and fakes no quote card. The design's do-not-invent list is explicit on
// all of it.

export const OPPORTUNITY_STAGE_LABEL = STAGE_LABEL;

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * STATE IN WORDS (R04). The composition never prints `CUSTOMER_REVIEW`.
 *
 * A closed Opportunity reads by OUTCOME and an open one by STAGE — the reading `commercialState()`
 * already applies to every pipeline row. Returns null on a value neither vocabulary recognises, so
 * an unplaceable state is reported as unplaceable rather than echoed back as though it were a word.
 */
export function opportunityStateWords(opportunity) {
  const outcome = opportunity?.outcome ?? null;
  if (outcome) return OUTCOME_LABEL[outcome] ?? null;
  const stage = opportunity?.stage ?? null;
  return stage ? (STAGE_LABEL[stage] ?? null) : null;
}

/**
 * STATE AS A SENTENCE — P1v2 writes the header state as a clause, not a label.
 *
 * The artifact reads "Decision — awaiting customer decision". Every clause is DERIVED FROM THE
 * ENGINE'S OWN GUARDS rather than written as copy:
 *
 *   DECISION           — `allowedActions` offers WON and LOST here and only here; the deal is
 *                        waiting on the customer, which is what the stage means.
 *   open, not DECISION — `allowedActions` offers exactly one forward stage, so the clause names
 *                        the stage the record can actually reach next. Nothing else is legal.
 *   WON / LOST         — terminal. A closed deal waits on nothing, and padding it into a clause
 *                        for symmetry would be writing prose rather than stating fact.
 */
export function opportunityStateSentence(opportunity) {
  const words = opportunityStateWords(opportunity);
  if (!words) return null;
  if (opportunity?.outcome) return words;
  if (opportunity?.stage === "DECISION") return `${words} — awaiting customer decision`;
  const { advanceTo } = allowedActions(opportunity);
  if (advanceTo) return `${words} — next stage ${STAGE_LABEL[advanceTo] ?? advanceTo}`;
  return words;
}

/** Tone, so colour and word always agree. Never colour alone (R04). */
export function opportunityStateTone(opportunity) {
  if (opportunity?.outcome === "WON") return "positive";
  if (opportunity?.outcome === "LOST") return "negative";
  if (opportunity?.stage === "DECISION") return "attention";
  return "info";
}

/**
 * THE LIFECYCLE SPINE — and this family legally gets CHEVRONS.
 *
 * A pass-through to `stageProgress`, deliberately. It already returns the exact shape
 * `LifecycleChevrons` consumes, because the pipeline row was built against it first. Adding a
 * second Opportunity-specific progression here would create precisely the drift the grammar
 * forbids: two answers to "where is this deal".
 *
 * The Account family draws no spine because its four statuses are an editable field with no
 * transition command (ND-11). An Opportunity has six governed stages, a legality graph and a
 * transition command, so the chevrons assert a rule the engine actually holds.
 *
 * `unrecognised` is a REPORT rather than a rule: a stage the vocabulary cannot place must be
 * visible as unplaceable, not silently drawn as step one.
 */
export function opportunitySpine(opportunity) {
  const { stages, terminal } = stageProgress(opportunity);
  const stage = opportunity?.stage ?? null;
  const reachedIndex = OPPORTUNITY_STAGES.indexOf(stage);
  return {
    steps: stages,
    terminal,
    unrecognised: stage != null && reachedIndex < 0,
    // P1v2 mobile renders the chevron row as words — "stage 6 of 6". Derived here so the phone
    // and desktop compositions cannot disagree about which stage that is.
    positionWords: reachedIndex >= 0 ? `stage ${reachedIndex + 1} of ${OPPORTUNITY_STAGES.length}` : null,
    isLastStage: reachedIndex === OPPORTUNITY_STAGES.length - 1,
  };
}

// ═════════════════════════════════════════ TIME, DERIVED FROM WHAT IS STORED

/**
 * How long this deal has been open — P1v2's "open 47 days" in the header.
 *
 * From `createdAtMillis`, which the record genuinely stores. Null when the creation time is
 * absent, and the header simply omits the phrase rather than printing "open 0 days", which would
 * read as a deal created today.
 */
export function opportunityDaysOpen(opportunity, nowMillis) {
  const created = num(opportunity?.createdAtMillis);
  const now = num(nowMillis);
  if (created == null || now == null) return null;
  return Math.max(0, Math.floor((now - created) / DAY_MS));
}

/**
 * Days until the expected close — negative once it has passed.
 *
 * Only ever used to WORD an attention reason the domain already raised; it never decides whether
 * the reason fires. `deriveAttention` owns that.
 */
export function opportunityDaysToClose(opportunity, nowMillis) {
  const close = num(opportunity?.expectedCloseAt);
  const now = num(nowMillis);
  if (close == null || now == null) return null;
  return Math.round((close - now) / DAY_MS);
}

// ═════════════════════════════════════════ THE ATTENTION STRIP (P1v2)

/**
 * THE ATTENTION STRIP — `deriveAttention` VERBATIM, worded for this page.
 *
 * ════════════════════ IT DOES NOT DECIDE, IT ONLY WORDS ════════════════════
 *
 * `deriveAttention` in opportunityLifecycle.js is the existing authority on what needs attention on
 * an Opportunity, and the pipeline already sorts by it. This function consumes ALL FOUR of its
 * reasons and re-words them in the artifact's own voice. It never adds a reason, never suppresses
 * one, and never recomputes "overdue" — a second derivation is how two screens come to disagree.
 *
 * P1v2 calls this out as presentation of an existing derivation, NOT a recommendation engine, and
 * the page must not label it as one. deriveAttention's four reasons are the entire "next best
 * action" vocabulary this product has.
 *
 * ════════════════════ A REVERSAL, RECORDED ════════════════════
 *
 * An earlier build of this page dropped DECISION_PENDING here, on the NS-P4 argument that the
 * header sentence already says "awaiting customer decision". P1v2 keeps both: the header states
 * WHERE the deal is, the strip states WHAT IS OWED, and the artifact shows them together. Under the
 * three-authority model a conflict that changes only how an already-permitted fact is drawn is
 * Design's to decide, so the design is followed and the earlier call reversed.
 *
 * `nextAction` rides along because the strip is where P1v2 states it — the stored text when there
 * is one, and the absence when there is not, which is itself the NO_NEXT_ACTION reason.
 */
export function opportunityAttentionStrip(opportunity, nowMillis) {
  if (!opportunity) return { present: false, reasons: [], nextAction: null };

  const toClose = opportunityDaysToClose(opportunity, nowMillis);
  const days = (n) => `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`;

  // The KINDS are the domain's; only the wording is this page's.
  const WORDS = {
    DECISION_PENDING: () => "Awaiting customer decision",
    NO_NEXT_ACTION: () => "No next action on file",
    CLOSE_OVERDUE: () => (toClose == null ? "Expected close has passed" : `expected close was ${days(toClose)} ago`),
    CLOSE_SOON: () => (toClose == null ? "Closing soon" : `expected close is in ${days(toClose)}`),
  };

  const derived = deriveAttention(opportunity, nowMillis);
  const reasons = derived.map((r) => ({
    kind: r.kind,
    tone: r.tone,
    // An unmapped kind still renders, using the domain's own label, so a reason added upstream can
    // never silently vanish from this strip.
    text: WORDS[r.kind] ? WORDS[r.kind]() : r.label,
  }));

  // P1v2 leads the strip with the decision/no-next-action reason and trails with the timing one,
  // which is how the artifact reads: "Awaiting customer decision · expected close is in 9 days."
  const RANK = { DECISION_PENDING: 0, NO_NEXT_ACTION: 1, CLOSE_OVERDUE: 2, CLOSE_SOON: 3 };
  reasons.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));

  const nextAction = typeof opportunity.nextAction === "string" && opportunity.nextAction.trim()
    ? opportunity.nextAction.trim()
    : null;

  return { present: reasons.length > 0, reasons, nextAction };
}

// ═════════════════════════════════════════ THE HEADER (P1v2 identity)

/**
 * The single header derivation — everything the P1v2 identity block states, in one object.
 *
 * Assembled here rather than in the component so that "the state" is one value used by the header,
 * the chevrons and the attention strip, and cannot drift between them.
 *
 * THE KICKER carries the channel: the artifact reads `Opportunity · National Accounts`. An
 * unrecognised channel degrades to the bare object type rather than leaking the stored enum.
 *
 * THE TITLE is the governed reference. A record written before numbering existed renders
 * "Opportunity — not numbered", which is the artifact's own words, and NEVER the document id
 * (DECISIONS #106) — the id is not even carried on this object.
 *
 * THE SUBTITLE is `need`, the nearest thing to a human name this entity has. Omitted entirely when
 * absent; never fabricated, and never replaced by something else standing in for it.
 */
export function opportunityHeader(opportunity) {
  if (!opportunity) return null;
  const channelWords = opportunity.salesChannel ? (CHANNEL_LABEL[opportunity.salesChannel] ?? null) : null;
  return {
    kicker: channelWords ? `Opportunity · ${channelWords}` : "Opportunity",
    channelWords,
    reference: opportunity.opportunityNumber ?? null,
    title: opportunity.opportunityNumber ?? "Opportunity — not numbered",
    subtitle: typeof opportunity.need === "string" && opportunity.need.trim() ? opportunity.need.trim() : null,
    stateWords: opportunityStateWords(opportunity),
    stateSentence: opportunityStateSentence(opportunity),
    stateTone: opportunityStateTone(opportunity),
    isClosed: opportunity.outcome === "WON" || opportunity.outcome === "LOST",
    isWon: opportunity.outcome === "WON",
  };
}

/**
 * THE EXPECTED VALUE — a number with no currency, said as such (decision O1).
 *
 * `expectedValue` is stored as a plain number and the document has NO currency field. P1v2 renders
 * it as a bare grouped figure followed by "(no currency recorded)", and a "$" appears only when the
 * data justifies one — which on this record it never does. The Sales Agreement card is the
 * exception on this page, and only because the agreement genuinely stores a currency.
 *
 * NULL IS NOT ZERO. An opportunity with no expected value shows no number at all: a zero would read
 * as a worthless deal rather than an unestimated one.
 *
 * @param formatNumber injected group-formatter, so this file holds no locale knowledge
 */
export const NO_CURRENCY_NOTE = "(no currency recorded)";
export const NO_CURRENCY_TITLE =
  "expectedValue is stored as a plain number with no currency field — a symbol the data does not justify is never rendered.";

export function opportunityValueDisplay(opportunity, formatNumber) {
  const value = num(opportunity?.expectedValue);
  if (value == null) {
    return { amount: null, note: null, title: "No expected value has been recorded for this opportunity." };
  }
  return {
    amount: typeof formatNumber === "function" ? formatNumber(value) : String(value),
    note: NO_CURRENCY_NOTE,
    title: NO_CURRENCY_TITLE,
  };
}

// ═════════════════════════════════════════ THE GOVERNED CONVERSION ("When this closes")

/**
 * The two real commercial paths, stated as fact rather than as a workflow this page enforces.
 *
 * REPOSITORY TRUTH, and P1v2 decision O6 records it as such:
 *   • `closeOpportunityAsWon` creates a Sales Order atomically from the opportunity's own lines.
 *   • `agreementToSalesOrder` creates a PRICED Sales Order from an accepted agreement's lines.
 *   • An agreement is NOT a prerequisite for Won, and nothing enforces a sequence.
 *
 * This returns which chain TRULY exists for this record so the page can state it without implying
 * the other. It converges nothing: normalising the two paths is an open product decision, and a
 * page that described them as one would be pre-deciding it.
 *
 * @param agreementView the READY-or-not view from `salesAgreementView`, or null when not read
 */
export function opportunityConversion(opportunity, agreementView) {
  const salesOrderId = opportunity?.salesOrderId ?? null;
  const agreementReady = agreementView?.kind === "READY";
  const agreementAccepted = agreementReady && agreementView.state === "ACCEPTED";
  const agreementOrderId = agreementReady ? (agreementView.salesOrderId ?? null) : null;
  return {
    hasOrder: salesOrderId != null,
    salesOrderId,
    salesOrderNumber: opportunity?.salesOrderNumber ?? null,
    hasAgreement: agreementReady,
    agreementAccepted,
    // The agreement's own order, which may exist independently of the opportunity's back-link.
    agreementOrderId,
    isClosed: opportunity?.outcome === "WON" || opportunity?.outcome === "LOST",
    isWon: opportunity?.outcome === "WON",
  };
}
