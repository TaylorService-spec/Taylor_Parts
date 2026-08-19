// Design-system foundation (PR 1) -- a small labelled number for a dense
// summary row. Tabular numerals (.fo-tabular-nums) so a row of these never
// jitters as values update in place. Distinct from the existing card-scale
// .fo-stat/.fo-stat-value pairing elsewhere in index.css, which this does
// not replace.
export default function CompactMetric({ value, label, className = "" }) {
  return (
    <div className={["fo-compact-metric", className].filter(Boolean).join(" ")}>
      <span className="fo-compact-metric__value fo-tabular-nums">{value}</span>
      <span className="fo-compact-metric__label">{label}</span>
    </div>
  );
}
