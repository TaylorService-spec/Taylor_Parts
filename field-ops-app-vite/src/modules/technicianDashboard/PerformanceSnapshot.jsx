import { useEffect, useState } from "react";
import { getTechnicianExecutionStats } from "../../analytics/executionAnalyticsService";

// Epic 7 Step 4 -- "My Performance Snapshot," read-only. One-shot fetch
// on mount (not a live subscription -- this is analytics, not the
// live Work Order board that useAssignedWorkOrders() already powers
// elsewhere on this dashboard). No write capability anywhere in this
// component.
//
// "Parts used this week" isn't literally computable from
// getTechnicianExecutionStats() as specified (that returns an
// all-time totalPartsConsumed, not a weekly-windowed figure -- there's
// no per-transaction date breakdown available client-side without
// reading the Epic 2D ledger, which is Admin-SDK-only and unrelated to
// this technician's own execution data). Shows the real, honest
// all-time total instead of fabricating a weekly figure this data
// can't actually support.
function formatDuration(ms) {
  if (ms == null) return "N/A";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  return `${hours.toFixed(1)}h`;
}

export default function PerformanceSnapshot({ technicianId }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!technicianId) {
      setStats(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTechnicianExecutionStats(technicianId)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [technicianId]);

  return (
    <div className="fo-card">
      <h4>My Performance Snapshot</h4>
      {loading ? (
        <p className="fo-muted">Loading...</p>
      ) : error ? (
        <p className="fo-muted">Couldn't load performance stats: {error}</p>
      ) : !stats ? (
        <p className="fo-muted">No data available.</p>
      ) : (
        <div className="fo-stat-grid">
          <div className="fo-stat">
            <div className="fo-stat-value">{stats.totalWorkOrdersCompleted}</div>
            <div className="fo-stat-label">Work Orders Completed (all-time)</div>
          </div>
          <div className="fo-stat">
            <div className="fo-stat-value">{stats.totalPartsConsumed}</div>
            <div className="fo-stat-label">Parts Used (all-time)</div>
          </div>
          <div className="fo-stat">
            <div className="fo-stat-value">{formatDuration(stats.averageCompletionTimeMs)}</div>
            <div className="fo-stat-label">Avg. Job Duration</div>
          </div>
        </div>
      )}
    </div>
  );
}
