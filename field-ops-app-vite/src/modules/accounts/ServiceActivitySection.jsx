import { Link } from "react-router-dom";
import {
  fetchAccountCompletedWorkOrderCount,
  fetchAccountOpenWorkOrderCount,
} from "../../domain/accountWorkOrders";
import { countView, timelineView } from "../../domain/serviceActivityView";
import {
  useAccountWorkOrderCount,
  useAccountWorkOrderTimeline,
} from "../../hooks/useAccountServiceActivity";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import { workOrderStatusWords } from "../../domain/workOrderNorthStar.js";
import { formatDateOnly } from "../../domain/displayTimestamp.js";
import { objectListPath, OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import { Button } from "../../shared/ui/primitives/index.js";
import { useState, useEffect } from "react";
import ImportedServiceHistoryBlock from "./ImportedServiceHistoryBlock.jsx";
import { fetchImportedServiceHistory } from "../../access/importedServiceHistorySource.js";

// SERVICE ACTIVITY -- this account's work, in the North Star row grammar.
//
// Two distinct presentation elements over the same Account's Work Orders, each backed by its OWN
// query and state and NEVER merged: operational summary counts (Completed and Open, themselves two
// INDEPENDENT counts), and the chronological Account Activity timeline. These are operational
// activity counts, NOT financial figures -- rendered under "Service activity", never inside or
// adjacent to a financial surface (docs/architecture/enterprise-business-metrics-framework.md,
// Section 3). Every element renders strictly from its pure view (domain/serviceActivityView.js), so
// one element's failure can never change what another renders -- see test/serviceActivityView.test.mjs.
//
// ════════════════════ WHAT ACCOUNT NORTH STAR P1 CHANGED ════════════════════
//
// 1. STATUS IN WORDS. Each row handed the raw stored token to a pill -- "WORK_IN_PROGRESS" as
//    though it were English. workOrderStatusWords is the governed Work Order vocabulary and is now
//    the one this surface reads, so the account's view of a job and the job's own page cannot word
//    the same state differently. A status the vocabulary cannot place is stated as unrecognised
//    rather than echoed raw.
//
// 2. SCHEDULE AND TECHNICIAN. Both come off the SAME documents the timeline query already fetched
//    (see accountWorkOrders.js) -- no second read of Work Orders. The technician NAME is resolved
//    through resolveTechnicianIdentity against the same fieldops_technicians directory seven other
//    dispatch surfaces already read; its four states stay distinct, and an id that does not resolve
//    is reported as unresolved, never rendered as if it were a name.
//
// 3. THE EQUIPMENT SENTENCE. There is no account-scoped equipment read anywhere in this codebase
//    (CustomerEquipment filters client-side over already-loaded documents, so any count would
//    describe the current page rather than the account). A partial equipment list on a customer
//    record would mislead more than an absent one, so the absence is STATED, with a route to the
//    workspace that can answer properly. No count is invented and no equipment data is fabricated.

// Renders one count from its OWN state via the pure countView().
function CountCell({ label, state }) {
  const view = countView(state);
  if (view.kind === "loading") return <span className="ns-rail__meta">{label} …</span>;
  if (view.kind === "error") return <span className="ns-rail__meta">{label} couldn’t be read</span>;
  return (
    <span className="ns-svc__count">
      {label} <strong>{view.value}</strong>
    </span>
  );
}

// One Work Order row: reference, status in words, schedule, technician. Each cell states its own
// absence rather than rendering blank -- "not scheduled" and "unassigned" are real facts about a
// job, and a blank cell reads as a rendering failure.
function WorkOrderRow({ wo, technicians, techniciansLoading, techniciansError }) {
  const statusWords = wo.status ? workOrderStatusWords(wo.status) : null;
  const tech = resolveTechnicianIdentity(wo.assignedTechId, {
    technicians,
    loading: techniciansLoading,
    error: techniciansError,
  });
  return (
    <li className="ns-svc__row">
      <Link to={`/service/work-orders/${wo.id}`} className="ns-svc__ref">
        {/* woNumber is the governed reference. A Work Order without one states the absence; the
            document id is never a display identity (DECISIONS #106). */}
        {wo.woNumber ?? "Work order — no number recorded"}
      </Link>
      <span className="ns-svc__status">
        {statusWords ?? (wo.status ? "State not recognised" : "State not recorded")}
      </span>
      <span className="ns-svc__when">
        {wo.scheduledStart ? formatDateOnly(wo.scheduledStart) : "Not scheduled"}
      </span>
      <span className="ns-svc__who">
        {tech.state === "unset" ? "Unassigned" : tech.state === "loading" ? "…" : tech.name}
      </span>
    </li>
  );
}

/**
 * Imported historical service, on its OWN state.
 *
 * A fourth independent read beside the two counts and the timeline, following this file's
 * existing rule exactly: one element's failure can never change what another renders. If the
 * imported read is denied or fails, the Work Order timeline above is untouched -- and if there
 * is no imported history at all (the normal case), the block renders nothing.
 *
 * It reads through a trusted callable rather than a Firestore query because
 * `imported_service_history` is deny-all in Rules, which is the correct posture for records
 * carrying another system's free text.
 */
function useImportedServiceHistory(accountId) {
  const [state, setState] = useState({ loading: true, source: null });

  useEffect(() => {
    if (!accountId) {
      setState({ loading: false, source: null });
      return undefined;
    }
    let live = true;
    setState({ loading: true, source: null });
    fetchImportedServiceHistory(accountId).then((source) => {
      // Guarded against an account change mid-flight: a late response for the PREVIOUS
      // customer rendering under this one would attribute somebody else's history.
      if (live) setState({ loading: false, source });
    });
    return () => {
      live = false;
    };
  }, [accountId]);

  return state;
}

export default function ServiceActivitySection({ accountId }) {
  // Two SEPARATE count hooks -- each fetches and error-handles on its own, so Completed failing
  // never hides Open (or vice versa), and neither touches the timeline below.
  const completed = useAccountWorkOrderCount(accountId, fetchAccountCompletedWorkOrderCount);
  const open = useAccountWorkOrderCount(accountId, fetchAccountOpenWorkOrderCount);
  const timeline = useAccountWorkOrderTimeline(accountId);
  const imported = useImportedServiceHistory(accountId);
  const tView = timelineView(timeline);
  const {
    data: technicians,
    loading: techniciansLoading,
    error: techniciansError,
  } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  return (
    <section className="ns-section" aria-label="Service activity">
      <div className="ns-section__head">
        <h2 className="ns-section__title">Service activity</h2>
        <span className="ns-section__meta ns-svc__counts">
          <CountCell label="Open work orders" state={open} />
          <CountCell label="Completed" state={completed} />
        </span>
      </div>

      {/* Account Activity timeline -- its own query/state; loading/empty/error are all distinct,
          never an empty list indistinguishable from an error. */}
      {tView.kind === "loading" ? (
        <p className="ns-state">Loading service activity…</p>
      ) : tView.kind === "error" ? (
        <p className="ns-state">Service activity couldn’t be read. Try again later.</p>
      ) : tView.kind === "empty" ? (
        <p className="ns-state">No service activity yet for this customer.</p>
      ) : (
        <>
          <ul className="ns-svc__list">
            {timeline.items.map((wo) => (
              <WorkOrderRow
                key={wo.id}
                wo={wo}
                technicians={technicians}
                techniciansLoading={techniciansLoading}
                techniciansError={techniciansError}
              />
            ))}
          </ul>

          {timeline.loadMoreError && (
            <p className="ns-state">Could not load more activity. Try again.</p>
          )}

          {timeline.hasMore ? (
            <Button type="button" variant="tertiary" onClick={timeline.loadMore} loading={timeline.loadingMore}>
              Load More
            </Button>
          ) : (
            <p className="ns-table__note">End of activity.</p>
          )}
        </>
      )}

      {/* THE SECOND SOURCE. Below the Work Order list, never interleaved with it, and never
          counted into the two counts above -- those are Work Order counts, and an imported
          record is not a Work Order. */}
      <ImportedServiceHistoryBlock loading={imported.loading} source={imported.source} />

      <p className="ns-table__note">
        Equipment isn’t listed here: no account-scoped equipment read exists yet, and a partial list
        would mislead. <Link to={objectListPath(OBJECT_LIST_KEY.EQUIPMENT)}>Equipment workspace →</Link>
      </p>
    </section>
  );
}
