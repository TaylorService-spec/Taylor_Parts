import { X } from "lucide-react";
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
// COLLECTION GRAMMAR PASS: this row now renders the shared North Star view chips
// (.ns-collection__views / .ns-view), the same control OpportunityList shipped and the Owner
// accepted -- so every list states its views in one visual language instead of four.
//
// The leading CHECK GLYPH described below is gone with the pill styling that needed it. Its job was
// to keep "which filter is active" off colour alone; .ns-view.is-active does that with FONT WEIGHT
// and a bottom rule, which survives greyscale and colour-blind viewing just as well. The semantics
// are untouched: still a group of aria-pressed buttons, not a radiogroup, so this is a presentation
// change and not a behavioural one for the five lists that share it.
//
// Superseded note, kept for the reasoning it records: the active chip once carried a check glyph
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
// `variant` — WHICH SURFACE IS ASKING, because a views row is not a generic filter row.
//
//   "views"  the collection grammar: the row of view chips a LIST states its views with.
//   "chips"  the older pill group, for surfaces that filter a panel without being a collection.
//
// The distinction is enforced elsewhere: `listsP2Compose` asserts that no non-collection surface
// renders a views row or a collection footer. Making every FilterBar a views row broke that
// immediately — WarehouseManagerHome is a role Home, an Overview archetype, and its category filter
// is not the same act as choosing which slice of a collection to read. The test was right and the
// prop exists because of it.
export default function FilterBar({ options, activeKey, onChange, label = "Filters", variant = "views" }) {
  const defaultKey = options[0]?.key;
  const isFiltered = activeKey != null && activeKey !== defaultKey;
  const isViews = variant === "views";

  return (
    <div
      className={isViews ? "ns-collection__views" : "fo-filter-bar"}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const isActive = option.key === activeKey;
        return (
          <button
            key={option.key}
            type="button"
            className={isViews
              ? `ns-view ${isActive ? "is-active" : ""}`.trim()
              : (isActive ? "fo-filter-btn fo-filter-btn-active" : "fo-filter-btn")}
            aria-pressed={isActive}
            onClick={() => onChange(option.key)}
          >
            {option.label}
            {/* THREE STATES, NOT TWO, and collapsing any pair of them tells a lie.
                  undefined  this list has no counting dimension at all -> render NOTHING.
                  null       a count was attempted and is unavailable -> render an em dash.
                  number     the governed count, including a real 0.
                "0" is a claim about the business; "—" is a claim about the READ; a bare label says
                the question was never asked. An earlier version of this chip rendered null as
                nothing, which quietly demoted "we could not count" to "there is nothing to count" —
                three suites caught it, and they were right to. */}
            {option.count === undefined ? null : (
              <span className={isViews ? "ns-view__count" : "fo-tabular-nums"}>
                {isViews ? (option.count === null ? "—" : option.count)
                         : ` (${option.count === null ? "—" : option.count})`}
              </span>
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
