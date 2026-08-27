import { SALES_AGREEMENT_VIEW_STATE } from "./salesAgreementView.js";

// THE SALES AGREEMENT READ SEAM, DECIDED IN PURE CODE.
//
// PR 2 of the Sales Agreement North Star implementation
// (docs/implementation-plans/sales-agreement-north-star.md).
//
// ════════════════════ WHY THE DECISIONS LIVE HERE AND NOT IN THE HOOK ════════════════════
//
// `useSalesAgreement` reads BY OPPORTUNITY. A routed record page arrives holding a Sales Agreement
// id instead, and `getSalesAgreementContext` — the governed by-id callable — already exists and is
// already wired in `services/salesAgreementCommandClient.js`. Nothing new is needed on the server.
//
// What IS needed is that both reads make the same decisions: do not ask when the feature is not
// enabled, do not ask without an identity, and never collapse denied / unavailable / absent. Those
// decisions were embedded in a React callback, where node cannot reach them. They are stated here
// instead, matching this codebase's "pure logic lives in domain/" pattern (see actorDisplayName.js,
// extracted for exactly this reason).
//
// This module performs NO read. It decides whether one should happen and what an answer means.
// There is no Firestore import here and none in the hook above it: the callable is the only path.

/** The feature is not live in this environment, so nothing was asked. Not a permission answer. */
export const SALES_AGREEMENT_READ_NOT_ENABLED = "not-enabled";

/**
 * Which question produced a view. It changes what ABSENCE means, and nothing else.
 *
 * `SALES_AGREEMENT_VIEW_STATE.NONE` is documented as "no agreement exists for this Opportunity yet
 * — the answer that decides between offering CREATE and offering VIEW". That reading is correct for
 * a by-opportunity read and WRONG for a by-id one: an id that resolves to nothing is a bad address,
 * and offering to create an agreement there would be offering to create it from nowhere.
 *
 * Same view state, two different facts. The read mode is what tells them apart.
 */
export const SALES_AGREEMENT_READ_MODE = Object.freeze({
  BY_ID: "BY_ID",
  BY_OPPORTUNITY: "BY_OPPORTUNITY",
});

/** What an absent record MEANS, given how it was asked for. Null when the record is present. */
export const SALES_AGREEMENT_ABSENCE = Object.freeze({
  /** Asked by id; nothing is there. A bad address — never an invitation to create. */
  NOT_FOUND: "NOT_FOUND",
  /** Asked by opportunity; none drafted yet. Ordinary, common, and where CREATE belongs. */
  NONE_YET: "NONE_YET",
});

const identity = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Should a read be attempted, and if not, what does the screen show instead?
 *
 * DO NOT ASK FOR WHAT THIS CALLER MAY NOT HAVE — the rule `useSalesAgreement.refresh` already
 * follows, stated once so both reads follow it identically. Where the Sales Agreement layer is not
 * enabled, firing the request anyway produces a doomed round trip per selection, and an undeployed
 * callable answers 404 WITHOUT CORS headers, so the browser reports a CORS failure about a feature
 * that is simply not deployed. That console noise is not harmless: it is the first thing anyone
 * looks at when something else goes wrong.
 *
 * NO IDENTITY IS IDLE, NOT AN ERROR. A page still resolving its route parameter has not failed;
 * `errorStatus: null` with `shouldRead: false` is "nothing to ask about yet".
 *
 * `enabled` defaults to true, matching `useSalesAgreement`'s own signature, and anything that is
 * not exactly `true` disables the read — a truthy string is not an opt-in. The default is about
 * console noise rather than authority: the callable itself enforces `salesAgreement.read`, so a
 * read attempted here is refused there, and the two hooks agreeing on the default matters more than
 * a stricter one would gain.
 */
export function planSalesAgreementRead({ salesAgreementId, enabled = true } = {}) {
  if (enabled !== true) {
    return { shouldRead: false, errorStatus: SALES_AGREEMENT_READ_NOT_ENABLED, salesAgreementId: null };
  }
  const id = identity(salesAgreementId);
  if (!id) return { shouldRead: false, errorStatus: null, salesAgreementId: null };
  return { shouldRead: true, errorStatus: null, salesAgreementId: id };
}

/**
 * Turn one transport answer into the two values `salesAgreementView` consumes.
 *
 * The transport never throws and never interprets: `salesAgreementCommandClient` returns either
 * `{ result }` or `{ errorStatus }`, where errorStatus is the callable's own HttpsError code with
 * the `functions/` prefix stripped. This function does not rename those codes, because the view
 * model maps them itself — "permission-denied" to DENIED, anything else to UNAVAILABLE — and a
 * second mapping is how a denial comes to be reported as an outage.
 */
export function interpretSalesAgreementReadResponse(response) {
  if (response?.errorStatus) return { result: null, errorStatus: response.errorStatus };
  return { result: response?.result ?? null, errorStatus: null };
}

/**
 * What this view's absence means — or null when a record is present.
 *
 * Deliberately returns null for every non-NONE state, including DENIED and UNAVAILABLE: those are
 * answers about the ASKING, not about whether a record exists, and reporting "not found" for a read
 * that failed would tell somebody their agreement was gone when the network was down.
 */
export function salesAgreementAbsence(view, readMode) {
  if (view?.kind !== SALES_AGREEMENT_VIEW_STATE.NONE) return null;
  return readMode === SALES_AGREEMENT_READ_MODE.BY_ID
    ? SALES_AGREEMENT_ABSENCE.NOT_FOUND
    : SALES_AGREEMENT_ABSENCE.NONE_YET;
}

/** The one sentence each absence earns. Wording lives with the fact, not in a component. */
export const SALES_AGREEMENT_ABSENCE_SENTENCE = Object.freeze({
  [SALES_AGREEMENT_ABSENCE.NOT_FOUND]: "No sales agreement matches this address.",
  [SALES_AGREEMENT_ABSENCE.NONE_YET]: "No sales agreement yet.",
});
