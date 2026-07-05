import { memo, useState } from "react";

// Dispatcher Activity Panel -- pure renderer for
// hooks/useSessionActivityFeed.js's output. Session-only, collapsible,
// clearly visually separated from the 3-pane board (its own bordered
// strip, not one of the queue/preview/technician panes) so it reads as
// a distinct, secondary feature -- not a fourth core pane.
function formatRelativeTime(at) {
  const seconds = Math.floor((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function DispatcherActivityFeed({ entries }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="disp-activity-feed">
      <div className="disp-activity-feed-header">
        <h4>Recent Activity (this session)</h4>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <>
          {entries.length === 0 ? (
            <p className="fo-muted">No activity yet this session. Changes to Work Orders (by you or others) will appear here as they happen.</p>
          ) : (
            <ul className="disp-activity-feed-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <span className="fo-muted">{formatRelativeTime(entry.at)}</span> -- {entry.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default memo(DispatcherActivityFeed);
