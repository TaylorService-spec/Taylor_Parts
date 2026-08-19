import { useEffect, useRef } from "react";
import LoadingState from "../shared/ui/LoadingState";
import EmptyState from "../shared/ui/EmptyState";
import FailureState from "../shared/ui/FailureState";
import { Button } from "../shared/ui/primitives/index.js";

// Cell types whose VALUES are numeric quantities (a count, a currency amount) rather
// than text that happens to contain digits (an ENUM label, a formatted date). Only
// these get the tabular-numerals treatment (--font-tabular-nums / .fo-tabular-nums,
// index.css) -- fixed digit width so a column of quantities or amounts does not jitter
// as rows load or values update, and so digits line up for scanning. Deliberately a
// closed list read off the SAME column.type resolveColumns() already resolved
// (listPresentation.js), never a guess from the formatted string -- a "STRING" column
// that happens to render digits (e.g. an ID) must not silently pick up numeral styling.
const NUMERIC_CELL_TYPES = new Set(["NUMBER", "CURRENCY_MINOR"]);

// Renders a list presentation model. Thin by design, exactly like MetadataRecordPage:
// buildListPresentation() already decided the state, the columns, the cell values and
// the copy. This maps that model to EOS table markup and does nothing else.
//
// THE FOUR EMPTIES ARE THE POINT. "No accounts yet", "none match your filters", "you do
// not have access" and "could not be loaded" are four different facts about the world,
// and a component that renders them through one shared empty box would undo the entire
// reason the model distinguishes them. So each state routes to the primitive that
// carries its meaning: EMPTY and FILTERED are legitimate emptiness, DENIED and
// UNAVAILABLE are failures and must never read as "there is nothing here".
//
// The copy itself comes from the model, not from here. Two components rendering the
// same state would otherwise drift into two different sentences for one fact.
//
// X-RELATED-LIST-ACTIONS — this file previously had no row-action affordance and no
// post-create focus handoff, which is the recorded reason the hand-written Contacts and
// Locations sections (AccountDetail.jsx) could not be wired through the metadata list
// runtime without an accessibility regression: they offer per-row context and move
// keyboard focus onto a newly created row, and this component could not. Both are added
// here, additively — every existing caller that passes no `rowActions` and no
// `focusRowKey` renders exactly as before (see the "no-actions callers unchanged" tests).

/**
 * Non-READY states.
 *
 * Kept as one function so it is impossible to add a state that renders nothing: an
 * unhandled state falls through to UNAVAILABLE rather than to a blank region, because a
 * blank region is indistinguishable from a list that legitimately has no rows.
 */
