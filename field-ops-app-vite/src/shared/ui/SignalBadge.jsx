// Single shared badge for rendering a SEVERITY value (see
// domain/controlTower/types.js). Control Tower's risk badges and
// technician workload badges both render severity now, so they share one
// component/class family instead of two separately-styled pill
// implementations with their own color rules.
export default function SignalBadge({ severity, children }) {
  return (
    <span className={`fo-signal-badge fo-signal-badge--${severity.toLowerCase()}`}>
      {children}
    </span>
  );
}
