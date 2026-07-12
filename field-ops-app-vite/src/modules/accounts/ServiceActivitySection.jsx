import { Link } from "react-router-dom";
import {
  useAccountWorkOrderCounts,
  useAccountWorkOrderTimeline,
} from "../../hooks/useAccountServiceActivity";

// Customer/Account Business Model -- Customer PR 3, Service Activity.
// Two distinct presentation elements over the same Account's Work Orders,
// each backed by its OWN query and state (never merged): operational
// summary counts, and the chronological Account Activity timeline. These
// are operational activity counts, NOT financial figures -- rendered under
// "Service Activity", never inside/adjacent to Financial Summary
// (docs/architecture/enterprise-business-metrics-framework.md, Section 3).

function formatWoDate(createdAt) {
  // createdAt is a Firestore Timestamp (written server-side by
  // createWorkOrder.ts). Guard for a missing/legacy value rather than
  // fabricating a date.
  if (createdAt && typeof createdAt.toDate === "function") {
    return createdAt.toDate().toLocaleDateString();
  }
  return "—"; // em dash -- date genuinely unavailable
}

export default function ServiceActivitySection({ accountId }) {
  const counts = useAccountWorkOrderCounts(accountId);
  const timeline = useAccountWorkOrderTimeline(accountId);

  return (
    <section className="wo-history">
      <h4>Service Activity</h4>

      {/* Summary counts -- own query/state, independent of the timeline below.
          A count is never derived from the timeline's loaded pages. */}
      <div className="fo-service-activity-counts">
        {counts.loading ? (
          <span className="fo-muted">Loading counts&hellip;</span>
        ) : counts.error ? (
          <span className="fo-warning">Service activity counts are temporarily unavailable.</span>
        ) : (
          <>
            <span className="fo-badge">Completed Work Orders: {counts.completed}</span>
            <span className="fo-badge">Open Work Orders: {counts.open}</span>
          </>
        )}
      </div>

      {/* Account Activity timeline -- its own query/state; loading/empty/error
          are all distinct, never an empty list indistinguishable from an error. */}
      {timeline.loading ? (
        <p className="fo-muted">Loading activity&hellip;</p>
      ) : timeline.error ? (
        <p className="fo-warning">Account activity is temporarily unavailable.</p>
      ) : timeline.isEmpty ? (
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
