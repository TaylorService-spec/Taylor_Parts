// Issue #214 PR-4 -- shared application-state primitive. A polite loading region
// for a page/collection load. Thin and composable (NOT a state framework); reuses
// the existing `fo-muted` visual token. For form saving/success use FormStatus;
// this is for page/collection loads. LoadingEmptyState remains for consumers not
// migrated in this PR.
export default function LoadingState({ children = "Loading…", className }) {
  const cls = ["fo-state", "fo-state-loading", "fo-muted", className].filter(Boolean).join(" ");
  return (
    <p className={cls} role="status" aria-live="polite">
      {children}
    </p>
  );
}
