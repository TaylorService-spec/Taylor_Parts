import { summarizeListView, selectableSavedViews } from "./listViewSummary.js";

// THE LIST VIEW HEADER — one component, every object.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// The metadata layer declares saved views on every object — "Open work", "Active customers",
// "Active parts", "Open orders" — and no screen ever mounted them. It knows exactly what a list is
// filtered by and sorted by, and said none of it out loud: a person looking at a narrowed list
// could not tell, from the list, that it was narrowed.
//
// This is the strip that says what you are looking at:
//
//     Open work ▾
//     31 items · Sorted by Created (newest first) · Filtered by Status, Customer
//
// Deliberately ONE shared component rather than a per-screen header. Every object should read the
// same way, and the moment this is copied into a second screen the two begin to disagree about
// what "items" counts.
//
// It renders and decides nothing: every phrase comes from listViewSummary.js, which is pure.

export default function ListViewHeader({
  def,
  entity,
  criteria,
  total = null,
  activeViewId = null,
  onSelectView = null,
  children = null,
}) {
  const views = selectableSavedViews(def);
  const summary = summarizeListView({
    entity,
    criteria,
    defaultSort: def?.defaultSort ?? null,
    total,
  });

  return (
    <div className="fo-listview-header">
      <div className="fo-listview-header__title">
        {views.length > 0 && onSelectView ? (
          <label className="fo-listview-header__view">
            <span className="fo-sr-only">List view</span>
            <select
              value={activeViewId ?? ""}
              onChange={(e) => onSelectView(e.target.value || null)}
            >
              {/* The unnamed default is a real choice and is named as one. Without it there would
                  be no control to click to leave a saved view. */}
              <option value="">All {def?.label ?? "records"}</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <h2 className="fo-listview-header__heading">{def?.label ?? "Records"}</h2>
        )}
        {children}
      </div>

      {summary && (
        <p className="fo-listview-header__meta" role="status" aria-live="polite">
          {summary}
        </p>
      )}
    </div>
  );
}
