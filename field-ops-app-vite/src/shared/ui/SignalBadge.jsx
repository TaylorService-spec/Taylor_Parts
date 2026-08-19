import Icon from "./Icon.jsx";
import { severityIcon } from "./tone.js";

// Single shared badge for rendering a SEVERITY value (see
// domain/controlTower/types.js). Control Tower's risk badges and
// technician workload badges both render severity now, so they share one
// component/class family instead of two separately-styled pill
// implementations with their own color rules.
//
// Reconciled with StatusPill: a severity borrows the same glyph a tone of equivalent meaning
// would render (tone.js's SEVERITY_TONE + TONE_ICONS), so "critical" never means one thing in a
// StatusPill and something visually different in a SignalBadge, and colour is never the only
// channel carrying the severity.
export default function SignalBadge({ severity, children }) {
  const key = severity.toLowerCase();
  return (
    <span className={`fo-signal-badge fo-signal-badge--${key}`}>
      <Icon icon={severityIcon(severity)} size="dense" />
      {children}
    </span>
  );
}
