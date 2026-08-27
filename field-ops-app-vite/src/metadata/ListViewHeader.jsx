import { summarizeListView, selectableSavedViews } from "./listViewSummary.js";

// THE VIEWS ROW — one component, every object.
//
// ════════════════════ WHAT THIS WAS, AND WHY IT CHANGED ════════════════════
//
// This began as a HEADER: it rendered the object's label as an `<h2>` (18px/600), or a saved-view
// `<select>` styled to match, with a summary line beneath — "31 items · Sorted by Created (newest
// first) · Filtered by Status, Customer". It existed because the metadata layer declared saved views
// that no screen mounted, and because a narrowed list said nothing about being narrowed. Both of
// those problems were real and both are still solved here.
//
// The Owner's visual review (2026-08-27) found what it had become once every collection also grew a
// North Star page header above it:
//
//   1. A SECOND PAGE IDENTITY. `WorkspaceIdentity` renders the collection's name as a 34px serif
//      `<h1>`. This then rendered the same object's name again, eighteen pixels tall, directly
//      underneath. Two titles for one page — the exact defect GATE 2b records for record pages
//      ("running both doubles the chrome and BOTH claim the h1"), arriving on collections through a
//      different door.
//
//   2. THE SAVED VIEWS DID NOT LOOK LIKE VIEWS. Lists P2 draws them as a views ROW — mutually
//      exclusive tabs with an active underline, which is what Opportunity ships and what the
//      artifact shows. A `<select>` is a form control: it hides every option but one, so a person
//      cannot see that "Open work" and "All" are the two ways to read this collection without
//      opening it.
//
//   3. THE RESULT CONTEXT WAS IN THE WRONG PLACE. P2's anatomy is identity → views → narrowing →
//      RESULT CONTEXT → rows: the sentence that says what you are looking at belongs immediately
//      above the rows it describes, after the controls that produced it. It rendered above the
//      controls, so it described a state the reader had not reached yet.
//
// So this is now the VIEWS ROW and nothing else. It renders no heading — the page already has one.
// The summary moved to `<CollectionResultContext>` below, which pages place just above their grid.
//
// It still renders and decides nothing: every phrase comes from listViewSummary.js, which is pure.

/**
 * The views row: the object's declared saved views as mutually exclusive tabs.
 *
 * Radio semantics rather than buttons, matching OpportunityList — these are exclusive readings of
 * one collection and an assistive reader should hear that, not a row of unrelated controls.
 *
 * Renders NOTHING when the object declares no selectable view or the caller offers no handler. An
 * empty views row would be a strip of chrome asserting a choice that does not exist.
 */
export default function ListViewHeader({
  def,
  entity: _entity,
  criteria: _criteria,
  total: _total,
  activeViewId = null,
  onSelectView = null,
  children = null,
}) {
  const views = selectableSavedViews(def);
  if (views.length === 0 || !onSelectView) return children ?? null;

  return (
    <div className="ns-collection__views" role="radiogroup" aria-label={`${def?.label ?? "Record"} view`}>
      {/* THE UNNAMED DEFAULT IS A REAL CHOICE and is named as one — without it there is no control
          to press to leave a saved view. It was already here as the select's first option; it stays,
          now visible rather than hidden behind a chevron. */}
      <button
        type="button"
        role="radio"
        aria-checked={activeViewId === null}
        className={`ns-view ${activeViewId === null ? "is-active" : ""}`.trim()}
        onClick={() => onSelectView(null)}
      >
        {`All ${def?.label ?? "records"}`}
      </button>
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="radio"
          aria-checked={activeViewId === v.id}
          className={`ns-view ${activeViewId === v.id ? "is-active" : ""}`.trim()}
          onClick={() => onSelectView(v.id)}
        >
          {v.label}
          {/* NO COUNTS. A per-view count needs a governed aggregate per view, and no object has
              one — Lists P2 board 2k. Opportunity's tabs carry counts because its complete read
              can derive them truthfully; a bounded list cannot, and a tally of one page beside a
              tab name is a confident wrong claim about the business. */}
        </button>
      ))}
      {children}
    </div>
  );
}

/**
 * The result context: what you are looking at, immediately above the rows.
 *
 * Separated from the views row above so it can be placed where P2 puts it — after the narrowing
 * controls, not before them. Same sentence, same pure source; only its position changed.
 *
 * Renders nothing when there is nothing true to say, rather than an empty line holding space.
 */
export function CollectionResultContext({ entity, criteria, defaultSort = null, total = null }) {
  const summary = summarizeListView({ entity, criteria, defaultSort, total });
  if (!summary) return null;
  return (
    <p className="ns-collection__result" role="status" aria-live="polite">
      {summary}
    </p>
  );
}
