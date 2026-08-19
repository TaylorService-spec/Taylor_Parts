// Epic 9 -- Platform Workspace Framework. Extracted from the
// identical `loading ? <p className="fo-muted">...</p> : isEmpty ?
// <p className="fo-muted">...</p> : <content>` ternary chain
// duplicated in AccountsList.jsx, WorkOrdersList.jsx, and
// PartsList.jsx. No behavior change -- same three states, same
// fo-muted styling, just one implementation instead of three.
// `isEmpty` is passed in rather than computed here, since "empty"
// means something different per screen (raw collection length vs.
// filtered-list length) and this component has no way to know which
// the caller means.
//
// M25 -- `loading`/`isEmpty` alone gave a caller no way to say "the read was
// denied or failed", so callers were coercing a permission-denied or read-error
// into `isEmpty` -- reporting a failure as "nothing here" and, because EmptyState-
// style copy carries no alert semantics, dropping it out of the accessibility
// tree's alert channel entirely. `failed` is the explicit third branch: pass it
// whenever the underlying read could not complete (denied, unavailable, or any
// other read failure), and this renders through FailureState (role="alert")
// instead of the muted empty paragraph -- the same EMPTY-vs-DENIED/UNAVAILABLE
// distinction MetadataListGrid.jsx's StateBody draws for its own list states,
// applied to this simpler primitive. Checked before `isEmpty` so a caller that
// (incorrectly) sets both still gets the honest failure state, never a silently
// "empty" one -- no fallthrough-to-blank.
//
// Visual-states migration -- the three branches now render through the same
// LoadingState/EmptyState/FailureState primitives the rest of the app uses
// (icon, heading, message) instead of a bare `<p className="fo-muted">`, so a
// consumer still on this simpler primitive gets the same considered composition
// for free. `loadingText`/`emptyText`/`failedText`/`children` keep their exact
// meaning -- no caller has to change anything.
import LoadingState from "./LoadingState.jsx";
import EmptyState from "./EmptyState.jsx";
import FailureState from "./FailureState.jsx";

export default function LoadingEmptyState({ loading, isEmpty, failed, loadingText, emptyText, failedText, children }) {
  if (loading) return <LoadingState>{loadingText}</LoadingState>;
  if (failed) return <FailureState message={failedText ?? emptyText} />;
  if (isEmpty) return <EmptyState message={emptyText} />;
  return children;
}
