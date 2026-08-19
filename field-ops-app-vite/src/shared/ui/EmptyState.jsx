// Issue #214 PR-4 -- shared application-state primitive. "No results" content for
// a page/collection. Deliberately has NO alert semantics (an empty result is not
// an error). `variant` distinguishes the two empties the behavior contract
// requires and must never conflate:
//   - "database"  -- nothing exists yet (create the first record);
//   - "filtered"  -- records exist but the current filters hide them all.
// `action` is an optional caller-supplied native button/link (keyboard-accessible).
//
// Design-system foundation (PR 1) -- `icon` is a new, OPTIONAL prop (a lucide
// icon component, rendered at the "empty" size -- 32px, the scale's max).
// Omitted, this renders exactly as before.
import Icon from "./Icon.jsx";

export default function EmptyState({ title, message, action, variant = "database", icon, className }) {
  const cls = ["fo-state", "fo-empty-state", `fo-empty-${variant}`, icon ? "fo-state--iconic" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} data-empty-variant={variant}>
      {icon && <Icon icon={icon} size="empty" />}
      {title && <p className="fo-state-title">{title}</p>}
      {message && <p className="fo-muted fo-state-message">{message}</p>}
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
