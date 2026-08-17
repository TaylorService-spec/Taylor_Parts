import LoadingState from "../shared/ui/LoadingState";
import EmptyState from "../shared/ui/EmptyState";
import FailureState from "../shared/ui/FailureState";

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
          <button type="button" className="fo-button fo-button-secondary" onClick={onRetry}>
            Try again
          </button>
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
}) {
  const { state, columns, rows, hasMore, viewAllListId, truncated, listId } = presentation;

  if (state !== "READY") {
    return (
      <div className="fo-list-grid" data-list-id={listId} data-list-state={state}>
        <StateBody presentation={presentation} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="fo-list-grid" data-list-id={listId} data-list-state={state}>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                // The document id routes the row and never labels it. It is deliberately
                // absent from the cells the model produced, so there is no path by which
                // it reaches a reader as content.
                onClick={onRowClick ? () => onRowClick(row.key) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
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
                {row.cells.map((cell) => (
                  <td key={cell.fieldId}>{cell.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* An INDEX pages. A RELATED section caps and hands off -- offering "load more"
          there would quietly turn an embedded section into a second unbounded list, and
          the model already refuses to report hasMore for one. */}
      {hasMore && onLoadMore && (
        <button type="button" className="fo-button fo-button-secondary" onClick={onLoadMore}>
          Load more
        </button>
      )}

      {truncated && (
        <p className="fo-list-grid-truncation">
          Showing the most recent {rows.length}.{" "}
          {viewAllListId && onViewAll && (
            <button type="button" className="fo-link-button" onClick={() => onViewAll(viewAllListId)}>
              View all
            </button>
          )}
        </p>
      )}
    </div>
  );
}
