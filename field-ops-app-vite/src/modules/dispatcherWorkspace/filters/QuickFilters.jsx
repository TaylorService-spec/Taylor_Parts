import { QUICK_FILTERS } from "./viewsConfig";

// Renders purely from QUICK_FILTERS (viewsConfig.js) -- config-driven,
// per this phase's requirement. Distinct from SavedViews: quick filters
// are the top-level, always-visible shortcuts; saved views are the
// fuller (and future user-definable) list.
export default function QuickFilters({ activeKey, onSelect }) {
  return (
    <div className="fo-quick-filters">
      {QUICK_FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={activeKey === filter.key ? "fo-badge fo-badge-active" : "fo-badge"}
          onClick={() => onSelect(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
