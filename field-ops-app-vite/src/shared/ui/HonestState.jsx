import LoadingState from "./LoadingState.jsx";
import FailureState from "./FailureState.jsx";
import EmptyState from "./EmptyState.jsx";

// ONE VOCABULARY FOR THE SIX HONEST STATES (North Star pattern 7).
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// The pilot's third systemic weakness: "Fail-closed became fail-blank — inactive capability flags
// erase whole sections (Account) or lock every control (Opportunity), so honest security reads as a
// broken product."
//
// EOS distinguishes these situations in CODE better than most commercial ERPs. What it does not do
// is SAY them. A denial that renders as an empty region tells an operator their data is missing when
// their permission is, and sends them to look for a data problem that does not exist.
//
// ════════════════════ WHY A RESOLVER, NOT A NEW COMPONENT ════════════════════
//
// LoadingState, FailureState and EmptyState already exist and are already used across the product.
// Duplicating them under North Star names would be exactly the "don't duplicate an existing
// primitive merely to give it a North Star name" mistake. This composes them, and adds only the two
// renderings the vocabulary was genuinely missing: CAPABILITY NOT ENABLED and NOT APPLICABLE.
//
// ════════════════════ THE STATES ARE NOT INTERCHANGEABLE ════════════════════
//
//   IDLE           the read has not begun because the identity or context it needs is not ready.
//                  Distinct from LOADING: there is no request to be polite about yet.
//   LOADING        a read is in flight. "Nothing yet" is not "nothing".
//   EMPTY          the read succeeded and there is genuinely nothing.
//   NO_MATCHES     things exist; these filters exclude them. Offers a way back.
//   EMPTY_VIEW     records exist; THIS VIEW's slice is empty. A different fact from NO_MATCHES.
//   SEARCH_ZERO    a search matched nothing. Echoes the query and states what was searched.
//   FILTER_ZERO    filters narrowed the view to none, and says how many rows they are eating.
//   UNKNOWN        a derivation this view depends on cannot be resolved. Renders no count, ever.
//   DENIED         your role does not include this. A permission fact, not a data fact.
//   NOT_ENABLED    the capability is not switched on for this workspace. One sentence, once —
//                  "never a page of padlocks".
//   UNAVAILABLE    the read failed. Says your other work is unaffected, because a failed panel
//                  should not read as a failed application.
//   DEGRADED       the rows are fine; a secondary fact failed. One quiet line above the table.
//   NOT_APPLICABLE the fact does not apply to this record. Distinct from absent.
//
// ════════════════════ THE SIX ADDED BY LISTS P2 ════════════════════
//
// IDLE, EMPTY_VIEW, SEARCH_ZERO, FILTER_ZERO, UNKNOWN and DEGRADED come from the Lists P2 page-state
// board (docs/north-star/lists/, board 2d), whose rule is that "TRUE EMPTY / EMPTY VIEW / SEARCH
// ZERO / FILTER ZERO / UNKNOWN / DENIED / UNAVAILABLE are seven different facts with seven different
// sentences and seven different ways out — never one generic empty component."
//
// NO_MATCHES IS THE GENERIC P2 SPLITS, AND IT STAYS. Two surfaces render it today. Removing it here
// would be a breaking change dressed as a vocabulary improvement, and the three specific states are
// only better where the CALLER genuinely knows which of the three it is in — a caller that cannot
// tell a filtered empty from an empty view should keep saying the less specific true thing. Each
// family picks the specific state as it migrates; src/shared/ui/collectionPageState.js records which
// of the seventeen each id serves.
export const HONEST_STATE = Object.freeze({
  IDLE: "IDLE",
  LOADING: "LOADING",
  EMPTY: "EMPTY",
  NO_MATCHES: "NO_MATCHES",
  EMPTY_VIEW: "EMPTY_VIEW",
  SEARCH_ZERO: "SEARCH_ZERO",
  FILTER_ZERO: "FILTER_ZERO",
  UNKNOWN: "UNKNOWN",
  DENIED: "DENIED",
  NOT_ENABLED: "NOT_ENABLED",
  UNAVAILABLE: "UNAVAILABLE",
  DEGRADED: "DEGRADED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

/**
 * @param query        SEARCH_ZERO — the term to echo back, so the reader sees what was actually run.
 * @param scope        SEARCH_ZERO — what the search reached ("the loaded view", "work order numbers
 *                     beginning with this"). P2 §7: the placeholder and this sentence must both name
 *                     the REAL scope, because a search that quietly covers less than it appears to is
 *                     how somebody concludes a record does not exist.
 * @param narrowedFrom FILTER_ZERO — how many rows the filters are narrowing to none. A number here is
 *                     what makes the filter, rather than the data, legible as the cause.
 */
export default function HonestState({
  state,
  subject,
  action = null,
  onRetry = null,
  detail = null,
  query = null,
  scope = null,
  narrowedFrom = null,
}) {
  const thing = subject ?? "This";

  switch (state) {
    case HONEST_STATE.IDLE:
      // NO SPINNER, DELIBERATELY. The read has not been issued, so a loading affordance would be
      // announcing progress on a request that does not exist — and `aria-live` would announce it.
      // A quiet, static line instead: the shell above it (title, rule pair, views) is still intact,
      // so this is a body that says why it is waiting rather than a blank one.
      return <p className="ns-state ns-state--na">{detail ?? `Waiting for the information ${subject ?? "this list"} needs.`}</p>;

    case HONEST_STATE.LOADING:
      return <LoadingState>{`Loading ${subject ?? "…"}`}</LoadingState>;

    case HONEST_STATE.EMPTY:
      return <EmptyState message={detail ?? `No ${subject ?? "records"} yet.`} action={action} />;

    case HONEST_STATE.NO_MATCHES:
      // Names what exists, so the reader knows the filter is the cause and not the data.
      return <EmptyState message={detail ?? `None of these ${subject ?? "records"} match the current filters.`} action={action} />;

    case HONEST_STATE.EMPTY_VIEW:
      // RECORDS EXIST; THIS SLICE IS EMPTY. The `filtered` variant is right even though no filter is
      // applied: the variant's own contract is "records exist and something is hiding them", which a
      // view is, and it is what suppresses the first-run guidance paragraph. A view's emptiness is
      // usually good news ("nothing needs attention"), so the caller's sentence carries the meaning
      // and the way out is a link to a view that is not empty.
      return (
        <EmptyState
          variant="filtered"
          title="Nothing in this view"
          message={detail ?? `No ${subject ?? "records"} are in this view right now.`}
          action={action}
        />
      );

    case HONEST_STATE.SEARCH_ZERO:
      // THE QUERY IS ECHOED AND THE SCOPE IS STATED. Both matter: without the echo a person cannot
      // tell a typo from an absence, and without the scope they read "no results" as a claim about
      // the whole collection when the search may only have reached the rows already loaded.
      return (
        <EmptyState
          variant="filtered"
          title="No results"
          message={detail ?? (query ? `No results for “${query}”.` : `No ${subject ?? "records"} matched that search.`)}
          // Deliberately NOT `guidance` — that prop renders for the `database` variant only, and a
          // scope sentence is not first-run help. It is part of the message, because it is part of
          // what "no results" means here.
          action={
            <>
              {scope ? <p className="ns-state ns-state--na">{`This searched ${scope}.`}</p> : null}
              {action}
            </>
          }
        />
      );

    case HONEST_STATE.FILTER_ZERO:
      // THE COUNT IS THE POINT. "No matches" alone reads as an empty collection; "3 of 41 are being
      // narrowed to none" puts the cause on screen beside the tokens that caused it.
      return (
        <EmptyState
          variant="filtered"
          title="No matches"
          message={
            detail ??
            (narrowedFrom === null || narrowedFrom === undefined
              ? `No ${subject ?? "records"} match these filters.`
              : `No ${subject ?? "records"} match these filters. ${
                  narrowedFrom === 1 ? "1 record is" : `${narrowedFrom} records are`
                } being narrowed to none.`)
          }
          action={action}
        />
      );

    case HONEST_STATE.UNKNOWN:
      // UNKNOWN IS NOT ZERO, AND THIS IS THE RENDERING THAT ENFORCES IT. There is no count slot on
      // this branch at all, so a caller cannot accidentally print a `0` beside a sentence that says
      // the answer is unknown. Not an alert: nothing failed, and nothing here is retryable.
      return (
        <p className="ns-state ns-state--na">
          {detail ?? `EOS can't determine which ${subject ?? "records"} apply to you.`}
        </p>
      );

    case HONEST_STATE.DENIED:
      // A permission fact. Never phrased as an apology, and never as an error the reader could fix
      // by retrying.
      return (
        <p className="ns-state ns-state--denied">
          {detail ?? `${thing} isn't part of your role.`} Ask an administrator if you believe you need it.
        </p>
      );

    case HONEST_STATE.NOT_ENABLED:
      // ONE SENTENCE, ONCE. The lock farm is the anti-pattern this replaces.
      return (
        <p className="ns-state ns-state--not-enabled">
          {detail ?? `${thing} isn't switched on for this workspace yet.`}
        </p>
      );

    case HONEST_STATE.UNAVAILABLE:
      // THE SERVER'S OWN REASON SURVIVES, VERBATIM.
      //
      // `detail` is the message the read layer produced ("You do not have permission to view these
      // work orders."), and it is rendered UNCHANGED as the alert. An earlier draft of this
      // component wrapped it in a generic sentence, which silently replaced a specific, true reason
      // with a vague one — the H14 fail-closed invariant undone in the name of nicer copy.
      //
      // The reassurance is a SEPARATE node for the same reason: it is this component's addition, and
      // it must not become part of the server's sentence.
      return (
        <>
          <FailureState message={detail ?? `${thing} couldn't be loaded.`} action={action} />
          <p className="ns-state">Your work elsewhere is unaffected.</p>
        </>
      );

    case HONEST_STATE.DEGRADED:
      // THE ROWS ARE FINE. This is the ONE QUIET LINE that sits above them, and nothing else — the
      // per-cell half of a degraded list belongs to the cells, through referenceResolution.js's
      // REFERENCE_STATE vocabulary, which already says "Name unavailable" in the place the name
      // would have been. Rendering a failure box here instead would hide a list that works.
      return <p className="ns-state ns-state--na">{detail ?? `Some details couldn't be loaded. The ${subject ?? "records"} below are complete otherwise.`}</p>;

    case HONEST_STATE.NOT_APPLICABLE:
      return <p className="ns-state ns-state--na">{detail ?? `${thing} doesn't apply to this record.`}</p>;

    default:
      // An unmapped state is reported rather than rendered as nothing — a blank here would be the
      // exact fail-blank defect this component exists to remove.
      return <p className="ns-state ns-state--na">This section's state could not be determined.</p>;
  }
}
