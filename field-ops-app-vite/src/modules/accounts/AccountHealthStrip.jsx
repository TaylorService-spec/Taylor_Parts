import { Link } from "react-router-dom";
import {
  buildAccountHealthStrip,
  HEALTH_METRIC_STATE,
  HEALTH_STRIP_ABSENCE_NOTE,
} from "../../domain/accountHealthStrip";

// THE STANDING STRIP — the Account's three real numbers, on one ruled line.
//
// ════════════════════ WHAT CHANGED, AND WHY IT IS NOT A REDESIGN ════════════════════
//
// The metrics, their sources and their states are untouched: domain/accountHealthStrip.js still
// projects ONLY facts with a real account-scoped authority behind them, and this file still
// computes nothing. What changed is the GRAMMAR. This rendered as `.fo-stat-grid` — a row of
// metric cards — and the approved Account North Star P1 composition draws it as ONE ruled row
// between two hairlines, the same way the record's other structure is made of whitespace and
// rules rather than boxes. Three cards for three numbers is a card habit, not a hierarchy.
//
// ════════════════════ THE THREE ANSWERS THAT ARE NOT NUMBERS ════════════════════
//
// A metric has four honest outcomes and each gets its OWN words, because collapsing any two of
// them is how a salesperson comes to believe a false zero:
//
//   DENIED       "Not available to you"   — there IS an answer; it is not yours to see.
//   UNAVAILABLE  "Couldn't be read"       — the source exists and could not answer right now.
//   ZERO         the number 0             — a real, authoritative answer, rendered as one.
//   READY        the value                — with a link where there is something to go look at.
//
// The DENIED and UNAVAILABLE wordings are the approved design's own, replacing "Not visible to
// you" / "Unavailable". Same three states, same fail-closed derivation; only the words moved.
//
// A DENIED metric keeps its slot rather than disappearing (design decision A-D2): a page whose
// financial geography quietly vanishes for a salesperson reads as "this customer owes nothing",
// which is the one thing it must never say.

function MetricValue({ metric }) {
  switch (metric.state) {
    case HEALTH_METRIC_STATE.LOADING:
      return <span className="ns-standing__pending">…</span>;
    case HEALTH_METRIC_STATE.DENIED:
      return <span className="ns-standing__absent">Not available to you</span>;
    case HEALTH_METRIC_STATE.UNAVAILABLE:
      return <span className="ns-standing__absent">Couldn&rsquo;t be read</span>;
    default:
      break;
  }
  if (metric.href && metric.href.startsWith("#")) {
    return <a href={metric.href}>{metric.value}</a>;
  }
  if (metric.href) {
    return <Link to={metric.href}>{metric.value}</Link>;
  }
  return <span>{metric.value}</span>;
}

export default function AccountHealthStrip({ workOrderCount, arView }) {
  const metrics = buildAccountHealthStrip({ workOrderCount, arView });
  if (metrics.length === 0) return null;
  return (
    <section className="ns-standing" aria-label="Standing">
      <span className="ns-standing__label">Standing</span>
      {metrics.map((metric) => (
        <span key={metric.id} className="ns-standing__metric">
          <span className="ns-standing__metric-label">{metric.label}</span>
          <span
            className={
              metric.tone === "warn"
                ? "ns-standing__metric-value is-warn"
                : "ns-standing__metric-value"
            }
          >
            <MetricValue metric={metric} />
          </span>
        </span>
      ))}
      {/* The gap, stated once — see HEALTH_STRIP_ABSENCE_NOTE for why it is owned in the domain. */}
      <span className="ns-standing__note">{HEALTH_STRIP_ABSENCE_NOTE}</span>
    </section>
  );
}
