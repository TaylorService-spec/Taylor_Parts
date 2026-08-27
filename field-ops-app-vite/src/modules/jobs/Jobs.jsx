import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { fieldPhaseTone } from "../../domain/fieldWorkOrder";
import WorkspaceIdentity from "../../shared/ui/WorkspaceIdentity.jsx";
import HonestState, { HONEST_STATE } from "../../shared/ui/HonestState.jsx";
import Button from "../../shared/ui/primitives/Button.jsx";
import { useAuth } from "../../auth/AuthContext";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
import { createPermissionPreviewer } from "../../access/navPermissionPreview";
import { resolveEffectivePermission } from "../../access/resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "../../access/compatibilityRoles";
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../../config/capabilityActivationOverrides";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";

const previewHasPermission = createPermissionPreviewer(
  resolveEffectivePermission,
  COMPATIBILITY_ROLES,
  CAPABILITY_ACTIVATION_OVERRIDE_SET,
);

// F0 -- this surface now READS the governed Work Order Engine (fieldops_wos)
// instead of the legacy fieldops_jobs collection.
//
// Its legacy "New Job" form is REMOVED rather than migrated. Creating a
// governed Work Order requires a governed customerId + locationId + priority +
// classification (functions/src/createWorkOrder.ts), which the legacy form's
// free-text customer and optional address could not supply. Inventing a
// placeholder customer to keep a create button here would have manufactured
// exactly the ungoverned data F0 exists to eliminate. The governed creation
// path already exists -- WorkOrderWizard at /service/work-orders/new, with a
// real CustomerPicker -- so this surface links there.

