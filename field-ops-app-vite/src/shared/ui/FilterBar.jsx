// Epic 9 -- Platform Workspace Framework. Extracted from the
// identical toggle-button-group-with-counts pattern duplicated in
// WorkOrdersList.jsx (status groups) and PartsList.jsx (categories) --
// same array-of-{key,label}/useState-active-key/map-to-buttons shape
// in both places. No filtering logic moves here; each screen still
// owns its own options list and active-key state and passes them in --
// this component only renders the toggle row and reports clicks back.
//
// Uses new fo-filter-btn/fo-filter-btn-active classes, NOT
// fo-nav-btn/fo-nav-btn-active. Those existing classes are tuned for
// AppShell.jsx's dark header nav (light-gray text, white-tinted hover,
// on a dark background) -- reusing them here, on a white fo-panel
// background, is what caused the reported contrast/hover/active-state
// visibility problem: light-gray-on-white and a white-tinted hover
// overlay are both close to invisible on a light background. This
// component gets its own, light-panel-appropriate styling instead of
// cross-purposing a class designed for a different visual context.
export default function FilterBar({ options, activeKey, onChange }) {
  return (
    <div className="fo-filter-bar">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={option.key === activeKey ? "fo-filter-btn fo-filter-btn-active" : "fo-filter-btn"}
          onClick={() => onChange(option.key)}
        >
          {option.label}
          {option.count !== undefined ? ` (${option.count})` : ""}
        </button>
      ))}
    </div>
  );
}
