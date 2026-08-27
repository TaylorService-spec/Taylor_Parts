// THE SEVENTEEN COLLECTION PAGE STATES — the Lists P2 shared contract.
//
// DESIGN AUTHORITY: docs/north-star/lists/Lists-North-Star-P2.dc.html, board 2d.
// RECONCILIATION: docs/north-star/lists/LISTS-P2-RECONCILIATION.md §E item 3.
//
// ════════════════════ WHAT THIS IS, AND WHY IT IS NOT AN ENUM ════════════════════
//
// P2 names seventeen states a collection page can be in and rules that each gets ONE rendering:
// "TRUE EMPTY / EMPTY VIEW / SEARCH ZERO / FILTER ZERO / UNKNOWN / DENIED / UNAVAILABLE are seven
// different facts with seven different sentences and seven different ways out — never one generic
// empty component."
//
// A bare list of seventeen strings would be the ninth instance of this program's defining defect:
// a declaration nothing consumes. So each state here carries the answer to the only two questions
// that make the list useful — WHO RENDERS IT, and CAN IT BE REACHED AT ALL TODAY — and the tests
// in test/listsP2StateContract.test.jsx read both back:
//
//   * every state marked `renderedBy: HONEST_STATE` must resolve to a real HonestState id that
//     HonestState actually renders. A state that names a rendering it does not have fails the build.
//   * every state marked unreachable must NAME the authority it awaits. "Not built yet" is not an
//     acceptable value, because that is how a design illustration becomes a silent backlog.
//
// ════════════════════ SEVENTEEN IS NOT THE SAME AS SEVENTEEN RENDERINGS ════════════════════
//
// POPULATED is the list itself. DEGRADED is a per-cell fallback plus one quiet line. The four
// ACTION_* / SELECTION_MODE states belong to a docked bar over governed bulk transitions, and EOS
// has no governed bulk transition of any kind — P2's own 2k board classifies them as
// authority-dependent. They are declared here so a family can ask "is this state reachable for me?"
// and get a truthful no with a reason, rather than a designer's board being mistaken for a backlog
// of work somebody forgot to do.
//
// ════════════════════ NOT_APPLICABLE IS DELIBERATELY ABSENT ════════════════════
//
// HonestState carries a seventh id, NOT_APPLICABLE ("the fact does not apply to this record"). That
// is a RECORD/FIELD state, not a collection page state, and P2's 2d does not name it. It stays on
// HonestState for its record-page callers and is not one of the seventeen. Conflating the two is
// how a page-state contract quietly becomes a general-purpose state grab bag.

import { HONEST_STATE } from "./HonestState.jsx";

/** Which surface is responsible for putting a state on screen. */
export const RENDERED_BY = Object.freeze({
  /** The shared HonestState resolver, in place of the list body. */
  HONEST_STATE: "HONEST_STATE",
  /** The list body itself — rows, or rows plus a note. */
  LIST_BODY: "LIST_BODY",
  /** Individual cells within otherwise-good rows. */
  ROW: "ROW",
  /** A docked bar beneath a selection. No EOS surface has one. */
  DOCKED_BAR: "DOCKED_BAR",
});

const SURFACES = Object.freeze(Object.values(RENDERED_BY));

/**
 * One state.
 *
 * @param id          STABLE, machine, SCREAMING_SNAKE — quoted in reviews and in family handoffs.
 * @param summary     what the state MEANS. Not the copy; the copy belongs to the family, because
 *                    P2 words every state in the object's own vocabulary ("No work orders yet").
 * @param renderedBy  RENDERED_BY.
 * @param honestState the HONEST_STATE id that renders it, when `renderedBy` is HONEST_STATE.
 * @param reachable   whether any EOS surface can be in this state today.
 * @param awaits      the authority that would make it reachable. REQUIRED when `reachable` is false.
 * @param note        the load-bearing caveat, where one exists.
 */
