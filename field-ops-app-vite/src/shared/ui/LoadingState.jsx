// Issue #214 PR-4 -- shared application-state primitive. A polite loading region
// for a page/collection load. Thin and composable (NOT a state framework); reuses
// the existing `fo-muted` visual token. For form saving/success use FormStatus;
// this is for page/collection loads. LoadingEmptyState remains for consumers not
// migrated in this PR.
//
// Design-system foundation (PR 1) -- `withIcon` is a new, OPTIONAL prop that
// renders a spinning Loader2 glyph (Icon.jsx, "dense" size) ahead of the
// text. Off by default -- existing consumers render exactly as before.
import { Loader2 } from "lucide-react";
import Icon from "./Icon.jsx";

export default function LoadingState({ children = "Loading…", withIcon = false, className }) {
  const cls = ["fo-state", "fo-state-loading", "fo-muted", className].filter(Boolean).join(" ");
  return (
    <p className={cls} role="status" aria-live="polite" style={withIcon ? { display: "inline-flex", alignItems: "center", gap: "8px" } : undefined}>
      {withIcon && <Icon icon={Loader2} size="dense" className="fo-icon--spin" />}
      {children}
    </p>
  );
}
