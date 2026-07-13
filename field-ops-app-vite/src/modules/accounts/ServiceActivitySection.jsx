import { Link } from "react-router-dom";
import {
  fetchAccountCompletedWorkOrderCount,
  fetchAccountOpenWorkOrderCount,
} from "../../domain/accountWorkOrders";
import { countView, timelineView } from "../../domain/serviceActivityView";
import {
  useAccountWorkOrderCount,
  useAccountWorkOrderTimeline,
} from "../../hooks/useAccountServiceActivity";

// Customer/Account Business Model -- Customer PR 3, Service Activity.
// Two distinct presentation elements over the same Account's Work Orders,
// each backed by its OWN query and state (never merged): operational
// summary counts (Completed and Open, themselves two INDEPENDENT counts),
// and the chronological Account Activity timeline. These are operational
// activity counts, NOT financial figures -- rendered under "Service
// Activity", never inside/adjacent to Financial Summary
// (docs/architecture/enterprise-business-metrics-framework.md, Section 3).
//
// Every element renders strictly from its pure view (domain/
// serviceActivityView.js), so one element's failure can never change what
// another renders -- see test/serviceActivityView.test.mjs.

function formatWoDate(createdAt) {
  // createdAt is a Firestore Timestamp (written server-side by
  // createWorkOrder.ts). Guard for a missing/legacy value rather than
  // fabricating a date.
  if (createdAt && typeof createdAt.toDate === "function") {
    return createdAt.toDate().toLocaleDateString();
  }
  return "—"; // em dash -- date genuinely unavailable
}

// Renders one count from its OWN state via the pure countView().
function CountCell({ label, state }) {
  const view = countView(state);
  if (view.kind === "loading") {
    return <span className="fo-muted">{label}: loading&hellip;</span>;
  }
  if (view.kind === "error") {
    return <span className="fo-warning">{label}: unavailable</span>;
  }
  return <span className="fo-badge">{label}: {view.value}</span>;
}

export default function ServiceActivitySection({ accountId }) {
  // Two SEPARATE count hooks -- each fetches and error-handles on its own,
  // so Completed failing never hides Open (or vice versa), and neither
  // touches the timeline below.
  const completed = useAccountWorkOrderCount(accountId, fetchAccountCompletedWorkOrderCount);
  const open = useAccountWorkOrderCount(accountId, fetchAccountOpenWorkOrderCount);
  const timeline = useAccountWorkOrderTimeline(accountId);
  const tView = timelineView(timeline);

  return (
    <section className="wo-history">
      <h4>Service Activity</h4>

      {/* Summary counts -- two independent counts, each its own query/state,
          both independent of the timeline. A count is never derived from the
          timeline's loaded pages. */}
      <div className="fo-service-activity-counts">
        <CountCell label="Completed Work Orders" state={completed} />
        <CountCell label="Open Work Orders" state={open} />
      </div>

      {/* Account Activity timeline -- its own query/state; loading/empty/error
          are all distinct, never an empty list indistinguishable from an error. */}
      {tView.kind === "loading" ? (
        <p className="fo-muted">Loading activity&hellip;</p>
      ) : tView.kind === "error" ? (
        <p className="fo-warning">Account activity is temporarily unavailable.</p>
      ) : tView.kind === "empty" ? (
        <p className="fo-muted">No activity yet for this Account.</p>
      ) : (
        <>
          <ul className="fo-activity-list">
            {timeline.items.map((wo) => (
              <li key={wo.id} className="wo-history-row">
                <span className="fo-muted">{formatWoDate(wo.createdAt)}</span>{" "}
                {wo.status && <span className="fo-badge">{wo.status}</span>}{" "}
                <Link to={`/service/work-orders/${wo.id}`}>{wo.woNumber ?? wo.id}</Link>
              </li>
            ))}
          </ul>

          {timeline.loadMoreError && (
            <p className="fo-warning">Could not load more activity. Try again.</p>
          )}

          {timeline.hasMore ? (
            <button type="button" onClick={timeline.loadMore} disabled={timeline.loadingMore}>
              {timeline.loadingMore ? "Loading…" : "Load More"}
            </button>
          ) : (
            <p className="fo-muted">End of activity.</p>
          )}
        </>
      )}
    </section>
  );
}
