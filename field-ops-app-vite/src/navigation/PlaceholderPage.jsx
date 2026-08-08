// Sprint 2.0.1 -- shared stub for business-domain areas that don't
// have a real screen yet (requirement #4). One component, reused
// across every placeholder route, rather than ~30 near-duplicate
// files -- the nav tree (navConfig.js) supplies the label/note per
// route.
// `explanation` REPLACES the default sentence for a destination where "isn't built
// yet" would be untrue. Reporting is the case that forced this: the governed report
// builder IS built, so its per-domain entries are missing report DEFINITIONS, not a
// missing capability -- and telling a user the area does not exist sends them away
// from a capability they may already hold.
export default function PlaceholderPage({ title, note, explanation }) {
  return (
    <div className="fo-panel">
      <h2>{title}</h2>
      <p className="fo-muted">{explanation ?? "This area isn't built yet. It's reachable now so the navigation foundation reflects the platform's target shape (see docs/ProductBlueprint.md) ahead of implementation."}</p>
      {note && <p className="fo-muted">{note}</p>}
    </div>
  );
}
