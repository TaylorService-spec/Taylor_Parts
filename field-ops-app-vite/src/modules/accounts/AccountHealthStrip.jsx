import { Link } from "react-router-dom";
import { buildAccountHealthStrip, HEALTH_METRIC_STATE } from "../../domain/accountHealthStrip";

// The Account workspace's top-line health metrics. Presentational only -- every value comes from
// domain/accountHealthStrip.js, which projects ONLY metrics with a real account-scoped authority
// behind them (see that file for what is deliberately absent and why).
//
// Each metric navigates to the records behind it where that is meaningful. A metric whose count is
// zero is a real answer and renders as such, but it does not link anywhere -- there is nothing to
// look at.

function MetricValue({ metric }) {
  switch (metric.state) {
    case HEALTH_METRIC_STATE.LOADING:
      return <span className="fo-muted">…</span>;
    case HEALTH_METRIC_STATE.DENIED:
      // Never collapsed into "0" or an empty state: the caller cannot see this, which is a
      // different fact from "there is none".
      return <span className="fo-muted">Not visible to you</span>;
    case HEALTH_METRIC_STATE.UNAVAILABLE:
      return <span className="fo-muted">Unavailable</span>;
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
    <section className="fo-account-health" aria-label="Account health">
      <div className="fo-stat-grid">
        {metrics.map((metric) => (
          <div key={metric.id} className="fo-stat">
            <div className="fo-muted fo-stat-label">{metric.label}</div>
            <div className={metric.tone === "warn" ? "fo-stat-value fo-stat-warn" : "fo-stat-value"}>
              <MetricValue metric={metric} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
