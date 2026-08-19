// Issue #214 PR-4 -- shared application-state primitive. "No results" content for
// a page/collection. Deliberately has NO alert semantics (an empty result is not
// an error). `variant` distinguishes the two empties the behavior contract
// requires and must never conflate:
//   - "database"  -- nothing exists yet (create the first record);
//   - "filtered"  -- records exist but the current filters hide them all.
// `action` is an optional caller-supplied native button/link (keyboard-accessible).
//
// Visual-states migration -- every empty state now carries a considered
// composition by default: a variant-appropriate icon, the existing title/message
// text, and the action slot, laid out through the `.fo-state--iconic` treatment
// the design-system foundation PR already shipped in index.css. `icon` remains
// an optional prop for a caller that wants to name a more specific glyph (e.g.
// a domain icon for "no Parts yet"); passing `icon={null}` opts a caller back
// out to the bare text-only rendering. No consumer has to change a single prop
// to pick up the new look -- the prop contract is unchanged.
import Icon from "./Icon.jsx";
import { Inbox, SearchX } from "lucide-react";

const DEFAULT_ICON_BY_VARIANT = {
  database: Inbox,
  filtered: SearchX,
};

export default function EmptyState({ title, message, action, variant = "database", icon, className }) {
  const resolvedIcon = icon === undefined ? DEFAULT_ICON_BY_VARIANT[variant] : icon;
  const cls = ["fo-state", "fo-empty-state", `fo-empty-${variant}`, resolvedIcon ? "fo-state--iconic" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} data-empty-variant={variant}>
      {resolvedIcon && <Icon icon={resolvedIcon} size="empty" />}
      {title && <p className="fo-state-title">{title}</p>}
      {message && <p className="fo-muted fo-state-message">{message}</p>}
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
