// PREVIEW LIST -- the rows of a bounded current-work queue, and nothing that looks like a total.
//
// Owner Decision #172. This component renders REAL WORK a person can act on, from a governed read
// that is bounded by nature. It has no props for a count and no place to put one: the only thing it
// can say about what it is not showing is "More items available", which proves more exist without
// claiming how many.
//
// EVERY ROW WEARS BUSINESS IDENTITY. A reorder number, an opportunity name, a customer -- never a
// raw Firestore document id. An id on a dashboard is not merely ugly: it is unusable, because the
// person reading it cannot search for it, say it out loud, or match it to the paper on their desk.
import { Link } from "react-router-dom";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import StatusIndicator from "../../shared/ui/primitives/StatusIndicator.jsx";
import { PREVIEW_STATE } from "../../domain/dashboardPreview.js";

/**
 * @param preview   `boundedPreview(...)` output -- { state, rows, hasMore }.
 * @param subject   what this queue is, for the honest states. "Reorder requests".
 * @param emptyCopy the CONFIRMED-empty sentence. Only ever shown for PREVIEW_STATE.EMPTY, which
 *                  means the read resolved and established there are none.
 * @param viewAll   `{ href, label }` for the governed workspace, or null. Null renders NO call to
 *                  action -- #172 forbids fabricating one when no reachable route exists.
 * @param renderRow row -> { key, primary, secondary, href }. `primary` is the business identity.
 */
export default function PreviewList({ preview, subject, emptyCopy, viewAll = null, renderRow }) {
  if (!preview || preview.state === PREVIEW_STATE.UNKNOWN) {
    // NOT "nothing waiting". The read did not answer, and saying a queue is clear on the strength of
    // a failed read is the one thing this component must never do.
    return <HonestState state={HONEST_STATE.UNAVAILABLE} subject={subject} detail={`${subject} could not be read just now.`} />;
  }

  if (preview.state === PREVIEW_STATE.EMPTY) {
    // A CONFIRMED clean state: the read succeeded and found none. Absence is the signal.
    return <StatusIndicator tone="positive" label={emptyCopy} />;
  }

  return (
    <>
      <ul className="fo-preview-list">
        {preview.rows.map((row) => {
          const r = renderRow(row);
          // ONE WRAPPER IN BOTH CASES. An earlier version rendered a fragment when there was no
          // href, so the row had no wrapper element at all and the layout rule landed on the
          // PRIMARY span -- which became a full-width flex container and pushed the secondary onto
          // its own line. A link and a non-link row must have the same shape, or only one of them
          // is ever really styled.
          const Wrapper = r.href ? Link : "div";
          const wrapperProps = r.href ? { to: r.href } : {};
          return (
            <li key={r.key} className="fo-preview-list__row">
              <Wrapper {...wrapperProps} className="fo-preview-list__line">
                <span className="fo-preview-list__primary">{r.primary}</span>
                {r.secondary && <span className="fo-preview-list__secondary">{r.secondary}</span>}
              </Wrapper>
            </li>
          );
        })}
      </ul>
      <p className="fo-muted fo-preview-list__footer">
        {/* THE ONLY THING SAID ABOUT WHAT IS NOT SHOWN. Never "and 12 more" -- the read cannot
            support that number, and a dashboard that guesses it teaches people to trust the guess. */}
        {preview.hasMore ? "More items available." : "These are the items waiting."}
        {viewAll?.href && (
          <>
            {" "}
            <Link to={viewAll.href}>{viewAll.label ?? "View all"}</Link>
          </>
        )}
      </p>
    </>
  );
}
