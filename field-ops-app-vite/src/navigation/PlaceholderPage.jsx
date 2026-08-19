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
//
// Visual migration onto the merged design system (baa8b43d): the bare h2 + two
// paragraphs is now a PageHeader (the one h1 for this screen, same title text as
// before -- only its heading LEVEL changes) over an EmptyState. This is a
// considered-empty-state read, not a decorative change: "not built yet" already IS
// an honest empty state (a destination with genuinely nothing behind it yet), so it
// gets the same treatment this program asks every other genuinely-empty surface to
// use, rather than a bespoke unstyled paragraph. No copy changes: `explanation` and
// `note` render byte-for-byte what they did before.
import { Construction } from "lucide-react";
import PageHeader from "../shared/ui/primitives/PageHeader.jsx";
import EmptyState from "../shared/ui/EmptyState.jsx";

export default function PlaceholderPage({ title, note, explanation }) {
  return (
    <div className="fo-panel">
      <PageHeader title={title} />
      <EmptyState
        icon={Construction}
        variant="database"
        message={explanation ?? "This area isn't built yet. It's reachable now so the navigation foundation reflects the platform's target shape (see docs/ProductBlueprint.md) ahead of implementation."}
      />
      {note && <p className="fo-muted">{note}</p>}
    </div>
  );
}
