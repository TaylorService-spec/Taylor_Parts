import { Check, X } from "lucide-react";
import Icon from "./Icon.jsx";
import IconButton from "./primitives/IconButton.jsx";

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
//
// Design-system pass: the active chip now carries a leading check glyph
// (icon + colour + text, never colour alone, per the shared tone
// convention) so "which filter is active" reads before the label text
// does, not just via a background-colour swap a colour-blind or
// low-contrast field screen might miss. Options are treated as a
// single-select group with `options[0]` as the implicit "cleared"
// state (every caller already supplies an "All ..." first option) --
// once a non-default filter is active, a trailing Clear control
// appears so the active filter is never a dead end the operator has
// to hunt for the right chip to escape. `flex-wrap` (existing CSS)
// keeps every chip on-screen by wrapping to new lines rather than
// growing the row wider than its container; the inline overflow guard
// below is a second line of defence so a single unbreakable label can
// never push the page itself into horizontal scroll.
export default function FilterBar({ options, activeKey, onChange, label = "Filters" }) {
  const defaultKey = options[0]?.key;
  const isFiltered = activeKey != null && activeKey !== defaultKey;

  return (
    <div
      className="fo-filter-bar"
      role="group"
      aria-label={label}
      style={{ maxWidth: "100%", overflowX: "auto" }}
    >
      {options.map((option) => {
        const isActive = option.key === activeKey;
        return (
          <button
            key={option.key}
            type="button"
            className={isActive ? "fo-filter-btn fo-filter-btn-active" : "fo-filter-btn"}
            aria-pressed={isActive}
            onClick={() => onChange(option.key)}
          >
            {isActive && (
              <Icon
                icon={Check}
                size="dense"
                style={{ verticalAlign: "-3px", marginRight: "var(--space-1)" }}
              />
            )}
            {option.label}
            {option.count !== undefined ? (
              <span className="fo-tabular-nums"> ({option.count})</span>
            ) : (
              ""
            )}
          </button>
        );
      })}
      {isFiltered && (
        <IconButton
          icon={X}
          label={`Clear filter (showing ${options[0]?.label ?? "all"})`}
          onClick={() => onChange(defaultKey)}
        />
      )}
    </div>
  );
}
