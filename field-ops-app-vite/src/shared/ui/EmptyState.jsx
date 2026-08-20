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
//
// `guidance` (contextual-help slice) is one or two plain sentences explaining WHY
// this collection exists and what causes a record to appear in it -- not how to
// click. It exists because a first-run `database` empty is the one moment a user
// is guaranteed not to know what the screen is for, and the app had no help
// affordance of any kind (repo-wide: zero Tooltip, zero Onboard, zero help usages
// across 464 source files).
//
// Scope rule, deliberately enforced here rather than left to callers: guidance
// renders for the "database" variant ONLY. A "filtered" empty means the user
// already has records and merely over-filtered -- explaining what a work order is
// at that moment is noise, and repeating it on every filter change is worse than
// silence. Callers may pass `guidance` unconditionally; this component decides.
//
// The icon and the guidance are answering DIFFERENT questions and both belong on
// a first-run empty: the icon says at a glance which kind of empty this is, the
// guidance says what the screen is for. Neither replaces the other, so the two
// compose rather than competing for the same slot.
import Icon from "./Icon.jsx";
import { Inbox, SearchX } from "lucide-react";

const DEFAULT_ICON_BY_VARIANT = {
  database: Inbox,
  filtered: SearchX,
};

export default function EmptyState({ title, message, guidance, action, variant = "database", icon, className }) {
  const resolvedIcon = icon === undefined ? DEFAULT_ICON_BY_VARIANT[variant] : icon;
  const cls = ["fo-state", "fo-empty-state", `fo-empty-${variant}`, resolvedIcon ? "fo-state--iconic" : "", className]
    .filter(Boolean)
    .join(" ");
  const showGuidance = variant === "database" && guidance;
  return (
    <div className={cls} data-empty-variant={variant}>
      {resolvedIcon && <Icon icon={resolvedIcon} size="empty" />}
      {title && <p className="fo-state-title">{title}</p>}
      {message && <p className="fo-muted fo-state-message">{message}</p>}
      {showGuidance ? <p className="fo-state-guidance" data-state-guidance="">{guidance}</p> : null}
      {action ? <div className="fo-state-action">{action}</div> : null}
    </div>
  );
}
