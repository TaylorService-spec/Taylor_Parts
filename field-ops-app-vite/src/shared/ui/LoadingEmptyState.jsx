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
export default function LoadingEmptyState({ loading, isEmpty, loadingText, emptyText, children }) {
  if (loading) return <p className="fo-muted">{loadingText}</p>;
  if (isEmpty) return <p className="fo-muted">{emptyText}</p>;
  return children;
}
