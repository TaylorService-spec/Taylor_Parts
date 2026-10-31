// Compact UX Standard (docs/design/compact-ux-standard.md §3) -- the one row that holds a
// page's search, filters and secondary controls, directly under the page header. It reuses
// the North Star collection toolbar styling (.ns-toolbar) so every list and queue states its
// controls in one visual language. Layout only: each page still owns its own controls and
// what they do.
export default function Toolbar({ label = "Search and filters", className = "", children }) {
  return (
    <div className={["ns-toolbar", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {children}
    </div>
  );
}
