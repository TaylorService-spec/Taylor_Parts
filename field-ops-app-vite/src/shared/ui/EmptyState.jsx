// Generic, reusable empty-state message -- lives alongside
// AppHeader.jsx/SignalBadge.jsx since it's not specific to any one
// module. Callers pass friendly, specific copy (e.g. "Great news -- no
// Priority 1 Work Orders") -- this component has no opinion on wording,
// it just renders it consistently. Never render a bare "No Data".
export default function EmptyState({ message }) {
  return (
    <div className="fo-empty-state">
      <p className="fo-muted">{message}</p>
    </div>
  );
}
