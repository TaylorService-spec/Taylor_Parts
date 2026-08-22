// REFERENCE RESOLUTION STATES — why a reference could not be shown, kept distinct.
//
// ============================ THE DEFECT THIS COMES FROM ============================
//
// Every row of the Sales Orders list rendered "Unresolved reference" under Customer. The data was
// perfect: all 14 Sales Orders carried a valid `accountId` resolving to a real customer. The list
// runtime simply never received a resolver, and `cellValue` correctly refused to print a raw
// document id -- so it printed the only honest thing it had.
//
// The uniformity was the tell. A dangling reference is sporadic; missing plumbing is total.
//
// ============================ WHY STATES, NOT ONE LABEL ============================
//
// "Unresolved reference" is honest but uninformative, and it collapses situations that mean
// opposite things. The system usually KNOWS which one it is:
//
//   NOT_FOUND  the referenced record does not exist -- a real data gap worth investigating
//   DENIED     it exists, but this viewer may not read it -- not a data gap at all
//   LOADING    the resolver has not answered yet -- nothing is wrong
//   ERROR      resolution failed -- transient, and a retry may fix it
//
// Collapsing DENIED into NOT_FOUND is the one that matters most: it would tell an operator their
// data is broken when the truth is that their ROLE is narrow. It also runs the other way -- a
// screen that says "no longer exists" for a record the viewer merely cannot see has leaked a
// conclusion about data it was not allowed to observe.
//
// DENIED MUST NOT LEAK. Its label never includes the referenced entity's name or id, because the
// whole point is that this viewer is not entitled to them.
//
// ============================ WHY NOT REUSE CUSTOMER_IDENTITY ============================
//
// `domain/fieldCurrentJob.js` already models RESOLVED / NOT_AUTHORIZED / ABSENT / UNRESOLVED, and
// it is the right model where it lives -- but it is about a CUSTOMER on a WORK ORDER, and its copy
// says so ("No customer on this Work Order"). This layer resolves any reference on any of the 27
// definitions that declare one: partId, locationId, ownerEmployeeId, homeWarehouseId. Reusing a
// customer-shaped vocabulary for a warehouse reference would produce wrong words, and widening that
// enum until it fits everything would take the specific copy away from the surface that needs it.
//
// Same idea, different subject, deliberately separate.

/** How a reference resolution turned out. */
export const REFERENCE_STATE = Object.freeze({
  /** Resolved to a human-readable label. */
  FOUND: "FOUND",
  /** The referenced record does not exist. A data gap. */
  NOT_FOUND: "NOT_FOUND",
  /** It exists, but this viewer may not read it. NOT a data gap, and the label must not leak. */
  DENIED: "DENIED",
  /** Resolution is still in flight. Nothing is wrong yet. */
  LOADING: "LOADING",
  /** The resolver ran and failed. Transient; a retry may succeed. */
  ERROR: "ERROR",
  /** The stored reference is in a shape the current compatibility layer cannot interpret. */
  LEGACY_UNSUPPORTED: "LEGACY_UNSUPPORTED",
  /** A resolver ran but produced no answer, and did not say why. The honest fallback. */
  UNRESOLVED: "UNRESOLVED",
});

/**
 * Business-language display for each state.
 *
 * Plain words, no jargon, and no internal state names in front of a user. None of these strings
 * includes an id: a document id is a routing key, not content, and printing one is the defect this
 * whole path exists to avoid.
 */
export const REFERENCE_STATE_LABEL = Object.freeze({
  [REFERENCE_STATE.NOT_FOUND]: "No longer exists",
  // Deliberately says nothing about WHAT is not available.
  [REFERENCE_STATE.DENIED]: "Not available to your role",
  [REFERENCE_STATE.LOADING]: "Loading…",
  [REFERENCE_STATE.ERROR]: "Could not be loaded",
  [REFERENCE_STATE.LEGACY_UNSUPPORTED]: "Unrecognized reference",
  [REFERENCE_STATE.UNRESOLVED]: "Unresolved reference",
});

/** The label a bare `UNRESOLVED` renders as. Exported for callers that assert on it. */
export const UNRESOLVED_REFERENCE_LABEL = REFERENCE_STATE_LABEL[REFERENCE_STATE.UNRESOLVED];

/**
 * Normalize whatever a resolver returned into a state.
 *
 * BACKWARD COMPATIBLE ON PURPOSE. Resolvers predating this module return a plain string for a hit
 * and null/undefined for a miss -- `CustomerEquipment.jsx` is one, and it was the only screen
 * resolving references correctly, so breaking it to introduce a richer contract would trade a fix
 * for a regression. Those returns keep their exact previous meaning:
 *
 *   "Harbor Grill"  -> FOUND
 *   null/undefined  -> UNRESOLVED  ("could not be shown honestly")
 *   ""              -> UNRESOLVED  (an empty name is not a name)
 *
 * A resolver that knows more returns `{ state, label? }` and gets the specific state instead.
 */
export function normalizeReferenceResult(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed
      ? { state: REFERENCE_STATE.FOUND, label: trimmed }
      : { state: REFERENCE_STATE.UNRESOLVED, label: REFERENCE_STATE_LABEL[REFERENCE_STATE.UNRESOLVED] };
  }

  if (value && typeof value === "object" && typeof value.state === "string") {
    const state = REFERENCE_STATE[value.state] ? value.state : REFERENCE_STATE.UNRESOLVED;
    if (state === REFERENCE_STATE.FOUND) {
      const label = typeof value.label === "string" ? value.label.trim() : "";
      // FOUND with nothing to show is not FOUND. Trusting the state over the payload would render
      // a blank cell and call it a resolved reference.
      return label
        ? { state: REFERENCE_STATE.FOUND, label }
        : { state: REFERENCE_STATE.UNRESOLVED, label: REFERENCE_STATE_LABEL[REFERENCE_STATE.UNRESOLVED] };
    }
    // Every non-FOUND state takes the canonical label. A caller cannot substitute its own text for
    // DENIED and accidentally leak the name the state exists to withhold.
    return { state, label: REFERENCE_STATE_LABEL[state] };
  }

  return { state: REFERENCE_STATE.UNRESOLVED, label: REFERENCE_STATE_LABEL[REFERENCE_STATE.UNRESOLVED] };
}

/** True when the resolution produced a real, showable label. */
export function isResolved(result) {
  return result?.state === REFERENCE_STATE.FOUND && Boolean(result.label);
}
