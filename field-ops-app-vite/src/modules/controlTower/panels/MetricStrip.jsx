import { Link } from "react-router-dom";

// The metric strip — grammar pattern 4. Exactly four operating numbers, and the two rules that make
// it a strip rather than a row of vanity tiles:
//
//   1. EVERY NUMBER LINKS. The page it replaces had five tiles and not one of them was clickable, so
//      a dispatcher could read "7 awaiting dispatch" and have nowhere to go with it.
//   2. EVERY NUMBER CARRIES ITS EXCEPTION COUNT, or says in words that it has none — and the
//      exception REACHES ITS ROWS. The exception links here are in-page anchors to the very sections
//      that hold the rows the count came from, so the number and the evidence can never disagree.
//
// A metric whose value is `null` is one this page could not read (the technician read failing
// independently of the work-order read is the real case). It renders "unavailable" — never 0. A zero
// is a finding; an unread number is not, and the difference matters to somebody staffing a day.
function Metric({ metric }) {
  const unknown = metric.value === null || metric.value === undefined;

  return (
    <div className="ns-metric">
      <p className="ns-metric__label">{metric.label}</p>
      <p className="ns-metric__value">
        {unknown ? (
          <span className="ns-metric__unknown">unavailable</span>
        ) : (
          <Link to={metric.href}>{metric.value}</Link>
        )}
      </p>
      <p className="ns-metric__exception">
        {metric.exception ? (
          <a href={metric.exception.href}>
            <strong className={`ns-tone--${metric.exception.tone}`}>{metric.exception.count}</strong>{" "}
            {metric.exception.text}
          </a>
        ) : unknown ? (
          <span className="ns-muted">not read</span>
        ) : (
          <span className="ns-muted">no exceptions</span>
        )}
      </p>
    </div>
  );
}

export default function MetricStrip({ metrics = [] }) {
  return (
    <section className="ns-metrics" aria-label="Service operations at a glance">
      {metrics.map((metric) => (
        <Metric key={metric.key} metric={metric} />
      ))}
    </section>
  );
}