export default function Jobs() {
  const navigate = useNavigate();
  const { data: jobs, loading, error } = useWorkOrders();
  // The "Assigned" column showed a bare `fieldops_technicians` document id, which tells the reader
  // nothing about who is doing the work. Naming a technician requires reading the technician names,
  // so this surface now reads that collection -- the SAME read Dispatch and Control Tower already
  // perform. It fails independently and never blocks the work-order table: a technician who cannot
  // read the collection still gets the full list, with the assignment column honestly reporting that
  // the name is unavailable rather than falling back to the id.
  const {
    data: technicians,
    loading: techniciansLoading,
    error: techniciansError,
  } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const [announcement, setAnnouncement] = useState("");
  // The new row keeps a stable tabIndex=-1 (focusRowId is not cleared) so focusing
  // it never blurs when a follow-up render runs -- removing tabIndex from the
  // focused <tr> would drop focus to <body>. focusedOnceRef guards against
  // re-focusing on every later subscription tick.
  const [focusRowId, setFocusRowId] = useState(null);
  const focusedOnceRef = useRef(null);
  const newRowRef = useRef(null);

  // After a successful add, move focus to the new row once the live subscription
  // has delivered it. The id is only an internal match key -- never rendered.
  useEffect(() => {
    if (focusRowId && focusRowId !== focusedOnceRef.current && newRowRef.current) {
      newRowRef.current.focus();
      focusedOnceRef.current = focusRowId;
    }
  }, [focusRowId, jobs]);

  const { role } = useAuth();
  // Row 43 fix -- this button must stay in lockstep with App.jsx's own gate on the
  // /service/work-orders/new route (same permission id + same admin/dispatcher
  // fallback). Without this, a technician (who reaches this page via the "jobs"
  // legacyKey in ROLE_NAV_ACCESS) sees a live-looking primary action that matches
  // no mounted route and silently bounces them to /dashboard via the catch-all.
  const canCreateWorkOrder = previewHasPermission("workOrder.create", role, {
    fallback: role === "admin" || role === "dispatcher",
  });

  // "Nobody is assigned" and "assigned to someone we cannot name" are different facts, and an
  // em dash for both would hide the second one entirely.
  const assignedLabel = (job) => {
    const identity = resolveTechnicianIdentity(job.assignedTechId, {
      technicians,
      loading: techniciansLoading,
      error: techniciansError,
    });
    return identity.state === "unset" ? "Unassigned" : identity.name ?? "…";
  };

  /**
   * Whether the assignment cell is an ABSENCE rather than a value.
   *
   * `Unassigned` is a fact about the work; a name that could not be resolved is a fact about a
   * read. Both used to render as plain text, so a column of them read as one thing. The words
   * were already right — this only marks which are absences so they are styled as absences,
   * exactly as Opportunity's owner column does. No new state, no new read.
   */
  const assignedIsAbsence = (job) =>
    resolveTechnicianIdentity(job.assignedTechId, {
      technicians,
      loading: techniciansLoading,
      error: techniciansError,
    }).state !== "resolved";

  // ONE ACTION, NO RAIL. Lists P2 places a single governed action beside the title; ActionRail
  // exists to arrange a CLUSTER, and a cluster of one is chrome around nothing. The permitted
  // branch was also an `fo-btn-link` anchor while the protected branch was the Button primitive,
  // so the same control changed shape depending on who was looking at it. Both are the primitive
  // now; only the variant differs, which is what the variant is for.
  const actions = canCreateWorkOrder ? (
    <Link to="/service/work-orders/new" className="ns-collection__act-link">
      <Button variant="primary">New Work Order</Button>
    </Link>
  ) : (
    <Button variant="protected" reason="Requires admin or dispatcher role">
      New Work Order
    </Button>
  );

  const settled = !loading && !error;

  return (
    // ════════════════ THE COLLECTION HEADER, NOT THE WORKSPACE SHELL ════════════════
    //
    // OWNER VISUAL REVIEW, 2026-08-27: "Job Assignments does not match Opportunity's collection
    // format." It did not, and it had not been asked to — the Lists P2 disposition classified this
    // surface BLOCKED on a PRODUCT question (is it a distinct assignment board, or an assignment
    // VIEW of Work Orders?), and it therefore received none of the presentation work. That was the
    // wrong inference: the product question governs whether this surface should EXIST, not what it
    // should look like while it does. It is answered here as presentation only, and the product
    // question stays open and untouched.
    //
    // WHAT IS DELIBERATELY STILL ABSENT. Opportunity has a views row, a search box and a filter
    // sheet; this has none of them, and none is invented:
    //
    //   * NO VIEWS — this surface has no governed operational view set. Inventing Open / My Work /
    //     Unassigned would be minting a vocabulary to fill a gap in a screenshot.
    //   * NO SEARCH, NO FILTER — there is no search read here and no declared filter. Adding either
    //     would be new authority, which this correction forbids.
    //
    // Same grammar, not same features. What it DOES share is placement, typography, density and
    // composition for the capabilities that actually exist.
    <WorkspaceIdentity
      crumb="Service → Job Assignments"
      title="Job Assignments"
      // EXACT, and only because this read is complete. `useWorkOrders` is an unfiltered realtime
      // subscription over the whole collection — not a page — so a count over the rows IS the
      // collection count. Null until the read settles: a number printed over a denial would claim
      // the business has no work when the truth is that this reader may not see it.
      count={settled ? jobs.length : null}
      countLabel={jobs.length === 1 ? "work order" : "work orders"}
      // NOTHING TO SUMMARISE TRUTHFULLY. There is no governed attention projection for work orders
      // at collection level (the derivations are record-level — the same named gap the Work Orders
      // list carries), so a workload line here could only be assembled from status words this page
      // happens to hold. Omitted entirely rather than approximated.
      summaryItems={[]}
      action={actions}
    >
      {/* Success announcement -- polite live region for assistive tech. */}
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {loading ? (
        <HonestState state={HONEST_STATE.LOADING} subject="work orders" />
      ) : error ? (
        // Fail VISIBLY -- the denial used to be swallowed, leaving the page spinning forever.
        //
        // It then failed visibly but INACCURATELY: every failure was reported as "you don't have
        // access", so an offline device, a dropped connection or a broken index all accused the user
        // of lacking permission they may well have. The cause now comes from the shared
        // loadErrorMessage helper that Dispatch and Control Tower already use, which keeps
        // permission-denied, unavailable and unknown distinct.
        //
        // The wayfinding half is kept, because it is genuinely useful -- but ONLY when the cause is
        // actually a permission denial. Telling someone whose network dropped to go look somewhere
        // else sends them on an errand that will not work either.
        // DENIED AND UNAVAILABLE ARE DIFFERENT STATES, and both used to render as one muted
        // paragraph carrying role="alert" — an alert styled as a whisper. The distinction the
        // wayfinding sentence already depends on is now the distinction the STATE makes.
        (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") ? (
          <HonestState
            state={HONEST_STATE.DENIED}
            subject="Job Assignments"
            detail={`${loadErrorMessage(error, { entity: "work orders" })} Your own assigned work is available in Technician Workspace.`}
          />
        ) : (
          <HonestState state={HONEST_STATE.UNAVAILABLE} detail={loadErrorMessage(error, { entity: "work orders" })} />
        )
      ) : jobs.length === 0 ? (
        <HonestState state={HONEST_STATE.EMPTY} detail="No work orders yet." />
      ) : (
        <>
          {/* RESULT CONTEXT — what you are looking at, immediately above the rows. Truthful here
              precisely because the subscription is complete: there is no view to be a denominator
              of and no page boundary to hedge, so the sentence states the whole set. */}
          <p className="ns-collection__result">
            {`Showing ${jobs.length} ${jobs.length === 1 ? "work order" : "work orders"}`}
          </p>
          <div className="ns-table-wrap">
            <table className="ns-table ns-collection__table">
              <thead>
                <tr>
                  <th scope="col">Work Order</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  // THE ROW DEFERS TO ITS ANCHOR — the shared collection grammar.
                  //
                  // This file previously recorded the opposite convention: "linking the WO number is
                  // how every other list navigates ... rather than introducing a whole-row click
                  // handler those surfaces deliberately avoid." That was true when it was written
                  // and is now superseded: Opportunity P1v4 established the anchor-deferring row,
                  // and Lists P2 rules it for every collection. The anchor is still the focusable,
                  // activatable thing — the row adds no second tab stop and defers whenever the
                  // event began inside a link — so cmd/middle-click still open a tab.
                  //
                  // Same destination as before. No route was added.
                  <tr
                    key={job.id}
                    ref={job.id === focusRowId ? newRowRef : null}
                    tabIndex={job.id === focusRowId ? -1 : undefined}
                    className="ns-row"
                    onClick={(e) => {
                      if (e.target.closest("a, button")) return;
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      navigate(`/service/work-orders/${job.id}`);
                    }}
                  >
                    {/* IDENTITY: governed reference bold, human subtitle beneath.
                        The complaint was its own column and is now the identity's second line —
                        the P2 row-priority treatment Opportunity uses for `need`. The FACT is
                        unchanged and still on every row; only its composition moved, which is what
                        makes a row scannable by what it IS rather than by four equal columns. */}
                    <td>
                      <Link to={`/service/work-orders/${job.id}`} className="ns-row__ref">
                        {job.woNumber ?? job.id}
                      </Link>
                      {(job.complaint ?? job.description) ? (
                        <span className="ns-row__sub">{job.complaint ?? job.description}</span>
                      ) : null}
                    </td>
                    <td data-label="Assigned">
                      <span className={assignedIsAbsence(job) ? "ns-state--na" : undefined}>
                        {assignedLabel(job)}
                      </span>
                    </td>
                    {/* WORDS + TONE, NO PILL (board 2e), collection-scoped. */}
                    <td data-label="Status">
                      <span className={`ns-row__stage is-${fieldPhaseTone(job)}`}>{job.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </WorkspaceIdentity>
  );
}
