import WorkspaceHeader from "./WorkspaceHeader.jsx";

// Operating Workspace Shell (Wave-0 composition primitive; the highest-leverage one).
//
// The missing composition layer between the (good) design tokens and application surfaces. It declares
// REGIONS, not a card, and establishes hierarchy WITHOUT dictating one visual layout — the work area accepts
// a queue, table, calendar, timeline, split pane, map, or detail. This is the primitive that stops
// `.fo-panel` from functioning as the default page model (the card-farm root), and it resolves the phantom
// `.fo-workspace` class (which was used in 5 files with no CSS).
//
// Regions (all optional except the work area):
//   title + actions   -> WORKSPACE IDENTITY + PRIMARY ACTION (what operation am I performing / what next)
//   context           -> CONTEXT (a ContextBand: what business situation)
//   attention         -> ATTENTION (what needs intervention — kept ABOVE the work area, never buried)
//   children          -> WORK AREA (the dominant operating surface; caller composes it)
//   supporting        -> SUPPORTING CONTEXT (an aside: info needed to decide)
//
// density: "comfortable" | "compact" | "field" — a job-fit density the shell exposes via a data-attribute
// for its descendants (field = large targets/low load; compact/comfortable = desktop operational density).
// The shell owns the responsive recomposition of its regions so pages don't each reinvent breakpoints.
export default function WorkspaceShell({
  title,
  actions = null,
  context = null,
  attention = null,
  supporting = null,
  density = "comfortable",
  className = "",
  children,
}) {
  return (
    <section className={`fo-workspace ${className}`.trim()} data-density={density}>
      {(title != null || actions != null) && (
        <WorkspaceHeader title={title}>{actions}</WorkspaceHeader>
      )}
      {context ? <div className="fo-workspace__context">{context}</div> : null}
      {attention ? <div className="fo-workspace__attention" role="region" aria-label="Needs attention">{attention}</div> : null}
      <div className={`fo-workspace__body ${supporting ? "fo-workspace__body--split" : ""}`.trim()}>
        <div className="fo-workspace__work">{children}</div>
        {supporting ? <aside className="fo-workspace__supporting">{supporting}</aside> : null}
      </div>
    </section>
  );
}
