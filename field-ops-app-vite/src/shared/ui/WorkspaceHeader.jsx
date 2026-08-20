import PageHeader from "./primitives/PageHeader.jsx";

// Epic 9 -- Platform Workspace Framework. Extracted from the
// identical `disp-board-toolbar` + `<h2 style={{margin:0}}>` wrapper
// duplicated across AccountsList.jsx, WorkOrdersList.jsx, and
// PartsList.jsx (each hand-rolled the same title-row shape). No
// behavior change -- same markup shape, same class, just one
// implementation instead of three. `children` is whatever a screen
// puts after the title (GlobalSearch, action buttons); this component
// doesn't know or care what those are.
//
// Workspace chrome pass -- this used to hand-roll its own bare <h2>,
// which meant every WorkspaceShell screen's visible title rendered in
// the browser's unstyled default heading font rather than the design
// system's display type. It now composes the PageHeader primitive
// instead of re-declaring the heading: PageHeader is the ONE title
// level a screen gets (display typeface, h1), `children` becomes
// PageHeader's `actions` slot (the ONE action zone for workspace-level
// operations), so nothing here competes with ContextBand's supporting-
// context strip below it or with AppHeader's session-utility zone above
// it. AppShell.jsx renders its own visually-hidden <h1> per domain as a
// route-change screen-reader landmark/focus target (outside this
// component's scope) -- that is a distinct, non-visual navigation aid,
// not a second visible page title, so it does not compete with this one.
export default function WorkspaceHeader({ title, children }) {
  return <PageHeader title={title} actions={children} />;
}
