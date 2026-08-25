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
//   LOADING        a read is in flight. "Nothing yet" is not "nothing".
//   EMPTY          the read succeeded and there is genuinely nothing.
//   NO_MATCHES     things exist; these filters exclude them. Offers a way back.
//   DENIED         your role does not include this. A permission fact, not a data fact.
//   NOT_ENABLED    the capability is not switched on for this workspace. One sentence, once —
//                  "never a page of padlocks".
//   UNAVAILABLE    the read failed. Says your other work is unaffected, because a failed panel
//                  should not read as a failed application.
//   NOT_APPLICABLE the fact does not apply to this record. Distinct from absent.
export const HONEST_STATE = Object.freeze({
  LOADING: "LOADING",
  EMPTY: "EMPTY",
  NO_MATCHES: "NO_MATCHES",
  DENIED: "DENIED",
  NOT_ENABLED: "NOT_ENABLED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export default function HonestState({ state, subject, action = null, onRetry = null, detail = null }) {
  const thing = subject ?? "This";

  switch (state) {
    case HONEST_STATE.LOADING:
      return <LoadingState>{`Loading ${subject ?? "…"}`}</LoadingState>;

    case HONEST_STATE.EMPTY:
      return <EmptyState message={detail ?? `No ${subject ?? "records"} yet.`} action={action} />;

    case HONEST_STATE.NO_MATCHES:
      // Names what exists, so the reader knows the filter is the cause and not the data.
      return <EmptyState message={detail ?? `None of these ${subject ?? "records"} match the current filters.`} action={action} />;

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

    case HONEST_STATE.NOT_APPLICABLE:
      return <p className="ns-state ns-state--na">{detail ?? `${thing} doesn't apply to this record.`}</p>;

    default:
      // An unmapped state is reported rather than rendered as nothing — a blank here would be the
      // exact fail-blank defect this component exists to remove.
      return <p className="ns-state ns-state--na">This section's state could not be determined.</p>;
  }
}
