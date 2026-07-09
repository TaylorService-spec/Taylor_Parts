// Epic 9 -- Platform Workspace Framework. Extracted from the
// identical `disp-board-toolbar` + `<h2 style={{margin:0}}>` wrapper
// duplicated across AccountsList.jsx, WorkOrdersList.jsx, and
// PartsList.jsx (each hand-rolled the same title-row shape). No
// behavior change -- same markup shape, same class, just one
// implementation instead of three. `children` is whatever a screen
// puts after the title (GlobalSearch, action buttons); this component
// doesn't know or care what those are.
export default function WorkspaceHeader({ title, children }) {
  return (
    <div className="fo-workspace-header">
      <h2 className="fo-workspace-header-title">{title}</h2>
      {children}
    </div>
  );
}