function state(input) {
  return Object.freeze({
    id: input.id,
    summary: input.summary,
    renderedBy: input.renderedBy,
    honestState: input.honestState ?? null,
    reachable: input.reachable !== false,
    awaits: input.awaits ?? null,
    note: input.note ?? null,
  });
}

export const COLLECTION_PAGE_STATES = Object.freeze([
  state({
    id: "IDLE",
    summary:
      "Required identity or context is not ready and the read has not begun. The page states nothing — a spinner here would be a claim about a request that does not exist.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.IDLE,
  }),
  state({
    id: "LOADING",
    summary: "A read is in flight. Skeleton or a polite line inside the intact shell; never a lone spinner.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.LOADING,
  }),
  state({
    id: "POPULATED",
    summary: "The anatomy: rows, result context, and the footer the read's data shape justifies.",
    renderedBy: RENDERED_BY.LIST_BODY,
    note: "Not a HonestState rendering — this state IS the list.",
  }),
  state({
    id: "TRUE_EMPTY",
    summary:
      "The read succeeded and the collection genuinely holds nothing. Purpose sentence, and Create only where the write seam permits it.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.EMPTY,
  }),
  state({
    id: "EMPTY_VIEW",
    summary:
      "Records exist; this view's own slice is empty. Carries the view's sentence and a way to a view that is not.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.EMPTY_VIEW,
  }),
  state({
    id: "SEARCH_ZERO",
    summary:
      "A search matched nothing. The query is echoed, the scope that was searched is stated, and Clear search is offered. No create CTA.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.SEARCH_ZERO,
  }),
  state({
    id: "FILTER_ZERO",
    summary:
      "Filters narrowed the view to none. The tokens stay on screen so the cause is visible, and the sentence says how many rows are being narrowed away.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.FILTER_ZERO,
  }),
  state({
    id: "UNKNOWN",
    summary:
      "A derivation the view depends on cannot be resolved — the viewer's identity, most often. The view says so and renders NO count. Unknown is not zero.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.UNKNOWN,
  }),
  state({
    id: "NOT_ENABLED",
    summary:
      "The feature or read is not switched on. One sentence, once — and the column or section it would feed is OMITTED rather than rendered as dead cells.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.NOT_ENABLED,
  }),
  state({
    id: "DENIED",
    summary:
      "A permission fact, never a data fact. No counts, no views, no create — nothing leaks about what exists.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.DENIED,
  }),
  state({
    id: "UNAVAILABLE",
    summary:
      "The read failed. The reason the read layer produced survives verbatim, plus the reassurance that other work is unaffected. No raw backend text.",
    renderedBy: RENDERED_BY.HONEST_STATE,
    honestState: HONEST_STATE.UNAVAILABLE,
  }),
  state({
    id: "DEGRADED",
    summary:
      "The list renders; a secondary fact failed. The failed cell says so in its own place, with one quiet line above the table. Never the document id as a fallback label.",
    renderedBy: RENDERED_BY.ROW,
    note:
      "The per-cell half is referenceResolution.js's REFERENCE_STATE vocabulary, already live. HonestState.DEGRADED renders only the quiet line above the table.",
  }),
  state({
    id: "OFFLINE_STALE",
    summary: "Retained data is being shown because the device is offline. Only where retained data genuinely exists.",
    renderedBy: RENDERED_BY.LIST_BODY,
    note:
      "Reachable ONLY inside the handheld runtime's sync queue (hooks/useOfflineRuntime.js). P2: 'never claimed elsewhere' — a desktop list has no retained data to show, so it must not offer this sentence.",
  }),
  state({
    id: "SELECTION_MODE",
    summary: "Rows are selected and a docked bar offers the governed actions valid for that selection.",
    renderedBy: RENDERED_BY.DOCKED_BAR,
    reachable: false,
    awaits:
      "A governed bulk transition — a command that accepts many records and reports per record. EOS has none; every governed transition today is single-record.",
    note: "P2 2k: 'no selection UI where no governed bulk action exists — no fake Assign/Delete/Export'.",
  }),
  state({
    id: "ACTION_IN_PROGRESS",
    summary: "A bulk action is running: the bar shows progress, controls disable, and no modal blocks the page.",
    renderedBy: RENDERED_BY.DOCKED_BAR,
    reachable: false,
    awaits: "The same governed bulk transition SELECTION_MODE awaits.",
  }),
  state({
    id: "ACTION_FAILURE",
    summary: "A bulk action partly failed. Failed rows stay marked, Retry failed is offered, and success is never implied.",
    renderedBy: RENDERED_BY.DOCKED_BAR,
    reachable: false,
    awaits: "A governed bulk transition that reports PER RECORD — a whole-batch pass/fail cannot render this state honestly.",
  }),
  state({
    id: "ACTION_SUCCESS",
    summary: "A bulk action succeeded. One quiet line; the updated row state is the real confirmation.",
    renderedBy: RENDERED_BY.DOCKED_BAR,
    reachable: false,
    awaits: "The same governed bulk transition SELECTION_MODE awaits.",
  }),
]);