function StateBody({ presentation, onRetry }) {
  const { state, emptyMessage } = presentation;

  if (state === "LOADING") return <LoadingState />;

  if (state === "EMPTY" || state === "FILTERED") {
    return (
      <EmptyState
        title={state === "FILTERED" ? "No matches" : "Nothing here yet"}
        message={emptyMessage}
        // The primitive already draws this exact distinction and names it the same way:
        // "database" means nothing exists yet, "filtered" means records exist and the
        // current filters hide them. Reusing its vocabulary keeps one definition of the
        // difference rather than a second one that can drift.
        variant={state === "FILTERED" ? "filtered" : "database"}
      />
    );
  }

  return (
    <FailureState
      title={state === "DENIED" ? "Not available to you" : "Could not load"}
      message={emptyMessage}
      // Retry is offered only where retrying can help. A denied read retried is a denied
      // read, and a button that cannot work reads as a system that is merely broken.
      action={
        state === "UNAVAILABLE" && onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

export default function MetadataListGrid({
  presentation,
  onRowClick,
  onLoadMore,
  onViewAll,
  onRetry,
  caption,
  // A row action: { id, label, onActivate(rowKey), denied, deniedReason }. The caller
  // (DefaultRelatedList) resolves this list — capability decisions included — before it
  // ever reaches here; this component renders what it is given and makes no
  // authorization decision of its own (same boundary MetadataRecordPage draws for
  // section visibility). Absent or empty renders no actions column at all, which is
  // what keeps every existing no-actions caller pixel-identical.
  rowActions,
  // Post-create focus handoff: the row `key` (the same routing key onRowClick receives)
  // to move focus onto once it is present among `presentation.rows`. Mirrors the
  // ref-then-focus-once pattern AccountDetail.jsx hand-rolls per section
  // (pendingContactFocus/contactRowRef + a useEffect keyed on the live list), so a
  // metadata-driven related list can offer the same behaviour that hand-written pattern
  // exists to provide. `onFocusHandled` fires once the handoff actually lands, so the
  // caller can clear its own pending state the same way AccountDetail does.
  focusRowKey,
  onFocusHandled,
}) {
  const { state, columns, rows, hasMore, viewAllListId, truncated, listId } = presentation;

  const containerRef = useRef(null);
  const rowElementsRef = useRef(new Map());
  // The row key an action button or row most recently held focus on, so that if THAT
  // row disappears from the next render (an action removed it — e.g. a delete), focus
  // loss can be detected and repaired rather than left wherever the browser drops it.
  const lastFocusedRowKeyRef = useRef(null);

  const actions = rowActions && rowActions.length > 0 ? rowActions : null;

  // Post-create focus handoff. Waits for the target row to actually be rendered (the
  // live list may not have delivered it on the render that requested focus) rather than
  // focusing something that is not there yet.
  useEffect(() => {
    if (!focusRowKey) return;
    const el = rowElementsRef.current.get(focusRowKey);
    if (!el) return;
    el.focus();
    onFocusHandled?.();
    // Re-runs whenever the target key changes OR the rendered rows change (the row we
    // are waiting for may only just have arrived).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRowKey, rows]);

  // Keyboard parity for actions that remove their own row: if the element that held
  // focus is gone on the next render, the browser drops focus to <body> — indistinguishable
  // from focus never having been managed at all for anyone navigating by keyboard. Hand
  // it to the list container instead of leaving it stranded off the page.
  useEffect(() => {
    const key = lastFocusedRowKeyRef.current;
    if (key == null) return;
    if (rows.some((r) => r.key === key)) return;
    lastFocusedRowKeyRef.current = null;
    if (typeof document !== "undefined" && document.activeElement === document.body) {
      containerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (state !== "READY") {
    return (
      <div className="fo-list-grid" data-list-id={listId} data-list-state={state}>
        <StateBody presentation={presentation} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div
      className="fo-list-grid"
      data-list-id={listId}
      data-list-state={state}
      ref={containerRef}
      // -1: a valid programmatic focus target (the row-removal fallback above), never
      // an extra stop in the normal tab order.
      tabIndex={-1}
    >
      <div className="fo-table-scroll">
        <table className="fo-table">
          <caption className="fo-sr-only">{caption ?? `${columns.length} column list`}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.fieldId} scope="col">
                  {column.label}
                </th>
              ))}
              {actions && (
                <th scope="col" className="fo-sr-only">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isFocusTarget = row.key === focusRowKey;
              // A row already reachable by navigation keeps its own tabIndex (0). A row
              // with neither navigation nor a pending focus request gets none, exactly
              // as before. A row that IS the post-create focus target but has no
              // onRowClick still needs to be a valid focus destination — the hand-written
              // -1 pattern: programmatically focusable, not a normal tab stop.
              const rowTabIndex = onRowClick ? 0 : isFocusTarget ? -1 : undefined;
              return (
                <tr
                  key={row.key}
                  ref={(el) => {
                    if (el) rowElementsRef.current.set(row.key, el);
                    else rowElementsRef.current.delete(row.key);
                  }}
                  onFocus={() => {
                    lastFocusedRowKeyRef.current = row.key;
                  }}
                  // The document id routes the row and never labels it. It is deliberately
                  // absent from the cells the model produced, so there is no path by which
                  // it reaches a reader as content.
                  onClick={onRowClick ? () => onRowClick(row.key) : undefined}
                  tabIndex={rowTabIndex}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row.key);
                          }
                        }
                      : undefined
                  }
                >
                  {row.cells.map((cell, cellIndex) => {
                    // Positional, not a second lookup by fieldId: buildListPresentation
                    // (listPresentation.js) builds `cells` by mapping `columns` in order,
                    // so index i of one is always index i of the other.
                    const column = columns[cellIndex];
                    const isNumeric = NUMERIC_CELL_TYPES.has(column?.type);
                    return (
                      <td key={cell.fieldId} className={isNumeric ? "fo-tabular-nums" : undefined}>
                        {cell.value}
                      </td>
                    );
                  })}
                  {actions && (
                    <td
                      className="fo-list-grid-actions"
                      // A row action must never also trigger row navigation. Both the
                      // click AND the activating keydown (Enter/Space on a focused
                      // action button) bubble from the button through this cell to the
                      // <tr> above, which is exactly where onRowClick listens — so this
                      // cell stops that bubble before it ever reaches the row.
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {actions.map((action) => (
                        <Button
                          key={action.id}
                          variant="secondary"
                          className="fo-list-grid-action"
                          disabled={!!action.denied}
                          // A denied action stays VISIBLE and LABELED, with the reason it
                          // cannot be used — an unknown or missing capability decision
                          // fails closed, but failing closed by hiding the affordance
                          // entirely would read to the viewer as "no actions exist",
                          // which is a different (false) statement than "you may not do
                          // this one." disabled removes it from the tab order (there is
                          // nothing to activate), while the visible label and title keep
                          // it an honest, explained absence rather than a silent one.
                          // (aria-disabled tracks the primitive's own `disabled` prop.)
                          title={action.denied ? action.deniedReason ?? undefined : undefined}
                          onFocus={() => {
                            lastFocusedRowKeyRef.current = row.key;
                          }}
                          onClick={() => {
                            if (action.denied) return;
                            action.onActivate?.(row.key);
                          }}
                          // Explicit, same as the row's own onKeyDown above, rather than
                          // relying on a <button>'s native Enter/Space default action:
                          // this is the one activation path both a mouse click and a
                          // keyboard press go through, so keyboard parity does not
                          // depend on a browser's default behaviour matching this
                          // handler's own (preventDefault stops the native click a real
                          // browser would otherwise ALSO fire for Enter/Space, which
                          // would double-activate).
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            if (action.denied) return;
                            action.onActivate?.(row.key);
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* An INDEX pages. A RELATED section caps and hands off -- offering "load more"
          there would quietly turn an embedded section into a second unbounded list, and
          the model already refuses to report hasMore for one. */}
      {hasMore && onLoadMore && (
        <Button variant="secondary" onClick={onLoadMore}>
          Load more
        </Button>
      )}

      {truncated && (
        <p className="fo-list-grid-truncation">
          Showing the most recent {rows.length}.{" "}
          {viewAllListId && onViewAll && (
            <Button variant="tertiary" className="fo-link-button" onClick={() => onViewAll(viewAllListId)}>
              View all
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
