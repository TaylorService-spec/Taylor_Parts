// Sprint 2.0.1 -- shared stub for business-domain areas that don't
// have a real screen yet (requirement #4). One component, reused
// across every placeholder route, rather than ~30 near-duplicate
// files -- the nav tree (navConfig.js) supplies the label/note per
// route.
export default function PlaceholderPage({ title, note }) {
  return (
    <div className="fo-panel">
      <h2>{title}</h2>
      <p className="fo-muted">This area isn't built yet. It's reachable now so the navigation foundation reflects the platform's target shape (see docs/ProductBlueprint.md) ahead of implementation.</p>
      {note && <p className="fo-muted">{note}</p>}
    </div>
  );
}