/** The seventeen ids, in board order. */
export const COLLECTION_PAGE_STATE_IDS = Object.freeze(COLLECTION_PAGE_STATES.map((s) => s.id));

/** One state by id, or null. Never throws — callers ask about ids that may not exist. */
export function findCollectionPageState(id) {
  return COLLECTION_PAGE_STATES.find((s) => s.id === id) ?? null;
}

/** Every state a given surface is responsible for rendering. */
export function statesRenderedBy(surface) {
  return Object.freeze(COLLECTION_PAGE_STATES.filter((s) => s.renderedBy === surface));
}

/**
 * The states no EOS surface can reach, each with the authority it awaits.
 *
 * This is the list a family handoff quotes when it says "these five of the seventeen are not
 * reachable here" — so the absence is a stated fact rather than an omission somebody has to notice.
 */
export function unreachableStates() {
  return Object.freeze(COLLECTION_PAGE_STATES.filter((s) => !s.reachable));
}

/** Validate the contract. Returns problem strings; empty means valid. */
export function validateCollectionPageStates(states = COLLECTION_PAGE_STATES) {
  const problems = [];
  const seen = new Set();

  for (const s of states) {
    const at = s?.id ? `state ${s.id}` : "state (no id)";

    if (!s?.id || typeof s.id !== "string") {
      problems.push(`${at}: id is required and must be a string`);
    } else if (!/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(s.id)) {
      problems.push(`${at}: id must be SCREAMING_SNAKE_CASE so it can be quoted in a handoff verbatim`);
    } else if (seen.has(s.id)) {
      problems.push(`${at}: duplicate id`);
    } else {
      seen.add(s.id);
    }

    if (!s?.summary || typeof s.summary !== "string") problems.push(`${at}: summary is required`);
    if (s?.id && s.id === s.summary) problems.push(`${at}: id and summary must be distinct`);

    if (!SURFACES.includes(s?.renderedBy)) {
      problems.push(`${at}: renderedBy must be one of ${SURFACES.join(", ")}`);
    }

    // A state that claims HonestState renders it must NAME the id. Without this, "HonestState does
    // it" becomes an untested assertion and the rendering can go missing silently.
    if (s?.renderedBy === RENDERED_BY.HONEST_STATE && !s?.honestState) {
      problems.push(`${at}: renderedBy HONEST_STATE requires a honestState id`);
    }
    if (s?.renderedBy !== RENDERED_BY.HONEST_STATE && s?.honestState) {
      problems.push(`${at}: honestState is set but ${s.renderedBy} renders this state, not HonestState`);
    }

    // THE LOAD-BEARING RULE. An unreachable state without a named authority is a design
    // illustration masquerading as a backlog item.
    if (s?.reachable === false && !s?.awaits) {
      problems.push(`${at}: an unreachable state must name the authority it awaits`);
    }
    if (s?.reachable !== false && s?.awaits) {
      problems.push(`${at}: a reachable state must not claim to await an authority`);
    }
  }

  return problems;
}
