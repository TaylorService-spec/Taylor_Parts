// Issue #214 PR-4 -- shared application-state primitive. A polite loading region
// for a page/collection load. Thin and composable (NOT a state framework); reuses
// the existing `fo-muted` visual token. For form saving/success use FormStatus;
// this is for page/collection loads. LoadingEmptyState remains for consumers not
// migrated in this PR.
//
// Visual-states migration -- the spinning Loader2 glyph (Icon.jsx, "dense" size)
// now renders by default so a loading region reads as "in progress" rather than
// static muted text. Pass `withIcon={false}` to opt a caller back out to the
// bare text-only rendering; no existing prop changes shape. The icon and text
// sit on one inline-flex line so the region's height matches the plain-text
// rendering it replaces -- swapping the icon on/off, or swapping this region
// for the loaded content, never nudges surrounding layout.
import { Loader2 } from "lucide-react";
import Icon from "./Icon.jsx";

export default function LoadingState({ children = "Loading…", withIcon = true, className }) {
  const cls = ["fo-state", "fo-state-loading", "fo-muted", className].filter(Boolean).join(" ");
  return (
    <p
      className={cls}
      role="status"
      aria-live="polite"
      style={withIcon ? { display: "inline-flex", alignItems: "center", gap: "var(--space-2)" } : undefined}
    >
      {withIcon && <Icon icon={Loader2} size="dense" className="fo-icon--spin" />}
      {children}
    </p>
  );
}
