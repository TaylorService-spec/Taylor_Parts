import { SAVED_VIEWS } from "./viewsConfig";

// Renders purely from SAVED_VIEWS (viewsConfig.js) -- no hardcoded
// conditional UI logic here, per this phase's requirement. Adding a
// view (including, later, a user-defined one) means adding a config
// entry, not touching this component.
export default function SavedViews({ activeKey, onSelect }) {
  return (
    <div className="fo-saved-views">
      {SAVED_VIEWS.map((view) => (
        <button
          key={view.key}
          type="button"
          className={activeKey === view.key ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn"}
          onClick={() => onSelect(view.key)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
