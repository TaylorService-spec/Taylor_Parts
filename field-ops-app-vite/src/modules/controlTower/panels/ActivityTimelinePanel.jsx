import { ACTIVITY_FILTER } from "../../../domain/serviceOperationsNorthStar";

const FILTERS = [
  { value: ACTIVITY_FILTER.ALL, label: "All" },
  { value: ACTIVITY_FILTER.WORK_ORDER, label: "Work order" },
  { value: ACTIVITY_FILTER.JOB, label: "Job" },
  { value: ACTIVITY_FILTER.SYSTEM, label: "System" },
];

// The activity rail. Entries come from domain/serviceOperationsNorthStar.js's activityEntries(),
// which composes domain/timelineBuilder.js. The rail carries no actions and no attention — those
// belong in the work area (grammar pattern 8).
//
// ── SO-N3 / SO-G6 — NO CLOCK TIME, AND THAT IS THE HONEST RENDERING ────────────────────────────
//
// timelineBuilder stamps EVERY milestone with the work order's `createdAt`, because that is the only
// timestamp this schema holds: there is no assignedAt / startedAt / completedAt. Three milestones for
// one work order therefore carry one identical time. Printing it beside each entry would tell a
// dispatcher that three things happened at the same instant, which is a claim about the business the
// data cannot support — false precision is worse than an absent field, because it cannot be seen to
// be missing. Relative ORDER is real (sortEvents breaks ties by EVENT_SEQUENCE_RANK), so the list is
// ordered and unstamped.
//
// The provenance line is load-bearing for the same reason: a list of events that looks like an audit
// log will be read as one. This one is derived from whatever work orders are currently loaded.
//
// SO-N5 — no actor. The event model carries no actor identity, so no person, role or "System" is
// attributed to any entry here.
//
// SO-G6 records the underlying gap: authoritative per-transition timestamps do not exist. It is not
// solved by a presentation migration, and nothing here pretends otherwise.
export default function ActivityTimelinePanel({ entries = [], filter, onFilterChange }) {
  return (
    <aside className="ns-rail" aria-label="Activity">
      <p className="ns-rail__label">Activity</p>

      {/* Labeled links, not a bare <select> with no accessible name -- the filter states what it
          filters, and the current view is marked rather than only coloured. */}
      <div className="ns-rail__filters">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`ns-rail__filter${filter === option.value ? " is-current" : ""}`}
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="ns-state">No activity in the loaded work orders.</p>
      ) : (
        <ul className="ns-rail__list">
          {entries.map((entry) => (
            <li key={entry.key} className="ns-rail__entry">
              <span className="ns-rail__entry-text">{entry.description}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="ns-rail__note">
        Derived from the loaded work-order snapshot — not an audit log. Entries are in order; the
        system does not record a time for each step.
      </p>
    </aside>
  );
}
